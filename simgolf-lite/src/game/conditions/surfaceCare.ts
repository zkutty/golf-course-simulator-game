import { terrainCostMult } from "../balance/difficulty";
import { decodeTerrainBaseline } from "../estate/estate";
import type {
  CultivatedTerrain,
  Course,
  Hole,
  SurfaceCareRecordV1,
  SurfaceCareStateV1,
  SurfaceRepairKind,
  SurfaceRepairTaskV1,
  Terrain,
  World,
} from "../models/types";
import { SURFACE_CARE_CELL_SIZE } from "../models/types";
import {
  TERRAIN_BUILD_COST,
  terrainMaintenanceWeight,
  themeBuildMult,
} from "../models/terrainEconomics";
import type { PropertyShotTrace } from "../property/types";
import type {
  BiomeClimatePhenologyState,
  DailyWeather,
  TurfPriority,
  WaterPolicy,
} from "../seasons/types";

export const SURFACE_CARE_STATE_VERSION = 1 as const;
export const MAX_SURFACE_CARE_RECORDS = 4_096;
export const MAX_SURFACE_CARE_ABSOLUTE_DAY = 1_000_000;
const MAX_SURFACE_CARE_TELEMETRY_PER_TILE = 10_000;
const MAX_SURFACE_REPAIR_COST_PER_TILE = 100_000;
export const CULTIVATED_TERRAINS = [
  "green",
  "tee",
  "fairway",
  "rough",
  "deep_rough",
] as const satisfies readonly CultivatedTerrain[];

const CULTIVATED = new Set<Terrain>(CULTIVATED_TERRAINS);
const TERRAIN_CARE_PRIORITY: Record<CultivatedTerrain, number> = {
  green: 5,
  tee: 4,
  fairway: 3,
  rough: 2,
  deep_rough: 1,
};
const TERRAIN_WATER_NEED: Record<CultivatedTerrain, number> = {
  green: 1.8,
  tee: 1.2,
  fairway: 1,
  rough: 0.25,
  deep_rough: 0.12,
};

export type SurfaceCareBiomePressureId =
  | "parkland"
  | "links"
  | "desert"
  | "tropical"
  | "temperate-japan"
  | "alpine"
  | "heathland"
  | "australian-sandbelt";

export interface SurfaceCareBiomePressure {
  growth: number;
  evaporation: number;
  saturation: number;
  disease: number;
  exposure: number;
  encroachment: number;
  compaction: number;
  frost: number;
  recoveryWindow: number;
  note: string;
}

/**
 * Authored cross-biome agronomy contract. Only Parkland, Links, and Desert
 * are currently selectable course themes; the remaining rows are complete
 * forward contracts and do not register unfinished biomes.
 */
export const SURFACE_CARE_BIOME_PRESSURES: Readonly<
  Record<SurfaceCareBiomePressureId, SurfaceCareBiomePressure>
> = Object.freeze({
  parkland: Object.freeze({
    growth: 1,
    evaporation: 1,
    saturation: 1,
    disease: 1,
    exposure: 0.45,
    encroachment: 0.35,
    compaction: 0.75,
    frost: 0.6,
    recoveryWindow: 1,
    note: "Conventional mowing, traffic, moisture, disease, and seasonal recovery.",
  }),
  links: Object.freeze({
    growth: 0.8,
    evaporation: 1.1,
    saturation: 1.25,
    disease: 0.7,
    exposure: 1.45,
    encroachment: 1.35,
    compaction: 0.85,
    frost: 0.65,
    recoveryWindow: 0.9,
    note: "Wind/coastal exposure, winter wetness, and fescue encroachment.",
  }),
  desert: Object.freeze({
    growth: 0.55,
    evaporation: 1.8,
    saturation: 0.35,
    disease: 0.35,
    exposure: 1.1,
    encroachment: 0.2,
    compaction: 1.05,
    frost: 0.2,
    recoveryWindow: 0.8,
    note: "Heat and irrigation failure.",
  }),
  tropical: Object.freeze({
    growth: 1.75,
    evaporation: 1.15,
    saturation: 1.7,
    disease: 1.8,
    exposure: 1.05,
    encroachment: 1.5,
    compaction: 0.85,
    frost: 0,
    recoveryWindow: 1.2,
    note: "Overgrowth, saturation, fungus, storm damage, and bunker washout.",
  }),
  "temperate-japan": Object.freeze({
    growth: 1.15,
    evaporation: 0.9,
    saturation: 1.35,
    disease: 1.45,
    exposure: 0.55,
    encroachment: 0.85,
    compaction: 0.8,
    frost: 0.8,
    recoveryWindow: 0.9,
    note: "Seasonal growth, humidity, drainage, leaf litter, frost, and disease.",
  }),
  alpine: Object.freeze({
    growth: 0.55,
    evaporation: 0.75,
    saturation: 0.85,
    disease: 0.55,
    exposure: 1.3,
    encroachment: 0.35,
    compaction: 0.75,
    frost: 1.8,
    recoveryWindow: 0.45,
    note: "Frost/freeze-thaw, short recovery windows, and authoritative dormancy.",
  }),
  heathland: Object.freeze({
    growth: 0.75,
    evaporation: 1.15,
    saturation: 0.75,
    disease: 0.55,
    exposure: 1.05,
    encroachment: 1.65,
    compaction: 0.9,
    frost: 0.65,
    recoveryWindow: 0.85,
    note: "Heather/gorse encroachment, dry stress, and loss of firm playing quality.",
  }),
  "australian-sandbelt": Object.freeze({
    growth: 0.72,
    evaporation: 1.45,
    saturation: 0.55,
    disease: 0.45,
    exposure: 1.1,
    encroachment: 0.45,
    compaction: 1.45,
    frost: 0.2,
    recoveryWindow: 1,
    note: "Drought, compaction, dry-season thinning, and rainfall recovery distinct from Desert.",
  }),
});

export interface SurfaceCareZone {
  key: string;
  surfaceId: string;
  cellX: number;
  cellY: number;
  intendedTerrain: CultivatedTerrain;
  cells: number[];
}

export interface SurfaceCareTopology {
  zones: SurfaceCareZone[];
  zoneByTile: Array<string | null>;
  zonesByKey: ReadonlyMap<string, SurfaceCareZone>;
}

export type EffectiveSurfaceTreatment =
  | "healthy"
  | "stressed"
  | "overgrown"
  | "severely-overgrown"
  | "thin"
  | "dormant"
  | "repairing"
  | "bare";

export interface EffectiveSurface {
  key: string | null;
  surfaceId: string | null;
  intendedTerrain: Terrain;
  effectiveTerrain: Terrain;
  treatment: EffectiveSurfaceTreatment;
  mowingQuality: number;
  moisture: number;
  turfHealth: number;
  wear: number;
  dormancy: number;
  drainageStress: number;
  repairRequired: boolean;
  repairProgress: number;
  puttingQuality: number;
  playingQuality: number;
}

export interface SurfaceCareZoneEvidence {
  key: string;
  surfaceId: string;
  cellX: number;
  cellY: number;
  terrain: CultivatedTerrain;
  tiles: number;
  demand: number;
  allocated: number;
  serviceRatio: number;
  traffic: number;
  irrigationDemand: number;
  irrigationApplied: number;
  elevatedWaterDemand: number;
  elevatedWaterApplied: number;
  mowingQuality: number;
  moisture: number;
  turfHealth: number;
  wear: number;
  drainageStress: number;
  repairRequired: boolean;
  effectiveTerrain: Terrain;
  action: string;
}

/**
 * Read-only bridge for presentation and reporting consumers. The sparse
 * authority stays in SurfaceCareStateV1; consumers receive the normalized
 * record, stable topology, and the exact effective-surface projection
 * together so they cannot reconstruct a competing condition model.
 */
export interface ObservedSurfaceCareZone {
  zone: SurfaceCareZone;
  record: SurfaceCareRecordV1;
  effective: EffectiveSurface;
}

export interface SurfaceCareDayReport {
  absoluteDay: number;
  zones: number;
  totalDemand: number;
  totalAllocated: number;
  totalIrrigationDemand: number;
  totalIrrigationApplied: number;
  elevatedWaterDemand: number;
  elevatedWaterApplied: number;
  budgetCapacity: number;
  laborCapacity: number;
  groundskeepers: number;
  overallCondition: number;
  tournamentReadiness: number;
  repairRequiredZones: number;
  evidence: SurfaceCareZoneEvidence[];
}

