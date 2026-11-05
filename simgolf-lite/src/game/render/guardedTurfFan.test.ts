import { describe, expect, it } from "vitest";
import { copyGuardedTurfFan, guardedTurfFanEligible, guardedTurfFanKernelBytes,
  hasOwnedHighTurfFanRegistration, prepareGuardedTurfFan, withOwnedHighTurfFan } from "./guardedTurfFan";
function cell(height = (_x: number, _y: number) => 0, rotation = 0) {
  const positions = new Float32Array(50), uvs = new Float32Array(50), indices = new Uint32Array(96);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const at = (y * 5 + x) * 2;
    let a = x, b = y;
    for (let r = 0; r < rotation; r++) [a, b] = [-b, a];
    positions[at] = (a - b) * 8; positions[at + 1] = (a + b) * 4 - height(x, y);
    uvs[at] = x / 32; uvs[at + 1] = y / 32;
  }
  let cursor = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const g = y * 5 + x;
    indices.set([g, g + 1, g + 6, g, g + 6, g + 5], cursor); cursor += 6;
  }
  return { positions, uvs, indices };
}
describe("fixed guarded High turf fan", () => {
  it("retains every boundary vertex and original byte buffers, with exactly16wound triangles", () => {
    const g = cell(), before = [g.positions.slice(), g.uvs.slice(), g.indices.slice()];
    const error = prepareGuardedTurfFan(g.positions, g.uvs, g.indices, 1)!;
    const target = new Uint32Array(96); expect(copyGuardedTurfFan(g.indices, 0, target, 0)).toBe(48);
    expect(new Set(target.subarray(0, 48))).toEqual(new Set([12, 0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5]));
    for (let i = 0; i < 48; i += 3) expect(target[i]).toBe(12);
    expect([g.positions, g.uvs, g.indices]).toEqual(before);
    expect(error[0]).toBeLessThan(1e-6); expect(error[1]).toBeLessThan(1e-6);
    expect(guardedTurfFanKernelBytes()).toBeLessThan(16 * 1024);
  });
  it("certifies flat geometry across4rotations and the actual .15to8camera domain", () => {
    for (let r = 0; r < 4; r++) {
      const g = cell(undefined, r), e = prepareGuardedTurfFan(g.positions, g.uvs, g.indices, 1)!;
      for (const scale of [.15, .27087962962962964, .5, 1, 2, 4, 8]) expect(guardedTurfFanEligible(e, 0, scale, .01)).toBe(true);
    }
  });
  it("retains original detail for curvature at closezoom and uncertain rounding", () => {
    const g = cell((x, y) => .1 * x * y), e = prepareGuardedTurfFan(g.positions, g.uvs, g.indices, 1)!;
    expect(guardedTurfFanEligible(e, 0, .15, .001)).toBe(true);
    expect(guardedTurfFanEligible(e, 0, 8, .001)).toBe(false);
    expect(guardedTurfFanEligible(e, 0, .15, .1)).toBe(false);
    for (const scale of [NaN, Infinity, -1, 0]) expect(guardedTurfFanEligible(e, 0, scale, 0)).toBe(false);
  });
  it("declines malformed topology, UV phase, nonfinite data and unknown stride", () => {
    const g = cell();g.indices[4] = 3;expect(prepareGuardedTurfFan(g.positions, g.uvs, g.indices, 1)).toBeNull();
    const uv = cell();uv.uvs[2] += 2 ** -25;expect(prepareGuardedTurfFan(uv.positions, uv.uvs, uv.indices, 1)).toBeNull();
    const bad = cell();bad.positions[0] = NaN;expect(prepareGuardedTurfFan(bad.positions, bad.uvs, bad.indices, 1)).toBeNull();
    expect(prepareGuardedTurfFan(cell().positions, cell().uvs, new Uint32Array(48), 1)).toBeNull();
  });
  it("rejects folded or degenerate cells without approximating them", () => {
    for (const amount of [100, 1000]) {
      const g = cell();g.positions[24] += amount;g.positions[25] += amount;
      const e = prepareGuardedTurfFan(g.positions, g.uvs, g.indices, 1)!;
      expect(guardedTurfFanEligible(e, 0, .15, 0)).toBe(false);
    }
  });
  it("bounds an independent full old/fan edge-intersection overlay oracle", () => {
    const g = cell((x, y) => .03 * x * y + .02 * Math.sin(x * 2 + y));
    const e = prepareGuardedTurfFan(g.positions, g.uvs, g.indices, 1)!;
    const fan = new Uint32Array(48);copyGuardedTurfFan(g.indices, 0, fan, 0);
    const uv = (v: number) => [g.uvs[v * 2] * 32, g.uvs[v * 2 + 1] * 32];
    const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1]];
    const edges = (indices: Uint32Array) => Array.from({ length: indices.length }, (_, i) => [uv(indices[i]), uv(indices[Math.floor(i / 3) * 3 + (i + 1) % 3])]);
    const points = Array.from({ length: 25 }, (_, v) => uv(v));
    for (const [a, b] of edges(g.indices)) for (const [c, d] of edges(fan)) {
      const ab = sub(b, a), cd = sub(d, c), ca = sub(c, a), den = cross(ab, cd);
      if (den === 0) continue;
      const u = cross(ca, cd) / den, v = cross(ca, ab) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) points.push([a[0] + u * ab[0], a[1] + u * ab[1]]);
    }
    const sample = (indices: Uint32Array, point: number[]) => {
      for (let i = 0; i < indices.length; i += 3) {
        const ids = [indices[i], indices[i + 1], indices[i + 2]], a = uv(ids[0]), b = uv(ids[1]), c = uv(ids[2]);
        const denominator = cross(sub(b, a), sub(c, a));
        const w = cross(sub(b, point), sub(c, point)) / denominator;
        const u = cross(sub(c, point), sub(a, point)) / denominator, v = 1 - w - u;
        if (w < -1e-12 || u < -1e-12 || v < -1e-12) continue;
        return [0, 1].map(axis => w * g.positions[ids[0] * 2 + axis] + u * g.positions[ids[1] * 2 + axis] + v * g.positions[ids[2] * 2 + axis]);
      }
      throw new Error("independent overlay uncovered");
    };
    let witnessed = 0;
    for (const point of points) {
      const old = sample(g.indices, point), next = sample(fan, point);
      for (let axis = 0; axis < 2; axis++) { const error = Math.abs(old[axis] - next[axis]); expect(e[axis]).toBeGreaterThanOrEqual(error);witnessed = Math.max(witnessed, error); }
    }
    expect(witnessed).toBeGreaterThan(.01);
  });
  it("transient admission retains no marker after original callback return or throw", () => {
    const owner = {};expect(hasOwnedHighTurfFanRegistration(owner)).toBe(false);
    withOwnedHighTurfFan(owner, () => expect(hasOwnedHighTurfFanRegistration(owner)).toBe(true));
    expect(hasOwnedHighTurfFanRegistration(owner)).toBe(false);
    expect(() => withOwnedHighTurfFan(owner, () => { throw new Error("original"); })).toThrow("original");
    expect(hasOwnedHighTurfFanRegistration(owner)).toBe(false);
  });
});
