import { beforeEach, describe, expect, it } from "vitest";
import {
  __createIndexedDbKVForTests,
  __resetSaveStoreForTests,
  __setSaveModuleImporterForTests,
  __setSaveStoreKVForTests,
  __failNextManifestWriteForTests,
  autosave,
  deleteSlot,
  exportSlot,
  importSave,
  listSlots,
  loadSlot,
  mostRecentSlot,
  quicksave,
  renameSlot,
  saveToSlot,
  subscribeToSaveSlots,
} from "./saveStore";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { CURRENT_SAVE_SCHEMA_VERSION, type SavePayload } from "./save";
import { BIOME_KEYS, biomeCompatibilityMetadataFor } from "../game/models/biomes";

function payload(week = 1, cash = 25_000, name = "Test Links"): SavePayload {
  return {
    course: { ...DEFAULT_COURSE, name },
    world: { ...DEFAULT_WORLD, week, cash },
    history: [],
  };
}

/** Runs the production driver against serialized transactions and durable storage. */
function transactionalIndexedDb() {
  const values = new Map<string, string>();
  const transactions: Array<{ mode: IDBTransactionMode; operations: string[] }> = [];
  const pending: Array<() => Promise<void>> = [];
  let running = false;
  let holdNext = false;
  let throwPut = 0;
  let signalHeld: (() => void) | undefined;
  let releaseHeld: ((abort: boolean) => void) | undefined;
  const drain = async () => {
    if (running) return;
    running = true;
    while (pending.length) await pending.shift()!();
    running = false;
  };
  const database = {
    transaction: (_store: string, mode: IDBTransactionMode) => {
      const record = { mode, operations: [] as string[] };
      transactions.push(record);
      const requests: Array<() => void> = [];
      const tx = {
        oncomplete: null as Handler,
        onerror: null as Handler,
        onabort: null as Handler,
        error: null as DOMException | null,
        abort: () => {
          if (aborted) throw new DOMException("Already aborted", "InvalidStateError");
          aborted = true;
          tx.error = new DOMException("Aborted", "AbortError");
          queueMicrotask(() => tx.onabort?.(new Event("abort")));
        },
        objectStore: () => ({
          get: (key: string) => request("get", () => staged.get(key)),
          put: (value: string, key: string) => request("put", () => { staged.set(key, value); return key; }),
          delete: (key: string) => request("delete", () => { staged.delete(key); }),
        }),
      };
      let staged = new Map<string, string>();
      let aborted = false;
      function request<T>(operation: string, perform: () => T) {
        record.operations.push(operation);
        if (operation === "put" && throwPut && --throwPut === 0) throw new DOMException("Disk full", "QuotaExceededError");
        const req = deferredRequest<T>(undefined as T);
        requests.push(() => { req.result = perform(); req.onsuccess?.(new Event("success")); });
        return req as unknown as IDBRequest<T>;
      }
      pending.push(async () => {
        staged = new Map(values);
        while (requests.length && !aborted) {
          requests.shift()!();
          await Promise.resolve();
        }
        if (mode === "readwrite" && holdNext && !aborted) {
          holdNext = false;
          await new Promise<void>((resolve) => {
            releaseHeld = (abort) => { if (abort) tx.abort(); resolve(); };
            signalHeld?.();
          });
        }
        if (aborted) return;
        if (mode === "readwrite") {
          values.clear();
          for (const [key, value] of staged) values.set(key, value);
        }
        tx.oncomplete?.(new Event("complete"));
      });
      queueMicrotask(() => { void drain(); });
      return tx as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
  const open = deferredRequest<IDBDatabase>(database);
  const factory = { open: () => { queueMicrotask(() => open.onsuccess?.(new Event("success"))); return open; } } as unknown as IDBFactory;
  return {
    factory, values, transactions,
    holdCommit: () => { holdNext = true; return new Promise<void>((resolve) => { signalHeld = resolve; }); },
    finishCommit: (abort = false) => { releaseHeld?.(abort); },
    throwOnPut: (ordinal: number) => { throwPut = ordinal; },
  };
}

describe("atomic IndexedDB slot publication", () => {
  beforeEach(() => __resetSaveStoreForTests());

  it("commits a slot payload and manifest in one transaction against the production driver", async () => {
    const fake = transactionalIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    await driver.ready;
    __setSaveStoreKVForTests(driver);
    const meta = await saveToSlot("atomic", "manual", "Atomic", payload(4));
    expect(fake.transactions).toHaveLength(1);
    expect(fake.transactions[0]).toEqual({ mode: "readwrite", operations: ["get", "put", "put"] });
    expect(JSON.parse(fake.values.get("coursecraft_saves_manifest_v1")!)).toMatchObject([{ id: meta.id, week: 4 }]);
    expect(JSON.parse(fake.values.get(meta.storageKey!)!).world.week).toBe(4);
  });

  it("publishes the replacement and notifies listeners only after transaction completion", async () => {
    const fake = transactionalIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    await driver.ready;
    __setSaveStoreKVForTests(driver);
    const previous = await saveToSlot("atomic", "manual", "Atomic", payload(2));
    const held = fake.holdCommit();
    let notifications = 0;
    let settled = false;
    const unsubscribe = subscribeToSaveSlots(() => notifications++);
    try {
      const pending = saveToSlot("atomic", "manual", "Atomic", payload(9)).then((meta) => { settled = true; return meta; });
      await held;
      expect(settled).toBe(false);
      expect(notifications).toBe(0);
      expect((await listSlots())[0].week).toBe(2);
      expect(fake.values.has(previous.storageKey!)).toBe(true);
      fake.finishCommit();
      const committed = await pending;
      expect(settled).toBe(true);
      expect(notifications).toBe(1);
      expect((await listSlots())[0].week).toBe(9);
      expect(fake.values.has(previous.storageKey!)).toBe(false);
      expect(fake.values.has(committed.storageKey!)).toBe(true);
    } finally { unsubscribe(); }
  });

  it("rolls back payload, manifest and cache after successful requests but an aborted commit", async () => {
    const fake = transactionalIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    await driver.ready;
    __setSaveStoreKVForTests(driver);
    const previous = await saveToSlot("atomic", "manual", "Atomic", payload(2));
    const before = [...fake.values];
    const held = fake.holdCommit();
    let notifications = 0;
    const unsubscribe = subscribeToSaveSlots(() => notifications++);
    try {
      const pending = saveToSlot("atomic", "manual", "Atomic", payload(9));
      const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await held;
      fake.finishCommit(true);
      await rejected;
      expect([...fake.values]).toEqual(before);
      expect((await listSlots())[0].storageKey).toBe(previous.storageKey);
      expect((await loadSlot(previous.id))?.world.week).toBe(2);
      expect(notifications).toBe(0);
    } finally { unsubscribe(); }
  });

  it("aborts queued payload writes if enqueueing the manifest throws synchronously", async () => {
    const fake = transactionalIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    await driver.ready;
    __setSaveStoreKVForTests(driver);
    const previous = await saveToSlot("atomic", "manual", "Atomic", payload(2));
    const before = [...fake.values];
    fake.throwOnPut(2);
    await expect(saveToSlot("atomic", "manual", "Atomic", payload(9))).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect([...fake.values]).toEqual(before);
    expect((await listSlots())[0].storageKey).toBe(previous.storageKey);
  });

  it("keeps both simultaneous new slots in the current durable manifest", async () => {
    const fake = transactionalIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    await driver.ready;
    __setSaveStoreKVForTests(driver);
    const saved = await Promise.all([saveToSlot("first", "manual", "First", payload(2)), saveToSlot("second", "manual", "Second", payload(9))]);
    expect(fake.transactions).toHaveLength(2);
    expect((await listSlots()).map((meta) => meta.id).sort()).toEqual(["first", "second"]);
    expect(JSON.parse(fake.values.get("coursecraft_saves_manifest_v1")!).map((meta: { id: string }) => meta.id)).toEqual(["first", "second"]);
    expect(saved.every((meta) => fake.values.has(meta.storageKey!))).toBe(true);
  });

  it("serializes simultaneous replacements and removes only superseded revision keys", async () => {
    const fake = transactionalIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    await driver.ready;
    __setSaveStoreKVForTests(driver);
    const [first, second] = await Promise.all([saveToSlot("same", "manual", "Same", payload(2)), saveToSlot("same", "manual", "Same", payload(9))]);
    expect((await listSlots())).toMatchObject([{ id: "same", seq: second.seq, week: 9 }]);
    expect(fake.values.has(first.storageKey!)).toBe(false);
    expect(fake.values.has(second.storageKey!)).toBe(true);
    expect((await loadSlot("same"))?.world.week).toBe(9);
  });

  it("reads the durable manifest rather than overwriting an entry absent from the runtime cache", async () => {
    const fake = transactionalIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    await driver.ready;
    __setSaveStoreKVForTests(driver);
    const previous = await saveToSlot("first", "manual", "First", payload(2));
    await driver.set("coursecraft_saves_manifest_v1", JSON.stringify([previous, { ...previous, id: "other-runtime", storageKey: "other-runtime-payload" }]));
    await saveToSlot("new", "manual", "New", payload(9));
    expect((await listSlots()).map((meta) => meta.id).sort()).toEqual(["first", "new", "other-runtime"]);
  });
});

type Handler = ((event: Event) => void) | null;

interface FakeRequest<T> {
  onsuccess: Handler;
  onerror: Handler;
  onupgradeneeded: Handler;
  result: T;
  error: DOMException | null;
}

interface FakeTransaction {
  oncomplete: Handler;
  onerror: Handler;
  onabort: Handler;
  error: DOMException | null;
  store: {
    put: (value: string, key: string) => IDBRequest<IDBValidKey>;
    get: (key: string) => IDBRequest<string | undefined>;
  };
  objectStore: () => IDBObjectStore;
}

function deferredRequest<T>(result: T): FakeRequest<T> {
  return { onsuccess: null, onerror: null, onupgradeneeded: null, result, error: null };
}

function controlledIndexedDb() {
  const write = deferredRequest<IDBValidKey>("key");
  const read = deferredRequest<string | undefined>("saved value");
  const transaction = {
    oncomplete: null,
    onerror: null,
    onabort: null,
    error: null,
    store: {
      put: () => write as unknown as IDBRequest<IDBValidKey>,
      get: () => read as unknown as IDBRequest<string | undefined>,
    },
    objectStore: () => transaction.store as unknown as IDBObjectStore,
  } as FakeTransaction;
  const database = {
    transaction: () => transaction as unknown as IDBTransaction,
  } as unknown as IDBDatabase;
  const open = deferredRequest<IDBDatabase>(database);
  const factory = {
    open: () => open as unknown as IDBOpenDBRequest,
  } as unknown as IDBFactory;
  return { factory, open, transaction, write, read };
}

describe("saveStore", () => {
  beforeEach(() => {
    __resetSaveStoreForTests();
  });

  it("waits for an IndexedDB transaction to complete before confirming a write", async () => {
    const fake = controlledIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    fake.open.onsuccess?.(new Event("success"));
    await driver.ready;

    let settled = false;
    const write = driver.set("key", "value").then(() => {
      settled = true;
    });
    await Promise.resolve();
    fake.write.onsuccess?.(new Event("success"));
    await Promise.resolve();
    expect(settled).toBe(false);

    fake.transaction.oncomplete?.(new Event("complete"));
    await write;
    expect(settled).toBe(true);
  });

  it("returns a readonly value at request success after a durable write boundary", async () => {
    const fake = controlledIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    fake.open.onsuccess?.(new Event("success"));
    await driver.ready;

    const read = driver.get("key");
    await Promise.resolve();
    fake.read.onsuccess?.(new Event("success"));

    await expect(read).resolves.toBe("saved value");
    expect(fake.transaction.oncomplete).not.toBeNull();
  });

  it("rejects an IndexedDB write when its transaction aborts after request success", async () => {
    const fake = controlledIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    fake.open.onsuccess?.(new Event("success"));
    await driver.ready;

    const write = driver.set("key", "value");
    await Promise.resolve();
    fake.write.onsuccess?.(new Event("success"));
    fake.transaction.error = new DOMException("disk full", "QuotaExceededError");
    fake.transaction.onabort?.(new Event("abort"));

    await expect(write).rejects.toMatchObject({ name: "QuotaExceededError" });
  });

  it("rejects an IndexedDB write when its transaction reports an error", async () => {
    const fake = controlledIndexedDb();
    const driver = __createIndexedDbKVForTests(fake.factory);
    fake.open.onsuccess?.(new Event("success"));
    await driver.ready;

    const write = driver.set("key", "value");
    await Promise.resolve();
    fake.transaction.error = new DOMException("database failure", "UnknownError");
    fake.transaction.onerror?.(new Event("error"));

    await expect(write).rejects.toMatchObject({ name: "UnknownError" });
  });

  it("saves, lists, and loads a manual slot round-trip", async () => {
    const meta = await saveToSlot(null, "manual", "My course", payload(7, 31_500));
    expect(meta.week).toBe(7);
    expect(meta.cash).toBe(31_500);
    expect(meta.courseName).toBe("Test Links");
    expect(meta).toMatchObject({
      experienceProfile: "classic",
      economicPressure: "balanced",
      systemControl: { profile: "classic", automated: 13, manual: 0, overrides: 0 },
    });
    expect(meta.difficulty).toBeUndefined();

    const slots = await listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe("My course");
    expect(slots[0]).toMatchObject({
      experienceProfile: "classic",
      economicPressure: "balanced",
      systemControl: { profile: "classic", automated: 13, manual: 0, overrides: 0 },
    });

    const loaded = await loadSlot(meta.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.world.week).toBe(7);
    expect(loaded!.course.elevations).toHaveLength(DEFAULT_COURSE.width * DEFAULT_COURSE.height);
  });

  it("lists a durably committed slot from the manifest snapshot without another KV read", async () => {
    const values = new Map<string, string>();
    let reads = 0;
    __setSaveStoreKVForTests({
      get: async (key) => {
        reads++;
        return values.get(key) ?? null;
      },
      set: async (key, value) => void values.set(key, value),
      del: async (key) => void values.delete(key),
    });

    const meta = await saveToSlot(null, "manual", "Committed", payload(6));
    const readsBeforeListing = reads;
    const slots = await listSlots();

    expect(slots).toMatchObject([{ id: meta.id, name: "Committed", week: 6 }]);
    expect(reads).toBe(readsBeforeListing);
  });

  it("notifies open slot pickers only after the manifest commit succeeds", async () => {
    let notifications = 0;
    const unsubscribe = subscribeToSaveSlots(() => {
      notifications++;
    });
    try {
      const meta = await saveToSlot(null, "manual", "Committed", payload(2));
      expect(notifications).toBe(1);

      __failNextManifestWriteForTests();
      await expect(saveToSlot(meta.id, "manual", meta.name, payload(3))).rejects.toThrow("interrupted");
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it("overwrites when saving to an existing slot id", async () => {
    const meta = await saveToSlot(null, "manual", "Slot", payload(1));
    await saveToSlot(meta.id, "manual", "Slot", payload(9));
    const slots = await listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].week).toBe(9);
  });

  it("keeps the last known-good revision when a save is interrupted before manifest commit", async () => {
    const meta = await saveToSlot(null, "manual", "Protected slot", payload(3, 28_000));
    __failNextManifestWriteForTests();
    await expect(saveToSlot(meta.id, "manual", meta.name, payload(9, 99_000))).rejects.toThrow("interrupted");

    const slots = await listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ id: meta.id, week: 3, cash: 28_000 });
    const loaded = await loadSlot(meta.id);
    expect(loaded?.world).toMatchObject({ week: 3, cash: 28_000 });
  });

  it("keeps a slot readable when deletion is interrupted before manifest commit", async () => {
    const meta = await saveToSlot(null, "manual", "Protected slot", payload(6, 44_000));
    __failNextManifestWriteForTests();
    await expect(deleteSlot(meta.id)).rejects.toThrow("interrupted");

    expect(await listSlots()).toHaveLength(1);
    expect((await loadSlot(meta.id))?.world).toMatchObject({ week: 6, cash: 44_000 });
  });

  it("autosave rotates through three slots, replacing the oldest", async () => {
    for (let week = 1; week <= 5; week++) {
      await autosave(payload(week));
    }
    const autos = (await listSlots()).filter((m) => m.kind === "auto");
    expect(autos).toHaveLength(3);
    const weeks = autos.map((m) => m.week).sort((a, b) => a - b);
    expect(weeks).toEqual([3, 4, 5]); // weeks 1-2 rotated out
  });

  it("commits overlapping autosaves in request order", async () => {
    const values = new Map<string, string>();
    let releaseFirstPayload!: () => void;
    let reportFirstPayload!: () => void;
    let reportSecondPayload!: () => void;
    const firstPayloadStarted = new Promise<void>((resolve) => { reportFirstPayload = resolve; });
    const firstPayloadReleased = new Promise<void>((resolve) => { releaseFirstPayload = resolve; });
    const secondPayloadStarted = new Promise<void>((resolve) => { reportSecondPayload = resolve; });
    let payloadWrites = 0;
    __setSaveStoreKVForTests({
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        if (key.startsWith("coursecraft_save_")) {
          payloadWrites++;
          if (payloadWrites === 1) {
            reportFirstPayload();
            await firstPayloadReleased;
          } else if (payloadWrites === 2) {
            reportSecondPayload();
          }
        }
        values.set(key, value);
      },
      del: async (key) => void values.delete(key),
    });

    const older = autosave(payload(1));
    await firstPayloadStarted;
    const newer = autosave(payload(2));
    await Promise.race([
      secondPayloadStarted,
      new Promise<void>((resolve) => setTimeout(resolve, 20)),
    ]);
    releaseFirstPayload();
    await Promise.all([older, newer]);

    const recent = await mostRecentSlot();
    expect(recent?.week).toBe(2);
    expect((await loadSlot(recent!.id))?.world.week).toBe(2);
  });

  it("round-trips every registered biome through autosave, export, and fresh-profile import", async () => {
    for (const theme of BIOME_KEYS) {
      __resetSaveStoreForTests();
      const source = payload(8, 52_000, `${theme} portable`);
      source.course = {
        ...source.course,
        theme,
        biomeCompatibility: undefined,
      };
      const saved = await autosave(source);
      const text = await exportSlot(saved.id);
      expect(text).not.toBeNull();
      expect(JSON.parse(text!).course.biomeCompatibility).toEqual(
        biomeCompatibilityMetadataFor(theme),
      );

      __resetSaveStoreForTests();
      const imported = await importSave(text!, `${theme} imported`);
      expect(imported).not.toBeNull();
      const restored = await loadSlot(imported!.id);
      expect(restored?.course.theme).toBe(theme);
      expect(restored?.course.biomeCompatibility).toEqual(
        biomeCompatibilityMetadataFor(theme),
      );
      expect(restored?.world).toMatchObject({ week: 8, cash: 52_000 });
    }
  });

  it("quicksave reuses one slot; rename and delete work", async () => {
    await quicksave(payload(2));
    await quicksave(payload(3));
    let slots = await listSlots();
    expect(slots.filter((m) => m.kind === "quick")).toHaveLength(1);
    expect(slots[0].week).toBe(3);

    await renameSlot("quick", "Before the lake job");
    slots = await listSlots();
    expect(slots[0].name).toBe("Before the lake job");

    await deleteSlot("quick");
    expect(await listSlots()).toHaveLength(0);
    expect(await loadSlot("quick")).toBeNull();
  });

  it("retries a transient warmed save-module import instead of caching its rejection", async () => {
    let attempts = 0;
    __setSaveModuleImporterForTests(async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient save module load failure");
      return import("./save");
    });

    await expect(quicksave(payload(2))).rejects.toThrow("transient save module load failure");
    await expect(quicksave(payload(3))).resolves.toMatchObject({ id: "quick", week: 3 });
    expect(attempts).toBe(2);
  });

  it("mostRecentSlot returns the newest of any kind", async () => {
    const a = await saveToSlot(null, "manual", "Old", payload(1));
    a.savedAt = 0; // not persisted; recency is by savedAt at write time
    await autosave(payload(2));
    const recent = await mostRecentSlot();
    expect(recent!.kind).toBe("auto");
  });

  it("export → import round-trips a playable payload as a new slot", async () => {
    const meta = await saveToSlot(null, "manual", "Exported", payload(12, 40_000));
    const text = await exportSlot(meta.id);
    expect(text).not.toBeNull();
    const exported = JSON.parse(text!);
    expect(exported.appProfile).toMatchObject({ version: 5, gameplay: { autosaveCadence: "weekly" }, achievements: { earned: [] } });
    expect(exported.schemaVersion).toBe(CURRENT_SAVE_SCHEMA_VERSION);
    expect(exported.course.biomeCompatibility).toMatchObject({
      version: 1,
      biome: "parkland",
      contentVersion: 1,
    });

    __resetSaveStoreForTests(); // fresh browser
    const imported = await importSave(text!, "Imported course");
    expect(imported).not.toBeNull();
    const loaded = await loadSlot(imported!.id);
    expect(loaded!.world.week).toBe(12);
    expect(loaded!.world.cash).toBe(40_000);
  });

  it("sanitizes malformed buildings on import instead of crashing later", async () => {
    const p = payload(2);
    const file = JSON.stringify({
      schemaVersion: 1,
      savedAt: 0,
      course: {
        ...p.course,
        buildings: [
          { type: "castle", x: 1, y: 1 }, // unknown type
          { type: "clubhouse", x: -5, y: 2 }, // out of bounds
          { type: "clubhouse", x: 3.7, y: 4 }, // non-integer
          "junk", // not even an object
          { type: "clubhouse", x: 3, y: 4 }, // the one valid entry
        ],
      },
      world: p.world,
    });
    const meta = await importSave(file, "sneaky");
    expect(meta).not.toBeNull();
    const loaded = await loadSlot(meta!.id);
    expect(loaded!.course.buildings).toEqual([{ id: "building-clubhouse-3-4", type: "clubhouse", x: 3, y: 4 }]);

    const nonArray = JSON.stringify({
      schemaVersion: 1,
      savedAt: 0,
      course: { ...p.course, buildings: "nope" },
      world: p.world,
    });
    const meta2 = await importSave(nonArray, "sneaky2");
    expect((await loadSlot(meta2!.id))!.course.buildings).toEqual([]);
  });

  it("hostile imports return null and leave existing slots untouched", async () => {
    await saveToSlot(null, "manual", "Keep me", payload(4));
    expect(await importSave("not json at all", "x")).toBeNull();
    expect(await importSave('{"schemaVersion":99}', "x")).toBeNull();
    expect(await importSave('{"schemaVersion":1,"course":{"tiles":"nope"},"world":{}}', "x")).toBeNull();
    const slots = await listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe("Keep me");
  });
});
