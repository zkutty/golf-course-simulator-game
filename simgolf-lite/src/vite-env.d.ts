/// <reference types="vite/client" />

/** App version injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;

interface Window {
  render_game_to_text?: () => string;
  advanceTime?: (ms: number) => void;
  __coursecraftTest?: {
    state(): {
      screen: string;
      screenBase: "title" | "setup-wizard" | "loading" | "in-game";
      paused: boolean;
      modal: "options" | "save-load" | "golfopedia" | "scenario-select" | null;
      dirty: boolean;
      speed: "paused" | "1x" | "2x" | "3x";
      dayMinute: number;
      golferPositions: Array<[number, number, number]>;
      week: number;
      cash: number;
      terrainVersion: number;
      economyVersion: number;
      terrainCounts: Partial<Record<import("./game/models/types").Terrain, number>>;
      courseHash: string;
    };
    setPaintCash(cash: number): void;
    runGoldenWeek(): Promise<{
      beforeHash: string;
      afterHash: string;
      week: number;
      cash: number;
      rounds: number;
    }>;
    validateFixture(text: string):
      | { ok: true; migratedFrom: number | null }
      | { ok: false; error: string };
    startTournamentFixture(): void;
    invalidateAndCancelTournamentFixture(): void;
  };
}
