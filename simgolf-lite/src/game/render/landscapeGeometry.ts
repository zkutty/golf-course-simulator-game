import { buildingTiles } from "../models/buildings";
import type { Course, LandTheme, SurfacePoint, Terrain } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";
import { terrainSurfaceInsetPx } from "./terrainRelief";
import { ELEVATION_STEP_PX } from "./iso";
import { buildSharedBoundaryContours } from "./sharedBoundaryContours";
import { buildLandscapeMeshCellSet } from "./landscapeMeshGeometry";
import {
  hazardDepthOffsets,
  hazardDepthProfile,
  hazardInteriorDropAt,
} from "./hazardDepth";

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
  /** Render-only one-cell halo for canonical displaced non-path seams. */
  presentationCells: readonly number[];
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

export interface RecessedLandformRibbonPoint {
  top: SurfacePoint;
  bottom: SurfacePoint;
  topHeight: number;
  bottomHeight: number;
}

export interface HazardDepthSectionPoint extends SurfacePoint {
  height: number;
}

export interface HazardDepthSectionSegment {
  shelfOuterA: HazardDepthSectionPoint;
  shelfOuterB: HazardDepthSectionPoint;
  boundaryA: HazardDepthSectionPoint;
  boundaryB: HazardDepthSectionPoint;
  bankInnerA: HazardDepthSectionPoint;
  bankInnerB: HazardDepthSectionPoint;
  contactInnerA: HazardDepthSectionPoint;
  contactInnerB: HazardDepthSectionPoint;
  shallowInnerA: HazardDepthSectionPoint;
  shallowInnerB: HazardDepthSectionPoint;
  deepInnerA: HazardDepthSectionPoint;
  deepInnerB: HazardDepthSectionPoint;
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
  /** Presentation geometry also depends on the immediate terrain halo. */
  boundaryContextKey: string;
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
      boundaryContextKey: "",
    });
  }
  for (const component of components) {
    const owned = new Set(component.cells);
    const halo = new Set<number>();
    for (const index of component.cells) {
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (!owned.has(neighbor)) halo.add(neighbor);
      }
    }
    component.boundaryContextKey = fnv1a([...halo]
      .sort((a, b) => a - b)
      .map((index) => `${index}:${tiles[index]}`)
      .join("|"));
  }
  return components;
}

function materializeLandscapeComponent(
  skeleton: LandscapeComponentSkeleton,
  width: number,
  height: number,
  options: LandscapeOptions,
  sharedRings?: readonly (readonly SurfacePoint[])[],
): LandscapeComponent {
  // The path compositor consumes the accepted ring verbatim. Other materials
  // use the grid-wide shared boundary contract so the two sides of a seam can
  // never expose independently rounded cell tips.
  const rings = (skeleton.terrain === "path" || !sharedRings
    ? traceComponentRings(skeleton.cells, width, height).map((ring) => roundLandscapeRing(
        ring,
        options.cornerRadius ?? 0.36,
        options.cornerSegments ?? 3,
      ))
    : sharedRings.map((ring) => ring.map((point) => ({ ...point }))))
    .sort((a, b) => Math.abs(ringSignedArea(b)) - Math.abs(ringSignedArea(a)));
  return {
    terrain: skeleton.terrain,
    cells: skeleton.cells,
    presentationCells: buildLandscapeMeshCellSet(
      skeleton.cells,
      skeleton.terrain,
      width,
      height,
    ).presentationCells,
    bounds: skeleton.bounds,
    topologyKey: skeleton.topologyKey,
    rings,
  };
}

function sharedRingsForSkeletons(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  skeletons: readonly LandscapeComponentSkeleton[],
  options: LandscapeOptions,
): ReadonlyMap<number, SurfacePoint[][]> {
  return buildSharedBoundaryContours(
    tiles,
    width,
    height,
    skeletons.map((skeleton, id) => ({ id, terrain: skeleton.terrain, cells: skeleton.cells })),
    {
      cornerRadius: options.cornerRadius ?? 0.36,
      cornerSegments: options.cornerSegments ?? 3,
    },
  ).ringsByComponent;
}

