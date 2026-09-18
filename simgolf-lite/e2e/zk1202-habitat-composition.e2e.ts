import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(process.env.ZK1202_EVIDENCE_DIR ?? "../zk1202-habitat-evidence");
const commit = process.env.ZK1202_COMMIT ?? "unknown";
const baseUrl = process.env.ZK1202_BASE_URL ?? "";

type Capture = {
  file: string;
  rotation: 0 | 180;
  zoom: number;
  quality: "high" | "medium";
  focus: { x: number; y: number };
  courseHash: string;
  renderer: unknown;
};

async function capture(
  page: import("@playwright/test").Page,
  input: Omit<Capture, "file" | "courseHash" | "renderer"> & { label: string },
): Promise<Capture> {
  await page.evaluate(({ quality, zoom, focus }) => {
    window.__coursecraftTest!.setGraphicsQualityFixture(quality);
    window.__coursecraftPixiTest!.focusTileForTest(focus.x, focus.y, zoom);
  }, input);
  await expect.poll(() => page.evaluate(({ quality, zoom }) => {
    const state = window.__coursecraftPixiTest!.rendererAtlasState();
    return state.requested.quality === quality
      && Math.abs(state.camera.zoom - zoom) < 0.001
      && Math.abs(state.camera.targetZoom - zoom) < 0.001;
  }, input)).toBe(true);
  await page.waitForTimeout(600);
  const file = resolve(outputRoot, `${input.label}.png`);
  await writeFile(file, await page.screenshot({ fullPage: true }));
  return {
    file,
    rotation: input.rotation,
    zoom: input.zoom,
    quality: input.quality,
    focus: input.focus,
    courseHash: await page.evaluate(() => window.__coursecraftTest!.state().courseHash),
    renderer: await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState()),
  };
}

test("ZK-1202 captures deterministic Parkland habitat at normal and detail scale", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(outputRoot, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/?zk1202HabitatFixture=1`);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));

  const captures: Capture[] = [];
  captures.push(await capture(page, {
    label: "zk1202-normal-r0",
    rotation: 0,
    zoom: 1,
    quality: "medium",
    focus: { x: 25, y: 18 },
  }));
  captures.push(await capture(page, {
    label: "zk1202-detail-r0",
    rotation: 0,
    zoom: 2,
    quality: "high",
    focus: { x: 28, y: 5 },
  }));

  await page.keyboard.press("e");
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
  ))).toBe(90);
  await page.keyboard.press("e");
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
  ))).toBe(180);
  captures.push(await capture(page, {
    label: "zk1202-normal-r180",
    rotation: 180,
    zoom: 1,
    quality: "medium",
    focus: { x: 25, y: 18 },
  }));

  expect(new Set(captures.map((item) => item.courseHash)).size).toBe(1);
  await writeFile(resolve(outputRoot, "zk1202-habitat-report.json"), `${JSON.stringify({
    version: 1,
    issue: "ZK-1202",
    commit,
    fixture: "zk1202HabitatFixture",
    viewport: { width: 1440, height: 900 },
    command: "ZK1202_EVIDENCE_DIR=<dir> ZK1202_COMMIT=<sha> npx playwright test e2e/zk1202-habitat-composition.e2e.ts --workers=1 --retries=0",
    captures,
  }, null, 2)}\n`);
});
