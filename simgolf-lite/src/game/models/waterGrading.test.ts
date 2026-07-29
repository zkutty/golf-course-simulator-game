import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "./defaults";
import type { Course, Terrain } from "./types";
import { applyWaterGrading, computeWaterGrading } from "./waterGrading";

function courseWith(
  tiles: Terrain[],
  elevations: number[],
  width = 7,
  height = 5,
): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles,
    elevations,
    holes: [],
    layouts: [],
    obstacles: [],
    buildings: [],
    decorations: [],
    estate: undefined,
  };
}

describe("automatic water grading", () => {
  it("levels the complete touched lake below its lowest land edge", () => {
    const width = 7;
    const height = 5;
    const tiles = new Array<Terrain>(width * height).fill("rough");
    const elevations = new Array<number>(width * height).fill(6);
    const lake = [
      2 * width + 2,
      2 * width + 3,
      2 * width + 4,
    ];
    for (const index of lake) tiles[index] = "water";
    elevations[lake[0]] = 8;
    elevations[lake[1]] = 7;
    elevations[lake[2]] = 9;
    const course = courseWith(tiles, elevations, width, height);

    const grading = computeWaterGrading(course, tiles, [lake[1]]);
    expect(grading.deltas).toEqual([
      { x: 2, y: 2, delta: -3 },
      { x: 3, y: 2, delta: -2 },
      { x: 4, y: 2, delta: -4 },
    ]);
    expect(grading.earthworkSteps).toBe(9);

    const graded = applyWaterGrading(course, grading);
    expect(lake.map((index) => graded[index])).toEqual([5, 5, 5]);
  });

  it("uses a shallower edge-level grade for wetland", () => {
    const width = 7;
    const height = 5;
    const tiles = new Array<Terrain>(width * height).fill("rough");
    const elevations = new Array<number>(width * height).fill(6);
    const wetland = [2 * width + 2, 2 * width + 3];
    for (const index of wetland) tiles[index] = "wetland";
    elevations[wetland[0]] = 8;
    elevations[wetland[1]] = 7;
    const course = courseWith(tiles, elevations, width, height);

    const grading = computeWaterGrading(course, tiles, [wetland[0]]);
    const graded = applyWaterGrading(course, grading);
    expect(wetland.map((index) => graded[index])).toEqual([6, 6]);
    expect(grading.earthworkSteps).toBe(3);
  });

  it("never raises a deliberately deeper basin", () => {
    const width = 7;
    const height = 5;
    const tiles = new Array<Terrain>(width * height).fill("rough");
    const elevations = new Array<number>(width * height).fill(6);
    const lake = [2 * width + 2, 2 * width + 3];
    for (const index of lake) tiles[index] = "water";
    elevations[lake[0]] = 2;
    elevations[lake[1]] = 8;
    const course = courseWith(tiles, elevations, width, height);

    const grading = computeWaterGrading(course, tiles, [lake[1]]);
    expect(grading.deltas).toEqual([{ x: 3, y: 2, delta: -6 }]);
    const graded = applyWaterGrading(course, grading);
    expect(lake.map((index) => graded[index])).toEqual([2, 2]);
  });

  it("respects the base elevation floor and ignores untouched water", () => {
    const width = 7;
    const height = 5;
    const tiles = new Array<Terrain>(width * height).fill("rough");
    const elevations = new Array<number>(width * height).fill(0);
    const touchedLake = 2 * width + 2;
    const untouchedLake = 2 * width + 5;
    tiles[touchedLake] = "water";
    tiles[untouchedLake] = "water";
    elevations[untouchedLake] = 4;
    const course = courseWith(tiles, elevations, width, height);

    const grading = computeWaterGrading(course, tiles, [touchedLake]);
    expect(grading).toEqual({ deltas: [], earthworkSteps: 0 });
    expect(applyWaterGrading(course, grading)[untouchedLake]).toBe(4);
  });
});
