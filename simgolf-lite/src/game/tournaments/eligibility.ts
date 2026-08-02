import { PIN_ROTATIONS, type Course, type TeeSet, type World } from "../models/types";
import { computeRatingForSetup, type SetupRatingSummary } from "../sim/courseRating";
import { lastItem } from "../../utils/array";
import type {
  TournamentQualificationSnapshot,
  TournamentRequirement,
  TournamentTier,
} from "./types";
import { strategicIdentity } from "../m49/identity";
import { surfaceCareConditionSummary } from "../conditions/surfaceCare";
import { analyzePinRotation } from "../greens/pinFairness";

export interface TournamentCourseStandard {
  teeSet: TeeSet;
  rotationChoice: "easiest" | "median" | "hardest";
  minimumCompleteRotations: number;
  rating: readonly [number, number];
  slope: readonly [number, number];
}

export const TOURNAMENT_COURSE_STANDARDS: Record<TournamentTier, TournamentCourseStandard> = {
  local: { teeSet: "member", rotationChoice: "easiest", minimumCompleteRotations: 1, rating: [64, 74.9], slope: [80, 130] },
  regional: { teeSet: "championship", rotationChoice: "median", minimumCompleteRotations: 2, rating: [68, 76.9], slope: [100, 145] },
  championship: { teeSet: "championship", rotationChoice: "hardest", minimumCompleteRotations: 3, rating: [72, 80], slope: [120, 155] },
};

const qualificationCache = new WeakMap<Course, Partial<Record<TournamentTier, TournamentQualificationSnapshot>>>();

export function meetsTournamentRange(value: number, bounds: readonly [number, number]): boolean {
  return value >= bounds[0] && value <= bounds[1];
}

function rangeLabel(bounds: readonly [number, number]): string {
  return `${bounds[0].toFixed(1)}–${bounds[1].toFixed(1)}`;
}

function requirement(requirement: TournamentRequirement): TournamentRequirement {
  return requirement;
}

function requiredPinReadiness(tier: TournamentTier): number {
  return tier === "championship" ? .68 : tier === "regional" ? .55 : .4;
}

function pinFairnessRequirement(course: Course, tier: TournamentTier, pinRotation: (typeof PIN_ROTATIONS)[number]): TournamentRequirement {
  const fairness = analyzePinRotation(course, pinRotation);
  const required = requiredPinReadiness(tier);
  const worst = [...fairness.warnings].sort((left, right) => right.warning.severity - left.warning.severity)[0];
  return requirement({
    id: "pin-fairness",
    label: `Pin ${pinRotation} fairness`,
    passed: fairness.configuredHoles > 0 && fairness.legalHoles === fairness.configuredHoles && fairness.tournamentReadiness >= required,
    current: `${Math.round(fairness.tournamentReadiness * 100)}% ready; casual ${fairness.satisfactionDelta.toFixed(1)} satisfaction, +${fairness.paceMinutesDelta.toFixed(2)} min/hole`,
    required: `${Math.round(required * 100)}% setup readiness`,
    guidance: worst
      ? `${worst.holeName}: ${worst.warning.message} Move that cohort-visible warning or select another legal rotation.`
      : `Configure a legal Pin ${pinRotation} on every hole.`,
  });
}

function chooseSetup(
  setups: readonly SetupRatingSummary[],
  choice: TournamentCourseStandard["rotationChoice"],
): SetupRatingSummary | undefined {
  const sorted = [...setups].sort((a, b) =>
    a.courseRating - b.courseRating ||
    a.pinDifficultyDelta - b.pinDifficultyDelta ||
    PIN_ROTATIONS.indexOf(a.pinRotation) - PIN_ROTATIONS.indexOf(b.pinRotation)
  );
  if (choice === "easiest") return sorted[0];
  if (choice === "hardest") return lastItem(sorted);
  return sorted[Math.floor(sorted.length / 2)];
}

