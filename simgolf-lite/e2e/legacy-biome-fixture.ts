import { expect, type Page } from "@playwright/test";

export type LegacyBiomeTheme = "parkland" | "links" | "desert";

type LegacyBiomeFixtureContract = {
  theme: LegacyBiomeTheme;
  courseName: string;
  minimumObstacleCount?: number;
  decorationCount?: number;
};

// The legacy biome fixtures build a whole reference course after the app shell
// mounts. In a shared CI runner that can take longer than Playwright's default
// 5s poll; wait for the observable fixture contract instead of treating the
// first published theme value as proof that its terrain is ready to capture.
const LEGACY_BIOME_FIXTURE_TIMEOUT_MS = 45_000;

export async function waitForLegacyBiomeFixture(
  page: Page,
  contract: LegacyBiomeFixtureContract,
): Promise<void> {
  await expect.poll(
    () => page.evaluate((expected) => {
      const read = window.render_game_to_text?.();
      if (!read) return false;

      let state: {
        screen?: string;
        course?: {
          theme?: string;
          name?: string;
          obstacleCounts?: Record<string, number>;
          decorations?: unknown[];
        };
      };
      try {
        state = JSON.parse(read);
      } catch {
        return false;
      }

      const obstacleCount = Object.values(state.course?.obstacleCounts ?? {})
        .reduce((sum, value) => sum + Number(value), 0);
      const canvas = document.querySelector<HTMLCanvasElement>(".cc-pixi-stage canvas");
      const bounds = canvas?.getBoundingClientRect();
      const style = canvas ? getComputedStyle(canvas) : null;
      const visibleCanvas = Boolean(
        canvas
          && canvas.isConnected
          && canvas.width > 0
          && canvas.height > 0
          && bounds
          && bounds.width > 0
          && bounds.height > 0
          && style?.display !== "none"
          && style?.visibility !== "hidden"
          && Number(style?.opacity) > 0,
      );

      return state.screen === "game"
        && state.course?.theme === expected.theme
        && state.course?.name === expected.courseName
        && (expected.minimumObstacleCount == null || obstacleCount >= expected.minimumObstacleCount)
        && (expected.decorationCount == null || state.course?.decorations?.length === expected.decorationCount)
        && visibleCanvas;
    }, contract),
    { timeout: LEGACY_BIOME_FIXTURE_TIMEOUT_MS, intervals: [250, 500, 1_000] },
  ).toBe(true);
}
