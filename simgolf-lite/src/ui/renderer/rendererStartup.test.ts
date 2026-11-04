import { describe, expect, it, vi } from "vitest";
import { prepareRendererStartup } from "./rendererStartup";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("prepareRendererStartup", () => {
  it("starts imports during initialization and activates atlases only after both settle", async () => {
    const init = deferred<void>();
    const modules = deferred<string>();
    const activation = deferred<number>();
    const calls: string[] = [];
    const result = prepareRendererStartup(
      () => { calls.push("init"); return init.promise; },
      () => { calls.push("modules"); return modules.promise; },
      () => { calls.push("atlas"); return activation.promise; },
      () => false,
    );
    expect(calls).toEqual(["init", "modules"]);
    modules.resolve("scene modules");
    await Promise.resolve();
    expect(calls).toEqual(["init", "modules"]);
    init.resolve(undefined);
    await vi.waitFor(() => expect(calls).toEqual(["init", "modules", "atlas"]));
    activation.resolve(7);
    await expect(result).resolves.toEqual({ kind: "ready", modules: "scene modules", activation: 7 });
  });

  it("handles an import rejection while init is pending and keeps init-error precedence", async () => {
    const init = deferred<void>();
    const modules = deferred<string>();
    const atlas = vi.fn(async () => 1);
    const result = prepareRendererStartup(() => init.promise, () => modules.promise, atlas, () => false);
    modules.reject(new Error("import failed"));
    // A turn passes before init rejects; an unhandled import rejection would fail this test.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const initError = new Error("init failed");
    init.reject(initError);
    await expect(result).rejects.toBe(initError);
    expect(atlas).not.toHaveBeenCalled();
  });

  it("cancels after init without waiting for imports or activating atlases", async () => {
    const init = deferred<void>();
    const modules = deferred<string>();
    const atlas = vi.fn(async () => 1);
    let cancelled = false;
    const result = prepareRendererStartup(() => init.promise, () => modules.promise, atlas, () => cancelled);
    cancelled = true;
    init.resolve(undefined);
    await expect(result).resolves.toEqual({ kind: "cancelled" });
    modules.reject(new Error("late import failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(atlas).not.toHaveBeenCalled();
  });

  it("preserves the import failure for the existing owner cleanup handler", async () => {
    const importError = new Error("import failed");
    const atlas = vi.fn(async () => 1);
    const release = vi.fn();
    await prepareRendererStartup(
      async () => {},
      async () => { throw importError; },
      atlas,
      () => false,
    ).catch(release);
    expect(release).toHaveBeenCalledExactlyOnceWith(importError);
    expect(atlas).not.toHaveBeenCalled();
  });

  it("does not activate atlases when cancelled after module settlement", async () => {
    const init = deferred<void>();
    const modules = deferred<string>();
    const atlas = vi.fn(async () => 1);
    let cancelled = false;
    const result = prepareRendererStartup(() => init.promise, () => modules.promise, atlas, () => cancelled);
    modules.resolve("loaded");
    await Promise.resolve();
    cancelled = true;
    init.resolve(undefined);
    await expect(result).resolves.toEqual({ kind: "cancelled" });
    expect(atlas).not.toHaveBeenCalled();
  });

  it("a cancelled old owner ignores a late import failure after a new owner becomes ready", async () => {
    const oldModules = deferred<string>();
    const oldAtlas = vi.fn(async () => 1);
    const oldCleanup = vi.fn();
    let oldCancelled = false;
    const oldResult = prepareRendererStartup(async () => {}, () => oldModules.promise, oldAtlas, () => oldCancelled)
      .catch(oldCleanup);
    await Promise.resolve(); // The old owner has passed its post-init cancellation check.
    const newAtlas = vi.fn(async () => 2);
    await expect(prepareRendererStartup(async () => {}, async () => "new", newAtlas, () => false))
      .resolves.toEqual({ kind: "ready", modules: "new", activation: 2 });
    oldCancelled = true;
    oldModules.reject(new Error("old import failed"));
    await expect(oldResult).resolves.toEqual({ kind: "cancelled" });
    expect(oldCleanup).not.toHaveBeenCalled();
    expect(oldAtlas).not.toHaveBeenCalled();
    expect(newAtlas).toHaveBeenCalledOnce();
  });

  it("does not publish a completed atlas activation after cancellation", async () => {
    const activation = deferred<number>();
    const atlas = vi.fn(() => activation.promise);
    let cancelled = false;
    const result = prepareRendererStartup(async () => {}, async () => "loaded", atlas, () => cancelled);
    await vi.waitFor(() => expect(atlas).toHaveBeenCalledOnce());
    cancelled = true;
    activation.resolve(3);
    await expect(result).resolves.toEqual({ kind: "cancelled" });
  });

  it("keeps a cancelled StrictMode owner separate from the new owner", async () => {
    const oldInit = deferred<void>();
    const oldModules = deferred<string>();
    const oldAtlas = vi.fn(async () => 1);
    const newAtlas = vi.fn(async () => 2);
    let oldCancelled = false;
    const oldResult = prepareRendererStartup(() => oldInit.promise, () => oldModules.promise, oldAtlas, () => oldCancelled);
    oldCancelled = true;
    const newResult = prepareRendererStartup(async () => {}, async () => "new", newAtlas, () => false);
    await expect(newResult).resolves.toEqual({ kind: "ready", modules: "new", activation: 2 });
    oldInit.resolve(undefined);
    await expect(oldResult).resolves.toEqual({ kind: "cancelled" });
    oldModules.resolve("old");
    expect(oldAtlas).not.toHaveBeenCalled();
    expect(newAtlas).toHaveBeenCalledOnce();
  });
});
