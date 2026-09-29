import { expect, test, type Locator, type Page } from "@playwright/test";

const viewports = [
  { width: 1440, height: 900 },
  { width: 800, height: 500 },
] as const;

type Point = { x: number; y: number };

async function inputState(page: Page) {
  return page.evaluate(() => window.__coursecraftPixiTest!.viewportInputState()!);
}

async function waitForCamera(page: Page) {
  await expect.poll(async () => {
    const state = await inputState(page);
    return Math.abs(state.camera.center.x - state.camera.targetCenter.x)
      + Math.abs(state.camera.center.y - state.camera.targetCenter.y)
      + Math.abs(state.camera.zoom - state.camera.targetZoom);
  }, { timeout: 15_000 }).toBeLessThan(0.025);
}

async function safariGesture(canvas: Locator, anchor: Point, scale: number) {
  await canvas.evaluate((element, detail) => {
    const emit = (type: string, nextScale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        scale: { value: nextScale },
        clientX: { value: detail.x },
        clientY: { value: detail.y },
      });
      element.dispatchEvent(event);
    };
    emit("gesturestart", 1);
    emit("gesturechange", detail.scale);
    emit("gestureend", detail.scale);
  }, { ...anchor, scale });
}

async function _projectTile(page: Page, canvas: Locator, point: Point) {
  const projected = await page.evaluate((target) => ({
    point: window.__coursecraftPixiTest!.tileToScreen(target.x, target.y),
    viewport: window.__coursecraftPixiTest!.viewport(),
  }), point);
  const bounds = await canvas.boundingBox();
  if (!bounds || !projected.point || !projected.viewport) throw new Error("Course projection unavailable");
  return {
    x: bounds.x + projected.point.x * bounds.width / projected.viewport.width,
    y: bounds.y + projected.point.y * bounds.height / projected.viewport.height,
  };
}

async function beginFlyover(page: Page) {
  const button = page.getByRole("button", { name: "Flyover", exact: true }).first();
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(async () => (await inputState(page)).flyover.active, { timeout: 10_000 }).toBe(true);
}

