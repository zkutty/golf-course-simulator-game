import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Point, SurfaceFeature } from '../models/types';
import { rasterizeSurfaceFeatureDetailed } from '../models/surfaceIntent';
import { authoredPathFixture, continuousPathFixture, type ContinuousPathFixture } from '../testing/continuousPathFixtures';
import reference from '../testing/continuousPathBoundaryReference.json';
import { buildContinuousPathPlan, type ContinuousPathInput, type ContinuousPathLayer, type ContinuousPathPlan } from './continuousPathPlan';
import { buildPathRibbon } from './continuousPathRibbon';
import type { PathChain } from './continuousPathTopology';

type PlanCase = { name: string; kind: 'plan'; input: ContinuousPathInput };
type RibbonInput = { chains: PathChain[]; coverage: number[]; width: number; height: number };
type RibbonCase = { name: string; kind: 'ribbon'; input: RibbonInput };
export type BoundaryCase = PlanCase | RibbonCase;
export type BoundaryOutput = ContinuousPathPlan | ContinuousPathLayer[];

export const boundaryDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function paint(course: ContinuousPathFixture, points: readonly (readonly number[])[]): ContinuousPathFixture {
  for (const [x, y] of points) course.tiles[y * course.width + x] = 'path';
  return course;
}

function crossing(reversed = false): ContinuousPathFixture {
  const course = authoredPathFixture([{ x: 2.5, y: 7.5 }, { x: 12.5, y: 7.5 }], 1);
  const other = authoredPathFixture([{ x: 7.5, y: 2.5 }, { x: 7.5, y: 12.5 }], 1).surfaceIntent!.features[0];
  const second: SurfaceFeature = { ...other, id: 'surface-2', order: 2 };
  course.surfaceIntent!.features.push(second);
  for (const cell of second.coverage) course.tiles[cell] = 'path';
  if (reversed) course.surfaceIntent!.features.reverse();
  return course;
}

function savedCorner(detour: boolean): ContinuousPathFixture {
  const course = continuousPathFixture('empty');
  const points = detour ? [[2, 2], [2, 1], [3, 1], [4, 1], [4, 2], [4, 3], [3, 3]] : [[3, 3], [4, 4]];
  paint(course, points);
  const corner = detour ? 3 : 4;
  course.surfaceIntent = { version: 1, nextId: 2, features: [{ id: 'surface-1', order: 1, terrain: 'path', coverage: points.map(([x, y]) => y * course.width + x), geometry: { kind: 'corridor', width: 1, knots: [{ x: corner - .5, y: corner - .5 }, { x: corner + .5, y: corner + .5 }] } }] };
  return course;
}

function ribbon(name: string, pointSets: Point[][], widths: number[] = [.6], closed = false): RibbonCase {
  const width = 8, height = 8;
  const coverage = Array.from({ length: width * height }, (_, cell) => cell);
  const chains: PathChain[] = pointSets.map((points, index) => ({ points, coverage: [...coverage], width: widths[index % widths.length], source: 'intent', featureIds: [`boundary-${index}`], closed }));
  return { name, kind: 'ribbon', input: { chains, coverage, width, height } };
}