export function surfaceCareWaterCostMultiplier(
  report: Pick<
    SurfaceCareDayReport,
    "totalIrrigationApplied" | "elevatedWaterApplied"
  >,
): number {
  const elevated = Math.max(0, report.elevatedWaterApplied);
  if (elevated <= 0) return 1;
  const routine = Math.max(0, report.totalIrrigationApplied - elevated);
  if (routine <= 0) return 1.35;
  return round4(clamp((routine + elevated) / routine, 1, 1.5));
}

export interface SurfaceRepairQuote {
  key: string;
  kind: SurfaceRepairKind;
  adjustedConstruction: number;
  rate: 0.35 | 0.6;
  cost: number;
  requiredDays: number;
}

export type StartSurfaceRepairResult =
  | {
    ok: true;
    course: Course;
    world: World;
    quote: SurfaceRepairQuote;
  }
  | {
    ok: false;
    course: Course;
    world: World;
    reason: string;
    quote?: SurfaceRepairQuote;
  };

interface MutableZoneAllocation {
  zone: SurfaceCareZone;
  demand: number;
  allocated: number;
  traffic: number;
}

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const round4 = (value: number) => Number(value.toFixed(4));
const integer = (value: unknown, fallback = 0) =>
  Math.floor(finite(value, fallback));

function isCultivatedTerrain(terrain: Terrain | undefined): terrain is CultivatedTerrain {
  return terrain != null && CULTIVATED.has(terrain);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function recordKey(surfaceId: string, cellX: number, cellY: number): string {
  return `${surfaceId}@${cellX},${cellY}`;
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function decodedNaturalTerrain(course: Course): Terrain[] | null {
  if (!course.estate) return null;
  return decodeTerrainBaseline(
    course.estate.naturalBaseline.terrainRle,
    course.width * course.height,
  );
}

function authoredSurfaceIds(course: Course): Array<string | null> {
  const ids = new Array<string | null>(course.tiles.length).fill(null);
  for (const feature of [...(course.surfaceIntent?.features ?? [])]
    .sort((a, b) => a.order - b.order || compareText(a.id, b.id))) {
    if (!isCultivatedTerrain(feature.terrain)) continue;
    for (const index of feature.coverage) {
      if (
        index >= 0
        && index < course.tiles.length
        && course.tiles[index] === feature.terrain
      ) ids[index] = feature.id;
    }
  }
  return ids;
}

const topologyCache = new WeakMap<Course["tiles"], {
  intent: Course["surfaceIntent"];
  estate: Course["estate"];
  width: number;
  height: number;
  topology: SurfaceCareTopology;
}>();

/**
 * Builds stable surface/cell identities without persisting a per-tile map.
 * M35 IDs win. Legacy tile-only surfaces use a deterministic four-connected
 * component ID rooted at the lowest row-major cell.
 */
export function surfaceCareTopology(course: Course): SurfaceCareTopology {
  const cached = topologyCache.get(course.tiles);
  if (
    cached
    && cached.intent === course.surfaceIntent
    && cached.estate === course.estate
    && cached.width === course.width
    && cached.height === course.height
  ) return cached.topology;

  const authored = authoredSurfaceIds(course);
  const natural = decodedNaturalTerrain(course);
  const surfaceIds = authored.slice();
  const managed = course.tiles.map((terrain, index) => {
    if (!isCultivatedTerrain(terrain)) return false;
    if (authored[index]) return true;
    // Green, tee, and fairway are unambiguously cultivated in every vintage.
    if (terrain === "green" || terrain === "tee" || terrain === "fairway") return true;
    // Rough/deep rough are tracked when authoring or an estate baseline proves
    // that the player changed this land. Untouched natural acreage stays free.
    return natural != null && natural[index] !== terrain;
  });

  for (let seed = 0; seed < course.tiles.length; seed++) {
    const terrain = course.tiles[seed];
    if (!managed[seed] || surfaceIds[seed] || !isCultivatedTerrain(terrain)) continue;
    const id = `legacy-${terrain}-${seed.toString(36)}`;
    const queue = [seed];
    surfaceIds[seed] = id;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < course.width ? index + 1 : -1,
        y > 0 ? index - course.width : -1,
        y + 1 < course.height ? index + course.width : -1,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0
          && managed[neighbor]
          && !surfaceIds[neighbor]
          && course.tiles[neighbor] === terrain
        ) {
          surfaceIds[neighbor] = id;
          queue.push(neighbor);
        }
      }
    }
  }

  const mutable = new Map<string, SurfaceCareZone>();
  const zoneByTile = new Array<string | null>(course.tiles.length).fill(null);
  for (let index = 0; index < course.tiles.length; index++) {
    const surfaceId = surfaceIds[index];
    const terrain = course.tiles[index];
    if (!surfaceId || !isCultivatedTerrain(terrain)) continue;
    const x = index % course.width;
    const y = Math.floor(index / course.width);
    const cellX = Math.floor(x / SURFACE_CARE_CELL_SIZE);
    const cellY = Math.floor(y / SURFACE_CARE_CELL_SIZE);
    const key = recordKey(surfaceId, cellX, cellY);
    const zone = mutable.get(key) ?? {
      key,
      surfaceId,
      cellX,
      cellY,
      intendedTerrain: terrain,
      cells: [],
    };
    zone.cells.push(index);
    mutable.set(key, zone);
    zoneByTile[index] = key;
  }
  const zones = [...mutable.values()]
    .map((zone) => ({ ...zone, cells: zone.cells.sort((a, b) => a - b) }))
    .sort((a, b) => compareText(a.key, b.key))
    .slice(0, MAX_SURFACE_CARE_RECORDS);
  const allowed = new Set(zones.map((zone) => zone.key));
  for (let index = 0; index < zoneByTile.length; index++) {
    if (zoneByTile[index] && !allowed.has(zoneByTile[index]!)) zoneByTile[index] = null;
  }
  const topology: SurfaceCareTopology = {
    zones,
    zoneByTile,
    zonesByKey: new Map(zones.map((zone) => [zone.key, zone])),
  };
  topologyCache.set(course.tiles, {
    intent: course.surfaceIntent,
    estate: course.estate,
    width: course.width,
    height: course.height,
    topology,
  });
  return topology;
}

function defaultRecord(zone: SurfaceCareZone, absoluteDay = -1): SurfaceCareRecordV1 {
  return {
    key: zone.key,
    surfaceId: zone.surfaceId,
    cellX: zone.cellX,
    cellY: zone.cellY,
    intendedTerrain: zone.intendedTerrain,
    area: zone.cells.length,
    mowingQuality: 1,
    moisture: 0.58,
    turfHealth: 1,
    wear: 0,
    dormancy: 0,
    drainageStress: 0,
    failureDurationDays: 0,
    missedMowingDays: 0,
    insufficientWaterDays: 0,
    saturatedDays: 0,
    repairRequired: false,
    repairProgress: 0,
    lastDemand: 0,
    lastAllocated: 0,
    lastTraffic: 0,
    lastIrrigationDemand: 0,
    lastIrrigationApplied: 0,
    lastElevatedWaterDemand: 0,
    lastElevatedWaterApplied: 0,
    lastRepairProgressed: false,
    lastRepairServiceRatio: 0,
    lastObservedAbsoluteDay: absoluteDay,
  };
}

function initialRecordForCondition(
  zone: SurfaceCareZone,
  condition: number,
): SurfaceCareRecordV1 {
  const safeCondition = clamp(condition);
  return {
    ...defaultRecord(zone),
    turfHealth: safeCondition,
    mowingQuality: clamp(0.7 + safeCondition * 0.3),
    wear: clamp((1 - safeCondition) * 0.35),
  };
}

