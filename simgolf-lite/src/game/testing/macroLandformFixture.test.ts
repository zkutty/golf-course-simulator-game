import { describe, expect, it } from "vitest";
import { worldToIso, type IsoRotation } from "../render/iso";
import {
  buildLandscapeComponents,
  buildRecessedLandformRibbon,
  buildVisualHeightfield,
  sampleLandscapeSurfaceHeight,
  sampleVisualHeight,
} from "../render/landscapeGeometry";
import { buildMacroLandformRaster } from "../render/macroLandform";
import { hazardDepthProfile } from "../render/hazardDepth";
import { createM20TerrainReferenceCourse, createParklandVisualReferenceCourse } from "./referenceCourse";
import { createMacroLandformFixture } from "./macroLandformFixture";

const rotations: IsoRotation[] = [0, 90, 180, 270];

describe("M35 macro-landform fixture contract", () => {
  it("keeps authoritative state immutable and deterministic across M19, M20, and a radial fixture", () => {
    for (const course of [
      createParklandVisualReferenceCourse(),
      createM20TerrainReferenceCourse(),
      createMacroLandformFixture(),
    ]) {
      const before = JSON.stringify(course);
      const first = buildVisualHeightfield(course);
      const second = buildVisualHeightfield(course);
      expect(Array.from(second.vertices)).toEqual(Array.from(first.vertices));
      expect(JSON.stringify(course)).toBe(before);
      const raster = buildMacroLandformRaster(first, course.tiles, course.theme, 4);
      expect(raster.maximumGrade).toBeGreaterThan(0.18);
    }
  });

  it("keeps water perfectly level and bunker recession bounded", () => {
    for (const course of [createParklandVisualReferenceCourse(), createMacroLandformFixture()]) {
      const field = buildVisualHeightfield(course);
      const components = buildLandscapeComponents(course.tiles, course.width, course.height);
      const water = components.find((component) => component.terrain === "water")!;
      const waterHeights = water.cells.map((cell) => {
        const x = cell % course.width;
        const y = Math.floor(cell / course.width);
        return sampleLandscapeSurfaceHeight(field, water, x + 0.5, y + 0.5);
      });
      expect(Math.max(...waterHeights) - Math.min(...waterHeights)).toBeLessThan(1e-6);

      const bunker = components.find((component) => component.terrain === "sand")!;
      const centerCell = bunker.cells[Math.floor(bunker.cells.length / 2)];
      const x = centerCell % course.width + 0.5;
      const y = Math.floor(centerCell / course.width) + 0.5;
      const recession = sampleVisualHeight(field, x, y) - sampleLandscapeSurfaceHeight(field, bunker, x, y);
      expect(bunker.cells.length).toBeGreaterThan(4);
      const profile = hazardDepthProfile("sand", bunker.cells.length)!;
      expect(profile.floorDrop).toBe(0.55);
      expect(recession).toBeGreaterThan(0.08);
      expect(recession).toBeCloseTo(profile.floorDrop, 7);
      expect(recession).toBeLessThanOrEqual(profile.floorDrop + 1e-7);
      const ribbon = buildRecessedLandformRibbon(field, bunker, bunker.rings[0]);
      expect(Math.max(...ribbon.map((point) => point.topHeight - point.bottomHeight))).toBeLessThan(1.5);
    }
  });

  it("projects the three-level slope measurably in all four rotations", () => {
    const course = createMacroLandformFixture();
    const field = buildVisualHeightfield(course);
    const low = { x: 2.5, y: 10.5 };
    const high = { x: 13.5, y: 10.5 };
    const lowHeight = sampleVisualHeight(field, low.x, low.y);
    const highHeight = sampleVisualHeight(field, high.x, high.y);
    expect(highHeight - lowHeight).toBeGreaterThan(1.5);
    for (const rotation of rotations) {
      const projectedLow = worldToIso(low.x, low.y, lowHeight, rotation);
      const projectedHigh = worldToIso(high.x, high.y, highHeight, rotation);
      const flatLow = worldToIso(low.x, low.y, 0, rotation);
      const flatHigh = worldToIso(high.x, high.y, 0, rotation);
      const reliefDelta = Math.abs(
        (projectedHigh.y - flatHigh.y) - (projectedLow.y - flatLow.y),
      );
      expect(reliefDelta).toBeGreaterThan(12);
    }
  });
});
