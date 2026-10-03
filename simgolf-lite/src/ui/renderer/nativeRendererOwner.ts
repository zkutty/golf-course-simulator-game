/** Public native operations; implementations must not capture a React scene. */
export interface NativeRendererPorts<Application, Texture, Configuration> {
  create(): Application;
  initialize(application: Application, configuration: Configuration): Promise<void>;
  compatible(created: Configuration, requested: Configuration): boolean;
  resume(application: Application, configuration: Configuration): void;
  stop(application: Application): void;
  detachCanvas(application: Application): void;
  destroy(application: Application): void;
  createDiamond(application: Application): Texture;
  destroyDiamond(texture: Texture): void;
}

// Object identity is the authority. Course names, slots and seeds are irrelevant.
export interface RendererGeneration { readonly generation: number }
export interface RendererRestoreTransaction { readonly generation: number }

interface Completion {
  promise: Promise<void>;
  resolve(): void;
}
function completion(): Completion {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
interface NativeEntry<Application, Texture, Configuration> {
  application: Application;
  configuration: Configuration;
  initialized: Completion;
  settled: boolean;
  destroyed: boolean;
  active: SceneGeneration<Application, Texture, Configuration> | null;
  diamond: Texture | null;
}
interface SceneGeneration<Application, Texture, Configuration> {
  identity: RendererGeneration;
  configuration: Configuration;
  entry: NativeEntry<Application, Texture, Configuration> | null;
  cancelled: boolean;
  failed: boolean;
  ready: boolean;
  cleaned: boolean;
  retain: boolean;
  borrow: boolean;
  acquisitionStarted: boolean;
  acquisition: Promise<Application | null> | null;
}
interface Retirement<Application, Texture, Configuration> {
  scene: SceneGeneration<Application, Texture, Configuration>;
  entry: NativeEntry<Application, Texture, Configuration>;
  complete: Completion;
  queued: boolean;
  failed: boolean;
  error: unknown;
}

/** Bounded ownership across an explicit restore, with fresh React scene generations. */
export class NativeRendererOwner<Application, Texture, Configuration> {
  private readonly ports: NativeRendererPorts<Application, Texture, Configuration>;
  private readonly scenes = new WeakMap<RendererGeneration, SceneGeneration<Application, Texture, Configuration>>();
  private current: NativeEntry<Application, Texture, Configuration> | null = null;
  private latest: SceneGeneration<Application, Texture, Configuration> | null = null;
  private retirement: Retirement<Application, Texture, Configuration> | null = null;
  private transaction: RendererRestoreTransaction | null = null;
  private serial = 0;
  private closed = false;

  constructor(ports: NativeRendererPorts<Application, Texture, Configuration>) {
    this.ports = ports;
  }

  claim(configuration: Configuration, transaction?: RendererRestoreTransaction): RendererGeneration {
    if (this.closed) throw new Error("Native renderer owner is closed");
    if (this.latest && !this.latest.cancelled) throw new Error("Previous renderer generation is still active");
    if (transaction && transaction !== this.transaction) throw new Error("Invalid renderer restore transaction");
    // A claim without the outstanding transaction cannot borrow a parked entry.
    if (!transaction && this.current && !this.current.active) this.destroyEntry(this.current);
    this.transaction = null;
    const identity = Object.freeze({ generation: ++this.serial });
    const scene: SceneGeneration<Application, Texture, Configuration> = {
      identity, configuration, entry: null, cancelled: false, failed: false,
      ready: false, cleaned: false, retain: false, borrow: transaction !== undefined,
      acquisitionStarted: false, acquisition: null,
    };
    this.scenes.set(identity, scene);
    this.latest = scene;
    return identity;
  }

  beginRestore(generation: RendererGeneration): RendererRestoreTransaction {
    const scene = this.scene(generation);
    if (this.closed || this.latest !== scene || scene.cancelled) throw new Error("Inactive renderer restore source");
    const transaction = Object.freeze({ generation: generation.generation });
    scene.retain = true;
    this.transaction = transaction;
    return transaction;
  }

  acquire(generation: RendererGeneration): Promise<Application | null> {
    const scene = this.scene(generation);
    if (scene.cancelled || this.closed) return Promise.resolve(null);
    if (!scene.acquisitionStarted) {
      scene.acquisitionStarted = true;
      scene.acquisition = this.acquireScene(scene).catch((error: unknown) => {
        this.fail(generation);
        throw error;
      });
    }
    return scene.acquisition!;
  }

  isCurrent(generation: RendererGeneration): boolean {
    const scene = this.scene(generation);
    return !this.closed && !scene.cancelled && !scene.failed && this.latest === scene
      && scene.entry !== null && scene.entry.active === scene && scene.entry.settled && !scene.entry.destroyed;
  }

  markReady(generation: RendererGeneration): void {
    if (!this.isCurrent(generation)) throw new Error("Inactive renderer scene cannot become ready");
    this.scene(generation).ready = true;
  }

  /** Call at the original post-atlas/canvas bootstrap point; scenes borrow this texture. */
  diamond(generation: RendererGeneration): Texture {
    if (!this.isCurrent(generation)) throw new Error("Inactive renderer scene cannot generate a diamond");
    const entry = this.scene(generation).entry!;
    entry.diamond ??= this.ports.createDiamond(entry.application);
    return entry.diamond;
  }

  /** Layout cleanup: stop before any passive scene/resource cleanup starts. */
  invalidate(generation: RendererGeneration): void {
    const scene = this.scene(generation);
    if (scene.cancelled) return;
    scene.cancelled = true;
    const entry = scene.entry;
    if (!entry || entry.active !== scene) return;
    // A generation waiting for another lease has no entry and cannot replace this barrier.
    if (!this.retirement) {
      this.retirement = { scene, entry, complete: completion(), queued: false, failed: false, error: undefined };
    } else if (this.retirement.scene !== scene) {
      throw new Error("Concurrent native renderer retirements");
    }
    try { this.ports.stop(entry.application); } catch (error) {
      scene.failed = true;
      this.recordRetirementFailure(this.retirement, error);
    }
    this.finishRetirement();
  }

  /** Queue after every captured old React cleanup has run, never during scene disposal. */
  completeCleanup(generation: RendererGeneration): Promise<void> {
    const scene = this.scene(generation);
    if (!scene.cancelled) throw new Error("Renderer cleanup requires early invalidation");
    scene.cleaned = true;
    this.finishRetirement();
    const retirement = this.retirement;
    return retirement?.scene === scene
      ? retirement.complete.promise.then(() => { if (retirement.failed) throw retirement.error; })
      : Promise.resolve();
  }

  fail(generation: RendererGeneration): void {
    const scene = this.scene(generation);
    // An old async catch must not poison the native entry after it has been rebound.
    if (scene.entry && scene.entry.active !== scene) return;
    scene.failed = true;
    this.invalidate(generation);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.transaction = null;
    const scene = this.latest;
    if (scene && !scene.cancelled) this.invalidate(scene.identity);
    const retirement = this.retirement;
    if (retirement) {
      try { this.ports.stop(retirement.entry.application); } catch (error) {
        retirement.scene.failed = true;
        this.recordRetirementFailure(retirement, error);
      }
      this.finishRetirement();
      await retirement.complete.promise;
      if (retirement.failed) throw retirement.error;
    }
    if (this.current && !this.current.active) this.destroyEntry(this.current);
    this.latest = null;
  }

  private scene(generation: RendererGeneration): SceneGeneration<Application, Texture, Configuration> {
    const scene = this.scenes.get(generation);
    if (!scene) throw new Error("Foreign renderer generation");
    return scene;
  }

  private async acquireScene(scene: SceneGeneration<Application, Texture, Configuration>): Promise<Application | null> {
    while (this.retirement) {
      const retirement = this.retirement;
      await retirement.complete.promise;
      if (retirement.failed) throw retirement.error;
    }
    if (this.closed || scene.cancelled || this.latest !== scene) return null;
    let entry = this.current;
    if (entry && (!scene.borrow || !this.ports.compatible(entry.configuration, scene.configuration))) {
      this.destroyEntry(entry);
      entry = null;
    }
    if (!entry) {
      entry = {
        application: this.ports.create(), configuration: scene.configuration,
        initialized: completion(), settled: false, destroyed: false, active: scene, diamond: null,
      };
      this.current = entry;
      scene.entry = entry;
      try {
        // Native init retains its default autoStart. No explicit first-start/prewarm.
        await this.ports.initialize(entry.application, scene.configuration);
      } catch (error) {
        scene.failed = true;
        this.invalidate(scene.identity);
        throw error;
      } finally {
        entry.settled = true;
        entry.initialized.resolve();
        if (scene.cancelled || this.closed) {
          try { this.ports.stop(entry.application); } catch (error) {
            this.recordStopFailure(scene, error);
          }
        }
        this.finishRetirement();
      }
    } else {
      scene.entry = entry;
      entry.active = scene;
      this.ports.resume(entry.application, scene.configuration);
    }
    if (!this.isCurrent(scene.identity)) return null;
    return entry.application;
  }

  private recordRetirementFailure(retirement: Retirement<Application, Texture, Configuration>, error: unknown): void {
    if (!retirement.failed) {
      retirement.failed = true;
      retirement.error = error;
    }
  }

  private recordStopFailure(scene: SceneGeneration<Application, Texture, Configuration>, error: unknown): void {
    scene.failed = true;
    if (this.retirement?.scene === scene) this.recordRetirementFailure(this.retirement, error);
  }

  private finishRetirement(): void {
    const retirement = this.retirement;
    if (!retirement || retirement.queued || !retirement.scene.cleaned) return;
    retirement.queued = true;
    queueMicrotask(() => { void this.finalizeRetirement(retirement); });
  }

  private async finalizeRetirement(retirement: Retirement<Application, Texture, Configuration>): Promise<void> {
    const { scene, entry } = retirement;
    await entry.initialized.promise;
    try {
      try { this.ports.stop(entry.application); } catch (error) { this.recordRetirementFailure(retirement, error); }
      try { this.ports.detachCanvas(entry.application); } catch (error) { this.recordRetirementFailure(retirement, error); }
      entry.active = null;
      if (retirement.failed || this.closed || scene.failed || !scene.ready || !scene.retain) this.destroyEntry(entry);
    } catch (error) {
      this.recordRetirementFailure(retirement, error);
      try { this.destroyEntry(entry); } catch { /* Preserve the first cleanup failure. */ }
    } finally {
      scene.entry = null;
      scene.acquisition = null;
      if (this.latest === scene) this.latest = null;
      if (this.retirement === retirement) this.retirement = null;
      retirement.complete.resolve();
    }
  }

  private destroyEntry(entry: NativeEntry<Application, Texture, Configuration>): void {
    if (entry.destroyed) return;
    entry.destroyed = true;
    try {
      if (entry.diamond !== null) this.ports.destroyDiamond(entry.diamond);
    } finally {
      entry.diamond = null;
      entry.active = null;
      if (this.current === entry) this.current = null;
      this.ports.destroy(entry.application);
    }
  }
}
