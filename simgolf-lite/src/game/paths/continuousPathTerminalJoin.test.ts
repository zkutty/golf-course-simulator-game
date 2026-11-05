import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Point, SurfaceFeature, Terrain } from '../models/types';
import { authoredPathFixture, continuousPathFixture } from '../testing/continuousPathFixtures';
import { createContinuousPathContactSampler } from '../../ui/renderer/scenes/pathMaterialScene';
import {
  buildContinuousPathPlan, classifyContinuousPathPoint, continuousPathPlanKey,
  DEFAULT_TILE_PATH_WIDTH, PATH_RIBBON_WIDTH_FACTOR,
  type ContinuousPathInput, type ContinuousPathLayer,
} from './continuousPathPlan';
import { buildPathRibbon } from './continuousPathRibbon';
import * as topology from './continuousPathTopology';

const originalBuildChains = topology.buildPathChains;
const originalGraph = topology.pathGraph;
const epsilon = 1e-8;
afterEach(() => vi.restoreAllMocks());

function empty(): ContinuousPathInput {
  return { width: 9, height: 9, tiles: Array<Terrain>(81).fill('rough') };
}
function paint(course: ContinuousPathInput, x: number, y: number, terrain: Terrain) {
  course.tiles[y * course.width + x] = terrain;
}
function straight(rotation = 0, bothEnds = true): ContinuousPathInput {
  const course = empty();
  const rotate = (x: number, y: number): Point => {
    for (let i = 0; i < rotation; i++) [x, y] = [8 - y, x];
    return { x, y };
  };
  for (let x = 2; x <= 6; x++) { const p = rotate(x, 4); paint(course, p.x, p.y, 'path'); }
  if (bothEnds) { const p = rotate(1, 4); paint(course, p.x, p.y, 'tee'); }
  const p = rotate(7, 4); paint(course, p.x, p.y, 'green');
  return course;
}
function raw(course: ContinuousPathInput) {
  const coverage = course.tiles.flatMap((terrain, cell) => terrain === 'path' ? [cell] : []);
  const source = originalBuildChains(course, coverage, PATH_RIBBON_WIDTH_FACTOR, DEFAULT_TILE_PATH_WIDTH);
  return { ...source, coverage, graph: originalGraph(source.chains) };
}
function triangles(layers: readonly ContinuousPathLayer[], course: ContinuousPathInput): Map<string, number[][]> {
  const result = new Map<string, number[][]>();
  const violations: unknown[] = [];
  for (const layer of layers) for (let i = 0; i < layer.indices.length; i += 3) {
    const coordinates = layer.indices.slice(i, i + 3).flatMap(index => layer.positions.slice(index * 2, index * 2 + 2));
    const x = Math.floor((coordinates[0] + coordinates[2] + coordinates[4]) / 3);
    const y = Math.floor((coordinates[1] + coordinates[3] + coordinates[5]) / 3);
    const cell = y * course.width + x;
    if (x < 0 || y < 0 || x >= course.width || y >= course.height || course.tiles[cell] !== 'path'
      || !coordinates.every((value, j) => Number.isFinite(value) && value >= (j % 2 ? y : x) - epsilon && value <= (j % 2 ? y : x) + 1 + epsilon)) {
      if (violations.length < 5) violations.push({ role: layer.role, coordinates, cell });
    }
    const key = `${layer.role}:${cell}`; const list = result.get(key) ?? []; list.push(coordinates); result.set(key, list);
  }
  expect(violations, 'every complete triangle must stay in one original charged tile').toEqual([]);
  return result;
}
function faceLength(layer: ContinuousPathLayer, point: Point, direction: Point): number {
  const intervals: [number, number][] = [];
  const onFace = (p: Point) => Math.abs((p.x - point.x) * direction.x + (p.y - point.y) * direction.y) <= epsilon;
  const along = (p: Point) => p.x * -direction.y + p.y * direction.x;
  for (let i = 0; i < layer.indices.length; i += 3) {
    const points = layer.indices.slice(i, i + 3).map(index => ({ x: layer.positions[index * 2], y: layer.positions[index * 2 + 1] }));
    for (let j = 0; j < 3; j++) {
      const a = points[j], b = points[(j + 1) % 3];
      if (onFace(a) && onFace(b)) intervals.push([Math.min(along(a), along(b)), Math.max(along(a), along(b))]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let length = 0, end = -Infinity;
  for (const [lo, hi] of intervals) { length += Math.max(0, hi - Math.max(end, lo)); end = Math.max(end, hi); }
  return length;
}
function expectRawParity(course: ContinuousPathInput, chains = raw(course).chains, graph = originalGraph(chains)) {
  const before = JSON.stringify(course), chainBefore = JSON.stringify(chains);
  const plan = buildContinuousPathPlan(course);
  const layers = buildPathRibbon(chains, plan.coverage, course.width, course.height);
  expect(JSON.stringify(plan)).toBe(JSON.stringify({ ...plan, ...graph, layers }));
  expect(JSON.stringify(course)).toBe(before); expect(JSON.stringify(chains)).toBe(chainBefore);
  triangles(plan.layers, course);
  return plan;
}
function savedCoverage(course: ContinuousPathInput, geometry: SurfaceFeature['geometry'], coverage: number[]) {
  course.surfaceIntent = { version: 1, nextId: 2, features: [{ id: 'saved-1', order: 1, terrain: 'path', coverage, geometry }] };
}

describe('cardinal legacy-terminal render joins', () => {
  it.each([0, 1, 2, 3].flatMap(rotation => [false, true].map(reverse => ({ rotation, reverse }))))(
    'extends both protected faces at world rotation $rotation, raw orientation reversed=$reverse without graph or interior changes', ({ rotation, reverse }) => {
      const course = straight(rotation), input = JSON.stringify(course), source = raw(course);
      const chains = source.chains.map(chain => ({ ...chain, points: reverse ? [...chain.points].reverse() : chain.points }));
      const graph = originalGraph(chains), oldLayers = buildPathRibbon(chains, source.coverage, course.width, course.height);
      const oldTriangles = triangles(oldLayers, course), chainBefore = JSON.stringify(chains);
      vi.spyOn(topology, 'buildPathChains').mockReturnValue({ chains, clippedBreakCount: source.clippedBreakCount });
      const plan = buildContinuousPathPlan(course), newTriangles = triangles(plan.layers, course);
      expect({ nodes: plan.nodes, edges: plan.edges }).toEqual(graph);
      expect(plan.key).toBe(continuousPathPlanKey(course)); expect(plan.coverage).toEqual(source.coverage);
      expect(plan.underlayTiles).toEqual(course.tiles.map(terrain => terrain === 'path' ? 'rough' : terrain));
      expect(plan.diagnostics).toEqual({ intentEdgeCount: 0, tileEdgeCount: graph.edges.length, junctionCount: 0, loopCount: 0, clippedBreakCount: source.clippedBreakCount });
      const terminalCells = new Set<number>();
      for (const node of graph.nodes) {
        expect(node.kind).toBe('endpoint');
        const cell = Math.floor(node.point.y) * course.width + Math.floor(node.point.x); terminalCells.add(cell);
        const x = cell % course.width, y = Math.floor(cell / course.width);
        const neighbors = [[0, -1], [-1, 0], [1, 0], [0, 1]].filter(([dx, dy]) => ['tee', 'green'].includes(course.tiles[(y + dy) * course.width + x + dx]));
        expect(neighbors).toHaveLength(1); const [dx, dy] = neighbors[0];
        const face = { x: node.point.x + dx * .5, y: node.point.y + dy * .5 };
        for (const layer of plan.layers) {
          const factor = layer.role === 'core' ? .36 : layer.role === 'edge' ? .44 - .36 : .5 - .44;
          expect(faceLength(layer, face, { x: dx, y: dy })).toBeCloseTo(2 * DEFAULT_TILE_PATH_WIDTH * factor, 7);
          expect(faceLength(oldLayers.find(old => old.role === layer.role)!, face, { x: dx, y: dy })).toBe(0);
        }
        expect(classifyContinuousPathPoint(plan, { x: node.point.x + .4 * dx, y: node.point.y + .4 * dy })).toBe('core');
        expect(classifyContinuousPathPoint(plan, { x: face.x + .01 * dx, y: face.y + .01 * dy })).toBeNull();
      }
      expect(terminalCells.size).toBe(2);
      for (const [key, old] of oldTriangles) {
        if (!terminalCells.has(Number(key.split(':')[1]))) expect(newTriangles.get(key), key).toEqual(old);
      }
      expect(JSON.stringify(course)).toBe(input); expect(JSON.stringify(chains)).toBe(chainBefore);
    },
  );

  const negatives: { name: string; make: () => ContinuousPathInput }[] = [
    { name: 'isolated endpoint with one protected target', make: () => { const c = empty(); paint(c, 4, 4, 'path'); paint(c, 5, 4, 'tee'); return c; } },
    { name: 'isolated endpoint with multiple protected targets', make: () => { const c = empty(); paint(c, 4, 4, 'path'); paint(c, 5, 4, 'tee'); paint(c, 4, 3, 'green'); return c; } },
    { name: 'real terminal with multiple protected targets', make: () => { const c = straight(0, false); paint(c, 6, 3, 'tee'); return c; } },
    { name: 'side target along a parallel path', make: () => { const c = straight(0, false); paint(c, 7, 4, 'rough'); paint(c, 4, 3, 'tee'); return c; } },
    { name: 'side target beside a terminal', make: () => { const c = straight(0, false); paint(c, 7, 4, 'rough'); paint(c, 6, 3, 'tee'); return c; } },
    { name: 'diagonal-only target', make: () => { const c = straight(0, false); paint(c, 7, 4, 'rough'); paint(c, 7, 5, 'green'); return c; } },
    { name: 'junction adjacent to protected play', make: () => { const c = straight(0, false); paint(c, 7, 4, 'rough'); paint(c, 4, 5, 'path'); paint(c, 4, 6, 'path'); paint(c, 4, 3, 'tee'); return c; } },
    { name: 'closed loop beside green', make: () => { const c = empty(); for (let i = 3; i <= 5; i++) { paint(c, i, 3, 'path'); paint(c, i, 5, 'path'); paint(c, 3, i, 'path'); paint(c, 5, i, 'path'); } paint(c, 6, 4, 'green'); return c; } },
    { name: 'missing charged approach cell', make: () => { const c = straight(0, false); paint(c, 6, 4, 'rough'); return c; } },
    { name: 'overwritten approach cell', make: () => { const c = straight(0, false); paint(c, 6, 4, 'water'); return c; } },
    { name: 'row-wrapped array neighbor is not cardinal land', make: () => { const c = empty(); for (let x = 0; x <= 3; x++) paint(c, x, 4, 'path'); paint(c, 8, 3, 'green'); return c; } },
    { name: 'clipped authored-to-legacy connection owns its terminal', make: () => { const c = straight(0, false); savedCoverage(c, { kind: 'corridor', width: 1, knots: [{ x: 4.5, y: 4.5 }, { x: 7.5, y: 4.5 }] }, [40, 41, 42]); return c; } },
    { name: 'saved region owns the terminal coverage', make: () => { const c = straight(0, false); savedCoverage(c, { kind: 'region', ring: [{ x: 6, y: 4 }, { x: 7, y: 4 }, { x: 7, y: 5 }] }, [42]); return c; } },
    { name: 'invalid saved corridor still owns its terminal coverage', make: () => { const c = straight(0, false); savedCoverage(c, { kind: 'corridor', width: 0, knots: [{ x: 6.5, y: 4.5 }] }, [42]); return c; } },
  ];
  it.each(negatives)('keeps the complete original ribbon for $name', ({ make }) => { expectRawParity(make()); });

  it.each([1, 1.5, 2.5])('never extends authored width %s or its saved tangent envelope', width => {
    const course = straight();
    savedCoverage(course, { kind: 'corridor', width, knots: [{ x: 2.5, y: 4.5 }, { x: 4.5, y: 4.3 }, { x: 6.5, y: 4.5 }], tangents: [
      { in: { x: 2.5, y: 4.5 }, out: { x: 3.1, y: 4.2 } },
      { in: { x: 3.8, y: 4.1 }, out: { x: 5.2, y: 4.1 } },
      { in: { x: 5.9, y: 4.2 }, out: { x: 6.5, y: 4.5 } },
    ] }, [38, 39, 40, 41, 42]);
    expectRawParity(course);
  });

  it('rejects coincident raw-end ambiguity even when the deduplicated graph has degree one', () => {
    const course = straight(0, false), source = raw(course);
    const chains = [...source.chains, ...source.chains.map(chain => ({ ...chain, points: chain.points.map(p => ({ ...p })) }))];
    expect(originalGraph(chains).nodes.every(node => node.kind === 'endpoint')).toBe(true);
    vi.spyOn(topology, 'buildPathChains').mockReturnValue({ chains, clippedBreakCount: 0 });
    expectRawParity(course, chains);
  });

  it.each(['fractional', 'raw-direction', 'graph-direction', 'width', 'mixed-source', 'closed'] as const)(
    'fails closed on contradictory source evidence: %s', kind => {
      const course = straight(0, false), source = raw(course), chains = structuredClone(source.chains);
      if (kind === 'fractional') for (const chain of chains) { chain.points[0].x += .01; chain.points[chain.points.length - 1].x -= .01; }
      if (kind === 'raw-direction') chains[0].points[chains[0].points.length - 2].y += .01;
      const graph = originalGraph(kind === 'raw-direction' ? source.chains : chains);
      if (kind === 'graph-direction') graph.edges[0] = { ...graph.edges[0], points: graph.edges[0].points.map((p, i, points) => i === points.length - 2 ? { ...p, y: p.y + .01 } : p) };
      if (kind === 'width') graph.edges[0] = { ...graph.edges[0], width: graph.edges[0].width + .1 };
      if (kind === 'mixed-source') graph.edges[0] = { ...graph.edges[0], source: 'intent', featureIds: ['saved-other'] };
      if (kind === 'closed') chains[0].closed = true;
      vi.spyOn(topology, 'buildPathChains').mockReturnValue({ chains, clippedBreakCount: 0 });
      vi.spyOn(topology, 'pathGraph').mockReturnValue(graph);
      expectRawParity(course, chains, graph);
    },
  );

  it('invalidates geometry for adjacency edits without changing the PATH graph', () => {
    const course = straight(0, false), before = buildContinuousPathPlan(course);
    paint(course, 7, 4, 'rough'); const after = buildContinuousPathPlan(course);
    expect(after.key).not.toBe(before.key); expect(after.nodes).toEqual(before.nodes); expect(after.edges).toEqual(before.edges);
    expect(after.coverage).toEqual(before.coverage); expect(after.diagnostics).toEqual(before.diagnostics);
    expect(after.layers).not.toEqual(before.layers);
    const authored = authoredPathFixture(); const key = continuousPathPlanKey(authored);
    const feature = authored.surfaceIntent!.features[0]; if (feature.geometry.kind !== 'corridor') throw new Error('corridor fixture');
    feature.geometry.width += .25; expect(continuousPathPlanKey(authored)).not.toBe(key);
  });

  it('gives A2 CSR a real new terminal triangle and its non-affine vertex-height plane', () => {
    const course = straight(0, false), plan = buildContinuousPathPlan(course), core = plan.layers.find(layer => layer.role === 'core')!;
    const height = (x: number, y: number) => x * x + 3 * y * y + x * y;
    const sample = createContinuousPathContactSampler({ suppressWholeCellPaths: true, layers: plan.layers }, course.width, course.height, height);
    let exercised = false;
    for (let i = 0; i < core.indices.length; i += 3) {
      const p = core.indices.slice(i, i + 3).map(index => ({ x: core.positions[index * 2], y: core.positions[index * 2 + 1] }));
      const x = p.reduce((sum, point) => sum + point.x, 0) / 3, y = p.reduce((sum, point) => sum + point.y, 0) / 3;
      const area = Math.abs((p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x));
      if (x <= 6.82 || area <= 1e-8) continue;
      const plane = p.reduce((sum, point) => sum + height(point.x, point.y), 0) / 3;
      expect(sample(x, y)).toBeCloseTo(plane, 9); expect(Math.abs(plane - height(x, y))).toBeGreaterThan(1e-6);
      exercised = true; break;
    }
    expect(exercised, 'must query the interior of a new nondegenerate terminal triangle').toBe(true);
    expect(sample(7.01, 4.5)).toBeNull(); triangles(plan.layers, course);
  });

  it('keeps untouched legacy fixtures exact with no protected target', () => {
    for (const kind of ['straight', 'diagonal', 'T', 'cross', 'loop', 'corner'] as const) expectRawParity(continuousPathFixture(kind));
  });
});
