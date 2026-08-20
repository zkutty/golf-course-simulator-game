import { expect, test } from "@playwright/test";
import { BIOME_KEYS, getBiomeDefinition } from "../src/game/models/biomes";
import { waitForLegacyBiomeFixture } from "./legacy-biome-fixture";

test("ZK-623 keeps one CourseCraft shell while biome context follows selection", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({ version: 5, tutorialOffered: true }));
  });

  for (const theme of BIOME_KEYS) {
    await page.goto("/");
    await page.getByRole("button", { name: /New Game/i }).click();
    await page.getByRole("button", { name: /Sandbox/i }).click();
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByRole("button").filter({ hasText: getBiomeDefinition(theme).label }).first().click();

    const wizard = page.locator(".cc-biome-wizard");
    await expect(wizard).toHaveAttribute("data-biome", theme);
    await expect(wizard).toHaveAttribute("data-biome-motif", theme === "links" ? "wind" : theme === "desert" ? "sun" : "leaf");
    const wizardShot = await page.screenshot({ path: `artifacts/zk-623/wizard-${theme}.png`, fullPage: true });
    await testInfo.attach(`wizard-${theme}`, { body: wizardShot, contentType: "image/png" });

    // A deterministic, populated fixture makes the UI reference meaningful:
    // do not accept a merely-visible Pixi canvas before its terrain has drawn.
    await page.goto(`/?m21Fixture=1&m21Theme=${theme}`);
    await waitForLegacyBiomeFixture(page, {
      theme,
      courseName: `M21 ${theme} Biome Preserve`,
      minimumObstacleCount: 21,
    });
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.theme)).toBe(theme);
    await expect.poll(() => page.evaluate(() => {
      const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
      return Object.values(state.course?.obstacleCounts ?? {}).reduce((sum: number, value) => sum + Number(value), 0);
    })).toBeGreaterThan(20);

    const shell = page.locator(".cc-app");
    await expect(shell).toHaveAttribute("data-biome", theme);
    await expect(shell).toHaveCSS("--ui-focus", "#0b67a3");
    await expect(shell).toHaveCSS("--biome-motion-duration", "180ms");
    const terrain = page.locator(".cc-pixi-stage canvas");
    await expect(terrain).toBeVisible();
    const terrainShot = await terrain.screenshot({ path: `artifacts/zk-623/terrain-${theme}.png` });
    await testInfo.attach(`terrain-${theme}`, { body: terrainShot, contentType: "image/png" });
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus-visible")).toHaveCount(1);
    const shellShot = await page.screenshot({ path: `artifacts/zk-623/shell-${theme}.png`, fullPage: true });
    await testInfo.attach(`shell-${theme}`, { body: shellShot, contentType: "image/png" });
  }

  expect(errors).toEqual([]);
});

test("ZK-623 removes contextual transitions for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /New Game/i }).click();
  await expect(page.locator(".cc-biome-wizard")).toBeVisible();
  await expect.poll(() => page.locator(".cc-biome-wizard").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element, "::after").transitionDuration),
  )).toBeLessThanOrEqual(0.001);
});