function normalizeRepair(
  value: unknown,
  absoluteDay: number,
  zone: SurfaceCareZone,
  maxAbsoluteDay: number,
): SurfaceRepairTaskV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SurfaceRepairTaskV1>;
  if (candidate.kind !== "reseed" && candidate.kind !== "resod") return undefined;
  const requiredMinimum = candidate.kind === "reseed" ? 14 : 5;
  const requiredMaximum = candidate.kind === "reseed" ? 28 : 10;
  const requiredDays = Math.max(
    requiredMinimum,
    Math.min(requiredMaximum, integer(candidate.requiredDays, requiredMinimum)),
  );
  return {
    kind: candidate.kind,
    cost: clamp(
      finite(candidate.cost, 0),
      0,
      zone.cells.length * MAX_SURFACE_REPAIR_COST_PER_TILE,
    ),
    requiredDays,
    progressDays: clamp(finite(candidate.progressDays, 0), 0, requiredDays),
    startedAbsoluteDay: clamp(
      integer(candidate.startedAbsoluteDay, Math.max(0, absoluteDay)),
      0,
      maxAbsoluteDay,
    ),
    elevatedWaterDaysRemaining: Math.max(
      0,
      Math.min(10, integer(candidate.elevatedWaterDaysRemaining, 0)),
    ),
  };
}

function sanitizeRecord(
  value: unknown,
  zone: SurfaceCareZone,
  maxAbsoluteDay: number,
): SurfaceCareRecordV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SurfaceCareRecordV1>;
  const absoluteDay = clamp(
    integer(candidate.lastObservedAbsoluteDay, -1),
    -1,
    maxAbsoluteDay,
  );
  const repair = normalizeRepair(candidate.repair, absoluteDay, zone, maxAbsoluteDay);
  const telemetryMaximum =
    Math.max(1, zone.cells.length) * MAX_SURFACE_CARE_TELEMETRY_PER_TILE;
  const lastDemand = clamp(finite(candidate.lastDemand, 0), 0, telemetryMaximum);
  const lastAllocated = clamp(
    finite(candidate.lastAllocated, 0),
    0,
    lastDemand,
  );
  const lastIrrigationDemand = clamp(
    finite(candidate.lastIrrigationDemand, 0),
    0,
    telemetryMaximum,
  );
  const lastIrrigationApplied = clamp(
    finite(candidate.lastIrrigationApplied, 0),
    0,
    lastIrrigationDemand,
  );
  const lastElevatedWaterDemand = clamp(
    finite(candidate.lastElevatedWaterDemand, 0),
    0,
    lastIrrigationDemand,
  );
  const lastElevatedWaterApplied = clamp(
    finite(candidate.lastElevatedWaterApplied, 0),
    0,
    Math.min(lastIrrigationApplied, lastElevatedWaterDemand),
  );
  return {
    key: zone.key,
    surfaceId: zone.surfaceId,
    cellX: zone.cellX,
    cellY: zone.cellY,
    intendedTerrain: zone.intendedTerrain,
    area: zone.cells.length,
    mowingQuality: clamp(finite(candidate.mowingQuality, 1)),
    moisture: clamp(finite(candidate.moisture, 0.58)),
    turfHealth: clamp(finite(candidate.turfHealth, 1)),
    wear: clamp(finite(candidate.wear, 0)),
    dormancy: clamp(finite(candidate.dormancy, 0)),
    drainageStress: clamp(finite(candidate.drainageStress, 0)),
    failureDurationDays: Math.max(0, Math.min(3650, integer(candidate.failureDurationDays))),
    missedMowingDays: Math.max(0, Math.min(3650, integer(candidate.missedMowingDays))),
    insufficientWaterDays: Math.max(0, Math.min(3650, integer(candidate.insufficientWaterDays))),
    saturatedDays: Math.max(0, Math.min(3650, integer(candidate.saturatedDays))),
    repairRequired: candidate.repairRequired === true,
    repairProgress: clamp(
      repair ? repair.progressDays / Math.max(1, repair.requiredDays) : finite(candidate.repairProgress, 0),
    ),
    ...(repair ? { repair } : {}),
    lastDemand,
    lastAllocated,
    lastTraffic: clamp(finite(candidate.lastTraffic, 0), 0, telemetryMaximum),
    lastIrrigationDemand,
    lastIrrigationApplied,
    lastElevatedWaterDemand,
    lastElevatedWaterApplied,
    lastRepairProgressed: candidate.lastRepairProgressed === true,
    lastRepairServiceRatio: clamp(
      finite(candidate.lastRepairServiceRatio, 0),
    ),
    lastObservedAbsoluteDay: absoluteDay,
  };
}

// Courses are immutable reducer values. Reusing their sanitized sparse state
// keeps route sampling and renderer lookups O(1) per cell after topology work.
const normalizedStateCache = new WeakMap<Course, SurfaceCareStateV1 | null>();

export interface SurfaceCareNormalizationOptions {
  /** Save import can clamp timestamps to the world's current playable day. */
  maxAbsoluteDay?: number;
}

export function normalizeSurfaceCareState(
  value: unknown,
  course: Course,
  options?: SurfaceCareNormalizationOptions,
): SurfaceCareStateV1 | undefined {
  const isCourseState = options == null && value === course.surfaceCare;
  if (isCourseState) {
    const cached = normalizedStateCache.get(course);
    if (cached !== undefined) return cached ?? undefined;
  }
  if (!value || typeof value !== "object") {
    if (isCourseState) normalizedStateCache.set(course, null);
    return undefined;
  }
  const candidate = value as Partial<SurfaceCareStateV1>;
  if (
    candidate.version !== SURFACE_CARE_STATE_VERSION
    || candidate.cellSize !== SURFACE_CARE_CELL_SIZE
    || !candidate.records
    || typeof candidate.records !== "object"
    || Array.isArray(candidate.records)
  ) {
    if (isCourseState) normalizedStateCache.set(course, null);
    return undefined;
  }
  const maxAbsoluteDay = clamp(
    integer(options?.maxAbsoluteDay, MAX_SURFACE_CARE_ABSOLUTE_DAY),
    0,
    MAX_SURFACE_CARE_ABSOLUTE_DAY,
  );
  const lastAdvancedAbsoluteDay = clamp(
    integer(candidate.lastAdvancedAbsoluteDay, -1),
    -1,
    maxAbsoluteDay,
  );
  const records: Record<string, SurfaceCareRecordV1> = {};
  for (const zone of surfaceCareTopology(course).zones) {
    const normalized = sanitizeRecord(
      (candidate.records as Record<string, unknown>)[zone.key],
      zone,
      maxAbsoluteDay,
    );
    if (normalized) records[zone.key] = normalized;
  }
  const normalized: SurfaceCareStateV1 = {
    version: SURFACE_CARE_STATE_VERSION,
    cellSize: SURFACE_CARE_CELL_SIZE,
    lastAdvancedAbsoluteDay,
    records,
  };
  if (isCourseState) normalizedStateCache.set(course, normalized);
  return normalized;
}

function aggregateRecords(
  weighted: Array<{ record: SurfaceCareRecordV1; weight: number }>,
  zone: SurfaceCareZone,
): SurfaceCareRecordV1 | undefined {
  if (weighted.length === 0) return undefined;
  const weight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const average = (select: (record: SurfaceCareRecordV1) => number) =>
    weighted.reduce((sum, item) => sum + select(item.record) * item.weight, 0)
    / Math.max(1, weight);
  return {
    ...defaultRecord(zone),
    mowingQuality: round4(average((record) => record.mowingQuality)),
    moisture: round4(average((record) => record.moisture)),
    turfHealth: round4(average((record) => record.turfHealth)),
    wear: round4(average((record) => record.wear)),
    dormancy: round4(average((record) => record.dormancy)),
    drainageStress: round4(average((record) => record.drainageStress)),
    failureDurationDays: Math.round(average((record) => record.failureDurationDays)),
    missedMowingDays: Math.round(average((record) => record.missedMowingDays)),
    insufficientWaterDays: Math.round(average((record) => record.insufficientWaterDays)),
    saturatedDays: Math.round(average((record) => record.saturatedDays)),
    repairRequired: weighted.some(({ record }) => record.repairRequired),
    // A topology-changing edit cannot duplicate or enlarge a paid task.
    // The resulting zone may still require repair, but must be quoted again.
    repairProgress: 0,
    lastDemand: round4(average((record) => record.lastDemand)),
    lastAllocated: round4(average((record) => record.lastAllocated)),
    lastTraffic: round4(average((record) => record.lastTraffic)),
    lastIrrigationDemand: round4(average((record) => record.lastIrrigationDemand)),
    lastIrrigationApplied: round4(average((record) => record.lastIrrigationApplied)),
    lastElevatedWaterDemand: round4(average((record) => record.lastElevatedWaterDemand)),
    lastElevatedWaterApplied: round4(average((record) => record.lastElevatedWaterApplied)),
    lastObservedAbsoluteDay: Math.max(
      ...weighted.map(({ record }) => record.lastObservedAbsoluteDay),
    ),
  };
}

