import { expect, test } from "@playwright/test";

test("M36-M37 Player Pro aims, resolves, progresses, and returns to design", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorialOffer.count()) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
  await page.evaluate(() => window.__coursecraftTest!.setPlayerProFixture());

  await page.getByTestId("open-player-pro").click();
  const panel = page.getByTestId("player-pro-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Casey Fairway");
  await expect(panel).toContainText("Six-skill profile");
  await panel.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("player-pro-route")).toHaveValue("player-pro-slice");
  await page.getByTestId("start-player-round").click();

  const hud = page.getByTestId("player-shot-hud");
  await expect(hud).toBeVisible();
  await expect(hud).toContainText("Hole 1 of 3");
  await expect(page.getByTestId("open-course-manager")).toBeDisabled();

  const stage = page.locator(".cc-pixi-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Course stage is not measurable");
  await stage.click({ position: { x: Math.round(box.width * 0.57), y: Math.round(box.height * 0.48) } });
  const picked = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.aim);
  expect(picked).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  await hud.getByRole("button", { name: "Use caddie line" }).click();
  await page.getByTestId("commit-player-shot").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound.phase), { timeout: 10_000 }).not.toBe("flight");

  const afterShot = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound);
  expect(afterShot.strokes).toBe(1);
  expect(afterShot.recentTrace).toMatchObject({
    club: expect.any(String),
    aim: expect.any(Object),
    rest: expect.any(Object),
    evidence: expect.any(Array),
  });
  const decisionShot = await page.screenshot({ path: "artifacts/m36-player-pro-shot.png", fullPage: true });
  await testInfo.attach("player-pro-shot", { body: decisionShot, contentType: "image/png" });

  await hud.getByRole("button", { name: "Auto-finish" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound?.phase), { timeout: 15_000 }).toBe("round_complete");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.rounds)).toBe(1);
  await expect(hud).toContainText("Career gains, records, and competition rewards were settled once.");
  const completeShot = await page.screenshot({ path: "artifacts/m36-player-pro-complete.png", fullPage: true });
  await testInfo.attach("player-pro-complete", { body: completeShot, contentType: "image/png" });

  await page.getByTestId("return-to-design").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").playerPro.activeRound)).toBeNull();
  await expect(page.getByTestId("open-course-manager")).toBeEnabled();
  expect(errors).toEqual([]);
});
