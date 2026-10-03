import type { NativeRendererOwner, RendererGeneration, RendererRestoreTransaction } from "./nativeRendererOwner";

export interface NativeRendererLease<Application, Texture, Configuration> {
  readonly owner: NativeRendererOwner<Application, Texture, Configuration>;
  readonly generation: RendererGeneration;
}

/** An App lifetime handle. Native ports must be top-level functions without scene closures. */
export class NativeRendererSession<Application, Texture, Configuration> {
  private createOwner: (() => NativeRendererOwner<Application, Texture, Configuration>) | null;
  private owner: NativeRendererOwner<Application, Texture, Configuration> | null = null;
  private lease: NativeRendererLease<Application, Texture, Configuration> | null = null;
  private restore: RendererRestoreTransaction | null = null;

  constructor(createOwner?: () => NativeRendererOwner<Application, Texture, Configuration>) {
    this.createOwner = createOwner ?? null;
  }

  /** Installed by the demanded scene module, without initializing native resources. */
  configure(createOwner: () => NativeRendererOwner<Application, Texture, Configuration>): void {
    if (this.createOwner && this.createOwner !== createOwner) throw new Error("Renderer session factory cannot change");
    this.createOwner = createOwner;
  }

  claim(configuration: Configuration): NativeRendererLease<Application, Texture, Configuration> {
    if (!this.createOwner) throw new Error("Renderer scene module has not configured the session");
    const owner = this.owner ?? this.createOwner();
    this.owner = owner;
    const generation = owner.claim(configuration, this.restore ?? undefined);
    this.restore = null;
    const lease = Object.freeze({ owner, generation });
    this.lease = lease;
    return lease;
  }

  beginRestore(): void {
    // Loading may already have unmounted the old generation. Keep its pending transaction.
    if (this.lease) this.restore = this.lease.owner.beginRestore(this.lease.generation);
  }

  invalidate(lease: NativeRendererLease<Application, Texture, Configuration>): void {
    lease.owner.invalidate(lease.generation);
    if (this.lease === lease) this.lease = null;
  }

  completeCleanup(lease: NativeRendererLease<Application, Texture, Configuration>): Promise<void> {
    return lease.owner.completeCleanup(lease.generation);
  }

  fail(lease: NativeRendererLease<Application, Texture, Configuration>): Promise<void> {
    lease.owner.fail(lease.generation);
    if (this.owner === lease.owner && this.lease === lease) {
      this.owner = null;
      this.lease = null;
      this.restore = null;
      return lease.owner.close();
    }
    // Late work belongs to a retired generation and cannot close a rebound owner.
    return Promise.resolve();
  }

  close(): Promise<void> {
    const owner = this.owner;
    // Clear before awaiting old cleanup. StrictMode's later setup can claim a fresh owner.
    this.owner = null;
    this.lease = null;
    this.restore = null;
    return owner?.close() ?? Promise.resolve();
  }
}

/** Capture the generation during setup; React may continue other cleanups after an error. */
export function guardNativeRendererCleanup<Application, Texture, Configuration>(
  lease: NativeRendererLease<Application, Texture, Configuration> | undefined,
  cleanup: () => void,
): () => void {
  return () => {
    try { cleanup(); } catch (error) {
      lease?.owner.fail(lease.generation);
      throw error;
    }
  };
}

/** Attempt every independently owned disposer, preserving even a falsy first error. */
export function completeNativeSceneDisposers(disposers: readonly (() => void)[]): void {
  let failed = false;
  let firstError: unknown;
  for (const dispose of disposers) {
    try { dispose(); } catch (error) {
      if (!failed) { failed = true; firstError = error; }
    }
  }
  if (failed) throw firstError;
}
