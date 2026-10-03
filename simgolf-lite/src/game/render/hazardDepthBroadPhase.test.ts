import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { HazardBankPoint } from "./hazardDepth";
import { buildHazardBankFacePlan } from "./hazardDepth";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { buildTerrainPresentationMap } from "./terrainPresentationPolicy";
import { authoredBunkerRings } from "./bunkerPresentation";
import { buildHazardVisualRings, classifyBunkerVisualType } from "./bunkerShapes";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, v) => {
    if (typeof v !== "number") return v;
    const b = Buffer.alloc(8); b.writeDoubleBE(v); return { ieee754: b.toString("hex") };
  })).digest("hex");
}
function smooth(ring: readonly HazardBankPoint[]): HazardBankPoint[] {
  let smoothed = ring.map(point => ({ ...point }));
  for (let pass = 0; pass < 3 && smoothed.length >= 9; pass++) {
    const source = smoothed;
    smoothed = source.map((_point, index) => {
      let x = 0, y = 0;
      for (let offset = -4; offset <= 4; offset++) {
        const p = source[(index + offset + source.length) % source.length]; x += p.x; y += p.y;
      }
      return { x: x / 9, y: y / 9 };
    });
  }
  for (let pass = 0; pass < 2 && smoothed.length >= 3; pass++) {
    smoothed = smoothed.flatMap((point, index) => {
      const next = smoothed[(index + 1) % smoothed.length];
      return [{ x: point.x * .75 + next.x * .25, y: point.y * .75 + next.y * .25 },
        { x: point.x * .25 + next.x * .75, y: point.y * .25 + next.y * .75 }];
    });
  }
  return smoothed;
}
// Original7f complete IEEE arrays captured BEFORE implementation, all18cases.
const ORIGINAL = {
  "m19-parkland-low": "46e0926497078f548761590e55d3f9374f9d799ea53bc70d980b5473a33333b4",
  "m19-parkland-medium": "1ba1443493980a74fa1a1312a4e4476f213b20ca59a964f196d88f2281e0f075",
  "m19-parkland-high": "acb6db1f7fc124ef2fe8259866f495a86d5f67a0289e1b51a22ad7a14a03e91a",
  "m19-links-low": "13b3c6a84a2ca1bde19a2adb63dfe69ba82a71e7dbd7b80d8a56e627db3a4950",
  "m19-links-medium": "1ba1443493980a74fa1a1312a4e4476f213b20ca59a964f196d88f2281e0f075",
  "m19-links-high": "acb6db1f7fc124ef2fe8259866f495a86d5f67a0289e1b51a22ad7a14a03e91a",
  "m19-desert-low": "13b3c6a84a2ca1bde19a2adb63dfe69ba82a71e7dbd7b80d8a56e627db3a4950",
  "m19-desert-medium": "1ba1443493980a74fa1a1312a4e4476f213b20ca59a964f196d88f2281e0f075",
  "m19-desert-high": "acb6db1f7fc124ef2fe8259866f495a86d5f67a0289e1b51a22ad7a14a03e91a",
  "m27-parkland-low": "75206eb9a025b4db007e7e5dbc5e74c8a843dc03217d87182d2dc2d564d2ce11",
  "m27-parkland-medium": "451adc781773ce88a755ba8ed4c473dd6e3307b40d8f313f7354eed77f31c718",
  "m27-parkland-high": "021be66a5bf75ccdbf0020c8ddbc475996c2d5bde0a98a766bde9aa9312665bc",
  "m27-links-low": "fd63f1f71a5686e336945683464d78e0d8e5bef6a7dcdd4b72b2450ed8fdd381",
  "m27-links-medium": "301e1dda35d7b3cb0aec8717e0410684aa47cbc13018905d6a407e8afc781fb2",
  "m27-links-high": "b940252105d69126c615d48d4f6e3a13ecb6d08a0ef1ce7948f5e43405ecbb84",
  "m27-desert-low": "3cde743676ab4ddde43fdfef1573d2d33ec192e03d199a08d484e7cb46481677",
  "m27-desert-medium": "f8ef7c0f58878829cc23ca9404600f4efe512424e4af1945dee641be2cbd47ea",
  "m27-desert-high": "f3532361d0c4bde473e789523103f82953f303fbeefa5fe198c4d8c4c70b4ad0"
};
function square(): HazardBankPoint[] {
  return Array.from({ length: 32 }, (_, i) => {
    const side = Math.floor(i / 8), along = i % 8;
    return side === 0 ? { x: along, y: 0 } : side === 1 ? { x: 8, y: along }
      : side === 2 ? { x: 8 - along, y: 8 } : { x: 0, y: 8 - along };
  });
}
describe("bounded hazard broad phase", () => {
  for (const fixture of ["m19", "m27"] as const) for (const theme of ["parkland", "links", "desert"] as const) {
    for (const quality of ["low", "medium", "high"] as const) it(`${fixture}/${theme}/${quality} keeps the original full adapter plans`, () => {
      const course = fixture === "m27" ? createM27ReleaseReferenceCourse(theme) : { ...createParklandVisualReferenceCourse(), theme };
      const effective = courseWithEffectiveSurfaces(course);
      const tiles = buildTerrainPresentationMap(effective.tiles, course.width, course.height, theme).presentationTiles;
      const components = buildLandscapeComponents(tiles, course.width, course.height,
        { cornerRadius: quality === "high" ? .4 : .32, cornerSegments: quality === "high" ? 4 : 2 });
      const plans = [];
      for (const component of components) {
        if (!["sand", "water", "wetland"].includes(component.terrain)) continue;
        if (quality === "low" && (component.terrain === "sand" || theme !== "parkland")) continue;
        let rings = (component.terrain === "sand" ? authoredBunkerRings(component.cells, course.surfaceIntent?.features, course.width, course.height) : null)
          ?? buildHazardVisualRings(component.terrain, component.rings, component.topologyKey, component.cells.length,
            component.terrain === "sand" ? classifyBunkerVisualType(component.cells, tiles, course.width, course.height) : undefined);
        if (quality === "low") rings = rings.map(smooth);
        for (const ring of rings) plans.push(buildHazardBankFacePlan(component.terrain, component.cells.length, ring, quality === "low"));
      }
      if (quality === "low") for (const component of buildLandscapeComponents(tiles, course.width, course.height,
        { cornerRadius: .4, cornerSegments: 4 }).filter(c => c.terrain === "sand")) {
        const rings = authoredBunkerRings(component.cells, course.surfaceIntent?.features, course.width, course.height)
          ?? buildHazardVisualRings("sand", component.rings, component.topologyKey, component.cells.length,
            classifyBunkerVisualType(component.cells, tiles, course.width, course.height));
        for (const ring of rings) plans.push(buildHazardBankFacePlan("sand", component.cells.length, ring));
      }
      expect(digest(plans)).toBe(ORIGINAL[`${fixture}-${theme}-${quality}`]);
    });
  }
  it("skips actual determinant work rather than computing and discarding", () => {
    const abs = vi.spyOn(Math, "abs");
    try {
      const plan = buildHazardBankFacePlan("water", 64, square());
      // Untouched7f made3017abs calls; less than one quarter is an
      // original-derived work bound, not a candidate-seeded exact count.
      expect(abs.mock.calls.length).toBeLessThan(3017 / 4);
      expect(digest(plan)).toBe("00ed83a33ccdc072bad3a7f383bd121e93e881e2740c60eb4fbd0fdf7e457079");
    } finally { abs.mockRestore(); }
  });
  it("preserves the raw public getter footprint", () => {
    const reads: string[] = [];
    const ring = square().map((p, index) => ({ get x() { reads.push(`${index}:x`); return p.x; }, get y() { reads.push(`${index}:y`); return p.y; } }));
    expect(digest(buildHazardBankFacePlan("water", 64, ring))).toBe("00ed83a33ccdc072bad3a7f383bd121e93e881e2740c60eb4fbd0fdf7e457079");
    expect(reads).toEqual(square().flatMap((_p, i) => [`${i}:x`, `${i}:y`, `${i}:x`, `${i}:y`]));
  });
});
