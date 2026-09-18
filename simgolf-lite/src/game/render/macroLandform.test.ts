import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { buildVisualHeightfield } from "./landscapeGeometry";
import { buildMacroLandformRaster } from "./macroLandform";

function fixture(width = 14, height = 10): Course {
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const elevations = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    elevations[y * width + x] = x < 4 ? 0 : x < 9 ? 1 : 2;
  }
  for (let y = 5; y <= 8; y++) for (let x = 2; x <= 5; x++) {
    tiles[y * width + x] = "water";
    elevations[y * width + x] = 0;
  }
  return {
    width,
    height,
    tiles,
    elevations,
    holes: [],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Macro landform fixture",
    baseGreenFee: 30,
    condition: 1,
    theme: "parkland",
  };
}

describe("continuous macro-landform shading", () => {
  it("emits slope variation without painting cell-edge bands", () => {
    const course = fixture();
    const field = buildVisualHeightfield(course);
    const raster = buildMacroLandformRaster(field, course.tiles, course.theme, 4);
    expect(raster.width).toBe(course.width * 4);
    expect(raster.height).toBe(course.height * 4);
    expect(raster.maximumGrade).toBeGreaterThan(0.2);
    const alphas = Array.from(raster.shadow).filter((_, index) => index % 4 === 3);
    expect(Math.max(...alphas)).toBeGreaterThan(20);
    // A flat high plateau is not outlined per cell; its interior remains clear.
    const density = 4;
    const plateauInterior = (5 * density * raster.width + 11 * density) * 4 + 3;
    expect(raster.shadow[plateauInterior]).toBeLessThan(8);
  });

  it("leaves a connected water plane completely unshaded", () => {
    const course = fixture();
    const density = 4;
    const raster = buildMacroLandformRaster(
      buildVisualHeightfield(course),
      course.tiles,
      course.theme,
      density,
    );
    for (let y = 5 * density; y < 9 * density; y++) for (let x = 2 * density; x < 6 * density; x++) {
      const alpha = (y * raster.width + x) * 4 + 3;
      expect(raster.shadow[alpha]).toBe(0);
      expect(raster.highlight[alpha]).toBe(0);
    }
  });

  it("is deterministic and theme-aware", () => {
    const course = fixture();
    const field = buildVisualHeightfield(course);
    const first = buildMacroLandformRaster(field, course.tiles, "parkland", 3);
    const second = buildMacroLandformRaster(field, course.tiles, "parkland", 3);
    const links = buildMacroLandformRaster(field, course.tiles, "links", 3);
    expect(Array.from(second.shadow)).toEqual(Array.from(first.shadow));
    expect(Array.from(links.shadow)).not.toEqual(Array.from(first.shadow));
  });
});
