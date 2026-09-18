import { computeElevationChangeCost } from "./terrainEconomics";
import { clampElevation, getElevation } from "./elevation";
import { BUILDING_SPECS } from "./buildings";
import type { Building, Course, Point } from "./types";

/**
 * A presentation-agnostic earthwork proposal for a building site.
 *
 * This module is deliberately a planner. It never writes a Course, so merely
 * inspecting a proposed building site cannot alter terrain, saves, or hashes.
 * A placement owner must explicitly consume `mutations` if it wants to commit
 * the grade.
 */
export const BUILDING_SITE_GRADE_VERSION = 1 as const;

export type BuildingSiteGradeCellRole = "footprint" | "transition";
export type BuildingSiteGradeEdgeDirection = "north" | "east" | "south" | "west";

export interface BuildingSiteGradeCell extends Point {
  readonly index: number;
  readonly role: BuildingSiteGradeCellRole;
  readonly before: number;
  readonly after: number;
  /** Positive values fill; negative values cut. */
  readonly delta: number;
}

/** One changed elevation cell. Kept separate from complete coverage for atomic consumers. */
export type BuildingSiteGradeMutation = BuildingSiteGradeCell;

/**
 * A perimeter edge between the planned grade and untouched terrain (or the
 * edge of the estate). ZK-774 can use this geometry to choose plinths,
 * retaining walls, or an unadorned shoulder without owning the earthwork math.
 */
export interface BuildingSiteGradeExposedEdge {
  readonly cell: Point;
  readonly role: BuildingSiteGradeCellRole;
  readonly direction: BuildingSiteGradeEdgeDirection;
  readonly neighbor: Point | null;
  readonly neighborElevation: number | null;
  /** Planned cell elevation minus the untouched neighbor elevation. */
  readonly delta: number;
  readonly magnitude: number;
}

export interface BuildingSiteGradeCostBaseline {
  readonly currency: "USD";
  readonly fillSteps: number;
  readonly cutSteps: number;
  readonly totalSteps: number;
  readonly unitCost: number;
  readonly total: number;
}

export interface BuildingSiteGradePlan {
  readonly version: typeof BUILDING_SITE_GRADE_VERSION;
  readonly building: Pick<Building, "type" | "x" | "y">;
  /** The deterministic upper median of the original footprint elevations. */
  readonly supportElevation: number;
  /** Every in-bounds building cell, in row-major order, including unchanged cells. */
  readonly footprint: readonly BuildingSiteGradeCell[];
  /** Every in-bounds cell in the one-cell Chebyshev ring, in row-major order. */
  readonly transitionRing: readonly BuildingSiteGradeCell[];
  /** Only cells whose elevation would change if an explicit owner commits this plan. */
  readonly mutations: readonly BuildingSiteGradeMutation[];
  /** Largest absolute earthwork delta on any planned cell. */
  readonly maximumDelta: number;
  /** Largest difference from the selected support elevation on the original footprint. */
  readonly maximumSupportDelta: number;
  /** Largest remaining drop/rise from the planned perimeter to untouched terrain. */
  readonly maximumExposedEdgeDelta: number;
  readonly exposedEdges: readonly BuildingSiteGradeExposedEdge[];
  readonly costBaseline: BuildingSiteGradeCostBaseline;
}

export interface BuildingSiteGradeOptions {
  /** Matches the run-level terrain/elevation economy multiplier. */
  readonly costMult?: number;
}

const CARDINAL_DIRECTIONS: ReadonlyArray<{
  direction: BuildingSiteGradeEdgeDirection;
  x: number;
  y: number;
}> = [
  { direction: "north", x: 0, y: -1 },
  { direction: "east", x: 1, y: 0 },
  { direction: "south", x: 0, y: 1 },
  { direction: "west", x: -1, y: 0 },
];

function inBounds(course: Pick<Course, "width" | "height">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < course.width && y < course.height;
}

function safeElevation(course: Course, x: number, y: number): number {
  const elevation = getElevation(course, x, y);
  return Number.isFinite(elevation) ? clampElevation(elevation) : 0;
}

function upperMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function transitionElevation(supportElevation: number, originalElevation: number): number {
  // Keep the shoulder within one elevation step of the level pad. This creates
  // a genuine one-cell transition while retaining already-compatible terrain.
  return Math.max(supportElevation - 1, Math.min(supportElevation + 1, originalElevation));
}

