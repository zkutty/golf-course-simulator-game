import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(process.env.M35_LANDFORM_EVIDENCE_DIR ?? "../m35-landform-evidence");
const commit = process.env.M35_LANDFORM_COMMIT ?? "unknown";

test("captures ZK-1207 broad landform geometry through four rotations", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(outputRoot, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m35LandformFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  await page.evaluate(() => {
    window.__coursecraftTest!.setGraphicsQualityFixture("medium");
    window.__coursecraftPixiTest!.focusTileForTest(14, 11, 1);
  });

  const captures: Array<{ rotation: number; file: string; camera: unknown; landformDepth: unknown }> = [];
  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).toBe(rotation);
    await expect.poll(() => page.evaluate(() => {
      const camera = window.__coursecraftPixiTest!.rendererAtlasState().camera;
      return Math.abs(camera.zoom - 1) < 0.001 && Math.abs(camera.targetZoom - 1) < 0.001;
    })).toBe(true);
    const landformDepth = await page.evaluate(() => (
      window.__coursecraftPixiTest!.rendererAtlasState().landformDepth
    ));
    expect(landformDepth.active).toBe(true);
    expect(landformDepth.macro.active).toBe(true);
    expect(landformDepth.macro.maximumGrade).toBeGreaterThan(0.2);
    expect(landformDepth.macro.maximumShadowAlpha).toBeGreaterThanOrEqual(20);
    expect(landformDepth.shoulderLevels).toEqual([0.5, 1.5]);
    expect(landformDepth.shoulderFaces).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const file = resolve(outputRoot, `zk1207-r${rotation}-normal.png`);
    await writeFile(file, await page.screenshot({ fullPage: true }));
    captures.push({
      rotation,
      file,
      camera: await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().camera),
      landformDepth,
    });
  }
  await writeFile(resolve(outputRoot, "zk1207-landform-report.json"), `${JSON.stringify({
    version: 1,
    issue: "ZK-1207",
    commit,
    fixture: "m35LandformFixture",
    focus: { x: 14, y: 11 },
    zoom: 1,
    viewport: { width: 1440, height: 900 },
    captures,
  }, null, 2)}\n`);
});
