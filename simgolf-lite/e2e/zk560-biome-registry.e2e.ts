import { expect, test } from "@playwright/test";
import { BIOME_KEYS, getBiomeDefinition } from "../src/game/models/biomes";

test("ZK-560 new-game cards create a rendered game for every registered biome", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400 && /atlases|assets/.test(response.url())) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const theme of BIOME_KEYS) {
    await page.goto("/");
    await page.getByRole("button", { name: /New Game/i }).click();
    await page.getByRole("button", { name: /Sandbox/i }).click();
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByText("Pick your land", { exact: true })).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(4);

    const biome = getBiomeDefinition(theme);
    await page.getByRole("button").filter({ hasText: biome.label }).first().click();
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByText(biome.label, { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "⛳ Start building" }).click();

    await expect.poll(() => page.evaluate(() => {
      const text = window.render_game_to_text?.();
      return text ? JSON.parse(text).course?.theme : null;
    })).toBe(theme);
    await expect(page.getByText(`Beginner-friendly ${biome.label}`, { exact: true })).toBeVisible();
    for (const other of BIOME_KEYS.filter((key) => key !== theme)) {
      await expect(page.getByText(`Beginner-friendly ${getBiomeDefinition(other).label}`, { exact: true }))
        .toHaveCount(0);
    }
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const shot = await page.screenshot({
      path: `artifacts/zk-560/new-game-${theme}.png`,
      fullPage: true,
    });
    await testInfo.attach(`new-game-${theme}`, { body: shot, contentType: "image/png" });
  }

  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});
