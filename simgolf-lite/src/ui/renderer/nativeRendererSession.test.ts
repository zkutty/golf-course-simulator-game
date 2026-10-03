import { describe, expect, it } from "vitest";
import { completeNativeSceneDisposers, guardNativeRendererCleanup, NativeRendererSession } from "./nativeRendererSession";
import { NativeRendererOwner, type NativeRendererPorts } from "./nativeRendererOwner";

type App = { stage: object; running: boolean; attached: boolean; destroys: number };
type Texture = { destroys: number };
function fixture() {
  const apps: App[] = [];
  const textures: Texture[] = [];
  let initialize: (() => Promise<void>) | null = null;
  const ports: NativeRendererPorts<App, Texture, number> = {
    create() { const app = { stage: {}, running: false, attached: false, destroys: 0 }; apps.push(app); return app; },
    async initialize(app) { await initialize?.(); app.running = true; },
    compatible: (created, requested) => created === requested,
    resume(app) { app.running = true; },
    stop(app) { app.running = false; },
    detachCanvas(app) { expect(app.running).toBe(false); app.attached = false; },
    destroy(app) { expect(app.running).toBe(false); app.destroys++; },
    createDiamond() { const texture = { destroys: 0 }; textures.push(texture); return texture; },
    destroyDiamond(texture) { texture.destroys++; },
  };
  const session = new NativeRendererSession(() => new NativeRendererOwner(ports));
  const mount = async (configuration = 1) => {
    const lease = session.claim(configuration);
    const app = await lease.owner.acquire(lease.generation);
    if (!app) throw new Error("Cancelled mount");
    app.attached = true;
    const diamond = lease.owner.diamond(lease.generation);
    lease.owner.markReady(lease.generation);
    return { lease, app, diamond };
  };
  const cleanup = async (mounted: Awaited<ReturnType<typeof mount>>) => {
    const closing = session.close(); await session.completeCleanup(mounted.lease); await closing;
  };
  return { session, apps, textures, mount, cleanup, delayInit(callback: () => Promise<void>) { initialize = callback; } };
}
async function turns() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("NativeRendererSession App lifetime", () => {
  it("requires one stable demanded factory and creates no owner during configuration", () => {
    const f = fixture();
    const session = new NativeRendererSession<App, Texture, number>();
    expect(() => session.claim(1)).toThrow("not configured");
    let creates = 0;
    const factory = () => { creates++; return f.session.claim(1).owner; };
    session.configure(factory); session.configure(factory);
    expect(creates).toBe(0); expect(f.apps).toHaveLength(0);
    expect(() => session.configure(() => factory())).toThrow("cannot change");
  });
  it("creates no native resources until a generation acquires", () => {
    const f = fixture(); f.session.beginRestore(); f.session.claim(1);
    expect(f.apps).toHaveLength(0); expect(f.textures).toHaveLength(0);
  });

  it("retains only explicitly authorized compatible restores across twelve fresh generations", async () => {
    const f = fixture(); let current = await f.mount(); const first = current;
    for (let i = 0; i < 12; i++) {
      f.session.beginRestore(); const old = current; f.session.invalidate(old.lease);
      // Loading can invoke this again after unmount without losing the transaction.
      f.session.beginRestore();
      let published = false;
      const pending = f.mount().then((value) => { published = true; return value; });
      await turns(); expect(published).toBe(false); expect(old.app.running).toBe(false);
      await f.session.completeCleanup(old.lease); current = await pending;
      expect(current.lease.generation).not.toBe(old.lease.generation);
      expect(current.app).toBe(first.app); expect(current.app.stage).toBe(first.app.stage);
      expect(current.diamond).toBe(first.diamond);
      await f.session.fail(old.lease);
      expect(current.lease.owner.isCurrent(current.lease.generation)).toBe(true);
    }
    expect(f.apps).toHaveLength(1); await f.cleanup(current);
    expect(first.app.destroys).toBe(1); expect(first.diamond.destroys).toBe(1);
  });

  it("does not borrow after ordinary unmount or after incompatible restore", async () => {
    const f = fixture(); const first = await f.mount(); f.session.invalidate(first.lease);
    await f.session.completeCleanup(first.lease); const second = await f.mount();
    expect(second.app).not.toBe(first.app); expect(first.app.destroys).toBe(1);
    f.session.beginRestore(); f.session.invalidate(second.lease); await f.session.completeCleanup(second.lease);
    const third = await f.mount(2); expect(third.app).not.toBe(second.app);
    expect(second.app.destroys).toBe(1); await f.cleanup(third);
  });

  it("close clears the App handle before awaiting old cleanup, allowing StrictMode's fresh setup", async () => {
    const f = fixture(); const old = await f.mount(); const closing = f.session.close();
    const fresh = await f.mount(); expect(fresh.lease.owner).not.toBe(old.lease.owner);
    expect(fresh.app).not.toBe(old.app); expect(old.app.destroys).toBe(0);
    await f.session.completeCleanup(old.lease); await closing; await f.session.fail(old.lease);
    expect(fresh.lease.owner.isCurrent(fresh.lease.generation)).toBe(true);
    expect(fresh.app.running).toBe(true); await f.cleanup(fresh);
    expect(f.apps.map((app) => app.destroys)).toEqual([1, 1]);
  });

  it("current failure closes only the failed owner while fresh setup can proceed", async () => {
    const f = fixture(); const old = await f.mount(); f.session.beginRestore();
    const failing = f.session.fail(old.lease); const fresh = await f.mount();
    expect(fresh.lease.owner).not.toBe(old.lease.owner);
    await f.session.completeCleanup(old.lease); await failing;
    expect(old.app.destroys).toBe(1); expect(old.diamond.destroys).toBe(1);
    expect(fresh.lease.owner.isCurrent(fresh.lease.generation)).toBe(true); await f.cleanup(fresh);
  });

  it("a cleanup failure invalidates park eligibility and never poisons an incoming generation", async () => {
    const f = fixture(); const old = await f.mount(); f.session.beginRestore(); f.session.invalidate(old.lease);
    const pending = f.mount(); old.lease.owner.fail(old.lease.generation);
    await f.session.completeCleanup(old.lease); const fresh = await pending;
    expect(old.app.destroys).toBe(1); expect(fresh.app).not.toBe(old.app);
    await f.session.fail(old.lease); expect(fresh.lease.owner.isCurrent(fresh.lease.generation)).toBe(true);
    await f.cleanup(fresh);
  });

  it("closing during pending initialization awaits captured settlement without retaining a failed borrow", async () => {
    const f = fixture(); let settle!: () => void;
    f.delayInit(() => new Promise<void>((resolve) => { settle = resolve; }));
    const lease = f.session.claim(1); const acquire = lease.owner.acquire(lease.generation);
    const closing = f.session.close(); const cleaned = f.session.completeCleanup(lease);
    await turns(); expect(f.apps[0].destroys).toBe(0); settle();
    expect(await acquire).toBe(null); await cleaned; await closing;
    expect(f.apps[0].destroys).toBe(1); expect(f.apps[0].running).toBe(false);
  });
});


