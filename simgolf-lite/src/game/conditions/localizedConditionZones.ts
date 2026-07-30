import type { Course, Terrain } from "../models/types";
import { TERRAIN_MAINT_WEIGHT } from "../models/terrainEconomics";

export type LocalizedConditionZoneId = "NW" | "NE" | "SW" | "SE";

export interface LocalizedConditionZone {
  readonly zoneId: LocalizedConditionZoneId;
  readonly terrain: Terrain;
  readonly tiles: number;
  readonly burden: number;
}

const zoneCache = new WeakMap<
  readonly Terrain[],
  Map<string, ReadonlyMap<LocalizedConditionZoneId, LocalizedConditionZone>>
>();

export function localizedConditionZoneId(
  width: number,
  height: number,
  x: number,
  y: number,
): LocalizedConditionZoneId {
  return `${y < Math.max(1, height / 2) ? "N" : "S"}${x < Math.max(1, width / 2) ? "W" : "E"}`;
}

/**
 * M49's localized maintenance projection, shared by reports and presentation.
 * Only four aggregates are retained; no condition data is copied onto tiles.
 */
export function localizedConditionZones(
  course: Pick<Course, "width" | "height" | "tiles">,
): ReadonlyMap<LocalizedConditionZoneId, LocalizedConditionZone> {
  const dimensions = `${course.width}x${course.height}`;
  const variants = zoneCache.get(course.tiles);
  const cached = variants?.get(dimensions);
  if (cached) return cached;

  const mutable = new Map<LocalizedConditionZoneId, { terrain: Terrain; tiles: number; burden: number }>();
  course.tiles.forEach((terrain, index) => {
    const x = index % Math.max(1, course.width);
    const y = Math.floor(index / Math.max(1, course.width));
    const zoneId = localizedConditionZoneId(course.width, course.height, x, y);
    const burden = TERRAIN_MAINT_WEIGHT[terrain] ?? 1;
    const current = mutable.get(zoneId) ?? { terrain, tiles: 0, burden: 0 };
    current.tiles++;
    current.burden += burden;
    if (burden > (TERRAIN_MAINT_WEIGHT[current.terrain] ?? 1)) current.terrain = terrain;
    mutable.set(zoneId, current);
  });

  const zones = new Map<LocalizedConditionZoneId, LocalizedConditionZone>();
  for (const [zoneId, zone] of mutable) {
    zones.set(zoneId, Object.freeze({
      zoneId,
      terrain: zone.terrain,
      tiles: zone.tiles,
      burden: Number((zone.burden / Math.max(1, zone.tiles)).toFixed(3)),
    }));
  }
  const nextVariants = variants ?? new Map();
  nextVariants.set(dimensions, zones);
  zoneCache.set(course.tiles, nextVariants);
  return zones;
}
