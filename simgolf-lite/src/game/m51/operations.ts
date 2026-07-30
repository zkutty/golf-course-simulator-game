import type { ConcessionTransaction, Course, Terrain } from "../models/types";
import { buildingEntrance } from "../models/buildings";
import type { Golfer, LiveState, Segment } from "../live/types";
import { mobilityRouteCacheKey, normalizeM51CourseMobilityState } from "./mobility";
import { TimedMobilityLegCache, mobilityGeometryVersion, planTimedMobilityLeg, type MobilityRouteConditions } from "./travelRouter";
import {
  MOBILITY_BUSINESS,
  type MobilityAssignment,
  type MobilityFleetUnit,
  type MobilityGroupSelection,
  type MobilityMode,
} from "./types";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cents = (value: number) => Math.round(value * 100) / 100;

const CART_PROTECTED_TERRAIN = new Set<Terrain>(["green", "tee", "sand", "water", "wetland"]);
const liveRouteCaches = new WeakMap<LiveState, TimedMobilityLegCache>();

function routeCache(state: LiveState): TimedMobilityLegCache {
  const existing = liveRouteCaches.get(state);
  if (existing) return existing;
  const created = new TimedMobilityLegCache();
  liveRouteCaches.set(state, created);
  return created;
}

function groupWalkingMinutes(golfers: Golfer[]): number {
  if (!golfers.length) return 0;
  return golfers.reduce((sum, golfer) => sum + golfer.segments.filter((segment) => segment.kind === "walk").reduce((total, segment) => total + segment.dur, 0), 0) / golfers.length;
}

function pathUtility(course: Course): number {
  const developed = course.tiles.filter((terrain) => terrain !== "rough" && terrain !== "deep_rough").length;
  if (!developed) return 0;
  return clamp(course.tiles.filter((terrain) => terrain === "path").length / Math.max(1, developed) * 5, 0, 1);
}

export function mobilityRouteConditions(state: LiveState): MobilityRouteConditions {
  const kind = state.weather?.daily.kind;
  if (kind === "heavy_rain" || kind === "storm") {
    return { weather: "cart_path_only", cartPathOnly: true, restrictionId: `${kind}:${state.weather?.daily.absoluteDay ?? state.dayIndex}` };
  }
  if (kind === "rain") return { weather: "wet", cartPathOnly: true, restrictionId: `rain:${state.weather?.daily.absoluteDay ?? state.dayIndex}` };
  return { weather: "dry", restrictionId: `dry:${state.weather?.daily.absoluteDay ?? state.dayIndex}` };
}

function demandScore(args: {
  mode: MobilityMode;
  golfers: Golfer[];
  course: Course;
  price: number;
  tier: number;
  serviceCoverage: number;
  walkingMinutes: number;
  pathUtility: number;
  weather: LiveState["weather"];
}): number {
  const averages = args.golfers.reduce((result, golfer) => ({
    spend: result.spend + golfer.personality.spendPropensity,
    price: result.price + golfer.personality.prefs.price,
    scenery: result.scenery + golfer.personality.prefs.scenery,
    pace: result.pace + (golfer.pacePreference ?? golfer.personality.pacePreference ?? .5),
    senior: result.senior + (golfer.archetype === "senior" ? 1 : 0),
  }), { spend: 0, price: 0, scenery: 0, pace: 0, senior: 0 });
  const divisor = Math.max(1, args.golfers.length);
  const spend = averages.spend / divisor;
  const priceTolerance = (averages.price / divisor + 1) / 2;
  const scenery = (averages.scenery / divisor + 1) / 2;
  const pace = averages.pace / divisor;
  const senior = averages.senior / divisor;
  const burden = clamp(args.walkingMinutes / 180, 0, 1);
  const value = clamp(args.course.condition * .65 + (1 - args.price / 250) * .35, 0, 1);
  const service = clamp((args.tier - 1) * .18 + args.serviceCoverage * .08, 0, .45);
  const heat = args.weather?.daily.kind === "heat" || args.weather?.daily.kind === "drought" ? 1 : 0;
  const wet = ["rain", "heavy_rain", "storm"].includes(args.weather?.daily.kind ?? "") ? 1 : 0;
  if (args.mode === "walk") return .52 + scenery * .16 + (1 - spend) * .08 - burden * .26 - heat * .16 + wet * .04;
  if (args.mode === "pushcart") return .32 + burden * .24 + spend * .12 + priceTolerance * .12 + value * .1 + service - wet * .03;
  return .25 + burden * .3 + pace * .12 + senior * .18 + spend * .13 + priceTolerance * .1 + value * .08 + args.pathUtility * .3 + service + heat * .22 - wet * .32;
}

