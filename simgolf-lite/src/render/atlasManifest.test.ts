import { describe, expect, it } from "vitest";
import {
  normalizeAtlasManifest,
  selectedOverlay,
  type AtlasBundleFile,
} from "./atlasManifest";

const file = (name: string): AtlasBundleFile => ({
  json: `${name}.123456789abc.json`,
  image: `${name}.abcdef123456.png`,
});
const base = {
  buildings: file("buildings"),
  terrain: file("terrain"),
  details: file("details"),
  props: file("props"),
  fields: { fairway: { image: "fairway.123456789abc.png" } },
};

function manifest(version: 1 | 2) {
  const tier = (quality: "high" | "medium" | "low") => version === 1
    ? base
    : {
      base,
      seasonal: quality === "low" ? {} : {
        autumn: {
          materials: { rough: { image: "autumn-rough.123456789abc.png" } },
          props: file("autumn-props"),
          decals: null,
        },
      },
    };
  return {
    version,
    core: { golfers: file("golfers") },
    biomes: {
      parkland: { high: tier("high"), medium: tier("medium"), low: tier("low") },
    },
  };
}

describe("atlas manifest schema and compatibility", () => {
  it("migrates the legacy v1 tier into an explicit base-only v2 view", () => {
    const parsed = normalizeAtlasManifest(manifest(1), ["parkland"]);
    expect(parsed.sourceVersion).toBe(1);
    expect(parsed.biomes.parkland.high.base.terrain.json).toContain("terrain");
    expect(parsed.biomes.parkland.high.seasonal).toEqual({});
  });

  it("keeps one optional current-season overlay without cloning the base", () => {
    const parsed = normalizeAtlasManifest(manifest(2), ["parkland"]);
    const autumn = selectedOverlay(parsed, "parkland", "high", "autumn");
    expect(autumn?.materials.rough?.image).toContain("autumn-rough");
    expect(autumn?.props?.json).toContain("autumn-props");
    expect(selectedOverlay(parsed, "parkland", "high", "winter")).toBeNull();
  });

  it("fails closed for unknown schemas, missing registered biomes, and bad asset references", () => {
    expect(() => normalizeAtlasManifest({ ...manifest(2), version: 3 }, ["parkland"])).toThrow(/unsupported/);
    expect(() => normalizeAtlasManifest(manifest(2), ["links"])).toThrow(/links/);
    const valid = manifest(2);
    const invalid = {
      ...valid,
      core: { golfers: { ...valid.core.golfers, json: "" } },
    };
    expect(() => normalizeAtlasManifest(invalid, ["parkland"])).toThrow(/non-empty string/);
    const unknownSeason = manifest(2);
    (unknownSeason.biomes.parkland.high as { seasonal: Record<string, unknown> }).seasonal.monsoon = {
      materials: {},
      props: null,
      decals: null,
    };
    expect(() => normalizeAtlasManifest(unknownSeason, ["parkland"])).toThrow(/unknown season/);
  });
});
