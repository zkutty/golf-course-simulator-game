import pngjs from "pngjs";
const { PNG } = pngjs;
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createPwaPersistenceReport } from "./pwa-save-evidence.mjs";
import { createZk682DesktopPersistenceReport } from "./zk682-desktop-persistence-contract.mjs";
import { ZK682_RESOURCE_GROWTH_THRESHOLDS, createZk682ResourceGrowthReport } from "./zk682-resource-growth-contract.mjs";
import { ZK682_STABILITY_THRESHOLDS, createZk682StabilityReport, createZk682ConservationStabilityReport } from "./zk682-stability-contract.mjs";
import { ZK682_CERTIFICATION_ID, ZK682_CRITERIA, ZK682_GATE_CONTRACTS, ZK682_SCHEMA_VERSION, buildZk682Report, sha256, inspectZk682RendererCompleteness, ZK682_RENDERER_COMPLETENESS_PROTOCOL, validateZk682EvidenceManifest } from "./zk682-certification-contract.mjs";

const COMMIT = "1".repeat(40);
const LOCK = Buffer.from("lockfile fixture\n");

function rendererCompleteFixture(commit) {
  const image = new PNG({ width: 2, height: 1 }); image.data.set([255,0,0,255,0,0,255,255]);
  const png = PNG.sync.write(image);
  const state = { current: true, connected: true, visible: true, tag: "CANVAS", x: 0, y: 0, width: 2, height: 1, viewportWidth: 1280, viewportHeight: 720, intrinsicWidth: 2, intrinsicHeight: 1, dpr: 1, zoom: 1 };
  const capture = { method: "public-page-screenshot-canvas-viewport-clip-v1", clip: { x: 0, y: 0, width: 2, height: 1 }, before: state, after: { ...state }, bytes: png.length, sha256: sha256(png), qualification: "Fixture decoded PNG; not actual browser proof" };
  const cleanup = { measurementProtocol: "exclusive-react-development-component-measures-cleared-before-existing-gc-v1", preserves: "same-name collisions, scheduler and application measures", samples: Array.from({length:7},(_,cycle)=>({cycle,cleanup:{measureEntriesBefore:3,reactComponentEntriesBefore:2,clearedEntries:2,clearedNames:1,preservedCollisionNames:0,measureEntriesAfter:1}})) };
  const commandReceipt = { schemaVersion:1,kind:"command-receipt",receiptId:"renderer-resource-growth",candidateCommit:commit,capturedAt:NOW,command:["npx","playwright","test","e2e/zk682-resource-growth.e2e.ts","--workers=1","--retries=0"],exitCode:0,durationMs:1,passed:true };
  return { png, capture, cleanup, commandReceipt };
}

const NOW = "2026-09-29T12:00:00.000Z";
function write(root, path, value) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(absolute, bytes);
  return { path, sha256: sha256(bytes) };
}
const criterion = (id, status = "pass") => ({ id, status, summary: `${id} ${status}` });

function pwaReport() {
  const before = { courseHash: "deadbeef", week: 3, cash: 42000, terrainVersion: 7, economyVersion: 4, terrainCounts: { rough: 8 }, golferPositions: [[1, 2, 3]] };
  const stored = { driver: "indexeddb", database: "coursecraft-saves", objectStore: "kv", slotId: "quick-save", storageKey: "coursecraft_save_quick-save@1", saveSchemaVersion: 31, payloadBytes: 2048, payloadSha256: "a".repeat(64), localStorageFallbackKeys: [] };
  return createPwaPersistenceReport({
    candidateCommit: COMMIT, capturedAt: NOW, command: "fixture pwa",
    environment: { baseUrl: "https://candidate.invalid/", browser: "chromium", browserVersion: "fixture", buildCommit: COMMIT },
    before, storedBefore: stored, storedAfter: structuredClone(stored), after: { ...before, terrainVersion: 1, economyVersion: 1 },
  });
}

const userDataPath = "/tmp/coursecraft-zk682-user-data";
const storageKey = "coursecraft_save_zk682-desktop-persistence@1";
function phase(name, recovered = false) {
  return { schemaVersion: 1, phase: name, packaged: true, appVersion: "1.0.0-rc.6", userDataPath,
    security: { contextIsolation: true, sandbox: true, nodeIntegrationDisabled: true, webSecurity: true, preload: true },
    renderer: { schemaVersion: 1, phase: name, slotId: "zk682-desktop-persistence", storageKey, saveSchemaVersion: 31, sourceCanonicalHash: "1234abcd", loadedCanonicalHash: "1234abcd", canonicalEqual: true, rawPayloadBytes: 4096, nativePlatform: true, platformKind: "desktop", safeMode: false,
      recovery: recovered ? { key: storageKey, selected: `${storageKey}.json.bak1`, recovered: true, invalid: [`${storageKey}.json`] } : { key: storageKey, selected: `${storageKey}.json`, recovered: false, invalid: [] } } };
}
function desktopReport(platform, architecture, packageArtifact, executable) {
  return createZk682DesktopPersistenceReport({
    candidateCommit: COMMIT, capturedAt: NOW, platform, architecture, command: `fixture ${platform}`,
    packageArtifact, executable, userDataPath,
    filesystem: { activeRelativePath: "saves/fixture.json", activeMode: 0o600, validRevisionSha256: "b".repeat(64), backupSha256: "b".repeat(64), corruptedActiveSha256: "c".repeat(64) },
    phases: { write: phase("write"), verify: phase("verify"), recover: phase("recover", true) },
  });
}

