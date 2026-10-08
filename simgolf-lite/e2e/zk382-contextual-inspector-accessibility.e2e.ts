import { expect, test } from "@playwright/test";

test("ZK-382 inspector tabs support keyboard roving focus and preserve actions", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/e2e/fixtures/zk382-contextual-inspector.html");
  const inspector = page.getByTestId("contextual-inspector");
  const tabs = inspector.getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await expect(tabs.nth(0)).toHaveAttribute("tabindex", "0");
  await expect(tabs.nth(1)).toHaveAttribute("tabindex", "-1");

  await tabs.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(0)).toHaveAttribute("tabindex", "-1");
  await expect.poll(() => tabs.evaluateAll((elements) => elements.filter((el) => (el as HTMLButtonElement).tabIndex === 0).length)).toBe(1);

  await page.keyboard.press("End");
  await expect(tabs.nth(4)).toBeFocused();
  await expect(inspector.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "contextual-inspector-tab-legacy");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(4)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toBeFocused();

  await inspector.getByRole("button", { name: "Cozy view" }).click();
  await inspector.getByRole("button", { name: "Architect view" }).click();
  await expect(page.getByTestId("callback-log")).toHaveJSProperty("value", "view-cozy,view-architect");
  await tabs.nth(1).click();
  for (const preset of ["Relaxed", "Balanced", "Brisk"]) {
    await inspector.getByRole("button", { name: preset }).click();
  }
  await expect(page.getByTestId("callback-log")).toHaveJSProperty("value", "view-cozy,view-architect,pace-relaxed,pace-balanced,pace-brisk");

  for (const [index, key] of [[1, "live"], [2, "property"], [3, "people"], [4, "legacy"], [0, "courses"]] as const) {
    await tabs.nth(index).click();
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    await inspector.getByRole("button", { name: "Open details" }).click();
    await expect.poll(() => page.getByTestId("callback-log").evaluate((output: HTMLOutputElement) => output.value)).toContain(`open-${key}`);
  }
  await inspector.getByRole("button", { name: "Close contextual inspector" }).click();
  await expect.poll(() => page.getByTestId("callback-log").evaluate((output: HTMLOutputElement) => output.value)).toMatch(/close$/);
});

