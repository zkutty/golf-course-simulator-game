import { LIVE, type SpeedName } from "./liveConfig";

export const FIXED_GAME_STEP_MINUTES = 0.05;

export interface ClockAdvance {
  steps: number;
  remainderMinutes: number;
}

/** Convert wall time into deterministic, fixed-size simulation steps. */
export function consumeClock(
  realMs: number,
  speed: SpeedName,
  remainderMinutes = 0,
): ClockAdvance {
  if (!Number.isFinite(realMs) || realMs <= 0 || speed === "paused") {
    return { steps: 0, remainderMinutes };
  }
  const available = remainderMinutes + (realMs / 1000) * LIVE.speed[speed];
  const steps = Math.floor((available + 1e-9) / FIXED_GAME_STEP_MINUTES);
  return {
    steps,
    remainderMinutes: Math.max(0, available - steps * FIXED_GAME_STEP_MINUTES),
  };
}
