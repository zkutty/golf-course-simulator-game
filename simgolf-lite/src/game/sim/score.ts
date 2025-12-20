import type { Course, World } from "../models/types";
import { scoreCourseHoles } from "./holes";

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

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

  const base =
    0.28 * q +
    0.22 * cond +
    0.22 * rep +
    0.16 * price +
    0.06 * marketing +
    0.06 * staff;

  const demand = Math.max(0, Math.min(1.2, base));

  return {
    courseQuality: Math.round(q * 100),
    condition: Math.round(cond * 100),
    reputation: Math.round(rep * 100),
    priceAttractiveness: Math.round(price * 100),
    marketing: Math.round(marketing * 100),
    staff: Math.round(staff * 100),
    demandIndex: demand,
  };
}

export function demandIndex(course: Course, world: World): number {
  return demandBreakdown(course, world).demandIndex;
}

export function satisfactionScore(course: Course, world: World): number {
  const q = courseQuality(course);
  const cond = course.condition;
  const staff = Math.min(1, world.staffLevel * 0.12);

  // 0..100
  const s = 100 * (0.45 * q + 0.45 * cond + 0.1 * staff);
  return Math.max(0, Math.min(100, s));
}

export function satisfactionBreakdown(course: Course, world: World) {
  const playability = courseQuality(course); // 0..1
  const cond = course.condition; // 0..1
  const staff = Math.min(1, world.staffLevel * 0.12);

  const s = 100 * (0.45 * playability + 0.45 * cond + 0.1 * staff);
  const sat = Math.max(0, Math.min(100, s));

  return {
    playability: Math.round(playability * 100),
    condition: Math.round(cond * 100),
    staff: Math.round(staff * 100),
    satisfaction: Math.round(sat),
  };
}


