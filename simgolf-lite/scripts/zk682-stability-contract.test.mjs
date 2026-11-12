import assert from "node:assert/strict";
import test from "node:test";
import {
  stabilitySchemaVersion,
  ZK682_LEGACY_STABILITY_THRESHOLDS,
  createLegacyZk682StabilityReport,
  createZk682LegacySaveLoadDiagnostic,
  validateZk682LegacySaveLoadDiagnostic,
  ZK682_STABILITY_THRESHOLDS,
  createZk682StabilityReport,
  evaluateZk682Stability,
  validateZk682SupplementalStabilityReport,
} from "./zk682-stability-contract.mjs";

import { createStabilityProducer, stabilityProducerKind, ZK682_STABILITY_FIXTURE } from "./zk682-stability-producer.mjs";

const COMMIT = "a".repeat(40);
const browser = { name: "chromium", version: "fixture", cdpHeap: true };
const resources = { containers: 2000, sprites: 1200, graphics: 400, meshes: 300, text: 5, displayObjects: 2000, attachedTextures: 80, attachedTextureSources: 20, managedTextureSources: 48, canvasConnected: true };
const measured = (index) => ({ rendererQuality: "high", resources: { ...resources }, heap: { runtimeUsedBytes: 40_000_000 + index * 20_000, runtimeTotalBytes: 80_000_000 } });
const buildId = "12345678-1234-1234-1234-123456789abc";
const runtime = { dev: false, prod: true, mode: "e2e", commit: COMMIT, buildId, privatePerfFixture: true, fixture: { ...ZK682_STABILITY_FIXTURE } };
const producer = createStabilityProducer(runtime, COMMIT, buildId);
const baseInput = (gate, samples) => ({ producer, ...(gate === "save-load-resource-stability" ? { runtimeErrors: [] } : {}), candidateCommit: COMMIT, capturedAt: "2026-09-29T12:00:00.000Z", command: `fixture ${gate}`, browser, gate, thresholds: ZK682_STABILITY_THRESHOLDS[gate], samples });

function saveSamples(count = 48) {
  const state = { screen: "game", week: 2, cash: 42000, terrainCounts: { rough: 7700 } };
  return Array.from({ length: count + 1 }, (_, cycle) => ({ cycle, slotId: "quick-save", loaded: cycle > 0, courseHash: "deadbeef", state: { ...state }, ...measured(cycle) }));
}

function longSamples(count = 7) {
  return Array.from({ length: count }, (_, index) => ({ elapsedGameMinutes: index * 22.4, courseHash: index.toString(16).padStart(8, "0"), state: { dayMinute: 100 + index * 22.4, speed: "4x", onCourse: 12 }, ...measured(index) }));
}

function interactionSamples() {
  return [
    { scenario: "editing", passed: true, before: { terrainVersion: 7 }, after: { terrainVersion: 8, screen: "game" }, ...measured(0) },
    { scenario: "overlay", passed: true, before: { panelOpen: false, kind: "traces" }, after: { kind: "recovery", visible: true }, ...measured(1) },
    { scenario: "sleep-wake", passed: true, before: { courseHash: "deadbeef" }, after: { courseHash: "deadbeef", lifecycle: "active", responsive: true }, ...measured(2) },
    { scenario: "recovery", passed: true, before: { savedCourseHash: "deadbeef", mutatedCourseHash: "cafef00d" }, after: { courseHash: "deadbeef", quickSaveLoaded: true }, ...measured(3) },
  ];
}

test("builds all three typed candidate-bound stability reports", () => {
  for (const [gate, samples] of [
    ["save-load-resource-stability", saveSamples()],
    ["long-session-resource-stability", longSamples()],
    ["editing-overlay-sleep-recovery", interactionSamples()],
  ]) {
    const report = createZk682StabilityReport(baseInput(gate, samples));
    assert.equal(report.schemaVersion, stabilitySchemaVersion(gate));
    assert.equal(report.candidateCommit, COMMIT);
    assert.equal(report.passed, true, report.errors.join("\n"));
  }
});

test("save-load evidence fails closed on short runs, drift, and heap growth", () => {
  assert.match(evaluateZk682Stability("save-load-resource-stability", saveSamples(2)).errors.join("\n"), /exactly 49/);
  const drift = saveSamples(); drift[8].state.cash += 1;
  assert.match(evaluateZk682Stability("save-load-resource-stability", drift).errors.join("\n"), /canonical projection/);
  const topologyShift = saveSamples(); topologyShift[8].rendererQuality = "low";
  assert.match(evaluateZk682Stability("save-load-resource-stability", topologyShift).errors.join("\n"), /High renderer quality/);
  const missingQuality = saveSamples(); delete missingQuality[0].rendererQuality;
  assert.match(evaluateZk682Stability("save-load-resource-stability", missingQuality).errors.join("\n"), /typed sample keys/);
  const heap = saveSamples(); heap.at(-1).heap.runtimeUsedBytes += 9 * 1024 * 1024;
  assert.match(evaluateZk682Stability("save-load-resource-stability", heap).errors.join("\n"), /post-GC JS heap/);
});

