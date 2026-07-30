import type { Course } from "../models/types";
import type { Golfer } from "../live/types";
import { buildStrategicPortfolio } from "../architecture/portfolio";
import type { M48CohortId } from "../architecture/m48Types";
import type { M49ObservedRound, M49HoleObservation } from "./types";
import { m49MobilityCauses, m49ObservedMobilityValue } from "./mobility";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

const STRATEGIC_COHORT: Record<Golfer["archetype"], M48CohortId> = {
  pro: "power",
  lowHandicap: "accuracy",
  casual: "casual",
  senior: "recovery",
  junior: "shortGame",
  tourist: "casual",
};

const BASE_WILLINGNESS_TO_PAY: Record<Golfer["archetype"], number> = {
  pro: 125,
  lowHandicap: 105,
  casual: 58,
  senior: 68,
  junior: 42,
  tourist: 92,
};

const BASE_PRICE_ELASTICITY: Record<Golfer["archetype"], number> = {
  pro: .42,
  lowHandicap: .68,
  casual: 1.42,
  senior: 1.08,
  junior: 1.7,
  tourist: .86,
};

const strategicCache = new WeakMap<Course, ReturnType<typeof buildStrategicPortfolio>>();

function strategicPortfolio(course: Course) {
  const cached = strategicCache.get(course);
  if (cached) return cached;
  const portfolio = buildStrategicPortfolio(course, { samplesPerOption: 1, seed: 494001 });
  strategicCache.set(course, portfolio);
  return portfolio;
}

function strategicFit(course: Course, golfer: Golfer): number {
  const portfolio = strategicPortfolio(course);
  const cohort = STRATEGIC_COHORT[golfer.archetype];
  const holeIds = new Set(golfer.holeIds ?? []);
  const holes = portfolio.evaluation.holes.filter((hole) => !holeIds.size || holeIds.has(hole.holeId));
  const fits = holes
    .map((hole) => hole.cohorts.find((candidate) => candidate.cohortId === cohort)?.viability ?? 0)
    .filter((value) => Number.isFinite(value));
  const localFit = fits.length ? fits.reduce((sum, value) => sum + value, 0) / fits.length / 100 : .5;
  const portfolioFit = portfolio.summary.total / 100;
  return clamp(localFit * .72 + portfolioFit * .28);
}

function causeList(golfer: Golfer, condition: number, paceDelayMinutes: number, hospitalityDelayMinutes: number): string[] {
  const causes = new Set<string>();
  for (const reaction of golfer.holeReactions ?? []) {
    for (const fact of reaction.facts) causes.add(`${fact.code}:${fact.detail}`);
    if (reaction.outcome === "unfair") causes.add("hole:forced-mismatch");
    if (reaction.outcome === "frustrated") causes.add("hole:frustration");
  }
  if (condition < .55) causes.add("condition:below-55");
  if (paceDelayMinutes >= 12) causes.add("pace:meaningful-delay");
  if (hospitalityDelayMinutes >= 8) causes.add("hospitality:service-delay");
  return [...causes].slice(0, 24);
}

function holeEvidence(golfer: Golfer): M49HoleObservation[] {
  const holeIds = golfer.holeIds ?? [];
  const observations: M49HoleObservation[] = [];
  for (let index = 0; index < Math.min(holeIds.length, golfer.holeStrokes.length, 72); index++) {
    const reaction = golfer.holeReactions?.[index];
    observations.push({
      holeId: holeIds[index] ?? `hole-${index + 1}`,
      expectedScore: round(golfer.holePlans?.[index]?.expectedScore ?? (golfer.holePar[index] ?? 4) + 1, 2),
      actualScore: golfer.holeStrokes[index] ?? 0,
      satisfaction: round(reaction?.satisfaction ?? golfer.mood * 100, 2),
      outcome: reaction?.outcome ?? "neutral",
      causes: (reaction?.facts ?? []).map((fact) => `${fact.code}:${fact.detail}`).slice(0, 12),
    });
  }
  return observations;
}

