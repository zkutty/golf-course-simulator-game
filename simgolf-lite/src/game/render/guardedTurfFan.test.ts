import { describe, expect, it } from "vitest";
import { copyGuardedTurfFan, guardedTurfFanEligible, guardedTurfFanKernelBytes,
  hasOwnedHighTurfFanRegistration, prepareGuardedTurfFan, withOwnedHighTurfFan } from "./guardedTurfFan";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { prepareGuardedTurfFan as prepareReference } from "./guardedTurfFan.reference.test-data";
import { createM27ReleaseReferenceCourse } from "../testing/referenceCourse";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { buildVisualHeightfield, createLandscapeComponentCache,
  sampleLandscapeSurfaceHeight, type LandscapeComponent } from "./landscapeGeometry";
import { buildTerrainPresentationMap } from "./terrainPresentationPolicy";
import { isoDepth, worldToIso } from "./iso";
import { buildParklandComposableMeshGeometry, PARKLAND_COMPOSABLE_SEMANTICS as roles } from "./parklandComposable";
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

// The whole original module is frozen, not a reimplemented approximation of
// the changed loop. Compare result bits, including Infinity and signed zero.
const digest = (data: Float32Array | Uint32Array) => createHash("sha256").update(
  new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
).digest("hex");
function samePreparation(data: Readonly<{ positions: Float32Array; uvs: Float32Array; indices: Uint32Array }>, units = 1) {
  const before = [digest(data.positions), digest(data.uvs), digest(data.indices)];
  const reference = prepareReference(data.positions, data.uvs, data.indices, units);
  const actual = prepareGuardedTurfFan(data.positions, data.uvs, data.indices, units);
  if (reference === null) expect(actual).toBeNull();
  else {
    expect(actual).not.toBeNull();
    expect(actual!.length).toBe(reference.length);
    const bytes = (value: Float64Array) => Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    expect(bytes(actual!).equals(bytes(reference))).toBe(true);
  }
  expect([digest(data.positions), digest(data.uvs), digest(data.indices)]).toEqual(before);
  return actual;
}

