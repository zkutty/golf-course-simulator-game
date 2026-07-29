import type { Point, Terrain } from "../models/types";
import type { BunkerVisualType } from "./bunkerShapes";

export type LandscapeEdgeColor =
  | { terrain: Terrain; shade: number }
  | { color: number };

export interface LandscapeEdgeBand {
  width: number;
  color: LandscapeEdgeColor;
  alpha: number;
}

export interface LandscapeEdgeStyle {
  priority: number;
  bands: readonly LandscapeEdgeBand[];
  shoreRocks?: boolean;
}

export interface LandscapeBoundaryRun {
  /** Terrain immediately outside the connected component, or null at the map edge. */
  outsideTerrain: Terrain | null;
  /** Ordered world-space points; closed runs repeat their first point at the end. */
  points: Point[];
}

/**
 * Broad-to-narrow presentation bands for connected terrain components.
 * Widths are deliberately nested: the remaining part of each broader stroke
 * becomes a visible collar around the next material.
 */
const EDGE_STYLES: Partial<Record<Terrain, LandscapeEdgeStyle>> = {
  water: {
    priority: 70,
    shoreRocks: true,
    bands: [
      { width: 9, color: { terrain: "rough", shade: 0.68 }, alpha: 0.7 },
      { width: 6, color: { color: 0x747569 }, alpha: 0.82 },
      { width: 2.8, color: { terrain: "water", shade: 0.7 }, alpha: 0.88 },
      { width: 1, color: { color: 0xe3eee2 }, alpha: 0.34 },
    ],
  },
  wetland: {
    priority: 60,
    bands: [
      { width: 7, color: { terrain: "rough", shade: 0.74 }, alpha: 0.64 },
      { width: 4.5, color: { terrain: "wetland", shade: 0.72 }, alpha: 0.76 },
      { width: 1.6, color: { color: 0x8da76d }, alpha: 0.52 },
    ],
  },
  sand: {
    priority: 50,
    bands: [
      { width: 8, color: { terrain: "rough", shade: 0.72 }, alpha: 0.74 },
      { width: 4.2, color: { terrain: "sand", shade: 0.68 }, alpha: 0.82 },
      { width: 1.2, color: { terrain: "sand", shade: 1.16 }, alpha: 0.6 },
    ],
  },
  path: {
    priority: 40,
    bands: [
      { width: 6, color: { terrain: "rough", shade: 0.7 }, alpha: 0.62 },
      { width: 3.5, color: { terrain: "path", shade: 0.58 }, alpha: 0.74 },
      { width: 1, color: { terrain: "path", shade: 1.12 }, alpha: 0.5 },
    ],
  },
  green: {
    priority: 30,
    bands: [
      { width: 8, color: { terrain: "rough", shade: 0.76 }, alpha: 0.7 },
      { width: 5, color: { terrain: "fairway", shade: 0.9 }, alpha: 0.9 },
      { width: 1.2, color: { terrain: "green", shade: 1.12 }, alpha: 0.52 },
    ],
  },
  tee: {
    priority: 20,
    bands: [
      { width: 6, color: { terrain: "rough", shade: 0.76 }, alpha: 0.66 },
      { width: 2, color: { terrain: "tee", shade: 0.94 }, alpha: 0.56 },
    ],
  },
  fairway: {
    priority: 10,
    bands: [
      { width: 6, color: { terrain: "rough", shade: 0.78 }, alpha: 0.72 },
      { width: 1.6, color: { terrain: "fairway", shade: 0.94 }, alpha: 0.56 },
    ],
  },
  deep_rough: {
    priority: 5,
    bands: [
      { width: 4.5, color: { terrain: "rough", shade: 0.7 }, alpha: 0.62 },
      { width: 1.3, color: { terrain: "deep_rough", shade: 0.82 }, alpha: 0.56 },
    ],
  },
  waste_area: {
    priority: 4,
    bands: [
      { width: 5, color: { terrain: "rough", shade: 0.72 }, alpha: 0.58 },
      { width: 1.4, color: { terrain: "waste_area", shade: 0.82 }, alpha: 0.52 },
    ],
  },
};

const EDGE_OWNER_PRIORITY: Record<Terrain, number> = {
  water: 90,
  wetland: 80,
  sand: 70,
  path: 60,
  green: 50,
  tee: 40,
  fairway: 30,
  deep_rough: 20,
  waste_area: 10,
  rough: 0,
};

const BUNKER_EDGE_STYLES: Record<BunkerVisualType, LandscapeEdgeStyle> = {
  pot: {
    priority: 50,
    bands: [
      { width: 8.4, color: { terrain: "rough", shade: 0.67 }, alpha: 0.8 },
      { width: 4.5, color: { terrain: "sand", shade: 0.62 }, alpha: 0.86 },
      { width: 1.3, color: { terrain: "sand", shade: 1.18 }, alpha: 0.64 },
    ],
  },
  greenside: EDGE_STYLES.sand!,
  fairway: {
    priority: 50,
    bands: [
      { width: 6, color: { terrain: "rough", shade: 0.75 }, alpha: 0.68 },
      { width: 3, color: { terrain: "sand", shade: 0.74 }, alpha: 0.76 },
      { width: 0.9, color: { terrain: "sand", shade: 1.12 }, alpha: 0.52 },
    ],
  },
};

/**
 * Returns the one semantic edge owner for a terrain pair. This prevents the
 * double borders that appear when both connected components stroke the same
 * shared contour.
 */
