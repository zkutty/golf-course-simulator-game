import type { Course, Point, Terrain } from '../models/types';
import { buildPathChains, pathGraph } from './continuousPathTopology';
import { buildPathRibbon } from './continuousPathRibbon.accepted-10c85b89.test-support';

export const PATH_RIBBON_WIDTH_FACTOR = .6;
export const DEFAULT_TILE_PATH_WIDTH = .6;
export const PATH_WIDTH_PRESETS = [
  { id: 'walking', envelopeWidth: 1 },
  { id: 'cart', envelopeWidth: 1.5 },
  { id: 'wide', envelopeWidth: 2.5 },
] as const;
export type ContinuousPathInput = Pick<Course, 'width' | 'height' | 'tiles' | 'surfaceIntent'>;
export type PathRibbonRole = 'shoulder' | 'edge' | 'core';
export interface ContinuousPathNode {
  readonly id: string; readonly point: Point;
  readonly kind: 'endpoint' | 'junction' | 'isolated' | 'transition';
  readonly incidentEdgeIds: readonly string[];
}
export interface ContinuousPathEdge {
  readonly id: string; readonly fromNodeId: string | null; readonly toNodeId: string | null;
  readonly closed: boolean; readonly source: 'intent' | 'tiles'; readonly featureIds: readonly string[];
  readonly coverage: readonly number[]; readonly points: readonly Point[]; readonly width: number;
}
export interface ContinuousPathLayer {
  readonly role: PathRibbonRole; readonly rings: readonly (readonly Point[])[];
  readonly positions: readonly number[]; readonly indices: readonly number[];
}
export interface ContinuousPathPlan {
  readonly version: 1; readonly key: string; readonly coverage: readonly number[];
  readonly underlayTiles: readonly Terrain[]; readonly nodes: readonly ContinuousPathNode[];
  readonly edges: readonly ContinuousPathEdge[]; readonly layers: readonly ContinuousPathLayer[];
  readonly diagnostics: { readonly intentEdgeCount: number; readonly tileEdgeCount: number; readonly junctionCount: number; readonly loopCount: number; readonly clippedBreakCount: number; };
}

function sortedFeatures(course: ContinuousPathInput) {
  return [...(course.surfaceIntent?.features ?? [])].filter((feature) => feature.terrain === 'path').sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((feature) => ({ id: feature.id, order: feature.order, geometry: feature.geometry, coverage: [...new Set(feature.coverage)].sort((a, b) => a - b) }));
}

/** Includes geometry-only edits, while ignoring camera/quality and stale masks. */
export function continuousPathPlanKey(course: ContinuousPathInput): string {
  const source = JSON.stringify({ width: course.width, height: course.height, tiles: course.tiles, features: sortedFeatures(course) });
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `continuous-path-v1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const TURF = new Set<Terrain>(['rough', 'fairway', 'deep_rough', 'green', 'tee']);
function pathUnderlay(course: ContinuousPathInput, coverage: readonly number[]): Terrain[] {
  const result = [...course.tiles];
  for (const cell of coverage) {
    const x = cell % course.width; const y = Math.floor(cell / course.width); const candidates = new Map<Terrain, number>();
    for (let radius = 1; radius <= 3 && !candidates.size; radius++) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue; const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= course.width || ny >= course.height) continue;
        // Always read original input: reconstruction cannot propagate its own
        // guesses and depend on the iteration order of active coverage.
        const terrain = course.tiles[ny * course.width + nx]; if (TURF.has(terrain)) candidates.set(terrain, (candidates.get(terrain) ?? 0) + 1);
      }
    }
    result[cell] = [...candidates].sort(([ta, ca], [tb, cb]) => cb - ca || ta.localeCompare(tb))[0]?.[0] ?? 'rough';
  }
  return result;
}

/** Pure derived presentation/topology; never writes terrain or persisted intent. */
export function buildContinuousPathPlan(course: ContinuousPathInput): ContinuousPathPlan {
  const coverage = course.tiles.flatMap((terrain, cell) => terrain === 'path' && cell < course.width * course.height ? [cell] : []);
  const { chains, clippedBreakCount } = buildPathChains(course, coverage, PATH_RIBBON_WIDTH_FACTOR, DEFAULT_TILE_PATH_WIDTH);
  const graph = pathGraph(chains);
  return {
    version: 1, key: continuousPathPlanKey(course), coverage, underlayTiles: pathUnderlay(course, coverage), ...graph,
    layers: buildPathRibbon(chains, coverage, course.width, course.height),
    diagnostics: { intentEdgeCount: graph.edges.filter((edge) => edge.source === 'intent').length, tileEdgeCount: graph.edges.filter((edge) => edge.source === 'tiles').length, junctionCount: graph.nodes.filter((node) => node.kind === 'junction').length, loopCount: graph.edges.filter((edge) => edge.closed).length, clippedBreakCount },
  };
}

/** Classifies the actual final clipped triangles with deterministic boundary precedence. */
export function classifyContinuousPathPoint(plan: ContinuousPathPlan, point: Readonly<Point>): PathRibbonRole | null {
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  for (const role of ['core', 'edge', 'shoulder'] as const) {
    const layer = plan.layers.find((candidate) => candidate.role === role); if (!layer) continue;
    for (let i = 0; i < layer.indices.length; i += 3) {
      const [a, b, c] = layer.indices.slice(i, i + 3).map((index) => index * 2); const p = layer.positions;
      const ab = cross(p[b] - p[a], p[b + 1] - p[a + 1], point.x - p[a], point.y - p[a + 1]);
      const bc = cross(p[c] - p[b], p[c + 1] - p[b + 1], point.x - p[b], point.y - p[b + 1]);
      const ca = cross(p[a] - p[c], p[a + 1] - p[c + 1], point.x - p[c], point.y - p[c + 1]);
      if (ab >= -1e-9 && bc >= -1e-9 && ca >= -1e-9) return role;
    }
  }
  return null;
}
