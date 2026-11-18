import { afterEach, beforeAll, expect, it } from "vitest";
import { BALANCE } from "../balance/balanceConfig";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { courseForCourseSetup } from "../models/courseSetup";
import type { Course } from "../models/types";
import { presentCompleteShotRoute } from "../presentation/shotRoutePresentation";
import { createM27ReleaseReferenceCourse } from "../testing/referenceCourse";
import {
  __getHoleScoreCacheStatsForTests,
  __resetHoleScoreCacheForTests,
  scoreCourseHoles,
  scoreSelectedCourseHole,
} from "./holes";

let estate: Course;
beforeAll(() => {
  estate = normalizeCourseLayouts(createM27ReleaseReferenceCourse("parkland"));
});
afterEach(() => {
  __resetHoleScoreCacheForTests();
});

function memberView() {
  return courseForCourseSetup(structuredClone(estate), "member", estate.activePinRotation ?? "A");
}

it("preserves the complete score and route for either layout while scoring only one cold hole", () => {
  expect(estate.holes).toHaveLength(36);
  expect(estate.holes.every((hole) => hole.tee && hole.green)).toBe(true);

  const first = scoreSelectedCourseHole(memberView(), 0);
  expect(__getHoleScoreCacheStatsForTests()).toEqual({ hits: 0, misses: 1 });
  __resetHoleScoreCacheForTests();
  const last = scoreSelectedCourseHole(memberView(), 35);
  expect(__getHoleScoreCacheStatsForTests()).toEqual({ hits: 0, misses: 1 });
  __resetHoleScoreCacheForTests();

  const summary = scoreCourseHoles(memberView());
  expect(__getHoleScoreCacheStatsForTests()).toEqual({ hits: 0, misses: 36 });
  expect(first).toEqual(summary.holes[0]);
  expect(last).toEqual(summary.holes[35]);
  expect(presentCompleteShotRoute(first)).toEqual(presentCompleteShotRoute(summary.holes[0]));
  expect(presentCompleteShotRoute(last)).toEqual(presentCompleteShotRoute(summary.holes[35]));
});

it("preserves the requested tee and pin score through terrain edits and incomplete markers", () => {
  const course = structuredClone(estate);
  const [first, second] = course.holes;
  const tee = { x: first.tee!.x, y: first.tee!.y - 1 };
  const pin = { x: first.green!.x, y: first.green!.y + 1 };
  first.teeBoxes = { ...first.teeBoxes, forward: tee };
  first.pinPositions = { ...first.pinPositions, B: pin };
  const tileIndex = tee.y * course.width + tee.x;
  course.elevations[tileIndex] += 2;
  course.tiles[tileIndex] = "tee";
  course.holes = [first, second];

  const view = () => courseForCourseSetup(structuredClone(course), "forward", "B");
  const authority = view();
  const selected = scoreSelectedCourseHole(authority, 0);
  const incomplete = scoreSelectedCourseHole(authority, 1);
  const summary = scoreCourseHoles(view());
  expect(authority.holes[0].tee).toEqual(tee);
  expect(authority.holes[0].green).toEqual(pin);
  expect(selected).toEqual(summary.holes[0]);
  expect(selected?.isComplete).toBe(true);
  expect(incomplete).toEqual(summary.holes[1]);
  expect(incomplete?.isComplete).toBe(false);
  for (const index of [-1, 2, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(scoreSelectedCourseHole(authority, index)).toBeUndefined();
  }
});

it("invalidates the selected score when another hole changes whole-course domain eligibility", () => {
  const member = memberView();
  const [first, second] = member.holes;
  const course = { ...member, holes: [first, second] };
  const score = scoreSelectedCourseHole(course, 0);
  expect(scoreSelectedCourseHole(course, 0)).toBe(score);
  expect(__getHoleScoreCacheStatsForTests()).toEqual({ hits: 1, misses: 1 });

  // A non-plain neighboring record declines the existing whole-course search
  // optimization even though the selected hole and its geometry are identical.
  const unconventional = { ...second };
  Object.setPrototypeOf(unconventional, Object.create(Object.prototype));
  const changed = { ...course, holes: [first, unconventional] };
  const fallback = scoreSelectedCourseHole(changed, 0);
  expect(__getHoleScoreCacheStatsForTests()).toEqual({ hits: 1, misses: 2 });
  expect(fallback).toEqual(scoreCourseHoles(changed).holes[0]);
});

it("uses the existing search config snapshot to refresh a selected score", () => {
  const member = memberView();
  const course = { ...member, holes: member.holes.slice(0, 2) };
  const original = scoreSelectedCourseHole(course, 0);
  const tooShort = "Hole too short (tee too close to green)";
  expect(original?.issues).not.toContain(tooShort);
  const config = BALANCE.shots.hole;
  const descriptor = Object.getOwnPropertyDescriptor(config, "minHoleDistanceYards")!;
  try {
    Object.defineProperty(config, "minHoleDistanceYards", { ...descriptor, value: 100_000 });
    const changed = scoreSelectedCourseHole(course, 0);
    expect(__getHoleScoreCacheStatsForTests()).toEqual({ hits: 0, misses: 2 });
    expect(changed?.issues).toContain(tooShort);
    expect(changed).toEqual(scoreCourseHoles(course).holes[0]);
  } finally {
    Object.defineProperty(config, "minHoleDistanceYards", descriptor);
  }
});
