import { expect, test } from "@playwright/test";

test("M12 iso minimap, tycoon chrome, and sole-renderer fixture", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?perfFixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen), { timeout: 15_000 }).toBe("game");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").simulation?.onCourse), { timeout: 15_000 }).toBe(100);

  const minimap = page.getByLabel("Isometric course minimap");
  await expect(minimap).toBeVisible();
  await expect(page.getByLabel("View bearing 0 degrees")).toBeVisible();
  const controls = page.locator(".cc-live-controls");
  const miniBox = await minimap.boundingBox();
  const controlsBox = await controls.boundingBox();
  expect(miniBox && controlsBox && miniBox.y + miniBox.height <= controlsBox.y + 2).toBe(true);

  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera.center);
  await minimap.click({ position: { x: 42, y: 170 } });
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera.center)).not.toEqual(before);
  await page.screenshot({ path: "/tmp/coursecraft-m12-1280.png", fullPage: true });

  await page.getByRole("button", { name: "Architect" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByLabel("Isometric preview of hole 1")).toBeVisible();
  await page.screenshot({ path: "/tmp/coursecraft-m12-hole.png", fullPage: true });

  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Graphics" }).click();
  await expect(page.getByText("Renderer", { exact: true })).toHaveCount(0);
  await expect(page.locator(".cc-options-panel")).toBeVisible();
  await page.screenshot({ path: "/tmp/coursecraft-m12-options.png", fullPage: true });
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Resume" }).click();

  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect(minimap).toBeVisible();
  await page.screenshot({ path: "/tmp/coursecraft-m12-2560.png", fullPage: true });
  expect(consoleErrors).toEqual([]);
});
