import { createIndexedDbKV } from "./saveStoreIndexedDb";
import { isCommitRequest, SAVE_COMMIT_PROTOCOL, type CommitReply } from "./saveCommitProtocol";

export interface SaveCommitPort {
  postMessage(message: CommitReply): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
}
/** The worker and tests execute the same transaction engine. No UI module is imported at runtime. */
export function installSaveCommitWorker(port: SaveCommitPort, factory: IDBFactory): () => void {
  const db = createIndexedDbKV(factory);
  let live = true;
  let busy = false;
  const send = (reply: CommitReply) => { if (live) port.postMessage(reply); };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!live || !isCommitRequest(event.data)) return;
    const request = event.data;
    if (busy) return; // A conforming client has exactly one in-flight mutation.
    busy = true;
    let failureConsumed = false;
    void db.commitSerializedSlot(request.meta, request.serialized, () => {
      failureConsumed = request.failManifest;
      return failureConsumed;
    }).then(
      (manifest) => send({ protocol: SAVE_COMMIT_PROTOCOL, type: "result", id: request.id, failureConsumed, outcome: { ok: true, manifest } }),
      (error: unknown) => send({ protocol: SAVE_COMMIT_PROTOCOL, type: "result", id: request.id, failureConsumed,
        outcome: { ok: false, name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "IndexedDB slot commit failed" } }),
    ).finally(() => { busy = false; });
  };
  port.addEventListener("message", onMessage);
  void db.ready.then(
    () => send({ protocol: SAVE_COMMIT_PROTOCOL, type: "ready" }),
    () => send({ protocol: SAVE_COMMIT_PROTOCOL, type: "unavailable" }),
  );
  return () => { live = false; port.removeEventListener("message", onMessage); db.dispose?.(); };
}
