import { expect, test } from "@playwright/test";

test("ZK-760 neutral reference plans stay readable and deterministic on desktop and mobile", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m30Fixture=1");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name),
    { timeout: 45_000 },
  ).toBe("M26 Twin Courses Estate");

  await page.getByTestId("open-architecture-review").click();
  const review = page.getByTestId("architecture-review");
  await review.getByTestId("architecture-overlay-reference").click();
  await review.getByTestId("architecture-hole-filter").selectOption({ index: 1 });

  const reference = review.getByTestId("architecture-reference-plan");
  await expect(reference).toContainText("Effective route:", { timeout: 60_000 });
  await expect(reference).toContainText(/full shots \+ 2 expected putts/);
  await expect(reference.getByTestId("architecture-reference-consumer-summary")).toContainText(/Architecture .*\/100 · safety .*\/100/);
  await expect(reference.getByTestId("architecture-reference-consumer-summary")).toContainText(/Setup rating .* \/ slope .* · .* yd/);
  await expect(reference).toContainText("Reference plans use fixed neutral carry");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.kind),
  ).toBe("reference");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reference).toBeVisible();
  await reference.scrollIntoViewIfNeeded();
  const box = await review.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const screenshotPath = testInfo.outputPath("zk760-reference-plan-mobile.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("zk760-reference-plan-mobile", { path: screenshotPath, contentType: "image/png" });
  expect(errors).toEqual([]);
});