/**
 * Reprojects condition through an edit by exact tile overlap. Same-terrain
 * repaint, M35 split/merge, feature-node edits, and undo/redo therefore retain
 * neglect deterministically; genuine terrain replacement starts fresh.
 */
export function reconcileSurfaceCareAfterEdit(
  previous: Course,
  next: Course,
): Course {
  const state = normalizeSurfaceCareState(previous.surfaceCare, previous);
  if (!state) return { ...next, surfaceCare: undefined };
  const before = surfaceCareTopology(previous);
  const after = surfaceCareTopology(next);
  const records: Record<string, SurfaceCareRecordV1> = {};
  const coverageKey = (zone: SurfaceCareZone) =>
    `${zone.intendedTerrain}:${zone.cells.join(",")}`;
  const exactBefore = new Map(
    before.zones.map((zone) => [coverageKey(zone), zone]),
  );

  for (const zone of after.zones) {
    const exactZone = exactBefore.get(coverageKey(zone));
    const exact = exactZone ? state.records[exactZone.key] : undefined;
    if (exact && exact.intendedTerrain === zone.intendedTerrain) {
      records[zone.key] = {
        ...exact,
        key: zone.key,
        surfaceId: zone.surfaceId,
        cellX: zone.cellX,
        cellY: zone.cellY,
        intendedTerrain: zone.intendedTerrain,
        area: zone.cells.length,
      };
      continue;
    }
    const overlaps = new Map<string, number>();
    for (const index of zone.cells) {
      const oldKey = before.zoneByTile[index];
      if (oldKey) overlaps.set(oldKey, (overlaps.get(oldKey) ?? 0) + 1);
    }
    const weighted: Array<{ record: SurfaceCareRecordV1; weight: number }> = [...overlaps]
      .flatMap(([key, weight]) => {
        const record = state.records[key];
        return record?.intendedTerrain === zone.intendedTerrain
          ? [{ record, weight }]
          : [];
      });
    const retainedArea = weighted.reduce((sum, item) => sum + item.weight, 0);
    const freshArea = Math.max(0, zone.cells.length - retainedArea);
    if (freshArea > 0) {
      weighted.push({
        record: initialRecordForCondition(zone, next.condition),
        weight: freshArea,
      });
    }
    const aggregated = aggregateRecords(weighted, zone);
    if (aggregated) records[zone.key] = aggregated;
  }
  return {
    ...next,
    surfaceCare: {
      version: SURFACE_CARE_STATE_VERSION,
      cellSize: SURFACE_CARE_CELL_SIZE,
      lastAdvancedAbsoluteDay: state.lastAdvancedAbsoluteDay,
      records,
    },
  };
}

function pressureForTheme(course: Course): SurfaceCareBiomePressure {
  return SURFACE_CARE_BIOME_PRESSURES[course.theme ?? "parkland"];
}

function trafficByZone(
  topology: SurfaceCareTopology,
  course: Course,
  rounds: number,
  traces: readonly PropertyShotTrace[],
  mobilityOffPathTiles: number,
): Map<string, number> {
  const traffic = new Map<string, number>();
  const addIndex = (index: number, amount: number) => {
    const key = topology.zoneByTile[index];
    if (key) traffic.set(key, (traffic.get(key) ?? 0) + amount);
  };
  for (const trace of traces) {
    const distance = Math.hypot(trace.to.x - trace.from.x, trace.to.y - trace.from.y);
    const samples = Math.max(1, Math.ceil(distance / 2));
    for (let sample = 0; sample <= samples; sample++) {
      const t = sample / samples;
      const x = Math.max(
        0,
        Math.min(course.width - 1, Math.floor(trace.from.x + (trace.to.x - trace.from.x) * t)),
      );
      const y = Math.max(
        0,
        Math.min(course.height - 1, Math.floor(trace.from.y + (trace.to.y - trace.from.y) * t)),
      );
      addIndex(y * course.width + x, sample === samples ? 1.5 : 0.35);
    }
  }
  const areaByTerrain = new Map<CultivatedTerrain, number>();
  for (const zone of topology.zones) {
    areaByTerrain.set(
      zone.intendedTerrain,
      (areaByTerrain.get(zone.intendedTerrain) ?? 0) + zone.cells.length,
    );
  }
  const baselineFactor: Record<CultivatedTerrain, number> = {
    green: 1.5,
    tee: 1.1,
    fairway: 0.42,
    rough: 0.18,
    deep_rough: 0.08,
  };
  for (const zone of topology.zones) {
    const areaShare = zone.cells.length
      / Math.max(1, areaByTerrain.get(zone.intendedTerrain) ?? zone.cells.length);
    const baseline = Math.max(0, rounds) * baselineFactor[zone.intendedTerrain] * areaShare;
    const mobility = (
      zone.intendedTerrain === "fairway"
      || zone.intendedTerrain === "rough"
      || zone.intendedTerrain === "deep_rough"
    )
      ? Math.max(0, mobilityOffPathTiles) * areaShare * 0.018
      : 0;
    traffic.set(zone.key, (traffic.get(zone.key) ?? 0) + baseline + mobility);
  }
  return traffic;
}

function groundskeeperCapacity(world: World, course: Course): {
  groundskeepers: number;
  laborCapacity: number;
} {
  const activeCourseId = course.activeCourseId;
  const groundskeepers = (world.staffRoster ?? []).filter((member) =>
    member.role === "groundskeeper"
    && (!member.courseId || member.courseId === activeCourseId)
  );
  if (groundskeepers.length > 0) {
    return {
      groundskeepers: groundskeepers.length,
      laborCapacity: groundskeepers.reduce((sum, member) =>
        sum + 820 * clamp(member.proficiency ?? 0.65, 0.35, 1.25), 0),
    };
  }
  const fallback = Math.max(0, Math.floor(world.staffLevel));
  return {
    groundskeepers: fallback > 0 ? 1 : 0,
    laborCapacity: fallback > 0 ? 620 + fallback * 90 : 0,
  };
}

function allocationPriority(
  allocation: MutableZoneAllocation,
  record: SurfaceCareRecordV1,
  priority: TurfPriority,
): number {
  const repair = record.repairRequired || record.repair ? 100 : 0;
  const health = (1 - record.turfHealth) * (priority === "recovery" ? 45 : 25);
  const presentation = (1 - record.mowingQuality)
    * (priority === "presentation" ? 36 : 18);
  const playability = TERRAIN_CARE_PRIORITY[allocation.zone.intendedTerrain]
    * (priority === "playability" ? 7 : 4);
  return repair + health + presentation + playability + allocation.traffic * 0.03;
}

function weatherEvaporation(weather: DailyWeather): number {
  const temperature = clamp((weather.temperatureF - 48) / 55, 0, 1.5);
  const wind = clamp((weather.windMph - 5) / 35, 0, 1);
  const kind = weather.kind === "drought"
    ? 1.55
    : weather.kind === "heat"
      ? 1.35
      : weather.kind === "frost"
        ? 0.25
        : 1;
  return (0.025 + temperature * 0.07 + wind * 0.025) * kind;
}

interface IrrigationPlan {
  /** Area-weighted volume used for reporting and operating-cost allocation. */
  demand: number;
  applied: number;
  elevatedDemand: number;
  elevatedApplied: number;
  /** Per-tile root-zone depth used only for local moisture evolution. */
  appliedDepth: number;
}

