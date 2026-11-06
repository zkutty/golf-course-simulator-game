import { createIndexedDbKV, type IndexedSaveKV } from "./saveStoreIndexedDb";
import { createSaveCommitClient, type SaveCommitClient } from "./saveCommitWorkerClient";

export interface BrowserSaveOptions {
  useWorker: boolean;
  consumeFailure(): boolean;
  restoreFailure(): void;
  onUnknown(): void;
  createClient?: (onUnknown: () => void) => SaveCommitClient;
}
/** One coordinator per IDB owner. It spans reads, dependent payloads and cache publication in saveStore. */
export function createBrowserSaveKV(factory: IDBFactory, options: BrowserSaveOptions): IndexedSaveKV {
  const db = createIndexedDbKV(factory, options.consumeFailure);
  let live = true;
  const client = options.useWorker ? (options.createClient ?? createSaveCommitClient)(() => { if (live) options.onUnknown(); }) : undefined;
  const assertActive = () => { if (!live) throw new Error("Save storage owner was disposed"); };
  let tail: Promise<unknown> = Promise.resolve();
  return {
    ...db,
    assertActive,
    get: async (key) => { assertActive(); const value = await db.get(key); assertActive(); return value; },
    set: async (key, value) => { assertActive(); await db.set(key, value); assertActive(); },
    del: async (key) => { assertActive(); await db.del(key); assertActive(); },
    manifestAccess<T>(run: () => Promise<T>): Promise<T> {
      const access = tail.catch(() => undefined).then(() => {
        assertActive();
        return run();
      });
      tail = access.catch(() => undefined);
      return access;
    },
    async commitSlot(meta, serialize) {
      // Snapshot construction and serialization remain on the caller; no transaction exists yet.
      const serialized = await serialize();
      if (!live) throw new Error("Save storage owner was disposed");
      if (client && await client.ready) {
        const failure = options.consumeFailure();
        // Accepted/unknown rejection propagates; it must never run again on the main connection.
        const reply = await client.commit(meta, serialized, failure);
        if (reply) {
          assertActive();
          if (failure && !reply.failureConsumed) options.restoreFailure();
          if (reply.outcome.ok) return reply.outcome.manifest;
          const error = new Error(reply.outcome.message);
          error.name = reply.outcome.name;
          throw error;
        }
        if (failure) options.restoreFailure();
      }
      if (!live) throw new Error("Save storage owner was disposed");
      const manifest = await db.commitSerializedSlot(meta, serialized);
      assertActive();
      return manifest;
    },
    dispose() { live = false; client?.dispose(); db.dispose?.(); },
  };
}
