import { afterEach, describe, expect, it, vi } from "vitest";
import { createSaveCommitClient, type SaveCommitWorker } from "./saveCommitWorkerClient";
import { SAVE_COMMIT_PROTOCOL, isCommitReply, type CommitRequest } from "./saveCommitProtocol";
import type { SaveSlotMeta } from "./saveStore";

const meta: SaveSlotMeta = { id: "quick", storageKey: "revision", kind: "quick", name: "Quick", savedAt: 1, seq: 1, courseName: "Test", week: 1, cash: 1, holesOpen: 0 };
function controlledWorker() {
  const listeners = new Map<string, Set<(event: MessageEvent<unknown>) => void>>();
  const posted: CommitRequest[] = [];
  let terminated = false;
  let throwPost = false;
  const worker: SaveCommitWorker = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
    postMessage: (data) => { if (throwPost) throw new DOMException("Clone failed", "DataCloneError"); posted.push(data); },
    terminate: () => { terminated = true; },
  };
  const emit = (data: unknown, type = "message") => {
    for (const fn of listeners.get(type) ?? []) fn(new MessageEvent(type, { data }));
  };
  const ready = () => emit({ protocol: SAVE_COMMIT_PROTOCOL, type: "ready" });
  const success = (id: number) => emit({ protocol: SAVE_COMMIT_PROTOCOL, type: "result", id, failureConsumed: false, outcome: { ok: true, manifest: [meta] } });
  return { worker, posted, emit, ready, success, throwOnPost: () => { throwPost = true; }, count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0), get terminated() { return terminated; } };
}

afterEach(() => vi.useRealTimers());
describe("owned save worker transport", () => {
  it("bounds startup failure and releases all owned hooks without dispatch", async () => {
    vi.useFakeTimers();
    const fake = controlledWorker();
    const client = createSaveCommitClient(() => { throw new Error("No dispatch"); }, () => fake.worker);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await client.ready).toBe(false);
    expect(await client.commit(meta, "payload", false)).toBeNull();
    expect(fake.posted).toHaveLength(0);
    expect(fake.count()).toBe(0);
    expect(fake.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows fallback only when postMessage synchronously rejects before accepting a command", async () => {
    const fake = controlledWorker();
    const client = createSaveCommitClient(() => { throw new Error("Not unknown"); }, () => fake.worker);
    fake.ready();
    fake.throwOnPost();
    expect(await client.commit(meta, "payload", false)).toBeNull();
    expect(fake.posted).toHaveLength(0);
    expect(fake.count()).toBe(0);
  });

  it("times out an accepted command as unknown without replay and ignores late replies", async () => {
    vi.useFakeTimers();
    const fake = controlledWorker();
    let unknown = 0;
    const client = createSaveCommitClient(() => unknown++, () => fake.worker);
    fake.ready();
    const pending = client.commit(meta, "payload", false);
    const rejected = expect(pending).rejects.toMatchObject({ name: "SaveCommitOutcomeUnknown" });
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    fake.success(1);
    expect(unknown).toBe(1);
    expect(fake.posted).toHaveLength(1);
    expect(fake.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(await client.commit(meta, "next explicit request", false)).toBeNull();
  });

  it("rejects a second in-flight request and does not resolve from duplicate or stale result IDs", async () => {
    const fake = controlledWorker();
    const client = createSaveCommitClient(() => undefined, () => fake.worker);
    fake.ready();
    const first = client.commit(meta, "first", false);
    await Promise.resolve();
    await expect(client.commit(meta, "concurrent", false)).rejects.toThrow("already pending");
    fake.success(1);
    expect((await first)?.outcome.ok).toBe(true);
    let settled = false;
    const second = client.commit(meta, "second", false).then((reply) => { settled = true; return reply; });
    await Promise.resolve();
    fake.success(1);
    await Promise.resolve();
    expect(settled).toBe(false);
    fake.success(2);
    await second;
    client.dispose();
    expect(fake.count()).toBe(0);
  });

  it("invalidates once on message corruption or dispose while a command is pending", async () => {
    for (const failure of ["corrupt", "dispose", "error"] as const) {
      const fake = controlledWorker();
      let unknown = 0;
      const client = createSaveCommitClient(() => unknown++, () => fake.worker);
      fake.ready();
      const pending = client.commit(meta, "payload", false);
      const rejected = expect(pending).rejects.toMatchObject({ name: "SaveCommitOutcomeUnknown" });
      await Promise.resolve();
      if (failure === "corrupt") fake.emit({ protocol: SAVE_COMMIT_PROTOCOL, type: "result", id: 1, outcome: null });
      else if (failure === "dispose") client.dispose();
      else fake.emit(undefined, "messageerror");
      await rejected;
      client.dispose();
      fake.success(1);
      expect(unknown).toBe(1);
      expect(fake.count()).toBe(0);
    }
  });

  it("accepts pre-revision manifest entries but requires a revision key for new commit requests", () => {
    const legacy = { ...meta };
    delete legacy.storageKey;
    const beforeSequence = { id: "legacy", kind: "manual", name: "Old save" };
    expect(isCommitReply({ protocol: SAVE_COMMIT_PROTOCOL, type: "result", id: 1, failureConsumed: false, outcome: { ok: true, manifest: [beforeSequence, legacy, meta] } })).toBe(true);
    expect(isCommitReply({ protocol: SAVE_COMMIT_PROTOCOL, type: "result", id: 1, failureConsumed: false, outcome: { ok: true, manifest: [null] } })).toBe(false);
  });
});
