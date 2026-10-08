import { phase, markPhase, phaseStatus, withDiagnosticStatus } from "../scripts/zk682-linux-phase.mjs";
import { timedReactComponentCleanup } from "../scripts/zk682-linux-cleanup-timing.mjs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { captureVisibleCanvas } from "../scripts/zk682-linux-capture.mjs";
import { clearReactComponentTimings } from "../scripts/react-component-timing-cleanup.mjs";
import {
  ZK682_RESOURCE_GROWTH_THRESHOLDS,
  ZK682_MATCHED_WARMUP_PROTOCOL,
  createZk682ResourceGrowthReport,
} from "../scripts/zk682-resource-growth-contract.mjs";

type Theme = "parkland" | "links" | "desert";
type Quality = "low" | "medium" | "high";

test.use({
  launchOptions: { args: ["--enable-precise-memory-info"] },
});

async function waitForRenderer(page: Page, theme: Theme, quality: Quality) {
  return await phase("helper.waitForRenderer", async () => {
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
  });
}

async function setRendererFixture(page: Page, theme: Theme, quality: Quality) {
  return await phase("helper.setRendererFixture", async () => {
  await phase("warm.theme", () => page.evaluate(({ requestedTheme }) => {
    window.__coursecraftTest!.setRendererThemeFixture(requestedTheme);
  }, { requestedTheme: theme }));
  await waitForRenderer(page, theme, await page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState().requested.quality
  )));
  await phase("warm.quality", () => page.evaluate(({ requestedQuality }) => {
    window.__coursecraftTest!.setGraphicsQualityFixture(requestedQuality);
  }, { requestedQuality: quality }));
  await waitForRenderer(page, theme, quality);
  });
}

async function pauseSimulation(page: Page) {
  return await phase("helper.pauseSimulation", async () => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => {
    const speed = await page.evaluate(() => window.__coursecraftTest?.state().speed);
    if (speed !== "paused") {
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);
    }
    return page.evaluate(() => window.__coursecraftTest?.state().speed);
  }, { timeout: 120_000, intervals: [250] }).toBe("paused");
  });
}

async function rotateFullCircle(page: Page) {
  return await phase("helper.rotateFullCircle", async () => {
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
  });
}

async function routeThroughTitle(page: Page) {
  return await phase("helper.routeThroughTitle", async () => {
  const pause = page.getByTestId("pause-overlay");
  await expect.poll(async () => {
    if (!await pause.isVisible()) await page.keyboard.press("Escape");
    return pause.isVisible();
  }, { timeout: 120_000, intervals: [250] }).toBe(true);
  page.once("dialog", (dialog) => dialog.accept());
  await pause.getByRole("button", { name: "⌂ Quit to title" }).click();
  await expect(page.locator(".cc-pixi-stage canvas")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest == null)).toBe(true);
  const quickStart = page.getByRole("button", { name: "Quick Start" });
  await expect(quickStart).toBeVisible();
  await quickStart.click();
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest != null), {
    timeout: 120_000,
  }).toBe(true);
  const restoredQuality = await page.evaluate(() => (
    window.__coursecraftPixiTest!.rendererAtlasState().requested.quality
  ));
  await waitForRenderer(page, "parkland", restoredQuality);
  await setRendererFixture(page, "parkland", "high");
  await pauseSimulation(page);
  });
}

type TimingCleanupReceipt = { cycle: number; cleanup: ReturnType<typeof clearReactComponentTimings> };

