/**
 * Rounded terrain silhouettes derived from connected whole-tile components —
 * ZK-468.
 *
 * `Course.tiles` stays the single authority for gameplay, painting, undo/redo,
 * saves, hashes, and simulation. Nothing here is persisted: every value is
 * recomputed from the tile grid, so the save schema and course hash are
 * untouched.
 *
 * The pipeline is:
 *   1. flood-fill 4-connected same-terrain components (row-major seeds),
 *   2. trace their tile-union boundary into outer rings and hole rings with
 *      stable winding,
 *   3. merge collinear runs that share the same opposing terrain,
 *   4. round the remaining corners with a terrain-configurable radius.
 *
 * Two properties matter more than anything else and are enforced structurally
 * rather than by tuning:
 *
 * **Shared boundaries.** Where terrains A and B meet, A's ring and B's ring
 * must produce the same curve or a crack (or a doubled edge) appears between
 * them. Rounding is therefore a function of the *grid*, never of the component
 * being traced: the radius at a vertex is looked up from the tiles surrounding
 * that vertex, the clamp is purely local to the two incident edges, and the arc
 * is evaluated in a canonical endpoint order and quantized. Both sides
 * consequently emit bit-identical points. Vertices where more than two terrains
 * meet — the only places where the two rings' local neighbourhoods could
 * diverge — stay sharp.
 *
 * **Topology.** A rounded ring must still contain exactly the cell centers its
 * component owns. Radii are capped at half a tile and at half the shorter
 * incident run, which bounds a corner's deviation to ~0.18 tiles while the
 * nearest cell center sits ~0.71 tiles away. Narrow necks are straight runs and
 * carry no corners at all, so they never pinch off.
 */

import type { SurfacePoint, Terrain } from "../models/types";
import { TERRAIN_BOUNDARY_PRIORITY } from "./terrainMaterials";

/** Internal presentation resolution: the mask is reasoned about at 4× tiles. */
export const PRESENTATION_SCALE = 4;

/**
 * Silhouette points snap to this fraction of a tile (1/256 ≈ 0.25 px at zoom 1
 * with a 64 px tile). Quantizing removes the last-ulp drift that would
 * otherwise let a shared boundary disagree between its two owners.
 */
export const SILHOUETTE_QUANTUM = 1 / (PRESENTATION_SCALE * 64);

/** Points emitted per rounded corner (endpoints included). */
const ARC_SEGMENTS = 4;

/**
 * Corner radius per terrain, in tiles. The spec's 0.25–0.5 band: engineered
 * surfaces (paths, tees) stay crisp, hazards and mown turf read roundest.
 */
export const TERRAIN_CORNER_RADIUS: Record<Terrain, number> = {
  sand: 0.5,
  water: 0.45,
  fairway: 0.45,
  wetland: 0.42,
  green: 0.4,
  waste_area: 0.38,
  rough: 0.35,
  deep_rough: 0.35,
  tee: 0.3,
  path: 0.25,
};

export type RingKind = "outer" | "hole";

export interface SilhouetteRing {
  kind: RingKind;
  points: SurfacePoint[];
  /** Positive for outer rings, negative for holes (y-down shoelace). */
  signedArea: number;
}

/**
 * A contiguous run of a rounded ring facing one constant opposing terrain.
 * `other` is null where the run faces outside the course. ZK-469 draws its
 * pair-aware contour bands directly from these.
 */
export interface BoundarySegment {
  terrain: Terrain;
  other: Terrain | null;
  points: SurfacePoint[];
}