function availableUnits(courseState: ReturnType<typeof normalizeM51CourseMobilityState>, live: NonNullable<LiveState["m51"]>, buildingId: string, mode: Exclude<MobilityMode, "walk">): MobilityFleetUnit[] {
  const reserved = new Set(live.assignments.filter((assignment) => assignment.status === "active" || assignment.status === "reserved").flatMap((assignment) => assignment.fleetUnitIds));
  return Object.values(courseState.fleet)
    .filter((unit) => unit.buildingId === buildingId && unit.mode === mode && unit.state === "available" && unit.condition > .15 && !reserved.has(unit.id))
    .sort((a, b) => compare(a.id, b.id));
}

function requiredUnits(mode: Exclude<MobilityMode, "walk">, groupSize: number): number {
  return mode === "pushcart" ? groupSize : Math.ceil(groupSize / 2);
}

function assignRiders(golfers: Golfer[], units: MobilityFleetUnit[], mode: Exclude<MobilityMode, "walk">): MobilityAssignment["riders"] {
  const ordered = [...golfers].sort((a, b) => a.id - b.id);
  return ordered.map((golfer, index) => {
    const unitIndex = mode === "pushcart" ? index : Math.floor(index / 2);
    return { golferId: golfer.id, fleetUnitId: units[unitIndex].id, seat: mode === "pushcart" ? 0 : index % 2 };
  });
}

function travelEvidence(course: Course, state: LiveState, golfer: Golfer, mode: MobilityMode, geometryVersion: string): {
  segments: Segment[];
  actualTravelMinutes: number;
  walkingFallbackMinutes: number;
  offPathTiles: number;
} {
  const conditions = mobilityRouteConditions(state);
  let actualTravelMinutes = 0;
  let walkingFallbackMinutes = 0;
  let offPathTiles = 0;
  const segments = golfer.segments.flatMap((segment): Segment[] => {
    if (segment.kind !== "walk" || mode === "walk") {
      if (segment.kind === "walk") actualTravelMinutes += segment.dur;
      return [{ ...segment, ...(segment.kind === "walk" ? { mobility: { requestedMode: mode, resolvedMode: "walk" as const, minutesSaved: 0, offPathTiles: 0 } } : {}) }];
    }
    const courseId = golfer.courseId ?? course.activeCourseId ?? "course-primary";
    const leg = planTimedMobilityLeg({
      course, courseId, layoutId: courseId, mode, from: segment.from, to: segment.to,
      conditions, geometryVersion, allowWalkFallback: true,
    }, routeCache(state));
    if (!leg || leg.cells.length < 2) {
      actualTravelMinutes += segment.dur;
      walkingFallbackMinutes += segment.dur;
      return [{ ...segment, mobility: { requestedMode: mode, resolvedMode: "walk", minutesSaved: 0, offPathTiles: 0 } }];
    }
    const resolved = leg.resolvedMode;
    const duration = Math.max(.01, leg.minutes);
    actualTravelMinutes += duration;
    if (resolved === "walk") walkingFallbackMinutes += duration;
    const legOffPath = resolved === "riding_cart"
      ? leg.cells.filter((point) => {
          const terrain = course.tiles[Math.round(point.y) * course.width + Math.round(point.x)];
          return terrain !== "path" && !CART_PROTECTED_TERRAIN.has(terrain);
        }).length
      : 0;
    offPathTiles += legOffPath;
    const waypoints = leg.waypoints.length ? leg.waypoints : [{ ...segment.to }];
    const distances: number[] = [];
    let cursor = segment.from;
    for (const point of waypoints) {
      distances.push(Math.max(.0001, Math.hypot(point.x - cursor.x, point.y - cursor.y)));
      cursor = point;
    }
    const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
    cursor = segment.from;
    return waypoints.map((point, index) => {
      const next: Segment = {
        ...segment,
        from: { ...cursor },
        to: { ...point },
        dur: duration * distances[index] / totalDistance,
        mobility: {
          requestedMode: mode,
          resolvedMode: resolved,
          minutesSaved: (segment.dur - duration) * distances[index] / totalDistance,
          offPathTiles: Math.round(legOffPath * distances[index] / totalDistance),
        },
      };
      cursor = point;
      return next;
    });
  });
  return { segments, actualTravelMinutes, walkingFallbackMinutes, offPathTiles };
}

