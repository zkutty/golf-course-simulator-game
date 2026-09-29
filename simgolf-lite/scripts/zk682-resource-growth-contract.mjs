import assert from "node:assert/strict";

export const ZK682_RESOURCE_GROWTH_SCHEMA_VERSION = 1;

export const ZK682_RESOURCE_GROWTH_THRESHOLDS = Object.freeze({
  minimumMeasuredCycles: 6,
  displayObjects: Object.freeze({ maxGrowth: 2, maxEndGrowth: 2 }),
  attachedTextures: Object.freeze({ maxGrowth: 2, maxEndGrowth: 2 }),
  attachedTextureSources: Object.freeze({ maxGrowth: 1, maxEndGrowth: 1 }),
  // Pixi's renderer keeps a finite, theme-dependent set of GPU sources. The
  // absolute peak therefore allows the calibrated desert-vs-parkland delta,
  // while repeatedStateMaxGrowth catches accumulation when a state recurs.
  managedTextureSources: Object.freeze({
    maxGrowth: 16,
    maxEndGrowth: 2,
    maxRepeatedStateGrowth: 2,
  }),
  heap: Object.freeze({
    maxGrowthBytes: 8 * 1024 * 1024,
    maxEndGrowthBytes: 4 * 1024 * 1024,
    maxSlopeBytesPerCycle: 512 * 1024,
  }),
});

const RESOURCE_METRICS = [
  "displayObjects",
  "attachedTextures",
  "attachedTextureSources",
  "managedTextureSources",
];

function linearSlope(values) {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function metricSummary(values) {
  const baseline = values[0];
  const end = values.at(-1);
  return {
    baseline,
    end,
    min: Math.min(...values),
    max: Math.max(...values),
    maxGrowth: Math.max(...values) - baseline,
    endGrowth: end - baseline,
    slopePerCycle: linearSlope(values),
  };
}

function repeatedStateMaxGrowth(samples, metric) {
  const groups = new Map();
  for (const sample of samples) {
    const key = sample.exercised
      ? `${sample.exercised.theme}:${sample.exercised.quality}`
      : "baseline";
    const values = groups.get(key) ?? [];
    values.push(sample.resources[metric]);
    groups.set(key, values);
  }
  const growth = [...groups.values()]
    .filter((values) => values.length > 1)
    .map((values) => values.at(-1) - values[0]);
  return growth.length > 0 ? Math.max(...growth) : 0;
}

function atlasResidencyIdentity(residency) {
  return JSON.stringify({
    baseBundles: residency.baseBundles,
    seasonalOverlays: residency.seasonalOverlays,
    seasonalFrameMaps: residency.seasonalFrameMaps,
    materialFields: residency.materialFields,
    pathMaterialFields: residency.pathMaterialFields,
    seasonalMaterialFields: residency.seasonalMaterialFields,
    parklandComposableFields: residency.parklandComposableFields,
  });
}

export function evaluateZk682ResourceGrowth(samples, thresholds = ZK682_RESOURCE_GROWTH_THRESHOLDS) {
  const errors = [];
  if (!Array.isArray(samples) || samples.length < thresholds.minimumMeasuredCycles) {
    return {
      passed: false,
      errors: [`expected at least ${thresholds.minimumMeasuredCycles} measured browser cycles`],
      metrics: {},
    };
  }

  for (const [index, sample] of samples.entries()) {
    if (!sample?.resources?.canvasConnected) errors.push(`cycle ${index + 1} has no connected Pixi canvas`);
    for (const metric of RESOURCE_METRICS) {
      if (!Number.isFinite(sample?.resources?.[metric]) || sample.resources[metric] < 0) {
        errors.push(`cycle ${index + 1} is missing renderer diagnostic ${metric}`);
      }
    }
    if (!Number.isFinite(sample?.heap?.runtimeUsedBytes) || sample.heap.runtimeUsedBytes <= 0) {
      errors.push(`cycle ${index + 1} is missing real Chromium heap diagnostics`);
    }
    if (!sample?.atlasResidency) errors.push(`cycle ${index + 1} is missing atlas residency diagnostics`);
  }
  if (errors.length > 0) return { passed: false, errors, metrics: {} };

  const metrics = Object.fromEntries(RESOURCE_METRICS.map((metric) => [
    metric,
    {
      ...metricSummary(samples.map((sample) => sample.resources[metric])),
      repeatedStateMaxGrowth: repeatedStateMaxGrowth(samples, metric),
    },
  ]));
  metrics.heap = metricSummary(samples.map((sample) => sample.heap.runtimeUsedBytes));

  for (const metric of RESOURCE_METRICS) {
    const summary = metrics[metric];
    const limit = thresholds[metric];
    if (summary.maxGrowth > limit.maxGrowth) {
      errors.push(`${metric} grew ${summary.maxGrowth}; limit ${limit.maxGrowth}`);
    }
    if (summary.endGrowth > limit.maxEndGrowth) {
      errors.push(`${metric} ended ${summary.endGrowth} above baseline; limit ${limit.maxEndGrowth}`);
    }
    if (Number.isFinite(limit.maxRepeatedStateGrowth) && summary.repeatedStateMaxGrowth > limit.maxRepeatedStateGrowth) {
      errors.push(`${metric} repeated-state growth was ${summary.repeatedStateMaxGrowth}; limit ${limit.maxRepeatedStateGrowth}`);
    }
  }
  if (metrics.heap.maxGrowth > thresholds.heap.maxGrowthBytes) {
    errors.push(`post-GC JS heap grew ${metrics.heap.maxGrowth} bytes; limit ${thresholds.heap.maxGrowthBytes}`);
  }
  if (metrics.heap.endGrowth > thresholds.heap.maxEndGrowthBytes) {
    errors.push(`post-GC JS heap ended ${metrics.heap.endGrowth} bytes above baseline; limit ${thresholds.heap.maxEndGrowthBytes}`);
  }
  if (metrics.heap.slopePerCycle > thresholds.heap.maxSlopeBytesPerCycle) {
    errors.push(`post-GC JS heap slope was ${Math.round(metrics.heap.slopePerCycle)} bytes/cycle; limit ${thresholds.heap.maxSlopeBytesPerCycle}`);
  }

  const atlasBaseline = atlasResidencyIdentity(samples[0].atlasResidency);
  if (samples.some((sample) => atlasResidencyIdentity(sample.atlasResidency) !== atlasBaseline)) {
    errors.push("atlas residency changed after the completed warmup");
  }

  return { passed: errors.length === 0, errors, metrics };
}

export function createZk682ResourceGrowthReport(input) {
  assert.equal(typeof input?.source?.commit, "string", "report source commit is required");
  assert.ok(input.source.commit.length > 0, "report source commit is required");
  assert.equal(typeof input?.browser?.version, "string", "browser version is required");
  assert.ok(Array.isArray(input?.warmup?.baseBundles), "warmup bundle evidence is required");
  const result = evaluateZk682ResourceGrowth(input.samples, input.thresholds);
  return {
    schemaVersion: ZK682_RESOURCE_GROWTH_SCHEMA_VERSION,
    gate: "renderer-resource-growth",
    source: input.source,
    browser: input.browser,
    thresholds: input.thresholds,
    warmup: input.warmup,
    samples: input.samples,
    summary: result.metrics,
    errors: result.errors,
    passed: result.passed,
  };
}
