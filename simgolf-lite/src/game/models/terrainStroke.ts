import { isOwnedTile } from "../estate/estate";
import { isTerrainUnlocked } from "../progression/progression";
import { isWaterHazard } from "./terrainRules";
import type { Course, Obstacle, Point, Terrain } from "./types";
import {
  computeElevationChangeCost,
  computeTerrainChangeBreakdown,
} from "./terrainEconomics";
import {
  collectTouchedWaterCells,
  computeWaterGrading,
  type WaterGradingDelta,
} from "./waterGrading";

export interface TerrainPaintTile extends Point {
  terrain: Terrain;
}

export interface TerrainStrokePreview {
  tiles: TerrainPaintTile[];
  /** Valid coverage including already-matching cells, used to clip visual intent. */
  acceptedTiles: TerrainPaintTile[];
  changedCount: number;
  duplicateCount: number;
  unchangedCount: number;
  excludedCount: number;
  excluded: {
    outOfBounds: number;
    unowned: number;
    locked: number;
    protected: number;
  };
  /** Dry-land gameplay props cleared by this water edit. */
  removedObstacles: Obstacle[];
  /** Automatic basin excavation committed atomically with the terrain. */
  elevationDeltas: WaterGradingDelta[];
  earthworkSteps: number;
  earthworkCost: number;
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
  protectedTrees?: boolean;
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
  const acceptedTiles: TerrainPaintTile[] = [];
  const excluded = { outOfBounds: 0, unowned: 0, locked: 0, protected: 0 };
  const protectedTreeIndices = input.protectedTrees
    ? new Set(
      course.obstacles
        .filter((obstacle) => obstacle.type === "tree")
        .map((obstacle) => obstacle.y * course.width + obstacle.x),
    )
    : null;
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
    if (
      protectedTreeIndices?.has(tile.y * course.width + tile.x)
      && isWaterHazard(tile.terrain)
    ) {
      excluded.protected++;
      continue;
    }
    acceptedTiles.push(tile);
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

  const finalTiles = course.tiles.slice();
  const gradingSeeds: number[] = [];
  for (const tile of acceptedTiles) {
    const index = tile.y * course.width + tile.x;
    finalTiles[index] = tile.terrain;
    if (tile.terrain === "water" || tile.terrain === "wetland") {
      gradingSeeds.push(index);
    }
  }
  const grading = computeWaterGrading(course, finalTiles, gradingSeeds);
  const touchedWaterCells = new Set(
    collectTouchedWaterCells(course, finalTiles, gradingSeeds),
  );
  const removedObstacles = course.obstacles.filter((obstacle) => (
    touchedWaterCells.has(obstacle.y * course.width + obstacle.x)
  ));
  const earthworkCost = computeElevationChangeCost(
    grading.earthworkSteps,
    costMult,
  ).net;
  gross += earthworkCost;
  net += earthworkCost;
  charged += earthworkCost;

  const excludedCount =
    excluded.outOfBounds + excluded.unowned + excluded.locked + excluded.protected;
  const shortfall = Math.max(0, net - cash);
  return {
    tiles,
    acceptedTiles,
    changedCount: tiles.length,
    duplicateCount,
    unchangedCount,
    excludedCount,
    excluded,
    removedObstacles,
    elevationDeltas: grading.deltas,
    earthworkSteps: grading.earthworkSteps,
    earthworkCost,
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
  reputation: number,
  protectedTrees = false,
): TerrainStrokePreview {
  return computeTerrainBatch({
    course,
    tiles: points.map(({ x, y }) => ({ x, y, terrain })),
    cash,
    costMult,
    reputation,
    protectedTrees,
  });
}
