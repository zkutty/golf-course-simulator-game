import pngjs from "pngjs";
const { PNG } = pngjs;
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { certifyOfflineIndexedDbSave, PWA_PERSISTENCE_REPORT_SCHEMA_VERSION } from "./pwa-save-evidence.mjs";
import {
  ZK682_DESKTOP_PERSISTENCE_REPORT_SCHEMA_VERSION,
  validateZk682DesktopPersistenceSequence,
} from "./zk682-desktop-persistence-contract.mjs";
import {
  evaluateZk682ResourceGrowth,
  ZK682_RESOURCE_GROWTH_SCHEMA_VERSION,
  ZK682_RESOURCE_GROWTH_THRESHOLDS,
} from "./zk682-resource-growth-contract.mjs";
import {
  evaluateZk682Stability,
  evaluateZk682ConservationStability,
  ZK682_DISPLAY_CONSERVATION_SCHEMA_VERSION,
  stableStabilityJson,
  ZK682_STABILITY_SCHEMA_VERSION,
  ZK682_STABILITY_THRESHOLDS,
} from "./zk682-stability-contract.mjs";
import { inspectZk682CommandReceipt } from "./zk682-command-receipt.mjs";

export const ZK682_SCHEMA_VERSION = 2;
export const ZK682_CERTIFICATION_ID = "zk682-architecture-slice-certification-v2";
export const ZK682_REPORT_VERSION = 2;

const MiB = 1024 * 1024;
export const ZK682_BUDGETS = Object.freeze({
  rendererWorkMilliseconds: 8,
  coldStartupMilliseconds: 5_000,
  fixtureLoadMilliseconds: 6_000,
  midrangeP95Milliseconds: 20,
  lowEndP95Milliseconds: 33,
  initialCriticalBytes: 8 * MiB,
  selectedBiomeBytes: 6 * MiB,
  individualAtlasBytes: 8 * MiB,
});

export const ZK682_CRITERIA = Object.freeze([
  { id: "immutable-candidate-and-dependencies", gate: "provenance", requirement: "machine", title: "Exact commit and dependency lockfile are pinned." },
  { id: "immutable-browser-and-package-artifacts", gate: "provenance", requirement: "machine", title: "Browser and packaged build artifacts are content-addressed to the candidate." },
  { id: "production-build-and-unit-gates", gate: "core-compatibility", requirement: "machine", title: "Production build and unit gates pass on the candidate." },
  { id: "representative-36-hole-100-golfer-load", gate: "headless-performance", requirement: "machine", title: "The 36-hole/100-golfer heavy biome, season, and weather fixture stays within the renderer-work budget." },
  { id: "headless-frame-p95-report-only", gate: "headless-performance", requirement: "report-only", title: "Headless frame p95 is retained only as a trend signal." },
  { id: "startup-and-fixture-load", gate: "headless-performance", requirement: "machine", title: "Cold startup and representative fixture load stay within their declared budgets." },
  { id: "browser-pwa-certification", gate: "browser-pwa", requirement: "machine", title: "Supported browser and installed-PWA paths pass." },
  { id: "golden-e2e", gate: "browser-pwa", requirement: "machine", title: "Golden end-to-end behavior passes." },
  { id: "offline-launch", gate: "browser-pwa", requirement: "machine", title: "The installed PWA launches and restores state offline." },
  { id: "packaged-electron-certification", gate: "packaged-desktop", requirement: "machine", title: "Packaged Electron passes the declared Windows and macOS matrix." },
  { id: "desktop-persistence", gate: "packaged-desktop", requirement: "machine", title: "Packaged native persistence and recovery behavior pass." },
  { id: "midrange-physical-p95", gate: "physical-midrange", requirement: "physical", title: "Midrange physical hardware records p95 frame time at or below 20 ms." },
  { id: "low-end-physical-p95", gate: "physical-lowend", requirement: "physical", title: "Low-end physical hardware records p95 at or below 33 ms, unless an approved minimum-spec adjustment is documented." },
  { id: "initial-critical-assets", gate: "asset-delivery", requirement: "machine", title: "Initial critical assets remain at or below 8 MiB." },
  { id: "selected-biome-payload", gate: "asset-delivery", requirement: "machine", title: "The selected biome payload remains at or below 6 MiB." },
  { id: "individual-atlas-payload", gate: "asset-delivery", requirement: "machine", title: "Every individual atlas remains at or below 8 MiB." },
  { id: "unselected-biomes-unloaded", gate: "asset-delivery", requirement: "machine", title: "Unselected biome atlases remain unloaded." },
  { id: "package-size-and-asset-audit", gate: "asset-delivery", requirement: "machine", title: "Package-size and asset-audit gates pass." },
  { id: "deterministic-hashes", gate: "core-compatibility", requirement: "machine", title: "Deterministic hashes remain stable." },
  { id: "reducer-behavior", gate: "core-compatibility", requirement: "machine", title: "Reducer behavior remains compatible." },
  { id: "save-v25-round-trip", gate: "core-compatibility", requirement: "machine", title: "Save schema v25 round trips remain compatible." },
  { id: "historical-save-migrations", gate: "core-compatibility", requirement: "machine", title: "Historical save migrations remain compatible." },
  { id: "platform-services", gate: "core-compatibility", requirement: "machine", title: "PlatformServices browser and desktop contracts remain compatible." },
  { id: "route-change-resource-stability", gate: "stability", requirement: "machine", title: "Repeated route changes show no material memory or resource growth." },
  { id: "save-load-resource-stability", gate: "stability", requirement: "machine", title: "Repeated save loads show no material memory or resource growth." },
  { id: "long-session-resource-stability", gate: "stability", requirement: "machine", title: "Long-running live simulation shows no material memory or resource growth." },
  { id: "editing-overlay-sleep-recovery", gate: "stability", requirement: "machine", title: "Representative overlays, editing, sleep/wake, and recovery paths pass." },
]);

export const ZK682_GATE_CONTRACTS = Object.freeze({
  provenance: { classification: "machine", required: true },
  "core-compatibility": { classification: "machine", required: true },
  "browser-pwa": { classification: "machine", required: true },
  "packaged-desktop": { classification: "machine", required: true },
  "asset-delivery": { classification: "machine", required: true },
  "headless-performance": { classification: "report-only", required: true },
  stability: { classification: "machine", required: true },
  "physical-midrange": { classification: "physical", required: false },
  "physical-lowend": { classification: "physical", required: false },
});

const CRITERIA_BY_ID = new Map(ZK682_CRITERIA.map((criterion) => [criterion.id, criterion]));
const CRITERIA_BY_GATE = new Map(Object.keys(ZK682_GATE_CONTRACTS).map((gate) => [
  gate,
  ZK682_CRITERIA.filter((criterion) => criterion.gate === gate),
]));

export const stableValue = (value) => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]))
    : value;

export const stableJson = (value) => JSON.stringify(stableValue(value));
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  if (stableJson(Object.keys(value).sort()) !== stableJson([...keys].sort())) {
    errors.push(`${label} keys must be exactly ${[...keys].sort().join(", ")}`);
    return false;
  }
  return true;
}

function safeRelativePath(path) {
  return typeof path === "string"
    && path.length > 0
    && !path.startsWith("/")
    && !path.split(/[\\/]/).includes("..")
    && !path.includes("\0");
}

function readBoundFile(root, path, maxBytes = Infinity) {
  if (!safeRelativePath(path)) throw new Error(`unsafe evidence path: ${String(path)}`);
  const absolute = resolve(root, path);
  const normalizedRoot = resolve(root);
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`evidence path escapes the package root: ${path}`);
  }
  if (statSync(absolute).size > maxBytes) throw new Error(`evidence byte bound exceeded: ${path}`);
  return readFileSync(absolute);
}

