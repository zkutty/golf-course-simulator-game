import { expect, test } from "@playwright/test";

type CameraState = {
  center: { x: number; y: number };
  zoom: number;
  controllerZoom: number;
  targetZoom: number;
};

async function camera(page: import("@playwright/test").Page): Promise<CameraState> {
  return page.evaluate(() => {
    const published = JSON.parse(window.render_game_to_text?.() ?? "{}").camera;
    const actual = window.__coursecraftPixiTest?.cameraTransform()?.camera;
    if (!actual) throw new Error("Actual camera transform is required");
    return { ...published, controllerZoom: actual.zoom, targetZoom: actual.targetZoom };
  });
}

async function settledCamera(page: import("@playwright/test").Page, initial?: CameraState): Promise<CameraState> {
  let current = initial ?? await camera(page);
  const target = current.targetZoom;
  let targetChanged = false;
  await expect.poll(async () => {
    current = await camera(page);
    targetChanged ||= current.targetZoom !== target;
    return !targetChanged
      && Math.abs(current.controllerZoom - target) < 1e-4;
  }).toBe(true);
  // Published view snapshots are throttled; retain the original zoom precision.
  expect(current.zoom).toBeCloseTo(target, 2);
  return current;
}

test("manual zoom remains stable in the hole editor", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m23Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), {
    timeout: 15_000,
  }).toBe("M23 Course Standards Club");

  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Fit", exact: true })).toBeVisible();

  const canvas = page.locator(".cc-pixi-stage canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Course canvas has no bounds");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);

  const fitted = await settledCamera(page);
  for (let index = 0; index < 3; index++) await page.mouse.wheel(0, -320);
  const wheelStart = await camera(page);
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(fitted.zoom * 1.2);
  const manuallyZoomed = await settledCamera(page, wheelStart);

  await page.waitForTimeout(1_000);
  const settled = await camera(page);
  expect(settled.zoom).toBeGreaterThan(fitted.zoom * 1.2);
  expect(settled.zoom).toBeCloseTo(manuallyZoomed.zoom, 2);
  expect(settled.targetZoom).toBe(manuallyZoomed.targetZoom);

  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const refitStart = await camera(page);
  await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(settled.zoom * 0.9);
  const refitted = await settledCamera(page, refitStart);

  await page.evaluate(() => {
    const target = document.querySelector(".cc-pixi-stage canvas");
    if (!target) throw new Error("Course stage is missing");
    const dispatchGesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        scale: { value: scale },
        clientX: { value: window.innerWidth * 0.35 },
        clientY: { value: window.innerHeight * 0.4 },
      });
      target.dispatchEvent(event);
    };
    dispatchGesture("gesturestart", 1);
    dispatchGesture("gesturechange", 1.65);
    dispatchGesture("gestureend", 1.65);
  });

  const pinchStart = await camera(page);
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(refitted.zoom * 1.2);
  const pinched = await settledCamera(page, pinchStart);
  expect(pinched.zoom).toBeGreaterThan(refitted.zoom * 1.2);
  await page.waitForTimeout(1_000);
  const afterPinch = await camera(page);
  expect(afterPinch.zoom).toBeCloseTo(pinched.zoom, 2);
  expect(afterPinch.targetZoom).toBe(pinched.targetZoom);
  const screenshot = await page.screenshot({ path: "artifacts/zk445-hole-editor-zoom.png", fullPage: true });
  await testInfo.attach("hole-editor-manual-zoom", { body: screenshot, contentType: "image/png" });
  expect(consoleErrors).toEqual([]);
});
