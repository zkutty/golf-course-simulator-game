import { isShotPacingCursor, shotPacingDurationMs, type ShotPacingCursorV1, type ShotPacingFrame, type ShotPacingPhase, type ShotPacingPlan } from "../live/shotPacing";
import type { PlayerPlayableRound } from "../models/playerProTypes";
import type { RetainedShotMotionV1, ShotMotionIdentityV1 } from "../rules/shotMotion";
/** Presentation-only cursor. Scores, shot outcomes and RNG never depend on it. */
export interface PlayerShotPresentationV1 {
  version: 1;
  shotId: string;
  progress: number;
}
export interface PlayerShotPlaybackFrame {
  shotId: string;
  progress: number;
  motionProgress: number;
  addressing: boolean;
  complete: boolean;
  phase?: ShotPacingPhase;
  addressProgress?: number;
}
/** Transient body-source DTO. This is not a saved cursor or a second clock. */
export interface PlayerShotActivitySampleV1 {
  readonly version: 1;
  readonly roundId: string;
  readonly actorId: string;
  readonly key: string;
  readonly owner: { readonly scopeId: string; readonly actorId: string; readonly shot: Readonly<ShotMotionIdentityV1> };
  readonly handedness: "right" | "left" | null;
  readonly equipmentClass: "driver" | "iron" | "wedge" | "putter" | null;
  readonly origin: { readonly horizontal: "tiles"; readonly vertical: "yards"; readonly x: number; readonly y: number; readonly heightYards: number };
  readonly targetWorld: Readonly<{ x: number; y: number }> | null;
  readonly plan: ShotPacingPlan;
  readonly cursor: ShotPacingCursorV1;
  readonly frame: ShotPacingFrame;
  readonly retainedEvidence: { readonly key: string; readonly validated: true };
}
const sameIdentity = (a: Readonly<ShotMotionIdentityV1>, b: Readonly<ShotMotionIdentityV1>) =>
  a.shotId === b.shotId && a.holeId === b.holeId && a.shotNumber === b.shotNumber && a.seed === b.seed && a.club === b.club && a.style === b.style && a.modelVersion === b.modelVersion;
function retainedTarget(motion: RetainedShotMotionV1): PlayerShotActivitySampleV1["targetWorld"] {
  const target = motion.flight?.geometry?.to ?? motion.groundPath?.[1]?.point;
  if (!target) return null;
  const x = target.x - motion.from.point.x, y = target.y - motion.from.point.y, length = Math.hypot(x, y);
  return Number.isFinite(length) && length > 1e-8 ? Object.freeze({ x: x / length, y: y / length }) : null;
}
function retainedEquipment(club: string): PlayerShotActivitySampleV1["equipmentClass"] {
  if (club === "Putter") return "putter";
  if (club === "Driver") return "driver";
  if (club === "5 Iron" || club === "7 Iron") return "iron";
  if (club === "Pitching Wedge" || club === "Sand Wedge") return "wedge";
  return null;
}

