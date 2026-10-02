import { afterEach, describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../utils/canonical";
import { createM27ReleaseReferenceCourse, createReferenceCourse } from "../testing/referenceCourse";
import { EQUIVALENT_HOLE_SCORE_MAX_DEPENDENCIES, __getElevationReadTrackerRetainedRootsForTests, __getEquivalentHoleScoreCacheDependenciesForTests, __getEquivalentHoleScoreCacheRetainedRootsForTests, __getEquivalentHoleScoreCacheSizeForTests, __getHoleScoreCacheStatsForTests, __getHoleScoreDependenciesForTests, __resetHoleScoreCacheForTests, scoreCourseHoles, scoreHole } from "./holes";
import { scoringDependencyWeight, trimScoringDependencyCache } from "./scoringCacheRetention";

afterEach(__resetHoleScoreCacheForTests);

describe("release-scale scoring read tracking", () => {
  it("retains the original 36-hole estate scoring oracle", () => {
    // Captured from the unmodified Proxy recorder; includes every retained
    // shot plan, slope fact, corridor, rating and validity result.
    const course = createM27ReleaseReferenceCourse();
    expect(hashCanonicalValue(scoreCourseHoles(course))).toBe("c019869d");
    expect(__getEquivalentHoleScoreCacheDependenciesForTests(course)).toBe(76_220);
    expect(__getEquivalentHoleScoreCacheDependenciesForTests(course)).toBeLessThan(EQUIVALENT_HOLE_SCORE_MAX_DEPENDENCIES);
  });

  it("reuses equivalent immutable hole views and bounds retained edit history", () => {
    const course = createReferenceCourse();
    const hole = course.holes[0];
    const first = scoreHole(course, hole, 0);
    const clone = { ...hole };
    expect(scoreHole(course, clone, 0)).toBe(first);
    expect(__getHoleScoreDependenciesForTests(clone)).toEqual([]);
    expect(__getHoleScoreCacheStatsForTests()).toEqual({ hits: 1, misses: 1 });
    for (let index = 0; index < 90; index++) expect(scoreHole(course, { ...hole, id: `ID ${index}`, name: `Edit ${index}` }, 0)).toBe(first);
    expect(__getEquivalentHoleScoreCacheSizeForTests(course)).toBe(1);
    for (let index = 1; index <= 90; index++) scoreHole(course, { ...hole }, index);
    expect(__getEquivalentHoleScoreCacheSizeForTests(course)).toBe(72);
    const before = __getHoleScoreCacheStatsForTests().misses;
    expect(scoreHole(course, { ...hole }, 0)).toEqual(first);
    expect(__getHoleScoreCacheStatsForTests().misses).toBe(before + 1);
  });

  it("never aliases malformed nonfinite or signed-zero scoring markers", () => {
    const course = createReferenceCourse();
    const source = course.holes[0];
    for (const coordinate of [NaN, Infinity, -Infinity, -0]) {
      const malformed = { ...source, tee: { x: coordinate, y: source.tee!.y } };
      const before = __getHoleScoreCacheStatsForTests();
      const first = scoreHole(course, malformed, 0);
      const repeated = scoreHole(course, { ...malformed }, 0);
      expect(repeated).toEqual(first);
      expect(__getHoleScoreCacheStatsForTests().misses).toBe(before.misses + 2);
      expect(__getHoleScoreCacheStatsForTests().hits).toBe(before.hits);
      expect(__getEquivalentHoleScoreCacheSizeForTests(course)).toBe(0);
    }
  });

  it("retains secondary payload for only the latest terrain root across paint/undo", () => {
    const course = createReferenceCourse();
    const first = scoreHole(course, { ...course.holes[0] }, 0);
    const roots = Array.from({ length: 12 }, () => ({ ...course, tiles: course.tiles.slice() }));
    for (const next of roots) {
      expect(scoreHole(next, { ...course.holes[0] }, 0)).toEqual(first);
      expect(__getEquivalentHoleScoreCacheRetainedRootsForTests()).toBe(1);
      expect(__getEquivalentHoleScoreCacheSizeForTests(course)).toBe(0);
      expect(__getEquivalentHoleScoreCacheSizeForTests(next)).toBe(1);
    }
    expect(__getEquivalentHoleScoreCacheSizeForTests(roots[0])).toBe(0);
    __resetHoleScoreCacheForTests();
    expect(__getEquivalentHoleScoreCacheRetainedRootsForTests()).toBe(0);
  });

  it("caps retained cell payload above the measured release working set and evicts exact entries", () => {
    const payload = (tiles: number, elevations: number) => ({
      tileDependencies: new Map(Array.from({ length: tiles }, (_, index) => [index, "fairway"])),
      elevationDependencies: new Map(Array.from({ length: elevations }, (_, index) => [index, 0])),
    });
    const entries = new Map([["old", payload(3, 2)], ["middle", payload(2, 1)], ["latest", payload(2, 2)]]);
    expect(scoringDependencyWeight(entries)).toBe(12);
    trimScoringDependencyCache(entries, 72, 7);
    expect([...entries.keys()]).toEqual(["middle", "latest"]);
    expect(scoringDependencyWeight(entries)).toBe(7);
    trimScoringDependencyCache(entries, 1, 100);
    expect([...entries.keys()]).toEqual(["latest"]);
    entries.set("oversized", payload(10, 10));
    trimScoringDependencyCache(entries, 72, 7);
    expect(entries.size).toBe(0);
  });

  it("invalidates consumed tile/elevation, obstacle contents and hole metadata", () => {
    const course = createReferenceCourse();
    const hole = course.holes[0];
    scoreHole(course, hole, 0);
    const consumed = __getHoleScoreDependenciesForTests(hole)[0];
    course.tiles[consumed] = "water";
    const afterTile = scoreHole(course, { ...hole }, 0);
    __resetHoleScoreCacheForTests();
    expect(scoreHole(course, { ...hole }, 0)).toEqual(afterTile);

    const validCourse = createReferenceCourse();
    const validHole = validCourse.holes[0];
    scoreHole(validCourse, validHole, 0);
    const elevated = { ...validCourse, elevations: validCourse.elevations!.slice() };
    elevated.elevations[validHole.tee!.y * validCourse.width + validHole.tee!.x] += 4;
    const elevationMisses = __getHoleScoreCacheStatsForTests().misses;
    const elevationResult = scoreHole(elevated, { ...validHole }, 0);
    expect(__getHoleScoreCacheStatsForTests().misses).toBe(elevationMisses + 1);
    __resetHoleScoreCacheForTests();
    expect(scoreHole(elevated, { ...validHole }, 0)).toEqual(elevationResult);

    course.obstacles.push({ type: "tree", x: hole.tee!.x, y: hole.tee!.y });
    const misses = __getHoleScoreCacheStatsForTests().misses;
    scoreHole(course, { ...hole }, 0);
    expect(__getHoleScoreCacheStatsForTests().misses).toBe(misses + 1);
    const marker = { ...hole, green: { x: hole.green!.x - 1, y: hole.green!.y } };
    const moved = scoreHole(course, marker, 0);
    const indexed = scoreHole(course, { ...marker }, 1);
    expect(indexed.holeIndex).toBe(1);
    __resetHoleScoreCacheForTests();
    expect(scoreHole(course, marker, 0)).toEqual(moved);
  });

  it("retains only one accessor root across sculpt/undo history and clears it on reset", () => {
    const course = createReferenceCourse();
    const hole = course.holes[0];
    const undoHistory = Array.from({ length: 30 }, (_, index) => {
      const elevations = course.elevations!.slice();
      elevations[hole.tee!.y * course.width + hole.tee!.x] += index % 4;
      return { ...course, elevations };
    });
    for (const snapshot of [...undoHistory, ...undoHistory.slice().reverse()]) {
      scoreHole(snapshot, { ...hole }, 0);
      expect(__getElevationReadTrackerRetainedRootsForTests()).toBe(1);
    }
    expect(undoHistory).toHaveLength(30);
    __resetHoleScoreCacheForTests();
    expect(__getElevationReadTrackerRetainedRootsForTests()).toBe(0);
  });
});
