import { expect, test, type Page } from "@playwright/test";

async function skipTutorialIfOffered(page: Page): Promise<void> {
  const tutorialOffer = page.getByRole("dialog", { name: "First-launch tutorial" });
  const offered = await tutorialOffer.waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  if (offered) await tutorialOffer.getByRole("button", { name: "Skip tutorial" }).click();
}

test("ZK-685 profile policy, takeover, return, and graduation stay visible and atomic", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await skipTutorialIfOffered(page);
  await page.evaluate(() => window.__coursecraftTest!.setM39Fixture());

  const panel = page.getByTestId("seasons-legacy-panel");
  await panel.getByRole("button", { name: "Club identity", exact: true }).click();
  await expect(panel.getByTestId("system-control-summary")).toContainText("Relaxed · 13 automated · 0 direct");
  await panel.getByText("Manual system overrides", { exact: true }).click();
  await expect(panel.getByTestId("system-policy-maintenance")).toBeVisible();
  await expect(panel.getByTestId("system-policy-drainage")).toHaveCount(0);

  const cashBefore = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").economy.cash);
  const maintenance = panel.getByTestId("system-policy-maintenance");
  await maintenance.getByRole("button", { name: "Take control" }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return state.systemControl.systems.find((system: { id: string }) => system.id === "maintenance");
  })).toMatchObject({ mode: "manual", source: "save-override", override: true });
  await maintenance.getByRole("button", { name: "Return" }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return state.systemControl.systems.find((system: { id: string }) => system.id === "maintenance");
  })).toMatchObject({ mode: "automated", source: "profile-default", override: false });

  await panel.getByTestId("graduate-experience-profile").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl.profile)).toBe("classic");
  await expect(panel.getByTestId("system-policy-drainage")).toHaveCount(1);
  await panel.getByTestId("graduate-experience-profile").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl.profile)).toBe("simulation");
  await expect(panel.locator("[data-testid^=system-policy-]")).toHaveCount(13);
  await expect(panel.getByRole("button", { name: "Profile default" })).toHaveCount(13);
  await expect(panel.getByRole("button", { name: "Profile default" }).first()).toBeDisabled();
  await expect(panel.getByTestId("graduate-experience-profile")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").economy.cash)).toBe(cashBefore);
  expect(await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").systemControl.systems.every((system: { mode: string; source: string }) => system.mode === "manual" && system.source === "profile-default"))).toBe(true);

  await panel.getByTestId("system-policy-community").scrollIntoViewIfNeeded();
  const shot = await page.screenshot({ path: testInfo.outputPath("zk685-system-control.png"), fullPage: true });
  await testInfo.attach("zk685-system-control", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("ZK-685 manual pricing takes authority atomically and survives the next automation day", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await skipTutorialIfOffered(page);
  await page.evaluate(() => window.__coursecraftTest!.setM39Fixture());
  await page.getByTestId("seasons-legacy-panel").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Architect", exact: true }).click();
  await page.getByRole("button", { name: "Upgrades", exact: true }).click();
  const fee = page.locator('[data-tutorial-target="green-fee"] input[type="range"]');
  await fee.fill("123");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      fee: state.course.layouts.find((layout: { id: string }) => layout.id === state.course.activeCourseId)?.greenFee,
      policy: state.systemControl.systems.find((system: { id: string }) => system.id === "property"),
    };
  })).toMatchObject({ fee: 123, policy: { mode: "manual", source: "save-override" } });
  await expect(page.evaluate(() => window.__coursecraftTest!.advanceSystemControlDay()))
    .resolves.toEqual({ greenFee: 123, propertyMode: "manual", propertySource: "save-override" });
});

test("ZK-685 rejected HUD chunk stays local and reload recovers without a reset-save path", async ({ page }) => {
  await page.route("**/src/ui/HUD.tsx*", (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("button", { name: "Quick Start" }).click();
  await skipTutorialIfOffered(page);
  await expect(page.getByTestId("hud-load-error")).toBeVisible();
  await expect(page.getByText("Course controls are temporarily unavailable")).toBeVisible();
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: /Reset save/ })).toHaveCount(0);

  await page.unroute("**/src/ui/HUD.tsx*");
  await page.getByRole("button", { name: "Reload course controls" }).click();
  await page.getByRole("button", { name: "Quick Start" }).click();
  await expect(page.locator(".cc-hud")).toBeVisible();
  await expect(page.getByTestId("hud-load-error")).toHaveCount(0);
});
