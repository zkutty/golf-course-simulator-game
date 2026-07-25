import { expect, test } from "@playwright/test";

async function clickCourseTile(page: import("@playwright/test").Page, point: { x: number; y: number }, elevation = 1) {
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera?.zoom)).not.toBeNull();
  const camera = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").camera);
  if (camera.rotation !== 0 || typeof camera.zoom !== "number") throw new Error("M23 tile helper expects the fitted zero-degree camera");
  const canvas = page.locator(".cc-pixi-stage canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Course canvas has no bounds");
  const project = (x: number, y: number, z = 0) => ({
    x: (x - y) * 32,
    y: (x + y) * 16 - z * 8,
  });
  const center = project(camera.center.x, camera.center.y);
  const tile = project(point.x + 0.5, point.y + 0.5, elevation);
  await canvas.click({
    force: true,
    position: {
      x: box.width / 2 + (tile.x - center.x) * camera.zoom,
      y: box.height / 2 + (tile.y - center.y) * camera.zoom,
    },
  });
}

test("M23 tee sets, pin rotations, ratings, editor, and daily operations", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m23Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 15_000 }).toBe("M23 Course Standards Club");

  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(state.course.activePinRotation).toBe("B");
  expect(Object.keys(state.course.teeRatings)).toEqual(["forward", "member", "championship"]);
  expect(state.course.holeSetups[0].teeBoxes).toMatchObject({ forward: { x: 9 }, member: { x: 7 }, championship: { x: 5 } });
  await expect(page.getByRole("region", { name: "Tee and pin setup" })).toBeVisible();
  await expect(page.getByLabel("Forward tee x")).toHaveCount(0);
  await expect(page.getByLabel("Pin C x")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Tee and pin setup" }).locator('input[type="number"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move Forward tee on map" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move Pin C on map" })).toBeVisible();
  await page.getByTestId("tee-row-forward").click();
  await page.getByTestId("tee-par-forward").selectOption("3");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.holeSetups?.[0]?.parByTee?.forward)).toEqual({ mode: "MANUAL", par: 3 });

  await page.getByTestId("daily-pin-rotation").selectOption("C");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.activePinRotation)).toBe("C");

  await page.getByRole("button", { name: "Move Forward tee on map" }).click();
  await expect(page.getByTestId("setup-placement-prompt")).toContainText("Move Forward tee on the course");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.setupPlacement)).toEqual({ kind: "tee", key: "forward" });
  await clickCourseTile(page, { x: 10, y: 17 });
  await expect(page.getByTestId("tee-placement-confirm")).toBeVisible();
  await expect(page.getByTestId("tee-placement-confirm")).not.toContainText(/Tile \d/);
  await page.getByTestId("tee-placement-confirm").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.holeSetups?.[0]?.teeBoxes?.forward?.x)).toBe(10);

  await page.getByRole("button", { name: "Move Pin C on map" }).click();
  await expect(page.getByTestId("setup-placement-prompt")).toContainText("Move Pin C on the course");
  await clickCourseTile(page, { x: 32, y: 20 });
  await expect(page.getByTestId("setup-placement-prompt").getByRole("alert")).toContainText("must sit on existing green terrain");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.setupPlacement)).toEqual({ kind: "pin", key: "C" });
  await page.screenshot({ path: "artifacts/zk-447-map-placement.png", fullPage: true });
  await clickCourseTile(page, { x: 42, y: 20 });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.holeSetups?.[0]?.pinPositions?.C)).toEqual({ x: 42, y: 20 });
  await expect(page.getByTestId("setup-placement-prompt")).toHaveCount(0);

  const screenshot = await page.screenshot({ path: "artifacts/m23-course-standards.png", fullPage: true });
  await testInfo.attach("course-standards", { body: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("offers optional point-and-click tee construction immediately after a hole", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m23Fixture=1&teeOfferFixture=1");
  await expect(page.getByTestId("tee-setup-offer")).toBeVisible();
  await expect(page.getByTestId("offer-forward-tee")).toContainText("from $");
  await page.getByTestId("offer-forward-tee").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.selectedTeeSet)).toBe("forward");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").editor?.mode)).toBe("HOLE_WIZARD");
  await expect(page.getByTestId("setup-placement-prompt")).toContainText("Place Forward tee on the course");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("setup-placement-prompt")).toBeHidden();
  await expect(page.getByTestId("tee-placement-confirm")).toBeHidden();
});
