import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PNG } from "pngjs";
import { M53_SEASONAL_TERRAIN_FIXTURES } from "../src/game/testing/m53SeasonalTerrainFixtures";

const PRIMARY_BIOMES = ["parkland", "links", "desert"] as const;
const QUALITY_REVERSAL = ["medium", "low", "high"] as const;
const ZOOM_THRESHOLDS = [0.33, 0.35, 0.71, 0.73] as const;

function flatBlockRatio(body: Buffer): number {
  const png = PNG.sync.read(body);
  const blockWidth = 12;
  const blockHeight = 6;
  let flat = 0;
  let sampled = 0;
  for (let y = Math.floor(png.height * 0.08); y + blockHeight < png.height * 0.92; y += blockHeight) {
    for (let x = Math.floor(png.width * 0.08); x + blockWidth < png.width * 0.92; x += blockWidth) {
      let minimum = 255;
      let maximum = 0;
      let opaque = true;
      for (let dy = 0; dy < blockHeight; dy++) for (let dx = 0; dx < blockWidth; dx++) {
        const offset = ((y + dy) * png.width + x + dx) * 4;
        opaque &&= png.data[offset + 3] > 250;
        for (let channel = 0; channel < 3; channel++) {
          minimum = Math.min(minimum, png.data[offset + channel]);
          maximum = Math.max(maximum, png.data[offset + channel]);
        }
      }
      if (!opaque) continue;
      sampled++;
      if (maximum - minimum <= 3) flat++;
    }
  }
  return flat / Math.max(1, sampled);
}

async function rendererState(page: Page) {
  return page.evaluate(() => window.__coursecraftPixiTest?.rendererAtlasState() ?? null);
}

async function expectAtomicGeneration(page: Page, quality: "high" | "medium" | "low") {
  await expect.poll(async () => {
    const state = await rendererState(page);
    if (!state?.layers) return null;
    return {
      requested: state.requested.quality,
      rendered: state.rendered.quality,
      active: state.activation.bundleKey,
      generations: [...new Set(Object.values(state.layers))],
      terrainChunks: state.counts?.terrainChunks ?? 0,
      connectedSurfaces: state.counts?.connectedSurfaces ?? -1,
    };
  }, { timeout: 120_000 }).toMatchObject({
    requested: quality,
    rendered: quality,
    active: expect.stringMatching(new RegExp(`:${quality}$`)),
    generations: [expect.any(Number)],
    terrainChunks: expect.any(Number),
    connectedSurfaces: quality === "low" ? 0 : expect.any(Number),
  });
  const state = await rendererState(page);
  expect(state?.counts?.terrainChunks).toBeGreaterThan(0);
  if (quality !== "low") expect(state?.counts?.connectedSurfaces).toBeGreaterThan(0);
  expect(state?.fallbacks).toEqual([]);
}

async function captureMaterialEvidence(
  page: Page,
  testInfo: TestInfo,
  theme: typeof PRIMARY_BIOMES[number],
  quality: typeof QUALITY_REVERSAL[number],
) {
  const body = await page.locator(".cc-pixi-stage canvas").screenshot({
    path: testInfo.outputPath(`${theme}-${quality}-zoom-generation.png`),
  });
  const ratio = flatBlockRatio(body);
  await testInfo.attach(`${theme}-${quality}-zoom-generation`, { body, contentType: "image/png" });
  // The reported corruption replaces authored connected surfaces with broad,
  // single-color diamonds. Healthy reference frames keep large flat 12x6
  // blocks below 4%; the prior Desert evidence measured 1.5%.
  expect(ratio, `${theme}/${quality} flat-block ratio`).toBeLessThan(0.04);
}

for (const theme of PRIMARY_BIOMES) {
  test(`ZK-674 keeps ${theme} atlas generations atomic through tier and zoom reversals`, async ({ page }, testInfo) => {
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

    // Make the previously unsafe partial-generation window deterministic.
    // The live scene must retain the complete prior generation while the new
    // tier's independently requested sheets and fields are still in flight.
    await page.route(/atlases\/biomes\/.*-(?:medium|low)\./, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 280));
      await route.continue();
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
      graphics: { quality: "high" },
    });
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    await expectAtomicGeneration(page, "high");

    // While Medium is deliberately delayed, requested and rendered tiers may
    // differ, but every visible layer must remain on the rendered generation.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("medium"));
    await expect.poll(async () => (await rendererState(page))?.requested.quality).toBe("medium");
    const pending = await rendererState(page);
    expect(pending?.rendered.quality).toBe("high");
    expect(new Set(Object.values(pending?.layers ?? {}))).toEqual(new Set([pending?.rendered.generation]));
    await expectAtomicGeneration(page, "medium");

    // Supersede two in-flight requests and finish on Low. An older completion
    // may become resident, but it must never become the active render context.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("low"));
    await page.waitForTimeout(35);
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("high"));
    await page.waitForTimeout(20);
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("low"));
    await expectAtomicGeneration(page, "low");

    await canvas.hover();
    for (const zoom of ZOOM_THRESHOLDS) {
      await page.evaluate((value) => window.__coursecraftPixiTest!.setZoomForTest(value), zoom);
      await page.mouse.wheel(0, -360);
      await page.mouse.wheel(0, 360);
      await page.mouse.wheel(0, 520);
      await page.mouse.wheel(0, -520);
      await page.waitForTimeout(45);
      const state = await rendererState(page);
      expect(new Set(Object.values(state?.layers ?? {}))).toEqual(new Set([state?.rendered.generation]));
      expect(state?.counts?.terrainChunks).toBeGreaterThan(0);
    }

    for (const quality of QUALITY_REVERSAL) {
      await page.evaluate((value) => window.__coursecraftTest!.setGraphicsQualityFixture(value), quality);
      await expectAtomicGeneration(page, quality);
      await captureMaterialEvidence(page, testInfo, theme, quality);
    }

    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
  });
}
