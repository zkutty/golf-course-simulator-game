import { expect, test } from "@playwright/test";
import path from "node:path";
import { buildPreviewAtlas } from "../scripts/pixellab-pilot.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PREVIEW_ATLAS = path.join(ROOT, "test-results/pixellab-preview-atlas");

test.beforeAll(() => {
  buildPreviewAtlas({
    candidate: path.join(ROOT, "artifacts/pixellab-pilot/high-res-cart-rental-192x160.png"),
    frame: "parkland_cart_rental_t1",
    output: PREVIEW_ATLAS,
  });
});

test("review-only candidate atlas renders in the real M22 parkland scene", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && /atlases|assets/.test(response.url())) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.route("**/atlases/buildings-decor.json", (route) => route.fulfill({
    path: path.join(PREVIEW_ATLAS, "buildings-decor.json"),
    contentType: "application/json",
  }));
  await page.route("**/atlases/buildings-decor.png", (route) => route.fulfill({
    path: path.join(PREVIEW_ATLAS, "buildings-decor.png"),
    contentType: "image/png",
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m22Fixture=1&m22Theme=parkland");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.theme), {
    timeout: 120_000,
  }).toBe("parkland");
  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(state.course.decorations).toHaveLength(11);
  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const shot = await canvas.screenshot({
    path: "artifacts/pixellab-pilot/high-res-cart-rental-live.png",
  });
  await testInfo.attach("high-resolution-alternative-live-render", {
    body: shot,
    contentType: "image/png",
  });

  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.keyboard.press("f");
  await page.mouse.move(
    bounds!.x + Math.min(bounds!.width - 1, 330),
    bounds!.y + Math.min(bounds!.height - 1, 390),
  );
  for (let step = 0; step < 3; step += 1) {
    await page.mouse.wheel(0, -900);
  }
  await page.waitForTimeout(500);
  const detailShot = await canvas.screenshot({
    path: "artifacts/pixellab-pilot/high-res-cart-rental-live-detail.png",
  });
  await testInfo.attach("high-resolution-alternative-live-detail", {
    body: detailShot,
    contentType: "image/png",
  });
  expect(detailShot.equals(shot)).toBe(false);

  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});
