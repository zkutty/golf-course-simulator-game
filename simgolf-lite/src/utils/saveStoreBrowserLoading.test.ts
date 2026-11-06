import { afterEach, expect, it, vi } from "vitest";

// A delivered-code failure is not evidence that an existing user's IndexedDB is unavailable.
afterEach(() => { vi.doUnmock("./saveStoreBrowser"); vi.unstubAllGlobals(); vi.resetModules(); });
it("propagates a browser driver chunk failure without switching to localStorage or memory", async () => {
  vi.resetModules();
  let fallbackReads = 0;
  let opens = 0;
  vi.stubGlobal("indexedDB", { open: () => { opens++; throw new Error("Must not open"); } });
  vi.stubGlobal("localStorage", { getItem: () => { fallbackReads++; return null; }, setItem: () => { throw new Error("Must not write fallback"); } });
  vi.doMock("./saveStoreBrowser", () => { throw new Error("Browser driver chunk unavailable"); });
  const store = await import("./saveStore");
  await expect(store.listSlots()).rejects.toThrow();
  // Legacy migration reads the existing legacy key once; no fallback manifest reads are allowed.
  expect(fallbackReads).toBeLessThanOrEqual(1);
  expect(opens).toBe(0);
  store.__resetSaveStoreForTests();
});


it("retains the existing fallback policy for an actual IDB-open rejection after module delivery", async () => {
  vi.resetModules();
  let disposed = 0;
  let manifestReads = 0;
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => { if (key === "coursecraft_saves_manifest_v1") manifestReads++; return null; },
    setItem: () => undefined,
  });
  vi.doMock("./saveStoreBrowser", () => ({ createBrowserSaveKV: () => ({
    ready: Promise.reject(new DOMException("Storage denied", "SecurityError")),
    dispose: () => disposed++,
  }) }));
  const store = await import("./saveStore");
  expect(await store.listSlots()).toEqual([]);
  expect(disposed).toBe(1);
  expect(manifestReads).toBe(1);
  store.__resetSaveStoreForTests();
});
