import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { certifyOfflineIndexedDbSave } from "./pwa-save-evidence.mjs";
import { validateZk682DesktopPersistenceSequence } from "./zk682-desktop-persistence-contract.mjs";
import { evaluateZk682ResourceGrowth, ZK682_RESOURCE_GROWTH_THRESHOLDS } from "./zk682-resource-growth-contract.mjs";
import { inspectZk682CommandReceipt } from "./zk682-command-receipt.mjs";
import {
  ZK682_BUDGETS,
  ZK682_CERTIFICATION_ID,
  ZK682_CRITERIA,
  ZK682_GATE_CONTRACTS,
  ZK682_SCHEMA_VERSION,
  sha256,
  stableJson,
} from "./zk682-certification-contract.mjs";

export const ZK682_FIXED_EVIDENCE_ROOT = "artifacts/zk682/raw";
export const ZK682_PACKET_DIRECTORY = "release/zk682";
export const ZK682_PACKET_RECEIPTS = Object.freeze({
  "core-build": "core-build.json",
  "core-unit": "core-unit.json",
  "core-determinism": "core-determinism.json",
  "core-reducer": "core-reducer.json",
  "core-save": "core-save.json",
  "core-platform-services": "core-platform-services.json",
  "browser-supported": "browser-supported.json",
  "browser-golden": "browser-golden.json",
  "browser-pwa": "browser-pwa.json",
  "asset-package-audit": "asset-package-audit.json",
  "asset-unselected-biomes": "asset-unselected-biomes.json",
  "headless-performance": "headless-performance-command.json",
});

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fullCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const fullDigest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const finiteNonnegative = (value) => Number.isFinite(value) && value >= 0;

function exactKeys(value, keys, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (stableJson(Object.keys(value).sort()) !== stableJson([...keys].sort())) {
    throw new Error(`${label} keys must be exactly ${[...keys].sort().join(", ")}`);
  }
}

function git(root, args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: root, encoding });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? "").trim()}`);
  return result.stdout;
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : entry.isFile() ? [path] : [];
  });
}

function createContext(root, candidateCommit, evidenceRoot) {
  if (!fullCommit(candidateCommit)) throw new Error("candidate must be a full 40-character commit SHA");
  if (evidenceRoot !== ZK682_FIXED_EVIDENCE_ROOT) throw new Error(`evidence root must be exactly ${ZK682_FIXED_EVIDENCE_ROOT}`);
  const resolvedRoot = realpathSync(resolve(root));
  const rawRoot = resolve(resolvedRoot, evidenceRoot);
  const packetRoot = resolve(resolvedRoot, ZK682_PACKET_DIRECTORY);
  const head = String(git(resolvedRoot, ["rev-parse", "HEAD"])).trim();
  if (head !== candidateCommit) throw new Error(`HEAD ${head} does not match candidate ${candidateCommit}`);
  const lock = readFileSync(join(resolvedRoot, "package-lock.json"));
  const repositoryRoot = realpathSync(String(git(resolvedRoot, ["rev-parse", "--show-toplevel"])).trim());
  const packagePrefix = relative(repositoryRoot, resolvedRoot).split(sep).join("/");
  const candidateLock = git(resolvedRoot, ["show", `${candidateCommit}:${packagePrefix ? `${packagePrefix}/` : ""}package-lock.json`], null);
  if (sha256(lock) !== sha256(candidateLock)) throw new Error("working-tree package-lock.json differs from the exact candidate");
  const usedRaw = new Set();
  const relativePath = (absolute) => {
    const rel = relative(resolvedRoot, absolute).split(sep).join("/");
    if (!rel || rel.startsWith("../")) throw new Error(`artifact escapes package root: ${absolute}`);
    return rel;
  };
  const bind = (absolute, raw = false) => {
    const path = resolve(absolute);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing evidence artifact: ${relativePath(path)}`);
    if (raw) usedRaw.add(path);
    return { path: relativePath(path), sha256: sha256(readFileSync(path)) };
  };
  const readRaw = (name) => {
    const path = resolve(rawRoot, name);
    if (path !== rawRoot && !path.startsWith(`${rawRoot}${sep}`)) throw new Error(`unsafe raw evidence path: ${name}`);
    const artifact = bind(path, true);
    let value;
    try { value = JSON.parse(readFileSync(path, "utf8")); } catch (error) { throw new Error(`${name} must be JSON: ${error.message}`); }
    return { path, artifact, value };
  };
  return { root: resolvedRoot, rawRoot, packetRoot, candidateCommit, lock, bind, readRaw, usedRaw };
}

