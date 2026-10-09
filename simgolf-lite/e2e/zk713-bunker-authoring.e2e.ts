import { expect, test } from "@playwright/test";

test("authored bunker preview persists the same world contour", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const keyEvidence: string[] = [];
  page.on("console", (message) => { if (message.text().startsWith("ZK713_KEY ")) keyEvidence.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m20Fixture=1&m20Theme=parkland");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 150_000 }).toBe("game");
  await page.evaluate(() => window.__coursecraftTest!.setGraphicsQualityFixture("medium"));
  await page.evaluate(() => window.__coursecraftTest!.setPaintCash(1_000_000));
  await page.evaluate(() => window.addEventListener("keydown", (event) => {
    if (event.code === "KeyE") console.info("ZK713_KEY " + JSON.stringify({ code: event.code, key: event.key, repeat: event.repeat, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, focus: document.activeElement?.tagName, state: window.__coursecraftPixiTest?.viewportInputState() }));
  }, true));
  await page.getByRole("button", { name: "Expand design dock" }).click();
  await page.getByTestId("design-tool-curve").click();
  await page.getByLabel("Brush width").fill("3");
  await page.getByTestId("design-card-terrain-sand").click();
  const canvas = page.locator(".cc-pixi-stage canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Canvas missing");
  const before = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length);
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.23, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.25, { steps: 8 });
  await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.terrainPreview()?.authoredBunkerRings?.length ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const preview = await page.evaluate(() => window.__coursecraftPixiTest!.terrainPreview()!.authoredBunkerRings);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(before + 1);
  const committed = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.at(-1));
  expect(committed?.terrain).toBe("sand");
  expect(committed).toBeDefined();
  const finalContour = () => page.evaluate((coverage) => window.__coursecraftPixiTest!.bunkerContours()
    .find((component) => component.cells.length === coverage.length && coverage.every((cell) => component.cells.includes(cell)))?.boundary, committed!.coverage);
  await expect.poll(finalContour).toEqual(preview);
  await page.getByRole("button", { name: "Undo terrain edit", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(before);
  await page.getByRole("button", { name: "Redo terrain edit", exact: true }).click();
  await expect.poll(finalContour).toEqual(preview);
  await page.getByTestId("design-dock").locator(".cc-design-toolbar strong").click();
  for (const rotation of [0, 90, 180, 270]) {
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.tweening)).toBe(false);
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches("input, textarea, select, [contenteditable=true]") ?? false)).toBe(false);
    if (rotation) await page.keyboard.press("KeyE");
    try {
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.committed)).toBe(rotation);
      await expect.poll(() => page.evaluate((coverage) => window.__coursecraftPixiTest!.bunkerContours().find((component) => component.cells.length === coverage.length && coverage.every((cell) => component.cells.includes(cell)))?.rotation, committed!.coverage)).toBe(rotation);
    } finally {
      await testInfo.attach(`rotation-input-${rotation}`, { body: Buffer.from(JSON.stringify({ keys: keyEvidence, state: await page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()), focus: await page.evaluate(() => document.activeElement?.tagName) }, null, 2)), contentType: "application/json" });
    }
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.tweening)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.screenRadians)).toBe(0);
    await expect.poll(finalContour).toEqual(preview);
    await testInfo.attach(`authored-bunker-${rotation}`, {
      body: await page.screenshot({ path: testInfo.outputPath(`bunker-${rotation}.png`) }), contentType: "image/png",
    });
  }
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete", { timeout: 30_000 });
  await page.locator(".cc-sidebar-footer").getByRole("button", { name: /Load$/ }).click();
  await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.at(-1))).toEqual(committed);
  await expect.poll(finalContour).toEqual(preview);
});
