import { expect, test, type Page } from "@playwright/test";

const viewports = [{ width: 320, height: 900 }, { width: 570, height: 900 }, { width: 768, height: 900 }, { width: 1280, height: 1000 }];

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return errors;
}

async function openFixture(page: Page, locale: "en" | "pseudo") {
  await page.addInitScript((selectedLocale) => localStorage.setItem("coursecraft_locale", selectedLocale), locale);
  await page.goto("/e2e/fixtures/zk382-illustration-accessibility.html");
  const panel = page.getByTestId("hole-illustration-preview");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("hole-illustration-evidence-warning")).toBeVisible();
  return panel;
}

for (const locale of ["en", "pseudo"] as const) for (const viewport of viewports) {
  test(`ZK-382 illustration text and controls fit at ${viewport.width}px, 130% root scale (${locale})`, async ({ page }, testInfo) => {
    const errors = trackPageErrors(page);
    await page.setViewportSize(viewport);
    await openFixture(page, locale);
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    await expect.poll(() => page.locator("html").getAttribute("data-locale")).toBe(locale);

    const measurement = await page.evaluate(() => {
      const root = document.documentElement;
      const panel = document.querySelector<HTMLElement>("[data-testid=hole-illustration-preview]")!;
      const text = [...panel.querySelectorAll<HTMLElement>("[data-testid=hole-illustration-metadata], [data-testid=hole-illustration-evidence-warning], fieldset, #hole-illustration-atlas-unavailable, [data-testid=hole-illustration-export-status]")];
      const caption = panel.querySelector<HTMLElement>("figcaption")!;
      const controls = [...panel.querySelectorAll<HTMLElement>("button, select, input[type=checkbox]")];
      const panelBox = panel.getBoundingClientRect();
      return {
        rootFont: getComputedStyle(root).fontSize,
        textFonts: text.map((element) => getComputedStyle(element).fontSize),
        captionFont: getComputedStyle(caption).fontSize,
        controlFonts: [...panel.querySelectorAll<HTMLElement>("button, select")].map((element) => getComputedStyle(element).fontSize),
        overflow: root.scrollWidth > root.clientWidth,
        panel: { left: panelBox.left, right: panelBox.right, width: panelBox.width },
        controls: controls.map((element) => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }; }),
        textOverflow: text.map((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })),
      };
    });
    expect(measurement.rootFont).toBe("20.8px");
    expect(measurement.textFonts.length).toBeGreaterThanOrEqual(4);
    expect(measurement.textFonts.every((font) => Math.abs(Number.parseFloat(font) - 15.6) < 0.1)).toBe(true);
    expect(Number.parseFloat(measurement.captionFont)).toBeGreaterThanOrEqual(15.6);
    expect(Number.parseFloat(measurement.captionFont)).toBeLessThanOrEqual(20.8);
    expect(measurement.controlFonts.length).toBeGreaterThanOrEqual(10);
    expect(measurement.controlFonts.every((font) => Math.abs(Number.parseFloat(font) - 17.333) < 0.1)).toBe(true);
    expect(measurement.overflow).toBe(false);
    expect(measurement.panel.left).toBeGreaterThanOrEqual(0);
    expect(measurement.panel.right).toBeLessThanOrEqual(viewport.width);
    for (const control of measurement.controls) {
      expect(control.left).toBeGreaterThanOrEqual(measurement.panel.left);
      expect(control.right).toBeLessThanOrEqual(measurement.panel.right + 0.5);
      expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
    }
    for (const text of measurement.textOverflow) expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
    if (locale === "pseudo" && viewport.width === 320) {
      const screenshotPath = testInfo.outputPath("zk382-illustration-pseudo-320-130pct.png");
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach("illustration-pseudo-320-130pct", { path: screenshotPath, contentType: "image/png" });
    }
    expect(errors).toEqual([]);
  });
}

test("ZK-382 illustration text keeps its baseline size at 100 percent root scale", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openFixture(page, "en");
  const panel = page.getByTestId("hole-illustration-preview");
  const sizes = await panel.evaluate((element) => [...element.querySelectorAll<HTMLElement>("[data-testid=hole-illustration-metadata], [data-testid=hole-illustration-evidence-warning], fieldset, #hole-illustration-atlas-unavailable, [data-testid=hole-illustration-export-status]")].map((node) => getComputedStyle(node).fontSize));
  expect(sizes.length).toBeGreaterThanOrEqual(4);
  expect(sizes.every((size) => size === "12px")).toBe(true);
  expect(errors).toEqual([]);
});

test("ZK-382 figure caption scales by 1.3 at the 570px breakpoint", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 570, height: 900 });
  const panel = await openFixture(page, "en");
  const caption = panel.locator("figcaption");
  const baseline = Number.parseFloat(await caption.evaluate((element) => getComputedStyle(element).fontSize));
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  const scaled = Number.parseFloat(await caption.evaluate((element) => getComputedStyle(element).fontSize));
  expect(baseline).toBe(16);
  expect(scaled).toBe(20.8);
  expect(scaled / baseline).toBeCloseTo(1.3, 5);
  expect(errors).toEqual([]);
});

test("ZK-382 illustration keeps keyboard close, route controls, and export guards", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setViewportSize({ width: 768, height: 900 });
  const panel = await openFixture(page, "en");
  const routeSource = panel.getByLabel("Route source");
  await routeSource.selectOption("draft");
  await expect(routeSource).toHaveValue("draft");
  const atlas = panel.getByRole("button", { name: "Download course atlas SVG" });
  await expect(atlas).toBeDisabled();
  const before = await page.evaluate(() => window.__illustrationFixture.calls());
  expect(before).toEqual([]);
  const close = panel.getByRole("button", { name: "Close hole illustration preview" });
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__illustrationFixture.calls())).toEqual(["close"]);
  await page.evaluate(() => window.__illustrationFixture.reset());
  const cancel = page.getByTestId("hole-illustration-cancel");
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__illustrationFixture.calls())).toEqual(["close"]);
  expect(errors).toEqual([]);
});