function inspectPwa(report, candidateCommit) {
  exactKeys(report, ["schemaVersion", "gate", "candidateCommit", "capturedAt", "command", "environment", "roundTrip", "evidence", "passed"], "PWA evidence");
  if (report.schemaVersion !== 1 || report.gate !== "offline-indexeddb-pwa" || report.candidateCommit !== candidateCommit || report.environment?.buildCommit !== candidateCommit) throw new Error("PWA evidence identity/schema mismatch");
  let recomputed = null;
  try { recomputed = certifyOfflineIndexedDbSave(report.roundTrip); } catch { /* a typed negative remains a failed criterion */ }
  const passed = Boolean(recomputed && stableJson(recomputed) === stableJson(report.evidence));
  if (report.passed !== passed) throw new Error("PWA passed flag disagrees with recomputed round-trip evidence");
  return passed;
}

function inspectDesktop(report, candidateCommit, artifactByPath) {
  if (report.candidateCommit !== candidateCommit || !["darwin", "win32"].includes(report.platform) || !report.architecture) throw new Error("desktop evidence identity/platform mismatch");
  for (const reference of [
    { path: report.package?.path, sha256: report.package?.sha256 },
    { path: report.package?.manifestPath, sha256: report.package?.manifestSha256 },
    report.executable,
  ]) {
    if (!reference?.path || !fullDigest(reference.sha256)) throw new Error("desktop package binding is incomplete");
    const bound = artifactByPath(reference.path);
    if (bound.sha256 !== reference.sha256) throw new Error(`desktop package binding drift: ${reference.path}`);
  }
  let summary = null;
  try { summary = validateZk682DesktopPersistenceSequence({ ...report.phases, userDataPath: report.phases?.write?.userDataPath }); } catch { /* typed negative */ }
  const passed = Boolean(summary && stableJson(summary) === stableJson(report.summary));
  if (report.passed !== passed) throw new Error("desktop passed flag disagrees with recomputed phase evidence");
  return passed;
}

function inspectResource(report, candidateCommit) {
  if (report.source?.commit !== candidateCommit || report.source?.mode !== "e2e") throw new Error("renderer resource evidence candidate/source mismatch");
  if (stableJson(report.thresholds) !== stableJson(ZK682_RESOURCE_GROWTH_THRESHOLDS)) throw new Error("renderer resource thresholds were relaxed");
  const recomputed = evaluateZk682ResourceGrowth(report.samples, ZK682_RESOURCE_GROWTH_THRESHOLDS);
  if (stableJson(recomputed.metrics) !== stableJson(report.summary) || stableJson(recomputed.errors) !== stableJson(report.errors) || report.passed !== recomputed.passed) throw new Error("renderer resource report disagrees with recomputed samples");
  return recomputed.passed;
}

async function inspectSupplemental(report, expectedGate, candidateCommit, root) {
  if (![1, 2].includes(report.schemaVersion) || report.gate !== expectedGate || report.candidateCommit !== candidateCommit) throw new Error(`${expectedGate} evidence identity/schema mismatch`);
  if (!isRecord(report.observations) || typeof report.passed !== "boolean") throw new Error(`${expectedGate} evidence is incomplete`);
  if (report.schemaVersion === 2) {
    const contractPath = join(root, "scripts/zk682-stability-contract.mjs");
    if (!existsSync(contractPath)) throw new Error("schema-v2 stability evidence requires scripts/zk682-stability-contract.mjs");
    const { validateZk682SupplementalStabilityReport } = await import(new URL(`file://${contractPath}`).href);
    const inspected = validateZk682SupplementalStabilityReport(report, expectedGate, candidateCommit);
    const structuralErrors = inspected.errors.filter((error) => error !== "supplemental stability report did not pass");
    if (structuralErrors.length) throw new Error(`${expectedGate}: ${structuralErrors.join("; ")}`);
    return inspected.passed;
  }
  return report.passed;
}

