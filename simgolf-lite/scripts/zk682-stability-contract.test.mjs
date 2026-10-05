import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ZK682_STABILITY_SCHEMA_VERSION,
  ZK682_STABILITY_THRESHOLDS,
  createZk682StabilityReport,
  evaluateZk682Stability,
  createZk682ConservationStabilityReport,
  evaluateZk682ConservationStability,
  validateZk682SupplementalStabilityReport,
  writeZk682ConservationStabilityReport,
} from "./zk682-stability-contract.mjs";

const COMMIT = "a".repeat(40);
const browser = { name: "chromium", version: "fixture", cdpHeap: true };
const resources = { displayObjects: 2000, attachedTextures: 80, attachedTextureSources: 20, managedTextureSources: 48, canvasConnected: true };
const measured = (index) => ({ rendererQuality: "high", resources: { ...resources }, heap: { runtimeUsedBytes: 40_000_000 + index * 20_000 } });
const baseInput = (gate, samples) => ({ candidateCommit: COMMIT, capturedAt: "2026-09-29T12:00:00.000Z", command: `fixture ${gate}`, browser, gate, thresholds: ZK682_STABILITY_THRESHOLDS[gate], samples });

function saveSamples(count = 12) {
  const state = { screen: "game", week: 2, cash: 42000, terrainVersion: 7 };
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
    assert.equal(report.schemaVersion, ZK682_STABILITY_SCHEMA_VERSION);
    assert.equal(report.candidateCommit, COMMIT);
    assert.equal(report.passed, true, report.errors.join("\n"));
  }
});

