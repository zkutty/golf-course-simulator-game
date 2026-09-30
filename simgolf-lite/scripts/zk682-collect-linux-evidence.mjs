import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const rawRoot = join(root, "artifacts/zk682/raw");
const candidateCommit = process.env.ZK682_EXPECTED_COMMIT;
if (!/^[0-9a-f]{40}$/.test(candidateCommit ?? "")) throw new Error("ZK682_EXPECTED_COMMIT must be a full candidate SHA");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const copyJson = (source, name) => {
  const value = readJson(source);
  const output = join(rawRoot, name);
  writeJson(output, value);
  return { value, reference: { path: relative(root, output).split("\\").join("/"), sha256: sha256(readFileSync(output)) } };
};
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
});

mkdirSync(rawRoot, { recursive: true });

const assetSource = copyJson(join(root, "artifacts/m35/asset-audit.json"), "m35-asset-audit.json");
const browserManifestSource = copyJson(join(root, "dist/.vite/manifest.json"), "browser-build-manifest.json");
const bundles = Object.entries(assetSource.value?.dist?.bundles ?? {}).flatMap(([theme, tiers]) =>
  Object.entries(tiers ?? {}).map(([tier, bundle]) => ({ theme, tier, bytes: Number(bundle?.bytes) })),
).sort((left, right) => `${left.theme}:${left.tier}`.localeCompare(`${right.theme}:${right.tier}`));
const atlasFiles = walk(join(root, "dist/atlases")).filter((path) => /\.(?:png|webp|avif|json)$/i.test(path));
const atlases = atlasFiles.map((path) => ({
  path: relative(join(root, "dist"), path).split("\\").join("/"),
  bytes: statSync(path).size,
  sha256: sha256(readFileSync(path)),
})).sort((left, right) => left.path.localeCompare(right.path));
const assetMeasurements = {
  initialCriticalBytes: Number(assetSource.value?.initialCritical?.bytes),
  selectedBiomeMaxBytes: Math.max(...bundles.map((bundle) => bundle.bytes)),
  individualAtlasMaxBytes: Math.max(...atlases.map((atlas) => atlas.bytes)),
};
const assetPassed = assetSource.value?.ok === true
  && assetMeasurements.initialCriticalBytes <= 8 * 1024 * 1024
  && assetMeasurements.selectedBiomeMaxBytes <= 6 * 1024 * 1024
  && assetMeasurements.individualAtlasMaxBytes <= 8 * 1024 * 1024;
writeJson(join(rawRoot, "asset-delivery.json"), {
  schemaVersion: 1,
  gate: "asset-delivery",
  candidateCommit,
  capturedAt: new Date().toISOString(),
  source: assetSource.reference,
  browserBuild: browserManifestSource.reference,
  bundles,
  atlases,
  measurements: assetMeasurements,
  passed: assetPassed,
});

const performanceSource = copyJson(join(root, "artifacts/m28/performance-parkland.json"), "headless-performance-source.json");
const performance = performanceSource.value;
const budgets = {
  rendererWorkMilliseconds: 8,
  coldStartupMilliseconds: 5_000,
  fixtureLoadMilliseconds: 6_000,
};
const measurements = {
  frameP95Ms: Number(performance?.renderer?.p95Ms),
  rendererWorkMs: Number(performance?.renderer?.workMs),
  coldStartupMs: Number(performance?.coldStartupMs),
  fixtureLoadMs: Number(performance?.fixtureLoadMs),
};
const finite = Object.values(measurements).every((value) => Number.isFinite(value) && value >= 0);
const effective = performance?.effective;
const contractPinned = effective?.fixture === "m27Fixture"
  && effective?.frameAssertion === false
  && effective?.budgets?.rendererWorkMilliseconds === budgets.rendererWorkMilliseconds
  && effective?.budgets?.coldStartupMilliseconds === budgets.coldStartupMilliseconds;
const headlessPassed = finite
  && contractPinned
  && measurements.rendererWorkMs <= budgets.rendererWorkMilliseconds
  && measurements.coldStartupMs <= budgets.coldStartupMilliseconds
  && measurements.fixtureLoadMs <= budgets.fixtureLoadMilliseconds;
writeJson(join(rawRoot, "headless-performance.json"), {
  schemaVersion: 1,
  gate: "headless-performance",
  candidateCommit,
  capturedAt: new Date().toISOString(),
  source: performanceSource.reference,
  budgets,
  scenario: { holes: 36, golfers: 100, biome: performance?.theme, season: "summer", weather: "clear" },
  measurements,
  physicalDevice: false,
  frameP95Asserted: false,
  passed: headlessPassed,
});
