import type {
  Course,
  Point,
  SurfaceFeature,
  SurfaceIntentV1,
  SurfacePoint,
  Terrain,
} from "./types";

const SUBSAMPLES = 4;
const MAX_FEATURES = 512;
const MAX_POINTS = 256;

export const EMPTY_SURFACE_INTENT: SurfaceIntentV1 = {
  version: 1,
  nextId: 1,
  features: [],
};

/** Douglas–Peucker simplification for pointer-authored surface geometry. */
export function simplifySurfacePoints(
  points: readonly SurfacePoint[],
  tolerance = 0.65,
): SurfacePoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const squareTolerance = tolerance * tolerance;
  const squareSegmentDistance = (point: SurfacePoint, start: SurfacePoint, end: SurfacePoint) => {
    let x = start.x;
    let y = start.y;
    let dx = end.x - x;
    let dy = end.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = end.x;
        y = end.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = point.x - x;
    dy = point.y - y;
    return dx * dx + dy * dy;
  };
  const simplify = (first: number, last: number, result: SurfacePoint[]) => {
    let maxDistance = squareTolerance;
    let split = 0;
    for (let index = first + 1; index < last; index++) {
      const distance = squareSegmentDistance(points[index], points[first], points[last]);
      if (distance > maxDistance) {
        split = index;
        maxDistance = distance;
      }
    }
    if (split === 0) return;
    if (split - first > 1) simplify(first, split, result);
    result.push({ ...points[split] });
    if (last - split > 1) simplify(split, last, result);
  };
  const result: SurfacePoint[] = [{ ...points[0] }];
  simplify(0, points.length - 1, result);
  result.push({ ...points[points.length - 1] });
  return result;
}

function finitePoint(value: unknown): value is SurfacePoint {
  if (!value || typeof value !== "object") return false;
  const point = value as SurfacePoint;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function clampPoint(point: SurfacePoint, width: number, height: number): SurfacePoint {
  return {
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  };
}

export function normalizeSurfaceIntent(
  value: unknown,
  width: number,
  height: number,
  terrainValues: readonly Terrain[],
): SurfaceIntentV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<SurfaceIntentV1>;
  if (raw.version !== 1 || !Array.isArray(raw.features)) return undefined;
  const allowed = new Set<string>(terrainValues);
  const features: SurfaceFeature[] = [];
  for (const candidate of raw.features.slice(-MAX_FEATURES)) {
    if (!candidate || typeof candidate !== "object") continue;
    const feature = candidate as SurfaceFeature;
    if (typeof feature.id !== "string" || !allowed.has(feature.terrain)) continue;
    if (!Number.isInteger(feature.order) || !Array.isArray(feature.coverage)) continue;
    const coverage = [...new Set(feature.coverage.filter(
      (index) => Number.isInteger(index) && index >= 0 && index < width * height,
    ))].sort((a, b) => a - b);
    if (feature.geometry?.kind === "corridor") {
      const knots = feature.geometry.knots?.filter(finitePoint).slice(0, MAX_POINTS).map(
        (point) => clampPoint(point, width, height),
      );
      if (knots.length < 2 || !Number.isFinite(feature.geometry.width)) continue;
      features.push({
        id: feature.id,
        terrain: feature.terrain,
        order: feature.order,
        coverage,
        geometry: {
          kind: "corridor",
          knots,
          width: Math.max(0.25, Math.min(24, feature.geometry.width)),
        },
      });
    } else if (feature.geometry?.kind === "region") {
      const ring = feature.geometry.ring?.filter(finitePoint).slice(0, MAX_POINTS).map(
        (point) => clampPoint(point, width, height),
      );
      if (ring.length < 3) continue;
      features.push({
        id: feature.id,
        terrain: feature.terrain,
        order: feature.order,
        coverage,
        geometry: { kind: "region", ring },
      });
    }
  }
  const nextId = Number.isInteger(raw.nextId) && (raw.nextId ?? 0) > 0
    ? raw.nextId as number
    : features.length + 1;
  return { version: 1, nextId, features: features.sort((a, b) => a.order - b.order) };
}

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * b +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t2 +
    (-a + 3 * b - 3 * c + d) * t3
  );
}

/** Fixed-step sampling makes preview, commit, save/reload, and tests agree. */
export function sampleCorridor(knots: readonly SurfacePoint[], step = 0.2): SurfacePoint[] {
  if (knots.length < 2) return [...knots];
  const result: SurfacePoint[] = [];
  for (let index = 0; index < knots.length - 1; index++) {
    const p0 = knots[Math.max(0, index - 1)];
    const p1 = knots[index];
    const p2 = knots[index + 1];
    const p3 = knots[Math.min(knots.length - 1, index + 2)];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const divisions = Math.max(1, Math.ceil(distance / step));
    for (let part = 0; part < divisions; part++) {
      const t = part / divisions;
      result.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
  }
  result.push({ ...knots[knots.length - 1] });
  return result;
}

function pointSegmentDistance(point: SurfacePoint, a: SurfacePoint, b: SurfacePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 <= 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function insidePolygon(point: SurfacePoint, ring: readonly SurfacePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    ) inside = !inside;
  }
  return inside;
}

