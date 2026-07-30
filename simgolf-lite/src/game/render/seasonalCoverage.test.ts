import { describe, expect, it } from "vitest";
import {
  BIOME_DEFINITIONS,
  BIOME_KEYS,
  CLIMATE_CALENDAR_SEASONS,
} from "../models/biomes";
import {
  SEASONAL_COVERAGE_CONTRACT,
  SEASONAL_TREATMENT_ROUTES,
  SEASONAL_VISUAL_FAMILIES,
  auditSeasonalCoverageContract,
} from "./seasonalCoverage";

describe("ZK-379 seasonal coverage contract", () => {
  it("covers every biome x calendar season x visual family", () => {
    expect(auditSeasonalCoverageContract(SEASONAL_COVERAGE_CONTRACT)).toEqual([]);
    let cells = 0;
    for (const biome of BIOME_KEYS) {
      const coverage = SEASONAL_COVERAGE_CONTRACT.biomes[biome];
      expect(BIOME_DEFINITIONS[biome].compatibility.fallbackBiome).toBe(biome);
      for (const season of CLIMATE_CALENDAR_SEASONS) {
        expect(Object.keys(coverage.seasons[season]).sort()).toEqual(
          [...SEASONAL_VISUAL_FAMILIES].sort(),
        );
        for (const family of SEASONAL_VISUAL_FAMILIES) {
          const treatment = coverage.seasons[season][family];
          expect(SEASONAL_TREATMENT_ROUTES).toContain(treatment.route);
          expect(treatment.fallback).toEqual({
            route: "same-biome-base",
            biome,
          });
          cells += 1;
        }
      }
    }
    expect(cells).toBe(3 * 4 * 8);
  });

  it("rejects missing, malformed, and cross-biome fallback cells", () => {
    const malformed = structuredClone(SEASONAL_COVERAGE_CONTRACT) as unknown as {
      biomes: Record<string, {
        seasons: Record<string, Record<string, {
          route: string;
          fallback: { route: string; biome: string };
          signals: string[];
        }>>;
      }>;
    };
    delete malformed.biomes.links.seasons.autumn["construction"];
    malformed.biomes.parkland.seasons.winter["buildings"].route = "replace-everything";
    malformed.biomes.desert.seasons.summer["natural-props"].fallback.biome = "parkland";

    const errors = auditSeasonalCoverageContract(malformed);
    expect(errors).toContain("links/autumn/construction: treatment is missing");
    expect(errors).toContain("parkland/winter/buildings: treatment route is invalid");
    expect(errors).toContain(
      'desert/summer/natural-props: fallback must use the same-biome "desert" base',
    );
  });

  it("keeps art direction climate-possible and biome-specific", () => {
    expect(SEASONAL_COVERAGE_CONTRACT.biomes.parkland.direction).toBe("four-season");
    expect(SEASONAL_COVERAGE_CONTRACT.biomes.links.direction).toBe("exposed-muted");
    expect(SEASONAL_COVERAGE_CONTRACT.biomes.desert.direction).toBe("drought-heat-led");

    for (const season of CLIMATE_CALENDAR_SEASONS) {
      for (const treatment of Object.values(
        SEASONAL_COVERAGE_CONTRACT.biomes.desert.seasons[season],
      )) {
        expect(treatment.signals).not.toContain("snow");
        expect(treatment.fallback.biome).toBe("desert");
      }
    }
    expect(
      SEASONAL_COVERAGE_CONTRACT.biomes.desert.seasons.summer[
        "terrain-material-fields"
      ].signals,
    ).toEqual(expect.arrayContaining(["drought", "heat"]));
    expect(
      SEASONAL_COVERAGE_CONTRACT.biomes.links.seasons.winter[
        "weather-dressing"
      ].signals,
    ).toContain("exposure");
  });
});
