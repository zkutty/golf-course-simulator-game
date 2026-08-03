import { expect, test } from "@playwright/test";

test("ZK-644 green forecasts, retained evidence, and responsive text state stay actionable", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m38Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.currentEvidence), { timeout: 60_000 }).toBeGreaterThan(0);

  const livingClub = page.getByTestId("living-club-panel");
  if (await livingClub.isVisible()) await livingClub.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("open-architecture-review").click();
  const review = page.getByTestId("architecture-review");
  await expect(review).toBeVisible({ timeout: 60_000 });

  await review.getByTestId("architecture-overlay-green-preferred").click();
  await expect(review.getByTestId("architecture-green-strategy")).toBeVisible({ timeout: 60_000 });
  await expect(review.getByTestId("architecture-green-source")).toContainText("Forecast · current geometry");
  await expect(review).toContainText("Planning estimate on current geometry; not an observed result.");
  await expect(review).toContainText("Overlay patterns are static");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.greenStrategy?.evidenceSource), { timeout: 60_000 }).toBe("forecast-and-observed");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.overlay?.cells), { timeout: 60_000 }).toBeGreaterThan(0);

  await review.getByTestId("architecture-green-cohort").selectOption("accuracy");
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.greenStrategy?.selectedCohorts),
    { timeout: 60_000 },
  ).toEqual(["accuracy"]);
  await review.getByTestId("architecture-overlay-green-risk").click();
  await expect(review.getByTestId("architecture-green-report")).toContainText("Short-side punishment", { timeout: 60_000 });
  const text = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview.greenStrategy);
  expect(text).toMatchObject({ reducedMotionSafe: true, report: { shortSidePunishment: expect.any(Number), rotationVariety: expect.any(Number), cohortSeparation: expect.any(Number), unfairness: expect.any(Number) } });
  expect(text.textSummary).toContain("Forecast on current geometry");

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(review.getByTestId("architecture-green-report")).toBeVisible();
  const tabletBox = await review.boundingBox();
  expect(tabletBox).not.toBeNull();
  expect(tabletBox!.x + tabletBox!.width).toBeLessThanOrEqual(820);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeVisible();
  const box = await review.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(review.getByTestId("architecture-green-cohort")).toBeVisible();
  const screenshot = await page.screenshot();
  await testInfo.attach("zk644-green-strategy-mobile", { body: screenshot, contentType: "image/png" });
  expect(errors).toEqual([]);
});
