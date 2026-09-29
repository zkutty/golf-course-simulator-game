import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  ZK682_CERTIFICATION_ID,
  ZK682_CRITERIA,
  ZK682_GATE_CONTRACTS,
  ZK682_SCHEMA_VERSION,
  buildZk682Report,
  sha256,
  validateZk682EvidenceManifest,
  zk682ReportMarkdown,
} from "./zk682-certification-contract.mjs";

const COMMIT = "1".repeat(40);
const LOCK = Buffer.from("lockfile fixture\n");

function write(root, path, value) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(absolute, bytes);
  return { path, sha256: sha256(bytes) };
}

function criterion(id, status = "pass") {
  return { id, status, summary: `${id} ${status}` };
}

function observations(gateId, lockSha, rawArtifacts) {
  if (gateId === "provenance") return {
    dependencyLockSha256: lockSha,
    buildArtifacts: [
      { kind: "browser-build", ...rawArtifacts[0] },
      { kind: "packaged-electron", ...rawArtifacts[1] },
    ],
  };
  if (gateId === "core-compatibility") return { productionBuildPassed: true, unitTestsPassed: true, deterministicHashesPassed: true, reducerPassed: true, saveV25RoundTripPassed: true, historicalMigrationsPassed: true, platformServicesPassed: true };
  if (gateId === "browser-pwa") return { browserPassed: true, goldenE2ePassed: true, offlineLaunchPassed: true, browsers: ["chromium", "firefox", "webkit"] };
  if (gateId === "packaged-desktop") return { packagedElectronPassed: true, desktopPersistencePassed: true, platforms: ["darwin", "win32"] };
  if (gateId === "asset-delivery") return { initialCriticalBytes: 7_000_000, selectedBiomeMaxBytes: 5_000_000, individualAtlasMaxBytes: 7_000_000, unselectedBiomeAtlasesUnloaded: true, packageSizeAndAssetAuditPassed: true };
  if (gateId === "headless-performance") return { physicalDevice: false, frameP95Asserted: false, frameP95Ms: 100, rendererWorkMs: 0.68, coldStartupMs: 1_160, coldStartupBudgetMs: 5_000, fixtureLoadMs: 4_030, fixtureLoadBudgetMs: 300_000, scenario: { holes: 36, golfers: 100, biome: "parkland", season: "summer", weather: "storm" } };
  if (gateId === "stability") return { routeChangesStable: true, saveLoadsStable: true, longSessionStable: true, interactionRecoveryPassed: true, routeChanges: 20, saveLoads: 20, sessionMinutes: 120 };
  if (gateId === "physical-midrange") return { physicalDevice: true, hardwareClass: "midrange", device: "Fixture GPU", operatingSystem: "Fixture OS", powerMode: "plugged-in", graphicsBackend: "WebGL2", frameP95Ms: 19, scenario: { holes: 36, golfers: 100, biome: "parkland", season: "summer", weather: "storm" } };
  return { physicalDevice: true, hardwareClass: "low-end", device: "Fixture iGPU", operatingSystem: "Fixture OS", powerMode: "battery", graphicsBackend: "WebGL2", frameP95Ms: 32, scenario: { holes: 36, golfers: 100, biome: "parkland", season: "summer", weather: "storm" } };
}

function fixture({ physical = false, lowEndP95 = 32, adjustment = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "zk682-contract-"));
  const lockSha = sha256(LOCK);
  const descriptors = [];
  const gateIds = Object.entries(ZK682_GATE_CONTRACTS)
    .filter(([, contract]) => contract.required || physical)
    .map(([gateId]) => gateId);
  for (const gateId of gateIds) {
    const rawArtifacts = gateId === "provenance"
      ? [
          write(root, "raw/browser-build.txt", "browser build fixture\n"),
          write(root, "raw/packaged-electron.txt", "packaged Electron fixture\n"),
        ]
      : [write(root, `raw/${gateId}.txt`, `${gateId} raw evidence\n`)];
    const criteria = ZK682_CRITERIA.filter((entry) => entry.gate === gateId).map((entry) => criterion(entry.id, entry.requirement === "report-only" ? "report-only" : "pass"));
    const observed = observations(gateId, lockSha, rawArtifacts);
    if (gateId === "physical-lowend") observed.frameP95Ms = lowEndP95;
    const result = {
      schemaVersion: ZK682_SCHEMA_VERSION,
      certificationId: ZK682_CERTIFICATION_ID,
      gateId,
      candidateCommit: COMMIT,
      classification: ZK682_GATE_CONTRACTS[gateId].classification,
      status: "pass",
      command: `fixture ${gateId}`,
      environment: { fixture: true },
      criteria,
      observations: observed,
      artifacts: rawArtifacts,
    };
    descriptors.push({ gateId, ...write(root, `gates/${gateId}.json`, result) });
  }
  const exceptions = adjustment ? [{
    criterionId: "low-end-physical-p95",
    evidence: "Approved minimum-spec adjustment fixture.",
    playerImpact: "Players below the revised floor may receive reduced quality.",
    owner: "Release owner",
    followUpIssue: "ZK-405",
    approvedMinimumSpecAdjustment: true,
  }] : [];
  const manifest = {
    schemaVersion: ZK682_SCHEMA_VERSION,
    certificationId: ZK682_CERTIFICATION_ID,
    candidateCommit: COMMIT,
    dependencyLock: { path: "package-lock.json", sha256: lockSha },
    gateResults: descriptors,
    exceptions,
  };
  return {
    root,
    manifest,
    options: { root, expectedCommit: COMMIT, commitExists: () => true, readCandidateFile: () => LOCK },
  };
}

