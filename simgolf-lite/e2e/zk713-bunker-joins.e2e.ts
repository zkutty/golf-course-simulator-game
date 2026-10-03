import { expect, test } from "@playwright/test";

test("consumed pot, joined and bridged previews match final sand at every tier", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const quality of ["low", "medium", "high"] as const) for (const scenario of ["pot", "join", "bridge"] as const) {
    await page.goto("/?m20Fixture=1&m20Theme=parkland");
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen), { timeout: 150_000 }).toBe("game");
    await page.waitForFunction(() => Boolean(window.__coursecraftPixiTest));
    await page.evaluate((quality) => { window.__coursecraftTest!.setGraphicsQualityFixture(quality); window.__coursecraftTest!.setPaintCash(1_000_000); }, quality);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.rendererAtlasState().rendered.quality)).toBe(quality);
    await page.getByRole("button", { name: "Expand design dock" }).click();
    await page.getByTestId("design-tool-curve").click();
    await page.getByLabel("Brush width").fill("1");
    await page.getByTestId("design-card-terrain-sand").click();
    await page.getByRole("button", { name: "Collapse design dock" }).click();
    const base = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState());
    const contours = await page.evaluate(() => window.__coursecraftPixiTest!.bunkerContours());
    const p = (cell: number) => ({ x: cell % base.width, y: Math.floor(cell / base.width) });
    let from: number, to: number;
    let required: number[] = [];
    if (scenario === "pot") {
      from = to = base.tiles.findIndex((terrain, cell) => terrain === "rough" && base.owned[cell]
        && p(cell).x > 12 && p(cell).x < base.width - 8 && p(cell).y > 8
        && [cell - 1, cell + 1, cell - base.width, cell + base.width].every((n) => base.tiles[n] === "rough")
        && !base.obstacles.some((obstacle) => Math.abs(obstacle.x - p(cell).x) <= 1 && Math.abs(obstacle.y - p(cell).y) <= 1));
    } else if (scenario === "join") {
      const component = contours.find((c) => c.cells.length > 2)!;
      required = component.cells;
      from = to = component.cells.flatMap((cell) => [cell - 1, cell + 1, cell - base.width, cell + base.width])
        .find((cell) => base.tiles[cell] === "rough" && base.owned[cell])!;
    } else {
      const pairs = contours.flatMap((a, index) => contours.slice(index + 1).flatMap((b) => a.cells.flatMap((from) => b.cells.map((to) => ({ from, to, required: [...a.cells, ...b.cells], d: Math.hypot(p(from).x - p(to).x, p(from).y - p(to).y) })))))
        .sort((a, b) => a.d - b.d);
      const pair = pairs.find(({ from, to }) => Array.from({ length: Math.ceil(pairs[0].d * 8) + 1 }, (_, step) => {
        const t = step / Math.ceil(pairs[0].d * 8);
        const x = Math.floor(p(from).x + .5 + (p(to).x - p(from).x) * t);
        const y = Math.floor(p(from).y + .5 + (p(to).y - p(from).y) * t);
        return y * base.width + x;
      }).every((cell) => base.owned[cell] && !["green", "tee", "water", "wetland"].includes(base.tiles[cell])));
      expect(pair).toBeDefined();
      ({ from, to, required } = pair!);
    }
    expect(from).toBeGreaterThanOrEqual(0);
    const center = { x: (p(from).x + p(to).x) / 2, y: (p(from).y + p(to).y) / 2 };
    await page.evaluate((center) => window.__coursecraftPixiTest!.focusTileForTest(center.x, center.y, 1), center);
    const canvas = page.locator(".cc-pixi-stage canvas");
    const box = (await canvas.boundingBox())!;
    const start = (await page.evaluate((point) => window.__coursecraftPixiTest!.tileToScreen(point.x, point.y), p(from)))!;
    const end = (await page.evaluate((point) => window.__coursecraftPixiTest!.tileToScreen(point.x, point.y), p(to)))!;
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + end.x + (scenario === "bridge" ? 0 : .01), box.y + end.y, { steps: scenario === "bridge" ? 20 : 1 });
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.terrainPreview()?.bunkerContours?.length ?? 0)).toBeGreaterThan(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const preview = (await page.evaluate(() => window.__coursecraftPixiTest!.terrainPreview()))!;
    const expected = preview.bunkerContours!.find((component) => required.every((cell) => component.cells.includes(cell)))!;
    expect(expected).toBeDefined();
    expect(preview.chargedCells!.length).toBeGreaterThan(0);
    expect(preview.chargedCells!.every((cell) => base.tiles[cell] !== "sand")).toBe(true);
    expect(required.every((cell) => expected.cells.includes(cell))).toBe(true);
    if (scenario === "pot") expect(expected.cells).toHaveLength(1);
    else expect(expected.authored).toBe(false);
    await testInfo.attach(`${quality}-${scenario}-preview`, { body: await canvas.screenshot({ path: testInfo.outputPath(`${quality}-${scenario}-preview.png`) }), contentType: "image/png" });
    await page.mouse.up();
    const actual = () => page.evaluate((cells) => window.__coursecraftPixiTest?.bunkerContours().find((component) => component.cells.length === cells.length && cells.every((cell) => component.cells.includes(cell))), expected.cells);
    await expect.poll(async () => { const c = await actual(); return c && { cells: c.cells, boundary: c.boundary, floor: c.floor }; }).toEqual({ cells: expected.cells, boundary: expected.boundary, floor: expected.floor });
    const features = await page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features);
    await page.getByRole("button", { name: "Expand design dock" }).click();
    await page.getByRole("button", { name: "Undo terrain edit", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.terrainSurfaceState().features.length)).toBe(features.length - 1);
    await page.getByRole("button", { name: "Redo terrain edit", exact: true }).click();
    await expect.poll(async () => (await actual())?.boundary).toEqual(expected.boundary);
    await page.getByRole("button", { name: "Collapse design dock" }).click();
    await page.getByTestId("design-dock").locator(".cc-design-toolbar strong").click();
    for (const rotation of [0, 90, 180, 270]) {
      if (rotation) await page.keyboard.press("KeyE");
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.committed)).toBe(rotation);
      await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!.rotation.tweening)).toBe(false);
      await expect.poll(async () => (await actual())?.rotation).toBe(rotation);
      await expect.poll(async () => (await actual())?.boundary).toEqual(expected.boundary);
      await expect.poll(async () => (await actual())?.floor).toEqual(expected.floor);
      await page.evaluate((center) => window.__coursecraftPixiTest!.focusTileForTest(center.x, center.y, 1), center);
      await page.mouse.move(2, 2);
      await testInfo.attach(`${quality}-${scenario}-${rotation}-final`, { body: await canvas.screenshot({ path: testInfo.outputPath(`${quality}-${scenario}-${rotation}.png`) }), contentType: "image/png" });
    }
    await page.keyboard.press("Control+KeyS");
    await expect(page.locator('.sr-only[role="status"]')).toContainText("Quick save complete");
    await page.locator(".cc-sidebar-footer").getByRole("button", { name: /Load$/ }).click();
    await page.getByTestId("save-slot-quick-save").getByRole("button", { name: "Load", exact: true }).click();
    await expect.poll(async () => (await actual())?.boundary).toEqual(expected.boundary);
    await expect.poll(async () => (await actual())?.floor).toEqual(expected.floor);
    await testInfo.attach(`${quality}-${scenario}-coverage`, { body: Buffer.from(JSON.stringify({ changedCells: preview.chargedCells, acceptedCells: preview.acceptedCells, existingJoinedCells: required, expected }, null, 2)), contentType: "application/json" });
  }
  expect(errors).toEqual([]);
});
