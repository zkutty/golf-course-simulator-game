import { isValidRetainedShotMotionV1, type RetainedShotMotionV1, type ShotMotionIdentityV1 } from "../rules/shotMotion";

/** A presentation clock. No field is a simulation duration or a physics input. */
export const SHOT_PACING_VERSION = 1 as const;
export const MAX_SHOT_PACING_FRAME_MS = 100;
export type ShotPacingPhase = "address" | "contact" | "flight" | "roll" | "rest" | "complete";

export interface ShotPacingPlan {
  readonly version: typeof SHOT_PACING_VERSION;
  /** Scope must change on day/round replacement and itinerary reconciliation. */
  readonly scopeId: string;
  readonly actorId: string;
  /** Includes the complete retained identity; shotId alone is not an owner. */
  readonly key: string;
  readonly identity: Readonly<ShotMotionIdentityV1>;
  readonly kind: "swing" | "putt";
  readonly durationMs: number;
  readonly addressMs: number;
  readonly contactMs: number;
  readonly restMs: number;
  readonly firstContactT: number;
}

export interface ShotPacingCursorV1 {
  readonly version: typeof SHOT_PACING_VERSION;
  readonly key: string;
  readonly elapsedMs: number;
}

export interface ShotPacingFrame {
  readonly key: string;
  readonly shotId: string;
  readonly progress: number;
  /** Sample the existing retained trajectory at this time; do not resolve it again. */
  readonly motionProgress: number;
  readonly phase: ShotPacingPhase;
  readonly addressing: boolean;
  readonly complete: boolean;
}

export interface CreateShotPacingPlanInput {
  scopeId: string;
  actorId: string;
  motion: RetainedShotMotionV1;
  /** Retained carry + rollout distance, in yards; never current terrain distance. */
  distanceYards: number;
}

const label = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256
  && Array.from(value).every((character) => character.charCodeAt(0) >= 32);

/** Real milliseconds, independent of LIVE.speed and game-minute shot segments. */
export function shotPacingDurationMs(kind: "swing" | "putt", distanceYards: number): number | null {
  if ((kind !== "swing" && kind !== "putt") || !Number.isFinite(distanceYards) || distanceYards < 0) return null;
  return kind === "putt" ? 2400 + Math.min(40, distanceYards) * 45 : 6000 + Math.min(400, distanceYards) * 10;
}

/** Validate retained evidence once at acquisition, then keep a small immutable plan. */
export function createShotPacingPlan(input: CreateShotPacingPlanInput): ShotPacingPlan | null {
  if (!input || !label(input.scopeId) || !label(input.actorId) || !isValidRetainedShotMotionV1(input.motion)) return null;
  const kind = input.motion.identity.club === "Putter" ? "putt" : "swing";
  const durationMs = shotPacingDurationMs(kind, input.distanceYards);
  if (durationMs === null) return null;
  const identity = Object.freeze({ ...input.motion.identity });
  // JSON tuple boundaries prevent concatenation collisions, including ':' in ids.
  const key = JSON.stringify([input.scopeId, input.actorId, identity.shotId, identity.holeId,
    identity.shotNumber, identity.seed, identity.club, identity.style, identity.modelVersion]);
  return Object.freeze({
    version: SHOT_PACING_VERSION, scopeId: input.scopeId, actorId: input.actorId, key, identity, kind, durationMs,
    addressMs: kind === "putt" ? 500 : 1000,
    contactMs: kind === "putt" ? 150 : 200,
    restMs: kind === "putt" ? 650 : 900,
    firstContactT: input.motion.groundPath[0]!.time,
  });
}

/** Strict optional save carrier: a different owner or malformed cursor starts fresh. */
export function isShotPacingCursor(value: unknown, plan: ShotPacingPlan): value is ShotPacingCursorV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const cursor = value as Partial<ShotPacingCursorV1>;
  return Object.keys(value).length === 3 && Object.keys(value).every((key) => ["version", "key", "elapsedMs"].includes(key))
    && cursor.version === SHOT_PACING_VERSION && cursor.key === plan.key
    && typeof cursor.elapsedMs === "number" && Number.isFinite(cursor.elapsedMs)
    && cursor.elapsedMs >= 0 && cursor.elapsedMs <= plan.durationMs;
}

export function createShotPacingCursor(plan: ShotPacingPlan, saved?: unknown): ShotPacingCursorV1 {
  return Object.freeze(isShotPacingCursor(saved, plan) ? { ...saved } : { version: SHOT_PACING_VERSION, key: plan.key, elapsedMs: 0 });
}

/** Hidden tabs never accumulate a playback backlog. Explicit visible skip wins pause. */
export function advanceShotPacingCursor(
  plan: ShotPacingPlan,
  cursor: ShotPacingCursorV1,
  elapsedMs: number,
  options: { paused?: boolean; hidden?: boolean; skip?: boolean } = {},
): ShotPacingCursorV1 | null {
  if (!isShotPacingCursor(cursor, plan)) return null;
  if (options.hidden || cursor.elapsedMs === plan.durationMs) return cursor;
  if (options.skip) return Object.freeze({ ...cursor, elapsedMs: plan.durationMs });
  if (options.paused || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return cursor;
  return Object.freeze({ ...cursor, elapsedMs: Math.min(plan.durationMs, cursor.elapsedMs + Math.min(MAX_SHOT_PACING_FRAME_MS, elapsedMs)) });
}

/** Motion and event ratios come from the retained source, including collision paths. */
export function shotPacingFrame(plan: ShotPacingPlan, cursor: ShotPacingCursorV1): ShotPacingFrame | null {
  if (!isShotPacingCursor(cursor, plan)) return null;
  const motionStartMs = plan.addressMs + plan.contactMs;
  const motionEndMs = plan.durationMs - plan.restMs;
  const motionProgress = Math.max(0, Math.min(1, (cursor.elapsedMs - motionStartMs) / (motionEndMs - motionStartMs)));
  const complete = cursor.elapsedMs === plan.durationMs;
  const phase: ShotPacingPhase = complete ? "complete"
    : cursor.elapsedMs < plan.addressMs ? "address"
    : cursor.elapsedMs < motionStartMs ? "contact"
    : cursor.elapsedMs >= motionEndMs ? "rest"
    : motionProgress < plan.firstContactT ? "flight" : "roll";
  return { key: plan.key, shotId: plan.identity.shotId, progress: cursor.elapsedMs / plan.durationMs,
    motionProgress, phase, addressing: cursor.elapsedMs < motionStartMs, complete };
}

/** Includes launch/contact and rest; callers suppress historical or skipped audio. */
export function shotPacingEventProgress(plan: ShotPacingPlan, motionTime: number): number | null {
  if (!Number.isFinite(motionTime) || motionTime < 0 || motionTime > 1) return null;
  const motionStartMs = plan.addressMs + plan.contactMs;
  const motionMs = plan.durationMs - plan.restMs - motionStartMs;
  return (motionStartMs + motionTime * motionMs) / plan.durationMs;
}
