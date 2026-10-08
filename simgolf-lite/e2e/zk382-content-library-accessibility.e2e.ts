import { expect, test } from "@playwright/test";

test("ZK-382 content library closes accessibly and preserves focus across locale changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/zk382-content-library-accessibility.html", { waitUntil: "networkidle" });
  const opener = page.getByTestId("open-library");
  await opener.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("content-library");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Close content library" })).toBeFocused();

  const author = panel.locator("input").nth(1);
  await author.focus();
  await page.evaluate(() => document.dispatchEvent(new Event("zk382-locale-change")));
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await expect(author).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("close-count")).toHaveText("1");
  await expect(opener).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("close-count")).toHaveText("1");

  await opener.focus();
  await page.keyboard.press("Enter");
  const reopened = page.getByTestId("content-library");
  await reopened.locator("header button").click();
  await expect(reopened).toHaveCount(0);
  await expect(page.getByTestId("close-count")).toHaveText("2");
  await expect(opener).toBeFocused();
  expect(errors).toEqual([]);
});

test("ZK-382 content library keeps long metadata readable and actions reachable at 130 percent", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("coursecraft_locale", "pseudo"));

  for (const viewport of [{ width: 320, height: 640 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/e2e/fixtures/zk382-content-library-accessibility.html", { waitUntil: "networkidle" });
    await page.getByTestId("open-library").click();
    const panel = page.getByTestId("content-library");
    const article = panel.locator("article");
    await expect(article).toHaveCount(1);
    const title = article.locator("strong");
    const summary = article.locator("small");
    const titleBaseline = await title.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    const summaryBaseline = await summary.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    await scalePanelTextBy(page, 1.3);
    const titleScaled = await title.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    const summaryScaled = await summary.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(Math.abs(titleScaled / titleBaseline - 1.3)).toBeLessThan(0.01);
    expect(Math.abs(summaryScaled / summaryBaseline - 1.3)).toBeLessThan(0.01);

    await expect(title).toContainText("A very long course title");
    await expect(article).toContainText("LôñgÁüthôr");
    await expect(article).toContainText("Pláÿër-büïlt-sôürçë-");
    const bounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    const focusables = panel.locator("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)");
    const focusableCount = await focusables.count();
    expect(focusableCount).toBeGreaterThan(1);
    const closeButton = panel.locator("header button");
    await closeButton.focus();
    for (let index = 1; index < focusableCount; index += 1) {
      await page.keyboard.press("Tab");
      await expect(focusables.nth(index)).toBeFocused();
      const controlBounds = await focusables.nth(index).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const panelRect = element.closest<HTMLElement>("[data-testid=content-library]")!.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, panel: panelRect };
      });
      expect(controlBounds.left).toBeGreaterThanOrEqual(controlBounds.panel.left);
      expect(controlBounds.right).toBeLessThanOrEqual(controlBounds.panel.right);
      expect(controlBounds.top).toBeGreaterThanOrEqual(controlBounds.panel.top);
      expect(controlBounds.bottom).toBeLessThanOrEqual(controlBounds.panel.bottom);
    }

    const attestation = panel.locator('input[type="checkbox"]');
    await attestation.focus();
    await page.keyboard.press("Space");
    await expect(attestation).toBeChecked();
    await expect(panel.locator("button").nth(2)).toBeEnabled();
    await page.keyboard.press("Space");
    await expect(attestation).not.toBeChecked();
  }
  expect(errors).toEqual([]);
});

async function scalePanelTextBy(page: import("@playwright/test").Page, scale: number) {
  await page.evaluate((factor) => {
    const panel = document.querySelector<HTMLElement>("[data-testid=content-library]")!;
    const elements = [panel, ...panel.querySelectorAll<HTMLElement>("*")];
    const baselines = elements.map((element) => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of baselines) {
      if (Number.isFinite(size)) {
        element.dataset.zk382BaselineFontSize = String(size);
        element.style.setProperty("font-size", `${size * factor}px`, "important");
      }
    }
    const applyToNewContent = (root: HTMLElement) => {
      const added = [root, ...root.querySelectorAll<HTMLElement>("*")];
      for (const element of added) {
        if (element.dataset.zk382BaselineFontSize) continue;
        const computed = Number.parseFloat(getComputedStyle(element).fontSize);
        if (!Number.isFinite(computed)) continue;
        const baseline = computed / factor;
        element.dataset.zk382BaselineFontSize = String(baseline);
        element.style.setProperty("font-size", `${baseline * factor}px`, "important");
      }
    };
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) applyToNewContent(node);
      }
    }).observe(panel, { childList: true, subtree: true });
  }, scale);
}
