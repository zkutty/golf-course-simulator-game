import { describe, expect, it } from 'vitest';
import type { Point, SurfaceFeature } from '../models/types';
import { sampleCorridor, rasterizeSurfaceFeatureDetailed } from '../models/surfaceIntent';
import { authoredPathFixture, continuousPathFixture } from '../testing/continuousPathFixtures';
import { buildContinuousPathPlan, classifyContinuousPathPoint, continuousPathPlanKey, PATH_WIDTH_PRESETS, type ContinuousPathLayer, type ContinuousPathPlan } from './continuousPathPlan';

function triangleArea(a: Point, b: Point, c: Point): number { return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2; }
function ringArea(points: readonly Point[]): number { return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - p.y * q.x; }, 0) / 2; }
function layerArea(layer: ContinuousPathLayer): number {
  let sum = 0; for (let i = 0; i < layer.indices.length; i += 3) { const points = layer.indices.slice(i, i + 3).map((j) => ({ x: layer.positions[2 * j], y: layer.positions[2 * j + 1] })); sum += triangleArea(points[0], points[1], points[2]); } return sum;
}
function assertContained(plan: ContinuousPathPlan, width: number, height: number) {
  const active = new Set(plan.coverage);
  const legal = (point: Point) => {
    for (let y = Math.max(0, Math.floor(point.y - 1e-7)); y <= Math.min(height - 1, Math.floor(point.y)); y++) for (let x = Math.max(0, Math.floor(point.x - 1e-7)); x <= Math.min(width - 1, Math.floor(point.x)); x++) if (active.has(y * width + x)) return true;
    return false;
  };
  for (const layer of plan.layers) {
    expect(layer.positions.every(Number.isFinite)).toBe(true); expect(layer.indices.length % 3).toBe(0);
    for (let i = 0; i < layer.indices.length; i += 3) {
      const points = layer.indices.slice(i, i + 3).map((j) => ({ x: layer.positions[2 * j], y: layer.positions[2 * j + 1] }));
      expect(triangleArea(points[0], points[1], points[2])).toBeGreaterThan(1e-12);
      // Tile clipping is convex: verifying triangle extents occupy one tile,
      // together with centroid membership, proves its entire interior legal.
      const cx = points.reduce((sum, p) => sum + p.x, 0) / 3; const cy = points.reduce((sum, p) => sum + p.y, 0) / 3;
      expect(legal({ x: cx, y: cy })).toBe(true);
      expect(Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))).toBeLessThanOrEqual(1 + 1e-7);
      const tileX = Math.floor(cx); const tileY = Math.floor(cy);
      for (const p of points) { expect(p.x).toBeGreaterThanOrEqual(tileX - 1e-7); expect(p.x).toBeLessThanOrEqual(tileX + 1 + 1e-7); expect(p.y).toBeGreaterThanOrEqual(tileY - 1e-7); expect(p.y).toBeLessThanOrEqual(tileY + 1 + 1e-7); }
    }
    expect(layer.rings.reduce((sum, ring) => sum + ringArea(ring), 0)).toBeCloseTo(layerArea(layer), 4);
  }
  for (const edge of plan.edges) for (let i = 1; i < edge.points.length; i++) expect(Math.hypot(edge.points[i].x - edge.points[i - 1].x, edge.points[i].y - edge.points[i - 1].y)).toBeLessThanOrEqual(.2000001);
}
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

