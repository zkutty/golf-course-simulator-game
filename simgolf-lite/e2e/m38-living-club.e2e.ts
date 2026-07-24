import { expect, test } from "@playwright/test";

test("M38 architecture evidence and living club remain inspectable and actionable", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?m38Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").livingClub?.regulars?.length), { timeout: 60_000 }).toBe(1);

  const seeded = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(seeded.livingClub.regulars[0]).toMatchObject({ name: "Morgan Links", rounds: 2 });
  expect(seeded.architectureReview.currentEvidence).toBeGreaterThanOrEqual(20);
  expect(seeded.livingClub.pendingStories).toHaveLength(1);

  const club = page.getByTestId("living-club-panel");
  await expect(club).toBeVisible();
  await expect(club.getByTestId("story-choice-card")).toBeVisible();
  await club.getByRole("button", { name: "Regulars" }).click();
  await expect(club).toContainText("Morgan Links");
  await club.getByTestId("favorite-regular").click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("coursecraft_app_profile_v5") ?? "{}").favoritePersonIds)).toHaveLength(1);

  await club.getByRole("button", { name: "Staff" }).click();
  await expect(club.getByText("Proficiency").first()).toBeVisible();
  const cashBefore = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").economy.cash);
  await club.getByRole("button", { name: "Train" }).first().click();
  await expect(club.getByRole("status")).toContainText("Staff plan updated");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").economy.cash)).toBe(cashBefore - 650);

  await club.getByRole("button", { name: "Stories" }).click();
  await club.getByTestId("story-choice-card").locator('button[data-testid^="story-choice-"]').first().click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").livingClub.journalEntries)).toBe(1);
  await expect(club).toContainText("Club journal");
  const clubShot = await page.screenshot({ path: "artifacts/m38-living-club.png", fullPage: true });
  await testInfo.attach("m38-living-club", { body: clubShot, contentType: "image/png" });
  await club.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("open-architecture-review").click();
  const architecture = page.getByTestId("architecture-review");
  await expect(architecture).toBeVisible();
  await expect(architecture).toContainText("Evidence is ready to review");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview.overlay.traces)).toBeGreaterThan(0);
  await architecture.getByTestId("architecture-overlay-heatmap").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview.overlay.cells)).toBeGreaterThan(0);
  const architectureShot = await page.screenshot({ path: "artifacts/m38-architecture-review.png", fullPage: true });
  await testInfo.attach("m38-architecture-review", { body: architectureShot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