function applyAssignmentToGolfers(course: Course, state: LiveState, golfers: Golfer[], selection: MobilityGroupSelection, assignment: MobilityAssignment, includeService = true): void {
  const geometryVersion = mobilityGeometryVersion(course);
  for (const golfer of golfers) {
    // Cart Rental commerce is owned by M51. Any old generic planner segment is
    // discarded before it can create a duplicate concession charge.
    golfer.segments = golfer.segments.filter((segment) => segment.concession?.buildingType !== "cart_rental");
    const evidence = travelEvidence(course, state, golfer, selection.mode, geometryVersion);
    if (includeService && assignment.serviceDelayMinutes > 0 && selection.mode !== "walk") {
      const at = golfer.segments[0]?.from ?? golfer.pos;
      evidence.segments.unshift({ kind: "pause", from: { ...at }, to: { ...at }, holeIndex: -1, dur: assignment.serviceDelayMinutes });
    }
    golfer.segments = evidence.segments;
    golfer.mobilityMode = selection.mode;
    golfer.mobilityAssignmentId = assignment.id;
    golfer.mobilityPredictedWalkingMinutes = selection.predictedWalkingMinutes;
    golfer.mobilityActualTravelMinutes = evidence.actualTravelMinutes;
    golfer.mobilityWalkingFallbackMinutes = evidence.walkingFallbackMinutes;
    golfer.mobilityOffPathTiles = evidence.offPathTiles;
  }
  assignment.actualTravelMinutes = golfers.length ? golfers.reduce((sum, golfer) => sum + (golfer.mobilityActualTravelMinutes ?? 0), 0) / golfers.length : 0;
  assignment.walkingFallbackMinutes = golfers.length ? golfers.reduce((sum, golfer) => sum + (golfer.mobilityWalkingFallbackMinutes ?? 0), 0) / golfers.length : 0;
  assignment.offPathTiles = golfers.reduce((sum, golfer) => sum + (golfer.mobilityOffPathTiles ?? 0), 0);
}

export interface GroupMobilityReservation {
  selection: MobilityGroupSelection;
  assignment: MobilityAssignment;
  concessionTransactions: ConcessionTransaction[];
  cashDelta: number;
}

/**
 * Select one deterministic mode, reserve exact units, apply the shared live
 * itinerary, and emit existing-economy transactions in stable golfer order.
 */
