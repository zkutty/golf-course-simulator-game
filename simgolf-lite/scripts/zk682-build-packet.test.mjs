import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createPwaPersistenceReport } from "./pwa-save-evidence.mjs";
import { createZk682DesktopPersistenceReport } from "./zk682-desktop-persistence-contract.mjs";
import { createZk682ResourceGrowthReport, ZK682_RESOURCE_GROWTH_THRESHOLDS } from "./zk682-resource-growth-contract.mjs";
import { buildZk682Report, sha256 } from "./zk682-certification-contract.mjs";
import { buildZk682Packet, ZK682_PACKET_RECEIPTS } from "./zk682-build-packet.mjs";

const NOW = "2026-09-29T12:00:00.000Z";
const write = (root, path, value) => {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(absolute, bytes);
  return { path, sha256: sha256(bytes) };
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function commandReceipt(receiptId, commit, passed = true) {
  return { schemaVersion: 1, kind: "command-receipt", receiptId, candidateCommit: commit, capturedAt: NOW, command: ["fixture", receiptId], exitCode: passed ? 0 : 1, durationMs: 5, passed };
}

function pwaReport(commit) {
  const before = { courseHash: "deadbeef", week: 3, cash: 42000, terrainVersion: 7, economyVersion: 4, terrainCounts: { rough: 8 }, golferPositions: [[1, 2, 3]] };
  const stored = { driver: "indexeddb", database: "coursecraft-saves", objectStore: "kv", slotId: "quick-save", storageKey: "coursecraft_save_quick-save@1", saveSchemaVersion: 31, payloadBytes: 2048, payloadSha256: "a".repeat(64), localStorageFallbackKeys: [] };
  return createPwaPersistenceReport({ candidateCommit: commit, capturedAt: NOW, command: "fixture PWA", environment: { baseUrl: "https://candidate.invalid/", browser: "chromium", browserVersion: "fixture", buildCommit: commit }, before, storedBefore: stored, storedAfter: structuredClone(stored), after: { ...before, terrainVersion: 1, economyVersion: 1 } });
}

const userDataPath = "/tmp/zk682-fixture";
const storageKey = "coursecraft_save_zk682-desktop-persistence@1";
function phase(name, recovered = false) {
  return { schemaVersion: 1, phase: name, packaged: true, appVersion: "fixture", userDataPath,
    security: { contextIsolation: true, sandbox: true, nodeIntegrationDisabled: true, webSecurity: true, preload: true },
    renderer: { schemaVersion: 1, phase: name, slotId: "zk682-desktop-persistence", storageKey, saveSchemaVersion: 31, sourceCanonicalHash: "1234abcd", loadedCanonicalHash: "1234abcd", canonicalEqual: true, rawPayloadBytes: 4096, nativePlatform: true, platformKind: "desktop", safeMode: false,
      recovery: recovered ? { key: storageKey, selected: `${storageKey}.json.bak1`, recovered: true, invalid: [`${storageKey}.json`] } : { key: storageKey, selected: `${storageKey}.json`, recovered: false, invalid: [] } } };
}

const residency = { baseBundles: ["desert:high", "desert:low", "desert:medium", "links:high", "links:low", "links:medium", "parkland:high", "parkland:low", "parkland:medium"], seasonalOverlays: [], seasonalFrameMaps: [], materialFields: 20, pathMaterialFields: 4, seasonalMaterialFields: 0, parklandComposableFields: 8 };
function resourceReport(commit) {
  const samples = Array.from({ length: 7 }, (_, cycle) => ({ cycle, exercised: { theme: "parkland", quality: "high" }, resources: { displayObjects: 2000, attachedTextures: 80, attachedTextureSources: 20, managedTextureSources: 48, canvasConnected: true }, heap: { runtimeUsedBytes: 40000000 + cycle * 20000 }, atlasResidency: structuredClone(residency) }));
  return createZk682ResourceGrowthReport({ source: { commit, mode: "e2e" }, capturedAt: NOW, command: "fixture resource", browser: { name: "chromium", version: "fixture", cdpHeap: true }, thresholds: ZK682_RESOURCE_GROWTH_THRESHOLDS, warmup: { baseBundles: residency.baseBundles, transitions: 9, routeTeardowns: 1 }, samples });
}

function supplemental(gate, commit) {
  const observations = gate === "save-load-resource-stability" ? { saveLoads: 20, resourceGrowthBounded: true } : gate === "long-session-resource-stability" ? { sessionMinutes: 120, resourceGrowthBounded: true } : { scenarios: ["editing", "overlay", "recovery", "sleep-wake"], recoveryPassed: true };
  return { schemaVersion: 1, gate, candidateCommit: commit, capturedAt: NOW, command: `fixture ${gate}`, observations, passed: true };
}

function fixture() {
  const repository = mkdtempSync(join(tmpdir(), "zk682-builder-"));
  const root = join(repository, "simgolf-lite");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package-lock.json"), "fixture lock\n");
  git(repository, "init");
  git(repository, "config", "user.email", "fixture@example.invalid");
  git(repository, "config", "user.name", "Fixture");
  git(repository, "add", "simgolf-lite/package-lock.json");
  git(repository, "commit", "-m", "fixture candidate");
  const commit = git(repository, "rev-parse", "HEAD");
  const raw = join(root, "artifacts/zk682/raw");
  for (const [id, name] of Object.entries(ZK682_PACKET_RECEIPTS)) write(raw, name, commandReceipt(id, commit));
  write(raw, "pwa-indexeddb.json", pwaReport(commit));
  for (const [platform, architecture, executableName] of [["darwin", "arm64", "CourseCraft"], ["win32", "x64", "CourseCraft.exe"]]) {
    const prefix = `artifacts/zk682/raw/desktop-${platform}-${architecture}`;
    const packageFile = write(root, `${prefix}/package/CourseCraft/resources/app.asar`, Buffer.from(`${platform} package`));
    const executable = write(root, `${prefix}/executable/${executableName}`, Buffer.from(`${platform} executable`));
    const manifest = write(root, `${prefix}/package-manifest.json`, { sourceCommit: commit, platform, architecture, files: [{ path: packageFile.path, sha256: packageFile.sha256 }] });
    const report = createZk682DesktopPersistenceReport({ candidateCommit: commit, capturedAt: NOW, platform, architecture, command: `fixture ${platform}`, packageArtifact: { ...packageFile, manifestPath: manifest.path, manifestSha256: manifest.sha256 }, executable, userDataPath, filesystem: { activeRelativePath: "saves/fixture.json", activeMode: 0o600, validRevisionSha256: "b".repeat(64), backupSha256: "b".repeat(64), corruptedActiveSha256: "c".repeat(64) }, phases: { write: phase("write"), verify: phase("verify"), recover: phase("recover", true) } });
    write(root, `${prefix}/persistence.json`, report);
  }
  write(raw, "renderer-resource-growth.json", resourceReport(commit));
  for (const gate of ["save-load-resource-stability", "long-session-resource-stability", "editing-overlay-sleep-recovery"]) write(raw, `${gate}.json`, supplemental(gate, commit));
  const assetSource = write(root, "artifacts/zk682/raw/m35-asset-audit.json", { ok: true, initialCritical: { bytes: 7_000_000 }, dist: { bundles: { parkland: { high: { bytes: 5_000_000 } } } } });
  const browserBuild = write(root, "artifacts/zk682/raw/browser-build-manifest.json", { "src/main.tsx": { file: "assets/index.js", isEntry: true } });
  write(raw, "asset-delivery.json", { schemaVersion: 1, gate: "asset-delivery", candidateCommit: commit, capturedAt: NOW, source: assetSource, browserBuild, bundles: [{ theme: "parkland", tier: "high", bytes: 5_000_000 }], atlases: [{ path: "atlases/fixture.png", bytes: 4_000_000, sha256: "a".repeat(64) }], measurements: { initialCriticalBytes: 7_000_000, selectedBiomeMaxBytes: 5_000_000, individualAtlasMaxBytes: 4_000_000 }, passed: true });
  const perf = { version: 1, theme: "parkland", fixture: "m27Fixture", coldStartupMs: 1000, fixtureLoadMs: 4000, renderer: { workMs: 1, p95Ms: 99 }, effective: { fixture: "m27Fixture", frameAssertion: false, budgets: { rendererWorkMilliseconds: 8, coldStartupMilliseconds: 5000 } } };
  const perfSource = write(root, "artifacts/zk682/raw/headless-performance-source.json", perf);
  write(raw, "headless-performance.json", { schemaVersion: 1, gate: "headless-performance", candidateCommit: commit, capturedAt: NOW, source: perfSource, budgets: { rendererWorkMilliseconds: 8, coldStartupMilliseconds: 5000, fixtureLoadMilliseconds: 6000 }, scenario: { holes: 36, golfers: 100, biome: "parkland", season: "summer", weather: "clear" }, measurements: { frameP95Ms: 99, rendererWorkMs: 1, coldStartupMs: 1000, fixtureLoadMs: 4000 }, physicalDevice: false, frameP95Asserted: false, passed: true });
  return { repository, root, raw, commit };
}

test("builder emits a hash-bound v2 packet and HOLD only for absent physical gates", async () => {
  const value = fixture();
  try {
    const built = await buildZk682Packet({ root: value.root, candidateCommit: value.commit, invokeCertification: false });
    const manifest = JSON.parse(readFileSync(built.manifestPath, "utf8"));
    const report = buildZk682Report(manifest, {
      root: value.root,
      expectedCommit: value.commit,
      commitExists: (commit) => commit === value.commit,
      readCandidateFile: () => readFileSync(join(value.root, "package-lock.json")),
    });
    assert.equal(report.decision, "HOLD");
    assert.equal(report.machinePassed, true);
    assert.deepEqual(report.blockers.map((blocker) => blocker.criterionId), ["midrange-physical-p95", "low-end-physical-p95"]);
    assert.equal(manifest.gateResults.length, 7);
  } finally { rmSync(value.repository, { recursive: true, force: true }); }
});

test("builder derives a machine criterion failure from a failed receipt", async () => {
  const value = fixture();
  try {
    write(value.raw, ZK682_PACKET_RECEIPTS["core-determinism"], commandReceipt("core-determinism", value.commit, false));
    const built = await buildZk682Packet({ root: value.root, candidateCommit: value.commit, invokeCertification: false });
    const manifest = JSON.parse(readFileSync(built.manifestPath, "utf8"));
    const report = buildZk682Report(manifest, { root: value.root, expectedCommit: value.commit, commitExists: () => true, readCandidateFile: () => readFileSync(join(value.root, "package-lock.json")) });
    assert.equal(report.decision, "HOLD");
    assert.equal(report.machinePassed, false);
    assert(report.blockers.some((blocker) => blocker.criterionId === "deterministic-hashes"));
  } finally { rmSync(value.repository, { recursive: true, force: true }); }
});

test("builder rejects relaxed timing budgets, wrong HEAD, and unbound raw files", async () => {
  const relaxed = fixture();
  try {
    const path = join(relaxed.raw, "headless-performance.json");
    const report = JSON.parse(readFileSync(path, "utf8"));
    report.budgets.fixtureLoadMilliseconds = 6001;
    writeFileSync(path, `${JSON.stringify(report)}\n`);
    await assert.rejects(() => buildZk682Packet({ root: relaxed.root, candidateCommit: relaxed.commit, invokeCertification: false }), /budgets were relaxed/);
  } finally { rmSync(relaxed.repository, { recursive: true, force: true }); }
  const extra = fixture();
  try {
    writeFileSync(join(extra.raw, "unbound.txt"), "unbound\n");
    await assert.rejects(() => buildZk682Packet({ root: extra.root, candidateCommit: extra.commit, invokeCertification: false }), /unbound raw evidence/);
    await assert.rejects(() => buildZk682Packet({ root: extra.root, candidateCommit: "f".repeat(40), invokeCertification: false }), /HEAD .* does not match candidate/);
  } finally { rmSync(extra.repository, { recursive: true, force: true }); }
});
