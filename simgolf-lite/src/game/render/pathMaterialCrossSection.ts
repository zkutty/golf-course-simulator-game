import type { Point, Terrain } from "../models/types";
import type { LandscapeComponent } from "./landscapeGeometry";
import { buildLandscapeBoundaryRuns } from "./landscapeEdges";
import { terrainBoundaryFor } from "./terrainMaterials";

export type PathMaterialZoneRole = "shoulder" | "edge" | "core";

export interface PathMaterialStrip {
  readonly role: Exclude<PathMaterialZoneRole, "core">;
  readonly outsideTerrain: Terrain;
  /** Ordered world-space boundary nearest the outside terrain. */
  readonly outer: readonly Point[];
  /** Ordered world-space boundary nearest the path core. */
  readonly inner: readonly Point[];
}
export interface PathMaterialCrossSection {
  readonly componentKey: string;
  readonly componentCells: readonly number[];
  readonly shoulderWidth: number;
  readonly edgeWidth: number;
  readonly strips: readonly PathMaterialStrip[];
  readonly ownedOutsideTerrains: readonly Terrain[];
}

export interface PathMaterialCrossSectionOptions {
  /** World-tile width outside the authoritative path. */
  shoulderWidth?: number;
  /** World-tile width inside the authoritative path. */
  edgeWidth?: number;
}

const DEFAULT_SHOULDER_WIDTH = 0.24;
const DEFAULT_EDGE_WIDTH = 0.22;
const EPSILON = 1e-7;

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function normalForSegment(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(EPSILON, Math.hypot(dx, dy));
  // Landscape rings keep their filled component on the left in y-down world
  // coordinates. This normal therefore points into the authoritative path.
  return { x: -dy / length, y: dx / length };
}

/**
 * Produces a bevel-safe signed offset without route or centerline inference.
 * The miter is capped to 1.45× the requested width, preventing acute elbows
 * from growing fins while preserving a continuous join at ordinary turns.
 */
function offsetRun(points: readonly Point[], signedDistance: number): Point[] {
  if (points.length < 2) return [];
  const closed = points.length > 2 && samePoint(points[0], points[points.length - 1]);
  const source = closed ? points.slice(0, -1) : [...points];
  const result = source.map((point, index) => {
    const previousIndex = closed ? (index - 1 + source.length) % source.length : Math.max(0, index - 1);
    const nextIndex = closed ? (index + 1) % source.length : Math.min(source.length - 1, index + 1);
    const previousNormal = normalForSegment(source[previousIndex], point);
    const nextNormal = normalForSegment(point, source[nextIndex]);
    const atStart = !closed && index === 0;
    const atEnd = !closed && index === source.length - 1;
    const baseNormal = atStart ? nextNormal : atEnd ? previousNormal : {
      x: previousNormal.x + nextNormal.x,
      y: previousNormal.y + nextNormal.y,
    };
    const baseLength = Math.max(EPSILON, Math.hypot(baseNormal.x, baseNormal.y));
    const direction = { x: baseNormal.x / baseLength, y: baseNormal.y / baseLength };
    const reference = atStart ? nextNormal : previousNormal;
    const projection = Math.max(0.42, direction.x * reference.x + direction.y * reference.y);
    const requested = signedDistance / projection;
    const limit = Math.abs(signedDistance) * 1.45;
    const distance = Math.max(-limit, Math.min(limit, requested));
    return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
  });
  if (closed && result.length > 0) result.push({ ...result[0] });
  return result;
}

export function pathOwnsBoundaryWith(outsideTerrain: Terrain | null): outsideTerrain is Terrain {
  return outsideTerrain != null && terrainBoundaryFor("path", outsideTerrain)?.owner === "path";
}

/**
 * Builds the two presentation-only material strips around one authoritative
 * connected path component. Core ownership remains the existing component
 * mesh; no tile, save, picking, pathfinding, or simulation data is changed.
 */
export function buildPathMaterialCrossSection(
  component: LandscapeComponent,
  tiles: readonly Terrain[],
  width: number,
  height: number,
  options: PathMaterialCrossSectionOptions = {},
): PathMaterialCrossSection | null {
  if (component.terrain !== "path") return null;
  const shoulderWidth = Math.max(0.08, Math.min(0.32, options.shoulderWidth ?? DEFAULT_SHOULDER_WIDTH));
  const edgeWidth = Math.max(0.08, Math.min(0.3, options.edgeWidth ?? DEFAULT_EDGE_WIDTH));
  const runs = buildLandscapeBoundaryRuns(component.rings, "path", tiles, width, height)
    .filter((run) => pathOwnsBoundaryWith(run.outsideTerrain));
  const strips: PathMaterialStrip[] = [];
  for (const run of runs) {
    const boundary = offsetRun(run.points, 0);
    const shoulderOuter = offsetRun(run.points, -shoulderWidth);
    const edgeInner = offsetRun(run.points, edgeWidth);
    if (
      boundary.length < 2 ||
      shoulderOuter.length !== boundary.length ||
      edgeInner.length !== boundary.length
    ) continue;
    strips.push({
      role: "shoulder",
      outsideTerrain: run.outsideTerrain!,
      outer: shoulderOuter,
      inner: boundary,
    });
    strips.push({
      role: "edge",
      outsideTerrain: run.outsideTerrain!,
      outer: boundary,
      inner: edgeInner,
    });
  }
  return {
    componentKey: component.topologyKey,
    componentCells: [...component.cells],
    shoulderWidth,
    edgeWidth,
    strips,
    ownedOutsideTerrains: [...new Set(runs.map((run) => run.outsideTerrain!))].sort(),
  };
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function minimumOwnedBoundaryDistance(section: PathMaterialCrossSection, point: Point): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const strip of section.strips) {
    if (strip.role !== "edge") continue;
    for (let index = 0; index + 1 < strip.outer.length; index++) {
      distance = Math.min(distance, pointToSegmentDistance(point, strip.outer[index], strip.outer[index + 1]));
    }
  }
  return distance;
}

/**
 * Deterministic sample classifier used by geometry and browser probes. The
 * three roles are mutually exclusive and are derived only from authoritative
 * component membership plus distance to pair-owned boundary runs.
 */
export function classifyPathMaterialPoint(
  section: PathMaterialCrossSection,
  point: Point,
  tiles: readonly Terrain[],
  width: number,
  height: number,
): PathMaterialZoneRole | null {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const index = y * width + x;
  const insidePath = tiles[index] === "path" && section.componentCells.includes(index);
  const distance = minimumOwnedBoundaryDistance(section, point);
  if (insidePath) return distance <= section.edgeWidth + EPSILON ? "edge" : "core";
  const outside = tiles[index];
  return pathOwnsBoundaryWith(outside) && distance <= section.shoulderWidth + EPSILON
    ? "shoulder"
    : null;
}
