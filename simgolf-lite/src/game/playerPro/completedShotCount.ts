import type { PlayerPlayableRound } from "../models/playerProTypes";

export const MAX_RETAINED_PLAYER_SHOTS = 240;

/** Terminal accounting evidence only; RNG and score authority stay unchanged. */
export function isValidTerminalCompletedShotCount(round: PlayerPlayableRound): boolean {
  const count = round.completedShotCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= round.shots.length
    && round.phase === "conceded" && round.pendingShot === null
    && Number.isSafeInteger(round.rngCursor) && (round.rngCursor - count === 0 || round.rngCursor - count === 1);
}

/** A discarded pending attempt has consumed RNG, but has no completed trace. */
export function completedPlayerShotCount(round: PlayerPlayableRound): number | null {
  if (round.completedShotCount !== undefined) return isValidTerminalCompletedShotCount(round) ? round.completedShotCount : null;
  if (round.phase === "conceded") {
    // Legacy uncapped history is complete. At the retention cap, an absent
    // terminal marker cannot prove whether the last RNG attempt was discarded.
    return round.shots.length < MAX_RETAINED_PLAYER_SHOTS || round.shots.length === round.rngCursor ? round.shots.length : null;
  }
  const count = round.rngCursor - (round.phase === "flight" && round.pendingShot ? 1 : 0);
  return Number.isSafeInteger(count) && count >= round.shots.length ? count : null;
}
