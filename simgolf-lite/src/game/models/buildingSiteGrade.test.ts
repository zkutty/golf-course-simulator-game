import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeElevationChangeCost } from "./terrainEconomics";
import { planBuildingSiteGrade } from "./buildingSiteGrade";
import { DEFAULT_COURSE } from "./defaults";
import type { Course, Terrain } from "./types";

function courseWithElevations(width = 9, height = 9): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "fairway" as Terrain),
    elevations: Array.from({ length: width * height }, () => 0),
    holes: [],
    obstacles: [],
    buildings: [],
  };
}

describe("building site-grade contract", () => {
  it("plans a complete flat pad, one-cell transition ring, edge geometry, and exact earthwork baseline", () => {
    const course = courseWithElevations();
    const elevations = [1, 5, 4, 0, 8, 3, 5, 2, 6];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      course.elevations[(y + 3) * course.width + x + 3] = elevations[y * 3 + x];
    }
    course.elevations[2 * course.width + 2] = 0;
    course.elevations[2 * course.width + 3] = 12;
    course.elevations[2 * course.width + 4] = 5;

    const plan = planBuildingSiteGrade(course, { type: "clubhouse", x: 3, y: 3 });

    expect(plan.supportElevation).toBe(4); // upper median of the nine footprint cells
    expect(plan.footprint).toHaveLength(9);
    expect(plan.transitionRing).toHaveLength(16);
    expect(plan.footprint.every((cell) => cell.after === 4)).toBe(true);
    expect(plan.transitionRing.find((cell) => cell.x === 2 && cell.y === 2)).toMatchObject({ before: 0, after: 3, delta: 3 });
    expect(plan.transitionRing.find((cell) => cell.x === 3 && cell.y === 2)).toMatchObject({ before: 12, after: 5, delta: -7 });
    expect(new Set([...plan.footprint, ...plan.transitionRing].map((cell) => cell.index)).size).toBe(25);
    expect(plan.maximumDelta).toBe(7);
    expect(plan.maximumSupportDelta).toBe(4);
    expect(plan.exposedEdges).toHaveLength(20);
    expect(plan.exposedEdges.every((edge) => edge.role === "transition")).toBe(true);
    expect(plan.exposedEdges).toEqual([...plan.exposedEdges].sort((a, b) => (
      a.cell.y - b.cell.y || a.cell.x - b.cell.x || ["north", "east", "south", "west"].indexOf(a.direction) - ["north", "east", "south", "west"].indexOf(b.direction)
    )));
    expect(plan.costBaseline.totalSteps).toBe(plan.costBaseline.fillSteps + plan.costBaseline.cutSteps);
    expect(plan.costBaseline.total).toBe(computeElevationChangeCost(plan.costBaseline.totalSteps, 1, course.theme).net);
  });

  it("is deterministic and leaves ordinary and legacy courses unchanged until a placement owner applies its mutations", () => {
    const course = courseWithElevations();
    course.elevations[4 * course.width + 4] = 6;
    const elevationReference = course.elevations;
    const before = structuredClone(course);

    const first = planBuildingSiteGrade(course, { type: "pro_shop", x: 4, y: 4 }, { costMult: 1.25 });
    const second = planBuildingSiteGrade(course, { type: "pro_shop", x: 4, y: 4 }, { costMult: 1.25 });

    expect(second).toEqual(first);
    expect(course).toEqual(before);
    expect(course.elevations).toBe(elevationReference); // no terrain allocation or save/hash input changed

    const legacy = { ...course, elevations: undefined } as unknown as Course;
    const legacyPlan = planBuildingSiteGrade(legacy, { type: "pro_shop", x: 4, y: 4 });
    expect(legacyPlan.supportElevation).toBe(0);
    expect(legacyPlan.mutations).toEqual([]);
    expect(legacyPlan.costBaseline.total).toBe(0);
    expect(legacy.elevations).toBeUndefined();
  });

  it("represents estate-boundary edges without inventing a partial out-of-bounds ring", () => {
    const course = courseWithElevations(5, 5);
    const plan = planBuildingSiteGrade(course, { type: "clubhouse", x: 0, y: 0 });

    expect(plan.footprint).toHaveLength(9);
    expect(plan.transitionRing).toHaveLength(7);
    expect(plan.exposedEdges.some((edge) => edge.neighbor === null && edge.cell.x === 0 && edge.direction === "west")).toBe(true);
    expect(plan.exposedEdges.some((edge) => edge.neighbor === null && edge.cell.y === 0 && edge.direction === "north")).toBe(true);
  });

  it("keeps the contract complete, bounded, and source-immutable for arbitrary valid terrain", () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 81, maxLength: 81 }),
      (elevations) => {
        const course = courseWithElevations();
        course.elevations = elevations;
        const before = [...elevations];
        const plan = planBuildingSiteGrade(course, { type: "clubhouse", x: 3, y: 3 });

        expect(plan.footprint).toHaveLength(9);
        expect(plan.transitionRing).toHaveLength(16);
        expect(plan.footprint.every((cell) => cell.after === plan.supportElevation)).toBe(true);
        expect(plan.transitionRing.every((cell) => Math.abs(cell.after - plan.supportElevation) <= 1)).toBe(true);
        expect(plan.mutations.every((cell) => cell.delta !== 0)).toBe(true);
        expect(plan.costBaseline.totalSteps).toBe(plan.costBaseline.fillSteps + plan.costBaseline.cutSteps);
        expect(course.elevations).toEqual(before);
      },
    ), { numRuns: 100 });
  });
});