for (const viewport of viewports) {
  test(`ZK-679 production viewport input at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.goto("/?perfFixture=1");
    const canvas = page.locator(".cc-pixi-stage canvas");
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.viewportInputState()?.attached)).toBe(true);
    let bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const initial = await inputState(page);
    expect(initial.viewport.width).toBeCloseTo(bounds!.width, 0);
    expect(initial.viewport.height).toBeCloseTo(bounds!.height, 0);
    expect(initial.camera.initialized).toBe(true);
    expect(initial.rotation).toMatchObject({ committed: 0, tweening: false, screenRadians: 0 });

    const cameraPoint = {
      x: bounds!.x + bounds!.width * 0.15,
      y: bounds!.y + bounds!.height * 0.62,
    };
    await page.mouse.move(cameraPoint.x, cameraPoint.y);
    const beforeCameraInputs = await inputState(page);
    const rebuildsBefore = (beforeCameraInputs.terrain as { chunkRebuilds: number }).chunkRebuilds;
    await page.mouse.move(cameraPoint.x + 35, cameraPoint.y + 18, { steps: 3 });
    await expect.poll(async () => (await inputState(page)).counters.overlayInvalidations)
      .toBeGreaterThan(beforeCameraInputs.counters.overlayInvalidations);
    await page.mouse.wheel(0, -120);
    await expect.poll(async () => (await inputState(page)).camera.targetZoom)
      .toBeGreaterThan(beforeCameraInputs.camera.targetZoom);
    await waitForCamera(page);
    const afterWheel = await inputState(page);
    expect(afterWheel.counters.culls).toBeGreaterThan(beforeCameraInputs.counters.culls);
    expect((afterWheel.terrain as { chunkRebuilds: number }).chunkRebuilds).toBe(rebuildsBefore);

    bounds = await canvas.boundingBox();
    const gestureAnchor = { x: bounds!.x + bounds!.width * 0.5, y: bounds!.y + bounds!.height * 0.48 };
    const gestureLocal = {
      x: (gestureAnchor.x - bounds!.x) * initial.viewport.width / bounds!.width,
      y: (gestureAnchor.y - bounds!.y) * initial.viewport.height / bounds!.height,
    };
    const worldBeforeGesture = await page.evaluate((point) => window.__coursecraftPixiTest!.screenToWorld(point.x, point.y), gestureLocal);
    const zoomBeforeGesture = (await inputState(page)).camera.targetZoom;
    await safariGesture(canvas, gestureAnchor, 1.32);
    await expect.poll(async () => (await inputState(page)).input.gestureScale).toBe(1);
    await expect.poll(async () => (await inputState(page)).camera.targetZoom).toBeGreaterThan(zoomBeforeGesture);
    await waitForCamera(page);
    const worldAfterGesture = await page.evaluate((point) => window.__coursecraftPixiTest!.screenToWorld(point.x, point.y), gestureLocal);
    expect(worldBeforeGesture).not.toBeNull();
    expect(worldAfterGesture).not.toBeNull();
    expect(Math.hypot(worldAfterGesture!.x - worldBeforeGesture!.x, worldAfterGesture!.y - worldBeforeGesture!.y)).toBeLessThan(0.35);

    await page.mouse.move(cameraPoint.x, cameraPoint.y);
    await page.mouse.wheel(0, 90);
    const temporaryViewport = { width: viewport.width - 40, height: viewport.height - 20 };
    await page.setViewportSize(temporaryViewport);
    await expect.poll(async () => {
      const [state, box] = await Promise.all([inputState(page), canvas.boundingBox()]);
      return Math.max(Math.abs(state.viewport.width - box!.width), Math.abs(state.viewport.height - box!.height));
    }).toBeLessThan(2);
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const [state, box] = await Promise.all([inputState(page), canvas.boundingBox()]);
      return Math.max(Math.abs(state.viewport.width - box!.width), Math.abs(state.viewport.height - box!.height));
    }).toBeLessThan(2);
    await waitForCamera(page);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.down("KeyD");
    await expect.poll(async () => (await inputState(page)).input.heldPanActions).toContain("panRight");
    const beforeHeldPan = (await inputState(page)).camera.targetCenter;
    await expect.poll(async () => (await inputState(page)).camera.targetCenter.x).not.toBe(beforeHeldPan.x);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect.poll(async () => (await inputState(page)).input.heldPanActions).toEqual([]);
    await page.keyboard.up("KeyD");

    bounds = await canvas.boundingBox();
    const panPoint = { x: bounds!.x + bounds!.width * 0.22, y: bounds!.y + bounds!.height * 0.58 };
    for (const button of ["middle", "right"] as const) {
      await page.mouse.move(panPoint.x, panPoint.y);
      await page.mouse.down({ button });
      await expect.poll(async () => (await inputState(page)).input.panning).toBe(true);
      expect((await inputState(page)).input.panPointerId).not.toBeNull();
      await page.mouse.move(panPoint.x + 32, panPoint.y + 14, { steps: 3 });
      await page.mouse.up({ button });
      await expect.poll(async () => (await inputState(page)).input).toMatchObject({ panning: false, panPointerId: null });
    }

    await page.keyboard.press("KeyE");
    await expect.poll(async () => (await inputState(page)).rotation.committed, { timeout: 15_000 }).toBe(90);
    await expect.poll(async () => (await inputState(page)).rotation.tweening).toBe(false);
    const afterCameraInputs = await inputState(page);
    expect(afterCameraInputs.counters.culls).toBeGreaterThan(beforeCameraInputs.counters.culls);
    expect(afterCameraInputs.counters.overlayInvalidations).toBeGreaterThan(beforeCameraInputs.counters.overlayInvalidations);

    await beginFlyover(page);
    await expect.poll(async () => (await inputState(page)).flyover.active, { timeout: 12_000 }).toBe(false);
    await beginFlyover(page);
    await page.mouse.move(panPoint.x, panPoint.y);
    await page.mouse.wheel(0, -80);
    await expect.poll(async () => (await inputState(page)).flyover.active).toBe(false);

    await beginFlyover(page);
    await page.mouse.move(panPoint.x, panPoint.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.up({ button: "middle" });
    await expect.poll(async () => (await inputState(page)).flyover.active).toBe(false);
    await beginFlyover(page);
    await page.keyboard.press("KeyD");
    await expect.poll(async () => (await inputState(page)).flyover.active).toBe(false);
    await beginFlyover(page);
    await page.mouse.click(panPoint.x, panPoint.y);
    await expect.poll(async () => (await inputState(page)).flyover.active).toBe(false);



    await waitForCamera(page);
    const finalState = await inputState(page);
    const textState = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
    expect(textState.camera.rotation).toBe(finalState.rotation.committed);
    expect(textState.camera.zoom).toBeCloseTo(finalState.camera.zoom, 2);
    expect(textState.camera.center.x).toBeCloseTo(finalState.camera.center.x, 1);
    expect(textState.camera.center.y).toBeCloseTo(finalState.camera.center.y, 1);
    expect(page.viewportSize()).toEqual(viewport);
    expect(finalState.terrain).not.toBeNull();

    expect(errors).toEqual([]);
    await testInfo.attach("viewport-input-state", {
      body: Buffer.from(JSON.stringify({ textState: textState.camera, controller: finalState }, null, 2)),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("viewport-input-final.png") });
  });
}
