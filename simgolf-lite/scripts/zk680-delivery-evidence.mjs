import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import typescriptEslint from "typescript-eslint";
import { collectDesktopPackageEvidence } from "./desktop-package-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baselinePath = join(root, "artifacts/zk-680/pre-split-baseline.json");
const performancePath = join(root, "artifacts/zk-680/current-performance.json");
const entrySourcePath = join(root, "src/main.tsx");
const parklandHabitatManifestPath = join(root, "src/assets/terrain/parkland-habitat-4x/manifest.json");
const allowedEagerEntryImports = new Set(["./game/analysis/benchmark"]);
const parklandHabitatSourceRoot = "src/assets/terrain/parkland-habitat-4x/";
export const PARKLAND_HABITAT_ATLAS_BYTES_MAX = JSON.parse(readFileSync(parklandHabitatManifestPath, "utf8")).budgets.totalAtlasBytesMax;

// ZK-332: the pre-I1 build left 40,740 B below this pre-existing aggregate cap.
export const HISTORICAL_DIST_BYTES_CAP = 114878859 + 2 * 1024 * 1024;
// The final accepted I1 runtime consumer/manifest/generated-metadata delta was 172,486 B.
// This rounds only that consumer to a bounded 192 KiB allowance; atlas bytes stay separate.
export const PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE = 192 * 1024;
export const PARKLAND_HABITAT_PRE_I1_DIST_BYTES = 116935271;
export const PARKLAND_HABITAT_ACCEPTED_ATLAS_BYTES = 362862;
export const PARKLAND_HABITAT_ACCEPTED_CANDIDATE_DIST_BYTES = 117470619;
export const PARKLAND_HABITAT_ACCEPTED_RUNTIME_CONSUMER_BYTES = 172486;

export const DELIVERY_BUDGETS = {
  // The initial game graph may never exceed the pre-split bundle.
  initialJavaScriptBytes: 1608719,
  // This independently protects the deferred Vision route.
  visionPageJavaScriptBytes: 32 * 1024,
  // Existing M35 limits still protect assets; these keep the delivery view explicit.
  initialCriticalTransferBytes: 4 * 1024 * 1024,
  maxSelectedBiomeBytes: 6 * 1024 * 1024,
  // ZK-332 retains the historical aggregate gate after removing only accepted habitat atlases.
  historicalDistBytesCap: HISTORICAL_DIST_BYTES_CAP,
  parklandHabitatRuntimeConsumerAllowance: PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE,
  distBytesExcludingParklandHabitatAtlases: HISTORICAL_DIST_BYTES_CAP + PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE,
  // The accepted manifest's totalAtlasBytesMax is added here and re-read at evaluation time.
  distBytes: HISTORICAL_DIST_BYTES_CAP + PARKLAND_HABITAT_ATLAS_BYTES_MAX + PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE,
  // Package totals include platform metadata and are allowed a bounded release overhead.
  desktopPackageBytes: 495074219 + 4 * 1024 * 1024,
  desktopAsarBytes: 206569606 + 2 * 1024 * 1024,
  coldStartupMs: 5000,
  fixtureLoadMs: 6000,
};

function walkBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = join(directory, entry.name);
    return total + (entry.isDirectory() ? walkBytes(file) : entry.isFile() ? statSync(file).size : 0);
  }, 0);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function expectedParklandHabitatAtlasSources(habitatManifest) {
  const tiers = ["high", "medium", "low"];
  const sources = tiers.map((tier) => {
    const image = habitatManifest?.tiers?.[tier]?.image;
    if (typeof image !== "string" || !image.endsWith(".png")) {
      throw new Error(`Accepted Parkland habitat manifest has no PNG for ${tier} tier.`);
    }
    return { tier, source: `${parklandHabitatSourceRoot}${image}` };
  });
  if (new Set(sources.map(({ source }) => source)).size !== sources.length) {
    throw new Error("Accepted Parkland habitat manifest maps multiple tiers to one atlas PNG.");
  }
  return sources;
}

/**
 * Uses Vite's source-addressable manifest records, never emitted filenames, to
 * account for the three selected Parkland habitat atlas PNGs exactly once.
 */
