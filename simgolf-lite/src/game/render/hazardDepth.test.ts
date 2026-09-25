import { describe, expect, it } from "vitest";
import {
  hazardDepthOffsets,
  hazardDepthProfile,
  hazardInteriorDropAt,
  buildHazardBankFacePlan,
} from "./hazardDepth";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";

describe("hazard depth cross-sections", () => {
  it("eases bunker grade monotonically into a lower sand floor", () => {
    for (const cellCount of [1, 3, 12]) {
      const profile = hazardDepthProfile("sand", cellCount)!;
      const distances = [0, 0.06, 0.12, 0.24, 0.36, 0.48, 0.8];
      const drops = distances.map((distance) => hazardInteriorDropAt(profile, distance));
      expect(drops[0]).toBe(0);
      expect(drops.at(-1)).toBe(profile.floorDrop);
      for (let index = 1; index < drops.length; index++) {
        expect(drops[index]).toBeGreaterThanOrEqual(drops[index - 1]);
      }
      expect(profile.floorDrop).toBeGreaterThanOrEqual(profile.minimumBankDrop - 0.05);
    }
  });

  it("finishes the bunker recession at its joined inner lip", () => {
    for (const cellCount of [1, 3, 12]) {
      const profile = hazardDepthProfile("sand", cellCount)!;
      expect(profile.recessionRun).toBe(profile.bankWidth);
      expect(hazardInteriorDropAt(profile, profile.bankWidth)).toBe(profile.floorDrop);
    }
  });

  it("reserves a normal-scale face instead of an outline-sized recess", () => {
    expect(hazardDepthProfile("water")!.minimumBankDrop * 8).toBeGreaterThanOrEqual(6);
    expect(hazardDepthProfile("wetland")!.minimumBankDrop * 8).toBeGreaterThanOrEqual(5);
    for (const cellCount of [1, 3, 12]) {
      const profile = hazardDepthProfile("sand", cellCount)!;
      expect(profile.minimumBankDrop * 8).toBeGreaterThanOrEqual(4);
      expect(profile.floorDrop).toBeGreaterThanOrEqual(profile.minimumBankDrop);
    }
  });

  it("orders a finite shelf, bank, contact, shallow, and deep section", () => {
    for (const terrain of ["sand", "water", "wetland"] as const) {
      const profile = hazardDepthProfile(terrain, 4)!;
      for (const edgeLength of [0.04, 0.2, 1, Number.POSITIVE_INFINITY]) {
        const offsets = hazardDepthOffsets(profile, edgeLength);
        expect(Object.values(offsets).every(Number.isFinite)).toBe(true);
        expect(offsets.shelfOuter).toBeLessThan(offsets.boundary);
        expect(offsets.boundary).toBeLessThan(offsets.bankInner);
        expect(offsets.bankInner).toBeLessThan(offsets.contactInner);
        expect(offsets.contactInner).toBeLessThan(offsets.shallowInner);
        expect(offsets.shallowInner).toBeLessThan(offsets.deepInner);
        expect(offsets.deepInner).toBeLessThanOrEqual(0.72);
      }
    }
  });

  it("contains no ecology or camera ownership", () => {
    const serialized = JSON.stringify(hazardDepthProfile("water"));
    expect(serialized).not.toMatch(/reed|stone|tuft|rotation|camera/i);
    expect(hazardDepthProfile("rough")).toBeNull();
  });

  it("plans one joined bank skirt with shared indexed inner vertices", () => {
    const ring = [
      { x: 1.125, y: 2.25 },
      { x: 4.75, y: 2.25 },
      { x: 4.75, y: 5.625 },
      { x: 1.125, y: 5.625 },
    ];
    for (const terrain of ["sand", "water", "wetland"] as const) {
      const plan = buildHazardBankFacePlan(terrain, 6, ring)!;
      expect(plan.suppressedFillKinds).toEqual(["shelf", "contact", "shallow", "deep"]);
      expect(plan.outerRing).toEqual(ring);
      expect(plan.innerRing).toHaveLength(ring.length);
      expect(plan.stripIndices).toHaveLength(ring.length * 6);
      expect(new Set(plan.innerRing.map((point) => `${point.x},${point.y}`)).size).toBe(ring.length);
      expect(plan.innerRing.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      expect(plan.lip.offset).toBe(0);
      expect(plan.lip.width).toBeGreaterThan(0);
    }
  });

  it("keeps a finite, consistently wound non-self-intersecting strip at concave turns", () => {
    const ring = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 },
      { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 },
    ];
    const plan = buildHazardBankFacePlan("sand", 8, ring)!;
    const vertices = plan.outerRing.flatMap((outer, index) => [outer, plan.innerRing[index]]);
    const triangleAreas = plan.stripIndices.reduce<number[]>((areas, _, index) => {
      if (index % 3 !== 0) return areas;
      const [a, b, c] = plan.stripIndices.slice(index, index + 3).map((vertex) => vertices[vertex]);
      areas.push((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      return areas;
    }, []);
    expect(triangleAreas.every((area) => Number.isFinite(area) && Math.abs(area) > 1e-6)).toBe(true);
    expect(new Set(triangleAreas.map((area) => Math.sign(area))).size).toBe(1);
    for (let first = 0; first < plan.innerRing.length; first++) {
      const a = plan.innerRing[first];
      const b = plan.innerRing[(first + 1) % plan.innerRing.length];
      for (let second = first + 1; second < plan.innerRing.length; second++) {
        const next = (second + 1) % plan.innerRing.length;
        if ((first + 1) % plan.innerRing.length === second || next === first) continue;
        const c = plan.innerRing[second];
        const d = plan.innerRing[next];
        const cross = (p: typeof a, q: typeof a, r: typeof a) => (
          (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
        );
        const abC = cross(a, b, c);
        const abD = cross(a, b, d);
        const cdA = cross(c, d, a);
        const cdB = cross(c, d, b);
        expect((abC > 1e-6) !== (abD > 1e-6) && (cdA > 1e-6) !== (cdB > 1e-6)).toBe(false);
      }
    }
  });

  it("keeps the same joined world-space plan through each camera rotation", () => {
    const ring = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }];
    const signature = JSON.stringify(buildHazardBankFacePlan("water", 8, ring));
    for (const _rotation of [0, 90, 180, 270]) {
      expect(JSON.stringify(buildHazardBankFacePlan("water", 8, ring))).toBe(signature);
    }
  });

  it("accepts every dense M19 hazard ring as one joined strip", () => {
    const course = createParklandVisualReferenceCourse();
    const hazardComponents = buildLandscapeComponents(course.tiles, course.width, course.height, {
      cornerRadius: 0.36,
      cornerSegments: 3,
    }).filter((component) => (
      component.terrain === "sand" || component.terrain === "water" || component.terrain === "wetland"
    ));
    expect(hazardComponents.length).toBeGreaterThan(0);
    for (const component of hazardComponents) for (const ring of component.rings) {
      const plan = buildHazardBankFacePlan(component.terrain, component.cells.length, ring);
      expect(plan, `${component.topologyKey} should have one valid joined bank`).not.toBeNull();
      expect(plan!.outerRing).toHaveLength(plan!.innerRing.length);
      expect(plan!.stripIndices).toHaveLength(plan!.outerRing.length * 6);
      expect(new Set(plan!.innerRing.map((point) => `${point.x},${point.y}`)).size).toBe(plan!.innerRing.length);
    }
  });
});
