import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { terrainCostMult } from "../balance/difficulty";
import type { GameState } from "../gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./defaults";
import {
  IRRIGATION_REFERENCE_MAINTAINED_AREA_UNITS,
  PARKLAND_BALANCED_IRRIGATION_REFERENCE_DAILY_COST,
  maintainedAreaDemandUnits,
  playerPlantingDemand,
  quoteDailyBiomeOperatingCosts,
  quoteIrrigationFromDemand,
  weatherIrrigationDemandMultiplier,
} from "./biomeOperatingCosts";
import {
  decorationCost,
  decorationRemovalQuote,
} from "./decorations";
import {
  defaultObstaclePlantId,
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
} from "./plantRegistry";
import { previewTerrainStroke } from "./terrainStroke";
import {
  computeElevationChangeCost,
  computeTerrainChangeCost,
  terrainConstructionUnitCost,
  terrainSalvageUnitValue,
} from "./terrainEconomics";
import type { Course, Decoration, LandTheme, Obstacle } from "./types";
import type { DailyWeather, WeatherKind } from "../seasons/types";
import { commitDay } from "../live/commitDay";
import { evaluateHole } from "../eval/evaluateHole";

function weather(
  kind: WeatherKind,
  temperatureF: number,
  rainInches: number,
  severity = .5,
): DailyWeather {
  return {
    absoluteDay: 12,
    kind,
    temperatureF,
    windMph: 8,
    rainInches,
    severity,
    theme: "parkland",
    season: "summer",
  };
}

function tinyCourse(theme: LandTheme = "parkland"): Course {
  return {
    ...DEFAULT_COURSE,
    width: 4,
    height: 2,
    tiles: new Array(8).fill("rough"),
    elevations: new Array(8).fill(0),
    holes: [],
    layouts: [],
    obstacles: [],
    buildings: [],
    decorations: [],
    theme,
    estate: undefined,
    property: undefined,
  };
}

function state(course: Course, difficulty: "easy" | "normal" | "hard" = "normal"): GameState {
  const economicPressure = difficulty === "easy" ? "friendly" : difficulty === "hard" ? "tight" : "balanced";
  return {
    course,
    world: {
      ...DEFAULT_WORLD,
      cash: 100_000,
      economicPressure,
      constraints: undefined,
    },
    selectedTerrain: "fairway",
    terrainVersion: 0,
    obstaclesVersion: 0,
    markersVersion: 0,
    economyVersion: 0,
  };
}

function courseWithTerrainMix(
  theme: LandTheme,
  mix: Array<readonly [Course["tiles"][number], number]>,
): Course {
  const tiles = mix.flatMap(([terrain, count]) =>
    new Array(count).fill(terrain) as Course["tiles"]
  );
  const width = 100;
  const height = Math.ceil(tiles.length / width);
  while (tiles.length < width * height) tiles.push("rough");
  const nativePlant = defaultObstaclePlantId(theme, "tree");
  return {
    ...tinyCourse(theme),
    width,
    height,
    tiles,
    elevations: new Array(tiles.length).fill(0),
    obstacles: [{
      x: 1,
      y: 1,
      type: "tree",
      origin: "player",
      plantId: nativePlant,
    }],
  };
}

