import { expect, test } from "@playwright/test";

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
  await expect(page.getByLabel("Forward tee x")).toBeVisible();
  await expect(page.getByLabel("Pin C x")).toBeVisible();
  await page.getByTestId("tee-row-forward").click();
  await page.getByTestId("tee-par-forward").selectOption("3");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.holeSetups?.[0]?.parByTee?.forward)).toEqual({ mode: "MANUAL", par: 3 });

  await page.getByTestId("daily-pin-rotation").selectOption("C");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.activePinRotation)).toBe("C");

  await page.getByLabel("Forward tee x").fill("10");
  await page.getByLabel("Forward tee x").press("Tab");
  await page.getByLabel("Forward tee y").press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tee-placement-confirm")).toBeVisible();
  await page.getByTestId("tee-placement-confirm").getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.holeSetups?.[0]?.teeBoxes?.forward?.x)).toBe(10);

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
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tee-placement-confirm")).toBeHidden();
});
