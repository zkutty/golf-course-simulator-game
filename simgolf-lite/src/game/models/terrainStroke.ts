import { isOwnedTile } from "../estate/estate";
import { isTerrainUnlocked } from "../progression/progression";
import { isWaterHazard } from "./terrainRules";
import type { Course, LandTheme, Obstacle, Point, Terrain } from "./types";
import {
  computeElevationChangeCost,
  computeTerrainChangeBreakdown,
  terrainMaintenanceWeight,
} from "./terrainEconomics";
import { naturalFeatureRemovalQuote } from "./plantRegistry";
import {
  maintainedAreaDemandUnits,
  playerPlantingDemand,
  quoteIrrigationFromDemand,
} from "./biomeOperatingCosts";
import { getBiomeDefinition } from "./biomes";
import type {
  DailyWeather,
  SeasonName,
  WaterPolicy,
} from "../seasons/types";
import {
  collectTouchedWaterCells,
  computeWaterGrading,
  type WaterGradingDelta,
} from "./waterGrading";

export interface TerrainPaintTile extends Point {
  terrain: Terrain;
}

export interface ExcludedTerrainPaintTile extends TerrainPaintTile {
  reason: "outOfBounds" | "unowned" | "locked" | "protected";
}

export type TerrainClimateWarning =
  | {
    kind: "water-pressure";
    biome: LandTheme;
    seasonal: number;
    weather: number;
    scarcity: number;
    policy: number;
  }
  | { kind: "saturation-pressure" }
  | { kind: "heat-drought-pressure" };

export interface TerrainStrokePreview {
  previewKind: "stroke" | "surface-edit";
  tiles: TerrainPaintTile[];
  /** Valid coverage including already-matching cells, used to clip visual intent. */
  acceptedTiles: TerrainPaintTile[];
  /** Located invalid cells for non-color-only map preview states. */
  excludedTiles: ExcludedTerrainPaintTile[];
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
  /** Terrain construction only, before terrain/natural-feature salvage. */
  constructionCost: number;
  terrainSalvage: number;
  naturalClearingCost: number;
  naturalSalvage: number;
  /** Exact change to the terrain-mix authority consumed by maintenance. */
  weeklyUpkeepWeightDelta: number;
  /** Exact change to managed-area plus player-planting irrigation demand. */
  irrigationDemandDelta: number;
  /** Seven-day cost delta from the shared biome irrigation quote. */
  weeklyIrrigationCostDelta: number;
  /** Seven-day recurring plant-care delta after natural-feature removal. */
  weeklyPlantCareCostDelta: number;
  irrigationMultipliers: {
    seasonal: number;
    weather: number;
    scarcity: number;
    policy: number;
  };
  climateWarnings: TerrainClimateWarning[];
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
  season?: SeasonName;
  currentWeather?: DailyWeather;
  publishedForecast?: readonly DailyWeather[];
  waterPolicy?: WaterPolicy;
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
  const excludedTiles: ExcludedTerrainPaintTile[] = [];
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
  let constructionCost = 0;
  let terrainSalvage = 0;
  let naturalClearingCost = 0;
  let naturalSalvage = 0;
  let weeklyUpkeepWeightDelta = 0;

