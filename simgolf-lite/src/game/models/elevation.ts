import type { Course } from "./types";

/**
 * Per-tile elevation model (ZKU-143).
 *
 * Elevation is stored as integer steps on `Course.elevations`
 * (length = width × height, row-major, same indexing as `tiles`).
 * 0 is base level; ELEVATION_MAX caps sculpting. One step renders as
 * ELEVATION_STEP_PX of vertical offset (src/game/render/iso.ts) and plays
 * as ~2–3 yards of effective shot distance (ZKU-146, balanceConfig).
 */

export const ELEVATION_MIN = 0;
export const ELEVATION_MAX = 15;

/** Flat baseline (used by defaults and save migration). */
export function makeFlatElevations(width: number, height: number): number[] {
  return new Array<number>(width * height).fill(0);
}

export function clampElevation(value: number): number {
  return Math.max(ELEVATION_MIN, Math.min(ELEVATION_MAX, Math.round(value)));
}

/**
 * Elevation at a tile; out-of-bounds and pre-elevation courses read as base
 * level so callers never need to special-case old data.
 */
export function getElevation(course: Course, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height) return 0;
  return course.elevations?.[y * course.width + x] ?? 0;
}

/** Signed elevation delta going from tile a to tile b. */
export function slopeBetween(
  course: Course,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  return getElevation(course, bx, by) - getElevation(course, ax, ay);
}

/**
 * Largest absolute elevation difference between any two tiles in a rect
 * (inclusive). Used to validate tee/green/building footprints (flat ≤ 1).
 */
export function maxSlopeInRect(
  course: Course,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const e = getElevation(course, x, y);
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
  }
  return hi === -Infinity ? 0 : hi - lo;
}

/**
 * Ensure a course has an elevations array of the right length (fills zeros;
 * truncates/pads on grid-size mismatch). Non-mutating.
 */
export function withNormalizedElevations(course: Course): Course {
  const expected = course.width * course.height;
  const src = course.elevations;
  if (src && src.length === expected) return course;
  const next = makeFlatElevations(course.width, course.height);
  if (src) {
    for (let i = 0; i < Math.min(src.length, expected); i++) {
      next[i] = clampElevation(src[i]);
    }
  }
  return { ...course, elevations: next };
}