function inspectAsset(report, candidateCommit, readBound) {
  exactKeys(report, ["schemaVersion", "gate", "candidateCommit", "capturedAt", "source", "browserBuild", "bundles", "atlases", "measurements", "passed"], "asset evidence");
  if (report.schemaVersion !== 1 || report.gate !== "asset-delivery" || report.candidateCommit !== candidateCommit) throw new Error("asset evidence identity/schema mismatch");
  const source = readBound(report.source);
  const bundles = Object.entries(source?.dist?.bundles ?? {}).flatMap(([theme, tiers]) => Object.entries(tiers ?? {}).map(([tier, bundle]) => ({ theme, tier, bytes: Number(bundle?.bytes) }))).sort((left, right) => `${left.theme}:${left.tier}`.localeCompare(`${right.theme}:${right.tier}`));
  if (stableJson(report.bundles) !== stableJson(bundles)) throw new Error("asset bundle rows disagree with the M35 audit");
  if (!Array.isArray(report.atlases) || report.atlases.length === 0 || report.atlases.some((entry) => typeof entry.path !== "string" || !finiteNonnegative(entry.bytes) || !fullDigest(entry.sha256))) throw new Error("asset atlas rows are invalid");
  const expected = {
    initialCriticalBytes: Number(source?.initialCritical?.bytes),
    selectedBiomeMaxBytes: Math.max(...bundles.map((bundle) => bundle.bytes)),
    individualAtlasMaxBytes: Math.max(...report.atlases.map((atlas) => atlas.bytes)),
  };
  if (stableJson(expected) !== stableJson(report.measurements)) throw new Error("asset measurements disagree with source evidence");
  const passed = source?.ok === true
    && expected.initialCriticalBytes <= ZK682_BUDGETS.initialCriticalBytes
    && expected.selectedBiomeMaxBytes <= ZK682_BUDGETS.selectedBiomeBytes
    && expected.individualAtlasMaxBytes <= ZK682_BUDGETS.individualAtlasBytes;
  if (report.passed !== passed) throw new Error("asset passed flag disagrees with recomputed measurements");
  return { passed, measurements: expected };
}

function inspectHeadless(report, candidateCommit, readBound) {
  exactKeys(report, ["schemaVersion", "gate", "candidateCommit", "capturedAt", "source", "budgets", "scenario", "measurements", "physicalDevice", "frameP95Asserted", "passed"], "headless evidence");
  if (report.schemaVersion !== 1 || report.gate !== "headless-performance" || report.candidateCommit !== candidateCommit) throw new Error("headless evidence identity/schema mismatch");
  const expectedBudgets = { rendererWorkMilliseconds: 8, coldStartupMilliseconds: 5_000, fixtureLoadMilliseconds: 6_000 };
  if (stableJson(report.budgets) !== stableJson(expectedBudgets)) throw new Error("headless startup/fixture budgets were relaxed");
  if (report.physicalDevice !== false || report.frameP95Asserted !== false) throw new Error("headless evidence cannot claim physical frame p95");
  const source = readBound(report.source);
  const expectedMeasurements = { frameP95Ms: Number(source?.renderer?.p95Ms), rendererWorkMs: Number(source?.renderer?.workMs), coldStartupMs: Number(source?.coldStartupMs), fixtureLoadMs: Number(source?.fixtureLoadMs) };
  if (stableJson(report.measurements) !== stableJson(expectedMeasurements) || !Object.values(expectedMeasurements).every(finiteNonnegative)) throw new Error("headless measurements disagree with source evidence");
  if (source?.effective?.fixture !== "m27Fixture" || source?.effective?.frameAssertion !== false || source?.effective?.budgets?.rendererWorkMilliseconds !== 8 || source?.effective?.budgets?.coldStartupMilliseconds !== 5_000) throw new Error("headless source does not use the pinned workload/budgets");
  const passed = expectedMeasurements.rendererWorkMs <= 8 && expectedMeasurements.coldStartupMs <= 5_000 && expectedMeasurements.fixtureLoadMs <= 6_000;
  if (report.passed !== passed) throw new Error("headless passed flag disagrees with recomputed measurements");
  return { passed, measurements: expectedMeasurements, scenario: report.scenario, budgets: report.budgets };
}

