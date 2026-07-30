import type { Course, Terrain, WeekResult, World } from "../models/types";
import { terrainMaintenanceWeight } from "../models/terrainEconomics";
import {
  activeWeather,
  biomeClimatePhenologyForDay,
  seasonalState,
  weatherModifiers,
} from "../seasons/seasons";
import type {
  BiomeClimatePhenologyState,
  DailyWeather,
  WeatherModifiers,
} from "../seasons/types";
import {
  localizedConditionZoneId,
  localizedConditionZones,
  type LocalizedConditionZoneId,
} from "../conditions/localizedConditionZones";

export type SeasonalPresentationLayer =
  | "phenology"
  | "wet-surface"
  | "dry-surface"
  | "frost"
  | "turf-stress"
  | "wear"
  | "maintenance";

export interface SeasonalSurfaceVisualState {
  readonly zoneId: LocalizedConditionZoneId;
  readonly terrain: Terrain;
  readonly moisture: number;
  readonly firmness: number;
  /** Global course condition projected through this surface's static burden. */
  readonly projectedTurfHealth: number;
  /** Latest global wear evidence projected through static surface burden. */
  readonly projectedWear: number;
  /** Static burden projection, not observed localized condition history. */
  readonly maintenancePriority: "baseline" | "watch" | "high";
}

export interface SeasonalVisualState {
  readonly climate: BiomeClimatePhenologyState;
  readonly weather: DailyWeather;
  readonly modifiers: WeatherModifiers;
  /** Course-wide presentation projections; never localized observations. */
  readonly condition: Readonly<{
    moisture: number;
    firmness: number;
    turfHealth: number;
    wear: number;
  }>;
  readonly maintenance: Readonly<{
    source: "latest-week" | "unavailable";
    budget: number;
    required: number | null;
    shortfall: number | null;
    priorities: readonly Readonly<{
      zoneId: LocalizedConditionZoneId;
      priority: "baseline" | "watch" | "high";
      source: "projected-burden";
      terrain: Terrain;
      burden: number;
      relativeBurden: number;
    }>[];
  }>;
  readonly activeLayers: readonly SeasonalPresentationLayer[];
  readonly renderer: Readonly<{
    sceneTint: number;
    vegetationDormancy: number;
    flowering: number;
    wetness: number;
    dryness: number;
    frost: number;
  }>;
  readonly audio: Readonly<{
    weatherKind: DailyWeather["kind"];
    season: DailyWeather["season"];
    rain: number;
    wind: number;
    wildlife: number;
  }>;
  /** Constant-time lookup for a currently visible surface; never persisted. */
  readonly surfaceAt: (x: number, y: number, terrain?: Terrain) => SeasonalSurfaceVisualState;
}

