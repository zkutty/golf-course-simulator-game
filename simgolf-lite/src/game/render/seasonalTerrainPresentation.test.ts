import { describe, expect, it } from "vitest";
import { TERRAIN_PALETTES } from "../../accessibility/terrainPalettes";
import { createNewGame } from "../gen/newGame";
import { TERRAIN_KINDS } from "./terrainMaterials";
import { seasonalVisualState, type SeasonalVisualState } from "../presentation/seasonalVisualState";
import { biomeClimatePhenologyForDay, weatherModifiers } from "../seasons/seasons";
import type { DailyWeather, SeasonName, WeatherKind } from "../seasons/types";
import {
  SEASONAL_TERRAIN_DECAL_BUDGET,
  seasonalTerrainDecals,
  seasonalTerrainSummary,
  seasonalTerrainTreatment,
} from "./seasonalTerrainPresentation";

function fixture(theme: "parkland" | "links" | "desert" = "parkland") {
  const game = createNewGame({
    mode: "sandbox",
    courseName: "ZK-567 Terrain Fixture",
    seed: 567_053,
    theme,
    difficulty: "normal",
  });
  return {
    course: {
      ...game.course,
      width: 10,
      height: 10,
      tiles: Array.from({ length: 100 }, (_, index) => TERRAIN_KINDS[index % TERRAIN_KINDS.length]),
      elevations: new Array(100).fill(0),
      holes: [],
      obstacles: [],
    },
    world: game.world,
  };
}

const seasonDay: Record<SeasonName, number> = {
  spring: 28,
  summer: 84,
  autumn: 140,
  winter: 196,
};

function severeState(
  theme: "parkland" | "links" | "desert",
  season: SeasonName,
  kind: WeatherKind,
  options: { snow?: boolean; colorDay?: number } = {},
): SeasonalVisualState {
  const { course, world } = fixture(theme);
  const absoluteDay = options.colorDay ?? seasonDay[season];
  const base = seasonalVisualState({
    course,
    world: { ...world, week: Math.floor(absoluteDay / 7) + 1 },
    day: absoluteDay % 7,
  });
  const weather: DailyWeather = {
    ...base.weather,
    absoluteDay,
    season,
    kind,
    severity: .92,
    rainInches: kind === "storm" ? 1.6 : kind === "heavy_rain" ? .8 : kind === "rain" ? .24 : 0,
    temperatureF: kind === "frost" ? 26 : kind === "heat" || kind === "drought" ? 104 : 58,
  };
  return {
    ...base,
    climate: {
      ...biomeClimatePhenologyForDay(theme, absoluteDay),
      ...(options.snow ? {
        snow: {
          enabled: true,
          maximumTemperatureF: 32,
          chance: .72,
        },
      } : {}),
    },
    weather,
    modifiers: weatherModifiers(weather),
    renderer: {
      ...base.renderer,
      wetness: kind === "storm" || kind === "heavy_rain" ? .96 : kind === "rain" ? .78 : kind === "frost" ? .68 : .2,
      dryness: kind === "drought" || kind === "heat" ? .94 : .24,
      frost: kind === "frost" ? .92 : 0,
    },
  };
}

