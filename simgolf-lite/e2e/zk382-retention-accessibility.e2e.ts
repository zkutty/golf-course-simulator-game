import { expect, test, type Locator } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { ACHIEVEMENTS, achievementProgress, type AchievementContext } from "../src/game/retention/achievements";
import { downsampleHistory } from "../src/game/retention/records";
import type { CourseRecords } from "../src/game/retention/types";

const fixture = "/e2e/fixtures/zk382-retention.html";
const baselineOnly = process.env.RETENTION_BASELINE === "1";
const fonts = (surface: Locator) => surface.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>("h2,h3,strong,p,small,button,span,summary,li,label,select,option")).filter(item => Array.from(item.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map(item => ({ text: item.textContent, size: parseFloat(getComputedStyle(item).fontSize) })));

if (baselineOnly) for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`Retention baseline ${locale} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 800 });
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture);
    await page.getByTestId("opener").click();
    const dialog = page.getByTestId("retention-hub");
    const before = await fonts(dialog);
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    const after = await fonts(dialog);
    const measurement = await dialog.evaluate(element => ({ root: getComputedStyle(document.documentElement).fontSize, focusInside: element.contains(document.activeElement), regions: Array.from(element.querySelectorAll<HTMLElement>("section,nav,article")).map(item => ({ tag: item.tagName, client: item.clientWidth, scroll: item.scrollWidth })), unnamedCharts: element.querySelectorAll('svg[role="img"]:not([aria-label]):not([aria-labelledby])').length }));
    const evidence = { ...measurement, fonts: after.map((item, i) => ({ ...item, before: before[i].size, ratio: item.size / before[i].size })) };
    writeFileSync(join(tmpdir(), `zk382-retention-${locale}-${width}-baseline.json`), JSON.stringify(evidence, null, 2));
    await testInfo.attach("baseline", { body: JSON.stringify(evidence), contentType: "application/json" });
    await page.screenshot({ path: join(tmpdir(), `zk382-retention-${locale}-${width}-baseline.png`) });
    expect(evidence.focusInside, "modal must receive initial focus").toBe(true);
    expect(evidence.unnamedCharts).toBe(0);
    for (const item of evidence.fonts) expect(Math.abs(item.ratio - 1.3), item.text ?? "text").toBeLessThan(.01);
    for (const region of evidence.regions) expect(region.scroll).toBeLessThanOrEqual(region.client);
  });
}

if (!baselineOnly) {
  for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
    test(`Retention complete sections at measured 130%: ${locale} ${width}`, async ({ page }, testInfo) => {
      const errors: string[] = []; const rendererRequests: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) rendererRequests.push(request.url()); });
      const height = width === 320 ? 640 : 800;
      await page.setViewportSize({ width, height });
      await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
      await page.goto(fixture); await page.getByTestId("opener").click();
      const dialog = page.getByTestId("retention-hub");
      const initial = await page.evaluate(() => JSON.stringify((window as Window & { retentionFixture: unknown }).retentionFixture));
      const baselines = [];
      for (let tab = 0; tab < 4; tab++) {
        await dialog.getByRole("tab").nth(tab).click();
        if (tab === 0) for (const detail of await dialog.locator("details").all()) await detail.locator("summary").click();
        baselines.push(await fonts(dialog));
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
      const measurement: unknown[] = [];
      for (let tab = 0; tab < 4; tab++) {
        await dialog.getByRole("tab").nth(tab).click();
        if (tab === 0) for (const detail of await dialog.locator("details").all()) await detail.locator("summary").click();
        const scaled = await fonts(dialog); expect(scaled).toHaveLength(baselines[tab].length);
        const growth = scaled.map((item, i) => ({ ...item, baseline: baselines[tab][i].size, ratio: item.size / baselines[tab][i].size }));
        for (const item of growth) expect(Math.abs(item.ratio - 1.3), `${item.text}: ${item.baseline}->${item.size}`).toBeLessThan(.01);
        const body = dialog.getByRole("tabpanel");
        await expect(body).toHaveAttribute("aria-labelledby", `retention-tabs-tab-${tab}`);
        await body.focus(); await expect(body).toBeFocused();
        if (await body.evaluate(el => el.scrollHeight > el.clientHeight)) {
          await body.evaluate(el => { el.scrollTop = 0; }); await page.keyboard.press("PageDown");
          await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        }
        const regions = await dialog.locator(".cc-retention__panel, .cc-retention__header, .cc-retention__tabs, [role=tablist], .cc-retention__body, article").evaluateAll(elements => elements.map(el => { const e = el as HTMLElement; const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, client: e.clientWidth, scroll: e.scrollWidth }; }));
        for (const region of regions) { expect(region.left).toBeGreaterThanOrEqual(0); expect(region.right).toBeLessThanOrEqual(width); expect(region.scroll).toBeLessThanOrEqual(region.client); }
        const readable = body.locator("h3,p,strong,small,span,summary,li,label,select");
        for (const item of await readable.all()) {
          if (!(await item.isVisible())) continue;
          await item.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
          const bounds = await item.evaluate(el => { const e = el as HTMLElement; const r = e.getBoundingClientRect(); const p = e.closest('.cc-retention__body')!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, pLeft: p.left, pRight: p.right, pTop: p.top, pBottom: p.bottom, client: e.clientWidth, scroll: e.scrollWidth }; });
          expect(bounds.left).toBeGreaterThanOrEqual(bounds.pLeft); expect(bounds.right).toBeLessThanOrEqual(bounds.pRight);
          expect(bounds.top).toBeGreaterThanOrEqual(bounds.pTop); expect(bounds.bottom).toBeLessThanOrEqual(bounds.pBottom);
          expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
        }
        measurement.push({ tab, growth, regions });
        await testInfo.attach(`section-${tab}`, { body: await page.screenshot({ path: join(tmpdir(), `zk382-retention-${locale}-${width}-section-${tab}-green.png`) }), contentType: "image/png" });
      }
      expect(await page.locator("html").evaluate(el => getComputedStyle(el).fontSize)).toBe("20.8px");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      writeFileSync(join(tmpdir(), `zk382-retention-${locale}-${width}-green.json`), JSON.stringify(measurement, null, 2));
      await testInfo.attach("measured-fonts-and-bounds", { body: JSON.stringify(measurement), contentType: "application/json" });
      await dialog.getByRole("button").focus(); await expect(dialog.getByRole("button")).toBeFocused();
      const close = await dialog.getByRole("button").boundingBox(); expect(close!.y + close!.height).toBeLessThanOrEqual(height);
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByTestId("close-count")).toHaveText("1"); await expect(page.getByTestId("opener")).toBeFocused();
      expect(await page.evaluate(() => JSON.stringify((window as Window & { retentionFixture: unknown }).retentionFixture))).toBe(initial);
      await expect(page.getByTestId("immutable")).toHaveText("true"); expect(errors).toEqual([]); expect(rendererRequests).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
    });
  }

  for (const locale of ["en", "pseudo"] as const) {
    test(`Retention modal ownership, keyboard tabs, and close authority: ${locale}`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
      await page.goto(fixture); await page.getByTestId("opener").click();
      const dialog = page.getByTestId("retention-hub"); const close = dialog.getByRole("button");
      await expect(close).toBeFocused(); await expect(dialog).toHaveAttribute("aria-modal", "true");
      await page.keyboard.press("Shift+Tab"); await expect(dialog.locator("summary").last()).toBeFocused();
      await page.keyboard.press("Tab"); await expect(close).toBeFocused();
      await page.keyboard.press("Tab"); await expect(dialog.getByRole("tab").nth(0)).toBeFocused();
      await page.keyboard.press("ArrowRight"); await expect(dialog.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByRole("tabpanel")).toHaveAttribute("id", "retention-panel-records");
      await page.keyboard.press("End"); await expect(dialog.getByRole("tab").nth(3)).toBeFocused(); await expect(dialog.getByRole("tabpanel")).toHaveAttribute("id", "retention-panel-achievements");
      await page.keyboard.press("Home"); await expect(dialog.getByRole("tab").nth(0)).toBeFocused();
      await page.keyboard.press("ArrowLeft"); await expect(dialog.getByRole("tab").nth(3)).toBeFocused();
      await expect(dialog.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
      await dialog.getByRole("tab").nth(0).click(); await dialog.getByRole("tabpanel").focus();
      for (const summary of await dialog.locator("summary").all()) {
        await page.keyboard.press("Tab"); await expect(summary).toBeFocused();
        await page.keyboard.press("Enter"); await expect(summary.locator("..")).toHaveAttribute("open", "");
        await page.keyboard.press("Enter"); await expect(summary.locator("..")).not.toHaveAttribute("open", "");
      }
      await page.keyboard.press("Tab"); await expect(close).toBeFocused();
      for (const svg of await dialog.locator("svg:not([role=img])").all()) await expect(svg).toHaveAttribute("aria-hidden", "true");
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByTestId("close-count")).toHaveText("1"); await expect(page.getByTestId("opener")).toBeFocused();
      await page.getByTestId("opener").click(); await close.click(); await expect(page.getByTestId("close-count")).toHaveText("2"); await expect(page.getByTestId("opener")).toBeFocused();
      await page.getByTestId("opener").click(); await dialog.click({ position: { x: 1, y: 1 } }); await expect(page.getByTestId("close-count")).toHaveText("3"); await expect(page.getByTestId("opener")).toBeFocused();
    });

    test(`Retention exact records, filter identity, Hall order, and all27 achievements: ${locale}`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
      await page.goto(fixture); await page.getByTestId("opener").click();
      const dialog = page.getByTestId("retention-hub"); await dialog.getByRole("tab").nth(1).click();
      const cards = dialog.locator(".cc-retention__record strong");
      await expect(cards.nth(0)).toContainText("Morgan"); await expect(cards.nth(0)).toContainText("-3");
      await expect(cards.nth(1)).toHaveText("2"); await expect(cards.nth(2)).toHaveText("$123,456"); await expect(cards.nth(3)).toHaveText("1,234"); await expect(cards.nth(4)).toHaveText("7"); await expect(cards.nth(5)).toHaveText("1 · 4.00");
      await dialog.getByTestId("records-course-filter").selectOption("alpha"); await expect(cards.nth(0)).toHaveText("Casey · -1"); await expect(cards.nth(1)).toHaveText("1"); await expect(cards.nth(5)).toHaveText("alpha-hole · 3.00");
      await dialog.getByTestId("records-course-filter").selectOption("beta"); await expect(cards.nth(0)).toContainText("Morgan"); await expect(cards.nth(1)).toHaveText("1"); await expect(cards.nth(5)).toHaveText("beta-hole · 5.00");
      await dialog.getByRole("tab").nth(2).click(); await expect(dialog.locator(".cc-retention__hall-person strong").nth(0)).toContainText("Morgan"); await expect(dialog.locator(".cc-retention__hall-person strong").nth(1)).toHaveText("Casey");
      await dialog.getByRole("tab").nth(3).click();
      const context = await page.evaluate(() => (window as Window & { retentionFixture: { context: AchievementContext } }).retentionFixture.context);
      await expect(dialog.locator("article[data-achievement-id]")).toHaveCount(27);
      expect(await dialog.locator("article[data-achievement-id]").evaluateAll(items => items.map(item => item.getAttribute("data-achievement-id")))).toEqual(ACHIEVEMENTS.map(item => item.id));
      for (const definition of ACHIEVEMENTS) {
        const article = dialog.locator(`[data-achievement-id="${definition.id}"]`); const bar = article.getByRole("progressbar");
        await expect(bar).toHaveAttribute("aria-labelledby", `retention-achievement-${definition.id}`);
        expect(await bar.evaluate(el => ({ max: (el as HTMLProgressElement).max, value: (el as HTMLProgressElement).value }))).toEqual({ max: definition.target, value: Math.min(definition.target, achievementProgress(definition, context)) });
        if (definition.hidden) { await expect(article).not.toContainText(definition.title); await expect(article).not.toContainText(definition.hint); expect(await article.ariaSnapshot()).not.toContain(definition.title); expect(await article.ariaSnapshot()).not.toContain(definition.hint); await expect(bar).toHaveAccessibleName(locale === "en" ? "Hidden achievement" : /Hïddëñ/); }
        else { if (locale === "en") await expect(article.locator("h3")).toHaveText(definition.title); else await expect(article.locator("h3")).toHaveText(/^⟦.*···⟧$/); }
      }
      await expect(dialog.locator('[data-achievement-id="first-hole"]')).toHaveAttribute("data-earned", "true");
      await expect(dialog.locator('[data-achievement-id="first-hole"] .cc-retention__state')).toContainText(locale === "en" ? "Earned" : "Ëárñëd");
      await expect(dialog.locator('[data-achievement-id="front-nine"] .cc-retention__state')).toContainText(locale === "en" ? "Locked" : "Lôçkëd");
      await expect(page.getByTestId("immutable")).toHaveText("true");
    });
  }

  for (const variant of ["normal", "empty", "one", "long", "fractional"]) {
    test(`Retention exact plotted sample equivalents: ${variant}`, async ({ page }) => {
      await page.goto(`${fixture}?state=${variant}`); await page.getByTestId("opener").click();
      const records = await page.evaluate(() => (window as Window & { retentionFixture: { records: CourseRecords } }).retentionFixture.records);
      const samples = downsampleHistory(records.history, 180);
      for (let index = 1; index <= 4; index++) {
        const chart = page.getByTestId(`history-${index}`);
        if (samples.length === 0) { await expect(chart).toContainText("No history yet."); await expect(chart.locator("details,svg")).toHaveCount(0); continue; }
        await chart.locator("summary").click();
        expect(await chart.locator("li").evaluateAll(items => items.map(item => [Number(item.getAttribute("data-week")), Number(item.getAttribute("data-value"))]))).toEqual(samples.map(row => [row[0], row[index]]));
        if (samples.length > 1) {
          await expect(chart.getByRole("img")).toHaveAccessibleName(/history/);
          const min = Math.min(...samples.map(row => row[index])); const max = Math.max(...samples.map(row => row[index]));
          await expect(chart.locator("polyline")).toHaveAttribute("points", samples.map((row, i) => `${(i / (samples.length - 1)) * 560},${82 - ((row[index] - min) / Math.max(1, max - min)) * 70}`).join(" "));
        } else await expect(chart.locator("svg")).toHaveCount(0);
      }
      if (variant === "normal") {
        await expect(page.getByTestId("history-1").locator("p")).toHaveText("4 sampled observations · First $1,500 · Latest $1,800 · Low $1,400 · High $1,800");
        await expect(page.getByTestId("history-4").locator("p")).toHaveText("4 sampled observations · First -$100 · Latest $300 · Low -$100 · High $300");
      }
      if (variant === "fractional") {
        await expect(page.getByTestId("history-1").locator("li").nth(0)).toHaveText("Week 1: $1,500.123456789");
        await expect(page.getByTestId("history-1").locator("li").nth(1)).toHaveText("Week 2: -$1,500.87654321");
        await expect(page.getByTestId("history-2").locator("li").nth(0)).toHaveText("Week 1: 61.123456789");
        await expect(page.getByTestId("history-4").locator("li").nth(0)).toHaveText("Week 1: -$100.87654321");
      }
      await expect(page.getByTestId("immutable")).toHaveText("true");
    });
  }

  test("Retention reveals earned hidden awards and preserves empty records", async ({ page }) => {
    await page.goto(`${fixture}?state=hidden-earned`); await page.getByTestId("opener").click(); await page.getByRole("tab").nth(3).click();
    const revealed = page.locator('[data-achievement-id="hidden-ace-pair"]'); await expect(revealed.locator("h3")).toHaveText("Lightning Twice"); await expect(revealed.getByRole("progressbar")).toHaveAccessibleName("Lightning Twice"); await expect(revealed).toHaveAttribute("data-earned", "true");
    await page.goto(`${fixture}?state=empty`); await page.getByTestId("opener").click(); await page.getByRole("tab").nth(1).click();
    await expect(page.getByTestId("records-course-filter")).toHaveCount(0); await expect(page.locator(".cc-retention__record strong").nth(0)).toHaveText("—"); await expect(page.locator(".cc-retention__record strong").nth(1)).toHaveText("0");
    await page.getByRole("tab").nth(2).click(); await expect(page.getByRole("tabpanel")).toContainText("The Hall of Fame is waiting for its first memorable round.");
  });
}
