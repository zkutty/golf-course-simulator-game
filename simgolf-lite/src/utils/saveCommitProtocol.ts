import type { SaveSlotMeta } from "./saveStore";

export const SAVE_COMMIT_PROTOCOL = "coursecraft-save-commit-v1";
export interface CommitRequest {
  protocol: typeof SAVE_COMMIT_PROTOCOL;
  id: number;
  meta: SaveSlotMeta;
  serialized: string;
  failManifest: boolean;
}
export type CommitReply =
  | { protocol: typeof SAVE_COMMIT_PROTOCOL; type: "ready" }
  | { protocol: typeof SAVE_COMMIT_PROTOCOL; type: "unavailable" }
  | { protocol: typeof SAVE_COMMIT_PROTOCOL; type: "result"; id: number; failureConsumed: boolean;
      outcome: { ok: true; manifest: SaveSlotMeta[] } | { ok: false; name: string; message: string } };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
export function isSaveSlotMeta(value: unknown): value is SaveSlotMeta {
  if (!record(value)) return false;
  return typeof value.id === "string" && (value.storageKey === undefined || typeof value.storageKey === "string")
    && ["manual", "auto", "quick"].includes(value.kind as string)
    && typeof value.name === "string" && typeof value.courseName === "string"
    && [value.savedAt, value.seq, value.week, value.cash, value.holesOpen].every((n) => typeof n === "number" && Number.isFinite(n));
}
export function isCommitRequest(value: unknown): value is CommitRequest {
  return record(value) && value.protocol === SAVE_COMMIT_PROTOCOL && Number.isSafeInteger(value.id)
    && (value.id as number) > 0 && isSaveSlotMeta(value.meta) && typeof value.meta.storageKey === "string"
    && typeof value.serialized === "string" && typeof value.failManifest === "boolean";
}
export function isCommitReply(value: unknown): value is CommitReply {
  if (!record(value) || value.protocol !== SAVE_COMMIT_PROTOCOL) return false;
  if (value.type === "ready" || value.type === "unavailable") return true;
  if (value.type !== "result" || !Number.isSafeInteger(value.id) || (value.id as number) <= 0
    || typeof value.failureConsumed !== "boolean" || !record(value.outcome)) return false;
  const outcome = value.outcome;
  // The original parser accepts older partial metadata, including absent seq/storageKey.
  // Validate the transport envelope without adding a persisted-save schema.
  return outcome.ok === true ? Array.isArray(outcome.manifest) && outcome.manifest.every(record)
    : outcome.ok === false && typeof outcome.name === "string" && typeof outcome.message === "string";
}