test("long-session evidence requires a real-duration monotonic active simulation", () => {
  const short = longSamples(5);
  assert.match(evaluateZk682Stability("long-session-resource-stability", short).errors.join("\n"), /at least 6/);
  const tooBrief = longSamples(); tooBrief.at(-1).elapsedGameMinutes = 119;
  assert.match(evaluateZk682Stability("long-session-resource-stability", tooBrief).errors.join("\n"), /minimum 120/);
  const paused = longSamples(); paused[3].state.speed = "paused";
  assert.match(evaluateZk682Stability("long-session-resource-stability", paused).errors.join("\n"), /active 4x simulation/);
  const stalled = longSamples(); for (const sample of stalled) sample.courseHash = "deadbeef";
  assert.match(evaluateZk682Stability("long-session-resource-stability", stalled).errors.join("\n"), /did not advance its game-state identity/);
});

test("interaction evidence requires exact real outcomes for every scenario", () => {
  const missing = interactionSamples().slice(1);
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", missing).errors.join("\n"), /cover exactly/);
  const fakeEdit = interactionSamples(); fakeEdit[0].after.terrainVersion = 9;
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", fakeEdit).errors.join("\n"), /exactly one real terrain revision/);
  const fakeWake = interactionSamples(); fakeWake[2].after.responsive = false;
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", fakeWake).errors.join("\n"), /freeze\/active recovery/);
  const fakeRecovery = interactionSamples(); fakeRecovery[3].after.courseHash = "cafef00d";
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", fakeRecovery).errors.join("\n"), /pre-edit state/);
});

test("report creation rejects local identity and relaxed thresholds", () => {
  assert.throws(() => createZk682StabilityReport({ ...baseInput("save-load-resource-stability", saveSamples()), candidateCommit: "local" }), /full SHA/);
  assert.throws(() => createZk682StabilityReport({ ...baseInput("save-load-resource-stability", saveSamples()), thresholds: { ...ZK682_STABILITY_THRESHOLDS["save-load-resource-stability"], minimumSaveLoads: 1 } }), /immutable contract/);
});


test("schema3 requires production attestation while legacy schema2 remains diagnostic only", () => {
  const input = baseInput("save-load-resource-stability", saveSamples());
  const corrected = createZk682StabilityReport(input);
  assert.equal(corrected.schemaVersion, 3);
  const stripped = structuredClone(corrected); delete stripped.producer;
  assert.equal(validateZk682SupplementalStabilityReport(stripped, input.gate, COMMIT, { allowLegacy: true }).valid, false);
  assert.equal(validateZk682SupplementalStabilityReport(corrected, input.gate, COMMIT).valid, true);
  for (const change of [{ producerVersion: "legacy" }, { heapMethod: "gc-delay-then-read" }, { buildMode: "development" }, { runtime: { ...runtime, dev: true } }, { runtime: { ...runtime, commit: "b".repeat(40) } }, { runtime: { ...runtime, fixture: { ...runtime.fixture, holes: 36 } } }]) {
    const falseProducer = { ...producer, ...change };
    assert.throws(() => createZk682StabilityReport({ ...input, producer: falseProducer }));
    assert.equal(validateZk682SupplementalStabilityReport({ ...corrected, producer: falseProducer }, input.gate, COMMIT, { allowLegacy: true }).valid, false);
  }
  const historical = createLegacyZk682StabilityReport({ ...input, samples: input.samples.slice(0, 13), thresholds: ZK682_LEGACY_STABILITY_THRESHOLDS[input.gate] });
  assert.equal(stabilityProducerKind(historical), producer.producerVersion);
  assert.equal(historical.schemaVersion, 2);
  assert.equal(validateZk682SupplementalStabilityReport(historical, input.gate, COMMIT).valid, false);
  assert.equal(validateZk682SupplementalStabilityReport(historical, input.gate, COMMIT, { allowLegacy: true }).valid, true);
});

const curve = () => saveSamples().map(sample => ({ ...sample, heap: { ...sample.heap, runtimeUsedBytes: 40_000_000 } }));
const evaluateCurve = samples => evaluateZk682Stability("save-load-resource-stability", samples);
for (const [name, mutate, expected] of [
  ["whole peak", samples => { samples[5].heap.runtimeUsedBytes += 8 * 1024 * 1024 + 1; }, /post-GC JS heap grew/],
  ["whole endpoint", samples => { for (const sample of samples.slice(1)) sample.heap.runtimeUsedBytes += 6 * 1024 * 1024 + 1; }, /post-GC JS heap ended/],
  ...[24, 36].flatMap(start => [
    [`window${start} endpoint`, samples => { for (const sample of samples.slice(start + 1)) sample.heap.runtimeUsedBytes += 524_289; }, new RegExp(`window ${start}-${start + 12} ended`)],
    [`window${start} slope`, samples => { samples[start + 10].heap.runtimeUsedBytes += 2_981_889; }, new RegExp(`window ${start}-${start + 12} slope`)],
  ]),
]) test(`schema3 independently rejects one-byte excess: ${name}`, () => {
  const samples = curve(); mutate(samples); const result = evaluateCurve(samples);
  assert.equal(result.passed, false); assert.match(result.errors.join("\n"), expected);
  assert.equal(result.errors.length, 1, `negative control must isolate ${name}`);
});

