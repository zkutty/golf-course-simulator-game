import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ZK682_STABILITY_THRESHOLDS,
  createZk682StabilityReport,
} from "../scripts/zk682-stability-contract.mjs";

test.use({ launchOptions: { args: ["--enable-precise-memory-info"] } });

type Measured = {
  resources: NonNullable<ReturnType<NonNullable<Window["__coursecraftPixiTest"]>["resourceSnapshot"]>>;
  heap: { runtimeUsedBytes: number; runtimeTotalBytes: number };
};

async function measure(page: Page, cdp: CDPSession): Promise<Measured> {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(120);
  const heap = await cdp.send("Runtime.getHeapUsage");
  const resources = await page.evaluate(() => window.__coursecraftPixiTest?.resourceSnapshot() ?? null);
  expect(resources, "Pixi resource diagnostics must be mounted").not.toBeNull();
  return {
    resources: resources!,
    heap: { runtimeUsedBytes: heap.usedSize, runtimeTotalBytes: heap.totalSize },
  };
}

async function canonicalState(page: Page) {
  return page.evaluate(() => {
    const state = window.__coursecraftTest!.state();
    return {
      screen: state.screen,
      week: state.week,
      cash: state.cash,
      terrainVersion: state.terrainVersion,
    };
  });
}

async function openPause(page: Page) {
  if (!await page.getByTestId("pause-overlay").isVisible()) await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
}

