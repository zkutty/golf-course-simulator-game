import { describe, expect, it } from "vitest";
import {
  hazardDepthOffsets,
  hazardDepthProfile,
  hazardInteriorDropAt,
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
});
