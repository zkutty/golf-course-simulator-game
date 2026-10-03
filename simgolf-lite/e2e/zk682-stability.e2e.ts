import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { closeSync, openSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ZK682_STABILITY_THRESHOLDS,
  createZk682StabilityReport,
} from "../scripts/zk682-stability-contract.mjs";

import { clearReactComponentTimings } from "../scripts/react-component-timing-cleanup.mjs";

test.use({ launchOptions: { args: ["--enable-precise-memory-info"] } });

type Measured = {
  resources: NonNullable<ReturnType<NonNullable<Window["__coursecraftPixiTest"]>["resourceSnapshot"]>>;
  rendererQuality: "high" | "medium" | "low";
  heap: { runtimeUsedBytes: number; runtimeTotalBytes: number };
};

const timingCleanupSamples: ReturnType<typeof clearReactComponentTimings>[] = [];

// Opt-in snapshots may trigger GC and perturb later samples. Uninstrumented
// stability evidence remains authoritative for release acceptance.
async function createHeapDiagnostics(outputDirectory: string, candidateCommit: string) {
  const requested = process.env.ZK682_DIAGNOSTICS_DIR;
  if (!requested) return null;
  const physicalPath = async (path: string): Promise<string> => {
    try { return await realpath(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(path);
      if (parent === path) throw error;
      return resolve(await physicalPath(parent), relative(parent, path));
    }
  };
  const fixedCanonical = resolve("artifacts/zk682/raw");
  const canonicalDirectories = [
    resolve(outputDirectory), fixedCanonical,
    await physicalPath(resolve(outputDirectory)), await physicalPath(fixedCanonical),
  ];
  const assertOutsideCanonical = (directory: string) => {
    for (const canonicalDirectory of canonicalDirectories) {
      const withinCanonical = relative(canonicalDirectory, directory);
      if (withinCanonical === "" || (withinCanonical.split(/[\\/]/)[0] !== ".." && !isAbsolute(withinCanonical))) {
        throw new Error("ZK682_DIAGNOSTICS_DIR must be outside active and fixed canonical stability output");
      }
    }
  };
  assertOutsideCanonical(resolve(requested));
  assertOutsideCanonical(await physicalPath(resolve(requested)));
  await mkdir(requested, { recursive: true });
  const directory = await realpath(requested);
  assertOutsideCanonical(directory);
  const maxBytes = 256 * 1024 * 1024;
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let errorCount = 0;
  const diagnosticFailure = (error: unknown) => {
    errorCount++;
    if (errors.length < 16) errors.push(String(error));
    console.warn("[zk682-heap-diagnostics]", JSON.stringify({ complete: false, candidateCommit, startedAt, error: String(error) }));
  };
  const manifestPath = resolve(directory, "heap-diagnostics.json");
  type Capture = { cycle: number; reasons: string[]; file: string; bytesWritten: number; sha256: string | null; complete: boolean; error: string | null };
  const captures: Capture[] = [];
  const samples: Array<{ cycle: number; growthBytes: number; measured: Measured; timingCleanup: ReturnType<typeof clearReactComponentTimings> }> = [];
  const persist = async () => {
    try {
      await writeFile(`${manifestPath}.tmp`, `${JSON.stringify({
        diagnosticOnly: true,
        acceptanceEvidence: "Use the uninstrumented candidate run; snapshots may perturb later samples.",
        candidateCommit, startedAt,
        limits: { snapshots: 2, bytesPerSnapshot: maxBytes, samples: 13 },
        complete: errorCount === 0 && samples.length === 13 && captures.length === 2
          && captures.some(capture => capture.reasons.includes("baseline") && capture.complete)
          && captures.some(capture => capture.reasons.includes("end") && capture.complete)
          && captures.every(capture => capture.complete),
        errors, errorCount, captures, samples,
      }, null, 2)}\n`);
      await rename(`${manifestPath}.tmp`, manifestPath);
    } catch (error) {
      diagnosticFailure(error);
      // Do not leave a previous run's complete manifest looking current after
      // persistence fails. Root validates freshness and diagnostic log failures.
      await rm(manifestPath, { force: true }).catch(diagnosticFailure);
      await rm(`${manifestPath}.tmp`, { force: true }).catch(diagnosticFailure);
    }
  };
  await persist();
  return async (cdp: CDPSession, cycle: number, measured: Measured, baselineBytes: number) => {
    try {
      if (samples.length >= 13) {
        diagnosticFailure("Bounded heap diagnostic sample count exceeded");
        await persist();
        return;
      }
      const growthBytes = measured.heap.runtimeUsedBytes - baselineBytes;
      samples.push({ cycle, growthBytes, measured, timingCleanup: timingCleanupSamples.at(-1)! });
      const reasons: string[] = [];
      if (cycle === 0) reasons.push("baseline");
      if (cycle === ZK682_STABILITY_THRESHOLDS["save-load-resource-stability"].minimumSaveLoads) reasons.push("end");
      // Persist the original post-GC sample before potentially perturbing capture.
      await persist();
      if (!reasons.length || captures.length >= 2) return;
      const capture: Capture = { cycle, reasons, file: `cycle-${cycle}.heapsnapshot`, bytesWritten: 0, sha256: null, complete: false, error: null };
      captures.push(capture);
      let descriptor: number | undefined;
      const hash = createHash("sha256");
      const finalPath = resolve(directory, capture.file);
      const partialPath = `${finalPath}.part`;
      const chunk = ({ chunk: text }: { chunk: string }) => {
        if (capture.error || descriptor === undefined) return;
        try {
          const bytes = Buffer.from(text, "utf8");
          if (capture.bytesWritten + bytes.length > maxBytes) {
            capture.error = "Snapshot exceeded the 256 MiB cap; diagnostic file is incomplete";
            return;
          }
          // Drain each chunk synchronously: no retained chunk array or unbounded
          // pending-write/backpressure queue. The browser heap is never copied here.
          let offset = 0;
          while (offset < bytes.length) {
            const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
            if (written <= 0) throw new Error("Heap snapshot write made no progress");
            capture.bytesWritten += written;
            hash.update(bytes.subarray(offset, offset + written));
            offset += written;
          }

        } catch (error) { capture.error = String(error); }
      };
      try {
        descriptor = openSync(partialPath, "wx");
        cdp.on("HeapProfiler.addHeapSnapshotChunk", chunk);
        await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
        if (capture.bytesWritten === 0 && capture.error === null) capture.error = "Heap snapshot returned no data";
        capture.complete = capture.error === null;
      } catch (error) { capture.error = String(error); }
      finally {
        try { cdp.off("HeapProfiler.addHeapSnapshotChunk", chunk); }
        catch (error) { capture.error = String(error); capture.complete = false; }
        if (descriptor !== undefined) {
          try { closeSync(descriptor); } catch (error) { capture.error = String(error); capture.complete = false; }
        }
      }
      if (capture.complete) {
        try {
          capture.sha256 = hash.digest("hex");
          await rename(partialPath, finalPath);
        } catch (error) { capture.error = String(error); capture.complete = false; capture.sha256 = null; }
      }
      if (!capture.complete) {
        await rm(partialPath, { force: true }).catch(diagnosticFailure);
        await rm(finalPath, { force: true }).catch(diagnosticFailure);
      }
      if (!capture.complete) diagnosticFailure(capture.error ?? "Heap snapshot capture is incomplete");
      await persist();
    } catch (error) { diagnosticFailure(error); await persist(); }
  };
}

async function measure(page: Page, cdp: CDPSession): Promise<Measured> {
  timingCleanupSamples.push(await page.evaluate(clearReactComponentTimings));
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(120);
  const heap = await cdp.send("Runtime.getHeapUsage");
  const renderer = await page.evaluate(() => ({
    resources: window.__coursecraftPixiTest?.resourceSnapshot() ?? null,
    quality: window.__coursecraftPixiTest?.rendererAtlasState().rendered.quality ?? null,
  }));
  expect(renderer.resources, "Pixi resource diagnostics must be mounted").not.toBeNull();
  expect(renderer.quality, "renderer quality must be part of every resource sample").toMatch(/^(high|medium|low)$/);
  return {
    resources: renderer.resources!,
    rendererQuality: renderer.quality!,
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
      terrainCounts: state.terrainCounts,
    };
  });
}

