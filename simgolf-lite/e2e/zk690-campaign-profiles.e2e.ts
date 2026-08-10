import { expect, test, type Page } from "@playwright/test";

async function enterGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
}

async function chooseCurrentCampaignScene(page: Page) {
  const scene = page.getByTestId("campaign-scene");
  await expect(scene).toBeVisible();
  const pendingId = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign?.pendingSceneId);
  await scene.getByRole("button").first().click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign?.pendingSceneId)).not.toBe(pendingId);
}

async function saveAndReload(page: Page, name: string) {
  await page.keyboard.press("Escape");
  const pause = page.getByTestId("pause-overlay");
  await expect(pause).toBeVisible();
  await pause.getByRole("button", { name: /save game/i }).click();
  await page.getByPlaceholder("New save name…").fill(name);
  await page.getByRole("button", { name: "Save to new slot" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
}

test("ZK-690 chapter cards expose the exact six axes and start with localized active responsibility", async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_career_v1", JSON.stringify({
      version: 2,
      scenarios: {
        "back-nine": { completed: true, attempts: 2, bestWeek: 8, bestCash: 50_000, bestMedal: "gold" },
        "muni-rescue": { completed: true, attempts: 1, bestWeek: 14, bestCash: 20_000, bestMedal: "silver" },
      },
      unlocks: [],
      campaignChoices: [],
    }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("button", { name: "Career" }).click();
  await page.getByRole("button", { name: "Next →" }).click();

  const rows = [
    ["back-nine", "RELAXED · FRIENDLY"],
    ["muni-rescue", "RELAXED · FRIENDLY"],
    ["swamp-deal", "CLASSIC · BALANCED"],
    ["links-by-the-sea", "CLASSIC · BALANCED"],
    ["members-club", "CLASSIC · BALANCED"],
    ["championship-dream", "SIMULATION · BALANCED"],
  ] as const;
  for (const [id, axes] of rows) {
    const preview = page.getByTestId(`campaign-card-responsibility-${id}`);
    await expect(preview).toBeAttached();
    await expect(preview.locator("xpath=..")).toContainText(axes);
    await expect(preview).toContainText("Responsibility preview");
  }

  const backNine = page.getByTestId("campaign-card-back-nine");
  await expect(backNine).toHaveAccessibleName(/1\. The Back Nine/i);
  await expect(backNine).toHaveAccessibleName(/Completed.*Gold.*best: week 8.*\$50,000.*replayable/i);
  await expect(backNine).toHaveAccessibleDescription(/Responsibility preview/i);
  const locked = page.getByTestId("campaign-card-links-by-the-sea");
  await expect(locked).toBeDisabled();
  await expect(locked).toHaveAccessibleName(/4\. Links by the Sea.*Complete the previous scenario to unlock/i);
  await expect(locked).toHaveAccessibleDescription(/Responsibility preview/i);
  await backNine.focus();
  await page.keyboard.press("Enter");
  const scene = page.getByTestId("campaign-scene");
  await expect(scene).toContainText("Active setup: Relaxed · Friendly");
  const shot = await page.screenshot({ path: testInfo.outputPath("zk690-back-nine-active-axes.png"), fullPage: true });
  await testInfo.attach("back-nine-active-axes", { body: shot, contentType: "image/png" });
  await scene.getByRole("button").first().click();
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) await tutorial.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-campaign").click();
  const panel = page.getByTestId("campaign-panel");
  await expect(panel.getByTestId("campaign-active-axes")).toContainText("Relaxed · Friendly");
  await expect(panel.getByTestId("campaign-participation")).toContainText("Direct authored choice recorded");
  expect(errors).toEqual([]);
});

test("ZK-690 a representative Classic chapter starts with its authored Balanced responsibility", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_career_v1", JSON.stringify({
      version: 2,
      scenarios: {
        "back-nine": { completed: true, attempts: 1, bestMedal: "bronze" },
        "muni-rescue": { completed: true, attempts: 1, bestMedal: "bronze" },
      },
      unlocks: [],
      campaignChoices: [],
    }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("button", { name: "Career" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  const swamp = page.getByTestId("campaign-card-swamp-deal");
  await expect(swamp).toBeEnabled();
  await swamp.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("campaign-scene-axes")).toContainText("Classic · Balanced");
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return [state.campaign.chapterId, state.experience.profile, state.experience.economicPressure];
  })).toEqual(["swamp-deal", "classic", "balanced"]);
});

