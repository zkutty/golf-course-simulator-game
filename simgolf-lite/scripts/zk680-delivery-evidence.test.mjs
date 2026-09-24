import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertNoUnexpectedEagerEntryImports,
  collectParklandHabitatAtlasEvidence,
  DELIVERY_BUDGETS,
  eagerEntryDynamicImports,
  evaluateDeliveryBudgets,
  HISTORICAL_DIST_BYTES_CAP,
  PARKLAND_HABITAT_ACCEPTED_ATLAS_BYTES,
  PARKLAND_HABITAT_ACCEPTED_CANDIDATE_DIST_BYTES,
  PARKLAND_HABITAT_ACCEPTED_RUNTIME_CONSUMER_BYTES,
  PARKLAND_HABITAT_ATLAS_BYTES_MAX,
  PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE,
} from "./zk680-delivery-evidence.mjs";

const habitatManifest = {
  budgets: { totalAtlasBytesMax: 100 },
  tiers: {
    high: { image: "high/habitat-atlas.png" },
    medium: { image: "medium/habitat-atlas.png" },
    low: { image: "low/habitat-atlas.png" },
  },
};

function withSyntheticHabitatDist(callback) {
  const directory = mkdtempSync(join(tmpdir(), "zk680-delivery-evidence-"));
  const manifest = {};
  try {
    for (const [tier, bytes] of [["high", 10], ["medium", 20], ["low", 30]]) {
      const source = `src/assets/terrain/parkland-habitat-4x/${tier}/habitat-atlas.png`;
      const file = `assets/${tier}.png`;
      mkdirSync(join(directory, "assets"), { recursive: true });
      writeFileSync(join(directory, file), Buffer.alloc(bytes));
      manifest[source] = { src: source, file };
    }
    return callback({ directory, manifest });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("entry audit rejects dynamic chunks requested during module evaluation", () => {
  assert.deepEqual(
    eagerEntryDynamicImports("const load = () => import('./lazy'); import('./eager')"),
    ["./eager"],
  );
  assert.throws(
    () => assertNoUnexpectedEagerEntryImports("import('./monitoring')"),
    /requests dynamic code during startup.*monitoring/,
  );
  assert.doesNotThrow(
    () => assertNoUnexpectedEagerEntryImports("const load = () => import('./monitoring')"),
  );
});

test("delivery report records before/after deltas and accepts values within the pinned budgets", () => {
  const baseline = {
    reference: { commit: "baseline", label: "before" },
    measurements: {
      initialJavaScriptBytes: 100,
      visionPageJavaScriptBytes: 200,
      initialCriticalTransferBytes: 300,
      maxSelectedBiomeBytes: 400,
      distBytes: 500,
      desktopPackageBytes: 600,
      desktopAsarBytes: 700,
    },
  };
  const report = evaluateDeliveryBudgets({
    initialJavaScriptBytes: 100,
    visionPageJavaScriptBytes: 200,
  }, baseline);
  assert.equal(report.ok, true);
  assert.equal(report.checks.initialJavaScriptBytes.deltaBytes, 0);
  assert.equal(report.checks.visionPageJavaScriptBytes.budget, DELIVERY_BUDGETS.visionPageJavaScriptBytes);
});

test("Parkland habitat accounting measures only the three Vite-manifest source records", () => {
  withSyntheticHabitatDist(({ directory, manifest }) => {
    const evidence = collectParklandHabitatAtlasEvidence(manifest, directory, habitatManifest);
    assert.equal(evidence.habitatAtlasBytes, 60);
    assert.equal(evidence.habitatAtlasBytesMax, 100);
    assert.deepEqual(evidence.habitatAtlasAssets.map(({ tier, bytes }) => [tier, bytes]), [["high", 10], ["medium", 20], ["low", 30]]);
  });
});

test("Parkland habitat accounting fails closed for missing, duplicate, and unattributed tier records", () => {
  withSyntheticHabitatDist(({ directory, manifest }) => {
    const missing = { ...manifest };
    delete missing["src/assets/terrain/parkland-habitat-4x/low/habitat-atlas.png"];
    assert.throws(() => collectParklandHabitatAtlasEvidence(missing, directory, habitatManifest), /low atlas.*found 0/);

    const duplicate = {
      ...manifest,
      "duplicate-high": { ...manifest["src/assets/terrain/parkland-habitat-4x/high/habitat-atlas.png"] },
    };
    assert.throws(() => collectParklandHabitatAtlasEvidence(duplicate, directory, habitatManifest), /high atlas.*found 2/);

    const unattributed = {
      ...manifest,
      "extra-atlas": {
        src: "src/assets/terrain/parkland-habitat-4x/experimental/habitat-atlas.png",
        file: "assets/extra.png",
      },
    };
    assert.throws(() => collectParklandHabitatAtlasEvidence(unattributed, directory, habitatManifest), /Unattributed/);
  });
});

test("Parkland habitat budgets pass exactly and fail at plus one without loosening legacy checks", () => {
  const baseline = {
    reference: { commit: "baseline", label: "before" },
    measurements: {
      initialJavaScriptBytes: 1,
      visionPageJavaScriptBytes: 1,
      initialCriticalTransferBytes: 1,
      maxSelectedBiomeBytes: 1,
      distBytes: DELIVERY_BUDGETS.historicalDistBytesCap,
      coldStartupMs: 1,
      fixtureLoadMs: 1,
    },
  };
  const habitatBudget = 100;
  const evidence = {
    initialJavaScriptBytes: 1,
    visionPageJavaScriptBytes: 1,
    initialCriticalTransferBytes: 1,
    maxSelectedBiomeBytes: 1,
    coldStartupMs: 1,
    fixtureLoadMs: 1,
    habitatAtlasBytes: habitatBudget,
    distBytesExcludingParklandHabitatAtlases: DELIVERY_BUDGETS.distBytesExcludingParklandHabitatAtlases,
    distBytes: DELIVERY_BUDGETS.historicalDistBytesCap + habitatBudget + DELIVERY_BUDGETS.parklandHabitatRuntimeConsumerAllowance,
  };
  const report = evaluateDeliveryBudgets(evidence, baseline, habitatBudget);
  assert.equal(report.ok, true);
  assert.equal(report.parklandHabitatAccounting.distBytes.actual - report.parklandHabitatAccounting.habitatAtlasBytes.actual, report.parklandHabitatAccounting.distBytesExcludingParklandHabitatAtlases.actual);
  assert.equal(report.parklandHabitatAccounting.runtimeConsumerDeltaFromPreI1, evidence.distBytes - report.parklandHabitatAccounting.preI1DistBytes - evidence.habitatAtlasBytes);
  assert.equal(report.budgets.historicalDistBytesCap, 116976011);

  for (const [name, value] of [
    ["habitatAtlasBytes", habitatBudget + 1],
    ["distBytesExcludingParklandHabitatAtlases", evidence.distBytesExcludingParklandHabitatAtlases + 1],
    ["distBytes", evidence.distBytes + 1],
  ]) {
    const failed = evaluateDeliveryBudgets({ ...evidence, [name]: value }, baseline, habitatBudget);
    assert.equal(failed.ok, false, `${name} must fail at +1`);
    assert.match(failed.errors[0], new RegExp(name));
  }
  assert.equal(report.checks.initialJavaScriptBytes.budget, DELIVERY_BUDGETS.initialJavaScriptBytes);
  assert.equal(DELIVERY_BUDGETS.initialJavaScriptBytes, 1608719);
  assert.equal(DELIVERY_BUDGETS.visionPageJavaScriptBytes, 32 * 1024);
  assert.equal(DELIVERY_BUDGETS.initialCriticalTransferBytes, 4 * 1024 * 1024);
  assert.equal(report.checks.maxSelectedBiomeBytes.budget, DELIVERY_BUDGETS.maxSelectedBiomeBytes);
  assert.equal(DELIVERY_BUDGETS.maxSelectedBiomeBytes, 6 * 1024 * 1024);
  assert.equal(report.checks.coldStartupMs.budget, DELIVERY_BUDGETS.coldStartupMs);
  assert.equal(DELIVERY_BUDGETS.coldStartupMs, 5000);
  assert.equal(report.checks.fixtureLoadMs.budget, DELIVERY_BUDGETS.fixtureLoadMs);
  assert.equal(DELIVERY_BUDGETS.fixtureLoadMs, 6000);
  assert.equal(DELIVERY_BUDGETS.desktopPackageBytes, 495074219 + 4 * 1024 * 1024);
  assert.equal(DELIVERY_BUDGETS.desktopAsarBytes, 206569606 + 2 * 1024 * 1024);
});

test("accepted I1 delivery arithmetic remains exact", () => {
  const preI1DistBytes = 116935271;
  const candidateDistBytes = PARKLAND_HABITAT_ACCEPTED_CANDIDATE_DIST_BYTES;
  const habitatAtlasBytes = PARKLAND_HABITAT_ACCEPTED_ATLAS_BYTES;
  assert.equal(HISTORICAL_DIST_BYTES_CAP - preI1DistBytes, 40740);
  assert.equal(candidateDistBytes - preI1DistBytes, 535348);
  assert.equal(candidateDistBytes - preI1DistBytes - habitatAtlasBytes, PARKLAND_HABITAT_ACCEPTED_RUNTIME_CONSUMER_BYTES);
  assert.equal(PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE - PARKLAND_HABITAT_ACCEPTED_RUNTIME_CONSUMER_BYTES, 24122);
  assert.equal(candidateDistBytes, preI1DistBytes + habitatAtlasBytes + PARKLAND_HABITAT_ACCEPTED_RUNTIME_CONSUMER_BYTES);
  assert.equal(HISTORICAL_DIST_BYTES_CAP + PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE, 117172619);
  assert.equal(HISTORICAL_DIST_BYTES_CAP + PARKLAND_HABITAT_ATLAS_BYTES_MAX + PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE, 121366923);
});

test("delivery report rejects inconsistent total, excluded, and atlas measurements", () => {
  const baseline = { reference: {}, measurements: { distBytes: 0 } };
  const report = evaluateDeliveryBudgets({
    habitatAtlasBytes: 2,
    distBytesExcludingParklandHabitatAtlases: 3,
    distBytes: 6,
  }, baseline, 10);
  assert.equal(report.ok, false);
  assert.match(report.errors.at(-1), /distBytes must equal distBytesExcludingParklandHabitatAtlases \+ habitatAtlasBytes/);
});

test("delivery report rejects a web bundle above its agreed budget", () => {
  const baseline = {
    reference: { commit: "baseline", label: "before" },
    measurements: { initialJavaScriptBytes: 1 },
  };
  const report = evaluateDeliveryBudgets({
    initialJavaScriptBytes: DELIVERY_BUDGETS.initialJavaScriptBytes + 1,
  }, baseline);
  assert.equal(report.ok, false);
  assert.match(report.errors[0], /initialJavaScriptBytes/);
});
