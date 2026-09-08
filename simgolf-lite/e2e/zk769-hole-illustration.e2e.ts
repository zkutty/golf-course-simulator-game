import { expect, test } from "@playwright/test";

test("ZK-769 hole illustration is keyboard-safe, read-only, and contained on a narrow viewport", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?m23Fixture=1");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").screen),
    { timeout: 60_000 },
  ).toBe("game");

  const courseBefore = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text?.() ?? "{}").course));
  const reviewLauncher = page.getByTestId("open-architecture-review");
  await reviewLauncher.focus();
  await page.keyboard.press("Enter");

  const review = page.getByTestId("architecture-review");
  await expect(review).toBeVisible();
  const illustrationLauncher = review.getByTestId("architecture-create-hole-illustration");
  await illustrationLauncher.focus();
  await page.keyboard.press("Enter");
  await expect(illustrationLauncher).toHaveAttribute("aria-expanded", "true");
  await expect(illustrationLauncher).toHaveAttribute("aria-controls", "hole-illustration-preview");

  const preview = review.getByTestId("hole-illustration-preview");
  await expect(preview).toBeVisible();
  await preview.getByLabel("Frame").selectOption("tee-to-green");

  const figure = preview.locator("figure");
  const image = figure.locator("img");
  const caption = figure.locator("figcaption");
  await expect(figure).toBeVisible();
  await expect(image).toBeVisible();
  await expect(caption).toBeVisible();
  await figure.scrollIntoViewIfNeeded();

  const [reviewBox, figureBox, imageBox, captionBox] = await Promise.all([
    review.boundingBox(), figure.boundingBox(), image.boundingBox(), caption.boundingBox(),
  ]);
  expect(reviewBox).not.toBeNull();
  expect(figureBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect(captionBox).not.toBeNull();
  expect(reviewBox!.x).toBeGreaterThanOrEqual(0);
  expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(390);
  expect(figureBox!.x).toBeGreaterThanOrEqual(reviewBox!.x);
  expect(figureBox!.x + figureBox!.width).toBeLessThanOrEqual(reviewBox!.x + reviewBox!.width);
  expect(imageBox!.x).toBeGreaterThanOrEqual(figureBox!.x);
  expect(imageBox!.x + imageBox!.width).toBeLessThanOrEqual(figureBox!.x + figureBox!.width + 0.5);
  expect(captionBox!.x).toBeGreaterThanOrEqual(figureBox!.x);
  expect(captionBox!.x + captionBox!.width).toBeLessThanOrEqual(figureBox!.x + figureBox!.width);
  const captionFont = await caption.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(captionFont).toBeGreaterThanOrEqual(12);
  const screenshotPath = testInfo.outputPath("zk769-hole-illustration-narrow.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("zk769-hole-illustration-narrow", { path: screenshotPath, contentType: "image/png" });

  const topClose = preview.getByRole("button", { name: "Close hole illustration preview" });
  await topClose.focus();
  await page.keyboard.press("Enter");
  await expect(preview).toBeHidden();
  await expect(illustrationLauncher).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(preview).toBeVisible();
  const cancel = preview.getByTestId("hole-illustration-cancel");
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(preview).toBeHidden();
  await expect(illustrationLauncher).toBeFocused();

  const courseAfter = await page.evaluate(() => JSON.stringify(JSON.parse(window.render_game_to_text?.() ?? "{}").course));
  expect(courseAfter).toBe(courseBefore);
  expect(errors).toEqual([]);
});