const residency = { baseBundles: ["desert:high", "desert:low", "desert:medium", "links:high", "links:low", "links:medium", "parkland:high", "parkland:low", "parkland:medium"], seasonalOverlays: [], seasonalFrameMaps: [], materialFields: 20, pathMaterialFields: 4, seasonalMaterialFields: 0, parklandComposableFields: 8 };
function resourceReport() {
  const samples = Array.from({ length: 7 }, (_, cycle) => ({ cycle, exercised: { theme: "parkland", quality: "high" }, resources: { displayObjects: 2000, attachedTextures: 80, attachedTextureSources: 20, managedTextureSources: 48, canvasConnected: true }, heap: { runtimeUsedBytes: 40000000 + cycle * 20000 }, atlasResidency: structuredClone(residency) }));
  return createZk682ResourceGrowthReport({ source: { commit: COMMIT, mode: "e2e" }, capturedAt: NOW, command: "fixture resource", browser: { name: "chromium", version: "fixture", cdpHeap: true }, thresholds: ZK682_RESOURCE_GROWTH_THRESHOLDS, warmup: { baseBundles: residency.baseBundles, transitions: 9, routeTeardowns: 1 }, samples });
}
function supplemental(gate) {
  const measured = (index) => ({ rendererQuality: "high", resources: { displayObjects: 2000, attachedTextures: 80, attachedTextureSources: 20, managedTextureSources: 48, canvasConnected: true }, heap: { runtimeUsedBytes: 40_000_000 + index * 20_000 } });
  const samples = gate === "save-load-resource-stability"
    ? Array.from({ length: 13 }, (_, cycle) => ({ cycle, slotId: "quick-save", loaded: cycle > 0, courseHash: "deadbeef", state: { screen: "game", week: 2, cash: 42000, terrainVersion: 7 }, ...measured(cycle) }))
    : gate === "long-session-resource-stability"
      ? Array.from({ length: 7 }, (_, index) => ({ elapsedGameMinutes: index * 22.4, courseHash: index.toString(16).padStart(8, "0"), state: { dayMinute: 100 + index * 22.4, speed: "4x", onCourse: 12 }, ...measured(index) }))
      : [
        { scenario: "editing", passed: true, before: { terrainVersion: 7 }, after: { terrainVersion: 8, screen: "game" }, ...measured(0) },
        { scenario: "overlay", passed: true, before: { panelOpen: false, kind: "traces" }, after: { kind: "recovery", visible: true }, ...measured(1) },
        { scenario: "sleep-wake", passed: true, before: { courseHash: "deadbeef" }, after: { courseHash: "deadbeef", lifecycle: "active", responsive: true }, ...measured(2) },
        { scenario: "recovery", passed: true, before: { savedCourseHash: "deadbeef", mutatedCourseHash: "cafef00d" }, after: { courseHash: "deadbeef", quickSaveLoaded: true }, ...measured(3) },
      ];
  return createZk682StabilityReport({ gate, candidateCommit: COMMIT, capturedAt: NOW, command: `fixture ${gate}`, browser: { name: "chromium", version: "fixture", cdpHeap: true }, thresholds: ZK682_STABILITY_THRESHOLDS[gate], samples });
}

function commandReceipt(receiptId, passed = true) {
  return { schemaVersion: 1, kind: "command-receipt", receiptId, candidateCommit: COMMIT, capturedAt: NOW, command: ["fixture", receiptId], exitCode: passed ? 0 : 1, durationMs: 10, passed };
}

const RECEIPTS = {
  "core-compatibility": ["core-build", "core-unit", "core-determinism", "core-reducer", "core-save", "core-platform-services"],
  "browser-pwa": ["browser-supported", "browser-golden", "browser-pwa"],
  "asset-delivery": ["asset-package-audit", "asset-unselected-biomes"],
  "headless-performance": ["headless-performance"],
};