async function collectPostGcCheckpoint(page: Page, cdp: CDPSession, cycle: number, exercised: { theme: Theme; quality: Quality } | null, timingCleanup: TimingCleanupReceipt[]) {
  return await phase("helper.collectPostGcCheckpoint", async () => {
  if (timingCleanup.length >= 7) throw new Error("Timing cleanup receipt bound exceeded");
  const timedCleanup = await phase("checkpoint.cleanup.evaluate", () => page.evaluate(timedReactComponentCleanup));
  markPhase("checkpoint.cleanup.browser-span", "returned", undefined, { cycle, browserCleanupElapsedMs: timedCleanup.browserCleanupElapsedMs, originalCleanupReceipt: timedCleanup.receipt, qualification: "Browser-local synchronous elapsed; not host-clock subtraction or exclusive cause" });
  timingCleanup.push({ cycle, cleanup: timedCleanup.receipt });
  await phase("checkpoint.gc", () => cdp.send("HeapProfiler.collectGarbage"));
  await phase("checkpoint.settle", () => page.waitForTimeout(150));
  const heap = await phase("checkpoint.heap", () => cdp.send("Runtime.getHeapUsage"));
  const browser = await page.evaluate(() => {
    const resources = window.__coursecraftPixiTest?.resourceSnapshot();
    const atlas = window.__coursecraftPixiTest?.rendererAtlasState();
    const performanceMemory = (performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    return {
      diagnosticEnvironment: { userAgent: navigator.userAgent.slice(0, 512), viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, glDriver: "UNKNOWN" },
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
  const observedCommit = browser.state.buildCommit;
  markPhase("checkpoint.environment", "returned", undefined, { cycle, ...browser.diagnosticEnvironment, observedSourceCommit: typeof observedCommit === "string" && /^[0-9a-f]{40}$/.test(observedCommit) ? observedCommit : "UNKNOWN", expectedSourceCommit: process.env.ZK682_EXPECTED_COMMIT ?? "UNKNOWN", sourceCommitQualification: "Expected commit is host source-bound; observed commit only if existing public state carries full buildCommit", diagnosticStatus: phaseStatus() });
  const diagnosticStatus = phaseStatus();
  if (diagnosticStatus.overflow || diagnosticStatus.secondaryLoggingFailures) throw new Error("Diagnostic phase logger failed or overflowed; diagnostic invalid");
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
      width: browser.state.course?.width,
      height: browser.state.course?.height,
      holesOpen: browser.state.course?.holesOpen,
      holeSlots: browser.state.course?.holeSetups?.length,
      speed: browser.state.simulation?.speed,
    },
    heap: {
      runtimeUsedBytes: heap.usedSize,
      runtimeTotalBytes: heap.totalSize,
      embedderUsedBytes: heap.embedderHeapUsedSize,
      backingStorageBytes: heap.backingStorageSize,
      performance: browser.performanceMemory,
    },
  };
  });
}

test("ZK-682 bounds real Pixi resource growth after warmup and repeated teardown", async ({ page, browserName }, testInfo) => {
  return await withDiagnosticStatus("producer.terminal-status", async () => {
  test.slow();
  markPhase("producer.setup", "enter");
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

  // Warm the same large Quick Start course used by every measured remount.
  // Its e2e seed is source-bound; dimensions and paused state are observed here.
  await routeThroughTitle(page);
  const warmupFixture = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return {
      width: state.course?.width,
      height: state.course?.height,
      holesOpen: state.course?.holesOpen,
      holeSlots: state.course?.holeSetups?.length,
      quality: state.graphics?.quality,
      speed: state.simulation?.speed,
      screen: state.screen,
    };
  });
  expect(warmupFixture).toEqual({ width: 220, height: 140, holesOpen: 0, holeSlots: 9, quality: "high", speed: "paused", screen: "game" });

  // Fully warm the finite 3-biome × 3-quality atlas residency before taking
  // a baseline. Intentional cache population is not a post-warmup leak.
  const themes: Theme[] = ["parkland", "links", "desert"];
  const qualities: Quality[] = ["low", "medium", "high"];
  for (const theme of themes) {
    // Warm-only theme assignment: activate once, then exercise all qualities.
    await phase("warm.theme", () => page.evaluate(({ requestedTheme }) => {
      window.__coursecraftTest!.setRendererThemeFixture(requestedTheme);
    }, { requestedTheme: theme }));
    await waitForRenderer(page, theme, await page.evaluate(() => (
      window.__coursecraftPixiTest!.rendererAtlasState().requested.quality
    )));
    for (const quality of qualities) {
      await phase("warm.quality", () => page.evaluate(({ requestedQuality }) => {
        window.__coursecraftTest!.setGraphicsQualityFixture(requestedQuality);
      }, { requestedQuality: quality }));
      await waitForRenderer(page, theme, quality);
    }
  }
  await rotateFullCircle(page);
  await routeThroughTitle(page);
  const warmupAtlas = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().residency);
  expect(warmupAtlas.baseBundles).toEqual([
    "desert:high", "desert:low", "desert:medium",
    "links:high", "links:low", "links:medium",
    "parkland:high", "parkland:low", "parkland:medium",
  ]);

  const timingCleanup: TimingCleanupReceipt[] = [];
  const samples = [await collectPostGcCheckpoint(page, cdp, 0, null, timingCleanup)];
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
    samples.push(await collectPostGcCheckpoint(page, cdp, index + 1, transition, timingCleanup));
    console.log(`[zk682-resource-growth] collected cycle ${index + 1}/${sequence.length}`);
  }

  const outputPath = resolve(
    process.env.COURSECRAFT_ZK682_RESOURCE_REPORT ?? testInfo.outputPath("zk682-resource-growth-report.json"),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  const finalCapturePath = resolve(dirname(outputPath), "zk682-resource-growth-final.png");
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
      themeLoads: themes.length,
      routeTeardowns: 2,
      rotations: 1,
      protocol: ZK682_MATCHED_WARMUP_PROTOCOL,
      states: themes.flatMap((theme) => qualities.map((quality) => ({ theme, quality }))),
      fixture: warmupFixture,
      seed: { value: 424242, qualification: "source-bound-e2e-quick-start" },
    },
    samples,
  });
  await phase("producer.report.317", () => writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" }));
  expect(timingCleanup).toHaveLength(7);
  const timingCleanupPath = resolve(dirname(outputPath), "zk682-react-component-timing-cleanup.json");
  const timingCleanupJson = `${JSON.stringify({
    measurementProtocol: "exclusive-react-development-component-measures-cleared-before-existing-gc-v1",
    preserves: "same-name collisions, scheduler and application measures",
    samples: timingCleanup,
  }, null, 2)}\n`;
  if (Buffer.byteLength(timingCleanupJson, "utf8") > 8192) throw new Error("Timing cleanup artifact byte cap exceeded");
  await phase("producer.report.326", () => writeFile(timingCleanupPath, timingCleanupJson, { encoding: "utf8", flag: "wx" }));
  // Preserve quantitative artifacts before the required final image capture.
  const captureReceipt = await phase("producer.capture", () => captureVisibleCanvas(page, finalCapturePath));
  await phase("producer.report.329", () => writeFile(resolve(dirname(outputPath), "zk682-canvas-capture-receipt.json"), `${JSON.stringify(captureReceipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" }));
  await testInfo.attach("zk682-react-component-timing-cleanup", { path: timingCleanupPath, contentType: "application/json" });
  await testInfo.attach("zk682-resource-growth-report", { path: outputPath, contentType: "application/json" });
  await testInfo.attach("zk682-resource-growth-final", { path: finalCapturePath, contentType: "image/png" });
  console.log(`[zk682-resource-growth] ${JSON.stringify({ summary: report.summary, thresholds: report.thresholds, passed: report.passed })}`);
  expect(browserErrors).toEqual([]);
  expect(report.errors, JSON.stringify(report.errors, null, 2)).toEqual([]);
  expect(report.passed).toBe(true);
  markPhase("producer.complete", "exit");
  });
});
