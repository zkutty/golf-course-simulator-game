import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  ZK682_RESOURCE_GROWTH_THRESHOLDS,
  createZk682ResourceGrowthReport,
} from "../scripts/zk682-resource-growth-contract.mjs";

type Theme = "parkland" | "links" | "desert";
type Quality = "low" | "medium" | "high";

test.use({
  launchOptions: { args: ["--enable-precise-memory-info"] },
});

async function waitForRenderer(page: Page, theme: Theme, quality: Quality) {
  await expect.poll(() => page.evaluate(() => {
    const renderer = window.__coursecraftPixiTest?.rendererAtlasState();
    const resources = window.__coursecraftPixiTest?.resourceSnapshot();
    return renderer && resources ? {
      requestedBiome: renderer.requested.biome,
      requestedQuality: renderer.requested.quality,
      renderedBiome: renderer.rendered.biome,
      renderedQuality: renderer.rendered.quality,
      status: renderer.rendered.status,
      pending: renderer.activation.pending,
      fallbacks: renderer.fallbacks.length,
      managedTextureSources: resources.managedTextureSources,
      canvasConnected: resources.canvasConnected,
    } : null;
  }), { timeout: 120_000 }).toEqual({
    requestedBiome: theme,
    requestedQuality: quality,
    renderedBiome: theme,
    renderedQuality: quality,
    status: "activated",
    pending: null,
    fallbacks: 0,
    managedTextureSources: expect.any(Number),
    canvasConnected: true,
  });
  const managed = await page.evaluate(() => window.__coursecraftPixiTest!.resourceSnapshot()!.managedTextureSources);
  expect(managed, "Pixi renderer must expose its real managed texture-source count").toBeGreaterThan(0);
}

async function setRendererFixture(page: Page, theme: Theme, quality: Quality) {
  await page.evaluate(({ requestedTheme }) => {
    window.__coursecraftTest!.setRendererThemeFixture(requestedTheme);
  }, { requestedTheme: theme });
  await waitForRenderer(page, theme, await page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState().requested.quality
  )));
  await page.evaluate(({ requestedQuality }) => {
    window.__coursecraftTest!.setGraphicsQualityFixture(requestedQuality);
  }, { requestedQuality: quality });
  await waitForRenderer(page, theme, quality);
}

async function pauseSimulation(page: Page) {
  const speed = await page.evaluate(() => window.__coursecraftTest?.state().speed);
  if (speed !== "paused") await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().speed)).toBe("paused");
}

async function rotateFullCircle(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Remounting/reconfiguring Pixi replaces the production keyboard effect.
  // Give React one frame to attach the new handler before exercising it.
  await page.waitForTimeout(150);
  const start = await page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState().parklandComposable.camera.rotation
  ));
  for (let turn = 1; turn <= 4; turn += 1) {
    await page.keyboard.press("e");
    const expected = (start + turn * 90) % 360;
    await expect.poll(() => page.evaluate(() => (
      window.__coursecraftPixiTest!.rendererAtlasState().parklandComposable.camera.rotation
    )), { timeout: 15_000 }).toBe(expected);
    await page.waitForTimeout(100);
  }
}

async function routeThroughTitle(page: Page) {
  await page.keyboard.press("Escape");
  const pause = page.getByTestId("pause-overlay");
  await expect(pause).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await pause.getByRole("button", { name: "⌂ Quit to title" }).click();
  await expect(page.locator(".cc-pixi-stage canvas")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest == null)).toBe(true);
  const quickStart = page.getByRole("button", { name: "Quick Start" });
  await expect(quickStart).toBeVisible();
  await quickStart.click();
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest != null)).toBe(true);
  const restoredQuality = await page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState().requested.quality
  ));
  await waitForRenderer(page, "parkland", restoredQuality);
  await setRendererFixture(page, "parkland", "high");
  await pauseSimulation(page);
}

