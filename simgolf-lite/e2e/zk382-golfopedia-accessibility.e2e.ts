import { expect, test, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = "/e2e/fixtures/zk382-golfopedia-accessibility.html";
const bounds = (control: Locator) => control.evaluate((element) => {
  const r = element.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
});
const fonts = (dialog: Locator) => dialog.evaluate((element) => {
  const selectors = ["header", "header > div > div > div", "[role=tab]", "[role=tabpanel]", "[data-golfopedia-sidebar-entry]", "input", "h2", "article p", "article li", "article div", "article dt", "article dd", "header button"];
  return selectors.flatMap((selector) => Array.from(element.querySelectorAll<HTMLElement>(selector)).map((item) => ({ selector, text: item.textContent?.slice(0, 50), size: Number.parseFloat(getComputedStyle(item).fontSize) })));
});

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`Golfopedia contains reachable controls with measured 130% text: ${locale} ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const height = width === 320 ? 640 : 800;
    await page.setViewportSize({ width, height });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture);
    await page.getByTestId("open-golfopedia").click();
    const dialog = page.getByRole("dialog");
    const panel = dialog.getByRole("tabpanel");
    const tabs = dialog.getByRole("tab");
    const baselines = [];
    for (let index = 0; index < 4; index++) { await tabs.nth(index).click(); baselines.push(await fonts(dialog)); }
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    const measurements = [];
    for (let index = 0; index < 4; index++) {
      await tabs.nth(index).click();
      const scaled = await fonts(dialog);
      const panelBounds = await bounds(panel);
      const articleBounds = await bounds(dialog.getByTestId("golfopedia-entry"));
      measurements.push({ index, rootFont: await page.locator("html").evaluate((el) => getComputedStyle(el).fontSize), panelBounds, articleBounds, fonts: scaled.map((font, item) => ({ ...font, baseline: baselines[index][item].size, ratio: font.size / baselines[index][item].size })) });
    }
    writeFileSync(join(tmpdir(), `zk382-golfopedia-${locale}-${width}.json`), JSON.stringify(measurements, null, 2));
    await testInfo.attach("computed-fonts-and-bounds", { body: JSON.stringify(measurements), contentType: "application/json" });
    for (let index = 0; index < 4; index++) {
      await tabs.nth(index).click();
      if (locale === "pseudo") {
        await expect(tabs.nth(index)).toHaveText(/^⟦.*···⟧$/);
        await expect(dialog.getByTestId("golfopedia-entry").locator(":scope > div").first()).toHaveText(/^⟦.*···⟧$/);
      }
      for (const font of measurements[index].fonts) expect(Math.abs(font.ratio - 1.3), `${font.selector} ${font.text}: ${font.baseline} -> ${font.size}`).toBeLessThan(.01);
      const dialogBounds = await bounds(dialog);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      for (const region of [dialog.locator("header"), panel, dialog.locator("nav"), dialog.getByTestId("golfopedia-entry")]) {
        const rect = await bounds(region);
        expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.top).toBeGreaterThanOrEqual(0); expect(rect.bottom).toBeLessThanOrEqual(height);
        expect(rect.scrollWidth).toBeLessThanOrEqual(rect.clientWidth);
      }
      for (let tab = 0; tab < 4; tab++) {
        await tabs.nth(tab).focus(); await expect(tabs.nth(tab)).toBeFocused();
        const rect = await bounds(tabs.nth(tab));
        expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.top).toBeGreaterThanOrEqual(0); expect(rect.bottom).toBeLessThanOrEqual(height);
      }
      const controls = dialog.locator("header button:not([role=tab]), input, [data-golfopedia-sidebar-entry]");
      for (let item = 0; item < await controls.count(); item++) {
        const control = controls.nth(item);
        await control.focus(); await expect(control).toBeFocused();
        const rect = await bounds(control);
        expect(rect.left).toBeGreaterThanOrEqual(dialogBounds.left); expect(rect.right).toBeLessThanOrEqual(dialogBounds.right);
        expect(rect.top).toBeGreaterThanOrEqual(0); expect(rect.bottom).toBeLessThanOrEqual(height);
        expect(rect.scrollWidth).toBeLessThanOrEqual(rect.clientWidth);
      }
      const article = dialog.getByTestId("golfopedia-entry");
      await article.focus(); await expect(article).toBeFocused();
      await page.keyboard.press("Home");
      await expect.poll(() => article.evaluate((element) => element.scrollTop)).toBe(0);
      await page.keyboard.press("PageDown");
      if (await article.evaluate((element) => element.scrollHeight > element.clientHeight)) {
        await expect.poll(() => article.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }
      if (index === 3) {
        const rows = dialog.getByTestId("current-keybindings").locator("dt, dd");
        for (let row = 0; row < await rows.count(); row++) {
          await rows.nth(row).evaluate((element) => element.scrollIntoView({ block: "center" }));
          const rowBounds = await bounds(rows.nth(row));
          const articleBounds = await bounds(article);
          expect(rowBounds.left).toBeGreaterThanOrEqual(articleBounds.left);
          expect(rowBounds.right).toBeLessThanOrEqual(articleBounds.right);
          expect(rowBounds.top).toBeGreaterThanOrEqual(articleBounds.top);
          expect(rowBounds.bottom).toBeLessThanOrEqual(articleBounds.bottom);
        }
      }
      const outsideText = await dialog.evaluate((element) => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const outside: string[] = [];
        while (nodes.nextNode()) {
          if (!nodes.currentNode.textContent?.trim() || nodes.currentNode.parentElement?.closest("style")) continue;
          const range = document.createRange(); range.selectNodeContents(nodes.currentNode);
          for (const rect of range.getClientRects()) {
            // Vertically offscreen text belongs to an explicitly scrollable nav/article.
            if (rect.bottom > 0 && rect.top < viewport.height && (rect.left < 0 || rect.right > viewport.width)) outside.push(nodes.currentNode.textContent);
          }
        }
        return outside;
      });
      expect(outsideText).toEqual([]);
      await expect(panel).toHaveAttribute("aria-labelledby", (await tabs.nth(index).getAttribute("id"))!);
      await expect(tabs.nth(index)).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);
    }
    await dialog.getByTestId("golfopedia-entry").evaluate((element) => { element.scrollTop = 0; });
    await testInfo.attach("scaled-controls-layout", { body: await page.screenshot({ path: join(tmpdir(), `zk382-golfopedia-${locale}-${width}-green.png`) }), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0); await expect(page.getByTestId("open-golfopedia")).toBeFocused();
    await expect(page.getByTestId("close-count")).toHaveText("1");
    expect(errors).toEqual([]);
  });
}

test("Golfopedia preserves localized navigation, search, current bindings, focus and tooltip-free states", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({ version: 5, accessibility: { keybindings: { pause: "KeyP" } } }));
  });
  await page.goto(fixture);
  const opener = page.getByTestId("open-golfopedia"); await opener.click();
  const dialog = page.getByRole("dialog"); const tabs = dialog.getByRole("tab");
  const search = dialog.getByRole("textbox");
  await expect(search).toBeFocused();
  await tabs.first().focus();
  for (const [key, index] of [["ArrowRight", 1], ["End", 3], ["ArrowRight", 0], ["ArrowLeft", 3], ["Home", 0]] as const) {
    await page.keyboard.press(key); await expect(tabs.nth(index)).toBeFocused();
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    expect(await tabs.evaluateAll((items) => items.filter((item) => (item as HTMLButtonElement).tabIndex === 0).length)).toBe(1);
  }
  const fairway = dialog.getByRole("button", { name: "Fairway", exact: true });
  await fairway.hover(); await fairway.focus();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(fairway).toHaveAttribute("aria-current", "page"); await expect(fairway).toHaveCSS("border-left-width", "4px");
  await dialog.getByRole("button", { name: "Rough", exact: true }).click();
  await expect(dialog.getByTestId("golfopedia-entry")).toHaveAttribute("data-entry-id", "terrain-rough");
  await search.fill("putting");
  await expect(dialog.locator("[data-golfopedia-sidebar-entry]")).not.toHaveCount(0);
  await expect(dialog.getByTestId("golfopedia-entry")).toContainText(/putting/i);
  await search.fill("unmatchableqwerty"); await expect(dialog.locator("nav")).toContainText("No entries match that search");
  await expect(dialog.locator("[data-golfopedia-sidebar-entry]")).toHaveCount(0);
  await tabs.nth(3).click(); await expect(search).toHaveValue("");
  const bindings = dialog.getByTestId("current-keybindings");
  await expect(bindings.locator("dt").filter({ hasText: "Pause / resume" }).locator("+ dd")).toHaveText("P");
  await tabs.nth(1).hover(); await expect(page.getByRole("tooltip")).toHaveCount(0);
  await tabs.nth(1).click(); await expect(tabs.nth(1)).toHaveCSS("box-shadow", /rgb\(230, 188, 100\)/);
  const last = dialog.getByTestId("golfopedia-entry"); await last.focus(); await page.keyboard.press("Tab");
  const close = dialog.getByRole("button", { name: "Close Golfopedia" }); await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(last).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await expect(page.getByTestId("close-count")).toHaveText("1");
  await opener.click(); await dialog.getByRole("button", { name: "Close Golfopedia" }).click();
  await expect(page.getByTestId("close-count")).toHaveText("2"); await expect(opener).toBeFocused();
});


test("Golfopedia preserves the requested initial entry and backdrop close callback", async ({ page }) => {
  await page.goto(`${fixture}?initialEntry=terrain-green`);
  await page.getByTestId("open-golfopedia").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("golfopedia-entry")).toHaveAttribute("data-entry-id", "terrain-green");
  await expect(dialog.getByRole("button", { name: "Green", exact: true })).toHaveAttribute("aria-current", "page");
  await dialog.click({ position: { x: 1, y: 1 } });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("close-count")).toHaveText("1");
  await expect(page.getByTestId("open-golfopedia")).toBeFocused();
});
