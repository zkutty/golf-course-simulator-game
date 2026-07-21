import { expect, test } from "@playwright/test";

test("M26 manages independent draft/published routings, fees, and metrics", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m26Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.layouts?.length), { timeout: 45_000 }).toBe(2);

  await page.getByTestId("open-course-manager").click();
  const panel = page.getByTestId("course-manager");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("tab", { name: "North Course" })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab", { name: "South Nine" }).click();
  await expect(panel.getByTestId("course-green-fee")).toHaveValue("55");
  await expect(panel.getByTestId("course-metrics")).toContainText("Rating");

  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.layouts.find((layout: { id: string }) => layout.id === "south"));
  await panel.getByLabel("Move down").first().click();
  const draftChanged = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.layouts.find((layout: { id: string }) => layout.id === "south"));
  expect(draftChanged.draftHoleIds).not.toEqual(before.draftHoleIds);
  expect(draftChanged.publishedHoleIds).toEqual(before.publishedHoleIds);
  await panel.getByTestId("publish-routing").click();
  await expect(panel.getByRole("status")).toContainText("published");
  const published = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course.layouts.find((layout: { id: string }) => layout.id === "south"));
  expect(published.publishedHoleIds).toEqual(published.draftHoleIds);

  await panel.evaluate((element) => { element.scrollTop = 0; });
  const shot = await page.screenshot({ path: "artifacts/m26-course-manager.png", fullPage: true });
  await testInfo.attach("m26-course-manager", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
