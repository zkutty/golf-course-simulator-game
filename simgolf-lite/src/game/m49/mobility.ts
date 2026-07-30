import type { Course } from "../models/types";
import type { Golfer, LiveState } from "../live/types";
import { normalizeM51CourseMobilityState } from "../m51/mobility";
import type { M49ObservedMobilityEvidence, M49SegmentMobilityHistory } from "./types";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

type Segment = Golfer["archetype"];

const NEEDS: Record<Segment, { walking: number; pushcart: number; riding: number; price: number; pace: number; service: number }> = {
  pro: { walking: .35, pushcart: .14, riding: .34, price: .22, pace: .92, service: .3 },
  lowHandicap: { walking: .42, pushcart: .2, riding: .38, price: .42, pace: .82, service: .35 },
  casual: { walking: .68, pushcart: .42, riding: .46, price: .92, pace: .52, service: .46 },
  senior: { walking: .98, pushcart: .48, riding: .9, price: .62, pace: .58, service: .54 },
  junior: { walking: .52, pushcart: .26, riding: .22, price: 1, pace: .38, service: .32 },
  tourist: { walking: .74, pushcart: .3, riding: .7, price: .62, pace: .66, service: .82 },
};

function courseWalkingBurden(course: Course): number {
  const holes = course.holes.filter((hole) => hole.tee && hole.green);
  if (!holes.length) return .5;
  const distance = holes.reduce((sum, hole) => sum + Math.hypot(hole.green!.x - hole.tee!.x, hole.green!.y - hole.tee!.y), 0);
  return clamp(distance / Math.max(1, holes.length) / 42);
}

/** Current geometry and offer availability, useful for expectation only. */
export function m49CurrentMobilitySupport(course: Course, segment: Segment) {
  const state = normalizeM51CourseMobilityState(course.m51, course);
  const developed = course.tiles.filter((terrain) => terrain !== "rough" && terrain !== "deep_rough").length;
  const pathSupport = clamp(course.tiles.filter((terrain) => terrain === "path").length / Math.max(1, developed) * 5);
  const burden = courseWalkingBurden(course);
  const needs = NEEDS[segment];
  const operational = (mode: "pushcart" | "riding_cart") => Object.values(state.cartRentals).some((rental) =>
    rental.products[mode].enabled && Object.values(state.fleet).some((unit) => unit.buildingId === rental.buildingId && unit.mode === mode && unit.state === "available" && unit.condition > .15),
  );
  const pushcart = operational("pushcart");
  const riding = operational("riding_cart");
  const price = (mode: "pushcart" | "riding_cart") => {
    const offers = Object.values(state.cartRentals).filter((rental) => rental.products[mode].enabled).map((rental) => rental.products[mode].price);
    return offers.length ? Math.min(...offers) : 0;
  };
  const walking = clamp((1 - burden) * .58 + pathSupport * .42);
  const pushValue = pushcart ? clamp(.42 + burden * .28 + pathSupport * .14 - price("pushcart") / 170 * needs.price) : 0;
  const ridingValue = riding ? clamp(.38 + burden * .3 + pathSupport * .2 - price("riding_cart") / 220 * needs.price) : 0;
  const score = clamp(Math.max(
    walking * (1 + needs.walking * .22),
    pushValue * (1 + needs.pushcart * .2),
    ridingValue * (1 + needs.riding * .2),
  ));
  const supportedBy = [
    ...(pathSupport >= .16 ? ["paths:current-geometry"] : []),
    ...(pushcart ? ["pushcart:available-now"] : []),
    ...(riding ? ["riding-cart:available-now"] : []),
  ];
  const missing = [
    ...(pathSupport < .16 ? ["paths"] : []),
    ...(needs.pushcart >= .3 && !pushcart ? ["pushcart-rental"] : []),
    ...(needs.riding >= .45 && !riding ? ["riding-cart-rental"] : []),
  ];
  return { score: round(score), pathSupport: round(pathSupport), walkingBurden: round(burden), pushcart, riding, supportedBy, missing };
}

