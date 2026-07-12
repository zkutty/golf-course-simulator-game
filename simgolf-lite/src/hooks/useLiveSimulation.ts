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
import type { DayResult, GolferRenderData, LiveState } from "../game/live/types";

const DAYS_PER_WEEK = 7;
const STATUS_THROTTLE_MS = 150;

export interface LiveStatus {
  speed: SpeedName;
  dayIndex: number; // 0..6 within the week
  dayMinute: number;
  clockLabel: string;
  onCourse: number;
  roundsToday: number;
  greenFeesToday: number;
  lastDay: DayResult | null;
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
  onDayCommitted?: (result: DayResult) => void;
  onCashTick?: () => void;
}) {
  const { enabled, course, world, setWorld, setCourse, onDayCommitted, onCashTick } = args;

  const [speed, setSpeed] = useState<SpeedName>("paused");
  const [status, setStatus] = useState<LiveStatus>({
    speed: "paused",
    dayIndex: 0,
    dayMinute: 0,
    clockLabel: clockLabel(0),
    onCourse: 0,
    roundsToday: 0,
    greenFeesToday: 0,
    lastDay: null,
  });

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
  const onDayRef = useRef(onDayCommitted);
  const onCashRef = useRef(onCashTick);

  useEffect(() => {
    courseRef.current = course;
    worldRef.current = world;
    speedRef.current = speed;
    onDayRef.current = onDayCommitted;
    onCashRef.current = onCashTick;
  });

  // Detect course *geometry* edits (terrain/holes/obstacles) and re-plan any
  // golfers already on the course so they don't walk a stale itinerary. The
  // reducer replaces these arrays on every edit, while daily condition updates
  // keep the same references — so identity comparison isolates real edits.
  const geomRef = useRef({ tiles: course.tiles, holes: course.holes, obstacles: course.obstacles });
  useEffect(() => {
    const prev = geomRef.current;
    const changed =
      prev.tiles !== course.tiles ||
      prev.holes !== course.holes ||
      prev.obstacles !== course.obstacles;
    if (!changed) return;
    geomRef.current = { tiles: course.tiles, holes: course.holes, obstacles: course.obstacles };
    const live = liveRef.current;
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
    setStatus({
      speed: speedRef.current,
      dayIndex: live.dayIndex,
      dayMinute: live.dayMinute,
      clockLabel: clockLabel(live.dayMinute),
      onCourse: live.golfers.length,
      roundsToday: live.roundsStarted,
      greenFeesToday: live.greenFeeCollected,
      lastDay: status.lastDay,
    });
  }, [status.lastDay]);

  // Commit a finished day: apply costs/rep/condition as deltas (green fees were
  // already banked live), then roll the calendar and start the next day.
  const finishDay = useCallback((live: LiveState) => {
    flushCash();
    const revenue = live.greenFeeCollected;
    const { result } = commitDay({
      course: courseRef.current,
      world: worldRef.current,
      revenue,
      reactions: roundReactions(live),
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
        isBankrupt: w.isBankrupt || nextCash < -10_000,
      };
    });
    onDayRef.current?.(result);

    const nextDayIndex = (live.dayIndex + 1) % DAYS_PER_WEEK;
    const next = createLiveState(courseRef.current, worldRef.current, nextDayIndex);
    liveRef.current = next;
    golfersRef.current = [];
    setStatus((s) => ({
      ...s,
      dayIndex: next.dayIndex,
      dayMinute: next.dayMinute,
      clockLabel: clockLabel(next.dayMinute),
      onCourse: 0,
      roundsToday: 0,
      greenFeesToday: 0,
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
        const ev = stepLive(live, courseRef.current, dtMin);
        if (ev.cashDelta > 0) {
          pendingCashRef.current += ev.cashDelta;
          onCashRef.current?.();
        }
        golfersRef.current = liveRenderData(live);

        if (ts - lastStatusAtRef.current >= STATUS_THROTTLE_MS) {
          lastStatusAtRef.current = ts;
          flushCash();
          publishStatus(live);
        }
        if (live.dayOver) finishDay(live);
      }

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

  return { status, speed, setSpeed, golfersRef, liveActive };
}
