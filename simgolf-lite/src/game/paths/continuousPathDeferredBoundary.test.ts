import { describe, expect, it } from 'vitest';
import type { ContinuousPathLayer } from './continuousPathPlan';
import { createDeferredPathLayer } from './continuousPathRibbon';

const quad = [2, 2, 4, 2, 4, 3, 2, 3];
const triangles = [0, 1, 2, 0, 2, 3];

/** Observe coordinate reads without changing any value or adding a mesh copy. */
function observePositions(values: readonly number[]) {
  const positions = [...values];
  let reads = 0; let failure = false;
  for (let index = 0; index < values.length; index++) Object.defineProperty(positions, index, {
    enumerable: true, configurable: true,
    get: () => {
      reads++;
      if (failure && index === 3) throw new Error('observed coordinate read failed');
      return values[index];
    },
  });
  return { positions, count: () => reads, reset: () => { reads = 0; }, fail: (value: boolean) => { failure = value; } };
}

describe('deferred exact continuous-path boundary values', () => {
  it('keeps the original enumerable order and buffers without reading coordinates', () => {
    const observed = observePositions(quad);
    const layer = createDeferredPathLayer('core', observed.positions, triangles);
    expect(Object.keys(layer)).toEqual(['role', 'rings', 'positions', 'indices']);
    const descriptor = Object.getOwnPropertyDescriptor(layer, 'rings')!;
    expect(descriptor.enumerable).toBe(true); expect(typeof descriptor.get).toBe('function'); expect(descriptor.set).toBeUndefined();
    expect(layer.positions).toBe(observed.positions); expect(layer.indices).toBe(triangles); expect(layer.role).toBe('core');
    expect(observed.count()).toBe(0);
  });

  it('reads every coordinate on first demand and reuses one successful result', () => {
    const observed = observePositions(quad);
    const layer = createDeferredPathLayer('core', observed.positions, triangles);
    const first = layer.rings;
    expect(observed.count()).toBe(quad.length);
    expect(first).toHaveLength(1); expect(first[0]).toHaveLength(4);
    expect(first[0]).toEqual(expect.arrayContaining([{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 2, y: 3 }]));
    observed.reset(); observed.fail(true);
    expect(layer.rings).toBe(first); expect(observed.count()).toBe(0);
  });

  it('does not cache a failure or return a partial/empty substitute', () => {
    const observed = observePositions(quad);
    const layer = createDeferredPathLayer('core', observed.positions, triangles);
    observed.fail(true);
    expect(() => layer.rings).toThrow('observed coordinate read failed');
    observed.fail(false); observed.reset();
    const complete = layer.rings;
    expect(complete).toHaveLength(1); expect(complete[0]).toHaveLength(4); expect(observed.count()).toBe(quad.length);
    observed.reset(); observed.fail(true);
    expect(layer.rings).toBe(complete); expect(observed.count()).toBe(0);
  });

  it('initializes its private cache even after the layer object is frozen', () => {
    const observed = observePositions(quad);
    const layer = Object.freeze(createDeferredPathLayer('edge', observed.positions, triangles));
    expect(observed.count()).toBe(0);
    const first = layer.rings;
    expect(first).toHaveLength(1); expect(layer.rings).toBe(first); expect(observed.count()).toBe(quad.length);
  });

  it('caches independent empty values for each layer', () => {
    const first = createDeferredPathLayer('core', [], []), second = createDeferredPathLayer('edge', [], []);
    expect(first.rings).toEqual([]); expect(first.rings).toBe(first.rings); expect(first.rings).not.toBe(second.rings);
  });

  it.each([1, 2, 6, 7, 9])('rejects an incomplete %i-number quad layout clearly', length => {
    expect(() => createDeferredPathLayer('core', new Array(length).fill(0), [])).toThrow('eight-number quad blocks');
  });

  it('retains all packed quads even when indices omit one face or every face', () => {
    const taper = [2, 2, 4, 2, 4, 2, 2, 3];
    const normal = createDeferredPathLayer('core', taper, [0, 2, 3]);
    const unused = createDeferredPathLayer('core', taper, []);
    expect(normal.rings).toHaveLength(1); expect(normal.rings[0]).toHaveLength(3); expect(unused.rings).toEqual(normal.rings);
    const bothFiltered = observePositions([0, 0, 1e-5, 0, 1e-5, 1.5e-7, 0, 1.5e-7]);
    const area = 1e-5 * 1.5e-7;
    expect(area).toBeGreaterThan(1e-12); expect(area / 2).toBeLessThanOrEqual(1e-12);
    const tiny = createDeferredPathLayer('shoulder', bothFiltered.positions, []);
    expect(tiny.rings).toEqual([]); expect(bothFiltered.count()).toBe(8);
  });

  it('reconstructs each consecutive block and retains polygon order', () => {
    const observed = observePositions([...quad, 6, 2, 7, 2, 7, 3, 6, 3]);
    const layer = createDeferredPathLayer('core', observed.positions, []);
    expect(layer.rings).toHaveLength(2); expect(observed.count()).toBe(16);
    expect(layer.rings[0].every(point => point.x <= 4)).toBe(true);
    expect(layer.rings[1].every(point => point.x >= 6)).toBe(true);
  });

  it('owns independent ring points without freezing or aliasing exported geometry', () => {
    const positions = [...quad];
    const first = createDeferredPathLayer('core', positions, triangles), second = createDeferredPathLayer('edge', positions, triangles);
    const firstRings = first.rings, secondRings = second.rings;
    const allPoints = [...firstRings.flat(), ...secondRings.flat()];
    expect(new Set(allPoints).size).toBe(allPoints.length);
    const otherX = secondRings[0][0].x;
    firstRings[0][0].x = -9;
    expect(first.rings[0][0].x).toBe(-9); expect(secondRings[0][0].x).toBe(otherX); expect(positions).toEqual(quad);
  });

  it.each([
    { name: 'values', read: (layer: ContinuousPathLayer) => Object.values(layer) },
    { name: 'entries', read: (layer: ContinuousPathLayer) => Object.entries(layer) },
    { name: 'spread', read: (layer: ContinuousPathLayer) => ({ ...layer }) },
    { name: 'assign', read: (layer: ContinuousPathLayer) => Object.assign({}, layer) },
    { name: 'JSON', read: (layer: ContinuousPathLayer) => JSON.stringify(layer) },
  ])('makes $name demand exact rings rather than hide them', ({ name, read }) => {
    const observed = observePositions(quad);
    const layer = createDeferredPathLayer('core', observed.positions, triangles);
    expect(observed.count()).toBe(0);
    read(layer);
    // JSON also reads the positions field itself after demanding rings.
    expect(observed.count()).toBe(quad.length * (name === 'JSON' ? 2 : 1)); expect(layer.rings).toHaveLength(1);
  });
});
