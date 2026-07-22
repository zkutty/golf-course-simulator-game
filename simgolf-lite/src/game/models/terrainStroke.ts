import { isOwnedTile } from "../estate/estate";
import { isTerrainUnlocked } from "../progression/progression";
import type { Course, Point, Terrain } from "./types";
import { computeTerrainChangeBreakdown } from "./terrainEconomics";

export interface TerrainPaintTile extends Point {
  terrain: Terrain;
}

export interface TerrainStrokePreview {
  tiles: TerrainPaintTile[];
  changedCount: number;
  duplicateCount: number;
  unchangedCount: number;
  excludedCount: number;
  excluded: {
    outOfBounds: number;
    unowned: number;
    locked: number;
  };
  gross: number;
  salvage: number;
  net: number;
  charged: number;
  refunded: number;
  cash: number;
  projectedCash: number;
  affordable: boolean;
  shortfall: number;
}

export interface TerrainBatchInput {
  course: Course;
  tiles: TerrainPaintTile[];
  cash: number;
  costMult?: number;
  reputation: number;
}

/**
 * The single source of truth for terrain-stroke validity and economics.
 * It is deliberately pure so pointer preview and reducer commit cannot drift.
 */
export function computeTerrainBatch(input: TerrainBatchInput): TerrainStrokePreview {
  const { course, cash, reputation } = input;
  const costMult = input.costMult ?? 1;
  const seen = new Set<string>();
  const tiles: TerrainPaintTile[] = [];
  const excluded = { outOfBounds: 0, unowned: 0, locked: 0 };
  let duplicateCount = 0;
  let unchangedCount = 0;
  let gross = 0;
  let salvage = 0;
  let net = 0;
  let charged = 0;
  let refunded = 0;

  for (const tile of input.tiles) {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    if (tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height) {
      excluded.outOfBounds++;
      continue;
    }
    if (!isOwnedTile(course, tile.x, tile.y)) {
      excluded.unowned++;
      continue;
    }
    if (!isTerrainUnlocked(tile.terrain, reputation)) {
      excluded.locked++;
      continue;
    }
    const prev = course.tiles[tile.y * course.width + tile.x];
    if (prev === tile.terrain) {
      unchangedCount++;
      continue;
    }
    const cost = computeTerrainChangeBreakdown(prev, tile.terrain, costMult, course.theme);
    gross += cost.gross;
    salvage += cost.salvage;
    net += cost.net;
    charged += cost.charged;
    refunded += cost.refunded;
    tiles.push(tile);
  }

  const excludedCount = excluded.outOfBounds + excluded.unowned + excluded.locked;
  const shortfall = Math.max(0, net - cash);
  return {
    tiles,
    changedCount: tiles.length,
    duplicateCount,
    unchangedCount,
    excludedCount,
    excluded,
    gross,
    salvage,
    net,
    charged,
    refunded,
    cash,
    projectedCash: cash - net,
    affordable: shortfall === 0,
    shortfall,
  };
}

export function previewTerrainStroke(
  course: Course,
  points: Point[],
  terrain: Terrain,
  cash: number,
  costMult: number,
  reputation: number
): TerrainStrokePreview {
  return computeTerrainBatch({
    course,
    tiles: points.map(({ x, y }) => ({ x, y, terrain })),
    cash,
    costMult,
    reputation,
  });
}
