import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

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
  if (report?.schemaVersion === 3) return validateConservationStabilityReport(report, expectedGate, expectedCommit);
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

// Explicit v3 semantics. The schema-2 evaluator/creator above remain the replay path.
export const ZK682_DISPLAY_CONSERVATION_SCHEMA_VERSION = 3;
const EMOTE_KINDS = new Set(["star", "happy", "angry", "storm", "zzz", "cashGood", "cashBad", "alert"]);
const exactMetadataKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && stableStabilityJson(Object.keys(value).sort()) === stableStabilityJson([...keys].sort());
const identity = (value) => Number.isSafeInteger(value) && value >= 0;

function admittedEmoteContribution(sample) {
  const m = sample?.resources?.emoteOwnership;
  if (!exactMetadataKeys(m, ["schemaVersion", "complete", "failure", "generation", "stageUID", "overlayUID", "currentOwner", "apiIdentityCurrent", "ownerCount", "scheduler", "groups", "contribution"])
    || m.schemaVersion !== 1 || m.complete !== true || m.failure !== null || m.currentOwner !== true || m.apiIdentityCurrent !== true
    || !identity(m.generation) || m.generation === 0 || !identity(m.stageUID) || !identity(m.overlayUID) || m.stageUID === m.overlayUID
    || !Array.isArray(m.groups) || m.groups.length > 5 || m.ownerCount !== m.groups.length
    || !Array.isArray(m.scheduler) || m.scheduler.length !== m.groups.length) throw new Error("missing or invalid current emote ownership metadata");
  const scheduler = new Map();
  for (const row of m.scheduler) {
    if (!exactMetadataKeys(row, ["golferId", "kind"]) || !identity(row.golferId) || !EMOTE_KINDS.has(row.kind) || scheduler.has(row.golferId)) throw new Error("invalid emote scheduler identities");
    scheduler.set(row.golferId, row.kind);
  }
  const uids = new Set([m.stageUID, m.overlayUID]);
  const owners = new Set();
  let displayObjects = 0, graphics = 0, text = 0;
  for (const g of m.groups) {
    if (!exactMetadataKeys(g, ["golferId", "builtKind", "schedulerKind", "uid", "className", "destroyed", "parentIsCurrentOverlay", "children"])
      || !identity(g.golferId) || owners.has(g.golferId) || !EMOTE_KINDS.has(g.builtKind)
      || g.builtKind !== g.schedulerKind || scheduler.get(g.golferId) !== g.builtKind
      || !identity(g.uid) || uids.has(g.uid) || g.className !== "Container" || g.destroyed !== false || g.parentIsCurrentOverlay !== true) throw new Error("invalid built-kind/current emote group identity");
    const glyph = g.builtKind === "zzz" ? "Zz" : g.builtKind === "alert" ? "!" : ["cashGood", "cashBad"].includes(g.builtKind) ? "$" : null;
    if (!Array.isArray(g.children) || g.children.length !== (glyph === null ? 2 : 3)) throw new Error("invalid emote subtree shape");
    owners.add(g.golferId); uids.add(g.uid);
    displayObjects++;
    for (const [index, child] of g.children.entries()) {
      const expectedClass = glyph !== null && index === 1 ? "Text" : "Graphics";
      if (!exactMetadataKeys(child, ["uid", "className", "destroyed", "parentIsGroup", "childCount", "text"])
        || !identity(child.uid) || uids.has(child.uid) || child.className !== expectedClass || child.destroyed !== false
        || child.parentIsGroup !== true || child.childCount !== 0 || child.text !== (expectedClass === "Text" ? glyph : null)) throw new Error("invalid emote child identity/glyph/leaf");
      uids.add(child.uid); displayObjects++;
      if (expectedClass === "Text") text++; else graphics++;
    }
  }
  if (!exactMetadataKeys(m.contribution, ["displayObjects", "graphics", "text"])
    || m.contribution.displayObjects !== displayObjects || m.contribution.graphics !== graphics || m.contribution.text !== text
    || !Number.isSafeInteger(sample.resources.displayObjects) || sample.resources.displayObjects < displayObjects
    || !Number.isSafeInteger(sample.resources.graphics) || sample.resources.graphics < graphics
    || !Number.isSafeInteger(sample.resources.text) || sample.resources.text < text) throw new Error("emote contribution disagrees with exact subtrees/raw counts");
  return displayObjects;
}

