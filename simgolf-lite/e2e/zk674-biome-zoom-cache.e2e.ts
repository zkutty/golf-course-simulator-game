import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PNG } from "pngjs";
import { M53_SEASONAL_TERRAIN_FIXTURES } from "../src/game/testing/m53SeasonalTerrainFixtures";

const PRIMARY_BIOMES = ["parkland", "links", "desert"] as const;
const QUALITY_REVERSAL = ["medium", "low", "high"] as const;
const ZOOM_THRESHOLDS = [0.33, 0.35, 0.71, 0.73] as const;

interface BrowserAtlasFile {
  readonly json: string;
  readonly image: string;
}

interface BrowserAtlasTier {
  readonly base: {
    readonly buildings: BrowserAtlasFile;
    readonly terrain: BrowserAtlasFile;
    readonly details: BrowserAtlasFile;
    readonly props: BrowserAtlasFile;
    readonly fields: Record<string, { readonly image: string }>;
  };
  seasonal: Record<string, unknown>;
}

interface BrowserAtlasManifest {
  readonly biomes: Record<string, Record<string, BrowserAtlasTier>>;
}

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
      stampsMatch: Object.values(state.layers).every((generation) => generation === state.rendered.generation),
      terrainChunks: state.counts?.terrainChunks ?? 0,
      connectedSurfaces: state.counts?.connectedSurfaces ?? -1,
      structuresAndProps: state.counts?.structuresAndProps ?? 0,
      dressing: state.counts?.dressing ?? 0,
    };
  }, { timeout: 120_000 }).toMatchObject({
    requested: quality,
    rendered: quality,
    active: expect.stringMatching(new RegExp(`:${quality}$`)),
    generations: [expect.any(Number)],
    stampsMatch: true,
    terrainChunks: expect.any(Number),
    connectedSurfaces: quality === "low" ? 0 : expect.any(Number),
    structuresAndProps: expect.any(Number),
    dressing: quality === "low" ? 0 : expect.any(Number),
  });
  const state = await rendererState(page);
  expect(state?.counts?.terrainChunks).toBeGreaterThan(0);
  if (quality !== "low") expect(state?.counts?.connectedSurfaces).toBeGreaterThan(0);
  expect(state?.counts?.structuresAndProps).toBeGreaterThan(0);
  if (quality !== "low") expect(state?.counts?.dressing).toBeGreaterThan(0);
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
    let releaseAutumnOverlay = () => {};
    const autumnOverlayGate = new Promise<void>((resolve) => {
      releaseAutumnOverlay = resolve;
    });
    let markAutumnOverlayRequested = () => {};
    const autumnOverlayRequested = new Promise<void>((resolve) => {
      markAutumnOverlayRequested = resolve;
    });
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
    await page.route(/atlases\/biomes\/manifest\.json/, async (route) => {
      const response = await route.fetch();
      const manifest = await response.json() as BrowserAtlasManifest;
      const tier = manifest.biomes.parkland.high;
      const uniqueFrame = (file: BrowserAtlasFile, family: string): BrowserAtlasFile => ({
        ...file,
        json: `${file.json}?zk674-autumn-overlay=${family}`,
        image: `${file.image}?zk674-autumn-overlay=${family}`,
      });
      tier.seasonal.autumn = {
        owner: "parkland",
        season: "autumn",
        materials: {
          fairway: {
            image: `${tier.base.fields.fairway.image}?zk674-autumn-overlay=fairway`,
          },
        },
        frames: {
          buildings: uniqueFrame(tier.base.buildings, "buildings"),
          "natural-props": uniqueFrame(tier.base.props, "natural-props"),
          "terrain-details": uniqueFrame(tier.base.details, "terrain-details"),
        },
      };
      await route.fulfill({ response, json: manifest });
    });
    await page.route(/atlases\/biomes\/.*-(?:(?:medium|low)|links-high)\./, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.route(/zk674-autumn-overlay=/, async (route) => {
      markAutumnOverlayRequested();
      await autumnOverlayGate;
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
    const unrelatedObjectProbe = await page.evaluate(() => (
      window.__coursecraftPixiTest!.unrelatedObjectCountProbe()
    ));
    expect(unrelatedObjectProbe.before).toBeGreaterThan(0);
    expect(unrelatedObjectProbe.after).toBe(unrelatedObjectProbe.before);

    // A→B→A must invalidate B even if its assets finish well after the view
    // has returned to A. The active global atlas may not drift behind React.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("medium"));
    await expect.poll(async () => (await rendererState(page))?.requested.quality, { timeout: 120_000 }).toBe("medium");
    const pending = await rendererState(page);
    expect(pending?.rendered.quality).toBe("high");
    expect(new Set(Object.values(pending?.layers ?? {}))).toEqual(new Set([pending?.rendered.generation]));
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("high"));
    await expect.poll(async () => (await rendererState(page))?.activation.pending, { timeout: 120_000 }).toBeNull();
    await page.waitForTimeout(1_800);
    await expectAtomicGeneration(page, "high");

    // The same now-resident B tier can activate as one complete generation.
    await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("medium"));
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

    if (theme === "parkland") {
      // Theme requests are held exactly like tiers. First prove a canceled
      // Parkland→Links→Parkland request cannot activate late, then allow the
      // same resident Links bundle to commit in place and return.
      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("links"));
      await expect.poll(async () => (await rendererState(page))?.requested.biome, { timeout: 120_000 }).toBe("links");
      expect((await rendererState(page))?.rendered.biome).toBe("parkland");
      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("parkland"));
      await page.waitForTimeout(1_800);
      await expect.poll(async () => {
        const state = await rendererState(page);
        return {
          requested: state?.requested.biome,
          rendered: state?.rendered.biome,
          active: state?.activation.bundleKey,
          pending: state?.activation.pending,
          stampsMatch: state?.layers
            ? Object.values(state.layers).every((generation) => generation === state.rendered.generation)
            : false,
        };
      }, { timeout: 120_000 }).toEqual({ requested: "parkland", rendered: "parkland", active: "parkland:high", pending: null, stampsMatch: true });

      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("links"));
      await expect.poll(async () => (await rendererState(page))?.rendered.biome, { timeout: 120_000 }).toBe("links");
      await page.evaluate(() => window.__coursecraftTest!.setRendererThemeFixture("parkland"));
      await expect.poll(async () => (await rendererState(page))?.rendered.biome, { timeout: 120_000 }).toBe("parkland");

      // The browser manifest injects an actual authored autumn overlay route
      // with unique gated URLs, proving the presentation remains held until
      // every overlay asset can commit as one generation.
      const summerState = await rendererState(page);
      await page.evaluate(() => window.__coursecraftTest!.setRendererSeasonFixture("autumn"));
      await expect.poll(async () => (await rendererState(page))?.requested.season, { timeout: 120_000 }).toBe("autumn");
      await autumnOverlayRequested;
      const heldAutumn = await rendererState(page);
      expect(heldAutumn?.rendered.season).toBe("summer");
      expect(heldAutumn?.rendered.generation).toBe(summerState?.rendered.generation);
      expect(heldAutumn?.rendered.seasonalVisualSignature).toBe(summerState?.rendered.seasonalVisualSignature);
      expect(heldAutumn?.layers).toEqual(summerState?.layers);
      releaseAutumnOverlay();
      await expect.poll(async () => {
        const state = await rendererState(page);
        return {
          requested: state?.requested.season,
          rendered: state?.rendered.season,
          overlay: state?.rendered.overlayKey,
          stampsMatch: state?.layers
            ? Object.values(state.layers).every((generation) => generation === state.rendered.generation)
            : false,
        };
      }, { timeout: 120_000 }).toEqual({
        requested: "autumn",
        rendered: "autumn",
        overlay: "parkland:high:autumn",
        stampsMatch: true,
      });
      await page.evaluate(() => window.__coursecraftTest!.setRendererSeasonFixture("summer"));
      await expect.poll(async () => (await rendererState(page))?.rendered.season, { timeout: 120_000 }).toBe("summer");
    }

    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("ZK-674 publishes one stable UI fallback generation after a failed bundle load", async ({ page }) => {
  const fixture = M53_SEASONAL_TERRAIN_FIXTURES.find((candidate) => (
    candidate.biome === "parkland"
    && candidate.season === "summer"
    && candidate.quality === "high"
    && candidate.rotation === 0
  ));
  expect(fixture).toBeDefined();
  let failedBundleRequests = 0;
  await page.route(/terrain-parkland-high\..*\.json/, async (route) => {
    failedBundleRequests++;
    await route.abort("failed");
  });
  await page.goto(fixture!.query);
  await expect.poll(async () => {
    const state = await rendererState(page);
    return {
      status: state?.rendered.status,
      pending: state?.activation.pending,
      terrainChunks: state?.counts?.terrainChunks ?? 0,
    };
  }, { timeout: 120_000 }).toMatchObject({
    status: "fallback",
    pending: null,
    terrainChunks: expect.any(Number),
  });
  const settled = await rendererState(page);
  expect(settled?.counts?.terrainChunks).toBeGreaterThan(0);
  expect(settled?.fallbacks).toHaveLength(1);
  await page.waitForTimeout(2_000);
  const stable = await rendererState(page);
  expect(failedBundleRequests).toBe(1);
  expect(stable?.rendered.status).toBe("fallback");
  expect(stable?.rendered.requestId).toBe(settled?.rendered.requestId);
  expect(stable?.rendered.generation).toBe(settled?.rendered.generation);
  expect(stable?.counts?.terrainRebuilds).toBe(settled?.counts?.terrainRebuilds);
  expect(stable?.activation.pending).toBeNull();
});
