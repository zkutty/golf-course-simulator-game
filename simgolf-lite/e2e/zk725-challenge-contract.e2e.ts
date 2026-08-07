import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function openBuilder(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setChallengeContractFixture());
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  const panel = page.getByTestId("player-pro-panel");
  await panel.getByRole("button", { name: "Matches", exact: true }).click();
  const builder = page.getByTestId("challenge-contract-builder");
  await expect(builder).toBeVisible();
  return builder;
}

async function attach(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true }), contentType: "image/png" });
}

test("cash-only escrow warns clearly and pre-shot cancellation refunds exactly", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await openBuilder(page);
  await expect(page.getByTestId("challenge-format").locator("option")).toHaveText(["individual", "four-ball", "alternate-shot", "scramble"]);
  await expect(page.getByTestId("challenge-scoring").locator("option")).toHaveCount(5);
  await expect(page.getByTestId("challenge-stakes-warning")).toContainText("After a shot, settle or concede");
  await expect(page.getByTestId("challenge-value-preview")).toContainText("0.0%");
  await page.getByTestId("accept-challenge-contract").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(9_900);
  await attach(page, testInfo, "zk725-cash-escrowed");
  await page.getByRole("button", { name: "Concede", exact: true }).click();
  await expect(page.getByTestId("player-shot-hud")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(10_000);
  expect(JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}")).playerPro.activeChallengeGroupRound).toBeNull();
  await attach(page, testInfo, "zk725-pre-shot-refund");
  expect(errors).toEqual([]);
});

test("four-ball terms become operative and post-shot concession settles once", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const builder = await openBuilder(page);
  await page.getByTestId("challenge-format").selectOption("four-ball");
  await page.getByTestId("challenge-player-partner").selectOption("partner-one");
  await page.getByTestId("challenge-rival-partner").selectOption("partner-two");
  await expect(page.getByTestId("accept-challenge-contract")).toBeEnabled();
  await page.getByTestId("accept-challenge-contract").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("commit-player-shot").click();
  await expect(page.getByRole("button", { name: "Concede", exact: true })).toBeVisible();
  await attach(page, testInfo, "zk725-four-ball-live");
  await page.getByRole("button", { name: "Concede", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(9_900);
  if (!await page.getByTestId("player-pro-panel").count()) await page.getByTestId("open-player-pro").click();
  await expect(page.getByTestId("player-pro-panel")).toBeVisible();
  await page.getByTestId("player-pro-panel").getByRole("button", { name: "Matches", exact: true }).click();
  await expect(builder).toContainText("conceded");
  await attach(page, testInfo, "zk725-team-concession-settled");
  expect(errors).toEqual([]);
});

test("ordinary item loss creates named custody and an authored winning rematch recovers it", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const builder = await openBuilder(page);
  await page.getByTestId("challenge-player-cash").fill("0");
  await page.getByTestId("challenge-rival-cash").fill("0");
  await builder.getByText("Contract Player items (0)", { exact: true }).click();
  await builder.getByText("Rival One items (0)", { exact: true }).click();
  await page.getByTestId("challenge-player-item-player-ordinary-keepsake").check();
  await page.getByTestId("challenge-rival-item-rival-ordinary-keepsake").check();
  await page.getByTestId("challenge-confirm-owner").check();
  await page.getByTestId("challenge-confirm-rival").check();
  await page.getByTestId("accept-challenge-contract").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("commit-player-shot").click();
  await page.getByRole("button", { name: "Concede", exact: true }).click();
  if (!await page.getByTestId("player-pro-panel").count()) await page.getByTestId("open-player-pro").click();
  await expect(page.getByTestId("player-pro-panel")).toBeVisible();
  await page.getByTestId("player-pro-panel").getByRole("button", { name: "Matches", exact: true }).click();
  await expect(builder).toContainText("Player Ordinary Keepsake · held · Rival One");
  await attach(page, testInfo, "zk725-named-rival-custody");
  await page.getByTestId("prepare-rematch-custody:player-challenge:725101:1:player-ordinary-keepsake").click();
  await page.getByTestId("accept-challenge-contract").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("commit-player-shot").click();
  await page.evaluate(() => window.__coursecraftTest!.forceChallengeRivalWithdrawal());
  await page.getByRole("button", { name: "Auto-finish", exact: true }).click();
  if (!await page.getByTestId("player-pro-panel").count()) await page.getByTestId("open-player-pro").click();
  await expect(page.getByTestId("player-pro-panel")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("player-pro-panel").getByRole("button", { name: "Matches", exact: true }).click();
  await expect(builder).toContainText("Player Ordinary Keepsake · recovered · Rival One");
  await attach(page, testInfo, "zk725-rematch-recovered");
  expect(errors).toEqual([]);
});

test("high-prestige stakes require the second confirmation and tie/refund returns all cash", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  const builder = await openBuilder(page);
  await page.getByTestId("challenge-player-cash").fill("0");
  await page.getByTestId("challenge-rival-cash").fill("0");
  await builder.getByText("Contract Player items (0)", { exact: true }).click();
  await builder.getByText("Rival One items (0)", { exact: true }).click();
  await page.getByTestId("challenge-player-item-player-prestige-club").check();
  await page.getByTestId("challenge-rival-item-rival-prestige-club").check();
  await page.getByTestId("challenge-confirm-owner").check();
  await page.getByTestId("challenge-confirm-rival").check();
  await page.getByTestId("accept-challenge-contract").click();
  await expect(page.getByRole("status").filter({ hasText: "unique or high-prestige" })).toBeVisible();
  await page.getByTestId("challenge-confirm-prestige").check();
  await page.getByTestId("accept-challenge-contract").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Concede", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(10_000);

  if (!await page.getByTestId("player-pro-panel").count()) await page.getByTestId("open-player-pro").click();
  await expect(page.getByTestId("player-pro-panel")).toBeVisible();
  await page.getByTestId("player-pro-panel").getByRole("button", { name: "Matches", exact: true }).click();
  await page.getByTestId("challenge-player-cash").fill("100");
  await page.getByTestId("challenge-rival-cash").fill("100");
  await builder.getByText("Side bets", { exact: true }).click();
  await page.getByTestId("challenge-sidebet-skins").check();
  await page.getByTestId("accept-challenge-contract").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("commit-player-shot").click();
  await page.evaluate(() => window.__coursecraftTest!.forceChallengeTieCompletion());
  await expect(page.getByTestId("player-pro-panel")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(10_000);
  await page.getByTestId("player-pro-panel").getByRole("button", { name: "Matches", exact: true }).click();
  await expect(builder).toContainText("tied");
  await attach(page, testInfo, "zk725-prestige-and-tie-refund");
  expect(errors).toEqual([]);
});
