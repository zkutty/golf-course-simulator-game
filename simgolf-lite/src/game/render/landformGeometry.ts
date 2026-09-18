import type { SurfacePoint, Terrain } from "../models/types";
import type { VisualHeightfield } from "./landscapeGeometry";
import { sampleVisualHeight } from "./landscapeGeometry";

export interface LandformPresentationPlan {
  /** Continuous raster slope-light is the sole Parkland relief treatment. */
  readonly macroGrade: "spatially-filtered-slope-light";
  /** No Parkland shoulder bands are emitted into the final scene plan. */
  readonly shoulders: readonly LandformShoulder[];
}

export interface LandformShoulderPoint {
  upper: SurfacePoint;
  lower: SurfacePoint;
  upperHeight: number;
  lowerHeight: number;
}

export interface LandformShoulder {
  level: number;
  closed: boolean;
  points: LandformShoulderPoint[];
  worldLength: number;
  minimumRise: number;
  maximumRise: number;
}

interface Segment {
  a: SurfacePoint;
  b: SurfacePoint;
}

const QUANTUM = 1 / 4096;
const pointKey = (point: SurfacePoint) => (
  `${Math.round(point.x / QUANTUM)},${Math.round(point.y / QUANTUM)}`
);
const quantize = (value: number) => Math.round(value / QUANTUM) * QUANTUM;

function interpolate(
  a: SurfacePoint,
  aHeight: number,
  b: SurfacePoint,
  bHeight: number,
  level: number,
): SurfacePoint {
  const delta = bHeight - aHeight;
  const t = Math.abs(delta) <= 1e-9 ? 0.5 : Math.max(0, Math.min(1, (level - aHeight) / delta));
  return {
    x: quantize(a.x + (b.x - a.x) * t),
    y: quantize(a.y + (b.y - a.y) * t),
  };
}

function marchingSegments(
  field: VisualHeightfield,
  level: number,
  density: number,
): Segment[] {
  const columns = field.width * density;
  const rows = field.height * density;
  const segments: Segment[] = [];
  const sample = (x: number, y: number) => sampleVisualHeight(field, x / density, y / density);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const corners = [
      { point: { x: x / density, y: y / density }, height: sample(x, y) },
      { point: { x: (x + 1) / density, y: y / density }, height: sample(x + 1, y) },
      { point: { x: (x + 1) / density, y: (y + 1) / density }, height: sample(x + 1, y + 1) },
      { point: { x: x / density, y: (y + 1) / density }, height: sample(x, y + 1) },
    ];
    const crossings: Array<{ edge: number; point: SurfacePoint }> = [];
    for (let edge = 0; edge < 4; edge++) {
      const current = corners[edge];
      const next = corners[(edge + 1) % 4];
      if ((current.height >= level) === (next.height >= level)) continue;
      crossings.push({
        edge,
        point: interpolate(current.point, current.height, next.point, next.height, level),
      });
    }
    if (crossings.length === 2) {
      segments.push({ a: crossings[0].point, b: crossings[1].point });
    } else if (crossings.length === 4) {
      const center = corners.reduce((sum, corner) => sum + corner.height, 0) / 4;
      const byEdge = new Map(crossings.map((crossing) => [crossing.edge, crossing.point]));
      const pairs = center >= level
        ? [[0, 1], [2, 3]] as const
        : [[0, 3], [1, 2]] as const;
      for (const [first, second] of pairs) {
        segments.push({ a: byEdge.get(first)!, b: byEdge.get(second)! });
      }
    }
  }
  return segments.filter((segment) => pointKey(segment.a) !== pointKey(segment.b));
}

function stitchSegments(segments: readonly Segment[]): Array<{ points: SurfacePoint[]; closed: boolean }> {
  const endpoints = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const key = pointKey(point);
      const bucket = endpoints.get(key) ?? [];
      bucket.push(index);
      endpoints.set(key, bucket);
    }
  });
  const unused = new Set(segments.map((_, index) => index));
  const paths: Array<{ points: SurfacePoint[]; closed: boolean }> = [];
  while (unused.size > 0) {
    let seed = unused.values().next().value as number;
    for (const candidate of unused) {
      const segment = segments[candidate];
      if ((endpoints.get(pointKey(segment.a))?.length ?? 0) === 1 || (endpoints.get(pointKey(segment.b))?.length ?? 0) === 1) {
        seed = candidate;
        break;
      }
    }
    const first = segments[seed];
    const startAtA = (endpoints.get(pointKey(first.a))?.length ?? 0) === 1;
    const points = [startAtA ? first.a : first.b, startAtA ? first.b : first.a];
    unused.delete(seed);
    while (true) {
      const tail = points[points.length - 1];
      const nextIndex = (endpoints.get(pointKey(tail)) ?? []).find((index) => unused.has(index));
      if (nextIndex == null) break;
      const next = segments[nextIndex];
      points.push(pointKey(next.a) === pointKey(tail) ? next.b : next.a);
      unused.delete(nextIndex);
      if (pointKey(points[points.length - 1]) === pointKey(points[0])) break;
    }
    const closed = points.length > 3 && pointKey(points[0]) === pointKey(points[points.length - 1]);
    if (closed) points.pop();
    if (points.length >= 3) paths.push({ points, closed });
  }
  return paths;
}

