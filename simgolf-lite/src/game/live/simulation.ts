import type { Course, Point, World } from "../models/types";
import { mulberry32 } from "../../utils/rng";
import { getGolferProfile } from "../sim/golferProfiles";
import { scoreCourseHoles } from "../sim/holes";
import { ARCHETYPES, golferName } from "./archetypes";
import { rollPersonality, solverProfileForSkill } from "./personality";
import { createGolferCapabilities, stableGolferSeed } from "./capabilities";
import { getDifficultyProfile } from "../balance/difficulty";
import { buildGolferRound, entryPoint, planFromHole } from "./golfer";
import { buildStrategicGolferRound } from "./m47Round";
import { advanceGolfer } from "./golfer";
import { planEstateDay } from "./spawn";
import { findWalkPath } from "./walkPath";
import { LIVE } from "./liveConfig";
import type { Arrival, Golfer, GolferRenderData, LiveState, RoundReactions } from "./types";
import { rollDiscretionaryWallet } from "./concessions";
import type { CompletedRound } from "../retention/types";
import type { LiveShotOutcome } from "./m47Types";
import { createLiveTournament, planTournamentDay, tournamentForDate, updateTournamentStanding } from "../tournaments/tournaments";
import { getTeeBox, preferredTeeForArchetype } from "../models/courseSetup";
import { activeCourseLayout, courseForHoleIds, courseForLayout, layoutById, operatingCourseViews } from "../models/courseLayouts";
import {
  cohortFromGolfer,
  courseOperations,
  emptyPaceDayMetrics,
  ensureCoursePaceMetrics,
  groupTimeParMinutes,
  normalizedStaff,
} from "./pace";
import { activeWeather, seasonalState, weatherModifiers } from "../seasons/seasons";
import { BALANCE } from "../balance/balanceConfig";
import { paceIdentity, paceRepeatIntentModifier } from "./paceHistory";
import { observeM49Round } from "../m49/experience";
import { observedM49MobilityEvidence } from "../m49/mobility";
import { emptyM51LiveMobilityState } from "../m51/mobility";
import { applyGolferMobilityReaction, reapplyGroupMobility, releaseFinishedMobilityGroups, reserveGroupMobility } from "../m51/operations";

// A memoized walk router bound to a course + per-day cache. Golfers spawned the
// same day share cached routes, so pathfinding runs at most once per (from,to).
function makeRouter(course: Course, cache: Map<string, Point[] | null>) {
  return (from: Point, to: Point): Point[] | null => {
    const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const path = findWalkPath(course, from, to);
    cache.set(key, path);
    return path;
  };
}

export function createLiveState(
  course: Course,
  world: World,
  dayIndex: number
): LiveState {
  const seed = (world.runSeed | 0) + dayIndex * 7919;
  const courseViews = operatingCourseViews(course);
  const tournamentEvent = tournamentForDate(world, dayIndex, course);
  const rawArrivals = tournamentEvent
    ? planTournamentDay(
      tournamentEvent,
      LIVE.day.firstArrivalMinute,
      LIVE.day.teeGapMinutes,
      courseOperations(course, tournamentEvent.courseId).maxGroupSize,
    )
    : planEstateDay(course, world, seed, courseViews, dayIndex);
  const seasonal = seasonalState(world, course, dayIndex);
  const dailyWeather = activeWeather(world, course, dayIndex);
  const dailyWeatherModifiers = weatherModifiers(dailyWeather, seasonal.operations.drainageLevel);
  const arrivals = rawArrivals.map((arrival, index) => {
    const courseId = arrival.courseId ?? tournamentEvent?.courseId ?? activeCourseLayout(course).id;
    return {
      ...arrival,
      groupId: arrival.groupId ?? `${courseId}-solo-${index + 1}`,
      paceIdentityAtVisit: paceIdentity(world, courseId).score,
    };
  });
  const perCourse = Object.fromEntries(courseViews.map(({ layout }) => [layout.id, {
    courseName: layout.name,
    arrivals: arrivals.filter((arrival) => arrival.courseId === layout.id).length,
    roundsStarted: 0,
    roundsFinished: 0,
    greenFees: 0,
    satisfactionSum: 0,
    promoters: 0,
    detractors: 0,
    willReturnCount: 0,
  }]));
  const staff = normalizedStaff(world, course);
  const marshalCoverageByCourse: Record<string, number> = {};
  const beverageCoverageByCourse: Record<string, number> = {};
  const overtimeRateByCourse: Record<string, number> = {};
  for (const member of staff) {
    const courseId = member.courseId ?? courseViews[0]?.layout.id;
    if (!courseId) continue;
    if (member.role === "marshal") marshalCoverageByCourse[courseId] = (marshalCoverageByCourse[courseId] ?? 0) + 1;
    if (member.role === "cart_attendant") beverageCoverageByCourse[courseId] = (beverageCoverageByCourse[courseId] ?? 0) + 1;
    overtimeRateByCourse[courseId] = (overtimeRateByCourse[courseId] ?? 0)
      + member.weeklyWage / BALANCE.paceOperations.staffHoursPerWeek * BALANCE.paceOperations.overtimePremium;
  }
  const groups = [...new Map(arrivals.map((arrival) => [arrival.groupId!, {
    id: arrival.groupId!, courseId: arrival.courseId ?? courseViews[0]?.layout.id ?? "course-primary",
    bookedAt: arrival.atMinute, startedAt: null, golferIds: [], waitMinutes: 0, blocked: false,
    interventions: 0, pickups: 0, finishedAt: null,
  }])).values()];
  return {
    difficulty: world.difficulty,
    dayIndex,
    dayMinute: LIVE.day.openMinute,
    golfers: [],
    arrivals,
    nextArrivalIdx: 0,
    nextGolferId: 1,
    greenFeeCollected: 0,
    concessionCollected: 0,
    concessionTransactions: [],
    concessionByType: {},
    roundsStarted: 0,
    roundsFinished: 0,
    satisfactionSum: 0,
    promoters: 0,
    detractors: 0,
    willReturnCount: 0,
    reconcileEpoch: 0,
    nextTeeFreeAt: 0,
    nextTeeFreeAtByCourse: {},
    perCourse,
    walkCache: new Map(),
    dayOver: false,
    seed,
    tournament: tournamentEvent ? createLiveTournament(tournamentEvent, course) : undefined,
    groups,
    pace: emptyPaceDayMetrics(courseViews.map(({ layout }) => layout.id)),
    marshalCoverageByCourse,
    beverageCoverageByCourse,
    overtimeRateByCourse,
    operationsByCourse: Object.fromEntries(courseViews.map(({ layout }) => {
      const operations = courseOperations(course, layout.id);
      return [layout.id, tournamentEvent?.courseId === layout.id || (!tournamentEvent?.courseId && tournamentEvent)
        ? { ...operations, daylightPolicy: "finish_started" as const }
        : operations];
    })),
    weather: { daily: dailyWeather, modifiers: dailyWeatherModifiers },
    observedRounds: [],
    m51: emptyM51LiveMobilityState(seed),
  };
}

