import type {
  Course,
  Point,
  SurfaceFeature,
  SurfaceIntentV1,
  SurfacePoint,
  SurfaceTangentHandles,
  Terrain,
} from "./types";

const SUBSAMPLES = 4;
const MAX_FEATURES = 512;
const MAX_POINTS = 256;
const MAX_RENDER_RINGS = 32;

export interface SurfaceRasterization {
  tiles: Point[];
  /** Clockwise outer rings and counter-clockwise holes in world tile space. */
  rings: SurfacePoint[][];
}

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

function normalizeRenderRings(
  value: unknown,
  width: number,
  height: number,
): SurfacePoint[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rings = value
    .slice(0, MAX_RENDER_RINGS)
    .filter(Array.isArray)
    .map((ring) => ring
      .filter(finitePoint)
      .slice(0, MAX_POINTS)
      .map((point) => clampPoint(point, width, height)))
    .filter((ring) => ring.length >= 3);
  return rings.length > 0 ? rings : undefined;
}

function normalizeTangents(
  value: unknown,
  points: readonly SurfacePoint[],
  width: number,
  height: number,
): SurfaceTangentHandles[] | undefined {
  if (!Array.isArray(value) || value.length !== points.length) return undefined;
  const tangents = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") return null;
    const handles = candidate as Partial<SurfaceTangentHandles>;
    if (!finitePoint(handles.in) || !finitePoint(handles.out)) return null;
    return {
      in: clampPoint(handles.in, width, height),
      out: clampPoint(handles.out, width, height),
    };
  });
  return tangents.every((handles): handles is SurfaceTangentHandles => handles !== null)
    ? tangents
    : undefined;
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
        renderRings: normalizeRenderRings(feature.renderRings, width, height),
        geometry: {
          kind: "corridor",
          knots,
          width: Math.max(0.25, Math.min(24, feature.geometry.width)),
          tangents: normalizeTangents(feature.geometry.tangents, knots, width, height),
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
        renderRings: normalizeRenderRings(feature.renderRings, width, height),
        geometry: {
          kind: "region",
          ring,
          tangents: normalizeTangents(feature.geometry.tangents, ring, width, height),
        },
      });
    }
  }
  const nextId = Number.isInteger(raw.nextId) && (raw.nextId ?? 0) > 0
    ? raw.nextId as number
    : features.length + 1;
  return { version: 1, nextId, features: features.sort((a, b) => a.order - b.order) };
}

