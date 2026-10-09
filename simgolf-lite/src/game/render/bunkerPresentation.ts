import type { SurfaceFeature, SurfacePoint } from "../models/types";
import type { Terrain } from "../models/types";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { buildBunkerVisualRings, classifyBunkerVisualType } from "./bunkerShapes";
import { buildHazardBankFacePlan } from "./hazardDepth";

export interface BunkerPresentationComponent {
  cells: number[];
  rings: SurfacePoint[][];
}

export function normalizeBunkerPresentation(value: unknown, tiles: readonly string[], width: number): BunkerPresentationComponent[] | undefined {
  if (!Number.isInteger(width) || width <= 0 || tiles.length % width !== 0 || !Array.isArray(value) || value.length > tiles.length) return undefined;
  const seen = new Set<number>();
  let points = 0;
  const normalized: BunkerPresentationComponent[] = [];
  for (const candidate of value) {
    if (!candidate || !Array.isArray(candidate.cells) || !candidate.cells.length || !Array.isArray(candidate.rings)) return undefined;
    const cells: number[] = candidate.cells;
    if (new Set(cells).size !== cells.length || !cells.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < tiles.length && tiles[cell] === "sand" && !seen.has(cell))) return undefined;
    if (!candidate.rings.every(Array.isArray)) return undefined;
    points += candidate.rings.reduce((sum: number, ring: SurfacePoint[]) => sum + ring.length, 0);
    if (points > 65536) return undefined;
    const rings = authoredBunkerRings(cells, [{ id: "snapshot", terrain: "sand", order: 0, coverage: cells,
      geometry: { kind: "region", ring: [] }, renderRings: candidate.rings }], width, tiles.length / width, false);
    if (!rings) return undefined;
    cells.forEach((cell) => seen.add(cell));
    normalized.push({ cells: [...cells], rings });
  }
  if (tiles.some((terrain, cell) => terrain === "sand" && !seen.has(cell))) return undefined;
  // Each record must be exactly one four-connected component, never an
  // arbitrary subset or a diagonal merge that changes mask ownership.
  for (const component of normalized) {
    const owned = new Set(component.cells);
    const visited = new Set<number>();
    const queue = [component.cells[0]];
    while (queue.length) {
      const cell = queue.pop()!;
      if (visited.has(cell)) continue;
      visited.add(cell);
      const x = cell % width;
      for (const neighbor of [cell - width, cell + width, ...(x > 0 ? [cell - 1] : []), ...(x + 1 < width ? [cell + 1] : [])]) {
        if (neighbor >= 0 && neighbor < tiles.length && tiles[neighbor] === "sand") {
          if (!owned.has(neighbor)) return undefined;
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
    }
    if (visited.size !== owned.size) return undefined;
  }
  return normalized;
}

const capturedBoundaries = new WeakMap<BunkerPresentationComponent, SurfacePoint[][]>();

/** Active-course capture keeps the shared boundary beside its floor without
 * persisting extra metadata or changing frozen round snapshot semantics. */
export function capturedBunkerBoundary(component: BunkerPresentationComponent): readonly (readonly SurfacePoint[])[] {
  return capturedBoundaries.get(component) ?? component.rings;
}

export function captureBunkerPresentation(
  tiles: readonly Terrain[], width: number, height: number,
  features?: readonly SurfaceFeature[],
): BunkerPresentationComponent[] {
  return buildLandscapeComponents(tiles, width, height, { cornerRadius: 0.4, cornerSegments: 4 })
    .filter((component) => component.terrain === "sand")
    .map((component) => {
      const boundary = authoredBunkerRings(component.cells, features, width, height) ?? buildBunkerVisualRings(
        component.rings, component.topologyKey, component.cells.length,
        classifyBunkerVisualType(component.cells, tiles, width, height),
      );
      const captured = { cells: [...component.cells], rings: boundary.map((ring) => {
        const plan = buildHazardBankFacePlan("sand", component.cells.length, ring);
        return (plan?.innerRing ?? ring).map((point) => ({ ...point }));
      }) };
      capturedBoundaries.set(captured, boundary);
      return captured;
    });
}

/** Finds a visible interior within the same logical component. Candidate
 * points are quantized exactly as shot traces are, so rounding cannot put the
 * final displayed rest outside the mask. No other lie or rule is changed. */
export function reconcileBunkerRest(
  point: SurfacePoint, width: number,
  components: readonly BunkerPresentationComponent[],
  logicalCell = Math.floor(point.y) * width + Math.floor(point.x),
): SurfacePoint {
  let indexed = componentIndex.get(components);
  if (!indexed) {
    indexed = new Map();
    for (const component of components) for (const cell of component.cells) indexed.set(cell, component);
    componentIndex.set(components, indexed);
  }
  const component = indexed.get(logicalCell);
  if (!component || insideBunkerRings(point, component.rings)) return point;
  let nearest: SurfacePoint | null = null;
  let distance = Infinity;
  let candidates = interiorCandidates.get(component);
  if (!candidates) {
    const owned = new Set(component.cells);
    candidates = [];
    const add = (candidate: SurfacePoint) => {
      const rounded = { x: Math.round(candidate.x * 1000) / 1000, y: Math.round(candidate.y * 1000) / 1000 };
      if (candidates!.length < 8192 && owned.has(Math.floor(rounded.y) * width + Math.floor(rounded.x))
        && insideBunkerRings(rounded, component.rings)) candidates!.push(rounded);
    };
    for (const cell of component.cells) add({ x: cell % width + 0.5, y: Math.floor(cell / width) + 0.5 });
    // Both sides of each edge are checked, so clockwise outers and islands
    // need no special winding convention. Only actual owned sand is kept.
    for (const ring of component.rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const length = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
      for (const sign of [-1, 1]) add({
        x: (a.x + b.x) / 2 - (b.y - a.y) / length * 0.02 * sign,
        y: (a.y + b.y) / 2 + (b.x - a.x) / length * 0.02 * sign,
      });
    }
    interiorCandidates.set(component, candidates);
  }
  for (const candidate of candidates) {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d < distance) { nearest = candidate; distance = d; }
  }
  return nearest ? { ...nearest } : point;
}