describe("scalar fan validation against frozen172 whole-module oracle", () => {
  it("pins the unmodified original implementation bytes", () => {
    const bytes = readFileSync(new URL("./guardedTurfFan.reference.test-data.ts", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("e3a042bab010917dfdeac7267b25bef1e40a991e443e322b0ae091270a13fe30");
  });

  it("preserves exact error bytes for valid, curved, cliff, folded and degenerate inputs", () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      for (const height of [() => 0, (x: number, y: number) => .1 * x * y,
        (x: number, y: number) => .03 * x * y + .02 * Math.sin(x * 2 + y),
        (_x: number, y: number) => y < 2 ? 0 : 15]) {
        expect(samePreparation(cell(height, rotation))).not.toBeNull();
      }
    }
    const folded = cell();folded.positions[24] += 1000;folded.positions[25] += 1000;
    expect(samePreparation(folded)?.every(value => value === Infinity)).toBe(true);
    const degenerate = cell();degenerate.positions.fill(0);
    expect(samePreparation(degenerate)?.every(value => value === Infinity)).toBe(true);
    const signedZero = cell();signedZero.positions[0] = -0;signedZero.uvs[0] = -0;
    expect(samePreparation(signedZero)).not.toBeNull();
    const phaseEdge = cell();for (let i = 0; i < phaseEdge.uvs.length; i++) phaseEdge.uvs[i] += 127.875;
    expect(samePreparation(phaseEdge)).not.toBeNull();
  });

  it("preserves null fallbacks and each of the six ordered topology comparisons", () => {
    for (let index = 0; index < 6; index++) {
      const changed = cell(), at = 30 + index;
      changed.indices[at] = (changed.indices[at] + 2) % 25;
      expect(samePreparation(changed)).toBeNull();
    }
    for (const value of [NaN, Infinity, -Infinity, 2 ** 20 + 1, -(2 ** 20 + 1)]) {
      const changed = cell();changed.positions[0] = value;expect(samePreparation(changed)).toBeNull();
    }
    for (const value of [NaN, Infinity, -Infinity, -1 / 32, 1 / 64, 128]) {
      const changed = cell();changed.uvs[0] = value;expect(samePreparation(changed)).toBeNull();
    }
    const outOfRange = cell();outOfRange.indices[0] = 0xffffffff;expect(samePreparation(outOfRange)).toBeNull();
    const odd = cell();odd.positions = odd.positions.slice(1);expect(samePreparation(odd)).toBeNull();
    const shortUV = cell();shortUV.uvs = shortUV.uvs.slice(1);expect(samePreparation(shortUV)).toBeNull();
    const shortIndices = cell();shortIndices.indices = shortIndices.indices.slice(1);expect(samePreparation(shortIndices)).toBeNull();
    for (const units of [-1, 0, 1.5, 2, 62_500, 62_501, Number.MAX_SAFE_INTEGER, NaN, Infinity]) {
      expect(samePreparation(cell(), units)).toBeNull();
    }
    const coordinateEdge = cell();coordinateEdge.positions[0] = 2 ** 20;
    expect(samePreparation(coordinateEdge)).not.toBeNull();
    const pair = cell((x, y) => .05 * x * y), first = cell();
    const two = { positions: new Float32Array(100), uvs: new Float32Array(100), indices: new Uint32Array(192) };
    two.positions.set(first.positions);two.positions.set(pair.positions, 50);
    two.uvs.set(first.uvs);two.uvs.set(pair.uvs, 50);
    two.indices.set(first.indices);two.indices.set(pair.indices.map(index => index + 25), 96);
    expect(samePreparation(two, 2)).toHaveLength(4);
  });

  it("compares every full M27 field and its distinct paired cue arrays to the frozen oracle", () => {
    const course = normalizeCourseLayouts(createM27ReleaseReferenceCourse("parkland"));
    const heightfield = buildVisualHeightfield(course), effective = courseWithEffectiveSurfaces(course).tiles;
    const presentation = buildTerrainPresentationMap(effective, course.width, course.height, course.theme).presentationTiles;
    const cache = createLandscapeComponentCache(), options = { cornerRadius: .4, cornerSegments: 4 };
    try {
      cache.update(effective, course.width, course.height, options);
      const components = cache.update(presentation, course.width, course.height, options).components;
      const componentDepth = (component: LandscapeComponent) => {
        let total = 0, samples = 0;
        const step = Math.max(1, Math.floor(component.cells.length / 64));
        for (let cursor = 0; cursor < component.cells.length; cursor += step) {
          const index = component.cells[cursor], x = index % course.width, y = Math.floor(index / course.width);
          total += isoDepth(x + .5, y + .5, sampleLandscapeSurfaceHeight(heightfield, component, x + .5, y + .5), 0);
          samples++;
        }
        return total / Math.max(1, samples);
      };
      const depths = new Map<LandscapeComponent, number>();
      const depth = (component: LandscapeComponent) => {
        if (depths.has(component)) return depths.get(component)!;
        const value = componentDepth(component);depths.set(component, value);return value;
      };
      const sorted = [...components].sort((a, b) => depth(a) - depth(b));
      // These pins come from the already-qualified original M27 source/24-buffer
      // identity evidence. UVs were source-built, not captured browser inputs.
      const expected = [
        [10116, "85eed6cce5972707a9ed90d766af7aafbdcba25e481f2aec06881fc02f760584", "611fbd3a36c329681fb7cd204c63d4fde992355733485a61a7499dcfa758a3b2", "d982c2ad8aa96b243cd73dcea4db4a1f36d43e6c5ee1762eb0a3c4656a746c9d"],
        [19105, "2b8dce78db2ed11b1973a4bcef163113c0cad914dcb803a8a73fdfe87542831d", "c4a8b351784ef088e2b0214f9075125e578bee5dd32390f723fc4414f80439bf", "3efbf0f81518949d0ae19e4d7960996ecbf85a2d082bee9b2172787734cf3f6e"],
        [40, "2ac882af1e8ad456689dbff145f8d5fe87c17c695347ee50f1963434fc354e90", "d94ce6d4fd7994f2243228f08dbde091f1443a58061dfc52f04938a1658cffcc", "2899ae3b4fbf312a3446bdf053608e607422521fd22f19b03ea29e09a4b431a0"],
        [324, "07eba866ac18b5140fef34cb85091a42163c4fa52540a28ae39920901fd6b515", "111e8a92ac14243a1d5fb14f3ca8066616e4ff961aac248a8fb5b46c84afe4f5", "00e61109275f3ebe09c67344a0e4adcd4aadc6a20a3968775578c10ef0460b39"],
        [36, "5c6538890104daabd6770cbffd4352cb2475c437489c43b9767cc330f8d78132", "5d14e1c9897dccef1521a0dee593ba4422b347e56d111b037e01cc92471cc99b", "1fd8196b970d54cf2de6cea373001a4140a0090bf562d96aa76a4396e60b657e"],
      ] as const;
      let units = 0;
      for (let role = 0; role < roles.length; role++) {
        const entries = sorted.filter(component => component.terrain === roles[role])
          .flatMap(component => component.cells.map(index => ({ index, component })));
        const data = buildParklandComposableMeshGeometry(entries, course.width, 4, entry => entry.index,
          (entry, x, y) => worldToIso(x, y, sampleLandscapeSurfaceHeight(heightfield, entry.component, x, y), 0),
          entries.length * 64 > 100);
        const [count, positions, uvs, indices] = expected[role];
        expect(entries.length).toBe(count);
        expect([digest(data.positions), digest(data.uvs), digest(data.indices)]).toEqual([positions, uvs, indices]);
        expect(samePreparation(data, count)).toHaveLength(count * 2);
        const cue = { positions: data.positions.slice(), uvs: data.uvs.slice(), indices: data.indices.slice() };
        expect(cue.positions.buffer).not.toBe(data.positions.buffer);
        expect(samePreparation(cue, count)).toHaveLength(count * 2);
        units += count * 2;
      }
      expect(units).toBe(59_242);
    } finally { cache.clear(); }
  });
});