function lerpPoint(a: SurfacePoint, b: SurfacePoint, t: number): SurfacePoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicBezier(
  p0: SurfacePoint,
  p1: SurfacePoint,
  p2: SurfacePoint,
  p3: SurfacePoint,
  t: number,
): SurfacePoint {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

export function defaultSurfaceTangents(
  points: readonly SurfacePoint[],
  closed = false,
): SurfaceTangentHandles[] {
  return points.map((point, index) => {
    const previous = index > 0
      ? points[index - 1]
      : closed
        ? points[points.length - 1]
        : point;
    const next = index + 1 < points.length
      ? points[index + 1]
      : closed
        ? points[0]
        : point;
    const scale = closed || (index > 0 && index + 1 < points.length) ? 1 / 6 : 1 / 3;
    const dx = (next.x - previous.x) * scale;
    const dy = (next.y - previous.y) * scale;
    return {
      in: { x: point.x - dx, y: point.y - dy },
      out: { x: point.x + dx, y: point.y + dy },
    };
  });
}

export function withDefaultSurfaceTangents(feature: SurfaceFeature): SurfaceFeature {
  const points = feature.geometry.kind === "corridor"
    ? feature.geometry.knots
    : feature.geometry.ring;
  if (feature.geometry.tangents?.length === points.length) return feature;
  const tangents = defaultSurfaceTangents(points, feature.geometry.kind === "region");
  return feature.geometry.kind === "corridor"
    ? { ...feature, geometry: { ...feature.geometry, tangents } }
    : { ...feature, geometry: { ...feature.geometry, tangents } };
}

/**
 * Centripetal Catmull–Rom avoids the loops and cusps that the former uniform
 * spline could create at tight pointer turns.
 */
function centripetalCatmullRom(
  p0: SurfacePoint,
  p1: SurfacePoint,
  p2: SurfacePoint,
  p3: SurfacePoint,
  u: number,
): SurfacePoint {
  const interval = (a: SurfacePoint, b: SurfacePoint) =>
    Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const t0 = 0;
  const t1 = t0 + interval(p0, p1);
  const t2 = t1 + interval(p1, p2);
  const t3 = t2 + interval(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const blend = (a: SurfacePoint, b: SurfacePoint, ta: number, tb: number) =>
    lerpPoint(a, b, (t - ta) / Math.max(1e-6, tb - ta));
  const a1 = blend(p0, p1, t0, t1);
  const a2 = blend(p1, p2, t1, t2);
  const a3 = blend(p2, p3, t2, t3);
  const b1 = lerpPoint(a1, a2, (t - t0) / Math.max(1e-6, t2 - t0));
  const b2 = lerpPoint(a2, a3, (t - t1) / Math.max(1e-6, t3 - t1));
  return lerpPoint(b1, b2, (t - t1) / Math.max(1e-6, t2 - t1));
}

/** Fixed-step sampling makes preview, commit, save/reload, and tests agree. */
export function sampleCorridor(
  knots: readonly SurfacePoint[],
  step = 0.2,
  tangents?: readonly SurfaceTangentHandles[],
): SurfacePoint[] {
  if (knots.length < 2) return [...knots];
  const result: SurfacePoint[] = [];
  const explicitTangents = tangents?.length === knots.length ? tangents : undefined;
  for (let index = 0; index < knots.length - 1; index++) {
    const p1 = knots[index];
    const p2 = knots[index + 1];
    const p0 = index > 0
      ? knots[index - 1]
      : { x: p1.x * 2 - p2.x, y: p1.y * 2 - p2.y };
    const p3 = index + 2 < knots.length
      ? knots[index + 2]
      : { x: p2.x * 2 - p1.x, y: p2.y * 2 - p1.y };
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const divisions = Math.max(1, Math.ceil(distance / step));
    for (let part = 0; part < divisions; part++) {
      const t = part / divisions;
      result.push(explicitTangents
        ? cubicBezier(p1, explicitTangents[index].out, explicitTangents[index + 1].in, p2, t)
        : centripetalCatmullRom(p0, p1, p2, p3, t));
    }
  }
  result.push({ ...knots[knots.length - 1] });
  return result;
}

export function sampleRegion(
  ring: readonly SurfacePoint[],
  tangents?: readonly SurfaceTangentHandles[],
  step = 0.2,
): SurfacePoint[] {
  if (ring.length < 3 || tangents?.length !== ring.length) return ring.map((point) => ({ ...point }));
  const sampled: SurfacePoint[] = [];
  for (let index = 0; index < ring.length; index++) {
    const nextIndex = (index + 1) % ring.length;
    const start = ring[index];
    const end = ring[nextIndex];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const divisions = Math.max(1, Math.ceil(distance / step));
    for (let part = 0; part < divisions; part++) {
      sampled.push(cubicBezier(
        start,
        tangents[index].out,
        tangents[nextIndex].in,
        end,
        part / divisions,
      ));
    }
  }
  return sampled;
}

function pointSegmentDistance(point: SurfacePoint, a: SurfacePoint, b: SurfacePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 <= 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function coverageBounds(feature: SurfaceFeature): { minX: number; minY: number; maxX: number; maxY: number } {
  const geometryPoints = feature.geometry.kind === "corridor" ? feature.geometry.knots : feature.geometry.ring;
  const points = feature.geometry.tangents
    ? [...geometryPoints, ...feature.geometry.tangents.flatMap((handles) => [handles.in, handles.out])]
    : geometryPoints;
  const pad = feature.geometry.kind === "corridor" ? feature.geometry.width / 2 + 1 : 1;
  return {
    minX: Math.floor(Math.min(...points.map((point) => point.x)) - pad),
    minY: Math.floor(Math.min(...points.map((point) => point.y)) - pad),
    maxX: Math.ceil(Math.max(...points.map((point) => point.x)) + pad),
    maxY: Math.ceil(Math.max(...points.map((point) => point.y)) + pad),
  };
}

interface LocalSurfaceMask {
  minX: number;
  minY: number;
  tileWidth: number;
  tileHeight: number;
  width: number;
  height: number;
  cells: Uint8Array;
}

function localMask(feature: SurfaceFeature, courseWidth: number, courseHeight: number): LocalSurfaceMask | null {
  const bounds = coverageBounds(feature);
  const minX = Math.max(0, bounds.minX);
  const minY = Math.max(0, bounds.minY);
  const maxX = Math.min(courseWidth, bounds.maxX);
  const maxY = Math.min(courseHeight, bounds.maxY);
  const tileWidth = maxX - minX;
  const tileHeight = maxY - minY;
  if (tileWidth <= 0 || tileHeight <= 0) return null;
  return {
    minX,
    minY,
    tileWidth,
    tileHeight,
    width: tileWidth * SUBSAMPLES,
    height: tileHeight * SUBSAMPLES,
    cells: new Uint8Array(tileWidth * tileHeight * SUBSAMPLES * SUBSAMPLES),
  };
}

function maskCellCenter(mask: LocalSurfaceMask, x: number, y: number): SurfacePoint {
  return {
    x: mask.minX + (x + 0.5) / SUBSAMPLES,
    y: mask.minY + (y + 0.5) / SUBSAMPLES,
  };
}

function paintMaskSegment(
  mask: LocalSurfaceMask,
  start: SurfacePoint,
  end: SurfacePoint,
  radius: number,
): void {
  const toSubcell = (value: number, origin: number) => (value - origin) * SUBSAMPLES - 0.5;
  const minX = Math.max(
    0,
    Math.floor(toSubcell(Math.min(start.x, end.x) - radius, mask.minX)),
  );
  const maxX = Math.min(
    mask.width - 1,
    Math.ceil(toSubcell(Math.max(start.x, end.x) + radius, mask.minX)),
  );
  const minY = Math.max(
    0,
    Math.floor(toSubcell(Math.min(start.y, end.y) - radius, mask.minY)),
  );
  const maxY = Math.min(
    mask.height - 1,
    Math.ceil(toSubcell(Math.max(start.y, end.y) + radius, mask.minY)),
  );
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointSegmentDistance(maskCellCenter(mask, x, y), start, end) <= radius) {
        mask.cells[y * mask.width + x] = 1;
      }
    }
  }
}

