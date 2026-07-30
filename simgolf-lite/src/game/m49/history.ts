import type { World } from "../models/types";
import { basePriceElasticity, baseWillingnessToPay } from "./experience";
import { m49MobilityCauses } from "./mobility";
import type { M49CourseHistory, M49EconomyState, M49ObservedRound, M49SegmentHistory } from "./types";
import { M49_ECONOMY_VERSION, M49_MAX_COURSES, M49_MAX_HOLE_EVIDENCE, M49_MAX_SEGMENT_ROUNDS, M49_SEGMENTS } from "./types";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

function emptySegment(segment: M49ObservedRound["segment"]): M49SegmentHistory {
  return {
    observedRounds: 0,
    completedRounds: 0,
    evidenceWeight: 0,
    averageValue: .58,
    averageSatisfaction: 65,
    returnRate: .55,
    recommendationRate: .5,
    churnRate: .45,
    willingnessToPay: baseWillingnessToPay(segment),
    priceElasticity: basePriceElasticity(segment),
    lastObservedWeek: 0,
    holeEvidence: {},
  };
}

export function emptyM49State(): M49EconomyState {
  return { version: M49_ECONOMY_VERSION, courses: {}, marketingPromises: [] };
}

function validNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSegment(raw: unknown, segment: M49ObservedRound["segment"]): M49SegmentHistory {
  const base = emptySegment(segment);
  if (!raw || typeof raw !== "object") return base;
  const candidate = raw as Partial<M49SegmentHistory>;
  const holeEvidence: M49SegmentHistory["holeEvidence"] = {};
  if (candidate.holeEvidence && typeof candidate.holeEvidence === "object") {
    for (const [holeId, value] of Object.entries(candidate.holeEvidence).slice(0, M49_MAX_HOLE_EVIDENCE)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Partial<M49SegmentHistory["holeEvidence"][string]>;
      const causes: Record<string, number> = {};
      if (row.causes && typeof row.causes === "object") {
        for (const [cause, count] of Object.entries(row.causes).slice(0, 24)) {
          if (typeof count === "number" && Number.isFinite(count) && count > 0) causes[cause.slice(0, 80)] = clampInt(count, 0, M49_MAX_SEGMENT_ROUNDS);
        }
      }
      holeEvidence[holeId.slice(0, 120)] = {
        observations: clampInt(validNumber(row.observations, 0), 0, M49_MAX_SEGMENT_ROUNDS),
        averageSatisfaction: clamp(validNumber(row.averageSatisfaction, 65), 0, 100),
        frustrationRate: clamp(validNumber(row.frustrationRate, .45)),
        causes,
      };
    }
  }
  const mobility = normalizeMobility(candidate.mobility);
  return {
    observedRounds: clampInt(validNumber(candidate.observedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    completedRounds: clampInt(validNumber(candidate.completedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    evidenceWeight: clamp(validNumber(candidate.evidenceWeight, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    averageValue: clamp(validNumber(candidate.averageValue, base.averageValue)),
    averageSatisfaction: clamp(validNumber(candidate.averageSatisfaction, base.averageSatisfaction), 0, 100),
    returnRate: clamp(validNumber(candidate.returnRate, base.returnRate)),
    recommendationRate: clamp(validNumber(candidate.recommendationRate, base.recommendationRate)),
    churnRate: clamp(validNumber(candidate.churnRate, base.churnRate)),
    willingnessToPay: clamp(validNumber(candidate.willingnessToPay, base.willingnessToPay), 10, 500),
    priceElasticity: clamp(validNumber(candidate.priceElasticity, base.priceElasticity), .1, 4),
    lastObservedWeek: clampInt(validNumber(candidate.lastObservedWeek, 0), 0, 10_000_000),
    ...(mobility ? { mobility } : {}),
    holeEvidence,
  };
}

function normalizeMobility(raw: unknown): M49SegmentHistory["mobility"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<NonNullable<M49SegmentHistory["mobility"]>>;
  const observedRounds = clampInt(validNumber(value.observedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS);
  // Do not materialize this object for old M49 histories: its absence is the
  // explicit statement that no rental/path outcome was observed.
  if (!observedRounds) return undefined;
  const causes: Record<string, number> = {};
  if (value.causes && typeof value.causes === "object") for (const [cause, count] of Object.entries(value.causes).slice(0, 24)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) causes[cause.slice(0, 80)] = clampInt(count, 0, M49_MAX_SEGMENT_ROUNDS);
  }
  return {
    observedRounds,
    walkingRounds: clampInt(validNumber(value.walkingRounds, 0), 0, observedRounds),
    pushcartRounds: clampInt(validNumber(value.pushcartRounds, 0), 0, observedRounds),
    ridingCartRounds: clampInt(validNumber(value.ridingCartRounds, 0), 0, observedRounds),
    rentalRounds: clampInt(validNumber(value.rentalRounds, 0), 0, observedRounds),
    stockoutFallbacks: clampInt(validNumber(value.stockoutFallbacks, 0), 0, observedRounds),
    restrictions: clampInt(validNumber(value.restrictions, 0), 0, observedRounds),
    tournamentPolicyRounds: clampInt(validNumber(value.tournamentPolicyRounds, 0), 0, observedRounds),
    averageWalkingBurdenMinutes: clamp(validNumber(value.averageWalkingBurdenMinutes, 0), 0, 24 * 60),
    averageActualTravelMinutes: clamp(validNumber(value.averageActualTravelMinutes, 0), 0, 24 * 60),
    averagePaceMinutes: clamp(validNumber(value.averagePaceMinutes, 0), 0, 24 * 60),
    averageValue: clamp(validNumber(value.averageValue, .5)),
    causes,
  };
}

function normalizeCourse(raw: unknown): M49CourseHistory | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<M49CourseHistory>;
  const segments: M49CourseHistory["segments"] = {};
  if (candidate.segments && typeof candidate.segments === "object") {
    for (const segment of M49_SEGMENTS) {
      if (candidate.segments[segment]) segments[segment] = normalizeSegment(candidate.segments[segment], segment);
    }
  }
  return {
    version: M49_ECONOMY_VERSION,
    observedRounds: clampInt(validNumber(candidate.observedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    completedRounds: clampInt(validNumber(candidate.completedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    lastObservedWeek: clampInt(validNumber(candidate.lastObservedWeek, 0), 0, 10_000_000),
    segments,
  };
}

export function normalizeM49State(raw: unknown): M49EconomyState {
  if (!raw || typeof raw !== "object") return emptyM49State();
  const candidate = raw as Partial<M49EconomyState>;
  if (candidate.version !== M49_ECONOMY_VERSION || !candidate.courses || typeof candidate.courses !== "object") return emptyM49State();
  const courses: M49EconomyState["courses"] = {};
  for (const [courseId, value] of Object.entries(candidate.courses).slice(0, M49_MAX_COURSES)) {
    const normalized = normalizeCourse(value);
    if (normalized) courses[courseId.slice(0, 120)] = normalized;
  }
  const marketingPromises = Array.isArray(candidate.marketingPromises)
    ? candidate.marketingPromises.filter((promise) => promise && typeof promise.id === "string" && typeof promise.courseId === "string" && typeof promise.segment === "string" && Number.isFinite(promise.reach) && Number.isFinite(promise.cost)).slice(-24).map((promise) => ({
      ...promise,
      reach: clamp(validNumber(promise.reach, 0), 0, 1),
      cost: Math.max(0, validNumber(promise.cost, 0)),
      credibility: clamp(validNumber(promise.credibility, .5)),
      disappointmentRisk: clamp(validNumber(promise.disappointmentRisk, .5)),
      playedRounds: clampInt(validNumber(promise.playedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
      disappointedRounds: clampInt(validNumber(promise.disappointedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    }))
    : [];
  return { version: M49_ECONOMY_VERSION, courses, marketingPromises };
}

export function m49CourseHistory(world: World, courseId: string): M49CourseHistory | undefined {
  return normalizeM49State(world.m49).courses[courseId];
}

function smooth(previous: number, sample: number, observations: number, min = 0, max = 1): number {
  // A new course has useful prior belief from M48. Early bad luck changes it,
  // but cannot erase the entire strategic signal in one round.
  const alpha = Math.min(.34, 1 / Math.max(3, observations + 2));
  return Math.max(min, Math.min(max, previous + (sample - previous) * alpha));
}

function mergeHoleEvidence(history: M49SegmentHistory, observation: M49ObservedRound): M49SegmentHistory["holeEvidence"] {
  const next = { ...history.holeEvidence };
  for (const hole of observation.holeEvidence.slice(0, M49_MAX_HOLE_EVIDENCE)) {
    if (!next[hole.holeId] && Object.keys(next).length >= M49_MAX_HOLE_EVIDENCE) continue;
    const current = next[hole.holeId] ?? { observations: 0, averageSatisfaction: 65, frustrationRate: .45, causes: {} };
    const observations = current.observations + 1;
    const causes = { ...current.causes };
    for (const cause of hole.causes.slice(0, 12)) causes[cause] = Math.min(M49_MAX_SEGMENT_ROUNDS, (causes[cause] ?? 0) + 1);
    next[hole.holeId] = {
      observations: Math.min(M49_MAX_SEGMENT_ROUNDS, observations),
      averageSatisfaction: smooth(current.averageSatisfaction, hole.satisfaction, observations, 0, 100),
      frustrationRate: smooth(current.frustrationRate, hole.outcome === "frustrated" || hole.outcome === "unfair" ? 1 : 0, observations),
      causes,
    };
  }
  return next;
}

function mergeMobilityEvidence(current: M49SegmentHistory["mobility"], observation: M49ObservedRound): M49SegmentHistory["mobility"] {
  const evidence = observation.mobility;
  if (!evidence || evidence.source !== "observed") return current;
  const previous = current ?? {
    observedRounds: 0, walkingRounds: 0, pushcartRounds: 0, ridingCartRounds: 0, rentalRounds: 0,
    stockoutFallbacks: 0, restrictions: 0, tournamentPolicyRounds: 0, averageWalkingBurdenMinutes: 0,
    averageActualTravelMinutes: 0, averagePaceMinutes: 0, averageValue: .5, causes: {},
  };
  const observations = previous.observedRounds + 1;
  const causes = { ...previous.causes };
  for (const item of m49MobilityCauses(evidence)) causes[item] = Math.min(M49_MAX_SEGMENT_ROUNDS, (causes[item] ?? 0) + 1);
  return {
    observedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, observations),
    walkingRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, previous.walkingRounds + (evidence.mode === "walk" ? 1 : 0)),
    pushcartRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, previous.pushcartRounds + (evidence.mode === "pushcart" ? 1 : 0)),
    ridingCartRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, previous.ridingCartRounds + (evidence.mode === "riding_cart" ? 1 : 0)),
    rentalRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, previous.rentalRounds + (evidence.rentalProvided ? 1 : 0)),
    stockoutFallbacks: Math.min(M49_MAX_SEGMENT_ROUNDS, previous.stockoutFallbacks + (evidence.stockoutFallback ? 1 : 0)),
    restrictions: Math.min(M49_MAX_SEGMENT_ROUNDS, previous.restrictions + (evidence.restricted ? 1 : 0)),
    tournamentPolicyRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, previous.tournamentPolicyRounds + (evidence.tournamentPolicy ? 1 : 0)),
    averageWalkingBurdenMinutes: smooth(previous.averageWalkingBurdenMinutes, evidence.walkingBurdenMinutes, observations, 0, 24 * 60),
    averageActualTravelMinutes: smooth(previous.averageActualTravelMinutes, evidence.actualTravelMinutes, observations, 0, 24 * 60),
    averagePaceMinutes: smooth(previous.averagePaceMinutes, evidence.paceMinutes, observations, 0, 24 * 60),
    averageValue: smooth(previous.averageValue, evidence.value, observations),
    causes,
  };
}

function mergeObservation(previous: M49SegmentHistory | undefined, observation: M49ObservedRound, week: number): M49SegmentHistory {
  const current = previous ?? emptySegment(observation.segment);
  const observations = current.observedRounds + 1;
  const completed = current.completedRounds + (observation.completed ? 1 : 0);
  const weight = Math.min(M49_MAX_SEGMENT_ROUNDS, current.evidenceWeight + (observation.completed ? 1 : .5));
  return {
    ...current,
    observedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, observations),
    completedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, completed),
    evidenceWeight: weight,
    averageValue: smooth(current.averageValue, observation.valueReceived, observations),
    averageSatisfaction: smooth(current.averageSatisfaction, observation.satisfaction, observations, 0, 100),
    returnRate: smooth(current.returnRate, observation.completed && observation.returnIntent ? 1 : 0, observations),
    recommendationRate: smooth(current.recommendationRate, observation.completed && observation.recommend ? 1 : 0, observations),
    churnRate: smooth(current.churnRate, observation.churnRisk, observations),
    willingnessToPay: smooth(current.willingnessToPay, observation.willingnessToPay, observations, 10, 500),
    priceElasticity: smooth(current.priceElasticity, observation.priceElasticity, observations, .1, 4),
    lastObservedWeek: Math.max(current.lastObservedWeek, week),
    mobility: mergeMobilityEvidence(current.mobility, observation),
    holeEvidence: mergeHoleEvidence(current, observation),
  };
}

/** Persist only bounded observed rounds. An empty observation set is a no-op. */
export function recordM49Observations(world: World, observations: readonly M49ObservedRound[], week: number): World {
  if (!observations.length) return world;
  const state = normalizeM49State(world.m49);
  const courses = { ...state.courses };
  for (const observation of observations.slice(0, M49_MAX_SEGMENT_ROUNDS)) {
    if (!observation || observation.version !== M49_ECONOMY_VERSION || !observation.courseId) continue;
    const current = courses[observation.courseId] ?? { version: M49_ECONOMY_VERSION, observedRounds: 0, completedRounds: 0, lastObservedWeek: 0, segments: {} };
    const segment = mergeObservation(current.segments[observation.segment], observation, week);
    courses[observation.courseId] = {
      ...current,
      observedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, current.observedRounds + 1),
      completedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, current.completedRounds + (observation.completed ? 1 : 0)),
      lastObservedWeek: Math.max(current.lastObservedWeek, week),
      segments: { ...current.segments, [observation.segment]: segment },
    };
  }
  const marketingPromises = (state.marketingPromises ?? []).map((promise) => {
    const matches = observations.filter((observation) => observation.courseId === promise.courseId && observation.segment === promise.segment && week >= promise.createdWeek);
    if (!matches.length) return promise;
    const disappointed = matches.filter((observation) => !observation.completed || observation.valueReceived < .55).length;
    return {
      ...promise,
      playedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, promise.playedRounds + matches.length),
      disappointedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, promise.disappointedRounds + disappointed),
      credibility: clamp(promise.credibility - disappointed * .035 + (matches.length - disappointed) * .008),
      disappointmentRisk: clamp(promise.disappointmentRisk + disappointed * .028 - (matches.length - disappointed) * .006),
    };
  });
  return { ...world, m49: { version: M49_ECONOMY_VERSION, courses, marketingPromises } };
}

export function m49ReputationDelta(observations: readonly M49ObservedRound[]): { delta: number; observedRounds: number } {
  const completed = observations.filter((observation) => observation.version === M49_ECONOMY_VERSION && observation.completed && observation.holesPlayed > 0);
  if (!completed.length) return { delta: 0, observedRounds: 0 };
  const sentiment = completed.reduce((sum, observation) => {
    const satisfaction = (observation.satisfaction - 65) / 35;
    const loyalty = observation.returnIntent ? .18 : -.18;
    const recommendation = observation.recommend ? .16 : -.16;
    return sum + clamp(satisfaction * .68 + loyalty + recommendation - observation.churnRisk * .12, -1, 1);
  }, 0) / completed.length;
  return { delta: Math.max(-2.5, Math.min(2.5, sentiment * 1.8)), observedRounds: completed.length };
}
