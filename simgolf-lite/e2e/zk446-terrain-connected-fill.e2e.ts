import { expect, test } from "@playwright/test";

type SurfaceSnapshot = ReturnType<NonNullable<Window["__coursecraftTest"]>["terrainSurfaceState"]>;

function connectedComponentCount(coverage: number[], width: number): number {
  const remaining = new Set(coverage);
  let components = 0;
  for (const seed of coverage) {
    if (!remaining.delete(seed)) continue;
    components += 1;
    const queue = [seed];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const x = current % width;
      for (const next of [
        current - width,
        current + width,
        ...(x > 0 ? [current - 1] : []),
        ...(x + 1 < width ? [current + 1] : []),
      ]) {
        if (!remaining.delete(next)) continue;
        queue.push(next);
      }
    }
  }
  return components;
}

function featureSnapshot(surface: SurfaceSnapshot) {
  const feature = surface.features.at(-1);
  expect(feature, "paint gesture should append a surface feature").toBeDefined();
  return feature!;
}

test("ZK-446 Area brush commits one connected filled mask and round-trips it exactly", async ({ page }, testInfo) => {
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
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name
  ))).toBe("M20 parkland Terrain Laboratory");
  await page.evaluate(() => window.__coursecraftTest?.setPaintCash(1_000_000));
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().cash)).toBe(1_000_000);

  const before = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const beforeTerrainVersion = await page.evaluate(() => window.__coursecraftTest!.state().terrainVersion);
  await page.getByRole("button", { name: "Area", exact: true }).click();
  await expect(page.getByRole("button", { name: "Area", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("button").filter({ hasText: /^sand$/ }).last().click();

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const loop: Array<[number, number]> = [
    [0.39, 0.29],
    [0.54, 0.27],
    [0.65, 0.36],
    [0.64, 0.51],
    [0.54, 0.61],
    [0.39, 0.57],
    [0.32, 0.44],
    [0.39, 0.30],
  ];
  await page.mouse.move(box.x + box.width * loop[0][0], box.y + box.height * loop[0][1]);
  await page.mouse.down();
  for (const [x, y] of loop.slice(1)) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 5 });
  }
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(before.features.length + 1);
  const committed = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  const feature = featureSnapshot(committed);

  expect(feature.kind).toBe("region");
  expect(feature.terrain).toBe("sand");
  expect(feature.renderRings.length).toBeGreaterThan(0);
  expect(feature.coverage.length).toBeGreaterThan(20);
  expect(connectedComponentCount(feature.coverage, committed.width)).toBe(1);

  const xs = feature.coverage.map((index) => index % committed.width);
  const ys = feature.coverage.map((index) => Math.floor(index / committed.width));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const boundingArea = (maxX - minX + 1) * (maxY - minY + 1);
  expect(feature.coverage.length / boundingArea, "Area should fill its interior instead of storing a snake-like perimeter").toBeGreaterThan(0.45);
  const centerX = Math.round((minX + maxX) / 2);
  const centerY = Math.round((minY + maxY) / 2);
  expect(feature.coverage).toContain(centerY * committed.width + centerX);
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().terrainVersion)).toBe(beforeTerrainVersion + 1);

  const shot = await page.screenshot({ path: "artifacts/zk446-connected-area.png", fullPage: true });
  await testInfo.attach("zk446-connected-area", { body: shot, contentType: "image/png" });

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(before.features.length);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(before.features.length + 1);
  const redone = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  expect(featureSnapshot(redone)).toEqual(feature);

  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /load game/i }).click();
  await expect(page.getByTestId("save-slot-quick-save")).toContainText("Quick Save");
  await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("in-game");
  const loaded = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
  expect(featureSnapshot(loaded)).toEqual(feature);
  expect(errors).toEqual([]);
});
