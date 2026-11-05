import type { Course, Point, Terrain } from '../models/types';
import { buildPathChains, pathGraph, type PathChain } from './continuousPathTopology';
import { buildPathRibbon } from './continuousPathRibbon';

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

/** Render-only continuation of unambiguous legacy terminals to a play-surface face.
 * Keep these stubs out of the graph: routing and saved geometry retain their
 * original points. Each stub borrows only its own charged terminal cell.
 */
function legacyTerminalRibbonChains(
  course: ContinuousPathInput, chains: readonly PathChain[], graph: ReturnType<typeof pathGraph>,
): readonly PathChain[] {
  const epsilon = 1e-7; // Same source-coordinate collinearity epsilon as topology.
  const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  const centeredCell = (point: Point): number | null => {
    const x = Math.floor(point.x); const y = Math.floor(point.y);
    return x >= 0 && y >= 0 && x < course.width && y < course.height
      && point.x === x + .5 && point.y === y + .5 && course.tiles[y * course.width + x] === 'path' ? y * course.width + x : null;
  };
  const entersAlong = (points: readonly Point[], start: boolean, point: Point, dx: number, dy: number): boolean => {
    if (!points.length || !samePoint(points[start ? 0 : points.length - 1], point)) return false;
    for (let i = start ? 1 : points.length - 2; start ? i < points.length : i >= 0; i += start ? 1 : -1) {
      const x = points[i].x - point.x; const y = points[i].y - point.y;
      if (Math.hypot(x, y) <= epsilon) continue;
      return x * dx + y * dy > epsilon && Math.abs(x * dy - y * dx) <= epsilon;
    }
    return false;
  };
  const authored = new Set((course.surfaceIntent?.features ?? []).filter(feature => feature.terrain === 'path').flatMap(feature => feature.coverage));
  const ends = new Map<number, { chain: PathChain; start: boolean }[]>();
  for (const chain of chains) {
    if (chain.closed || chain.source !== 'tiles' || chain.featureIds.length || chain.points.length < 2) continue;
    for (const start of [true, false]) {
      const cell = centeredCell(chain.points[start ? 0 : chain.points.length - 1]);
      if (cell === null) continue;
      const candidates = ends.get(cell) ?? []; candidates.push({ chain, start }); ends.set(cell, candidates);
    }
  }
  const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
  const stubs: { cell: number; chain: PathChain }[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'endpoint' || node.incidentEdgeIds.length !== 1) continue;
    const cell = centeredCell(node.point); if (cell === null || authored.has(cell)) continue;
    const edge = edges.get(node.incidentEdgeIds[0]);
    if (!edge || edge.closed || edge.source !== 'tiles' || edge.featureIds.length
      || (edge.fromNodeId === node.id) === (edge.toNodeId === node.id)) continue;
    const candidates = ends.get(cell);
    if (candidates?.length !== 1) continue;
    const { chain, start } = candidates[0];
    if (!Number.isFinite(chain.width) || chain.width <= 0 || chain.width !== edge.width || !chain.coverage.includes(cell)) continue;
    const x = cell % course.width; const y = Math.floor(cell / course.width);
    const path: Point[] = []; const play: Point[] = [];
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= course.width || ny >= course.height) continue;
      const terrain = course.tiles[ny * course.width + nx];
      if (terrain === 'path') path.push({ x: dx, y: dy });
      else if (terrain === 'tee' || terrain === 'green') play.push({ x: dx, y: dy });
    }
    if (path.length !== 1 || play.length !== 1 || path[0].x !== -play[0].x || path[0].y !== -play[0].y) continue;
    if (!entersAlong(edge.points, edge.fromNodeId === node.id, node.point, path[0].x, path[0].y)
      || !entersAlong(chain.points, start, node.point, path[0].x, path[0].y)) continue;
    stubs.push({ cell, chain: {
      points: [{ ...node.point }, { x: node.point.x + .5 * play[0].x, y: node.point.y + .5 * play[0].y }],
      coverage: [cell], width: chain.width, featureIds: [], source: 'tiles', closed: false,
    } });
  }
  return stubs.length ? [...chains, ...stubs.sort((a, b) => a.cell - b.cell).map(stub => stub.chain)] : chains;
}

/** Pure derived presentation/topology; never writes terrain or persisted intent. */
export function buildContinuousPathPlan(course: ContinuousPathInput): ContinuousPathPlan {
  const coverage = course.tiles.flatMap((terrain, cell) => terrain === 'path' && cell < course.width * course.height ? [cell] : []);
  const { chains, clippedBreakCount } = buildPathChains(course, coverage, PATH_RIBBON_WIDTH_FACTOR, DEFAULT_TILE_PATH_WIDTH);
  const graph = pathGraph(chains);
  const ribbonChains = legacyTerminalRibbonChains(course, chains, graph);
  return {
    version: 1, key: continuousPathPlanKey(course), coverage, underlayTiles: pathUnderlay(course, coverage), ...graph,
    layers: buildPathRibbon(ribbonChains, coverage, course.width, course.height),
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
