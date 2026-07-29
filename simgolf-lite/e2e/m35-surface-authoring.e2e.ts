import { expect, test } from "@playwright/test";

test("M35 click spline and post-commit node/tangent editing stay atomic", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), {
    timeout: 120_000,
  }).toBe("game");
  await page.evaluate(() => window.__coursecraftTest?.setPaintCash(1_000_000));

  await page.getByTestId("terrain-tool-spline").click();
  await page.getByTestId("terrain-width-5").click();
  await expect(page.getByLabel("Brush width")).toHaveValue("5");
  await page.locator("button").filter({ hasText: /^fairway$/ }).last().click();

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const screenPoint = (x: number, y: number) => ({
    x: box.x + box.width * x,
    y: box.y + box.height * y,
  });
  const authored = [
    screenPoint(0.38, 0.43),
    screenPoint(0.50, 0.34),
    screenPoint(0.64, 0.46),
  ];
  await page.mouse.click(authored[0].x, authored[0].y);
  await page.mouse.click(authored[1].x, authored[1].y);
  await page.mouse.click(authored[2].x, authored[2].y);
  await page.keyboard.press("Enter");

  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest?.terrainSurfaceState().features.length ?? 0
  ))).toBe(1);
  const created = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features[0]);
  expect(created.kind).toBe("corridor");
  expect(created.points).toHaveLength(3);
  expect(created.width).toBe(5);

  await page.getByTestId("terrain-tool-edit").click();
  await expect(page.getByTestId("surface-authoring-instructions")).toContainText("Click a persisted");
  await page.evaluate(() => window.__coursecraftTest!.resetM35Metrics());

  const movedFirst = { x: authored[0].x + 28, y: authored[0].y - 12 };
  await page.mouse.move(authored[0].x, authored[0].y);
  await page.mouse.down();
  await page.mouse.move(movedFirst.x, movedFirst.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features[0]);
    return Math.hypot(
      current.points[0].x - created.points[0].x,
      current.points[0].y - created.points[0].y,
    );
  }).toBeGreaterThan(0.25);
  await expect(page.getByTestId("surface-authoring-instructions")).toContainText("Drag gold nodes");

  // The default outgoing handle projects approximately one third of the way
  // from the selected endpoint to its next node.
  const handle = {
    x: movedFirst.x + (authored[1].x - movedFirst.x) / 3,
    y: movedFirst.y + (authored[1].y - movedFirst.y) / 3,
  };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 18, handle.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features[0].tangents
  ))).not.toBeNull();

  const edited = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features[0]);
  expect(edited.points).toHaveLength(3);
  expect(edited.tangents).toHaveLength(3);
  expect(await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(1);

  await page.keyboard.press("Delete");
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features[0].points.length
  ))).toBe(2);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features[0].points.length
  ))).toBe(3);

  await expect.poll(() => page.evaluate(() => (
    window.__coursecraftTest!.m35Metrics().connectedRebuild.count
  ))).toBeGreaterThan(0);
  const metrics = await page.evaluate(() => window.__coursecraftTest!.m35Metrics());
  expect(metrics.surfacePreview.count).toBeGreaterThanOrEqual(6);
  expect(metrics.surfacePreview.p95Ms).toBeLessThanOrEqual(50);
  expect(metrics.surfaceCommit.count).toBeGreaterThanOrEqual(3);
  expect(metrics.surfaceCommit.p95Ms).toBeLessThanOrEqual(100);
  expect(metrics.chunkRebuild.maxMs).toBeLessThanOrEqual(100);
  expect(metrics.connectedRebuild.maxMs).toBeLessThanOrEqual(100);
  await testInfo.attach("m35-authoring-metrics", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });

  for (const rotation of [90, 180, 270]) {
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => (
      JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.rotation
    ))).toBe(rotation);
    expect(await page.evaluate(() => (
      window.__coursecraftTest!.terrainSurfaceState().features[0]
    ))).toEqual(edited);
  }

  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
  // Edit mode owns the first Escape to clear its selected control point.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().paused)).toBe(true);
  await page.getByRole("button", { name: /load game/i }).click({ timeout: 10_000 });
  await expect(page.getByTestId("save-slot-quick-save")).toContainText("Quick Save");
  await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("in-game");
  expect(await page.evaluate(() => (
    window.__coursecraftTest!.terrainSurfaceState().features[0]
  ))).toEqual(edited);

  const shot = await page.screenshot({
    path: "artifacts/m35-surface-node-editor.png",
    fullPage: true,
  });
  await testInfo.attach("m35-surface-node-editor", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