function validSha(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function validCapturedAt(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function artifactIsBound(gate, artifact) {
  return gate.artifacts.some((entry) => entry.path === artifact.path && entry.sha256 === artifact.sha256);
}

function readTypedArtifact(reference, gate, root, label, errors) {
  if (!exactKeys(reference, ["path", "sha256"], label, errors)) return null;
  if (!safeRelativePath(reference.path)) {
    errors.push(`${label}.path is unsafe`);
    return null;
  }
  if (!validSha(reference.sha256)) {
    errors.push(`${label}.sha256 is invalid`);
    return null;
  }
  if (!artifactIsBound(gate, reference)) {
    errors.push(`${label} must match a raw artifact binding by path and SHA-256`);
    return null;
  }
  let bytes;
  try {
    bytes = readBoundFile(root, reference.path);
  } catch (error) {
    errors.push(`${label}: missing typed evidence ${reference.path}: ${error.message}`);
    return null;
  }
  if (sha256(bytes) !== reference.sha256) {
    errors.push(`${label}: typed evidence SHA-256 mismatch: ${reference.path}`);
    return null;
  }
  try {
    return JSON.parse(bytes);
  } catch (error) {
    errors.push(`${label}: typed evidence must be JSON: ${error.message}`);
    return null;
  }
}

function validatePwaPersistenceEvidence(report, manifest, label, errors) {
  if (!exactKeys(report, ["schemaVersion", "gate", "candidateCommit", "capturedAt", "command", "environment", "roundTrip", "evidence", "passed"], label, errors)) return false;
  if (report.schemaVersion !== PWA_PERSISTENCE_REPORT_SCHEMA_VERSION) errors.push(`${label}: wrong PWA persistence schema`);
  if (report.gate !== "offline-indexeddb-pwa") errors.push(`${label}: wrong PWA persistence gate`);
  if (!validCommit(report.candidateCommit) || report.candidateCommit !== manifest.candidateCommit) errors.push(`${label}: candidate commit mismatch`);
  if (!validCapturedAt(report.capturedAt)) errors.push(`${label}: capturedAt is invalid`);
  if (typeof report.command !== "string" || !report.command) errors.push(`${label}: command is required`);
  if (exactKeys(report.environment, ["baseUrl", "browser", "browserVersion", "buildCommit"], `${label}.environment`, errors)) {
    if (typeof report.environment.baseUrl !== "string" || !report.environment.baseUrl) errors.push(`${label}: baseUrl is required`);
    if (report.environment.browser !== "chromium") errors.push(`${label}: browser must be chromium`);
    if (typeof report.environment.browserVersion !== "string" || !report.environment.browserVersion) errors.push(`${label}: browserVersion is required`);
    if (report.environment.buildCommit !== manifest.candidateCommit) errors.push(`${label}: runtime build commit mismatch`);
  }
  let recomputed = null;
  try {
    recomputed = certifyOfflineIndexedDbSave(report.roundTrip);
  } catch (error) {
    if (report.passed === true) errors.push(`${label}: claimed pass but the offline IndexedDB round trip failed: ${error.message}`);
  }
  const passed = Boolean(recomputed && stableJson(recomputed) === stableJson(report.evidence));
  if (recomputed && !passed) errors.push(`${label}: declared evidence does not match the raw round trip`);
  if (report.passed !== passed) errors.push(`${label}: passed must agree with the recomputed round trip`);
  return passed;
}

function validateDesktopPersistenceEvidence(report, manifest, gate, root, label, errors) {
  if (!exactKeys(report, ["schemaVersion", "gate", "issue", "candidateCommit", "capturedAt", "platform", "architecture", "command", "package", "executable", "userDataLifecycle", "summary", "filesystem", "phases", "passed"], label, errors)) return false;
  if (report.schemaVersion !== ZK682_DESKTOP_PERSISTENCE_REPORT_SCHEMA_VERSION) errors.push(`${label}: wrong desktop persistence schema`);
  if (report.gate !== "packaged-desktop-persistence" || report.issue !== "ZK-682") errors.push(`${label}: wrong desktop persistence gate`);
  if (!validCommit(report.candidateCommit) || report.candidateCommit !== manifest.candidateCommit) errors.push(`${label}: candidate commit mismatch`);
  if (!validCapturedAt(report.capturedAt)) errors.push(`${label}: capturedAt is invalid`);
  if (!new Set(["darwin", "win32"]).has(report.platform)) errors.push(`${label}: platform must be darwin or win32`);
  if (typeof report.architecture !== "string" || !report.architecture) errors.push(`${label}: architecture is required`);
  if (typeof report.command !== "string" || !report.command) errors.push(`${label}: command is required`);
  const packageKeys = ["path", "sha256", "manifestPath", "manifestSha256"];
  if (exactKeys(report.package, packageKeys, `${label}.package`, errors)) {
    const packageArtifact = { path: report.package.path, sha256: report.package.sha256 };
    const manifestArtifact = { path: report.package.manifestPath, sha256: report.package.manifestSha256 };
    for (const [kind, artifact] of [["package", packageArtifact], ["package manifest", manifestArtifact]]) {
      if (!safeRelativePath(artifact.path) || !validSha(artifact.sha256)) errors.push(`${label}: ${kind} binding is invalid`);
      else if (!artifactIsBound(gate, artifact)) errors.push(`${label}: ${kind} must be a hash-bound raw artifact`);
    }
    try {
      const packageManifest = JSON.parse(readBoundFile(root, report.package.manifestPath));
      if (sha256(readBoundFile(root, report.package.manifestPath)) !== report.package.manifestSha256) errors.push(`${label}: package manifest SHA-256 mismatch`);
      if (packageManifest.sourceCommit !== manifest.candidateCommit) errors.push(`${label}: package manifest candidate commit mismatch`);
      if (packageManifest.platform !== report.platform || packageManifest.architecture !== report.architecture) errors.push(`${label}: package manifest platform/architecture mismatch`);
      if (!packageManifest.files?.some((entry) => entry.path === report.package.path.replace(/^desktop-dist\//, "") && entry.sha256 === report.package.sha256)) {
        errors.push(`${label}: package artifact is absent from the package manifest`);
      }
    } catch (error) {
      errors.push(`${label}: package manifest is invalid: ${error.message}`);
    }
  }
  if (exactKeys(report.executable, ["path", "sha256"], `${label}.executable`, errors)) {
    if (!safeRelativePath(report.executable.path) || !validSha(report.executable.sha256)) errors.push(`${label}: executable binding is invalid`);
    else if (!artifactIsBound(gate, report.executable)) errors.push(`${label}: executable must be a hash-bound raw artifact`);
  }
  let recomputed = null;
  try {
    recomputed = validateZk682DesktopPersistenceSequence({
      ...report.phases,
      userDataPath: report.phases?.write?.userDataPath,
    });
  } catch (error) {
    if (report.passed === true) errors.push(`${label}: claimed pass but the desktop persistence sequence failed: ${error.message}`);
  }
  const passed = Boolean(recomputed && stableJson(recomputed) === stableJson(report.summary));
  if (recomputed && !passed) errors.push(`${label}: declared desktop summary does not match phase evidence`);
  if (report.passed !== passed) errors.push(`${label}: passed must agree with the recomputed desktop sequence`);
  return passed;
}

function validateResourceGrowthEvidence(report, manifest, label, errors) {
  if (!exactKeys(report, ["schemaVersion", "gate", "source", "capturedAt", "command", "browser", "thresholds", "warmup", "samples", "summary", "errors", "passed"], label, errors)) return false;
  if (report.schemaVersion !== ZK682_RESOURCE_GROWTH_SCHEMA_VERSION) errors.push(`${label}: wrong renderer resource-growth schema`);
  if (report.gate !== "renderer-resource-growth") errors.push(`${label}: wrong renderer resource-growth gate`);
  if (!exactKeys(report.source, ["commit", "mode"], `${label}.source`, errors)) return false;
  if (!validCommit(report.source.commit) || report.source.commit !== manifest.candidateCommit) errors.push(`${label}: candidate commit mismatch`);
  if (report.source.mode !== "e2e") errors.push(`${label}: source mode must be e2e`);
  if (!validCapturedAt(report.capturedAt)) errors.push(`${label}: capturedAt is invalid`);
  if (typeof report.command !== "string" || !report.command) errors.push(`${label}: command is required`);
  if (report.browser?.name !== "chromium" || report.browser?.cdpHeap !== true || typeof report.browser?.version !== "string" || !report.browser.version) errors.push(`${label}: real Chromium CDP heap evidence is required`);
  if (stableJson(report.thresholds) !== stableJson(ZK682_RESOURCE_GROWTH_THRESHOLDS)) errors.push(`${label}: resource-growth thresholds differ from the certification contract`);
  const recomputed = evaluateZk682ResourceGrowth(report.samples, ZK682_RESOURCE_GROWTH_THRESHOLDS);
  if (stableJson(recomputed.metrics) !== stableJson(report.summary) || stableJson(recomputed.errors) !== stableJson(report.errors) || recomputed.passed !== report.passed) {
    errors.push(`${label}: declared renderer result does not match raw samples`);
  }
  return recomputed.passed === true;
}

const SUPPLEMENTAL_STABILITY_GATES = Object.freeze({
  "save-load-resource-stability": ["saveLoads", "resourceGrowthBounded"],
  "long-session-resource-stability": ["sessionMinutes", "resourceGrowthBounded"],
  "editing-overlay-sleep-recovery": ["scenarios", "recoveryPassed"],
});

function validateSupplementalStabilityEvidence(report, expectedGate, manifest, label, errors) {
  const schemaV1 = report?.schemaVersion === 1;
  const schemaV3 = report?.schemaVersion === ZK682_DISPLAY_CONSERVATION_SCHEMA_VERSION;
  const expectedKeys = schemaV1
    ? ["schemaVersion", "gate", "candidateCommit", "capturedAt", "command", "observations", "passed"]
    : ["schemaVersion", "gate", "candidateCommit", "capturedAt", "command", "browser", "thresholds", "samples", "observations", "summary", "errors", "passed"];
  if (schemaV3) expectedKeys.push("legacyRawComparison");
  if (!exactKeys(report, expectedKeys, label, errors)) return false;
  if (![1, ZK682_STABILITY_SCHEMA_VERSION, ZK682_DISPLAY_CONSERVATION_SCHEMA_VERSION].includes(report.schemaVersion) || report.gate !== expectedGate) errors.push(`${label}: wrong supplemental stability schema/gate`);
  if (!validCommit(report.candidateCommit) || report.candidateCommit !== manifest.candidateCommit) errors.push(`${label}: candidate commit mismatch`);
  if (!validCapturedAt(report.capturedAt)) errors.push(`${label}: capturedAt is invalid`);
  if (typeof report.command !== "string" || !report.command) errors.push(`${label}: command is required`);
  if (!schemaV1 && (report.browser?.name !== "chromium" || report.browser?.cdpHeap !== true || typeof report.browser?.version !== "string" || !report.browser.version)) errors.push(`${label}: real Chromium CDP heap evidence is required`);
  if (!schemaV1 && stableStabilityJson(report.thresholds) !== stableStabilityJson(ZK682_STABILITY_THRESHOLDS[expectedGate])) errors.push(`${label}: thresholds differ from the immutable stability contract`);
  const keys = SUPPLEMENTAL_STABILITY_GATES[expectedGate];
  let passed = false;
  if (exactKeys(report.observations, keys, `${label}.observations`, errors)) {
    if (expectedGate === "save-load-resource-stability") {
      if (!Number.isFinite(report.observations.saveLoads) || report.observations.saveLoads <= 0 || typeof report.observations.resourceGrowthBounded !== "boolean") errors.push(`${label}: save-load observations are invalid`);
      else passed = report.observations.resourceGrowthBounded;
    }
    if (expectedGate === "long-session-resource-stability") {
      if (!Number.isFinite(report.observations.sessionMinutes) || report.observations.sessionMinutes <= 0 || typeof report.observations.resourceGrowthBounded !== "boolean") errors.push(`${label}: long-session observations are invalid`);
      else passed = report.observations.resourceGrowthBounded;
    }
    if (expectedGate === "editing-overlay-sleep-recovery") {
      const scenarios = Array.isArray(report.observations.scenarios) ? [...report.observations.scenarios].sort() : [];
      if (stableJson(scenarios) !== stableJson(["editing", "overlay", "recovery", "sleep-wake"]) || typeof report.observations.recoveryPassed !== "boolean") errors.push(`${label}: interaction recovery observations are invalid`);
      else passed = report.observations.recoveryPassed;
    }
  }
  if (schemaV1) {
    if (report.passed !== passed) errors.push(`${label}: passed must agree with the typed observations`);
    return passed;
  }
  const recomputed = (schemaV3 ? evaluateZk682ConservationStability : evaluateZk682Stability)(expectedGate, report.samples, ZK682_STABILITY_THRESHOLDS[expectedGate]);
  if (schemaV3 && stableJson(recomputed.legacyRawComparison) !== stableJson(report.legacyRawComparison)) errors.push(`${label}: legacy raw result does not match raw samples`);
  if (stableJson(recomputed.observations) !== stableJson(report.observations)
    || stableJson(recomputed.metrics) !== stableJson(report.summary)
    || stableJson(recomputed.errors) !== stableJson(report.errors)
    || recomputed.passed !== report.passed) {
    errors.push(`${label}: declared supplemental result does not match raw samples`);
  }
  if (report.passed !== passed) errors.push(`${label}: passed must agree with the typed observations`);
  return report.passed === true && recomputed.passed === true && passed;
}

const RECEIPT_IDS_BY_GATE = Object.freeze({
  "core-compatibility": ["core-build", "core-unit", "core-determinism", "core-reducer", "core-save", "core-platform-services"],
  "browser-pwa": ["browser-supported", "browser-golden", "browser-pwa"],
  "asset-delivery": ["asset-package-audit", "asset-unselected-biomes"],
  "headless-performance": ["headless-performance"],
});

function validateCommandReceipts(gate, manifest, root, errors) {
  const expectedIds = RECEIPT_IDS_BY_GATE[gate.gateId];
  if (!expectedIds) return new Map();
  const references = gate.observations?.receipts;
  if (!Array.isArray(references)) {
    errors.push(`${gate.gateId}: observations.receipts must be an array`);
    return new Map();
  }
  const ids = references.map((reference) => reference?.receiptId);
  if (stableJson([...ids].sort()) !== stableJson([...expectedIds].sort())) errors.push(`${gate.gateId}: receipt IDs must be exactly ${expectedIds.join(", ")}`);
  const receipts = new Map();
  for (const [index, reference] of references.entries()) {
    const label = `${gate.gateId}.receipts[${index}]`;
    if (!exactKeys(reference, ["receiptId", "path", "sha256"], label, errors)) continue;
    const report = readTypedArtifact({ path: reference.path, sha256: reference.sha256 }, gate, root, label, errors);
    if (!report) continue;
    const inspected = inspectZk682CommandReceipt(report, { candidateCommit: manifest.candidateCommit, receiptId: reference.receiptId });
    if (!inspected.valid) errors.push(...inspected.errors.map((error) => `${label}: ${error}`));
    else receipts.set(reference.receiptId, inspected.passed);
  }
  return receipts;
}

function validateAssetDeliveryEvidence(report, manifest, gate, root, label, errors) {
  if (!exactKeys(report, ["schemaVersion", "gate", "candidateCommit", "capturedAt", "source", "browserBuild", "bundles", "atlases", "measurements", "passed"], label, errors)) return false;
  if (report.schemaVersion !== 1 || report.gate !== "asset-delivery") errors.push(`${label}: wrong asset evidence schema/gate`);
  if (report.candidateCommit !== manifest.candidateCommit) errors.push(`${label}: candidate commit mismatch`);
  if (!validCapturedAt(report.capturedAt)) errors.push(`${label}: capturedAt is invalid`);
  const source = readTypedArtifact(report.source, gate, root, `${label}.source`, errors);
  readTypedArtifact(report.browserBuild, gate, root, `${label}.browserBuild`, errors);
  const expectedBundles = Object.entries(source?.dist?.bundles ?? {}).flatMap(([theme, tiers]) => Object.entries(tiers ?? {}).map(([tier, bundle]) => ({ theme, tier, bytes: Number(bundle?.bytes) }))).sort((left, right) => `${left.theme}:${left.tier}`.localeCompare(`${right.theme}:${right.tier}`));
  if (stableJson(report.bundles) !== stableJson(expectedBundles)) errors.push(`${label}: bundle rows disagree with the M35 audit`);
  if (!Array.isArray(report.atlases) || report.atlases.length === 0 || report.atlases.some((entry) => !exactKeys(entry, ["path", "bytes", "sha256"], `${label}.atlas`, errors) || !safeRelativePath(entry.path) || !Number.isFinite(entry.bytes) || entry.bytes < 0 || !validSha(entry.sha256))) errors.push(`${label}: atlas rows are invalid`);
  const measurements = {
    initialCriticalBytes: Number(source?.initialCritical?.bytes),
    selectedBiomeMaxBytes: Math.max(...expectedBundles.map((entry) => entry.bytes)),
    individualAtlasMaxBytes: Math.max(...(Array.isArray(report.atlases) ? report.atlases.map((entry) => entry.bytes) : [])),
  };
  if (stableJson(report.measurements) !== stableJson(measurements)) errors.push(`${label}: measurements disagree with raw rows`);
  const passed = source?.ok === true
    && measurements.initialCriticalBytes <= ZK682_BUDGETS.initialCriticalBytes
    && measurements.selectedBiomeMaxBytes <= ZK682_BUDGETS.selectedBiomeBytes
    && measurements.individualAtlasMaxBytes <= ZK682_BUDGETS.individualAtlasBytes;
  if (report.passed !== passed) errors.push(`${label}: passed disagrees with recomputed asset evidence`);
  return passed;
}

function validateHeadlessPerformanceEvidence(report, manifest, gate, root, label, errors) {
  if (!exactKeys(report, ["schemaVersion", "gate", "candidateCommit", "capturedAt", "source", "budgets", "scenario", "measurements", "physicalDevice", "frameP95Asserted", "passed"], label, errors)) return false;
  if (report.schemaVersion !== 1 || report.gate !== "headless-performance") errors.push(`${label}: wrong headless evidence schema/gate`);
  if (report.candidateCommit !== manifest.candidateCommit) errors.push(`${label}: candidate commit mismatch`);
  const expectedBudgets = { rendererWorkMilliseconds: 8, coldStartupMilliseconds: 5_000, fixtureLoadMilliseconds: 6_000 };
  if (stableJson(report.budgets) !== stableJson(expectedBudgets)) errors.push(`${label}: timing budgets differ from the pinned 8/5000/6000 contract`);
  if (report.physicalDevice !== false || report.frameP95Asserted !== false) errors.push(`${label}: headless evidence cannot claim physical frame p95`);
  const source = readTypedArtifact(report.source, gate, root, `${label}.source`, errors);
  const measurements = { frameP95Ms: Number(source?.renderer?.p95Ms), rendererWorkMs: Number(source?.renderer?.workMs), coldStartupMs: Number(source?.coldStartupMs), fixtureLoadMs: Number(source?.fixtureLoadMs) };
  if (stableJson(report.measurements) !== stableJson(measurements) || Object.values(measurements).some((value) => !Number.isFinite(value) || value < 0)) errors.push(`${label}: measurements disagree with the raw performance source`);
  if (source?.effective?.fixture !== "m27Fixture" || source?.effective?.frameAssertion !== false || source?.effective?.budgets?.rendererWorkMilliseconds !== 8 || source?.effective?.budgets?.coldStartupMilliseconds !== 5_000) errors.push(`${label}: raw performance workload/budgets are not pinned`);
  const passed = measurements.rendererWorkMs <= 8 && measurements.coldStartupMs <= 5_000 && measurements.fixtureLoadMs <= 6_000;
  if (report.passed !== passed) errors.push(`${label}: passed disagrees with recomputed performance evidence`);
  return passed;
}

function validateCriterionResults(gateId, results, errors) {
  const expected = CRITERIA_BY_GATE.get(gateId) ?? [];
  if (!Array.isArray(results)) {
    errors.push(`${gateId}: criteria must be an array`);
    return;
  }
  const ids = results.map((entry) => entry?.id);
  if (stableJson([...ids].sort()) !== stableJson(expected.map((entry) => entry.id).sort())) {
    errors.push(`${gateId}: criteria must cover exactly ${expected.map((entry) => entry.id).join(", ")}`);
  }
  for (const [index, result] of results.entries()) {
    const label = `${gateId}.criteria[${index}]`;
    if (!exactKeys(result, ["id", "status", "summary"], label, errors)) continue;
    const criterion = CRITERIA_BY_ID.get(result.id);
    if (!criterion || criterion.gate !== gateId) continue;
    const allowed = criterion.requirement === "report-only" ? ["report-only"] : ["pass", "fail"];
    if (!allowed.includes(result.status)) errors.push(`${result.id}: status must be ${allowed.join(" or ")}`);
    if (typeof result.summary !== "string" || result.summary.length === 0) errors.push(`${result.id}: summary is required`);
  }
}

function expectBooleanObservation(observations, key, criterion, criteria, errors) {
  if (typeof observations?.[key] !== "boolean") errors.push(`${criterion}: observations.${key} must be boolean`);
  const status = criteria.find((entry) => entry.id === criterion)?.status;
  if (typeof observations?.[key] === "boolean" && (status === "pass") !== observations[key]) {
    errors.push(`${criterion}: declared status disagrees with observations.${key}`);
  }
}

function validateGateObservations(gate, manifest, root, errors) {
  const observations = gate.observations;
  if (!isRecord(observations)) {
    errors.push(`${gate.gateId}: observations must be an object`);
    return;
  }
  const criteria = gate.criteria;
  const receipts = validateCommandReceipts(gate, manifest, root, errors);
  if (gate.gateId === "provenance") {
    if (observations.dependencyLockSha256 !== manifest.dependencyLock.sha256) errors.push("provenance: dependency lock SHA-256 does not match the manifest");
    if (!Array.isArray(observations.buildArtifacts)) errors.push("provenance: buildArtifacts must be an array");
    else {
      const artifactKinds = [];
      for (const [index, artifact] of observations.buildArtifacts.entries()) {
        const label = `provenance: observations.buildArtifacts[${index}]`;
        if (!exactKeys(artifact, ["kind", "path", "sha256"], label, errors)) continue;
        artifactKinds.push(artifact.kind);
        const bound = gate.artifacts.some((entry) => entry.path === artifact.path && entry.sha256 === artifact.sha256);
        if (!bound) errors.push(`${label} must match a raw artifact binding by path and SHA-256`);
      }
      if (stableJson([...artifactKinds].sort()) !== stableJson(["browser-build", "packaged-electron"])) {
        errors.push("provenance: buildArtifacts must contain exactly browser-build and packaged-electron");
      }
    }
  } else if (gate.gateId === "core-compatibility") {
    exactKeys(observations, ["productionBuildPassed", "unitTestsPassed", "deterministicHashesPassed", "reducerPassed", "saveV25RoundTripPassed", "historicalMigrationsPassed", "platformServicesPassed", "receipts"], "core-compatibility.observations", errors);
    expectBooleanObservation(observations, "productionBuildPassed", "production-build-and-unit-gates", criteria, errors);
    if (typeof observations.unitTestsPassed !== "boolean") errors.push("production-build-and-unit-gates: observations.unitTestsPassed must be boolean");
    const buildAndUnitPass = observations.productionBuildPassed === true && observations.unitTestsPassed === true;
    if ((criteria.find((entry) => entry.id === "production-build-and-unit-gates")?.status === "pass") !== buildAndUnitPass) errors.push("production-build-and-unit-gates: declared status disagrees with build/unit observations");
    expectBooleanObservation(observations, "deterministicHashesPassed", "deterministic-hashes", criteria, errors);
    expectBooleanObservation(observations, "reducerPassed", "reducer-behavior", criteria, errors);
    expectBooleanObservation(observations, "saveV25RoundTripPassed", "save-v25-round-trip", criteria, errors);
    expectBooleanObservation(observations, "historicalMigrationsPassed", "historical-save-migrations", criteria, errors);
    expectBooleanObservation(observations, "platformServicesPassed", "platform-services", criteria, errors);
    const receiptExpectations = {
      productionBuildPassed: receipts.get("core-build"),
      unitTestsPassed: receipts.get("core-unit"),
      deterministicHashesPassed: receipts.get("core-determinism"),
      reducerPassed: receipts.get("core-reducer"),
      saveV25RoundTripPassed: receipts.get("core-save"),
      historicalMigrationsPassed: receipts.get("core-save"),
      platformServicesPassed: receipts.get("core-platform-services"),
    };
    for (const [key, value] of Object.entries(receiptExpectations)) if (typeof value === "boolean" && observations[key] !== value) errors.push(`core-compatibility: ${key} disagrees with its command receipt`);
  } else if (gate.gateId === "browser-pwa") {
    exactKeys(observations, ["browserPassed", "goldenE2ePassed", "offlineLaunchPassed", "browsers", "offlineIndexedDbEvidence", "receipts"], "browser-pwa.observations", errors);
    expectBooleanObservation(observations, "browserPassed", "browser-pwa-certification", criteria, errors);
    expectBooleanObservation(observations, "goldenE2ePassed", "golden-e2e", criteria, errors);
    expectBooleanObservation(observations, "offlineLaunchPassed", "offline-launch", criteria, errors);
    if (!Array.isArray(observations.browsers) || observations.browsers.length === 0) errors.push("browser-pwa: browsers must be recorded");
    const report = readTypedArtifact(observations.offlineIndexedDbEvidence, gate, root, "browser-pwa.offlineIndexedDbEvidence", errors);
    const passed = report ? validatePwaPersistenceEvidence(report, manifest, "browser-pwa.offlineIndexedDbEvidence", errors) : false;
    if (observations.offlineLaunchPassed !== passed) errors.push("offline-launch: declared status disagrees with typed IndexedDB evidence");
    if (receipts.has("browser-supported") && receipts.has("browser-pwa") && observations.browserPassed !== (receipts.get("browser-supported") && receipts.get("browser-pwa"))) errors.push("browser-pwa-certification: declared status disagrees with command receipts");
    if (receipts.has("browser-golden") && observations.goldenE2ePassed !== receipts.get("browser-golden")) errors.push("golden-e2e: declared status disagrees with command receipt");
    if (receipts.has("browser-pwa") && observations.offlineLaunchPassed !== (passed && receipts.get("browser-pwa"))) errors.push("offline-launch: declared status disagrees with PWA command receipt");
  } else if (gate.gateId === "packaged-desktop") {
    exactKeys(observations, ["packagedElectronPassed", "desktopPersistencePassed", "platforms", "persistenceEvidence"], "packaged-desktop.observations", errors);
    expectBooleanObservation(observations, "packagedElectronPassed", "packaged-electron-certification", criteria, errors);
    expectBooleanObservation(observations, "desktopPersistencePassed", "desktop-persistence", criteria, errors);
    const platforms = Array.isArray(observations.platforms) ? [...observations.platforms].sort() : [];
    if (stableJson(platforms) !== stableJson(["darwin", "win32"])) errors.push("packaged-desktop: platforms must contain darwin and win32");
    const persistenceEvidence = observations.persistenceEvidence;
    const evidencePlatforms = [];
    let evidencePassed = Array.isArray(persistenceEvidence) && persistenceEvidence.length === 2;
    if (!Array.isArray(persistenceEvidence)) errors.push("packaged-desktop: persistenceEvidence must be an array");
    else for (const [index, reference] of persistenceEvidence.entries()) {
      const label = `packaged-desktop.persistenceEvidence[${index}]`;
      if (!exactKeys(reference, ["platform", "architecture", "path", "sha256"], label, errors)) { evidencePassed = false; continue; }
      evidencePlatforms.push(reference.platform);
      if (typeof reference.architecture !== "string" || !reference.architecture) errors.push(`${label}: architecture is required`);
      const report = readTypedArtifact({ path: reference.path, sha256: reference.sha256 }, gate, root, label, errors);
      if (!report || report.platform !== reference.platform || report.architecture !== reference.architecture || !validateDesktopPersistenceEvidence(report, manifest, gate, root, label, errors)) evidencePassed = false;
    }
    if (stableJson([...evidencePlatforms].sort()) !== stableJson(["darwin", "win32"])) {
      errors.push("packaged-desktop: typed persistence evidence must contain exactly darwin and win32");
      evidencePassed = false;
    }
    if (observations.desktopPersistencePassed !== evidencePassed) errors.push("desktop-persistence: declared status disagrees with typed platform evidence");
  } else if (gate.gateId === "asset-delivery") {
    exactKeys(observations, ["initialCriticalBytes", "selectedBiomeMaxBytes", "individualAtlasMaxBytes", "unselectedBiomeAtlasesUnloaded", "packageSizeAndAssetAuditPassed", "receipts", "typedEvidence"], "asset-delivery.observations", errors);
    const checks = [
      ["initial-critical-assets", "initialCriticalBytes", ZK682_BUDGETS.initialCriticalBytes],
      ["selected-biome-payload", "selectedBiomeMaxBytes", ZK682_BUDGETS.selectedBiomeBytes],
      ["individual-atlas-payload", "individualAtlasMaxBytes", ZK682_BUDGETS.individualAtlasBytes],
    ];
    for (const [criterion, key, budget] of checks) {
      const value = observations[key];
      if (!Number.isFinite(value) || value < 0) errors.push(`${criterion}: observations.${key} must be a non-negative number`);
      else if ((criteria.find((entry) => entry.id === criterion)?.status === "pass") !== (value <= budget)) errors.push(`${criterion}: declared status disagrees with the ${budget}-byte budget`);
    }
    expectBooleanObservation(observations, "unselectedBiomeAtlasesUnloaded", "unselected-biomes-unloaded", criteria, errors);
    expectBooleanObservation(observations, "packageSizeAndAssetAuditPassed", "package-size-and-asset-audit", criteria, errors);
    const assetReport = readTypedArtifact(observations.typedEvidence, gate, root, "asset-delivery.typedEvidence", errors);
    const assetPassed = assetReport ? validateAssetDeliveryEvidence(assetReport, manifest, gate, root, "asset-delivery.typedEvidence", errors) : false;
    if (assetReport && (assetReport.measurements.initialCriticalBytes !== observations.initialCriticalBytes || assetReport.measurements.selectedBiomeMaxBytes !== observations.selectedBiomeMaxBytes || assetReport.measurements.individualAtlasMaxBytes !== observations.individualAtlasMaxBytes)) errors.push("asset-delivery: normalized measurements disagree with typed evidence");
    if (observations.packageSizeAndAssetAuditPassed && !assetPassed) errors.push("package-size-and-asset-audit: cannot pass when typed asset evidence failed");
    if (receipts.has("asset-unselected-biomes") && observations.unselectedBiomeAtlasesUnloaded !== receipts.get("asset-unselected-biomes")) errors.push("unselected-biomes-unloaded: declared status disagrees with command receipt");
    if (receipts.has("asset-package-audit") && observations.packageSizeAndAssetAuditPassed && !receipts.get("asset-package-audit")) errors.push("package-size-and-asset-audit: cannot pass when its command receipt failed");
  } else if (gate.gateId === "headless-performance") {
    const headlessReport = readTypedArtifact(observations.typedEvidence, gate, root, "headless-performance.typedEvidence", errors);
    if (headlessReport) {
      validateHeadlessPerformanceEvidence(headlessReport, manifest, gate, root, "headless-performance.typedEvidence", errors);
      if (stableJson(headlessReport.scenario) !== stableJson(observations.scenario) || headlessReport.measurements.frameP95Ms !== observations.frameP95Ms || headlessReport.measurements.rendererWorkMs !== observations.rendererWorkMs || headlessReport.measurements.coldStartupMs !== observations.coldStartupMs || headlessReport.measurements.fixtureLoadMs !== observations.fixtureLoadMs) errors.push("headless-performance: normalized observations disagree with typed evidence");
    }
    if (observations.physicalDevice !== false) errors.push("headless-performance: physicalDevice must be false");
    if (observations.frameP95Asserted !== false) errors.push("headless-performance: frameP95Asserted must be false");
    if (!Number.isFinite(observations.frameP95Ms) || observations.frameP95Ms < 0) errors.push("headless-performance: frameP95Ms must be reported");
    if (!Number.isFinite(observations.rendererWorkMs) || observations.rendererWorkMs < 0) errors.push("headless-performance: rendererWorkMs must be reported");
    if (observations.scenario?.holes !== 36 || observations.scenario?.golfers !== 100) errors.push("headless-performance: scenario must be 36 holes and 100 golfers");
    for (const key of ["biome", "season", "weather"]) if (typeof observations.scenario?.[key] !== "string" || !observations.scenario[key]) errors.push(`headless-performance: scenario.${key} is required`);
    const loadStatus = criteria.find((entry) => entry.id === "representative-36-hole-100-golfer-load")?.status;
    if ((loadStatus === "pass") !== (observations.rendererWorkMs <= ZK682_BUDGETS.rendererWorkMilliseconds)) errors.push("representative-36-hole-100-golfer-load: declared status disagrees with the renderer-work budget");
    if (criteria.find((entry) => entry.id === "headless-frame-p95-report-only")?.status !== "report-only") errors.push("headless frame p95 must remain report-only");
    for (const key of ["coldStartupMs", "coldStartupBudgetMs", "fixtureLoadMs", "fixtureLoadBudgetMs"]) if (!Number.isFinite(observations[key]) || observations[key] < 0) errors.push(`headless-performance: observations.${key} must be non-negative`);
    if (observations.coldStartupBudgetMs !== ZK682_BUDGETS.coldStartupMilliseconds) errors.push("headless-performance: cold startup budget must remain 5000 ms");
    if (observations.fixtureLoadBudgetMs !== ZK682_BUDGETS.fixtureLoadMilliseconds) errors.push("headless-performance: fixture load budget must remain 6000 ms");
    const startupPassed = observations.coldStartupMs <= observations.coldStartupBudgetMs
      && observations.fixtureLoadMs <= observations.fixtureLoadBudgetMs;
    if ((criteria.find((entry) => entry.id === "startup-and-fixture-load")?.status === "pass") !== startupPassed) errors.push("startup-and-fixture-load: declared status disagrees with observed timings and budgets");
  } else if (gate.gateId === "stability") {
    exactKeys(observations, ["routeChangesStable", "saveLoadsStable", "longSessionStable", "interactionRecoveryPassed", "routeChanges", "saveLoads", "sessionMinutes", "resourceGrowthEvidence", "saveLoadEvidence", "longSessionEvidence", "interactionRecoveryEvidence", "rendererCompleteness"], "stability.observations", errors);
    expectBooleanObservation(observations, "routeChangesStable", "route-change-resource-stability", criteria, errors);
    expectBooleanObservation(observations, "saveLoadsStable", "save-load-resource-stability", criteria, errors);
    expectBooleanObservation(observations, "longSessionStable", "long-session-resource-stability", criteria, errors);
    expectBooleanObservation(observations, "interactionRecoveryPassed", "editing-overlay-sleep-recovery", criteria, errors);
    for (const key of ["routeChanges", "saveLoads", "sessionMinutes"]) if (!Number.isFinite(observations[key]) || observations[key] <= 0) errors.push(`stability: observations.${key} must be positive`);
    const resourceReport = readTypedArtifact(observations.resourceGrowthEvidence, gate, root, "stability.resourceGrowthEvidence", errors);
    let completenessPassed = false;
    const complete = observations.rendererCompleteness;
    if (exactKeys(complete, ["protocol", "cleanup", "capture", "command", "png"], "stability.rendererCompleteness", errors)) {
      if (complete.protocol !== ZK682_RENDERER_COMPLETENESS_PROTOCOL) errors.push("renderer completeness protocol mismatch");
      const cleanup = readTypedArtifact(complete.cleanup, gate, root, "renderer cleanup", errors);
      const capture = readTypedArtifact(complete.capture, gate, root, "renderer capture", errors);
      const commandReceipt = readTypedArtifact(complete.command, gate, root, "renderer command", errors);
      let png;
      if (exactKeys(complete.png, ["path", "sha256"], "renderer PNG reference", errors) && safeRelativePath(complete.png.path) && validSha(complete.png.sha256) && artifactIsBound(gate, complete.png)) {
        try { png = readBoundFile(root, complete.png.path, 12 * 1024 * 1024); if (sha256(png) !== complete.png.sha256) throw Error("hash mismatch"); } catch (error) { errors.push(`renderer PNG: ${error.message}`); }
      } else errors.push("renderer PNG requires safe hash-bound artifact reference");
      const inspected = inspectZk682RendererCompleteness({ candidateCommit: manifest.candidateCommit, resource: resourceReport, cleanup, capture, commandReceipt, png });
      errors.push(...inspected.errors); completenessPassed = inspected.passed && complete.protocol === ZK682_RENDERER_COMPLETENESS_PROTOCOL;
    }
    const resourceNumericPassed = resourceReport ? validateResourceGrowthEvidence(resourceReport, manifest, "stability.resourceGrowthEvidence", errors) : false;
    const resourcePassed = resourceNumericPassed && completenessPassed;
    if (observations.routeChangesStable !== resourcePassed) errors.push("route-change-resource-stability: declared status disagrees with typed renderer resource-growth evidence");
    const supplemental = [
      ["saveLoadEvidence", "save-load-resource-stability", "saveLoadsStable", "saveLoads"],
      ["longSessionEvidence", "long-session-resource-stability", "longSessionStable", "sessionMinutes"],
      ["interactionRecoveryEvidence", "editing-overlay-sleep-recovery", "interactionRecoveryPassed", null],
    ];
    for (const [referenceKey, expectedGate, observationKey, countKey] of supplemental) {
      const label = `stability.${referenceKey}`;
      const report = readTypedArtifact(observations[referenceKey], gate, root, label, errors);
      const passed = report ? validateSupplementalStabilityEvidence(report, expectedGate, manifest, label, errors) : false;
      if (countKey && report?.observations?.[countKey] !== observations[countKey]) errors.push(`${label}: normalized count disagrees with typed evidence`);
      if (observations[observationKey] !== passed) errors.push(`${expectedGate}: declared status disagrees with typed evidence`);
    }
  } else if (gate.gateId === "physical-midrange" || gate.gateId === "physical-lowend") {
    if (observations.physicalDevice !== true) errors.push(`${gate.gateId}: physicalDevice must be true`);
    if (observations.scenario?.holes !== 36 || observations.scenario?.golfers !== 100) errors.push(`${gate.gateId}: scenario must be 36 holes and 100 golfers`);
    for (const key of ["hardwareClass", "device", "operatingSystem", "powerMode", "graphicsBackend"]) if (typeof observations[key] !== "string" || !observations[key]) errors.push(`${gate.gateId}: observations.${key} is required`);
    for (const key of ["biome", "season", "weather"]) if (typeof observations.scenario?.[key] !== "string" || !observations.scenario[key]) errors.push(`${gate.gateId}: scenario.${key} is required`);
    if (!Number.isFinite(observations.frameP95Ms) || observations.frameP95Ms < 0) errors.push(`${gate.gateId}: frameP95Ms must be reported`);
    const expectedClass = gate.gateId === "physical-midrange" ? "midrange" : "low-end";
    if (observations.hardwareClass !== expectedClass) errors.push(`${gate.gateId}: hardwareClass must be ${expectedClass}`);
    const raw = readTypedArtifact(observations.physicalEvidence, gate, root, `${gate.gateId}.physicalEvidence`, errors);
    if (raw && (raw.gate !== gate.gateId || raw.hardwareClass !== expectedClass || raw.candidateCommit !== manifest.candidateCommit || raw.frameP95Ms !== observations.frameP95Ms || stableJson(raw.scenario) !== stableJson(observations.scenario))) errors.push(`${gate.gateId}: normalized observations disagree with typed physical evidence`);
  }
}

function validateGateResult(gate, manifest, root, errors) {
  const gateId = gate?.gateId;
  const contract = ZK682_GATE_CONTRACTS[gateId];
  if (!exactKeys(gate, ["schemaVersion", "certificationId", "gateId", "candidateCommit", "classification", "status", "command", "environment", "criteria", "observations", "artifacts"], `gate ${String(gateId)}`, errors)) return;
  if (gate.schemaVersion !== ZK682_SCHEMA_VERSION) errors.push(`${gateId}: schemaVersion must be ${ZK682_SCHEMA_VERSION}`);
  if (gate.certificationId !== ZK682_CERTIFICATION_ID) errors.push(`${gateId}: certificationId is invalid`);
  if (!contract) {
    errors.push(`unknown gate result: ${String(gateId)}`);
    return;
  }
  if (gate.candidateCommit !== manifest.candidateCommit) errors.push(`${gateId}: candidate commit mismatch`);
  if (gate.classification !== contract.classification) errors.push(`${gateId}: classification must be ${contract.classification}`);
  if (!["pass", "fail"].includes(gate.status)) errors.push(`${gateId}: status must be pass or fail`);
  if (typeof gate.command !== "string" || !gate.command) errors.push(`${gateId}: command is required`);
  if (!isRecord(gate.environment)) errors.push(`${gateId}: environment must be an object`);
  validateCriterionResults(gateId, gate.criteria, errors);
  if (Array.isArray(gate.criteria)) {
    const decisive = gate.criteria.filter((entry) => entry.status !== "report-only");
    const expectedStatus = decisive.every((entry) => entry.status === "pass") ? "pass" : "fail";
    if (gate.status !== expectedStatus) errors.push(`${gateId}: gate status disagrees with criterion results`);
  }
  if (!Array.isArray(gate.artifacts) || gate.artifacts.length === 0) errors.push(`${gateId}: at least one raw artifact binding is required`);
  else for (const [index, artifact] of gate.artifacts.entries()) {
    const label = `${gateId}.artifacts[${index}]`;
    if (!exactKeys(artifact, ["path", "sha256"], label, errors)) continue;
    if (!safeRelativePath(artifact.path)) { errors.push(`${label}.path is unsafe`); continue; }
    if (!validSha(artifact.sha256)) { errors.push(`${label}.sha256 is invalid`); continue; }
    try {
      if (!existsSync(resolve(root, artifact.path))) errors.push(`${gateId}: missing raw artifact: ${artifact.path}`);
      else if (sha256(readBoundFile(root, artifact.path)) !== artifact.sha256) errors.push(`${gateId}: raw artifact SHA-256 mismatch: ${artifact.path}`);
    } catch (error) {
      errors.push(`${gateId}: ${error.message}`);
    }
  }
  validateGateObservations(gate, manifest, root, errors);
}

function validateExceptions(exceptions, errors) {
  if (!Array.isArray(exceptions)) {
    errors.push("exceptions must be an array");
    return;
  }
  const seen = new Set();
  for (const [index, exception] of exceptions.entries()) {
    const label = `exceptions[${index}]`;
    if (!exactKeys(exception, ["criterionId", "evidence", "playerImpact", "owner", "followUpIssue", "approvedMinimumSpecAdjustment"], label, errors)) continue;
    if (!CRITERIA_BY_ID.has(exception.criterionId)) errors.push(`${label}: unknown criterionId`);
    if (seen.has(exception.criterionId)) errors.push(`${label}: duplicate criterion exception`);
    seen.add(exception.criterionId);
    for (const key of ["evidence", "playerImpact", "owner"]) if (typeof exception[key] !== "string" || !exception[key]) errors.push(`${label}.${key} is required`);
    if (typeof exception.followUpIssue !== "string" || !/^ZK-\d+$/.test(exception.followUpIssue)) errors.push(`${label}.followUpIssue must be a ZK issue identifier`);
    if (typeof exception.approvedMinimumSpecAdjustment !== "boolean") errors.push(`${label}.approvedMinimumSpecAdjustment must be boolean`);
    if (exception.approvedMinimumSpecAdjustment && exception.criterionId !== "low-end-physical-p95") errors.push(`${label}: only low-end physical p95 may use a minimum-spec adjustment`);
  }
}

export function validateZk682EvidenceManifest(manifest, options) {
  const errors = [];
  const gateResults = new Map();
  if (!exactKeys(manifest, ["schemaVersion", "certificationId", "candidateCommit", "dependencyLock", "gateResults", "exceptions"], "manifest", errors)) return { errors, gateResults };
  if (manifest.schemaVersion !== ZK682_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ZK682_SCHEMA_VERSION}`);
  if (manifest.certificationId !== ZK682_CERTIFICATION_ID) errors.push(`certificationId must be ${ZK682_CERTIFICATION_ID}`);
  if (typeof manifest.candidateCommit !== "string" || !/^[0-9a-f]{40}$/.test(manifest.candidateCommit)) errors.push("candidateCommit must be a full 40-character commit SHA");
  if (options.expectedCommit && manifest.candidateCommit !== options.expectedCommit) errors.push(`candidateCommit ${manifest.candidateCommit} does not match expected commit ${options.expectedCommit}`);
  if (options.commitExists && !options.commitExists(manifest.candidateCommit)) errors.push(`candidate commit object is unavailable: ${manifest.candidateCommit}`);
  if (exactKeys(manifest.dependencyLock, ["path", "sha256"], "dependencyLock", errors)) {
    if (manifest.dependencyLock.path !== "package-lock.json") errors.push("dependencyLock.path must be package-lock.json");
    if (!validSha(manifest.dependencyLock.sha256)) errors.push("dependencyLock.sha256 is invalid");
    if (options.readCandidateFile && validSha(manifest.dependencyLock.sha256)) {
      try {
        const actual = sha256(options.readCandidateFile(manifest.candidateCommit, manifest.dependencyLock.path));
        if (actual !== manifest.dependencyLock.sha256) errors.push("dependency lock SHA-256 does not match the candidate commit");
      } catch (error) {
        errors.push(`unable to read dependency lock from candidate commit: ${error.message}`);
      }
    }
  }
  if (!Array.isArray(manifest.gateResults)) errors.push("gateResults must be an array");
  else for (const [index, descriptor] of manifest.gateResults.entries()) {
    const label = `gateResults[${index}]`;
    if (!exactKeys(descriptor, ["gateId", "path", "sha256"], label, errors)) continue;
    if (!ZK682_GATE_CONTRACTS[descriptor.gateId]) errors.push(`${label}: unknown gateId`);
    if (gateResults.has(descriptor.gateId)) errors.push(`${label}: duplicate gateId ${descriptor.gateId}`);
    if (!safeRelativePath(descriptor.path)) { errors.push(`${label}.path is unsafe`); continue; }
    if (!validSha(descriptor.sha256)) { errors.push(`${label}.sha256 is invalid`); continue; }
    let bytes;
    try {
      bytes = readBoundFile(options.root, descriptor.path);
    } catch (error) {
      errors.push(`${label}: missing gate result ${descriptor.path}: ${error.message}`);
      continue;
    }
    if (sha256(bytes) !== descriptor.sha256) {
      errors.push(`${label}: gate result SHA-256 mismatch: ${descriptor.path}`);
      continue;
    }
    let gate;
    try { gate = JSON.parse(bytes); } catch (error) {
      errors.push(`${label}: invalid gate result JSON: ${error.message}`);
      continue;
    }
    if (gate.gateId !== descriptor.gateId) errors.push(`${label}: descriptor gateId does not match result`);
    validateGateResult(gate, manifest, options.root, errors);
    gateResults.set(descriptor.gateId, { descriptor, result: gate });
  }
  for (const [gateId, contract] of Object.entries(ZK682_GATE_CONTRACTS)) {
    if (contract.required && !gateResults.has(gateId)) errors.push(`missing required machine gate result: ${gateId}`);
  }
  const headlessScenario = gateResults.get("headless-performance")?.result?.observations?.scenario;
  for (const gateId of ["physical-midrange", "physical-lowend"]) {
    const physicalScenario = gateResults.get(gateId)?.result?.observations?.scenario;
    if (physicalScenario && stableJson(physicalScenario) !== stableJson(headlessScenario)) errors.push(`${gateId}: physical scenario must exactly match headless performance evidence`);
  }
  validateExceptions(manifest.exceptions, errors);
  return { errors, gateResults };
}

function physicalCriterionStatus(criterion, gateResults, manifest) {
  const gate = gateResults.get(criterion.gate)?.result;
  if (!gate) return { status: "missing", summary: "No physical-device evidence was supplied." };
  const declared = gate.criteria.find((entry) => entry.id === criterion.id);
  const p95 = gate.observations.frameP95Ms;
  if (criterion.id === "midrange-physical-p95") {
    const pass = declared.status === "pass" && p95 <= ZK682_BUDGETS.midrangeP95Milliseconds;
    return { status: pass ? "pass" : "fail", summary: declared.summary, observedP95Ms: p95, budgetP95Ms: ZK682_BUDGETS.midrangeP95Milliseconds };
  }
  const adjustment = manifest.exceptions.find((entry) => entry.criterionId === criterion.id && entry.approvedMinimumSpecAdjustment);
  const pass = declared.status === "pass" && (p95 <= ZK682_BUDGETS.lowEndP95Milliseconds || Boolean(adjustment));
  return { status: pass ? "pass" : "fail", summary: declared.summary, observedP95Ms: p95, budgetP95Ms: ZK682_BUDGETS.lowEndP95Milliseconds, approvedMinimumSpecAdjustment: adjustment ?? null };
}

export function buildZk682Report(manifest, options) {
  const validation = validateZk682EvidenceManifest(manifest, options);
  if (validation.errors.length) throw new Error(`ZK-682 evidence is invalid:\n${validation.errors.join("\n")}`);
  const criteria = ZK682_CRITERIA.map((criterion) => {
    if (criterion.requirement === "physical") return { ...criterion, ...physicalCriterionStatus(criterion, validation.gateResults, manifest) };
    const gate = validation.gateResults.get(criterion.gate).result;
    const result = gate.criteria.find((entry) => entry.id === criterion.id);
    return { ...criterion, status: result.status, summary: result.summary };
  });
  const machinePassed = criteria.filter((criterion) => criterion.requirement === "machine").every((criterion) => criterion.status === "pass");
  const physicalPassed = criteria.filter((criterion) => criterion.requirement === "physical").every((criterion) => criterion.status === "pass");
  const decision = machinePassed && physicalPassed ? "GO" : "HOLD";
  const blockers = criteria.filter((criterion) => criterion.requirement !== "report-only" && criterion.status !== "pass").map((criterion) => ({
    criterionId: criterion.id,
    status: criterion.status,
    summary: criterion.summary,
    exception: manifest.exceptions.find((entry) => entry.criterionId === criterion.id) ?? null,
  }));
  const gateResults = [...validation.gateResults.values()].map(({ descriptor, result }) => ({
    gateId: result.gateId,
    classification: result.classification,
    status: result.status,
    candidateCommit: result.candidateCommit,
    command: result.command,
    environment: result.environment,
    observations: result.observations,
    resultArtifact: descriptor,
    rawArtifacts: result.artifacts,
  })).sort((left, right) => left.gateId.localeCompare(right.gateId));
  const reportWithoutDigest = {
    schemaVersion: ZK682_REPORT_VERSION,
    certificationId: ZK682_CERTIFICATION_ID,
    issue: "ZK-682",
    candidateCommit: manifest.candidateCommit,
    dependencyLock: manifest.dependencyLock,
    decision,
    machinePassed,
    physicalPassed,
    criteria,
    blockers,
    exceptions: manifest.exceptions,
    gateResults,
    limitations: [
      "Headless frame p95 is report-only and never satisfies either physical-device criterion.",
      "GO requires both physical midrange and low-end evidence; absent physical evidence produces HOLD.",
      "Offline IndexedDB, packaged native persistence, and renderer resource-growth evidence are schema-validated and candidate-bound.",
      "Renderer resource-growth satisfies only route/resource stability; save-load, long-session, and interaction recovery retain separate typed machine evidence.",
    ],
  };
  return { ...reportWithoutDigest, reportDigest: sha256(`${stableJson(reportWithoutDigest)}\n`) };
}

export function zk682ReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function zk682ReportMarkdown(report) {
  const rows = report.criteria.map((criterion) => `| ${criterion.id} | ${criterion.requirement} | ${criterion.status} | ${criterion.title} |`);
  const blockers = report.blockers.length
    ? report.blockers.map((blocker) => `- **${blocker.criterionId}** (${blocker.status}): ${blocker.summary}`).join("\n")
    : "- None.";
  return `# ZK-682 architecture-slice certification\n\n` +
    `**Decision: ${report.decision}**\n\n` +
    `Candidate commit: \`${report.candidateCommit}\`  \n` +
    `Dependency lock SHA-256: \`${report.dependencyLock.sha256}\`  \n` +
    `Report digest: \`${report.reportDigest}\`\n\n` +
    `Machine gates: ${report.machinePassed ? "PASS" : "FAIL"}  \n` +
    `Physical-device gates: ${report.physicalPassed ? "PASS" : "INCOMPLETE/FAIL"}\n\n` +
    `## Criteria\n\n| Criterion | Requirement | Status | Contract |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n` +
    `## Blockers\n\n${blockers}\n\n` +
    `## Evidence boundary\n\n${report.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

export const ZK682_RENDERER_COMPLETENESS_PROTOCOL = "renderer-producer-complete-v1";
export function inspectZk682RendererCompleteness({ candidateCommit, resource, cleanup, capture, commandReceipt, png }) {
  const errors = [], fail = message => errors.push(message);
  const keys = (value, expected, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || stableJson(Object.keys(value).sort()) !== stableJson([...expected].sort())) { fail(`${label}: exact keys required`); return false; }
    return true;
  };
  const receipt = inspectZk682CommandReceipt(commandReceipt, { candidateCommit, receiptId: "renderer-resource-growth" });
  if (!Array.isArray(commandReceipt?.command) || !["npx", "npx.cmd"].includes(commandReceipt.command[0]) || stableJson(commandReceipt.command.slice(1)) !== stableJson(["playwright", "test", "e2e/zk682-resource-growth.e2e.ts", "--workers=1", "--retries=0"])) fail("renderer command argv mismatch");
  if (!receipt.valid || !receipt.passed) fail(`renderer command did not pass: ${receipt.errors.join("; ")}`);
  if (!resource || resource.source?.commit !== candidateCommit || !Array.isArray(resource.samples) || resource.samples.length !== 7 || resource.samples.some((s, i) => s?.cycle !== i)) fail("renderer resource requires seven ordered cycles 0..6");
  if (keys(cleanup, ["measurementProtocol", "preserves", "samples"], "cleanup")) {
    if (cleanup.measurementProtocol !== "exclusive-react-development-component-measures-cleared-before-existing-gc-v1" || cleanup.preserves !== "same-name collisions, scheduler and application measures") fail("cleanup protocol mismatch");
    if (!Array.isArray(cleanup.samples) || cleanup.samples.length !== 7) fail("cleanup requires seven samples");
    else cleanup.samples.forEach((sample, cycle) => {
      if (!keys(sample, ["cycle", "cleanup"], "cleanup sample")) return;
      if (sample.cycle !== cycle) fail("cleanup cycles must be 0..6 in order");
      const fields = ["measureEntriesBefore", "reactComponentEntriesBefore", "clearedEntries", "clearedNames", "preservedCollisionNames", "measureEntriesAfter"];
      if (keys(sample.cleanup, fields, "cleanup counts")) {
        const c = sample.cleanup;
        if (fields.some(k => !Number.isSafeInteger(c[k]) || c[k] < 0) || c.reactComponentEntriesBefore > c.measureEntriesBefore || c.clearedEntries > c.reactComponentEntriesBefore || c.clearedNames > c.clearedEntries || c.measureEntriesAfter !== c.measureEntriesBefore - c.clearedEntries) fail("cleanup counts invalid");
      }
    });
  }
  if (keys(capture, ["method", "clip", "before", "after", "bytes", "sha256", "qualification"], "capture")) {
    if (capture.method !== "public-page-screenshot-canvas-viewport-clip-v1" || typeof capture.qualification !== "string" || !capture.qualification) fail("capture method/qualification invalid");
    const fields = ["current", "connected", "visible", "tag", "x", "y", "width", "height", "viewportWidth", "viewportHeight", "intrinsicWidth", "intrinsicHeight", "dpr", "zoom"];
    const before = capture.before, after = capture.after;
    if (keys(before, fields, "capture before") && keys(after, fields, "capture after")) {
      if (stableJson(before) !== stableJson(after)) fail("capture pre/post state changed");
      if (before.current !== true || before.connected !== true || before.visible !== true || before.tag !== "CANVAS" || before.dpr !== 1 || before.zoom !== 1) fail("capture current visible connected DPR1 canvas required");
      const numeric = fields.filter(k => !["current", "connected", "visible", "tag"].includes(k));
      if (numeric.some(k => !Number.isFinite(before[k])) || before.width <= 0 || before.height <= 0 || before.intrinsicWidth <= 0 || before.intrinsicHeight <= 0 || before.x < 0 || before.y < 0 || before.x + before.width > before.viewportWidth || before.y + before.height > before.viewportHeight) fail("capture raw geometry invalid");
      const x = Math.floor(before.x + 0.001), y = Math.floor(before.y + 0.001);
      const expected = { x, y, width: Math.ceil(before.x + before.width - 0.001) - x, height: Math.ceil(before.y + before.height - 0.001) - y };
      if (!keys(capture.clip, ["x", "y", "width", "height"], "capture clip") || stableJson(capture.clip) !== stableJson(expected) || Object.values(expected).some(v => !Number.isSafeInteger(v)) || expected.width <= 0 || expected.height <= 0 || x < 0 || y < 0 || x + expected.width > before.viewportWidth || y + expected.height > before.viewportHeight) fail("capture integer clip mismatch");
    }
    if (!Buffer.isBuffer(png) || png.length < 24 || png.length > 12 * 1024 * 1024 || capture.bytes !== png.length || capture.sha256 !== sha256(png)) fail("capture PNG bytes/hash mismatch");
    else {
      try {
        if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.subarray(12, 16).toString() !== "IHDR") throw Error("PNG signature/header");
        if (png.length < 33 || png.readUInt32BE(8) !== 13 || png[24] !== 8 || ![2, 6].includes(png[25]) || png[26] !== 0 || png[27] !== 0 || png[28] !== 0) throw Error("Unsupported PNG encoding: require 8-bit RGB/RGBA, compression/filter0 and noninterlaced IHDR before decode");
        let offset = 8, seenIdat = false, seenIend = false;
        while (offset < png.length) {
          if (offset + 12 > png.length) throw Error("PNG chunk extent invalid");
          const length = png.readUInt32BE(offset), type = png.subarray(offset + 4, offset + 8).toString("ascii");
          const end = offset + 12 + length;
          if (end > png.length) throw Error("PNG chunk extent invalid");
          if (type === "IHDR" && offset !== 8) throw Error("PNG duplicate IHDR invalid");
          if (type === "IDAT") seenIdat = true;
          if (type === "IEND") {
            if (length !== 0 || end !== png.length) throw Error("PNG IEND must be terminal without trailing data");
            seenIend = true;
          }
          offset = end;
        }
        if (!seenIdat || !seenIend) throw Error("PNG IDAT and terminal IEND required");
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
        if (width !== capture.clip?.width || height !== capture.clip?.height || width * height > 16 * 1024 * 1024) throw Error("PNG dimensions");
        const decoded = PNG.sync.read(png, { checkCRC: true });
        if (decoded.width !== width || decoded.height !== height) throw Error("PNG decode dimensions");
        const first = decoded.data.readUInt32BE(0); let differing = false, visible = false;
        for (let offset = 0; offset < decoded.data.length; offset += 4) {
          if (decoded.data.readUInt32BE(offset) !== first) differing = true;
          if (decoded.data[offset + 3] > 0) visible = true;
        }
        if (!differing || !visible) throw Error("PNG must contain nonuniform visible pixels; scene coherence still requires manual QA");
      } catch (error) { fail(`renderer PNG invalid: ${error.message}`); }
    }
  }
  return { valid: errors.length === 0, passed: errors.length === 0, errors };
}