async function loadQuickSave(page: Page) {
  await openPause(page);
  await page.getByTestId("pause-overlay").getByRole("button", { name: /load game/i }).click();
  const slot = page.getByTestId("save-slot-quick-save");
  await expect(slot).toContainText("Quick Save", { timeout: 30_000 });
  await slot.getByRole("button", { name: "Load", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible({ timeout: 120_000 });
}

async function projectTile(page: Page, canvas: Locator, point: { x: number; y: number }) {
  const projected = await page.evaluate((target) => ({
    point: window.__coursecraftPixiTest!.tileToScreen(target.x, target.y),
    viewport: window.__coursecraftPixiTest!.viewport(),
  }), point);
  const bounds = await canvas.boundingBox();
  if (!bounds || !projected.point || !projected.viewport) throw new Error("Course projection unavailable");
  return {
    x: bounds.x + projected.point.x * bounds.width / projected.viewport.width,
    y: bounds.y + projected.point.y * bounds.height / projected.viewport.height,
  };
}

test("ZK-682 produces candidate-bound supplemental stability evidence", async ({ page, browserName }, testInfo) => {
  test.slow();
  expect(browserName).toBe("chromium");
  const expectedCommit = process.env.ZK682_EXPECTED_COMMIT;
  expect(expectedCommit, "ZK682_EXPECTED_COMMIT must be a full candidate SHA").toMatch(/^[0-9a-f]{40}$/);
  const outputDirectory = resolve(process.env.COURSECRAFT_ZK682_STABILITY_DIR ?? testInfo.outputDir);
  await mkdir(outputDirectory, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console.error: ${message.text()}`); });
  await page.addInitScript(() => localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
    version: 5,
    tutorialOffered: true,
    tutorialCompleted: true,
    gameplay: { autosaveCadence: "off" },
  })));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Page.enable");
  await page.goto("/?perfFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 120_000 }).toBe("game");
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.rendererAtlasState().rendered.status)).toBe("activated");
  const runtimeCommit = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().pathMaterialCrossSection.commit);
  expect(runtimeCommit).toBe(expectedCommit);

  // Repeated production quick-save loads, including real IndexedDB reads and
  // full App state restoration, are measured after a post-GC baseline.
  if (await page.evaluate(() => window.__coursecraftTest!.state().speed) !== "paused") await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().speed)).toBe("paused");
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  const savedCourseHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  const savedState = await canonicalState(page);
  const saveLoadSamples = [{ cycle: 0, slotId: "quick-save", loaded: false, courseHash: savedCourseHash, state: savedState, ...await measure(page, cdp) }];
  for (let cycle = 1; cycle <= ZK682_STABILITY_THRESHOLDS["save-load-resource-stability"].minimumSaveLoads; cycle += 1) {
    await loadQuickSave(page);
    saveLoadSamples.push({ cycle, slotId: "quick-save", loaded: true, courseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash), state: await canonicalState(page), ...await measure(page, cdp) });
  }
  const saveLoadReport = createZk682StabilityReport({
    gate: "save-load-resource-stability",
    candidateCommit: expectedCommit!,
    capturedAt: new Date().toISOString(),
    command: "npm run test:stability",
    browser: { name: browserName, version: page.context().browser()?.version() ?? "unknown", cdpHeap: true },
    thresholds: ZK682_STABILITY_THRESHOLDS["save-load-resource-stability"],
    samples: saveLoadSamples,
  });
  expect(saveLoadReport.errors, JSON.stringify(saveLoadReport.errors, null, 2)).toEqual([]);
  await writeFile(resolve(outputDirectory, "save-load-resource-stability.json"), `${JSON.stringify(saveLoadReport, null, 2)}\n`);

  // Run the actual mutable live simulation for at least two in-game hours.
  await page.keyboard.press("Digit3");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().speed)).toBe("4x");
  const startMinute = await page.evaluate(() => window.__coursecraftTest!.state().dayMinute);
  const longSessionSamples = [{ elapsedGameMinutes: 0, courseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash), state: { ...(await page.evaluate(() => { const state = window.__coursecraftTest!.state(); return { dayMinute: state.dayMinute, speed: state.speed, onCourse: state.golferPositions.length }; })) }, ...await measure(page, cdp) }];
  while ((longSessionSamples.at(-1)?.elapsedGameMinutes ?? 0) < ZK682_STABILITY_THRESHOLDS["long-session-resource-stability"].minimumSessionMinutes) {
    await page.evaluate(() => window.advanceTime!(2_000));
    await page.waitForTimeout(80);
    const state = await page.evaluate(() => window.__coursecraftTest!.state());
    longSessionSamples.push({ elapsedGameMinutes: Number((state.dayMinute - startMinute).toFixed(4)), courseHash: state.courseHash, state: { dayMinute: state.dayMinute, speed: state.speed, onCourse: state.golferPositions.length }, ...await measure(page, cdp) });
    expect(longSessionSamples.length, "bounded long-session producer").toBeLessThanOrEqual(10);
  }
  const longSessionReport = createZk682StabilityReport({
    gate: "long-session-resource-stability",
    candidateCommit: expectedCommit!,
    capturedAt: new Date().toISOString(),
    command: "npm run test:stability",
    browser: { name: browserName, version: page.context().browser()?.version() ?? "unknown", cdpHeap: true },
    thresholds: ZK682_STABILITY_THRESHOLDS["long-session-resource-stability"],
    samples: longSessionSamples,
  });
  expect(longSessionReport.errors, JSON.stringify(longSessionReport.errors, null, 2)).toEqual([]);
  await writeFile(resolve(outputDirectory, "long-session-resource-stability.json"), `${JSON.stringify(longSessionReport, null, 2)}\n`);

  // Save a recovery point, then exercise editing, diagnostic overlay,
  // Chromium frozen/active lifecycle, and production load recovery.
  if (await page.evaluate(() => window.__coursecraftTest!.state().speed) !== "paused") await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().speed)).toBe("paused");
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  const recoveryPoint = await page.evaluate(() => window.__coursecraftTest!.state());
  const interactionSamples: Array<Record<string, unknown> & Measured> = [];

  const canvas = page.locator(".cc-pixi-stage canvas");
  const placement = await page.evaluate(() => window.__coursecraftTest!.setZk470PlacementFixture("terrain-stroke"));
  await page.evaluate(({ point }) => window.__coursecraftPixiTest!.focusTileForTest(point.x, point.y, 1.15), placement);
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const paintPoint = await projectTile(page, canvas, placement.point);
  const beforeEdit = await page.evaluate(() => window.__coursecraftTest!.state());
  await page.mouse.move(paintPoint.x, paintPoint.y);
  await page.mouse.down();
  await page.mouse.move(paintPoint.x + 20, paintPoint.y + 8, { steps: 4 });
  await expect(page.getByTestId("terrain-stroke-preview")).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().terrainVersion)).toBe(beforeEdit.terrainVersion + 1);
  const afterEdit = await page.evaluate(() => window.__coursecraftTest!.state());
  interactionSamples.push({ scenario: "editing", passed: true, before: { terrainVersion: beforeEdit.terrainVersion }, after: { terrainVersion: afterEdit.terrainVersion, screen: afterEdit.screen }, ...await measure(page, cdp) });

  const beforeOverlayKind = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.kind ?? null);
  await page.getByTestId("open-architecture-review").click();
  await expect(page.getByTestId("architecture-review")).toBeVisible();
  await page.getByTestId("architecture-overlay-recovery").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.kind)).toBe("recovery");
  interactionSamples.push({ scenario: "overlay", passed: true, before: { kind: beforeOverlayKind }, after: { kind: "recovery", visible: await page.getByTestId("architecture-review").isVisible() }, ...await measure(page, cdp) });
  await page.getByTestId("architecture-review").getByRole("button", { name: "Close" }).click();

  const beforeSleepHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  await cdp.send("Page.setWebLifecycleState" as never, { state: "frozen" } as never);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  await cdp.send("Page.setWebLifecycleState" as never, { state: "active" } as never);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().courseHash)).toBe(beforeSleepHash);
  const responsive = await page.evaluate(() => { window.advanceTime?.(50); return typeof window.render_game_to_text?.() === "string"; });
  interactionSamples.push({ scenario: "sleep-wake", passed: responsive, before: { courseHash: beforeSleepHash }, after: { courseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash), lifecycle: "active", responsive }, ...await measure(page, cdp) });

  await loadQuickSave(page);
  const recovered = await page.evaluate(() => window.__coursecraftTest!.state());
  interactionSamples.push({ scenario: "recovery", passed: true, before: { savedTerrainVersion: recoveryPoint.terrainVersion, mutatedTerrainVersion: afterEdit.terrainVersion, savedCourseHash: recoveryPoint.courseHash }, after: { terrainVersion: recovered.terrainVersion, courseHash: recovered.courseHash, quickSaveLoaded: true }, ...await measure(page, cdp) });
  const interactionReport = createZk682StabilityReport({
    gate: "editing-overlay-sleep-recovery",
    candidateCommit: expectedCommit!,
    capturedAt: new Date().toISOString(),
    command: "npm run test:stability",
    browser: { name: browserName, version: page.context().browser()?.version() ?? "unknown", cdpHeap: true },
    thresholds: ZK682_STABILITY_THRESHOLDS["editing-overlay-sleep-recovery"],
    samples: interactionSamples,
  });
  expect(interactionReport.errors, JSON.stringify(interactionReport.errors, null, 2)).toEqual([]);
  await writeFile(resolve(outputDirectory, "editing-overlay-sleep-recovery.json"), `${JSON.stringify(interactionReport, null, 2)}\n`);

  const finalScreenshot = resolve(outputDirectory, "zk682-stability-final.png");
  await page.screenshot({ path: finalScreenshot, fullPage: true });
  await testInfo.attach("zk682-stability-final", { path: finalScreenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