export function reserveGroupMobility(state: LiveState, course: Course, golfersInput: Golfer[]): GroupMobilityReservation {
  state.m51 ??= {
    version: 3, seed: state.seed, nextDecisionOrder: 0, selections: [], assignments: [],
    transactions: [], predictedEvidence: [], observedEvidence: [], stockouts: [],
  };
  const live = state.m51;
  const golfers = [...golfersInput].sort((a, b) => a.id - b.id);
  const groupId = golfers[0]?.groupId ?? `group-${live.nextDecisionOrder}`;
  const courseId = golfers[0]?.courseId ?? course.activeCourseId ?? "course-primary";
  const existingAssignment = live.assignments.find((assignment) => assignment.groupId === groupId && assignment.status !== "cancelled");
  const existingSelection = existingAssignment && live.selections.find((selection) => selection.id === existingAssignment.selectionId);
  if (existingAssignment && existingSelection) {
    return { selection: existingSelection, assignment: existingAssignment, concessionTransactions: [], cashDelta: 0 };
  }
  const decisionOrder = live.nextDecisionOrder++;
  const seed = (live.seed + decisionOrder * 2654435761) >>> 0;
  const walkingMinutes = groupWalkingMinutes(golfers);
  const courseState = normalizeM51CourseMobilityState(course.m51, course);
  const facilities = Object.values(courseState.cartRentals).sort((a, b) => compare(a.buildingId, b.buildingId));
  const serviceCoverage = state.beverageCoverageByCourse?.[courseId] ?? 0;
  const utility = pathUtility(course);
  let fallbackReason: MobilityGroupSelection["reason"] = facilities.length ? "preference" : "no_facility";
  const candidates: Array<{
    mode: MobilityMode;
    score: number;
    buildingId?: string;
    productId?: string;
    price: number;
    tier: number;
    units: MobilityFleetUnit[];
    availableCount: number;
  }> = [{
    mode: "walk",
    score: demandScore({ mode: "walk", golfers, course, price: 0, tier: 1, serviceCoverage, walkingMinutes, pathUtility: utility, weather: state.weather }),
    price: 0, tier: 1, units: [], availableCount: 0,
  }];
  if (!state.tournament) for (const rental of facilities) for (const paidMode of ["pushcart", "riding_cart"] as const) {
    const product = rental.products[paidMode];
    if (!product.enabled) continue;
    const needed = requiredUnits(paidMode, golfers.length);
    const available = availableUnits(courseState, live, rental.buildingId, paidMode);
    const affordable = golfers.every((golfer) => golfer.wallet >= product.price);
    if (!affordable) {
      fallbackReason = "unaffordable_fallback";
      continue;
    }
    if (available.length < needed) {
      fallbackReason = "stockout_fallback";
      live.stockouts.push({
        id: `stockout:${state.seed}:${groupId}:${product.id}:${decisionOrder}`, courseId, groupId,
        buildingId: rental.buildingId, productId: product.id, mode: paidMode,
        requiredUnits: needed, availableUnits: available.length, decisionOrder,
      });
      continue;
    }
    const weatherRestricted = paidMode === "riding_cart" && mobilityRouteConditions(state).cartPathOnly && utility < .08;
    if (weatherRestricted) {
      fallbackReason = "weather_fallback";
      continue;
    }
    candidates.push({
      mode: paidMode,
      score: demandScore({ mode: paidMode, golfers, course, price: product.price, tier: rental.tier, serviceCoverage, walkingMinutes, pathUtility: utility, weather: state.weather }),
      buildingId: rental.buildingId, productId: product.id, price: product.price, tier: rental.tier, units: available.slice(0, needed),
      availableCount: available.length,
    });
  }
  if (state.tournament) fallbackReason = "policy_fallback";
  const chosen = candidates.sort((a, b) => b.score - a.score || compare(a.mode, b.mode) || compare(a.buildingId ?? "", b.buildingId ?? ""))[0];
  const predictedTravelMinutes = chosen.mode === "walk" ? walkingMinutes : walkingMinutes * (chosen.mode === "pushcart" ? .82 : clamp(.68 - utility * .2, .42, .68));
  const selection: MobilityGroupSelection = {
    id: `selection:${state.seed}:${groupId}:${decisionOrder}`, groupId, courseId, mode: chosen.mode,
    ...(chosen.productId ? { productId: chosen.productId } : {}), status: "confirmed",
    groupSize: golfers.length, perGolferFee: cents(chosen.price), predictedWalkingMinutes: walkingMinutes,
    predictedTravelMinutes, reason: chosen.mode === "walk" ? fallbackReason : "preference", seed, decisionOrder,
  };
  const activeAtFacility = live.assignments.filter((assignment) => assignment.buildingId === chosen.buildingId && (assignment.status === "active" || assignment.status === "reserved")).length;
  const serviceDelayMinutes = chosen.mode === "walk" ? 0 : cents(MOBILITY_BUSINESS.serviceMinutes[chosen.mode] / Math.max(1, chosen.tier) * (1 + activeAtFacility * .25) / Math.max(1, serviceCoverage || 1));
  const assignment: MobilityAssignment = {
    id: `assignment:${state.seed}:${groupId}:${decisionOrder}`, groupId, courseId, selectionId: selection.id, mode: chosen.mode,
    ...(chosen.buildingId ? { buildingId: chosen.buildingId } : {}), ...(chosen.productId ? { productId: chosen.productId } : {}),
    fleetUnitIds: chosen.units.map((unit) => unit.id), riders: chosen.mode === "walk" ? [] : assignRiders(golfers, chosen.units, chosen.mode),
    status: "active",
    routeCacheKey: mobilityRouteCacheKey({ courseId, layoutId: courseId, mode: chosen.mode, from: golfers[0]?.pos ?? { x: 0, y: 0 }, to: golfers[0]?.segments.at(-1)?.to ?? golfers[0]?.pos ?? { x: 0, y: 0 } }),
    serviceDelayMinutes, availableUnitsAtSelection: chosen.availableCount, actualTravelMinutes: 0, walkingFallbackMinutes: 0, offPathTiles: 0, seed, decisionOrder,
  };
  applyAssignmentToGolfers(course, state, golfers, selection, assignment);
  const concessionTransactions: ConcessionTransaction[] = [];
  let cashDelta = 0;
  if (chosen.mode !== "walk") for (const golfer of golfers) {
    const rider = assignment.riders.find((candidate) => candidate.golferId === golfer.id)!;
    const id = `mobility:${state.seed}:${groupId}:${decisionOrder}:${golfer.id}`;
    const amount = cents(chosen.price);
    golfer.wallet = cents(golfer.wallet - amount);
    golfer.spent = cents(golfer.spent + amount);
    live.transactions.push({
      id, courseId, groupId, assignmentId: assignment.id, productId: chosen.productId, buildingId: chosen.buildingId,
      golferId: golfer.id, fleetUnitId: rider.fleetUnitId, mode: chosen.mode, amount, status: "settled",
      seed, decisionOrder, authorizedAtMinute: state.dayMinute, settledAtWeek: undefined, settledAtDay: undefined,
    });
    const building = course.buildings.find((candidate) => candidate.id === chosen.buildingId)!;
    const entrance = building ? buildingEntrance(course, building) : golfer.pos;
    concessionTransactions.push({
      id, golferId: golfer.id, golferName: golfer.name, buildingType: "cart_rental",
      buildingX: entrance.x, buildingY: entrance.y,
      item: chosen.mode === "pushcart" ? "Pushcart rental" : "Riding cart rental",
      amount, atMinute: state.dayMinute,
    });
    cashDelta = cents(cashDelta + amount);
  }
  live.selections.push(selection);
  live.assignments.push(assignment);
  live.predictedEvidence.push({
    source: "predicted", groupId, courseId, mode: chosen.mode, paceMinutes: predictedTravelMinutes,
    cost: cents(chosen.price * golfers.length), confidence: chosen.mode === "walk" ? .9 : clamp(.65 + utility * .25, .65, .9),
    seed, decisionOrder,
  });
  return { selection, assignment, concessionTransactions, cashDelta };
}