describe("biome economy quotes", () => {
  it("keeps the direct Parkland Balanced neutral reference at exactly $42", () => {
    const quote = quoteIrrigationFromDemand({
      theme: "parkland",
      maintainedAreaUnits: IRRIGATION_REFERENCE_MAINTAINED_AREA_UNITS,
      policy: "balanced",
    });
    expect(quote.waterCost)
      .toBe(PARKLAND_BALANCED_IRRIGATION_REFERENCE_DAILY_COST);
    expect(quote.waterCost).toBe(42);
    expect(quote.seasonalDemandMultiplier).toBe(1);
    expect(quote.weatherDemandMultiplier).toBe(1);
    expect(quote.policyMultiplier).toBe(1);
  });

  it("uses supplied current/forecast weather deterministically within 0.75–1.25", () => {
    const hot = weather("drought", 130, 0, 1);
    const wet = weather("storm", 35, 5, 1);
    expect(weatherIrrigationDemandMultiplier(hot, [hot, hot])).toBe(1.25);
    expect(weatherIrrigationDemandMultiplier(wet, [wet, wet])).toBe(.75);
    const mixed = weatherIrrigationDemandMultiplier(hot, [wet, wet]);
    expect(mixed).toBeGreaterThanOrEqual(.75);
    expect(mixed).toBeLessThanOrEqual(1.25);
    expect(weatherIrrigationDemandMultiplier(hot, [wet, wet])).toBe(mixed);
  });

  it("counts maintained surfaces plus authored plants but leaves natural obstacles free", () => {
    const course = tinyCourse();
    course.tiles = [
      "fairway", "green", "rough", "path",
      "sand", "water", "wetland", "deep_rough",
    ];
    course.obstacles = [
      { x: 0, y: 0, type: "tree" },
      {
        x: 1,
        y: 0,
        type: "tree",
        origin: "player",
        plantId: "parkland-oak",
      },
    ];
    // Missing origin is ambiguous with deterministic starter generation and
    // therefore remains natural/free.
    course.decorations = [{
      kind: "flower_bed",
      x: 2,
      y: 0,
      rotation: 0,
      plantId: "parkland-perennial-bed",
    }];
    expect(maintainedAreaDemandUnits(course)).toBeCloseTo(3.08);
    const planting = playerPlantingDemand(course);
    expect(planting.waterUnits).toBeCloseTo(1.68);
    expect(planting.careCost).toBeCloseTo(.126);
    expect(decorationRemovalQuote(course.decorations![0], "parkland")).toEqual({
      net: 0,
      charged: 0,
      refunded: 0,
      gross: 0,
      salvage: 0,
    });
  });

  it("applies difficulty as one outer multiplier to water, care, and drainage", () => {
    const course = tinyCourse("desert");
    course.obstacles = [{
      x: 0,
      y: 0,
      type: "tree",
      origin: "player",
      plantId: "parkland-oak",
    }];
    const normal = quoteDailyBiomeOperatingCosts({
      course,
      season: "summer",
      currentWeather: weather("heat", 102, 0),
      publishedForecast: [weather("clear", 96, 0)],
      policy: "balanced",
      drainageLevel: 2,
      costMult: 1,
    });
    const hard = quoteDailyBiomeOperatingCosts({
      course,
      season: "summer",
      currentWeather: weather("heat", 102, 0),
      publishedForecast: [weather("clear", 96, 0)],
      policy: "balanced",
      drainageLevel: 2,
      costMult: 1.15,
    });
    expect(hard.waterCost).toBeCloseTo(normal.waterCost * 1.15);
    expect(hard.plantCareCost).toBeCloseTo(normal.plantCareCost * 1.15);
    expect(hard.drainageCareCost).toBeCloseTo(normal.drainageCareCost * 1.15);
    expect(hard.total).toBeCloseTo(normal.total * 1.15);
  });

  it("replaces the flat live-day charge with deterministic course demand", () => {
    const world = {
      ...DEFAULT_WORLD,
      cash: 100_000,
      seasonal: {
        ...DEFAULT_WORLD.seasonal!,
        operations: {
          ...DEFAULT_WORLD.seasonal!.operations,
          waterPolicy: "balanced" as const,
        },
      },
    };
    const reactions = {
      rounds: 0,
      avgSatisfaction: 0,
      promoters: 0,
      detractors: 0,
      willReturnRate: .5,
    };
    const lowDemand = tinyCourse("parkland");
    const highDemand = {
      ...tinyCourse("parkland"),
      tiles: new Array(8).fill("green" as const),
    };
    const first = commitDay({
      course: lowDemand,
      world,
      revenue: 0,
      reactions,
      dayIndex: 0,
    });
    const repeat = commitDay({
      course: lowDemand,
      world,
      revenue: 0,
      reactions,
      dayIndex: 0,
    });
    const larger = commitDay({
      course: highDemand,
      world,
      revenue: 0,
      reactions,
      dayIndex: 0,
    });
    expect(first.result.biomeEconomy).toEqual(repeat.result.biomeEconomy);
    expect(first.world.seasonal?.forecast).toEqual(repeat.world.seasonal?.forecast);
    expect(first.world.runSeed).toBe(world.runSeed);
    expect(first.result.biomeEconomy?.waterCost).not.toBe(42);
    expect(larger.result.biomeEconomy!.waterCost)
      .toBeGreaterThan(first.result.biomeEconomy!.waterCost);
    expect(first.result.biomeEconomy!.total).toBeCloseTo(
      first.result.biomeEconomy!.waterCost
      + first.result.biomeEconomy!.plantCareCost
      + first.result.biomeEconomy!.drainageCareCost,
    );
  });

  it("keeps climate-appropriate starter landscapes inside the weekly maintenance envelope", () => {
    const starters = {
      parkland: courseWithTerrainMix("parkland", [
        ["fairway", 1_600], ["green", 300], ["tee", 200], ["rough", 1_900],
      ]),
      links: courseWithTerrainMix("links", [
        ["fairway", 1_200], ["green", 200], ["tee", 160],
        ["deep_rough", 2_000], ["waste_area", 440],
      ]),
      desert: courseWithTerrainMix("desert", [
        ["fairway", 700], ["green", 150], ["tee", 120],
        ["waste_area", 2_000], ["sand", 1_030],
      ]),
    };
    const quotes = Object.fromEntries(
      (Object.entries(starters) as Array<[LandTheme, Course]>).map(
        ([theme, course]) => [theme, quoteDailyBiomeOperatingCosts({
          course,
          season: "summer",
          currentWeather: weather("clear", 75, 0),
          publishedForecast: [weather("clear", 75, 0)],
          policy: "balanced",
          drainageLevel: 0,
          costMult: 1,
        })],
      ),
    ) as Record<LandTheme, ReturnType<typeof quoteDailyBiomeOperatingCosts>>;
    for (const theme of ["parkland", "links", "desert"] as const) {
      expect(quotes[theme].total * 7)
        .toBeLessThan(DEFAULT_WORLD.maintenanceBudget);
    }
    // Xeric landscape choices offset Desert water scarcity instead of making
    // a climate-appropriate starter categorically less viable than Parkland.
    expect(quotes.desert.total).toBeLessThan(quotes.parkland.total * 1.25);
  });

  it("prices turf-heavy imported-plant Desert at least 25% above xeric Desert", () => {
    const appropriate = courseWithTerrainMix("desert", [
      ["fairway", 700], ["green", 150], ["tee", 120],
      ["waste_area", 2_000], ["sand", 1_030],
    ]);
    const turfHeavy = courseWithTerrainMix("desert", [
      ["fairway", 2_600], ["green", 700], ["tee", 300], ["rough", 400],
    ]);
    turfHeavy.obstacles = Array.from({ length: 40 }, (_, index) => ({
      x: index % turfHeavy.width,
      y: Math.floor(index / turfHeavy.width),
      type: "tree" as const,
      origin: "player" as const,
      plantId: "parkland-oak" as const,
    }));
    const input = {
      season: "summer" as const,
      currentWeather: weather("heat", 104, 0, .8),
      publishedForecast: [
        weather("heat", 102, 0, .7),
        weather("drought", 106, 0, .9),
      ],
      policy: "balanced" as const,
      drainageLevel: 0,
      costMult: 1,
    };
    const xericQuote = quoteDailyBiomeOperatingCosts({
      ...input,
      course: appropriate,
    });
    const turfQuote = quoteDailyBiomeOperatingCosts({
      ...input,
      course: turfHeavy,
    });
    expect(turfQuote.total).toBeGreaterThanOrEqual(xericQuote.total * 1.25);
    expect(turfQuote.maintainedAreaUnits)
      .toBeGreaterThan(xericQuote.maintainedAreaUnits);
    expect(turfQuote.plantCareCost).toBeGreaterThan(xericQuote.plantCareCost);
  });
});

