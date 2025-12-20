import type { Course } from "../models/types";
import { scoreCourseHoles } from "./holes";
import { BALANCE } from "../balance/balanceConfig";

export function isCoursePlayable(course: Course): boolean {
  // Hard gate: course must be in a state where people can reasonably play it.
  if (course.condition < BALANCE.coursePlayable.minCondition) return false;

  // Need 9 holes with tee+green and a valid playable route.
  const holes = scoreCourseHoles(course);
  const valid = holes.holes.filter((h) => h.isComplete && h.isValid);
  if (valid.length < BALANCE.coursePlayable.minValidHoles) return false;

  // Also require every hole entry has tee/green (even if score says valid).
  // This prevents edge cases where the score function changes.
  for (let i = 0; i < 9; i++) {
    const h = course.holes[i];
    if (!h?.tee || !h?.green) return false;
  }

  const avgPlay =
    valid.reduce((a, h) => a + h.playabilityScore, 0) / Math.max(1, valid.length);
  if (avgPlay < BALANCE.coursePlayable.minAvgPlayability) return false;

  return true;
}


