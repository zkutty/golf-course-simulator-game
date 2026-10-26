import { useCallback, useEffect, useRef, useState } from "react";
import type { Course, CourseOperations, PacePreset, PinRotation, TeeSet, WeekResult, World } from "../game/models/types";
import { LIVE, type SpeedName } from "../game/live/liveConfig";
import {
  createLiveState,
  courseCanReceiveLiveArrivals,
  ensureOpeningDayArrivals,
  liveRenderData,
  reconcileGolfers,
  roundReactions,
  shouldHoldUnopenedLiveDay,
  stepLive,
  type StepEvents,
} from "../game/live/simulation";
import { commitDay } from "../game/live/commitDay";
import type { DayResult, GolferRenderData, LiveState } from "../game/live/types";
import {
  restoreLiveSimulation,
  snapshotLiveSimulation,
  type LiveSimulationSnapshotV1,
  type WeekReportPendingV1,
} from "../game/live/persistence";
import { deriveLiveAudioEvents, type LiveAudioEvent } from "../audio/liveEvents";
import type { CompletedRound } from "../game/retention/types";
import type { GolferCapabilities, HoleReaction, ShotIntent, StrategicHolePlan, LiveShotOutcome } from "../game/live/m47Types";
import { completeTournament, prepareTournamentDay, sortedStandings } from "../game/tournaments/tournaments";
import type { TournamentStanding, TournamentTier } from "../game/tournaments/types";
import { activeCourseLayout, updateLayout } from "../game/models/courseLayouts";
import { courseOperations, PACE_PRESETS } from "../game/live/pace";
import { consumeClock, FIXED_GAME_STEP_MINUTES } from "../game/live/clock";
import { appendDayToLedger, createWeekLedger, weekResultFromLedger } from "../game/live/weeklyLedger";
import { recordLivingClubRound } from "../game/livingClub/livingClub";
import {
  diagnosePaceBottlenecks,
  paceIdentity,
  paceReports,
  type PaceAdvisorFinding,
  type PaceIdentitySummary,
  type PaceReportSummary,
} from "../game/live/paceHistory";
import { buildMobilityOperationsReports } from "../game/m51/operationsReport";
import { livePropertyShotTraces } from "../game/live/safetyEvidence";
import { currentShotEvidence, type CurrentShotEvidence } from "../game/live/currentShotEvidence";
import { createDayAdvanceRequest, runDayAdvanceChunk, type DayAdvanceRequest } from "../game/live/dayAdvance";
import { acquireFocusedShot, focusedShotAudioEvents, focusedShotMatches, projectFocusedShot, restoreFocusedShot, snapshotFocusedShot, type FocusedShotOwner } from "../game/live/focusedShot";
import { advanceShotPacingCursor, shotPacingFrame, type ShotPacingFrame } from "../game/live/shotPacing";
import { consumeControlledTimeStep, observeControlledTime, type ControlledTimeLedger, type ControlledTimeObservation } from "../game/live/controlledTime";

const DAYS_PER_WEEK = 7;
const STATUS_THROTTLE_MS = 150;
export type CourseOperationsPatch = Partial<Omit<CourseOperations, "beverage">> & { beverage?: Partial<CourseOperations["beverage"]> };
export type LiveDayAdvanceGoal = "next-event" | "finish-day";
export type LiveAdvanceDisabledReason = "controlled-round" | "unopened" | "unavailable" | null;

export interface SelectedGolferDetail {
  id: number;
  personId?: string;
  name: string;
  archetype: string;
  color: string;
  currentHole: number; // 0-based; -1 before first / after last
  strokes: number;
  scoreToPar: number;
  mood: number;
  thought: string | null;
  holePar: number[];
  holeStrokes: number[];
  scoredHoles: number;
  spent: number;
  wallet: number;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  courseId?: string;
  courseName?: string;
  currentHoleId?: string;
  capabilities?: GolferCapabilities;
  currentIntent?: ShotIntent;
  holePlans?: StrategicHolePlan[];
  shotOutcomes?: LiveShotOutcome[];
  holeReactions?: HoleReaction[];
  currentShotEvidence?: CurrentShotEvidence;
  mobilityMode?: "walk" | "pushcart" | "riding_cart";
  mobilityPredictedWalkingMinutes?: number;
  mobilityActualTravelMinutes?: number;
  mobilityWalkingFallbackMinutes?: number;
  mobilityOffPathTiles?: number;
}

export interface LiveStatus {
  speed: SpeedName;
  dayIndex: number; // 0..6 within the week
  dayMinute: number;
  clockLabel: string;
  onCourse: number;
  roundsToday: number;
  greenFeesToday: number;
  concessionsToday: number;
  arrivalsRemaining: number;
  nextArrivalMinute: number | null;
  lastDay: DayResult | null;
  selected: SelectedGolferDetail | null;
  golfers: Array<Pick<SelectedGolferDetail, "id" | "personId" | "name" | "archetype" | "currentHole" | "scoreToPar" | "mood" | "courseId" | "currentHoleId">>;
  tournament: null | {
    eventId: string;
    name: string;
    tier: TournamentTier;
    teeSet: TeeSet;
    pinRotation: PinRotation;
    standings: TournamentStanding[];
  };
  pace: {
    courseId: string;
    preset: PacePreset;
    teeIntervalMinutes: number;
    maxGroupSize: number;
    groupsOnCourse: number;
    blockedGroups: number;
    averageWaitMinutes: number;
    interventions: number;
    pickups: number;
    beverageRevenue: number;
    alcoholicDrinks: number;
    incidents: number;
    marshalCoverage: number;
    beverageCoverage: number;
    beverageMenu: CourseOperations["beverage"]["menu"];
    lastTeeMinute: number;
    daylightPolicy: CourseOperations["daylightPolicy"];
    compensationPolicy: CourseOperations["compensationPolicy"];
    identity: PaceIdentitySummary;
    bottlenecks: PaceAdvisorFinding[];
    reports7: PaceReportSummary[];
    reports28: PaceReportSummary[];
    overtimeCost: number;
    compensationCost: number;
    refunds: number;
    credits: number;
    goodwillVouchers: number;
  };
  mobility: ReturnType<typeof buildMobilityOperationsReports>;
}