async function pauseSimulation(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => {
    const speed = await page.evaluate(() => window.__coursecraftTest?.state().speed);
    if (speed !== "paused") {
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);
    }
    return page.evaluate(() => window.__coursecraftTest?.state().speed);
  }, { timeout: 120_000, intervals: [250] }).toBe("paused");
}

async function waitForStableResourceTopology(page: Page) {
  let previous = "";
  let stableSamples = 0;
  await expect.poll(async () => {
    const snapshot = await page.evaluate(() => {
      const renderer = window.__coursecraftPixiTest?.rendererAtlasState();
      const resources = window.__coursecraftPixiTest?.resourceSnapshot();
      if (renderer?.rendered.status !== "activated" || !resources?.canvasConnected) return null;
      return {
        displayObjects: resources.displayObjects,
        containers: resources.containers,
        sprites: resources.sprites,
        graphics: resources.graphics,
        meshes: resources.meshes,
        text: resources.text,
      };
    });
    const serialized = snapshot == null ? "" : JSON.stringify(snapshot);
    stableSamples = serialized !== "" && serialized === previous ? stableSamples + 1 : (serialized === "" ? 0 : 1);
    previous = serialized;
    return stableSamples;
  }, { timeout: 120_000, intervals: [100, 200, 400] }).toBeGreaterThanOrEqual(3);
}