function genericObservations(gateId, lowEndP95) {
  if (gateId === "core-compatibility") return { productionBuildPassed: true, unitTestsPassed: true, deterministicHashesPassed: true, reducerPassed: true, saveV25RoundTripPassed: true, historicalMigrationsPassed: true, platformServicesPassed: true };
  if (gateId === "asset-delivery") return { initialCriticalBytes: 7000000, selectedBiomeMaxBytes: 5000000, individualAtlasMaxBytes: 7000000, unselectedBiomeAtlasesUnloaded: true, packageSizeAndAssetAuditPassed: true };
  if (gateId === "headless-performance") return { physicalDevice: false, frameP95Asserted: false, frameP95Ms: 100, rendererWorkMs: 0.68, coldStartupMs: 1160, coldStartupBudgetMs: 5000, fixtureLoadMs: 4030, fixtureLoadBudgetMs: 6000, scenario: { holes: 36, golfers: 100, biome: "parkland", season: "summer", weather: "storm" } };
  return { physicalDevice: true, hardwareClass: gateId === "physical-midrange" ? "midrange" : "low-end", device: "Fixture GPU", operatingSystem: "Fixture OS", powerMode: "plugged-in", graphicsBackend: "WebGL2", frameP95Ms: gateId === "physical-midrange" ? 19 : lowEndP95, scenario: { holes: 36, golfers: 100, biome: "parkland", season: "summer", weather: "storm" } };
}