function criterion(id, passed, summary) {
  return { id, status: passed ? "pass" : "fail", summary };
}

function gate(ctx, gateId, criteria, observations, artifacts, command, environment = {}) {
  const classification = ZK682_GATE_CONTRACTS[gateId].classification;
  const decisive = criteria.filter((entry) => entry.status !== "report-only");
  return {
    schemaVersion: ZK682_SCHEMA_VERSION,
    certificationId: ZK682_CERTIFICATION_ID,
    gateId,
    candidateCommit: ctx.candidateCommit,
    classification,
    status: decisive.every((entry) => entry.status === "pass") ? "pass" : "fail",
    command,
    environment,
    criteria,
    observations,
    artifacts: [...new Map(artifacts.map((artifact) => [artifact.path, artifact])).values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function buildZk682Packet({ root, candidateCommit, evidenceRoot = ZK682_FIXED_EVIDENCE_ROOT, invokeCertification = true }) {
  const ctx = createContext(root, candidateCommit, evidenceRoot);
  mkdirSync(join(ctx.packetRoot, "gates"), { recursive: true });
  const raw = (name) => ctx.readRaw(name);
  const receiptEntries = Object.entries(ZK682_PACKET_RECEIPTS).map(([id, name]) => {
    const entry = raw(name);
    const inspected = inspectZk682CommandReceipt(entry.value, { candidateCommit, receiptId: id });
    if (!inspected.valid) throw new Error(`${name}: ${inspected.errors.join("; ")}`);
    return [id, { ...entry, passed: inspected.passed }];
  });
  const receipts = new Map(receiptEntries);
  const receiptRefs = (ids) => ids.map((id) => ({ receiptId: id, ...receipts.get(id).artifact }));
  const receiptArtifacts = (ids) => ids.map((id) => receipts.get(id).artifact);
  const receiptPass = (...ids) => ids.every((id) => receipts.get(id).passed);

  const pwa = raw("pwa-indexeddb.json");
  const pwaPassed = inspectPwa(pwa.value, candidateCommit);
  const desktopEntries = [["darwin", "arm64"], ["win32", "x64"]].map(([platform, architecture]) => {
    const prefix = `desktop-${platform}-${architecture}`;
    const report = raw(`${prefix}/persistence.json`);
    const files = walkFiles(join(ctx.rawRoot, prefix)).map((path) => ctx.bind(path, true));
    const byPath = (path) => {
      const absolute = resolve(ctx.root, path);
      if (!absolute.startsWith(`${ctx.rawRoot}${sep}`)) throw new Error(`desktop artifact is outside the fixed evidence root: ${path}`);
      return ctx.bind(absolute, true);
    };
    const passed = inspectDesktop(report.value, candidateCommit, byPath);
    return { platform, architecture, report, files, passed };
  });
  const resource = raw("renderer-resource-growth.json");
  const resourcePassed = inspectResource(resource.value, candidateCommit);
  const supplementalEntries = await Promise.all([
    ["save-load-resource-stability", "save-load-resource-stability.json"],
    ["long-session-resource-stability", "long-session-resource-stability.json"],
    ["editing-overlay-sleep-recovery", "editing-overlay-sleep-recovery.json"],
  ].map(async ([id, name]) => {
    const entry = raw(name);
    return [id, { ...entry, passed: await inspectSupplemental(entry.value, id, candidateCommit, ctx.root) }];
  }));
  const supplemental = new Map(supplementalEntries);
  const asset = raw("asset-delivery.json");
  const headless = raw("headless-performance.json");
  const readBoundJson = (reference) => {
    if (!reference?.path || !fullDigest(reference.sha256)) throw new Error("typed source binding is invalid");
    const absolute = resolve(ctx.root, reference.path);
    const bound = ctx.bind(absolute, true);
    if (bound.sha256 !== reference.sha256) throw new Error(`typed source hash drift: ${reference.path}`);
    return JSON.parse(readFileSync(absolute, "utf8"));
  };
  const assetResult = inspectAsset(asset.value, candidateCommit, readBoundJson);
  const headlessResult = inspectHeadless(headless.value, candidateCommit, readBoundJson);

  const desktopIndexPath = join(ctx.packetRoot, "desktop-package-index.json");
  const desktopIndex = {
    schemaVersion: 1,
    candidateCommit,
    platforms: desktopEntries.map((entry) => ({ platform: entry.platform, architecture: entry.architecture, report: entry.report.artifact, package: entry.value?.package ?? entry.report.value.package })),
  };
  writeFileSync(desktopIndexPath, `${JSON.stringify(desktopIndex, null, 2)}\n`);
  const desktopIndexArtifact = ctx.bind(desktopIndexPath);
  const browserBuildArtifact = ctx.bind(resolve(ctx.root, asset.value.browserBuild.path), true);

  const gates = [];
  const provenanceArtifacts = [ctx.bind(join(ctx.root, "package-lock.json")), browserBuildArtifact, desktopIndexArtifact];
  gates.push(gate(ctx, "provenance", [
    criterion("immutable-candidate-and-dependencies", true, "HEAD and package-lock.json match the exact candidate."),
    criterion("immutable-browser-and-package-artifacts", true, "Browser and both native package artifacts are content-addressed."),
  ], {
    dependencyLockSha256: sha256(ctx.lock),
    buildArtifacts: [
      { kind: "browser-build", ...browserBuildArtifact },
      { kind: "packaged-electron", ...desktopIndexArtifact },
    ],
  }, provenanceArtifacts, "node scripts/zk682-build-packet.mjs"));

  const coreIds = ["core-build", "core-unit", "core-determinism", "core-reducer", "core-save", "core-platform-services"];
  const coreStatus = {
    productionBuildPassed: receiptPass("core-build"),
    unitTestsPassed: receiptPass("core-unit"),
    deterministicHashesPassed: receiptPass("core-determinism"),
    reducerPassed: receiptPass("core-reducer"),
    saveV25RoundTripPassed: receiptPass("core-save"),
    historicalMigrationsPassed: receiptPass("core-save"),
    platformServicesPassed: receiptPass("core-platform-services"),
  };
  gates.push(gate(ctx, "core-compatibility", [
    criterion("production-build-and-unit-gates", coreStatus.productionBuildPassed && coreStatus.unitTestsPassed, "Production build and unit receipts are derived from command exits."),
    criterion("deterministic-hashes", coreStatus.deterministicHashesPassed, "Determinism receipt is derived from its command exit."),
    criterion("reducer-behavior", coreStatus.reducerPassed, "Reducer receipt is derived from its command exit."),
    criterion("save-v25-round-trip", coreStatus.saveV25RoundTripPassed, "Save v25 receipt is derived from its command exit."),
    criterion("historical-save-migrations", coreStatus.historicalMigrationsPassed, "Migration receipt is derived from its command exit."),
    criterion("platform-services", coreStatus.platformServicesPassed, "PlatformServices receipt is derived from its command exit."),
  ], { ...coreStatus, receipts: receiptRefs(coreIds) }, receiptArtifacts(coreIds), "structured command receipts"));

  const browserIds = ["browser-supported", "browser-golden", "browser-pwa"];
  const browserPassed = receiptPass("browser-supported", "browser-pwa");
  const goldenPassed = receiptPass("browser-golden");
  const offlinePassed = receiptPass("browser-pwa") && pwaPassed;
  gates.push(gate(ctx, "browser-pwa", [
    criterion("browser-pwa-certification", browserPassed, "Supported-browser and PWA command receipts pass."),
    criterion("golden-e2e", goldenPassed, "Golden E2E command receipt passes."),
    criterion("offline-launch", offlinePassed, "Offline IndexedDB round trip is recomputed from typed evidence."),
  ], { browserPassed, goldenE2ePassed: goldenPassed, offlineLaunchPassed: offlinePassed, browsers: ["chromium", "firefox", "webkit"], offlineIndexedDbEvidence: pwa.artifact, receipts: receiptRefs(browserIds) }, [...receiptArtifacts(browserIds), pwa.artifact], "typed browser/PWA evidence"));

  const desktopPassed = desktopEntries.every((entry) => entry.passed);
  gates.push(gate(ctx, "packaged-desktop", [
    criterion("packaged-electron-certification", desktopPassed, "Both native package manifests and binaries are hash-bound."),
    criterion("desktop-persistence", desktopPassed, "Both native persistence sequences are recomputed."),
  ], { packagedElectronPassed: desktopPassed, desktopPersistencePassed: desktopPassed, platforms: desktopEntries.map((entry) => entry.platform), persistenceEvidence: desktopEntries.map((entry) => ({ platform: entry.platform, architecture: entry.architecture, ...entry.report.artifact })) }, desktopEntries.flatMap((entry) => entry.files), "typed native package evidence"));

  const assetIds = ["asset-package-audit", "asset-unselected-biomes"];
  const assetObservations = {
    ...assetResult.measurements,
    unselectedBiomeAtlasesUnloaded: receiptPass("asset-unselected-biomes"),
    packageSizeAndAssetAuditPassed: receiptPass("asset-package-audit") && assetResult.passed,
    receipts: receiptRefs(assetIds),
    typedEvidence: asset.artifact,
  };
  gates.push(gate(ctx, "asset-delivery", [
    criterion("initial-critical-assets", assetResult.measurements.initialCriticalBytes <= ZK682_BUDGETS.initialCriticalBytes, "Measured initial critical bytes use the fixed 8 MiB ceiling."),
    criterion("selected-biome-payload", assetResult.measurements.selectedBiomeMaxBytes <= ZK682_BUDGETS.selectedBiomeBytes, "Measured selected biome bytes use the fixed 6 MiB ceiling."),
    criterion("individual-atlas-payload", assetResult.measurements.individualAtlasMaxBytes <= ZK682_BUDGETS.individualAtlasBytes, "Measured atlas bytes use the fixed 8 MiB ceiling."),
    criterion("unselected-biomes-unloaded", assetObservations.unselectedBiomeAtlasesUnloaded, "PWA network/cache receipt verifies unselected biome isolation."),
    criterion("package-size-and-asset-audit", assetObservations.packageSizeAndAssetAuditPassed, "Package and asset audit receipt plus typed measurements pass."),
  ], assetObservations, [...receiptArtifacts(assetIds), asset.artifact, ctx.bind(resolve(ctx.root, asset.value.source.path), true), browserBuildArtifact], "typed asset evidence"));

  const hp = headlessResult;
  gates.push(gate(ctx, "headless-performance", [
    criterion("representative-36-hole-100-golfer-load", hp.measurements.rendererWorkMs <= ZK682_BUDGETS.rendererWorkMilliseconds, "Renderer work is derived from the 36-hole/100-golfer source report."),
    { id: "headless-frame-p95-report-only", status: "report-only", summary: "Headless frame p95 is retained as a trend signal only." },
    criterion("startup-and-fixture-load", hp.measurements.coldStartupMs <= 5_000 && hp.measurements.fixtureLoadMs <= 6_000, "Startup and fixture load use fixed 5000/6000 ms budgets."),
  ], { physicalDevice: false, frameP95Asserted: false, ...hp.measurements, coldStartupBudgetMs: 5_000, fixtureLoadBudgetMs: 6_000, scenario: hp.scenario, receipts: receiptRefs(["headless-performance"]), typedEvidence: headless.artifact }, [receipts.get("headless-performance").artifact, headless.artifact, ctx.bind(resolve(ctx.root, headless.value.source.path), true)], "typed headless performance evidence"));

  const saveLoad = supplemental.get("save-load-resource-stability");
  const longSession = supplemental.get("long-session-resource-stability");
  const interaction = supplemental.get("editing-overlay-sleep-recovery");
  const stabilityArtifacts = [resource.artifact, saveLoad.artifact, longSession.artifact, interaction.artifact];
  for (const name of ["zk682-resource-growth-final.png", "zk682-stability-final.png"]) {
    const screenshot = join(ctx.rawRoot, name);
    if (existsSync(screenshot)) stabilityArtifacts.push(ctx.bind(screenshot, true));
  }
  gates.push(gate(ctx, "stability", [
    criterion("route-change-resource-stability", resourcePassed, "Renderer samples are recomputed with pinned thresholds."),
    criterion("save-load-resource-stability", saveLoad.passed, "Save/load samples are validated from typed evidence."),
    criterion("long-session-resource-stability", longSession.passed, "Long-session samples are validated from typed evidence."),
    criterion("editing-overlay-sleep-recovery", interaction.passed, "Interaction recovery samples are validated from typed evidence."),
  ], {
    routeChangesStable: resourcePassed,
    saveLoadsStable: saveLoad.passed,
    longSessionStable: longSession.passed,
    interactionRecoveryPassed: interaction.passed,
    routeChanges: Number(resource.value.samples?.length ?? 0),
    saveLoads: Number(saveLoad.value.observations?.saveLoads ?? 0),
    sessionMinutes: Number(longSession.value.observations?.sessionMinutes ?? 0),
    resourceGrowthEvidence: resource.artifact,
    saveLoadEvidence: saveLoad.artifact,
    longSessionEvidence: longSession.artifact,
    interactionRecoveryEvidence: interaction.artifact,
  }, stabilityArtifacts, "typed stability evidence"));

  for (const [gateId, hardwareClass, file] of [["physical-midrange", "midrange", "physical-midrange.json"], ["physical-lowend", "low-end", "physical-lowend.json"]]) {
    if (!existsSync(join(ctx.rawRoot, file))) continue;
    const evidence = raw(file);
    const value = evidence.value;
    if (value.gate !== gateId || value.hardwareClass !== hardwareClass || value.candidateCommit !== candidateCommit) throw new Error(`${gateId}: hardwareClass/gate/candidate mismatch`);
    if (stableJson(value.scenario) !== stableJson(hp.scenario)) throw new Error(`${gateId}: scenario must exactly match headless evidence`);
    const budget = gateId === "physical-midrange" ? ZK682_BUDGETS.midrangeP95Milliseconds : ZK682_BUDGETS.lowEndP95Milliseconds;
    const passed = finiteNonnegative(value.frameP95Ms) && value.frameP95Ms <= budget;
    gates.push(gate(ctx, gateId, [criterion(gateId === "physical-midrange" ? "midrange-physical-p95" : "low-end-physical-p95", passed, `Physical p95 ${value.frameP95Ms} ms; budget ${budget} ms.`)], { physicalDevice: true, hardwareClass, device: value.device, operatingSystem: value.operatingSystem, powerMode: value.powerMode, graphicsBackend: value.graphicsBackend, frameP95Ms: value.frameP95Ms, scenario: value.scenario, physicalEvidence: evidence.artifact }, [evidence.artifact], "typed physical evidence"));
  }

  const descriptors = gates.map((value) => {
    const path = join(ctx.packetRoot, "gates", `${value.gateId}.json`);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    return { gateId: value.gateId, ...ctx.bind(path) };
  }).sort((a, b) => a.gateId.localeCompare(b.gateId));
  const unboundRaw = walkFiles(ctx.rawRoot).filter((path) => !ctx.usedRaw.has(resolve(path)));
  if (unboundRaw.length) throw new Error(`unbound raw evidence: ${unboundRaw.map((path) => relative(ctx.root, path)).join(", ")}`);
  const manifest = {
    schemaVersion: ZK682_SCHEMA_VERSION,
    certificationId: ZK682_CERTIFICATION_ID,
    candidateCommit,
    dependencyLock: { path: "package-lock.json", sha256: sha256(ctx.lock) },
    gateResults: descriptors,
    exceptions: [],
  };
  const manifestPath = join(ctx.packetRoot, "evidence-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (invokeCertification) {
    const result = spawnSync("npm", ["run", "release:certify:zk682", "--", "--input", "release/zk682/evidence-manifest.json", "--output-dir", "release/zk682", "--expected-commit", candidateCommit], { cwd: ctx.root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`release:certify:zk682 failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    process.stdout.write(result.stdout ?? "");
  }
  return { manifest, manifestPath, gates };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const candidateCommit = valueFor("--candidate") ?? process.env.ZK682_EXPECTED_COMMIT;
  const evidenceRoot = valueFor("--evidence-root") ?? ZK682_FIXED_EVIDENCE_ROOT;
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (!fullCommit(candidateCommit) || args.some((arg) => arg.startsWith("--") && !["--candidate", "--evidence-root"].includes(arg))) {
    throw new Error("Usage: node scripts/zk682-build-packet.mjs --candidate <full-sha> [--evidence-root artifacts/zk682/raw]");
  }
  await buildZk682Packet({ root, candidateCommit, evidenceRoot });
}
