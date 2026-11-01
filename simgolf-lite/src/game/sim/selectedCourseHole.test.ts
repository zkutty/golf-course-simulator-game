import { describe, expect, it } from "vitest";
import { BALANCE } from "../balance/balanceConfig";
import { courseForCourseSetup } from "../models/courseSetup";
import type { Course } from "../models/types";
import { createM27ReleaseReferenceCourse, createReferenceCourse, createRenderPerfCourse } from "../testing/referenceCourse";
import { prepareShotSearchDomain } from "./shots/shotSearchDomain";
import { __resetHoleScoreCacheForTests, scoreCourseHoles, scoreSelectedCourseHole } from "./holes";

function expectSelectedMatchesSummary(course: Course, indices: readonly number[]) {
  for (const index of indices) {
    __resetHoleScoreCacheForTests();
    const selected = scoreSelectedCourseHole(course, index);
    const whole = scoreCourseHoles(course).holes[index];
    expect(selected).toEqual(whole);
  }
  expect(scoreSelectedCourseHole(course, course.holes.length)).toBeUndefined();
}

describe("selected course hole scoring", () => {
  it("preserves inspector hole output for reference, renderer and both M27 themes", () => {
    expectSelectedMatchesSummary(createReferenceCourse(), [0]);
    expectSelectedMatchesSummary(createRenderPerfCourse(), [0, 8, 17]);
    expectSelectedMatchesSummary(createM27ReleaseReferenceCourse("parkland"), [0, 17, 18, 35]);
    expectSelectedMatchesSummary(createM27ReleaseReferenceCourse("links"), [0, 17, 18, 35]);
  }, 60_000);

  it("retains whole-course search eligibility across setup and config changes", () => {
    const base = createReferenceCourse();
    const twoHoleCourse: Course = {
      ...base,
      holes: [base.holes[0], { ...base.holes[0], id: "second" }],
    };
    const member = courseForCourseSetup(twoHoleCourse, "member", "A");
    const championship = courseForCourseSetup(twoHoleCourse, "championship", "B");
    const penalty = BALANCE.shots.landing.penaltyStrokes;
    const original = Object.getOwnPropertyDescriptor(penalty, "rough")!;
    const setPenalty = (value: number) => Object.defineProperty(penalty, "rough", { ...original, value });
    try {
      expect(prepareShotSearchDomain(member).eligible).toBe(true);
      expectSelectedMatchesSummary(member, [0, 1]);
      expectSelectedMatchesSummary(championship, [0, 1]);
      setPenalty(Number(original.value) + 0.2);
      expectSelectedMatchesSummary(member, [0, 1]);
      setPenalty(-0.2); // Declines the optimized search domain.
      expect(prepareShotSearchDomain(member).eligible).toBe(false);
      expectSelectedMatchesSummary(member, [0, 1]);
      Object.defineProperty(penalty, "rough", original);
      expect(prepareShotSearchDomain(member).eligible).toBe(true);
      expectSelectedMatchesSummary(member, [0, 1]);

      // An invalid inactive hole must decline the same whole-course domain.
      const invalidInactiveHole: Course = {
        ...member,
        holes: [member.holes[0], { ...member.holes[1], tee: undefined } as unknown as Course["holes"][number]],
      };
      expect(prepareShotSearchDomain(invalidInactiveHole).eligible).toBe(false);
      expectSelectedMatchesSummary(invalidInactiveHole, [0]);
    } finally {
      Object.defineProperty(penalty, "rough", original);
      __resetHoleScoreCacheForTests();
    }
  }, 60_000);
});
