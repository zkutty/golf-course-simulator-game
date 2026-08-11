import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function startSocialFixture(page: Page, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setChallengeContractFixture());
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  await expect(page.getByTestId("player-pro-panel")).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true }), contentType: "image/png" });
}

test("ZK-731 seven social surfaces retain keyboard focus and never render unrevealed carriers", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await startSocialFixture(page);
  const surfaces = ["people", "challenges", "teamBuilder", "equipment", "wardrobe", "collection", "custody"] as const;
  for (const surface of surfaces) {
    const button = page.getByTestId(`player-pro-tab-${surface}`);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe(`player-pro-tab-${surface}`);
  }

  await page.getByTestId("player-pro-tab-people").click();
  await expect(page.getByTestId("player-pro-people")).toContainText("Rival One");
  await expect(page.getByTestId("player-pro-people")).toContainText("Rival Ordinary Keepsake");
  await expect(page.locator("body")).not.toContainText("UNREVEALED RIVAL VAULT");
  await capture(page, testInfo, "zk731-people-visible-authority");

  await page.getByTestId("player-pro-tab-challenges").click();
  const builder = page.getByTestId("challenge-contract-builder");
  await builder.getByText("Rival One items (0)", { exact: true }).click();
  await expect(builder.locator('[data-testid^="challenge-rival-item-"]')).toHaveCount(2);
  await expect(builder).not.toContainText("UNREVEALED RIVAL VAULT");
  await capture(page, testInfo, "zk731-challenge-preview-known-holdings");

  await page.getByTestId("player-pro-tab-equipment").click();
  const prestigeToggle = page.getByRole("button", { name: "Use default · Player High-Prestige Club", exact: true });
  const bagToggle = page.getByRole("button", { name: "Equip · Player Practice Bag", exact: true });
  await expect(prestigeToggle).toBeVisible();
  await expect(bagToggle).toBeVisible();
  await expect(prestigeToggle).toHaveAttribute("aria-describedby", "social-item-player-prestige-club-warnings");
  const prestigeWarnings = page.locator("#social-item-player-prestige-club-warnings");
  await expect(prestigeWarnings).toContainText("Second confirmation: unique/high-prestige.");
  await expect(prestigeWarnings).toContainText("Transfer uses the default-loadout fallback.");
  await capture(page, testInfo, "zk731-equipment-transfer-warning");
  await page.getByTestId("player-pro-tab-wardrobe").click();
  await expect(page.getByTestId("player-pro-wardrobe")).toContainText("No owned items; using defaults.");
  await capture(page, testInfo, "zk731-wardrobe-default");
  await page.getByTestId("player-pro-tab-collection").click();
  await expect(page.getByTestId("player-pro-collection")).toContainText("Player Ordinary Keepsake");
  const text = JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}"));
  expect(text.playerPro.social).toMatchObject({
    inventory: { items: expect.arrayContaining([expect.objectContaining({ id: "player-ordinary-keepsake" })]), escrowItemIds: [] },
    loadout: { clubItemIds: ["player-prestige-club"] },
    escrow: null,
    custody: [],
    relationships: expect.arrayContaining([expect.objectContaining({ personId: "rival-one", score: 20, tier: "acquaintance" })]),
    collection: { itemIds: ["player-ordinary-keepsake"], rewards: [] },
  });
  await capture(page, testInfo, "zk731-equipment-collection");
  expect(errors).toEqual([]);
});

test("ZK-731 2, 3, and 4 golfer group snapshots remain legible at supported widths", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await startSocialFixture(page);
  const cases = [
    { size: 2 as const, width: 390, height: 844 },
    { size: 3 as const, width: 768, height: 900 },
    { size: 4 as const, width: 1440, height: 1000 },
  ];
  for (const scenario of cases) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.evaluate((size) => window.__coursecraftTest!.setChallengeGroupRoundFixture(size), scenario.size);
    if (!await page.getByTestId("player-pro-panel").count()) await page.getByTestId("open-player-pro").click();
    await page.getByTestId("player-pro-tab-teamBuilder").click();
    const group = page.getByTestId("social-active-group");
    await expect(group).toBeVisible();
    await expect(group).toContainText(`${scenario.size} · net-match`);
    await group.evaluate((node) => {
      node.scrollIntoView({ block: "center" });
      const panel = node.closest('[data-testid="player-pro-panel"]');
      const header = panel?.querySelector("header");
      if (panel instanceof HTMLElement && header) panel.scrollTop += node.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 8;
    });
    expect(await group.evaluate((node) => {
      const header = node.closest('[data-testid="player-pro-panel"]')?.querySelector("header");
      return header ? node.getBoundingClientRect().top >= header.getBoundingClientRect().bottom : false;
    })).toBe(true);
    const activeGroup = JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}")).playerPro.social.teamBuilder.activeGroup;
    expect(activeGroup.golfers).toHaveLength(scenario.size);
    const expectedTeams = activeGroup.golfers.map((golfer: { id: string }) => ({ id: `individual:${golfer.id}`, playerIds: [golfer.id] }));
    expect(activeGroup.golfers.map((golfer: { id: string; teamId: string }) => golfer.teamId)).toEqual(expectedTeams.map((team: { id: string }) => team.id));
    expect(activeGroup.match.teams).toEqual(expectedTeams);
    expect(activeGroup.teamAuthority).toBeNull();
    expect(activeGroup.individualAuthority).toMatchObject({ format: "net-match" });
    expect(await page.getByTestId("player-pro-panel").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await capture(page, testInfo, `zk731-team-${scenario.size}-${scenario.width}`);
    await testInfo.attach(`zk731-team-card-${scenario.size}`, { body: await group.screenshot({ path: `artifacts/zk731-team-card-${scenario.size}-${scenario.width}.png` }), contentType: "image/png" });
  }
  expect(errors).toEqual([]);
});

test("ZK-731 structured escrow and custody follow the existing challenge commands", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await startSocialFixture(page);
  await page.getByTestId("player-pro-tab-challenges").click();
  const builder = page.getByTestId("challenge-contract-builder");
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
  const escrowed = JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}")).playerPro.social;
  expect(escrowed.escrow).toMatchObject({ reservedCash: 0, itemIds: ["player-ordinary-keepsake"] });
  expect(escrowed.inventory.escrowItemIds).toEqual(["player-ordinary-keepsake"]);
  await page.getByTestId("open-player-pro").click();
  await page.getByTestId("player-pro-tab-equipment").click();
  await expect(page.getByRole("button", { name: "Use default · Player High-Prestige Club", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Equip · Player Practice Bag", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close Player Pro" }).click();
  await page.getByTestId("commit-player-shot").click();
  await page.getByRole("button", { name: "Concede", exact: true }).click();
  if (!await page.getByTestId("player-pro-panel").count()) await page.getByTestId("open-player-pro").click();
  await page.getByTestId("player-pro-tab-custody").click();
  await expect(page.getByTestId("player-pro-custody")).toContainText("Player Ordinary Keepsake · held");
  const settled = JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? "{}")).playerPro.social;
  expect(settled.escrow).toBeNull();
  expect(settled.custody).toEqual([expect.objectContaining({ rivalName: "Rival One", itemName: "Player Ordinary Keepsake", status: "held", rematchChallengeId: expect.any(String) })]);
  await capture(page, testInfo, "zk731-rival-custody");
  expect(errors).toEqual([]);
});
