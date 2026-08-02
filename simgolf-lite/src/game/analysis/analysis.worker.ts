/// <reference lib="webworker" />

import type {
  AnalysisJobResult,
  AnalysisWorkerMessage,
} from "../session/analysisJobs";
import {
  runAnalysisWorkload,
  type AnalysisWorkloadOutput,
  type AnalysisWorkloadPayload,
} from "./workloads";

export interface AnalysisWorkerSuccess {
  status: "ok";
  computeMs: number;
  output: AnalysisWorkloadOutput;
}

export interface AnalysisWorkerFailure {
  status: "error";
  message: string;
}

export type AnalysisWorkerOutcome = AnalysisWorkerSuccess | AnalysisWorkerFailure;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<string>();

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

scope.addEventListener("message", (event: MessageEvent<AnalysisWorkerMessage<AnalysisWorkloadPayload>>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled.add(message.id);
    return;
  }

  const { job } = message;
  void (async () => {
    // Give a cancellation posted directly after `run` a task boundary before
    // the synchronous production analyzer begins.
    await nextTask();
    if (cancelled.delete(job.id)) return;
    const startedAt = performance.now();
    let result: AnalysisWorkerOutcome;
    try {
      if (job.kind !== job.payload.workload) throw new Error("Analysis job kind does not match its payload.");
      const output = runAnalysisWorkload(job.payload);
      result = {
        status: "ok",
        computeMs: performance.now() - startedAt,
        output,
      };
    } catch (error) {
      result = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (cancelled.delete(job.id)) return;
    const response: AnalysisJobResult<AnalysisWorkerOutcome> = {
      id: job.id,
      revision: job.revision,
      result,
    };
    scope.postMessage(response);
  })();
});

export {};
