import type { SurfacePoint, Terrain } from "../models/types";
import { sampleVisualHeight, type VisualHeightfield } from "./landscapeGeometry";

export interface LandformPresentationPlan {
  /** Sparse tile-boundary runs; no raster halo or closed contour ring. */
  readonly shoulders: readonly LandformShoulder[];
}

export interface LandformShoulderPoint {
  /** Exact authored level boundary shared by the two slope cues. */
  boundary: SurfacePoint;
  /** World-space sample on the upper plateau, away from the boundary. */
  upper: SurfacePoint;
  /** World-space sample on the lower plateau, away from the boundary. */
  lower: SurfacePoint;
  upperHeight: number;
  lowerHeight: number;
}

export interface LandformShoulder {
  level: number;
  /** Tile-snapped runs are intentionally open and never form full rings. */
  closed: false;
  points: readonly [LandformShoulderPoint, LandformShoulderPoint];
  worldLength: number;
  minimumRise: number;
  maximumRise: number;
}

interface BoundaryEdge {
  axis: "h" | "v";
  coordinate: number;
  start: number;
  nx: number;
  ny: number;
  low: number;
  high: number;
}

const isRecessed = (terrain: Terrain) => (
  terrain === "water" || terrain === "wetland" || terrain === "sand"
);

/**
 * Derives one owner per actual multi-tile elevation boundary, then merges
 * adjacent collinear edges into sparse tile-snapped runs. Unlike interpolated
 * isocontours, these runs cannot produce halos, rounded rings, or parallel
 * faces between the same two authored levels.
 */
export function buildLandformShoulders(
  field: VisualHeightfield,
  tiles: readonly Terrain[],
  elevations: readonly number[],
  _density = 2,
): LandformShoulder[] {
  const edges: BoundaryEdge[] = [];
  const add = (
    x: number,
    y: number,
    nextX: number,
    nextY: number,
    axis: "h" | "v",
  ) => {
    const index = y * field.width + x;
    const nextIndex = nextY * field.width + nextX;
    if (isRecessed(tiles[index]) || isRecessed(tiles[nextIndex])) return;
    const current = elevations[index] ?? 0;
    const next = elevations[nextIndex] ?? 0;
    if (Math.abs(current - next) < 0.45) return;
    const currentHigh = current > next;
    edges.push({
      axis,
      coordinate: axis === "v" ? nextX : nextY,
      start: axis === "v" ? y : x,
      nx: axis === "v" ? (currentHigh ? -1 : 1) : 0,
      ny: axis === "h" ? (currentHigh ? -1 : 1) : 0,
      low: Math.min(current, next),
      high: Math.max(current, next),
    });
  };
  for (let y = 0; y < field.height; y++) for (let x = 0; x < field.width; x++) {
    if (x + 1 < field.width) add(x, y, x + 1, y, "v");
    if (y + 1 < field.height) add(x, y, x, y + 1, "h");
  }

  const groups = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const key = [edge.axis, edge.coordinate, edge.nx, edge.ny, edge.low, edge.high].join(":");
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }

  const runs: LandformShoulder[] = [];
  // A broad top-surface run communicates the direction of grade without
  // painting a vertical cliff wall. Both samples stay in world space, so the
  // cue remains continuous and rotates with the authored landform.
  const inset = 0.68;
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    group.sort((a, b) => a.start - b.start);
    for (let first = 0; first < group.length;) {
      let last = first;
      while (last + 1 < group.length && group[last + 1].start === group[last].start + 1) last++;
      const edge = group[first];
      const start = edge.start;
      const end = group[last].start + 1;
      const boundary = (at: number): SurfacePoint => edge.axis === "v"
        ? { x: edge.coordinate, y: at }
        : { x: at, y: edge.coordinate };
      const point = (at: number): LandformShoulderPoint => {
        const base = boundary(at);
        return {
          boundary: base,
          upper: { x: base.x + edge.nx * inset, y: base.y + edge.ny * inset },
          lower: { x: base.x - edge.nx * inset, y: base.y - edge.ny * inset },
          upperHeight: edge.high,
          lowerHeight: edge.low,
        };
      };
      runs.push({
        level: (edge.low + edge.high) / 2,
        closed: false,
        points: [point(start), point(end)],
        worldLength: end - start,
        minimumRise: edge.high - edge.low,
        maximumRise: edge.high - edge.low,
      });
      first = last + 1;
    }
  }
  return runs.sort((a, b) => a.level - b.level || b.worldLength - a.worldLength);
}

export function buildLandformPresentationPlan(
  field: VisualHeightfield,
  tiles: readonly Terrain[],
  elevations: readonly number[],
  _theme: "parkland" | "links" | "desert" | undefined,
  density = 2,
): LandformPresentationPlan {
  return Object.freeze({
    shoulders: Object.freeze(buildLandformShoulders(field, tiles, elevations, density)),
  });
}

export interface LandformSurfaceCue {
  readonly level: number;
  readonly points: readonly (SurfacePoint & { height: number })[];
}

/** Open crest polylines, not vertical faces. Sampling each half tile keeps
 * the feathered renderer strokes attached to the field across every bearing.
 * Paths and hazards retain their own owners. A reversed view still sees the
 * top-surface crest, not a manufactured backface.
 */
export function buildLandformSurfaceCues(
  shoulders: readonly LandformShoulder[],
  field: VisualHeightfield,
  tiles: readonly Terrain[],
): LandformSurfaceCue[] {
  const cues: LandformSurfaceCue[] = [];
  for (const shoulder of shoulders) {
    if (shoulder.worldLength < 2) continue;
    const [a, b] = shoulder.points;
    const length = Math.hypot(a.upper.x - a.lower.x, a.upper.y - a.lower.y);
    const nx = (a.upper.x - a.lower.x) / length;
    const ny = (a.upper.y - a.lower.y) / length;
    const steps = Math.ceil(shoulder.worldLength * 2);
    let points: Array<SurfacePoint & { height: number }> = [];
    const flush = () => {
      if (points.length > 1) cues.push({ level: shoulder.level, points });
      points = [];
    };
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = a.boundary.x + (b.boundary.x - a.boundary.x) * t + nx * .48;
      const y = a.boundary.y + (b.boundary.y - a.boundary.y) * t + ny * .48;
      const terrain = tiles[Math.min(field.height - 1, Math.floor(y)) * field.width + Math.min(field.width - 1, Math.floor(x))];
      if (isRecessed(terrain) || terrain === "path") flush();
      else points.push({ x, y, height: sampleVisualHeight(field, x, y) });
    }
    flush();
  }
  return cues;
}
