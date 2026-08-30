import { expect, type Locator, type Page } from "@playwright/test";

export const TOURNAMENT_FIXTURE_READY_TIMEOUT_MS = 45_000;
export const TOURNAMENT_FIXTURE_ADVANCE_STEPS = 5;

export interface PublicTournamentFieldEvidence {
  readonly active: boolean;
  readonly rows: readonly string[];
}

function tournamentTextState(page: Page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
}

export async function openTournamentPanel(page: Page, expectedCourseName: string, requireSchedulingReadiness = true): Promise<Locator> {
  await expect.poll(
    () => tournamentTextState(page).then((state) => ({ screen: state.screen, courseName: state.course?.name })),
    { timeout: TOURNAMENT_FIXTURE_READY_TIMEOUT_MS },
  ).toEqual({ screen: "game", courseName: expectedCourseName });

  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-tournaments").click();

  const panel = page.getByTestId("tournament-panel");
  await expect(panel).toBeVisible({ timeout: TOURNAMENT_FIXTURE_READY_TIMEOUT_MS });
  if (requireSchedulingReadiness) {
    await expect(panel.getByTestId("tournament-readiness")).toBeVisible();
    await expect(panel.getByTestId("schedule-tournament")).toBeVisible();
  }
  return panel;
}

export async function bookTournament(page: Page, panel: Locator): Promise<void> {
  await panel.getByTestId("schedule-tournament").click();
  await expect.poll(
    () => tournamentTextState(page).then((state) => state.tournament?.scheduled),
    { timeout: TOURNAMENT_FIXTURE_READY_TIMEOUT_MS },
  ).toBe(1);
  await expect(panel.getByText("Tournament booked.")).toBeVisible({ timeout: TOURNAMENT_FIXTURE_READY_TIMEOUT_MS });
}

/**
 * Advance the public fixture in one browser turn so React publishes only the
 * resulting state instead of serializing an intermediate full game envelope
 * between each deterministic two-second step.
 */
export async function advanceTournamentFixture(page: Page, steps = TOURNAMENT_FIXTURE_ADVANCE_STEPS): Promise<void> {
  await page.evaluate((count) => {
    for (let index = 0; index < count; index++) window.advanceTime?.(2_000);
  }, steps);
}

/**
 * Read the whole published leaderboard rather than the compact text-state
 * summary, which deliberately retains only the leading five entrants.
 */
export async function publicTournamentFieldEvidence(page: Page): Promise<PublicTournamentFieldEvidence> {
  const activeTournament = page.getByTestId("active-tournament");
  if (!await activeTournament.isVisible()) return { active: false, rows: [] };
  return {
    active: true,
    rows: await activeTournament.getByTestId("tournament-leaderboard").locator("li").allTextContents(),
  };
}
