import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAtlasManifest, type AtlasManifest } from "../../render/atlasManifest";
import { BIOME_KEYS } from "../models/biomes";
import { DECORATION_KINDS } from "../models/decorations";
import { TERRAIN_KINDS } from "../render/terrainMaterials";
import {
  BIOME_REFERENCE_ROTATIONS,
  BIOME_REFERENCE_VIEWS,
  auditBiomeAuthoring,
  createBiomeReferenceFixture,
  type BiomeAssetInventory,
} from "./biomeAuthoring";

const root = process.cwd();

function realManifest(): AtlasManifest {
  return normalizeAtlasManifest(
    JSON.parse(readFileSync(join(root, "public/atlases/biomes/manifest.json"), "utf8")),
    BIOME_KEYS,
  );
}

function realInventory(manifest: AtlasManifest): BiomeAssetInventory {
  const jsonPaths = new Set<string>([manifest.core.golfers.json]);
  const assetPaths = new Set<string>([manifest.core.golfers.json, manifest.core.golfers.image]);
  for (const biome of BIOME_KEYS) for (const quality of ["high", "medium", "low"] as const) {
    const tier = manifest.biomes[biome][quality];
    for (const bundle of [tier.base.buildings, tier.base.terrain, tier.base.details, tier.base.props]) {
      if (bundle) {
        jsonPaths.add(bundle.json);
        assetPaths.add(bundle.json);
        assetPaths.add(bundle.image);
      }
    }
    for (const field of Object.values(tier.base.fields)) if (field) assetPaths.add(field.image);
    for (const overlay of Object.values(tier.seasonal)) {
      for (const bundle of [overlay?.props, overlay?.decals]) if (bundle) {
        jsonPaths.add(bundle.json);
        assetPaths.add(bundle.json);
        assetPaths.add(bundle.image);
      }
      for (const field of Object.values(overlay?.materials ?? {})) if (field) assetPaths.add(field.image);
    }
  }
  return {
    framesByJson: Object.fromEntries([...jsonPaths].map((path) => {
      const atlas = JSON.parse(readFileSync(join(root, "public/atlases/biomes", path), "utf8")) as {
        frames?: Record<string, unknown>;
      };
      return [path, Object.keys(atlas.frames ?? {})];
    })),
    sha256ByAsset: Object.fromEntries([...assetPaths].map((path) => [
      path,
      createHash("sha256").update(readFileSync(join(root, "public/atlases/biomes", path))).digest("hex"),
    ])),
  };
}

