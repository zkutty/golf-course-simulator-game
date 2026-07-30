import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BIOME_DEFINITIONS,
  BIOME_KEYS,
  CLIMATE_CALENDAR_SEASONS,
  FUTURE_BIOME_ECONOMY_SEEDS,
  auditBiomeDefinitions,
  biomeCompatibilityMetadataFor,
  climateStateFor,
  getBiomeDefinition,
  isLandTheme,
  normalizeBiomeKey,
  resolveFutureBiomeEconomySeed,
  validateBiomeCompatibilityMetadata,
  type BiomeDefinition,
  type ClimatePhenologyRegime,
  type LandTheme,
} from "./biomes";
import type { Terrain } from "./types";
import { LAND_THEMES, getLandTheme } from "./themes";
import { LAND_THEME_KINDS } from "../render/terrainMaterials";

describe("M52 biome and climate content contract", () => {
  it("derives the public theme union and runtime enumerations from one registry", () => {
    expect(BIOME_KEYS).toEqual(["parkland", "links", "desert"]);
    expect(LAND_THEME_KINDS).toBe(BIOME_KEYS);
    expectTypeOf<keyof typeof BIOME_DEFINITIONS>().toEqualTypeOf<LandTheme>();
    expectTypeOf(BIOME_DEFINITIONS).toMatchTypeOf<Record<LandTheme, BiomeDefinition<LandTheme>>>();
    expect(isLandTheme("links")).toBe(true);
    expect(isLandTheme("moonbase")).toBe(false);
    expect(getBiomeDefinition(undefined)).toBe(BIOME_DEFINITIONS.parkland);
    for (const key of BIOME_KEYS) {
      expect(LAND_THEMES[key]).toMatchObject({
        key,
        label: BIOME_DEFINITIONS[key].label,
        blurb: BIOME_DEFINITIONS[key].blurb,
      });
      expect(LAND_THEMES[key].generation).toBe(BIOME_DEFINITIONS[key].generation);
      expect(LAND_THEMES[key].tileTints).toBe(BIOME_DEFINITIONS[key].presentation.tileTints);
      expect(LAND_THEMES[key].cliffFaces).toBe(BIOME_DEFINITIONS[key].presentation.cliffFaces);
      expect(getLandTheme(key)).toBe(LAND_THEMES[key]);
    }
  });

  it("audits complete climate, content ownership, audio, preview, and compatibility metadata", () => {
    expect(auditBiomeDefinitions()).toEqual([]);
    for (const key of BIOME_KEYS) {
      const biome = BIOME_DEFINITIONS[key];
      expect(biome.key).toBe(key);
      expect(biome.compatibility.saveKey).toBe(key);
      expect(biome.compatibility.contentVersion).toBeGreaterThanOrEqual(1);
      expect(biome.presentation.preview.icon).not.toBe("");
      expect(Object.keys(biome.presentation.preview.propTints).sort()).toEqual(["bush", "rock", "tree"]);
      expect(Object.keys(biome.climate.seasons)).toEqual(CLIMATE_CALENDAR_SEASONS);
      expect(biome.content).toMatchObject({
        materials: { terrain: key, details: key, fields: key },
        props: { natural: key },
        structures: { buildings: key, decorations: key },
        audio: { designMusic: `build-${key}`, ambience: key },
      });
    }
  });

  it("keeps exact construction/upkeep and ecological-fit economy contracts", () => {
    const terrain = (
      theme: LandTheme,
    ): Record<Terrain, readonly [construction: number, upkeep: number]> =>
      Object.fromEntries(
        Object.entries(BIOME_DEFINITIONS[theme].economy.terrain).map(
          ([key, value]) => [key, [value.construction, value.upkeep]],
        ),
      ) as unknown as Record<Terrain, readonly [number, number]>;

    expect(terrain("parkland")).toEqual({
      fairway: [1, 1], green: [1, 1], tee: [1, 1], water: [1, 1],
      wetland: [1, 1], sand: [1, 1], waste_area: [1, 1], rough: [1, 1],
      deep_rough: [1, 1], path: [1, 1],
    });
    expect(terrain("links")).toEqual({
      fairway: [.95, .90], green: [1.05, 1.10], tee: [1, 1],
      water: [1.25, 1.10], wetland: [.85, .80], sand: [.90, .90],
      waste_area: [.90, .75], rough: [.85, .80], deep_rough: [.75, .70],
      path: [1, 1],
    });
    expect(terrain("desert")).toEqual({
      fairway: [1.35, 1.55], green: [1.60, 1.80], tee: [1.40, 1.50],
      water: [1.75, 1.40], wetland: [1.80, 1.60], sand: [.75, .70],
      waste_area: [.60, .50], rough: [.70, .55], deep_rough: [.75, .60],
      path: [.90, .85],
    });
    for (const theme of BIOME_KEYS) {
      expect(BIOME_DEFINITIONS[theme].economy.plantFit).toEqual({
        native: {
          installationMultiplier: .75,
          careMultiplier: .70,
          waterMultiplier: .70,
        },
        adapted: {
          installationMultiplier: 1,
          careMultiplier: 1,
          waterMultiplier: 1,
        },
        imported: {
          installationMultiplier: 1.60,
          careMultiplier: 1.75,
          waterMultiplier: 1.60,
        },
      });
    }
  });

  it("resolves all five typed future economy seeds without registering them", () => {
    expect(Object.keys(FUTURE_BIOME_ECONOMY_SEEDS)).toEqual([
      "tropical-coastal-resort",
      "temperate-japan",
      "alpine-mountain",
      "heathland",
      "australian-sandbelt",
    ]);
    expect(BIOME_KEYS).toEqual(["parkland", "links", "desert"]);
    for (const id of Object.keys(FUTURE_BIOME_ECONOMY_SEEDS) as Array<
      keyof typeof FUTURE_BIOME_ECONOMY_SEEDS
    >) {
      const resolved = resolveFutureBiomeEconomySeed(id);
      expect(Object.keys(resolved.terrain)).toEqual(
        Object.keys(BIOME_DEFINITIONS.parkland.economy.terrain),
      );
      expect(Object.keys(resolved.water.seasonalDemand)).toEqual(
        CLIMATE_CALENDAR_SEASONS,
      );
      expect(Object.keys(resolved.naturalFeatures)).toEqual([
        "tree",
        "bush",
        "rock",
      ]);
      expect(Object.keys(resolved.plantFit)).toEqual([
        "native",
        "adapted",
        "imported",
      ]);
      const numericLeaves = JSON.stringify(resolved)
        .match(/-?\d+(?:\.\d+)?/g)
        ?.map(Number) ?? [];
      expect(numericLeaves.length).toBeGreaterThan(40);
      expect(numericLeaves.every(Number.isFinite)).toBe(true);
    }
  });

  it("normalizes historical display identifiers and fails closed on unsupported compatibility evidence", () => {
    expect(normalizeBiomeKey("Parkland")).toBe("parkland");
    expect(normalizeBiomeKey(" LINKS ")).toBe("links");
    expect(normalizeBiomeKey("Desert")).toBe("desert");
    expect(normalizeBiomeKey("moonbase")).toBeNull();

    const links = biomeCompatibilityMetadataFor("links");
    expect(validateBiomeCompatibilityMetadata(undefined, "links")).toEqual({
      ok: true,
      metadata: links,
      migrated: true,
    });
    expect(validateBiomeCompatibilityMetadata({ ...links, contentVersion: links.contentVersion + 1 }, "links"))
      .toMatchObject({ ok: false, kind: "unsupported" });
    expect(validateBiomeCompatibilityMetadata(links, "desert"))
      .toMatchObject({ ok: false, kind: "corrupt" });
  });

  it("resolves semantic climate state without consulting presentation assets", () => {
    expect(climateStateFor("parkland", "spring")).toMatchObject({
      biome: "parkland",
      calendarSeason: "spring",
      temperature: { baseF: 59, seasonalOffsetF: 3, heatThresholdF: 91 },
      precipitation: { chance: 0.34, moisture: "wet" },
      windBaseMph: 6,
      stormChance: 0.026,
      droughtChance: 0,
      dormancy: 0.15,
      foliage: "emerging",
      flowering: 0.85,
      snow: { enabled: false, chance: 0 },
    });
    expect(climateStateFor("links", "winter")).toMatchObject({
      precipitation: { chance: 0.32, moisture: "wet" },
      windBaseMph: 15,
      droughtChance: 0,
      foliage: "sparse",
      snow: { enabled: true, maximumTemperatureF: 34, chance: .14 },
    });
    expect(climateStateFor("parkland", "winter").snow)
      .toEqual({ enabled: true, maximumTemperatureF: 38, chance: .28 });
    const desertSummer = climateStateFor("desert", "summer");
    expect(desertSummer).toMatchObject({
      temperature: { baseF: 72, seasonalOffsetF: 17, heatThresholdF: 100 },
      precipitation: { moisture: "dry" },
      droughtChance: 0.22,
      foliage: "sparse",
    });
    expect(desertSummer.precipitation.chance).toBeCloseTo(0.05);
    expect(desertSummer.stormChance).toBeCloseTo(0.019);
    expect(climateStateFor("desert", "winter").snow)
      .toEqual({ enabled: false, maximumTemperatureF: 32, chance: 0 });
  });

  it("declares current and future-ready phenology semantics without adding biome keys", () => {
    const futureContracts: readonly ClimatePhenologyRegime[] = [
      "tropical-wet-dry",
      "alpine-frost-snow",
    ];
    expect(futureContracts).toHaveLength(2);
    expect(BIOME_DEFINITIONS.parkland.climate.phenology).toEqual({
      regime: "temperate-four-season",
      exposure: "moderate",
    });
    expect(BIOME_DEFINITIONS.links.climate.phenology).toEqual({
      regime: "coastal-four-season",
      exposure: "exposed",
    });
    expect(BIOME_DEFINITIONS.desert.climate.phenology).toEqual({
      regime: "arid-heat-drought",
      exposure: "sheltered",
    });
    expect(BIOME_KEYS).toEqual(["parkland", "links", "desert"]);
  });

  it("reports malformed runtime content instead of silently accepting it", () => {
    const malformed = structuredClone(BIOME_DEFINITIONS) as unknown as Record<
      string,
      BiomeDefinition<string>
    >;
    malformed.parkland.compatibility.contentVersion = 0;
    malformed.parkland.compatibility.legacyAliases = ["desert", "shared"];
    malformed.links.compatibility.saveKey = "parkland";
    malformed.links.presentation.preview.icon = " ";
    malformed.links.presentation.preview.propTints.tree = -1;
    malformed.desert.compatibility.legacyAliases = ["shared"];
    malformed.desert.generation.water.fracMin = Number.POSITIVE_INFINITY;
    malformed.desert.generation.obstacles.treeRatio = 2;
    malformed.desert.climate.precipitationBaseChance = 2;
    malformed.desert.climate.seasons.summer.stormChance = 2;
    malformed.desert.climate.seasons.summer.droughtChance = -1;
    malformed.desert.climate.seasons.summer.frost.precipitationChanceMultiplier = 1.2;
    malformed.desert.climate.seasons.summer.snow.chance = Number.NaN;
    malformed.desert.climate.phenology.regime = "unsupported" as ClimatePhenologyRegime;
    malformed.parkland.economy.terrain.green.upkeep = Number.NaN;
    delete (malformed.links.economy.terrain as Partial<
      Record<Terrain, unknown>
    >).water;
    malformed.desert.economy.plantFit.imported.waterMultiplier = 0;

    const errors = auditBiomeDefinitions(malformed).join("\n");
    expect(errors).toContain("parkland: content version must be an integer at least 1");
    expect(errors).toContain("links: save key must match registry key");
    expect(errors).toContain("links: duplicate save key");
    expect(errors).toContain("legacy alias collides");
    expect(errors).toContain("links: preview icon is required");
    expect(errors).toContain("links: preview tree color must be a 24-bit color");
    expect(errors).toContain("desert: water fraction minimum must be finite");
    expect(errors).toContain("desert: tree ratio must be finite");
    expect(errors).toContain("desert: obstacle ratios must sum to 1");
    expect(errors).toContain("desert: base precipitation chance must be finite");
    expect(errors).toContain("desert/summer: storm chance must be finite");
    expect(errors).toContain("desert/summer: drought chance must be finite");
    expect(errors).toContain("desert/summer: frost precipitation multiplier must be finite");
    expect(errors).toContain("desert/summer: snow chance must be between zero and one");
    expect(errors).toContain("desert: climate phenology regime is not supported");
    expect(errors).toContain("parkland: green upkeep multiplier must be finite");
    expect(errors).toContain("links: economy terrain metadata must cover every terrain");
    expect(errors).toContain("links: water economy metadata is required");
    expect(errors).toContain("desert: imported plant water multiplier must be finite");
  });
});
