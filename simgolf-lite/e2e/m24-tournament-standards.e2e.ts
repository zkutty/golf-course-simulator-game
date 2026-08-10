import { expect, test } from "@playwright/test";

test("M24 explains readiness, books a prescribed setup, and runs it", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?m24Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 45_000 }).toBe("M24 Tournament Standards Club");

  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-tournaments").click();
  const panel = page.getByTestId("tournament-panel");
  await expect(panel).toBeVisible({ timeout: 45_000 });
  await expect(panel.getByTestId("tournament-readiness")).toBeVisible();
  await expect(panel.getByTestId("tournament-readiness").getByText("Prescribed setup")).toBeVisible();
  const readiness = panel.getByTestId("tournament-readiness");
  const requirements = readiness.locator("[data-requirement]");
  await expect(requirements).toHaveCount(10);
  await expect(requirements.evaluateAll((items) => items.map((item) => ({
    id: item.getAttribute("data-requirement"),
    passed: item.querySelector("span[aria-hidden=true]")?.textContent,
  })))).resolves.toEqual([
    { id: "reputation", passed: "✓" },
    { id: "deposit", passed: "✓" },
    { id: "date", passed: "✓" },
    { id: "calendar", passed: "✓" },
    { id: "holes", passed: "✓" },
    { id: "rotations", passed: "✓" },
    { id: "route", passed: "✓" },
    { id: "rating", passed: "✓" },
    { id: "slope", passed: "✓" },
    { id: "pin-fairness", passed: "✓" },
  ]);
  const readinessShot = await page.screenshot({ path: "artifacts/m24-readiness.png", fullPage: true });
  await testInfo.attach("m24-readiness", { body: readinessShot, contentType: "image/png" });
  await panel.getByTestId("schedule-tournament").click();
  await expect(panel.getByText("Tournament booked.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.scheduled)).toBe(1);

  await page.getByLabel("Close tournaments").click();
  await page.evaluate(() => window.__coursecraftTest!.startTournamentFixture());
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.active?.teeSet)).toBe("member");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").golfers.length), { timeout: 15_000 }).toBeGreaterThan(0);
  const setup = await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return { pin: state.tournament.active.pinRotation, golfers: state.golfers };
  });
  expect(setup.golfers.every((golfer: { teeSet: string; pinRotation: string }) => golfer.teeSet === "member" && golfer.pinRotation === setup.pin)).toBe(true);
  await page.getByTestId("open-tournaments").click();
  const liveShot = await page.screenshot({ path: "artifacts/m24-live.png", fullPage: true });
  await testInfo.attach("m24-live", { body: liveShot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("M24 warns and cancels after a prescribed setup is invalidated", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m24Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 45_000 }).toBe("M24 Tournament Standards Club");
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-tournaments").click();
  const panel = page.getByTestId("tournament-panel");
  await expect(panel).toBeVisible({ timeout: 45_000 });
  await panel.getByTestId("tournament-tier").selectOption("regional");
  await panel.getByTestId("schedule-tournament").click();
  await expect(panel.getByText("Tournament booked.")).toBeVisible();
  await page.evaluate(() => window.__coursecraftTest!.invalidateAndCancelTournamentFixture());
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").tournament.cancelled)).toBe(1);
  const cancellation = page.getByTestId("tournament-cancellation");
  await expect(cancellation).toBeVisible();
  await expect(cancellation.getByText(/Hosting deposit forfeited/)).toBeVisible();
  const shot = await page.screenshot({ path: "artifacts/m24-cancelled.png", fullPage: true });
  await testInfo.attach("m24-cancelled", { body: shot, contentType: "image/png" });
  expect(errors).toEqual([]);
});

test("M24 readiness remains usable at 130% text and in pseudo locale", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?m24Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 45_000 }).toBe("M24 Tournament Standards Club");
  await page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem("coursecraft_app_profile_v5") ?? "{}");
    profile.accessibility = { ...profile.accessibility, textScale: 130, reducedMotion: true };
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify(profile));
    localStorage.setItem("coursecraft_locale", "pseudo");
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-tournaments").click();
  const panel = page.getByTestId("tournament-panel");
  await expect(panel).toBeVisible({ timeout: 45_000 });
  await expect(panel.getByTestId("tournament-readiness")).toContainText("⟦");
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  await panel.getByTestId("schedule-tournament").scrollIntoViewIfNeeded();
  await expect(panel.getByTestId("schedule-tournament")).toBeVisible();
  const shot = await page.screenshot({ path: "artifacts/m24-pseudo-130.png", fullPage: true });
  await testInfo.attach("m24-pseudo-130", { body: shot, contentType: "image/png" });
});
