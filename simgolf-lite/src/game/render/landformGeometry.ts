import type { SurfacePoint, Terrain } from "../models/types";
import type { VisualHeightfield } from "./landscapeGeometry";

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