function floodExterior(mask: LocalSurfaceMask): Uint8Array {
  const exterior = new Uint8Array(mask.cells.length);
  const queue: number[] = [];
  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
    const index = y * mask.width + x;
    if (mask.cells[index] || exterior[index]) return;
    exterior[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < mask.width; x++) {
    enqueue(x, 0);
    enqueue(x, mask.height - 1);
  }
  for (let y = 0; y < mask.height; y++) {
    enqueue(0, y);
    enqueue(mask.width - 1, y);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    const x = index % mask.width;
    const y = Math.floor(index / mask.width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
  return exterior;
}

function closePinholes(mask: LocalSurfaceMask): void {
  const additions: number[] = [];
  for (let y = 1; y < mask.height - 1; y++) {
    for (let x = 1; x < mask.width - 1; x++) {
      const index = y * mask.width + x;
      if (mask.cells[index]) continue;
      const neighbors =
        mask.cells[index - 1] +
        mask.cells[index + 1] +
        mask.cells[index - mask.width] +
        mask.cells[index + mask.width];
      if (neighbors >= 3) additions.push(index);
    }
  }
  for (const index of additions) mask.cells[index] = 1;
}

function fillSmallEnclosedGaps(mask: LocalSurfaceMask, maxCells: number): void {
  if (maxCells <= 0) return;
  const exterior = floodExterior(mask);
  const visited = new Uint8Array(mask.cells.length);
  for (let seed = 0; seed < mask.cells.length; seed++) {
    if (mask.cells[seed] || exterior[seed] || visited[seed]) continue;
    const component = [seed];
    visited[seed] = 1;
    for (let cursor = 0; cursor < component.length; cursor++) {
      const index = component[cursor];
      const x = index % mask.width;
      const y = Math.floor(index / mask.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
        const neighbor = ny * mask.width + nx;
        if (mask.cells[neighbor] || exterior[neighbor] || visited[neighbor]) continue;
        visited[neighbor] = 1;
        component.push(neighbor);
      }
    }
    if (component.length <= maxCells) {
      for (const index of component) mask.cells[index] = 1;
    }
  }
}

function fillAreaInterior(mask: LocalSurfaceMask): void {
  const exterior = floodExterior(mask);
  for (let index = 0; index < mask.cells.length; index++) {
    if (!exterior[index]) mask.cells[index] = 1;
  }
}

function clipMaskToTiles(
  mask: LocalSurfaceMask,
  courseWidth: number,
  allowedIndices?: ReadonlySet<number>,
): void {
  if (!allowedIndices) return;
  for (let y = 0; y < mask.height; y++) {
    const tileY = mask.minY + Math.floor(y / SUBSAMPLES);
    for (let x = 0; x < mask.width; x++) {
      const tileX = mask.minX + Math.floor(x / SUBSAMPLES);
      if (!allowedIndices.has(tileY * courseWidth + tileX)) {
        mask.cells[y * mask.width + x] = 0;
      }
    }
  }
}

function tileCoverageFromMask(
  mask: LocalSurfaceMask,
  courseWidth: number,
  allowedIndices?: ReadonlySet<number>,
): { tiles: Point[]; counts: Map<number, number> } {
  const tiles: Point[] = [];
  const counts = new Map<number, number>();
  for (let tileY = 0; tileY < mask.tileHeight; tileY++) {
    for (let tileX = 0; tileX < mask.tileWidth; tileX++) {
      const worldX = mask.minX + tileX;
      const worldY = mask.minY + tileY;
      const courseIndex = worldY * courseWidth + worldX;
      if (allowedIndices && !allowedIndices.has(courseIndex)) continue;
      let covered = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        const row = (tileY * SUBSAMPLES + sy) * mask.width + tileX * SUBSAMPLES;
        for (let sx = 0; sx < SUBSAMPLES; sx++) covered += mask.cells[row + sx];
      }
      counts.set(courseIndex, covered);
      if (covered >= SUBSAMPLES) tiles.push({ x: worldX, y: worldY });
    }
  }
  return { tiles, counts };
}

function fillMaskTile(mask: LocalSurfaceMask, worldX: number, worldY: number): void {
  const tileX = worldX - mask.minX;
  const tileY = worldY - mask.minY;
  if (tileX < 0 || tileY < 0 || tileX >= mask.tileWidth || tileY >= mask.tileHeight) return;
  for (let sy = 0; sy < SUBSAMPLES; sy++) {
    const row = (tileY * SUBSAMPLES + sy) * mask.width + tileX * SUBSAMPLES;
    for (let sx = 0; sx < SUBSAMPLES; sx++) mask.cells[row + sx] = 1;
  }
}

function repairDiagonalTileConnections(
  mask: LocalSurfaceMask,
  tiles: Point[],
  counts: ReadonlyMap<number, number>,
  courseWidth: number,
  courseHeight: number,
  allowedIndices?: ReadonlySet<number>,
): Point[] {
  const covered = new Set(tiles.map((point) => point.y * courseWidth + point.x));
  const additions = new Set<number>();
  for (const point of tiles) {
    for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
      const diagonalX = point.x + dx;
      const diagonalY = point.y + dy;
      if (diagonalX < 0 || diagonalY < 0 || diagonalX >= courseWidth || diagonalY >= courseHeight) continue;
      const diagonal = diagonalY * courseWidth + diagonalX;
      if (!covered.has(diagonal)) continue;
      const candidateA = point.y * courseWidth + diagonalX;
      const candidateB = diagonalY * courseWidth + point.x;
      if (covered.has(candidateA) || covered.has(candidateB)) continue;
      const candidates = [candidateA, candidateB]
        .filter((index) => !allowedIndices || allowedIndices.has(index))
        .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b);
      if (candidates[0] != null) additions.add(candidates[0]);
    }
  }
  for (const index of additions) {
    covered.add(index);
    fillMaskTile(mask, index % courseWidth, Math.floor(index / courseWidth));
  }
  return [...covered]
    .sort((a, b) => a - b)
    .map((index) => ({ x: index % courseWidth, y: Math.floor(index / courseWidth) }));
}