function fixture({ physical = false, lowEndP95 = 32, adjustment = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "zk682-contract-"));
  const lockSha = sha256(LOCK);
  const descriptors = [];
  const gateIds = Object.entries(ZK682_GATE_CONTRACTS).filter(([, contract]) => contract.required || physical).map(([gateId]) => gateId);
  for (const gateId of gateIds) {
    let artifacts = [];
    let observations;
    if (gateId === "provenance") {
      artifacts = [write(root, "raw/browser-build.txt", "browser\n"), write(root, "raw/packaged-electron.txt", "desktop\n")];
      observations = { dependencyLockSha256: lockSha, buildArtifacts: [{ kind: "browser-build", ...artifacts[0] }, { kind: "packaged-electron", ...artifacts[1] }] };
    } else if (gateId === "browser-pwa") {
      const report = write(root, "raw/pwa.json", pwaReport());
      const receipts = RECEIPTS[gateId].map((id) => ({ receiptId: id, ...write(root, `raw/receipt-${id}.json`, commandReceipt(id)) }));
      artifacts = [report, ...receipts.map(({ receiptId: _receiptId, ...artifact }) => artifact)];
      observations = { browserPassed: true, goldenE2ePassed: true, offlineLaunchPassed: true, browsers: ["chromium", "firefox", "webkit"], offlineIndexedDbEvidence: report, receipts };
    } else if (gateId === "packaged-desktop") {
      const evidence = [];
      for (const [platform, architecture] of [["darwin", "arm64"], ["win32", "x64"]]) {
        const bundle = `artifacts/zk682/raw/desktop-${platform}-${architecture}`;
        const packageFile = write(root, `${bundle}/package/app.asar`, `${platform} package`);
        const executable = write(root, `${bundle}/executable/CourseCraft${platform === "win32" ? ".exe" : ""}`, `${platform} executable`);
        const manifest = write(root, `${bundle}/package-manifest.json`, { sourceCommit: COMMIT, platform, architecture, files: [{ path: packageFile.path, sha256: packageFile.sha256 }] });
        const report = write(root, `${bundle}/persistence.json`, desktopReport(platform, architecture, { ...packageFile, manifestPath: manifest.path, manifestSha256: manifest.sha256 }, executable));
        artifacts.push(packageFile, executable, manifest, report);
        evidence.push({ platform, architecture, ...report });
      }
      observations = { packagedElectronPassed: true, desktopPersistencePassed: true, platforms: ["darwin", "win32"], persistenceEvidence: evidence };
    } else if (gateId === "stability") {
      const resource = write(root, "raw/resource.json", resourceReport());
      const saveLoadReport = supplemental("save-load-resource-stability");
      const longSessionReport = supplemental("long-session-resource-stability");
      const interactionReport = supplemental("editing-overlay-sleep-recovery");
      const saveLoad = write(root, "raw/save-load.json", saveLoadReport);
      const longSession = write(root, "raw/long-session.json", longSessionReport);
      const interaction = write(root, "raw/interaction.json", interactionReport);
      const complete = rendererCompleteFixture(COMMIT);
      const cleanup = write(root,"raw/renderer-cleanup.json",complete.cleanup);
      const capture = write(root,"raw/renderer-capture.json",complete.capture);
      const command = write(root,"raw/renderer-command.json",complete.commandReceipt);
      const png = write(root,"raw/renderer-final.png",complete.png);
      const rendererCompleteness = { protocol:ZK682_RENDERER_COMPLETENESS_PROTOCOL,cleanup,capture,command,png };
      artifacts = [resource, saveLoad, longSession, interaction, cleanup, capture, command, png];
      observations = { routeChangesStable: true, saveLoadsStable: true, longSessionStable: true, interactionRecoveryPassed: true, routeChanges: 6, saveLoads: saveLoadReport.observations.saveLoads, sessionMinutes: longSessionReport.observations.sessionMinutes, rendererCompleteness, resourceGrowthEvidence: resource, saveLoadEvidence: saveLoad, longSessionEvidence: longSession, interactionRecoveryEvidence: interaction };
    } else {
      artifacts = [write(root, `raw/${gateId}.txt`, `${gateId}\n`)];
      observations = genericObservations(gateId, lowEndP95);
      if (RECEIPTS[gateId]) {
        const receipts = RECEIPTS[gateId].map((id) => ({ receiptId: id, ...write(root, `raw/receipt-${id}.json`, commandReceipt(id)) }));
        artifacts.push(...receipts.map(({ receiptId: _receiptId, ...artifact }) => artifact));
        observations.receipts = receipts;
      }
      if (gateId === "asset-delivery") {
        const source = write(root, "raw/m35-asset-audit.json", { ok: true, initialCritical: { bytes: 7000000 }, dist: { bundles: { parkland: { high: { bytes: 5000000 } } } } });
        const browserBuild = write(root, "raw/browser-build.json", { entry: "fixture" });
        const typedEvidence = write(root, "raw/asset-delivery.json", { schemaVersion: 1, gate: "asset-delivery", candidateCommit: COMMIT, capturedAt: NOW, source, browserBuild, bundles: [{ theme: "parkland", tier: "high", bytes: 5000000 }], atlases: [{ path: "atlases/fixture.png", bytes: 7000000, sha256: "a".repeat(64) }], measurements: { initialCriticalBytes: 7000000, selectedBiomeMaxBytes: 5000000, individualAtlasMaxBytes: 7000000 }, passed: true });
        artifacts.push(source, browserBuild, typedEvidence);
        observations.typedEvidence = typedEvidence;
      }
      if (gateId === "headless-performance") {
        const source = write(root, "raw/headless-source.json", { theme: "parkland", coldStartupMs: 1160, fixtureLoadMs: 4030, renderer: { p95Ms: 100, workMs: 0.68 }, effective: { fixture: "m27Fixture", frameAssertion: false, budgets: { rendererWorkMilliseconds: 8, coldStartupMilliseconds: 5000 } } });
        const typedEvidence = write(root, "raw/headless-performance.json", { schemaVersion: 1, gate: "headless-performance", candidateCommit: COMMIT, capturedAt: NOW, source, budgets: { rendererWorkMilliseconds: 8, coldStartupMilliseconds: 5000, fixtureLoadMilliseconds: 6000 }, scenario: observations.scenario, measurements: { frameP95Ms: 100, rendererWorkMs: 0.68, coldStartupMs: 1160, fixtureLoadMs: 4030 }, physicalDevice: false, frameP95Asserted: false, passed: true });
        artifacts.push(source, typedEvidence);
        observations.typedEvidence = typedEvidence;
      }
      if (gateId === "physical-midrange" || gateId === "physical-lowend") {
        const rawPhysical = write(root, `raw/${gateId}.json`, { gate: gateId, hardwareClass: observations.hardwareClass, candidateCommit: COMMIT, frameP95Ms: observations.frameP95Ms, scenario: observations.scenario });
        artifacts.push(rawPhysical);
        observations.physicalEvidence = rawPhysical;
      }
    }
    const criteria = ZK682_CRITERIA.filter((entry) => entry.gate === gateId).map((entry) => criterion(entry.id, entry.requirement === "report-only" ? "report-only" : "pass"));
    const gate = { schemaVersion: ZK682_SCHEMA_VERSION, certificationId: ZK682_CERTIFICATION_ID, gateId, candidateCommit: COMMIT, classification: ZK682_GATE_CONTRACTS[gateId].classification, status: "pass", command: `fixture ${gateId}`, environment: { fixture: true }, criteria, observations, artifacts };
    descriptors.push({ gateId, ...write(root, `gates/${gateId}.json`, gate) });
  }
  const exceptions = adjustment ? [{ criterionId: "low-end-physical-p95", evidence: "Approved fixture.", playerImpact: "Revised minimum.", owner: "Release owner", followUpIssue: "ZK-405", approvedMinimumSpecAdjustment: true }] : [];
  const manifest = { schemaVersion: ZK682_SCHEMA_VERSION, certificationId: ZK682_CERTIFICATION_ID, candidateCommit: COMMIT, dependencyLock: { path: "package-lock.json", sha256: lockSha }, gateResults: descriptors, exceptions };
  return { root, manifest, options: { root, expectedCommit: COMMIT, commitExists: () => true, readCandidateFile: () => LOCK } };
}

