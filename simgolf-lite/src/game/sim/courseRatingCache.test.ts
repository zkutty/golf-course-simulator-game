import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE } from "../gameState";
import type { Course } from "../models/types";
import { courseForLayout } from "../models/courseLayouts";
import { createReferenceCourse } from "../testing/referenceCourse";
import { architectureReferencePlans } from "../architecture/referencePlan";
import * as holes from "./holes";
import { computeCourseRatingAndSlope, computeRatingForSetup, computeRatingsByTee } from "./courseRating";
import { RecentRatingGeometry, RATING_GEOMETRY_HISTORY_LIMIT } from "./recentRatingGeometry";
function fixture(): Course {
  const base = createReferenceCourse();
  return { ...base, tiles: [...base.tiles], holes: [base.holes[0]], elevations: [...base.elevations] };
}
function observeSizes() {
  const sizes: { completed: number; partial: number }[] = [];
  const run = RecentRatingGeometry.prototype.run;
  vi.spyOn(RecentRatingGeometry.prototype, "run").mockImplementation(function<Result>(
    this: RecentRatingGeometry<object>, matches: (entry: object) => boolean,
    create: () => object, operation: (entry: object) => Result,
  ): Result {
    try { return run.call(this, matches, create, operation) as Result; }
    finally { sizes.push({ completed: this.completedSize, partial: this.failedPartialSize }); }
  });
  return sizes;
}
function json(value: unknown): string { return JSON.stringify(value); }
afterEach(() => vi.restoreAllMocks());
describe("rating geometry memo ownership", () => {
  it("bounds 64 real elevation versions and retains current operations-only identity", () => {
    const sizes = observeSizes();
    let state = { ...DEFAULT_STATE, course: fixture(), world: { ...DEFAULT_STATE.world, cash: 1_000_000 } };
    const tiles = state.course.tiles;
    const held = computeRatingsByTee(state.course);
    const heldJson = json(held);
    for (let i = 0; i < 64; i++) {
      const old = state.course.elevations;
      state = applyAction(state, { type: "SCULPT_TILES", deltas: [{ x: 1, y: 1, delta: i % 2 ? -1 : 1 }] });
      expect(state.course.tiles).toBe(tiles);
      expect(state.course.elevations).not.toBe(old);
      const rating = computeCourseRatingAndSlope(state.course);
      if (i % 16 === 0 || i === 63) {
        expect(json(rating)).toBe(json(computeCourseRatingAndSlope({ ...state.course, tiles: [...tiles] })));
      }
      expect(computeCourseRatingAndSlope({ ...state.course, baseGreenFee: 777 })).toBe(rating);
    }
    expect(sizes.some(size => size.completed === RATING_GEOMETRY_HISTORY_LIMIT)).toBe(true);
    expect(Math.max(...sizes.map(size => size.completed))).toBeLessThanOrEqual(RATING_GEOMETRY_HISTORY_LIMIT);
    expect(Math.max(...sizes.map(size => size.partial))).toBe(0);
    expect(json(held)).toBe(heldJson);
  }, 180_000);
  it("keeps a full estate plus five stable layout views hot; rehydrates evicted geometry numerically", () => {
    const base = fixture();
    const tee = base.holes[0].tee;
    if (!tee) throw new Error("FIXTURE_TEE_STOP");
    const estateHoles = Array.from({ length: 36 }, (_, index) => ({
      ...base.holes[0], id: `hole-${index}`, tee: { ...tee, x: tee.x + index % 7 },
    }));
    const ranges = [[0, 6], [6, 13], [13, 21], [21, 28], [28, 36]];
    const layouts = ranges.map(([start, end], i) => ({
      id: `layout-${i}`, name: `Layout ${i}`, draftHoleIds: estateHoles.slice(start, end).map(hole => hole.id),
      publishedHoleIds: estateHoles.slice(start, end).map(hole => hole.id), roundLength: 9 as const,
      state: "open" as const, greenFee: 50,
    }));
    const estate = { ...base, holes: estateHoles, layouts };
    const views = [estate, ...layouts.map(layout => courseForLayout(estate, layout.id))];
    const sizes = observeSizes();
    const ratings = views.map(computeRatingsByTee);
    for (let pass = 0; pass < 2; pass++) views.forEach((course, i) => expect(computeRatingsByTee({ ...course, baseGreenFee: 99 })).toBe(ratings[i]));
    expect(sizes.some(size => size.completed >= 6)).toBe(true);
    const held = json(ratings[0]);
    for (let i = 0; i < 9; i++) computeRatingForSetup({ ...estate, elevations: estate.elevations.slice() }, "member", "A");
    expect(json(computeRatingsByTee(estate))).toBe(held);
    expect(json(ratings[0])).toBe(held);
  }, 180_000);
  it("preserves all nine legacy setups, distinct tile owners and retained setup aliases", () => {
    const course = fixture();
    const setups = (["forward", "member", "championship"] as const).flatMap(tee =>
      (["A", "B", "C"] as const).map(pin => ({ tee, pin, result: computeRatingForSetup(course, tee, pin) })));
    const held = setups.map(({ result }) => json(result));
    for (const setup of setups) expect(computeRatingForSetup({ ...course, baseGreenFee: 1 }, setup.tee, setup.pin)).toBe(setup.result);
    const other = { ...course, tiles: [...course.tiles] };
    expect(json(computeRatingsByTee(other))).toBe(json(computeRatingsByTee(course)));
    setups.forEach(({ result }, i) => expect(json(result)).toBe(held[i]));
  }, 180_000);
  it("preserves optional reference-plan variants without silently capping their setup map", () => {
    const course = fixture();
    const original = architectureReferencePlans(course, "member", "A");
    for (let index = 0; index < 9; index++) {
      const plans = original.map(plan => ({ ...plan, version: `${plan.version}:test-${index}` }));
      const result = computeRatingForSetup(course, "member", "A", plans);
      expect(computeRatingForSetup(course, "member", "A", plans)).toBe(result);
      expect(json(result)).toBe(json(computeRatingForSetup({ ...course, tiles: [...course.tiles] }, "member", "A", plans)));
    }
  }, 180_000);
  it("retains existing completed aliases on construction/solver failure and bounds failed partial retries", () => {
    const base = fixture();
    const point = base.holes[0];
    if (!point.tee || !point.green) throw new Error("FIXTURE_SETUP_STOP");
    const course = { ...base, holes: [{ ...point,
      teeBoxes: { forward: point.tee, member: point.tee, championship: point.tee },
      pinPositions: { A: point.green, B: point.green, C: point.green },
    }] };
    const versions = Array.from({ length: 8 }, () => ({ ...course, elevations: course.elevations.slice() }));
    const hot = versions.map(computeRatingsByTee);
    const sizes = observeSizes();
    for (const error of [null, undefined, new Error("solver")]) {
      const next = { ...course, elevations: course.elevations.slice() };
      const score = vi.spyOn(holes, "scoreCourseHoles").mockImplementationOnce(() => { throw error; });
      let caught = false;
      try { computeRatingsByTee(next); } catch (actual) { caught = true; expect(actual).toBe(error); }
      expect(caught).toBe(true);
      score.mockRestore();
      versions.forEach((version, i) => expect(computeRatingsByTee(version)).toBe(hot[i]));
    }
    expect(Math.max(...sizes.map(size => size.partial))).toBe(1);
    expect(Math.max(...sizes.map(size => size.completed))).toBe(8);
    const error = new Error("construction");
    expect(() => computeRatingsByTee({ ...course, get holes(): Course["holes"] { throw error; } })).toThrow(error);
    versions.forEach((version, i) => expect(computeRatingsByTee(version)).toBe(hot[i]));
    const completedCourse = versions[0];
    const completedFailure = vi.spyOn(holes, "scoreCourseHoles").mockImplementationOnce(() => { throw error; });
    expect(() => computeRatingForSetup(completedCourse, "member", "A", [])).toThrow(error);
    completedFailure.mockRestore();
    expect(computeRatingsByTee(completedCourse)).toBe(hot[0]);
    const next = { ...course, elevations: course.elevations.slice() };
    const originalScore = holes.scoreCourseHoles;
    const score = vi.spyOn(holes, "scoreCourseHoles")
      .mockImplementationOnce(originalScore).mockImplementationOnce(() => { throw error; });
    let caught = false;
    try { computeRatingsByTee(next); } catch (actual) { caught = true; expect(actual).toBe(error); }
    expect(caught).toBe(true);
    expect(score).toHaveBeenCalledTimes(2);
    score.mockRestore();
    const retry = vi.spyOn(holes, "scoreCourseHoles");
    const first = computeRatingForSetup(next, "forward", "A");
    expect(retry).not.toHaveBeenCalled();
    expect(computeRatingForSetup(next, "forward", "A")).toBe(first);
    expect(json(computeRatingsByTee(next))).toBe(json(computeRatingsByTee({ ...next, tiles: [...next.tiles] })));
    expect(json(first)).toBe(json(computeRatingForSetup({ ...next, tiles: [...next.tiles] }, "forward", "A")));
  }, 180_000);
});