/**
 * Deterministically derive the complete grade proposal for an in-bounds
 * building footprint. It is intentionally pure; callers opt into application
 * by copying the returned mutations during an explicit placement transaction.
 */
export function planBuildingSiteGrade(
  course: Course,
  building: Pick<Building, "type" | "x" | "y">,
  options: BuildingSiteGradeOptions = {},
): BuildingSiteGradePlan {
  const spec = BUILDING_SPECS[building.type];
  const footprintCoordinates: Point[] = [];
  for (let y = building.y; y < building.y + spec.d; y++) {
    for (let x = building.x; x < building.x + spec.w; x++) {
      if (!inBounds(course, x, y)) {
        throw new RangeError("Building site-grade footprint must be fully in bounds");
      }
      footprintCoordinates.push({ x, y });
    }
  }

  const supportElevation = upperMedian(footprintCoordinates.map(({ x, y }) => safeElevation(course, x, y)));
  const footprintIndices = new Set(footprintCoordinates.map(({ x, y }) => y * course.width + x));
  const transitionCoordinates: Point[] = [];
  for (let y = building.y - 1; y <= building.y + spec.d; y++) {
    for (let x = building.x - 1; x <= building.x + spec.w; x++) {
      if (!inBounds(course, x, y) || footprintIndices.has(y * course.width + x)) continue;
      transitionCoordinates.push({ x, y });
    }
  }

  const footprint = footprintCoordinates.map(({ x, y }): BuildingSiteGradeCell => {
    const before = safeElevation(course, x, y);
    return { x, y, index: y * course.width + x, role: "footprint", before, after: supportElevation, delta: supportElevation - before };
  });
  const transitionRing = transitionCoordinates.map(({ x, y }): BuildingSiteGradeCell => {
    const before = safeElevation(course, x, y);
    const after = transitionElevation(supportElevation, before);
    return { x, y, index: y * course.width + x, role: "transition", before, after, delta: after - before };
  });
  const cells = [...footprint, ...transitionRing].sort((a, b) => a.index - b.index);
  const plannedByIndex = new Map(cells.map((cell) => [cell.index, cell]));
  const mutations = cells.filter((cell) => cell.delta !== 0);

  let fillSteps = 0;
  let cutSteps = 0;
  let maximumDelta = 0;
  for (const cell of mutations) {
    if (cell.delta > 0) fillSteps += cell.delta;
    else cutSteps += -cell.delta;
    maximumDelta = Math.max(maximumDelta, Math.abs(cell.delta));
  }

  const exposedEdges: BuildingSiteGradeExposedEdge[] = [];
  for (const cell of cells) {
    for (const side of CARDINAL_DIRECTIONS) {
      const x = cell.x + side.x;
      const y = cell.y + side.y;
      if (inBounds(course, x, y) && plannedByIndex.has(y * course.width + x)) continue;
      const neighborElevation = inBounds(course, x, y) ? safeElevation(course, x, y) : null;
      const delta = neighborElevation === null ? 0 : cell.after - neighborElevation;
      exposedEdges.push({
        cell: { x: cell.x, y: cell.y },
        role: cell.role,
        direction: side.direction,
        neighbor: neighborElevation === null ? null : { x, y },
        neighborElevation,
        delta,
        magnitude: Math.abs(delta),
      });
    }
  }

  const totalSteps = fillSteps + cutSteps;
  const unitCost = computeElevationChangeCost(1, options.costMult ?? 1, course.theme).net;
  return {
    version: BUILDING_SITE_GRADE_VERSION,
    building: { type: building.type, x: building.x, y: building.y },
    supportElevation,
    footprint,
    transitionRing,
    mutations,
    maximumDelta,
    maximumSupportDelta: Math.max(...footprint.map((cell) => Math.abs(cell.before - supportElevation)), 0),
    maximumExposedEdgeDelta: Math.max(...exposedEdges.map((edge) => edge.magnitude), 0),
    exposedEdges,
    costBaseline: {
      currency: "USD",
      fillSteps,
      cutSteps,
      totalSteps,
      unitCost,
      total: computeElevationChangeCost(totalSteps, options.costMult ?? 1, course.theme).net,
    },
  };
}
