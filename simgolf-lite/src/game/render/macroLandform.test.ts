import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { buildVisualHeightfield } from "./landscapeGeometry";
import { buildMacroLandformRaster } from "./macroLandform";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";

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

  it("leaves purpose-built hazards completely unshaded", () => {
    const course = fixture();
    course.tiles[4 * course.width + 10] = "sand";
    course.tiles[4 * course.width + 11] = "waste_area";
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
    for (const x of [10, 11]) for (let py = 4 * density; py < 5 * density; py++) {
      for (let px = x * density; px < (x + 1) * density; px++) {
        const alpha = (py * raster.width + px) * 4 + 3;
        expect(raster.shadow[alpha]).toBe(0);
        expect(raster.highlight[alpha]).toBe(0);
      }
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

  it("filters M19 ridge light into bounded, multi-tile gradients", () => {
    const course = createParklandVisualReferenceCourse();
    const density = 4;
    const raster = buildMacroLandformRaster(
      buildVisualHeightfield(course), course.tiles, course.theme, density,
    );
    const alphaAt = (x: number, y: number) => raster.shadow[(y * raster.width + x) * 4 + 3] +
      raster.highlight[(y * raster.width + x) * 4 + 3];
    const isShadedAt = (x: number, y: number) => {
      const terrain = course.tiles[Math.floor(y / density) * course.width + Math.floor(x / density)];
      return terrain !== "sand" && terrain !== "waste_area" &&
        terrain !== "water" && terrain !== "wetland" && terrain !== "path";
    };
    let maximumAdjacentDelta = 0;
    let gradedTransitions = 0;
    const ridgeLevels = new Set<string>();
    for (let y = 1; y < raster.height - 1; y++) for (let x = 1; x < raster.width - 1; x++) {
      const center = alphaAt(x, y);
      if (isShadedAt(x, y) && isShadedAt(x + 1, y)) {
        maximumAdjacentDelta = Math.max(maximumAdjacentDelta, Math.abs(center - alphaAt(x + 1, y)));
      }
      if (isShadedAt(x, y) && isShadedAt(x, y + 1)) {
        maximumAdjacentDelta = Math.max(maximumAdjacentDelta, Math.abs(center - alphaAt(x, y + 1)));
      }
      // A transition is only counted when its slope light persists through at
      // least three samples, which rules out one-pixel contour bands.
      if (center > 4 && alphaAt(x - 1, y) > 2 && alphaAt(x + 1, y) > 2) gradedTransitions++;
    }
    for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
      const index = y * course.width + x;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (x + dx >= course.width || y + dy >= course.height) continue;
        const adjacent = (y + dy) * course.width + x + dx;
        const low = Math.min(course.elevations[index], course.elevations[adjacent]);
        const high = Math.max(course.elevations[index], course.elevations[adjacent]);
        if (high - low !== 1) continue;
        const samples = dx
          ? [alphaAt((x + 1) * density - 1, (y + 0.5) * density), alphaAt((x + 1) * density, (y + 0.5) * density), alphaAt((x + 1) * density + 1, (y + 0.5) * density)]
          : [alphaAt((x + 0.5) * density, (y + 1) * density - 1), alphaAt((x + 0.5) * density, (y + 1) * density), alphaAt((x + 0.5) * density, (y + 1) * density + 1)];
        if (samples.every((alpha) => alpha > 2)) ridgeLevels.add(`${low}-${high}`);
      }
    }
    // Water remains intentionally transparent, so its hard material edge is
    // outside the grade field. On contiguous land the filtered field has no
    // one-sample contour jump.
    expect(maximumAdjacentDelta).toBeLessThanOrEqual(48);
    expect(gradedTransitions).toBeGreaterThan(3 * density);
    expect(ridgeLevels).toEqual(new Set(["0-1", "1-2", "2-3"]));
  });
});
