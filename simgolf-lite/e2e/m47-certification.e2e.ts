import { expect, test, type Page } from "@playwright/test";

async function advanceLive(page: Page, bursts = 4) {
  for (let index = 0; index < bursts; index++) await page.evaluate(() => window.advanceTime?.(2_000));
}

test("M47 Golfer Inspector exposes evidence and remains accessible/responsive", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m47Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 45_000 }).toBe("M47 18-Hole Certification Course");
  // Four 2s normal-speed advances reach the first tee time without collapsing
  // the browser test into a non-representative accelerated simulation burst.
  await page.getByTestId("speed-1x").click();
  await advanceLive(page, 4);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").simulation?.onCourse), { timeout: 30_000 }).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Open live overview" }).click();
  const overview = page.getByTestId("live-overview");
  await expect(overview).toBeVisible();
  await overview.locator("button:has(b)").first().click();
  const inspector = page.locator(".cc-golfer-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("Identity & approach");
  await expect(inspector).toContainText("Rejected:");
  const followButton = inspector.locator("button[aria-pressed]");
  const initialFollowing = await followButton.getAttribute("aria-pressed");
  expect(initialFollowing).toMatch(/^(true|false)$/);
  await followButton.focus();
  await expect(followButton).toBeFocused();
  await followButton.click();
  await expect(followButton).not.toHaveAttribute("aria-pressed", initialFollowing!);
  await expect(inspector.locator("button")).toHaveCount(2);

  const desktopShot = await page.screenshot({ path: "artifacts/m47/inspector-desktop.png", fullPage: true });
  await testInfo.attach("m47-inspector-desktop", { body: desktopShot, contentType: "image/png" });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await inspector.boundingBox();
  expect(mobileBounds).not.toBeNull();
  expect(mobileBounds!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const mobileShot = await page.screenshot({ path: "artifacts/m47/inspector-mobile.png", fullPage: true });
  await testInfo.attach("m47-inspector-mobile", { body: mobileShot, contentType: "image/png" });

  await page.evaluate(() => {
    const key = "coursecraft_app_profile_v5";
    const profile = JSON.parse(localStorage.getItem(key) ?? "{}");
    profile.accessibility = { ...profile.accessibility, colorVision: "deuteranopia", terrainPatterns: true, reducedMotion: true, textScale: 130 };
    localStorage.setItem(key, JSON.stringify(profile));
    localStorage.setItem("coursecraft_locale", "pseudo");
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator("html")).toHaveAttribute("data-color-vision", "deuteranopia");
  await expect(page.locator("html")).toHaveAttribute("data-terrain-patterns", "true");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.fontSize)).toBe("130%");
  await page.getByTestId("speed-1x").click();
  await advanceLive(page, 4);
  await page.locator('button[aria-label][aria-pressed]').filter({ hasText: "👥" }).click();
  await page.getByTestId("live-overview").locator("button:has(b)").first().click();
  const pseudoInspector = page.locator(".cc-golfer-inspector");
  await expect(pseudoInspector).toBeVisible();
  const pseudoBounds = await pseudoInspector.boundingBox();
  expect(pseudoBounds).not.toBeNull();
  expect(pseudoBounds!.x + pseudoBounds!.width).toBeLessThanOrEqual(390);
  expect(pseudoBounds!.y + pseudoBounds!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
