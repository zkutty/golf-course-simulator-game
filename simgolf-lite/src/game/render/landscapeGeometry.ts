import { buildingTiles } from "../models/buildings";
import type { Course, LandTheme, SurfacePoint, Terrain } from "../models/types";
import { terrainSurfaceInsetPx } from "./terrainRelief";
import { ELEVATION_STEP_PX } from "./iso";

export interface LandscapeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LandscapeComponent {
  terrain: Terrain;
  /** Sorted row-major authoritative cells in this connected component. */
  cells: number[];
  /** Rounded outer and hole rings in world tile coordinates. */
  rings: SurfacePoint[][];
  bounds: LandscapeBounds;
  /** Stable across camera rotations and non-topological simulation changes. */
  topologyKey: string;
}

export interface LandscapeOptions {
  /**
   * World-tile corner radius. Values at or below 0 retain the exact tile
   * union; values above 0.5 are clamped so one-tile corridors cannot fold.
   */
  cornerRadius?: number;
  /** Samples per rounded corner, excluding the incoming tangent. */
  cornerSegments?: number;
}

export interface LandscapeComponentCacheStats {
  hits: number;
  misses: number;
  components: number;
}

export interface LandscapeComponentCacheSnapshot {
  components: LandscapeComponent[];
  /** Components whose topology or presentation geometry changed. */
  changed: LandscapeComponent[];
  stats: LandscapeComponentCacheStats;
}

export interface LandscapeComponentCache {
  update(
    tiles: readonly Terrain[],
    width: number,
    height: number,
    options?: LandscapeOptions,
  ): LandscapeComponentCacheSnapshot;
  clear(): void;
}

export interface VisualHeightfield {
  width: number;
  height: number;
  /** Row-major shared vertices, `(width + 1) * (height + 1)` entries. */
  vertices: Float32Array;
}

interface DirectedEdge {
  start: SurfacePoint;
  end: SurfacePoint;
  direction: 0 | 1 | 2 | 3;
}

const CARDINALS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
] as const;

const pointKey = (point: SurfacePoint) => `${point.x},${point.y}`;

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function ringSignedArea(ring: readonly SurfacePoint[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const point = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
}

export function pointInLandscapeRing(
  ring: readonly SurfacePoint[],
  point: SurfacePoint,
): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    ) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(
  point: SurfacePoint,
  start: SurfacePoint,
  end: SurfacePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx + (point.y - start.y) * dy
  ) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + dx * t),
    point.y - (start.y + dy * t),
  );
}

function pointInLandscapeComponent(
  component: LandscapeComponent,
  point: SurfacePoint,
): boolean {
  let containingRings = 0;
  for (const ring of component.rings) {
    if (pointInLandscapeRing(ring, point)) containingRings++;
  }
  return containingRings % 2 === 1;
}

function distanceToLandscapeBoundary(
  component: LandscapeComponent,
  point: SurfacePoint,
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const ring of component.rings) {
    for (let index = 0; index < ring.length; index++) {
      distance = Math.min(distance, pointToSegmentDistance(
        point,
        ring[index],
        ring[(index + 1) % ring.length],
      ));
    }
  }
  return distance;
}

/**
 * Replaces orthogonal corners with bounded quadratic arcs. Every tangent
 * remains on the original edge and the radius is capped below half of the
 * adjacent edges, preserving one-cell corridors and hole topology.
 */
export function roundLandscapeRing(
  ring: readonly SurfacePoint[],
  radius = 0.36,
  cornerSegments = 3,
): SurfacePoint[] {
  if (ring.length < 3 || radius <= 0) return ring.map((point) => ({ ...point }));
  const requestedRadius = Math.min(0.49, Math.max(0, radius));
  const samples = Math.max(1, Math.min(8, Math.round(cornerSegments)));
  const rounded: SurfacePoint[] = [];
  for (let index = 0; index < ring.length; index++) {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
    if (incomingLength <= 1e-6 || outgoingLength <= 1e-6) continue;
    const localRadius = Math.min(
      requestedRadius,
      incomingLength * 0.49,
      outgoingLength * 0.49,
    );
    const incoming = {
      x: current.x + (previous.x - current.x) / incomingLength * localRadius,
      y: current.y + (previous.y - current.y) / incomingLength * localRadius,
    };
    const outgoing = {
      x: current.x + (next.x - current.x) / outgoingLength * localRadius,
      y: current.y + (next.y - current.y) / outgoingLength * localRadius,
    };
    rounded.push(incoming);
    for (let sample = 1; sample <= samples; sample++) {
      const t = sample / samples;
      const inverse = 1 - t;
      rounded.push({
        x: inverse * inverse * incoming.x + 2 * inverse * t * current.x + t * t * outgoing.x,
        y: inverse * inverse * incoming.y + 2 * inverse * t * current.y + t * t * outgoing.y,
      });
    }
  }
  return rounded;
}

