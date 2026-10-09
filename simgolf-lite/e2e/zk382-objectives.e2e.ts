import { expect, test, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = "/e2e/fixtures/zk382-objectives.html";
const fonts = (surface: Locator) => surface.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("div, span, b, button")).filter((item) => Array.from(item.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map((item) => ({ text: item.textContent, tag: item.tagName, size: Number.parseFloat(getComputedStyle(item).fontSize) })));
const bounds = (surface: Locator) => surface.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }; });

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`Objectives measured root 130% and readable regions: ${locale} ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = []; const rendererRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) rendererRequests.push(request.url()); });
    const height = width === 320 ? 640 : 800;
    await page.setViewportSize({ width, height });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture);
    const original = await page.evaluate(() => JSON.stringify((window as Window & { objectivesFixture: unknown }).objectivesFixture));
    const mini = page.getByTestId("mini"); const miniBaseline = await fonts(mini);
    await page.getByTestId("open-objectives").click();
    const harness = page.getByTestId("modal-harness"); const baseline = await fonts(harness);
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    const scaled = await fonts(harness); const scaledMini = await fonts(mini);
    const measurement = { root: await page.locator("html").evaluate((el) => getComputedStyle(el).fontSize), card: await bounds(harness.locator('[data-gameui="card"]')), modal: scaled.map((item, index) => ({ ...item, baseline: baseline[index].size, ratio: item.size / baseline[index].size })), mini: scaledMini.map((item, index) => ({ ...item, baseline: miniBaseline[index].size, ratio: item.size / miniBaseline[index].size })) };
    writeFileSync(join(tmpdir(), `zk382-objectives-${locale}-${width}.json`), JSON.stringify(measurement, null, 2));
    await testInfo.attach("font-and-layout-measurements", { body: JSON.stringify(measurement), contentType: "application/json" });
    for (const item of [...measurement.modal, ...measurement.mini]) expect(Math.abs(item.ratio - 1.3), `${item.tag} ${item.text}: ${item.baseline} -> ${item.size}`).toBeLessThan(.01);
    const dialog = page.getByRole("dialog", { name: locale === "en" ? "Objectives" : /Ôbjëçtïvës/ });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const region of [dialog, dialog.locator(".cc-objectives-panel"), dialog.locator(".cc-objectives-body"), mini]) {
      const r = await bounds(region); expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(width);
      expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth);
    }
    const body = dialog.locator(".cc-objectives-body"); await body.focus(); await expect(body).toBeFocused();
    await page.keyboard.press("PageDown"); await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await body.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
    const texts = body.locator(".cc-objective-title, .cc-objective-description, .cc-objective-deadline, .cc-objective-state, .cc-objective-metric, .cc-objective-value");
    for (let index = 0; index < await texts.count(); index++) {
      await texts.nth(index).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      const r = await bounds(texts.nth(index)); const container = await bounds(body);
      expect(r.left).toBeGreaterThanOrEqual(container.left); expect(r.right).toBeLessThanOrEqual(container.right);
      expect(r.top).toBeGreaterThanOrEqual(container.top); expect(r.bottom).toBeLessThanOrEqual(container.bottom);
      expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth);
    }
    const close = dialog.getByRole("button"); await close.focus(); await expect(close).toBeFocused();
    const r = await bounds(close); expect(r.top).toBeGreaterThanOrEqual(0); expect(r.bottom).toBeLessThanOrEqual(height);
    await body.evaluate((el) => { el.scrollTop = 0; });
    await testInfo.attach("scaled-objectives", { body: await page.screenshot({ path: join(tmpdir(), `zk382-objectives-${locale}-${width}-green.png`) }), contentType: "image/png" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("close-count")).toHaveText("1"); await expect(page.getByTestId("open-objectives")).toBeFocused();
    expect(await page.evaluate(() => JSON.stringify((window as Window & { objectivesFixture: unknown }).objectivesFixture))).toBe(original);
    expect(errors).toEqual([]); expect(rendererRequests).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
  });
}

for (const locale of ["en", "pseudo"] as const) {
  test(`Objectives preserves metric values, predicates, authored labels, deadlines and callbacks: ${locale}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture);
    const original = await page.evaluate(() => JSON.stringify((window as Window & { objectivesFixture: unknown }).objectivesFixture));
    const mini = page.getByTestId("mini");
    await expect(mini.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "45");
    await expect(mini).toContainText("1/4");
    await mini.getByRole("button").click(); await expect(page.getByTestId("open-count")).toHaveText("1");
    const dialog = page.getByRole("dialog"); const body = dialog.locator(".cc-objectives-body"); const close = dialog.getByRole("button");
    await expect(dialog).toHaveAttribute("aria-modal", "true"); await expect(body).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(close).toBeFocused();
    await page.keyboard.press("Tab"); await expect(body).toBeFocused();
    await page.keyboard.press("Tab"); await expect(close).toBeFocused();
    await page.keyboard.press("Tab"); await expect(body).toBeFocused();
    const values = ["$2,500 / $5,000", "30 / 60", "34.2 / 68.4", "3 / 6", "9 / 18", "1 / 2", "$1,234 / $2,468", "2 / 4", "500 / 1,000", "40% / 80%", "— / ≤ 3"];
    const metrics = ["Cash", "Reputation", "Course rating", "Holes built", "Published holes", "Published courses", "Weekly profit", "Profitable weeks in a row", "Total rounds played", "Course condition", "Tournament placement"];
    const conditions = dialog.locator('[data-objective-id="metrics"] .cc-objective-condition');
    await expect(conditions).toHaveCount(11);
    for (let index = 0; index < 11; index++) {
      const condition = conditions.nth(index); const bar = condition.getByRole("progressbar");
      await expect(condition.locator(".cc-objective-value")).toContainText(values[index]);
      await expect(bar).toHaveAttribute("aria-valuenow", index === 10 ? "0" : "50");
      await expect(bar).toHaveAttribute("aria-valuemin", "0"); await expect(bar).toHaveAttribute("aria-valuemax", "100");
      await expect(bar).toHaveAttribute("aria-valuetext", new RegExp(values[index].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      expect(await bar.getAttribute("aria-label")).toBeTruthy();
      if (locale === "en") await expect(condition.locator(".cc-objective-metric")).toHaveText(metrics[index]);
      else await expect(condition.locator(".cc-objective-metric")).toHaveText(/^⟦.*···⟧$/);
      await expect(condition.locator(".cc-objective-state")).toContainText(locale === "en" ? "Pending" : "Pëñdïñg");
    }
    await expect(dialog.locator('[data-objective-id="nonpositive"]').getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(dialog.locator('[data-objective-id="completed"]').getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(dialog.locator('[data-objective-id="completed"] > .cc-objective-heading .cc-objective-state')).toContainText(locale === "en" ? "Met" : "Mët");
    await expect(dialog.locator('[data-objective-id="completed"] .cc-objective-deadline')).toContainText(locale === "en" ? "Completed week 8" : "wëëk 8");
    await expect(dialog.locator('[data-objective-id="metrics"] .cc-objective-deadline')).toContainText(locale === "en" ? "By week 12 (2 weeks left)" : "wëëk 12");
    await expect(dialog.locator('[data-objective-id="keyed"] .cc-objective-deadline')).not.toContainText(locale === "en" ? "left" : "lëft");
    await expect(dialog.locator('[data-objective-id="keyed"] .cc-objective-title')).toContainText(locale === "en" ? "Open three holes" : "Ôpëñ thrëë hôlës");
    await expect(dialog.locator('[data-objective-id="keyed"] .cc-objective-description')).toContainText(locale === "en" ? "Build 3 playable holes." : "Büïld 3 pláÿáblë hôlës.");
    await expect(dialog.locator('[data-objective-id="metrics"] .cc-objective-title')).toHaveText("An authored goal with a long descriptive title that must remain completely readable on a narrow screen");
    await expect(dialog.locator('[data-objective-id="missing"]').getByRole("progressbar")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dialog.locator(".cc-objective-progress-fill").first()).toHaveCSS("transition-duration", "0s");
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("close-count")).toHaveText("1"); await expect(mini.getByRole("button")).toBeFocused();
    expect(await page.evaluate(() => JSON.stringify((window as Window & { objectivesFixture: unknown }).objectivesFixture))).toBe(original);
    await mini.getByRole("button").click(); await dialog.getByRole("button").click();
    await expect(page.getByTestId("close-count")).toHaveText("2"); await expect(mini.getByRole("button")).toBeFocused();
    await mini.getByRole("button").click(); await dialog.click({ position: { x: 1, y: 1 } });
    await expect(page.getByTestId("close-count")).toHaveText("3"); await expect(mini.getByRole("button")).toBeFocused();
  });
}

