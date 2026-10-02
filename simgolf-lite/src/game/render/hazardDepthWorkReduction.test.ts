import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BIOME_KEYS } from "../models/biomes";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { buildHazardVisualRings, classifyBunkerVisualType } from "./bunkerShapes";
import { buildHazardBankFacePlan } from "./hazardDepth";

// Number encoding preserves IEEE-754 bits, including signed zero; the digest
// covers the complete original plan, coordinate/order/null fallback included.
function planDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, entry) => {
    if (typeof entry !== "number") return entry;
    const bytes = Buffer.allocUnsafe(8); bytes.writeDoubleBE(entry);
    return { ieee754: bytes.toString("hex") };
  })).digest("hex");
}
// Captured from unmodified d608498 before predicate changes. The dyadic
// pathological corpus was also verified against that original implementation
// on Node22 Linux/x64 and Node26 Darwin/arm64 before updating its golden.
const ORIGINAL: Record<string, string> = {
  "m27-parkland-medium-low": "0490d705f2625166cff56079ac160653691a5c4694c7994a1228cc1fff84db20",
  "m27-parkland-high": "468e61be5d2b6a6c6387e432b3a0b76d1d24e42adfb6d3417d87bb7fc3a7273d",
  "m27-links-medium-low": "1ade2dd7979f947a055d41c66ffb4d09bc3143e77540da5ecef61f038967fc62",
  "m27-links-high": "479ae87c9da8f9d60451c11578f31820d5f00e6743feccbca44c014b5b437eb4",
  "m27-desert-medium-low": "c177253f3522ffaacdc571147782e35cd5e02a78489c44813596fb3ae6480fa9",
  "m27-desert-high": "fbd68228d9dab54034bf75667bda52a635d2ecff1ab30eb0c1437f8d71631e60",
  "m19": "a3de83e65055dbef5f0f80d466d66967bd3853521ec97f9122f91f06b7a9479e",
  "pathological": "5ddb548e5ea201ed64aa9ea52a190dadac8b6054f9676b85e6e19db1276f9e49"
};
function originalParity(name: string, value: unknown): void {
  const digest = planDigest(value);
  expect(digest, name).toBe(ORIGINAL[name]);
}

describe("original hazard plan parity", () => {
  for (const theme of BIOME_KEYS) it(`preserves all M27 ${theme} hazard plans at each adapter`, () => {
    const course = createM27ReleaseReferenceCourse(theme);
    for (const high of [false, true]) {
      const plans: unknown[] = [];
      const components = buildLandscapeComponents(course.tiles, course.width, course.height,
        { cornerRadius: high ? .4 : .32, cornerSegments: high ? 4 : 2 });
      for (const component of components) {
        if (!["sand", "water", "wetland"].includes(component.terrain)) continue;
        const rings = buildHazardVisualRings(component.terrain, component.rings, component.topologyKey,
          component.cells.length, component.terrain === "sand"
            ? classifyBunkerVisualType(component.cells, course.tiles, course.width, course.height) : undefined);
        for (const legacy of [false, true]) for (const ring of rings) {
          plans.push(buildHazardBankFacePlan(component.terrain, component.cells.length, ring, legacy));
        }
      }
      expect(plans.length).toBeGreaterThan(0);
      originalParity(`m27-${theme}-${high ? "high" : "medium-low"}`, plans);
    }
  });

  it("preserves M19 raw and organic plans including reverse winding", () => {
    const course = createParklandVisualReferenceCourse(); const plans: unknown[] = [];
    for (const high of [false, true]) for (const component of buildLandscapeComponents(course.tiles, course.width, course.height,
      { cornerRadius: high ? .4 : .32, cornerSegments: high ? 4 : 2 })) {
      if (!["sand", "water", "wetland"].includes(component.terrain)) continue;
      const visual = buildHazardVisualRings(component.terrain, component.rings, component.topologyKey, component.cells.length);
      for (const ring of [...component.rings, ...visual]) for (const legacy of [false, true]) {
        plans.push(buildHazardBankFacePlan(component.terrain, component.cells.length, ring, legacy));
        plans.push(buildHazardBankFacePlan(component.terrain, component.cells.length, [...ring].reverse(), legacy));
      }
    }
    originalParity("m19", plans);
  });

  it("preserves pathological rejection, touching, concavity and finite extremes", () => {
    const rings = [[], [{ x: 0, y: 0 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 2, y: 0 }],
      [{ x: Infinity, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }],
      [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }],
      [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 1, y: 1 }, { x: 0, y: 3 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 0 }],
      [{ x: -0, y: 0 }, { x: 1e-8, y: 0 }, { x: 1e-8, y: 1e-8 }, { x: 0, y: 1e-8 }],
      [{ x: -1e150, y: -1e150 }, { x: 1e150, y: -1e150 }, { x: 1e150, y: 1e150 }, { x: -1e150, y: 1e150 }],
      [{ x: -Number.MAX_VALUE, y: 0 }, { x: 0, y: Number.MAX_VALUE }, { x: Number.MAX_VALUE, y: 0 }, { x: 0, y: -Number.MAX_VALUE }],
    ];
    // Deterministic dense/concave/crossing variants exercise every scale and
    // the original decision ordering without relying on generated courses.
    // Dyadic square coordinates avoid platform-dependent sin/cos inputs.
    for (let seed = 1; seed <= 80; seed++) {
      const perSide = 2 ** (1 + seed % 3);
      const ring = Array.from({ length: perSide * 4 }, (_, i) => {
        const side = Math.floor(i / perSide);
        const along = (i % perSide) / perSide * 2 - 1;
        const square = side === 0 ? { x: 1, y: along }
          : side === 1 ? { x: -along, y: 1 }
            : side === 2 ? { x: -1, y: -along } : { x: along, y: -1 };
        const radius = (i % 2 ? 1 : (1 + seed % 9) / 16) * (seed % 7 + 1 / 8);
        return { x: square.x * radius, y: square.y * radius };
      });
      rings.push(ring);
    }
    const plans = rings.flatMap((ring) => (["sand", "water", "wetland", "rough"] as const).flatMap((terrain) =>
      [false, true].flatMap((legacy) => [ring, [...ring].reverse()].map((path) =>
        buildHazardBankFacePlan(terrain, 8, path, legacy)))));
    expect(plans.some((plan) => plan === null)).toBe(true);
    expect(plans.some((plan) => plan !== null)).toBe(true);
    originalParity("pathological", plans);
  });
});