export function evaluateZk682ConservationStability(gate, samples, thresholds = ZK682_STABILITY_THRESHOLDS[gate]) {
  const legacy = evaluateZk682Stability(gate, samples, thresholds);
  const errors = legacy.errors.filter((error) => !error.startsWith("displayObjects grew ") && !error.startsWith("displayObjects ended "));
  const metrics = { ...legacy.metrics };
  const explained = [];
  if (!Array.isArray(samples)) errors.push("v3 requires measured samples with current emote ownership");
  else for (const [index, sample] of samples.entries()) {
    try { explained.push(admittedEmoteContribution(sample)); }
    catch (error) { errors.push(`sample ${index}: ${error.message}`); }
  }
  if (Array.isArray(samples) && samples.length > 0 && explained.length === samples.length
    && legacy.metrics.displayObjects) {
    const residualSamples = samples.map((sample, i) => ({ ...sample, resources: { ...sample.resources, displayObjects: sample.resources.displayObjects - explained[i] } }));
    const residual = rendererTopologyMetric(residualSamples, "displayObjects");
    const baselines = new Map();
    const qualityCounts = new Map();
    const conservationRows = samples.map((sample, i) => {
      const quality = sample.rendererQuality;
      if (!baselines.has(quality)) baselines.set(quality, i);
      qualityCounts.set(quality, (qualityCounts.get(quality) ?? 0) + 1);
      const baselineIndex = baselines.get(quality);
      const observedChange = sample.resources.displayObjects - samples[baselineIndex].resources.displayObjects;
      const explainedEmoteChange = explained[i] - explained[baselineIndex];
      return { sampleIndex: i, rendererQuality: quality, baselineIndex, rawDisplayObjects: sample.resources.displayObjects,
        explainedEmoteDisplayObjects: explained[i], residualDisplayObjects: residualSamples[i].resources.displayObjects,
        observedChange, explainedEmoteChange, unexplainedDisplayChange: observedChange - explainedEmoteChange };
    });
    for (const [quality, count] of qualityCounts) if (count < 3) errors.push(`renderer quality ${quality} has ${count} measured report boundaries; at least 3 required (readiness polls do not count)`);
    if (residual.maxGrowth > thresholds.resources.displayObjects.maxGrowth) errors.push(`unexplained displayObjects grew ${residual.maxGrowth} within one renderer quality; limit ${thresholds.resources.displayObjects.maxGrowth}`);
    if (residual.endGrowth > thresholds.resources.displayObjects.maxEndGrowth) errors.push(`unexplained displayObjects ended ${residual.endGrowth} above its conserved quality baseline; limit ${thresholds.resources.displayObjects.maxEndGrowth}`);
    metrics.displayObjects = { semantics: "current-emote-conservation-v3", formula: "R=D-E; G=R-R_first_measured_same_quality",
      raw: legacy.metrics.displayObjects, residual, measuredBoundariesByQuality: Object.fromEntries(qualityCounts), samples: conservationRows };
  }
  const passed = errors.length === 0;
  const observations = { ...legacy.observations };
  if ("resourceGrowthBounded" in observations) observations.resourceGrowthBounded = passed;
  if ("recoveryPassed" in observations) observations.recoveryPassed = passed;
  return { passed, errors, metrics, observations,
    legacyRawComparison: { passed: legacy.passed, errors: legacy.errors, summary: legacy.metrics, observations: legacy.observations } };
}

export function createZk682ConservationStabilityReport(input) {
  const legacy = createZk682StabilityReport(input); // Keeps all original identity/budget assertions.
  const result = evaluateZk682ConservationStability(input.gate, input.samples, input.thresholds);
  return { ...legacy, schemaVersion: ZK682_DISPLAY_CONSERVATION_SCHEMA_VERSION,
    observations: result.observations, summary: result.metrics, errors: result.errors, passed: result.passed,
    legacyRawComparison: result.legacyRawComparison };
}

function validateConservationStabilityReport(report, expectedGate, expectedCommit) {
  const errors = [];
  const keys = ["schemaVersion", "gate", "candidateCommit", "capturedAt", "command", "browser", "thresholds", "samples", "observations", "summary", "errors", "passed", "legacyRawComparison"];
  if (!exactMetadataKeys(report, keys)) errors.push("supplemental v3 stability report keys are invalid");
  if (report.gate !== expectedGate || !ZK682_STABILITY_THRESHOLDS[expectedGate]) errors.push("wrong supplemental stability gate");
  if (!/^[0-9a-f]{40}$/.test(report.candidateCommit ?? "") || report.candidateCommit !== expectedCommit) errors.push("candidate commit mismatch");
  if (typeof report.capturedAt !== "string" || Number.isNaN(Date.parse(report.capturedAt))) errors.push("capturedAt is invalid");
  if (typeof report.command !== "string" || !report.command) errors.push("command is required");
  if (report.browser?.name !== "chromium" || report.browser?.cdpHeap !== true || typeof report.browser?.version !== "string" || !report.browser.version) errors.push("real Chromium CDP heap evidence is required");
  const thresholds = ZK682_STABILITY_THRESHOLDS[expectedGate];
  if (stableStabilityJson(report.thresholds) !== stableStabilityJson(thresholds)) errors.push("thresholds differ from the immutable stability contract");
  const r = evaluateZk682ConservationStability(expectedGate, report.samples, thresholds);
  if (stableStabilityJson(report.observations) !== stableStabilityJson(r.observations)
    || stableStabilityJson(report.summary) !== stableStabilityJson(r.metrics)
    || stableStabilityJson(report.errors) !== stableStabilityJson(r.errors)
    || stableStabilityJson(report.legacyRawComparison) !== stableStabilityJson(r.legacyRawComparison)
    || report.passed !== r.passed) errors.push("declared supplemental result does not match raw samples");
  if (report.passed !== true || r.passed !== true) errors.push("supplemental stability report did not pass");
  return { valid: errors.length === 0, errors, passed: report.passed === true && r.passed === true, observations: r.observations };
}


/** Never migrate or overwrite an existing v2/v3 artifact in the caller's directory. */
export async function writeZk682ConservationStabilityReport(path, report) {
  assert.equal(report?.schemaVersion, ZK682_DISPLAY_CONSERVATION_SCHEMA_VERSION, "new producer writes schema 3 only");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
