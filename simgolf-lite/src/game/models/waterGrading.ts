import { isOwnedTile } from "../estate/estate";
import { clampElevation, getElevation } from "./elevation";
import type { Course, Terrain } from "./types";

export interface WaterGradingDelta {
  x: number;
  y: number;
  delta: number;
}

export interface WaterGradingResult {
  deltas: WaterGradingDelta[];
  earthworkSteps: number;
}

const CARDINAL_NEIGHBORS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
] as const;

function isAutomaticallyGraded(terrain: Terrain): terrain is "water" | "wetland" {
  return terrain === "water" || terrain === "wetland";
}

/**
 * Collects the complete owned water/wetland components reached by a terrain
 * edit. This is shared by grading and obstacle clearing so both operations
 * have exactly the same bounded scope.
 */
export function collectTouchedWaterCells(
  course: Course,
  finalTiles: readonly Terrain[],
  touchedIndices: Iterable<number>,
): number[] {
  const expected = course.width * course.height;
  if (finalTiles.length !== expected) return [];
  const touched = [...new Set(touchedIndices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < expected)
    .sort((a, b) => a - b);
  const collected = new Set<number>();

  for (const start of touched) {
    if (collected.has(start)) continue;
    const terrain = finalTiles[start];
    if (!isAutomaticallyGraded(terrain)) continue;
    const startX = start % course.width;
    const startY = Math.floor(start / course.width);
    if (!isOwnedTile(course, startX, startY)) continue;

    const queued = new Set<number>([start]);
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      collected.add(index);
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      for (const neighbor of CARDINAL_NEIGHBORS) {
        const nx = x + neighbor.x;
        const ny = y + neighbor.y;
        if (nx < 0 || ny < 0 || nx >= course.width || ny >= course.height) continue;
        const neighborIndex = ny * course.width + nx;
        if (
          queued.has(neighborIndex)
          || finalTiles[neighborIndex] !== terrain
          || !isOwnedTile(course, nx, ny)
        ) continue;
        queued.add(neighborIndex);
        queue.push(neighborIndex);
      }
    }
  }

  return [...collected].sort((a, b) => a - b);
}

/**
 * Returns the authoritative earthwork needed by newly painted water surfaces.
 *
 * Water is a level basin one elevation step below its lowest land edge when
 * the elevation range permits it. Wetland is also level, but keeps a shallower
 * floor at the lowest edge elevation. A grade never raises ground, and it
 * never changes unowned cells. Touching an existing connected hazard grades
 * that complete owned component so a lake cannot retain hills away from the
 * brush stroke.
 */
export function computeWaterGrading(
  course: Course,
  finalTiles: readonly Terrain[],
  touchedIndices: Iterable<number>,
): WaterGradingResult {
  const expected = course.width * course.height;
  if (finalTiles.length !== expected) return { deltas: [], earthworkSteps: 0 };

  const touched = [...new Set(touchedIndices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < expected)
    .sort((a, b) => a - b);
  const processed = new Set<number>();
  const deltas: WaterGradingDelta[] = [];
  let earthworkSteps = 0;

  for (const start of touched) {
    if (processed.has(start)) continue;
    const terrain = finalTiles[start];
    if (!isAutomaticallyGraded(terrain)) continue;

    const startX = start % course.width;
    const startY = Math.floor(start / course.width);
    if (!isOwnedTile(course, startX, startY)) continue;

    const component: number[] = [];
    const queued = new Set<number>([start]);
    const queue = [start];
    let boundaryMinimum = Number.POSITIVE_INFINITY;
    let componentMinimum = Number.POSITIVE_INFINITY;

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      processed.add(index);
      component.push(index);
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      componentMinimum = Math.min(componentMinimum, getElevation(course, x, y));

      for (const neighbor of CARDINAL_NEIGHBORS) {
        const nx = x + neighbor.x;
        const ny = y + neighbor.y;
        if (nx < 0 || ny < 0 || nx >= course.width || ny >= course.height) continue;
        const neighborIndex = ny * course.width + nx;
        if (
          finalTiles[neighborIndex] === terrain
          && isOwnedTile(course, nx, ny)
        ) {
          if (!queued.has(neighborIndex)) {
            queued.add(neighborIndex);
            queue.push(neighborIndex);
          }
          continue;
        }
        boundaryMinimum = Math.min(boundaryMinimum, getElevation(course, nx, ny));
      }
    }

    if (component.length === 0 || !Number.isFinite(componentMinimum)) continue;
    const edgeTarget = Number.isFinite(boundaryMinimum)
      ? boundaryMinimum - (terrain === "water" ? 1 : 0)
      : componentMinimum;
    // Ground is never raised by automatic grading. This also preserves a
    // deliberately deeper hand-sculpted basin when water is repainted.
    const target = clampElevation(Math.min(componentMinimum, edgeTarget));

    for (const index of component) {
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      const current = getElevation(course, x, y);
      const delta = target - current;
      if (delta === 0) continue;
      deltas.push({ x, y, delta });
      earthworkSteps += Math.abs(delta);
    }
  }

  deltas.sort((a, b) => (a.y * course.width + a.x) - (b.y * course.width + b.x));
  return { deltas, earthworkSteps };
}

export function applyWaterGrading(
  course: Course,
  grading: WaterGradingResult,
): number[] {
  const expected = course.width * course.height;
  const elevations = course.elevations?.length === expected
    ? course.elevations.slice()
    : Array.from({ length: expected }, (_, index) => {
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      return getElevation(course, x, y);
    });
  for (const { x, y, delta } of grading.deltas) {
    const index = y * course.width + x;
    elevations[index] = clampElevation((elevations[index] ?? 0) + delta);
  }
  return elevations;
}