const componentIndex = new WeakMap<readonly BunkerPresentationComponent[], Map<number, BunkerPresentationComponent>>();
const interiorCandidates = new WeakMap<BunkerPresentationComponent, SurfacePoint[]>();

/** Existing renderer coordinates add half a tile to simulation points. Keep
 * that convention everywhere except sand cutouts; select ownership with the
 * canonical point so the display offset cannot choose a neighboring hazard. */
export function bunkerDisplayPoint(point: SurfacePoint, width: number, components: readonly BunkerPresentationComponent[]): SurfacePoint {
  if (!components.length) return { x: point.x + 0.5, y: point.y + 0.5 };
  let cache = displayCache.get(components);
  if (!cache) { cache = new Map(); displayCache.set(components, cache); }
  const key = `${width}:${point.x}:${point.y}`;
  const prior = cache.get(key);
  if (prior) return { ...prior };
  const displayed = reconcileBunkerRest({ x: point.x + 0.5, y: point.y + 0.5 }, width, components,
    Math.floor(point.y) * width + Math.floor(point.x));
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
  cache.set(key, displayed);
  return { ...displayed };
}

const displayCache = new WeakMap<readonly BunkerPresentationComponent[], Map<string, SurfacePoint>>();

const presentationCache = new WeakMap<readonly Terrain[], { features: readonly SurfaceFeature[] | undefined; width: number; height: number; components: BunkerPresentationComponent[] }>();
export function cachedBunkerPresentation(tiles: readonly Terrain[], width: number, height: number, features?: readonly SurfaceFeature[]): BunkerPresentationComponent[] {
  const existing = presentationCache.get(tiles);
  if (existing && existing.features === features && existing.width === width && existing.height === height) return existing.components;
  const components = captureBunkerPresentation(tiles, width, height, features);
  presentationCache.set(tiles, { features, width, height, components });
  return components;
}

function pointInsideCoverage(point: SurfacePoint, cells: ReadonlySet<number>, width: number): boolean {
  return [-1e-6, 1e-6].some((dx) => [-1e-6, 1e-6].some((dy) => {
    const x = Math.floor(point.x + dx);
    const y = Math.floor(point.y + dy);
    return x >= 0 && x < width && y >= 0 && cells.has(y * width + x);
  }));
}

/** Check every crossed grid interval, including tiny concave corner cuts
 * that fixed-distance boundary sampling can miss. Exact shared grid edges
 * may belong to either adjacent accepted cell. */