/** Reapply a restored assignment to an edited itinerary without charging again. */
export function reapplyGroupMobility(state: LiveState, course: Course, golfer: Golfer): void {
  const assignment = state.m51?.assignments.find((candidate) => candidate.id === golfer.mobilityAssignmentId && candidate.status === "active");
  const selection = assignment && state.m51?.selections.find((candidate) => candidate.id === assignment.selectionId);
  if (!assignment || !selection) return;
  applyAssignmentToGolfers(course, state, [golfer], selection, assignment, false);
  const group = state.golfers.filter((candidate) => candidate.groupId === assignment.groupId);
  assignment.actualTravelMinutes = group.length ? group.reduce((sum, candidate) => sum + (candidate.mobilityActualTravelMinutes ?? 0), 0) / group.length : assignment.actualTravelMinutes;
  assignment.walkingFallbackMinutes = group.length ? group.reduce((sum, candidate) => sum + (candidate.mobilityWalkingFallbackMinutes ?? 0), 0) / group.length : assignment.walkingFallbackMinutes;
  assignment.offPathTiles = group.reduce((sum, candidate) => sum + (candidate.mobilityOffPathTiles ?? 0), 0);
}

/** Apply actual mobility time/fallback to live satisfaction before reactions aggregate. */
export function applyGolferMobilityReaction(state: LiveState, golfer: Golfer): void {
  if (golfer.mobilityReactionApplied) return;
  const assignment = state.m51?.assignments.find((candidate) => candidate.id === golfer.mobilityAssignmentId);
  const selection = assignment && state.m51?.selections.find((candidate) => candidate.id === assignment.selectionId);
  if (!assignment || !selection) return;
  const actual = golfer.mobilityActualTravelMinutes ?? selection.predictedWalkingMinutes;
  const minutesSaved = selection.predictedWalkingMinutes - actual;
  const reaction = clamp(minutesSaved / Math.max(30, selection.predictedWalkingMinutes) * .08 - (golfer.mobilityWalkingFallbackMinutes ?? 0) / Math.max(30, actual) * .025, -.04, .06);
  golfer.mood = clamp(golfer.mood + reaction, 0, 1);
  golfer.mobilityReactionApplied = true;
  if (Math.abs(minutesSaved) >= 5) {
    golfer.thought = minutesSaved > 0 ? `Mobility saved about ${Math.round(minutesSaved)} minutes` : "Mobility offered little time advantage";
    golfer.thoughtUntil = Math.max(golfer.thoughtUntil, state.dayMinute + 18);
  }
}

