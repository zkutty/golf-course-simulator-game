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

function manifest(version: 1 | 2 | 3) {
  const tier = (quality: "high" | "medium" | "low") => version === 1
    ? base
    : {
      base,
      seasonal: quality === "low" ? {} : {
        autumn: version === 2
          ? {
            materials: { rough: { image: "autumn-rough.123456789abc.png" } },
            props: file("autumn-props"),
            decals: null,
          }
          : {
            owner: "parkland",
            season: "autumn",
            materials: { rough: { image: "autumn-rough.123456789abc.png" } },
            frames: {
              "natural-props": file("autumn-props"),
              buildings: file("autumn-buildings"),
            },
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

  it("migrates the v2 props/decals overlay into typed same-biome ownership", () => {
    const parsed = normalizeAtlasManifest(manifest(2), ["parkland"]);
    const autumn = selectedOverlay(parsed, "parkland", "high", "autumn");
    expect(autumn?.materials.rough?.image).toContain("autumn-rough");
    expect(autumn?.owner).toBe("parkland");
    expect(autumn?.season).toBe("autumn");
    expect(autumn?.frames["natural-props"]?.json).toContain("autumn-props");
    expect(selectedOverlay(parsed, "parkland", "high", "winter")).toBeNull();
  });

  it("keeps typed sprite families isolated in v3", () => {
    const parsed = normalizeAtlasManifest(manifest(3), ["parkland"]);
    const autumn = selectedOverlay(parsed, "parkland", "high", "autumn");
    expect(autumn?.frames["natural-props"]?.json).toContain("autumn-props");
    expect(autumn?.frames.buildings?.json).toContain("autumn-buildings");
    expect(autumn?.frames.decorations).toBeUndefined();
  });

  it("fails closed for unknown schemas, missing registered biomes, and bad asset references", () => {
    expect(() => normalizeAtlasManifest({ ...manifest(3), version: 4 }, ["parkland"])).toThrow(/unsupported/);
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

    const wrongOwner = manifest(3);
    (wrongOwner.biomes.parkland.high as {
      seasonal: { autumn: { owner: string } };
    }).seasonal.autumn.owner = "links";
    expect(() => normalizeAtlasManifest(wrongOwner, ["parkland"])).toThrow(/same-biome owner/);

    const unknownFamily = manifest(3);
    ((unknownFamily.biomes.parkland.high as {
      seasonal: { autumn: { frames: Record<string, unknown> } };
    }).seasonal.autumn.frames).vehicles = file("autumn-vehicles");
    expect(() => normalizeAtlasManifest(unknownFamily, ["parkland"])).toThrow(/unknown seasonal frame family/);
  });
});
