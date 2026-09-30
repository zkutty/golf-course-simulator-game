import assert from "node:assert/strict";
import test from "node:test";
import {
  ZK682_STABILITY_SCHEMA_VERSION,
  ZK682_STABILITY_THRESHOLDS,
  createZk682StabilityReport,
  evaluateZk682Stability,
} from "./zk682-stability-contract.mjs";

const COMMIT = "a".repeat(40);
const browser = { name: "chromium", version: "fixture", cdpHeap: true };
const resources = { displayObjects: 2000, attachedTextures: 80, attachedTextureSources: 20, managedTextureSources: 48, canvasConnected: true };
const measured = (index) => ({ resources: { ...resources }, heap: { runtimeUsedBytes: 40_000_000 + index * 20_000 } });
const baseInput = (gate, samples) => ({ candidateCommit: COMMIT, capturedAt: "2026-09-29T12:00:00.000Z", command: `fixture ${gate}`, browser, gate, thresholds: ZK682_STABILITY_THRESHOLDS[gate], samples });

function saveSamples(count = 12) {
  const state = { screen: "game", week: 2, cash: 42000, terrainVersion: 7 };
  return Array.from({ length: count + 1 }, (_, cycle) => ({ cycle, slotId: "quick-save", loaded: cycle > 0, courseHash: "deadbeef", state: { ...state }, ...measured(cycle) }));
}

function longSamples(count = 7) {
  return Array.from({ length: count }, (_, index) => ({ elapsedGameMinutes: index * 22.4, courseHash: "deadbeef", state: { dayMinute: 100 + index * 22.4, speed: "4x", onCourse: 12 }, ...measured(index) }));
}

function interactionSamples() {
  return [
    { scenario: "editing", passed: true, before: { terrainVersion: 7 }, after: { terrainVersion: 8, screen: "game" }, ...measured(0) },
    { scenario: "overlay", passed: true, before: { kind: null }, after: { kind: "recovery", visible: true }, ...measured(1) },
    { scenario: "sleep-wake", passed: true, before: { courseHash: "deadbeef" }, after: { courseHash: "deadbeef", lifecycle: "active", responsive: true }, ...measured(2) },
    { scenario: "recovery", passed: true, before: { savedTerrainVersion: 7, mutatedTerrainVersion: 8, savedCourseHash: "deadbeef" }, after: { terrainVersion: 7, courseHash: "deadbeef", quickSaveLoaded: true }, ...measured(3) },
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
  const heap = saveSamples(); heap.at(-1).heap.runtimeUsedBytes += 9 * 1024 * 1024;
  assert.match(evaluateZk682Stability("save-load-resource-stability", heap).errors.join("\n"), /post-GC JS heap/);
});

test("long-session evidence requires a real-duration monotonic active simulation", () => {
  const short = longSamples(5);
  assert.match(evaluateZk682Stability("long-session-resource-stability", short).errors.join("\n"), /at least 6/);
  const tooBrief = longSamples(); tooBrief.at(-1).elapsedGameMinutes = 119;
  assert.match(evaluateZk682Stability("long-session-resource-stability", tooBrief).errors.join("\n"), /minimum 120/);
  const paused = longSamples(); paused[3].state.speed = "paused";
  assert.match(evaluateZk682Stability("long-session-resource-stability", paused).errors.join("\n"), /active 4x clock/);
});

test("interaction evidence requires exact real outcomes for every scenario", () => {
  const missing = interactionSamples().slice(1);
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", missing).errors.join("\n"), /cover exactly/);
  const fakeEdit = interactionSamples(); fakeEdit[0].after.terrainVersion = 9;
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", fakeEdit).errors.join("\n"), /exactly one real terrain revision/);
  const fakeWake = interactionSamples(); fakeWake[2].after.responsive = false;
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", fakeWake).errors.join("\n"), /freeze\/active recovery/);
  const fakeRecovery = interactionSamples(); fakeRecovery[3].after.terrainVersion = 8;
  assert.match(evaluateZk682Stability("editing-overlay-sleep-recovery", fakeRecovery).errors.join("\n"), /pre-edit state/);
});

test("report creation rejects local identity and relaxed thresholds", () => {
  assert.throws(() => createZk682StabilityReport({ ...baseInput("save-load-resource-stability", saveSamples()), candidateCommit: "local" }), /full SHA/);
  assert.throws(() => createZk682StabilityReport({ ...baseInput("save-load-resource-stability", saveSamples()), thresholds: { ...ZK682_STABILITY_THRESHOLDS["save-load-resource-stability"], minimumSaveLoads: 1 } }), /immutable contract/);
});
