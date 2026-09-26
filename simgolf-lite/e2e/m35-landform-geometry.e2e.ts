import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(process.env.M35_LANDFORM_EVIDENCE_DIR ?? "../m35-landform-evidence");
const commit = process.env.M35_LANDFORM_COMMIT ?? "unknown";

test("captures ZK-1207 material relief at actual normal scale through four rotations and both tiers", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await mkdir(outputRoot, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m35LandformFixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 90_000 }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  const initialHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  // Real Operate/Cozy transition owns the camera. No forced numerical zoom.
  await page.evaluate(() => window.__coursecraftTest!.enterNormalGameplayForTest());
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.viewMode)).toBe("COZY");
  const achievements = page.getByTestId("achievement-toast");
  for (let i = 0; i < 12 && await achievements.count(); i++) {
    await achievements.first().click({ timeout: 1_000 }).catch(() => undefined);
  }
  await expect(achievements).toHaveCount(0);
  await page.mouse.move(2, 2);

  const captures: unknown[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).toBe(rotation);
    for (const quality of ["medium", "high"] as const) {
    await page.evaluate((quality) => window.__coursecraftTest!.setGraphicsQualityFixture(quality), quality);
    await expect.poll(() => page.evaluate((quality) => {
      const state = window.__coursecraftPixiTest!.rendererAtlasState();
      const frame = window.__coursecraftPixiTest!.normalFrame();
      const transform = window.__coursecraftPixiTest!.cameraTransform();
      return state.rendered.quality === quality && state.activation.pending === null &&
        frame?.source === "active-hole" && transform != null &&
        Math.abs(state.camera.zoom - frame.zoom) < .001 &&
        Math.abs(state.camera.targetZoom - frame.zoom) < .001 &&
        Math.abs(transform.world.scale.x - frame.zoom) < .001;
    }, quality), { timeout: 30_000 }).toBe(true);
    const landformDepth = await page.evaluate(() => (
      window.__coursecraftPixiTest!.rendererAtlasState().landformDepth
    ));
    expect(landformDepth.active).toBe(true);
    expect(landformDepth.macro.active).toBe(true);
    expect(landformDepth.macro.maximumGrade).toBeGreaterThan(0.2);
    expect(landformDepth.macro.maximumShadowAlpha).toBeGreaterThanOrEqual(20);
    expect(landformDepth.shoulderFaces).toBe(0);
    expect(landformDepth.topSurfaceCrests).toBe(0);
    expect(landformDepth.surfaceForm.mode).toBe("material-field");
    expect(landformDepth.surfaceForm.samples).toBeGreaterThan(100);
    expect(landformDepth.surfaceForm.levels).toEqual([0.5, 1.5]);
    expect(landformDepth.waterSurfaceOwners.chunkSprites).toBe(0);
    expect(landformDepth.waterSurfaceOwners.chunkFoam).toBe(0);
    expect(landformDepth.waterSurfaceOwners.joinedMeshes).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    const file = resolve(outputRoot, `zk1207-r${rotation}-${quality}-normal.png`);
    await writeFile(file, await page.screenshot({ fullPage: true }));
    captures.push({
      rotation,
      quality,
      file,
      camera: await page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().camera),
      landformDepth,
      normalFrame: await page.evaluate(() => window.__coursecraftPixiTest!.normalFrame()),
      cameraTransform: await page.evaluate(() => window.__coursecraftPixiTest!.cameraTransform()),
    });
    }
  }
  const finalHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  expect(finalHash).toBe(initialHash);
  expect(captures).toHaveLength(8);
  expect(errors).toEqual([]);
  await writeFile(resolve(outputRoot, "zk1207-landform-report.json"), `${JSON.stringify({
    version: 2,
    issue: "ZK-1207",
    commit,
    fixture: "m35LandformFixture",
    cameraOwner: "actual Operate/Cozy active-hole fit",
    initialHash,
    finalHash,
    errors,
    viewport: { width: 1440, height: 900 },
    captures,
  }, null, 2)}\n`);
});
