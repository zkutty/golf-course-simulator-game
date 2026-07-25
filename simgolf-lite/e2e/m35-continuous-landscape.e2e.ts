import { expect, test } from "@playwright/test";

test("M35 curved terrain authoring persists connected material intent", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen), {
    timeout: 120_000,
    message: "render hook did not reach game",
  }).toBe("game");

  await expect(page.getByRole("button", { name: "Curve", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Brush width").fill("5");
  await page.locator("button").filter({ hasText: /^water$/ }).last().click();

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width * 0.34, box.y + box.height * 0.42);
  await page.mouse.down();
  for (const [x, y] of [
    [0.40, 0.36],
    [0.48, 0.38],
    [0.55, 0.48],
    [0.62, 0.55],
    [0.70, 0.50],
  ]) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 2 });
  }
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.smoothSurfaceFeatures ?? 0
  ))).toBeGreaterThan(0);

  const shot = await page.screenshot({ path: "artifacts/m35-curved-terrain.png", fullPage: true });
  await testInfo.attach("m35-curved-terrain", { body: shot, contentType: "image/png" });

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.smoothSurfaceFeatures ?? 0
  ))).toBe(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.smoothSurfaceFeatures ?? 0
  ))).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
