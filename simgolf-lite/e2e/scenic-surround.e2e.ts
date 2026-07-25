import { expect, test } from "@playwright/test";

test("regional canvas keeps Links ocean and countryside continuous at overview and pan limits", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m25Fixture=1&m22Theme=links&m25Seed=25");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen)).toBe("game");
  const starter = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.estate.parcels.find((parcel: { id: string }) => parcel.id === "parcel-5"));
  expect(starter.traits).toContain("water");

  const canvas = page.locator(".cc-pixi-stage canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Course canvas has no bounds");
  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera);

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -900);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera.zoom)).toBeGreaterThan(before.zoom);
  const close = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera.zoom)).toBeLessThan(close.zoom);
  const overview = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera);
  expect(overview.regionalSurround).toBe(true);
  expect(overview.zoom).toBeGreaterThanOrEqual(0.15);
  await page.screenshot({ path: "artifacts/scenic-links-overview.png", fullPage: true });

  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1_400);
  await page.keyboard.up("KeyW");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera.center)).not.toEqual(before.center);
  const edge = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera);
  expect(edge.center.x).toBeGreaterThanOrEqual(-48);
  expect(edge.center.y).toBeGreaterThanOrEqual(-48);
  await page.screenshot({ path: "artifacts/scenic-links-edge.png", fullPage: true });
  expect(consoleErrors).toEqual([]);
});
