import { expect, test } from "@playwright/test";
import { M53_SEASONAL_TERRAIN_FIXTURES } from "../src/game/testing/m53SeasonalTerrainFixtures";

// M21 already carries the all-biome visual matrix. This regression isolates
// the reported Desert path; the unit cache matrix proves Parkland/Links stay
// independently resident after a biome transition.
const PRIMARY_BIOMES = ["desert"] as const;

for (const theme of PRIMARY_BIOMES) {
  test(`ZK-674 preserves ${theme} material identity through slow and rapid zoom`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    const failedAssets: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && /atlases\/biomes/.test(response.url())) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });

    const fixture = M53_SEASONAL_TERRAIN_FIXTURES.find((candidate) => (
      candidate.biome === theme
      && candidate.season === "summer"
      && candidate.quality === "high"
      && candidate.rotation === 0
    ));
    expect(fixture).toBeDefined();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(fixture!.query);
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}")), {
      timeout: 120_000,
    }).toMatchObject({
      screen: "game",
      course: { theme },
      graphics: { resolvedQuality: "high" },
    });

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    await canvas.hover();
    for (let step = 0; step < 4; step++) {
      await page.mouse.wheel(0, -420);
      await page.waitForTimeout(55);
    }
    for (let step = 0; step < 4; step++) {
      await page.mouse.wheel(0, 420);
      await page.waitForTimeout(55);
    }
    await page.mouse.wheel(0, -2400);
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(180);

    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"))).toMatchObject({
      course: { theme },
    });

    if (theme === "desert") {
      const screenshot = await page.screenshot({
        path: "artifacts/zk674-desert-zoom-cache.png",
        fullPage: true,
      });
      await testInfo.attach("desert-zoom-cache", { body: screenshot, contentType: "image/png" });
    }
    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
  });
}
