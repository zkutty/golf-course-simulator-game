import assert from "node:assert/strict";
import test from "node:test";
import {
  ZK682_RESOURCE_GROWTH_SCHEMA_VERSION,
  ZK682_RESOURCE_GROWTH_THRESHOLDS,
  ZK682_MATCHED_WARMUP_PROTOCOL,
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
    source: { commit: "a".repeat(40), mode: "e2e" },
    capturedAt: "2026-09-29T12:00:00.000Z",
    command: "fixture resource growth",
    browser: { name: "chromium", version: "test", cdpHeap: true },
    thresholds: ZK682_RESOURCE_GROWTH_THRESHOLDS,
    warmup: { baseBundles: residency.baseBundles },
    samples,
  });
  assert.equal(report.schemaVersion, ZK682_RESOURCE_GROWTH_SCHEMA_VERSION);
  assert.equal(report.gate, "renderer-resource-growth");
  assert.equal(report.passed, true);
});

test("rejects local and abbreviated source identities", () => {
  const samples = Array.from({ length: 6 }, (_, index) => sample(index + 1));
  for (const commit of ["local", "abc123"]) {
    assert.throws(() => createZk682ResourceGrowthReport({
      source: { commit, mode: "e2e" },
      capturedAt: "2026-09-29T12:00:00.000Z",
      command: "fixture resource growth",
      browser: { name: "chromium", version: "test", cdpHeap: true },
      thresholds: ZK682_RESOURCE_GROWTH_THRESHOLDS,
      warmup: { baseBundles: residency.baseBundles },
      samples,
    }), /full candidate SHA/);
  }
});

function matchedWarmupInput() {
  const baseBundles = ["desert:high", "desert:low", "desert:medium", "links:high", "links:low", "links:medium", "parkland:high", "parkland:low", "parkland:medium"];
  const fixture = { width: 220, height: 140, holesOpen: 9, quality: "high", speed: "paused", screen: "game" };
  return {
    source: { commit: "a".repeat(40), mode: "e2e" }, capturedAt: "2026-10-07T12:00:00.000Z",
    command: "canonical matched-course warmup", browser: { name: "chromium", version: "test", cdpHeap: true },
    thresholds: ZK682_RESOURCE_GROWTH_THRESHOLDS,
    warmup: { protocol: ZK682_MATCHED_WARMUP_PROTOCOL, transitions: 9, routeTeardowns: 2, rotations: 1, baseBundles,
      states: ["parkland", "links", "desert"].flatMap((theme) => ["low", "medium", "high"].map((quality) => ({ theme, quality }))),
      fixture, seed: { value: 424242, qualification: "source-bound-e2e-quick-start" } },
    samples: Array.from({ length: 7 }, (_, cycle) => ({ ...sample(cycle), state: { ...fixture, theme: "parkland" } })),
  };
}

test("accepts declared matched-course warmup without changing numerical evaluation", () => {
  const input = matchedWarmupInput();
  const report = createZk682ResourceGrowthReport(input);
  assert.equal(report.passed, true);
  assert.equal(report.warmup.protocol, ZK682_MATCHED_WARMUP_PROTOCOL);
  assert.deepEqual(report.summary, evaluateZk682ResourceGrowth(input.samples).metrics);
});

test("rejects unsupported matched warmup protocols, counts, and configurations", () => {
  const mutations = [
    (input) => { input.warmup.protocol = "unknown"; },
    (input) => { input.warmup.protocol = null; },
    (input) => { input.warmup.transitions = 8; },
    (input) => { input.warmup.routeTeardowns = 1; },
    (input) => { input.warmup.rotations = 2; },
    (input) => { input.warmup.states[0].quality = "high"; },
    (input) => { input.warmup.baseBundles.pop(); },
    (input) => { input.samples.pop(); },
    (input) => { input.samples[3].cycle = 0; },
  ];
  for (const mutate of mutations) {
    const input = matchedWarmupInput(); mutate(input);
    assert.throws(() => createZk682ResourceGrowthReport(input), /warmup|checkpoint/);
  }
});

test("rejects mismatched warmup geometry, paused state, and seed qualification", () => {
  for (const [key, value] of [["width", 64], ["height", 64], ["holesOpen", 3], ["quality", "low"], ["speed", "1x"], ["screen", "menu"]]) {
    const input = matchedWarmupInput(); input.warmup.fixture[key] = value;
    assert.throws(() => createZk682ResourceGrowthReport(input), /observed fixture/);
  }
  for (const seed of [{ value: 2, qualification: "source-bound-e2e-quick-start" }, { value: 424242, qualification: "runtime-observed" }]) {
    const input = matchedWarmupInput(); input.warmup.seed = seed;
    assert.throws(() => createZk682ResourceGrowthReport(input), /seed qualification/);
  }
  const input = matchedWarmupInput(); input.samples[3].state.width = 64;
  assert.throws(() => createZk682ResourceGrowthReport(input), /measured checkpoint/);
});

test("retains legacy warmup reports without assigning the matched protocol", () => {
  const input = matchedWarmupInput(); input.warmup = { baseBundles: residency.baseBundles, transitions: 9, routeTeardowns: 1 };
  input.samples = Array.from({ length: 6 }, (_, cycle) => sample(cycle));
  const report = createZk682ResourceGrowthReport(input);
  assert.deepEqual(report.warmup, input.warmup);
  assert.equal(Object.hasOwn(report.warmup, "protocol"), false);
  assert.equal(report.schemaVersion, 1);
});
