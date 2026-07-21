import type {
  Building,
  BuildingTier,
  BuildingType,
  ConcessionType,
  Course,
  Point,
  LandTheme,
} from "./types";
import { maxSlopeInRect } from "./elevation";

/**
 * Building registry + placement rules (ZKU-152).
 *
 * This is the renderer-facing API that M4's concessions (ZKU-117) extend:
 * adding a new building type is one spec entry + one atlas frame — no
 * renderer changes.
 */

export interface BuildingSpec {
  type: BuildingType;
  name: string;
  /** Footprint in tiles (width along world x, depth along world y). */
  w: number;
  d: number;
  /** Atlas frame name (see src/render/atlas.ts). */
  frame: string;
  buildCost: number;
  defaultPrice?: number;
  item?: string;
  serviceMinutes?: number;
  capacity?: number;
}

export type BuildingVisualFrame = `${LandTheme}_${BuildingType}_t${BuildingTier}`;

/** Theme/tier visual selection is data-driven and always has a parkland T1 fallback. */
export function buildingVisualFrame(building: Building, theme: LandTheme = "parkland"): BuildingVisualFrame {
  const tier: BuildingTier = building.type === "clubhouse" ? 1 : (building.tier ?? 1);
  return `${theme}_${building.type}_t${tier}`;
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  clubhouse: {
    type: "clubhouse", name: "Clubhouse", w: 3, d: 3, frame: "clubhouse", buildCost: 0,
  },
  pro_shop: {
    type: "pro_shop", name: "Pro Shop", w: 2, d: 2, frame: "pro_shop",
    buildCost: 8_000, defaultPrice: 28, item: "Golf merchandise", serviceMinutes: 6, capacity: 3,
  },
  snack_bar: {
    type: "snack_bar", name: "Snack Bar", w: 2, d: 2, frame: "snack_bar",
    buildCost: 4_500, defaultPrice: 9, item: "Food & drink", serviceMinutes: 4, capacity: 4,
  },
  cart_rental: {
    type: "cart_rental", name: "Cart Rental", w: 2, d: 2, frame: "cart_rental",
    buildCost: 6_500, defaultPrice: 18, item: "Cart rental", serviceMinutes: 5, capacity: 5,
  },
};

export const CONCESSION_TYPES: readonly ConcessionType[] = [
  "pro_shop", "snack_bar", "cart_rental",
] as const;

export function isConcessionType(type: BuildingType): type is ConcessionType {
  return type !== "clubhouse";
}

export function isConcession(building: Building): building is Building & { type: ConcessionType } {
  return isConcessionType(building.type);
}

export function normalizedBuilding(building: Building): Building {
  if (!isConcession(building)) return building;
  const spec = BUILDING_SPECS[building.type];
  const tier = ([1, 2, 3] as BuildingTier[]).includes(building.tier as BuildingTier)
    ? building.tier as BuildingTier
    : 1;
  const price = Number.isFinite(building.price)
    ? Math.max(1, Math.round(building.price as number))
    : spec.defaultPrice!;
  return { ...building, tier, price };
}

export function buildingSpec(b: Building): BuildingSpec {
  return BUILDING_SPECS[b.type];
}

/** Tiles covered by a building (for pathfinding and overlap checks). */
export function buildingTiles(b: Building): Array<{ x: number; y: number }> {
  const spec = buildingSpec(b);
  const out: Array<{ x: number; y: number }> = [];
  for (let y = b.y; y < b.y + spec.d; y++) {
    for (let x = b.x; x < b.x + spec.w; x++) out.push({ x, y });
  }
  return out;
}

export function buildingAtTile(course: Course, x: number, y: number): Building | undefined {
  return (course.buildings ?? []).find((building) => {
    const spec = buildingSpec(building);
    return x >= building.x && x < building.x + spec.w && y >= building.y && y < building.y + spec.d;
  });
}

/** Door/queue tile: nearest passable tile immediately in front of a structure. */
export function buildingEntrance(course: Course, building: Building): Point {
  const spec = buildingSpec(building);
  const candidates: Point[] = [
    { x: building.x + Math.floor(spec.w / 2), y: building.y + spec.d },
    { x: building.x + spec.w, y: building.y + Math.floor(spec.d / 2) },
    { x: building.x - 1, y: building.y + Math.floor(spec.d / 2) },
    { x: building.x + Math.floor(spec.w / 2), y: building.y - 1 },
  ];
  return candidates.find((p) => {
    if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return false;
    return course.tiles[p.y * course.width + p.x] !== "water" && !buildingAtTile(course, p.x, p.y);
  }) ?? { x: building.x, y: building.y };
}

/** Fast lookup set of all building-covered tile indices for a course. */
export function buildingFootprintSet(course: Course): Set<number> {
  const set = new Set<number>();
  for (const b of course.buildings ?? []) {
    for (const t of buildingTiles(b)) {
      if (t.x >= 0 && t.y >= 0 && t.x < course.width && t.y < course.height) {
        set.add(t.y * course.width + t.x);
      }
    }
  }
  return set;
}

/**
 * Placement validation: in bounds, near-flat footprint (max 1 elevation
 * step, matching tee/green sites — the Level sculpt brush prepares pads),
 * no water, no tee/green markers, no obstacles, no building overlap.
 */
export function canPlaceBuilding(
  course: Course,
  type: BuildingType,
  x: number,
  y: number
): { ok: boolean; reason?: string } {
  const spec = BUILDING_SPECS[type];
  if (x < 0 || y < 0 || x + spec.w > course.width || y + spec.d > course.height) {
    return { ok: false, reason: "out of bounds" };
  }
  if (maxSlopeInRect(course, x, y, x + spec.w - 1, y + spec.d - 1) > 1) {
    return { ok: false, reason: "site too steep" };
  }
  const occupied = buildingFootprintSet(course);
  for (let ty = y; ty < y + spec.d; ty++) {
    for (let tx = x; tx < x + spec.w; tx++) {
      const idx = ty * course.width + tx;
      if (course.tiles[idx] === "water") return { ok: false, reason: "on water" };
      if (occupied.has(idx)) return { ok: false, reason: "overlaps a building" };
    }
  }
  for (const hole of course.holes) {
    for (const marker of [hole.tee, hole.green]) {
      if (!marker) continue;
      if (marker.x >= x && marker.x < x + spec.w && marker.y >= y && marker.y < y + spec.d) {
        return { ok: false, reason: "covers a tee or green" };
      }
    }
  }
  for (const obs of course.obstacles ?? []) {
    if (obs.x >= x && obs.x < x + spec.w && obs.y >= y && obs.y < y + spec.d) {
      return { ok: false, reason: "blocked by an obstacle" };
    }
  }
  return { ok: true };
}

/**
 * Find a spot for the starter clubhouse on fresh land: spiral out from the
 * course center until placement validates. Deterministic (no randomness).
 */
export function findClubhouseSpot(course: Course): { x: number; y: number } | null {
  const spec = BUILDING_SPECS.clubhouse;
  const cx = Math.floor(course.width / 2 - spec.w / 2);
  const cy = Math.floor(course.height / 2 - spec.d / 2);
  for (let r = 0; r < Math.max(course.width, course.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const x = cx + dx;
        const y = cy + dy;
        if (canPlaceBuilding(course, "clubhouse", x, y).ok) return { x, y };
      }
    }
  }
  return null;
}
