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
  const minimapShell = page.locator(".cc-minimap");
  await expect(minimapShell).toHaveAttribute("data-render-state", "ready");
  await expect(minimapShell).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(() => minimap.evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("2d");
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return 0;
    let nonBackground = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 38 || pixels[index + 1] !== 55 || pixels[index + 2] !== 47) nonBackground += 1;
    }
    return nonBackground;
  })).toBeGreaterThan(1_000);
  await expect(page.getByLabel("View bearing 0 degrees")).toBeVisible();
  const headerLayout = await page.locator('[data-biome-context="course-header"] > div').first().evaluate((row) => {
    const [identity, controls] = [...row.children] as HTMLElement[];
    const a = identity.getBoundingClientRect();
    const b = controls.getBoundingClientRect();
    return {
      overlaps: a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y,
      withinHeader: b.right <= row.parentElement!.getBoundingClientRect().right
        && b.bottom <= row.parentElement!.getBoundingClientRect().bottom,
    };
  });
  expect(headerLayout).toEqual({ overlaps: false, withinHeader: true });
  const statusPanel = page.locator('[data-biome-context="course-header"]');
  await expect(statusPanel).toHaveCSS("background-image", "none");
  await expect(statusPanel).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("design-dock")).toHaveCSS("background-image", "none");
  await expect(page.locator(".cc-sidebar-frame .cc-hud")).toHaveCSS("background-image", "none");
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