// Turn a finished golfer's observed round into a discrete reaction. Kept here
// (not on the golfer) so it reads only final state and stays deterministic.
function classifyReaction(g: Golfer): { promoter: boolean; detractor: boolean; willReturn: boolean } {
  const r = LIVE.reactions;
  const returnScore = g.mood
    + (g.personality.patience - 0.5) * r.returnPatienceNudge
    + paceRepeatIntentModifier(g.paceIdentityAtVisit ?? 0.5, g.pacePreference ?? 0.5);
  return {
    promoter: g.mood >= r.promoterMood,
    detractor: g.mood <= r.detractorMood,
    willReturn: returnScore >= r.returnMood,
  };
}

function spawnGolfer(state: LiveState, course: Course, arrival: Arrival): Golfer {
  const id = state.nextGolferId++;
  const arch = ARCHETYPES[arrival.archetype];
  const rng = mulberry32(state.seed + id * 131);
  // Roll this individual's personality, then plan their round from the shot
  // model their rolled skill implies (not a fixed per-archetype tier).
  const dp = getDifficultyProfile(state.difficulty);
  const rolledPersonality = rollPersonality(arch.personality, rng, {
    patience: dp.patienceMult,
    spend: dp.spendMult,
  });
  const personality = arrival.tournament
    ? { ...rolledPersonality, skill: Math.max(0, Math.min(1, arrival.tournament.skill)), consistency: Math.max(rolledPersonality.consistency, .62) }
    : rolledPersonality;
  const capabilities = createGolferCapabilities({
    personality,
    seed: stableGolferSeed(arrival.personId ?? arrival.tournament?.entrantId ?? `${state.seed}:${id}`, state.seed + id),
  });
  const courseId = arrival.courseId ?? state.tournament?.courseId ?? activeCourseLayout(course).id;
  const roundCourse = courseForLayout(course, courseId);
  const layout = layoutById(course, courseId) ?? activeCourseLayout(course);
  const baseProfile = getGolferProfile(solverProfileForSkill(personality.skill), roundCourse);
  const profile = state.weather ? {
    ...baseProfile,
    clubs: baseProfile.clubs.map((club) => ({
      ...club,
      carryYards: club.carryYards * state.weather!.modifiers.carryMultiplier,
      dispersionTilesBase: club.dispersionTilesBase * state.weather!.modifiers.dispersionMultiplier,
    })),
  } : baseProfile;
  const entry = entryPoint(roundCourse);
  const wallet = rollDiscretionaryWallet(personality, rng);
  const preferredTeeSet = preferredTeeForArchetype(arch.name);
  const operations = state.operationsByCourse?.[courseId] ?? courseOperations(course, courseId);
  const guidedTeeSet = operations.teeGuidance === "required"
    ? personality.skill < .48 ? "forward" : personality.skill > .86 ? "championship" : "member"
    : preferredTeeSet;
  const teeSet = arrival.tournament?.teeSet ?? (roundCourse.holes.every((hole) => !getTeeBox(hole, "member") || !!getTeeBox(hole, guidedTeeSet))
    ? guidedTeeSet
    : "member");
  const pinRotation = arrival.tournament?.pinRotation ?? roundCourse.activePinRotation ?? "A";
  const round = buildGolferRound({
    course: roundCourse,
    profile,
    entry,
    rng,
    personality,
    route: makeRouter(course, state.walkCache),
    wallet,
    teeSet,
    pinRotation,
    capabilities,
  });
  if (state.weather && state.weather.modifiers.paceMultiplier !== 1) {
    round.segments = round.segments.map((segment) => segment.kind === "walk" || segment.kind === "pause"
      ? { ...segment, dur: segment.dur * state.weather!.modifiers.paceMultiplier }
      : segment);
  }
  const holeIds = roundCourse.holes.map((hole) => hole.id!).filter(Boolean);
  round.segments = round.segments.map((segment) => ({ ...segment, holeId: segment.holeIndex >= 0 ? holeIds[segment.holeIndex] : undefined }));
  return {
    id,
    personId: arrival.personId,
    name: arrival.tournament?.name ?? arrival.name ?? golferName(rng(), rng()),
    archetype: arch.name,
    teeSet,
    pinRotation,
    courseId,
    courseName: layout.name,
    holeIds,
    personality,
    color: arch.color,
    segments: round.segments,
    segIndex: 0,
    segElapsed: 0,
    pos: { ...entry },
    ball: null,
    holePar: round.holePar,
    holeStrokes: round.holeStrokes,
    scoredHoles: 0,
    currentHole: -1,
    strokes: 0,
    scoreToPar: 0,
    mood: LIVE.mood.start,
    thought: null,
    thoughtUntil: 0,
    finished: false,
    spent: 0,
    wallet,
    purchasedSegmentIndexes: [],
    tournamentId: arrival.tournament?.eventId,
    tournamentEntrantId: arrival.tournament?.entrantId,
    groupId: arrival.groupId ?? `${courseId}-solo-${id}`,
    groupStartedAt: state.dayMinute,
    waitMinutes: 0,
    pacePreference: personality.pacePreference ?? personality.skill,
    paceIdentityAtVisit: arrival.paceIdentityAtVisit ?? 0.5,
    marshalInterventions: 0,
    forcedPickups: 0,
    drinksServed: 0,
    alcoholUnits: 0,
    hospitalityDelay: 0,
    disorderIncidents: 0,
    completionStatus: "completed",
    capabilities: round.capabilities ?? capabilities,
    holePlans: round.holePlans,
    shotOutcomes: round.shotOutcomes,
    holeReactions: round.holeReactions,
  };
}

