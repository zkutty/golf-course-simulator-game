import { expect, test } from "@playwright/test";

test("painting water automatically commits a flat excavated basin", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 90_000,
  }).toBe("game");
  await page.evaluate(() => window.__coursecraftTest?.setPaintCash(1_000_000));

  await page.getByTestId("terrain-tool-spline").click();
  await page.getByTestId("terrain-width-9").click();
  await page.locator("button").filter({ hasText: /^water$/i }).last().click();

  const before = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const beforeVersion = await page.evaluate(() => window.__coursecraftTest!.state().terrainVersion);
  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const point = (x: number, y: number) => ({
    x: box.x + box.width * x,
    y: box.y + box.height * y,
  });
  const knots = [
    point(0.40, 0.38),
    point(0.51, 0.31),
    point(0.62, 0.40),
  ];
  for (const knot of knots) await page.mouse.click(knot.x, knot.y);

  const preview = page.getByTestId("terrain-stroke-preview");
  await expect(preview).toContainText("Automatic basin");
  await expect(preview).toContainText("earthwork steps");
  await page.keyboard.press("Enter");

  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.length
  ))).toBe(before.features.length + 1);
  const after = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const feature = after.features.at(-1);
  expect(feature?.terrain).toBe("water");
  expect(feature?.coverage.length).toBeGreaterThan(0);
  if (!feature) return;
  const wetCoverage = new Set(feature.coverage);
  expect(after.obstacles.every((obstacle) => (
    !wetCoverage.has(obstacle.y * after.width + obstacle.x)
  ))).toBe(true);

  const component = new Set<number>();
  const queue = [feature.coverage[0]];
  while (queue.length > 0) {
    const index = queue.shift()!;
    if (component.has(index) || after.tiles[index] !== "water") continue;
    component.add(index);
    const x = index % after.width;
    const y = Math.floor(index / after.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= after.width || ny >= after.height) continue;
      queue.push(ny * after.width + nx);
    }
  }
  const waterLevels = new Set([...component].map((index) => after.elevations[index]));
  expect(waterLevels.size).toBe(1);
  const waterLevel = [...waterLevels][0];
  const boundaryLevels: number[] = [];
  for (const index of component) {
    const x = index % after.width;
    const y = Math.floor(index / after.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= after.width || ny >= after.height) continue;
      const neighbor = ny * after.width + nx;
      if (!component.has(neighbor)) boundaryLevels.push(after.elevations[neighbor]);
    }
  }
  expect(boundaryLevels.length).toBeGreaterThan(0);
  expect(waterLevel).toBeLessThanOrEqual(Math.max(0, Math.min(...boundaryLevels) - 1));
  expect(feature.coverage.some((index) => after.elevations[index] < before.elevations[index])).toBe(true);
  expect(await page.evaluate(() => window.__coursecraftTest!.state().terrainVersion)).toBe(beforeVersion + 1);

  const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";
  const redo = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
  await page.keyboard.press(undo);
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.length
  ))).toBe(before.features.length);
  expect((await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).elevations)
    .toEqual(before.elevations);
  expect((await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).obstacles)
    .toEqual(before.obstacles);
  await page.keyboard.press(redo);
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features.length
  ))).toBe(after.features.length);
  expect((await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).elevations)
    .toEqual(after.elevations);
  expect((await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).obstacles)
    .toEqual(after.obstacles);

  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().paused)).toBe(true);
  await page.getByRole("button", { name: /load game/i }).click();
  await expect(page.getByTestId("save-slot-quick-save")).toContainText("Quick Save");
  await page.getByTestId("save-slot-quick-save")
    .getByRole("button", { name: "Load", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().screenBase))
    .toBe("in-game");
  expect((await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).elevations)
    .toEqual(after.elevations);
  expect((await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState())).obstacles)
    .toEqual(after.obstacles);

  const shot = await page.screenshot({
    path: "artifacts/m35-water-basin.png",
    fullPage: true,
  });
  await testInfo.attach("m35-water-basin", { body: shot, contentType: "image/png" });
  await page.mouse.move(knots[1].x, knots[1].y);
  await page.mouse.wheel(0, -1400);
  await page.waitForTimeout(700);
  const closeShot = await page.screenshot({
    path: "artifacts/m35-water-bank-close.png",
    fullPage: true,
  });
  await testInfo.attach("m35-water-bank-close", { body: closeShot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
