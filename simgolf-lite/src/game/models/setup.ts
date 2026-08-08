import type {
  Difficulty,
  EconomicPressure,
  ExperienceProfile,
  LandTheme,
  PlayMode,
} from "./types";
import type { PlayerProAppearance, PlayerProBackground, PlayerProHandedness } from "./playerProTypes";

// New-game setup (ZKU-162): the wizard's output. One typed object, one
// creation path (game/gen/newGame.ts createNewGame) — no scattered init.

export interface SandboxOverrides {
  /** Starting cash override (sandbox only; career/scenarios pin their own). */
  startingCash?: number;
}

export interface GameSetup {
  mode: PlayMode;
  courseName: string;
  founderName?: string;
  /** Land generation seed — displayed and re-enterable so players can share land. */
  seed: number;
  theme: LandTheme;
  /** Independent player-facing complexity/presentation contract. */
  experienceProfile?: ExperienceProfile;
  /** Independent economy pressure contract. */
  economicPressure?: EconomicPressure;
  /** @deprecated Compatibility input for callers not yet moved to both axes. */
  difficulty?: Difficulty;
  playerPro?: {
    name: string;
    appearance: PlayerProAppearance;
    handedness: PlayerProHandedness;
    background: PlayerProBackground;
  };
  sandboxOverrides?: SandboxOverrides;
}

// A sandbox must be able to reproduce every certified fresh-run amount, then
// leave ample room for review/property fixtures without an artificial $100K cap.
export const SANDBOX_STARTING_CASH = { min: 10_000, max: 500_000, step: 5_000 } as const;
