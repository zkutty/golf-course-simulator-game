import assert from "node:assert/strict";
import test from "node:test";
import {
  ZK682_RESOURCE_GROWTH_SCHEMA_VERSION,
  ZK682_RESOURCE_GROWTH_THRESHOLDS,
  createZk682ResourceGrowthReport,
  evaluateZk682ResourceGrowth,
} from "./zk682-resource-growth-contract.mjs";

const residency = {
  baseBundles: ["desert:high", "links:medium", "parkland:low"],
  seasonalOverlays: [],
  seasonalFrameMaps: [],
  materialFields: 20,
  pathMaterialFields: 4,
  seasonalMaterialFields: 0,
  parklandComposableFields: 8,
};

function sample(cycle, overrides = {}) {
  return {
    cycle,
    resources: {
      displayObjects: 2_000,
      containers: 2_000,
      sprites: 1_400,
      graphics: 300,
      meshes: 12,
      text: 2,
      attachedTextures: 80,
      attachedTextureSources: 20,
      managedTextureSources: 48,
      canvasConnected: true,
      ...overrides.resources,
    },
    heap: { runtimeUsedBytes: 40_000_000 + cycle * 20_000, ...overrides.heap },
    atlasResidency: overrides.atlasResidency ?? structuredClone(residency),
  };
}

test("accepts bounded post-warmup renderer and heap metrics", () => {
  const samples = Array.from({ length: 6 }, (_, index) => sample(index + 1));
  const result = evaluateZk682ResourceGrowth(samples);
  assert.equal(result.passed, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.displayObjects.maxGrowth, 0);
  assert.equal(result.metrics.heap.slopePerCycle, 20_000);
});

test("allows bounded theme footprints but requires repeated states to remain stable", () => {
  const states = [
    ["links", "low", 56],
    ["desert", "medium", 62],
    ["parkland", "high", 48],
    ["links", "low", 55],
    ["desert", "medium", 61],
    ["parkland", "high", 48],
  ];
  const samples = [sample(0), ...states.map(([theme, quality, managedTextureSources], index) => ({
    ...sample(index + 1, { resources: { managedTextureSources } }),
    exercised: { theme, quality },
  }))];
  const result = evaluateZk682ResourceGrowth(samples);
  assert.equal(result.passed, true);
  assert.equal(result.metrics.managedTextureSources.maxGrowth, 14);
  assert.equal(result.metrics.managedTextureSources.repeatedStateMaxGrowth, 0);
});

test("rejects renderer-managed texture accumulation when the same state recurs", () => {
  const states = [
    ["links", "low", 50],
    ["desert", "medium", 52],
    ["parkland", "high", 48],
    ["links", "low", 53],
    ["desert", "medium", 55],
    ["parkland", "high", 51],
  ];
  const samples = states.map(([theme, quality, managedTextureSources], index) => ({
    ...sample(index + 1, { resources: { managedTextureSources } }),
    exercised: { theme, quality },
  }));
  const result = evaluateZk682ResourceGrowth(samples);
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /managedTextureSources repeated-state growth was 3/);
});

test("rejects linear display-object growth", () => {
  const samples = Array.from({ length: 6 }, (_, index) => sample(index + 1, {
    resources: { displayObjects: 2_000 + index },
  }));
  const result = evaluateZk682ResourceGrowth(samples);
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /displayObjects grew 5/);
});

test("fails closed when browser heap diagnostics are missing", () => {
  const samples = Array.from({ length: 6 }, (_, index) => sample(index + 1));
  samples[3].heap.runtimeUsedBytes = null;
  const result = evaluateZk682ResourceGrowth(samples);
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /missing real Chromium heap diagnostics/);
});

test("rejects atlas residency growth after warmup", () => {
  const samples = Array.from({ length: 6 }, (_, index) => sample(index + 1));
  samples[5].atlasResidency.baseBundles.push("links:high");
  const result = evaluateZk682ResourceGrowth(samples);
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /atlas residency changed/);
});

test("builds a versioned aggregation-ready report", () => {
  const samples = Array.from({ length: 6 }, (_, index) => sample(index + 1));
  const report = createZk682ResourceGrowthReport({
    source: { commit: "abc123", mode: "e2e" },
    browser: { name: "chromium", version: "test" },
    thresholds: ZK682_RESOURCE_GROWTH_THRESHOLDS,
    warmup: { baseBundles: residency.baseBundles },
    samples,
  });
  assert.equal(report.schemaVersion, ZK682_RESOURCE_GROWTH_SCHEMA_VERSION);
  assert.equal(report.gate, "renderer-resource-growth");
  assert.equal(report.passed, true);
});