test("ZK-382 inspector remains contained with 130 percent pseudo-locale text on a narrow screen", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("coursecraft_locale", "pseudo"));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/e2e/fixtures/zk382-contextual-inspector.html");
  await inspectorScaleTextBy(page, 1.3);

  const inspector = page.getByTestId("contextual-inspector");
  await expect(inspector.getByRole("tab").first()).toBeVisible();
  await expect(inspector.locator(".cc-inspector-icon-button")).toBeVisible();
  const layout = await inspector.evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    const tabs = panel.querySelectorAll<HTMLElement>("[role=tab]");
    return {
      panelLeft: bounds.left,
      panelRight: bounds.right,
      panelWidth: bounds.width,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      tabCount: tabs.length,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.panelLeft).toBeGreaterThanOrEqual(0);
  expect(layout.panelRight).toBeLessThanOrEqual(320);
  expect(layout.panelScrollWidth).toBeLessThanOrEqual(layout.panelClientWidth);
  expect(layout.documentWidth).toBeLessThanOrEqual(320);
  expect(layout.tabCount).toBe(5);
  await inspector.screenshot({ path: "artifacts/zk382/contextual-inspector-320px-130pct-pseudo.png" });

  for (let tabIndex = 0; tabIndex < await inspector.getByRole("tab").count(); tabIndex += 1) {
    const tab = inspector.getByRole("tab").nth(tabIndex);
    await tab.click();
    await inspectorScaleTextBy(page, 1);
    const baselineSizes = await inspector.getByRole("tabpanel").evaluate((pane) => {
      const metric = pane.querySelector<HTMLElement>(".cc-inspector-metric > div:nth-child(2)")!;
      const inheritedHeader = pane.closest<HTMLElement>("[data-testid=contextual-inspector]")!.querySelector<HTMLElement>("header > div:first-child")!;
      return {
        metric: Number.parseFloat(getComputedStyle(metric).fontSize),
        inheritedHeader: Number.parseFloat(getComputedStyle(inheritedHeader).fontSize),
      };
    });
    await inspectorScaleTextBy(page, 1.3);
    await tab.focus();
    await expect(tab).toBeFocused();
    const paneTextScale = await inspector.getByRole("tabpanel").evaluate((pane) => {
      const text = pane.querySelector<HTMLElement>(".cc-inspector-metric > div:nth-child(2)")!;
      const inheritedHeader = pane.closest<HTMLElement>("[data-testid=contextual-inspector]")!.querySelector<HTMLElement>("header > div:first-child")!;
      return {
        metricActual: Number.parseFloat(getComputedStyle(text).fontSize),
        inheritedHeaderActual: Number.parseFloat(getComputedStyle(inheritedHeader).fontSize),
      };
    });
    expect(Math.abs(paneTextScale.metricActual / baselineSizes.metric - 1.3)).toBeLessThan(0.01);
    expect(Math.abs(paneTextScale.inheritedHeaderActual / baselineSizes.inheritedHeader - 1.3)).toBeLessThan(0.01);
    const fullyVisible = await tab.evaluate((element) => {
      const panel = element.closest<HTMLElement>("[data-testid=contextual-inspector]")!;
      const tabBounds = element.getBoundingClientRect();
      const panelBounds = panel.getBoundingClientRect();
      return tabBounds.left >= panelBounds.left && tabBounds.right <= panelBounds.right;
    });
    expect(fullyVisible).toBe(true);

    for (const button of await inspector.getByRole("button").all()) {
      await button.focus();
      await expect(button).toBeFocused();
      const fullyVisible = await button.evaluate((element) => {
        const panel = element.closest<HTMLElement>("[data-testid=contextual-inspector]")!;
        const controlBounds = element.getBoundingClientRect();
        const panelBounds = panel.getBoundingClientRect();
        return controlBounds.left >= panelBounds.left
          && controlBounds.right <= panelBounds.right
          && controlBounds.top >= panelBounds.top
          && controlBounds.bottom <= panelBounds.bottom;
      });
      expect(fullyVisible).toBe(true);
    }
  }
});

async function inspectorScaleTextBy(page: import("@playwright/test").Page, scale: number) {
  await page.evaluate((factor) => {
    const panel = document.querySelector<HTMLElement>("[data-testid=contextual-inspector]")!;
    const elements = [panel, ...panel.querySelectorAll<HTMLElement>("*")];

    for (const element of elements) {
      if (element.dataset.zk382Scaled !== "true") continue;
      const originalSize = element.dataset.zk382OriginalInlineFontSize ?? "";
      const originalPriority = element.dataset.zk382OriginalInlineFontPriority ?? "";
      if (originalSize) element.style.setProperty("font-size", originalSize, originalPriority);
      else element.style.removeProperty("font-size");
      delete element.dataset.zk382Scaled;
      delete element.dataset.zk382OriginalInlineFontSize;
      delete element.dataset.zk382OriginalInlineFontPriority;
      delete element.dataset.zk382BaselineFontSize;
    }

    const baselines = elements.map((element) => ({
      element,
      computedFontSize: getComputedStyle(element).fontSize,
      originalInlineFontSize: element.style.getPropertyValue("font-size"),
      originalInlineFontPriority: element.style.getPropertyPriority("font-size"),
    }));

    for (const { element, computedFontSize, originalInlineFontSize, originalInlineFontPriority } of baselines) {
      element.dataset.zk382BaselineFontSize = computedFontSize;
      element.dataset.zk382OriginalInlineFontSize = originalInlineFontSize;
      element.dataset.zk382OriginalInlineFontPriority = originalInlineFontPriority;
      element.dataset.zk382Scaled = "true";
      element.style.setProperty("font-size", `${Number.parseFloat(computedFontSize) * factor}px`, "important");
    }
  }, scale);
}
