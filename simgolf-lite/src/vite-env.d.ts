/// <reference types="vite/client" />

/** App version injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;

interface Window {
  __coursecraftTest?: {
    state(): { screen: string; week: number; cash: number; courseHash: string };
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
  };
}
