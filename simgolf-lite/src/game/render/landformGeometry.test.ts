import { describe, expect, it } from "vitest";
import { worldToIso, type IsoRotation } from "./iso";
import { buildVisualHeightfield } from "./landscapeGeometry";
import { buildLandformPresentationPlan, buildLandformShoulders } from "./landformGeometry";
import { buildMacroLandformRaster } from "./macroLandform";
import { createMacroLandformFixture } from "../testing/macroLandformFixture";
import { createM20TerrainReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";

describe("tile-snapped landform transitions", () => {
  it("retains surface material relief when M19 r270 has no front-facing slopes", () => {
    const course = createParklandVisualReferenceCourse();
    const before = JSON.stringify(course);
    const field = buildVisualHeightfield(course);
    const shoulders = buildLandformShoulders(field, course.tiles, course.elevations);
    const front = shoulders.filter(({ points: [a, b] }) => (
      worldToIso(a.lower.x, a.lower.y, 0, 270).y + worldToIso(b.lower.x, b.lower.y, 0, 270).y >
      worldToIso(a.upper.x, a.upper.y, 0, 270).y + worldToIso(b.upper.x, b.upper.y, 0, 270).y
    ));
    expect(front).toHaveLength(0);
    const material = buildMacroLandformRaster(field, course.tiles, course.theme);
    expect(material.shadedSamples).toBeGreaterThan(100);
    expect([...new Set(shoulders.map((cue) => cue.level))].sort()).toEqual([.5, 1.5, 2.5]);
    expect(JSON.stringify(course)).toBe(before);
    expect(buildLandformShoulders(field, course.tiles, course.elevations.map(() => 0))).toEqual([]);
    expect(buildMacroLandformRaster(field, course.tiles.map(() => "path"), course.theme).shadedSamples).toBe(0);
  });
  it("merges actual M19 and M20 level edges without mutating course data", () => {
    for (const course of [createParklandVisualReferenceCourse(), createM20TerrainReferenceCourse()]) {
      const before = JSON.stringify(course);
      const shoulders = buildLandformShoulders(
        buildVisualHeightfield(course),
        course.tiles,
        course.elevations,
      );
      expect(shoulders.length).toBeGreaterThan(0);
      expect(shoulders.some((shoulder) => shoulder.worldLength > 10)).toBe(true);
      expect(shoulders.every((shoulder) => shoulder.minimumRise >= 0.45)).toBe(true);
      expect(shoulders.every((shoulder) => shoulder.maximumRise === shoulder.minimumRise)).toBe(true);
      expect(JSON.stringify(course)).toBe(before);
    }
  });

  it("produces deterministic open runs after a serialized reload", () => {
    const course = createMacroLandformFixture();
    const build = (input: typeof course) => buildLandformShoulders(
      buildVisualHeightfield(input),
      input.tiles,
      input.elevations,
    );
    const first = build(course);
    const second = build(JSON.parse(JSON.stringify(course)));
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(2);
    expect(first.every((shoulder) => !shoulder.closed && shoulder.points.length === 2)).toBe(true);
    expect([...new Set(first.map((shoulder) => shoulder.level))]).toEqual([0.5, 1.5]);
  });

  it("keeps the same measurable face rise through all camera rotations", () => {
    const course = createMacroLandformFixture();
    const shoulder = buildLandformShoulders(
      buildVisualHeightfield(course),
      course.tiles,
      course.elevations,
    ).find((candidate) => candidate.level === 1.5)!;
    const sample = shoulder.points[0];
    for (const rotation of [0, 90, 180, 270] as IsoRotation[]) {
      const upper = worldToIso(sample.upper.x, sample.upper.y, sample.upperHeight, rotation);
      const upperFlat = worldToIso(sample.upper.x, sample.upper.y, sample.lowerHeight, rotation);
      expect(Math.abs(upper.y - upperFlat.y)).toBeGreaterThan(4);
    }
  });

  it("keeps stitched Parkland shoulders in the renderer-facing plan", () => {
    const parkland = createParklandVisualReferenceCourse();
    const before = JSON.stringify(parkland);
    const plan = buildLandformPresentationPlan(
      buildVisualHeightfield(parkland),
      parkland.tiles,
      parkland.elevations,
      parkland.theme,
      3,
    );
    expect(plan.shoulders.length).toBeGreaterThan(0);
    expect(plan.shoulders.some((shoulder) => shoulder.worldLength > 10)).toBe(true);
    expect(plan.shoulders.every((shoulder) => shoulder.closed === false)).toBe(true);
    expect(JSON.stringify(parkland)).toBe(before);

    const links = { ...parkland, theme: "links" as const };
    expect(buildLandformPresentationPlan(
      buildVisualHeightfield(links), links.tiles, links.elevations, links.theme, 2,
    ).shoulders.length).toBeGreaterThan(0);
  });

  it("emits one unique owner for each sparse run and never a full ring", () => {
    const course = createMacroLandformFixture();
    const shoulders = buildLandformShoulders(
      buildVisualHeightfield(course),
      course.tiles,
      course.elevations,
    );
    const keys = shoulders.map((shoulder) => {
      const [a, b] = shoulder.points;
      return [shoulder.level, a.upper.x, a.upper.y, b.upper.x, b.upper.y].join(":");
    });
    expect(new Set(keys).size).toBe(keys.length);
    expect(shoulders.every((shoulder) => !shoulder.closed && shoulder.points.length === 2)).toBe(true);
  });
});