  for (const tile of input.tiles) {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    if (tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height) {
      excluded.outOfBounds++;
      excludedTiles.push({ ...tile, reason: "outOfBounds" });
      continue;
    }
    if (!isOwnedTile(course, tile.x, tile.y)) {
      excluded.unowned++;
      excludedTiles.push({ ...tile, reason: "unowned" });
      continue;
    }
    if (!isTerrainUnlocked(tile.terrain, reputation)) {
      excluded.locked++;
      excludedTiles.push({ ...tile, reason: "locked" });
      continue;
    }
    if (
      protectedTreeIndices?.has(tile.y * course.width + tile.x)
      && isWaterHazard(tile.terrain)
    ) {
      excluded.protected++;
      excludedTiles.push({ ...tile, reason: "protected" });
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
    constructionCost += cost.gross;
    terrainSalvage += cost.salvage;
    weeklyUpkeepWeightDelta +=
      terrainMaintenanceWeight(tile.terrain, course.theme)
      - terrainMaintenanceWeight(prev, course.theme);
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
  for (const obstacle of removedObstacles) {
    const removal = naturalFeatureRemovalQuote({
      theme: course.theme,
      obstacle,
      costMult,
    });
    gross += removal.gross;
    salvage += removal.salvage;
    net += removal.net;
    charged += removal.charged;
    refunded += removal.refunded;
    naturalClearingCost += removal.gross;
    naturalSalvage += removal.salvage;
  }
  const earthworkCost = computeElevationChangeCost(
    grading.earthworkSteps,
    costMult,
    course.theme,
  ).net;
  gross += earthworkCost;
  net += earthworkCost;
  charged += earthworkCost;

  const removedObstacleKeys = new Set(
    removedObstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`),
  );
  const nextCourse = {
    ...course,
    tiles: finalTiles,
    obstacles: removedObstacles.length > 0
      ? course.obstacles.filter(
        (obstacle) => !removedObstacleKeys.has(`${obstacle.x},${obstacle.y}`),
      )
      : course.obstacles,
  };
  const maintainedBefore = maintainedAreaDemandUnits(course);
  const maintainedAfter = maintainedAreaDemandUnits(nextCourse);
  const plantingBefore = playerPlantingDemand(course);
  const plantingAfter = playerPlantingDemand(nextCourse);
  const irrigationBefore = quoteIrrigationFromDemand({
    theme: course.theme,
    maintainedAreaUnits: maintainedBefore,
    plantingWaterUnits: plantingBefore.waterUnits,
    season: input.season,
    currentWeather: input.currentWeather,
    publishedForecast: input.publishedForecast,
    policy: input.waterPolicy,
    costMult,
  });
  const irrigationAfter = quoteIrrigationFromDemand({
    theme: course.theme,
    maintainedAreaUnits: maintainedAfter,
    plantingWaterUnits: plantingAfter.waterUnits,
    season: input.season,
    currentWeather: input.currentWeather,
    publishedForecast: input.publishedForecast,
    policy: input.waterPolicy,
    costMult,
  });
  const irrigationDemandDelta =
    maintainedAfter + plantingAfter.waterUnits
    - maintainedBefore - plantingBefore.waterUnits;
  const weeklyIrrigationCostDelta =
    (irrigationAfter.waterCost - irrigationBefore.waterCost) * 7;
  const weeklyPlantCareCostDelta =
    (plantingAfter.careCost - plantingBefore.careCost) * costMult * 7;
  const biome = getBiomeDefinition(course.theme);
  const climateWarnings: TerrainClimateWarning[] = [];
  const changedTerrains = new Set(tiles.map((tile) => tile.terrain));
  if (irrigationDemandDelta > 0 && (
    irrigationAfter.seasonalDemandMultiplier > 1.05
    || irrigationAfter.weatherDemandMultiplier > 1.05
    || biome.economy.water.scarcityPriceMultiplier > 1.05
  )) {
    climateWarnings.push({
      kind: "water-pressure",
      biome: biome.key,
      seasonal: irrigationAfter.seasonalDemandMultiplier,
      weather: irrigationAfter.weatherDemandMultiplier,
      scarcity: biome.economy.water.scarcityPriceMultiplier,
      policy: irrigationAfter.policyMultiplier,
    });
  }
  if (
    input.currentWeather
    && (
      input.currentWeather.kind === "heavy_rain"
      || input.currentWeather.kind === "storm"
    )
    && [...changedTerrains].some((terrain) =>
      terrain === "green" || terrain === "tee" || terrain === "fairway"
    )
  ) {
    climateWarnings.push({ kind: "saturation-pressure" });
  }
  if (
    input.currentWeather
    && (
      input.currentWeather.kind === "heat"
      || input.currentWeather.kind === "drought"
    )
    && [...changedTerrains].some((terrain) =>
      biome.economy.terrain[terrain].irrigationDemand >= 1
    )
  ) {
    climateWarnings.push({ kind: "heat-drought-pressure" });
  }

  const excludedCount =
    excluded.outOfBounds + excluded.unowned + excluded.locked + excluded.protected;
  const shortfall = Math.max(0, net - cash);
  return {
    previewKind: "stroke",
    tiles,
    acceptedTiles,
    excludedTiles,
    changedCount: tiles.length,
    duplicateCount,
    unchangedCount,
    excludedCount,
    excluded,
    removedObstacles,
    elevationDeltas: grading.deltas,
    earthworkSteps: grading.earthworkSteps,
    earthworkCost,
    constructionCost,
    terrainSalvage,
    naturalClearingCost,
    naturalSalvage,
    weeklyUpkeepWeightDelta,
    irrigationDemandDelta,
    weeklyIrrigationCostDelta,
    weeklyPlantCareCostDelta,
    irrigationMultipliers: {
      seasonal: irrigationAfter.seasonalDemandMultiplier,
      weather: irrigationAfter.weatherDemandMultiplier,
      scarcity: biome.economy.water.scarcityPriceMultiplier,
      policy: irrigationAfter.policyMultiplier,
    },
    climateWarnings,
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
  options: Pick<
    TerrainBatchInput,
    "season" | "currentWeather" | "publishedForecast" | "waterPolicy"
  > = {},
): TerrainStrokePreview {
  return computeTerrainBatch({
    course,
    tiles: points.map(({ x, y }) => ({ x, y, terrain })),
    cash,
    costMult,
    reputation,
    protectedTrees,
    ...options,
  });
}
