import type { PlayerShotTrace } from "../models/playerProTypes";
import { FIXED_GAME_STEP_MINUTES } from "./clock";
import { LIVE } from "./liveConfig";

export const MAX_CONTROLLED_TIME_SHOTS = 960;
export const MAX_CONTROLLED_SHOT_STEPS = 4_000;
export const MAX_CONTROLLED_RECENT_SHOTS = 240;
/** A trusted auto-finish batch: previous last cost plus at most 261 new shots. */
export const MAX_CONTROLLED_OBSERVATION_STEPS = 262;
export const MAX_CONTROLLED_OBSERVED_SHOTS = 1_000_000;
const MAX_TOTAL_STEPS = MAX_CONTROLLED_OBSERVED_SHOTS * MAX_CONTROLLED_SHOT_STEPS;

export interface ControlledTimeTotal {
  shotCount: number;
  /** Full cumulative cost normally; retained-window sum when recentShotSteps exists. */
  totalSteps: number;
  /** Present only for a retained solo window with an authoritative count. */
  recentShotSteps?: number[];
}

export interface ControlledTimeContext {
  completedShotCount?: number;
  holes?: readonly { id: string; tee: { x: number; y: number }; pin: { x: number; y: number } }[];
}

export interface ControlledTimeObservation extends ControlledTimeTotal {
  scope: string;
  roundId: string;
}

/** Optional save payload: only one observed controlled round, with its debt. */
export interface ControlledTimeLedger {
  version: 1;
  scope: string;
  roundId: string;
  observedShotCount: number;
  observedTotalSteps: number;
  pendingSteps: number;
  /** Window-mode marker only; observedTotalSteps remains the running financial total. */
  observedWindowSteps?: number;
}

