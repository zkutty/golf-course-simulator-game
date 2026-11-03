import { recordM35Metric } from "./m35Telemetry";

export interface PathPreviewResolution {
  readonly key: string;
  readonly keyMs: number;
  readonly buildMs: number;
  readonly built: boolean;
  readonly succeeded: boolean;
}

/** Scalars only: safe to carry through a transient render snapshot. */
export interface PathPreviewComputeReceipt {
  readonly epoch: number;
  readonly id: number;
  readonly key: string;
  readonly quoteMs: number;
  readonly keyMs: number;
  readonly buildMs: number;
}

export interface PathPreviewComputeSample extends PathPreviewComputeReceipt {
  readonly clipMs: number;
  /** CPU projection and Graphics command submission, not GPU completion. */
  readonly drawMs: number;
  readonly totalMs: number;
}

const LIMIT = 240;
let epoch = 0;
let nextId = 0;
let completedId = 0;
let resolutionCount = 0;
let buildCount = 0;
let failedBuildCount = 0;
let completedCount = 0;
let lastKey: string | null = null;
const samples: PathPreviewComputeSample[] = [];

/** One owner per resolver; same-key hits must not replace a pending build. */
export function createPathPreviewMeasurement() {
  let pending: PathPreviewComputeReceipt | null = null;
  let quoted = false;
  return {
    observe(resolution: PathPreviewResolution): void {
      resolutionCount++;
      lastKey = resolution.key;
      if (!resolution.built) {
        // Repeated calculations before the first draw still consume key CPU.
        // Keep the real build/quote while adding that pending key work.
        if (pending && pending.epoch === epoch && pending.id > completedId) pending = { ...pending, keyMs: pending.keyMs + resolution.keyMs };
        return;
      }
      buildCount++;
      if (!resolution.succeeded) { failedBuildCount++; pending = null; return; }
      pending = { epoch, id: ++nextId, key: resolution.key, quoteMs: 0, keyMs: resolution.keyMs, buildMs: resolution.buildMs };
      quoted = false;
    },
    receipt(quoteMs: number | undefined): PathPreviewComputeReceipt | null {
      if (pending && !quoted) {
        if (quoteMs === undefined || !Number.isFinite(quoteMs) || quoteMs < 0) return null;
        pending = { ...pending, quoteMs }; quoted = true;
      }
      return pending;
    },
    clear(): void { pending = null; quoted = false; },
  };
}

/** Called only after the changed candidate's scene draw returns successfully. */
export function completePathPreviewCompute(receipt: PathPreviewComputeReceipt, clipMs: number, drawMs: number): boolean {
  if (receipt.epoch !== epoch || !Number.isSafeInteger(receipt.id) || receipt.id <= completedId || receipt.id > nextId || typeof receipt.key !== "string") return false;
  const phases = [receipt.quoteMs, receipt.keyMs, receipt.buildMs, clipMs, drawMs];
  if (phases.some((value) => !Number.isFinite(value) || value < 0)) return false;
  const totalMs = phases.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(totalMs)) return false;
  completedId = receipt.id;
  completedCount++;
  // Do not spread a caller object: diagnostics retain only declared scalars.
  samples.push({ epoch: receipt.epoch, id: receipt.id, key: receipt.key, quoteMs: receipt.quoteMs, keyMs: receipt.keyMs, buildMs: receipt.buildMs, clipMs, drawMs, totalMs });
  if (samples.length > LIMIT) samples.splice(0, samples.length - LIMIT);
  recordM35Metric("surfacePreview", totalMs);
  return true;
}

/** Copies only bounded scalar/key records; no course, graph or point ownership. */
export function pathPreviewTelemetrySnapshot() {
  return { epoch, resolutionCount, buildCount, failedBuildCount, completedCount, lastKey, samples: samples.map((sample) => ({ ...sample })) };
}

export function resetPathPreviewTelemetry(): void {
  epoch++;
  nextId = 0; completedId = 0;
  resolutionCount = 0; buildCount = 0; failedBuildCount = 0; completedCount = 0;
  lastKey = null; samples.length = 0;
}
