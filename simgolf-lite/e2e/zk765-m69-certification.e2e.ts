import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { M53_SEASONAL_TERRAIN_FIXTURES } from "../src/game/testing/m53SeasonalTerrainFixtures";

const TEE_SETS = ["forward", "member", "championship"] as const;
const PIN_ROTATIONS = ["A", "B", "C"] as const;

async function openReferenceReview(page: import("@playwright/test").Page) {
  await page.getByTestId("open-architecture-review").click();
  const review = page.getByTestId("architecture-review");
  await review.getByTestId("architecture-overlay-reference").click();
  await review.getByTestId("architecture-hole-filter").selectOption({ index: 1 });
  await expect(review.getByTestId("architecture-reference-plan")).toContainText(/full shots \+ 2 expected putts/, { timeout: 120_000 });
  return review;
}

test("ZK-765 every authored tee and pin setup is selectable in the browser review", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m23Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen), { timeout: 60_000 }).toBe("game");
  const review = await openReferenceReview(page);
  const reference = review.getByTestId("architecture-reference-plan");

  for (const teeSet of TEE_SETS) for (const pinRotation of PIN_ROTATIONS) {
    await review.getByTestId("architecture-tee-filter").selectOption(teeSet);
    await review.getByTestId("architecture-pin-filter").selectOption(pinRotation);
    await expect(reference).toContainText(`${teeSet} reference:`, { timeout: 120_000 });
    await expect(reference).toContainText(`pin ${pinRotation}`);
    await expect(reference).toContainText(/Effective route: [1-9][0-9]* yd/);
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.kind)).toBe("reference");
  }
  expect(errors).toEqual([]);
});

test("ZK-765 reference overlays remain populated across every biome and camera rotation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.status() >= 400 && /atlases\/biomes/.test(response.url())) failedAssets.push(`${response.status()} ${response.url()}`);
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  const allFixtures = M53_SEASONAL_TERRAIN_FIXTURES.filter((fixture) => fixture.season === "summer" && fixture.quality === "high");
  expect(allFixtures).toHaveLength(12);
  const visualBiome = process.env.ZK765_VISUAL_BIOME;
  const fixtures = process.env.ZK765_VISUAL_SLICE === "1"
    ? allFixtures.filter((fixture) => fixture.rotation === 0 && (!visualBiome || fixture.biome === visualBiome))
    : allFixtures;
  const pixelHashes = new Set<string>();

  for (const fixture of fixtures) {
    await page.goto(fixture.query);
    await expect.poll(async () => {
      const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
      return { screen: state.screen, theme: state.course?.theme, rotation: state.camera?.rotation };
    }, { timeout: 120_000 }).toEqual({ screen: "game", theme: fixture.biome, rotation: fixture.rotation * 90 });
    const review = await openReferenceReview(page);
    await expect.poll(() => page.evaluate(() => {
      const architecture = JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview;
      return { kind: architecture?.overlay?.kind, traces: architecture?.overlay?.traces, points: architecture?.overlay?.points };
    }), { timeout: 120_000 }).toMatchObject({ kind: "reference", traces: expect.any(Number), points: expect.any(Number) });
    const architecture = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview);
    expect(architecture.overlay.traces).toBeGreaterThan(0);

    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (fixture.biome === "parkland" && fixture.rotation === 0 && box) {
      for (let sample = 0; sample < 250; sample++) {
        await page.mouse.move(
          box.x + box.width * .25 + (sample * 37 % Math.max(1, Math.floor(box.width * .5))),
          box.y + box.height * .25 + (sample * 53 % Math.max(1, Math.floor(box.height * .5))),
        );
      }
      await expect(review.getByTestId("architecture-reference-plan")).toContainText(/full shots \+ 2 expected putts/);
    }
    const screenshotPath = testInfo.outputPath(`zk765-${fixture.biome}-rotation-${fixture.rotation}.png`);
    const shot = await canvas.screenshot({ path: screenshotPath });
    const png = PNG.sync.read(shot);
    let checksum = 0x811c9dc5;
    for (let offset = 0; offset < png.data.length; offset += 4) {
      checksum ^= png.data[offset] | (png.data[offset + 1] << 8) | (png.data[offset + 2] << 16);
      checksum = Math.imul(checksum, 0x01000193);
    }
    pixelHashes.add((checksum >>> 0).toString(16));
    await testInfo.attach(`zk765-${fixture.biome}-rotation-${fixture.rotation}`, { path: screenshotPath, contentType: "image/png" });
  }

  expect(pixelHashes.size).toBeGreaterThanOrEqual(process.env.ZK765_VISUAL_SLICE === "1" ? fixtures.length : 10);
  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});