export function landscapeEdgeStyle(
  terrain: Terrain,
  outsideTerrain: Terrain | null = null,
  bunkerType: BunkerVisualType = "greenside",
): LandscapeEdgeStyle | null {
  if (outsideTerrain === terrain) return null;
  if (
    outsideTerrain != null &&
    EDGE_OWNER_PRIORITY[terrain] <= EDGE_OWNER_PRIORITY[outsideTerrain]
  ) return null;
  return terrain === "sand"
    ? BUNKER_EDGE_STYLES[bunkerType]
    : EDGE_STYLES[terrain] ?? null;
}

function terrainAt(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  point: Point,
): Terrain | null {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return tiles[y * width + x] ?? null;
}

function outsideTerrainForSegment(
  a: Point,
  b: Point,
  insideTerrain: Terrain,
  tiles: readonly Terrain[],
  width: number,
  height: number,
): Terrain | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-8) return null;
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Component rings are traced with filled cells on the numerically left
  // side in y-down world coordinates. The opposite normal samples outside.
  const normal = { x: dy / length, y: -dx / length };
  for (const distance of [0.08, 0.18, 0.34, 0.56, 0.78]) {
    const terrain = terrainAt(tiles, width, height, {
      x: midpoint.x + normal.x * distance,
      y: midpoint.y + normal.y * distance,
    });
    if (terrain !== insideTerrain) return terrain;
  }
  return null;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= 1e-7 && Math.abs(a.y - b.y) <= 1e-7;
}

/**
 * Splits rounded component rings into contiguous runs by the actual terrain
 * immediately outside each segment. Rendering can then select one table-
 * driven owner and treatment for every adjacency instead of outlining the
 * entire component indiscriminately.
 */
export function buildLandscapeBoundaryRuns(
  rings: readonly (readonly Point[])[],
  insideTerrain: Terrain,
  tiles: readonly Terrain[],
  width: number,
  height: number,
): LandscapeBoundaryRun[] {
  const result: LandscapeBoundaryRun[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const ringRuns: LandscapeBoundaryRun[] = [];
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const outsideTerrain = outsideTerrainForSegment(
        a,
        b,
        insideTerrain,
        tiles,
        width,
        height,
      );
      const current = ringRuns[ringRuns.length - 1];
      if (
        current &&
        current.outsideTerrain === outsideTerrain &&
        samePoint(current.points[current.points.length - 1], a)
      ) {
        current.points.push({ ...b });
      } else {
        ringRuns.push({
          outsideTerrain,
          points: [{ ...a }, { ...b }],
        });
      }
    }
    if (
      ringRuns.length > 1 &&
      ringRuns[0].outsideTerrain === ringRuns[ringRuns.length - 1].outsideTerrain
    ) {
      const first = ringRuns[0];
      const last = ringRuns.pop()!;
      first.points = [...last.points, ...first.points.slice(1)];
    }
    result.push(...ringRuns);
  }
  return result;
}

export interface ShoreRockPlacement extends Point {
  rx: number;
  ry: number;
  tone: 0 | 1 | 2;
  rank: number;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function random01(seed: number, index: number): number {
  return mix32(seed ^ Math.imul(index + 1, 0x9e3779b1)) / 0xffffffff;
}

function pointAtRingDistance(
  ring: readonly Point[],
  distance: number,
): { point: Point; tangent: Point } | null {
  let remaining = distance;
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) continue;
    if (remaining <= length) {
      const t = remaining / length;
      return {
        point: { x: a.x + dx * t, y: a.y + dy * t },
        tangent: { x: dx / length, y: dy / length },
      };
    }
    remaining -= length;
  }
  return null;
}

/**
 * Stable, sparse visual stones sampled in world space. They are decorative
 * terrain detail only—not Course obstacles—and are hard-capped for render
 * performance on large coasts.
 */
export function buildShoreRockPlacements(
  rings: readonly (readonly Point[])[],
  topologyKey: string,
  maxRocks = 240,
): ShoreRockPlacement[] {
  if (maxRocks <= 0) return [];
  const seed = hashString(topologyKey);
  const candidates: ShoreRockPlacement[] = [];
  let sequence = 0;

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex];
    if (ring.length < 3) continue;
    let perimeter = 0;
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (perimeter <= 0.25) continue;
    const spacing = 1.05;
    const phase = random01(seed ^ ringIndex, 0) * spacing;
    for (let distance = phase; distance < perimeter; distance += spacing) {
      const sample = pointAtRingDistance(ring, distance);
      if (!sample) continue;
      const include = random01(seed, sequence * 5);
      const id = sequence++;
      if (include < 0.42) continue;
      const normal = { x: -sample.tangent.y, y: sample.tangent.x };
      const alongJitter = (random01(seed, id * 5 + 1) - 0.5) * 0.22;
      const acrossJitter = (random01(seed, id * 5 + 2) - 0.5) * 0.2;
      candidates.push({
        x: sample.point.x + sample.tangent.x * alongJitter + normal.x * acrossJitter,
        y: sample.point.y + sample.tangent.y * alongJitter + normal.y * acrossJitter,
        rx: 3.8 + random01(seed, id * 5 + 3) * 3,
        ry: 1.7 + random01(seed, id * 5 + 4) * 1.7,
        tone: Math.floor(random01(seed ^ 0xa24baed5, id) * 3) as 0 | 1 | 2,
        rank: random01(seed ^ 0x85ebca6b, id),
      });
    }
  }

  return candidates
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxRocks)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}