/** Convert one completed or abandoned round into bounded, explainable evidence. */
export function observeM49Round(args: {
  course: Course;
  golfer: Golfer;
  courseId: string;
  greenFee: number;
  completed: boolean;
  returnIntent: boolean;
  recommend: boolean;
  condition: number;
  mobility?: Omit<NonNullable<M49ObservedRound["mobility"]>, "value">;
}): M49ObservedRound {
  const { golfer } = args;
  const holes = holeEvidence(golfer);
  const expectedScore = golfer.holePlans?.length
    ? golfer.holePlans.reduce((sum, plan) => sum + plan.expectedScore, 0)
    : golfer.holePar.reduce((sum, par) => sum + par + 1, 0);
  const actualScore = golfer.strokes || golfer.holeStrokes.slice(0, golfer.scoredHoles).reduce((sum, score) => sum + score, 0);
  const fit = strategicFit(args.course, golfer);
  const paceDelayMinutes = golfer.waitMinutes ?? 0;
  const hospitalityDelayMinutes = golfer.hospitalityDelay ?? 0;
  const paceValue = clamp(1 - paceDelayMinutes / 90);
  const hospitalityValue = clamp(1 - hospitalityDelayMinutes / 45);
  const priceAnchor = BASE_WILLINGNESS_TO_PAY[golfer.archetype];
  const mobility = args.mobility
    ? { ...args.mobility, value: m49ObservedMobilityValue(golfer.archetype, args.mobility) }
    : undefined;
  const mobilityDelta = mobility ? (mobility.value - .5) : 0;
  const observedSatisfaction = clamp(golfer.mood + mobilityDelta * .16);
  const pricePressure = Math.max(0, args.greenFee / Math.max(1, priceAnchor) - .72);
  const valueReceived = clamp(
    observedSatisfaction * .42 + fit * .3 + args.condition * .14 + paceValue * .08 + hospitalityValue * .06 + mobilityDelta * .12 - pricePressure * .12,
  );
  const priceElasticity = BASE_PRICE_ELASTICITY[golfer.archetype] * (1.22 - valueReceived * .42);
  const willingnessToPay = clamp(
    (priceAnchor * (.64 + valueReceived * .5 + mobilityDelta * .1) * (args.returnIntent ? 1.04 : .96)) / 150,
    .18,
    1.5,
  ) * 150;
  const causes = causeList(golfer, args.condition, paceDelayMinutes, hospitalityDelayMinutes);
  if (mobility) causes.push(...m49MobilityCauses(mobility));
  if (args.greenFee > willingnessToPay) causes.push("price:above-observed-willingness");
  if (fit < .45) causes.push("fit:unsupported-strength");
  const returnIntent = mobility && mobility.value < .28 ? false : args.returnIntent || (!!mobility && mobility.value >= .78 && observedSatisfaction >= .68);
  const recommend = mobility && mobility.value < .34 ? false : args.recommend || (!!mobility && mobility.value >= .84 && observedSatisfaction >= .76);

  return {
    version: 1,
    id: `m49-round-${args.courseId}-${golfer.id}-${golfer.currentHoleId ?? "complete"}`,
    courseId: args.courseId,
    segment: golfer.archetype,
    ...(golfer.tournamentId ? { tournamentId: golfer.tournamentId } : {}),
    completed: args.completed,
    holesPlayed: Math.max(0, golfer.scoredHoles),
    holesTotal: golfer.holePar.length,
    expectedScore: round(expectedScore, 2),
    actualScore: round(actualScore, 2),
    satisfaction: round(observedSatisfaction * 100, 2),
    condition: round(args.condition, 3),
    greenFee: Math.max(0, round(args.greenFee, 2)),
    strategicFit: round(fit),
    valueReceived: round(valueReceived),
    willingnessToPay: round(willingnessToPay, 2),
    priceElasticity: round(priceElasticity, 3),
    returnIntent,
    recommend,
    churnRisk: round(clamp(1 - valueReceived + (args.completed ? 0 : .18) + (paceDelayMinutes > 30 ? .12 : 0) + Math.max(0, .5 - (mobility?.value ?? .5)) * .24)),
    paceDelayMinutes: round(paceDelayMinutes, 2),
    hospitalityDelayMinutes: round(hospitalityDelayMinutes, 2),
    ...(mobility ? { mobility } : {}),
    holeEvidence: holes,
    causes: [...new Set(causes)].slice(0, 28),
  };
}

export function strategicCohortForSegment(segment: Golfer["archetype"]): M48CohortId {
  return STRATEGIC_COHORT[segment];
}

export function baseWillingnessToPay(segment: Golfer["archetype"]): number {
  return BASE_WILLINGNESS_TO_PAY[segment];
}

export function basePriceElasticity(segment: Golfer["archetype"]): number {
  return BASE_PRICE_ELASTICITY[segment];
}