/** Seed 100 active golfers across one immutable round plan for render perf QA. */
export function createRenderPerfLiveState(course: Course, world: World): LiveState {
  // The render fixture measures sprites, culling, and frame work—not route
  // planning. Always build its one golfer template on a tiny synthetic course
  // so the dressed fixture's route evidence is never multiplied by 100 when
  // the fixture is snapshotted and restored.
  const firstHole = course.holes.find((hole) => hole.tee && hole.green);
  const templateCourse: Course = {
    ...course,
    width: 24,
    height: 18,
    tiles: new Array(24 * 18).fill("fairway"),
    elevations: new Array(24 * 18).fill(0),
    holes: [{ id: "perf-hole", tee: { x: 3, y: 9 }, green: { x: 20, y: 9 }, parMode: "MANUAL", parManual: 4, name: firstHole?.name ?? "Performance Hole" }],
    layouts: [{ id: "perf-course", name: "Performance Course", draftHoleIds: ["perf-hole"], publishedHoleIds: ["perf-hole"], roundLength: 9, state: "open", greenFee: course.baseGreenFee, legacyPartial: true }],
    activeCourseId: "perf-course",
    obstacles: [], buildings: [], decorations: [], estate: undefined,
  };
  const state = createLiveState(templateCourse, world, 0);
  const template = spawnGolfer(state, templateCourse, { atMinute: LIVE.day.openMinute, archetype: "casual" });
  const active = activeCourseLayout(course);
  const colors = Object.values(ARCHETYPES).map((archetype) => archetype.color);
  state.golfers = Array.from({ length: 100 }, (_, index) => {
    const holeIndex = index % 18;
    const pos = { x: 12 + ((index * 17) % 85), y: 5 + holeIndex * 3 };
    const to = { x: Math.min(course.width - 2, pos.x + 1), y: pos.y };
    return {
      ...template,
      id: index + 1,
      name: `Perf Golfer ${index + 1}`,
      color: colors[index % colors.length],
      segments: [{ kind: "walk" as const, from: pos, to, holeIndex, dur: 10_000 }],
      segIndex: 0,
      segElapsed: (index % 100) * 10,
      pos,
      ball: null,
      currentHole: holeIndex,
      currentHoleId: active.publishedHoleIds[holeIndex % active.publishedHoleIds.length],
      courseId: active.id,
      courseName: active.name,
      holeIds: active.publishedHoleIds,
      holePar: new Array(18).fill(5),
      holeStrokes: new Array(18).fill(5),
      mood: 0.2 + (index % 8) * 0.1,
    };
  });
  state.arrivals = [];
  state.nextArrivalIdx = 0;
  state.nextGolferId = 101;
  state.roundsStarted = 100;
  state.dayMinute = LIVE.day.openMinute + 240;
  state.nextTeeFreeAt = state.dayMinute + LIVE.day.teeGapMinutes;
  return state;
}

export interface StepEvents {
  cashDelta: number; // green fees collected this step
  finishedThisStep: number;
  completedRounds: CompletedRound[];
}

