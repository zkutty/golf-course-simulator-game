import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAtlasManifest, type AtlasManifest } from "../../render/atlasManifest";
import { BIOME_KEYS } from "../models/biomes";
import {
  auditBiomeAuthoring,
  createBiomeReferenceFixture,
  type BiomeAssetInventory,
} from "./biomeAuthoring";

const root = process.cwd();
const atlasRoot = join(root, "public/atlases/biomes");
const artifactRoot = join(root, "artifacts/zk-564");
const manifest = normalizeAtlasManifest(
  JSON.parse(readFileSync(join(atlasRoot, "manifest.json"), "utf8")),
  BIOME_KEYS,
);

function inventoryFor(current: AtlasManifest): BiomeAssetInventory {
  const paths = new Set<string>([current.core.golfers.json]);
  const assetPaths = new Set<string>([current.core.golfers.json, current.core.golfers.image]);
  for (const biome of BIOME_KEYS) for (const quality of ["high", "medium", "low"] as const) {
    const tier = current.biomes[biome][quality];
    for (const bundle of [tier.base.buildings, tier.base.terrain, tier.base.details, tier.base.props]) {
      if (bundle) {
        paths.add(bundle.json);
        assetPaths.add(bundle.json);
        assetPaths.add(bundle.image);
      }
    }
    for (const field of Object.values(tier.base.fields)) if (field) assetPaths.add(field.image);
    for (const overlay of Object.values(tier.seasonal)) {
      for (const bundle of [overlay?.props, overlay?.decals]) if (bundle) {
        paths.add(bundle.json);
        assetPaths.add(bundle.json);
        assetPaths.add(bundle.image);
      }
      for (const field of Object.values(overlay?.materials ?? {})) if (field) assetPaths.add(field.image);
    }
  }
  return {
    framesByJson: Object.fromEntries([...paths].sort().map((path) => {
      const contents = JSON.parse(readFileSync(join(atlasRoot, path), "utf8")) as {
        frames?: Record<string, unknown>;
      };
      return [path, Object.keys(contents.frames ?? {}).sort()];
    })),
    sha256ByAsset: Object.fromEntries([...assetPaths].sort().map((path) => [
      path,
      createHash("sha256").update(readFileSync(join(atlasRoot, path))).digest("hex"),
    ])),
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const fixtures = BIOME_KEYS.map(createBiomeReferenceFixture);
const report = auditBiomeAuthoring({ manifest, inventory: inventoryFor(manifest), fixtures });
const fixtureReport = {
  version: report.version,
  fixtures: fixtures.map((fixture) => ({
    id: fixture.id,
    biome: fixture.biome,
    seed: fixture.seed,
    source: fixture.source,
    courseHash: sha256(fixture.course),
    terrain: [...new Set(fixture.course.tiles)].sort(),
    props: [...new Set(fixture.course.obstacles.map((item) => item.type))].sort(),
    structures: [...new Set(fixture.course.buildings.map((item) => item.type))].sort(),
    decorations: [...new Set((fixture.course.decorations ?? []).map((item) => item.kind))].sort(),
    climateStates: fixture.climateStates.map((state) => state.calendarSeason),
    bookmarks: fixture.bookmarks,
    fixtureHash: sha256(fixture),
  })),
};
const missingAssets = {
  version: report.version,
  pass: report.pass,
  required: report.findings.filter((item) => item.category === "required"),
  optional: report.findings.filter((item) => item.category === "optional"),
  fallback: report.findings.filter((item) => item.category === "fallback"),
  overBudget: report.findings.filter((item) => item.category === "over-budget"),
};
const payloadReport = {
  version: report.version,
  pass: report.payloads.every((item) => item.status === "within-budget"),
  tiers: report.payloads,
};

mkdirSync(artifactRoot, { recursive: true });
writeFileSync(join(artifactRoot, "biome-authoring-audit.json"), json(report));
writeFileSync(join(artifactRoot, "biome-reference-fixtures.json"), json(fixtureReport));
writeFileSync(join(artifactRoot, "biome-missing-assets.json"), json(missingAssets));
writeFileSync(join(artifactRoot, "biome-payload-report.json"), json(payloadReport));
console.log(JSON.stringify({
  pass: report.pass,
  reportHash: sha256(report),
  fixtureReportHash: sha256(fixtureReport),
  counts: report.counts,
  payloads: report.payloads,
}, null, 2));
if (!report.pass) process.exitCode = 1;
