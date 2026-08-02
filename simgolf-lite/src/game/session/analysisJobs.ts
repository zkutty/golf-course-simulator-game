import type { GameSession } from "./GameSession";

/**
 * Versioned protocol for optional, non-authoritative analysis. A result is
 * usable only while it still describes the session revision that requested it.
 */
export interface AnalysisJob<Payload> {
  id: string;
  kind: string;
  revision: number;
  payload: Payload;
}

export interface AnalysisJobResult<Result> {
  id: string;
  revision: number;
  result: Result;
}

export type AnalysisWorkerMessage<Payload> =
  | { type: "run"; job: AnalysisJob<Payload> }
  | { type: "cancel"; id: string };

export interface AnalysisWorkerPort<Payload, Result> {
  postMessage(message: AnalysisWorkerMessage<Payload>): void;
  addEventListener(type: "message", listener: (event: MessageEvent<AnalysisJobResult<Result>>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<AnalysisJobResult<Result>>) => void): void;
  terminate(): void;
}

/**
 * Makes a Worker an advisory computation endpoint. It never mutates game
 * state: consumers choose whether to apply a current result after this client
 * has rejected cancellation and stale-revision responses.
 */
export class VersionedAnalysisJobClient<Payload, Result> {
  private nextId = 1;
  private disposed = false;
  private readonly callbacks = new Map<string, (result: Result) => void>();
  private readonly removeSessionTeardown: () => void;
  private readonly session: GameSession;
  private readonly worker: AnalysisWorkerPort<Payload, Result>;

  constructor(
    session: GameSession,
    worker: AnalysisWorkerPort<Payload, Result>,
  ) {
    this.session = session;
    this.worker = worker;
    this.worker.addEventListener("message", this.onMessage);
    this.removeSessionTeardown = this.session.registerTeardown(() => this.dispose());
  }

  submit(kind: string, payload: Payload, onResult: (result: Result) => void): () => void {
    this.assertActive();
    const id = `analysis-${this.nextId++}`;
    this.callbacks.set(id, onResult);
    this.worker.postMessage({ type: "run", job: { id, kind, revision: this.session.revision, payload } });
    return () => this.cancel(id);
  }

  cancelAll(): void {
    for (const id of [...this.callbacks.keys()]) this.cancel(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.terminate();
    this.removeSessionTeardown();
  }

  private cancel(id: string): void {
    if (!this.callbacks.delete(id)) return;
    this.worker.postMessage({ type: "cancel", id });
  }

  private onMessage = (event: MessageEvent<AnalysisJobResult<Result>>): void => {
    const { id, revision, result } = event.data;
    const callback = this.callbacks.get(id);
    this.callbacks.delete(id);
    // State may have changed through editing, navigation, or a restored save
    // while the Worker was computing. Its old answer must not win that race.
    if (!callback || revision !== this.session.revision || this.disposed) return;
    callback(result);
  };

  private assertActive(): void {
    if (this.disposed) throw new Error("Analysis job client has been disposed.");
  }
}