function traceComponentRings(
  cells: readonly number[],
  width: number,
  height: number,
): SurfacePoint[][] {
  const inComponent = new Set(cells);
  const edges: DirectedEdge[] = [];
  const contains = (x: number, y: number) => (
    x >= 0 && y >= 0 && x < width && y < height &&
    inComponent.has(y * width + x)
  );
  for (const index of cells) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (!contains(x, y - 1)) {
      edges.push({ start: { x, y }, end: { x: x + 1, y }, direction: 0 });
    }
    if (!contains(x + 1, y)) {
      edges.push({ start: { x: x + 1, y }, end: { x: x + 1, y: y + 1 }, direction: 1 });
    }
    if (!contains(x, y + 1)) {
      edges.push({ start: { x: x + 1, y: y + 1 }, end: { x, y: y + 1 }, direction: 2 });
    }
    if (!contains(x - 1, y)) {
      edges.push({ start: { x, y: y + 1 }, end: { x, y }, direction: 3 });
    }
  }

  const byStart = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const candidates = byStart.get(pointKey(edge.start)) ?? [];
    candidates.push(index);
    byStart.set(pointKey(edge.start), candidates);
  });
  const unused = new Set(edges.map((_, index) => index));
  const rings: SurfacePoint[][] = [];
  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    const first = edges[firstIndex];
    const ring: SurfacePoint[] = [{ ...first.start }];
    let currentIndex = firstIndex;
    while (unused.delete(currentIndex)) {
      const current = edges[currentIndex];
      if (pointKey(current.end) === pointKey(first.start)) break;
      ring.push({ ...current.end });
      const candidates = (byStart.get(pointKey(current.end)) ?? [])
        .filter((candidate) => unused.has(candidate));
      if (candidates.length === 0) break;
      // Directed cell edges keep filled space on their right. At a kissing
      // vertex, the right-most continuation prevents unrelated rings from
      // being stitched together.
      const turnPriority = [1, 0, 3, 2];
      candidates.sort((a, b) => {
        const turnA = (edges[a].direction - current.direction + 4) % 4;
        const turnB = (edges[b].direction - current.direction + 4) % 4;
        return turnPriority.indexOf(turnA) - turnPriority.indexOf(turnB);
      });
      currentIndex = candidates[0];
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

interface LandscapeComponentSkeleton {
  terrain: Terrain;
  cells: number[];
  bounds: LandscapeBounds;
  topologyKey: string;
}

function buildLandscapeComponentSkeletons(
  tiles: readonly Terrain[],
  width: number,
  height: number,
): LandscapeComponentSkeleton[] {
  if (width <= 0 || height <= 0 || tiles.length !== width * height) return [];
  const visited = new Uint8Array(tiles.length);
  const components: LandscapeComponentSkeleton[] = [];
  for (let seed = 0; seed < tiles.length; seed++) {
    if (visited[seed]) continue;
    const terrain = tiles[seed];
    const cells: number[] = [];
    const queue = [seed];
    visited[seed] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      cells.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const { dx, dy } of CARDINALS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (visited[neighbor] || tiles[neighbor] !== terrain) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    cells.sort((a, b) => a - b);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (const index of cells) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
    }
    components.push({
      terrain,
      cells,
      bounds: { minX, minY, maxX, maxY },
      topologyKey: `${terrain}-${fnv1a(`${width}x${height}:${cells.join(",")}`)}`,
    });
  }
  return components;
}

function materializeLandscapeComponent(
  skeleton: LandscapeComponentSkeleton,
  width: number,
  height: number,
  options: LandscapeOptions,
): LandscapeComponent {
  const exactRings = traceComponentRings(skeleton.cells, width, height);
  const rings = exactRings
    .map((ring) => roundLandscapeRing(
      ring,
      options.cornerRadius ?? 0.36,
      options.cornerSegments ?? 3,
    ))
    .sort((a, b) => Math.abs(ringSignedArea(b)) - Math.abs(ringSignedArea(a)));
  return { ...skeleton, rings };
}

export function buildLandscapeComponents(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  options: LandscapeOptions = {},
): LandscapeComponent[] {
  return buildLandscapeComponentSkeletons(tiles, width, height)
    .map((skeleton) => materializeLandscapeComponent(skeleton, width, height, options));
}

/**
 * Reuses rounded component geometry across dirty terrain updates. The flood
 * fill still runs for the authoritative tile array, but unchanged component
 * topology skips ring tracing and rounding. Presentation options are part of
 * the cache namespace because quality tiers intentionally use different
 * corner sampling.
 */
