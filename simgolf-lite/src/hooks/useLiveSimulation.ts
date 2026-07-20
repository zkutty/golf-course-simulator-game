import { useCallback, useEffect, useRef, useState } from "react";
import type { Course, World } from "../game/models/types";
import { LIVE, type SpeedName } from "../game/live/liveConfig";
import {
  createLiveState,
  liveRenderData,
  reconcileGolfers,
  roundReactions,
  stepLive,
} from "../game/live/simulation";
import { commitDay } from "../game/live/commitDay";
import { hitsLiquidityTrap } from "../game/sim/runState";
import { isCoursePlayable } from "../game/sim/isCoursePlayable";
import { planDay } from "../game/live/spawn";
import type { DayResult, GolferRenderData, LiveState } from "../game/live/types";
import {
  restoreLiveSimulation,
  snapshotLiveSimulation,
  type LiveSimulationSnapshotV1,
} from "../game/live/persistence";
import { deriveLiveAudioEvents, type LiveAudioEvent } from "../audio/liveEvents";

const DAYS_PER_WEEK = 7;
const STATUS_THROTTLE_MS = 150;

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
  lastDay: DayResult | null;
  selected: SelectedGolferDetail | null;
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

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
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
  onDayCommitted?: (result: DayResult, live: LiveSimulationSnapshotV1) => void;
  onCashTick?: () => void;
  onAudioEvent?: (event: LiveAudioEvent) => void;
}) {
  const { enabled, course, world, setWorld, setCourse, onDayCommitted, onCashTick, onAudioEvent } = args;

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
    lastDay: null,
    selected: null,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Latest inputs, mirrored into refs so the rAF loop never restarts. Synced in
  // an effect (not during render) per the rules of hooks.
  const courseRef = useRef(course);
  const worldRef = useRef(world);
  const speedRef = useRef<SpeedName>(speed);
  const liveRef = useRef<LiveState | null>(null);
  const golfersRef = useRef<GolferRenderData[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const pendingCashRef = useRef(0);
  const lastStatusAtRef = useRef(0);
  const selectedIdRef = useRef<number | null>(null);
  const onDayRef = useRef(onDayCommitted);
  const onCashRef = useRef(onCashTick);
  const onAudioRef = useRef(onAudioEvent);
  const skipNextReconcileRef = useRef(false);
  const wasPlayableRef = useRef(isCoursePlayable(course));

  useEffect(() => {
    courseRef.current = course;
    worldRef.current = world;
    speedRef.current = speed;
    onDayRef.current = onDayCommitted;
    onCashRef.current = onCashTick;
    onAudioRef.current = onAudioEvent;
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
      const arrivals = planDay(course, worldRef.current, live.seed);
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
      golfersRef.current = liveRenderData(live);
    }
  }, [enabled, course]);

  const flushCash = useCallback(() => {
    const d = pendingCashRef.current;
    if (d === 0) return;
    pendingCashRef.current = 0;
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
      lastDay: status.lastDay,
      selected,
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
    const revenue = live.greenFeeCollected + live.concessionCollected;
    const { result, world: committedWorld } = commitDay({
      course: courseRef.current,
      world: worldRef.current,
      revenue,
      greenFees: live.greenFeeCollected,
      concessionRevenue: live.concessionCollected,
      concessionByType: live.concessionByType,
      transactions: live.concessionTransactions,
      reactions: roundReactions(live),
      dayIndex: live.dayIndex,
    });
    result.dayIndex = live.dayIndex;

    setCourse((c) => ({ ...c, condition: clamp(c.condition + result.conditionDelta, 0, 1) }));
    setWorld((w) => {
      const nextCash = w.cash - result.costs;
      const rolloverWeek = live.dayIndex + 1 >= DAYS_PER_WEEK;
      return {
        ...w,
        cash: nextCash,
        reputation: clamp(w.reputation + result.reputationDelta, 0, 100),
        lastWeekProfit: result.profit,
        week: rolloverWeek ? w.week + 1 : w.week,
        isBankrupt: w.isBankrupt || hitsLiquidityTrap(nextCash),
        // Objective state was evaluated inside commitDay (the sim commit
        // point); the hook only stores the result.
        objectives: committedWorld.objectives,
      };
    });
    const nextDayIndex = (live.dayIndex + 1) % DAYS_PER_WEEK;
    const next = createLiveState(courseRef.current, worldRef.current, nextDayIndex);
    liveRef.current = next;
    golfersRef.current = [];
    selectedIdRef.current = null;
    setSelectedId(null);
    onDayRef.current?.(result, snapshotLiveSimulation({
      state: next,
      pendingCash: 0,
      speed: speedRef.current,
      selectedGolferId: null,
    }));
    setStatus((s) => ({
      ...s,
      dayIndex: next.dayIndex,
      dayMinute: next.dayMinute,
      clockLabel: clockLabel(next.dayMinute),
      onCourse: 0,
      roundsToday: 0,
      greenFeesToday: 0,
      concessionsToday: 0,
      lastDay: result,
    }));
  }, [flushCash, setCourse, setWorld]);

  // Main clock loop.
  useEffect(() => {
    if (!enabled) return;
    if (!liveRef.current) {
      liveRef.current = createLiveState(courseRef.current, worldRef.current, 0);
    }

    const tick = (ts: number) => {
      const live = liveRef.current;
      if (!live) return;
      const last = lastTsRef.current ?? ts;
      const realDtSec = Math.min(0.1, (ts - last) / 1000); // clamp big gaps
      lastTsRef.current = ts;

      const gmPerSec = LIVE.speed[speedRef.current];
      if (gmPerSec > 0) {
        const dtMin = realDtSec * gmPerSec;
        const previousRender = golfersRef.current;
        const ev = stepLive(live, courseRef.current, dtMin);
        if (ev.cashDelta > 0) {
          pendingCashRef.current += ev.cashDelta;
          onCashRef.current?.();
        }
        const nextRender = liveRenderData(live);
        golfersRef.current = nextRender;
        const eventCap = speedRef.current === "3x" ? 2 : speedRef.current === "2x" ? 3 : 6;
        for (const audioEvent of deriveLiveAudioEvents(previousRender, nextRender, courseRef.current).slice(0, eventCap)) {
          onAudioRef.current?.(audioEvent);
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
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [enabled, flushCash, publishStatus, finishDay]);

  const liveActive = speed !== "paused" || status.onCourse > 0;

  const getSnapshot = useCallback((): LiveSimulationSnapshotV1 | undefined => {
    const state = liveRef.current;
    if (!state) return undefined;
    return snapshotLiveSimulation({
      state,
      pendingCash: pendingCashRef.current,
      speed: speedRef.current,
      selectedGolferId: selectedIdRef.current,
    });
  }, []);

  const restoreSnapshot = useCallback((snapshot: LiveSimulationSnapshotV1 | undefined): boolean => {
    if (!snapshot) {
      liveRef.current = null;
      golfersRef.current = [];
      pendingCashRef.current = 0;
      selectedIdRef.current = null;
      setSelectedId(null);
      speedRef.current = "paused";
      setSpeedState("paused");
      return true;
    }
    const restored = restoreLiveSimulation(snapshot);
    if (!restored) return false;
    liveRef.current = restored.state;
    golfersRef.current = liveRenderData(restored.state);
    pendingCashRef.current = restored.pendingCash;
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
      lastDay: null,
      selected,
    });
    return true;
  }, []);

  const advanceTime = useCallback((ms: number) => {
    if (!enabled || !Number.isFinite(ms) || ms <= 0) return;
    const live = liveRef.current ?? createLiveState(courseRef.current, worldRef.current, 0);
    liveRef.current = live;
    const gmPerSec = LIVE.speed[speedRef.current];
    if (gmPerSec <= 0) return;
    const previousRender = golfersRef.current;
    const ev = stepLive(live, courseRef.current, Math.min(2, ms / 1000) * gmPerSec);
    if (ev.cashDelta > 0) pendingCashRef.current += ev.cashDelta;
    const nextRender = liveRenderData(live);
    golfersRef.current = nextRender;
    const eventCap = speedRef.current === "3x" ? 2 : speedRef.current === "2x" ? 3 : 6;
    for (const audioEvent of deriveLiveAudioEvents(previousRender, nextRender, courseRef.current).slice(0, eventCap)) {
      onAudioRef.current?.(audioEvent);
    }
    flushCash();
    publishStatus(live);
    if (live.dayOver) finishDay(live);
  }, [enabled, finishDay, flushCash, publishStatus]);

  const setSpeed = useCallback((next: SpeedName) => {
    // Update the loop's ref synchronously. App-shell pause must freeze the
    // mutable live store before React gets a chance to paint the overlay.
    speedRef.current = next;
    setSpeedState(next);
    setStatus((current) => ({ ...current, speed: next }));
  }, []);

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
  };
}