export function evaluateTournamentCourseQualification(
  course: Course,
  tier: TournamentTier,
): TournamentQualificationSnapshot {
  const cached = qualificationCache.get(course)?.[tier];
  if (cached) return cached;
  const standard = TOURNAMENT_COURSE_STANDARDS[tier];
  const setups = PIN_ROTATIONS.map((rotation) => computeRatingForSetup(course, standard.teeSet, rotation));
  const complete = setups.filter((setup) => setup.setupComplete);
  const chosen = chooseSetup(complete, standard.rotationChoice) ?? setups[0];
  const completeHoles = course.holes.filter((hole) => hole.tee && hole.green).length;
  const holePass = completeHoles >= 9;
  const rotationsPass = complete.length >= standard.minimumCompleteRotations;
  const routePass = !!chosen?.setupComplete;
  const ratingValue = chosen?.courseRating ?? 0;
  const slopeValue = chosen?.slope ?? 55;
  const ratingPass = routePass && meetsTournamentRange(ratingValue, standard.rating);
  const slopePass = routePass && meetsTournamentRange(slopeValue, standard.slope);
  const requirements: TournamentRequirement[] = [
    requirement({ id: "holes", label: "Open course", passed: holePass, current: `${completeHoles} complete holes`, required: "9 or 18 complete holes", guidance: "Finish at least nine playable holes." }),
    requirement({ id: "rotations", label: "Pin rotations", passed: rotationsPass, current: `${complete.length} complete`, required: `${standard.minimumCompleteRotations} complete`, guidance: `Configure valid ${standard.teeSet} tee-to-pin routes on every hole.` }),
    requirement({ id: "route", label: "Prescribed route", passed: routePass, current: routePass ? `${standard.teeSet} / Pin ${chosen.pinRotation}` : "No complete route", required: `${standard.teeSet} tee route`, guidance: `Repair every invalid ${standard.teeSet} tee-to-pin corridor.` }),
    requirement({ id: "rating", label: "Course rating", passed: ratingPass, current: ratingValue.toFixed(1), required: rangeLabel(standard.rating), guidance: ratingValue < standard.rating[0] ? "Add strategic length or difficulty to the prescribed setup." : "Reduce excessive length or difficulty in the prescribed setup." }),
    requirement({ id: "slope", label: "Slope", passed: slopePass, current: `${slopeValue}`, required: `${standard.slope[0]}–${standard.slope[1]}`, guidance: slopeValue < standard.slope[0] ? "Add challenge that affects bogey golfers without overwhelming scratch golfers." : "Ease hazards and forced carries that disproportionately punish bogey golfers." }),
    pinFairnessRequirement(course, tier, chosen?.pinRotation ?? "A"),
  ];
  if (course.surfaceCare && Object.keys(course.surfaceCare.records).length > 0) {
    const readiness = surfaceCareConditionSummary(course).tournamentReadiness;
    const requiredReadiness = tier === "championship" ? .8 : tier === "regional" ? .65 : .45;
    requirements.push(requirement({
      id: "surface-care",
      label: "Playing surfaces",
      passed: readiness >= requiredReadiness,
      current: `${Math.round(readiness * 100)}% ready`,
      required: `${Math.round(requiredReadiness * 100)}% ready`,
      guidance: "Restore mowing, moisture, turf health, and any repair-required local surfaces.",
    }));
  }
  const result: TournamentQualificationSnapshot = {
    eligible: requirements.every((item) => item.passed),
    teeSet: standard.teeSet,
    pinRotation: chosen?.pinRotation ?? "A",
    rating: ratingValue,
    slope: slopeValue,
    effectiveYardage: chosen?.effectiveYardage ?? 0,
    completeRotations: complete.map((setup) => setup.pinRotation),
    requirements,
    blockingReasons: requirements.filter((item) => !item.passed).map((item) => `${item.label}: ${item.current}; requires ${item.required}. ${item.guidance}`),
  };
  const courseCache = qualificationCache.get(course) ?? {};
  courseCache[tier] = result;
  qualificationCache.set(course, courseCache);
  return result;
}