describe("ZK-567 seasonal terrain presentation", () => {
  it("keeps all ten terrain identities distinct across biomes, seasons, qualities, and color-vision modes", () => {
    for (const theme of ["parkland", "links", "desert"] as const) {
      for (const season of ["spring", "summer", "autumn", "winter"] as const) {
        const kind: WeatherKind = season === "spring" ? "storm"
          : season === "summer" ? "drought"
            : season === "autumn" ? "heavy_rain"
              : "frost";
        const state = severeState(theme, season, kind);
        for (const quality of ["low", "medium", "high"] as const) {
          for (const colorVision of Object.keys(TERRAIN_PALETTES) as Array<keyof typeof TERRAIN_PALETTES>) {
            const treatments = TERRAIN_KINDS.map((terrain) => seasonalTerrainTreatment({
              state,
              terrain,
              quality,
              colorVision,
            }));
            expect(new Set(treatments.map((treatment) => treatment.color)).size).toBe(10);
            expect(treatments.every((treatment) => treatment.opaqueCoverage === 0)).toBe(true);
          }
        }
      }
    }
  });

  it("uses declarative biome profiles for full temperate, muted exposed, and drought-led responses", () => {
    const parklandWinter = seasonalTerrainTreatment({
      state: severeState("parkland", "winter", "frost"),
      terrain: "rough",
      quality: "high",
      colorVision: "standard",
    });
    const linksWinter = seasonalTerrainTreatment({
      state: severeState("links", "winter", "frost"),
      terrain: "rough",
      quality: "high",
      colorVision: "standard",
    });
    const desertSummer = seasonalTerrainTreatment({
      state: severeState("desert", "summer", "drought"),
      terrain: "rough",
      quality: "high",
      colorVision: "standard",
    });
    const parklandSummer = seasonalTerrainTreatment({
      state: severeState("parkland", "summer", "drought"),
      terrain: "rough",
      quality: "high",
      colorVision: "standard",
    });

    expect(parklandWinter.channels.frost).toBeGreaterThan(linksWinter.channels.frost);
    expect(desertSummer.channels.drought).toBeGreaterThan(parklandSummer.channels.drought);
    expect(seasonalTerrainSummary(
      severeState("parkland", "autumn", "clear"),
      "high",
      "standard",
      false,
    ).profile).toBe("four-season");
    expect(seasonalTerrainSummary(
      severeState("links", "autumn", "clear"),
      "high",
      "standard",
      false,
    ).profile).toBe("exposed-muted");
    expect(seasonalTerrainSummary(
      severeState("desert", "summer", "drought"),
      "high",
      "standard",
      false,
    ).profile).toBe("drought-heat-led");
  });

  it("never treats water as land or applies opaque/partial snow to aquatic cells", () => {
    const state = severeState("parkland", "winter", "frost");
    const water = seasonalTerrainTreatment({
      state,
      terrain: "water",
      quality: "high",
      colorVision: "standard",
    });
    const rough = seasonalTerrainTreatment({
      state,
      terrain: "rough",
      quality: "high",
      colorVision: "standard",
    });
    expect(water.aquatic).toBe(true);
    expect(water.channels.snow).toBe(0);
    expect(water.supportedCues).toEqual(["water-sheen"]);
    expect(water.opaqueCoverage).toBe(0);
    expect(rough.channels.snow).toBeGreaterThan(0);
    expect(state.climate.snow.enabled).toBe(true);
    expect(severeState("links", "winter", "frost").climate.snow.enabled).toBe(true);
    expect(severeState("desert", "winter", "frost").climate.snow.enabled).toBe(false);

    const tiles = ["water", "rough", "wetland", "fairway"] as const;
    const decals = seasonalTerrainDecals({
      state,
      tiles,
      width: 2,
      height: 2,
      quality: "high",
      colorVision: "standard",
      seed: 567,
    });
    expect(decals.filter((decal) => decal.terrain === "water").every((decal) =>
      decal.cue === "water-sheen" && decal.opaque === false)).toBe(true);
    expect(decals.every((decal) => decal.alpha <= .48)).toBe(true);
  });

  it("is deterministic across reload/rotation inputs and bounded by quality", () => {
    const state = severeState("parkland", "autumn", "heavy_rain");
    const tiles = Array.from({ length: 110 * 70 }, (_, index) =>
      TERRAIN_KINDS[index % TERRAIN_KINDS.length]);
    for (const quality of ["low", "medium", "high"] as const) {
      const input = {
        state,
        tiles,
        width: 110,
        height: 70,
        quality,
        colorVision: "standard" as const,
        seed: 567,
      };
      const baseline = seasonalTerrainDecals(input);
      const reloadedState = {
        ...state,
        climate: structuredClone(state.climate),
        weather: structuredClone(state.weather),
        modifiers: structuredClone(state.modifiers),
        condition: structuredClone(state.condition),
        renderer: structuredClone(state.renderer),
      };
      expect(seasonalTerrainDecals({ ...input, state: reloadedState })).toEqual(baseline);
      expect(baseline.length).toBeLessThanOrEqual(SEASONAL_TERRAIN_DECAL_BUDGET[quality]);
      if (quality === "low") expect(baseline).toEqual([]);
    }
  });

  it("preserves cue information under reduced-motion and color-vision settings", () => {
    const state = severeState("parkland", "winter", "frost", { snow: true });
    const standard = seasonalTerrainSummary(state, "high", "standard", false);
    const reduced = seasonalTerrainSummary(state, "high", "deuteranopia", true);
    for (const terrain of TERRAIN_KINDS) {
      expect(reduced.terrains[terrain].channels).toEqual(standard.terrains[terrain].channels);
      expect(reduced.terrains[terrain].supportedCues).toEqual(standard.terrains[terrain].supportedCues);
      expect(reduced.terrains[terrain].opaqueCoverage).toBe(0);
    }
    expect(reduced.decalBudget).toBe(standard.decalBudget);

    const cvdTreatment = seasonalTerrainTreatment({
      state,
      terrain: "rough",
      quality: "high",
      colorVision: "deuteranopia",
    });
    const base = TERRAIN_PALETTES.deuteranopia.rough;
    const multiply = (shift: number) => Math.round(
      ((base >> shift) & 0xff) * ((cvdTreatment.textureTint >> shift) & 0xff) / 255,
    );
    expect((multiply(16) << 16) | (multiply(8) << 8) | multiply(0)).toBe(cvdTreatment.color);
    expect(cvdTreatment.textureTint).not.toBe(cvdTreatment.color);
  });

  it("excludes protected tee/pin cells from every seasonal decal command", () => {
    const state = severeState("parkland", "winter", "frost", { snow: true });
    const tiles = new Array(64).fill("rough") as Array<"rough">;
    const baseline = seasonalTerrainDecals({
      state,
      tiles,
      width: 8,
      height: 8,
      quality: "high",
      colorVision: "standard",
      seed: 567,
    });
    const protectedCells = new Set(baseline.map((decal) =>
      Math.floor(decal.y) * 8 + Math.floor(decal.x)));
    expect(protectedCells.size).toBeGreaterThan(0);
    const protectedResult = seasonalTerrainDecals({
      state,
      tiles,
      width: 8,
      height: 8,
      quality: "high",
      colorVision: "standard",
      seed: 567,
      protectedCells,
    });
    expect(protectedResult.every((decal) =>
      !protectedCells.has(Math.floor(decal.y) * 8 + Math.floor(decal.x)))).toBe(true);
  });

  it("blends seasonal signals continuously across the calendar boundary", () => {
    const before = severeState("parkland", "spring", "clear", { colorDay: 55 });
    const after = severeState("parkland", "summer", "clear", { colorDay: 56 });
    const beforeTreatment = seasonalTerrainTreatment({
      state: before,
      terrain: "rough",
      quality: "high",
      colorVision: "standard",
    });
    const afterTreatment = seasonalTerrainTreatment({
      state: after,
      terrain: "rough",
      quality: "high",
      colorVision: "standard",
    });
    for (const channel of Object.keys(beforeTreatment.channels) as Array<keyof typeof beforeTreatment.channels>) {
      expect(Math.abs(beforeTreatment.channels[channel] - afterTreatment.channels[channel])).toBeLessThan(.16);
    }
  });

  it("keeps repeated treatment work bounded within the renderer work budget", () => {
    const state = severeState("desert", "summer", "drought");
    const started = performance.now();
    for (let index = 0; index < 10_000; index++) {
      seasonalTerrainTreatment({
        state,
        terrain: TERRAIN_KINDS[index % TERRAIN_KINDS.length],
        quality: index % 2 ? "medium" : "high",
        colorVision: "standard",
      });
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});