function cleanup(value) { rmSync(value.root, { recursive: true, force: true }); }

test("valid machine evidence produces HOLD when physical evidence is missing and headless p95 stays report-only", () => {
  const value = fixture();
  try {
    const report = buildZk682Report(value.manifest, value.options);
    assert.equal(report.decision, "HOLD");
    assert.equal(report.machinePassed, true);
    assert.equal(report.physicalPassed, false);
    assert.deepEqual(report.blockers.map((entry) => entry.criterionId), ["midrange-physical-p95", "low-end-physical-p95"]);
    assert.equal(report.criteria.find((entry) => entry.id === "headless-frame-p95-report-only").status, "report-only");
    assert.match(zk682ReportMarkdown(report), /\*\*Decision: HOLD\*\*/);
  } finally { cleanup(value); }
});

test("complete physical evidence can produce GO while a 100 ms headless p95 remains report-only", () => {
  const value = fixture({ physical: true });
  try {
    const report = buildZk682Report(value.manifest, value.options);
    assert.equal(report.decision, "GO");
    assert.equal(report.physicalPassed, true);
    assert.equal(report.gateResults.find((entry) => entry.gateId === "headless-performance").observations.frameP95Ms, 100);
  } finally { cleanup(value); }
});

test("low-end evidence over 33 ms cannot pass without an explicit approved adjustment", () => {
  const unapproved = fixture({ physical: true, lowEndP95: 40 });
  try {
    const report = buildZk682Report(unapproved.manifest, unapproved.options);
    assert.equal(report.decision, "HOLD");
    assert.equal(report.criteria.find((entry) => entry.id === "low-end-physical-p95").status, "fail");
  } finally { cleanup(unapproved); }
  const approved = fixture({ physical: true, lowEndP95: 40, adjustment: true });
  try {
    const report = buildZk682Report(approved.manifest, approved.options);
    assert.equal(report.decision, "GO");
    assert.equal(report.criteria.find((entry) => entry.id === "low-end-physical-p95").approvedMinimumSpecAdjustment.followUpIssue, "ZK-405");
  } finally { cleanup(approved); }
});

test("wrong commits, stale gate hashes, missing raw artifacts, and missing machine gates are rejected", () => {
  const wrong = fixture();
  try {
    wrong.manifest.candidateCommit = "2".repeat(40);
    assert(validateZk682EvidenceManifest(wrong.manifest, wrong.options).errors.some((error) => error.includes("does not match expected commit")));
  } finally { cleanup(wrong); }

  const stale = fixture();
  try {
    stale.manifest.gateResults[0].sha256 = "0".repeat(64);
    assert(validateZk682EvidenceManifest(stale.manifest, stale.options).errors.some((error) => error.includes("gate result SHA-256 mismatch")));
  } finally { cleanup(stale); }

  const missing = fixture();
  try {
    const gatePath = join(missing.root, missing.manifest.gateResults[0].path);
    const gate = JSON.parse(readFileSync(gatePath, "utf8"));
    rmSync(join(missing.root, gate.artifacts[0].path));
    assert(validateZk682EvidenceManifest(missing.manifest, missing.options).errors.some((error) => error.includes("missing raw artifact")));
  } finally { cleanup(missing); }

  const incomplete = fixture();
  try {
    incomplete.manifest.gateResults = incomplete.manifest.gateResults.filter((entry) => entry.gateId !== "stability");
    assert(validateZk682EvidenceManifest(incomplete.manifest, incomplete.options).errors.some((error) => error === "missing required machine gate result: stability"));
  } finally { cleanup(incomplete); }
});

test("candidate lockfile drift and incomplete exception metadata are rejected", () => {
  const value = fixture();
  try {
    const drifted = { ...value.options, readCandidateFile: () => Buffer.from("different lock\n") };
    assert(validateZk682EvidenceManifest(value.manifest, drifted).errors.includes("dependency lock SHA-256 does not match the candidate commit"));
    value.manifest.exceptions = [{ criterionId: "low-end-physical-p95" }];
    const errors = validateZk682EvidenceManifest(value.manifest, value.options).errors;
    assert(errors.some((error) => error.includes("exceptions[0] keys")));
  } finally { cleanup(value); }
});

test("provenance build declarations must match hash-bound raw artifacts", () => {
  const value = fixture();
  try {
    const descriptor = value.manifest.gateResults.find((entry) => entry.gateId === "provenance");
    const gate = JSON.parse(readFileSync(join(value.root, descriptor.path), "utf8"));
    gate.observations.buildArtifacts[0].sha256 = "0".repeat(64);
    descriptor.sha256 = write(value.root, descriptor.path, gate).sha256;
    assert(validateZk682EvidenceManifest(value.manifest, value.options).errors.some((error) => error.includes("must match a raw artifact binding")));
  } finally { cleanup(value); }
});
