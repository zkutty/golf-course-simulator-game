import assert from "node:assert/strict";
import { validateStabilityProducer } from "./zk682-stability-producer.mjs";

export const ZK682_STABILITY_SCHEMA_VERSION = 3;
export const ZK682_LEGACY_STABILITY_SCHEMA_VERSION = 2;
export const stabilitySchemaVersion = (gate) => gate === "save-load-resource-stability" ? 3 : 2;

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

export const ZK682_LEGACY_STABILITY_THRESHOLDS = Object.freeze({
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
  }),
});

// Schema 3 changes only save/load. Schema 2 long-session/recovery and the
// historical 12-load evaluator retain their original thresholds and semantics.
export const ZK682_STABILITY_THRESHOLDS = Object.freeze({
  ...ZK682_LEGACY_STABILITY_THRESHOLDS,
  "save-load-resource-stability": Object.freeze({
    minimumSaveLoads: 48,
    resources: Object.freeze({ ...RESOURCE_LIMITS, heap: Object.freeze({ maxGrowthBytes: 8 * MiB, maxEndGrowthBytes: 6 * MiB }) }),
    lateWindows: Object.freeze([Object.freeze({ startCycle: 24, endCycle: 36 }), Object.freeze({ startCycle: 36, endCycle: 48 })]),
    lateHeap: Object.freeze({ maxEndGrowthBytes: 512 * 1024, maxSlopeBytesPerSample: 64 * 1024 }),
    rendererQuality: "high",
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

function rendererTopologyMetric(samples, name) {
  const overall = metric(samples.map((sample) => sample.resources[name]));
  const groups = new Map();
  for (const sample of samples) {
    const values = groups.get(sample.rendererQuality) ?? [];
    values.push(sample.resources[name]);
    groups.set(sample.rendererQuality, values);
  }
  const byRendererQuality = Object.fromEntries(
    [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([quality, values]) => [quality, metric(values)]),
  );
  const topologyMetrics = Object.values(byRendererQuality);
  return {
    ...overall,
    crossTopologyEndGrowth: overall.endGrowth,
    maxGrowth: Math.max(...topologyMetrics.map((value) => value.maxGrowth)),
    endGrowth: Math.max(...topologyMetrics.map((value) => value.endGrowth)),
    byRendererQuality,
  };
}

function evaluateResources(samples, limits, errors) {
  for (const [index, sample] of samples.entries()) {
    if (!["high", "medium", "low"].includes(sample?.rendererQuality)) errors.push(`sample ${index} is missing renderer topology identity`);
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
  const metrics = Object.fromEntries(RESOURCE_METRICS.map((name) => [name, rendererTopologyMetric(samples, name)]));
  metrics.heap = metric(samples.map((sample) => sample.heap.runtimeUsedBytes));
  for (const name of RESOURCE_METRICS) {
    if (metrics[name].maxGrowth > limits[name].maxGrowth) errors.push(`${name} grew ${metrics[name].maxGrowth} within one renderer topology; limit ${limits[name].maxGrowth}`);
    if (metrics[name].endGrowth > limits[name].maxEndGrowth) errors.push(`${name} ended ${metrics[name].endGrowth} above its same-topology baseline; limit ${limits[name].maxEndGrowth}`);
  }
  if (metrics.heap.maxGrowth > limits.heap.maxGrowthBytes) errors.push(`post-GC JS heap grew ${metrics.heap.maxGrowth} bytes; limit ${limits.heap.maxGrowthBytes}`);
  if (metrics.heap.endGrowth > limits.heap.maxEndGrowthBytes) errors.push(`post-GC JS heap ended ${metrics.heap.endGrowth} bytes above baseline; limit ${limits.heap.maxEndGrowthBytes}`);
  if (Object.hasOwn(limits.heap, "maxSlopeBytesPerSample") && metrics.heap.slopePerSample > limits.heap.maxSlopeBytesPerSample) errors.push(`post-GC JS heap slope was ${Math.round(metrics.heap.slopePerSample)} bytes/sample; limit ${limits.heap.maxSlopeBytesPerSample}`);
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

const sameKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && stableStabilityJson(Object.keys(value).sort()) === stableStabilityJson([...keys].sort());
const FULL_RESOURCE_METRICS = Object.freeze(["displayObjects", "containers", "sprites", "graphics", "meshes", "text", "attachedTextures", "attachedTextureSources", "managedTextureSources"]);

function evaluateSaveLoadCurve(samples, thresholds, errors, runtimeErrors) {
  const observations = { saveLoads: Array.isArray(samples) ? Math.max(0, samples.length - 1) : 0, resourceGrowthBounded: false };
  if (!Array.isArray(samples) || samples.length !== thresholds.minimumSaveLoads + 1) {
    errors.push("expected exactly 49 samples: baseline plus 48 real save loads");
    return { metrics: {}, observations };
  }
  if (!Array.isArray(runtimeErrors) || runtimeErrors.some(error => typeof error !== "string") || runtimeErrors.length !== 0) errors.push("runtimeErrors must be an empty console/page error array");
  const baseline = samples[0];
  for (const [index, sample] of samples.entries()) {
    if (!sameKeys(sample, ["cycle", "slotId", "loaded", "courseHash", "state", "resources", "rendererQuality", "heap"])) {
      errors.push(`save-load sample ${index} has invalid typed sample keys`);
      continue;
    }
    if (sample.cycle !== index) errors.push(`save-load sample ${index} has a non-contiguous cycle`);
    if (sample.slotId !== "quick-save" || sample.loaded !== (index > 0)) errors.push(`save-load sample ${index} does not prove the production quick-save load path`);
    if (!/^[0-9a-f]{8}$/.test(sample.courseHash ?? "") || sample.courseHash !== baseline?.courseHash) errors.push(`save-load sample ${index} has an invalid or drifting canonical hash`);
    const state = sample.state;
    if (!sameKeys(state, ["screen", "week", "cash", "terrainCounts"]) || state.screen !== "game"
      || !Number.isSafeInteger(state.week) || state.week < 0 || !Number.isFinite(state.cash)
      || !state.terrainCounts || typeof state.terrainCounts !== "object" || Array.isArray(state.terrainCounts)
      || Object.keys(state.terrainCounts).length === 0 || Object.values(state.terrainCounts).some(value => !Number.isSafeInteger(value) || value < 0)
      || stableStabilityJson(state) !== stableStabilityJson(baseline?.state)) errors.push(`save-load sample ${index} drifted from the saved canonical projection or has invalid typed state`);
    if (sample.rendererQuality !== thresholds.rendererQuality) errors.push(`save-load sample ${index} must retain High renderer quality`);
    if (!sameKeys(sample.resources, [...FULL_RESOURCE_METRICS, "canvasConnected"]) || sample.resources.canvasConnected !== true
      || FULL_RESOURCE_METRICS.some(name => !Number.isSafeInteger(sample.resources[name]) || sample.resources[name] < 0)
      || stableStabilityJson(sample.resources) !== stableStabilityJson(baseline?.resources)) errors.push(`save-load sample ${index} must retain the full flat renderer resource snapshot`);
    if (!sameKeys(sample.heap, ["runtimeUsedBytes", "runtimeTotalBytes"]) || !Number.isSafeInteger(sample.heap.runtimeUsedBytes) || sample.heap.runtimeUsedBytes <= 0
      || !Number.isSafeInteger(sample.heap.runtimeTotalBytes) || sample.heap.runtimeTotalBytes < sample.heap.runtimeUsedBytes) errors.push(`save-load sample ${index} has invalid real Chromium heap diagnostics`);
  }
  if (errors.length) return { metrics: {}, observations };
  const metrics = evaluateResources(samples, thresholds.resources, errors);
  metrics.lateHeapWindows = thresholds.lateWindows.map(({ startCycle, endCycle }) => {
    const window = { startCycle, endCycle, ...metric(samples.slice(startCycle, endCycle + 1).map(sample => sample.heap.runtimeUsedBytes)) };
    if (window.endGrowth > thresholds.lateHeap.maxEndGrowthBytes) errors.push(`post-GC JS heap window ${startCycle}-${endCycle} ended ${window.endGrowth} bytes above its rebased baseline; limit ${thresholds.lateHeap.maxEndGrowthBytes}`);
    if (window.slopePerSample > thresholds.lateHeap.maxSlopeBytesPerSample) errors.push(`post-GC JS heap window ${startCycle}-${endCycle} slope was ${window.slopePerSample} bytes/sample; limit ${thresholds.lateHeap.maxSlopeBytesPerSample}`);
    return window;
  });
  observations.resourceGrowthBounded = errors.length === 0;
  return { metrics, observations };
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
  const courseHashes = new Set();
  for (const [index, sample] of samples.entries()) {
    if (!/^[0-9a-f]{8}$/.test(sample.courseHash ?? "")) errors.push(`live-simulation sample ${index} is missing a valid game-state hash`);
    else courseHashes.add(sample.courseHash);
    if (!Number.isFinite(sample.state?.dayMinute)
      || sample.state?.speed !== "4x"
      || !Number.isInteger(sample.state?.onCourse)
      || sample.state.onCourse <= 0
      || (index > 0 && sample.state.dayMinute <= samples[index - 1].state?.dayMinute)) {
      errors.push(`live-simulation sample ${index} is missing an advancing active 4x simulation`);
    }
  }
  if (courseHashes.size < 2) errors.push("live simulation did not advance its game-state identity");
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
  if (!overlay || overlay.before?.panelOpen !== false || overlay.after?.kind !== "recovery" || overlay.after?.visible !== true) errors.push("recovery overlay did not open through the production UI");
  const sleepWake = byScenario.get("sleep-wake");
  if (!sleepWake || sleepWake.before?.courseHash !== sleepWake.after?.courseHash || sleepWake.after?.lifecycle !== "active" || sleepWake.after?.responsive !== true) errors.push("browser freeze/active recovery did not preserve a responsive candidate");
  const recovery = byScenario.get("recovery");
  if (!recovery || recovery.before?.mutatedCourseHash === recovery.before?.savedCourseHash || recovery.after?.courseHash !== recovery.before?.savedCourseHash || recovery.after?.quickSaveLoaded !== true) errors.push("loading the production quick-save did not recover the pre-edit state");
  for (const sample of samples) if (sample.passed !== true) errors.push(`${sample.scenario ?? "unknown"} interaction did not pass`);
  for (const [index, sample] of samples.entries()) {
    if (sample?.resources?.canvasConnected !== true) errors.push(`sample ${index} has no connected Pixi canvas`);
    for (const name of RESOURCE_METRICS) if (!Number.isFinite(sample?.resources?.[name]) || sample.resources[name] < 0) errors.push(`sample ${index} is missing renderer diagnostic ${name}`);
    if (!Number.isFinite(sample?.heap?.runtimeUsedBytes) || sample.heap.runtimeUsedBytes <= 0) errors.push(`sample ${index} is missing real Chromium heap diagnostics`);
  }
  const metrics = Object.fromEntries(samples.map((sample) => [sample.scenario, {
    resources: sample.resources,
    runtimeUsedBytes: sample.heap?.runtimeUsedBytes,
  }]));
  return { metrics, observations: { scenarios: scenarioNames, recoveryPassed: errors.length === 0 } };
}

function evaluate(gate, samples, thresholds, legacy, runtimeErrors) {
  const errors = [];
  if (!thresholds) return { passed: false, errors: [`unknown stability gate ${String(gate)}`], metrics: {}, observations: {} };
  const result = gate === "save-load-resource-stability"
    ? legacy ? evaluateSaveLoads(samples, thresholds, errors) : evaluateSaveLoadCurve(samples, thresholds, errors, runtimeErrors)
    : gate === "long-session-resource-stability" ? evaluateLongSession(samples, thresholds, errors) : evaluateInteractions(samples, thresholds, errors);
  return { passed: errors.length === 0, errors, ...result };
}

export function evaluateZk682Stability(gate, samples, thresholds = ZK682_STABILITY_THRESHOLDS[gate], runtimeErrors = []) {
  if (!ZK682_STABILITY_THRESHOLDS[gate] || stableStabilityJson(thresholds) !== stableStabilityJson(ZK682_STABILITY_THRESHOLDS[gate])) return { passed: false, errors: ["unknown gate or thresholds differ from the immutable stability contract"], metrics: {}, observations: {} };
  return evaluate(gate, samples, thresholds, false, runtimeErrors);
}

// Diagnostic history only. Machine validators never select this evaluator for
// schema-2 save/load evidence unless the caller explicitly opts into history.
export function evaluateLegacyZk682Stability(gate, samples, thresholds = ZK682_LEGACY_STABILITY_THRESHOLDS[gate]) {
  return evaluate(gate, samples, thresholds, true, []);
}

function createReport(input, legacy) {
  assert.match(input?.candidateCommit ?? "", /^[0-9a-f]{40}$/, "candidateCommit must be a full SHA");
  assert.ok(!Number.isNaN(Date.parse(input?.capturedAt)), "capturedAt is required");
  assert.equal(typeof input?.command, "string", "command is required");
  assert.ok(input.command.length > 0, "command is required");
  assert.equal(input?.browser?.name, "chromium", "real Chromium evidence is required");
  assert.equal(input?.browser?.cdpHeap, true, "real Chromium CDP heap evidence is required");
  const expectedThresholds = (legacy ? ZK682_LEGACY_STABILITY_THRESHOLDS : ZK682_STABILITY_THRESHOLDS)[input.gate];
  assert.ok(expectedThresholds, "known stability gate is required");
  assert.equal(stableStabilityJson(input.thresholds), stableStabilityJson(expectedThresholds), "thresholds must match the immutable contract");
  if (Object.hasOwn(input, "producer")) {
    const producerErrors = validateStabilityProducer(input.producer, input.candidateCommit);
    assert.deepEqual(producerErrors, [], producerErrors.join("; "));
  }
  const curve = !legacy && input.gate === "save-load-resource-stability";
  if (curve) {
    assert.ok(Object.hasOwn(input, "producer"), "schema-3 save/load producer attestation is required");
    assert.ok(Array.isArray(input.runtimeErrors), "schema-3 save/load runtimeErrors array is required");
  }
  const result = legacy ? evaluateLegacyZk682Stability(input.gate, input.samples, input.thresholds) : evaluateZk682Stability(input.gate, input.samples, input.thresholds, input.runtimeErrors);
  return {
    schemaVersion: legacy ? ZK682_LEGACY_STABILITY_SCHEMA_VERSION : stabilitySchemaVersion(input.gate),
    gate: input.gate,
    candidateCommit: input.candidateCommit,
    capturedAt: input.capturedAt,
    command: input.command,
    ...(Object.hasOwn(input, "producer") ? { producer: input.producer } : {}),
    browser: input.browser,
    thresholds: input.thresholds,
    samples: input.samples,
    ...(curve ? { runtimeErrors: input.runtimeErrors } : {}),
    observations: result.observations,
    summary: result.metrics,
    errors: result.errors,
    passed: result.passed,
  };
}

export const createZk682StabilityReport = (input) => createReport(input, false);
export const createLegacyZk682StabilityReport = (input) => createReport(input, true);

export function validateZk682SupplementalStabilityReport(report, expectedGate, expectedCommit, { allowLegacy = false } = {}) {
  const errors = [];
  const expectedKeys = ["schemaVersion", "gate", "candidateCommit", "capturedAt", "command", "browser", "thresholds", "samples", "observations", "summary", "errors", "passed"];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { valid: false, errors: ["supplemental stability report must be an object"], passed: false, observations: {} };
  }
  const legacySaveLoad = expectedGate === "save-load-resource-stability" && report.schemaVersion === 2;
  const curve = expectedGate === "save-load-resource-stability" && !legacySaveLoad;
  if (curve) expectedKeys.push("runtimeErrors");
  if (legacySaveLoad && !allowLegacy) errors.push("schema-2 save/load evidence is diagnostic only; schema-3 is required for machine acceptance");
  if (!Object.hasOwn(report, "producer") && (!allowLegacy || curve)) errors.push("corrected stability producer attestation is required; legacy evidence is diagnostic only");
  if (Object.hasOwn(report, "producer")) {
    expectedKeys.push("producer");
    errors.push(...validateStabilityProducer(report.producer, expectedCommit));
  }
  if (stableStabilityJson(Object.keys(report).sort()) !== stableStabilityJson(expectedKeys.sort())) errors.push("supplemental stability report keys are invalid");
  if (report.schemaVersion !== (legacySaveLoad && allowLegacy ? 2 : stabilitySchemaVersion(expectedGate))) errors.push("wrong supplemental stability schema");
  if (report.gate !== expectedGate || !ZK682_STABILITY_THRESHOLDS[expectedGate]) errors.push("wrong supplemental stability gate");
  if (!/^[0-9a-f]{40}$/.test(report.candidateCommit ?? "") || report.candidateCommit !== expectedCommit) errors.push("candidate commit mismatch");
  if (typeof report.capturedAt !== "string" || Number.isNaN(Date.parse(report.capturedAt))) errors.push("capturedAt is invalid");
  if (typeof report.command !== "string" || !report.command) errors.push("command is required");
  if (report.browser?.name !== "chromium" || report.browser?.cdpHeap !== true || typeof report.browser?.version !== "string" || !report.browser.version) errors.push("real Chromium CDP heap evidence is required");
  const thresholds = (legacySaveLoad && allowLegacy ? ZK682_LEGACY_STABILITY_THRESHOLDS : ZK682_STABILITY_THRESHOLDS)[expectedGate];
  if (thresholds && stableStabilityJson(report.thresholds) !== stableStabilityJson(thresholds)) errors.push("thresholds differ from the immutable stability contract");
  const recomputed = thresholds ? (legacySaveLoad && allowLegacy ? evaluateLegacyZk682Stability(expectedGate, report.samples, thresholds) : evaluateZk682Stability(expectedGate, report.samples, thresholds, report.runtimeErrors)) : { passed: false, errors: ["unknown gate"], metrics: {}, observations: {} };
  if (stableStabilityJson(report.observations) !== stableStabilityJson(recomputed.observations)
    || stableStabilityJson(report.summary) !== stableStabilityJson(recomputed.metrics)
    || stableStabilityJson(report.errors) !== stableStabilityJson(recomputed.errors)
    || report.passed !== recomputed.passed) errors.push("declared supplemental result does not match raw samples");
  if (report.passed !== true || recomputed.passed !== true) errors.push("supplemental stability report did not pass");
  return { valid: errors.length === 0, errors, passed: errors.length === 0 && report.passed === true && recomputed.passed === true, observations: recomputed.observations };
}

// Explicitly non-gating wrapper: even a passing legacy report is not machine evidence.
export function createZk682LegacySaveLoadDiagnostic(machineReport) {
  return { kind: "non-gating-legacy-first12", diagnosticOnly: true, productionGateAcceptance: false,
    report: createLegacyZk682StabilityReport({ ...machineReport,
      command: "legacy first12 diagnostic only; not machine acceptance",
      thresholds: ZK682_LEGACY_STABILITY_THRESHOLDS["save-load-resource-stability"],
      samples: machineReport.samples.slice(0, 13),
    }),
  };
}

export function validateZk682LegacySaveLoadDiagnostic(diagnostic, machineReport, expectedCommit) {
  const errors = [];
  if (!sameKeys(diagnostic, ["kind", "diagnosticOnly", "productionGateAcceptance", "report"])
    || diagnostic.kind !== "non-gating-legacy-first12" || diagnostic.diagnosticOnly !== true || diagnostic.productionGateAcceptance !== false) return ["legacy first12 diagnostic must be explicitly non-gating"];
  const report = diagnostic.report;
  if (report?.schemaVersion !== 2) errors.push("legacy first12 diagnostic requires schema 2");
  const inspected = validateZk682SupplementalStabilityReport(report, "save-load-resource-stability", expectedCommit, { allowLegacy: true });
  errors.push(...inspected.errors.filter(error => error !== "supplemental stability report did not pass"));
  if (report?.samples?.length !== 13 || stableStabilityJson(report?.samples) !== stableStabilityJson(machineReport?.samples?.slice(0, 13))
    || stableStabilityJson(report?.producer) !== stableStabilityJson(machineReport?.producer)
    || stableStabilityJson(report?.browser) !== stableStabilityJson(machineReport?.browser)) errors.push("legacy first12 diagnostic must bind the machine run's first13 samples, producer and browser");
  return errors;
}
