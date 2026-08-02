import { expect, test, type Page } from "@playwright/test";

type CourseState = ReturnType<NonNullable<Window["__coursecraftTest"]>["terrainSurfaceState"]>;

function adjacentGreenPair(state: CourseState): [{ x: number; y: number }, { x: number; y: number }] {
  for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
    const index = y * state.width + x;
    if (state.tiles[index] !== "green" || !state.owned[index]) continue;
    for (const neighbor of [{ x: x + 1, y }, { x, y: y + 1 }]) {
      if (neighbor.x >= state.width || neighbor.y >= state.height) continue;
      const neighborIndex = neighbor.y * state.width + neighbor.x;
      if (state.tiles[neighborIndex] === "green" && state.owned[neighborIndex]) return [{ x, y }, neighbor];
    }
  }
  throw new Error("Fine-green fixture needs two adjacent owned green tiles.");
}

async function projectTile(page: Page, state: CourseState, point: { x: number; y: number }) {
  const camera = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera);
  if (camera.rotation !== 0 || typeof camera.zoom !== "number") throw new Error("ZK-638 fixture expects a zero-degree fitted camera.");
  const canvas = page.locator(".cc-pixi-stage canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Course canvas has no bounds.");
  const project = (x: number, y: number, elevation: number) => ({ x: (x - y) * 32, y: (x + y) * 16 - elevation * 8 });
  const centerElevation = state.elevations[Math.floor(camera.center.y) * state.width + Math.floor(camera.center.x)] ?? 0;
  const center = project(camera.center.x, camera.center.y, centerElevation);
  const elevation = state.elevations[point.y * state.width + point.x] ?? 0;
  const tile = project(point.x + 0.5, point.y + 0.5, elevation);
  return {
    x: box.x + box.width / 2 + (tile.x - center.x) * camera.zoom,
    y: box.y + box.height / 2 + (tile.y - center.y) * camera.zoom,
  };
}

test("ZK-638 mouse/touch fine-green strokes preview, commit, undo, and redo atomically", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m23Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 30_000 }).toBe("game");
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(1_000_000));

  const exitHoleEditor = page.getByRole("button", { name: "Exit", exact: true });
  if (await exitHoleEditor.isVisible()) {
    await exitHoleEditor.evaluate((button: HTMLButtonElement) => button.click());
    await expect(exitHoleEditor).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Sculpt", exact: true }).click();
  await expect(page.getByTestId("fine-green-sculpt-controls")).toBeVisible();
  await page.getByTestId("fine-green-brush-ridge").click();
  await expect(page.getByTestId("fine-green-brush-ridge")).toHaveAttribute("aria-pressed", "true");

  const state = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const [first, second] = adjacentGreenPair(state);
  const start = await projectTile(page, state, first);
  const end = await projectTile(page, state, second);
  const before = await page.evaluate(() => window.__coursecraftTest!.state());

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.getByTestId("fine-green-stroke-preview")).toBeVisible();
  await expect(page.getByTestId("fine-green-stroke-preview")).toContainText("Fine contour preview");
  await page.mouse.up();
  await expect(page.getByTestId("fine-green-stroke-preview")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().greenSurface?.tiles.length ?? 0)).toBeGreaterThan(0);
  const afterMouse = await page.evaluate(() => window.__coursecraftTest!.state());
  expect(afterMouse.terrainVersion).toBe(before.terrainVersion + 1);
  expect(afterMouse.economyVersion).toBe(before.economyVersion + 1);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().greenSurface?.tiles.length ?? 0)).toBe(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().greenSurface?.tiles.length ?? 0)).toBeGreaterThan(0);

  // Pointer capture is pointer-type agnostic. A synthetic touch stroke covers
  // the same native path without relying on a separate mobile-only handler.
  const touchTarget = page.locator(".cc-pixi-stage canvas");
  await touchTarget.dispatchEvent("pointerdown", { pointerId: 42, pointerType: "touch", button: 0, clientX: start.x, clientY: start.y, bubbles: true });
  await touchTarget.dispatchEvent("pointermove", { pointerId: 42, pointerType: "touch", button: 0, clientX: end.x, clientY: end.y, bubbles: true });
  await expect(page.getByTestId("fine-green-stroke-preview")).toBeVisible();
  await touchTarget.dispatchEvent("pointerup", { pointerId: 42, pointerType: "touch", button: 0, clientX: end.x, clientY: end.y, bubbles: true });
  await expect(page.getByTestId("fine-green-stroke-preview")).toHaveCount(0);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach("zk638-fine-green-overlay", { body: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
