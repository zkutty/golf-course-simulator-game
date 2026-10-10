import { expect, test, type Locator, type Page } from "@playwright/test";

async function checkParent(panel: Locator, page: Page) {
  await expect(panel).toBeVisible();
  const measurements = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      parentLeft: parent.left, parentRight: parent.right,
      parentTop: parent.top, parentBottom: parent.bottom,
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      root: getComputedStyle(document.documentElement).fontSize,
    };
  });
  expect(measurements.root).toBe("20.8px");
  expect(measurements.left).toBeGreaterThanOrEqual(measurements.parentLeft - 1);
  expect(measurements.right).toBeLessThanOrEqual(measurements.parentRight + 1);
  expect(measurements.top).toBeGreaterThanOrEqual(measurements.parentTop - 1);
  expect(measurements.bottom).toBeLessThanOrEqual(measurements.parentBottom + 1);
  expect(measurements.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(measurements.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width + 1);
  for (const control of await panel.locator("button:enabled, input:enabled, select:enabled").all()) {
    await control.focus();
    await expect(control).toBeFocused();
    const bounds = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const panel = element.closest(".cc-hole-inspector, .cc-golfer-inspector, [data-testid=live-overview]")!.getBoundingClientRect();
      return { text: element.textContent, rect: rect.toJSON(), panel: panel.toJSON() };
    });
    expect(bounds.rect.left, JSON.stringify(bounds)).toBeGreaterThanOrEqual(bounds.panel.left - 1);
    expect(bounds.rect.right, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.panel.right + 1);
    expect(bounds.rect.top, JSON.stringify(bounds)).toBeGreaterThanOrEqual(bounds.panel.top - 1);
    expect(bounds.rect.bottom, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.panel.bottom + 1);
  }
}

for (const locale of ["en", "pseudo"] as const) {
  test(`ZK-382 inspectors fit actual gameplay parents at 130% ${locale}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript((locale) => {
      localStorage.setItem("coursecraft_locale", locale);
      localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
        version: 5, tutorialOffered: true, tutorialCompleted: true,
        accessibility: { textScale: 130, reducedMotion: true },
        gameplay: { autosaveCadence: "off" },
      }));
    }, locale);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?m23Fixture=1");
    const hole = page.locator(".cc-hole-inspector");
    await expect(hole).toBeVisible();
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await checkParent(hole, page);
      await hole.evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`hole-${width}.png`) });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?m47Fixture=1");
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.name), { timeout: 45_000 }).toBe("M47 18-Hole Certification Course");
    await page.getByTestId("speed-1x").click();
    for (let index = 0; index < 4; index++) await page.evaluate(() => window.advanceTime?.(2_000));
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").simulation?.onCourse), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.locator('button[aria-label][aria-pressed]').filter({ hasText: "👥" }).click();
    const live = page.getByTestId("live-overview");
    await expect(live).toBeVisible();
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await checkParent(live, page);
      await live.evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`live-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await live.locator("button:has(b)").first().click();
    const golfer = page.locator(".cc-golfer-inspector");
    await expect(golfer).toBeVisible();
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await checkParent(golfer, page);
      await golfer.evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`golfer-${width}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