function terrainAt(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  point: SurfacePoint,
): Terrain | null {
  const x = Math.max(0, Math.min(width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(point.y)));
  return tiles[y * width + x] ?? null;
}

const isRecessed = (terrain: Terrain | null) => (
  terrain === "water" || terrain === "wetland" || terrain === "sand"
);

/**
 * Converts shared-heightfield isocontours into broad, stitched render-only
 * shoulders. Each level is traced globally and each path is continuous; tile
 * edges are never emitted as render primitives. Authoritative course data is
 * read-only and does not appear in the returned geometry.
 */
export function buildLandformShoulders(
  field: VisualHeightfield,
  tiles: readonly Terrain[],
  elevations: readonly number[],
  density = 2,
): LandformShoulder[] {
  const levels = [...new Set(elevations.flatMap((elevation, index) => (
    isRecessed(tiles[index]) ? [] : [Math.round(elevation * 1000) / 1000]
  )))].sort((a, b) => a - b);
  const contourLevels = levels.slice(0, -1)
    .map((level, index) => ({ low: level, high: levels[index + 1] }))
    .filter(({ low, high }) => high - low >= 0.45)
    .map(({ low, high }) => (low + high) / 2);
  const result: LandformShoulder[] = [];
  const resolution = Math.max(1, Math.min(4, Math.round(density)));
  const derivativeRadius = 0.42;
  const halfWidth = 0.18;

  for (const level of contourLevels) {
    for (const path of stitchSegments(marchingSegments(field, level, resolution))) {
      const worldLength = path.points.reduce((sum, point, index) => {
        if (index === 0) return sum;
        return sum + Math.hypot(point.x - path.points[index - 1].x, point.y - path.points[index - 1].y);
      }, path.closed ? Math.hypot(
        path.points[0].x - path.points[path.points.length - 1].x,
        path.points[0].y - path.points[path.points.length - 1].y,
      ) : 0);
      if (worldLength < 2) continue;
      const shoulderPoints: LandformShoulderPoint[] = [];
      for (const point of path.points) {
        const dx = sampleVisualHeight(field, point.x + derivativeRadius, point.y) -
          sampleVisualHeight(field, point.x - derivativeRadius, point.y);
        const dy = sampleVisualHeight(field, point.x, point.y + derivativeRadius) -
          sampleVisualHeight(field, point.x, point.y - derivativeRadius);
        const length = Math.hypot(dx, dy);
        if (length <= 1e-5) continue;
        const nx = dx / length;
        const ny = dy / length;
        const upper = {
          x: Math.max(0, Math.min(field.width, point.x + nx * halfWidth)),
          y: Math.max(0, Math.min(field.height, point.y + ny * halfWidth)),
        };
        const lower = {
          x: Math.max(0, Math.min(field.width, point.x - nx * halfWidth)),
          y: Math.max(0, Math.min(field.height, point.y - ny * halfWidth)),
        };
        if (isRecessed(terrainAt(tiles, field.width, field.height, upper)) || isRecessed(terrainAt(tiles, field.width, field.height, lower))) continue;
        const lowerHeight = sampleVisualHeight(field, lower.x, lower.y);
        shoulderPoints.push({
          upper,
          lower,
          upperHeight: Math.max(sampleVisualHeight(field, upper.x, upper.y), lowerHeight + 0.52),
          lowerHeight,
        });
      }
      if (shoulderPoints.length < 3) continue;
      const rises = shoulderPoints.map((point) => point.upperHeight - point.lowerHeight);
      result.push({
        level,
        closed: path.closed && shoulderPoints.length === path.points.length,
        points: shoulderPoints,
        worldLength,
        minimumRise: Math.min(...rises),
        maximumRise: Math.max(...rises),
      });
    }
  }
  return result;
}

/**
 * The renderer-facing relief policy. Parkland deliberately returns no
 * shoulder primitives: its terrain grade is communicated by the continuous
 * macro raster, not a second contour treatment. Other themes retain the
 * existing stitched geometry until they receive their own art-direction pass.
 */
export function buildLandformPresentationPlan(
  field: VisualHeightfield,
  tiles: readonly Terrain[],
  elevations: readonly number[],
  theme: "parkland" | "links" | "desert" | undefined,
  density = 2,
): LandformPresentationPlan {
  return Object.freeze({
    macroGrade: "spatially-filtered-slope-light",
    shoulders: Object.freeze(theme === "parkland"
      ? []
      : buildLandformShoulders(field, tiles, elevations, density)),
  });
}