test("save-load evidence fails closed on short runs, drift, and heap growth", () => {
  assert.match(evaluateZk682Stability("save-load-resource-stability", saveSamples(2)).errors.join("\n"), /at least 12/);
  const drift = saveSamples(); drift[8].state.cash += 1;
  assert.match(evaluateZk682Stability("save-load-resource-stability", drift).errors.join("\n"), /canonical projection/);
  const topologyShift = saveSamples();
  for (const sample of topologyShift.slice(8)) {
    sample.rendererQuality = "low";
    sample.resources.attachedTextureSources += 2;
  }
  assert.equal(evaluateZk682Stability("save-load-resource-stability", topologyShift).passed, true);
  topologyShift.at(-1).resources.attachedTextureSources += 2;
  assert.match(evaluateZk682Stability("save-load-resource-stability", topologyShift).errors.join("\n"), /within one renderer topology/);
  const missingQuality = saveSamples(); delete missingQuality[0].rendererQuality;
  assert.match(evaluateZk682Stability("save-load-resource-stability", missingQuality).errors.join("\n"), /renderer topology identity/);
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

const emptyOwnership = () => ({ schemaVersion: 1, complete: true, failure: null, generation: 1, stageUID: 1, overlayUID: 2,
  currentOwner: true, apiIdentityCurrent: true, ownerCount: 0, scheduler: [], groups: [], contribution: { displayObjects: 0, graphics: 0, text: 0 } });
function withEmotes(sample, count = 0) {
  const m = emptyOwnership();
  for (let i = 0; i < count; i++) {
    const uid = 100 + i * 4;
    m.scheduler.push({ golferId: i, kind: "cashBad" });
    m.groups.push({ golferId: i, builtKind: "cashBad", schedulerKind: "cashBad", uid, className: "Container", destroyed: false, parentIsCurrentOverlay: true,
      children: ["Graphics", "Text", "Graphics"].map((className, j) => ({ uid: uid + j + 1, className, destroyed: false, parentIsGroup: true, childCount: 0, text: className === "Text" ? "$" : null })) });
  }
  m.ownerCount = count; m.contribution = { displayObjects: count * 4, graphics: count * 2, text: count };
  sample.resources.emoteOwnership = m;
  sample.resources.graphics = 100 + count * 2;
  sample.resources.text = count;
  sample.resources.displayObjects += count * 4;
  return sample;
}
const v3Samples = () => saveSamples().map((s, i) => withEmotes(s, i >= 6 ? 5 : 0));

test("v3 conserves the first quality baseline and preserves the raw legacy +20 failure", () => {
  const samples = v3Samples();
  const report = createZk682ConservationStabilityReport(baseInput("save-load-resource-stability", samples));
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.passed, true, report.errors.join("\n"));
  assert.equal(report.summary.displayObjects.residual.maxGrowth, 0);
  assert.equal(report.legacyRawComparison.passed, false);
  assert.equal(report.summary.displayObjects.raw.maxGrowth, 20);
  assert.deepEqual(report.samples, samples);
  assert.equal(validateZk682SupplementalStabilityReport(report, report.gate, COMMIT).valid, true);
  for (const start of [6, 12]) {
    const leaking = v3Samples();
    for (const sample of leaking.slice(start)) sample.resources.displayObjects += 3;
    const result = evaluateZk682ConservationStability("save-load-resource-stability", leaking);
    assert.equal(result.passed, false);
    assert.match(result.errors.join("\n"), /unexplained displayObjects grew 3/);
  }
});

test("v3 uses quality rather than occupancy, UID or generation as its conserved baseline", () => {
  const samples = v3Samples();
  for (let i = 5; i < samples.length; i++) samples[i].rendererQuality = "medium";
  for (const [i, sample] of samples.entries()) sample.resources.emoteOwnership.generation = i + 1;
  const result = evaluateZk682ConservationStability("save-load-resource-stability", samples);
  assert.equal(result.passed, true);
  assert.deepEqual(result.metrics.displayObjects.measuredBoundariesByQuality, { high: 5, medium: 8 });
  assert.equal(result.metrics.displayObjects.samples[6].baselineIndex, 5);
  assert.equal(result.metrics.displayObjects.samples[6].observedChange, 20);
  assert.equal(result.metrics.displayObjects.samples[6].explainedEmoteChange, 20);
});

test("v3 refuses missing, inconsistent, stale, extra and unbounded emote metadata", () => {
  const mutations = [
    (s) => { delete s.resources.emoteOwnership; },
    (s) => { s.resources.emoteOwnership = null; },
    (s) => { s.resources.emoteOwnership.complete = false; },
    (s) => { s.resources.emoteOwnership.currentOwner = false; },
    (s) => { s.resources.emoteOwnership.apiIdentityCurrent = false; },
    (s) => { s.resources.emoteOwnership.groups[0].builtKind = null; },
    (s) => { delete s.resources.emoteOwnership.groups[0].builtKind; },
    (s) => { s.resources.emoteOwnership.groups[0].schedulerKind = "alert"; },
    (s) => { s.resources.emoteOwnership.scheduler[0].golferId = 99; },
    (s) => { s.resources.emoteOwnership.groups[0].parentIsCurrentOverlay = false; },
    (s) => { s.resources.emoteOwnership.groups[0].destroyed = true; },
    (s) => { s.resources.emoteOwnership.groups[1].golferId = 0; },
    (s) => { s.resources.emoteOwnership.groups[1].uid = 100; },
    (s) => { s.resources.emoteOwnership.groups[0].children[0].uid = 100; },
    (s) => { s.resources.emoteOwnership.groups[0].children[0].parentIsGroup = false; },
    (s) => { s.resources.emoteOwnership.groups[0].children[0].childCount = 1; },
    (s) => { s.resources.emoteOwnership.groups[0].children[1].text = "?"; },
    (s) => { s.resources.emoteOwnership.groups[0].children.push({}); },
    (s) => { s.resources.emoteOwnership.groups.push({}); },
    (s) => { s.resources.emoteOwnership.contribution.displayObjects = 23; },
    (s) => { s.resources.emoteOwnership.stageUID = s.resources.emoteOwnership.overlayUID; },
  ];
  for (const mutate of mutations) {
    const samples = v3Samples(); mutate(samples[6]);
    const result = evaluateZk682ConservationStability("save-load-resource-stability", samples);
    assert.equal(result.passed, false);
    assert.match(result.errors.join("\n"), /sample 6:/);
  }
});

test("v3 requires three actual report boundaries per observed quality; polls cannot pad rows", () => {
  for (const count of [1, 2]) {
    const samples = v3Samples();
    for (const s of samples.slice(-count)) { s.rendererQuality = "low"; s.readinessPolls = [{}, {}, {}]; }
    assert.match(evaluateZk682ConservationStability("save-load-resource-stability", samples).errors.join("\n"), /at least 3 required/);
  }
});

test("the witnessed 13-boundary counts explain current +20 but retain the exact whole-heap failure", () => {
  // Actual witnessed scalar inputs; metadata is a constructed admission fixture,
  // not a migration of the old witness or a new runtime ownership certificate.
  const heaps = [69837472,71494272,71794608,72596256,73425160,70974736,71556752,72559068,73179208,73702356,74099656,74607280,75046636];
  const samples = v3Samples();
  for (const [i, s] of samples.entries()) {
    s.rendererQuality = i < 5 ? "high" : "medium";
    s.resources.displayObjects = i < 5 ? 14669 : i === 5 ? 13963 : 13983;
    s.resources.graphics = i < 5 ? 1645 : i === 5 ? 1624 : 1634;
    s.heap.runtimeUsedBytes = heaps[i];
  }
  const report = createZk682ConservationStabilityReport(baseInput("save-load-resource-stability", samples));
  assert.equal(report.passed, false);
  assert.equal(report.summary.displayObjects.residual.maxGrowth, 0);
  assert.equal(report.summary.heap.endGrowth, 5209164);
  assert.deepEqual(report.summary.heap, report.legacyRawComparison.summary.heap);
  assert.match(report.errors.join("\n"), /post-GC JS heap ended 5209164.*4194304/);
  assert.equal(validateZk682SupplementalStabilityReport(report, report.gate, COMMIT).valid, false);
});

test("v3 replay rejects forged conservation/legacy summaries and retains non-display ceilings", () => {
  const report = createZk682ConservationStabilityReport(baseInput("save-load-resource-stability", v3Samples()));
  for (const mutate of [
    (r) => { r.summary.displayObjects.residual.maxGrowth = -1; },
    (r) => { r.legacyRawComparison.passed = true; },
    (r) => { r.samples.at(-1).resources.emoteOwnership.contribution.displayObjects = 21; },
  ]) {
    const changed = structuredClone(report); mutate(changed);
    assert.equal(validateZk682SupplementalStabilityReport(changed, changed.gate, COMMIT).valid, false);
  }
  const textures = v3Samples(); textures.at(-1).resources.attachedTextures += 3;
  assert.match(evaluateZk682ConservationStability("save-load-resource-stability", textures).errors.join("\n"), /attachedTextures grew 3/);
});

test("schema 2 creation and replay remain explicit and do not infer absent metadata as v3", () => {
  const legacy = createZk682StabilityReport(baseInput("save-load-resource-stability", saveSamples()));
  assert.equal(legacy.schemaVersion, 2);
  assert.equal(validateZk682SupplementalStabilityReport(legacy, legacy.gate, COMMIT).valid, true);
  const mislabeled = { ...legacy, schemaVersion: 3, legacyRawComparison: {} };
  assert.equal(validateZk682SupplementalStabilityReport(mislabeled, legacy.gate, COMMIT).valid, false);
});


test("schema-3 writes refuse an existing v2 artifact without changing its bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "zk682-v3-exclusive-"));
  const path = join(root, "save-load-resource-stability.json");
  const legacy = createZk682StabilityReport(baseInput("save-load-resource-stability", saveSamples()));
  const original = Buffer.from(`${JSON.stringify(legacy)}\n`);
  try {
    await writeFile(path, original);
    const next = createZk682ConservationStabilityReport(baseInput("save-load-resource-stability", v3Samples()));
    await assert.rejects(writeZk682ConservationStabilityReport(path, next), { code: "EEXIST" });
    assert.deepEqual(await readFile(path), original);
    const fresh = join(root, "fresh.json");
    await writeZk682ConservationStabilityReport(fresh, next);
    assert.deepEqual(JSON.parse(await readFile(fresh, "utf8")), next);
    await assert.rejects(writeZk682ConservationStabilityReport(join(root, "legacy.json"), legacy), /schema 3 only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
