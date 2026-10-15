import { expect, test } from "@playwright/test";

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`shared buttons scale and wrap ${locale} ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/e2e/fixtures/zk377-shared-buttons.html");
    await expect(page.getByTestId("size-sm")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const read = () => page.evaluate(() => {
      const selectors = ["[data-testid=size-sm]", "[data-testid=size-md]", "[data-testid=size-lg]", "[data-testid=icon] > div:last-child"];
      return selectors.map((selector) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize));
    });
    const baseline = await read();
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    const scaled = await read();
    expect(scaled.map((size, index) => Math.round(size / baseline[index] * 1000) / 1000)).toEqual([1.3, 1.3, 1.3, 1.3]);
    const bounds = await page.locator("button").evaluateAll((buttons) => buttons.map((button) => ({
      scroll: button.scrollWidth, client: button.clientWidth, left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right,
    })));
    for (const button of bounds) {
      expect(button.scroll).toBeLessThanOrEqual(button.client + 1);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
    if (width === 320) await page.screenshot({ path: testInfo.outputPath(`shared-buttons-${locale}-130.png`), fullPage: true });
  });
}

test("shared buttons preserve keyboard focus, variants, disabled and custom props", async ({ page }) => {
  await page.goto("/e2e/fixtures/zk377-shared-buttons.html");
  const first = page.getByTestId("size-sm");
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  const outline = await first.evaluate((button) => ({ style: getComputedStyle(button).outlineStyle, width: getComputedStyle(button).outlineWidth }));
  expect(outline).toEqual({ style: "solid", width: "3px" });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  for (const variant of ["primary", "secondary", "success", "danger"]) {
    await expect(page.getByTestId(`variant-${variant}`)).toHaveAttribute("data-variant", variant);
    await page.getByTestId(`variant-${variant}`).click();
  }
  await page.getByTestId("icon").click();
  for (const id of ["disabled", "disabled-icon"]) {
    const button = page.getByTestId(id);
    await expect(button).toBeDisabled();
    await button.dispatchEvent("click");
    await button.focus();
    await expect(button).not.toBeFocused();
  }
  const custom = page.getByTestId("custom");
  await expect(custom).toHaveClass("custom-class");
  await expect(custom).toHaveAttribute("aria-label", "Custom control");
  await expect(custom).toHaveAttribute("title", "Custom title");
  expect(await custom.evaluate((button) => getComputedStyle(button).fontSize)).toBe("20px");
  await custom.click();
  await expect(page.getByTestId("calls")).toHaveJSProperty("value", "sm,md,primary,secondary,success,danger,icon,custom");
});