const cleanup = (value) => rmSync(value.root, { recursive: true, force: true });
function rewriteGate(value, gateId, mutate) {
  const descriptor = value.manifest.gateResults.find((entry) => entry.gateId === gateId);
  const gate = JSON.parse(readFileSync(join(value.root, descriptor.path), "utf8"));
  mutate(gate);
  descriptor.sha256 = write(value.root, descriptor.path, gate).sha256;
}

test("valid typed machine evidence produces HOLD only for absent physical evidence", () => {
  const value = fixture();
  try {
    const report = buildZk682Report(value.manifest, value.options);
    assert.equal(report.decision, "HOLD");
    assert.equal(report.machinePassed, true);
    assert.deepEqual(report.blockers.map((entry) => entry.criterionId), ["midrange-physical-p95", "low-end-physical-p95"]);
  } finally { cleanup(value); }
});

test("complete physical evidence can produce GO", () => {
  const value = fixture({ physical: true });
  try { assert.equal(buildZk682Report(value.manifest, value.options).decision, "GO"); } finally { cleanup(value); }
});

test("rejects arbitrary text in place of typed PWA evidence", () => {
  const value = fixture();
  try {
    rewriteGate(value, "browser-pwa", (gate) => {
      const artifact = write(value.root, "raw/not-evidence.txt", "passed\n");
      gate.artifacts = [artifact];
      gate.observations.offlineIndexedDbEvidence = artifact;
    });
    assert(validateZk682EvidenceManifest(value.manifest, value.options).errors.some((error) => error.includes("typed evidence must be JSON")));
  } finally { cleanup(value); }
});

test("rejects local, short, stale, and mismatched producer commits", () => {
  for (const commit of ["local", "abc123", "2".repeat(40)]) {
    const value = fixture();
    try {
      rewriteGate(value, "stability", (gate) => {
        const reference = gate.observations.resourceGrowthEvidence;
        const report = JSON.parse(readFileSync(join(value.root, reference.path), "utf8"));
        report.source.commit = commit;
        const rewritten = write(value.root, reference.path, report);
        reference.sha256 = rewritten.sha256;
        gate.artifacts.find((entry) => entry.path === reference.path).sha256 = rewritten.sha256;
      });
      assert(validateZk682EvidenceManifest(value.manifest, value.options).errors.some((error) => error.includes("candidate commit mismatch")));
    } finally { cleanup(value); }
  }
});

test("rejects one-platform desktop evidence and wrong producer schemas", () => {
  const onePlatform = fixture();
  try {
    rewriteGate(onePlatform, "packaged-desktop", (gate) => gate.observations.persistenceEvidence.pop());
    assert(validateZk682EvidenceManifest(onePlatform.manifest, onePlatform.options).errors.some((error) => error.includes("exactly darwin and win32")));
  } finally { cleanup(onePlatform); }
  const wrongSchema = fixture();
  try {
    rewriteGate(wrongSchema, "browser-pwa", (gate) => {
      const reference = gate.observations.offlineIndexedDbEvidence;
      const report = JSON.parse(readFileSync(join(wrongSchema.root, reference.path), "utf8"));
      report.schemaVersion = 99;
      const rewritten = write(wrongSchema.root, reference.path, report);
      reference.sha256 = rewritten.sha256;
      gate.artifacts[0].sha256 = rewritten.sha256;
    });
    assert(validateZk682EvidenceManifest(wrongSchema.manifest, wrongSchema.options).errors.some((error) => error.includes("wrong PWA persistence schema")));
  } finally { cleanup(wrongSchema); }
});

test("rejects relaxed renderer thresholds and missing unrelated stability evidence", () => {
  const relaxed = fixture();
  try {
    rewriteGate(relaxed, "stability", (gate) => {
      const reference = gate.observations.resourceGrowthEvidence;
      const report = JSON.parse(readFileSync(join(relaxed.root, reference.path), "utf8"));
      report.thresholds.displayObjects.maxGrowth = 999;
      const rewritten = write(relaxed.root, reference.path, report);
      reference.sha256 = rewritten.sha256;
      gate.artifacts.find((entry) => entry.path === reference.path).sha256 = rewritten.sha256;
    });
    assert(validateZk682EvidenceManifest(relaxed.manifest, relaxed.options).errors.some((error) => error.includes("thresholds differ")));
  } finally { cleanup(relaxed); }
  const missing = fixture();
  try {
    rewriteGate(missing, "stability", (gate) => { delete gate.observations.longSessionEvidence; });
    assert(validateZk682EvidenceManifest(missing.manifest, missing.options).errors.some((error) => error.includes("longSessionEvidence")));
  } finally { cleanup(missing); }
});

test("rejects executable binding drift", () => {
  const value = fixture();
  try {
    rewriteGate(value, "packaged-desktop", (gate) => {
      const reference = gate.observations.persistenceEvidence[0];
      const report = JSON.parse(readFileSync(join(value.root, reference.path), "utf8"));
      report.executable.sha256 = "0".repeat(64);
      const rewritten = write(value.root, reference.path, report);
      reference.sha256 = rewritten.sha256;
      gate.artifacts.find((entry) => entry.path === reference.path).sha256 = rewritten.sha256;
    });
    assert(validateZk682EvidenceManifest(value.manifest, value.options).errors.some((error) => error.includes("executable must be a hash-bound raw artifact")));
  } finally { cleanup(value); }
});