function compactMaskRing(points: SurfacePoint[]): SurfacePoint[] {
  if (points.length < 3) return points;
  const closed = [...points, points[0]];
  let compact = simplifySurfacePoints(closed, 0.1);
  if (
    compact.length > 1 &&
    compact[0].x === compact[compact.length - 1].x &&
    compact[0].y === compact[compact.length - 1].y
  ) compact = compact.slice(0, -1);
  if (compact.length > MAX_POINTS) {
    const stride = Math.ceil(compact.length / MAX_POINTS);
    compact = compact.filter((_, index) => index % stride === 0);
  }
  return compact;
}

function maskRings(mask: LocalSurfaceMask): SurfacePoint[][] {
  interface MaskEdge { startX: number; startY: number; endX: number; endY: number }
  const edges: MaskEdge[] = [];
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.cells[y * mask.width + x] === 1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) edges.push({ startX: x, startY: y, endX: x + 1, endY: y });
      if (!filled(x + 1, y)) edges.push({ startX: x + 1, startY: y, endX: x + 1, endY: y + 1 });
      if (!filled(x, y + 1)) edges.push({ startX: x + 1, startY: y + 1, endX: x, endY: y + 1 });
      if (!filled(x - 1, y)) edges.push({ startX: x, startY: y + 1, endX: x, endY: y });
    }
  }
  const key = (x: number, y: number) => `${x},${y}`;
  const byStart = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const edgeKey = key(edge.startX, edge.startY);
    byStart.set(edgeKey, [...(byStart.get(edgeKey) ?? []), index]);
  });
  const unused = new Set(edges.map((_, index) => index));
  const rings: SurfacePoint[][] = [];
  while (unused.size > 0 && rings.length < MAX_RENDER_RINGS) {
    const firstIndex = unused.values().next().value as number;
    const first = edges[firstIndex];
    const ring: SurfacePoint[] = [];
    let edgeIndex = firstIndex;
    while (unused.delete(edgeIndex)) {
      const edge = edges[edgeIndex];
      ring.push({
        x: mask.minX + edge.startX / SUBSAMPLES,
        y: mask.minY + edge.startY / SUBSAMPLES,
      });
      if (edge.endX === first.startX && edge.endY === first.startY) break;
      const next = (byStart.get(key(edge.endX, edge.endY)) ?? []).find((candidate) => unused.has(candidate));
      if (next == null) break;
      edgeIndex = next;
    }
    const compact = compactMaskRing(ring);
    if (compact.length >= 3) rings.push(compact);
  }
  return rings;
}

