import assert from "node:assert/strict";

export const ZK682_STABILITY_SCHEMA_VERSION = 2;

const MiB = 1024 * 1024;
const RESOURCE_LIMITS = Object.freeze({
  displayObjects: Object.freeze({ maxGrowth: 2, maxEndGrowth: 2 }),
  attachedTextures: Object.freeze({ maxGrowth: 2, maxEndGrowth: 2 }),
  attachedTextureSources: Object.freeze({ maxGrowth: 1, maxEndGrowth: 1 }),
  managedTextureSources: Object.freeze({ maxGrowth: 2, maxEndGrowth: 2 }),
  heap: Object.freeze({
    maxGrowthBytes: 8 * MiB,
    maxEndGrowthBytes: 4 * MiB,
    maxSlopeBytesPerSample: 512 * 1024,
  }),
});

export const ZK682_STABILITY_THRESHOLDS = Object.freeze({
  "save-load-resource-stability": Object.freeze({
    minimumSaveLoads: 12,
    resources: RESOURCE_LIMITS,
  }),
  "long-session-resource-stability": Object.freeze({
    minimumSessionMinutes: 120,
    minimumSamples: 6,
    resources: RESOURCE_LIMITS,
  }),
  "editing-overlay-sleep-recovery": Object.freeze({
    requiredScenarios: Object.freeze(["editing", "overlay", "recovery", "sleep-wake"]),
    resources: RESOURCE_LIMITS,
  }),
});

const RESOURCE_METRICS = [
  "displayObjects",
  "attachedTextures",
  "attachedTextureSources",
  "managedTextureSources",
];

function stable(value) {
  return Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
      : value;
}

export const stableStabilityJson = (value) => JSON.stringify(stable(value));