/** Frozen named inputs; changing these requires a new reviewed reference, never a digest refresh. */
export function continuousPathBoundaryCases(): BoundaryCase[] {
  const cases: BoundaryCase[] = [];
  for (const kind of ['empty', 'straight', 'diagonal', 'bend', 'T', 'cross', 'loop', 'isolated', 'broad', 'corner'] as const) cases.push({ name: `tile-${kind}`, kind: 'plan', input: continuousPathFixture(kind) });
  const extended = continuousPathFixture('straight'); extended.tiles[4 * extended.width + 11] = 'path';
  cases.push({ name: 'tile-straight-extended-preview', kind: 'plan', input: extended });
  for (const size of [2, 4]) {
    const course = continuousPathFixture('empty');
    for (let y = 4; y < 4 + size; y++) for (let x = 4; x < 4 + size; x++) course.tiles[y * course.width + x] = 'path';
    cases.push({ name: `tile-even-brush-${size}`, kind: 'plan', input: course });
  }
  cases.push({ name: 'tile-open-detour', kind: 'plan', input: paint(continuousPathFixture('empty'), [[2, 2], [2, 1], [3, 1], [4, 1], [4, 2], [4, 3], [3, 3]]) });
  for (const width of [1, 1.5, 2.5]) cases.push({ name: `saved-S-width-${width}`, kind: 'plan', input: authoredPathFixture(undefined, width) });
  const explicit = authoredPathFixture();
  const feature = explicit.surfaceIntent!.features[0];
  if (feature.geometry.kind !== 'corridor') throw new Error('Expected corridor fixture');
  feature.geometry.tangents = feature.geometry.knots.map(point => ({ in: { x: point.x - .6, y: point.y }, out: { x: point.x + .6, y: point.y } }));
  const raster = rasterizeSurfaceFeatureDetailed(feature, explicit.width, explicit.height);
  explicit.tiles.fill('rough'); feature.coverage = raster.tiles.map(point => point.y * explicit.width + point.x);
  for (const cell of feature.coverage) explicit.tiles[cell] = 'path';
  cases.push({ name: 'saved-S-explicit-tangents', kind: 'plan', input: explicit });
  const knots = [{ x: 2.5, y: 3.5 }, { x: 6.5, y: 2.5 }, { x: 9.5, y: 6.5 }, { x: 13.5, y: 5.5 }];
  cases.push({ name: 'saved-S-translated', kind: 'plan', input: authoredPathFixture(knots.map(point => ({ x: point.x + .17, y: point.y - .13 }))) });
  cases.push({ name: 'saved-S-reversed', kind: 'plan', input: authoredPathFixture([...knots].reverse()) });
  const gap = authoredPathFixture([{ x: 2.5, y: 4.5 }, { x: 12.5, y: 4.5 }], 1);
  gap.tiles[4 * gap.width + 7] = 'water'; gap.surfaceIntent!.features[0].coverage = gap.surfaceIntent!.features[0].coverage.filter(cell => cell !== 4 * gap.width + 5);
  cases.push({ name: 'saved-overwrite-gap-excluded-orphan', kind: 'plan', input: gap });
  cases.push({ name: 'saved-crossing', kind: 'plan', input: crossing() });
  cases.push({ name: 'saved-crossing-reordered', kind: 'plan', input: crossing(true) });
  const transition = authoredPathFixture([{ x: 2.5, y: 6.5 }, { x: 7.5, y: 6.5 }], 1);
  const other = authoredPathFixture([{ x: 7.5, y: 6.5 }, { x: 12.5, y: 6.5 }], 2.5).surfaceIntent!.features[0];
  transition.surfaceIntent!.features.push({ ...other, id: 'surface-2', order: 2 });
  for (const cell of other.coverage) transition.tiles[cell] = 'path';
  cases.push({ name: 'saved-width-feature-transition', kind: 'plan', input: transition });
  const legacy = authoredPathFixture([{ x: 2.5, y: 6.5 }, { x: 7.5, y: 6.5 }], 1);
  for (let x = 8; x <= 12; x++) legacy.tiles[6 * legacy.width + x] = 'path';
  cases.push({ name: 'saved-to-legacy-transition', kind: 'plan', input: legacy });
  cases.push({ name: 'saved-corner-contact', kind: 'plan', input: savedCorner(false) });
  cases.push({ name: 'saved-corner-remote-detour', kind: 'plan', input: savedCorner(true) });
  cases.push({ name: 'saved-S-repeat-independent', kind: 'plan', input: authoredPathFixture() });
  const axis = Array.from({ length: 25 }, (_, index) => ({ x: 1.25 + index * .22, y: 3.5 }));
  cases.push(ribbon('ribbon-axis-partition-many-cuts', [axis, [{ x: 3.5, y: 1.25 }, { x: 3.5, y: 6.5 }]], [.6, .9]));
  cases.push(ribbon('ribbon-near-coincident-weld-anchors', [0, 1e-7, 2e-7].map(offset => [{ x: 1.5 + offset, y: 2.5 + offset }, { x: 4.5 + offset, y: 3.25 + offset }, { x: 6.5 + offset, y: 2.5 + offset }])));
  cases.push(ribbon('ribbon-narrow-quantized-slabs', [0, 1.5e-8, 3e-8].map(offset => [{ x: 2.000000011 + offset, y: 1.5 }, { x: 2.000000026 + offset, y: 4.5 }, { x: 5.5, y: 5.5 + offset }])));
  cases.push(ribbon('ribbon-repeated-overlapping-chains', [axis, axis.map(point => ({ ...point })), axis.map(point => ({ ...point }))]));
  cases.push(ribbon('ribbon-reversed-chain', [[{ x: 6.5, y: 2.5 }, { x: 4.5, y: 3.25 }, { x: 1.5, y: 2.5 }]]));
  cases.push(ribbon('ribbon-closed-mini-loop', [[{ x: 2.5, y: 2.5 }, { x: 4.5, y: 2.5 }, { x: 4.5, y: 4.5 }, { x: 2.5, y: 4.5 }, { x: 2.5, y: 2.5 }]], [.6], true));
  for (const delta of [.5e-8, 1e-8, 1.5e-8]) cases.push(ribbon(`ribbon-EPS-offset-${delta}`, [[{ x: 1.5, y: 3.5 }, { x: 3 + delta, y: 3.5 }, { x: 3.5 + delta, y: 4.5 }, { x: 6.5, y: 4.5 }], [{ x: 3 - delta, y: 2.5 }, { x: 3 - delta, y: 5.5 }]], [.6, .6]));
  return cases;
}

