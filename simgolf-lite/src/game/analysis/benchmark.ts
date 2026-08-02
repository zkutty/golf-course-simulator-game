import { DEFAULT_STATE } from "../gameState";
import {
  GameSession,
  VersionedAnalysisJobClient,
  type AnalysisJobResult,
  type AnalysisWorkerMessage,
  type AnalysisWorkerPort,
} from "../session";
import { createM27ReleaseReferenceCourse } from "../testing/referenceCourse";
import { browserPlatform } from "../../platform/browserPlatform";
import type { NaturalPropFrame } from "../render/naturalProps";
import type { AnalysisWorkerOutcome } from "./analysis.worker";
import {
  analysisOutputDigest,
  runAnalysisWorkload,
  type AnalysisWorkloadOutput,
  type AnalysisWorkloadPayload,
  type ArchitectureRoutingPayload,
  type SurfaceHabitatPayload,
} from "./workloads";

const FIXTURE_VERSION = 1;
const RESPONSE_TIMEOUT_MS = 120_000;

export interface WorkerBenchmarkMeasurement {
  workload: AnalysisWorkloadPayload["workload"];
  payloadBytes: number;
  transferBytes: number;
  mainComputeMs: number;
  workerDispatchMs: number;
  workerComputeMs: number;
  workerEndToEndMs: number;
  workerMessageOverheadMs: number;
  outputEquivalent: boolean;
  outputDigest: string;
  output: AnalysisWorkloadOutput;
}

export interface AnalysisWorkerBenchmarkReport {
  schemaVersion: 1;
  fixtureVersion: number;
  runtime: {
    userAgent: string;
    hardwareConcurrency: number;
    crossOriginIsolated: boolean;
  };
  measurements: WorkerBenchmarkMeasurement[];
  semantics: {
    cancellationRejectedCallback: boolean;
    staleRevisionRejectedCallback: boolean;
    sessionTeardownTerminatesWorker: boolean;
  };
  gate: {
    mainThreadBudgetMs: number;
    equivalenceRequired: true;
    cancellationRequired: true;
    staleRevisionRequired: true;
  };
  decision: "adopt-advisory-worker" | "defer-worker";
  rationale: string;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function createSurfacePayload(): SurfaceHabitatPayload {
  const course = createM27ReleaseReferenceCourse("parkland");
  const samples = Array.from({ length: 3_072 }, (_, index) => {
    const from = {
      x: (index * 37 + 11) % course.width,
      y: (index * 19 + 7) % course.height,
    };
    const to = {
      x: (from.x + 9 + index % 47) % course.width,
      y: (from.y + 5 + index % 29) % course.height,
    };
    return { from, to, handedness: index % 5 === 0 ? "left" as const : "right" as const };
  });
  const frames: NaturalPropFrame[] = [
    "parkland_tree_oak",
    "parkland_tree_pine",
    "parkland_tree_birch",
    "parkland_tree_fir",
  ];
  const habitats = course.obstacles
    .filter((obstacle) => obstacle.type === "tree")
    .slice(0, 600)
    .map((obstacle, index) => ({
      frame: frames[index % frames.length],
      obstacle,
      scale: 0.8 + (index % 5) * 0.1,
    }));
  return {
    workload: "surface-habitat",
    width: course.width,
    height: course.height,
    yardsPerTile: course.yardsPerTile,
    worldSeed: 270252,
    elevations: Float64Array.from(course.elevations),
    samples,
    habitats,
    repetitions: 3,
  };
}

function createArchitecturePayload(): ArchitectureRoutingPayload {
  return {
    workload: "architecture-routing",
    course: createM27ReleaseReferenceCourse("parkland"),
  };
}

function transferList(payload: AnalysisWorkloadPayload): Transferable[] {
  return payload.workload === "surface-habitat"
    ? [payload.elevations.buffer as ArrayBuffer]
    : [];
}

async function runMeasurement(
  client: VersionedAnalysisJobClient<AnalysisWorkloadPayload, AnalysisWorkerOutcome>,
  mainPayload: AnalysisWorkloadPayload,
  workerPayload: AnalysisWorkloadPayload,
): Promise<WorkerBenchmarkMeasurement> {
  const payloadBytes = workerPayload.workload === "surface-habitat"
    ? utf8Bytes({ ...workerPayload, elevations: undefined }) + workerPayload.elevations.byteLength
    : utf8Bytes(workerPayload);
  const transfer = transferList(workerPayload);
  const transferBytes = transfer.reduce<number>(
    (sum, item) => sum + (item instanceof ArrayBuffer ? item.byteLength : 0),
    0,
  );
  const mainStartedAt = performance.now();
  const mainOutput = runAnalysisWorkload(mainPayload);
  const mainComputeMs = performance.now() - mainStartedAt;
  const workerStartedAt = performance.now();
  let workerDispatchMs = 0;
  const workerOutcome = await new Promise<AnalysisWorkerOutcome>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`${workerPayload.workload} Worker benchmark timed out.`)),
      RESPONSE_TIMEOUT_MS,
    );
    const dispatchStartedAt = performance.now();
    client.submit(workerPayload.workload, workerPayload, (outcome) => {
      window.clearTimeout(timeout);
      resolve(outcome);
    }, transfer);
    workerDispatchMs = performance.now() - dispatchStartedAt;
  });
  const workerEndToEndMs = performance.now() - workerStartedAt;
  if (workerOutcome.status === "error") throw new Error(workerOutcome.message);
  const mainDigest = analysisOutputDigest(mainOutput);
  const workerDigest = analysisOutputDigest(workerOutcome.output);
  return {
    workload: workerPayload.workload,
    payloadBytes,
    transferBytes,
    mainComputeMs: rounded(mainComputeMs),
    workerDispatchMs: rounded(workerDispatchMs),
    workerComputeMs: rounded(workerOutcome.computeMs),
    workerEndToEndMs: rounded(workerEndToEndMs),
    workerMessageOverheadMs: rounded(Math.max(0, workerEndToEndMs - workerOutcome.computeMs - workerDispatchMs)),
    outputEquivalent: mainDigest === workerDigest,
    outputDigest: workerDigest,
    output: workerOutcome.output,
  };
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