test("schema3 includes both window boundaries and accepts exact byte/slope limits", () => {
  const samples = curve(); for (const sample of samples.slice(1)) sample.heap.runtimeUsedBytes += 6 * 1024 * 1024;
  samples[5].heap.runtimeUsedBytes = samples[0].heap.runtimeUsedBytes + 8 * 1024 * 1024;
  assert.equal(evaluateCurve(samples).passed, true);
  for (const start of [24, 36]) {
    const slope = curve(); slope[start + 10].heap.runtimeUsedBytes += 2_981_888;
    const result = evaluateCurve(slope); assert.equal(result.passed, true); assert.equal(result.metrics.lateHeapWindows[start === 24 ? 0 : 1].slopePerSample, 65536);
    const endpoint = curve(); for (const sample of endpoint.slice(start + 1)) sample.heap.runtimeUsedBytes += 524_288;
    assert.equal(evaluateCurve(endpoint).passed, true);
  }
});

test("schema3 strictly validates 49 contiguous typed samples, all full resources, hash/state and heap", () => {
  const mutations = [samples => samples.pop(), samples => samples.push(structuredClone(samples.at(-1))), samples => { samples[2].cycle = 1; },
    samples => { samples[2].loaded = false; }, samples => { samples[2].slotId = "fake"; }, samples => { samples[2].courseHash = "cafef00d"; },
    samples => { for (const sample of samples) delete sample.courseHash; }, samples => { samples[2].state.cash += 1; }, samples => { for (const sample of samples) sample.state = {}; },
    samples => { samples[2].heap.runtimeUsedBytes = NaN; }, samples => { samples[2].heap.runtimeUsedBytes += .5; }, samples => { delete samples[2].heap.runtimeTotalBytes; },
    samples => { samples[2] = null; }, samples => { samples[2].untyped = true; }, samples => { samples[2].rendererQuality = "medium"; }];
  for (const key of Object.keys(resources)) mutations.push(samples => { delete samples[2].resources[key]; });
  for (const key of Object.keys(resources).filter(key => key !== "canvasConnected")) mutations.push(samples => { samples[2].resources[key] += 1; });
  for (const mutate of mutations) { const samples = curve(); mutate(samples); assert.equal(evaluateCurve(samples).passed, false); }
});

test("schema3 rechecks thresholds, console errors and every declared result from raw evidence", () => {
  const input = baseInput("save-load-resource-stability", curve()), report = createZk682StabilityReport(input);
  assert.throws(() => { const missing = { ...input }; delete missing.runtimeErrors; createZk682StabilityReport(missing); }, /runtimeErrors/);
  assert.equal(createZk682StabilityReport({ ...input, runtimeErrors: ["console.error: failure"] }).passed, false);
  for (const mutate of [r => { r.schemaVersion = 2; }, r => { delete r.runtimeErrors; }, r => { r.runtimeErrors = ["pageerror"]; }, r => { r.summary.lateHeapWindows[1].endGrowth++; },
    r => { r.summary.heap.endGrowth++; }, r => { r.observations.saveLoads = 12; }, r => { r.thresholds = { ...r.thresholds, lateHeap: { ...r.thresholds.lateHeap, maxEndGrowthBytes: 524289 } }; }, r => { r.passed = false; }, r => { r.candidateCommit = "b".repeat(40); }]) {
    const changed = structuredClone(report); mutate(changed); assert.equal(validateZk682SupplementalStabilityReport(changed, input.gate, COMMIT).valid, false);
  }
});

test("legacy first12 red is preserved and non-gating, with exact binding to the new run", () => {
  const samples = curve(); for (const sample of samples.slice(1)) sample.heap.runtimeUsedBytes += 4_500_000;
  const report = createZk682StabilityReport(baseInput("save-load-resource-stability", samples)); assert.equal(report.passed, true);
  const diagnostic = createZk682LegacySaveLoadDiagnostic(report); assert.equal(diagnostic.report.passed, false); assert.equal(diagnostic.productionGateAcceptance, false);
  assert.deepEqual(validateZk682LegacySaveLoadDiagnostic(diagnostic, report, COMMIT), []);
  assert.equal(validateZk682SupplementalStabilityReport(diagnostic.report, report.gate, COMMIT).valid, false);
  for (const mutate of [d => { d.diagnosticOnly = false; }, d => { d.productionGateAcceptance = true; }, d => { d.report.browser.version = "other-run"; }, d => { d.report.samples[5].heap.runtimeUsedBytes++; }, d => { d.report.passed = true; }, d => { d.report.producer.buildId = "bad"; }]) {
    const changed = structuredClone(diagnostic); mutate(changed); assert.notEqual(validateZk682LegacySaveLoadDiagnostic(changed, report, COMMIT).length, 0);
  }
});
