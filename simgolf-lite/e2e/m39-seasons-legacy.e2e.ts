import { expect, test } from "@playwright/test";

test("M39 forecasts, strategic responses, charters, automation, and annual legacy remain inspectable", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setM39Fixture());

  const panel = page.getByTestId("seasons-legacy-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("club-calendar-date")).toContainText("Year 1");
  await expect(page.getByTestId("current-weather")).toBeVisible();
  await expect(page.getByTestId("seven-day-forecast").locator("> div")).toHaveCount(7);
  const textState = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").seasons);
  expect(textState).toMatchObject({
    panelOpen: true,
    charter: "destination-retreat",
    calendar: { year: 1, weekOfYear: 32, season: "winter" },
    yearbooks: [{ id: "yearbook-1", year: 1, charter: "destination-retreat", dismissed: false }],
  });
  expect(textState.forecast).toHaveLength(7);
  const forecastShot = await page.screenshot({ path: "artifacts/m39-season-forecast.png", fullPage: true });
  await testInfo.attach("m39-season-forecast", { body: forecastShot, contentType: "image/png" });

  await panel.getByRole("button", { name: "Club identity" }).click();
  await expect(panel.getByTestId("charter-destination-retreat")).toContainText("Current charter");
  await panel.getByTestId("automation-preset").selectOption("stewardship");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").seasons.automation.preset)).toBe("stewardship");
  const identityShot = await page.screenshot({ path: "artifacts/m39-charter-automation.png", fullPage: true });
  await testInfo.attach("m39-charter-automation", { body: identityShot, contentType: "image/png" });

  await panel.getByRole("button", { name: "Season" }).click();
  const cashBefore = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").economy.cash);
  await page.getByTestId("improve-drainage").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").seasons.operations.drainageLevel)).toBe(1);
  const cashAfter = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").economy.cash);
  expect(cashAfter).toBeLessThan(cashBefore);

  await panel.getByRole("button", { name: "Legacy" }).click();
  const yearbook = page.getByTestId("yearbook-1");
  await expect(yearbook).toBeVisible();
  await expect(yearbook).toContainText("Course of the Year");
  await expect(yearbook.locator("ol li")).toHaveCount(5);
  const shot = await page.screenshot({ path: "artifacts/m39-seasons-legacy.png", fullPage: true });
  await testInfo.attach("m39-seasons-legacy", { body: shot, contentType: "image/png" });
  await page.getByTestId("acknowledge-yearbook").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").seasons.yearbooks[0].dismissed)).toBe(true);
  expect(errors).toEqual([]);
});
