import { expect, test } from "@playwright/test";

test("M30 pace history exposes identity, local bottlenecks, and multi-course reports", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/?m30Fixture=1");
  await expect(page.getByLabel("Open live overview")).toBeVisible();
  await page.getByLabel("Open live overview").click();
  await page.getByRole("tab", { name: "Pace" }).click();

  const identity = page.getByTestId("pace-identity");
  await expect(identity).toContainText("Rolling pace identity");
  await expect(identity).toContainText("10 operating days");

  const bottlenecks = page.getByTestId("pace-bottlenecks");
  await expect(bottlenecks.getByRole("button")).toHaveCount(1);
  await expect(bottlenecks.getByRole("button")).toContainText(/WATCH|HIGH|SEVERE/);
  await expect(bottlenecks.getByRole("button")).toContainText("Action:");

  const history = page.getByTestId("pace-history");
  const courseSelect = history.getByLabel("Report course");
  await expect(courseSelect.locator("option")).toHaveCount(2);
  await history.getByLabel("Period").selectOption("28");
  await expect(history).toContainText("Gross / net per tee hour");
  const firstCourse = await courseSelect.inputValue();
  await courseSelect.selectOption({ index: 1 });
  await expect(courseSelect).not.toHaveValue(firstCourse);
  await expect(history).toContainText("Completed / incomplete");

  await history.scrollIntoViewIfNeeded();
  const screenshot = await page.screenshot({ path: "artifacts/m30-pace/pace-history.png", fullPage: true });
  await testInfo.attach("m30-pace-history", {
    body: screenshot,
    contentType: "image/png",
  });
  await testInfo.attach("m30-render-state", {
    body: await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
    contentType: "application/json",
  });
  await bottlenecks.getByRole("button").click();
  await expect(page.getByTestId("live-overview")).toHaveCount(0);
  expect(errors).toEqual([]);
});
