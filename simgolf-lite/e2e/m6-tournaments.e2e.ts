import { expect, test } from "@playwright/test";

test("M6 schedules events and presents live tournament standings", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m24Fixture=1");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen),
    { timeout: 30_000 },
  ).toBe("game");

  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-tournaments").click();
  await expect(page.getByTestId("tournament-panel")).toBeVisible();
  await page.getByTestId("tournament-tier").selectOption("regional");
  const cashBefore = await page.evaluate(() => window.__coursecraftTest!.state().cash);
  await page.getByTestId("schedule-tournament").click();
  await expect(page.getByTestId("tournament-panel").getByText("Tournament booked.")).toBeVisible();
  await expect(page.getByText("Upcoming")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.scheduled)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(cashBefore - 3_500);

  await page.getByLabel("Close tournaments").click();
  await page.evaluate(() => window.__coursecraftTest!.startTournamentFixture());
  await page.getByTestId("open-tournaments").click();
  await expect(page.getByTestId("active-tournament")).toBeVisible();
  await expect(page.getByTestId("tournament-leaderboard").locator("li")).toHaveCount(8);
  await page.evaluate(() => { for (let index = 0; index < 5; index++) window.advanceTime?.(2_000); });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.active?.standings.some((row: { holesCompleted: number }) => row.holesCompleted > 0))).toBe(true);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.active?.standings.length)).toBe(5);
  const shot = await page.screenshot({ fullPage: true, path: "artifacts/m6-tournament-live.png" });
  await testInfo.attach("m6-tournament-live", { body: shot, contentType: "image/png" });

  await expect.poll(async () => {
    await page.evaluate(() => window.advanceTime?.(2_000));
    return page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.active);
  }, { timeout: 45_000 }).toBeNull();
  await expect(page.getByTestId("active-tournament")).toBeHidden();
  await expect(page.getByText("Recent results")).toBeVisible();
  await expect(page.getByTestId("tournament-panel").locator("details")).toHaveCount(1);
  await page.getByTestId("tournament-panel").locator("summary").click();
  await expect(page.getByTestId("tournament-panel").getByTestId("tournament-leaderboard").locator("li")).toHaveCount(8);
  const resultsShot = await page.screenshot({ fullPage: true, path: "artifacts/m6-tournament-results.png" });
  await testInfo.attach("m6-tournament-results", { body: resultsShot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
