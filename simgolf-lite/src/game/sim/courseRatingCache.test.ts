import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE } from "../gameState";
import type { Course } from "../models/types";
import { courseForLayout } from "../models/courseLayouts";
import { createReferenceCourse } from "../testing/referenceCourse";
import { architectureReferencePlans } from "../architecture/referencePlan";
import * as holes from "./holes";
import { computeCourseRatingAndSlope, computeRatingForSetup, computeRatingsByTee } from "./courseRating";
import { RecentSetupRatings, OPTIONAL_SETUP_HISTORY_LIMIT } from "./recentSetupRatings";
import { RecentRatingGeometry, RATING_GEOMETRY_HISTORY_LIMIT } from "./recentRatingGeometry";
function fixture(): Course {
  const base = createReferenceCourse();
  return { ...base, yardsPerTile: 4, tiles: [...base.tiles], holes: [{ ...base.holes[0], id: "rating-cache-hole" }], elevations: [...base.elevations] };
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
function observeSetupSizes() {
  const sizes: number[] = [];
  const set = RecentSetupRatings.prototype.set;
  vi.spyOn(RecentSetupRatings.prototype, "set").mockImplementation(function(
    this: RecentSetupRatings<object>, key: string, value: object,
  ) {
    const result = set.call(this, key, value);
    sizes.push(this.size);
    return result;
  });
  return sizes;
}
function json(value: unknown): string { return JSON.stringify(value); }
afterEach(() => vi.restoreAllMocks());
describe("rating geometry memo ownership", () => {
  it("bounds 64 real elevation versions and retains current operations-only identity", () => {
    const sizes = observeSizes();
    let state = { ...DEFAULT_STATE, course: fixture(), world: { ...DEFAULT_STATE.world, cash: 1_000_000 } };
    const initialCourse = state.course;
    const tiles = state.course.tiles;
    const held = computeRatingsByTee(state.course);
    const heldJson = json(held);
    for (let i = 0; i < 64; i++) {
      const old = state.course.elevations;
      state = applyAction(state, { type: "SCULPT_TILES", deltas: [{ x: 1, y: 1, delta: i % 2 ? -1 : 1 }] });
      expect(state.course.tiles).toBe(tiles);
      expect(state.course.elevations).not.toBe(old);
      const rating = computeCourseRatingAndSlope(state.course);
      expect(json(rating)).toBe(json(computeCourseRatingAndSlope({ ...state.course, tiles: [...tiles] })));
      expect(computeCourseRatingAndSlope({ ...state.course, baseGreenFee: 777 })).toBe(rating);
    }
    const rehydrated = computeRatingsByTee(initialCourse);
    expect(rehydrated).not.toBe(held);
    expect(json(rehydrated)).toBe(heldJson);
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
    const rehydrated = computeRatingsByTee(estate);
    expect(rehydrated).not.toBe(ratings[0]);
    expect(json(rehydrated)).toBe(held);
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
  it("preserves nine hot optional reference-plan variants", () => {
    const course = fixture();
    const original = architectureReferencePlans(course, "member", "A");
    const variants = Array.from({ length: 9 }, (_, index) => {
      const plans = original.map(plan => ({ ...plan, version: `${plan.version}:test-${index}` }));
      const result = computeRatingForSetup(course, "member", "A", plans);
      expect(json(result)).toBe(json(computeRatingForSetup({ ...course, tiles: [...course.tiles] }, "member", "A", plans)));
      return { plans, result };
    });
    variants.forEach(({ plans, result }) => expect(computeRatingForSetup(course, "member", "A", plans)).toBe(result));
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
  it("bounds successful optional histories separately for all nine pairs and keeps legacy/empty identities", () => {
    const sizes = observeSetupSizes();
    const course = fixture();
    const plans = architectureReferencePlans(course, "member", "A");
    const legacy = new Map<string, ReturnType<typeof computeRatingForSetup>>();
    const empty = new Map<string, ReturnType<typeof computeRatingForSetup>>();
    for (const tee of ["forward", "member", "championship"] as const) {
      for (const pin of ["A", "B", "C"] as const) {
        const pair = `${tee}:${pin}`;
        legacy.set(pair, computeRatingForSetup(course, tee, pin));
        empty.set(pair, computeRatingForSetup(course, tee, pin, []));
        const hot = Array.from({ length: OPTIONAL_SETUP_HISTORY_LIMIT }, (_, index) => {
          const input = plans.map(plan => ({ ...plan, version: `optional-${pair}-${index}` }));
          return { input, result: computeRatingForSetup(course, tee, pin, input) };
        });
        hot.forEach(({ input, result }) => expect(computeRatingForSetup(course, tee, pin, input)).toBe(result));
        expect(computeRatingForSetup(course, tee, pin)).toBe(legacy.get(pair));
        expect(computeRatingForSetup(course, tee, pin, [])).toBe(empty.get(pair));
      }
    }
    expect(Math.max(...sizes)).toBe(9 * (OPTIONAL_SETUP_HISTORY_LIMIT + 2));
  }, 180_000);
  it("bounds 64 real reference-plan revisions with cold numerical parity and recomputes retired summaries", () => {
    const sizes = observeSetupSizes();
    const course = fixture();
    const original = architectureReferencePlans(course, "member", "A");
    expect(original.length).toBeGreaterThan(0);
    const revisions = Array.from({ length: 64 }, (_, index) => original.map(plan => ({
      ...plan, version: `${plan.version}:revision-${index}`, effectiveYardage: plan.effectiveYardage + index,
    })));
    const retained = revisions.map(plans => {
      const result = computeRatingForSetup(course, "member", "A", plans);
      expect(result).toEqual(computeRatingForSetup({ ...course, tiles: [...course.tiles] }, "member", "A", plans));
      return result;
    });
    expect(new Set(retained.map(result => result.effectiveYardage)).size).toBeGreaterThan(1);
    revisions.slice(-OPTIONAL_SETUP_HISTORY_LIMIT).forEach((plans, index) => {
      expect(computeRatingForSetup(course, "member", "A", plans)).toBe(retained[64 - OPTIONAL_SETUP_HISTORY_LIMIT + index]);
    });
    const held = json(retained[0]);
    const rehydrated = computeRatingForSetup(course, "member", "A", revisions[0]);
    expect(rehydrated).not.toBe(retained[0]);
    expect(json(rehydrated)).toBe(held);
    expect(json(retained[0])).toBe(held);
    expect(Math.max(...sizes)).toBe(OPTIONAL_SETUP_HISTORY_LIMIT);
  }, 180_000);
  it("preserves joined-key collisions, ordering, aliases and fail-before-publication", () => {
    const course = fixture();
    const plan = architectureReferencePlans(course, "member", "A")[0];
    const legacy = computeRatingForSetup(course, "member", "A");
    const empty = computeRatingForSetup(course, "member", "A", []);
    expect(computeRatingForSetup(course, "member", "A", [{ ...plan, version: "legacy" }])).toBe(legacy);
    expect(computeRatingForSetup(course, "member", "A", [{ ...plan, version: "" }])).toBe(empty);
    const joined = [{ ...plan, version: "one" }, { ...plan, version: "two" }];
    const published = computeRatingForSetup(course, "member", "A", joined);
    expect(computeRatingForSetup(course, "member", "A", [{ ...plan, version: "one|two" }])).toBe(published);
    expect(computeRatingForSetup(course, "member", "A", [...joined].reverse())).not.toBe(published);
    const held = json(published);
    const hot = Array.from({ length: 16 }, (_, index) => {
      const input = [{ ...plan, version: `hot-${index}` }];
      return { input, result: computeRatingForSetup(course, "member", "A", input) };
    });
    for (const error of [null, undefined, new Error("optional solver")]) {
      const score = vi.spyOn(holes, "scoreCourseHoles").mockImplementationOnce(() => { throw error; });
      let failed = false;
      try { computeRatingForSetup(course, "member", "A", [{ ...plan, version: `failed-${String(error)}` }]); }
      catch (actual) { failed = true; expect(actual).toBe(error); }
      expect(failed).toBe(true); score.mockRestore();
      hot.forEach(({ input, result }) => expect(computeRatingForSetup(course, "member", "A", input)).toBe(result));
      let getterFailed = false;
      try { computeRatingForSetup(course, "member", "A", [{ ...plan, get version(): string { throw error; } }]); }
      catch (actual) { getterFailed = true; expect(actual).toBe(error); }
      expect(getterFailed).toBe(true);
    }
    const succeeding = [{ ...plan, version: "success-after-failures" }];
    computeRatingForSetup(course, "member", "A", succeeding);
    hot.slice(1).forEach(({ input, result }) => expect(computeRatingForSetup(course, "member", "A", input)).toBe(result));
    expect(computeRatingForSetup(course, "member", "A", hot[0].input)).not.toBe(hot[0].result);
    expect(json(published)).toBe(held);
    const rehydrated = computeRatingForSetup(course, "member", "A", joined);
    expect(rehydrated).not.toBe(published);
    expect(json(rehydrated)).toBe(held);
    expect(json(rehydrated)).toBe(json(computeRatingForSetup({ ...course, tiles: course.tiles.slice() }, "member", "A", joined)));
    expect(json(published)).toBe(held);
  }, 180_000);
  it("uses the real bounded helper for arbitrary runtime full keys without new errors", () => {
    const cache = new RecentSetupRatings<{ value: number }>();
    const held = { value: 1 };
    cache.set("member:A:legacy", held);
    cache.set("member:A:", held);
    for (const tee of ["forward", "member", "championship"] as const) {
      for (const pin of ["A", "B", "C"] as const) {
        cache.set(`${tee}:${pin}:legacy`, held); cache.set(`${tee}:${pin}:`, held);
        for (let index = 0; index < 16; index++) cache.set(`${tee}:${pin}:plan-${index}`, { value: index });
      }
    }
    for (let index = 0; index < 64; index++) cache.set(`unknown-${index}`, { value: index });
    expect(cache.size).toBe(178);
    expect(cache.get("member:A:legacy")).toBe(held);
    expect(cache.get("member:A:")).toBe(held);
    expect(held.value).toBe(1);
  });

});


describe("rating geometry transaction boundaries", () => {
  it("shares an active entry across reentrant calls and publishes only at outer completion", () => {
    const cache = new RecentRatingGeometry<{ id: number; summary?: object }>();
    const create = vi.fn(() => ({ id: 1, summary: undefined as object | undefined }));
    const held = {};
    cache.run(entry => entry.id === 1, create, outer => {
      cache.run(entry => entry.id === 1, create, inner => {
        expect(inner).toBe(outer);
        inner.summary = held;
      });
      expect(cache.completedSize).toBe(0);
      expect(outer.summary).toBe(held);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(cache.completedSize).toBe(1);
    cache.run(entry => entry.id === 1, create, entry => expect(entry.summary).toBe(held));
  });

  it("preserves nested summaries on falsy failure and does not retire hot entries until retry succeeds", () => {
    const cache = new RecentRatingGeometry<{ id: number; summary?: object }>();
    const hot = Array.from({ length: RATING_GEOMETRY_HISTORY_LIMIT }, (_, id) => ({ id }));
    hot.forEach(entry => cache.run(value => value.id === entry.id, () => entry, value => value));
    const partial = { id: 99, summary: undefined as object | undefined };
    const held = {};
    let failed = false;
    try {
      cache.run(entry => entry.id === 99, () => partial, outer => {
        cache.run(entry => entry.id === 99, () => { throw new Error("duplicate entry"); }, inner => {
          expect(inner).toBe(outer);
          inner.summary = held;
        });
        expect(cache.completedSize).toBe(RATING_GEOMETRY_HISTORY_LIMIT);
        throw undefined;
      });
    } catch (error) { failed = true; expect(error).toBeUndefined(); }
    expect(failed).toBe(true);
    expect(cache.failedPartialSize).toBe(1);
    hot.forEach(entry => cache.run(value => value.id === entry.id,
      () => { throw new Error("hot entry retired on failure"); }, value => expect(value).toBe(entry)));
    cache.run(entry => entry.id === 99, () => { throw new Error("partial lost"); }, entry => {
      expect(entry).toBe(partial);
      expect(entry.summary).toBe(held);
    });
    expect(cache.failedPartialSize).toBe(0);
    expect(cache.completedSize).toBe(RATING_GEOMETRY_HISTORY_LIMIT);
    const replacement = { id: 0 };
    expect(cache.run(entry => entry.id === 0, () => replacement, entry => entry)).toBe(replacement);
    expect(partial.summary).toBe(held);
  });

  it("handles nested construction and leaves completed history intact when construction throws", () => {
    const cache = new RecentRatingGeometry<{ id: number }>();
    const nested = { id: 2 };
    const outer = { id: 1 };
    expect(cache.run(entry => entry.id === 1, () => {
      expect(cache.run(entry => entry.id === 2, () => nested, entry => entry)).toBe(nested);
      return outer;
    }, entry => entry)).toBe(outer);
    expect(cache.completedSize).toBe(2);
    for (const error of [null, undefined, new Error("construction")]) {
      let failed = false;
      try { cache.run(entry => entry.id === 3, () => { throw error; }, entry => entry); }
      catch (actual) { failed = true; expect(actual).toBe(error); }
      expect(failed).toBe(true);
      expect(cache.completedSize).toBe(2);
      expect(cache.failedPartialSize).toBe(0);
    }
    expect(cache.run(entry => entry.id === 1, () => { throw new Error("outer lost"); }, entry => entry)).toBe(outer);
    expect(cache.run(entry => entry.id === 2, () => { throw new Error("nested lost"); }, entry => entry)).toBe(nested);
  });
});