test("wrong manifest commits, stale hashes, and missing machine gates are rejected", () => {
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
  const incomplete = fixture();
  try {
    incomplete.manifest.gateResults = incomplete.manifest.gateResults.filter((entry) => entry.gateId !== "stability");
    assert(validateZk682EvidenceManifest(incomplete.manifest, incomplete.options).errors.includes("missing required machine gate result: stability"));
  } finally { cleanup(incomplete); }
});

test("low-end evidence over budget needs a complete adjustment", () => {
  const unapproved = fixture({ physical: true, lowEndP95: 40 });
  try { assert.equal(buildZk682Report(unapproved.manifest, unapproved.options).decision, "HOLD"); } finally { cleanup(unapproved); }
  const approved = fixture({ physical: true, lowEndP95: 40, adjustment: true });
  try { assert.equal(buildZk682Report(approved.manifest, approved.options).decision, "GO"); } finally { cleanup(approved); }
});

test("a structurally valid typed failure produces HOLD instead of manifest invalid", () => {
  const value = fixture();
  try {
    rewriteGate(value, "stability", (gate) => {
      const reference = gate.observations.resourceGrowthEvidence;
      const prior = JSON.parse(readFileSync(join(value.root, reference.path), "utf8"));
      prior.samples.at(-1).resources.displayObjects += 100;
      const failed = createZk682ResourceGrowthReport({ source: prior.source, capturedAt: prior.capturedAt, command: prior.command, browser: prior.browser, thresholds: prior.thresholds, warmup: prior.warmup, samples: prior.samples });
      assert.equal(failed.passed, false);
      const rewritten = write(value.root, reference.path, failed);
      reference.sha256 = rewritten.sha256;
      gate.artifacts.find((entry) => entry.path === reference.path).sha256 = rewritten.sha256;
      gate.observations.routeChangesStable = false;
      gate.criteria.find((entry) => entry.id === "route-change-resource-stability").status = "fail";
      gate.status = "fail";
    });
    const report = buildZk682Report(value.manifest, value.options);
    assert.equal(report.decision, "HOLD");
    assert.equal(report.machinePassed, false);
    assert(report.blockers.some((blocker) => blocker.criterionId === "route-change-resource-stability"));
  } finally { cleanup(value); }
});

test("a schema-v2 supplemental stability failure produces HOLD instead of manifest invalid", () => {
  const value = fixture();
  try {
    rewriteGate(value, "stability", (gate) => {
      const reference = gate.observations.saveLoadEvidence;
      const prior = JSON.parse(readFileSync(join(value.root, reference.path), "utf8"));
      prior.samples.at(-1).resources.attachedTextureSources += 2;
      const failed = createZk682StabilityReport({
        gate: prior.gate,
        candidateCommit: prior.candidateCommit,
        capturedAt: prior.capturedAt,
        command: prior.command,
        browser: prior.browser,
        thresholds: prior.thresholds,
        samples: prior.samples,
      });
      assert.equal(failed.passed, false);
      const rewritten = write(value.root, reference.path, failed);
      reference.sha256 = rewritten.sha256;
      gate.artifacts.find((entry) => entry.path === reference.path).sha256 = rewritten.sha256;
      gate.observations.saveLoadsStable = false;
      gate.criteria.find((entry) => entry.id === "save-load-resource-stability").status = "fail";
      gate.status = "fail";
    });
    const report = buildZk682Report(value.manifest, value.options);
    assert.equal(report.decision, "HOLD");
    assert.equal(report.machinePassed, false);
    assert(report.blockers.some((blocker) => blocker.criterionId === "save-load-resource-stability"));
  } finally { cleanup(value); }
});

test("rejects relaxed fixture budget and physical evidence that does not match its gate/scenario", () => {
  const relaxed = fixture();
  try {
    rewriteGate(relaxed, "headless-performance", (gate) => { gate.observations.fixtureLoadBudgetMs = 6001; });
    assert(validateZk682EvidenceManifest(relaxed.manifest, relaxed.options).errors.some((error) => error.includes("fixture load budget must remain 6000 ms")));
  } finally { cleanup(relaxed); }
  const mismatched = fixture({ physical: true });
  try {
    rewriteGate(mismatched, "physical-midrange", (gate) => { gate.observations.scenario.weather = "snow"; });
    const errors = validateZk682EvidenceManifest(mismatched.manifest, mismatched.options).errors;
    assert(errors.some((error) => error.includes("normalized observations disagree with typed physical evidence")));
    assert(errors.some((error) => error.includes("physical scenario must exactly match headless")));
  } finally { cleanup(mismatched); }
});