export function revalidatePrescribedTournamentSetup(
  course: Course,
  tier: TournamentTier,
  teeSet: TeeSet,
  pinRotation: (typeof PIN_ROTATIONS)[number],
): TournamentQualificationSnapshot {
  const base = evaluateTournamentCourseQualification(course, tier);
  const standard = TOURNAMENT_COURSE_STANDARDS[tier];
  const setup = computeRatingForSetup(course, teeSet, pinRotation);
  const routePass = setup.setupComplete;
  const ratingPass = routePass && meetsTournamentRange(setup.courseRating, standard.rating);
  const slopePass = routePass && meetsTournamentRange(setup.slope, standard.slope);
  const replacements: Partial<Record<TournamentRequirement["id"], TournamentRequirement>> = {
    route: requirement({ id: "route", label: "Prescribed route", passed: routePass, current: routePass ? `${teeSet} / Pin ${pinRotation}` : `${teeSet} / Pin ${pinRotation} is invalid`, required: `${teeSet} tee route`, guidance: `Restore the booked ${teeSet} tee-to-Pin ${pinRotation} route on every hole.` }),
    rating: requirement({ id: "rating", label: "Course rating", passed: ratingPass, current: setup.courseRating.toFixed(1), required: rangeLabel(standard.rating), guidance: setup.courseRating < standard.rating[0] ? "Add strategic length or difficulty to the booked setup." : "Reduce excessive length or difficulty in the booked setup." }),
    slope: requirement({ id: "slope", label: "Slope", passed: slopePass, current: `${setup.slope}`, required: `${standard.slope[0]}–${standard.slope[1]}`, guidance: setup.slope < standard.slope[0] ? "Add balanced challenge to the booked setup." : "Ease hazards that disproportionately punish bogey golfers." }),
    "pin-fairness": pinFairnessRequirement(course, tier, pinRotation),
  };
  const requirements = base.requirements.map((item) => replacements[item.id] ?? item);
  return {
    ...base,
    eligible: requirements.every((item) => item.passed),
    teeSet,
    pinRotation,
    rating: setup.courseRating,
    slope: setup.slope,
    effectiveYardage: setup.effectiveYardage,
    requirements,
    blockingReasons: requirements.filter((item) => !item.passed).map((item) => `${item.label}: ${item.current}; requires ${item.required}. ${item.guidance}`),
  };
}

export function evaluateTournamentEligibility(args: {
  course: Course;
  world: World;
  tier: TournamentTier;
  currentDay: number;
  daysAhead: number;
  minReputation: number;
  bookingCost: number;
}): TournamentQualificationSnapshot {
  const courseResult = evaluateTournamentCourseQualification(args.course, args.tier);
  const absolute = (Math.max(1, args.world.week) - 1) * 7 + args.currentDay + Math.max(1, Math.floor(args.daysAhead));
  const targetWeek = Math.floor(absolute / 7) + 1;
  const targetDay = absolute % 7;
  const events = args.world.tournaments?.events ?? [];
  const commercial: TournamentRequirement[] = [
    requirement({ id: "reputation", label: "Reputation", passed: args.world.reputation >= args.minReputation, current: `${Math.round(args.world.reputation)}`, required: `${args.minReputation}`, guidance: "Improve golfer satisfaction and complete successful rounds." }),
    requirement({ id: "deposit", label: "Hosting deposit", passed: args.world.cash >= args.bookingCost, current: `$${Math.floor(args.world.cash).toLocaleString("en-US")}`, required: `$${args.bookingCost.toLocaleString("en-US")}`, guidance: "Build enough cash reserves to cover the non-refundable deposit." }),
    requirement({ id: "date", label: "Event date", passed: args.daysAhead >= 1, current: `${args.daysAhead} days ahead`, required: "A future date", guidance: "Choose tomorrow or a later date." }),
    requirement({ id: "calendar", label: "Calendar", passed: !events.some((event) => event.status === "scheduled" && event.scheduledWeek === targetWeek && event.scheduledDay === targetDay), current: `Week ${targetWeek}, day ${targetDay + 1}`, required: "An open date", guidance: "Choose a date without another scheduled tournament." }),
  ];
  const requirements = [...commercial, ...courseResult.requirements];
  const identity = strategicIdentity(args.course, args.world);
  return {
    ...courseResult,
    eligible: requirements.every((item) => item.passed),
    requirements,
    blockingReasons: requirements.filter((item) => !item.passed).map((item) => `${item.label}: ${item.current}; requires ${item.required}. ${item.guidance}`),
    strategicIdentity: {
      strategicScore: identity.strategicScore,
      broadAppeal: identity.broadAppeal,
      nicheIdentity: identity.nicheIdentity,
      supportedSegments: identity.supportedSegments,
      tournamentFieldFit: identity.tournamentFieldFit,
    },
  };
}
