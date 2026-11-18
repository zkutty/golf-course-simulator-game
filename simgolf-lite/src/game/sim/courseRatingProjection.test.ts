import { afterEach, expect, it, vi } from "vitest";
import { architectureReferencePlans } from "../architecture/referencePlan";
import { BALANCE } from "../balance/balanceConfig";
import { courseWithEffectiveSurfaces, normalizeSurfaceCareState, surfaceCareTopology } from "../conditions/surfaceCare";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { courseForCourseSetup } from "../models/courseSetup";
import { SURFACE_CARE_CELL_SIZE, type Course, type Terrain } from "../models/types";
import { createM27ReleaseReferenceCourse, createReferenceCourse } from "../testing/referenceCourse";
import { computeCourseRatingAndSlope, computeRatingForSetup, computeRatingsByTee } from "./courseRating";
import { __getHoleScoreCacheStatsForTests, __resetHoleScoreCacheForTests, scoreCourseHoles } from "./holes";
import * as privateRating from "./privateRatingScoring";
import * as shots from "./shots/solveShotsToGreen";

function resetScoring() {
  __resetHoleScoreCacheForTests();
  privateRating.__resetPrivateRatingScoringForTests();
}

afterEach(() => {
  vi.restoreAllMocks();
  resetScoring();
});

function withFullScoring<T>(operation: () => T): T {
  const original = privateRating.scorePrivateRatingSetup;
  const spy = vi.spyOn(privateRating, "scorePrivateRatingSetup").mockImplementation((source, projected) => original(source, projected));
  try { return operation(); }
  finally { spy.mockRestore(); }
}

function observedSolver() {
  const original = shots.solveShotsToGreen;
  return vi.spyOn(shots, "solveShotsToGreen").mockImplementation((args) => original(args));
}

function solverCounts(solver: ReturnType<typeof observedSolver>) {
  const counts = { SCRATCH: 0, BOGEY: 0 };
  for (const [{ golfer }] of solver.mock.calls) counts[golfer.name]++;
  return counts;
}

function smallCourse(): Course {
  const base = createReferenceCourse();
  const width = 28;
  const height = 12;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  const tee = { x: 3, y: 5 };
  const green = { x: 22, y: 5 };
  for (let y = 4; y <= 6; y++) for (let x = 21; x <= 23; x++) tiles[y * width + x] = "green";
  tiles[tee.y * width + tee.x] = "tee";
  return {
    ...base, width, height, tiles, elevations: new Array(tiles.length).fill(0), buildings: [],
    holes: [{
      ...base.holes[0], id: "published-hole", tee, green,
      teeBoxes: { member: tee, forward: { x: 5, y: 5 }, championship: { x: 2, y: 5 } },
      pinPositions: { A: green, B: { x: 22, y: 6 } },
    }],
  };
}

it("keeps the exact cold M27 published rating and omits all 36 unused Bogey paths", () => {
  const fixture = normalizeCourseLayouts(createM27ReleaseReferenceCourse("parkland"));
  const solver = observedSolver();
  const expected = withFullScoring(() => computeCourseRatingAndSlope(structuredClone(fixture)));
  expect(solverCounts(solver)).toEqual({ SCRATCH: 36, BOGEY: 36 });
  solver.mockClear();
  resetScoring();

  const actual = computeCourseRatingAndSlope(structuredClone(fixture));
  expect(actual).toStrictEqual(expected);
  expect(solverCounts(solver)).toEqual({ SCRATCH: 36, BOGEY: 0 });
});

it("preserves published tees, rotations, reference plans and rating after marked terrain and care edits", () => {
  const source = smallCourse();
  const edited = structuredClone(source);
  const pin = { x: 21, y: 5 };
  edited.holes[0].pinPositions = { ...edited.holes[0].pinPositions, B: pin };
  edited.elevations[5 * edited.width + 10] = 3;
  edited.tiles[5 * edited.width + 11] = "sand";
  const zone = surfaceCareTopology(edited).zones.find((entry) => entry.cells.includes(5 * edited.width + 12))!;
  edited.surfaceCare = normalizeSurfaceCareState({
    version: 1, cellSize: SURFACE_CARE_CELL_SIZE, lastAdvancedAbsoluteDay: 0, records: { [zone.key]: { turfHealth: 0.05 } },
  }, edited);
  expect(courseWithEffectiveSurfaces(edited).tiles[5 * edited.width + 12]).toBe("waste_area");
  const missing = structuredClone(source);
  missing.holes[0] = { ...missing.holes[0], green: null, pinPositions: { A: null } };
  const invalid = structuredClone(source);
  invalid.holes[0] = { ...invalid.holes[0], tee: { x: -1, y: 5 }, teeBoxes: { member: { x: -1, y: 5 } } };

  const measure = (course: Course) => {
    const plans = architectureReferencePlans(course, "member", "A");
    return {
      published: computeRatingsByTee(course),
      missingRotation: computeRatingForSetup(course, "member", "C"),
      withoutPlanRows: computeRatingForSetup(course, "member", "A", []),
      withPlanRows: computeRatingForSetup(course, "member", "A", plans),
    };
  };
  for (const fixture of [source, edited, missing, invalid]) {
    const expected = withFullScoring(() => measure(structuredClone(fixture)));
    const actual = measure(structuredClone(fixture));
    expect(actual).toStrictEqual(expected);
  }
  expect(computeRatingsByTee(source).member.rotationsUsed).toEqual(["A", "B"]);
  expect(computeRatingsByTee(source).forward.rotationsUsed).toEqual(["A", "B"]);
  expect(computeRatingsByTee(missing).member.rotationsUsed).toEqual([]);
  expect(computeRatingsByTee(edited).member.setups.B).not.toEqual(computeRatingsByTee(source).member.setups.B);
});