// Advance the live day by dtMin game-minutes. Mutates and returns state; also
// returns the cash collected this step so the caller can update world.cash.
export function stepLive(
  state: LiveState,
  course: Course,
  dtMin: number
): StepEvents {
  if (state.dayOver || dtMin <= 0) return { cashDelta: 0, finishedThisStep: 0, completedRounds: [] };

  state.dayMinute += dtMin;
  let cashDelta = 0;
  let finishedThisStep = 0;
  const completedRounds: CompletedRound[] = [];

  // Spawn arrivals that are now due (no arrivals after close). The first tee
  // only clears every `teeGapMinutes`, so backed-up arrivals queue instead of
  // all teeing off together (ZKU-110).
  while (
    state.nextArrivalIdx < state.arrivals.length &&
    state.arrivals[state.nextArrivalIdx].atMinute <= state.dayMinute
  ) {
    const firstIndex = state.nextArrivalIdx;
    const first = state.arrivals[firstIndex];
    const groupId = first.groupId ?? `${first.courseId ?? "course"}-solo-${firstIndex}`;
    const batch: Arrival[] = [];
    const courseId = first.courseId ?? activeCourseLayout(course).id;
    const operations = state.operationsByCourse?.[courseId] ?? courseOperations(course, courseId);
    if (state.dayMinute < (state.nextTeeFreeAtByCourse?.[courseId] ?? 0)) break;
    while (state.nextArrivalIdx < state.arrivals.length && (state.arrivals[state.nextArrivalIdx].groupId ?? `${state.arrivals[state.nextArrivalIdx].courseId ?? "course"}-solo-${state.nextArrivalIdx}`) === groupId) {
      batch.push(state.arrivals[state.nextArrivalIdx++]);
    }
    if (state.dayMinute > operations.lastTeeMinute || state.dayMinute > LIVE.day.closeMinute) {
      const group = state.groups?.find((candidate) => candidate.id === groupId);
      if (group) group.finishedAt = state.dayMinute;
      continue;
    }
    const golfers = batch.map((arrival) => spawnGolfer(state, course, { ...arrival, groupId }));
    const mobility = reserveGroupMobility(state, course, golfers);
    state.golfers.push(...golfers);
    if (mobility.concessionTransactions.length) {
      state.concessionTransactions.push(...mobility.concessionTransactions);
      state.concessionCollected += mobility.cashDelta;
      state.concessionByType.cart_rental = (state.concessionByType.cart_rental ?? 0) + mobility.cashDelta;
      cashDelta += mobility.cashDelta;
    }
    state.roundsStarted += golfers.length;
    state.nextTeeFreeAtByCourse ??= {};
    state.nextTeeFreeAtByCourse[courseId] = state.dayMinute + operations.teeIntervalMinutes;
    state.nextTeeFreeAt = Math.min(...Object.values(state.nextTeeFreeAtByCourse));
    const courseStats = state.perCourse?.[courseId];
    if (courseStats) courseStats.roundsStarted += golfers.length;
    const group = state.groups?.find((candidate) => candidate.id === groupId);
    if (group) { group.startedAt = state.dayMinute; group.golferIds = golfers.map((golfer) => golfer.id); }
    if (state.pace) {
      state.pace.groupsStarted++;
      const coursePace = ensureCoursePaceMetrics(state.pace, courseId);
      coursePace.groupsStarted++;
      coursePace.lastStartedAt = state.dayMinute;
    }
    // Hosted-event players are in the contracted field; the sponsor/hosting
    // award is settled after results instead of charging each entrant a fee.
    if (!first.tournament) {
      const fee = layoutById(course, courseId)?.greenFee ?? course.baseGreenFee;
      cashDelta += fee * golfers.length;
      state.greenFeeCollected += fee * golfers.length;
      golfers.forEach((golfer) => { golfer.spent += fee; });
      if (courseStats) courseStats.greenFees += fee * golfers.length;
      if (state.pace) ensureCoursePaceMetrics(state.pace, courseId).greenFeeRevenue += fee * golfers.length;
    }
  }

  // Advance every golfer; retire finished ones.
  const activeByGroup = new Map<string, Golfer[]>();
  for (const golfer of state.golfers) {
    const id = golfer.groupId ?? `${golfer.courseId}-solo-${golfer.id}`;
    const list = activeByGroup.get(id) ?? [];
    list.push(golfer); activeByGroup.set(id, list);
  }
  const blockedGroups = new Set<string>();
  for (const courseId of new Set(state.golfers.map((golfer) => golfer.courseId).filter(Boolean) as string[])) {
    const ordered = (state.groups ?? []).filter((group) => group.courseId === courseId && group.startedAt != null && group.finishedAt == null).sort((a, b) => a.startedAt! - b.startedAt!);
    for (let index = 1; index < ordered.length; index++) {
      const current = activeByGroup.get(ordered[index].id) ?? [];
      const ahead = activeByGroup.get(ordered[index - 1].id) ?? [];
      const currentHole = Math.min(...current.map((golfer) => golfer.currentHole).filter((hole) => hole >= 0));
      const aheadHole = Math.min(...ahead.map((golfer) => golfer.currentHole).filter((hole) => hole >= 0));
      if (Number.isFinite(currentHole) && Number.isFinite(aheadHole) && aheadHole <= currentHole) blockedGroups.add(ordered[index].id);
    }
  }
  for (const group of state.groups ?? []) {
    group.blocked = blockedGroups.has(group.id);
    const activeGolfers = activeByGroup.get(group.id) ?? [];
    if (group.startedAt != null && group.finishedAt == null && activeGolfers.length && state.pace) {
      const coursePace = ensureCoursePaceMetrics(state.pace, group.courseId);
      coursePace.occupiedTeeMinutes += dtMin;
      const lead = [...activeGolfers].sort((left, right) => right.currentHole - left.currentHole)[0];
      const holeId = lead?.currentHoleId ?? lead?.holeIds?.[lead.currentHole];
      if (holeId) {
        const hole = coursePace.holes[holeId] ??= { holeId, queueMinutes: 0, occupancyMinutes: 0, recoveryDelayMinutes: 0, visits: 0 };
        hole.occupancyMinutes += dtMin;
        if (group.blocked) hole.queueMinutes += dtMin;
        const recoveryDelay = activeGolfers.some((golfer) => {
          const segment = golfer.segments[golfer.segIndex];
          if (!segment || segment.kind !== "pause") return false;
          const x = Math.max(0, Math.min(course.width - 1, Math.round(segment.from.x)));
          const y = Math.max(0, Math.min(course.height - 1, Math.round(segment.from.y)));
          return ["rough", "deep_rough", "sand", "waste_area", "water", "wetland"].includes(course.tiles[y * course.width + x]);
        });
        if (recoveryDelay) hole.recoveryDelayMinutes += dtMin;
        if (group.lastRecordedHoleId !== holeId) {
          group.lastRecordedHoleId = holeId;
          hole.visits++;
        }
      }
    }
    if (group.blocked) {
      group.waitMinutes += dtMin;
      if (state.pace) state.pace.totalWaitMinutes += dtMin;
    }
  }
  const overtimeMinutes = Math.max(0, state.dayMinute - Math.max(LIVE.day.closeMinute, state.dayMinute - dtMin));
  if (overtimeMinutes > 0 && state.pace) {
    for (const courseId of new Set((state.groups ?? []).filter((group) =>
      group.courseId && group.startedAt != null && group.finishedAt == null
    ).map((group) => group.courseId))) {
      ensureCoursePaceMetrics(state.pace, courseId).overtimeCost +=
        (state.overtimeRateByCourse?.[courseId] ?? 0) * overtimeMinutes / 60;
    }
  }
  const stillPlaying: Golfer[] = [];
  const finishedForMobility: Golfer[] = [];
  for (const g of state.golfers) {
    const previousSegment = g.segIndex;
    const previousScored = g.scoredHoles;
    const group = state.groups?.find((candidate) => candidate.id === g.groupId);
    const operations = state.operationsByCourse?.[g.courseId ?? ""] ?? courseOperations(course, g.courseId);
    const blocked = !!g.groupId && blockedGroups.has(g.groupId);
    if (!g.finished && state.dayMinute >= LIVE.day.closeMinute && operations.daylightPolicy === "strict_sunset") {
      g.completionStatus = "daylight";
      g.finished = true;
      g.thought = "Play ended at the daylight cutoff";
      g.thoughtUntil = state.dayMinute + 25;
    }
    if (blocked) {
      g.waitMinutes = (g.waitMinutes ?? 0) + dtMin;
      g.hospitalityDelay = Math.max(0, (g.hospitalityDelay ?? 0) - dtMin);
      g.mood = Math.max(0, g.mood - dtMin * (0.00015 + (g.pacePreference ?? .5) * .00035));
      if (state.pace && g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).totalWaitMinutes += dtMin;
      if (!g.finished && (g.waitMinutes ?? 0) >= BALANCE.paceOperations.abandonmentWaitMinutes && g.mood <= BALANCE.paceOperations.abandonmentMood) {
        g.completionStatus = "congestion_abandonment";
        g.finished = true;
        g.thought = "The group left after an excessive wait";
        g.thoughtUntil = state.dayMinute + 25;
      }
    } else if ((g.hospitalityDelay ?? 0) > 0) {
      g.hospitalityDelay = Math.max(0, (g.hospitalityDelay ?? 0) - dtMin);
    } else {
      let paceDt = dtMin;
      if (group?.startedAt != null && g.currentHole >= 0 && (state.marshalCoverageByCourse?.[g.courseId ?? ""] ?? 0) > 0 && operations.enforcement !== "advisory") {
        const holes = Math.max(1, g.holePar.length);
        const expected = groupTimeParMinutes(holes, group.golferIds.length || 1, operations) * ((g.currentHole + 1) / holes);
        const behind = state.dayMinute - group.startedAt - expected;
        const tolerance = operations.enforcement === "strict" ? 6 : 12;
        if (behind > tolerance && state.dayMinute - (group.lastMarshalMinute ?? -999) >= 20) {
          group.lastMarshalMinute = state.dayMinute; group.interventions++;
          g.marshalInterventions = (g.marshalInterventions ?? 0) + 1;
          if (state.pace) state.pace.marshalInterventions++;
          g.thought = "A course marshal asked our group to close the gap"; g.thoughtUntil = state.dayMinute + 20;
          g.mood = Math.max(0, g.mood - .015);
          if (behind > 30 && group.interventions >= 2 && group.lastPickupHole !== g.currentHole) {
            group.lastPickupHole = g.currentHole; group.pickups++;
            g.forcedPickups = (g.forcedPickups ?? 0) + 1;
            if (state.pace) {
              state.pace.forcedPickups++;
              if (g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).pickups++;
            }
            for (let index = g.segIndex; index < g.segments.length && g.segments[index].holeIndex === g.currentHole; index++) g.segments[index].dur = Math.min(g.segments[index].dur, .02);
            g.thought = "Picked up to restore position"; g.mood = Math.max(0, g.mood - .07);
          }
        }
        if (behind > tolerance) paceDt *= 1.2;
      }
      advanceGolfer(g, paceDt, course.condition);
    }
    if (state.tournament) updateTournamentStanding(state.tournament, g);
    for (let i = previousSegment; i <= Math.min(g.segIndex, g.segments.length - 1); i++) {
      const concession = g.segments[i]?.concession;
      if (!concession || g.purchasedSegmentIndexes.includes(i) || g.wallet < concession.amount) continue;
      g.purchasedSegmentIndexes.push(i);
      g.wallet -= concession.amount;
      g.spent += concession.amount;
      g.thought = `Bought ${concession.item.toLowerCase()} for $${concession.amount}`;
      g.thoughtUntil = state.dayMinute + 18;
      const transaction = {
        id: `${state.seed}-${g.id}-${i}`,
        golferId: g.id,
        golferName: g.name,
        buildingType: concession.buildingType,
        buildingX: concession.buildingX,
        buildingY: concession.buildingY,
        item: concession.item,
        amount: concession.amount,
        atMinute: state.dayMinute,
      };
      state.concessionTransactions.push(transaction);
      state.concessionCollected += concession.amount;
      state.concessionByType[concession.buildingType] =
        (state.concessionByType[concession.buildingType] ?? 0) + concession.amount;
      cashDelta += concession.amount;
    }
    if (g.scoredHoles > previousScored && (state.beverageCoverageByCourse?.[g.courseId ?? ""] ?? 0) > 0 && operations.beverage.menu !== "off" && operations.beverage.passes > 0) {
      const interval = Math.max(1, Math.ceil(g.holePar.length / operations.beverage.passes));
      if (g.scoredHoles % interval === 0 && g.wallet >= operations.beverage.price) {
        const alcoholic = operations.beverage.menu === "beer_wine" && g.archetype !== "junior";
        if (alcoholic && (g.alcoholUnits ?? 0) >= operations.beverage.alcoholLimit) {
          if (state.pace) state.pace.serviceRefusals++;
          g.thought = "Beverage service declined another drink"; g.thoughtUntil = state.dayMinute + 18;
        } else {
          const amount = operations.beverage.price;
          g.wallet -= amount; g.spent += amount; g.drinksServed = (g.drinksServed ?? 0) + 1;
          g.hospitalityDelay = (g.hospitalityDelay ?? 0) + 2;
          if (alcoholic) { g.alcoholUnits = (g.alcoholUnits ?? 0) + 1; if (state.pace) state.pace.alcoholicDrinks++; }
          g.mood = Math.min(1, g.mood + .025);
          const transaction = { id: `${state.seed}-${g.id}-bev-${g.scoredHoles}`, golferId: g.id, golferName: g.name, buildingType: "snack_bar" as const, buildingX: Math.round(g.pos.x), buildingY: Math.round(g.pos.y), item: alcoholic ? "Beer & snack" : "Refreshment", amount, atMinute: state.dayMinute };
          state.concessionTransactions.push(transaction); state.concessionCollected += amount; state.concessionByType.snack_bar = (state.concessionByType.snack_bar ?? 0) + amount;
          cashDelta += amount;
          if (state.pace) state.pace.beverageRevenue += amount;
          if (state.pace && g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).beverageRevenue += amount;
          if ((g.alcoholUnits ?? 0) >= 3 && ((state.seed + g.id * 17 + g.scoredHoles * 13) % 11 === 0)) {
            g.disorderIncidents = (g.disorderIncidents ?? 0) + 1; g.mood = Math.max(0, g.mood - .1); g.hospitalityDelay += 5;
            g.thought = "The group became disruptive"; g.thoughtUntil = state.dayMinute + 25;
            if (state.pace) state.pace.disorderIncidents++;
            if (state.pace && g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).incidents++;
          }
        }
      }
    }
    if (g.finished) {
      finishedForMobility.push(g);
      applyGolferMobilityReaction(state, g);
      const completed = g.completionStatus !== "daylight" &&
        g.completionStatus !== "congestion_abandonment" &&
        g.scoredHoles >= g.holePar.length;
      const courseId = g.courseId ?? activeCourseLayout(course).id;
      const roundCourse = courseForLayout(course, courseId);
      const greenFee = layoutById(course, courseId)?.greenFee ?? course.baseGreenFee;
      if (state.pace) {
        const coursePace = ensureCoursePaceMetrics(state.pace, courseId);
        const duration = Math.max(0, state.dayMinute - (g.groupStartedAt ?? group?.startedAt ?? state.dayMinute));
        const expected = groupTimeParMinutes(Math.max(1, g.holePar.length), group?.golferIds.length || 1, operations);
        const cohort = cohortFromGolfer(g.personality.skill, g.personality.patience);
        const cohortMetrics = coursePace.cohorts[cohort];
        coursePace.roundDurations.push(duration);
        if (coursePace.roundDurations.length > BALANCE.paceOperations.maxDurationSamplesPerDay) coursePace.roundDurations.shift();
        if (completed) {
          coursePace.roundsCompleted++;
          coursePace.satisfaction += g.mood * 100;
        } else {
          coursePace.roundsIncomplete++;
        }
        cohortMetrics.samples++;
        cohortMetrics.durationMinutes += duration;
        cohortMetrics.timeParVarianceMinutes += duration - expected;
        cohortMetrics.waitMinutes += g.waitMinutes ?? 0;
        cohortMetrics.pickups += g.forcedPickups ?? 0;
        cohortMetrics.abandonments += completed ? 0 : 1;
        cohortMetrics.satisfaction += g.mood * 100;

        const progress = g.holePar.length ? g.scoredHoles / g.holePar.length : 0;
        let compensationRate = 0;
        if (g.completionStatus === "daylight") {
          compensationRate = progress < 0.5
            ? BALANCE.paceOperations.daylightEarlyRefundRate
            : BALANCE.paceOperations.daylightLateRefundRate;
        } else if (g.completionStatus === "congestion_abandonment") {
          compensationRate = BALANCE.paceOperations.congestionCreditRate;
        } else if ((g.forcedPickups ?? 0) > 0) {
          compensationRate = Math.min(0.5, (g.forcedPickups ?? 0) * BALANCE.paceOperations.marshalPickupCreditRate);
        }
        if (compensationRate > 0) {
          const amount = Math.round(greenFee * compensationRate * 100) / 100;
          coursePace.compensationCost += amount;
          if (operations.compensationPolicy === "refund" || g.completionStatus === "daylight") coursePace.refunds += amount;
          else if (operations.compensationPolicy === "credit") coursePace.credits += amount;
          else coursePace.goodwillVouchers += amount;
        }
      }
      state.satisfactionSum += g.mood * 100;
      state.roundsFinished++;
      const reaction = classifyReaction(g);
      if (reaction.promoter) state.promoters++;
      if (reaction.detractor) state.detractors++;
      if (reaction.willReturn) state.willReturnCount++;
      const observation = observeM49Round({
        course: roundCourse,
        golfer: g,
        courseId,
        greenFee,
        completed,
        returnIntent: reaction.willReturn,
        recommend: reaction.promoter,
        condition: roundCourse.condition,
        mobility: observedM49MobilityEvidence({ live: state, golfer: g, paceMinutes: Math.max(0, state.dayMinute - (g.groupStartedAt ?? group?.startedAt ?? state.dayMinute)) }),
      });
      state.observedRounds ??= [];
      state.observedRounds.push(observation);
      if (state.observedRounds.length > 240) state.observedRounds.splice(0, state.observedRounds.length - 240);
      const courseStats = g.courseId ? state.perCourse?.[g.courseId] : undefined;
      if (courseStats) {
        if (completed) courseStats.roundsFinished++;
        courseStats.satisfactionSum += g.mood * 100;
        if (reaction.promoter) courseStats.promoters++;
        if (reaction.detractor) courseStats.detractors++;
        if (reaction.willReturn) courseStats.willReturnCount++;
      }
      finishedThisStep++;
      if (completed) completedRounds.push({
        golferId: g.id,
        golferName: g.name,
        archetype: g.archetype,
        score: g.strokes,
        scoreToPar: g.scoreToPar,
        holePar: g.holePar.slice(),
        holeStrokes: g.holeStrokes.slice(),
        mood: g.mood,
        courseId: g.courseId,
        courseName: g.courseName,
        holeIds: g.holeIds?.slice(),
        tournamentId: g.tournamentId,
        tournamentEntrantId: g.tournamentEntrantId,
        teeSet: g.teeSet,
        waitMinutes: g.waitMinutes ?? 0,
        capabilities: g.capabilities,
        holePlans: g.holePlans?.slice(),
        shotOutcomes: g.shotOutcomes?.slice(),
        holeReactions: g.holeReactions?.slice(),
        shots: g.shotOutcomes?.length ? g.shotOutcomes.map((outcome) => shotRecordFromOutcome(outcome)) : (() => {
          const numbers = new Map<string, number>();
          return g.segments.filter((segment) => segment.kind === "flight").map((segment) => {
            const holeId = segment.holeId ?? g.holeIds?.[segment.holeIndex] ?? `hole-${segment.holeIndex + 1}`;
            const shotNumber = (numbers.get(holeId) ?? 0) + 1;
            numbers.set(holeId, shotNumber);
            const x = Math.max(0, Math.min(course.width - 1, Math.round(segment.from.x)));
            const y = Math.max(0, Math.min(course.height - 1, Math.round(segment.from.y)));
            const lie = course.tiles[y * course.width + x] ?? "rough";
            const shotType = segment.shot === "putt"
              ? "putt" as const
              : shotNumber === 1 && lie === "tee"
                ? "drive" as const
                : ["rough", "deep_rough", "sand", "waste_area", "water", "wetland"].includes(lie)
                  ? "recovery" as const
                  : "approach" as const;
            return {
              id: `live-shot-${g.id}-${holeId}-${shotNumber}`,
              holeId,
              shotNumber,
              shotType,
              from: { ...segment.from },
              landing: { ...segment.to },
              rest: { ...segment.to },
              lieBefore: lie,
              lieAfter: course.tiles[Math.max(0, Math.min(course.height - 1, Math.round(segment.to.y))) * course.width + Math.max(0, Math.min(course.width - 1, Math.round(segment.to.x)))] ?? "rough",
            };
          });
        })(),
      });
    } else {
      stillPlaying.push(g);
    }
  }
  state.golfers = stillPlaying;
  releaseFinishedMobilityGroups(state, finishedForMobility);
  const activeIds = new Set(stillPlaying.map((golfer) => golfer.id));
  for (const group of state.groups ?? []) if (group.startedAt != null && group.finishedAt == null && group.golferIds.length > 0 && group.golferIds.every((id) => !activeIds.has(id))) {
    group.finishedAt = state.dayMinute;
    if (state.pace) {
      state.pace.groupsFinished++;
      ensureCoursePaceMetrics(state.pace, group.courseId).groupsFinished++;
    }
  }

  const allArrived = state.nextArrivalIdx >= state.arrivals.length;
  // Tournament days only ever arrive the field (no walk-up traffic), so once
  // every entrant is off the course the event is over — waiting for the
  // ordinary closeMinute leaves the tournament (and its `active` status)
  // hanging for the rest of the in-game day after the last group holes out.
  const closedForBusiness = state.tournament ? true : state.dayMinute >= LIVE.day.closeMinute;
  if (closedForBusiness && allArrived && state.golfers.length === 0) {
    state.dayOver = true;
  }

  return { cashDelta, finishedThisStep, completedRounds };
}

