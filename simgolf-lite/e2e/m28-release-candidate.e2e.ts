import { expect, test } from "@playwright/test";

test("M28 clean-profile golden path survives save, reload, input, resize, and accessible settings", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto("/");
  await expect(page.getByText("v1.0.0-rc.2")).toBeVisible();
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Audio" }).click();
  await page.getByLabel("Master volume").fill("0");
  await page.getByRole("tab", { name: "Accessibility" }).click();
  await page.getByLabel("Reduced motion").check();
  await page.getByLabel("Terrain patterns").check();
  await page.getByLabel("Text scale").selectOption("130");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Quick Start" }).focus();
  await page.keyboard.press("Enter");
  const tutorial = page.getByRole("dialog", { name: "First-launch tutorial" });
  if (await tutorial.count()) {
    page.once("dialog", (dialog) => dialog.accept());
    await tutorial.getByRole("button", { name: "Skip tutorial" }).focus();
    await page.keyboard.press("Enter");
  }
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase), { timeout: 30_000 }).toBe("in-game");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tutorialStep ?? null), { timeout: 30_000 }).toBeNull();
  const result = await page.evaluate(() => window.__coursecraftTest!.runGoldenWeek());
  expect(result).toMatchObject({ week: 2 });
  expect(result.rounds).toBeGreaterThan(0);

  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase), { timeout: 30_000 }).toBe("in-game");
  await page.getByRole("button", { name: /open pause menu/i }).click();
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  await page.getByTestId("pause-overlay").getByRole("button", { name: "Resume" }).click();
  await page.mouse.wheel(0, -400);
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().week), { timeout: 30_000 }).toBe(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize), { timeout: 30_000 }).toBe("130%");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion), { timeout: 30_000 }).toBe("true");

  await testInfo.attach("environment", {
    body: JSON.stringify(await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform, viewport: { width: innerWidth, height: innerHeight } })), null, 2),
    contentType: "application/json"
  });
  await testInfo.attach("final", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(errors).toEqual([]);
});
