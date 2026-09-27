import { expect, test } from "@playwright/test";

test("ZK-677 keeps one connected green tiered across biomes, qualities, and rotations", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      tutorialOffered: true,
      tutorialCompleted: true,
      accessibility: { reducedMotion: true },
    }));
  });

  for (const theme of ["parkland", "links", "desert"] as const) {
    await page.goto(`/?zk677TieredGreenFixture=1&zk677Theme=${theme}`);
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
      timeout: 90_000,
    }).toBe("game");
    await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
    const initialHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);

    for (const quality of ["low", "medium", "high"] as const) {
      await page.evaluate((next) => {
        window.__coursecraftTest!.setGraphicsQualityFixture(next);
        window.__coursecraftPixiTest!.focusTileForTest(12, 6, 2);
      }, quality);
      await expect.poll(() => page.evaluate(() => (
        window.__coursecraftPixiTest!.rendererAtlasState().rendered.quality
      )), { timeout: 30_000 }).toBe(quality);
      for (let resetTurn = 0; resetTurn < 4; resetTurn++) {
        const rotation = await page.evaluate(() => (
          window.__coursecraftPixiTest!.rendererAtlasState().pathMaterialCrossSection.camera.rotation
        ));
        if (rotation === 0) break;
        await page.keyboard.press("e");
      }
      await expect.poll(() => page.evaluate(() => (
        window.__coursecraftPixiTest!.rendererAtlasState().pathMaterialCrossSection.camera.rotation
      ))).toBe(0);

      for (let turn = 0; turn < 4; turn++) {
        if (turn > 0) await page.keyboard.press("e");
        await expect.poll(() => page.evaluate(() => (
          window.__coursecraftPixiTest!.rendererAtlasState().pathMaterialCrossSection.camera.rotation
        ))).toBe(turn * 90);
        const heights = await page.evaluate(() => [10.5, 12.5, 14.5].map((x) => (
          window.__coursecraftPixiTest!.surfaceHeightAt(x, 6.5)
        )));
        expect(heights[1]).toBeGreaterThan(heights[0] + 0.4);
        expect(heights[2]).toBeGreaterThan(heights[1] + 1.2);
      }
    }

    expect(await page.locator(".cc-pixi-stage canvas").screenshot()).not.toHaveLength(0);
    expect(await page.evaluate(() => window.__coursecraftTest!.state().courseHash)).toBe(initialHash);
  }
  expect(errors).toEqual([]);
});