export function createLandscapeComponentCache(): LandscapeComponentCache {
  let previous = new Map<string, LandscapeComponent>();
  return {
    update(tiles, width, height, options = {}) {
      const styleKey = `${width}x${height}:${options.cornerRadius ?? 0.36}:${options.cornerSegments ?? 3}`;
      const skeletons = buildLandscapeComponentSkeletons(tiles, width, height);
      const components: LandscapeComponent[] = [];
      const changed: LandscapeComponent[] = [];
      let hits = 0;
      const next = new Map<string, LandscapeComponent>();
      for (const skeleton of skeletons) {
        const key = `${styleKey}:${skeleton.topologyKey}`;
        const cached = previous.get(key);
        if (cached) {
          hits++;
          components.push(cached);
          next.set(key, cached);
        } else {
          const component = materializeLandscapeComponent(skeleton, width, height, options);
          changed.push(component);
          components.push(component);
          next.set(key, component);
        }
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

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function terrainTargetHeight(course: Course, index: number): number {
  const terrain = course.tiles[index];
  return (course.elevations[index] ?? 0) -
    terrainSurfaceInsetPx(terrain) / ELEVATION_STEP_PX;
}

function biomeUndulation(theme: LandTheme, x: number, y: number): number {
  const amplitude = theme === "links" ? 0.24 : theme === "parkland" ? 0.11 : 0.075;
  const phase = theme === "links" ? 0.7 : theme === "parkland" ? 2.1 : 4.2;
  const longWave = Math.sin(x * 0.22 + y * 0.105 + phase);
  const crossingWave = Math.sin(x * -0.095 + y * 0.19 + phase * 1.7);
  return amplitude * (longWave * 0.64 + crossingWave * 0.36);
}

function supportsBiomeUndulation(
  course: Course,
  vx: number,
  vy: number,
): boolean {
  let hasLand = false;
  for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
    const x = vx + dx;
    const y = vy + dy;
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) continue;
    const terrain = course.tiles[y * course.width + x];
    if (terrain === "water" || terrain === "wetland") return false;
    hasLand = true;
  }
  return hasLand;
}

interface FlatGroup {
  cells: number[];
  target: number;
  priority: number;
}

function deriveFlatGroups(course: Course): FlatGroup[] {
  const groups: FlatGroup[] = [];
  const components = buildLandscapeComponents(course.tiles, course.width, course.height, {
    cornerRadius: 0,
  });
  for (const component of components) {
    if (
      component.terrain !== "water" &&
      component.terrain !== "wetland" &&
      component.terrain !== "green" &&
      component.terrain !== "tee"
    ) continue;
    const elevations = component.cells.map((index) => course.elevations[index] ?? 0);
    const inset = terrainSurfaceInsetPx(component.terrain) / ELEVATION_STEP_PX;
    groups.push({
      cells: component.cells,
      target: median(elevations) - inset,
      priority: component.terrain === "water" || component.terrain === "wetland" ? 2 : 3,
    });
  }
  for (const building of course.buildings ?? []) {
    const cells = buildingTiles(building)
      .filter(({ x, y }) => x >= 0 && y >= 0 && x < course.width && y < course.height)
      .map(({ x, y }) => y * course.width + x);
    if (cells.length === 0) continue;
    groups.push({
      cells,
      target: median(cells.map((index) => course.elevations[index] ?? 0)),
      priority: 4,
    });
  }
  for (const asset of course.property?.assets ?? []) {
    if (!asset.enabled) continue;
    const cells: number[] = [];
    for (let y = Math.floor(asset.y); y < Math.ceil(asset.y + asset.height); y++) {
      for (let x = Math.floor(asset.x); x < Math.ceil(asset.x + asset.width); x++) {
        if (x < 0 || y < 0 || x >= course.width || y >= course.height) continue;
        cells.push(y * course.width + x);
      }
    }
    if (cells.length === 0) continue;
    groups.push({
      cells,
      target: median(cells.map((index) => course.elevations[index] ?? 0)),
      priority: 4,
    });
  }
  return groups;
}

/**
 * Produces one presentation-only shared-vertex field from authoritative
 * integer tile elevations. Compatible slopes are gently averaged, while
 * water, tee/green components, and building footprints are levelled as
 * visual pads. No gameplay/economic data is mutated.
 */
export function buildVisualHeightfield(
  course: Course,
  theme: LandTheme = course.theme ?? "parkland",
): VisualHeightfield {
  const width = course.width;
  const height = course.height;
  const stride = width + 1;
  const vertices = new Float32Array((width + 1) * (height + 1));
  const targets = new Float32Array(width * height);
  for (let index = 0; index < targets.length; index++) {
    targets[index] = terrainTargetHeight(course, index);
  }

  const flatGroups = deriveFlatGroups(course);
  for (const group of flatGroups) {
    for (const index of group.cells) targets[index] = group.target;
  }

  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const adjacent: number[] = [];
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const x = vx + dx;
        const y = vy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        adjacent.push(targets[y * width + x]);
      }
      if (adjacent.length === 0) continue;
      const low = Math.min(...adjacent);
      const high = Math.max(...adjacent);
      // Preserve authored cliff steps; otherwise use a shared averaged vertex.
      vertices[vy * stride + vx] = high - low > 1.5 ? median(adjacent) :
        adjacent.reduce((sum, value) => sum + value, 0) / adjacent.length;
    }
  }

  // Theme profiles alter only the compatible-land smoothing strength.
  const smoothingStrength = theme === "links" ? 0.34 : theme === "parkland" ? 0.26 : 0.18;
  const smoothed = vertices.slice();
  for (let vy = 1; vy < height; vy++) {
    for (let vx = 1; vx < width; vx++) {
      const index = vy * stride + vx;
      const neighborhood = [
        vertices[index],
        vertices[index - 1],
        vertices[index + 1],
        vertices[index - stride],
        vertices[index + stride],
      ];
      if (Math.max(...neighborhood) - Math.min(...neighborhood) > 1.5) continue;
      const average = neighborhood.reduce((sum, value) => sum + value, 0) / neighborhood.length;
      smoothed[index] = vertices[index] * (1 - smoothingStrength) + average * smoothingStrength;
    }
  }
  vertices.set(smoothed);

  // Add a low-amplitude, long-wavelength presentation field only across
  // compatible land. Links receives the clearest dune roll; Parkland and
  // Desert retain quieter shaping. Flat pads are enforced afterward.
  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const index = vy * stride + vx;
      if (!supportsBiomeUndulation(course, vx, vy)) continue;
      const neighborhood = [
        vertices[index],
        vx > 0 ? vertices[index - 1] : vertices[index],
        vx < width ? vertices[index + 1] : vertices[index],
        vy > 0 ? vertices[index - stride] : vertices[index],
        vy < height ? vertices[index + stride] : vertices[index],
      ];
      if (Math.max(...neighborhood) - Math.min(...neighborhood) > 1.5) continue;
      vertices[index] += biomeUndulation(theme, vx, vy);
    }
  }

  // Enforce flat presentation pads last. Vertices are shared, so adjacent
  // land naturally shoulders down to water and up to structures without gaps.
  const lockPriority = new Int8Array(vertices.length);
  for (const group of flatGroups.sort((a, b) => a.priority - b.priority)) {
    for (const cell of group.cells) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (const vertex of [
        y * stride + x,
        y * stride + x + 1,
        (y + 1) * stride + x,
        (y + 1) * stride + x + 1,
      ]) {
        if (lockPriority[vertex] > group.priority) continue;
        vertices[vertex] = group.target;
        lockPriority[vertex] = group.priority;
      }
    }
  }

  return { width, height, vertices };
}