export function collectParklandHabitatAtlasEvidence(manifest, distDirectory, habitatManifest = readJson(parklandHabitatManifestPath)) {
  const expected = expectedParklandHabitatAtlasSources(habitatManifest);
  const expectedSources = new Set(expected.map(({ source }) => source));
  const emittedAtlasEntries = Object.entries(manifest)
    .filter(([, entry]) => typeof entry?.src === "string" && entry.src.startsWith(parklandHabitatSourceRoot) && entry.src.endsWith(".png"));
  const unattributed = emittedAtlasEntries.filter(([, entry]) => !expectedSources.has(entry.src));
  if (unattributed.length) {
    throw new Error(`Unattributed Parkland habitat atlas manifest entries: ${unattributed.map(([key]) => key).join(", ")}`);
  }

  const atlasAssets = expected.map(({ tier, source }) => {
    const matches = emittedAtlasEntries.filter(([, entry]) => entry.src === source);
    if (matches.length !== 1) {
      throw new Error(`Expected one emitted Parkland habitat ${tier} atlas for ${source}; found ${matches.length}.`);
    }
    const [manifestKey, entry] = matches[0];
    if (typeof entry.file !== "string" || !entry.file.endsWith(".png")) {
      throw new Error(`Parkland habitat ${tier} atlas has no emitted PNG output.`);
    }
    const file = join(distDirectory, entry.file);
    if (!existsSync(file)) throw new Error(`Missing emitted Parkland habitat ${tier} atlas ${entry.file}.`);
    return { tier, source, manifestKey, file: entry.file, bytes: statSync(file).size };
  });
  if (new Set(atlasAssets.map(({ file }) => file)).size !== atlasAssets.length) {
    throw new Error("Parkland habitat atlas tiers are duplicated onto one emitted output.");
  }
  const totalAtlasBytesMax = Number(habitatManifest?.budgets?.totalAtlasBytesMax);
  if (!Number.isSafeInteger(totalAtlasBytesMax) || totalAtlasBytesMax < 0) {
    throw new Error("Accepted Parkland habitat manifest has no valid totalAtlasBytesMax budget.");
  }
  return {
    habitatAtlasBytes: atlasAssets.reduce((total, asset) => total + asset.bytes, 0),
    habitatAtlasBytesMax: totalAtlasBytesMax,
    habitatAtlasAssets: atlasAssets,
  };
}

function deliveryBudgets(habitatAtlasBytesMax) {
  return {
    ...DELIVERY_BUDGETS,
    habitatAtlasBytes: habitatAtlasBytesMax,
    distBytes: HISTORICAL_DIST_BYTES_CAP + habitatAtlasBytesMax + PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE,
  };
}

function applicationEntry(manifest) {
  return Object.entries(manifest).find(([, entry]) => entry.isEntry)?.[0] ?? null;
}

const functionNodes = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