it("keeps incomplete projections out of the full cache and reuses the genuine warm full identity", () => {
  const course = smallCourse();
  const solver = observedSolver();
  const rating = scoreCourseHoles(course, "rating").holes[0];
  expect(Object.keys(rating).sort()).toEqual(["corridor", "difficultyScore", "effectiveDistance", "isComplete", "isValid"]);
  expect(solverCounts(solver)).toEqual({ SCRATCH: 1, BOGEY: 0 });

  solver.mockClear();
  const full = scoreCourseHoles(course);
  expect(solverCounts(solver)).toEqual({ SCRATCH: 1, BOGEY: 1 });
  expect(full.holes[0].bogeyShotsToGreen).toBeGreaterThan(0);
  expect(full.holes[0]).toMatchObject(rating);

  solver.mockClear();
  expect(scoreCourseHoles(course)).toBe(full);
  expect(scoreCourseHoles(course, "rating").holes[0]).toBe(full.holes[0]);
  expect(solver).not.toHaveBeenCalled();
});

it("invalidates rated read footprints and declines when an unrelated hole fails whole-course eligibility", () => {
  const course = smallCourse();
  const solver = observedSolver();
  const original = scoreCourseHoles(course, "rating").holes[0];
  const editedTiles = course.tiles.slice();
  const tee = course.holes[0].tee!;
  editedTiles[tee.y * course.width + tee.x] = "water";
  const edited = { ...course, tiles: editedTiles };
  const changed = scoreCourseHoles(edited, "rating").holes[0];
  expect(changed.isValid).toBe(false);
  expect(changed).not.toBe(original);
  expect(scoreCourseHoles(structuredClone(edited)).holes[0]).toMatchObject(changed);

  const foreign = { ...course.holes[0], tee: null, green: null };
  Object.setPrototypeOf(foreign, Object.create(Object.prototype));
  solver.mockClear();
  const declined = scoreCourseHoles({ ...course, holes: [course.holes[0], foreign] }, "rating");
  expect(declined.holes[0]).toHaveProperty("bogeyShotsToGreen");
  expect(solverCounts(solver)).toEqual({ SCRATCH: 1, BOGEY: 1 });

  const elevations = course.elevations.slice();
  elevations[tee.y * course.width + tee.x] = 4;
  const moved = { ...course, elevations };
  const before = scoreCourseHoles(moved, "rating").holes[0];
  const settings = BALANCE.shots.hole;
  const descriptor = Object.getOwnPropertyDescriptor(settings, "minHoleDistanceYards")!;
  try {
    Object.defineProperty(settings, "minHoleDistanceYards", { ...descriptor, value: 100_000 });
    const after = scoreCourseHoles(moved, "rating").holes[0];
    expect(after.isValid).toBe(false);
    expect(after).not.toBe(before);
    expect(scoreCourseHoles(structuredClone(moved)).holes[0]).toMatchObject(after);
  } finally {
    Object.defineProperty(settings, "minHoleDistanceYards", descriptor);
  }
});

it("retains the old full computation on rejected owner entries and the original first exception", () => {
  const source = smallCourse();
  const projected = courseForCourseSetup(source, "member", "A");
  const accessor = vi.fn(() => "unobserved");
  Object.defineProperty(source.holes[0], "name", { get: accessor, configurable: true });
  const expected = privateRating.scorePrivateRatingSetup(source, projected);
  resetScoring();
  const solver = observedSolver();
  const actual = privateRating.scorePrivateRatingSetup(source, projected, "rating");
  expect(actual).toStrictEqual(expected);
  expect(accessor).not.toHaveBeenCalled();
  expect(solverCounts(solver)).toEqual({ SCRATCH: 1, BOGEY: 1 });
  expect(privateRating.__privateRatingScoringStateForTests()).toEqual({ owners: 1, entries: 0, active: false });

  resetScoring();
  const cause = new Error("legacy Bogey solver failure");
  solver.mockImplementation((args) => {
    if (args.golfer.name === "BOGEY") throw cause;
    return { reachable: true, expectedShotsToGreen: 1, plan: [] };
  });
  expect(() => privateRating.scorePrivateRatingSetup(source, projected, "rating")).toThrow(cause);
  expect(privateRating.__privateRatingScoringStateForTests()).toEqual({ owners: 0, entries: 0, active: false });
  expect(accessor).not.toHaveBeenCalled();
  expect(__getHoleScoreCacheStatsForTests().misses).toBe(1);
});