/** Bilinear presentation-height sampling for props, markers, and golfers. */
export function sampleVisualHeight(
  field: VisualHeightfield,
  x: number,
  y: number,
): number {
  const cx = Math.max(0, Math.min(field.width, x));
  const cy = Math.max(0, Math.min(field.height, y));
  const x0 = Math.min(field.width - 1, Math.max(0, Math.floor(cx)));
  const y0 = Math.min(field.height - 1, Math.max(0, Math.floor(cy)));
  const x1 = Math.min(field.width, x0 + 1);
  const y1 = Math.min(field.height, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const stride = field.width + 1;
  const top = field.vertices[y0 * stride + x0] * (1 - tx) +
    field.vertices[y0 * stride + x1] * tx;
  const bottom = field.vertices[y1 * stride + x0] * (1 - tx) +
    field.vertices[y1 * stride + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Samples the shared field plus terrain-interior shaping that cannot live on
 * shared cell corners. Bunker boundaries remain at the shared land height,
 * while the sand floor eases down toward the component interior. The same
 * helper is used by meshes and world objects, avoiding floating golfers or
 * markers without changing simulation coordinates.
 */
export function sampleLandscapeSurfaceHeight(
  field: VisualHeightfield,
  component: LandscapeComponent | null | undefined,
  x: number,
  y: number,
): number {
  const base = sampleVisualHeight(field, x, y);
  if (component?.terrain !== "sand") return base;
  const point = { x, y };
  if (!pointInLandscapeComponent(component, point)) return base;
  const boundaryDistance = distanceToLandscapeBoundary(component, point);
  if (!Number.isFinite(boundaryDistance) || boundaryDistance <= 0) return base;
  const t = Math.max(0, Math.min(1, boundaryDistance / 0.42));
  const eased = t * t * (3 - 2 * t);
  const maximumDrop = component.cells.length === 1
    ? 0.34
    : component.cells.length <= 4
      ? 0.29
      : 0.24;
  return base - eased * maximumDrop;
}
