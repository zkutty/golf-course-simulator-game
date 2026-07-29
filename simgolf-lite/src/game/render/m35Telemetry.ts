export type M35Metric =
  | "surfacePreview"
  | "surfaceCommit"
  | "chunkRebuild"
  | "connectedRebuild";

export interface M35MetricSummary {
  count: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
}

export type M35TelemetrySnapshot = Record<M35Metric, M35MetricSummary>;

const SAMPLE_LIMIT = 240;
const samples: Record<M35Metric, number[]> = {
  surfacePreview: [],
  surfaceCommit: [],
  chunkRebuild: [],
  connectedRebuild: [],
};

export function recordM35Metric(metric: M35Metric, elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  const list = samples[metric];
  list.push(elapsedMs);
  if (list.length > SAMPLE_LIMIT) list.splice(0, list.length - SAMPLE_LIMIT);
}

function summarize(values: readonly number[]): M35MetricSummary {
  if (values.length === 0) return { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const percentileIndex = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
  );
  return {
    count: values.length,
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95Ms: sorted[percentileIndex],
    maxMs: sorted[sorted.length - 1],
  };
}

export function m35TelemetrySnapshot(): M35TelemetrySnapshot {
  return {
    surfacePreview: summarize(samples.surfacePreview),
    surfaceCommit: summarize(samples.surfaceCommit),
    chunkRebuild: summarize(samples.chunkRebuild),
    connectedRebuild: summarize(samples.connectedRebuild),
  };
}

export function resetM35Telemetry(): void {
  for (const list of Object.values(samples)) list.length = 0;
}