function irrigationPlan(
  terrain: CultivatedTerrain,
  policy: WaterPolicy,
  pressure: SurfaceCareBiomePressure,
  repair: SurfaceRepairTaskV1 | undefined,
  moisture: number,
  area: number,
): IrrigationPlan {
  const policyCapacity =
    policy === "irrigate" ? 0.145 : policy === "balanced" ? 0.079 : 0.025;
  const establishmentMultiplier =
    repair?.kind === "resod" && repair.elevatedWaterDaysRemaining > 0
    ? 1.35
    : 1;
  const rootZoneTaper = clamp((0.72 - moisture) / 0.35, 0, 1);
  const routineDemand = Math.min(
    0.35,
    0.075
      * (0.65 + TERRAIN_WATER_NEED[terrain] * 0.35)
      * Math.max(0.65, pressure.evaporation)
      * rootZoneTaper,
  );
  const demandDepth = Math.min(0.45, routineDemand * establishmentMultiplier);
  const routineApplied = Math.min(routineDemand, policyCapacity * rootZoneTaper);
  const appliedDepth = Math.min(
    demandDepth,
    policyCapacity * establishmentMultiplier * rootZoneTaper,
  );
  const safeArea = Math.max(1, area);
  return {
    demand: demandDepth * safeArea,
    applied: appliedDepth * safeArea,
    elevatedDemand: Math.max(0, demandDepth - routineDemand) * safeArea,
    elevatedApplied: Math.max(0, appliedDepth - routineApplied) * safeArea,
    appliedDepth,
  };
}

function suitableGrowingDay(
  weather: DailyWeather,
  dormancy: number,
  moisture: number,
): boolean {
  return (
    dormancy < 0.68
    && weather.temperatureF >= 45
    && weather.temperatureF <= 92
    && weather.kind !== "frost"
    && weather.kind !== "storm"
    && moisture >= 0.32
    && moisture <= 0.82
  );
}

function advanceRecord(args: {
  allocation: MutableZoneAllocation;
  previous: SurfaceCareRecordV1;
  weather: DailyWeather;
  climate: BiomeClimatePhenologyState;
  pressure: SurfaceCareBiomePressure;
  waterPolicy: WaterPolicy;
  turfPriority: TurfPriority;
  drainageLevel: number;
  absoluteDay: number;
}): SurfaceCareRecordV1 {
  const {
    allocation,
    previous,
    weather,
    climate,
    pressure,
    waterPolicy,
    turfPriority,
    drainageLevel,
    absoluteDay,
  } = args;
  const service = clamp(allocation.allocated / Math.max(0.0001, allocation.demand));
  const dormancy = clamp(climate.vegetation.dormancy);
  const growing = Math.max(0.2, (1 - dormancy * 0.82) * pressure.growth);
  const mowingServiced = service >= 0.72;
  const missedMowingDays = mowingServiced
    ? Math.max(
      0,
      previous.missedMowingDays - Math.max(4, Math.round(7 * service)),
    )
    : previous.missedMowingDays + 1;
  const mowingQuality = mowingServiced
    ? clamp(previous.mowingQuality + 0.42 * service)
    : clamp(
      previous.mowingQuality
      - 0.095 * Math.max(0.75, growing) * (1 - service * 0.55),
    );

  const rainfall = Math.min(0.5, Math.max(0, weather.rainInches) * 0.42);
  const irrigation = irrigationPlan(
    allocation.zone.intendedTerrain,
    waterPolicy,
    pressure,
    previous.repair,
    previous.moisture,
    allocation.zone.cells.length,
  );
  const evaporation = weatherEvaporation(weather) * pressure.evaporation;
  const moisture = clamp(
    previous.moisture + rainfall + irrigation.appliedDepth - evaporation,
  );
  const insufficientWaterDays = moisture < 0.34
    ? previous.insufficientWaterDays + 1
    : Math.max(0, previous.insufficientWaterDays - 1);
  const saturatedDays = moisture > 0.84
    ? previous.saturatedDays + 1
    : Math.max(0, previous.saturatedDays - 1);
  const drainageRelief = clamp(Math.floor(drainageLevel), 0, 3) * 0.13;
  const drainageStress = clamp(
    previous.drainageStress * 0.68
    + Math.max(0, moisture - 0.78) * pressure.saturation * (1 - drainageRelief)
    + (weather.kind === "storm" ? 0.12 * pressure.saturation * (1 - drainageRelief) : 0),
  );
  const trafficWear = clamp(
    allocation.traffic
    / Math.max(3, allocation.zone.cells.length * 4)
    * pressure.compaction,
    0,
    0.34,
  );
  const wear = clamp(previous.wear * 0.72 + trafficWear);

  // Dormancy is authoritative seasonal state: it slows growth/recovery but is
  // never itself counted as turf death or a failure day.
  const droughtDamage = insufficientWaterDays >= 3
    ? 0.018 + Math.min(0.035, (insufficientWaterDays - 3) * 0.0025)
    : 0;
  const wetDamage = saturatedDays >= 4
    ? (0.009 + drainageStress * 0.018) * pressure.disease
    : 0;
  const mowingDamage = missedMowingDays >= 14
    ? 0.009 * pressure.encroachment * (1 - dormancy * 0.6)
    : 0;
  const frostDamage = weather.kind === "frost" && dormancy < 0.25
    ? 0.003 * pressure.frost
    : 0;
  const wearDamage = wear * 0.018;
  const damage = droughtDamage + wetDamage + mowingDamage + frostDamage + wearDamage;
  const recoveryRate = (
    turfPriority === "recovery" ? 0.032 : turfPriority === "presentation" ? 0.021 : 0.024
  ) * pressure.recoveryWindow * (1 - dormancy * 0.82);
  const recovery = (
    moisture >= 0.38
    && moisture <= 0.78
    && service >= 0.6
    && !previous.repairRequired
  ) ? recoveryRate * (1 - previous.turfHealth) : 0;
  let turfHealth = clamp(previous.turfHealth - damage + recovery);

  let repair = previous.repair ? { ...previous.repair } : undefined;
  let repairProgress = previous.repairProgress;
  let repairRequired = previous.repairRequired;
  let lastRepairProgressed = false;
  let lastRepairServiceRatio = 0;
  if (repair) {
    lastRepairServiceRatio = service;
    const suitable = repair.kind === "reseed"
      ? suitableGrowingDay(weather, dormancy, moisture)
      : weather.kind !== "storm"
        && weather.kind !== "frost"
        && moisture >= 0.3
        && moisture <= 0.86;
    const progressed = suitable && service >= 0.55;
    lastRepairProgressed = progressed;
    if (progressed) repair.progressDays++;
    if (
      progressed
      && repair.kind === "resod"
      && repair.elevatedWaterDaysRemaining > 0
    ) {
      repair.elevatedWaterDaysRemaining--;
    }
    repairProgress = clamp(repair.progressDays / Math.max(1, repair.requiredDays));
    turfHealth = Math.max(
      turfHealth,
      repair.kind === "resod"
        ? 0.22 + repairProgress * 0.73
        : 0.12 + repairProgress * 0.78,
    );
    if (repair.progressDays >= repair.requiredDays) {
      turfHealth = Math.max(turfHealth, repair.kind === "resod" ? 0.95 : 0.9);
      repairRequired = false;
      repairProgress = 1;
      repair = undefined;
    }
  }

  const failureDurationDays = turfHealth < 0.2
    ? previous.failureDurationDays + 1
    : Math.max(0, previous.failureDurationDays - 1);
  if (failureDurationDays >= 7 && !repair) {
    repairRequired = true;
    turfHealth = Math.min(turfHealth, 0.19);
  }

  return {
    key: allocation.zone.key,
    surfaceId: allocation.zone.surfaceId,
    cellX: allocation.zone.cellX,
    cellY: allocation.zone.cellY,
    intendedTerrain: allocation.zone.intendedTerrain,
    area: allocation.zone.cells.length,
    mowingQuality: round4(mowingQuality),
    moisture: round4(moisture),
    turfHealth: round4(turfHealth),
    wear: round4(wear),
    dormancy: round4(dormancy),
    drainageStress: round4(drainageStress),
    failureDurationDays,
    missedMowingDays,
    insufficientWaterDays,
    saturatedDays,
    repairRequired,
    repairProgress: round4(repairProgress),
    ...(repair ? { repair } : {}),
    lastDemand: round4(allocation.demand),
    lastAllocated: round4(allocation.allocated),
    lastTraffic: round4(allocation.traffic),
    // Keep volume telemetry unrounded per zone; reports round only after
    // aggregation so splitting identical acreage cannot change its surcharge.
    lastIrrigationDemand: irrigation.demand,
    lastIrrigationApplied: irrigation.applied,
    lastElevatedWaterDemand: irrigation.elevatedDemand,
    lastElevatedWaterApplied: irrigation.elevatedApplied,
    lastRepairProgressed,
    lastRepairServiceRatio: round4(lastRepairServiceRatio),
    lastObservedAbsoluteDay: absoluteDay,
  };
}

