import { describe, expect, it, vi } from "vitest";
import type { PlatformServices } from "../../platform/types";
import { DEFAULT_STATE } from "../gameState";
import { GameSession } from "./GameSession";
import {
  type AnalysisJobResult,
  type AnalysisWorkerMessage,
  type AnalysisWorkerPort,
  VersionedAnalysisJobClient,
} from "./analysisJobs";

function platform(): PlatformServices {
  return {
    version: 1,
    capabilities: { kind: "browser", nativeFiles: false, steam: false, workshop: false, cloud: false, overlay: false, screenshots: false },
    files: { readText: vi.fn(), writeTextAtomic: vi.fn(), delete: vi.fn(), list: vi.fn(), chooseImport: vi.fn(), chooseExport: vi.fn(), exportSupportBundle: vi.fn() },
    app: { version: vi.fn(), safeMode: vi.fn(), markCleanExit: vi.fn(), requestQuit: vi.fn(), onQuitRequested: vi.fn(() => () => undefined), setWindowMode: vi.fn() },
    achievements: { unlock: vi.fn() }, cloud: { status: vi.fn(), generations: vi.fn(), preserveBoth: vi.fn() },
    workshop: { legalAgreementUrl: null, list: vi.fn(), publish: vi.fn(), cancel: vi.fn(), copyLocal: vi.fn() },
    presence: { set: vi.fn() }, overlay: { open: vi.fn() }, screenshots: { save: vi.fn() },
  };
}

class FakeWorker implements AnalysisWorkerPort<{ value: number }, number> {
  readonly sent: AnalysisWorkerMessage<{ value: number }>[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  private listener?: (event: MessageEvent<AnalysisJobResult<number>>) => void;

  postMessage(message: AnalysisWorkerMessage<{ value: number }>, transfer: Transferable[] = []): void {
    this.sent.push(message);
    this.transfers.push(transfer);
  }
  addEventListener(_type: "message", listener: (event: MessageEvent<AnalysisJobResult<number>>) => void): void { this.listener = listener; }
  removeEventListener(): void { this.listener = undefined; }
  terminate(): void { this.terminated = true; }
  respond(result: AnalysisJobResult<number>): void { this.listener?.({ data: result } as MessageEvent<AnalysisJobResult<number>>); }
}

describe("versioned analysis jobs", () => {
  it("rejects a stale worker result after a newer GameSession revision", () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    const worker = new FakeWorker();
    const client = new VersionedAnalysisJobClient(session, worker);
    const received = vi.fn();
    client.submit("routing-review", { value: 1 }, received);
    const job = worker.sent[0];
    if (job.type !== "run") throw new Error("Expected a run request");

    session.updateWorld((world) => ({ ...world, cash: world.cash + 1 }));
    worker.respond({ id: job.job.id, revision: job.job.revision, result: 7 });

    expect(received).not.toHaveBeenCalled();
  });

  it("cancels outstanding work on explicit cancellation and app close", () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    const worker = new FakeWorker();
    const client = new VersionedAnalysisJobClient(session, worker);
    const cancel = client.submit("habitat-map", { value: 1 }, vi.fn());
    cancel();
    client.submit("fine-green", { value: 2 }, vi.fn());
    session.dispose();

    expect(worker.sent.filter((message) => message.type === "cancel")).toHaveLength(2);
    expect(worker.terminated).toBe(true);
  });

  it("forwards an explicit transfer list to the worker port", () => {
    const session = new GameSession({ initialState: DEFAULT_STATE, platform: platform() });
    const worker = new FakeWorker();
    const client = new VersionedAnalysisJobClient(session, worker);
    const buffer = new ArrayBuffer(16);

    client.submit("surface-slope", { value: 1 }, vi.fn(), [buffer]);

    expect(worker.transfers[0]).toEqual([buffer]);
    client.dispose();
  });
});