function slope(values) {
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

function metric(values) {
  const baseline = values[0];
  const end = values.at(-1);
  return {
    baseline,
    end,
    min: Math.min(...values),
    max: Math.max(...values),
    maxGrowth: Math.max(...values) - baseline,
    endGrowth: end - baseline,
    slopePerSample: slope(values),
  };
}

function evaluateResources(samples, limits, errors) {
  for (const [index, sample] of samples.entries()) {
    if (sample?.resources?.canvasConnected !== true) errors.push(`sample ${index} has no connected Pixi canvas`);
    for (const name of RESOURCE_METRICS) {
      if (!Number.isFinite(sample?.resources?.[name]) || sample.resources[name] < 0) {
        errors.push(`sample ${index} is missing renderer diagnostic ${name}`);
      }
    }
    if (!Number.isFinite(sample?.heap?.runtimeUsedBytes) || sample.heap.runtimeUsedBytes <= 0) {
      errors.push(`sample ${index} is missing real Chromium heap diagnostics`);
    }
  }
  if (errors.length > 0) return {};
  const metrics = Object.fromEntries(RESOURCE_METRICS.map((name) => [name, metric(samples.map((sample) => sample.resources[name]))]));
  metrics.heap = metric(samples.map((sample) => sample.heap.runtimeUsedBytes));
  for (const name of RESOURCE_METRICS) {
    if (metrics[name].maxGrowth > limits[name].maxGrowth) errors.push(`${name} grew ${metrics[name].maxGrowth}; limit ${limits[name].maxGrowth}`);
    if (metrics[name].endGrowth > limits[name].maxEndGrowth) errors.push(`${name} ended ${metrics[name].endGrowth} above baseline; limit ${limits[name].maxEndGrowth}`);
  }
  if (metrics.heap.maxGrowth > limits.heap.maxGrowthBytes) errors.push(`post-GC JS heap grew ${metrics.heap.maxGrowth} bytes; limit ${limits.heap.maxGrowthBytes}`);
  if (metrics.heap.endGrowth > limits.heap.maxEndGrowthBytes) errors.push(`post-GC JS heap ended ${metrics.heap.endGrowth} bytes above baseline; limit ${limits.heap.maxEndGrowthBytes}`);
  if (metrics.heap.slopePerSample > limits.heap.maxSlopeBytesPerSample) errors.push(`post-GC JS heap slope was ${Math.round(metrics.heap.slopePerSample)} bytes/sample; limit ${limits.heap.maxSlopeBytesPerSample}`);
  return metrics;
}

function evaluateSaveLoads(samples, thresholds, errors) {
  if (!Array.isArray(samples) || samples.length < thresholds.minimumSaveLoads + 1) {
    errors.push(`expected a baseline plus at least ${thresholds.minimumSaveLoads} real save loads`);
    return { metrics: {}, observations: { saveLoads: 0, resourceGrowthBounded: false } };
  }
  const baseline = samples[0];
  for (const [index, sample] of samples.entries()) {
    if (sample.cycle !== index) errors.push(`save-load sample ${index} has a non-contiguous cycle`);
    if (sample.slotId !== "quick-save" || sample.loaded !== (index > 0)) errors.push(`save-load sample ${index} does not prove the production quick-save load path`);
    if (sample.courseHash !== baseline.courseHash || stableStabilityJson(sample.state) !== stableStabilityJson(baseline.state)) {
      errors.push(`save-load sample ${index} drifted from the saved canonical projection`);
    }
  }
  const metrics = evaluateResources(samples, thresholds.resources, errors);
  return {
    metrics,
    observations: { saveLoads: samples.length - 1, resourceGrowthBounded: errors.length === 0 },
  };
}

function evaluateLongSession(samples, thresholds, errors) {
  if (!Array.isArray(samples) || samples.length < thresholds.minimumSamples) {
    errors.push(`expected at least ${thresholds.minimumSamples} live-simulation samples`);
    return { metrics: {}, observations: { sessionMinutes: 0, resourceGrowthBounded: false } };
  }
  const elapsed = samples.map((sample) => sample.elapsedGameMinutes);
  if (elapsed[0] !== 0 || elapsed.some((value, index) => !Number.isFinite(value) || value < 0 || (index > 0 && value <= elapsed[index - 1]))) {
    errors.push("live-simulation elapsed minutes must be finite, start at zero, and increase monotonically");
  }
  const sessionMinutes = elapsed.at(-1) ?? 0;
  if (sessionMinutes < thresholds.minimumSessionMinutes) errors.push(`live simulation covered ${sessionMinutes} minutes; minimum ${thresholds.minimumSessionMinutes}`);
  const baseline = samples[0];
  for (const [index, sample] of samples.entries()) {
    if (sample.courseHash !== baseline.courseHash) errors.push(`live-simulation sample ${index} changed the course hash`);
    if (!Number.isFinite(sample.state?.dayMinute) || sample.state?.speed !== "4x") errors.push(`live-simulation sample ${index} is missing an active 4x clock`);
  }
  const metrics = evaluateResources(samples, thresholds.resources, errors);
  return { metrics, observations: { sessionMinutes, resourceGrowthBounded: errors.length === 0 } };
}

function evaluateInteractions(samples, thresholds, errors) {
  if (!Array.isArray(samples)) samples = [];
  const scenarioNames = samples.map((sample) => sample.scenario).sort();
  if (stableStabilityJson(scenarioNames) !== stableStabilityJson([...thresholds.requiredScenarios].sort())) {
    errors.push(`interaction samples must cover exactly ${[...thresholds.requiredScenarios].sort().join(", ")}`);
  }
  const byScenario = new Map(samples.map((sample) => [sample.scenario, sample]));
  const editing = byScenario.get("editing");
  if (!editing || editing.before?.terrainVersion + 1 !== editing.after?.terrainVersion || editing.after?.screen !== "game") errors.push("editing did not commit exactly one real terrain revision");
  const overlay = byScenario.get("overlay");
  if (!overlay || overlay.before?.kind !== null || overlay.after?.kind !== "recovery" || overlay.after?.visible !== true) errors.push("recovery overlay did not open through the production UI");
  const sleepWake = byScenario.get("sleep-wake");
  if (!sleepWake || sleepWake.before?.courseHash !== sleepWake.after?.courseHash || sleepWake.after?.lifecycle !== "active" || sleepWake.after?.responsive !== true) errors.push("browser freeze/active recovery did not preserve a responsive candidate");
  const recovery = byScenario.get("recovery");
  if (!recovery || recovery.before?.mutatedCourseHash === recovery.before?.savedCourseHash || recovery.after?.courseHash !== recovery.before?.savedCourseHash || recovery.after?.quickSaveLoaded !== true) errors.push("loading the production quick-save did not recover the pre-edit state");
  for (const sample of samples) if (sample.passed !== true) errors.push(`${sample.scenario ?? "unknown"} interaction did not pass`);
  const metrics = evaluateResources(samples, thresholds.resources, errors);
  return { metrics, observations: { scenarios: scenarioNames, recoveryPassed: errors.length === 0 } };
}

export function evaluateZk682Stability(gate, samples, thresholds = ZK682_STABILITY_THRESHOLDS[gate]) {
  const errors = [];
  if (!thresholds) return { passed: false, errors: [`unknown stability gate ${String(gate)}`], metrics: {}, observations: {} };
  const result = gate === "save-load-resource-stability"
    ? evaluateSaveLoads(samples, thresholds, errors)
    : gate === "long-session-resource-stability"
      ? evaluateLongSession(samples, thresholds, errors)
      : evaluateInteractions(samples, thresholds, errors);
  return { passed: errors.length === 0, errors, ...result };
}

export function createZk682StabilityReport(input) {
  assert.match(input?.candidateCommit ?? "", /^[0-9a-f]{40}$/, "candidateCommit must be a full SHA");
  assert.ok(!Number.isNaN(Date.parse(input?.capturedAt)), "capturedAt is required");
  assert.equal(typeof input?.command, "string", "command is required");
  assert.ok(input.command.length > 0, "command is required");
  assert.equal(input?.browser?.name, "chromium", "real Chromium evidence is required");
  assert.equal(input?.browser?.cdpHeap, true, "real Chromium CDP heap evidence is required");
  const expectedThresholds = ZK682_STABILITY_THRESHOLDS[input.gate];
  assert.ok(expectedThresholds, "known stability gate is required");
  assert.equal(stableStabilityJson(input.thresholds), stableStabilityJson(expectedThresholds), "thresholds must match the immutable contract");
  const result = evaluateZk682Stability(input.gate, input.samples, input.thresholds);
  return {
    schemaVersion: ZK682_STABILITY_SCHEMA_VERSION,
    gate: input.gate,
    candidateCommit: input.candidateCommit,
    capturedAt: input.capturedAt,
    command: input.command,
    browser: input.browser,
    thresholds: input.thresholds,
    samples: input.samples,
    observations: result.observations,
    summary: result.metrics,
    errors: result.errors,
    passed: result.passed,
  };
}

export function validateZk682SupplementalStabilityReport(report, expectedGate, expectedCommit) {
  const errors = [];
  const expectedKeys = ["schemaVersion", "gate", "candidateCommit", "capturedAt", "command", "browser", "thresholds", "samples", "observations", "summary", "errors", "passed"];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { valid: false, errors: ["supplemental stability report must be an object"], passed: false, observations: {} };
  }
  if (stableStabilityJson(Object.keys(report).sort()) !== stableStabilityJson(expectedKeys.sort())) errors.push("supplemental stability report keys are invalid");
  if (report.schemaVersion !== ZK682_STABILITY_SCHEMA_VERSION) errors.push("wrong supplemental stability schema");
  if (report.gate !== expectedGate || !ZK682_STABILITY_THRESHOLDS[expectedGate]) errors.push("wrong supplemental stability gate");
  if (!/^[0-9a-f]{40}$/.test(report.candidateCommit ?? "") || report.candidateCommit !== expectedCommit) errors.push("candidate commit mismatch");
  if (typeof report.capturedAt !== "string" || Number.isNaN(Date.parse(report.capturedAt))) errors.push("capturedAt is invalid");
  if (typeof report.command !== "string" || !report.command) errors.push("command is required");
  if (report.browser?.name !== "chromium" || report.browser?.cdpHeap !== true || typeof report.browser?.version !== "string" || !report.browser.version) errors.push("real Chromium CDP heap evidence is required");
  const thresholds = ZK682_STABILITY_THRESHOLDS[expectedGate];
  if (thresholds && stableStabilityJson(report.thresholds) !== stableStabilityJson(thresholds)) errors.push("thresholds differ from the immutable stability contract");
  const recomputed = thresholds ? evaluateZk682Stability(expectedGate, report.samples, thresholds) : { passed: false, errors: ["unknown gate"], metrics: {}, observations: {} };
  if (stableStabilityJson(report.observations) !== stableStabilityJson(recomputed.observations)
    || stableStabilityJson(report.summary) !== stableStabilityJson(recomputed.metrics)
    || stableStabilityJson(report.errors) !== stableStabilityJson(recomputed.errors)
    || report.passed !== recomputed.passed) errors.push("declared supplemental result does not match raw samples");
  if (report.passed !== true || recomputed.passed !== true) errors.push("supplemental stability report did not pass");
  return { valid: errors.length === 0, errors, passed: report.passed === true && recomputed.passed === true, observations: recomputed.observations };
}