function degradationStage(record: SurfaceCareRecordV1): 0 | 1 | 2 | 3 {
  if (record.repairRequired || record.turfHealth < 0.12) return 3;
  if (
    record.turfHealth < 0.34
    || record.mowingQuality < 0.1
    || record.missedMowingDays >= 18
  ) return 2;
  if (
    record.turfHealth < 0.62
    || record.mowingQuality < 0.42
    || record.missedMowingDays >= 8
  ) return 1;
  return 0;
}

function degradedTerrain(
  terrain: CultivatedTerrain,
  stage: 0 | 1 | 2 | 3,
): Terrain {
  if (stage === 3) return "waste_area";
  if (terrain === "green" || terrain === "tee") {
    return stage === 2 ? "rough" : stage === 1 ? "fairway" : terrain;
  }
  if (terrain === "fairway") {
    return stage === 2 ? "deep_rough" : stage === 1 ? "rough" : terrain;
  }
  if (terrain === "rough") return stage >= 2 ? "waste_area" : stage === 1 ? "deep_rough" : terrain;
  return stage >= 2 ? "waste_area" : terrain;
}

function treatmentFor(
  record: SurfaceCareRecordV1,
  stage: 0 | 1 | 2 | 3,
): EffectiveSurfaceTreatment {
  if (record.repair) return "repairing";
  if (stage === 3) return "bare";
  if (
    (record.intendedTerrain === "rough" || record.intendedTerrain === "deep_rough")
    && record.turfHealth < 0.62
  ) return "thin";
  if (stage === 2) return "severely-overgrown";
  if (stage === 1 && record.mowingQuality < 0.42) return "overgrown";
  if (record.dormancy >= 0.55 && record.turfHealth >= 0.35) return "dormant";
  if (
    record.turfHealth < 0.8
    || record.moisture < 0.35
    || record.moisture > 0.82
    || record.drainageStress > 0.35
    || record.wear > 0.35
  ) return "stressed";
  return "healthy";
}

function effectiveFromRecord(record: SurfaceCareRecordV1): EffectiveSurface {
  const stage = degradationStage(record);
  const effectiveTerrain = degradedTerrain(record.intendedTerrain, stage);
  const moistureQuality = 1 - Math.min(1, Math.abs(record.moisture - 0.58) / 0.58);
  const playingQuality = clamp(
    record.turfHealth * 0.48
    + record.mowingQuality * 0.24
    + moistureQuality * 0.12
    + (1 - record.wear) * 0.1
    + (1 - record.drainageStress) * 0.06,
  );
  const puttingQuality = record.intendedTerrain === "green"
    ? clamp(playingQuality * 0.72 + record.mowingQuality * 0.28)
    : playingQuality;
  return {
    key: record.key,
    surfaceId: record.surfaceId,
    intendedTerrain: record.intendedTerrain,
    effectiveTerrain,
    treatment: treatmentFor(record, stage),
    mowingQuality: record.mowingQuality,
    moisture: record.moisture,
    turfHealth: record.turfHealth,
    wear: record.wear,
    dormancy: record.dormancy,
    drainageStress: record.drainageStress,
    repairRequired: record.repairRequired,
    repairProgress: record.repairProgress,
    puttingQuality: round4(puttingQuality),
    playingQuality: round4(playingQuality),
  };
}

function terrainVisualSignatureForRecord(record: SurfaceCareRecordV1): string {
  const effective = effectiveFromRecord(record);
  return [
    effective.effectiveTerrain,
    effective.treatment,
    record.mowingQuality.toFixed(4),
  ].join(":");
}

/**
 * Per-tile terrain-chunk invalidation only. Bounded care-layer cues have their
 * own compact signature and must not cause terrain geometry/material rebuilds.
 */
export function surfaceCareVisualSignatures(course: Course): string[] {
  if (course.surfaceCare == null) {
    return course.tiles.map((terrain) => `${terrain}:authored`);
  }
  const topology = surfaceCareTopology(course);
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  return course.tiles.map((terrain, index) => {
    const key = topology.zoneByTile[index];
    const zone = key ? topology.zonesByKey.get(key) : undefined;
    const record = key && zone ? state?.records[key] : undefined;
    return record
      ? terrainVisualSignatureForRecord(record)
      : `${terrain}:authored`;
  });
}

/**
 * Compact invalidation identity for the separate bounded care layer. It
 * includes every input used to select care cues, but is never expanded per
 * tile and never participates in terrain-chunk dirty checks.
 */
export function surfaceCarePresentationSignature(course: Course): string {
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  if (!state) return "00000000";
  const topology = surfaceCareTopology(course);
  const parts = topology.zones.flatMap((zone) => {
    const record = state.records[zone.key];
    if (!record || record.lastObservedAbsoluteDay < 0) return [];
    const effective = effectiveFromRecord(record);
    return [[
      zone.key,
      zone.surfaceId,
      zone.cells.length,
      effective.effectiveTerrain,
      effective.treatment,
      record.mowingQuality.toFixed(4),
      record.moisture.toFixed(4),
      record.turfHealth.toFixed(4),
      record.wear.toFixed(4),
      record.drainageStress.toFixed(4),
      record.missedMowingDays,
      record.insufficientWaterDays,
      record.saturatedDays,
      Number(record.repairRequired),
      record.repair?.kind ?? "none",
      record.repair?.progressDays ?? 0,
      record.repair?.requiredDays ?? 0,
      record.repair?.startedAbsoluteDay ?? -1,
      record.repairProgress.toFixed(4),
      record.lastTraffic.toFixed(4),
      Number(record.lastRepairProgressed === true),
      (record.lastRepairServiceRatio ?? 0).toFixed(4),
      record.lastObservedAbsoluteDay,
    ].join(":")];
  });
  const holeRoutes = course.holes.map((hole, index) => [
    hole.id ?? `hole-${index + 1}`,
    hole.tee ? `${hole.tee.x},${hole.tee.y}` : "no-tee",
    ...(hole.waypoints ?? []).map((point) => `${point.x},${point.y}`),
    hole.green ? `${hole.green.x},${hole.green.y}` : "no-green",
  ].join(":"));
  return hashText(`${parts.join("|")}#${holeRoutes.join("|")}`)
    .toString(16)
    .padStart(8, "0");
}

export function resolveEffectiveSurfaceAtIndex(
  course: Course,
  index: number,
): EffectiveSurface {
  const terrain = course.tiles[index] ?? "rough";
  const topology = surfaceCareTopology(course);
  const key = topology.zoneByTile[index];
  const zone = key ? topology.zonesByKey.get(key) : undefined;
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  const record = key && zone ? state?.records[key] ?? defaultRecord(zone) : undefined;
  if (record) return effectiveFromRecord(record);
  return {
    key: null,
    surfaceId: null,
    intendedTerrain: terrain,
    effectiveTerrain: terrain,
    treatment: "healthy",
    mowingQuality: 1,
    moisture: 0.58,
    turfHealth: 1,
    wear: 0,
    dormancy: 0,
    drainageStress: 0,
    repairRequired: false,
    repairProgress: 0,
    puttingQuality: 1,
    playingQuality: 1,
  };
}

/** A same-terrain repaint previews the current treatment, not healthy turf. */
export function effectiveTerrainForPaintPreview(
  course: Course,
  index: number,
  paintedTerrain: Terrain,
): Terrain {
  return course.tiles[index] === paintedTerrain
    ? resolveEffectiveSurfaceAtIndex(course, index).effectiveTerrain
    : paintedTerrain;
}

export function resolveEffectiveSurface(
  course: Course,
  x: number,
  y: number,
): EffectiveSurface {
  const safeX = Math.max(0, Math.min(course.width - 1, Math.floor(x)));
  const safeY = Math.max(0, Math.min(course.height - 1, Math.floor(y)));
  return resolveEffectiveSurfaceAtIndex(course, safeY * course.width + safeX);
}

/**
 * Returns only genuinely observed sparse zones. Defaults synthesized for
 * unobserved terrain are intentionally excluded: absence of evidence must
 * never become a visible maintenance problem.
 */
