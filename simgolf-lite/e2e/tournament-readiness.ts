import { expect, type Locator, type Page } from "@playwright/test";

const FIXTURE_READY_TIMEOUT_MS = 45_000;

function tournamentTextState(page: Page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
}

export async function openTournamentPanel(page: Page, expectedCourseName: string, requireSchedulingReadiness = true): Promise<Locator> {
  await expect.poll(
    () => tournamentTextState(page).then((state) => ({ screen: state.screen, courseName: state.course?.name })),
    { timeout: FIXTURE_READY_TIMEOUT_MS },
  ).toEqual({ screen: "game", courseName: expectedCourseName });

  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-tournaments").click();

  const panel = page.getByTestId("tournament-panel");
  await expect(panel).toBeVisible({ timeout: FIXTURE_READY_TIMEOUT_MS });
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
    { timeout: FIXTURE_READY_TIMEOUT_MS },
  ).toBe(1);
  await expect(panel.getByText("Tournament booked.")).toBeVisible({ timeout: FIXTURE_READY_TIMEOUT_MS });
}
