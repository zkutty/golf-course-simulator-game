import type { SaveSlotMeta } from "./saveStore";
import { MANIFEST_KEY, parseManifest, payloadKey, type SaveKV } from "./saveStoreManifest";

export interface IndexedSaveKV extends SaveKV {
  ready: Promise<void>;
  commitSerializedSlot(meta: SaveSlotMeta, serialized: string, consumeFailure?: () => boolean): Promise<SaveSlotMeta[]>;
}

export function createIndexedDbKV(factory: IDBFactory, defaultConsumeFailure: () => boolean = () => false): IndexedSaveKV {
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("coursecraft-saves", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open;
    const awaitCommit = mode === "readwrite";
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction("kv", mode);
      let request: IDBRequest<T> | undefined;
      let requestSucceeded = false;
      let result: T;
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      // A successful write request is only an intermediate acknowledgement.
      // Its data is not visible/durable until the transaction completes, and
      // a later abort must still reject the operation. A readonly get has no
      // commit boundary: request success already means it observed a visible
      // value, so returning then avoids making the load UI wait on unrelated
      // transaction cleanup after a completed save.
      t.oncomplete = () => {
        if (settled) return;
        if (!requestSucceeded) {
          fail(new Error("IndexedDB transaction completed without a successful request"));
          return;
        }
        settled = true;
        resolve(result);
      };
      t.onerror = () => fail(t.error ?? request?.error ?? new Error("IndexedDB transaction failed"));
      t.onabort = () => fail(t.error ?? request?.error ?? new Error("IndexedDB transaction aborted"));

      try {
        request = run(t.objectStore("kv"));
        request.onsuccess = () => {
          if (!awaitCommit) {
            settled = true;
            resolve(request!.result);
            return;
          }
          requestSucceeded = true;
          result = request!.result;
        };
        request.onerror = () => fail(request!.error ?? t.error ?? new Error("IndexedDB request failed"));
      } catch (error) {
        fail(error);
      }
    });
  };
  const commitSerializedSlot = async (meta: SaveSlotMeta, serialized: string, consumeFailure = defaultConsumeFailure): Promise<SaveSlotMeta[]> => {
    const db = await open;
    return new Promise<SaveSlotMeta[]>((resolve, reject) => {
      const transaction = db.transaction("kv", "readwrite");
      const store = transaction.objectStore("kv");
      let committedManifest: SaveSlotMeta[] | undefined;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        // A callback exception must not leave already queued writes live.
        try { transaction.abort(); } catch { /* already aborted/completed */ }
        reject(error);
      };
      transaction.onerror = () => fail(transaction.error ?? new Error("IndexedDB slot commit failed"));
      transaction.onabort = () => fail(transaction.error ?? new Error("IndexedDB slot commit aborted"));
      transaction.oncomplete = () => {
        if (settled) return;
        if (!committedManifest) { fail(new Error("IndexedDB slot commit completed without a manifest")); return; }
        settled = true;
        resolve(committedManifest);
      };
      const check = (request: IDBRequest) => {
        request.onerror = () => fail(request.error ?? transaction.error ?? new Error("IndexedDB slot request failed"));
      };
      try {
        const read = store.get(MANIFEST_KEY);
        check(read);
        read.onsuccess = () => {
          try {
            const manifest = parseManifest(read.result ?? null);
            const index = manifest.findIndex((entry) => entry.id === meta.id);
            const previous = index >= 0 ? manifest[index] : undefined;
            if (!meta.storageKey) throw new Error("IndexedDB slot commit requires a revision key");
            check(store.put(serialized, meta.storageKey));
            if (index >= 0) manifest[index] = meta;
            else manifest.push(meta);
            if (consumeFailure()) {
              throw new Error("Simulated interrupted manifest commit");
            }
            check(store.put(JSON.stringify(manifest), MANIFEST_KEY));
            const previousKey = payloadKey(previous, meta.id);
            if (previous && previousKey !== meta.storageKey) check(store.delete(previousKey));
            committedManifest = manifest;
          } catch (error) { fail(error); }
        };
      } catch (error) { fail(error); }
    });
  };
  return {
    ready: open.then(() => undefined),
    get: (k) => tx<string | undefined>("readonly", (store) => store.get(k)).then((value) => value ?? null),
    set: (k, value) => tx("readwrite", (store) => store.put(value, k)).then(() => undefined),
    del: (k) => tx("readwrite", (store) => store.delete(k)).then(() => undefined),
    commitSlot: async (meta, serializePayload) => commitSerializedSlot(meta, await serializePayload()),
    commitSerializedSlot,
    dispose: () => { void open.then((db) => db.close()).catch(() => undefined); },
  };
}
