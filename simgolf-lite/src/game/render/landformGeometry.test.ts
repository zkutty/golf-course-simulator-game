import { describe, expect, it } from "vitest";
import { worldToIso, type IsoRotation } from "./iso";
import { buildVisualHeightfield } from "./landscapeGeometry";
import { buildLandformShoulders } from "./landformGeometry";
import { createMacroLandformFixture } from "../testing/macroLandformFixture";
import { createM20TerrainReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";

describe("continuous landform geometry", () => {
  it("stitches broad M19 and M20 shoulders without mutating course data", () => {
    for (const course of [createParklandVisualReferenceCourse(), createM20TerrainReferenceCourse()]) {
      const before = JSON.stringify(course);
      const shoulders = buildLandformShoulders(
        buildVisualHeightfield(course),
        course.tiles,
        course.elevations,
      );
      expect(shoulders.length).toBeGreaterThan(0);
      expect(shoulders.some((shoulder) => shoulder.worldLength > 10)).toBe(true);
      expect(shoulders.every((shoulder) => shoulder.minimumRise >= 0.519)).toBe(true);
      expect(shoulders.every((shoulder) => shoulder.maximumRise < 1.5)).toBe(true);
      expect(JSON.stringify(course)).toBe(before);
    }
  });

  it("produces deterministic radial shoulders after a serialized reload", () => {
    const course = createMacroLandformFixture();
    const build = (input: typeof course) => buildLandformShoulders(
      buildVisualHeightfield(input),
      input.tiles,
      input.elevations,
    );
    const first = build(course);
    const second = build(JSON.parse(JSON.stringify(course)));
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first.every((shoulder) => shoulder.points.length > 12)).toBe(true);
    expect(first.map((shoulder) => shoulder.level)).toEqual([0.5, 1.5]);
  });

  it("keeps the same measurable face rise through all camera rotations", () => {
    const course = createMacroLandformFixture();
    const shoulder = buildLandformShoulders(
      buildVisualHeightfield(course),
      course.tiles,
      course.elevations,
    ).find((candidate) => candidate.level === 1.5)!;
    const sample = shoulder.points[Math.floor(shoulder.points.length / 3)];
    for (const rotation of [0, 90, 180, 270] as IsoRotation[]) {
      const upper = worldToIso(sample.upper.x, sample.upper.y, sample.upperHeight, rotation);
      const upperFlat = worldToIso(sample.upper.x, sample.upper.y, sample.lowerHeight, rotation);
      expect(Math.abs(upper.y - upperFlat.y)).toBeGreaterThan(4);
    }
  });
});
