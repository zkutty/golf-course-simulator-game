import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(
  process.env.ZK1201_EVIDENCE_DIR ?? "/private/tmp/zk1201-depth-relief-evidence",
);
const commit = process.env.ZK1201_COMMIT ?? "working-tree";

test("ZK-1201 keeps bunker, shoreline, and landform depth readable through four rotations", async ({ page }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir(outputRoot, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5,
      tutorialOffered: true,
      tutorialCompleted: true,
      accessibility: { reducedMotion: true },
    }));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m35LandformFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const initialHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  const captures: Array<{
    rotation: number;
    hazard: string;
    scale: string;
    zoom: number;
    focus: { x: number; y: number };
    depth: unknown;
    file: string;
  }> = [];

  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).toBe(rotation);
    for (const hazard of [
      { label: "lake", focus: { x: 8, y: 16 } },
      { label: "bunker", focus: { x: 21, y: 7 } },
    ]) {
      for (const view of [
        { label: "normal", zoom: 1 },
        { label: "2x", zoom: 2 },
      ]) {
        await page.evaluate(({ focus, zoom }) => {
          window.__coursecraftTest!.setGraphicsQualityFixture("high");
          window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom);
        }, { focus: hazard.focus, zoom: view.zoom });
        await expect.poll(() => page.evaluate(() => {
          const camera = window.__coursecraftPixiTest!.rendererAtlasState().camera;
          return {
            zoom: Number(camera.zoom.toFixed(3)),
            targetZoom: Number(camera.targetZoom.toFixed(3)),
          };
        }), { timeout: 30_000 }).toEqual({
          zoom: view.zoom,
          targetZoom: view.zoom,
        });
        await page.waitForTimeout(180);
        const depth = await page.evaluate(({ terrain }) => {
          const diagnostics = window.__coursecraftPixiTest!.rendererAtlasState().landformDepth;
          return {
            macro: diagnostics.macro,
            hazards: diagnostics.hazards.filter((entry) => entry.terrain === terrain),
          };
        }, { terrain: hazard.label === "lake" ? "water" as const : "sand" as const });
        expect(depth.macro.active).toBe(true);
        expect(depth.hazards.length).toBeGreaterThan(0);
        expect(depth.hazards.every((entry) => entry.nearFaces > 0 && entry.farFaces > 0)).toBe(true);
        // Actual joined surface separation, not the old forced bank-only drop.
        expect(Math.min(...depth.hazards.map((entry) => entry.minimumDropPx)))
          .toBeGreaterThanOrEqual(hazard.label === "lake" ? 6 : 2);
        expect(depth.hazards.every((entry) => entry.floorBoundaryOwner === "shared" && entry.interiorFaceAreaPx > 50)).toBe(true);
        const file = resolve(outputRoot, `zk1201-r${rotation}-${hazard.label}-${view.label}.png`);
        await writeFile(file, await canvas.screenshot());
        captures.push({
          rotation,
          hazard: hazard.label,
          scale: view.label,
          zoom: view.zoom,
          focus: hazard.focus,
          depth,
          file,
        });
      }
    }
  }

  const finalHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  expect(initialHash).toBe("05b74d13");
  expect(finalHash).toBe(initialHash);
  expect(errors).toEqual([]);
  expect(captures).toHaveLength(16);

  // The M35 fixture proves the dedicated relief scene, while the immutable
  // M19 authority course catches a bank that only appears joined in that
  // smaller fixture. These are detail crops only: they do not replace ZK-473's
  // full raw matrix.
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await expect(canvas).toBeVisible();
  const m19InitialHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  const m19Captures: Array<{
    rotation: number;
    hazard: "lake" | "bunker" | "green";
    zoom: number;
    focus: { x: number; y: number };
    depth: unknown;
    file: string;
  }> = [];
  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).toBe(rotation);
    for (const hazard of [
      { label: "lake" as const, focus: { x: 24, y: 26 } },
      { label: "bunker" as const, focus: { x: 32, y: 15 } },
      { label: "green" as const, focus: { x: 39, y: 20 } },
    ]) {
      await page.evaluate(({ focus }) => {
        window.__coursecraftTest!.setGraphicsQualityFixture("high");
        window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, 2);
      }, hazard);
      await expect.poll(() => page.evaluate(() => {
        const camera = window.__coursecraftPixiTest!.rendererAtlasState().camera;
        return Number(camera.zoom.toFixed(3)) === 2 && Number(camera.targetZoom.toFixed(3)) === 2;
      }), { timeout: 30_000 }).toBe(true);
      await page.waitForTimeout(180);
      const depth = await page.evaluate(({ terrain }) => {
        const diagnostics = window.__coursecraftPixiTest!.rendererAtlasState().landformDepth;
        return diagnostics.hazards.filter((entry) => entry.terrain === terrain);
      }, { terrain: hazard.label === "lake" ? "water" as const : hazard.label === "bunker" ? "sand" as const : "sand" as const });
      if (hazard.label !== "green") {
        expect(depth.length).toBeGreaterThan(0);
        expect(depth.every((entry) => entry.nearFaces > 0 && entry.farFaces > 0)).toBe(true);
        expect(Math.min(...depth.map((entry) => entry.minimumDropPx)))
          .toBeGreaterThanOrEqual(hazard.label === "lake" ? 6 : 2);
        expect(depth.every((entry) => entry.floorBoundaryOwner === "shared" && entry.interiorFaceAreaPx > 50)).toBe(true);
      }
      const file = resolve(outputRoot, `zk1201-m19-r${rotation}-${hazard.label}-detail.png`);
      await writeFile(file, await canvas.screenshot());
      m19Captures.push({ rotation, hazard: hazard.label, zoom: 2, focus: hazard.focus, depth, file });
    }
  }
  const m19FinalHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  expect(m19InitialHash).toBe("3cf67481");
  expect(m19FinalHash).toBe(m19InitialHash);
  expect(m19Captures).toHaveLength(12);
  expect(new Set(m19Captures.map((capture) => `${capture.rotation}:${capture.hazard}`)).size).toBe(12);
  expect(errors).toEqual([]);
  await writeFile(resolve(outputRoot, "zk1201-depth-relief-report.json"), `${JSON.stringify({
    version: 1,
    issue: "ZK-1201",
    commit,
    fixture: "m35LandformFixture",
    viewport: { width: 1440, height: 900 },
    quality: "high",
    command: "ZK1201_EVIDENCE_DIR=<dir> ZK1201_COMMIT=<sha> npx playwright test e2e/zk1201-depth-relief.e2e.ts --workers=1 --retries=0",
    initialHash,
    finalHash,
    captures,
    m19Authority: {
      fixture: "m19Fixture",
      initialHash: m19InitialHash,
      finalHash: m19FinalHash,
      captures: m19Captures,
    },
    consoleAndPageErrors: errors,
  }, null, 2)}\n`);
});
