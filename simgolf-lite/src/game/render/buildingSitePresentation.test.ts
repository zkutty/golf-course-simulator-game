import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Building, Course, LandTheme, Terrain } from "../models/types";
import { ISO_ROTATIONS } from "./iso";
import { buildingSitePresentation } from "./buildingSitePresentation";

function fixture(theme: LandTheme = "parkland"): { course: Course; building: Building } {
  const width = 10;
  const height = 10;
  const building: Building = {
    id: "graded-shop",
    type: "pro_shop",
    x: 4,
    y: 4,
    tier: 3,
    price: 40,
    siteGrade: {
      version: 1,
      supportElevation: 3,
      cutSteps: 2,
      fillSteps: 4,
      earthworkCost: 600,
      foundationCost: 360,
      totalSiteCost: 960,
    },
  };
  const course: Course = {
    ...DEFAULT_COURSE,
    width,
    height,
    theme,
    tiles: new Array<Terrain>(width * height).fill("fairway"),
    elevations: new Array(width * height).fill(2),
    holes: [],
    obstacles: [],
    buildings: [building],
    decorations: [],
    estate: undefined,
  };
  for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) course.elevations[y * width + x] = 3;
  return { course, building };
}

describe("building site presentation", () => {
  it("keeps one level support plane, fixed footprint, depth, entrance, and treatment across camera rotations", () => {
    const { course, building } = fixture();
    const before = structuredClone(course);
    const views = ISO_ROTATIONS.map((rotation) => buildingSitePresentation(course, building, rotation, "high"));
    expect(views.map((view) => view.supportElevation)).toEqual([3, 3, 3, 3]);
    expect(views.map((view) => view.treatment)).toEqual(["cut-fill", "cut-fill", "cut-fill", "cut-fill"]);
    expect(views.every((view) => view.top.length === 4 && view.lower.length === 4)).toBe(true);
    expect(new Set(views.map((view) => `${view.anchor.x},${view.anchor.y}`)).size).toBe(4);
    expect(views.every((view) => Number.isFinite(view.entrance.x) && Number.isFinite(view.entrance.y))).toBe(true);
    expect(course).toEqual(before);
  });

  it("uses biome-grounded materials and bounded LOD while retaining the same support", () => {
    const parkland = fixture("parkland");
    const links = fixture("links");
    const desert = fixture("desert");
    const high = buildingSitePresentation(parkland.course, parkland.building, 0, "high");
    const low = buildingSitePresentation(parkland.course, parkland.building, 0, "low");
    expect(low.supportElevation).toBe(high.supportElevation);
    expect(low.retaining).toEqual([]);
    expect(buildingSitePresentation(links.course, links.building, 0, "medium").palette.plinth).not.toBe(high.palette.plinth);
    expect(buildingSitePresentation(desert.course, desert.building, 0, "high").palette.plinth).not.toBe(high.palette.plinth);
  });

  it("presents a non-level legacy footprint as repair-needed without mutating it", () => {
    const { course, building } = fixture();
    delete building.siteGrade;
    course.elevations[4 * course.width + 4] = 0;
    const before = [...course.elevations];
    const presentation = buildingSitePresentation(course, building, 270, "high");
    expect(presentation.treatment).toBe("legacy-repair");
    expect(course.elevations).toEqual(before);
  });
});
