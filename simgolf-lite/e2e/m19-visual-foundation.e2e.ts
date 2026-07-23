import { expect, test } from "@playwright/test";

test("M19 parkland materials, rotations, and static-motion fallback", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m19Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name)).toBe("M19 Parkland Reference Club");

  const canvas = page.locator(".cc-pixi-stage canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(700);
  expect(box?.height).toBeGreaterThan(500);
  await page.getByRole("button", { name: "Photo" }).click();
  await expect(page.getByTestId("photo-mode")).toBeVisible();
  await page.getByTestId("photo-mode").evaluate((element) => { element.style.display = "none"; });
  const overview = await canvas.screenshot({ path: "artifacts/m19-parkland-overview.png" });
  await testInfo.attach("parkland-overview", { body: overview, contentType: "image/png" });

  for (const [index, rotation] of [90, 180, 270].entries()) {
    await page.keyboard.press("e");
    await expect(page.getByLabel(`View bearing ${rotation} degrees`)).toHaveCount(1);
    if (index === 0) {
      const rotated = await canvas.screenshot({ path: "artifacts/m19-parkland-rotation-90.png" });
      await testInfo.attach("parkland-rotation-90", { body: rotated, contentType: "image/png" });
    }
  }

  await page.keyboard.press("p");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("tab", { name: "Graphics" }).click();
  const animations = page.getByRole("checkbox", { name: "Animations master" });
  if (await animations.isChecked()) await animations.click();
  await expect(animations).not.toBeChecked();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(250);
  await canvas.screenshot({ path: "artifacts/m19-parkland-static-water.png" });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").graphics)).toMatchObject({ animations: false, waterAnimation: false, treeSway: false });
  expect(errors).toEqual([]);
});