export interface TerrainComponent {
  terrain: Terrain;
  /** Authoritative owned cells, row-major indices, ascending. */
  cells: number[];
  rings: SilhouetteRing[];
  boundarySegments: BoundarySegment[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Stable across reload and rebuild; identical topology ⇒ identical key. */
  topologyKey: string;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function quantize(value: number): number {
  // `+ 0` normalizes -0 so identical geometry compares identically.
  return Math.round(value / SILHOUETTE_QUANTUM) * SILHOUETTE_QUANTUM + 0;
}

function quantizePoint(x: number, y: number): SurfacePoint {
  return { x: quantize(x), y: quantize(y) };
}

function samePoint(a: SurfacePoint, b: SurfacePoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * The corner radius at a grid vertex, derived only from the tiles around it so
 * that every component touching the vertex computes the same value.
 *
 * Zero (a sharp corner) when the vertex touches the course boundary or when
 * more than two terrains meet there — the latter is the one case where two
 * neighbouring rings would otherwise round against different edges.
 */
export function vertexCornerRadius(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  vx: number,
  vy: number,
): number {
  const present: Terrain[] = [];
  for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const x = vx + ox;
    const y = vy + oy;
    // The course perimeter is a hard edge; rounding it would expose the
    // surround layer behind the map.
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const terrain = tiles[y * width + x];
    if (!present.includes(terrain)) present.push(terrain);
  }
  if (present.length !== 2) return 0;
  const owner = TERRAIN_BOUNDARY_PRIORITY.find((terrain) => present.includes(terrain));
  return owner ? TERRAIN_CORNER_RADIUS[owner] : 0;
}

interface HalfEdge {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  /** Terrain on the far side of this edge; null outside the course. */
  other: Terrain | null;
}

interface RingVertex {
  x: number;
  y: number;
  /** Opposing terrain of the run leaving this vertex. */
  other: Terrain | null;
}

/**
 * Boundary half-edges of one component, wound so the interior lies to the
 * right. Emitted in a fixed cell/direction order so tracing is deterministic.
 */
function componentHalfEdges(
  cells: readonly number[],
  owned: Set<number>,
  tiles: readonly Terrain[],
  width: number,
  height: number,
): HalfEdge[] {
  const edges: HalfEdge[] = [];
  for (const index of cells) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let direction = 0; direction < NEIGHBORS.length; direction++) {
      const [dx, dy] = NEIGHBORS[direction];
      const nx = x + dx;
      const ny = y + dy;
      const inside = nx >= 0 && ny >= 0 && nx < width && ny < height;
      if (inside && owned.has(ny * width + nx)) continue;
      const other = inside ? tiles[ny * width + nx] : null;
      if (direction === 0) edges.push({ sx: x, sy: y, ex: x + 1, ey: y, other });
      else if (direction === 1) edges.push({ sx: x + 1, sy: y, ex: x + 1, ey: y + 1, other });
      else if (direction === 2) edges.push({ sx: x + 1, sy: y + 1, ex: x, ey: y + 1, other });
      else edges.push({ sx: x, sy: y + 1, ex: x, ey: y, other });
    }
  }
  return edges;
}

/**
 * Chains half-edges into closed rings. At a pinch vertex — where the component
 * touches itself diagonally and four boundary edges meet — the tightest
 * right-hand turn is taken, which splits the pinch into separate rings instead
 * of merging two lobes through a zero-width join.
 */