describe("StrictMode restore claim replay", () => {
  it.each([false, true])("cancels before native acquire and retains explicit restore when old parked=%s", async (parked) => {
    const f = fixture(); const old = await f.mount(); f.session.beginRestore(); f.session.invalidate(old.lease);
    if (parked) await f.session.completeCleanup(old.lease);
    const proxy = f.session.claim(1); let cancelled = false; let firstAcquired = false;
    const firstSetup = (async () => {
      await Promise.resolve(); if (cancelled) return;
      firstAcquired = true; await proxy.owner.acquire(proxy.generation);
    })();
    cancelled = true; f.session.invalidate(proxy); await f.session.completeCleanup(proxy);
    const next = f.mount(); await firstSetup; expect(firstAcquired).toBe(false);
    if (!parked) await f.session.completeCleanup(old.lease);
    const current = await next; expect(current.app).toBe(old.app); expect(current.diamond).toBe(old.diamond);
    expect(f.apps).toHaveLength(1); await f.session.fail(proxy);
    expect(current.lease.owner.isCurrent(current.lease.generation)).toBe(true); await f.cleanup(current);
  });

  it("pending source failure revokes only its own token before claim", async () => {
    const f = fixture(); const old = await f.mount(); f.session.beginRestore(); f.session.invalidate(old.lease);
    await f.session.completeCleanup(old.lease);
    const proxy = f.session.claim(1); f.session.invalidate(proxy); await f.session.completeCleanup(proxy);
    await f.session.fail(proxy); const fresh = await f.mount();
    expect(fresh.app).not.toBe(old.app); expect(old.app.destroys).toBe(1); await f.cleanup(fresh);
  });

  it("close revokes pending replay and future setup uses a fresh lifetime", async () => {
    const f = fixture(); const old = await f.mount(); f.session.beginRestore(); f.session.invalidate(old.lease);
    await f.session.completeCleanup(old.lease);
    const proxy = f.session.claim(1); f.session.invalidate(proxy); await f.session.completeCleanup(proxy);
    await f.session.close(); const fresh = await f.mount();
    expect(fresh.lease.owner).not.toBe(proxy.owner); expect(fresh.app).not.toBe(old.app);
    expect(old.app.destroys).toBe(1); await f.cleanup(fresh);
  });
});

describe("captured native scene cleanup", () => {
  it.each([new Error("dispose failed"), 0, "", null, undefined])("attempts all disposers and preserves first failure %s", (error) => {
    const operations: string[] = [];
    let failed = false;
    let caught: unknown;
    try { completeNativeSceneDisposers([
      () => { operations.push("controller"); throw error; },
      () => { operations.push("host"); throw new Error("second"); },
      () => { operations.push("terrain"); },
    ]); } catch (failure) { failed = true; caught = failure; }
    expect(failed).toBe(true); expect(caught).toBe(error);
    expect(operations).toEqual(["controller", "host", "terrain"]);
  });

  it("a failed earlier React cleanup prevents native parking even when final teardown succeeds", async () => {
    const f = fixture(); const old = await f.mount();
    const failure = new Error("controller failed");
    const cleanup = guardNativeRendererCleanup(old.lease, () => { throw failure; });
    f.session.beginRestore(); f.session.invalidate(old.lease); const next = f.mount();
    expect(cleanup).toThrow(failure); await f.session.completeCleanup(old.lease);
    const current = await next; expect(old.app.destroys).toBe(1);
    expect(current.app).not.toBe(old.app); await f.cleanup(current);
  });
});
