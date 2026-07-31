import { isOwnedTile } from "../estate/estate";
import { isTerrainUnlocked } from "../progression/progression";
import { isWaterHazard } from "./terrainRules";
import type { Course, Obstacle, SurfaceFeature, SurfaceIntentV1, Terrain } from "./types";
import {
  computeElevationChangeCost,
  computeTerrainChangeBreakdown,
  terrainMaintenanceWeight,
} from "./terrainEconomics";
import { naturalFeatureRemovalQuote } from "./plantRegistry";
import type {
  TerrainBatchInput,
  TerrainStrokePreview,
} from "./terrainStroke";
import {
  maintainedAreaDemandUnits,
  playerPlantingDemand,
  quoteIrrigationFromDemand,
} from "./biomeOperatingCosts";
import { getBiomeDefinition } from "./biomes";
import {
  buildIntentUnderlayTiles,
  normalizeSurfaceIntent,
  rasterizeSurfaceFeatureDetailed,
} from "./surfaceIntent";
import {
  applyWaterGrading,
  collectTouchedWaterCells,
  computeWaterGrading,
} from "./waterGrading";

export interface PreparedSurfaceFeatureEdit {
  feature: SurfaceFeature;
  intent: SurfaceIntentV1;
  tiles: Terrain[];
  elevations: number[];
  obstacles: Obstacle[];
  preview: TerrainStrokePreview;
  commitAllowed: boolean;
}

function noChangePreview(
  cash: number,
  excluded: TerrainStrokePreview["excluded"],
  excludedTiles: TerrainStrokePreview["excludedTiles"] = [],
): TerrainStrokePreview {
  return {
    previewKind: "surface-edit",
    tiles: [],
    acceptedTiles: [],
    excludedTiles,
    changedCount: 0,
    duplicateCount: 0,
    unchangedCount: 0,
    excludedCount:
      excluded.outOfBounds + excluded.unowned + excluded.locked + excluded.protected,
    excluded,
    removedObstacles: [],
    elevationDeltas: [],
    earthworkSteps: 0,
    earthworkCost: 0,
    constructionCost: 0,
    terrainSalvage: 0,
    naturalClearingCost: 0,
    naturalSalvage: 0,
    weeklyUpkeepWeightDelta: 0,
    irrigationDemandDelta: 0,
    weeklyIrrigationCostDelta: 0,
    weeklyPlantCareCostDelta: 0,
    irrigationMultipliers: {
      seasonal: 1,
      weather: 1,
      scarcity: 1,
      policy: 1,
    },
    climateWarnings: [],
    gross: 0,
    salvage: 0,
    net: 0,
    charged: 0,
    refunded: 0,
    cash,
    projectedCash: cash,
    affordable: true,
    shortfall: 0,
  };
}

/**
 * Builds the exact post-edit terrain and economics from persisted intent.
 * Preview and reducer commit both call this function, keeping editing atomic.
 */
