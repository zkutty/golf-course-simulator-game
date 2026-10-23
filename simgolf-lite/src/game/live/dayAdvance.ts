import { FIXED_GAME_STEP_MINUTES } from "./clock";
import { shouldHoldUnopenedLiveDay, type StepEvents } from "./simulation";
import type { LiveState, Segment } from "./types";

export type DayAdvanceGoal = "next-event" | "finish-day" | "until";
export type DayAdvanceStatus = "running" | "complete" | "day-over" | "cancelled" | "ineligible" | "invalid";
export type DayAdvanceReason = "invalid-budget" | "missing-completion" | "invalid-clock" | "day-changed" | "unopened-course" | "no-progress";

export interface DayAdvanceRequest {
  readonly live: LiveState;
  readonly dayIndex: number;
  readonly goal: DayAdvanceGoal;
  readonly initialArrivalIndex: number;
  readonly initialRoundsFinished: number;
  /** References only: do not serialize or copy the golfer graph each quantum. */
  readonly initialFlights: ReadonlyMap<number, readonly (Segment | undefined)[]>;
  status: DayAdvanceStatus;
  reason?: DayAdvanceReason;
}

export interface DayAdvanceChunkResult {
  status: DayAdvanceStatus;
  steps: number;
  gameMinutes: number;
  reason?: DayAdvanceReason;
}

export function createDayAdvanceRequest(live: LiveState, goal: DayAdvanceGoal): DayAdvanceRequest {
  return {
    live,
    dayIndex: live.dayIndex,
    goal,
    initialArrivalIndex: live.nextArrivalIdx,
    initialRoundsFinished: live.roundsFinished,
    initialFlights: new Map(live.golfers.map((golfer) => [golfer.id, [
      golfer.segments[golfer.segIndex]?.kind === "flight" ? golfer.segments[golfer.segIndex] : undefined,
      golfer.lastMotionSegmentIndex == null ? undefined : golfer.segments[golfer.lastMotionSegmentIndex],
    ]])),
    status: "running",
  };
}

function reachedNextEvent(request: DayAdvanceRequest, live: LiveState): boolean {
  if (live.nextArrivalIdx > request.initialArrivalIndex || live.roundsFinished > request.initialRoundsFinished) return true;
  for (const golfer of live.golfers) {
    const initial = request.initialFlights.get(golfer.id);
    const current = golfer.segments[golfer.segIndex];
    if (current?.kind === "flight" && !initial?.includes(current)) return true;
    // A short retained flight can start and finish inside a fixed quantum.
    const completed = golfer.lastMotionSegmentIndex == null ? undefined : golfer.segments[golfer.lastMotionSegmentIndex];
    if (completed?.kind === "flight" && !initial?.includes(completed)) return true;
  }
  return false;
}

/**
 * Consume a bounded chunk of the ordinary live clock. The owner schedules the
 * next chunk, guards duplicate clicks, and commits a day after `day-over`.
 * `step` must call stepLive; `onEvents` applies its usual cash/round callbacks
 * synchronously so the next step reads the latest world. No settlement or
 * next-day creation belongs here. `until` supports a focused segment drain or
 * an action-time debit using an owner-supplied completion predicate.
 */
export function runDayAdvanceChunk(args: {
  request: DayAdvanceRequest;
  live: LiveState;
  canReceiveArrivals: boolean;
  step: (gameMinutes: number) => StepEvents;
  onEvents?: (events: StepEvents) => void;
  maxSteps?: number;
  maxWallMs?: number;
  now?: () => number;
  isCancelled?: () => boolean;
  isComplete?: (live: Readonly<LiveState>) => boolean;
}): DayAdvanceChunkResult {
  const { request, live } = args;
  let steps = 0;
  const finish = (status: DayAdvanceStatus, reason?: DayAdvanceReason): DayAdvanceChunkResult => {
    request.status = status;
    request.reason = reason;
    return { status, steps, gameMinutes: steps * FIXED_GAME_STEP_MINUTES, ...(reason ? { reason } : {}) };
  };
  if (request.status !== "running") return finish(request.status, request.reason);
  const maxSteps = args.maxSteps ?? 64;
  const maxWallMs = args.maxWallMs ?? 8;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 256
    || !Number.isFinite(maxWallMs) || maxWallMs <= 0) return finish("invalid", "invalid-budget");
  if (request.goal === "until" && !args.isComplete) return finish("invalid", "missing-completion");
  const now = args.now ?? (() => performance.now());
  const startedAt = now();
  if (!Number.isFinite(startedAt)) return finish("invalid", "invalid-clock");
  while (steps < maxSteps) {
    // Identity matters on the last day of a week too: never drain a new day.
    if (live !== request.live || live.dayIndex !== request.dayIndex) return finish("invalid", "day-changed");
    if (args.isCancelled?.()) return finish("cancelled");
    if (live.dayOver) return finish("day-over");
    if (shouldHoldUnopenedLiveDay(live, args.canReceiveArrivals)) return finish("ineligible", "unopened-course");
    if (request.goal === "until" && args.isComplete?.(live)) return finish("complete");
    if (steps > 0) {
      const elapsed = now() - startedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0) return finish("invalid", "invalid-clock");
      if (elapsed >= maxWallMs) return finish("running");
    }
    const beforeMinute = live.dayMinute;
    const events = args.step(FIXED_GAME_STEP_MINUTES);
    steps++;
    args.onEvents?.(events);
    if (!Number.isFinite(live.dayMinute) || live.dayMinute <= beforeMinute) return finish("invalid", "no-progress");
    if (live.dayOver) return finish("day-over");
    if (request.goal === "next-event" && reachedNextEvent(request, live)) return finish("complete");
    if (request.goal === "until" && args.isComplete?.(live)) return finish("complete");
  }
  return finish("running");
}