export function observedSurfaceCareZones(
  course: Course,
): readonly ObservedSurfaceCareZone[] {
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  if (!state) return Object.freeze([]);
  const topology = surfaceCareTopology(course);
  return Object.freeze(topology.zones.flatMap((zone) => {
    const record = state.records[zone.key];
    if (!record || record.lastObservedAbsoluteDay < 0) return [];
    return [Object.freeze({
      zone,
      record,
      effective: effectiveFromRecord(record),
    })];
  }));
}

/** Local playing quality sampled along a published hole, including its green. */
export function surfaceCareQualityForHole(course: Course, hole: Hole): number {
  if (!hole.tee || !hole.green) return clamp(course.condition);
  const route = [hole.tee, ...(hole.waypoints ?? []), hole.green];
  let quality = 0;
  let weight = 0;
  for (let segment = 1; segment < route.length; segment++) {
    const from = route[segment - 1];
    const to = route[segment];
    const samples = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
    for (let sample = 0; sample < samples; sample++) {
      const t = sample / samples;
      quality += resolveEffectiveSurface(
        course,
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
      ).playingQuality;
      weight++;
    }
  }
  const green = resolveEffectiveSurface(course, hole.green.x, hole.green.y);
  quality += green.puttingQuality * 3;
  weight += 3;
  return round4(quality / Math.max(1, weight));
}

const effectiveTilesCache = new WeakMap<Course, Terrain[]>();

export function effectiveSurfaceTiles(course: Course): Terrain[] {
  const cached = effectiveTilesCache.get(course);
  if (cached) return cached;
  if (course.surfaceCare == null) {
    effectiveTilesCache.set(course, course.tiles);
    return course.tiles;
  }
  const topology = surfaceCareTopology(course);
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  if (!state || Object.keys(state.records).length === 0) {
    effectiveTilesCache.set(course, course.tiles);
    return course.tiles;
  }
  const tiles = course.tiles.slice();
  for (const zone of topology.zones) {
    const record = state.records[zone.key];
    if (!record) continue;
    const effective = effectiveFromRecord(record).effectiveTerrain;
    if (effective === zone.intendedTerrain) continue;
    for (const index of zone.cells) tiles[index] = effective;
  }
  effectiveTilesCache.set(course, tiles);
  return tiles;
}

/**
 * Downstream simulation/analysis can consume this immutable view. Authored
 * terrain and care state remain available on the original Course only.
 */
export function courseWithEffectiveSurfaces(course: Course): Course {
  if (course.surfaceCare == null) return course;
  const tiles = effectiveSurfaceTiles(course);
  // Once the terrain projection is frozen, downstream terrain-only consumers
  // must not rebuild care topology through a tracked/proxied tile array.
  return { ...course, tiles, surfaceCare: undefined };
}

function evidenceAction(record: SurfaceCareRecordV1): string {
  if (record.repair) return `Continue ${record.repair.kind} establishment`;
  if (record.repairRequired) return "Schedule reseeding or resodding";
  if (record.insufficientWaterDays >= 2) return "Restore irrigation coverage";
  if (record.drainageStress > 0.4) return "Improve drainage or reduce traffic";
  if (record.missedMowingDays >= 2) return "Restore mowing service";
  if (record.wear > 0.4) return "Redirect traffic and fund recovery";
  return "Keep this local care plan";
}

export function observedSurfaceCareEvidence(course: Course): SurfaceCareZoneEvidence[] {
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  if (!state) return [];
  const topology = surfaceCareTopology(course);
  return topology.zones
    .flatMap((zone) => {
      const record = state.records[zone.key];
      if (!record || record.lastObservedAbsoluteDay < 0) return [];
      const effective = effectiveFromRecord(record);
      return [{
        key: zone.key,
        surfaceId: zone.surfaceId,
        cellX: zone.cellX,
        cellY: zone.cellY,
        terrain: zone.intendedTerrain,
        tiles: zone.cells.length,
        demand: record.lastDemand,
        allocated: record.lastAllocated,
        serviceRatio: round4(clamp(record.lastAllocated / Math.max(0.0001, record.lastDemand))),
        traffic: record.lastTraffic,
        irrigationDemand: record.lastIrrigationDemand,
        irrigationApplied: record.lastIrrigationApplied,
        elevatedWaterDemand: record.lastElevatedWaterDemand,
        elevatedWaterApplied: record.lastElevatedWaterApplied,
        mowingQuality: record.mowingQuality,
        moisture: record.moisture,
        turfHealth: record.turfHealth,
        wear: record.wear,
        drainageStress: record.drainageStress,
        repairRequired: record.repairRequired,
        effectiveTerrain: effective.effectiveTerrain,
        action: evidenceAction(record),
      }];
    })
    .sort((a, b) =>
      Number(b.repairRequired) - Number(a.repairRequired)
      || a.turfHealth - b.turfHealth
      || b.wear - a.wear
      || compareText(a.key, b.key));
}

export function surfaceCareConditionSummary(course: Course): {
  zones: number;
  overallCondition: number;
  tournamentReadiness: number;
  repairRequiredZones: number;
} {
  const topology = surfaceCareTopology(course);
  if (topology.zones.length === 0) {
    return {
      zones: 0,
      overallCondition: clamp(course.condition),
      tournamentReadiness: clamp(course.condition),
      repairRequiredZones: 0,
    };
  }
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  if (!state) {
    return {
      zones: topology.zones.length,
      overallCondition: clamp(course.condition),
      tournamentReadiness: clamp(course.condition),
      repairRequiredZones: 0,
    };
  }
  let weight = 0;
  let condition = 0;
  let readinessWeight = 0;
  let readiness = 0;
  let repairRequiredZones = 0;
  for (const zone of topology.zones) {
    const record =
      state.records[zone.key] ?? initialRecordForCondition(zone, course.condition);
    const effective = effectiveFromRecord(record);
    const zoneWeight = zone.cells.length * (
      zone.intendedTerrain === "green" ? 2.4
        : zone.intendedTerrain === "tee" ? 1.6
          : 1
    );
    weight += zoneWeight;
    condition += effective.playingQuality * zoneWeight;
    if (zone.intendedTerrain === "green" || zone.intendedTerrain === "tee") {
      const readinessZoneWeight = zone.cells.length
        * (zone.intendedTerrain === "green" ? 2 : 1);
      readinessWeight += readinessZoneWeight;
      readiness += (
        zone.intendedTerrain === "green"
          ? effective.puttingQuality
          : effective.playingQuality
      ) * readinessZoneWeight;
    }
    if (record.repairRequired) repairRequiredZones++;
  }
  return {
    zones: topology.zones.length,
    overallCondition: round4(condition / Math.max(1, weight)),
    tournamentReadiness: round4(
      readinessWeight > 0
        ? readiness / readinessWeight
        : condition / Math.max(1, weight),
    ),
    repairRequiredZones,
  };
}

