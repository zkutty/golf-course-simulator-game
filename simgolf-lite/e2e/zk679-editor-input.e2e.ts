import { expect, test, type Locator, type Page } from "@playwright/test";

const viewports = [
  { width: 1440, height: 900 },
  { width: 800, height: 500 },
] as const;

type Point = { x: number; y: number };

async function projectTile(page: Page, canvas: Locator, point: Point) {
  const projected = await page.evaluate((target) => ({
    point: window.__coursecraftPixiTest!.tileToScreen(target.x, target.y),
    viewport: window.__coursecraftPixiTest!.viewport(),
  }), point);
  const bounds = await canvas.boundingBox();
  if (!bounds || !projected.point || !projected.viewport) throw new Error("Course projection unavailable");
  const client = {
    x: bounds.x + projected.point.x * bounds.width / projected.viewport.width,
    y: bounds.y + projected.point.y * bounds.height / projected.viewport.height,
  };
  expect(client.x).toBeGreaterThan(bounds.x);
  expect(client.x).toBeLessThan(bounds.x + bounds.width);
  expect(client.y).toBeGreaterThan(bounds.y);
  expect(client.y).toBeLessThan(bounds.y + bounds.height);
  return client;
}

async function _safeTilePoint(page: Page, canvas: Locator, terrain: "fairway" | "green") {
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Canvas has no bounds");
  const point = await page.evaluate(({ bounds, terrain }) => {
    const api = window.__coursecraftPixiTest!;
    const course = window.__coursecraftTest!.terrainSurfaceState();
    const viewport = api.viewport()!;
    for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
      const index = y * course.width + x;
      if (course.tiles[index] !== terrain || !course.owned[index]) continue;
      const projected = api.tileToScreen(x, y);
      if (!projected) continue;
      const selected = api.screenToTile(projected.x, projected.y);
      if (selected?.x !== x || selected.y !== y) continue;
      const client = {
        x: bounds.x + projected.x * bounds.width / viewport.width,
        y: bounds.y + projected.y * bounds.height / viewport.height,
      };
      if (client.x <= bounds.x + 12 || client.x >= bounds.x + bounds.width - 12
        || client.y <= bounds.y + 12 || client.y >= bounds.y + bounds.height - 12) continue;
      if (document.elementFromPoint(client.x, client.y) === document.querySelector(".cc-pixi-stage canvas")) return client;
    }
    return null;
  }, { bounds, terrain });
  if (!point) throw new Error(`No unobscured ${terrain} tile is available`);
  expect(point.x).toBeGreaterThan(bounds.x);
  expect(point.x).toBeLessThan(bounds.x + bounds.width);
  expect(point.y).toBeGreaterThan(bounds.y);
  expect(point.y).toBeLessThan(bounds.y + bounds.height);
  return point;
}

for (const viewport of viewports) {
  test(`ZK-679 editor input at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.goto("/?perfFixture=1");
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    const collapseMinimap = page.getByRole("button", { name: "Collapse course minimap" });
    if (await collapseMinimap.isVisible()) await collapseMinimap.click();
    const placement = await page.evaluate(() => window.__coursecraftTest!.setZk470PlacementFixture("terrain-stroke"));
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor))
      .toMatchObject({ mode: "PAINT", terrainTool: "curve", selectedTerrain: "rough" });
    await page.evaluate(({ point }) => window.__coursecraftPixiTest!.focusTileForTest(point.x, point.y, 1.15), placement);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const paintPoint = await projectTile(page, canvas, placement.point);

    const beforePaint = await page.evaluate(() => window.__coursecraftTest!.state());
    await page.mouse.move(paintPoint.x, paintPoint.y);
    await page.mouse.down();
    await page.mouse.move(paintPoint.x + 20, paintPoint.y + 8, { steps: 4 });
    await expect(page.getByTestId("terrain-stroke-preview")).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().terrainVersion))
      .toBe(beforePaint.terrainVersion + 1);

    const cancelPlacement = await page.evaluate(() => window.__coursecraftTest!.setZk470PlacementFixture("terrain-stroke"));
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.mode)).toBe("PAINT");
    await page.evaluate(({ point }) => window.__coursecraftPixiTest!.focusTileForTest(point.x, point.y, 1.15), cancelPlacement);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const paintCancelPoint = await projectTile(page, canvas, cancelPlacement.point);
    const beforePaintCancel = (await page.evaluate(() => window.__coursecraftTest!.state())).terrainVersion;
    await page.mouse.move(paintCancelPoint.x, paintCancelPoint.y);
    await page.mouse.down();
    await page.mouse.move(paintCancelPoint.x + 3, paintCancelPoint.y + 2, { steps: 2 });
    await expect(page.getByTestId("terrain-stroke-preview")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await page.evaluate(() => window.__coursecraftTest!.state())).terrainVersion).toBe(beforePaintCancel);
    await expect(page.getByTestId("pause-overlay")).toHaveCount(0);

    await page.getByRole("button", { name: "Sculpt", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.mode)).toBe("SCULPT");
    await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(38, 20, 1.15));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    let greenPoint = await projectTile(page, canvas, { x: 38, y: 20 });
    const beforeSculpt = await page.evaluate(() => window.__coursecraftTest!.state());

    await page.mouse.move(greenPoint.x, greenPoint.y);
    await page.mouse.down();
    await page.mouse.move(greenPoint.x + 3, greenPoint.y + 2, { steps: 2 });
    await expect(page.getByTestId("fine-green-stroke-preview")).toBeVisible();
    await page.mouse.up();

    await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().terrainVersion))
      .toBe(beforeSculpt.terrainVersion + 1);
    await page.evaluate(() => window.__coursecraftTest!.setZk470PlacementFixture("terrain-stroke"));
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.mode)).toBe("PAINT");
    await page.getByRole("button", { name: "Sculpt", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.mode)).toBe("SCULPT");
    await page.evaluate(() => window.__coursecraftPixiTest!.focusTileForTest(38, 20, 1.15));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    greenPoint = await projectTile(page, canvas, { x: 38, y: 20 });
    const beforeSculptCancel = (await page.evaluate(() => window.__coursecraftTest!.state())).terrainVersion;

    await page.mouse.move(greenPoint.x, greenPoint.y);
    await page.mouse.down();

    await page.mouse.move(greenPoint.x - 3, greenPoint.y - 2, { steps: 2 });
    await expect(page.getByTestId("fine-green-stroke-preview")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.mouse.up();
    expect((await page.evaluate(() => window.__coursecraftTest!.state())).terrainVersion).toBe(beforeSculptCancel);
    await expect(page.getByTestId("pause-overlay")).toHaveCount(0);
    expect(errors).toEqual([]);

    await page.screenshot({ path: testInfo.outputPath("viewport-editor-final.png") });
  });
}