test("ZK-690 Championship curriculum is cumulative, keeps all 13 systems manual, and navigates without committing", async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await enterGame(page);

  for (const [phaseIndex, expectedCount] of [[0, 5], [1, 10], [2, 13]] as const) {
    await page.evaluate(([chapter, phase]) => window.__coursecraftTest!.setZk690CampaignFixture(chapter, phase), ["championship-dream", phaseIndex] as const);
    const scene = page.getByTestId("campaign-scene");
    await expect(scene.getByTestId("campaign-scene-axes")).toContainText("Simulation · Balanced");
    await expect(scene.getByTestId("campaign-scene-curriculum")).toBeVisible();
    await chooseCurrentCampaignScene(page);
    const panel = page.getByTestId("campaign-panel");
    await expect(panel.getByTestId("campaign-curriculum").locator("[data-campaign-system]"), `phase ${phaseIndex + 1}`).toHaveCount(expectedCount);
    await expect(panel.getByTestId("campaign-curriculum")).toContainText("never hide, unlock, automate, or commit");
  }

  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      profile: state.systemControl.profile,
      pressure: state.experience.economicPressure,
      systems: state.systemControl.systems.length,
      manual: state.systemControl.systems.filter((system: { mode: string; visibility: string }) => system.mode === "manual" && system.visibility === "full").length,
      curriculum: state.campaign.curriculumSystems,
    };
  })).toMatchObject({ profile: "simulation", pressure: "balanced", systems: 13, manual: 13, curriculum: expect.arrayContaining(["financing", "resort", "community"]) });

  let panel = page.getByTestId("campaign-panel");
  const beforeNavigation = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return { cash: state.economy.cash, receipts: state.campaign.participation.receipts.length };
  });
  await panel.locator('[data-campaign-system="financing"]').click();
  await expect(page.getByTestId("management-financing-target")).toBeFocused();
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return { cash: state.economy.cash, receipts: state.campaign.participation.receipts.length };
  })).toEqual(beforeNavigation);

  await page.evaluate(() => window.__coursecraftTest!.setZk690CampaignFixture("championship-dream", 0));
  await chooseCurrentCampaignScene(page);
  panel = page.getByTestId("campaign-panel");
  await panel.locator('[data-campaign-system="localized-turf"]').focus();
  await page.keyboard.press("Enter");
  const seasons = page.getByTestId("seasons-legacy-panel");
  await expect(seasons).toBeVisible({ timeout: 30_000 });
  await expect(seasons.locator('[data-operation-system="localized-turf"]')).toBeFocused({ timeout: 10_000 });

  await page.evaluate(() => window.__coursecraftTest!.setZk690CampaignFixture("championship-dream", 1));
  await chooseCurrentCampaignScene(page);
  panel = page.getByTestId("campaign-panel");
  await panel.locator('[data-campaign-system="mobility"]').click();
  const live = page.getByTestId("live-overview");
  await expect(live.getByRole("tab", { name: "Mobility" })).toHaveAttribute("aria-selected", "true");

  await page.evaluate(() => window.__coursecraftTest!.setZk690CampaignFixture("championship-dream", 2));
  await chooseCurrentCampaignScene(page);
  panel = page.getByTestId("campaign-panel");
  const shot = await page.screenshot({ path: testInfo.outputPath("zk690-championship-curriculum.png"), fullPage: true });
  await testInfo.attach("championship-curriculum", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("ZK-690 post-choice automation cannot advance; a real Player Pro round supplies exact-once mastery and survives reload", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterGame(page);
  await page.evaluate(() => window.__coursecraftTest!.setZk690CampaignFixture("back-nine", 0));
  await chooseCurrentCampaignScene(page);
  await page.evaluate(() => {
    window.__coursecraftTest!.setCampaignObjectiveWonFixture();
    window.__coursecraftTest!.advanceCampaignFixture();
  });
  expect(await page.evaluate(() => {
    const campaign = JSON.parse(window.render_game_to_text?.() ?? "{}").campaign;
    return { phase: campaign.phaseIndex, receipts: campaign.participation.receipts.length };
  })).toEqual({ phase: 0, receipts: 1 });
  await expect(page.getByTestId("campaign-direct-evidence")).toContainText("still required");

  await page.getByTestId("campaign-panel").getByRole("button", { name: /close campaign/i }).click();
  await page.evaluate(() => window.__coursecraftTest!.setPlayerProFixture());
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  const pro = page.getByTestId("player-pro-panel");
  await pro.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByTestId("start-player-round").click();
  await page.getByTestId("player-shot-hud").getByRole("button", { name: "Auto-finish" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign.phaseIndex), { timeout: 20_000 }).toBe(1);
  const completion = page.getByTestId("campaign-scene");
  await expect(completion).toContainText("Phase 1 of 3");
  await expect(completion.getByTestId("campaign-scene-curriculum")).toHaveCount(0);
  await chooseCurrentCampaignScene(page);
  await expect(page.getByTestId("campaign-scene")).toContainText("Phase 2 of 3");
  await chooseCurrentCampaignScene(page);
  await page.getByTestId("return-to-design").click();

  const beforeReload = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign);
  expect(beforeReload.phaseIndex).toBe(1);
  expect(beforeReload.participation.receipts.filter((receipt: { id: string }) =>
    receipt.id === "phase-scene:back-nine:back-nine-discover:back-nine-discover-intro")).toHaveLength(1);
  expect(Object.values(beforeReload.relationships).some((value) => Number(value) !== 0)).toBe(true);

  await saveAndReload(page, "ZK-690 participation");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign?.phaseIndex)).toBe(1);
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      chapter: state.campaign.chapterId,
      phase: state.campaign.phaseIndex,
      axes: [state.experience.profile, state.experience.economicPressure],
      receipts: state.campaign.participation.receipts,
    };
  })).toMatchObject({ chapter: "back-nine", phase: 1, axes: ["relaxed", "friendly"], receipts: expect.arrayContaining([expect.objectContaining({ source: "player-choice" })]) });
  await expect(page.getByText("Loading course controls…")).toHaveCount(0);
  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-campaign").click();
  await expect(page.getByTestId("campaign-panel")).toContainText("Phase 2 of 3");
  const shot = await page.screenshot({ path: testInfo.outputPath("zk690-participation-reload.png"), fullPage: true });
  await testInfo.attach("participation-reload", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("ZK-690 legacy recovery crosses the owning phase, and a reloaded exact finale reaches epilogue and Sandbox", async ({ page }, testInfo) => {
  page.setDefaultTimeout(25_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await enterGame(page);
  await page.evaluate(() => window.__coursecraftTest!.setZk690LegacyRecoveryFixture());
  const recovery = page.getByTestId("campaign-legacy-recovery");
  const recoveryAction = recovery.getByRole("button");
  await recoveryAction.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign.participation.receipts)).toEqual([
    expect.objectContaining({ source: "legacy-recovery" }),
  ]);
  await page.evaluate(() => window.__coursecraftTest!.advanceCampaignFixture());
  const completion = page.getByTestId("campaign-scene");
  await expect(completion).toContainText("Phase 1 of 3");
  await expect(completion.getByTestId("campaign-scene-curriculum")).toHaveCount(0);
  await chooseCurrentCampaignScene(page);
  await expect(page.getByTestId("campaign-scene")).toContainText("Phase 2 of 3");
  await expect(page.getByTestId("campaign-scene-curriculum").locator("text=Maintenance")).toBeVisible();
  await chooseCurrentCampaignScene(page);

  await page.evaluate(() => window.__coursecraftTest!.setZk690LegacyFinaleFixture());
  await saveAndReload(page, "ZK-690 legacy finale");
  expect(await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign.matches)).toEqual([
    expect.objectContaining({ definitionId: "back-nine-opening-match", status: "complete" }),
  ]);
  await page.evaluate(() => window.__coursecraftTest!.advanceCampaignFixture());
  await expect(page.getByTestId("campaign-scene")).toContainText("Phase 3 of 3");
  await chooseCurrentCampaignScene(page);
  await page.getByRole("button", { name: "Keep playing" }).click();
  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-campaign").click();
  const epilogue = page.getByTestId("campaign-epilogue");
  await expect(epilogue).toContainText("Bronze");
  await epilogue.scrollIntoViewIfNeeded();
  const shot = await page.screenshot({ path: testInfo.outputPath("zk690-legacy-epilogue.png"), fullPage: true });
  await testInfo.attach("legacy-epilogue", { body: shot, contentType: "image/png" });
  await epilogue.getByRole("button", { name: "Continue this property in Sandbox" }).click();
  expect(await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return { mode: state.mode, continued: state.campaign.continuedInSandbox };
  })).toEqual({ mode: "sandbox", continued: true });
  expect(errors).toEqual([]);
});