export function rasterizeSurfaceFeatureDetailed(
  feature: SurfaceFeature,
  courseWidth: number,
  courseHeight: number,
  allowedIndices?: ReadonlySet<number>,
): SurfaceRasterization {
  const sampled = feature.geometry.kind === "corridor"
    ? sampleCorridor(feature.geometry.knots, 0.2, feature.geometry.tangents)
    : sampleRegion(feature.geometry.ring, feature.geometry.tangents);
  if (feature.geometry.kind === "region" && sampled.length < 3) return { tiles: [], rings: [] };
  if (sampled.length === 0) return { tiles: [], rings: [] };
  const mask = localMask(feature, courseWidth, courseHeight);
  if (!mask) return { tiles: [], rings: [] };

  if (feature.geometry.kind === "corridor") {
    const radius = feature.geometry.width / 2;
    if (sampled.length === 1) {
      paintMaskSegment(mask, sampled[0], sampled[0], radius);
    } else {
      for (let index = 1; index < sampled.length; index++) {
        paintMaskSegment(mask, sampled[index - 1], sampled[index], radius);
      }
    }
    closePinholes(mask);
    const widthInSubcells = Math.max(SUBSAMPLES, feature.geometry.width * SUBSAMPLES);
    fillSmallEnclosedGaps(mask, Math.round(widthInSubcells * widthInSubcells * 0.5));
  } else {
    const boundaryRadius = Math.SQRT2 / (2 * SUBSAMPLES) + 1e-6;
    for (let index = 0; index < sampled.length; index++) {
      const next = (index + 1) % sampled.length;
      paintMaskSegment(mask, sampled[index], sampled[next], boundaryRadius);
    }
    closePinholes(mask);
    fillAreaInterior(mask);
  }

  clipMaskToTiles(mask, courseWidth, allowedIndices);
  const initial = tileCoverageFromMask(mask, courseWidth, allowedIndices);
  const tiles = repairDiagonalTileConnections(
    mask,
    initial.tiles,
    initial.counts,
    courseWidth,
    courseHeight,
    allowedIndices,
  );
  return { tiles, rings: maskRings(mask) };
}

export function rasterizeSurfaceFeature(feature: SurfaceFeature, width: number, height: number): Point[] {
  return rasterizeSurfaceFeatureDetailed(feature, width, height).tiles;
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

/** Reconstructs the terrain below persisted intent without increasing save size. */
export function buildIntentUnderlayTiles(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  features: readonly SurfaceFeature[],
): Terrain[] {
  const result = tiles.slice();
  for (const feature of features) {
    const coverage = new Set(feature.coverage.filter((index) => tiles[index] === feature.terrain));
    for (const index of coverage) {
      const x = index % width;
      const y = Math.floor(index / width);
      const candidates = new Map<Terrain, number>();
      for (let radius = 1; radius <= 3 && candidates.size === 0; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const neighborIndex = ny * width + nx;
            if (coverage.has(neighborIndex)) continue;
            const terrain = result[neighborIndex];
            if (terrain === feature.terrain) continue;
            candidates.set(terrain, (candidates.get(terrain) ?? 0) + 1);
          }
        }
      }
      result[index] = [...candidates].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "rough";
    }
  }
  return result;
}
