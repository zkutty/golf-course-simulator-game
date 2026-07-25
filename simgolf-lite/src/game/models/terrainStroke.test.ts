import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import type { GameState } from "../gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./defaults";
import type { Course, Terrain } from "./types";
import { previewTerrainStroke } from "./terrainStroke";

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

  it("rejects an unaffordable batch without any terrain, cash, or version mutation", () => {
    const before = state(course(), 1);
    const after = applyAction(before, {
      type: "PAINT_TILES",
      tiles: [{ x: 0, y: 0, terrain: "green" }, { x: 1, y: 0, terrain: "green" }],
    });
    expect(after).toEqual(before);
  });
});
