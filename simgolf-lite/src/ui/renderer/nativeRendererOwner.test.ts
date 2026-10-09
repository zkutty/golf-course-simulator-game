import { describe, expect, it } from "vitest";
import { NativeRendererOwner, type NativeRendererPorts } from "./nativeRendererOwner";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type App = { stage: object; running: boolean; destroys: number; attached: boolean };
type Texture = { destroys: number };
type Config = { resolution: number; antialias: boolean; width: number };
const config: Config = { resolution: 1, antialias: true, width: 800 };
function fixture() {
  const apps: App[] = [];
  const textures: Texture[] = [];
  const operations: string[] = [];
  let initGate: ReturnType<typeof deferred> | null = null;
  let resumeError = false;
  const ports: NativeRendererPorts<App, Texture, Config> = {
    create() {
      const app = { stage: {}, running: false, destroys: 0, attached: false };
      apps.push(app); operations.push("create"); return app;
    },
    async initialize(app) {
      operations.push("init");
      const gate = initGate; initGate = null;
      if (gate) await gate.promise;
      app.running = true; operations.push("autoStart");
    },
    compatible: (created, requested) => created.resolution === requested.resolution && created.antialias === requested.antialias,
    resume(app) { if (resumeError) throw new Error("resume failed"); app.running = true; operations.push("resume"); },
    stop(app) { app.running = false; operations.push("stop"); },
    detachCanvas(app) { expect(app.running).toBe(false); app.attached = false; operations.push("detach"); },
    destroy(app) { expect(app.running).toBe(false); app.destroys++; operations.push("destroy"); },
    createDiamond() { const texture = { destroys: 0 }; textures.push(texture); operations.push("diamond"); return texture; },
    destroyDiamond(texture) { texture.destroys++; operations.push("destroyDiamond"); },
  };
  const owner = new NativeRendererOwner(ports);
  const mount = async (settings = config, transaction?: Parameters<typeof owner.claim>[1]) => {
    const scene = owner.claim(settings, transaction);
    const app = await owner.acquire(scene);
    if (!app) throw new Error("unexpected cancelled acquisition");
    app.attached = true;
    const diamond = owner.diamond(scene);
    owner.markReady(scene);
    return { scene, app, diamond };
  };
  return { owner, apps, textures, operations, mount, delayInit() { initGate = deferred(); return initGate; }, failResume() { resumeError = true; } };
}
async function turns() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("NativeRendererOwner", () => {
  it("preserves application, stage and diamond across twelve explicit restores, then destroys once", async () => {
    const f = fixture(); let mounted = await f.mount();
    const { app, diamond } = mounted; const stage = app.stage;
    for (let i = 0; i < 12; i++) {
      const old = mounted.scene; const transaction = f.owner.beginRestore(old);
      f.owner.invalidate(old);
      expect(app.running).toBe(false);
      const next = f.owner.claim({ ...config, width: 800 + i }, transaction);
      let acquired = false; const pending = f.owner.acquire(next).then((value) => { acquired = true; return value; });
      await turns(); expect(acquired).toBe(false);
      expect(app.attached).toBe(true);
      await f.owner.completeCleanup(old);
      expect(await pending).toBe(app); expect(app.stage).toBe(stage);
      expect(app.attached).toBe(false); app.attached = true;
      expect(f.owner.diamond(next)).toBe(diamond); f.owner.markReady(next);
      f.owner.fail(old); expect(f.owner.isCurrent(next)).toBe(true); expect(app.running).toBe(true);
      mounted = { scene: next, app, diamond };
    }
    expect(f.apps).toHaveLength(1); expect(f.textures).toHaveLength(1);
    const closing = f.owner.close(); expect(app.destroys).toBe(0);
    await f.owner.completeCleanup(mounted.scene); await closing; await f.owner.close();
    expect(app.destroys).toBe(1); expect(diamond.destroys).toBe(1);
    expect(f.operations.slice(0, 4)).toEqual(["create", "init", "autoStart", "diamond"]);
  });

  it.each([{ ...config, resolution: 0.75 }, { ...config, antialias: false }])("ends the native lifetime on a generation configuration mismatch", async (settings) => {
    const f = fixture(); const old = await f.mount(); const tx = f.owner.beginRestore(old.scene);
    f.owner.invalidate(old.scene); await f.owner.completeCleanup(old.scene);
    const next = await f.mount(settings, tx);
    expect(next.app).not.toBe(old.app); expect(next.app.stage).not.toBe(old.app.stage);
    expect(next.diamond).not.toBe(old.diamond); expect(old.app.destroys).toBe(1); expect(old.diamond.destroys).toBe(1);
    const closing = f.owner.close(); await f.owner.completeCleanup(next.scene); await closing;
  });

  it("cannot borrow a parked renderer without its explicit transaction", async () => {
    const f = fixture(); const old = await f.mount(); f.owner.beginRestore(old.scene);
    f.owner.invalidate(old.scene); await f.owner.completeCleanup(old.scene);
    const next = await f.mount(); expect(next.app).not.toBe(old.app); expect(old.app.destroys).toBe(1);
    const closing = f.owner.close(); await f.owner.completeCleanup(next.scene); await closing;
  });

  it("rejects a foreign or already consumed restore transaction", async () => {
    const a = fixture(); const b = fixture(); const one = await a.mount(); const two = await b.mount();
    const tx = a.owner.beginRestore(one.scene); a.owner.invalidate(one.scene);
    const foreign = b.owner.beginRestore(two.scene); b.owner.invalidate(two.scene);
    expect(() => a.owner.claim(config, foreign)).toThrow("Invalid");
    const next = a.owner.claim(config, tx); a.owner.invalidate(next);
    expect(() => a.owner.claim(config, tx)).toThrow("Invalid");
    await a.owner.completeCleanup(next); await a.owner.completeCleanup(one.scene); await a.owner.close();
    await b.owner.completeCleanup(two.scene); await b.owner.close();
  });

  it("waits for pending init and all cleanup before closing, even if init autoStarts late", async () => {
    const f = fixture(); const gate = f.delayInit(); const scene = f.owner.claim(config);
    const acquisition = f.owner.acquire(scene);
    expect(f.owner.isCurrent(scene)).toBe(false);
    expect(() => f.owner.markReady(scene)).toThrow("Inactive");
    expect(() => f.owner.diamond(scene)).toThrow("Inactive");
    const closing = f.owner.close();
    expect(f.apps[0].destroys).toBe(0); const cleaned = f.owner.completeCleanup(scene);
    await turns(); expect(f.apps[0].destroys).toBe(0);
    gate.resolve(); expect(await acquisition).toBe(null); await cleaned; await closing;
    expect(f.apps[0].running).toBe(false); expect(f.apps[0].destroys).toBe(1);
    expect(() => f.owner.claim(config)).toThrow("closed");
  });

  it("settles rejected init and destroys the partial instance without parking it", async () => {
    const f = fixture(); const gate = f.delayInit(); const scene = f.owner.claim(config);
    const acquisition = f.owner.acquire(scene); const failure = expect(acquisition).rejects.toThrow("init failed");
    f.owner.beginRestore(scene); f.owner.invalidate(scene); const cleaned = f.owner.completeCleanup(scene);
    gate.reject(new Error("init failed")); await failure; await cleaned; await f.owner.close();
    expect(f.apps[0].destroys).toBe(1); expect(f.apps[0].running).toBe(false); expect(f.textures).toHaveLength(0);
  });

  it("preserves the original retirement barrier through a cancelled app-less middle claim", async () => {
    const f = fixture(); const gate = f.delayInit(); const old = f.owner.claim(config);
    const oldAcquire = f.owner.acquire(old); const tx1 = f.owner.beginRestore(old);
    f.owner.invalidate(old); const barrier = f.owner.completeCleanup(old);
    const middle = f.owner.claim(config, tx1); const middleAcquire = f.owner.acquire(middle);
    const tx2 = f.owner.beginRestore(middle); f.owner.invalidate(middle); await f.owner.completeCleanup(middle);
    const third = f.owner.claim(config, tx2); const thirdAcquire = f.owner.acquire(third);
    await turns(); expect(f.apps).toHaveLength(1); expect(f.apps[0].destroys).toBe(0);
    gate.resolve(); expect(await oldAcquire).toBe(null); await barrier; expect(await middleAcquire).toBe(null);
    const current = await thirdAcquire; expect(current).toBe(f.apps[1]); expect(f.apps[0].destroys).toBe(1);
    f.owner.markReady(third); const closing = f.owner.close(); await f.owner.completeCleanup(third); await closing;
    expect(f.apps.map((app) => app.destroys)).toEqual([1, 1]);
  });

  it("does not publish a scene cancelled during atlas work, and fences stale ready/texture calls", async () => {
    const f = fixture(); const scene = f.owner.claim(config); await f.owner.acquire(scene);
    f.owner.beginRestore(scene); f.owner.invalidate(scene);
    expect(() => f.owner.markReady(scene)).toThrow("Inactive"); expect(() => f.owner.diamond(scene)).toThrow("Inactive");
    await f.owner.completeCleanup(scene); expect(f.apps[0].destroys).toBe(1); await f.owner.close();
  });

  it("an acquisition/resume failure invalidates only its captured generation", async () => {
    const f = fixture(); const old = await f.mount(); const tx = f.owner.beginRestore(old.scene);
    f.owner.invalidate(old.scene); await f.owner.completeCleanup(old.scene); f.failResume();
    const next = f.owner.claim(config, tx); await expect(f.owner.acquire(next)).rejects.toThrow("resume failed");
    expect(f.owner.isCurrent(next)).toBe(false); expect(old.app.running).toBe(false);
    await f.owner.completeCleanup(next); await f.owner.close(); expect(old.app.destroys).toBe(1);
  });

  it("incoming borrow authority does not authorize parking after a later ordinary unmount", async () => {
    const f = fixture(); const old = await f.mount(); const tx = f.owner.beginRestore(old.scene);
    f.owner.invalidate(old.scene); await f.owner.completeCleanup(old.scene);
    const next = await f.mount(config, tx); expect(next.app).toBe(old.app);
    f.owner.invalidate(next.scene); await f.owner.completeCleanup(next.scene);
    expect(next.app.destroys).toBe(1); expect(next.diamond.destroys).toBe(1); await f.owner.close();
  });

  it("a throwing stop still establishes retirement, detaches and destroys after cleanup, and reports failure", async () => {
    const application = { running: false, destroys: 0, attached: true };
    const texture = { destroys: 0 };
    const owner = new NativeRendererOwner({
      create: () => application,
      initialize: async () => { application.running = true; },
      compatible: () => true,
      resume: () => { application.running = true; },
      stop: () => { throw new Error("stop failed"); },
      detachCanvas: () => { application.attached = false; },
      destroy: () => { application.running = false; application.destroys++; },
      createDiamond: () => texture,
      destroyDiamond: () => { texture.destroys++; },
    });
    const scene = owner.claim(config); await owner.acquire(scene); owner.diamond(scene); owner.markReady(scene);
    const tx = owner.beginRestore(scene); owner.invalidate(scene);
    expect(application.destroys).toBe(0); expect(application.attached).toBe(true);
    const next = owner.claim(config, tx);
    const acquiring = expect(owner.acquire(next)).rejects.toThrow("stop failed");
    await expect(owner.completeCleanup(scene)).rejects.toThrow("stop failed"); await acquiring;
    expect(application).toEqual({ running: false, destroys: 1, attached: false }); expect(texture.destroys).toBe(1);
    await expect(owner.acquire(scene)).resolves.toBe(null); await owner.completeCleanup(next); await owner.close();
  });

  it.each([0, "", null, undefined])("preserves a falsy cleanup exception (%s) and never parks the native entry", async (failure) => {
    const application = { running: false, destroys: 0, attached: true };
    const owner = new NativeRendererOwner({
      create: () => application,
      initialize: async () => { application.running = true; },
      compatible: () => true,
      resume: () => { application.running = true; },
      stop: () => { application.running = false; },
      detachCanvas: () => { throw failure; },
      destroy: () => { application.attached = false; application.destroys++; },
      createDiamond: () => ({}),
      destroyDiamond: () => undefined,
    });
    const scene = owner.claim(config); await owner.acquire(scene); owner.markReady(scene);
    const tx = owner.beginRestore(scene); owner.invalidate(scene); const next = owner.claim(config, tx);
    const observe = (promise: Promise<unknown>) => promise.then(() => ({ failed: false, error: undefined }), (error: unknown) => ({ failed: true, error }));
    const acquiring = observe(owner.acquire(next)); const closing = observe(owner.close());
    expect(await observe(owner.completeCleanup(scene))).toEqual({ failed: true, error: failure });
    expect(await acquiring).toEqual({ failed: true, error: failure }); expect(await closing).toEqual({ failed: true, error: failure });
    expect(application).toEqual({ running: false, destroys: 1, attached: false }); await owner.completeCleanup(next);
  });

  it("cancelled acquisition remains a Promise after retirement clears its cached result", async () => {
    const f = fixture(); const mounted = await f.mount(); f.owner.invalidate(mounted.scene);
    await f.owner.completeCleanup(mounted.scene);
    const reacquiring = f.owner.acquire(mounted.scene); expect(reacquiring).toBeInstanceOf(Promise);
    expect(await reacquiring).toBe(null); await f.owner.close();
  });

  it("finalizes a failed restore while parked without another scene", async () => {
    const f = fixture(); const old = await f.mount(); f.owner.beginRestore(old.scene);
    f.owner.invalidate(old.scene); await f.owner.completeCleanup(old.scene);
    expect(old.app.destroys).toBe(0); await f.owner.close(); expect(old.app.destroys).toBe(1); expect(old.diamond.destroys).toBe(1);
  });

  it.each([false, true])("continues one canceled pre-entry restore with original retirement parked=%s", async (parked) => {
    const f = fixture(); const old = await f.mount(); const tx = f.owner.beginRestore(old.scene);
    f.owner.invalidate(old.scene);
    if (parked) await f.owner.completeCleanup(old.scene);
    const proxy = f.owner.claim(config, tx);
    expect(f.owner.replayPendingRestore(proxy)).toBe(null); // Still active.
    f.owner.invalidate(proxy);
    const continuation = f.owner.replayPendingRestore(proxy);
    expect(continuation).not.toBe(null);
    expect(f.owner.replayPendingRestore(proxy)).toBe(null); // Mint once.
    await f.owner.completeCleanup(proxy);
    const next = f.owner.claim(config, continuation!);
    const pending = f.owner.acquire(next);
    if (!parked) await f.owner.completeCleanup(old.scene);
    expect(await pending).toBe(old.app); expect(f.owner.diamond(next)).toBe(old.diamond);
    f.owner.markReady(next);
    // Incoming continuation never authorizes an ordinary outgoing park.
    f.owner.invalidate(next); await f.owner.completeCleanup(next);
    expect(old.app.destroys).toBe(1); expect(old.diamond.destroys).toBe(1); await f.owner.close();
  });

  it("does not mint replay from ordinary, entry-bound, failed, closed or foreign generations", async () => {
    const f = fixture(); const initial = f.owner.claim(config); f.owner.invalidate(initial);
    expect(f.owner.replayPendingRestore(initial)).toBe(null); await f.owner.completeCleanup(initial);
    const old = await f.mount(); const tx = f.owner.beginRestore(old.scene); f.owner.invalidate(old.scene);
    await f.owner.completeCleanup(old.scene);
    const bound = f.owner.claim(config, tx); await f.owner.acquire(bound); f.owner.invalidate(bound);
    expect(f.owner.replayPendingRestore(bound)).toBe(null);
    await f.owner.completeCleanup(bound); expect(old.app.destroys).toBe(1);
    const fresh = await f.mount(); const tx2 = f.owner.beginRestore(fresh.scene); f.owner.invalidate(fresh.scene);
    await f.owner.completeCleanup(fresh.scene);
    const failed = f.owner.claim(config, tx2); f.owner.fail(failed);
    expect(f.owner.replayPendingRestore(failed)).toBe(null);
    expect(f.owner.replayPendingRestore(bound)).toBe(null); // Obsolete.
    expect(() => f.owner.replayPendingRestore({ generation: failed.generation })).toThrow("Foreign");
    await f.owner.completeCleanup(failed); await f.owner.close();
    expect(f.owner.replayPendingRestore(failed)).toBe(null); expect(fresh.app.destroys).toBe(1);
  });

  it("rejects a pending replay token failed before consumption and fences failure after consumption", async () => {
    const f = fixture(); const old = await f.mount(); const tx = f.owner.beginRestore(old.scene);
    f.owner.invalidate(old.scene); await f.owner.completeCleanup(old.scene);
    const proxy = f.owner.claim(config, tx); f.owner.invalidate(proxy);
    const replay = f.owner.replayPendingRestore(proxy)!;
    f.owner.fail(proxy); expect(() => f.owner.claim(config, replay)).toThrow("Invalid");
    await f.owner.completeCleanup(proxy); const fresh = await f.mount();
    expect(fresh.app).not.toBe(old.app); expect(old.app.destroys).toBe(1);
    const tx2 = f.owner.beginRestore(fresh.scene); f.owner.invalidate(fresh.scene); await f.owner.completeCleanup(fresh.scene);
    const proxy2 = f.owner.claim(config, tx2); f.owner.invalidate(proxy2);
    const replay2 = f.owner.replayPendingRestore(proxy2)!; await f.owner.completeCleanup(proxy2);
    const current = await f.mount(config, replay2); f.owner.fail(proxy2);
    expect(f.owner.isCurrent(current.scene)).toBe(true); expect(current.app).toBe(fresh.app);
    const closing = f.owner.close(); await f.owner.completeCleanup(current.scene); await closing;
  });

});