function integer(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    && value.trim() === value && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validTotal(count: unknown, steps: unknown, maxShots = MAX_CONTROLLED_TIME_SHOTS): boolean {
  return integer(count, maxShots) && integer(steps, MAX_TOTAL_STEPS)
    && steps <= count * MAX_CONTROLLED_SHOT_STEPS && (count > 0 ? steps > 0 : steps === 0);
}

function quantize(minutes: number): number {
  return Math.ceil(minutes / FIXED_GAME_STEP_MINUTES - 1e-9);
}

/** Return null for malformed source facts; never substitute guessed timing. */
export function controlledShotTimeSteps(trace: PlayerShotTrace, yardsPerTile: number): number | null {
  if (!trace || !Number.isFinite(yardsPerTile) || yardsPerTile <= 0
    || !Number.isFinite(trace.carryYards) || trace.carryYards < 0
    || !trace.from || !trace.rest
    || ![trace.from.x, trace.from.y, trace.rest.x, trace.rest.y].every(Number.isFinite)
    || typeof trace.club !== "string" || trace.club.length === 0) return null;
  const putts = trace.greenPutting?.putts ?? 0;
  if (trace.greenPutting !== undefined && (!trace.greenPutting || trace.greenPutting.version !== 1
    || !Number.isInteger(putts) || putts < 1 || putts > 3)) return null;
  const puttMinutes = LIVE.pace.puttPause + LIVE.pace.puttFlight + LIVE.pace.puttWalk;
  const flightMinutes = Math.max(LIVE.pace.flightMin, Math.min(LIVE.pace.flightMax,
    trace.carryYards / yardsPerTile * LIVE.pace.flightPerTile));
  const walkMinutes = Math.hypot(trace.rest.x - trace.from.x, trace.rest.y - trace.from.y) * LIVE.pace.walkPerTile;
  const minutes = (trace.club === "Putter" ? puttMinutes : LIVE.pace.swingPause + flightMinutes + walkMinutes)
    + putts * puttMinutes;
  // Remove only floating representation noise at exact fixed-step boundaries.
  const steps = quantize(minutes);
  return Number.isFinite(minutes) && integer(steps, MAX_CONTROLLED_SHOT_STEPS) && steps > 0 ? steps : null;
}

/**
 * Read immutable committed traces. Pass the authoritative completed count for
 * a retained solo window; its length is not the lifetime shot count. Window
 * totals describe only retained costs, and observeControlledTime accumulates
 * newly committed tail costs. Aiming and playback have no inputs.
 */
export function controlledParticipantTime(shots: readonly PlayerShotTrace[], yardsPerTile: number, context?: ControlledTimeContext): ControlledTimeTotal | null {
  const windowed = context?.completedShotCount !== undefined;
  const completedShotCount = context?.completedShotCount ?? shots?.length;
  if (!Array.isArray(shots) || shots.length > (windowed ? MAX_CONTROLLED_RECENT_SHOTS : MAX_CONTROLLED_TIME_SHOTS)
    || !integer(completedShotCount, windowed ? MAX_CONTROLLED_OBSERVED_SHOTS : MAX_CONTROLLED_TIME_SHOTS)
    || completedShotCount < shots.length || (completedShotCount > 0 && shots.length === 0)
    || !Number.isFinite(yardsPerTile) || yardsPerTile <= 0) return null;
  let totalSteps = 0;
  const recentShotSteps: number[] = [];
  for (let index = 0; index < shots.length; index++) {
    const trace = shots[index];
    const steps = controlledShotTimeSteps(trace, yardsPerTile);
    if (steps === null) return null;
    let transitionSteps = steps;
    const previous = shots[index - 1];
    // Debit the capped inter-hole walk with the next committed shot. A first
    // retained trace has no known predecessor, so no historical edge is guessed.
    if (previous && previous.holeId !== trace.holeId) {
      const from = previous.greenPutting
        ? context?.holes?.find((hole) => hole.id === previous.holeId)?.pin
        : previous.rest;
      if (!from || ![from.x, from.y].every(Number.isFinite)) return null;
      const minutes = Math.min(LIVE.pace.interHoleWalkCap,
        Math.hypot(trace.from.x - from.x, trace.from.y - from.y) * LIVE.pace.walkPerTile);
      if (!Number.isFinite(minutes)) return null;
      transitionSteps += quantize(minutes);
    }
    if (!integer(transitionSteps, MAX_CONTROLLED_SHOT_STEPS)) return null;
    recentShotSteps.push(transitionSteps);
    totalSteps += transitionSteps;
  }
  return { shotCount: completedShotCount, totalSteps, ...(windowed ? { recentShotSteps } : {}) };
}

/** Participants play concurrently: shared elapsed time is the largest total. */
export function controlledGroupTime(participants: readonly {
  shots: readonly PlayerShotTrace[];
  yardsPerTile: number;
  holes?: ControlledTimeContext["holes"];
}[]): ControlledTimeTotal | null {
  if (!Array.isArray(participants) || participants.length > 4) return null;
  let shotCount = 0;
  let totalSteps = 0;
  for (const participant of participants) {
    if (!participant) return null;
    const total = controlledParticipantTime(participant.shots, participant.yardsPerTile, { holes: participant.holes });
    if (!total) return null;
    shotCount += total.shotCount;
    totalSteps = Math.max(totalSteps, total.totalSteps);
  }
  return validTotal(shotCount, totalSteps) ? { shotCount, totalSteps } : null;
}

/** Strictly validate the optional payload before resuming any pending quantum. */
export function restoreControlledTimeLedger(value: unknown): ControlledTimeLedger | null {
  if (!record(value)) return null;
  const windowed = Object.hasOwn(value, "observedWindowSteps");
  const keys = ["version", "scope", "roundId", "observedShotCount", "observedTotalSteps", "pendingSteps"];
  if (!exactFields(value, windowed ? [...keys, "observedWindowSteps"] : keys)
    || value.version !== 1 || !identifier(value.scope) || !identifier(value.roundId)
    || !validTotal(value.observedShotCount, value.observedTotalSteps, windowed ? MAX_CONTROLLED_OBSERVED_SHOTS : MAX_CONTROLLED_TIME_SHOTS)
    || !integer(value.pendingSteps, MAX_TOTAL_STEPS) || value.pendingSteps > (value.observedTotalSteps as number)
    || (windowed && (!validTotal(Math.min(value.observedShotCount as number, MAX_CONTROLLED_OBSERVATION_STEPS), value.observedWindowSteps)
      || (value.observedWindowSteps as number) > (value.observedTotalSteps as number)))) return null;
  return {
    version: 1, scope: value.scope, roundId: value.roundId,
    observedShotCount: value.observedShotCount as number,
    observedTotalSteps: value.observedTotalSteps as number,
    pendingSteps: value.pendingSteps,
    ...(windowed ? { observedWindowSteps: value.observedWindowSteps as number } : {}),
  };
}

export interface ControlledTimeObservationResult {
  status: "baseline" | "queued" | "unchanged" | "invalid" | "pending-scope";
  ledger: ControlledTimeLedger | null;
}

/**
 * First observation establishes a legacy baseline without historical charges.
 * Observe a new round's empty trace arrays before its first committed shot.
 * A scope change cannot discard debt: drain the retained ledger, then observe
 * the new round. Day/week boundaries never enter this ledger or erase debt.
 */
export function observeControlledTime(ledger: ControlledTimeLedger | null, observation: ControlledTimeObservation): ControlledTimeObservationResult {
  const previous = ledger === null ? null : restoreControlledTimeLedger(ledger);
  const result = (status: ControlledTimeObservationResult["status"], next = previous): ControlledTimeObservationResult => ({ status, ledger: next });
  if (ledger !== null && !previous) return result("invalid");
  if (!record(observation)) return result("invalid");
  const windowed = Object.hasOwn(observation, "recentShotSteps");
  const keys = ["scope", "roundId", "shotCount", "totalSteps"];
  if (!exactFields(observation, windowed ? [...keys, "recentShotSteps"] : keys)
    || !identifier(observation.scope) || !identifier(observation.roundId)
    || !validTotal(observation.shotCount, observation.totalSteps, windowed ? MAX_CONTROLLED_OBSERVED_SHOTS : MAX_CONTROLLED_TIME_SHOTS)) return result("invalid");
  const recent = observation.recentShotSteps;
  if (windowed && (!Array.isArray(recent) || recent.length > Math.min(observation.shotCount, MAX_CONTROLLED_OBSERVATION_STEPS)
    || (observation.shotCount > 0 && recent.length === 0)
    || !recent.every((steps) => integer(steps, MAX_CONTROLLED_SHOT_STEPS) && steps > 0)
    || recent.reduce((sum, steps) => sum + steps, 0) !== observation.totalSteps)) return result("invalid");
  if (!previous || previous.scope !== observation.scope || previous.roundId !== observation.roundId) {
    if (previous && previous.pendingSteps > 0) return result("pending-scope");
    return result("baseline", {
      version: 1, scope: observation.scope, roundId: observation.roundId,
      observedShotCount: observation.shotCount, observedTotalSteps: observation.totalSteps, pendingSteps: 0,
      ...(windowed ? { observedWindowSteps: observation.totalSteps } : {}),
    });
  }
  if (previous.observedWindowSteps !== undefined && !windowed) return result("invalid");
  if (windowed && previous.observedWindowSteps === undefined && previous.observedShotCount > 0) {
    // A pre-window ledger's retained count might already have saturated. Only
    // an identical observation can establish the new mode without guessing.
    if (observation.shotCount !== previous.observedShotCount || observation.totalSteps !== previous.observedTotalSteps) return result("invalid");
    return result("unchanged", { ...previous, observedWindowSteps: observation.totalSteps });
  }
  if (observation.shotCount <= previous.observedShotCount) {
    const consistent = observation.shotCount === previous.observedShotCount
      // A trusted batch and the later ordinary retained window can have
      // different sums at the same authoritative count. Neither adds debt.
      ? windowed || observation.totalSteps === previous.observedTotalSteps
      : observation.totalSteps <= previous.observedTotalSteps;
    return result(consistent ? "unchanged" : "invalid", consistent && windowed
      ? { ...previous, observedWindowSteps: previous.observedWindowSteps ?? observation.totalSteps } : previous);
  }
  if (windowed && recent) {
    const gap = observation.shotCount - previous.observedShotCount;
    // The first newly observed shot needs its predecessor for inter-hole time.
    // Full initial history begins at shot zero and has no preceding edge.
    if (gap > recent.length || (gap === recent.length && previous.observedShotCount > 0)) return result("invalid");
    const delta = recent.slice(-gap).reduce((sum, steps) => sum + steps, 0);
    return result("queued", {
      ...previous, observedShotCount: observation.shotCount,
      observedTotalSteps: previous.observedTotalSteps + delta,
      observedWindowSteps: observation.totalSteps, pendingSteps: previous.pendingSteps + delta,
    });
  }
  const delta = observation.totalSteps - previous.observedTotalSteps;
  if (delta < 0 || delta > (observation.shotCount - previous.observedShotCount) * MAX_CONTROLLED_SHOT_STEPS) return result("invalid");
  return result("queued", {
    ...previous, observedShotCount: observation.shotCount, observedTotalSteps: observation.totalSteps,
    pendingSteps: previous.pendingSteps + delta,
  });
}

/** Call exactly once after an ordinary fixed live quantum actually executes. */
export function consumeControlledTimeStep(ledger: ControlledTimeLedger): ControlledTimeLedger | null {
  const valid = restoreControlledTimeLedger(ledger);
  return valid ? { ...valid, pendingSteps: Math.max(0, valid.pendingSteps - 1) } : null;
}
