import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(
  process.env.ZK1201_EVIDENCE_DIR ?? "/private/tmp/zk1201-depth-relief-evidence",
);
const commit = process.env.ZK1201_COMMIT ?? "working-tree";

test("ZK-1201 keeps bunker, shoreline, and landform depth readable through four rotations", async ({ page }) => {
  test.setTimeout(240_000);
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
        const file = resolve(outputRoot, `zk1201-r${rotation}-${hazard.label}-${view.label}.png`);
        await writeFile(file, await canvas.screenshot());
        captures.push({
          rotation,
          hazard: hazard.label,
          scale: view.label,
          zoom: view.zoom,
          focus: hazard.focus,
          file,
        });
      }
    }
  }

  const finalHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  expect(finalHash).toBe(initialHash);
  expect(errors).toEqual([]);
  expect(captures).toHaveLength(16);
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
    consoleAndPageErrors: errors,
  }, null, 2)}\n`);
});