// These assertions target the exported consumed geometry, not an independent
// diagnostic implementation of what the renderer is expected to draw.
describe('continuous path shared geometry', () => {
  it('returns an immutable-input empty plan with copied underlay and no geometry', () => {
    const course = deepFreeze(continuousPathFixture('empty')); const plan = buildContinuousPathPlan(course);
    expect(plan.nodes).toEqual([]); expect(plan.edges).toEqual([]); expect(plan.layers.every((layer) => !layer.indices.length && !layer.rings.length)).toBe(true);
    expect(plan.underlayTiles).toEqual(course.tiles); expect(plan.underlayTiles).not.toBe(course.tiles);
  });

  it('makes one narrow continuous straight path with exposed turf and disjoint material roles', () => {
    const course = continuousPathFixture('straight'); const plan = buildContinuousPathPlan(course);
    expect(plan.nodes.map((node) => node.kind)).toEqual(['endpoint', 'endpoint']); expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0].points[0]).toEqual({ x: 2.5, y: 4.5 }); expect(plan.edges[0].points.at(-1)).toEqual({ x: 10.5, y: 4.5 });
    expect(plan.edges[0].width).toBe(.6);
    expect(classifyContinuousPathPoint(plan, { x: 6.5, y: 4.5 })).toBe('core');
    expect(classifyContinuousPathPoint(plan, { x: 6.5, y: 4.74 })).toBe('edge');
    expect(classifyContinuousPathPoint(plan, { x: 6.5, y: 4.78 })).toBe('shoulder');
    expect(classifyContinuousPathPoint(plan, { x: 6.5, y: 4.9 })).toBeNull();
    const totalArea = plan.layers.reduce((sum, layer) => sum + layerArea(layer), 0);
    expect(totalArea).toBeCloseTo(8 * .6 + .3 * .3 * 12 * Math.sin(Math.PI / 12), 5);
    expect(plan.layers.every((layer) => layer.rings.length >= 1)).toBe(true); assertContained(plan, course.width, course.height);
  });

  it.each(['diagonal', 'bend'] as const)('joins %s as one smooth capped chain without per-cell resets', (kind) => {
    const course = continuousPathFixture(kind); const plan = buildContinuousPathPlan(course);
    expect(plan.nodes.filter((node) => node.kind === 'endpoint')).toHaveLength(2); expect(plan.nodes.filter((node) => node.kind === 'junction')).toHaveLength(0); expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0].points.length).toBeGreaterThan(10);
    for (const p of plan.edges[0].points) expect(classifyContinuousPathPoint(plan, p)).toBe('core');
    assertContained(plan, course.width, course.height);
  });

  it.each([['T', 3], ['cross', 4]] as const)('unions the %s junction without internal edge stripes', (kind, count) => {
    const course = continuousPathFixture(kind); const plan = buildContinuousPathPlan(course);
    expect(plan.nodes.filter((node) => node.kind === 'endpoint')).toHaveLength(count);
    const junctions = plan.nodes.filter((node) => node.kind === 'junction'); expect(junctions).toHaveLength(1);
    expect(junctions[0].incidentEdgeIds).toHaveLength(count); expect(junctions[0].point).toEqual({ x: 7.5, y: 7.5 }); expect(plan.edges).toHaveLength(count);
    expect(classifyContinuousPathPoint(plan, junctions[0].point)).toBe('core'); assertContained(plan, course.width, course.height);
  });

  it('keeps an open detour open instead of linking unsupported diagonal tips', () => {
    const course = continuousPathFixture('empty');
    for (const [x, y] of [[2, 2], [2, 1], [3, 1], [4, 1], [4, 2], [4, 3], [3, 3]]) course.tiles[y * course.width + x] = 'path';
    const plan = buildContinuousPathPlan(course);
    expect(plan.nodes.filter((node) => node.kind === 'endpoint')).toHaveLength(2); expect(plan.edges).toHaveLength(1); expect(plan.edges[0].closed).toBe(false);
    expect(plan.diagnostics.loopCount).toBe(0); expect(classifyContinuousPathPoint(plan, { x: 3, y: 3 })).toBeNull(); assertContained(plan, course.width, course.height);
  });

  it('retains a closed loop and its turf interior hole', () => {
    const course = continuousPathFixture('loop'); const plan = buildContinuousPathPlan(course);
    expect(plan.nodes).toHaveLength(0); expect(plan.edges).toHaveLength(1); expect(plan.edges[0].closed).toBe(true);
    expect(plan.edges[0].points[0]).toEqual(plan.edges[0].points.at(-1)); expect(plan.diagnostics.loopCount).toBe(1);
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 7.5 })).toBeNull();
    expect(plan.layers.find((layer) => layer.role === 'core')!.rings.some((ring) => ringArea(ring) < 0)).toBe(true); assertContained(plan, course.width, course.height);
  });

  it('thins a broad tile mask instead of turning all centers into a grid', () => {
    const course = continuousPathFixture('broad'); const plan = buildContinuousPathPlan(course);
    expect(plan.edges).toHaveLength(1); expect(plan.nodes.filter((node) => node.kind === 'endpoint')).toHaveLength(2); expect(plan.diagnostics.junctionCount).toBe(0);
    expect(plan.layers.reduce((sum, layer) => sum + layerArea(layer), 0)).toBeLessThan(plan.coverage.length / 2);
    expect(classifyContinuousPathPoint(plan, { x: 8.5, y: 6.5 })).toBe('core'); assertContained(plan, course.width, course.height);
  });

  it.each([2, 4])('preserves a nonempty medial skeleton for an even %sx%s brush patch', (size) => {
    const course = continuousPathFixture('empty');
    for (let y = 4; y < 4 + size; y++) for (let x = 4; x < 4 + size; x++) course.tiles[y * course.width + x] = 'path';
    const plan = buildContinuousPathPlan(course);
    expect(plan.coverage).toHaveLength(size * size); expect(plan.nodes.length + plan.edges.length).toBeGreaterThan(0);
    expect(plan.layers.reduce((sum, layer) => sum + layerArea(layer), 0)).toBeGreaterThan(0);
    for (const node of plan.nodes) expect(classifyContinuousPathPoint(plan, node.point)).toBe('core');
    assertContained(plan, course.width, course.height);
  });

  it('uses saved S geometry and explicit tangents rather than the tile outline', () => {
    const course = authoredPathFixture(); const feature = course.surfaceIntent!.features[0];
    if (feature.geometry.kind !== 'corridor') throw new Error('fixture corridor');
    feature.geometry.tangents = feature.geometry.knots.map((point) => ({ in: { x: point.x - .6, y: point.y }, out: { x: point.x + .6, y: point.y } }));
    const raster = rasterizeSurfaceFeatureDetailed(feature, course.width, course.height); course.tiles.fill('rough'); feature.coverage = raster.tiles.map((p) => p.y * course.width + p.x); for (const cell of feature.coverage) course.tiles[cell] = 'path';
    const before = JSON.stringify(course); const plan = buildContinuousPathPlan(deepFreeze(course));
    expect(plan.edges.every((edge) => edge.source === 'intent')).toBe(true); for (const edge of plan.edges) expect(edge.width).toBeCloseTo(.9); expect(plan.edges).toHaveLength(1);
    for (const p of sampleCorridor(feature.geometry.knots, .2, feature.geometry.tangents)) expect(classifyContinuousPathPoint(plan, p)).toBe('core');
    expect(JSON.stringify(course)).toBe(before); expect(buildContinuousPathPlan(course)).toEqual(plan); assertContained(plan, course.width, course.height);
  });

  it.each(PATH_WIDTH_PRESETS)('honors persisted $id width and clips the entire ribbon to charged coverage', ({ envelopeWidth }) => {
    const course = authoredPathFixture([{ x: 2.5, y: 6.5 }, { x: 12.5, y: 6.5 }], envelopeWidth); const plan = buildContinuousPathPlan(course); const visibleWidth = envelopeWidth * .6;
    expect(plan.edges).toHaveLength(1); expect(plan.edges[0].width).toBeCloseTo(visibleWidth);
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 6.5 + visibleWidth * .49 })).toBe('shoulder');
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 6.5 + visibleWidth * .51 })).toBeNull(); assertContained(plan, course.width, course.height);
  });

  it('breaks saved curves at overwritten cells and fills a legacy orphan cell without bridging the real gap', () => {
    const course = authoredPathFixture([{ x: 2.5, y: 4.5 }, { x: 12.5, y: 4.5 }], 1); const feature = course.surfaceIntent!.features[0];
    course.tiles[4 * course.width + 7] = 'water'; feature.coverage = feature.coverage.filter((cell) => cell !== 4 * course.width + 5);
    const plan = buildContinuousPathPlan(course);
    expect(classifyContinuousPathPoint(plan, { x: 7.5, y: 4.5 })).toBeNull(); expect(classifyContinuousPathPoint(plan, { x: 5.5, y: 4.5 })).toBe('core');
    expect(plan.nodes.filter((node) => node.kind === 'endpoint')).toHaveLength(4); expect(plan.diagnostics.clippedBreakCount).toBeGreaterThan(0); assertContained(plan, course.width, course.height);
  });

  it('splits crossing saved corridors into one graph and has stable feature ordering', () => {
    const course = authoredPathFixture([{ x: 2.5, y: 7.5 }, { x: 12.5, y: 7.5 }], 1);
    const other = authoredPathFixture([{ x: 7.5, y: 2.5 }, { x: 7.5, y: 12.5 }], 1).surfaceIntent!.features[0]; const second: SurfaceFeature = { ...other, id: 'surface-2', order: 2 };
    course.surfaceIntent!.features.push(second); for (const cell of second.coverage) course.tiles[cell] = 'path';
    const plan = buildContinuousPathPlan(course); expect(plan.nodes.filter((node) => node.kind === 'junction')).toHaveLength(1); expect(plan.edges).toHaveLength(4);
    course.surfaceIntent!.features.reverse(); expect(buildContinuousPathPlan(course)).toEqual(plan); assertContained(plan, course.width, course.height);
  });

  it.each([false, true])('disconnects saved corner-only intent even when its tiles share a remote detour (%s)', (detour) => {
    const course = continuousPathFixture('empty');
    const cells = detour ? [[2, 2], [2, 1], [3, 1], [4, 1], [4, 2], [4, 3], [3, 3]] : [[3, 3], [4, 4]];
    for (const [x, y] of cells) course.tiles[y * course.width + x] = 'path';
    const corner = detour ? 3 : 4;
    course.surfaceIntent = { version: 1, nextId: 2, features: [{ id: 'surface-1', order: 1, terrain: 'path', coverage: cells.map(([x, y]) => y * course.width + x), geometry: { kind: 'corridor', width: 1, knots: [{ x: corner - .5, y: corner - .5 }, { x: corner + .5, y: corner + .5 }] } }] };
    const plan = buildContinuousPathPlan(course);
    expect(plan.edges).toHaveLength(2); expect(plan.nodes.filter((node) => node.kind === 'endpoint')).toHaveLength(4);
    const tips = plan.nodes.filter((node) => Math.hypot(node.point.x - corner, node.point.y - corner) < 1e-4);
    expect(tips).toHaveLength(2); expect(tips[0].id).not.toBe(tips[1].id); expect(Math.hypot(tips[0].point.x - tips[1].point.x, tips[0].point.y - tips[1].point.y)).toBeGreaterThan(1e-7);
    expect(plan.edges[0].toNodeId).not.toBe(plan.edges[1].fromNodeId); assertContained(plan, course.width, course.height);
  });

  it('retains truthful scalar width and feature metadata at a degree-two transition', () => {
    const course = authoredPathFixture([{ x: 2.5, y: 6.5 }, { x: 7.5, y: 6.5 }], 1);
    const other = authoredPathFixture([{ x: 7.5, y: 6.5 }, { x: 12.5, y: 6.5 }], 2.5).surfaceIntent!.features[0];
    course.surfaceIntent!.features.push({ ...other, id: 'surface-2', order: 2 }); for (const cell of other.coverage) course.tiles[cell] = 'path';
    const plan = buildContinuousPathPlan(course); expect(plan.edges).toHaveLength(2); expect(plan.nodes.filter((node) => node.kind === 'transition')).toHaveLength(1); expect(plan.diagnostics.junctionCount).toBe(0);
    expect(plan.edges.map((edge) => edge.width)).toEqual([.6, 1.5]); expect(plan.edges.map((edge) => edge.featureIds)).toEqual([['surface-1'], ['surface-2']]);
    expect(classifyContinuousPathPoint(plan, { x: 4.5, y: 6.9 })).toBeNull(); expect(classifyContinuousPathPoint(plan, { x: 10.5, y: 7.1 })).not.toBeNull(); assertContained(plan, course.width, course.height);
  });

  it('retains separate fallback provenance at an authored-to-legacy transition', () => {
    const course = authoredPathFixture([{ x: 2.5, y: 6.5 }, { x: 7.5, y: 6.5 }], 1);
    for (let x = 8; x <= 12; x++) course.tiles[6 * course.width + x] = 'path';
    const plan = buildContinuousPathPlan(course); expect(plan.nodes.some((node) => node.kind === 'transition')).toBe(true);
    expect(plan.edges.some((edge) => edge.source === 'intent' && edge.featureIds.length === 1)).toBe(true);
    expect(plan.edges.some((edge) => edge.source === 'tiles' && edge.featureIds.length === 0)).toBe(true); assertContained(plan, course.width, course.height);
  });

  it('keys geometry-only width, tangent and coverage edits and reconstructs only path turf', () => {
    const course = authoredPathFixture(); const initial = continuousPathPlanKey(course); const feature = course.surfaceIntent!.features[0];
    if (feature.geometry.kind !== 'corridor') throw new Error('fixture corridor'); feature.geometry.width += .25; expect(continuousPathPlanKey(course)).not.toBe(initial);
    const widthKey = continuousPathPlanKey(course); feature.geometry.tangents = feature.geometry.knots.map((point) => ({ in: { ...point }, out: { ...point } })); expect(continuousPathPlanKey(course)).not.toBe(widthKey);
    const tangentKey = continuousPathPlanKey(course); feature.coverage = feature.coverage.slice(1); expect(continuousPathPlanKey(course)).not.toBe(tangentKey);
    course.tiles[0] = 'water'; const plan = buildContinuousPathPlan(course);
    for (let cell = 0; cell < course.tiles.length; cell++) expect(plan.underlayTiles[cell]).toBe(course.tiles[cell] === 'path' ? 'rough' : course.tiles[cell]);
  });

  it.each(['isolated', 'corner'] as const)('represents %s legacy pads honestly without invented diagonal coverage', (kind) => {
    const course = continuousPathFixture(kind); const plan = buildContinuousPathPlan(course);
    expect(plan.edges).toHaveLength(0); expect(plan.nodes).toHaveLength(kind === 'isolated' ? 1 : 2); expect(plan.nodes.every((node) => node.kind === 'isolated')).toBe(true);
    if (kind === 'corner') expect(classifyContinuousPathPoint(plan, { x: 4, y: 4 })).toBeNull();
    assertContained(plan, course.width, course.height);
  });
});