function chainRings(edges: readonly HalfEdge[]): RingVertex[][] {
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = `${edge.sx},${edge.sy}`;
    const bucket = outgoing.get(key);
    if (bucket) bucket.push(index);
    else outgoing.set(key, [index]);
  });

  const used = new Uint8Array(edges.length);
  const rings: RingVertex[][] = [];
  for (let seed = 0; seed < edges.length; seed++) {
    if (used[seed]) continue;
    const ring: RingVertex[] = [];
    let current = seed;
    while (!used[current]) {
      used[current] = 1;
      const edge = edges[current];
      ring.push({ x: edge.sx, y: edge.sy, other: edge.other });
      const candidates = outgoing.get(`${edge.ex},${edge.ey}`) ?? [];
      const dx = edge.ex - edge.sx;
      const dy = edge.ey - edge.sy;
      let best = -1;
      let bestRank = -1;
      for (const candidate of candidates) {
        if (used[candidate]) continue;
        const next = edges[candidate];
        const cx = next.ex - next.sx;
        const cy = next.ey - next.sy;
        const cross = dx * cy - dy * cx;
        // Right turn, then straight, then left. Never double back.
        const rank = cross > 0 ? 3 : cross === 0 ? 2 : 1;
        if (cx === -dx && cy === -dy) continue;
        if (rank > bestRank) {
          bestRank = rank;
          best = candidate;
        }
      }
      if (best < 0) break;
      current = best;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function signedArea(points: readonly { x: number; y: number }[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
}

/**
 * Collapses collinear runs, but only across vertices whose opposing terrain is
 * unchanged — a material change is a real corner even when the geometry runs
 * straight, and ZK-469 needs it to switch contour profiles there.
 */
function mergeCollinear(ring: readonly RingVertex[]): RingVertex[] {
  const merged: RingVertex[] = [];
  const count = ring.length;
  for (let index = 0; index < count; index++) {
    const previous = ring[(index - 1 + count) % count];
    const current = ring[index];
    const next = ring[(index + 1) % count];
    const inX = current.x - previous.x;
    const inY = current.y - previous.y;
    const outX = next.x - current.x;
    const outY = next.y - current.y;
    const collinear = inX * outY - inY * outX === 0;
    if (collinear && previous.other === current.other) continue;
    merged.push(current);
  }
  return merged.length >= 3 ? merged : ring.map((vertex) => ({ ...vertex }));
}

/**
 * Quadratic arc between the two cut points, evaluated with the endpoints in a
 * canonical order so that a ring and its mirror across a shared boundary
 * produce the same floating-point values before quantization.
 */
function cornerArc(
  entry: SurfacePoint,
  corner: SurfacePoint,
  exit: SurfacePoint,
): SurfacePoint[] {
  const flipped =
    entry.x > exit.x || (entry.x === exit.x && entry.y > exit.y);
  const a = flipped ? exit : entry;
  const b = flipped ? entry : exit;
  const points: SurfacePoint[] = [];
  for (let step = 0; step <= ARC_SEGMENTS; step++) {
    const t = step / ARC_SEGMENTS;
    const inv = 1 - t;
    points.push(quantizePoint(
      inv * inv * a.x + 2 * inv * t * corner.x + t * t * b.x,
      inv * inv * a.y + 2 * inv * t * corner.y + t * t * b.y,
    ));
  }
  return flipped ? points.reverse() : points;
}

interface RoundedRing {
  points: SurfacePoint[];
  /** Opposing terrain per emitted point, aligned by index. */
  others: (Terrain | null)[];
}

function roundRing(
  ring: readonly RingVertex[],
  tiles: readonly Terrain[],
  width: number,
  height: number,
): RoundedRing {
  const count = ring.length;
  const points: SurfacePoint[] = [];
  const others: (Terrain | null)[] = [];
  const push = (point: SurfacePoint, other: Terrain | null) => {
    const last = points[points.length - 1];
    if (last && samePoint(last, point)) return;
    points.push(point);
    others.push(other);
  };

  for (let index = 0; index < count; index++) {
    const previous = ring[(index - 1 + count) % count];
    const current = ring[index];
    const next = ring[(index + 1) % count];
    const inX = current.x - previous.x;
    const inY = current.y - previous.y;
    const outX = next.x - current.x;
    const outY = next.y - current.y;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    const configured = vertexCornerRadius(tiles, width, height, current.x, current.y);
    // Purely local clamp: half of each incident run. Two adjacent corners can
    // then never overtake one another, and both sides of a shared boundary see
    // the same two runs, so they clamp identically.
    const radius = Math.min(configured, inLength / 2, outLength / 2);
    const straight = inX * outY - inY * outX === 0;
    if (radius <= 0 || straight || inLength === 0 || outLength === 0) {
      push(quantizePoint(current.x, current.y), current.other);
      continue;
    }
    const entry = quantizePoint(
      current.x - (inX / inLength) * radius,
      current.y - (inY / inLength) * radius,
    );
    const exit = quantizePoint(
      current.x + (outX / outLength) * radius,
      current.y + (outY / outLength) * radius,
    );
    const arc = cornerArc(entry, { x: current.x, y: current.y }, exit);
    // A corner arc never straddles a material change: any vertex where a third
    // terrain appears has more than two terrains around it and stays sharp.
    for (const point of arc) push(point, current.other);
  }

  // The closing point may have collapsed onto the opening one.
  while (points.length >= 2 && samePoint(points[0], points[points.length - 1])) {
    points.pop();
    others.pop();
  }
  return { points, others };
}

function segmentsFromRing(terrain: Terrain, ring: RoundedRing): BoundarySegment[] {
  const { points, others } = ring;
  const count = points.length;
  if (count < 2) return [];
  // Start at a material change so a run wrapping the ring's origin stays whole.
  let start = 0;
  for (let index = 0; index < count; index++) {
    if (others[(index - 1 + count) % count] !== others[index]) {
      start = index;
      break;
    }
  }
  const segments: BoundarySegment[] = [];
  let current: BoundarySegment = {
    terrain,
    other: others[start],
    points: [points[start]],
  };
  for (let step = 1; step < count; step++) {
    const index = (start + step) % count;
    // The vertex where the opposing material changes belongs to both runs.
    current.points.push(points[index]);
    if (others[index] !== current.other) {
      segments.push(current);
      current = { terrain, other: others[index], points: [points[index]] };
    }
  }
  current.points.push(points[start]);
  segments.push(current);
  return segments.filter((segment) => segment.points.length >= 2);
}

/**
 * The eight-neighbour halo of a component: every cell touching it that it does
 * not own, ascending. The halo is part of the cache key because a component's
 * geometry depends on its surroundings as well as its own cells — a neighbour
 * repaint re-owns boundary runs and can change corner radii, and a diagonal
 * neighbour alone decides whether a vertex has two terrains around it or three.
 */
function haloCells(
  cells: readonly number[],
  owned: ReadonlySet<number>,
  width: number,
  height: number,
): number[] {
  const halo: number[] = [];
  const seen = new Set<number>();
  for (const index of cells) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (owned.has(neighbor) || seen.has(neighbor)) continue;
        seen.add(neighbor);
        halo.push(neighbor);
      }
    }
  }
  return halo.sort((a, b) => a - b);
}

