import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

export const ZK682_SCHEMA_VERSION = 1;
export const ZK682_CERTIFICATION_ID = "zk682-architecture-slice-certification-v1";
export const ZK682_REPORT_VERSION = 1;

const MiB = 1024 * 1024;
export const ZK682_BUDGETS = Object.freeze({
  rendererWorkMilliseconds: 8,
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

function readBoundFile(root, path) {
  if (!safeRelativePath(path)) throw new Error(`unsafe evidence path: ${String(path)}`);
  const absolute = resolve(root, path);
  const normalizedRoot = resolve(root);
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`evidence path escapes the package root: ${path}`);
  }
  return readFileSync(absolute);
}

function validSha(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
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

function validateGateObservations(gate, manifest, errors) {
  const observations = gate.observations;
  if (!isRecord(observations)) {
    errors.push(`${gate.gateId}: observations must be an object`);
    return;
  }
  const criteria = gate.criteria;
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
    expectBooleanObservation(observations, "productionBuildPassed", "production-build-and-unit-gates", criteria, errors);
    if (typeof observations.unitTestsPassed !== "boolean") errors.push("production-build-and-unit-gates: observations.unitTestsPassed must be boolean");
    const buildAndUnitPass = observations.productionBuildPassed === true && observations.unitTestsPassed === true;
    if ((criteria.find((entry) => entry.id === "production-build-and-unit-gates")?.status === "pass") !== buildAndUnitPass) errors.push("production-build-and-unit-gates: declared status disagrees with build/unit observations");
    expectBooleanObservation(observations, "deterministicHashesPassed", "deterministic-hashes", criteria, errors);
    expectBooleanObservation(observations, "reducerPassed", "reducer-behavior", criteria, errors);
    expectBooleanObservation(observations, "saveV25RoundTripPassed", "save-v25-round-trip", criteria, errors);
    expectBooleanObservation(observations, "historicalMigrationsPassed", "historical-save-migrations", criteria, errors);
    expectBooleanObservation(observations, "platformServicesPassed", "platform-services", criteria, errors);
  } else if (gate.gateId === "browser-pwa") {
    expectBooleanObservation(observations, "browserPassed", "browser-pwa-certification", criteria, errors);
    expectBooleanObservation(observations, "goldenE2ePassed", "golden-e2e", criteria, errors);
    expectBooleanObservation(observations, "offlineLaunchPassed", "offline-launch", criteria, errors);
    if (!Array.isArray(observations.browsers) || observations.browsers.length === 0) errors.push("browser-pwa: browsers must be recorded");
  } else if (gate.gateId === "packaged-desktop") {
    expectBooleanObservation(observations, "packagedElectronPassed", "packaged-electron-certification", criteria, errors);
    expectBooleanObservation(observations, "desktopPersistencePassed", "desktop-persistence", criteria, errors);
    const platforms = Array.isArray(observations.platforms) ? [...observations.platforms].sort() : [];
    if (stableJson(platforms) !== stableJson(["darwin", "win32"])) errors.push("packaged-desktop: platforms must contain darwin and win32");
  } else if (gate.gateId === "asset-delivery") {
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
  } else if (gate.gateId === "headless-performance") {
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
    const startupPassed = observations.coldStartupMs <= observations.coldStartupBudgetMs
      && observations.fixtureLoadMs <= observations.fixtureLoadBudgetMs;
    if ((criteria.find((entry) => entry.id === "startup-and-fixture-load")?.status === "pass") !== startupPassed) errors.push("startup-and-fixture-load: declared status disagrees with observed timings and budgets");
  } else if (gate.gateId === "stability") {
    expectBooleanObservation(observations, "routeChangesStable", "route-change-resource-stability", criteria, errors);
    expectBooleanObservation(observations, "saveLoadsStable", "save-load-resource-stability", criteria, errors);
    expectBooleanObservation(observations, "longSessionStable", "long-session-resource-stability", criteria, errors);
    expectBooleanObservation(observations, "interactionRecoveryPassed", "editing-overlay-sleep-recovery", criteria, errors);
    for (const key of ["routeChanges", "saveLoads", "sessionMinutes"]) if (!Number.isFinite(observations[key]) || observations[key] <= 0) errors.push(`stability: observations.${key} must be positive`);
  } else if (gate.gateId === "physical-midrange" || gate.gateId === "physical-lowend") {
    if (observations.physicalDevice !== true) errors.push(`${gate.gateId}: physicalDevice must be true`);
    if (observations.scenario?.holes !== 36 || observations.scenario?.golfers !== 100) errors.push(`${gate.gateId}: scenario must be 36 holes and 100 golfers`);
    for (const key of ["hardwareClass", "device", "operatingSystem", "powerMode", "graphicsBackend"]) if (typeof observations[key] !== "string" || !observations[key]) errors.push(`${gate.gateId}: observations.${key} is required`);
    for (const key of ["biome", "season", "weather"]) if (typeof observations.scenario?.[key] !== "string" || !observations.scenario[key]) errors.push(`${gate.gateId}: scenario.${key} is required`);
    if (!Number.isFinite(observations.frameP95Ms) || observations.frameP95Ms < 0) errors.push(`${gate.gateId}: frameP95Ms must be reported`);
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
  validateGateObservations(gate, manifest, errors);
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
      "This report aggregates evidence and does not implement missing PWA IndexedDB, packaged native-save, or renderer-leak gates.",
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
