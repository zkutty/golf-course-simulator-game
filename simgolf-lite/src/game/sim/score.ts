import type { Course, World } from "../models/types";
import { scoreCourseHoles } from "./holes";

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export const DEMAND_WEIGHTS = {
  courseQuality: 0.28,
  condition: 0.22,
  reputation: 0.22,
  priceAttractiveness: 0.16,
  marketing: 0.06,
  staff: 0.06,
} as const;

export const SATISFACTION_WEIGHTS = {
  playability: 0.32,
  aesthetics: 0.18,
  difficultyEase: 0.12, // uses (100 - difficulty)
  condition: 0.28,
  staff: 0.10,
} as const;

export function courseQuality(course: Course): number {
  // Hole-based quality (0..1)
  const s = scoreCourseHoles(course);
  return clamp01(s.courseQuality / 100);
}

export function priceAttractiveness(course: Course): number {
  // Sweet spot roughly 50–90 for MVP; penalize extremes.
  const p = course.baseGreenFee;
  const penalty = Math.min(1, Math.abs(p - 70) / 60); // 0 at 70, 1 at +/-60
  return 1 - penalty; // 0..1
}

export function demandBreakdown(course: Course, world: World) {
  const q = courseQuality(course); // 0..1
  const cond = course.condition; // 0..1
  const rep = world.reputation / 100; // 0..1
  const price = priceAttractiveness(course); // 0..1

  const marketing = Math.min(1, world.marketingLevel * 0.12); // 0..0.6
  const staff = Math.min(1, world.staffLevel * 0.1); // 0..0.5

  const contributions = {
    courseQuality: DEMAND_WEIGHTS.courseQuality * q,
    condition: DEMAND_WEIGHTS.condition * cond,
    reputation: DEMAND_WEIGHTS.reputation * rep,
    priceAttractiveness: DEMAND_WEIGHTS.priceAttractiveness * price,
    marketing: DEMAND_WEIGHTS.marketing * marketing,
    staff: DEMAND_WEIGHTS.staff * staff,
  };

  const base =
    contributions.courseQuality +
    contributions.condition +
    contributions.reputation +
    contributions.priceAttractiveness +
    contributions.marketing +
    contributions.staff;

  const demand = Math.max(0, Math.min(1.2, base));

  return {
    courseQuality: Math.round(q * 100),
    condition: Math.round(cond * 100),
    reputation: Math.round(rep * 100),
    priceAttractiveness: Math.round(price * 100),
    marketing: Math.round(marketing * 100),
    staff: Math.round(staff * 100),
    weights: { ...DEMAND_WEIGHTS },
    contributions,
    demandIndex: demand,
  };
}

export function demandIndex(course: Course, world: World): number {
  return demandBreakdown(course, world).demandIndex;
}

export function satisfactionScore(course: Course, world: World): number {
  return satisfactionBreakdown(course, world).satisfaction;
}

export function satisfactionBreakdown(course: Course, world: World) {
  const holeSummary = scoreCourseHoles(course);
  const complete = holeSummary.holes.filter((h) => h.isComplete && h.isValid);

  const playability =
    complete.length === 0
      ? 0
      : complete.reduce((a, h) => a + h.playabilityScore, 0) / complete.length;
  const difficulty =
    complete.length === 0
      ? 100
      : complete.reduce((a, h) => a + h.difficultyScore, 0) / complete.length;
  const aesthetics =
    complete.length === 0
      ? 0
      : complete.reduce((a, h) => a + h.aestheticsScore, 0) / complete.length;

  const condition = 100 * course.condition; // 0..100
  const staff = 100 * Math.min(1, world.staffLevel * 0.12); // 0..100

  const sat =
    SATISFACTION_WEIGHTS.playability * playability +
    SATISFACTION_WEIGHTS.aesthetics * aesthetics +
    SATISFACTION_WEIGHTS.difficultyEase * (100 - difficulty) +
    SATISFACTION_WEIGHTS.condition * condition +
    SATISFACTION_WEIGHTS.staff * staff;

  return {
    playability: Math.round(playability),
    difficulty: Math.round(difficulty),
    aesthetics: Math.round(aesthetics),
    condition: Math.round(condition),
    staff: Math.round(staff),
    weights: { ...SATISFACTION_WEIGHTS },
    satisfaction: Math.round(Math.max(0, Math.min(100, sat))),
  };
}


