import { describe, expect, it } from "vitest";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { deriveCourseSceneComposition } from "./courseSceneComposition";
import { deriveGrovePresentation } from "./grovePresentation";
import { NATURAL_PROP_FRAMES } from "./naturalProps";
import { m19SourceGeometrySignature } from "./m19AuthoredHabitatSource";

describe("source-preserving grove hierarchy", () => {
  it("retains exact authority and one presentation scale per real grove tree", () => {
    const course = createParklandVisualReferenceCourse();
    const before = JSON.stringify(course);
    const signature = m19SourceGeometrySignature(course);
    const plan = deriveCourseSceneComposition({ course, seed: 1202 });
    const result = deriveGrovePresentation(course, plan);
    const sources = new Set(plan.habitatZones.filter((zone) => zone.evidence.kind === "tree_grove")
      .flatMap((zone) => zone.evidence.sourcePoints.map((point) => `${point.x},${point.y}`)));
    expect(result.trees.size).toBeGreaterThan(0);
    expect(new Set(result.trees.keys())).toEqual(sources);
    for (const [id, scale] of result.trees) {
      expect(course.obstacles.filter((item) => item.type === "tree" && `${item.x},${item.y}` === id)).toHaveLength(1);
      expect(scale).toBeGreaterThanOrEqual(1.75);
      expect(scale).toBeLessThanOrEqual(2.05);
    }
    expect(JSON.stringify(course)).toBe(before);
    expect(m19SourceGeometrySignature(course)).toBe(signature);
  });

  it("uses only resident shrubs in source-supported occupied ground, without repeated cells", () => {
    const course = createParklandVisualReferenceCourse();
    const plan = deriveCourseSceneComposition({ course, seed: 1202 });
    const result = deriveGrovePresentation(course, plan);
    expect(result.accents.length).toBeGreaterThan(0);
    expect(result.accents.length).toBeLessThanOrEqual(result.trees.size * 2);
    expect(new Set(result.accents.map(({ tile }) => `${tile.x},${tile.y}`)).size).toBe(result.accents.length);
    for (const accent of result.accents) {
      expect(NATURAL_PROP_FRAMES).toContain(accent.frame);
      expect(accent.frame).toContain("_bush_");
      expect(result.trees.has(`${accent.source.x},${accent.source.y}`)).toBe(true);
      expect(Math.max(Math.abs(accent.tile.x - accent.source.x), Math.abs(accent.tile.y - accent.source.y))).toBeLessThanOrEqual(1);
      expect(course.obstacles.some((item) => item.x === accent.tile.x && item.y === accent.tile.y)).toBe(false);
      expect(plan.habitatZones.some((zone) => zone.evidence.kind === "tree_grove"
        && zone.occupancy.some((tile) => tile.x === accent.tile.x && tile.y === accent.tile.y))).toBe(true);
      const cell = accent.tile.y * course.width + accent.tile.x;
      expect(plan.exclusions.routedCorridor.cells).not.toContain(cell);
      expect(plan.exclusions.authoredMarkers.cells).not.toContain(cell);
    }
    expect(deriveGrovePresentation(structuredClone(course), structuredClone(plan))).toEqual(result);
    expect(deriveGrovePresentation(course, { ...plan, habitatZones: [] })).toEqual({ trees: new Map(), accents: [] });
  });
});
