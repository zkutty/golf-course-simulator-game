import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import type { GameState } from "../gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./defaults";
import type { Course, Terrain } from "./types";
import { previewTerrainStroke } from "./terrainStroke";
import { computeElevationChangeCost } from "./terrainEconomics";
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from "./surfaceIntent";
import {
  maintainedAreaDemandUnits,
  playerPlantingDemand,
} from "./biomeOperatingCosts";

function course(tiles: Terrain[] = new Array(12).fill("rough")): Course {
  return {
    ...DEFAULT_COURSE,
    width: 4,
    height: 3,
    tiles,
    elevations: new Array(12).fill(0),
    holes: [],
    layouts: [],
    obstacles: [],
    buildings: [],
    decorations: [],
  };
}

function state(c: Course, cash = 25_000, reputation = 100): GameState {
  return {
    course: c,
    world: { ...DEFAULT_WORLD, cash, reputation },
    selectedTerrain: "fairway",
    terrainVersion: 7,
    obstaclesVersion: 2,
    markersVersion: 3,
    economyVersion: 9,
  };
}

describe("terrain paint strokes", () => {
  it("deduplicates crossed tiles and reports unchanged, invalid, and locked points", () => {
    const c = course();
    c.tiles[1] = "fairway";
    const preview = previewTerrainStroke(
      c,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
      "fairway",
      25_000,
      1,
      100
    );
    expect(preview.tiles).toEqual([
      { x: 0, y: 0, terrain: "fairway" },
      { x: 3, y: 2, terrain: "fairway" },
    ]);
    expect(preview.acceptedTiles).toEqual([
      { x: 0, y: 0, terrain: "fairway" },
      { x: 1, y: 0, terrain: "fairway" },
      { x: 3, y: 2, terrain: "fairway" },
    ]);
    expect(preview).toMatchObject({ changedCount: 2, duplicateCount: 1, unchangedCount: 1, excludedCount: 1 });
    expect(preview.excluded.outOfBounds).toBe(1);
    expect(preview.excludedTiles).toContainEqual({
      x: 4,
      y: 2,
      terrain: "fairway",
      reason: "outOfBounds",
    });

    const locked = previewTerrainStroke(c, [{ x: 2, y: 1 }], "water", 25_000, 1, 0);
    expect(locked).toMatchObject({ changedCount: 0, excludedCount: 1 });
    expect(locked.excluded.locked).toBe(1);
  });

  it("exposes full construction and salvage while allowing refund-only strokes", () => {
    const c = course(new Array(12).fill("green"));
    const preview = previewTerrainStroke(c, [{ x: 0, y: 0 }, { x: 1, y: 0 }], "rough", 0, 1, 100);
    expect(preview.gross).toBe(0);
    expect(preview.salvage).toBeGreaterThan(0);
    expect(preview.net).toBe(-preview.salvage);
    expect(preview.projectedCash).toBe(preview.salvage);
    expect(preview.affordable).toBe(true);
  });

  it("commits an affordable batch once with the exact preview cash delta", () => {
    const before = state(course());
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const preview = previewTerrainStroke(before.course, points, "green", before.world.cash, 1, before.world.reputation);
    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: points.map((point) => ({ ...point, terrain: "green" as const })),
    });
    expect(after.world.cash).toBe(preview.projectedCash);
    expect(after.terrainVersion).toBe(before.terrainVersion + 1);
    expect(after.economyVersion).toBe(before.economyVersion + 1);
    expect(after.course.tiles.slice(0, 3)).toEqual(["green", "green", "green"]);
  });

  it("persists a valid visual feature even when its terrain already matches", () => {
    const c = course(new Array(12).fill("fairway"));
    c.surfaceIntent = { version: 1, nextId: 1, features: [] };
    const feature = corridorFeature(
      c,
      "fairway",
      [{ x: 0.5, y: 1.5 }, { x: 3.5, y: 1.5 }],
      1.5,
    );
    const raster = rasterizeSurfaceFeatureDetailed(feature, c.width, c.height);
    const before = state(c);
    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: raster.tiles.map((point) => ({ ...point, terrain: "fairway" as const })),
      surfaceFeature: feature,
    });

    expect(after.course.tiles).toEqual(before.course.tiles);
    expect(after.course.surfaceIntent?.features).toHaveLength(1);
    expect(after.course.surfaceIntent?.features[0].coverage.length).toBeGreaterThan(0);
    expect(after.world.cash).toBe(before.world.cash);
    expect(after.terrainVersion).toBe(before.terrainVersion + 1);
    expect(after.economyVersion).toBe(before.economyVersion + 1);
  });

  it("rejects an unaffordable batch without any terrain, cash, or version mutation", () => {
    const before = state(course(), 1);
    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: [{ x: 0, y: 0, terrain: "green" }, { x: 1, y: 0, terrain: "green" }],
    });
    expect(after).toEqual(before);
  });

  it("previews and commits automatic water excavation in the same transaction", () => {
    const c = course();
    c.elevations.fill(5);
    const before = state(c);
    const point = { x: 1, y: 1 };
    const preview = previewTerrainStroke(
      before.course,
      [point],
      "water",
      before.world.cash,
      1,
      before.world.reputation,
    );
    expect(preview.elevationDeltas).toEqual([{ ...point, delta: -1 }]);
    expect(preview.earthworkSteps).toBe(1);
    expect(preview.earthworkCost).toBe(computeElevationChangeCost(1).net);
    expect(preview.gross - preview.salvage).toBe(preview.net);

    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: [{ ...point, terrain: "water" }],
    });
    const index = point.y * c.width + point.x;
    expect(after.course.tiles[index]).toBe("water");
    expect(after.course.elevations[index]).toBe(4);
    expect(after.world.cash).toBe(preview.projectedCash);
  });

  it("can grade a touched legacy lake even when its terrain already matches", () => {
    const c = course();
    c.elevations.fill(6);
    const left = 1 * c.width + 1;
    const right = 1 * c.width + 2;
    c.tiles[left] = "water";
    c.tiles[right] = "water";
    c.elevations[left] = 5;
    c.elevations[right] = 7;
    const before = state(c);
    const preview = previewTerrainStroke(
      c,
      [{ x: 1, y: 1 }],
      "water",
      before.world.cash,
      1,
      before.world.reputation,
    );
    expect(preview.changedCount).toBe(0);
    expect(preview.elevationDeltas).toEqual([{ x: 2, y: 1, delta: -2 }]);

    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: [{ x: 1, y: 1, terrain: "water" }],
    });
    expect(after.course.elevations[left]).toBe(5);
    expect(after.course.elevations[right]).toBe(5);
    expect(after.terrainVersion).toBe(before.terrainVersion + 1);
  });

  it("rejects unaffordable water without applying terrain or excavation", () => {
    const c = course();
    c.elevations.fill(5);
    const before = state(c, 1);
    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: [{ x: 1, y: 1, terrain: "water" }],
    });
    expect(after).toEqual(before);
  });

  it("clears dry-land props inside only the touched water component", () => {
    const c = course();
    c.elevations.fill(4);
    c.obstacles = [
      { x: 1, y: 1, type: "tree" },
      { x: 2, y: 1, type: "rock" },
      { x: 0, y: 0, type: "bush" },
    ];
    const before = state(c);
    const points = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
    const preview = previewTerrainStroke(
      c,
      points,
      "water",
      before.world.cash,
      1,
      before.world.reputation,
    );
    expect(preview.removedObstacles).toEqual(c.obstacles.slice(0, 2));

    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: points.map((point) => ({ ...point, terrain: "water" as const })),
    });
    expect(after.course.obstacles).toEqual([{ x: 0, y: 0, type: "bush" }]);
    expect(after.obstaclesVersion).toBe(before.obstaclesVersion + 1);
  });

  it("clips protected trees into dry-land islands while clearing ordinary props", () => {
    const c = course();
    c.elevations.fill(4);
    c.obstacles = [
      { x: 1, y: 1, type: "tree" },
      { x: 2, y: 1, type: "bush" },
    ];
    const before = {
      ...state(c),
      world: {
        ...DEFAULT_WORLD,
        cash: 25_000,
        reputation: 100,
        constraints: { protectedTrees: true },
      },
    };
    const points = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
    const preview = previewTerrainStroke(
      c,
      points,
      "water",
      before.world.cash,
      1,
      before.world.reputation,
      true,
    );
    expect(preview.excluded.protected).toBe(1);
    expect(preview.excludedTiles).toContainEqual({
      x: 1,
      y: 1,
      terrain: "water",
      reason: "protected",
    });
    expect(preview.removedObstacles).toEqual([{ x: 2, y: 1, type: "bush" }]);

    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: points.map((point) => ({ ...point, terrain: "water" as const })),
    });
    expect(after.course.tiles[1 * c.width + 1]).toBe("rough");
    expect(after.course.tiles[1 * c.width + 2]).toBe("water");
    expect(after.course.obstacles).toEqual([{ x: 1, y: 1, type: "tree" }]);
  });

  it("quotes exact Desert summer irrigation modifiers and precommit deltas", () => {
    const c = { ...course(), theme: "desert" as const };
    const preview = previewTerrainStroke(
      c,
      [{ x: 1, y: 1 }],
      "green",
      25_000,
      1,
      100,
      false,
      {
        season: "summer",
        currentWeather: {
          absoluteDay: 42,
          kind: "drought",
          temperatureF: 105,
          windMph: 18,
          rainInches: 0,
          severity: 0.8,
          theme: "desert",
          season: "summer",
        },
        waterPolicy: "conserve",
      },
    );
    expect(preview.constructionCost).toBe(preview.gross);
    expect(preview.terrainSalvage).toBe(preview.salvage);
    expect(preview.naturalClearingCost).toBe(0);
    expect(preview.irrigationDemandDelta).toBeCloseTo(1.65, 8);
    expect(preview.weeklyUpkeepWeightDelta).toBeGreaterThan(0);
    expect(preview.weeklyIrrigationCostDelta).toBeGreaterThan(0);
    expect(preview.irrigationMultipliers).toEqual({
      seasonal: 1.25,
      weather: 1.25,
      scarcity: 1.3,
      policy: 12 / 42,
    });
    expect(preview.climateWarnings).toContainEqual({
      kind: "water-pressure",
      biome: "desert",
      seasonal: 1.25,
      weather: 1.25,
      scarcity: 1.3,
      policy: 12 / 42,
    });
  });

  it("quotes post-removal planting water and weekly care for a water stroke", () => {
    const c = course();
    c.elevations.fill(4);
    c.obstacles = [{
      x: 1,
      y: 1,
      type: "tree",
      plantId: "parkland-oak",
      origin: "player",
    }];
    const costMult = 1.4;
    const preview = previewTerrainStroke(
      c,
      [{ x: 1, y: 1 }],
      "water",
      25_000,
      costMult,
      100,
    );
    const afterCourse = {
      ...c,
      tiles: c.tiles.map((terrain, index) =>
        index === c.width + 1 ? "water" as const : terrain
      ),
      obstacles: [],
    };
    const plantingBefore = playerPlantingDemand(c);
    const plantingAfter = playerPlantingDemand(afterCourse);
    expect(preview.removedObstacles).toEqual(c.obstacles);
    expect(preview.irrigationDemandDelta).toBeCloseTo(
      maintainedAreaDemandUnits(afterCourse) + plantingAfter.waterUnits
      - maintainedAreaDemandUnits(c) - plantingBefore.waterUnits,
      8,
    );
    expect(preview.weeklyPlantCareCostDelta).toBeCloseTo(
      (plantingAfter.careCost - plantingBefore.careCost) * costMult * 7,
      8,
    );
    expect(preview.weeklyPlantCareCostDelta).toBeLessThan(0);
  });

  it("rejects new obstacles on water and wetland", () => {
    const c = course();
    c.tiles[0] = "water";
    c.tiles[1] = "wetland";
    const before = state(c);
    for (const x of [0, 1]) {
      expect(applyAction(before, {
        type: "PLACE_OBSTACLE",
        x,
        y: 0,
        obstacleType: "tree",
      })).toEqual(before);
    }
  });
});