test("schema-v3 conservation evidence is consumed and recomputed without changing v2 artifacts", () => {
  const value = fixture();
  try {
    rewriteGate(value, "stability", (gate) => {
      const ref = gate.observations.saveLoadEvidence;
      const prior = JSON.parse(readFileSync(join(value.root, ref.path), "utf8"));
      for (const sample of prior.samples) {
        sample.resources.graphics = 0; sample.resources.text = 0;
        sample.resources.emoteOwnership = { schemaVersion: 1, complete: true, failure: null, generation: 1, stageUID: 1, overlayUID: 2,
          currentOwner: true, apiIdentityCurrent: true, ownerCount: 0, scheduler: [], groups: [], contribution: { displayObjects: 0, graphics: 0, text: 0 } };
      }
      const report = createZk682ConservationStabilityReport(prior);
      assert.equal(report.passed, true);
      const rewritten = write(value.root, ref.path, report);
      ref.sha256 = rewritten.sha256;
      gate.artifacts.find((a) => a.path === ref.path).sha256 = rewritten.sha256;
    });
    assert.deepEqual(validateZk682EvidenceManifest(value.manifest, value.options).errors, []);
    rewriteGate(value, "stability", (gate) => {
      const ref = gate.observations.saveLoadEvidence;
      const report = JSON.parse(readFileSync(join(value.root, ref.path), "utf8"));
      report.legacyRawComparison.passed = false;
      const rewritten = write(value.root, ref.path, report);
      ref.sha256 = rewritten.sha256;
      gate.artifacts.find((a) => a.path === ref.path).sha256 = rewritten.sha256;
    });
    assert(validateZk682EvidenceManifest(value.manifest, value.options).errors.some((e) => e.includes("legacy raw result")));
  } finally { cleanup(value); }
});

test("renderer completeness validates independent typed artifacts and bounded PNG decode", () => {
  const valid = { candidateCommit: COMMIT, resource: resourceReport(), ...rendererCompleteFixture(COMMIT) };
  assert.equal(inspectZk682RendererCompleteness(valid).passed,true);
  for(const mutate of [
    x=>{x.commandReceipt.exitCode=1;x.commandReceipt.passed=false;},
    x=>{x.commandReceipt.candidateCommit="2".repeat(40);},
    x=>{x.commandReceipt.command=["fixture"];},
    x=>{x.cleanup.samples.pop();},x=>{x.cleanup.samples[0]=null;},x=>{x.cleanup=null;},x=>{x.cleanup.samples[0].cleanup=null;},x=>{x.commandReceipt=null;},x=>{x.cleanup.samples[0].cycle=1;},
    x=>{x.cleanup.samples[0].cleanup.measureEntriesAfter=9;},
    x=>{x.capture.before.x=-0.0005;},x=>{x.capture.after.connected=false;},
    x=>{x.capture.clip.width=3;},x=>{x.capture.sha256="0".repeat(64);},
    x=>{x.png=Buffer.from("not PNG");},
    x=>{const image=new PNG({width:2,height:1});image.data.fill(255);x.png=PNG.sync.write(image);x.capture.bytes=x.png.length;x.capture.sha256=sha256(x.png);},
    x=>{const image=new PNG({width:2,height:1});image.data.set([255,0,0,0,0,0,255,0]);x.png=PNG.sync.write(image);x.capture.bytes=x.png.length;x.capture.sha256=sha256(x.png);},
    x=>{x.png=x.png.subarray(0,x.png.length-8);x.capture.bytes=x.png.length;x.capture.sha256=sha256(x.png);},
    x=>{x.png=Buffer.alloc(12*1024*1024+1);x.capture.bytes=x.png.length;x.capture.sha256=sha256(x.png);},
    x=>{x.png.writeUInt32BE(0xffffffff,16);x.capture.sha256=sha256(x.png);},
    x=>{x.capture.extra=true;},x=>{x.commandReceipt.exitCode=null;},
  ]) { const changed=structuredClone(valid);changed.png=Buffer.from(changed.png);mutate(changed);assert.equal(inspectZk682RendererCompleteness(changed).passed,false); }
});

