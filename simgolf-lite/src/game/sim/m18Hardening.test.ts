import { afterEach, describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { DEFAULT_STATE } from "../gameState";
import { BALANCE } from "../balance/balanceConfig";
import { createRenderPerfCourse, createReferenceCourse } from "../testing/referenceCourse";
import { applyAction } from "../../core/reducer";
import { computeCourseRatingAndSlope } from "./courseRating";
import {
  __getHoleScoreCacheStatsForTests,
  __getHoleScoreDependenciesForTests,
  __resetHoleScoreCacheForTests,
  scoreCourseHoles,
} from "./holes";

const originalScratchCarries = BALANCE.golfers.scratch.clubs.map((club) => club.carryYards);

afterEach(() => {
  BALANCE.golfers.scratch.clubs.forEach((club, index) => {
    (club as { carryYards: number }).carryYards = originalScratchCarries[index];
  });
  __resetHoleScoreCacheForTests();
});

function separatedTwoHoleCourse(): Course {
  const width = 80;
  const height = 32;
  const tiles = new Array<Terrain>(width * height).fill("water");
  const holes = [
    { tee: { x: 4, y: 5 }, green: { x: 34, y: 5 }, parMode: "AUTO" as const },
    { tee: { x: 45, y: 26 }, green: { x: 75, y: 26 }, parMode: "AUTO" as const },
  ];
  for (const hole of holes) {
    for (let y = hole.tee.y - 2; y <= hole.tee.y + 2; y++) {
      for (let x = hole.tee.x; x <= hole.green.x; x++) tiles[y * width + x] = "fairway";
    }
    tiles[hole.tee.y * width + hole.tee.x] = "tee";
    tiles[hole.green.y * width + hole.green.x] = "green";
  }
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes,
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Dependency Test",
    baseGreenFee: 65,
    condition: 1,
    theme: "parkland",
  };
}

describe("M18 core hardening", () => {
  it("derives rating output from the shared BALANCE golfer profiles", () => {
    const baseline = computeCourseRatingAndSlope(createReferenceCourse());
    BALANCE.golfers.scratch.clubs.forEach((club) => {
      (club as { carryYards: number }).carryYards = Math.max(40, Math.round(club.carryYards * 0.55));
    });
    const retuned = computeCourseRatingAndSlope(createReferenceCourse());
    expect(retuned.expectedScratchScore).not.toBe(baseline.expectedScratchScore);
    expect(BALANCE.golfers.scratch.ratingMultipliers).toEqual({
      hazard: 1,
      rough: 0.8,
      deepRough: 1,
      obstacle: 1,
    });
  });

  it("reuses unaffected hole solves across immutable paint updates", () => {
    const course = separatedTwoHoleCourse();
    scoreCourseHoles(course);
    const firstDependencies = __getHoleScoreDependenciesForTests(course.holes[0]);
    const secondDependencies = new Set(__getHoleScoreDependenciesForTests(course.holes[1]));
    const firstOnlyIndex = firstDependencies.find((index) => !secondDependencies.has(index));
    expect(firstOnlyIndex).toBeTypeOf("number");
    const tiles = course.tiles.slice();
    tiles[firstOnlyIndex!] = tiles[firstOnlyIndex!] === "sand" ? "rough" : "sand";
    scoreCourseHoles({ ...course, tiles });
    const stats = __getHoleScoreCacheStatsForTests();
    expect(stats.misses).toBe(3);
    expect(stats.hits).toBe(1);
  });

  it.runIf(process.env.M18_BENCH === "1")(
    "measurably reduces scoring work for a paint stroke on a full nine-hole course",
    () => {
    const fixture = createRenderPerfCourse();
    const course = { ...fixture, holes: fixture.holes.slice(0, 9) };
    __resetHoleScoreCacheForTests();
    const coldStart = performance.now();
    scoreCourseHoles(course);
    const coldMs = performance.now() - coldStart;

    const dependencyUse = new Map<number, number>();
    for (const hole of course.holes) {
      for (const index of __getHoleScoreDependenciesForTests(hole)) {
        dependencyUse.set(index, (dependencyUse.get(index) ?? 0) + 1);
      }
    }
    const candidate = [...dependencyUse].sort((a, b) => a[1] - b[1])[0];
    expect(candidate?.[1]).toBeLessThan(course.holes.length);
    const tiles = course.tiles.slice();
    tiles[candidate[0]] = tiles[candidate[0]] === "sand" ? "rough" : "sand";

    const paintStart = performance.now();
    scoreCourseHoles({ ...course, tiles });
    const paintMs = performance.now() - paintStart;
    const stats = __getHoleScoreCacheStatsForTests();
    expect(stats.hits).toBeGreaterThan(0);
    expect(paintMs).toBeLessThan(coldMs);
      console.info(
        `[M18 score benchmark] cold=${coldMs.toFixed(1)}ms paint=${paintMs.toFixed(1)}ms speedup=${(coldMs / paintMs).toFixed(1)}x cacheHits=${stats.hits}`
      );
    }
  );

  it("takes configured loans through the reducer and bumps economyVersion", () => {
    const course = createRenderPerfCourse();
    const world = {
      ...DEFAULT_STATE.world,
      reputation: 100,
      lastWeekProfit: 5_000,
      loans: [],
    };
    const state = { ...DEFAULT_STATE, course, world };
    const next = applyAction(state, { type: "TAKE_LOAN", kind: "EXPANSION" });
    expect(next.economyVersion).toBe(state.economyVersion + 1);
    expect(next.world.cash).toBe(world.cash + BALANCE.loans.expansion.maxPrincipal);
    expect(next.world.loans[0]).toMatchObject({
      kind: "EXPANSION",
      principal: BALANCE.loans.expansion.maxPrincipal,
      apr: BALANCE.loans.expansion.apr,
      termWeeks: BALANCE.loans.expansion.termWeeks,
    });
    const duplicate = applyAction(next, { type: "TAKE_LOAN", kind: "EXPANSION" });
    expect(duplicate.economyVersion).toBe(next.economyVersion);
    expect(duplicate.world.loans).toHaveLength(1);
  });
});
