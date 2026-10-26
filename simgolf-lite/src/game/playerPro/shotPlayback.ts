import { shotPacingDurationMs, type ShotPacingPhase } from "../live/shotPacing";
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
