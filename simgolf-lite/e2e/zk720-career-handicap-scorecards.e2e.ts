import { expect, test } from "@playwright/test";

async function dismissTutorial(page: import("@playwright/test").Page) {
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
}

test("ZK-720 renders frozen handicap scorecards on compact and desktop surfaces", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await dismissTutorial(page);
  await page.evaluate(() => window.__coursecraftTest!.setPlayerProFixture());

  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  const panel = page.getByTestId("player-pro-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("player-handicap-summary")).toContainText("Provisional");
  await expect(page.getByTestId("player-handicap-index")).toHaveText(/^\+?\d+\.\d$/);

  await panel.getByRole("button", { name: "Play", exact: true }).click();
  const preview = page.getByTestId("player-round-scorecard");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("rating");
  await expect(preview).toContainText("Frozen scorecard is not postable");
  await expect(preview.getByRole("table", { name: "Hole-by-hole gross and net scorecard" })).toBeVisible();
  await expect(preview).toContainText("Strokes 0");
  await page.screenshot({ path: "artifacts/zk720-desktop-scorecard.png", fullPage: true });

  await page.getByTestId("start-player-round").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible();
  await expect(page.getByTestId("player-round-scorecard")).toContainText("Format: casual");
  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(state.playerPro.handicap).toMatchObject({
    handicapIndex: expect.any(Number),
    confidence: { status: "provisional", eligibleRoundCount: 0 },
    scoreRecords: [],
  });
  expect(state.playerPro.activeRound.handicapSnapshot).toMatchObject({
    course: { teeSet: "member", courseRating: expect.any(Number), slopeRating: expect.any(Number), holes: expect.any(Array) },
    eligibility: { eligible: expect.any(Boolean) },
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const compactCard = page.getByTestId("player-round-scorecard");
  await page.getByTestId("player-shot-hud").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(compactCard).toBeVisible();
  await compactCard.screenshot({ path: "artifacts/zk720-compact-scorecard.png" });
  expect(errors).toEqual([]);
});

test("ZK-720 renders frozen group net cards with format and withdrawal evidence", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await dismissTutorial(page);
  await page.evaluate(() => window.__coursecraftTest!.setChallengeGroupRoundFixture());
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  const card = page.getByTestId("competition-scorecard");
  await expect(card).toBeVisible();
  await expect(card).toContainText("net-match");
  await expect(card).toContainText("concessions 0 · withdrawals 0");
  await card.locator("summary").first().click();
  await expect(card.getByRole("table").first()).toContainText("Gross");
  await expect(card.getByRole("table").first()).toContainText("Net");
  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro);
  expect(state.activeChallengeGroupRound.golfers[0]).toMatchObject({ handicap: expect.any(Object), scorecard: expect.any(Array), withdrawn: false });
  expect(errors).toEqual([]);
});
