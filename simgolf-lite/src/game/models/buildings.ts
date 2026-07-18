import type { Building, BuildingType, Course } from "./types";
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
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  clubhouse: { type: "clubhouse", name: "Clubhouse", w: 3, d: 3, frame: "clubhouse" },
  proshop: { type: "proshop", name: "Pro Shop", w: 2, d: 2, frame: "proshop" },
  snackbar: { type: "snackbar", name: "Snack Bar", w: 1, d: 1, frame: "snackbar" },
  cartrental: { type: "cartrental", name: "Cart Rental", w: 2, d: 2, frame: "cartrental" },
};

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
