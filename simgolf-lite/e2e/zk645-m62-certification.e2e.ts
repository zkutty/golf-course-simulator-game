import { expect, test } from "@playwright/test";

test("ZK-645 certifies green strategy selectors and representative overlays at desktop and mobile sizes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m38Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview?.currentEvidence), { timeout: 60_000 }).toBeGreaterThan(0);

  const livingClub = page.getByTestId("living-club-panel");
  await expect(livingClub).toBeVisible({ timeout: 60_000 });
  await livingClub.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("open-architecture-review").click();
  const review = page.getByTestId("architecture-review");
  await expect(review).toBeVisible({ timeout: 60_000 });

  const overlayIds = [
    "green-preferred",
    "green-putts",
    "green-leaves",
    "green-misses",
    "green-rollout",
    "green-risk",
  ] as const;
  for (const kind of overlayIds) await expect(review.getByTestId(`architecture-overlay-${kind}`)).toBeVisible();
  const assertOverlay = async (kind: "green-preferred" | "green-risk") => {
    await review.getByTestId(`architecture-overlay-${kind}`).click();
    await expect(review.getByTestId("architecture-green-strategy")).toBeVisible({ timeout: 120_000 });
    await expect.poll(
      () => page.evaluate(() => {
        const value = JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview;
        return {
          kind: value?.overlay?.kind,
          cells: value?.overlay?.cells ?? 0,
          points: value?.overlay?.points ?? 0,
          traces: value?.overlay?.traces ?? 0,
          safe: value?.greenStrategy?.reducedMotionSafe,
          summary: value?.greenStrategy?.textSummary ?? "",
        };
      }),
      { timeout: 120_000 },
    ).toEqual(expect.objectContaining({ kind, safe: true, summary: expect.stringContaining("Forecast on current geometry") }));
    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").architectureReview);
    expect(state.overlay.cells).toBeLessThanOrEqual(240);
    expect(state.overlay.points).toBeLessThanOrEqual(240);
    expect(state.overlay.traces).toBeLessThanOrEqual(320);
    expect(state.overlay.cells + state.overlay.points + state.overlay.traces).toBeGreaterThan(0);
  };
  await assertOverlay("green-preferred");
  await assertOverlay("green-risk");

  const pinSelect = review.getByLabel("Pin rotation");
  const pinOptions = await pinSelect.locator("option").allTextContents();
  const cohortOptions = await review.getByTestId("architecture-green-cohort").locator("option").allTextContents();
  expect(pinOptions).toEqual(expect.arrayContaining(["All", "A", "B", "C"]));
  expect(cohortOptions.length).toBeGreaterThanOrEqual(6);
  await expect(review.getByTestId("architecture-green-report")).toContainText("Short-side punishment", { timeout: 60_000 });
  await expect(review).toContainText("Overlay patterns are static");
  await expect(review).toContainText("Planning estimate on current geometry; not an observed result.");
  const desktop = await page.screenshot({
    path: "artifacts/m62/screenshots/zk645-m62-desktop.png",
    fullPage: true,
  });
  await testInfo.attach("zk645-m62-desktop-overlays", { body: desktop, contentType: "image/png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeVisible();
  const bounds = await review.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(pinSelect).toBeVisible();
  await expect(review.getByTestId("architecture-green-cohort")).toBeVisible();
  const mobile = await page.screenshot({
    path: "artifacts/m62/screenshots/zk645-m62-mobile.png",
    fullPage: true,
  });
  await testInfo.attach("zk645-m62-mobile-overlays", { body: mobile, contentType: "image/png" });
  expect(errors).toEqual([]);
});