function shotRecordFromOutcome(outcome: LiveShotOutcome): NonNullable<CompletedRound["shots"]>[number] {
  const shotType = outcome.technique === "normal" && outcome.shotNumber === 1 && outcome.lieBefore === "tee"
    ? "drive" as const
    : outcome.intent === "recovery" || ["rough", "deep_rough", "sand", "waste_area", "water", "wetland"].includes(outcome.lieBefore)
      ? "recovery" as const
      : outcome.club === "Putter" || outcome.lieBefore === "green"
        ? "putt" as const
        : "approach" as const;
  return {
    id: outcome.id,
    holeId: outcome.holeId,
    shotNumber: outcome.shotNumber,
    shotType,
    from: { ...outcome.from },
    landing: { ...outcome.landing },
    rest: { ...outcome.rest },
    lieBefore: outcome.lieBefore,
    lieAfter: outcome.lieAfter,
  };
}

export function liveRenderData(state: LiveState, out: GolferRenderData[] = []): GolferRenderData[] {
  const mobilityRiders = new Map<number, { assignmentId: string; unitId?: string; mode: "walk" | "pushcart" | "riding_cart" }>();
  for (const assignment of state.m51?.assignments ?? []) {
    if (assignment.status !== "active") continue;
    for (const rider of assignment.riders) mobilityRiders.set(rider.golferId, { assignmentId: assignment.id, unitId: rider.fleetUnitId, mode: assignment.mode });
    if (assignment.mode === "walk") for (const golfer of state.golfers.filter((golfer) => golfer.groupId === assignment.groupId)) mobilityRiders.set(golfer.id, { assignmentId: assignment.id, mode: "walk" });
  }
  let outIndex = 0;
  for (const g of state.golfers) {
    // Animation facts (ZKU-153): current segment kind/progress, the stroke
    // being played, and a facing direction. Pure derivation — no sim state
    // is touched. The pause before a flight is the address/swing windup, so
    // its facing and shot come from the upcoming flight; that lets the
    // renderer land the contact frame exactly when the ball launches.
    const seg = g.segments[g.segIndex];
    const segKind = seg?.kind ?? null;
    const segT = seg ? (seg.dur > 0 ? Math.max(0, Math.min(1, g.segElapsed / seg.dur)) : 1) : 0;
    let shot: "swing" | "putt" | null = null;
    let dirX = 0;
    let dirY = 0;
    if (seg) {
      let aim: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
      if (seg.kind === "walk") {
        aim = seg;
      } else if (seg.kind === "flight") {
        shot = seg.shot ?? "swing";
        aim = seg;
      } else {
        const next = g.segments[g.segIndex + 1];
        if (next?.kind === "flight") {
          shot = next.shot ?? "swing";
          aim = next;
        }
      }
      if (aim) {
        const dx = aim.to.x - aim.from.x;
        const dy = aim.to.y - aim.from.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) {
          dirX = dx / len;
          dirY = dy / len;
        }
      }
    }
    const mobility = mobilityRiders.get(g.id);
    const next: GolferRenderData = {
      id: g.id,
      personId: g.personId,
      x: g.pos.x,
      y: g.pos.y,
      ballX: g.ball ? g.ball.x : null,
      ballY: g.ball ? g.ball.y : null,
      ballToX: g.ball && seg?.kind === "flight" ? seg.to.x : null,
      ballToY: g.ball && seg?.kind === "flight" ? seg.to.y : null,
      color: g.color,
      mood: g.mood,
      thought: g.thought,
      archetype: g.archetype,
      teeSet: g.teeSet ?? preferredTeeForArchetype(g.archetype),
      pinRotation: g.pinRotation ?? "A",
      courseId: g.courseId,
      currentHoleId: g.currentHoleId,
      segKind,
      segT,
      shot,
      dirX,
      dirY,
      scoredHoles: g.scoredHoles,
      lastHoleDelta:
        g.scoredHoles > 0
          ? (g.holeStrokes[g.scoredHoles - 1] ?? 0) - (g.holePar[g.scoredHoles - 1] ?? 0)
          : 0,
      intent: g.currentIntent?.kind ?? null,
      mobilityAssignmentId: mobility?.assignmentId ?? g.mobilityAssignmentId,
      mobilityUnitId: mobility?.unitId,
      mobilityUnitMode: mobility?.mode ?? g.mobilityMode,
    };
    if (out[outIndex]) Object.assign(out[outIndex], next);
    else out.push(next);
    outIndex += 1;
  }
  out.length = outIndex;
  return out;
}

