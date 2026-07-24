import { expect, test } from "@playwright/test";

test("M43 packages a course locally and test plays an isolated copy", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m25Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen), { timeout: 45_000 }).toBe("game");
  const originalName = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.name);

  await page.getByTestId("workspace-legacy").click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByTestId("workspace-action-content").click();
  const panel = page.getByTestId("content-library");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Description").fill("A local package acceptance fixture.");
  await panel.getByRole("button", { name: "Package current course" }).click();
  await expect(panel.getByRole("status")).toContainText("Saved");
  await expect(panel.getByText(originalName, { exact: true })).toBeVisible();
  const shot = await page.screenshot({ path: "artifacts/m43-content-library.png", fullPage: true });
  await testInfo.attach("content-library", { body: shot, contentType: "image/png" });

  await panel.getByRole("button", { name: "Test play copy" }).click();
  await expect(page.getByTestId("exit-content-test")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.name)).toBe(originalName);
  await page.getByTestId("exit-content-test").click();
  await expect(page.getByTestId("exit-content-test")).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.name)).toBe(originalName);
  expect(errors).toEqual([]);
});