for (const scenario of ["freeplay", "empty", "won", "keyed", "emptyconditions", "lessEqualMet", "negativeTarget"]) {
  test(`Objectives preserves ${scenario} presentation and mini callback`, async ({ page }) => {
    await page.goto(`${fixture}?scenario=${scenario}`);
    const mini = page.getByTestId("mini");
    if (scenario === "freeplay") {
      await expect(mini.getByRole("button")).toHaveCount(0); await expect(mini).toContainText("FREE PLAY");
      await expect(mini.getByRole("progressbar")).toHaveCount(0); await page.getByTestId("open-objectives").click();
    } else {
      await mini.getByRole("button").click(); await expect(page.getByTestId("open-count")).toHaveText("1");
    }
    const dialog = page.getByRole("dialog");
    if (scenario === "freeplay") await expect(dialog).toContainText("Free play — no goals. Enjoy the course.");
    if (scenario === "empty") { await expect(dialog).toContainText("No objectives have been assigned."); await expect(mini).toContainText("0/0"); }
    if (scenario === "won") { await expect(mini).toContainText("All objectives complete!"); await expect(mini).toContainText("1/1"); await expect(mini.getByRole("progressbar")).toHaveCount(0); }
    if (scenario === "keyed") { await expect(mini).toContainText("Open three holes"); await expect(mini).not.toContainText("Raw fallback title"); await expect(mini.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67"); }
    if (scenario === "emptyconditions") { await expect(mini.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0"); await expect(dialog.getByRole("progressbar")).toHaveCount(0); }
    if (scenario === "lessEqualMet") { await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"); await expect(dialog.locator(".cc-objective-value")).toHaveText("2 / ≤ 3"); }
    if (scenario === "negativeTarget") { await expect(mini.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"); await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"); }
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(page.getByTestId("close-count")).toHaveText("1");
  });
}
