import { decodeTerrainBaseline, isOwnedTile } from "../estate/estate";
import type { DailyWeather, SeasonName, WaterPolicy } from "../seasons/types";
import { getBiomeDefinition } from "./biomes";
import {
  decorationDailyCareCost,
  decorationPlantWaterDemand,
} from "./decorations";
import {
  dailyPlantCareCost,
  plantWaterDemand,
  resolvedObstaclePlantId,
} from "./plantRegistry";
import type {
  BiomeOperatingCostBreakdown,
  Course,
  LandTheme,
  Terrain,
} from "./types";

/**
 * The old Parkland/balanced daily charge, retained as the neutral calibration
 * point while area, planting, season, weather, policy, biome, and difficulty
 * now determine the actual charge.
 */
export const PARKLAND_BALANCED_IRRIGATION_REFERENCE_DAILY_COST = 42;
export const IRRIGATION_REFERENCE_MAINTAINED_AREA_UNITS = 4_000;
export const DRAINAGE_REFERENCE_DAILY_CARE_COST = 3;

export const WATER_POLICY_MULTIPLIERS: Record<WaterPolicy, number> = {
  conserve: 12 / PARKLAND_BALANCED_IRRIGATION_REFERENCE_DAILY_COST,
  balanced: 1,
  irrigate: 95 / PARKLAND_BALANCED_IRRIGATION_REFERENCE_DAILY_COST,
};