export function buildLandscapeComponents(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  options: LandscapeOptions = {},
): LandscapeComponent[] {
  const skeletons = buildLandscapeComponentSkeletons(tiles, width, height);
  const sharedRings = sharedRingsForSkeletons(tiles, width, height, skeletons, options);
  return skeletons.map((skeleton, index) => materializeLandscapeComponent(
    skeleton,
    width,
    height,
    options,
    sharedRings.get(index),
  ));
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
      const sharedRings = sharedRingsForSkeletons(tiles, width, height, skeletons, options);
      const components: LandscapeComponent[] = [];
      const changed: LandscapeComponent[] = [];
      let hits = 0;
      const next = new Map<string, LandscapeComponent>();
      for (let index = 0; index < skeletons.length; index++) {
        const skeleton = skeletons[index];
        const key = `${styleKey}:${skeleton.topologyKey}:${skeleton.boundaryContextKey}`;
        const cached = previous.get(key);
        if (cached) {
          hits++;
          components.push(cached);
          next.set(key, cached);
        } else {
          const component = materializeLandscapeComponent(
            skeleton,
            width,
            height,
            options,
            sharedRings.get(index),
          );
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

const HEIGHTFIELD_PROFILES: Record<LandTheme, {
  amplitude: number;
  phase: number;
  smoothingStrength: number;
}> = {
  parkland: { amplitude: 0.11, phase: 2.1, smoothingStrength: 0.26 },
  links: { amplitude: 0.24, phase: 0.7, smoothingStrength: 0.34 },
  desert: { amplitude: 0.075, phase: 4.2, smoothingStrength: 0.18 },
};

function biomeUndulation(theme: LandTheme, x: number, y: number): number {
  const { amplitude, phase } = HEIGHTFIELD_PROFILES[theme];
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
  theme: LandTheme = getBiomeDefinition(course.theme).key,
): VisualHeightfield {
  const materialOwner = getBiomeDefinition(theme).content.materials.terrain;
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
  const smoothingStrength = HEIGHTFIELD_PROFILES[materialOwner].smoothingStrength;
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
      vertices[index] += biomeUndulation(materialOwner, vx, vy);
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
 * Samples shared presentation height plus interior shaping. Legacy/Low sand
 * eases down from the tile boundary. Connected Medium/High hazards opt into
 * a floor whose bank is owned by the joined organic ring. Meshes, masks and
 * grounded objects use the same sampler, without changing simulation data.
 */
export function sampleLandscapeSurfaceHeight(
  field: VisualHeightfield,
  component: LandscapeComponent | null | undefined,
  x: number,
  y: number,
  recessedHazards = false,
): number {
  const base = sampleVisualHeight(field, x, y);
  // The connected Medium/High floor, its mask, bank feet and grounded objects
  // consume this same level. Its inward ring owns the sloping bank, so floor
  // vertices must not ease back up against a different, tile-snapped boundary.
  // Low retains the accepted legacy surface and its original smoothstep.
  if (recessedHazards && component) {
    const profile = hazardDepthProfile(component.terrain, component.cells.length);
    if (profile) return base - (component.terrain === "sand" ? profile.floorDrop : profile.minimumBankDrop);
  }
  if (component?.terrain !== "sand") return base;
  const point = { x, y };
  if (!pointInLandscapeComponent(component, point)) return base;
  const boundaryDistance = distanceToLandscapeBoundary(component, point);
  if (!Number.isFinite(boundaryDistance) || boundaryDistance <= 0) return base;
  const profile = hazardDepthProfile(component.terrain, component.cells.length);
  return profile ? base - hazardInteriorDropAt(profile, boundaryDistance) : base;
}

const boundedPoint = (
  field: VisualHeightfield,
  point: SurfacePoint,
): SurfacePoint => ({
  x: Math.max(0, Math.min(field.width, point.x)),
  y: Math.max(0, Math.min(field.height, point.y)),
});

/**
 * Edge-local hazard sections consume the accepted shared contour verbatim.
 * Each contour edge receives its own parallel offsets, so concave turns cannot
 * create mitres, fins, or inverted quads. The result contains no camera or
 * ecology state and is therefore identical under every view rotation.
 */
export function buildHazardDepthSections(
  field: VisualHeightfield,
  component: LandscapeComponent,
  ring: readonly SurfacePoint[],
): HazardDepthSectionSegment[] {
  const profile = hazardDepthProfile(component.terrain, component.cells.length);
  if (!profile || ring.length < 3) return [];
  const sections: HazardDepthSectionSegment[] = [];
  const atOffset = (
    point: SurfacePoint,
    inward: SurfacePoint,
    offset: number,
    height: number,
  ): HazardDepthSectionPoint => ({
    ...boundedPoint(field, {
      x: point.x + inward.x * offset,
      y: point.y + inward.y * offset,
    }),
    height,
  });

  for (let index = 0; index < ring.length; index++) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edgeLength = Math.hypot(dx, dy);
    if (!Number.isFinite(edgeLength) || edgeLength <= 1e-6) continue;
    const candidate = { x: -dy / edgeLength, y: dx / edgeLength };
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const probe = { x: midpoint.x + candidate.x * 0.04, y: midpoint.y + candidate.y * 0.04 };
    const inward = pointInLandscapeComponent(component, probe)
      ? candidate
      : { x: -candidate.x, y: -candidate.y };
    const offsets = hazardDepthOffsets(profile, edgeLength);
    const shelfSampleA = boundedPoint(field, {
      x: a.x + inward.x * offsets.shelfOuter,
      y: a.y + inward.y * offsets.shelfOuter,
    });
    const shelfSampleB = boundedPoint(field, {
      x: b.x + inward.x * offsets.shelfOuter,
      y: b.y + inward.y * offsets.shelfOuter,
    });
    const shelfHeightA = sampleVisualHeight(field, shelfSampleA.x, shelfSampleA.y);
    const shelfHeightB = sampleVisualHeight(field, shelfSampleB.x, shelfSampleB.y);
    const floorSampleA = boundedPoint(field, {
      x: a.x + inward.x * offsets.deepInner,
      y: a.y + inward.y * offsets.deepInner,
    });
    const floorSampleB = boundedPoint(field, {
      x: b.x + inward.x * offsets.deepInner,
      y: b.y + inward.y * offsets.deepInner,
    });
    const sampledFloorA = sampleLandscapeSurfaceHeight(field, component, floorSampleA.x, floorSampleA.y);
    const sampledFloorB = sampleLandscapeSurfaceHeight(field, component, floorSampleB.x, floorSampleB.y);
    const floorHeightA = Math.min(sampledFloorA, shelfHeightA - profile.minimumBankDrop);
    const floorHeightB = Math.min(sampledFloorB, shelfHeightB - profile.minimumBankDrop);
    sections.push({
      shelfOuterA: atOffset(a, inward, offsets.shelfOuter, shelfHeightA),
      shelfOuterB: atOffset(b, inward, offsets.shelfOuter, shelfHeightB),
      boundaryA: atOffset(a, inward, offsets.boundary, shelfHeightA),
      boundaryB: atOffset(b, inward, offsets.boundary, shelfHeightB),
      bankInnerA: atOffset(a, inward, offsets.bankInner, floorHeightA),
      bankInnerB: atOffset(b, inward, offsets.bankInner, floorHeightB),
      contactInnerA: atOffset(a, inward, offsets.contactInner, floorHeightA),
      contactInnerB: atOffset(b, inward, offsets.contactInner, floorHeightB),
      shallowInnerA: atOffset(a, inward, offsets.shallowInner, floorHeightA),
      shallowInnerB: atOffset(b, inward, offsets.shallowInner, floorHeightB),
      deepInnerA: atOffset(a, inward, offsets.deepInner, floorHeightA),
      deepInnerB: atOffset(b, inward, offsets.deepInner, floorHeightB),
    });
  }
  return sections;
}

/**
 * Builds a continuous shoulder-to-floor ribbon around a recessed material.
 * Normals are derived from the rounded component ring, not tile adjacency,
 * and heights come from the shared field. The result is rotation-agnostic
 * world geometry suitable for one connected bank/lip mesh.
 */
export function buildRecessedLandformRibbon(
  field: VisualHeightfield,
  component: LandscapeComponent,
  ring: readonly SurfacePoint[],
): RecessedLandformRibbonPoint[] {
  if (ring.length < 3 || (component.terrain !== "water" && component.terrain !== "wetland" && component.terrain !== "sand")) return [];
  const topWidth = component.terrain === "sand" ? 0.16 : 0.38;
  const bottomWidth = component.terrain === "sand" ? 0.34 : 0.12;
  const minimumDrop = component.terrain === "sand" ? 0.38 : 0.52;
  const points: RecessedLandformRibbonPoint[] = [];

  for (let index = 0; index < ring.length; index++) {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    const point = ring[index];
    const next = ring[(index + 1) % ring.length];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const tangentLength = Math.max(1e-6, Math.hypot(tangentX, tangentY));
    const candidate = { x: tangentY / tangentLength, y: -tangentX / tangentLength };
    const probe = { x: point.x + candidate.x * 0.08, y: point.y + candidate.y * 0.08 };
    const candidateIsInside = pointInLandscapeComponent(component, probe);
    const outward = candidateIsInside
      ? { x: -candidate.x, y: -candidate.y }
      : candidate;
    const top = {
      x: Math.max(0, Math.min(field.width, point.x + outward.x * topWidth)),
      y: Math.max(0, Math.min(field.height, point.y + outward.y * topWidth)),
    };
    const bottom = {
      x: Math.max(0, Math.min(field.width, point.x - outward.x * bottomWidth)),
      y: Math.max(0, Math.min(field.height, point.y - outward.y * bottomWidth)),
    };
    const sampledBottom = sampleLandscapeSurfaceHeight(field, component, bottom.x, bottom.y);
    const sampledTop = sampleVisualHeight(field, top.x, top.y);
    points.push({
      top,
      bottom,
      topHeight: Math.max(sampledTop, sampledBottom + minimumDrop),
      bottomHeight: sampledBottom,
    });
  }
  return points;
}
