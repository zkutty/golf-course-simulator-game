import { describe, expect, it } from "vitest";
import {
  hazardDepthOffsets,
  hazardDepthProfile,
  hazardInteriorDropAt,
  buildHazardBankFacePlan,
} from "./hazardDepth";

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

  it("plans exactly one bank face per canonical ring edge and no parallel fill strips", () => {
    const ring = [
      { x: 1.125, y: 2.25 },
      { x: 4.75, y: 2.25 },
      { x: 4.75, y: 5.625 },
      { x: 1.125, y: 5.625 },
    ];
    for (const terrain of ["sand", "water", "wetland"] as const) {
      const plan = buildHazardBankFacePlan(terrain, 6, ring)!;
      expect(plan.bankFaces).toHaveLength(ring.length);
      expect(plan.suppressedFillKinds).toEqual(["shelf", "contact", "shallow", "deep"]);
      expect(plan.bankFaces.map(({ boundaryA, boundaryB }) => [boundaryA, boundaryB])).toEqual([
        [ring[0], ring[1]], [ring[1], ring[2]], [ring[2], ring[3]], [ring[3], ring[0]],
      ]);
      expect(plan.bankFaces.every((face) => face.bankInnerOffset > 0)).toBe(true);
      expect(plan.lip.offset).toBe(0);
      expect(plan.lip.width).toBeGreaterThan(0);
    }
  });

  it("keeps the same one-face plan through each camera rotation", () => {
    const ring = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }];
    const signature = JSON.stringify(buildHazardBankFacePlan("water", 8, ring));
    for (const _rotation of [0, 90, 180, 270]) {
      expect(JSON.stringify(buildHazardBankFacePlan("water", 8, ring))).toBe(signature);
    }
  });
});