/** Snapshot only the actual shared plan/cursor/frame. Never derive a cursor from progress. */
export function playerShotActivitySample(plan: ShotPacingPlan, cursor: ShotPacingCursorV1, frame: ShotPacingFrame, motion: RetainedShotMotionV1,
  roundId: string, actorId: string, handedness: "right" | "left" | null): PlayerShotActivitySampleV1 | null {
  const identity = motion.identity;
  if (!identity || !motion.from?.point || (handedness !== null && handedness !== "right" && handedness !== "left")) return null;
  const key = JSON.stringify([roundId, actorId, identity.shotId, identity.holeId, identity.shotNumber, identity.seed, identity.club, identity.style, identity.modelVersion]);
  if (plan.scopeId !== roundId || plan.actorId !== actorId || plan.key !== key || !sameIdentity(plan.identity, identity) || !isShotPacingCursor(cursor, plan)
    || frame.key !== key || frame.shotId !== identity.shotId || !Number.isFinite(frame.progress) || !Number.isFinite(frame.motionProgress) || frame.motionProgress < 0 || frame.motionProgress > 1
    || !["address", "contact", "flight", "roll", "rest", "complete"].includes(frame.phase) || frame.complete !== (cursor.elapsedMs === plan.durationMs)
    || frame.addressing !== (cursor.elapsedMs < plan.addressMs + plan.contactMs) || Math.abs(frame.progress - cursor.elapsedMs / plan.durationMs) > 1e-12
    || ![motion.from.point.x, motion.from.point.y, motion.from.heightYards].every(Number.isFinite)) return null;
  const shot = Object.freeze({ shotId: identity.shotId, holeId: identity.holeId, shotNumber: identity.shotNumber, seed: identity.seed, club: identity.club, style: identity.style, modelVersion: identity.modelVersion });
  return Object.freeze({ version: 1, roundId, actorId, key, owner: Object.freeze({ scopeId: roundId, actorId, shot }), handedness,
    equipmentClass: retainedEquipment(identity.club), origin: Object.freeze({ horizontal: "tiles", vertical: "yards", x: motion.from.point.x, y: motion.from.point.y, heightYards: motion.from.heightYards }),
    targetWorld: retainedTarget(motion), plan: Object.freeze({ version: plan.version, scopeId: plan.scopeId, actorId: plan.actorId, key, identity: shot, kind: plan.kind,
      durationMs: plan.durationMs, addressMs: plan.addressMs, contactMs: plan.contactMs, restMs: plan.restMs, firstContactT: plan.firstContactT }),
    cursor: Object.freeze({ version: cursor.version, key: cursor.key, elapsedMs: cursor.elapsedMs }),
    frame: Object.freeze({ key: frame.key, shotId: frame.shotId, progress: frame.progress, motionProgress: frame.motionProgress, phase: frame.phase, addressing: frame.addressing, complete: frame.complete }),
    retainedEvidence: Object.freeze({ key, validated: true as const }) });
}

/** Revalidate every publication against the current round/participant, even with unchanged round id. */
export function playerShotActivityIsCurrent(sample: PlayerShotActivitySampleV1 | null, round: PlayerPlayableRound | null, actorId = "player"): boolean {
  const pending = round?.phase === "flight" ? round.pendingShot : null;
  const motion = pending?.sharedOutcome?.motion;
  return !!sample && !!round && !!pending && !!motion?.identity && !!motion.from?.point && sample.roundId === round.id && sample.actorId === actorId
    && sample.handedness === (round.handedness === "right" || round.handedness === "left" ? round.handedness : null)
    && sameIdentity(sample.owner.shot, motion.identity) && pending.id === sample.frame.shotId
    && sample.origin.x === motion.from.point.x && sample.origin.y === motion.from.point.y && sample.origin.heightYards === motion.from.heightYards
    && JSON.stringify(sample.targetWorld) === JSON.stringify(retainedTarget(motion));
}
export const PLAYER_SHOT_CONTACT_FRACTION = .18;
export function isPlayerShotPresentation(value: unknown, shotId: string): value is PlayerShotPresentationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<PlayerShotPresentationV1>;
  return Object.keys(v).length === 3 && v.version === 1 && v.shotId === shotId
    && typeof v.progress === "number" && Number.isFinite(v.progress) && v.progress >= 0 && v.progress <= 1;
}
export function playerShotDurationMs(club: string, carryYards: number): number {
  return shotPacingDurationMs(club === "Putter" ? "putt" : "swing", Math.max(0, carryYards)) ?? 6000;
}
export function playerShotPlaybackFrame(shotId: string, progress: number): PlayerShotPlaybackFrame {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return { shotId, progress: p, motionProgress: Math.max(0, (p - PLAYER_SHOT_CONTACT_FRACTION) / (1 - PLAYER_SHOT_CONTACT_FRACTION)),
    addressing: p < PLAYER_SHOT_CONTACT_FRACTION, complete: p === 1 };
}
export function advancePlayerShotPresentation(cursor: PlayerShotPresentationV1, elapsedMs: number, durationMs: number, paused = false): PlayerShotPresentationV1 {
  if (paused || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return cursor;
  return { ...cursor, progress: Math.min(1, cursor.progress + Math.min(elapsedMs, 100) / durationMs) };
}
