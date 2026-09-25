import { describe, expect, it } from "vitest";
import { courseForCourseSetup } from "../models/courseSetup";
import { createM23CourseSetupReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { m19AuthoredHabitatSource, m19SourceGeometrySignature } from "./m19AuthoredHabitatSource";

describe("m19 authored habitat source", () => {
  it("reports the canonical M19/M23 source signature", () => {
    expect(m19SourceGeometrySignature(createParklandVisualReferenceCourse())).toBe("1501df6a");
    expect(m19SourceGeometrySignature(createM23CourseSetupReferenceCourse())).toBe("d7d7f508");
  });

  it("exposes one frozen, tile-snapped source only for the exact M19/M23 authority", () => {
    const m19 = createParklandVisualReferenceCourse();
    const m23 = createM23CourseSetupReferenceCourse();
    const patches = m19AuthoredHabitatSource(m19);
    expect(patches).toEqual(m19AuthoredHabitatSource(m23));
    expect(patches).toEqual([{
      schema: "m19-m23-authored-habitat-patch-v1",
      id: "east-deep-rough-margin",
      family: "meadow_deep_rough_margin",
      bounds: { x: 31, y: 23, width: 2, height: 2 },
      rowRuns: [[31, 32], [31, 32]],
    }]);
    expect(Object.isFrozen(patches)).toBe(true);
    expect(Object.isFrozen(patches[0])).toBe(true);
    expect(Object.isFrozen(patches[0].bounds)).toBe(true);
    expect(Object.isFrozen(patches[0].rowRuns)).toBe(true);
    for (let y = 23; y <= 24; y += 1) for (let x = 31; x <= 32; x += 1) {
      expect(["rough", "deep_rough"]).toContain(m19.tiles[y * m19.width + x]);
    }
  });

  it("rejects secondary, renamed, and semantically mutated fixtures", () => {
    const m19 = createParklandVisualReferenceCourse();
    expect(m19AuthoredHabitatSource({ ...m19, name: "another club" })).toEqual([]);
    const mutatedTile = structuredClone(m19);
    mutatedTile.tiles[0] = "deep_rough";
    expect(m19AuthoredHabitatSource(mutatedTile)).toEqual([]);
    const mutatedObstacle = structuredClone(m19);
    mutatedObstacle.obstacles[0] = { ...mutatedObstacle.obstacles[0], x: mutatedObstacle.obstacles[0].x + 1 };
    expect(m19AuthoredHabitatSource(mutatedObstacle)).toEqual([]);
    const m23 = createM23CourseSetupReferenceCourse();
    expect(m19AuthoredHabitatSource({ ...m23, name: "M19 Parkland Reference Club" })).toEqual([]);
    expect(m19AuthoredHabitatSource({ ...m19, name: "M23 Course Standards Club" })).toEqual([]);
    const swappedPins = structuredClone(m23);
    swappedPins.holes[0].pinPositions = {
      ...swappedPins.holes[0].pinPositions!,
      A: swappedPins.holes[0].pinPositions!.B,
      B: swappedPins.holes[0].pinPositions!.A,
    };
    expect(m19AuthoredHabitatSource(swappedPins)).toEqual([]);
  });

  it("is independent of active setup, rotation selector, condition, and obstacle order", () => {
    const source = createM23CourseSetupReferenceCourse();
    for (const pinRotation of ["A", "B", "C"] as const) {
      const selected = courseForCourseSetup(source, "member", pinRotation);
      const normalized = {
        ...selected,
        activePinRotation: pinRotation,
        condition: 0.5,
        obstacles: selected.obstacles.slice().reverse(),
      };
      expect(m19SourceGeometrySignature(normalized)).toBe("d7d7f508");
      expect(m19AuthoredHabitatSource(normalized)).toHaveLength(1);
    }
  });
});
