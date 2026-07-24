import { expect, test } from "@playwright/test";

test("M40 starts an authored chapter and records its opening choice", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "New Game" }).click();
  await page.getByRole("button", { name: "Career" }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await page.getByRole("button", { name: /The Back Nine/ }).click();

  const scene = page.getByTestId("campaign-scene");
  await expect(scene).toBeVisible();
  await expect(scene).toContainText("Rowan Vale");
  await expect(scene).toContainText("Phase 1 of 3");
  await expect(page.getByTestId("campaign-scene-facts")).toContainText("Cash");
  await expect(page.getByTestId("campaign-scene-facts")).toContainText("Condition");
  const shot = await page.screenshot({ path: "artifacts/m40-campaign-opening.png", fullPage: true });
  await testInfo.attach("campaign-opening", { body: shot, contentType: "image/png" });
  await scene.getByRole("button").first().click();
  await expect(scene).toBeHidden();
  const skipTutorial = page.getByRole("button", { name: "Skip tutorial" });
  if (await skipTutorial.isVisible()) await skipTutorial.click();
  await page.getByTestId("workspace-legacy").click();
  await page.getByTestId("open-campaign").click();
  const panel = page.getByTestId("campaign-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Visible mastery criteria");
  await expect(panel).toContainText("Recovery guidance");
  const panelShot = await page.screenshot({ path: "artifacts/m40-campaign-dashboard.png", fullPage: true });
  await testInfo.attach("campaign-dashboard", { body: panelShot, contentType: "image/png" });

  const campaign = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").campaign);
  expect(campaign).toMatchObject({
    chapterId: "back-nine",
    phaseIndex: 0,
    pendingSceneId: null,
    panelOpen: true,
    choices: [expect.objectContaining({ sceneId: expect.any(String), choiceId: expect.any(String) })],
  });
  expect(errors).toEqual([]);
});
