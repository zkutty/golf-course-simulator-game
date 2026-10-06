import { expect, it, vi } from "vitest";
import { initializeRendererModules } from "./initializeRendererModules";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it("starts imports before acquisition and preserves the exact fulfilled tuple after ownership", async () => {
  const native = deferred<{ id: number }>(), modules = deferred<readonly [string, number]>();
  const events: string[] = [], app = { id: 1 }, tuple = ["scene", 7] as const;
  const pending = initializeRendererModules({
    loadModules: () => { events.push("imports"); return modules.promise; },
    acquire: () => { events.push("acquire"); return native.promise; },
    acquired: (value) => { expect(value).toBe(app); events.push("owned"); },
    isCurrent: () => true,
  });
  expect(events).toEqual(["imports", "acquire"]);
  modules.resolve(tuple); native.resolve(app);
  const result = await pending;
  expect(result?.application).toBe(app); expect(result?.modules).toBe(tuple);
  expect(events).toEqual(["imports", "acquire", "owned"]);
});

it("native failure and a null claim finish without awaiting unresolved imports", async () => {
  for (const failed of [true, false]) {
    const native = deferred<{ id: number } | null>(), modules = deferred<string>();
    const acquired = vi.fn(), error = Error("native failure");
    const pending = initializeRendererModules({ loadModules: () => modules.promise, acquire: () => native.promise, acquired, isCurrent: () => true });
    if (failed) { native.reject(error); await expect(pending).rejects.toBe(error); }
    else { native.resolve(null); expect(await pending).toBeNull(); }
    expect(acquired).not.toHaveBeenCalled();
    // A later abandoned import error already has the helper's rejection handler.
    modules.reject(Error("late import failure")); await Promise.resolve();
  }
});

it("retired claims preserve acquire notification and suppress late import errors before consumption", async () => {
  const native = deferred<{ id: number }>(), modules = deferred<string>();
  const acquired = vi.fn(); let current = true;
  const pending = initializeRendererModules({ loadModules: () => modules.promise, acquire: () => native.promise, acquired, isCurrent: () => current });
  native.resolve({ id: 2 }); await Promise.resolve();
  expect(acquired).toHaveBeenCalledTimes(1);
  current = false; modules.reject(Error("retired import failure"));
  expect(await pending).toBeNull();
});

it("a claim retired before acquire completes need not wait for modules", async () => {
  const native = deferred<{ id: number }>(), modules = deferred<string>(), acquired = vi.fn();
  const pending = initializeRendererModules({ loadModules: () => modules.promise, acquire: () => native.promise, acquired, isCurrent: () => false });
  native.resolve({ id: 3 }); expect(await pending).toBeNull(); expect(acquired).toHaveBeenCalledTimes(1);
  modules.reject(Error("abandoned")); await Promise.resolve();
});

it("current import failure is the exact error after acquisition, including synchronous loader failure", async () => {
  for (const synchronous of [false, true]) {
    const native = deferred<{ id: number }>(), modules = deferred<string>(), acquired = vi.fn(), error = Error("import failure");
    const pending = initializeRendererModules({ loadModules: () => { if (synchronous) throw error; return modules.promise; }, acquire: () => native.promise, acquired, isCurrent: () => true });
    if (!synchronous) modules.reject(error);
    native.resolve({ id: 4 }); await expect(pending).rejects.toBe(error); expect(acquired).toHaveBeenCalledTimes(1);
  }
});
