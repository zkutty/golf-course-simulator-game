import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const outputRoot = resolve(
  process.env.ZK1200_EVIDENCE_DIR ?? "/private/tmp/zk1200-shared-contour-evidence",
);

test("ZK-1200 keeps medium/1x terrain contours continuous through four rotations", async ({ page }) => {
  test.setTimeout(180_000);
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
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const initialHash = await page.evaluate(() => window.__coursecraftTest!.state().courseHash);
  const captures: Array<{ rotation: number; file: string; crop: string }> = [];

  for (let turn = 0; turn < 4; turn++) {
    const rotation = turn * 90;
    if (turn > 0) await page.keyboard.press("e");
    await page.evaluate(() => {
      window.__coursecraftTest!.setGraphicsQualityFixture("medium");
      window.__coursecraftPixiTest!.focusTileForTest(24, 18, 1);
    });
    await expect.poll(() => page.evaluate(() => {
      const state = window.__coursecraftPixiTest!.rendererAtlasState() as unknown as {
        pathMaterialCrossSection: { quality: string; camera: { rotation: number; zoom: number } };
      };
      return {
        quality: state.pathMaterialCrossSection.quality,
        rotation: state.pathMaterialCrossSection.camera.rotation,
        zoom: state.pathMaterialCrossSection.camera.zoom,
      };
    })).toEqual({ quality: "medium", rotation, zoom: 1 });

    const body = await canvas.screenshot();
    const image = PNG.sync.read(body);
    const cropWidth = Math.min(720, image.width);
    const cropHeight = Math.min(480, image.height);
    const cropped = new PNG({ width: cropWidth, height: cropHeight });
    PNG.bitblt(
      image,
      cropped,
      Math.floor((image.width - cropWidth) / 2),
      Math.floor((image.height - cropHeight) / 2),
      cropWidth,
      cropHeight,
      0,
      0,
    );
    const file = resolve(outputRoot, `zk1200-medium-1x-r${rotation}.png`);
    const crop = resolve(outputRoot, `zk1200-medium-1x-r${rotation}-crop.png`);
    await writeFile(file, body);
    await writeFile(crop, PNG.sync.write(cropped));
    captures.push({ rotation, file, crop });
  }

  expect(await page.evaluate(() => window.__coursecraftTest!.state().courseHash)).toBe(initialHash);
  expect(errors).toEqual([]);
  await writeFile(
    resolve(outputRoot, "zk1200-capture-report.json"),
    `${JSON.stringify({ version: 1, quality: "medium", zoom: 1, courseHash: initialHash, captures }, null, 2)}\n`,
  );
});