function paceStatus(live: LiveState, course: Course, world: World): LiveStatus["pace"] {
  const layout = activeCourseLayout(course);
  const operations = courseOperations(course, layout.id);
  const active = (live.groups ?? []).filter((group) => group.courseId === layout.id && group.startedAt != null && group.finishedAt == null);
  const coursePace = live.pace?.perCourse[layout.id];
  return {
    courseId: layout.id, preset: operations.preset, teeIntervalMinutes: operations.teeIntervalMinutes,
    maxGroupSize: operations.maxGroupSize, groupsOnCourse: active.length,
    blockedGroups: active.filter((group) => group.blocked).length,
    averageWaitMinutes: active.length ? active.reduce((sum, group) => sum + group.waitMinutes, 0) / active.length : 0,
    interventions: live.pace?.marshalInterventions ?? 0, pickups: live.pace?.forcedPickups ?? 0,
    beverageRevenue: live.pace?.beverageRevenue ?? 0, alcoholicDrinks: live.pace?.alcoholicDrinks ?? 0,
    incidents: live.pace?.disorderIncidents ?? 0,
    marshalCoverage: live.marshalCoverageByCourse?.[layout.id] ?? 0,
    beverageCoverage: live.beverageCoverageByCourse?.[layout.id] ?? 0, beverageMenu: operations.beverage.menu,
    lastTeeMinute: operations.lastTeeMinute,
    daylightPolicy: operations.daylightPolicy,
    compensationPolicy: operations.compensationPolicy,
    identity: paceIdentity(world, layout.id, operations.preset === "relaxed" ? 0 : operations.preset === "brisk" ? 1 : 0.5),
    bottlenecks: diagnosePaceBottlenecks(world, course, layout.id, coursePace, live.marshalCoverageByCourse?.[layout.id] ?? 0),
    reports7: paceReports(world, course, 7),
    reports28: paceReports(world, course, 28),
    overtimeCost: coursePace?.overtimeCost ?? 0,
    compensationCost: coursePace?.compensationCost ?? 0,
    refunds: coursePace?.refunds ?? 0,
    credits: coursePace?.credits ?? 0,
    goodwillVouchers: coursePace?.goodwillVouchers ?? 0,
  };
}

function buildSelected(
  live: LiveState | null,
  id: number | null
): SelectedGolferDetail | null {
  if (live == null || id == null) return null;
  const g = live.golfers.find((x) => x.id === id);
  if (!g) return null;
  return {
    id: g.id,
    personId: g.personId,
    name: g.name,
    archetype: g.archetype,
    color: g.color,
    currentHole: g.currentHole,
    strokes: g.strokes,
    scoreToPar: g.scoreToPar,
    mood: g.mood,
    thought: g.thought,
    holePar: g.holePar,
    holeStrokes: g.holeStrokes,
    scoredHoles: g.scoredHoles,
    spent: g.spent,
    wallet: g.wallet,
    teeSet: g.teeSet ?? "member",
    pinRotation: g.pinRotation ?? "A",
    courseId: g.courseId,
    courseName: g.courseName,
    currentHoleId: g.currentHoleId,
    capabilities: g.capabilities,
    currentIntent: g.currentIntent,
    holePlans: g.holePlans,
    shotOutcomes: g.shotOutcomes,
    holeReactions: g.holeReactions,
    currentShotEvidence: currentShotEvidence(g),
    mobilityMode: g.mobilityMode,
    mobilityPredictedWalkingMinutes: g.mobilityPredictedWalkingMinutes,
    mobilityActualTravelMinutes: g.mobilityActualTravelMinutes,
    mobilityWalkingFallbackMinutes: g.mobilityWalkingFallbackMinutes,
    mobilityOffPathTiles: g.mobilityOffPathTiles,
  };
}