function coverageBounds(feature: SurfaceFeature): { minX: number; minY: number; maxX: number; maxY: number } {
  const points = feature.geometry.kind === "corridor" ? feature.geometry.knots : feature.geometry.ring;
  const pad = feature.geometry.kind === "corridor" ? feature.geometry.width / 2 + 1 : 1;
  return {
    minX: Math.floor(Math.min(...points.map((point) => point.x)) - pad),
    minY: Math.floor(Math.min(...points.map((point) => point.y)) - pad),
    maxX: Math.ceil(Math.max(...points.map((point) => point.x)) + pad),
    maxY: Math.ceil(Math.max(...points.map((point) => point.y)) + pad),
  };
}

export function rasterizeSurfaceFeature(feature: SurfaceFeature, width: number, height: number): Point[] {
  const sampled = feature.geometry.kind === "corridor"
    ? sampleCorridor(feature.geometry.knots)
    : feature.geometry.ring;
  if (feature.geometry.kind === "region" && sampled.length < 3) return [];
  if (sampled.length === 0) return [];
  const bounds = coverageBounds(feature);
  const result: Point[] = [];
  const radius = feature.geometry.kind === "corridor" ? feature.geometry.width / 2 : 0;
  const contains = (point: SurfacePoint): boolean => {
    if (feature.geometry.kind === "region") return insidePolygon(point, sampled);
    if (sampled.length === 1) {
      return Math.hypot(point.x - sampled[0].x, point.y - sampled[0].y) <= radius;
    }
    for (let index = 1; index < sampled.length; index++) {
      if (pointSegmentDistance(point, sampled[index - 1], sampled[index]) <= radius) return true;
    }
    return false;
  };
  for (let y = Math.max(0, bounds.minY); y < Math.min(height, bounds.maxY); y++) {
    for (let x = Math.max(0, bounds.minX); x < Math.min(width, bounds.maxX); x++) {
      const centerCovered = contains({ x: x + 0.5, y: y + 0.5 });
      let covered = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          if (contains({
            x: x + (sx + 0.5) / SUBSAMPLES,
            y: y + (sy + 0.5) / SUBSAMPLES,
          })) covered++;
        }
      }
      if (centerCovered || covered / (SUBSAMPLES * SUBSAMPLES) >= 0.25) result.push({ x, y });
    }
  }
  return result;
}

export function corridorFeature(
  course: Pick<Course, "surfaceIntent" | "width">,
  terrain: Terrain,
  knots: readonly SurfacePoint[],
  width: number,
): SurfaceFeature {
  const intent = course.surfaceIntent ?? EMPTY_SURFACE_INTENT;
  const order = intent.features.reduce((max, feature) => Math.max(max, feature.order), 0) + 1;
  return {
    id: `surface-${intent.nextId}`,
    terrain,
    order,
    geometry: { kind: "corridor", knots: knots.map((point) => ({ ...point })), width },
    coverage: [],
  };
}

export function regionFeature(
  course: Pick<Course, "surfaceIntent" | "width">,
  terrain: Terrain,
  ring: readonly SurfacePoint[],
): SurfaceFeature {
  const intent = course.surfaceIntent ?? EMPTY_SURFACE_INTENT;
  const order = intent.features.reduce((max, feature) => Math.max(max, feature.order), 0) + 1;
  return {
    id: `surface-${intent.nextId}`,
    terrain,
    order,
    geometry: { kind: "region", ring: ring.map((point) => ({ ...point })) },
    coverage: [],
  };
}

export function appendSurfaceFeature(course: Course, feature: SurfaceFeature): SurfaceIntentV1 {
  const intent = course.surfaceIntent ?? EMPTY_SURFACE_INTENT;
  const validCoverage = [...new Set(feature.coverage.filter((index) => (
    index >= 0 &&
    index < course.tiles.length &&
    course.tiles[index] === feature.terrain
  )))].sort((a, b) => a - b);
  return {
    version: 1,
    nextId: Math.max(intent.nextId + 1, Number(feature.id.replace(/^surface-/, "")) + 1 || intent.nextId + 1),
    features: [...intent.features, { ...feature, coverage: validCoverage }].slice(-MAX_FEATURES),
  };
}
