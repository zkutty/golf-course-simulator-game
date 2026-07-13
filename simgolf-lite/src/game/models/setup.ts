import type { Difficulty, LandTheme, PlayMode } from "./types";

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
  difficulty: Difficulty;
  sandboxOverrides?: SandboxOverrides;
}

export const SANDBOX_STARTING_CASH = { min: 10_000, max: 100_000, step: 5_000 } as const;