function clockLabel(dayMinute: number): string {
  const total = Math.max(0, Math.floor(dayMinute));
  const hour24 = LIVE.day.displayStartHour + Math.floor(total / 60);
  const minute = total % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${period}`;
}

// Drives the real-time "living course": a game clock that spawns golfers, walks
// them through their rounds, banks green fees live, and commits each finished
// day into the economy/reputation model.
export function useLiveSimulation(args: {
  enabled: boolean;
  course: Course;
  world: World;
  setWorld: (updater: (w: World) => World) => void;
  setCourse: (updater: (c: Course) => Course) => void;
  onDayCommitted?: (result: DayResult, live: LiveSimulationSnapshotV1, completedWeek?: {
    week: number;
    result: WeekResult;
    resumeSpeed: Exclude<SpeedName, "paused">;
    cash: number;
    reputation: number;
  }) => void;
  onCashTick?: () => void;
  onAudioEvent?: (event: LiveAudioEvent) => void;
  onRoundCompleted?: (round: CompletedRound, dayIndex: number) => void;
  publicThreeHoleOperation?: boolean;
  followSelected?: boolean;
  followGolferId?: number | null;
  presentationPaused?: boolean;
  animationsEnabled?: boolean;
  controlledRoundActive?: boolean;
  getLatestWorld?: () => World;
  controlledTimeObservation?: ControlledTimeObservation | null;
  controlledPlaybackActive?: boolean;
}) {
  const { enabled, course, world, setWorld, setCourse, onDayCommitted, onCashTick, onAudioEvent, onRoundCompleted, publicThreeHoleOperation = false } = args;

  const [speed, setSpeedState] = useState<SpeedName>("paused");
  const [status, setStatus] = useState<LiveStatus>({
    speed: "paused",
    dayIndex: 0,
    dayMinute: 0,
    clockLabel: clockLabel(0),
    onCourse: 0,
    roundsToday: 0,
    greenFeesToday: 0,
    concessionsToday: 0,
    arrivalsRemaining: 0,
    nextArrivalMinute: null,
    lastDay: null,
    selected: null,
    golfers: [],
    tournament: null,
    pace: {
      courseId: "course-primary", preset: "balanced", teeIntervalMinutes: 10, maxGroupSize: 4,
      groupsOnCourse: 0, blockedGroups: 0, averageWaitMinutes: 0, interventions: 0,
      pickups: 0, beverageRevenue: 0, alcoholicDrinks: 0, incidents: 0, marshalCoverage: 0,
      beverageCoverage: 0, beverageMenu: "refreshments", lastTeeMinute: 600,
      daylightPolicy: "finish_started", compensationPolicy: "credit",
      identity: { score: 0.5, label: "balanced", samples: 0, cohorts: { skilled_impatient: 0.5, novice_social: 0.5, general: 0.5 } },
      bottlenecks: [], reports7: [], reports28: [], overtimeCost: 0, compensationCost: 0,
      refunds: 0, credits: 0, goodwillVouchers: 0,
    },
    mobility: buildMobilityOperationsReports({ course, world, week: world.week, dayIndex: 0 }),
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focusedShot, setFocusedShot] = useState<ShotPacingFrame | null>(null);
  const [advancing, setAdvancing] = useState<LiveDayAdvanceGoal | null>(null);
  const [controlledTimePendingSteps, setControlledTimePendingSteps] = useState(0);

  // Latest inputs, mirrored into refs so the rAF loop never restarts. Speed is
  // updated synchronously by setSpeed/restore so a stale React effect can never
  // overwrite a just-selected tier at a day boundary.
  const courseRef = useRef(course);
  const worldRef = useRef(world);
  const speedRef = useRef<SpeedName>(speed);
  const liveRef = useRef<LiveState | null>(null);
  const golfersRef = useRef<GolferRenderData[]>([]);
  // Alternate two retained render buffers so 100+ entity frames do not
  // allocate a new array/object graph every rAF. The previous buffer remains
  // intact long enough for audio edge detection.
  const renderBuffersRef = useRef<[GolferRenderData[], GolferRenderData[]]>([[], []]);
  const renderBufferIndexRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const pendingCashRef = useRef(0);
  const clockRemainderRef = useRef(0);
  const weekLedgerRef = useRef(createWeekLedger(world.week));
  const lastStatusAtRef = useRef(0);
  const selectedIdRef = useRef<number | null>(null);
  const onDayRef = useRef(onDayCommitted);
  const onCashRef = useRef(onCashTick);
  const onAudioRef = useRef(onAudioEvent);
  const onRoundRef = useRef(onRoundCompleted);
  const skipNextReconcileRef = useRef(false);
  const operationPolicyRef = useRef({ tutorialThreeHolePreview: publicThreeHoleOperation });
  const courseCanReceiveArrivalsRef = useRef(courseCanReceiveLiveArrivals(course, { tutorialThreeHolePreview: publicThreeHoleOperation }));
  const runtimeRef = useRef(args);
  const focusedOwnerRef = useRef<FocusedShotOwner | null>(null);
  const focusedDrainRef = useRef<DayAdvanceRequest | null>(null);
  const dayAdvanceRef = useRef<DayAdvanceRequest | null>(null);
  const controlledTimeRef = useRef<ControlledTimeLedger | null>(null);
  const controlledAdvanceRef = useRef<DayAdvanceRequest | null>(null);
  const weekReportPendingRef = useRef<WeekReportPendingV1 | null>(null);

  const clearDayAdvance = useCallback(() => {
    dayAdvanceRef.current = null;
    setAdvancing(null);
  }, []);
  const cancelFocusedShot = useCallback(() => {
    focusedOwnerRef.current = null;
    focusedDrainRef.current = null;
    setFocusedShot(null);
  }, []);
  const observeControlledTimeNow = useCallback((observation: ControlledTimeObservation): boolean => {
    const result = observeControlledTime(controlledTimeRef.current, observation);
    if (result.status === "invalid" || result.status === "pending-scope") return false;
    controlledTimeRef.current = result.ledger;
    setControlledTimePendingSteps(result.ledger?.pendingSteps ?? 0);
    return true;
  }, []);
  const latestWorld = useCallback(() => {
    const current = runtimeRef.current.getLatestWorld?.();
    if (current) worldRef.current = current;
    return worldRef.current;
  }, []);
  const followId = useCallback(() => runtimeRef.current.followGolferId !== undefined
    ? runtimeRef.current.followGolferId : runtimeRef.current.followSelected ? selectedIdRef.current : null, []);
  const publishFocusedShot = useCallback(() => {
    const owner = focusedOwnerRef.current;
    const next = owner ? shotPacingFrame(owner.plan, owner.cursor) : null;
    setFocusedShot((previous) => previous?.key === next?.key && previous?.phase === next?.phase
      && Math.floor((previous?.progress ?? 0) * 20) === Math.floor((next?.progress ?? 0) * 20) ? previous : next);
  }, []);

  const buildRenderData = useCallback((live: LiveState) => {
    renderBufferIndexRef.current = renderBufferIndexRef.current === 0 ? 1 : 0;
    const currentWorld = worldRef.current;
    const render = liveRenderData(live, renderBuffersRef.current[renderBufferIndexRef.current], { runSeed: currentWorld.runSeed, week: currentWorld.week });
    if (focusedOwnerRef.current) projectFocusedShot(focusedOwnerRef.current, render,
      focusedShotMatches(focusedOwnerRef.current, live, currentWorld, followId(), focusedDrainRef.current !== null), courseRef.current);
    return render;
  }, [followId]);

  useEffect(() => {
    runtimeRef.current = args;
    courseRef.current = course;
    worldRef.current = world;
    onDayRef.current = onDayCommitted;
    onCashRef.current = onCashTick;
    onAudioRef.current = onAudioEvent;
    onRoundRef.current = onRoundCompleted;
    operationPolicyRef.current = { tutorialThreeHolePreview: publicThreeHoleOperation };
  });

  useEffect(() => {
    if (!args.controlledTimeObservation) return;
    observeControlledTimeNow(args.controlledTimeObservation);
  }, [args.controlledTimeObservation, observeControlledTimeNow]);

  // Detect course *geometry* edits (terrain/holes/obstacles) and re-plan any
  // golfers already on the course so they don't walk a stale itinerary. The
  // reducer replaces these arrays on every edit, while daily condition updates
  // keep the same references — so identity comparison isolates real edits.
  const geomRef = useRef({ tiles: course.tiles, holes: course.holes, obstacles: course.obstacles, buildings: course.buildings, activePinRotation: course.activePinRotation ?? "A" });
  useEffect(() => {
    const prev = geomRef.current;
    const pinChanged = prev.activePinRotation !== (course.activePinRotation ?? "A");
    const changed = pinChanged ||
      prev.tiles !== course.tiles ||
      prev.holes !== course.holes ||
      prev.obstacles !== course.obstacles ||
      prev.buildings !== course.buildings;
    const live = liveRef.current;
    courseCanReceiveArrivalsRef.current = courseCanReceiveLiveArrivals(course, operationPolicyRef.current);
    if (enabled && live) ensureOpeningDayArrivals(live, course, worldRef.current, operationPolicyRef.current);
    if (!changed) return;
    geomRef.current = { tiles: course.tiles, holes: course.holes, obstacles: course.obstacles, buildings: course.buildings, activePinRotation: course.activePinRotation ?? "A" };
    const skipGolferReconcile = skipNextReconcileRef.current;
    skipNextReconcileRef.current = false;
    if (skipGolferReconcile) return;
    if (enabled && live && live.golfers.length > 0) {
      cancelFocusedShot();
      clearDayAdvance();
      reconcileGolfers(live, course, pinChanged ? "daily-pin" : "geometry");
      golfersRef.current = buildRenderData(live);
    }
  }, [buildRenderData, clearDayAdvance, cancelFocusedShot, enabled, course, publicThreeHoleOperation]);

  const flushCash = useCallback(() => {
    const d = pendingCashRef.current;
    if (d === 0) return;
    pendingCashRef.current = 0;
    const current = latestWorld();
    worldRef.current = { ...current, cash: current.cash + d };
    setWorld((w) => ({ ...w, cash: w.cash + d }));
    onCashRef.current?.();
  }, [latestWorld, setWorld]);

  const publishStatus = useCallback((live: LiveState) => {
    const selected = buildSelected(live, selectedIdRef.current);
    // The selected golfer finished/left the course — drop the selection.
    if (selectedIdRef.current != null && selected == null) {
      selectedIdRef.current = null;
      setSelectedId(null);
    }
    setStatus({
      speed: speedRef.current,
      dayIndex: live.dayIndex,
      dayMinute: live.dayMinute,
      clockLabel: clockLabel(live.dayMinute),
      onCourse: live.golfers.length,
      roundsToday: live.roundsStarted,
      greenFeesToday: live.greenFeeCollected,
      concessionsToday: live.concessionCollected,
      arrivalsRemaining: Math.max(0, live.arrivals.length - live.nextArrivalIdx),
      nextArrivalMinute: live.arrivals[live.nextArrivalIdx]?.atMinute ?? null,
      lastDay: status.lastDay,
      selected,
      golfers: live.golfers.map((g) => ({
        id: g.id,
        personId: g.personId,
        name: g.name,
        archetype: g.archetype,
        currentHole: g.currentHole,
        scoreToPar: g.scoreToPar,
        mood: g.mood,
        courseId: g.courseId,
        currentHoleId: g.currentHoleId,
      })),
      tournament: live.tournament ? {
        eventId: live.tournament.eventId,
        name: live.tournament.name,
        tier: live.tournament.tier,
        teeSet: live.tournament.teeSet,
        pinRotation: live.tournament.pinRotation,
        standings: sortedStandings(live.tournament.standings),
      } : null,
      pace: paceStatus(live, courseRef.current, worldRef.current),
      mobility: buildMobilityOperationsReports({ course: courseRef.current, world: worldRef.current, live: live.m51, week: worldRef.current.week, dayIndex: live.dayIndex }),
    });
  }, [status.lastDay]);

  // User cancellation publishes the actual stopped authority immediately. Internal
  // cancellation stays cheap because it also runs on paused/hidden rAF frames.
  const cancelDayAdvance = useCallback(() => {
    const wasAdvancing = dayAdvanceRef.current !== null;
    clearDayAdvance();
    const live = liveRef.current;
    if (wasAdvancing && live) {
      flushCash();
      publishStatus(live);
    }
  }, [clearDayAdvance, flushCash, publishStatus]);

  const getFocusedShotFrame = useCallback((): ShotPacingFrame | null => {
    const owner = focusedOwnerRef.current;
    return owner ? shotPacingFrame(owner.plan, owner.cursor) : null;
  }, []);

  const selectGolfer = useCallback((id: number | null) => {
    if (id !== selectedIdRef.current) cancelFocusedShot();
    selectedIdRef.current = id;
    setSelectedId(id);
    setStatus((s) => ({ ...s, selected: buildSelected(liveRef.current, id) }));
  }, [cancelFocusedShot]);

  // Commit a finished day: apply costs/rep/condition as deltas (green fees were
  // already banked live), then roll the calendar and start the next day.
  const finishDay = useCallback((live: LiveState) => {
    cancelFocusedShot();
    clearDayAdvance();
    controlledAdvanceRef.current = null;
    flushCash();
    latestWorld();
    const tournament = completeTournament(worldRef.current, live);
    const revenue = live.greenFeeCollected + live.concessionCollected + tournament.revenue;
    const { result, world: committedWorld, course: committedCourse } = commitDay({
      course: courseRef.current,
      // Green fees/concessions are already banked live. Tournament awards
      // settle at the results ceremony, so include that cash for objective
      // evaluation as well as the state update below.
      world: { ...tournament.world, cash: tournament.world.cash + tournament.revenue },
      revenue,
      greenFees: live.greenFeeCollected,
      concessionRevenue: live.concessionCollected,
      tournamentRevenue: tournament.revenue,
      tournamentReputation: tournament.reputation,
      concessionByType: live.concessionByType,
      transactions: live.concessionTransactions,
      perCourse: live.perCourse,
      reactions: roundReactions(live),
      dayIndex: live.dayIndex,
      pace: live.pace,
      mobility: live.m51,
      shotTraces: livePropertyShotTraces(live, courseRef.current),
    });
    result.dayIndex = live.dayIndex;
    weekLedgerRef.current = appendDayToLedger(weekLedgerRef.current, result);
    const closesWeek = live.dayIndex + 1 >= DAYS_PER_WEEK;
    const completedWeek = closesWeek ? weekResultFromLedger(weekLedgerRef.current) : undefined;
    const completedWeekNumber = weekLedgerRef.current.week;
    const resumeSpeed: Exclude<SpeedName, "paused"> = speedRef.current === "paused" ? "1x" : speedRef.current;
    if (closesWeek) {
      weekReportPendingRef.current = { version: 1, week: completedWeekNumber, resumeSpeed };
      speedRef.current = "paused";
      setSpeedState("paused");
    }

    const nextDayIndex = (live.dayIndex + 1) % DAYS_PER_WEEK;
    const nextCourse = committedCourse;
    courseRef.current = nextCourse;
    setCourse(() => nextCourse);
    const nextCalendarWorld: World = {
      ...committedWorld,
      week: closesWeek ? committedWorld.week + 1 : committedWorld.week,
      lastWeekProfit: closesWeek && completedWeek ? completedWeek.profit : worldRef.current.lastWeekProfit,
      tournaments: tournament.world.tournaments,
    };
    const preparedNext = prepareTournamentDay(nextCourse, nextCalendarWorld, nextDayIndex);
    worldRef.current = preparedNext.world;
    setWorld(() => preparedNext.world);
    if (closesWeek) weekLedgerRef.current = createWeekLedger(preparedNext.world.week);
    const next = createLiveState(nextCourse, preparedNext.world, nextDayIndex, operationPolicyRef.current);
    liveRef.current = next;
    golfersRef.current = [];
    selectedIdRef.current = null;
    setSelectedId(null);
    const snapshot = snapshotLiveSimulation({
      state: next,
      pendingCash: 0,
      speed: speedRef.current,
      selectedGolferId: null,
      clockRemainderMinutes: clockRemainderRef.current,
      weekLedger: weekLedgerRef.current,
      controlledTime: controlledTimeRef.current ?? undefined,
      weekReportPending: weekReportPendingRef.current ?? undefined,
    });
    onDayRef.current?.(result, snapshot, completedWeek ? {
      week: completedWeekNumber,
      result: completedWeek,
      resumeSpeed,
      cash: preparedNext.world.cash,
      reputation: preparedNext.world.reputation,
    } : undefined);
    setStatus((s) => ({
      ...s,
      dayIndex: next.dayIndex,
      dayMinute: next.dayMinute,
      clockLabel: clockLabel(next.dayMinute),
      onCourse: 0,
      roundsToday: 0,
      greenFeesToday: 0,
      concessionsToday: 0,
      arrivalsRemaining: next.arrivals.length,
      nextArrivalMinute: next.arrivals[0]?.atMinute ?? null,
      lastDay: result,
      golfers: [],
      tournament: next.tournament ? {
        eventId: next.tournament.eventId,
        name: next.tournament.name,
        tier: next.tournament.tier,
        teeSet: next.tournament.teeSet,
        pinRotation: next.tournament.pinRotation,
        standings: sortedStandings(next.tournament.standings),
      } : null,
    }));
  }, [clearDayAdvance, cancelFocusedShot, flushCash, latestWorld, setCourse, setWorld]);

  const applyStepEvents = useCallback((live: LiveState, events: StepEvents) => {
    for (const round of events.completedRounds) {
      const recordedWorld = recordLivingClubRound(latestWorld(), courseRef.current, round, live.dayIndex);
      worldRef.current = recordedWorld;
      setWorld(() => recordedWorld);
      onRoundRef.current?.(round, live.dayIndex);
    }
    if (events.cashDelta > 0) {
      pendingCashRef.current += events.cashDelta;
      onCashRef.current?.();
    }
  }, [latestWorld, setWorld]);

  const publishRender = useCallback((live: LiveState, suppressGolferId?: number) => {
    const previousRender = golfersRef.current;
    const nextRender = buildRenderData(live);
    golfersRef.current = nextRender;
    const eventCap = speedRef.current === "4x" ? 2 : speedRef.current === "2x" ? 3 : 6;
    for (const event of deriveLiveAudioEvents(previousRender, nextRender, courseRef.current)
      .filter((event) => event.golferId !== suppressGolferId).slice(0, eventCap)) onAudioRef.current?.(event);
  }, [buildRenderData]);

  const advanceSimulation = useCallback((live: LiveState, realMs: number, allowFocus = true) => {
    // A fresh course has no operating day to consume yet. Keep the opening
    // clock at the clubhouse while the player authors a valid layout, even if
    // their preferred default speed is 1x. Once any round has started, course
    // edits never freeze or rewind that real day.
    if (shouldHoldUnopenedLiveDay(live, courseCanReceiveArrivalsRef.current)) {
      clockRemainderRef.current = 0;
      return;
    }
    if (allowFocus && !runtimeRef.current.controlledRoundActive && followId() != null) {
      focusedOwnerRef.current = acquireFocusedShot(live, latestWorld(), followId(), courseRef.current);
      if (focusedOwnerRef.current) {
        publishRender(live, focusedOwnerRef.current.golferId);
        publishFocusedShot();
        return;
      }
    }
    const clock = consumeClock(realMs, speedRef.current, clockRemainderRef.current);
    clockRemainderRef.current = clock.remainderMinutes;
    if (clock.steps === 0) return;
    for (let step = 0; step < clock.steps && !live.dayOver; step++) {
      const ev = stepLive(live, courseRef.current, FIXED_GAME_STEP_MINUTES, latestWorld());
      applyStepEvents(live, ev);
      if (allowFocus && !runtimeRef.current.controlledRoundActive && followId() != null) {
        focusedOwnerRef.current = acquireFocusedShot(live, latestWorld(), followId(), courseRef.current);
        if (focusedOwnerRef.current) break;
      }
    }
    publishRender(live, focusedOwnerRef.current?.golferId);
    publishFocusedShot();
  }, [applyStepEvents, followId, latestWorld, publishFocusedShot, publishRender]);

  const baselineControlledRoundTime = useCallback((observation: ControlledTimeObservation): boolean => {
    if (weekReportPendingRef.current || observation.shotCount !== 0 || observation.totalSteps !== 0) return false;
    return observeControlledTimeNow(observation);
  }, [observeControlledTimeNow]);

  const acknowledgeWeekReport = useCallback(() => {
    weekReportPendingRef.current = null;
    lastTsRef.current = null;
  }, []);

  const runAuthorityChunk = useCallback((live: LiveState, request: DayAdvanceRequest, isComplete?: (state: Readonly<LiveState>) => boolean) => runDayAdvanceChunk({
    request, live, canReceiveArrivals: courseCanReceiveArrivalsRef.current,
    step: (minutes) => stepLive(live, courseRef.current, minutes, latestWorld()),
    onEvents: (events) => applyStepEvents(live, events),
    maxSteps: 64, maxWallMs: 8, isComplete,
  }), [applyStepEvents, latestWorld]);

  const drainFocusedShot = useCallback((live: LiveState) => {
    const owner = focusedOwnerRef.current;
    if (!owner) return;
    focusedDrainRef.current ??= createDayAdvanceRequest(live, "until");
    const result = runAuthorityChunk(live, focusedDrainRef.current, (state) => {
      const golfer = state.golfers.find((item) => item.id === owner.golferId);
      return !golfer || golfer.segIndex !== owner.segmentIndex || golfer.segments[golfer.segIndex] !== owner.segment;
    });
    if (result.status !== "running") cancelFocusedShot();
    // Do not acquire another shot or consume any rAF clock debt during this drain.
    publishRender(live, owner.golferId);
    publishFocusedShot();
  }, [cancelFocusedShot, publishFocusedShot, publishRender, runAuthorityChunk]);

  const skipFocusedShot = useCallback(() => {
    const owner = focusedOwnerRef.current;
    const live = liveRef.current;
    if (!owner || !live || document.hidden || runtimeRef.current.presentationPaused
      || !focusedShotMatches(owner, live, latestWorld(), followId(), !!focusedDrainRef.current)) return;
    owner.cursor = advanceShotPacingCursor(owner.plan, owner.cursor, 0, { skip: true })!;
    drainFocusedShot(live);
  }, [drainFocusedShot, followId, latestWorld]);

  const startDayAdvance = useCallback((goal: LiveDayAdvanceGoal) => {
    const live = liveRef.current;
    const current = runtimeRef.current;
    if ((goal !== "next-event" && goal !== "finish-day") || dayAdvanceRef.current || !current.enabled || !live
      || current.controlledRoundActive || (controlledTimeRef.current?.pendingSteps ?? 0) > 0
      || weekReportPendingRef.current
      || current.presentationPaused || document.hidden || shouldHoldUnopenedLiveDay(live, courseCanReceiveArrivalsRef.current)) return;
    cancelFocusedShot();
    dayAdvanceRef.current = createDayAdvanceRequest(live, goal);
    speedRef.current = "paused";
    setSpeedState("paused");
    setStatus((previous) => ({ ...previous, speed: "paused" }));
    setAdvancing(goal);
    golfersRef.current = buildRenderData(live);
    lastTsRef.current = null;
  }, [buildRenderData, cancelFocusedShot]);

  // Main clock loop.
  useEffect(() => {
    if (!enabled) return;
    if (!liveRef.current) {
      const prepared = prepareTournamentDay(courseRef.current, worldRef.current, 0);
      if (prepared.world !== worldRef.current) {
        worldRef.current = prepared.world;
        setWorld(() => prepared.world);
      }
      liveRef.current = createLiveState(courseRef.current, prepared.world, 0, operationPolicyRef.current);
    }

    const tick = (ts: number) => {
      const live = liveRef.current;
      if (!live) return;
      const last = lastTsRef.current ?? ts;
      const realDtSec = Math.min(0.1, (ts - last) / 1000); // clamp big gaps
      lastTsRef.current = ts;
      const current = runtimeRef.current;
      const hidden = document.hidden;
      if (hidden || current.presentationPaused || current.controlledRoundActive || weekReportPendingRef.current) clearDayAdvance();
      const owner = focusedOwnerRef.current;
      if (owner && (current.controlledRoundActive || !focusedShotMatches(owner, live, latestWorld(), followId(), !!focusedDrainRef.current))) {
        cancelFocusedShot();
        golfersRef.current = buildRenderData(live);
      }
      if (!hidden && !current.presentationPaused && !weekReportPendingRef.current) {
        const pending = controlledTimeRef.current?.pendingSteps ?? 0;
        if (pending > 0 && !current.controlledPlaybackActive) {
          cancelFocusedShot();
          controlledAdvanceRef.current ??= createDayAdvanceRequest(live, "until");
          const result = runDayAdvanceChunk({
            request: controlledAdvanceRef.current, live, canReceiveArrivals: courseCanReceiveArrivalsRef.current,
            step: (minutes) => {
              const before = live.dayMinute;
              const events = stepLive(live, courseRef.current, minutes, latestWorld());
              if (live.dayMinute > before && controlledTimeRef.current) controlledTimeRef.current = consumeControlledTimeStep(controlledTimeRef.current);
              return events;
            },
            onEvents: (events) => applyStepEvents(live, events), maxSteps: 64, maxWallMs: 8,
            isComplete: () => (controlledTimeRef.current?.pendingSteps ?? 0) === 0,
          });
          if (result.status !== "running") controlledAdvanceRef.current = null;
          setControlledTimePendingSteps(controlledTimeRef.current?.pendingSteps ?? 0);
          publishRender(live);
        } else if (dayAdvanceRef.current) {
          const result = runAuthorityChunk(live, dayAdvanceRef.current);
          if (result.status !== "running") clearDayAdvance();
          publishRender(live);
        } else if (focusedOwnerRef.current) {
          const focused = focusedOwnerRef.current;
          const previous = focused.cursor;
          const paused = speedRef.current === "paused";
          const skip = current.animationsEnabled === false && !paused;
          focused.cursor = advanceShotPacingCursor(focused.plan, focused.cursor, realDtSec * 1000, { paused, skip })!;
          for (const event of focusedShotAudioEvents(focused, previous, courseRef.current, skip)) onAudioRef.current?.(event);
          publishRender(live, focused.golferId);
          publishFocusedShot();
          if (shotPacingFrame(focused.plan, focused.cursor)!.complete && (!paused || focusedDrainRef.current)) drainFocusedShot(live);
        } else if (!current.controlledRoundActive && pending === 0) {
          advanceSimulation(live, realDtSec * 1000);
        }
      }

      // Publish status (clock, on-course, selected golfer) on a throttle even
      // while paused, so the inspector and clock stay responsive.
      if (ts - lastStatusAtRef.current >= STATUS_THROTTLE_MS) {
        lastStatusAtRef.current = ts;
        flushCash();
        publishStatus(live);
      }
      if (live.dayOver) finishDay(live);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    const resetTimestamp = () => {
      lastTsRef.current = null;
      if (document.hidden) clearDayAdvance();
    };
    document.addEventListener("visibilitychange", resetTimestamp);
    window.addEventListener("pagehide", resetTimestamp);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      document.removeEventListener("visibilitychange", resetTimestamp);
      window.removeEventListener("pagehide", resetTimestamp);
    };
  }, [advanceSimulation, applyStepEvents, buildRenderData, clearDayAdvance, cancelFocusedShot, drainFocusedShot,
    enabled, finishDay, flushCash, followId, latestWorld, publishFocusedShot, publishRender, publishStatus, runAuthorityChunk, setWorld]);

  const liveActive = speed !== "paused" || status.onCourse > 0;

  const getSnapshot = useCallback((): LiveSimulationSnapshotV1 | undefined => {
    const state = liveRef.current;
    if (!state) return undefined;
    return snapshotLiveSimulation({
      state,
      pendingCash: pendingCashRef.current,
      speed: speedRef.current,
      selectedGolferId: selectedIdRef.current,
      clockRemainderMinutes: clockRemainderRef.current,
      weekLedger: weekLedgerRef.current,
      focusedShot: focusedOwnerRef.current ? snapshotFocusedShot(focusedOwnerRef.current) : undefined,
      controlledTime: controlledTimeRef.current ?? undefined,
      weekReportPending: weekReportPendingRef.current ?? undefined,
    });
  }, []);

  const restoreSnapshot = useCallback((snapshot: LiveSimulationSnapshotV1 | undefined): boolean => {
    clearDayAdvance();
    cancelFocusedShot();
    controlledAdvanceRef.current = null;
    lastTsRef.current = null;
    if (!snapshot) {
      liveRef.current = null;
      golfersRef.current = [];
      pendingCashRef.current = 0;
      clockRemainderRef.current = 0;
      controlledTimeRef.current = null;
      weekReportPendingRef.current = null;
      setControlledTimePendingSteps(0);
      weekLedgerRef.current = createWeekLedger(worldRef.current.week);
      selectedIdRef.current = null;
      setSelectedId(null);
      speedRef.current = "paused";
      setSpeedState("paused");
      return true;
    }
    const restored = restoreLiveSimulation(snapshot);
    if (!restored) return false;
    if (restored.weekReportPending && (restored.weekReportPending.week + 1 !== latestWorld().week || restored.state.dayIndex !== 0)) {
      // A mismatched acknowledgement barrier is safer held for explicit recovery
      // than silently converted into a running operating day.
      weekReportPendingRef.current = restored.weekReportPending;
      speedRef.current = "paused";
      setSpeedState("paused");
      return false;
    }
    liveRef.current = restored.state;
    weekReportPendingRef.current = restored.weekReportPending ?? null;
    focusedOwnerRef.current = restoreFocusedShot(restored.focusedShot, restored.state, latestWorld(), courseRef.current);
    controlledTimeRef.current = restored.controlledTime ?? null;
    setControlledTimePendingSteps(restored.controlledTime?.pendingSteps ?? 0);
    golfersRef.current = buildRenderData(restored.state);
    publishFocusedShot();
    pendingCashRef.current = restored.pendingCash;
    clockRemainderRef.current = restored.clockRemainderMinutes;
    weekLedgerRef.current = restored.weekLedger.days.length === 0 && restored.weekLedger.week === 1 && worldRef.current.week !== 1
      ? createWeekLedger(worldRef.current.week)
      : restored.weekLedger;
    speedRef.current = restored.speed;
    setSpeedState(restored.speed);
    const selected = buildSelected(restored.state, restored.selectedGolferId);
    selectedIdRef.current = selected?.id ?? null;
    setSelectedId(selected?.id ?? null);
    skipNextReconcileRef.current = true;
    setStatus({
      speed: restored.speed,
      dayIndex: restored.state.dayIndex,
      dayMinute: restored.state.dayMinute,
      clockLabel: clockLabel(restored.state.dayMinute),
      onCourse: restored.state.golfers.length,
      roundsToday: restored.state.roundsStarted,
      greenFeesToday: restored.state.greenFeeCollected,
      concessionsToday: restored.state.concessionCollected,
      arrivalsRemaining: Math.max(0, restored.state.arrivals.length - restored.state.nextArrivalIdx),
      nextArrivalMinute: restored.state.arrivals[restored.state.nextArrivalIdx]?.atMinute ?? null,
      lastDay: null,
      selected,
      golfers: restored.state.golfers.map((g) => ({
        id: g.id,
        name: g.name,
        archetype: g.archetype,
        currentHole: g.currentHole,
        scoreToPar: g.scoreToPar,
        mood: g.mood,
        courseId: g.courseId,
        currentHoleId: g.currentHoleId,
      })),
      tournament: restored.state.tournament ? {
        eventId: restored.state.tournament.eventId,
        name: restored.state.tournament.name,
        tier: restored.state.tournament.tier,
        teeSet: restored.state.tournament.teeSet,
        pinRotation: restored.state.tournament.pinRotation,
        standings: sortedStandings(restored.state.tournament.standings),
      } : null,
      pace: paceStatus(restored.state, courseRef.current, worldRef.current),
      mobility: buildMobilityOperationsReports({ course: courseRef.current, world: worldRef.current, live: restored.state.m51, week: worldRef.current.week, dayIndex: restored.state.dayIndex }),
    });
    return true;
  }, [buildRenderData, clearDayAdvance, cancelFocusedShot, latestWorld, publishFocusedShot]);

  const advanceTime = useCallback((ms: number) => {
    if (!enabled || weekReportPendingRef.current || !Number.isFinite(ms) || ms <= 0) return;
    const live = liveRef.current ?? createLiveState(courseRef.current, worldRef.current, 0, operationPolicyRef.current);
    liveRef.current = live;
    clearDayAdvance();
    cancelFocusedShot();
    advanceSimulation(live, Math.min(2_000, ms), false);
    flushCash();
    publishStatus(live);
    if (live.dayOver) finishDay(live);
  }, [advanceSimulation, clearDayAdvance, cancelFocusedShot, enabled, finishDay, flushCash, publishStatus]);

  const setSpeed = useCallback((next: SpeedName) => {
    clearDayAdvance();
    // Update the loop's ref synchronously. App-shell pause must freeze the
    // mutable live store before React gets a chance to paint the overlay.
    speedRef.current = next;
    setSpeedState(next);
    setStatus((current) => ({ ...current, speed: next }));
  }, [clearDayAdvance]);

  const advanceDisabledReason: LiveAdvanceDisabledReason = args.controlledRoundActive ? "controlled-round"
    : !enabled || args.presentationPaused || weekReportPendingRef.current || (controlledTimeRef.current?.pendingSteps ?? 0) > 0 ? "unavailable"
    : !liveRef.current ? "unavailable"
    : shouldHoldUnopenedLiveDay(liveRef.current, courseCanReceiveArrivalsRef.current) ? "unopened" : null;

  const setPacePreset = useCallback((preset: PacePreset) => {
    const courseId = activeCourseLayout(courseRef.current).id;
    setCourse((current) => updateLayout(current, courseId, { operations: PACE_PRESETS[preset] }));
  }, [setCourse]);

  const updatePaceOperations = useCallback((patch: CourseOperationsPatch) => {
    const courseId = activeCourseLayout(courseRef.current).id;
    const current = courseOperations(courseRef.current, courseId);
    setCourse((course) => updateLayout(course, courseId, { operations: { ...current, ...patch, beverage: { ...current.beverage, ...patch.beverage } } }));
  }, [setCourse]);

  return {
    status,
    speed,
    setSpeed,
    golfersRef,
    liveActive,
    selectGolfer,
    selectedId,
    getSnapshot,
    restoreSnapshot,
    advanceTime,
    setPacePreset,
    updatePaceOperations,
    focusedShot,
    getFocusedShotFrame,
    skipFocusedShot,
    startDayAdvance,
    cancelDayAdvance,
    advancing,
    advanceDisabledReason,
    controlledTimePendingSteps,
    baselineControlledRoundTime,
    observeControlledTimeNow,
    acknowledgeWeekReport,
  };
}
