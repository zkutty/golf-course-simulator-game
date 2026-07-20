import { expect, test } from "@playwright/test";

test("M7 reputation progression, clock, live overview, and follow flow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?perfFixture=1&m7Rep=40");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").simulation?.onCourse)).toBe(100);

  await page.getByTestId("open-progression").click();
  const progression = page.getByTestId("progression-panel");
  await expect(progression).toBeVisible();
  await expect(progression.getByRole("heading", { name: "Local Favorite" })).toBeVisible();
  await expect(progression.getByText("🔒 Regional Draw", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/coursecraft-m7-progression.png", fullPage: true });
  await progression.getByRole("button", { name: "Close progression" }).click();

  for (const speed of ["paused", "1x", "2x", "3x"] as const) {
    await page.getByTestId(`speed-${speed}`).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").simulation?.speed)).toBe(speed);
  }

  await page.getByRole("button", { name: "Open live overview" }).click();
  const overview = page.getByTestId("live-overview");
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("tab", { name: "Golfers" })).toHaveAttribute("aria-selected", "true");
  await overview.getByRole("tab", { name: "Leaderboard" }).click();
  await expect(overview.locator("ol li")).toHaveCount(12);
  await overview.getByRole("tab", { name: "Staff" }).click();
  await expect(overview.getByText(/of 2 unlocked roles staffed/)).toBeVisible();
  await overview.getByRole("tab", { name: "Golfers" }).click();
  await overview.getByRole("button", { name: /^Perf Golfer 1 / }).click();
  await expect(page.locator(".cc-golfer-inspector")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop following golfer" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").simulation?.following)).toBe(1);
  await page.screenshot({ path: "/tmp/coursecraft-m7-follow.png", fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test("M7 progression locks unavailable build content", async ({ page }) => {
  await page.goto("/?perfFixture=1&m7Rep=40");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").progression?.tier)).toBe("local");
  await page.getByRole("button", { name: "Architect" }).click();
  await expect(page.getByRole("button", { name: /deep_rough/ })).toBeDisabled();
  await page.getByRole("button", { name: /Obstacle/ }).click();
  await expect(page.getByRole("button", { name: /rock/ })).toBeDisabled();
  await page.getByRole("button", { name: /Shop/ }).click();
  await expect(page.getByRole("button", { name: /Pro Shop/ })).toBeDisabled();
});