function segmentInsideCoverage(a: SurfacePoint, b: SurfacePoint, cells: ReadonlySet<number>, width: number): boolean {
  if (!pointInsideCoverage(a, cells, width) || !pointInsideCoverage(b, cells, width)) return false;
  const breaks = [0, 1];
  for (const axis of ["x", "y"] as const) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-12) continue;
    for (let line = Math.ceil(Math.min(a[axis], b[axis])); line <= Math.floor(Math.max(a[axis], b[axis])); line++) {
      const t = (line - a[axis]) / delta;
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((left, right) => left - right);
  return breaks.slice(1).every((next, index) => {
    const t = (next + breaks[index]) / 2;
    return pointInsideCoverage({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, cells, width);
  });
}

const GEOMETRY_EPSILON = 1e-8;
const cross = (a: SurfacePoint, b: SurfacePoint, c: SurfacePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segmentsTouch(a: SurfacePoint, b: SurfacePoint, c: SurfacePoint, d: SurfacePoint): boolean {
  if (Math.max(a.x, b.x) + GEOMETRY_EPSILON < Math.min(c.x, d.x)
    || Math.max(c.x, d.x) + GEOMETRY_EPSILON < Math.min(a.x, b.x)
    || Math.max(a.y, b.y) + GEOMETRY_EPSILON < Math.min(c.y, d.y)
    || Math.max(c.y, d.y) + GEOMETRY_EPSILON < Math.min(a.y, b.y)) return false;
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  const on = (p: SurfacePoint, q: SurfacePoint, r: SurfacePoint, signed: number) => Math.abs(signed) <= GEOMETRY_EPSILON
    && r.x >= Math.min(p.x, q.x) - GEOMETRY_EPSILON && r.x <= Math.max(p.x, q.x) + GEOMETRY_EPSILON
    && r.y >= Math.min(p.y, q.y) - GEOMETRY_EPSILON && r.y <= Math.max(p.y, q.y) + GEOMETRY_EPSILON;
  return on(a, b, c, abC) || on(a, b, d, abD) || on(c, d, a, cdA) || on(c, d, b, cdB)
    || (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function unambiguousRings(rings: readonly (readonly SurfacePoint[])[]): boolean {
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) <= GEOMETRY_EPSILON) return false;
      if (Math.abs(cross(a, b, c)) <= GEOMETRY_EPSILON
        && (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > GEOMETRY_EPSILON) return false;
      for (let j = i + 1; j < ring.length; j++) {
        if (j === i + 1 || i === 0 && j === ring.length - 1) continue;
        if (segmentsTouch(a, b, ring[j], ring[(j + 1) % ring.length])) return false;
      }
      for (let other = r + 1; other < rings.length; other++) {
        for (let j = 0; j < rings[other].length; j++) {
          if (segmentsTouch(a, b, rings[other][j], rings[other][(j + 1) % rings[other].length])) return false;
        }
      }
    }
  }
  return true;
}

/** Boundary validation means every unowned cell lies wholly inside or outside
 * the mask. Scanline cell centers therefore detect unauthorized interiors;
 * owned-cell samples reject hollow or tiny masks impersonating paid coverage. */
function fillOwnsCoverage(rings: readonly (readonly SurfacePoint[])[], cells: ReadonlySet<number>, width: number): boolean {
  let minY = Infinity, maxY = -Infinity;
  for (const cell of cells) {
    const x = cell % width, y = Math.floor(cell / width);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    if (insideBunkerRings({ x: x + 0.5, y: y + 0.5 }, rings)) continue;
    let visible = false;
    for (let dy = 0.125; dy < 1 && !visible; dy += 0.125) for (let dx = 0.125; dx < 1 && !visible; dx += 0.125) {
      visible = insideBunkerRings({ x: x + dx, y: y + dy }, rings);
    }
    if (!visible) return false;
  }
  for (let y = minY; y <= maxY; y++) {
    const scanY = y + 0.5;
    const crossings: number[] = [];
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a.y > scanY) !== (b.y > scanY)) crossings.push(a.x + (b.x - a.x) * (scanY - a.y) / (b.y - a.y));
    }
    crossings.sort((left, right) => left - right);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      for (let x = Math.ceil(crossings[i] - 0.5); x + 0.5 < crossings[i + 1]; x++) {
        if (!cells.has(y * width + x)) return false;
      }
    }
  }
  return true;
}