const WEATHER_KIND_DEMAND: Record<DailyWeather["kind"], number> = {
  clear: 1,
  cloudy: 0.95,
  rain: 0.86,
  heavy_rain: 0.78,
  storm: 0.75,
  heat: 1.17,
  drought: 1.25,
  frost: 0.78,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNonnegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function weatherSampleDemand(weather: DailyWeather): number {
  const temperatureAdjustment = clamp((weather.temperatureF - 70) * 0.003, -0.12, 0.12);
  const rainAdjustment = -clamp(weather.rainInches * 0.12, 0, 0.25);
  const severity = clamp(weather.severity, 0, 1);
  const severityAdjustment =
    weather.kind === "heat" || weather.kind === "drought"
      ? severity * 0.06
      : weather.kind === "rain" || weather.kind === "heavy_rain" || weather.kind === "storm"
        ? -severity * 0.06
        : 0;
  return clamp(
    WEATHER_KIND_DEMAND[weather.kind]
      + temperatureAdjustment
      + rainAdjustment
      + severityAdjustment,
    0.75,
    1.25,
  );
}

/**
 * Uses only supplied, already-authoritative weather. It never generates or
 * advances weather and therefore cannot consume sim RNG or alter state hashes.
 */
export function weatherIrrigationDemandMultiplier(
  currentWeather?: DailyWeather,
  publishedForecast: readonly DailyWeather[] = [],
): number {
  if (!currentWeather && publishedForecast.length === 0) return 1;
  const forecast = publishedForecast.slice(0, 7);
  const forecastAverage = forecast.length
    ? forecast.reduce((sum, weather) => sum + weatherSampleDemand(weather), 0) / forecast.length
    : undefined;
  const demand = currentWeather && forecastAverage != null
    ? weatherSampleDemand(currentWeather) * 0.6 + forecastAverage * 0.4
    : currentWeather
      ? weatherSampleDemand(currentWeather)
      : forecastAverage ?? 1;
  return clamp(demand, 0.75, 1.25);
}

function isManagedTerrain(
  terrain: Terrain,
  naturalTerrain: Terrain | undefined,
): boolean {
  return naturalTerrain == null
    || terrain !== naturalTerrain
    || terrain === "fairway"
    || terrain === "green"
    || terrain === "tee"
    || terrain === "path";
}

/**
 * Authored, owned land only. Untouched surveyed acreage is intentionally free.
 * Legacy courses without a natural baseline conservatively treat their map as
 * managed, matching the pre-estate operating model.
 */
export function maintainedAreaDemandUnits(course: Course): number {
  const expected = course.width * course.height;
  const natural = course.estate
    ? decodeTerrainBaseline(course.estate.naturalBaseline.terrainRle, expected)
    : null;
  const economy = getBiomeDefinition(course.theme).economy;
  let units = 0;
  for (let index = 0; index < expected; index++) {
    const x = index % course.width;
    const y = Math.floor(index / course.width);
    const terrain = course.tiles[index];
    if (!terrain || !isOwnedTile(course, x, y)) continue;
    if (!isManagedTerrain(terrain, natural?.[index])) continue;
    units += economy.terrain[terrain].irrigationDemand;
  }
  return units;
}

export function playerPlantingDemand(course: Course): {
  waterUnits: number;
  careCost: number;
} {
  let waterUnits = 0;
  let careCost = 0;
  for (const obstacle of course.obstacles) {
    // Generated and legacy obstacles deliberately remain natural/free.
    if (obstacle.origin !== "player" || obstacle.type === "rock") continue;
    const plantId = resolvedObstaclePlantId(course.theme, obstacle);
    if (!plantId) continue;
    waterUnits += plantWaterDemand(course.theme, plantId);
    careCost += dailyPlantCareCost(course.theme, plantId);
  }
  for (const decoration of course.decorations ?? []) {
    // Starter generation and old saves can contain provenance-free planting.
    // Only explicit post-schema editor placement enters recurring care.
    if (decoration.origin !== "player") continue;
    waterUnits += decorationPlantWaterDemand(decoration, course.theme);
    careCost += decorationDailyCareCost(decoration, course.theme);
  }
  return { waterUnits, careCost };
}

export interface IrrigationDemandQuoteInput {
  theme?: LandTheme;
  maintainedAreaUnits: number;
  plantingWaterUnits?: number;
  season?: SeasonName;
  currentWeather?: DailyWeather;
  publishedForecast?: readonly DailyWeather[];
  policy?: WaterPolicy;
  costMult?: number;
}

export function quoteIrrigationFromDemand(
  input: IrrigationDemandQuoteInput,
): Pick<
  BiomeOperatingCostBreakdown,
  | "biome"
  | "maintainedAreaUnits"
  | "plantingWaterUnits"
  | "seasonalDemandMultiplier"
  | "weatherDemandMultiplier"
  | "policyMultiplier"
  | "waterCost"
> {
  const biome = getBiomeDefinition(input.theme);
  const maintainedAreaUnits = finiteNonnegative(input.maintainedAreaUnits);
  const plantingWaterUnits = finiteNonnegative(input.plantingWaterUnits);
  const seasonalDemandMultiplier = input.season
    ? biome.economy.water.seasonalDemand[input.season]
    : 1;
  const weatherDemandMultiplier = weatherIrrigationDemandMultiplier(
    input.currentWeather,
    input.publishedForecast,
  );
  const policyMultiplier =
    WATER_POLICY_MULTIPLIERS[input.policy ?? "balanced"];
  const difficultyMultiplier = finiteNonnegative(input.costMult ?? 1);
  const demand =
    (maintainedAreaUnits + plantingWaterUnits)
    / IRRIGATION_REFERENCE_MAINTAINED_AREA_UNITS;
  const waterCost =
    PARKLAND_BALANCED_IRRIGATION_REFERENCE_DAILY_COST
    * demand
    * seasonalDemandMultiplier
    * weatherDemandMultiplier
    * biome.economy.water.scarcityPriceMultiplier
    * policyMultiplier
    * difficultyMultiplier;
  return {
    biome: biome.key,
    maintainedAreaUnits,
    plantingWaterUnits,
    seasonalDemandMultiplier,
    weatherDemandMultiplier,
    policyMultiplier,
    waterCost,
  };
}

export interface DailyBiomeOperatingCostInput
  extends Omit<IrrigationDemandQuoteInput, "theme" | "maintainedAreaUnits" | "plantingWaterUnits"> {
  course: Course;
  drainageLevel?: number;
}

export function quoteDailyBiomeOperatingCosts(
  input: DailyBiomeOperatingCostInput,
): BiomeOperatingCostBreakdown {
  const planting = playerPlantingDemand(input.course);
  const irrigation = quoteIrrigationFromDemand({
    theme: input.course.theme,
    maintainedAreaUnits: maintainedAreaDemandUnits(input.course),
    plantingWaterUnits: planting.waterUnits,
    season: input.season,
    currentWeather: input.currentWeather,
    publishedForecast: input.publishedForecast,
    policy: input.policy,
    costMult: input.costMult,
  });
  const difficultyMultiplier = finiteNonnegative(input.costMult ?? 1);
  const biome = getBiomeDefinition(input.course.theme);
  const plantCareCost = planting.careCost * difficultyMultiplier;
  const drainageCareCost =
    clamp(Math.floor(input.drainageLevel ?? 0), 0, 3)
    * DRAINAGE_REFERENCE_DAILY_CARE_COST
    * biome.economy.drainage.careMultiplier
    * difficultyMultiplier;
  return {
    ...irrigation,
    plantCareCost,
    drainageCareCost,
    total: irrigation.waterCost + plantCareCost + drainageCareCost,
    days: 1,
  };
}

export function scaleBiomeOperatingCosts(
  quote: BiomeOperatingCostBreakdown,
  days: number,
): BiomeOperatingCostBreakdown {
  const scale = Math.max(0, Math.floor(days));
  return {
    ...quote,
    waterCost: quote.waterCost * scale,
    plantCareCost: quote.plantCareCost * scale,
    drainageCareCost: quote.drainageCareCost * scale,
    total: quote.total * scale,
    days: scale,
  };
}