describe("shared preview and reducer economy parity", () => {
  it("uses the same biome and difficulty quote in Hole Inspector estimates", () => {
    const course: Course = {
      ...tinyCourse("desert"),
      width: 32,
      height: 5,
      tiles: new Array(160).fill("rough"),
      elevations: new Array(160).fill(0),
      holes: [{
        id: "economy-inspector-hole",
        name: "Economy inspector",
        tee: { x: 2, y: 2 },
        green: { x: 29, y: 2 },
        parMode: "MANUAL",
        parManual: 4,
      }],
    };
    const costMult = terrainCostMult("hard");
    const evaluation = evaluateHole(course, course.holes[0], 0, costMult);
    const issue = evaluation.issues.find(
      (candidate) => candidate.code === "FAIRWAY_CONTINUITY",
    );
    const failingTiles = issue?.metadata?.failingSegments?.length ?? 0;
    expect(failingTiles).toBeGreaterThan(0);
    expect(issue?.metadata?.costEstimate).toBe(
      Math.ceil(
        computeTerrainChangeCost(
          "rough",
          "fairway",
          costMult,
          "desert",
        ).charged * failingTiles,
      ),
    );
  });

  it("matches terrain and earthwork previews under biome plus difficulty", () => {
    const before = state(tinyCourse("desert"), "hard");
    const costMult = terrainCostMult("hard");
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const preview = previewTerrainStroke(
      before.course,
      points,
      "green",
      before.world.cash,
      costMult,
      before.world.reputation,
    );
    const painted = applyAction(before, {
      type: "PAINT_TILES",
      tiles: points.map((point) => ({ ...point, terrain: "green" as const })),
    });
    expect(painted.world.cash).toBe(preview.projectedCash);
    expect(preview.net).toBeCloseTo(
      computeTerrainChangeCost("rough", "green", costMult, "desert").net * 2,
    );

    const sculptQuote = computeElevationChangeCost(2, costMult, "desert");
    const sculpted = applyAction(before, {
      type: "SCULPT_TILES",
      deltas: [{ x: 0, y: 0, delta: 2 }],
    });
    expect(before.world.cash - sculpted.world.cash).toBe(sculptQuote.net);

    const roughBefore = state({
      ...tinyCourse("desert"),
      tiles: ["green", ...new Array(7).fill("rough")] as Course["tiles"],
    }, "hard");
    const roughPreview = previewTerrainStroke(
      roughBefore.course,
      [{ x: 0, y: 0 }],
      "rough",
      roughBefore.world.cash,
      costMult,
      roughBefore.world.reputation,
    );
    const reverted = applyAction(roughBefore, {
      type: "PAINT_TILES",
      tiles: [{ x: 0, y: 0, terrain: "rough" }],
    });
    expect(terrainConstructionUnitCost("rough", "desert", costMult)).toBe(0);
    expect(roughPreview.gross).toBe(0);
    expect(roughPreview.salvage)
      .toBe(terrainSalvageUnitValue("green", "desert", costMult));
    expect(reverted.world.cash).toBe(roughPreview.projectedCash);
  });

  it("matches semantic natural-feature install, clear, and salvage quotes", () => {
    const before = state(tinyCourse("links"), "hard");
    const costMult = terrainCostMult("hard");
    const plantId = defaultObstaclePlantId("links", "tree");
    const install = naturalFeatureInstallationQuote({
      theme: "links",
      obstacleType: "tree",
      plantId,
      costMult,
    });
    const placed = applyAction(before, {
      type: "PLACE_OBSTACLE",
      x: 0,
      y: 0,
      obstacleType: "tree",
      plantId,
    });
    expect(before.world.cash - placed.world.cash).toBeCloseTo(install.net);
    expect(placed.course.obstacles[0]).toMatchObject({
      type: "tree",
      plantId,
      origin: "player",
    });

    const salvage = naturalFeatureRemovalQuote({
      theme: "links",
      obstacle: placed.course.obstacles[0],
      costMult,
    });
    const removed = applyAction(placed, {
      type: "REMOVE_OBSTACLE",
      x: 0,
      y: 0,
    });
    expect(removed.world.cash).toBe(placed.world.cash - salvage.net);

    const naturalObstacle: Obstacle = { x: 1, y: 0, type: "bush" };
    const naturalState = state({
      ...tinyCourse("links"),
      obstacles: [naturalObstacle],
    }, "hard");
    const clearing = naturalFeatureRemovalQuote({
      theme: "links",
      obstacle: naturalObstacle,
      costMult,
    });
    const cleared = applyAction(naturalState, {
      type: "REMOVE_OBSTACLE",
      x: 1,
      y: 0,
    });
    expect(naturalState.world.cash - cleared.world.cash).toBe(clearing.net);
  });

  it("matches semantic decoration install and bounded removal salvage", () => {
    const before = state(tinyCourse("desert"), "hard");
    const costMult = terrainCostMult("hard");
    const decoration: Decoration = {
      kind: "flower_bed",
      x: 2,
      y: 0,
      rotation: 0,
      plantId: "parkland-perennial-bed",
      origin: "player",
    };
    const install = decorationCost(decoration, "desert", costMult);
    const placed = applyAction(before, {
      type: "PLACE_DECORATION",
      decoration,
    });
    expect(before.world.cash - placed.world.cash).toBeCloseTo(install);
    const removal = decorationRemovalQuote(
      placed.course.decorations![0],
      "desert",
      costMult,
    );
    expect(removal.salvage).toBeLessThanOrEqual(install * .5);
    const removed = applyAction(placed, {
      type: "REMOVE_DECORATION",
      x: 2,
      y: 0,
    });
    expect(removed.world.cash).toBe(placed.world.cash - removal.net);
  });
});
