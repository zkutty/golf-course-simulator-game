import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { scoreCourseHoles } from "../sim/holes";
import { presentCompleteShotRoute, presentShotRoute } from "./shotRoutePresentation";

const point = (x: number, y: number) => ({ x, y });

function scoringFixture(kind: "Par 3" | "Par 4" | "Par 5"): Course {
  const width = kind === "Par 5" ? 120 : 100;
  const height = kind === "Par 5" ? 80 : 70;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  const tee = kind === "Par 3" ? point(5, 15) : kind === "Par 4" ? point(5, 50) : point(5, 55);
  const green = kind === "Par 3" ? point(25, 15) : kind === "Par 4" ? point(70, 25) : point(105, 40);
  const water = (fromX: number, toX: number, fromY: number, toY: number) => {
    for (let y = fromY; y <= toY; y++) for (let x = fromX; x <= toX; x++) tiles[y * width + x] = "water";
  };
  if (kind === "Par 4") water(31, 60, 26, height - 1);
  if (kind === "Par 5") {
    water(31, 60, 26, height - 1);
    water(75, 92, 0, 35);
  }
  tiles[tee.y * width + tee.x] = "tee";
  tiles[green.y * width + green.x] = "green";
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{ id: `route-${kind}`, tee, green, parMode: "AUTO" }],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: `Semantic route ${kind}`,
    baseGreenFee: 50,
    condition: 1,
    theme: "parkland",
  };
}

describe("presentShotRoute", () => {
  it.each([
    ["Par 3", [point(9, 2)]],
    ["Par 4", [point(6, 3), point(12, 2)]],
    ["Par 5", [point(4, 4), point(9, 3), point(15, 2)]],
  ])("keeps %s destinations to full shots and reserves two putts for par", (_name, destinations) => {
    const route = presentShotRoute(destinations.map((to) => ({ to })), [point(0, 5), ...destinations]);

    expect(route.destinations).toEqual(destinations);
    expect(route.fullShots).toBe(destinations.length);
    expect(route.expectedPutts).toBe(2);
    expect(route.plannedStrokes).toBe(destinations.length + 2);
  });

  it("does not create destinations or strokes when draw sampling changes", () => {
    const plan = [{ to: point(6, 3) }, { to: point(12, 2) }];
    const sparse = presentShotRoute(plan, [point(0, 5), point(6, 3), point(12, 2)]);
    const dense = presentShotRoute(plan, [
      point(0, 5), point(1, 5), point(2, 4), point(3, 4), point(4, 4), point(5, 3), point(6, 3),
      point(7, 3), point(8, 3), point(9, 3), point(10, 2), point(11, 2), point(12, 2),
    ]);

    expect(dense.geometry).toHaveLength(13);
    expect(sparse.geometry).toHaveLength(3);
    expect(dense.destinations).toEqual(sparse.destinations);
    expect(dense.fullShots).toBe(sparse.fullShots);
    expect(dense.plannedStrokes).toBe(sparse.plannedStrokes);
  });

  it.each([
    ["Par 3", 3, 1],
    ["Par 4", 4, 2],
    ["Par 5", 5, 3],
  ] as const)("projects actual %s score plans as %i semantic full-shot targets", (kind, par, fullShots) => {
    const score = scoreCourseHoles(scoringFixture(kind)).holes[0];
    const route = presentCompleteShotRoute(score);

    expect(score).toMatchObject({ isComplete: true, isValid: true, par });
    expect(score.shotPlan).toHaveLength(fullShots);
    expect(score.path.length).toBeGreaterThan(score.shotPlan.length);
    expect(route).toMatchObject({ fullShots, expectedPutts: 2, plannedStrokes: par });
    expect(route?.destinations).toEqual(score.shotPlan.map((step) => step.to));
    expect(route?.geometry).toEqual(score.path);
  }, 15_000);

  it("does not imply targets, putts, or strokes for an incomplete score", () => {
    expect(presentCompleteShotRoute({
      isComplete: false,
      path: [point(0, 0), point(4, 0)],
      shotPlan: [{ to: point(4, 0) }],
    })).toBeNull();
    expect(presentCompleteShotRoute(null)).toBeNull();
  });
});