test("renderer PNG unsupported encodings reject before pngjs decode", () => {
  const decode = PNG.sync.read; let calls = 0;
  try {
    PNG.sync.read = () => { calls++; throw Error("decode must not run"); };
    for (const [offset, value] of [[24,16],[25,3],[26,1],[27,1],[28,1]]) {
      const evidence = { candidateCommit:COMMIT,resource:resourceReport(),...rendererCompleteFixture(COMMIT) };
      evidence.png[offset]=value; evidence.capture.sha256=sha256(evidence.png);
      const checked=inspectZk682RendererCompleteness(evidence);
      assert.equal(checked.passed,false);assert.ok(checked.errors.some(error=>error.includes("Unsupported PNG encoding")));
    }
    for (const transform of [
      png => Buffer.concat([png.subarray(0,33),png.subarray(8,33),png.subarray(33)]),
      png => Buffer.concat([png,Buffer.from([0])]),
      png => png.subarray(0,png.length-12),
    ]) {
      const evidence={candidateCommit:COMMIT,resource:resourceReport(),...rendererCompleteFixture(COMMIT)};
      evidence.png=transform(evidence.png);evidence.capture.bytes=evidence.png.length;evidence.capture.sha256=sha256(evidence.png);
      const checked=inspectZk682RendererCompleteness(evidence);assert.equal(checked.passed,false);assert.ok(checked.errors.some(error=>/duplicate IHDR|terminal|IEND/.test(error)));
    }
    assert.equal(calls,0);
  } finally { PNG.sync.read=decode; }
});

test("renderer completeness supports canonical noninterlaced RGB PNG", () => {
  const evidence={candidateCommit:COMMIT,resource:resourceReport(),...rendererCompleteFixture(COMMIT)};
  const image=new PNG({width:2,height:1});image.data.set([255,0,0,255,0,0,255,255]);
  evidence.png=PNG.sync.write(image,{colorType:2});evidence.capture.bytes=evidence.png.length;evidence.capture.sha256=sha256(evidence.png);
  assert.equal(evidence.png[25],2);assert.equal(inspectZk682RendererCompleteness(evidence).passed,true);
});

test('renderer completeness admits strict legacy and public CDP methods with unchanged seven-field receipts',()=>{for(const method of ['public-page-screenshot-canvas-viewport-clip-v1','public-cdp-page-captureScreenshot-canvas-viewport-clip-v1']){const evidence={candidateCommit:COMMIT,resource:resourceReport(),...rendererCompleteFixture(COMMIT)};evidence.capture.method=method;assert.equal(inspectZk682RendererCompleteness(evidence).passed,true);assert.equal(Object.keys(evidence.capture).length,7);}});
test('renderer public CDP completeness rejects unknown methods and conjunctive artifact defects',()=>{const make=()=>{const value={candidateCommit:COMMIT,resource:resourceReport(),...rendererCompleteFixture(COMMIT)};value.capture.method='public-cdp-page-captureScreenshot-canvas-viewport-clip-v1';return value;};for(const mutate of [e=>{e.capture.method='public-cdp-page-captureScreenshot-canvas-viewport-clip-v2';},e=>{e.capture.method='public-cdp-page-capturescreenshot-canvas-viewport-clip-v1';},e=>{e.capture.method=undefined;},e=>{e.capture.extra='not strict';},e=>{e.png=undefined;},e=>{e.capture.sha256='0'.repeat(64);},e=>{e.capture.clip.width+=1;},e=>{e.capture.after.current=false;},e=>{e.capture.after.dpr=2;},e=>{e.commandReceipt.exitCode=1;e.commandReceipt.passed=false;},e=>{e.commandReceipt.candidateCommit='f'.repeat(40);},e=>{e.resource.samples.pop();},e=>{e.cleanup.samples.pop();}]){const evidence=make();mutate(evidence);assert.equal(inspectZk682RendererCompleteness(evidence).passed,false);}});
test('renderer consumer validates actual canonical helper publication and strict new receipt',async()=>{const {captureVisibleCanvas}=await import('./zk682-public-canvas-capture.mjs'),evidence={candidateCommit:COMMIT,resource:resourceReport(),...rendererCompleteFixture(COMMIT)},root=mkdtempSync(join(tmpdir(),'zk682-cdp-consumer-')),output=join(root,'final.png');let acquisitions=0,conversions=0,dispose=0,elementDispose=0;const handle={evaluate:async()=>evidence.capture.before,dispose:async()=>{elementDispose++;}},raw={evaluate:handle.evaluate,asElement:()=>{conversions++;return handle;},dispose:async()=>{dispose++;}},session={send:async()=>({data:evidence.png.toString('base64')}),detach:async()=>{}},page={locator:()=>({count:async()=>1}),evaluateHandle:async()=>{acquisitions++;return raw;},context:()=>({newCDPSession:async()=>session})};try{evidence.capture=await captureVisibleCanvas(page,output);evidence.png=readFileSync(output);assert.deepEqual({acquisitions,conversions,dispose,elementDispose},{acquisitions:1,conversions:0,dispose:1,elementDispose:0});assert.equal(evidence.capture.method,'public-cdp-page-captureScreenshot-canvas-viewport-clip-v1');assert.equal(inspectZk682RendererCompleteness(evidence).passed,true);evidence.commandReceipt.exitCode=1;evidence.commandReceipt.passed=false;assert.equal(inspectZk682RendererCompleteness(evidence).passed,false);}finally{rmSync(root,{recursive:true,force:true});}});