export async function runAnalysisWorkerBenchmark(): Promise<AnalysisWorkerBenchmarkReport> {
  const course = createM27ReleaseReferenceCourse("parkland");
  const session = new GameSession({
    initialState: { ...DEFAULT_STATE, course },
    platform: browserPlatform,
  });
  const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    type: "module",
    name: "coursecraft-analysis-benchmark",
  });
  let workerTerminated = false;
  const workerPort: AnalysisWorkerPort<AnalysisWorkloadPayload, AnalysisWorkerOutcome> = {
    postMessage(message: AnalysisWorkerMessage<AnalysisWorkloadPayload>, transfer: Transferable[] = []) {
      worker.postMessage(message, transfer);
    },
    addEventListener(_type, listener) {
      worker.addEventListener("message", listener as (event: MessageEvent<AnalysisJobResult<AnalysisWorkerOutcome>>) => void);
    },
    removeEventListener(_type, listener) {
      worker.removeEventListener("message", listener as (event: MessageEvent<AnalysisJobResult<AnalysisWorkerOutcome>>) => void);
    },
    terminate() {
      workerTerminated = true;
      worker.terminate();
    },
  };
  const client = new VersionedAnalysisJobClient<AnalysisWorkloadPayload, AnalysisWorkerOutcome>(session, workerPort);
  const architectureMain = createArchitecturePayload();
  const architectureWorker = createArchitecturePayload();
  const surfaceMain = createSurfacePayload();
  const surfaceWorker = createSurfacePayload();
  const measurements = [
    await runMeasurement(client, architectureMain, architectureWorker),
    await runMeasurement(client, surfaceMain, surfaceWorker),
  ];

  let cancellationCalled = false;
  const cancellationPayload = createSurfacePayload();
  const cancel = client.submit(
    cancellationPayload.workload,
    cancellationPayload,
    () => { cancellationCalled = true; },
    transferList(cancellationPayload),
  );
  cancel();
  await wait(75);

  let staleCalled = false;
  const stalePayload = createSurfacePayload();
  client.submit(
    stalePayload.workload,
    stalePayload,
    () => { staleCalled = true; },
    transferList(stalePayload),
  );
  session.updateWorld((world) => ({ ...world, cash: world.cash + 1 }));
  await wait(250);

  session.dispose();
  const semantics = {
    cancellationRejectedCallback: !cancellationCalled,
    staleRevisionRejectedCallback: !staleCalled,
    sessionTeardownTerminatesWorker: workerTerminated,
  };
  const gatePassed = measurements.every((measurement) => measurement.outputEquivalent)
    && semantics.cancellationRejectedCallback
    && semantics.staleRevisionRejectedCallback;
  const exceedsFrameBudget = measurements.some((measurement) => measurement.mainComputeMs > 8);
  const decision = gatePassed && exceedsFrameBudget ? "adopt-advisory-worker" : "defer-worker";
  return {
    schemaVersion: 1,
    fixtureVersion: FIXTURE_VERSION,
    runtime: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: window.crossOriginIsolated,
    },
    measurements,
    semantics,
    gate: {
      mainThreadBudgetMs: 8,
      equivalenceRequired: true,
      cancellationRequired: true,
      staleRevisionRequired: true,
    },
    decision,
    rationale: decision === "adopt-advisory-worker"
      ? "At least one representative analyzer exceeded the 8 ms main-thread budget, while Worker output remained equivalent and advisory cancellation/revision guards passed. Adopt only for on-demand non-authoritative analysis."
      : "The measurement or safety gate did not justify Worker ownership. Keep the analyzers on the main thread and repeat this fixture after workload growth.",
  };
}

export function installAnalysisWorkerBenchmarkFixture(): void {
  document.title = "CourseCraft analysis Worker benchmark";
  document.body.dataset.analysisBenchmark = "running";
  const output = document.createElement("pre");
  output.id = "analysis-worker-benchmark";
  output.textContent = "Running real Worker benchmark…";
  document.getElementById("root")?.replaceChildren(output);
  window.__coursecraftAnalysisWorkerBenchmark = runAnalysisWorkerBenchmark()
    .then((report) => {
      document.body.dataset.analysisBenchmark = "complete";
      output.textContent = JSON.stringify(report, null, 2);
      return report;
    })
    .catch((error) => {
      document.body.dataset.analysisBenchmark = "failed";
      output.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
      throw error;
    });
}