export function buildBoundaryCase(sample: BoundaryCase): BoundaryOutput {
  return sample.kind === 'plan' ? buildContinuousPathPlan(sample.input) : buildPathRibbon(sample.input.chains, sample.input.coverage, sample.input.width, sample.input.height);
}

export function assertBoundaryFinite(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite boundary output');
  if (value && typeof value === 'object') for (const child of Object.values(value)) assertBoundaryFinite(child);
}

export function assertIndependentRingPoints(output: BoundaryOutput): void {
  const layers = Array.isArray(output) ? output : output.layers;
  const seen = new Set<Point>();
  for (const layer of layers) for (const ring of layer.rings) for (const point of ring) {
    if (seen.has(point)) throw new Error('Ring point object is aliased across exported positions');
    seen.add(point);
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

describe('accepted G boundary extraction exact equivalence', () => {
  const cases = continuousPathBoundaryCases();
  it('keeps the reviewed named input manifest intact', () => {
    expect(reference.format).toBe('continuous-path-boundary-reference-v1');
    expect(cases.map(sample => sample.name)).toEqual(reference.cases.map(sample => sample.name));
    expect(reference.acceptedCommit).toBe('10c85b89a9bf82afa9b0942b13072e05de06416a');
  });
  it.each(cases)('$name preserves the complete serialized accepted output', sample => {
    const baseline = reference.cases.find(row => row.name === sample.name);
    expect(baseline).toBeDefined();
    expect(boundaryDigest(sample.input)).toBe(baseline!.inputSha256);
    const originalInput = JSON.stringify(sample.input);
    freeze(sample.input);
    const output = buildBoundaryCase(sample);
    assertBoundaryFinite(output); assertIndependentRingPoints(output);
    expect(JSON.stringify(sample.input)).toBe(originalInput);
    expect(boundaryDigest(output)).toBe(baseline!.outputSha256);
    if (sample.kind === 'plan' && !Array.isArray(output)) expect(output.underlayTiles).not.toBe(sample.input.tiles);
  });
});