export function prepareSurfaceFeatureEdit(
  course: Course,
  candidate: SurfaceFeature,
  cash: number,
  costMult: number,
  reputation: number,
  protectedTrees = false,
  options: Pick<
    TerrainBatchInput,
    "season" | "currentWeather" | "publishedForecast" | "waterPolicy"
  > = {},
): PreparedSurfaceFeatureEdit | null {
  const intent = course.surfaceIntent;
  const existing = intent?.features.find((feature) => feature.id === candidate.id);
  if (!intent || !existing) return null;

  const normalized = normalizeSurfaceIntent({
    version: 1,
    nextId: intent.nextId,
    features: [{
      ...candidate,
      id: existing.id,
      terrain: existing.terrain,
      order: existing.order,
      coverage: existing.coverage,
      renderRings: existing.renderRings,
    }],
  }, course.width, course.height, [existing.terrain]);
  const sanitized = normalized?.features[0];
  if (!sanitized) return null;

  const rawRaster = rasterizeSurfaceFeatureDetailed(sanitized, course.width, course.height);
  if (!isTerrainUnlocked(existing.terrain, reputation)) {
    const excludedTiles: TerrainStrokePreview["excludedTiles"] =
      rawRaster.tiles.map((point) => ({
        ...point,
        terrain: existing.terrain,
        reason: "locked",
      }));
    return {
      feature: existing,
      intent,
      tiles: course.tiles.slice(),
      elevations: applyWaterGrading(course, { deltas: [], earthworkSteps: 0 }),
      obstacles: course.obstacles,
      preview: noChangePreview(cash, {
        outOfBounds: 0,
        unowned: 0,
        locked: rawRaster.tiles.length,
        protected: 0,
      }, excludedTiles),
      commitAllowed: false,
    };
  }

  const acceptedIndices = new Set<number>();
  const protectedTreeIndices = protectedTrees && isWaterHazard(existing.terrain)
    ? new Set(
      course.obstacles
        .filter((obstacle) => obstacle.type === "tree")
        .map((obstacle) => obstacle.y * course.width + obstacle.x),
    )
    : null;
  let unowned = 0;
  let protectedCount = 0;
  const excludedTiles: TerrainStrokePreview["excludedTiles"] = [];
  for (const point of rawRaster.tiles) {
    if (!isOwnedTile(course, point.x, point.y)) {
      unowned++;
      excludedTiles.push({
        ...point,
        terrain: existing.terrain,
        reason: "unowned",
      });
      continue;
    }
    const index = point.y * course.width + point.x;
    if (protectedTreeIndices?.has(index)) {
      protectedCount++;
      excludedTiles.push({
        ...point,
        terrain: existing.terrain,
        reason: "protected",
      });
      continue;
    }
    acceptedIndices.add(index);
  }
  // A fully clipped edit must not turn into an empty feature. In particular,
  // dragging an already-authored curve entirely over a sold/protected parcel
  // used to restore its old underlay and persist zero coverage. Partial edits
  // still clip normally below; this guard only preserves the current feature
  // when none of the proposed footprint can legally remain.
  if (acceptedIndices.size === 0) {
    return {
      feature: existing,
      intent,
      tiles: course.tiles.slice(),
      elevations: applyWaterGrading(course, { deltas: [], earthworkSteps: 0 }),
      obstacles: course.obstacles,
      preview: noChangePreview(cash, {
        outOfBounds: 0,
        unowned,
        locked: 0,
        protected: protectedCount,
      }, excludedTiles),
      commitAllowed: false,
    };
  }
  const clipped = rasterizeSurfaceFeatureDetailed(
    sanitized,
    course.width,
    course.height,
    acceptedIndices,
  );
  const feature: SurfaceFeature = {
    ...sanitized,
    coverage: clipped.tiles.map((point) => point.y * course.width + point.x),
    renderRings: clipped.rings,
  };
  const features = intent.features
    .map((current) => current.id === feature.id ? feature : current)
    .sort((a, b) => a.order - b.order);
  const nextIntent: SurfaceIntentV1 = { ...intent, features };

  // Only recompose cells whose top persisted layer is still present in the
  // authoritative tile map; this avoids resurrecting intent overwritten by a
  // later ordinary tile edit.
  const topFeatureByCell = new Map<number, SurfaceFeature>();
  for (const current of intent.features.slice().sort((a, b) => a.order - b.order)) {
    for (const index of current.coverage) topFeatureByCell.set(index, current);
  }
  const activeIntentCells = new Set<number>();
  for (const [index, top] of topFeatureByCell) {
    if (course.tiles[index] === top.terrain) activeIntentCells.add(index);
  }

  const finalTiles = buildIntentUnderlayTiles(
    course.tiles,
    course.width,
    course.height,
    intent.features,
  );
  for (const current of features) {
    for (const index of current.coverage) {
      if (current.id === feature.id || activeIntentCells.has(index)) {
        finalTiles[index] = current.terrain;
      }
    }
  }
  // Moving an authored surface must not restore underlay across land that is
  // no longer authorable. Keep every unowned cell byte-for-byte authoritative
  // and report the candidate footprint above as a located exclusion.
  for (let index = 0; index < finalTiles.length; index++) {
    if (finalTiles[index] === course.tiles[index]) continue;
    const x = index % course.width;
    const y = Math.floor(index / course.width);
    if (!isOwnedTile(course, x, y)) finalTiles[index] = course.tiles[index];
  }

  const grading = computeWaterGrading(course, finalTiles, feature.coverage);
  const elevations = applyWaterGrading(course, grading);
  const touchedWaterCells = new Set(
    collectTouchedWaterCells(course, finalTiles, feature.coverage),
  );
  const removedObstacles = course.obstacles.filter((obstacle) => (
    touchedWaterCells.has(obstacle.y * course.width + obstacle.x)
  ));
  const removedObstacleKeys = new Set(
    removedObstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`),
  );
  const obstacles = removedObstacles.length > 0
    ? course.obstacles.filter((obstacle) => !removedObstacleKeys.has(`${obstacle.x},${obstacle.y}`))
    : course.obstacles;
  const earthworkCost = computeElevationChangeCost(
    grading.earthworkSteps,
    costMult,
    course.theme,
  ).net;
  const changedTiles: TerrainStrokePreview["tiles"] = [];
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
  for (let index = 0; index < finalTiles.length; index++) {
    const terrain = finalTiles[index];
    if (terrain === course.tiles[index]) continue;
    const x = index % course.width;
    const y = Math.floor(index / course.width);
    // Existing authored coverage can only be restored on owned property.
    if (!isOwnedTile(course, x, y)) continue;
    const cost = computeTerrainChangeBreakdown(
      course.tiles[index],
      terrain,
      costMult,
      course.theme,
    );
    gross += cost.gross;
    salvage += cost.salvage;
    net += cost.net;
    charged += cost.charged;
    refunded += cost.refunded;
    constructionCost += cost.gross;
    terrainSalvage += cost.salvage;
    weeklyUpkeepWeightDelta +=
      terrainMaintenanceWeight(terrain, course.theme)
      - terrainMaintenanceWeight(course.tiles[index], course.theme);
    changedTiles.push({ x, y, terrain });
  }
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
  gross += earthworkCost;
  net += earthworkCost;
  charged += earthworkCost;
  const shortfall = Math.max(0, net - cash);
  const acceptedTiles = clipped.tiles.map((point) => ({ ...point, terrain: existing.terrain }));
  const afterCourse = { ...course, tiles: finalTiles, obstacles };
  const maintainedBefore = maintainedAreaDemandUnits(course);
  const maintainedAfter = maintainedAreaDemandUnits(afterCourse);
  const plantingBefore = playerPlantingDemand(course);
  const plantingAfter = playerPlantingDemand(afterCourse);
  const irrigationBefore = quoteIrrigationFromDemand({
    theme: course.theme,
    maintainedAreaUnits: maintainedBefore,
    plantingWaterUnits: plantingBefore.waterUnits,
    costMult,
    season: options.season,
    currentWeather: options.currentWeather,
    publishedForecast: options.publishedForecast,
    policy: options.waterPolicy,
  });
  const irrigationAfter = quoteIrrigationFromDemand({
    theme: course.theme,
    maintainedAreaUnits: maintainedAfter,
    plantingWaterUnits: plantingAfter.waterUnits,
    costMult,
    season: options.season,
    currentWeather: options.currentWeather,
    publishedForecast: options.publishedForecast,
    policy: options.waterPolicy,
  });
  const irrigationDemandDelta =
    maintainedAfter + plantingAfter.waterUnits
    - maintainedBefore - plantingBefore.waterUnits;
  const weeklyIrrigationCostDelta =
    (irrigationAfter.waterCost - irrigationBefore.waterCost) * 7;
  const weeklyPlantCareCostDelta =
    (plantingAfter.careCost - plantingBefore.careCost) * costMult * 7;
  const biome = getBiomeDefinition(course.theme);
  const climateWarnings = irrigationDemandDelta > 0 && (
    irrigationAfter.seasonalDemandMultiplier > 1.05
    || irrigationAfter.weatherDemandMultiplier > 1.05
    || biome.economy.water.scarcityPriceMultiplier > 1.05
  )
    ? [{
      kind: "water-pressure" as const,
      biome: biome.key,
      seasonal: irrigationAfter.seasonalDemandMultiplier,
      weather: irrigationAfter.weatherDemandMultiplier,
      scarcity: biome.economy.water.scarcityPriceMultiplier,
      policy: irrigationAfter.policyMultiplier,
    }]
    : [];
  const preview: TerrainStrokePreview = {
    previewKind: "surface-edit",
    tiles: changedTiles,
    acceptedTiles,
    excludedTiles,
    changedCount: changedTiles.length,
    duplicateCount: 0,
    unchangedCount: acceptedTiles.filter(
      (point) => course.tiles[point.y * course.width + point.x] === point.terrain,
    ).length,
    excludedCount: unowned + protectedCount,
    excluded: { outOfBounds: 0, unowned, locked: 0, protected: protectedCount },
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
  return {
    feature,
    intent: nextIntent,
    tiles: finalTiles,
    elevations,
    obstacles,
    preview,
    commitAllowed: true,
  };
}