/** Release each group once and capture observed pace/wear/reaction evidence. */
export function releaseFinishedMobilityGroups(state: LiveState, finishedGolfers: Golfer[]): void {
  const live = state.m51;
  if (!live) return;
  const byGroup = new Map<string, Golfer[]>();
  for (const golfer of finishedGolfers) {
    const groupId = golfer.groupId ?? "";
    if (!groupId) continue;
    const group = byGroup.get(groupId) ?? [];
    group.push(golfer); byGroup.set(groupId, group);
  }
  for (const [groupId, golfers] of byGroup) {
    if (state.golfers.some((golfer) => golfer.groupId === groupId && !golfer.finished)) continue;
    const assignment = live.assignments.find((candidate) => candidate.groupId === groupId && candidate.status === "active");
    const selection = assignment && live.selections.find((candidate) => candidate.id === assignment.selectionId);
    if (!assignment || !selection) continue;
    assignment.status = "released";
    const wear = assignment.fleetUnitIds.length * MOBILITY_BUSINESS.wearPerUse[assignment.mode === "walk" ? "pushcart" : assignment.mode]
      + assignment.offPathTiles * MOBILITY_BUSINESS.offPathWearPerTile;
    assignment.returnedCondition = clamp(1 - wear, 0, 1);
    golfers.forEach((golfer) => applyGolferMobilityReaction(state, golfer));
    const completed = golfers.every((golfer) => golfer.completionStatus === "completed" && golfer.scoredHoles >= golfer.holePar.length);
    const satisfaction = golfers.reduce((sum, golfer) => sum + golfer.mood * 100, 0) / Math.max(1, golfers.length);
    const actual = golfers.reduce((sum, golfer) => sum + (golfer.mobilityActualTravelMinutes ?? 0), 0) / Math.max(1, golfers.length);
    const minutesSaved = selection.predictedWalkingMinutes - actual;
    live.observedEvidence.push({
      source: "observed", id: `observation:${assignment.id}`, courseId: assignment.courseId, groupId,
      mode: assignment.mode, completed, paceMinutes: Math.max(...golfers.map((golfer) => state.dayMinute - (golfer.groupStartedAt ?? state.dayMinute)), 0),
      cost: cents(selection.perGolferFee * selection.groupSize), satisfaction,
      predictedWalkingMinutes: selection.predictedWalkingMinutes, actualTravelMinutes: actual, minutesSaved,
      walkingFallbackMinutes: assignment.walkingFallbackMinutes, offPathTiles: assignment.offPathTiles,
      seed: assignment.seed, decisionOrder: assignment.decisionOrder, settledAtWeek: 0, settledAtDay: state.dayIndex,
    });
  }
}

/** Apply bounded fleet uses/condition once per released assignment. */
export function settleMobilityFleet(course: Course, live: LiveState["m51"]): Course {
  if (!live) return course;
  const state = normalizeM51CourseMobilityState(course.m51, course);
  const settled = new Set(state.settledAssignmentIds);
  const fleet = { ...state.fleet };
  const newlySettled: string[] = [];
  for (const assignment of live.assignments.filter((candidate) => candidate.status === "released").sort((a, b) => a.decisionOrder - b.decisionOrder || compare(a.id, b.id))) {
    if (settled.has(assignment.id)) continue;
    const perUnitOffPath = assignment.fleetUnitIds.length ? assignment.offPathTiles / assignment.fleetUnitIds.length : 0;
    for (const unitId of assignment.fleetUnitIds) {
      const unit = fleet[unitId];
      if (!unit) continue;
      const wear = MOBILITY_BUSINESS.wearPerUse[unit.mode] + perUnitOffPath * MOBILITY_BUSINESS.offPathWearPerTile;
      fleet[unitId] = { ...unit, state: unit.condition - wear <= .15 ? "maintenance" : "available", condition: clamp(unit.condition - wear, 0, 1), uses: unit.uses + 1, wear: clamp(unit.wear + wear, 0, 1) };
    }
    settled.add(assignment.id); newlySettled.push(assignment.id);
  }
  if (!newlySettled.length) return course;
  return { ...course, m51: { ...state, fleet, settledAssignmentIds: [...state.settledAssignmentIds, ...newlySettled].slice(-360) } };
}
