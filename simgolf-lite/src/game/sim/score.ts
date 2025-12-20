import type { Course, World } from "../models/types";
import { scoreCourseHoles } from "./holes";
import { computeCourseRatingAndSlope } from "./courseRating";
import { BALANCE } from "../balance/balanceConfig";

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
  // Back-compat fallback (used when World isn't available).
  const p = course.baseGreenFee;
  const penalty = Math.min(1, Math.abs(p - 70) / 60);
  return 1 - penalty;
}

export function priceAttractivenessWithContext(course: Course, world: World): number {
  // Harsher elasticity above market, especially at low reputation.
  const p = course.baseGreenFee;
  const market = BALANCE.pricing.marketPrice;
  const base = priceAttractiveness(course);
  if (p <= market) return base;

  const over = (p - market) / market; // 0..+
  let mult = 1.0;
  if (world.reputation < BALANCE.pricing.repDiscountThreshold) mult *= BALANCE.pricing.lowRepPriceMult;
  if (world.reputation > BALANCE.pricing.repPremiumThreshold) mult *= BALANCE.pricing.highRepPriceMult;

  const harsh = Math.pow(over, BALANCE.pricing.highPriceHardness) * 0.9 * mult;
  return Math.max(0, Math.min(1, base - harsh));
}

export function demandBreakdown(course: Course, world: World) {
  const holeSummary = scoreCourseHoles(course);
  const q = clamp01(holeSummary.courseQuality / 100); // 0..1
  const cond = course.condition; // 0..1
  const rep = world.reputation / 100; // 0..1
  const price = priceAttractivenessWithContext(course, world); // 0..1

  const marketing = Math.min(1, world.marketingLevel * 0.12); // 0..0.6
  const staff = Math.min(1, world.staffLevel * 0.1); // 0..0.5

  const complete = holeSummary.holes.filter((h) => h.isComplete && h.isValid);
  const avgDiff =
    complete.length === 0 ? 100 : complete.reduce((a, h) => a + h.difficultyScore, 0) / complete.length;
  const avgAest =
    complete.length === 0 ? 0 : complete.reduce((a, h) => a + h.aestheticsScore, 0) / complete.length;
  const variety = clamp01(holeSummary.variety / 100);

  const ease = clamp01((100 - avgDiff) / 100);
  const rating = computeCourseRatingAndSlope(course);
  const courseRating01 = clamp01((rating.courseRating - 66) / 8); // higher-rated courses "unlock" core interest

  // Reputation threshold effects on demand (early penalty / late bonus)
  const repMod =
    world.reputation < BALANCE.reputation.demandPenaltyThreshold
      ? BALANCE.reputation.demandPenaltyMult
      : world.reputation > BALANCE.reputation.demandBonusThreshold
        ? BALANCE.reputation.demandBonusMult
        : 1.0;

  // Core golfers unlock gradually with reputation + course rating.
  const coreCap = clamp01((world.reputation - 45) / 35) * courseRating01; // starts at 0%
  const coreShare = clamp01(coreCap * 0.45); // cap at 45% of demand mix
  const casualShare = 1 - coreShare;

  // Segment preferences:
  // - Casual: likes ease, condition, fair prices; dislikes punishing setups (captured via ease).
  // - Core: likes aesthetics + variety + a bit of challenge; less price-sensitive.
  const casualIndexBase = clamp01(
    0.33 * q +
      0.26 * cond +
      0.14 * rep +
      0.17 * price +
      0.08 * ease +
      0.01 * marketing +
      0.01 * staff
  ) * 1.15; // allow slight >1

  const coreIndexBase = clamp01(
    0.26 * q +
      0.18 * cond +
      0.18 * rep +
      0.07 * clamp01(avgAest / 100) +
      0.07 * variety +
      0.07 * clamp01(avgDiff / 100) +
      0.05 * marketing +
      0.05 * staff +
      0.03 * price
  ) * 1.15;
  const casualIndex = Math.min(1.2, casualIndexBase * repMod);
  const coreIndex = Math.min(1.2, coreIndexBase * repMod);

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

  const blended = casualShare * casualIndex + coreShare * coreIndex;
  const demand = Math.max(0, Math.min(1.2, blended * 1.05 + base * 0.05)); // keep legacy weights barely influential

  const floor = 120;
  const floorCasual = Math.round(floor * casualShare);
  const floorCore = floor - floorCasual;
  const baseVisitorsCasual = floorCasual + Math.round(520 * casualIndex * casualShare);
  const baseVisitorsCore = floorCore + Math.round(520 * coreIndex * coreShare);
  const totalBaseVisitors = baseVisitorsCasual + baseVisitorsCore;

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
    segments: {
      casual: { share: casualShare, demandIndex: casualIndex, baseVisitors: baseVisitorsCasual },
      core: { share: coreShare, demandIndex: coreIndex, baseVisitors: baseVisitorsCore, cap: coreCap },
      totalBaseVisitors,
    },
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