describe("ZK-564 deterministic biome authoring fixtures", () => {
  it.each(BIOME_KEYS)("covers authoring and all standard camera views for %s", (biome) => {
    const first = createBiomeReferenceFixture(biome);
    const second = createBiomeReferenceFixture(biome);
    expect(first).toEqual(second);
    expect(first.course.biomeCompatibility?.biome).toBe(biome);
    expect(new Set(first.course.tiles)).toEqual(new Set(TERRAIN_KINDS));
    expect(new Set(first.course.obstacles.map((item) => item.type))).toEqual(new Set(["tree", "bush", "rock"]));
    expect(new Set(first.course.decorations?.map((item) => item.kind))).toEqual(new Set(DECORATION_KINDS));
    expect(first.bookmarks).toHaveLength(BIOME_REFERENCE_VIEWS.length * BIOME_REFERENCE_ROTATIONS.length);
    for (const view of BIOME_REFERENCE_VIEWS) for (const rotation of BIOME_REFERENCE_ROTATIONS) {
      const bookmark = first.bookmarks.find((item) => item.view === view && item.rotation === rotation);
      expect(bookmark).toBeDefined();
      expect(bookmark!.center.x).toBeGreaterThanOrEqual(0);
      expect(bookmark!.center.x).toBeLessThan(first.course.width);
      expect(bookmark!.center.y).toBeGreaterThanOrEqual(0);
      expect(bookmark!.center.y).toBeLessThan(first.course.height);
      expect(bookmark!.zoom).toBeGreaterThan(0);
    }
    expect(first.climateStates.map((state) => state.calendarSeason)).toEqual(["spring", "summer", "autumn", "winter"]);
  });

  it("passes every registered biome against the deployed manifest and authored frames", () => {
    const manifest = realManifest();
    const report = auditBiomeAuthoring({ manifest, inventory: realInventory(manifest) });
    expect(report.pass, JSON.stringify(report.findings.filter((item) => item.category === "required"), null, 2)).toBe(true);
    expect(report.counts.required).toBe(0);
    expect(report.counts["over-budget"]).toBe(0);
    expect(report.coverage.map((item) => item.biome)).toEqual(BIOME_KEYS);
    expect(report.payloads).toHaveLength(BIOME_KEYS.length * 3);
    expect(report.findings.some((item) => item.category === "optional")).toBe(true);
    expect(report.findings.some((item) => item.category === "fallback")).toBe(true);
  });

  it("fails closed for incomplete required assets and reports over-budget separately", () => {
    const manifest = realManifest();
    const inventory = realInventory(manifest);
    const brokenFrames = structuredClone(inventory.framesByJson) as Record<string, string[]>;
    const parklandProps = manifest.biomes.parkland.high.base.props!;
    brokenFrames[parklandProps.json] = brokenFrames[parklandProps.json]
      .filter((frame) => !frame.startsWith("parkland_tree_"));
    const baseline = auditBiomeAuthoring({ manifest, inventory });
    const selected = baseline.payloads.find((item) =>
      item.biome === "parkland" && item.quality === "high")!;
    const broken = auditBiomeAuthoring({
      manifest,
      inventory: { ...inventory, framesByJson: brokenFrames },
      payloadBudgetBytes: selected.bytes - 1,
    });
    expect(broken.pass).toBe(false);
    expect(broken.findings.some((item) =>
      item.category === "required"
      && item.biome === "parkland"
      && item.quality === "high"
      && item.asset.startsWith("frame.parkland_tree_")
    )).toBe(true);
    expect(broken.payloads.find((item) =>
      item.biome === "parkland" && item.quality === "high"
    )).toMatchObject({
      bytes: selected.bytes,
      budgetBytes: selected.bytes - 1,
      overByBytes: 1,
      status: "over-budget",
    });
    expect(broken.findings).toContainEqual(expect.objectContaining({
      category: "over-budget",
      biome: "parkland",
      quality: "high",
      detail: `${selected.bytes} bytes exceeds ${selected.bytes - 1} byte budget by 1 byte`,
    }));

    const incompleteFixture = structuredClone(createBiomeReferenceFixture("links"));
    incompleteFixture.course.decorations = incompleteFixture.course.decorations?.filter((item) => item.kind !== "bridge");
    const fixtureFailure = auditBiomeAuthoring({
      manifest,
      inventory,
      fixtures: BIOME_KEYS.map((biome) =>
        biome === "links" ? incompleteFixture : createBiomeReferenceFixture(biome)),
    });
    expect(fixtureFailure.pass).toBe(false);
    expect(fixtureFailure.findings).toContainEqual(expect.objectContaining({
      category: "required",
      biome: "links",
      asset: "fixture.decorations",
    }));
  });

  it("fails closed when content bytes do not match a filename digest or Low ships expensive layers", () => {
    const manifest = realManifest();
    const inventory = realInventory(manifest);
    const terrainImage = manifest.biomes.desert.medium.base.terrain.image;
    const tampered = auditBiomeAuthoring({
      manifest,
      inventory: {
        ...inventory,
        sha256ByAsset: { ...inventory.sha256ByAsset, [terrainImage]: "0".repeat(64) },
      },
    });
    expect(tampered.pass).toBe(false);
    expect(tampered.findings).toContainEqual(expect.objectContaining({
      category: "required",
      biome: "desert",
      quality: "medium",
      asset: `provenance.${terrainImage}`,
    }));

    const links = manifest.biomes.links;
    const lowManifest: AtlasManifest = {
      ...manifest,
      biomes: {
        ...manifest.biomes,
        links: {
          ...links,
          low: {
            ...links.low,
            base: {
              ...links.low.base,
              details: links.medium.base.details,
              props: links.medium.base.props,
              fields: { fairway: links.medium.base.fields.fairway! },
            },
          },
        },
      },
    };
    const lowFailure = auditBiomeAuthoring({ manifest: lowManifest, inventory });
    expect(lowFailure.pass).toBe(false);
    for (const asset of [
      "low-policy.base.details",
      "low-policy.base.props",
      "low-policy.base.fields",
    ]) {
      expect(lowFailure.findings).toContainEqual(expect.objectContaining({
        category: "required",
        biome: "links",
        quality: "low",
        asset,
      }));
    }
  });
});