function validOwnedRings(rings: readonly (readonly SurfacePoint[])[], cells: ReadonlySet<number>, width: number, maxPoints: number): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell % width); maxX = Math.max(maxX, cell % width + 1);
    minY = Math.min(minY, Math.floor(cell / width)); maxY = Math.max(maxY, Math.floor(cell / width) + 1);
  }
  // Validate all vertices before any crossed-grid traversal. A finite but
  // enormous malformed point must never cause an unbounded grid-line loop.
  if (!rings.every((ring) => Array.isArray(ring) && ring.length >= 3 && ring.length <= maxPoints && ring.every((point) => point
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY))) return false;
  if (!unambiguousRings(rings)) return false;
  if (!rings.every((ring) => {
    const area = ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0);
    return Number.isFinite(area) && Math.abs(area) > 1e-6
      && ring.every((point, index) => segmentInsideCoverage(point, ring[(index + 1) % ring.length], cells, width));
  })) return false;
  return fillOwnsCoverage(rings, cells, width);
}

/** Exact component ownership is required: merged, split or overlapping edits
 * retain the deterministic component fallback rather than hiding paid cells. */
export function authoredBunkerRings(
  cells: readonly number[],
  features: readonly SurfaceFeature[] | undefined,
  width: number,
  height: number,
  roundCorners = true,
): SurfacePoint[][] | null {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || !Number.isSafeInteger(width * height) || !cells.length || !cells.every((cell) => Number.isSafeInteger(cell) && cell >= 0 && cell < width * height)) return null;
  const owned = new Set(cells);
  const touching = features?.filter((feature) => feature.terrain === "sand"
    && feature.coverage.some((cell) => owned.has(cell))) ?? [];
  if (touching.length !== 1) return null;
  const feature = touching[0];
  // A one-click brush uses the classic pot fallback. Curves/regions retain
  // authored control; a rasterized single-point disk adds no useful intent.
  if (cells.length === 1 && feature.geometry.kind === "corridor" && feature.geometry.knots.length <= 1) return null;
  const coverage = new Set(feature.coverage);
  if (coverage.size !== owned.size || !cells.every((cell) => coverage.has(cell))) return null;
  const rings = feature.renderRings;
  if (!rings?.length || rings.length > 32 || !validOwnedRings(rings, owned, width, roundCorners ? 1024 : 4096)) return null;
  const roundedRings = rings.map((ring) => {
    if (!roundCorners) return ring.map((point) => ({ ...point }));
    let rounded = ring.map((point) => ({ ...point }));
    // Remove quarter-cell raster corners without simplifying away lobes,
    // islands or player-authored bends. The same contour owns preview/final.
    for (let pass = 0; pass < 2; pass++) {
      rounded = rounded.flatMap((point, index) => {
        const previous = rounded[(index - 1 + rounded.length) % rounded.length];
        const next = rounded[(index + 1) % rounded.length];
        const incoming = { x: previous.x * 0.25 + point.x * 0.75, y: previous.y * 0.25 + point.y * 0.75 };
        const outgoing = { x: point.x * 0.75 + next.x * 0.25, y: point.y * 0.75 + next.y * 0.25 };
        // Retain only the corner that cannot be rounded inside paid cells.
        // Other corners still round, even when a contour touches the estate
        // border or bends around a protected/unowned notch.
        return segmentInsideCoverage(incoming, outgoing, owned, width)
          ? [incoming, outgoing]
          : [incoming, { ...point }, outgoing];
      });
    }
    // Rounding a concave clipped corner can cross uncharged coverage. Keep
    // the clipped original in that case rather than leaking sand into grass.
    return rounded;
  });
  // Validate the complete set, so independently rounded outers and islands
  // cannot touch, cross, hide owned cells or enclose uncharged interiors.
  return !roundCorners || validOwnedRings(roundedRings, owned, width, 4096)
    ? roundedRings
    : rings.map((ring) => ring.map((point) => ({ ...point })));
}

/** Even/odd membership preserves islands in the shared floor mask. */
export function insideBunkerRings(point: SurfacePoint, rings: readonly (readonly SurfacePoint[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}