async function openPause(page: Page) {
  const pause = page.getByTestId("pause-overlay");
  await expect.poll(async () => {
    if (!await pause.isVisible()) await page.keyboard.press("Escape");
    return pause.isVisible();
  }, { timeout: 120_000, intervals: [250] }).toBe(true);
}

async function loadQuickSave(page: Page) {
  await openPause(page);
  await page.getByTestId("pause-overlay").getByRole("button", { name: /load game/i }).click();
  const slot = page.getByTestId("save-slot-quick-save");
  await expect(slot).toContainText("Quick Save", { timeout: 30_000 });
  await slot.getByRole("button", { name: "Load", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 120_000 }).toBe("game");
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible({ timeout: 120_000 });
  await waitForStableResourceTopology(page);
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
  timingCleanupSamples.length = 0;
  expect(browserName).toBe("chromium");
  const expectedCommit = process.env.ZK682_EXPECTED_COMMIT;
  expect(expectedCommit, "ZK682_EXPECTED_COMMIT must be a full candidate SHA").toMatch(/^[0-9a-f]{40}$/);
  const outputDirectory = resolve(process.env.COURSECRAFT_ZK682_STABILITY_DIR ?? testInfo.outputDir);
  await mkdir(outputDirectory, { recursive: true });
  let recordHeapDiagnostic: Awaited<ReturnType<typeof createHeapDiagnostics>> = null;
  try { recordHeapDiagnostic = await createHeapDiagnostics(outputDirectory, expectedCommit!); }
  catch (error) {
    console.warn("[zk682-heap-diagnostics]", JSON.stringify({ complete: false, candidateCommit: expectedCommit, error: String(error) }));
  }
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
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.rendererAtlasState().rendered.status), { timeout: 120_000 }).toBe("activated");
  const runtimeCommit = await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().pathMaterialCrossSection.commit);
  expect(runtimeCommit).toBe(expectedCommit);

  // Repeated production quick-save loads, including real IndexedDB reads and
  // full App state restoration, are measured after a post-GC baseline.
  await pauseSimulation(page);
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  // The synthetic heavy fixture is not itself a save-round-trip fixed point:
  // normal loading canonicalizes derived course fields. Warm that one-time
  // normalization, then save the canonical production state before measuring
  // repeated loads. No measured cycle may drift after this boundary.
  await loadQuickSave(page);
  await page.keyboard.press("Control+KeyS");
  await page.waitForTimeout(250);
  await waitForStableResourceTopology(page);
  const savedCourseHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  const savedState = await canonicalState(page);
  const saveLoadSamples = [{ cycle: 0, slotId: "quick-save", loaded: false, courseHash: savedCourseHash, state: savedState, ...await measure(page, cdp) }];
  await recordHeapDiagnostic?.(cdp, 0, saveLoadSamples[0], saveLoadSamples[0].heap.runtimeUsedBytes);
  for (let cycle = 1; cycle <= ZK682_STABILITY_THRESHOLDS["save-load-resource-stability"].minimumSaveLoads; cycle += 1) {
    await loadQuickSave(page);
    saveLoadSamples.push({ cycle, slotId: "quick-save", loaded: true, courseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash), state: await canonicalState(page), ...await measure(page, cdp) });
    await recordHeapDiagnostic?.(cdp, cycle, saveLoadSamples.at(-1)!, saveLoadSamples[0].heap.runtimeUsedBytes);
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
  await writeFile(resolve(outputDirectory, "save-load-resource-stability.json"), `${JSON.stringify(saveLoadReport, null, 2)}\n`);

  // Run the actual mutable live simulation for at least two in-game hours.
  await page.keyboard.press("Digit3");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().speed)).toBe("4x");
  const startMinute = await page.evaluate(() => window.__coursecraftTest!.state().dayMinute);
  const longSessionSamples = [{ elapsedGameMinutes: 0, courseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash), state: { ...(await page.evaluate(() => { const state = window.__coursecraftTest!.state(); return { dayMinute: state.dayMinute, speed: state.speed, onCourse: state.golferPositions.length }; })) }, ...await measure(page, cdp) }];
  while (longSessionSamples.length < ZK682_STABILITY_THRESHOLDS["long-session-resource-stability"].minimumSamples
    || (longSessionSamples.at(-1)?.elapsedGameMinutes ?? 0) < ZK682_STABILITY_THRESHOLDS["long-session-resource-stability"].minimumSessionMinutes) {
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
  await writeFile(resolve(outputDirectory, "long-session-resource-stability.json"), `${JSON.stringify(longSessionReport, null, 2)}\n`);

  // Save a recovery point, then exercise editing, diagnostic overlay,
  // Chromium frozen/active lifecycle, and production load recovery.
  await pauseSimulation(page);
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

  const beforeOverlay = await page.evaluate(() => {
    const review = JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview;
    return { panelOpen: review?.panelOpen === true, kind: review?.overlay?.kind ?? null };
  });
  await page.getByTestId("open-architecture-review").click();
  await expect(page.getByTestId("architecture-review")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("architecture-overlay-recovery").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.kind)).toBe("recovery");
  interactionSamples.push({ scenario: "overlay", passed: true, before: beforeOverlay, after: { kind: "recovery", visible: await page.getByTestId("architecture-review").isVisible() }, ...await measure(page, cdp) });
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
  interactionSamples.push({ scenario: "recovery", passed: true, before: { savedCourseHash: recoveryPoint.courseHash, mutatedCourseHash: afterEdit.courseHash }, after: { courseHash: recovered.courseHash, quickSaveLoaded: true }, ...await measure(page, cdp) });
  const interactionReport = createZk682StabilityReport({
    gate: "editing-overlay-sleep-recovery",
    candidateCommit: expectedCommit!,
    capturedAt: new Date().toISOString(),
    command: "npm run test:stability",
    browser: { name: browserName, version: page.context().browser()?.version() ?? "unknown", cdpHeap: true },
    thresholds: ZK682_STABILITY_THRESHOLDS["editing-overlay-sleep-recovery"],
    samples: interactionSamples,
  });
  await writeFile(resolve(outputDirectory, "editing-overlay-sleep-recovery.json"), `${JSON.stringify(interactionReport, null, 2)}\n`);

  const timingCleanupPath = testInfo.outputPath("react-component-timing-cleanup.json");
  await writeFile(timingCleanupPath, `${JSON.stringify({
    candidateCommit: expectedCommit,
    command: "npm run test:stability",
    browser: { name: browserName, version: page.context().browser()?.version() ?? "unknown" },
    filter: "detail.devtools.track === Components ⚛; all entries of each name must match",
    samples: timingCleanupSamples,
  }, null, 2)}\n`);

  await testInfo.attach("react-component-timing-cleanup", { path: timingCleanupPath, contentType: "application/json" });
  console.log(JSON.stringify({
    diagnostic: "react-component-timing-cleanup",
    candidateCommit: expectedCommit,
    samples: timingCleanupSamples.length,
    clearedEntries: timingCleanupSamples.reduce((total, sample) => total + sample.clearedEntries, 0),
    preservedCollisionNames: timingCleanupSamples.reduce((total, sample) => total + sample.preservedCollisionNames, 0),
    remainingMeasureEntries: timingCleanupSamples.at(-1)?.measureEntriesAfter ?? 0,
  }));

  const finalScreenshot = resolve(outputDirectory, "zk682-stability-final.png");
  await page.screenshot({ path: finalScreenshot, fullPage: true });
  await testInfo.attach("zk682-stability-final", { path: finalScreenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
  expect({
    saveLoad: saveLoadReport.errors,
    longSession: longSessionReport.errors,
    interactions: interactionReport.errors,
  }, "all supplemental reports are retained even when one gate fails").toEqual({
    saveLoad: [],
    longSession: [],
    interactions: [],
  });
});
