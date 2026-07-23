import { useCallback, useEffect, useRef, useState } from "react";
import type { Course, CourseOperations, PacePreset, PinRotation, TeeSet, WeekResult, World } from "../game/models/types";
import { LIVE, type SpeedName } from "../game/live/liveConfig";
import {
  createLiveState,
  liveRenderData,
  reconcileGolfers,
  roundReactions,
  stepLive,
} from "../game/live/simulation";
import { commitDay } from "../game/live/commitDay";
import { isCoursePlayable } from "../game/sim/isCoursePlayable";
import { planEstateDay } from "../game/live/spawn";
import type { DayResult, GolferRenderData, LiveState } from "../game/live/types";
import {
  restoreLiveSimulation,
  snapshotLiveSimulation,
  type LiveSimulationSnapshotV1,
} from "../game/live/persistence";
import { deriveLiveAudioEvents, type LiveAudioEvent } from "../audio/liveEvents";
import type { CompletedRound } from "../game/retention/types";
import { completeTournament, prepareTournamentDay, sortedStandings } from "../game/tournaments/tournaments";
import type { TournamentStanding, TournamentTier } from "../game/tournaments/types";
import { activeCourseLayout, updateLayout } from "../game/models/courseLayouts";
import { courseOperations, PACE_PRESETS } from "../game/live/pace";
import { consumeClock, FIXED_GAME_STEP_MINUTES } from "../game/live/clock";
import { appendDayToLedger, createWeekLedger, weekResultFromLedger } from "../game/live/weeklyLedger";

const DAYS_PER_WEEK = 7;
const STATUS_THROTTLE_MS = 150;
export type CourseOperationsPatch = Partial<Omit<CourseOperations, "beverage">> & { beverage?: Partial<CourseOperations["beverage"]> };

export interface SelectedGolferDetail {
  id: number;
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
  golfers: Array<Pick<SelectedGolferDetail, "id" | "name" | "archetype" | "currentHole" | "scoreToPar" | "mood" | "courseId" | "currentHoleId">>;
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
  };
}