function cause(evidence: M49ObservedMobilityEvidence): string[] {
  return [
    `mobility:mode-${evidence.mode}`,
    ...(evidence.rentalProvided ? ["mobility:rental-completed"] : []),
    ...(evidence.stockoutFallback ? ["mobility:stockout-fallback"] : []),
    ...(evidence.restricted ? ["mobility:restriction"] : []),
    ...(evidence.tournamentPolicy ? ["mobility:tournament-walking-policy"] : []),
    ...(evidence.walkingFallbackMinutes > 2 ? ["mobility:walking-fallback"] : []),
    ...(evidence.value < .42 ? ["mobility:disappointment"] : []),
  ];
}

/** Convert a finished live assignment into M49 evidence. It never reads a forecast. */
export function observedM49MobilityEvidence(args: {
  live: LiveState;
  golfer: Golfer;
  paceMinutes: number;
}): Omit<M49ObservedMobilityEvidence, "value"> | undefined {
  const assignment = args.live.m51?.assignments.find((row) => row.id === args.golfer.mobilityAssignmentId);
  const selection = assignment && args.live.m51?.selections.find((row) => row.id === assignment.selectionId);
  if (!assignment || !selection) return undefined;
  return {
    source: "observed",
    mode: selection.mode,
    rentalProvided: selection.mode !== "walk" && assignment.fleetUnitIds.length > 0,
    walkingBurdenMinutes: Math.max(0, selection.predictedWalkingMinutes),
    actualTravelMinutes: Math.max(0, args.golfer.mobilityActualTravelMinutes ?? assignment.actualTravelMinutes),
    paceMinutes: Math.max(0, args.paceMinutes),
    price: Math.max(0, selection.perGolferFee),
    serviceDelayMinutes: Math.max(0, assignment.serviceDelayMinutes),
    walkingFallbackMinutes: Math.max(0, args.golfer.mobilityWalkingFallbackMinutes ?? assignment.walkingFallbackMinutes),
    stockoutFallback: selection.reason === "stockout_fallback",
    restricted: selection.reason === "weather_fallback" || selection.reason === "policy_fallback",
    tournamentPolicy: selection.reason === "policy_fallback",
  };
}

/** Segment-sensitive value of actual mobility; not a prediction or capacity score. */
export function m49ObservedMobilityValue(segment: Segment, evidence: Omit<M49ObservedMobilityEvidence, "value">): number {
  const needs = NEEDS[segment];
  const burden = clamp(evidence.walkingBurdenMinutes / 180);
  const saved = clamp((evidence.walkingBurdenMinutes - evidence.actualTravelMinutes) / Math.max(30, evidence.walkingBurdenMinutes), -1, 1);
  const pricePressure = clamp(evidence.price / (segment === "junior" ? 48 : segment === "casual" ? 72 : segment === "senior" ? 88 : segment === "tourist" ? 118 : 130));
  const pace = clamp(1 - Math.max(0, evidence.paceMinutes - 255) / 180);
  const service = clamp(1 - evidence.serviceDelayMinutes / 18);
  const voluntaryWalk = evidence.mode === "walk" && !evidence.stockoutFallback && !evidence.restricted;
  const modeValue = evidence.mode === "riding_cart" ? needs.riding : evidence.mode === "pushcart" ? needs.pushcart : needs.walking;
  return round(clamp(
    .48 + burden * (evidence.mode === "walk" ? -needs.walking * .22 : modeValue * .17)
      + saved * (needs.walking * .26 + needs.pace * .14)
      + (voluntaryWalk ? .08 * needs.walking : 0)
      + pace * needs.pace * .13 + service * needs.service * .08
      - pricePressure * needs.price * .2
      - (evidence.stockoutFallback ? .2 + needs.walking * .1 : 0)
      - (evidence.restricted ? .09 : 0)
      - clamp(evidence.walkingFallbackMinutes / Math.max(30, evidence.walkingBurdenMinutes)) * needs.walking * .2,
  ));
}

export function m49MobilityCauses(evidence: M49ObservedMobilityEvidence): string[] {
  return cause(evidence);
}

export function m49MobilityHistoryDisappointment(history: M49SegmentMobilityHistory | undefined): number {
  if (!history?.observedRounds) return 0;
  return clamp(1 - history.averageValue + history.stockoutFallbacks / history.observedRounds * .35 + history.restrictions / history.observedRounds * .14);
}
