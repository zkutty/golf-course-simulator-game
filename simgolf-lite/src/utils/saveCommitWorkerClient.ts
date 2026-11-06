import type { SaveSlotMeta } from "./saveStore";
import { isCommitReply, SAVE_COMMIT_PROTOCOL, type CommitReply, type CommitRequest } from "./saveCommitProtocol";

export interface SaveCommitWorker {
  postMessage(message: CommitRequest): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message" | "error" | "messageerror", listener: (event: MessageEvent<unknown>) => void): void;
  terminate(): void;
}
export type CommitResult = Extract<CommitReply, { type: "result" }>;
export interface SaveCommitClient {
  ready: Promise<boolean>;
  commit(meta: SaveSlotMeta, serialized: string, failManifest: boolean): Promise<CommitResult | null>;
  dispose(): void;
}
function browserWorker(): SaveCommitWorker {
  const worker = new Worker(new URL("./saveCommit.worker.ts", import.meta.url), { type: "module", name: "coursecraft-save-commit" });
  return {
    postMessage: (message) => worker.postMessage(message),
    addEventListener: (type, listener) => worker.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) => worker.removeEventListener(type, listener as EventListener),
    terminate: () => worker.terminate(),
  };
}
export function createSaveCommitClient(onUnknown: () => void, factory: () => SaveCommitWorker = browserWorker): SaveCommitClient {
  // This worker instance and its owned listeners are the generation boundary; a retired instance is never reused.
  let worker: SaveCommitWorker | undefined;
  let live = true;
  let available = false;
  let nextId = 0;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: { id: number; timer: ReturnType<typeof setTimeout>; resolve: (reply: CommitResult) => void; reject: (error: Error) => void } | undefined;
  let resolveReady!: (value: boolean) => void;
  const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });
  const retire = (unknown: boolean) => {
    if (!live) return;
    live = false;
    available = false;
    clearTimeout(startupTimer);
    resolveReady(false);
    worker?.removeEventListener("message", onMessage);
    worker?.removeEventListener("error", onFailure);
    worker?.removeEventListener("messageerror", onFailure);
    worker?.terminate();
    worker = undefined;
    const current = pending;
    pending = undefined;
    if (current) {
      clearTimeout(current.timer);
      if (unknown) onUnknown();
      const error = new Error("Save commit outcome is unknown; the command was not replayed");
      error.name = "SaveCommitOutcomeUnknown";
      current.reject(error);
    }
  };
  const onFailure = () => retire(Boolean(pending));
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!live) return;
    if (!isCommitReply(event.data)) { retire(Boolean(pending)); return; }
    const reply = event.data;
    if (reply.type === "ready") {
      if (!available && !pending) { available = true; clearTimeout(startupTimer); resolveReady(true); }
    } else if (reply.type === "unavailable") retire(Boolean(pending));
    else if (pending && reply.id === pending.id) {
      const current = pending;
      pending = undefined;
      clearTimeout(current.timer);
      current.resolve(reply);
    }
  };
  try {
    worker = factory();
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onFailure);
    worker.addEventListener("messageerror", onFailure);
    startupTimer = setTimeout(() => retire(false), 3000);
  } catch { retire(false); }
  return {
    ready,
    async commit(meta, serialized, failManifest) {
      if (!await ready || !live || !available) return null;
      if (pending) throw new Error("A save commit is already pending");
      if (!Number.isSafeInteger(++nextId)) { retire(false); return null; }
      const id = nextId;
      return new Promise<CommitResult | null>((resolve, reject) => {
        pending = { id, resolve, reject, timer: setTimeout(() => retire(true), 30000) };
        try { worker!.postMessage({ protocol: SAVE_COMMIT_PROTOCOL, id, meta, serialized, failManifest }); }
        catch {
          // A synchronous structured-clone/post failure did not accept the command.
          clearTimeout(pending!.timer);
          pending = undefined;
          retire(false);
          resolve(null);
        }
      });
    },
    dispose: () => retire(Boolean(pending)),
  };
}