function paceStatus(live: LiveState, course: Course): LiveStatus["pace"] {
  const layout = activeCourseLayout(course);
  const operations = courseOperations(course, layout.id);
  const active = (live.groups ?? []).filter((group) => group.courseId === layout.id && group.startedAt != null && group.finishedAt == null);
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
}) {
  const { enabled, course, world, setWorld, setCourse, onDayCommitted, onCashTick, onAudioEvent, onRoundCompleted } = args;

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
    pace: { courseId: "course-primary", preset: "balanced", teeIntervalMinutes: 10, maxGroupSize: 4, groupsOnCourse: 0, blockedGroups: 0, averageWaitMinutes: 0, interventions: 0, pickups: 0, beverageRevenue: 0, alcoholicDrinks: 0, incidents: 0, marshalCoverage: 0, beverageCoverage: 0, beverageMenu: "refreshments" },
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
  const wasPlayableRef = useRef(isCoursePlayable(course));

  const buildRenderData = useCallback((live: LiveState) => {
    renderBufferIndexRef.current = renderBufferIndexRef.current === 0 ? 1 : 0;
    return liveRenderData(live, renderBuffersRef.current[renderBufferIndexRef.current]);
  }, []);

  useEffect(() => {
    courseRef.current = course;
    worldRef.current = world;
    onDayRef.current = onDayCommitted;
    onCashRef.current = onCashTick;
    onAudioRef.current = onAudioEvent;
    onRoundRef.current = onRoundCompleted;
  });

  // Detect course *geometry* edits (terrain/holes/obstacles) and re-plan any
  // golfers already on the course so they don't walk a stale itinerary. The
  // reducer replaces these arrays on every edit, while daily condition updates
  // keep the same references — so identity comparison isolates real edits.
  const geomRef = useRef({ tiles: course.tiles, holes: course.holes, obstacles: course.obstacles, buildings: course.buildings });
  useEffect(() => {
    const prev = geomRef.current;
    const changed =
      prev.tiles !== course.tiles ||
      prev.holes !== course.holes ||
      prev.obstacles !== course.obstacles ||
      prev.buildings !== course.buildings;
    if (!changed) return;
    geomRef.current = { tiles: course.tiles, holes: course.holes, obstacles: course.obstacles, buildings: course.buildings };
    if (skipNextReconcileRef.current) {
      skipNextReconcileRef.current = false;
      return;
    }
    const live = liveRef.current;
    const playable = isCoursePlayable(course);
    const becamePlayable = playable && !wasPlayableRef.current;
    wasPlayableRef.current = playable;
    if (enabled && live && becamePlayable) {
      const arrivals = planEstateDay(course, worldRef.current, live.seed);
      if (arrivals.length > 0) {
        arrivals[0] = {
          ...arrivals[0],
          atMinute: Math.min(arrivals[0].atMinute, live.dayMinute + 2),
        };
        arrivals.sort((a, b) => a.atMinute - b.atMinute);
      }
      live.arrivals = arrivals;
      live.nextArrivalIdx = 0;
      live.nextTeeFreeAt = live.dayMinute;
    }
    if (enabled && live && live.golfers.length > 0) {
      reconcileGolfers(live, course);
      golfersRef.current = buildRenderData(live);
    }
  }, [buildRenderData, enabled, course]);

  const flushCash = useCallback(() => {
    const d = pendingCashRef.current;
    if (d === 0) return;
    pendingCashRef.current = 0;
    worldRef.current = { ...worldRef.current, cash: worldRef.current.cash + d };
    setWorld((w) => ({ ...w, cash: w.cash + d }));
    onCashRef.current?.();
  }, [setWorld]);

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
      pace: paceStatus(live, courseRef.current),
    });
  }, [status.lastDay]);

  const selectGolfer = useCallback((id: number | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setStatus((s) => ({ ...s, selected: buildSelected(liveRef.current, id) }));
  }, []);

  // Commit a finished day: apply costs/rep/condition as deltas (green fees were
  // already banked live), then roll the calendar and start the next day.
  const finishDay = useCallback((live: LiveState) => {
    flushCash();
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
      shotTraces: live.golfers.flatMap((golfer) => golfer.segments.filter((segment) => segment.kind === "flight" && segment.shot !== "putt").map((segment) => ({
        golferId: golfer.id,
        holeId: segment.holeId,
        holeName: courseRef.current.holes.find((hole) => hole.id === segment.holeId)?.name,
        teeSet: golfer.teeSet,
        shotType: segment.holeIndex >= 0 && segment.from.x === (courseRef.current.holes[segment.holeIndex]?.tee?.x ?? Number.NaN) && segment.from.y === (courseRef.current.holes[segment.holeIndex]?.tee?.y ?? Number.NaN) ? "drive" as const : "approach" as const,
        from: segment.from,
        to: segment.to,
      }))),
    });
    result.dayIndex = live.dayIndex;
    weekLedgerRef.current = appendDayToLedger(weekLedgerRef.current, result);
    const closesWeek = live.dayIndex + 1 >= DAYS_PER_WEEK;
    const completedWeek = closesWeek ? weekResultFromLedger(weekLedgerRef.current) : undefined;
    const completedWeekNumber = weekLedgerRef.current.week;
    const resumeSpeed: Exclude<SpeedName, "paused"> = speedRef.current === "paused" ? "1x" : speedRef.current;
    if (closesWeek) {
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
    const next = createLiveState(nextCourse, preparedNext.world, nextDayIndex);
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
  }, [flushCash, setCourse, setWorld]);

  const advanceSimulation = useCallback((live: LiveState, realMs: number) => {
    const clock = consumeClock(realMs, speedRef.current, clockRemainderRef.current);
    clockRemainderRef.current = clock.remainderMinutes;
    if (clock.steps === 0) return;
    const previousRender = golfersRef.current;
    for (let step = 0; step < clock.steps && !live.dayOver; step++) {
      const ev = stepLive(live, courseRef.current, FIXED_GAME_STEP_MINUTES);
      for (const round of ev.completedRounds) onRoundRef.current?.(round, live.dayIndex);
      if (ev.cashDelta > 0) {
        pendingCashRef.current += ev.cashDelta;
        onCashRef.current?.();
      }
    }
    const nextRender = buildRenderData(live);
    golfersRef.current = nextRender;
    const eventCap = speedRef.current === "4x" ? 2 : speedRef.current === "2x" ? 3 : 6;
    for (const audioEvent of deriveLiveAudioEvents(previousRender, nextRender, courseRef.current).slice(0, eventCap)) {
      onAudioRef.current?.(audioEvent);
    }
  }, [buildRenderData]);

  // Main clock loop.
  useEffect(() => {
    if (!enabled) return;
    if (!liveRef.current) {
      const prepared = prepareTournamentDay(courseRef.current, worldRef.current, 0);
      if (prepared.world !== worldRef.current) {
        worldRef.current = prepared.world;
        setWorld(() => prepared.world);
      }
      liveRef.current = createLiveState(courseRef.current, prepared.world, 0);
    }

    const tick = (ts: number) => {
      const live = liveRef.current;
      if (!live) return;
      const last = lastTsRef.current ?? ts;
      const realDtSec = Math.min(0.1, (ts - last) / 1000); // clamp big gaps
      lastTsRef.current = ts;

      advanceSimulation(live, realDtSec * 1000);

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
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [advanceSimulation, enabled, flushCash, publishStatus, finishDay]);

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
    });
  }, []);

  const restoreSnapshot = useCallback((snapshot: LiveSimulationSnapshotV1 | undefined): boolean => {
    if (!snapshot) {
      liveRef.current = null;
      golfersRef.current = [];
      pendingCashRef.current = 0;
      clockRemainderRef.current = 0;
      weekLedgerRef.current = createWeekLedger(worldRef.current.week);
      selectedIdRef.current = null;
      setSelectedId(null);
      speedRef.current = "paused";
      setSpeedState("paused");
      return true;
    }
    const restored = restoreLiveSimulation(snapshot);
    if (!restored) return false;
    liveRef.current = restored.state;
    golfersRef.current = buildRenderData(restored.state);
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
      pace: paceStatus(restored.state, courseRef.current),
    });
    return true;
  }, [buildRenderData]);

  const advanceTime = useCallback((ms: number) => {
    if (!enabled || !Number.isFinite(ms) || ms <= 0) return;
    const live = liveRef.current ?? createLiveState(courseRef.current, worldRef.current, 0);
    liveRef.current = live;
    advanceSimulation(live, Math.min(2_000, ms));
    flushCash();
    publishStatus(live);
    if (live.dayOver) finishDay(live);
  }, [advanceSimulation, enabled, finishDay, flushCash, publishStatus]);

  const setSpeed = useCallback((next: SpeedName) => {
    // Update the loop's ref synchronously. App-shell pause must freeze the
    // mutable live store before React gets a chance to paint the overlay.
    speedRef.current = next;
    setSpeedState(next);
    setStatus((current) => ({ ...current, speed: next }));
  }, []);

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
  };
}