export function advanceSurfaceCareDay(input: {
  course: Course;
  world: World;
  absoluteDay: number;
  weather: DailyWeather;
  climate: BiomeClimatePhenologyState;
  turfPriority: TurfPriority;
  waterPolicy: WaterPolicy;
  drainageLevel: number;
  rounds: number;
  shotTraces?: readonly PropertyShotTrace[];
  mobilityOffPathTiles?: number;
}): { course: Course; report: SurfaceCareDayReport } {
  const topology = surfaceCareTopology(input.course);
  const normalized = normalizeSurfaceCareState(input.course.surfaceCare, input.course);
  const existing: SurfaceCareStateV1 = normalized ?? {
    version: SURFACE_CARE_STATE_VERSION,
    cellSize: SURFACE_CARE_CELL_SIZE,
    lastAdvancedAbsoluteDay: input.absoluteDay - 1,
    records: {},
  };
  if (existing.lastAdvancedAbsoluteDay >= input.absoluteDay) {
    const summary = surfaceCareConditionSummary(input.course);
    const evidence = observedSurfaceCareEvidence(input.course);
    return {
      course: input.course,
      report: {
        absoluteDay: existing.lastAdvancedAbsoluteDay,
        zones: summary.zones,
        totalDemand: evidence.reduce((sum, item) => sum + item.demand, 0),
        totalAllocated: evidence.reduce((sum, item) => sum + item.allocated, 0),
        totalIrrigationDemand: evidence.reduce(
          (sum, item) => sum + item.irrigationDemand,
          0,
        ),
        totalIrrigationApplied: evidence.reduce(
          (sum, item) => sum + item.irrigationApplied,
          0,
        ),
        elevatedWaterDemand: evidence.reduce(
          (sum, item) => sum + item.elevatedWaterDemand,
          0,
        ),
        elevatedWaterApplied: evidence.reduce(
          (sum, item) => sum + item.elevatedWaterApplied,
          0,
        ),
        budgetCapacity: Math.max(0, input.world.maintenanceBudget) / 7 / 0.13,
        laborCapacity: groundskeeperCapacity(input.world, input.course).laborCapacity,
        groundskeepers: groundskeeperCapacity(input.world, input.course).groundskeepers,
        overallCondition: summary.overallCondition,
        tournamentReadiness: summary.tournamentReadiness,
        repairRequiredZones: summary.repairRequiredZones,
        evidence,
      },
    };
  }

  const pressure = pressureForTheme(input.course);
  const initialRecord = (zone: SurfaceCareZone): SurfaceCareRecordV1 =>
    initialRecordForCondition(zone, input.course.condition);
  const traffic = trafficByZone(
    topology,
    input.course,
    input.rounds,
    input.shotTraces ?? [],
    input.mobilityOffPathTiles ?? 0,
  );
  const growthSeason = Math.max(0.25, 1 - input.climate.vegetation.dormancy * 0.75);
  const allocations: MutableZoneAllocation[] = topology.zones.map((zone) => {
    const previous = existing.records[zone.key] ?? initialRecord(zone);
    const localTraffic = traffic.get(zone.key) ?? 0;
    const repairDemand = previous.repair ? zone.cells.length * 0.55 : 0;
    const presentationDemand = zone.cells.length
      * Math.max(0.08, terrainMaintenanceWeight(zone.intendedTerrain, input.course.theme))
      * growthSeason
      * pressure.growth;
    const trafficDemand = localTraffic * (
      zone.intendedTerrain === "green" || zone.intendedTerrain === "tee" ? 0.6 : 0.32
    );
    const weatherDemand = zone.cells.length * (
      input.weather.kind === "storm" || input.weather.kind === "heavy_rain"
        ? 0.12 * pressure.saturation
        : input.weather.kind === "drought" || input.weather.kind === "heat"
          ? 0.1 * pressure.evaporation
          : 0
    );
    return {
      zone,
      demand: Math.max(0.01, presentationDemand + trafficDemand + weatherDemand + repairDemand),
      allocated: 0,
      traffic: localTraffic,
    };
  });
  const labor = groundskeeperCapacity(input.world, input.course);
  const budgetCapacity = Math.max(0, input.world.maintenanceBudget) / 7 / 0.13;
  let remaining = Math.min(labor.laborCapacity, budgetCapacity);
  const prioritized = allocations.slice().sort((a, b) => {
    const recordA = existing.records[a.zone.key] ?? initialRecord(a.zone);
    const recordB = existing.records[b.zone.key] ?? initialRecord(b.zone);
    return allocationPriority(b, recordB, input.turfPriority)
      - allocationPriority(a, recordA, input.turfPriority)
      || compareText(a.zone.key, b.zone.key);
  });
  for (const allocation of prioritized) {
    allocation.allocated = Math.min(allocation.demand, Math.max(0, remaining));
    remaining -= allocation.allocated;
  }
  const records: Record<string, SurfaceCareRecordV1> = {};
  for (const allocation of allocations) {
    const previous = existing.records[allocation.zone.key] ?? initialRecord(allocation.zone);
    records[allocation.zone.key] = advanceRecord({
      allocation,
      previous,
      weather: input.weather,
      climate: input.climate,
      pressure,
      waterPolicy: input.waterPolicy,
      turfPriority: input.turfPriority,
      drainageLevel: input.drainageLevel,
      absoluteDay: input.absoluteDay,
    });
  }
  const surfaceCare: SurfaceCareStateV1 = {
    version: SURFACE_CARE_STATE_VERSION,
    cellSize: SURFACE_CARE_CELL_SIZE,
    lastAdvancedAbsoluteDay: input.absoluteDay,
    records,
  };
  const course = { ...input.course, surfaceCare };
  const summary = surfaceCareConditionSummary(course);
  const evidence = observedSurfaceCareEvidence(course);
  return {
    course,
    report: {
      absoluteDay: input.absoluteDay,
      zones: summary.zones,
      totalDemand: round4(allocations.reduce((sum, allocation) => sum + allocation.demand, 0)),
      totalAllocated: round4(allocations.reduce((sum, allocation) => sum + allocation.allocated, 0)),
      totalIrrigationDemand: round4(
        evidence.reduce((sum, item) => sum + item.irrigationDemand, 0),
      ),
      totalIrrigationApplied: round4(
        evidence.reduce((sum, item) => sum + item.irrigationApplied, 0),
      ),
      elevatedWaterDemand: round4(
        evidence.reduce((sum, item) => sum + item.elevatedWaterDemand, 0),
      ),
      elevatedWaterApplied: round4(
        evidence.reduce((sum, item) => sum + item.elevatedWaterApplied, 0),
      ),
      budgetCapacity: round4(budgetCapacity),
      laborCapacity: round4(labor.laborCapacity),
      groundskeepers: labor.groundskeepers,
      overallCondition: summary.overallCondition,
      tournamentReadiness: summary.tournamentReadiness,
      repairRequiredZones: summary.repairRequiredZones,
      evidence,
    },
  };
}

export function quoteSurfaceRepair(
  course: Course,
  world: World,
  key: string,
  kind: SurfaceRepairKind,
): SurfaceRepairQuote | null {
  const zone = surfaceCareTopology(course).zonesByKey.get(key);
  if (!zone) return null;
  const adjustedConstruction = TERRAIN_BUILD_COST[zone.intendedTerrain]
    * themeBuildMult(course.theme, zone.intendedTerrain)
    * terrainCostMult(world.difficulty)
    * zone.cells.length;
  const rate = kind === "reseed" ? 0.35 as const : 0.6 as const;
  const timingHash = hashText(`${key}:${kind}`);
  const requiredDays = kind === "reseed"
    ? 14 + timingHash % 15
    : 5 + timingHash % 6;
  return {
    key,
    kind,
    adjustedConstruction: round4(adjustedConstruction),
    rate,
    cost: Math.round(adjustedConstruction * rate),
    requiredDays,
  };
}

export function startSurfaceRepair(
  course: Course,
  world: World,
  key: string,
  kind: SurfaceRepairKind,
  absoluteDay: number,
): StartSurfaceRepairResult {
  const state = normalizeSurfaceCareState(course.surfaceCare, course);
  const record = state?.records[key];
  const quote = quoteSurfaceRepair(course, world, key, kind);
  if (!record || !quote) {
    return { ok: false, course, world, reason: "Unknown cultivated care zone." };
  }
  if (!record.repairRequired) {
    return { ok: false, course, world, reason: "This zone can still recover through routine care.", quote };
  }
  if (record.repair) {
    return { ok: false, course, world, reason: "A repair task is already active.", quote };
  }
  if (world.cash < quote.cost) {
    return { ok: false, course, world, reason: "Insufficient cash for this repair.", quote };
  }
  const repair: SurfaceRepairTaskV1 = {
    kind,
    cost: quote.cost,
    requiredDays: quote.requiredDays,
    progressDays: 0,
    startedAbsoluteDay: Math.max(0, Math.floor(absoluteDay)),
    elevatedWaterDaysRemaining: kind === "resod" ? Math.min(10, quote.requiredDays) : 0,
  };
  return {
    ok: true,
    course: {
      ...course,
      surfaceCare: {
        ...state,
        records: {
          ...state.records,
          [key]: {
            ...record,
            repair,
            repairProgress: 0,
            // Generic care allocation can predate the purchase. A worker is
            // not observable until a later authoritative repair-day advance.
            lastRepairProgressed: false,
            lastRepairServiceRatio: 0,
          },
        },
      },
    },
    world: {
      ...world,
      cash: world.cash - quote.cost,
    },
    quote,
  };
}