async function collectPostGcCheckpoint(page: Page, cdp: CDPSession, cycle: number, exercised: { theme: Theme; quality: Quality } | null) {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(150);
  const heap = await cdp.send("Runtime.getHeapUsage");
  const browser = await page.evaluate(() => {
    const resources = window.__coursecraftPixiTest?.resourceSnapshot();
    const atlas = window.__coursecraftPixiTest?.rendererAtlasState();
    const performanceMemory = (performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    return {
      resources,
      atlasResidency: atlas?.residency ?? null,
      renderer: atlas ? {
        biome: atlas.rendered.biome,
        quality: atlas.rendered.quality,
        generation: atlas.rendered.generation,
        rotation: atlas.parklandComposable.camera.rotation,
        pending: atlas.activation.pending,
        fallbacks: atlas.fallbacks.length,
      } : null,
      state: JSON.parse(window.render_game_to_text?.() ?? "{}"),
      performanceMemory: performanceMemory ? {
        usedBytes: performanceMemory.usedJSHeapSize,
        totalBytes: performanceMemory.totalJSHeapSize,
        limitBytes: performanceMemory.jsHeapSizeLimit,
      } : null,
    };
  });
  return {
    cycle,
    exercised,
    resources: browser.resources,
    atlasResidency: browser.atlasResidency,
    renderer: browser.renderer,
    state: {
      screen: browser.state.screen,
      theme: browser.state.course?.theme,
      quality: browser.state.graphics?.quality,
      rotation: browser.state.camera?.rotation,
    },
    heap: {
      runtimeUsedBytes: heap.usedSize,
      runtimeTotalBytes: heap.totalSize,
      embedderUsedBytes: heap.embedderHeapUsedSize,
      backingStorageBytes: heap.backingStorageSize,
      performance: browser.performanceMemory,
    },
  };
}

test("ZK-682 bounds real Pixi resource growth after warmup and repeated teardown", async ({ page, browserName }, testInfo) => {
  test.slow();
  expect(browserName).toBe("chromium");
  const expectedCommit = process.env.ZK682_EXPECTED_COMMIT;
  expect(expectedCommit, "ZK682_EXPECTED_COMMIT must be a full candidate SHA").toMatch(/^[0-9a-f]{40}$/);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console.error: ${message.text()}`);
  });
  await page.addInitScript(() => localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
    version: 5,
    tutorialOffered: true,
    tutorialCompleted: true,
    gameplay: { autosaveCadence: "off" },
  })));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await page.goto("/?m53Fixture=1&m53Theme=parkland&m53Seed=2&m53Season=summer&m53Weather=drought&m53Rotation=0&m53Quality=high");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 120_000,
  }).toBe("game");
  await waitForRenderer(page, "parkland", "high");
  await pauseSimulation(page);

  // Fully warm the finite 3-biome × 3-quality atlas residency before taking
  // a baseline. Intentional cache population is not a post-warmup leak.
  const themes: Theme[] = ["parkland", "links", "desert"];
  const qualities: Quality[] = ["low", "medium", "high"];
  for (const theme of themes) {
    for (const quality of qualities) await setRendererFixture(page, theme, quality);
  }
  await rotateFullCircle(page);
  await routeThroughTitle(page);
  const warmupAtlas = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().residency);
  expect(warmupAtlas.baseBundles).toEqual([
    "desert:high", "desert:low", "desert:medium",
    "links:high", "links:low", "links:medium",
    "parkland:high", "parkland:low", "parkland:medium",
  ]);

  const samples = [await collectPostGcCheckpoint(page, cdp, 0, null)];
  console.log(`[zk682-resource-growth] collected baseline`);
  const sequence: Array<{ theme: Theme; quality: Quality }> = [
    { theme: "links", quality: "low" },
    { theme: "desert", quality: "medium" },
    { theme: "parkland", quality: "high" },
    { theme: "links", quality: "low" },
    { theme: "desert", quality: "medium" },
    { theme: "parkland", quality: "high" },
  ];
  for (const [index, transition] of sequence.entries()) {
    await setRendererFixture(page, transition.theme, transition.quality);
    await rotateFullCircle(page);
    await routeThroughTitle(page);
    samples.push(await collectPostGcCheckpoint(page, cdp, index + 1, transition));
    console.log(`[zk682-resource-growth] collected cycle ${index + 1}/${sequence.length}`);
  }

  const outputPath = resolve(
    process.env.COURSECRAFT_ZK682_RESOURCE_REPORT ?? testInfo.outputPath("zk682-resource-growth-report.json"),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  const finalCapturePath = resolve(dirname(outputPath), "zk682-resource-growth-final.png");
  await page.locator(".cc-pixi-stage canvas").screenshot({ path: finalCapturePath });
  const rendererState = await page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState() as unknown as {
      pathMaterialCrossSection: { commit: string };
    }
  ));
  expect(rendererState.pathMaterialCrossSection.commit).toBe(expectedCommit);
  const report = createZk682ResourceGrowthReport({
    source: { commit: rendererState.pathMaterialCrossSection.commit, mode: "e2e" },
    capturedAt: new Date().toISOString(),
    command: "npm run test:resource-growth",
    browser: {
      name: browserName,
      version: page.context().browser()?.version() ?? "unknown",
      cdpHeap: true,
    },
    thresholds: ZK682_RESOURCE_GROWTH_THRESHOLDS,
    warmup: {
      baseBundles: warmupAtlas.baseBundles,
      transitions: themes.length * qualities.length,
      routeTeardowns: 1,
    },
    samples,
  });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await testInfo.attach("zk682-resource-growth-report", { path: outputPath, contentType: "application/json" });
  await testInfo.attach("zk682-resource-growth-final", { path: finalCapturePath, contentType: "image/png" });
  console.log(`[zk682-resource-growth] ${JSON.stringify({ summary: report.summary, thresholds: report.thresholds, passed: report.passed })}`);
  expect(browserErrors).toEqual([]);
  expect(report.errors, JSON.stringify(report.errors, null, 2)).toEqual([]);
  expect(report.passed).toBe(true);
});