export function avgSatisfactionSoFar(state: LiveState): number {
  if (state.roundsFinished === 0) return LIVE.mood.start * 100;
  return state.satisfactionSum / state.roundsFinished;
}

// Aggregate the day's real finished-round reactions for the reputation model.
export function roundReactions(state: LiveState): RoundReactions {
  const rounds = state.roundsFinished;
  return {
    rounds,
    avgSatisfaction: avgSatisfactionSoFar(state),
    promoters: state.promoters,
    detractors: state.detractors,
    willReturnRate: rounds > 0 ? state.willReturnCount / rounds : 0,
    observations: state.observedRounds?.slice() ?? [],
  };
}

// Index of the n-th (0-based) currently-valid, complete hole, or -1 if there
// are fewer than n+1 of them. Used to find the hole a golfer should resume on.
function nthValidHoleIndex(course: Course, n: number): number {
  const summary = scoreCourseHoles(course);
  let count = 0;
  for (let i = 0; i < course.holes.length; i++) {
    const hole = course.holes[i];
    const info = summary.holes[i];
    if (!hole.tee || !hole.green || !info?.isComplete || !info?.isValid) continue;
    if (count === n) return i;
    count++;
  }
  return -1;
}

// Re-plan every in-progress golfer against an edited course (ZKU-136).
//
// Holes already scored are kept as-is; the golfer restarts their current hole
// on the new terrain, walking from wherever they stand to that hole's tee. This
// freezes committed history but stops golfers from walking a stale itinerary
// (e.g. flying over freshly-painted water) for the rest of the round.
export function reconcileGolfers(state: LiveState, course: Course): void {
  state.reconcileEpoch++;
  state.walkCache.clear(); // terrain changed → cached routes are stale
  const exit = entryPoint(course);
  for (const g of state.golfers) {
    if (g.finished) continue;
    // The hole to resume on is the next one not yet folded into the score.
    const routing = g.holeIds?.length ? courseForHoleIds(course, g.holeIds, g.courseId) : course;
    const startHole = nthValidHoleIndex(routing, g.scoredHoles);
    if (startHole < 0) continue; // nothing left to play; let them walk off

    const rng = mulberry32(state.seed + g.id * 911 + state.reconcileEpoch * 17);
    const from: Point = { x: g.pos.x, y: g.pos.y };
    const replanned = g.capabilities
      ? buildStrategicGolferRound({
          course: routing,
          entry: from,
          exit,
          rng,
          personality: g.personality,
          capabilities: g.capabilities,
          route: makeRouter(routing, state.walkCache),
          wallet: g.wallet,
          teeSet: g.teeSet,
          pinRotation: g.pinRotation,
          startHole,
          skipPreRoundPurchases: true,
        })
      : planFromHole({
          course: routing,
          profile: getGolferProfile(solverProfileForSkill(g.personality.skill), routing),
          personality: g.personality,
          rng,
          startHole,
          cursor: from,
          exit,
          route: makeRouter(routing, state.walkCache),
          wallet: g.wallet,
          teeSet: g.teeSet,
          pinRotation: g.pinRotation,
        });
    replanned.segments = replanned.segments.map((segment) => ({ ...segment, holeId: segment.holeIndex >= 0 ? routing.holes[segment.holeIndex]?.id : undefined }));

    // Splice: keep scored holes, replace the unplayed tail with the new plan.
    g.holePar = g.holePar.slice(0, g.scoredHoles).concat(replanned.holePar);
    g.holeStrokes = g.holeStrokes.slice(0, g.scoredHoles).concat(replanned.holeStrokes);
    if (g.capabilities) {
      const completedHoleIds = new Set((g.holePlans ?? []).slice(0, g.scoredHoles).map((plan) => plan.holeId));
      g.holePlans = (g.holePlans ?? []).slice(0, g.scoredHoles).concat(replanned.holePlans ?? []);
      g.shotOutcomes = (g.shotOutcomes ?? []).filter((outcome) => completedHoleIds.has(outcome.holeId)).concat(replanned.shotOutcomes ?? []);
      g.holeReactions = (g.holeReactions ?? []).slice(0, g.scoredHoles).concat(replanned.holeReactions ?? []);
      g.currentIntent = replanned.holePlans?.[0]?.chosen;
    }
    g.segments = replanned.segments;
    g.segIndex = 0;
    g.segElapsed = 0;
    g.ball = null;
    g.currentHole = startHole;
    reapplyGroupMobility(state, routing, g);
  }
}