function topologyKeyFor(
  terrain: Terrain,
  cells: readonly number[],
  halo: readonly number[],
  tiles: readonly Terrain[],
): string {
  // Two independent FNV-1a-style passes; identical inputs always agree, and a
  // collision would need both 32-bit hashes to match at the same cell count.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const fold = (value: number) => {
    a = Math.imul(a ^ (value & 0xff), 0x01000193);
    a = Math.imul(a ^ (value >>> 8), 0x01000193);
    b = Math.imul(b ^ value, 0x85ebca6b);
    b ^= b >>> 13;
  };
  for (const cell of cells) fold(cell);
  fold(0x7fffffff); // separator, so cells and halo cannot alias each other
  for (const cell of halo) {
    fold(cell);
    fold(TERRAIN_BOUNDARY_PRIORITY.indexOf(tiles[cell]) + 1);
  }
  return `${terrain}:${cells.length}:${halo.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}

/**
 * Derives one rounded silhouette per 4-connected same-terrain component.
 * Components are returned in ascending seed-cell order, which is stable across
 * reload, undo/redo, rotation, and chunk rebuilds because it only depends on
 * the tile array.
 */
export function buildTerrainComponents(
  tiles: readonly Terrain[],
  width: number,
  height: number,
): TerrainComponent[] {
  if (width <= 0 || height <= 0 || tiles.length !== width * height) return [];
  const visited = new Uint8Array(tiles.length);
  const components: TerrainComponent[] = [];

  for (let seed = 0; seed < tiles.length; seed++) {
    if (visited[seed]) continue;
    const terrain = tiles[seed];
    const queue = [seed];
    visited[seed] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (visited[neighbor] || tiles[neighbor] !== terrain) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    const cells = queue.slice().sort((a, b) => a - b);
    const owned = new Set(cells);

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (const index of cells) {
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + 1 > maxX) maxX = x + 1;
      if (y + 1 > maxY) maxY = y + 1;
    }

    const traced = chainRings(componentHalfEdges(cells, owned, tiles, width, height));
    const rings: SilhouetteRing[] = [];
    const boundarySegments: BoundarySegment[] = [];
    for (const raw of traced) {
      const rounded = roundRing(mergeCollinear(raw), tiles, width, height);
      if (rounded.points.length < 3) continue;
      const area = signedArea(rounded.points);
      rings.push({
        kind: area >= 0 ? "outer" : "hole",
        points: rounded.points,
        signedArea: area,
      });
      boundarySegments.push(...segmentsFromRing(terrain, rounded));
    }
    // Outer rings first so a mask can fill then cut.
    rings.sort((a, b) => b.signedArea - a.signedArea);

    components.push({
      terrain,
      cells,
      rings,
      boundarySegments,
      bounds: { minX, minY, maxX, maxY },
      topologyKey: topologyKeyFor(
        terrain,
        cells,
        haloCells(cells, owned, width, height),
        tiles,
      ),
    });
  }
  return components;
}

/** Even–odd containment test against a rounded ring, in tile space. */
export function ringContains(ring: readonly SurfacePoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      (a.y > y) !== (b.y > y) &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    ) inside = !inside;
  }
  return inside;
}

/** True when the point lies inside the component's outer rings and outside its holes. */
export function componentContains(
  component: TerrainComponent,
  x: number,
  y: number,
): boolean {
  let winding = 0;
  for (const ring of component.rings) {
    if (!ringContains(ring.points, x, y)) continue;
    winding += ring.kind === "outer" ? 1 : -1;
  }
  return winding > 0;
}

/**
 * Rasterizes a component's silhouette into the 4× presentation grid. Rendering
 * never needs this — it exists so fixtures can assert coverage and topology
 * against the mask the renderer actually fills.
 */
export function rasterizePresentationMask(
  component: TerrainComponent,
  width: number,
  height: number,
  scale: number = PRESENTATION_SCALE,
): Uint8Array {
  const mask = new Uint8Array(width * scale * height * scale);
  const { minX, minY, maxX, maxY } = component.bounds;
  const x0 = Math.max(0, Math.floor((minX - 1) * scale));
  const x1 = Math.min(width * scale, Math.ceil((maxX + 1) * scale));
  const y0 = Math.max(0, Math.floor((minY - 1) * scale));
  const y1 = Math.min(height * scale, Math.ceil((maxY + 1) * scale));
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      const wx = (sx + 0.5) / scale;
      const wy = (sy + 0.5) / scale;
      if (componentContains(component, wx, wy)) mask[sy * width * scale + sx] = 1;
    }
  }
  return mask;
}

export interface SilhouetteCacheStats {
  hits: number;
  misses: number;
  components: number;
}

export interface SilhouetteSnapshot {
  components: TerrainComponent[];
  /** Components whose geometry changed since the previous update. */
  changed: TerrainComponent[];
  stats: SilhouetteCacheStats;
}

/**
 * Caches derived geometry by component topology. A repaint that does not alter
 * a component's cell set reuses its rings verbatim, and `changed` reports the
 * bounds a caller should mark dirty.
 */
export interface SilhouetteCache {
  update(tiles: readonly Terrain[], width: number, height: number): SilhouetteSnapshot;
  clear(): void;
}

export function createSilhouetteCache(): SilhouetteCache {
  let previous = new Map<string, TerrainComponent>();
  return {
    update(tiles, width, height) {
      const derived = buildTerrainComponents(tiles, width, height);
      const next = new Map<string, TerrainComponent>();
      const components: TerrainComponent[] = [];
      const changed: TerrainComponent[] = [];
      let hits = 0;
      for (const component of derived) {
        const cached = previous.get(component.topologyKey);
        const resolved = cached ?? component;
        if (cached) hits++;
        else changed.push(component);
        next.set(component.topologyKey, resolved);
        components.push(resolved);
      }
      previous = next;
      return {
        components,
        changed,
        stats: { hits, misses: changed.length, components: components.length },
      };
    },
    clear() {
      previous = new Map();
    },
  };
}