export interface SeasonalVisualStateInput {
  course: Course;
  world: World;
  day: number;
  result?: WeekResult;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const queryCache = new WeakMap<readonly Terrain[], Map<string, SeasonalVisualState>>();
const MAX_QUERY_VARIANTS_PER_COURSE = 12;

function resultSignature(result: WeekResult | undefined): string {
  if (!result) return "-";
  return [
    result.maintenance?.required ?? "-",
    result.maintenance?.budget ?? "-",
    result.maintenance?.shortfall ?? "-",
    result.maintenancePressure?.wear ?? "-",
  ].join(":");
}

function sceneTintFor(weather: DailyWeather, dormancy: number, moisture: number): number {
  if (weather.kind === "frost") return 0xeaf1f5;
  if (weather.kind === "storm" || weather.kind === "heavy_rain") return 0xd8e2e6;
  if (weather.kind === "rain") return 0xe4ebea;
  if (weather.kind === "drought" || weather.kind === "heat") return 0xfff0d5;
  if (dormancy > .6) return 0xf1ead9;
  if (moisture > .7) return 0xe9f3e9;
  return 0xffffff;
}

function weatherMoisture(weather: DailyWeather): number {
  if (weather.kind === "storm") return .98;
  if (weather.kind === "heavy_rain") return .9;
  if (weather.kind === "rain") return .76;
  if (weather.kind === "frost") return .68;
  if (weather.kind === "drought") return .12;
  if (weather.kind === "heat") return .24;
  return weather.kind === "cloudy" ? .52 : .42;
}

/**
 * The single transient M53 presentation query. It projects only from the M39
 * calendar/weather, M52 phenology, M49 localized zones, and the authoritative
 * course/world maintenance inputs used by simulation and reporting.
 */
export function seasonalVisualState(input: SeasonalVisualStateInput): SeasonalVisualState {
  const { course, world, day, result } = input;
  const state = seasonalState(world, course, day);
  const weather = activeWeather(world, course, day);
  const climate = biomeClimatePhenologyForDay(course.theme ?? "parkland", weather.absoluteDay);
  const modifiers = weatherModifiers(weather, state.operations.drainageLevel);
  const maintenanceEvidence = result?.maintenance;
  const maintenanceSource = maintenanceEvidence ? "latest-week" as const : "unavailable" as const;
  const required = maintenanceEvidence?.required ?? null;
  const budget = maintenanceEvidence?.budget ?? world.maintenanceBudget;
  const shortfall = maintenanceEvidence?.shortfall ?? null;
  const wear = clamp(result?.maintenancePressure?.wear ?? (1 - course.condition));
  const key = [
    `${course.width}x${course.height}`,
    course.theme ?? "parkland",
    world.runSeed,
    weather.absoluteDay,
    weather.kind,
    weather.season,
    weather.temperatureF,
    weather.windMph,
    weather.rainInches,
    weather.severity,
    climate.transition.fromSeason,
    climate.transition.toSeason,
    climate.transition.blend,
    climate.vegetation.foliage.from,
    climate.vegetation.foliage.to,
    climate.vegetation.dormancy,
    climate.vegetation.flowering,
    climate.vegetation.moisture.dominant,
    state.operations.drainageLevel,
    course.condition,
    budget,
    required,
    resultSignature(result),
  ].join("|");
  let variants = queryCache.get(course.tiles);
  if (!variants) {
    variants = new Map();
    queryCache.set(course.tiles, variants);
  }
  const cached = variants.get(key);
  if (cached) return cached;

  const climateMoisture = climate.vegetation.moisture.dominant === "wet"
    ? .72
    : climate.vegetation.moisture.dominant === "dry" ? .28 : .5;
  const moisture = clamp(weatherMoisture(weather) * .68 + climateMoisture * .32 - state.operations.drainageLevel * .055);
  const firmness = clamp(1 - moisture * .72 + (weather.kind === "drought" || weather.kind === "heat" ? .18 : 0));
  const turfHealth = clamp(course.condition * (1 - climate.vegetation.dormancy * .28) * (1 - wear * .18));
  const zones = localizedConditionZones(course);
  const meanBurden = [...zones.values()].reduce((sum, zone) => sum + zone.burden, 0) / Math.max(1, zones.size);
  const priorities = [...zones.values()]
    .map((zone) => Object.freeze({
      zoneId: zone.zoneId,
      priority: zone.burden / Math.max(.01, meanBurden) >= 1.15
        ? "high" as const
        : zone.burden / Math.max(.01, meanBurden) >= 1.05 ? "watch" as const : "baseline" as const,
      source: "projected-burden" as const,
      terrain: zone.terrain,
      burden: zone.burden,
      relativeBurden: Number((zone.burden / Math.max(.01, meanBurden)).toFixed(3)),
    }))
    .sort((a, b) => b.burden - a.burden || a.zoneId.localeCompare(b.zoneId));
  const activeLayers: SeasonalPresentationLayer[] = ["phenology"];
  if (moisture >= .62) activeLayers.push("wet-surface");
  if (moisture <= .3) activeLayers.push("dry-surface");
  if (weather.kind === "frost") activeLayers.push("frost");
  if (turfHealth < .62) activeLayers.push("turf-stress");
  if (wear > .4) activeLayers.push("wear");
  if (maintenanceSource === "latest-week" && shortfall != null && shortfall > 0) activeLayers.push("maintenance");

  const surfaces = new Map<string, SeasonalSurfaceVisualState>();
  const surfaceAt = (x: number, y: number, suppliedTerrain?: Terrain): SeasonalSurfaceVisualState => {
    const safeX = Math.max(0, Math.min(course.width - 1, Math.floor(x)));
    const safeY = Math.max(0, Math.min(course.height - 1, Math.floor(y)));
    const terrain = suppliedTerrain ?? course.tiles[safeY * course.width + safeX] ?? "rough";
    const zoneId = localizedConditionZoneId(course.width, course.height, safeX, safeY);
    const cacheKey = `${zoneId}:${terrain}`;
    const existing = surfaces.get(cacheKey);
    if (existing) return existing;
    const zone = zones.get(zoneId);
    const burden = terrainMaintenanceWeight(terrain, course.theme);
    const relativeBurden = burden / Math.max(.1, zone?.burden ?? 1);
    const zoneWear = clamp(wear * (.82 + relativeBurden * .18));
    const zoneHealth = clamp(turfHealth - Math.max(0, relativeBurden - 1) * .08);
    const projectedPriority = relativeBurden >= 1.15 ? "high" : relativeBurden >= 1.05 ? "watch" : "baseline";
    const resolved = Object.freeze({
      zoneId,
      terrain,
      moisture: clamp(moisture + (terrain === "wetland" ? .18 : terrain === "sand" || terrain === "waste_area" ? -.16 : 0)),
      firmness: clamp(firmness + (terrain === "green" || terrain === "tee" ? .05 : terrain === "wetland" ? -.2 : 0)),
      projectedTurfHealth: zoneHealth,
      projectedWear: zoneWear,
      maintenancePriority: projectedPriority,
    });
    surfaces.set(cacheKey, resolved);
    return resolved;
  };

  const visual: SeasonalVisualState = Object.freeze({
    climate,
    weather: Object.freeze({ ...weather }),
    modifiers: Object.freeze({ ...modifiers }),
    condition: Object.freeze({ moisture, firmness, turfHealth, wear }),
    maintenance: Object.freeze({
      source: maintenanceSource,
      budget,
      required,
      shortfall,
      priorities: Object.freeze(priorities),
    }),
    activeLayers: Object.freeze(activeLayers),
    renderer: Object.freeze({
      sceneTint: sceneTintFor(weather, climate.vegetation.dormancy, moisture),
      vegetationDormancy: climate.vegetation.dormancy,
      flowering: climate.vegetation.flowering,
      wetness: moisture,
      dryness: 1 - moisture,
      frost: weather.kind === "frost" ? weather.severity : 0,
    }),
    audio: Object.freeze({
      weatherKind: weather.kind,
      season: weather.season,
      rain: clamp(weather.rainInches / 1.2),
      wind: clamp(weather.windMph / 34),
      wildlife: clamp(1 - climate.vegetation.dormancy * .75 - weather.severity * .35),
    }),
    surfaceAt,
  });
  variants.set(key, visual);
  if (variants.size > MAX_QUERY_VARIANTS_PER_COURSE) {
    variants.delete(variants.keys().next().value!);
  }
  return visual;
}