/** Direct entry imports execute during startup even when Vite emits a dynamic chunk. */
export function eagerEntryDynamicImports(source) {
  const { ast } = typescriptEslint.parser.parseForESLint(source, {
    ecmaVersion: "latest",
    jsx: true,
    sourceType: "module",
  });
  const imports = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object" || functionNodes.has(node.type)) return;
    if (node.type === "ImportExpression" && typeof node.source?.value === "string") {
      imports.add(node.source.value);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "parent", "range", "tokens", "comments"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  visit(ast);
  return [...imports].sort();
}

export function assertNoUnexpectedEagerEntryImports(source) {
  const unexpected = eagerEntryDynamicImports(source)
    .filter((specifier) => !allowedEagerEntryImports.has(specifier));
  if (unexpected.length) {
    throw new Error(`Entry requests dynamic code during startup: ${unexpected.join(", ")}`);
  }
}

function routeJavascriptBytes(manifest, directory, source) {
  const entry = Object.values(manifest).find((value) => value.src === source);
  if (!entry?.file?.endsWith(".js")) {
    throw new Error(`Missing JavaScript output for deferred route ${source}`);
  }
  return statSync(join(directory, entry.file)).size;
}

function maxSelectedBiomeBytes(assetAudit) {
  const bundles = Object.values(assetAudit?.dist?.bundles ?? {});
  const values = bundles.flatMap((bundle) => Object.values(bundle));
  return Math.max(0, ...values.map((entry) => Number(entry.bytes) || 0));
}

function comparison(name, value, baseline, budget) {
  return {
    baseline,
    value,
    deltaBytes: value - baseline,
    budget,
    ok: value <= budget,
    error: value <= budget ? null : `${name} is ${value} B; budget is ${budget} B`,
  };
}

export function collectWebDeliveryEvidence(distDirectory = join(root, "dist")) {
  const manifestPath = join(distDirectory, ".vite", "manifest.json");
  const auditPath = join(root, "artifacts/m35/asset-audit.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}; run the production build first.`);
  if (!existsSync(auditPath)) throw new Error(`Missing ${auditPath}; run the M35 asset audit first.`);
  assertNoUnexpectedEagerEntryImports(readFileSync(entrySourcePath, "utf8"));

  const manifest = readJson(manifestPath);
  const entry = applicationEntry(manifest);
  if (!entry) throw new Error("Vite manifest has no application entry.");
  const initialEntry = manifest[entry];
  if (!initialEntry.file.endsWith(".js")) throw new Error("Application entry has no JavaScript output.");
  const audit = readJson(auditPath);
  const performance = readJson(performancePath);
  const habitat = collectParklandHabitatAtlasEvidence(manifest, distDirectory);
  const distBytes = walkBytes(distDirectory);
  return {
    initialJavaScriptBytes: statSync(join(distDirectory, initialEntry.file)).size,
    visionPageJavaScriptBytes: routeJavascriptBytes(manifest, distDirectory, "src/ui/VisionPage.tsx"),
    initialCriticalTransferBytes: Number(audit?.initialCritical?.bytes),
    maxSelectedBiomeBytes: maxSelectedBiomeBytes(audit),
    habitatAtlasBytes: habitat.habitatAtlasBytes,
    distBytesExcludingParklandHabitatAtlases: distBytes - habitat.habitatAtlasBytes,
    distBytes,
    coldStartupMs: Number(performance.coldStartupMs),
    fixtureLoadMs: Number(performance.fixtureLoadMs),
  };
}

export async function collectDeliveryEvidence({ distDirectory = join(root, "dist"), desktopDirectory } = {}) {
  const web = collectWebDeliveryEvidence(distDirectory);
  if (!desktopDirectory) return web;
  const desktop = await collectDesktopPackageEvidence(desktopDirectory);
  return {
    ...web,
    desktopPackageBytes: desktop.packageBytes,
    desktopAsarBytes: desktop.asarBytes,
  };
}

export function evaluateDeliveryBudgets(evidence, baseline = readJson(baselinePath), habitatAtlasBytesMax = readJson(parklandHabitatManifestPath).budgets.totalAtlasBytesMax) {
  const measurements = baseline.measurements;
  const budgets = deliveryBudgets(habitatAtlasBytesMax);
  const baselineFor = (name) => {
    if (name === "habitatAtlasBytes") return 0;
    if (name === "distBytesExcludingParklandHabitatAtlases") return measurements.distBytes;
    return measurements[name];
  };
  const checks = Object.fromEntries(
    Object.entries(evidence).map(([name, value]) => [
      name,
      comparison(name, value, baselineFor(name), budgets[name]),
    ]),
  );
  const errors = Object.values(checks).flatMap((check) => check.error ? [check.error] : []);
  const distBytes = Number(evidence.distBytes);
  const habitatAtlasBytes = Number(evidence.habitatAtlasBytes);
  const excluded = Number(evidence.distBytesExcludingParklandHabitatAtlases);
  if (Number.isFinite(distBytes) && Number.isFinite(habitatAtlasBytes) && Number.isFinite(excluded)
    && distBytes !== excluded + habitatAtlasBytes) {
    errors.push(`distBytes must equal distBytesExcludingParklandHabitatAtlases + habitatAtlasBytes (${distBytes} B !== ${excluded} B + ${habitatAtlasBytes} B)`);
  }
  return {
    schemaVersion: 2,
    reference: baseline.reference,
    budgets,
    parklandHabitatAccounting: {
      historicalDistBytesCap: HISTORICAL_DIST_BYTES_CAP,
      preI1DistBytes: PARKLAND_HABITAT_PRE_I1_DIST_BYTES,
      habitatAtlasBytes: {
        actual: habitatAtlasBytes,
        budget: habitatAtlasBytesMax,
        deltaFromPreI1: habitatAtlasBytes,
        headroom: habitatAtlasBytesMax - habitatAtlasBytes,
      },
      runtimeConsumerAllowance: PARKLAND_HABITAT_RUNTIME_CONSUMER_ALLOWANCE,
      runtimeConsumerDeltaFromPreI1: distBytes - PARKLAND_HABITAT_PRE_I1_DIST_BYTES - habitatAtlasBytes,
      distBytesExcludingParklandHabitatAtlases: {
        actual: excluded,
        budget: budgets.distBytesExcludingParklandHabitatAtlases,
        deltaFromPreI1: excluded - PARKLAND_HABITAT_PRE_I1_DIST_BYTES,
        headroom: budgets.distBytesExcludingParklandHabitatAtlases - excluded,
      },
      distBytes: {
        actual: distBytes,
        budget: budgets.distBytes,
        deltaFromPreI1: distBytes - PARKLAND_HABITAT_PRE_I1_DIST_BYTES,
        headroom: budgets.distBytes - distBytes,
      },
    },
    checks,
    ok: errors.length === 0,
    errors,
  };
}

export async function assertDeliveryBudgets(options) {
  const evidence = await collectDeliveryEvidence(options);
  const report = evaluateDeliveryBudgets(evidence);
  if (!report.ok) throw new Error(`ZK-680 delivery budget failed: ${report.errors.join("; ")}`);
  return report;
}

async function run() {
  const desktopFlag = process.argv.indexOf("--desktop");
  const desktopDirectory = desktopFlag === -1 ? undefined : process.argv[desktopFlag + 1];
  if (desktopFlag !== -1 && !desktopDirectory) throw new Error("--desktop requires an Electron output directory.");
  const report = await assertDeliveryBudgets({ desktopDirectory });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
