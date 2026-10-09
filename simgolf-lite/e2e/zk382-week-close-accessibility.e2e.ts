import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import type { M49CourseReport } from "../src/game/m49/types";
import { translate } from "../src/i18n/core";
import { formatCurrency } from "../src/i18n/format";
import { biomeUiTheme, biomeUiStyle } from "../src/ui/biomeUiTheme";

test.setTimeout(60000);
test.use({ video: "off", trace: "retain-on-failure" });
const fixture = "/e2e/fixtures/zk382-week-close.html";
async function open(page: Page, query = "") { await page.goto(fixture + query); await page.getByTestId("opener").click(); await expect(page.getByTestId("week-close-continue")).toBeFocused(); }
const fonts = (panel: Locator) => panel.evaluate(el => Array.from(el.querySelectorAll<HTMLElement>("*")).filter(item => item.getClientRects().length && Array.from(item.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map(item => ({ tag: item.tagName, text: item.textContent, size: parseFloat(getComputedStyle(item).fontSize) })));

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) test(`week close scales and scrolls ${locale} ${width}`, async ({ page }, info) => {
  const errors: string[] = [], renderer: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
  await page.setViewportSize({ width, height: width === 320 ? 640 : 800 });
  await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
  await open(page); const panel = page.getByTestId("week-close-report");
  await panel.locator("summary").click();
  const baseline = await fonts(panel);
  await page.evaluate(() => document.documentElement.style.fontSize = "130%");
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).fontSize)).toBe("20.8px");
  const scaled = await fonts(panel);
  const measurements = scaled.map((item, i) => ({ ...item, baseline: baseline[i].size, ratio: item.size / baseline[i].size }));
  writeFileSync(`/private/tmp/zk382-week-close-${locale}-${width}-fonts.json`, JSON.stringify(measurements, null, 2));
  await info.attach("font measurements", { body: JSON.stringify(measurements), contentType: "application/json" });
  await info.attach("expanded report", { body: await page.screenshot({ path: `/private/tmp/zk382-week-close-${locale}-${width}.png` }), contentType: "image/png" });
  for (const item of measurements) expect(Math.abs(item.ratio - 1.3), `${item.tag} ${item.text}: ${item.baseline} → ${item.size}`).toBeLessThan(.01);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const body = panel.getByTestId("week-close-body");
  expect(await body.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await body.focus(); await body.evaluate(el => el.scrollTop = 0); await page.keyboard.press("PageDown"); await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const tableRegion = panel.getByTestId("week-close-audiences"); await tableRegion.focus(); await tableRegion.evaluate(el => el.scrollLeft = 0); await page.keyboard.press("ArrowRight");
  if (await tableRegion.evaluate(el => el.scrollWidth > el.clientWidth)) await expect.poll(() => tableRegion.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  for (const text of await panel.locator("h2,summary,button,span,strong,th,td,.cc-week-close-management-intro,.cc-week-close-condition,.cc-week-close-alert,.cc-week-close-cause,.cc-week-close-ledger").all()) {
    if (!await text.isVisible()) continue;
    await text.evaluate(el => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }));
    const bounds = (await text.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual((width === 320 ? 640 : 800) + 1);
    expect(await text.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await info.attach("management evidence", { body: await page.screenshot({ path: `/private/tmp/zk382-week-close-${locale}-${width}-management.png` }), contentType: "image/png" });
  await tableRegion.evaluate(el => { el.scrollIntoView({ block: "center", behavior: "instant" }); el.scrollLeft = 0; });
  await info.attach("audience table", { body: await page.screenshot({ path: `/private/tmp/zk382-week-close-${locale}-${width}-table.png` }), contentType: "image/png" });
  await body.evaluate(el => el.scrollTop = 0);
  await info.attach("report heading", { body: await page.screenshot({ path: `/private/tmp/zk382-week-close-${locale}-${width}-heading.png` }), contentType: "image/png" });
  await expect(panel).toHaveAttribute("aria-modal", "true"); await expect(page.locator(".cc-main")).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape"); await expect(panel).toBeVisible(); await expect(page.getByTestId("log")).toHaveText("[]");
  await panel.getByTestId("week-close-continue").click(); await expect(page.getByTestId("log")).toHaveText('[{"type":"continue","resumeSpeed":"4x"}]'); await expect(page.getByTestId("opener")).toBeFocused();
  await expect(page.getByTestId("immutable")).toHaveText("true"); expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
});

test("week close preserves exact facts, expanded evidence and modal containment", async ({ page }) => {
  await open(page); const panel = page.getByTestId("week-close-report"); await expect(panel).toHaveAttribute("data-resume-speed", "4x");
  for (const text of ["Week 17 complete", "1,234", "$123,456", "$65,432", "$2,456", "37", "$123", "$234", "$345", "79%", "Profit $58,024", translate("en", "season.report.weatherValue", { playable: 4, rain: 2, severe: 1 })]) await expect(panel.getByText(text, { exact: true })).toBeVisible();
  await expect(panel.getByTestId("m49-management-report")).not.toHaveAttribute("open", "");
  await page.keyboard.press("Tab"); await expect(panel.locator("summary")).toBeFocused();
  await page.keyboard.press("Enter"); await expect(panel.getByTestId("m49-management-report")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab"); await expect(panel.getByTestId("week-close-audiences")).toBeFocused();
  await page.keyboard.press("Tab"); await expect(panel.getByTestId("week-close-body")).toBeFocused();
  const report = JSON.parse((await page.getByTestId("management").textContent())!) as M49CourseReport;
  await expect(panel.getByText(translate("en", "weekClose.managementIntroObserved", { headline: report.headline, rounds: 2 }), { exact: true })).toBeVisible();
  expect(await panel.locator(".cc-week-close-segment").allTextContents()).toEqual(report.demand.supportedSegments);
  await expect(panel.getByText(translate("en", "weekClose.managementCondition", { condition: Math.round(report.condition.overall * 100), maintenance: translate("en", "weekClose.managementMaintenanceShort", { amount: formatCurrency(report.condition.shortfall) }), projected: Math.round(report.condition.projectedRecovery * 100) }), { exact: true })).toBeVisible();
  const rows = panel.getByRole("table").locator("tbody tr"); await expect(rows).toHaveCount(6);
  for (const [index, segment] of Object.values(report.demand.segments).entries()) expect(await rows.nth(index).locator("th,td").allTextContents()).toEqual([segment.segment, `${Math.round(segment.bookingAppeal * 100)}%`, formatCurrency(segment.willingnessToPay), segment.evidenceLabel]);
  for (const cause of report.topCauses.slice(0, 3)) await expect(panel.getByText(translate("en", "weekClose.managementCause", { cause: cause.cause, count: cause.observations }), { exact: true })).toBeVisible();
  for (const alert of report.alerts.slice(0, 3)) await expect(panel.getByText(translate("en", "weekClose.managementAlert", { title: alert.title, action: alert.action }), { exact: true })).toBeVisible();
  await expect(panel.getByText(translate("en", "weekClose.managementLedgerReconciled"), { exact: true })).toBeVisible();
  const last = panel.getByTestId("week-close-audiences"); await last.focus(); await page.keyboard.press("Tab"); await expect(panel.getByTestId("week-close-body")).toBeFocused(); await page.keyboard.press("Shift+Tab"); await expect(last).toBeFocused();
  await page.getByTestId("outside").evaluate(el => (el as HTMLElement).focus()); expect(await page.getByTestId("outside").evaluate(el => el === document.activeElement)).toBe(false);
  await page.mouse.click(1, 1); await page.keyboard.press("Escape"); await expect(panel).toBeVisible(); await expect(page.getByTestId("log")).toHaveText("[]");
  await panel.getByTestId("week-close-continue").focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("log")).toHaveText('[{"type":"continue","resumeSpeed":"4x"}]'); await expect(page.getByTestId("opener")).toBeFocused(); await expect(page.locator(".cc-main")).not.toHaveAttribute("aria-hidden"); expect(await page.locator(".cc-main").evaluate(el => (el as HTMLElement).inert)).toBe(false);
});

for (const profile of ["classic", "relaxed", "simulation"]) test(`week close ${profile} visibility remains exact`, async ({ page }) => {
  await open(page, `?profile=${profile}`); const panel = page.getByTestId("week-close-report");
  for (const text of ["Biome irrigation", "Plant care", "Drainage care"]) await expect(panel.getByText(text, { exact: true })).toHaveCount(profile === "simulation" ? 1 : 0);
  await expect(page.getByTestId("immutable")).toHaveText("true");
});

for (const state of ["basic", "empty", "predicted", "review", "one"]) for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) test(`week close ${state} ${locale} ${width} remains readable and renderer free`, async ({ page }, info) => {
  const errors: string[] = [], renderer: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
  await page.setViewportSize({ width, height: width === 320 ? 640 : 800 });
  await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
  await open(page, `?state=${state}&hidden=1`); const panel = page.getByTestId("week-close-report");
  await expect(page.getByTestId("week-close-continue")).toBeEnabled();
  await expect(panel.getByTestId("m49-management-report")).toHaveCount(state === "basic" ? 0 : 1);
  if (state !== "basic") { await panel.locator("summary").click(); await expect(panel.getByRole("table").locator("tbody tr")).toHaveCount(6); }
  const report = JSON.parse((await page.getByTestId("management").textContent())!) as M49CourseReport;
  if (state === "empty") { await expect(panel.getByText(translate(locale, "weekClose.managementNoFit"), { exact: true })).toBeVisible(); await expect(panel.getByText("0", { exact: true })).toBeVisible(); }
  if (state === "predicted") await expect(panel.getByText(translate(locale, "weekClose.managementIntroPredicted", { headline: report.headline }), { exact: true })).toBeVisible();
  if (state === "one") await expect(panel.getByText(translate(locale, "weekClose.managementIntroObservedOne", { headline: report.headline, rounds: 1 }), { exact: true })).toBeVisible();
  if (state === "review") { await expect(panel.getByText(translate(locale, "weekClose.profit", { profit: "-$58,024" }), { exact: true })).toBeVisible(); await expect(panel.getByText(translate(locale, "weekClose.managementLedgerReview"), { exact: true })).toBeVisible(); }
  const baseline = await fonts(panel);
  await page.evaluate(() => document.documentElement.style.fontSize = "130%");
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).fontSize)).toBe("20.8px");
  const measurements = (await fonts(panel)).map((item, i) => ({ ...item, baseline: baseline[i].size, ratio: item.size / baseline[i].size }));
  await info.attach("variant font measurements", { body: JSON.stringify(measurements), contentType: "application/json" });
  for (const item of measurements) expect(Math.abs(item.ratio - 1.3), `${item.tag} ${item.text}`).toBeLessThan(.01);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const body = panel.getByTestId("week-close-body");
  expect(await body.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await body.focus(); await body.evaluate(el => el.scrollTop = 0);
  if (await body.evaluate(el => el.scrollHeight > el.clientHeight)) { await page.keyboard.press("PageDown"); await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0); }
  await body.evaluate(el => new Promise<void>(resolve => {
    let previous = el.scrollTop, stableFrames = 0;
    const settle = () => { const current = el.scrollTop; stableFrames = current === previous ? stableFrames + 1 : 0; previous = current; if (stableFrames >= 5) resolve(); else requestAnimationFrame(settle); };
    requestAnimationFrame(settle);
  }));
  if (state !== "basic") {
    const audiences = panel.getByTestId("week-close-audiences"); await audiences.focus(); await audiences.evaluate(el => el.scrollLeft = 0);
    if (await audiences.evaluate(el => el.scrollWidth > el.clientWidth)) { await page.keyboard.press("ArrowRight"); await expect.poll(() => audiences.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); }
    await audiences.evaluate(el => new Promise<void>(resolve => {
      let previous = el.scrollLeft, stableFrames = 0;
      const settle = () => { const current = el.scrollLeft; stableFrames = current === previous ? stableFrames + 1 : 0; previous = current; if (stableFrames >= 5) resolve(); else requestAnimationFrame(settle); };
      requestAnimationFrame(settle);
    }));
  }
  for (const text of await panel.locator("h2,summary,button,span,strong,th,td,.cc-week-close-management-intro,.cc-week-close-condition,.cc-week-close-alert,.cc-week-close-cause,.cc-week-close-ledger").all()) {
    if (!await text.isVisible()) continue;
    await text.evaluate(el => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })); const bounds = (await text.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y, (await text.textContent()) ?? "").toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual((width === 320 ? 640 : 800) + 1);
    expect(await text.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await panel.getByTestId("week-close-continue").click(); await expect(page.locator(".cc-main")).toHaveAttribute("aria-hidden", "false"); await expect(page.getByTestId("opener")).toBeFocused();
  await expect(page.locator(".cc-main button[disabled]")).toBeDisabled();
  expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0); await expect(page.getByTestId("immutable")).toHaveText("true");
});

test("week close restores a previously inert background and manual profile visibility", async ({ page }) => {
  await page.goto(`${fixture}?profile=classic&override=1&hidden=1`);
  await page.getByTestId("opener").evaluate(el => el.addEventListener("click", () => { document.querySelector<HTMLElement>(".cc-main")!.inert = true; }, { once: true }));
  await page.getByTestId("opener").click(); const panel = page.getByTestId("week-close-report"); await expect(panel.getByTestId("week-close-continue")).toBeFocused();
  await expect(panel.getByText("Drainage care", { exact: true })).toHaveCount(1);
  for (const text of ["Biome irrigation", "Plant care"]) await expect(panel.getByText(text, { exact: true })).toHaveCount(0);
  await panel.getByTestId("week-close-continue").click();
  expect(await page.locator(".cc-main").evaluate(el => (el as HTMLElement).inert)).toBe(true); await expect(page.locator(".cc-main")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByTestId("log")).toHaveText('[{"type":"continue","resumeSpeed":"4x"}]');
});

for (const theme of ["parkland", "links", "desert"]) test(`week close ${theme} portal retains opaque contextual tokens`, async ({ page }) => {
  const errors: string[] = [], renderer: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
  await open(page, `?theme=${theme}`); const panel = page.getByTestId("week-close-body");
  const appearance = await panel.evaluate(el => { const style = getComputedStyle(el); return { background: style.backgroundColor, tokens: Object.fromEntries(["--biome-surface", "--biome-season-surface", "--biome-edge", "--biome-weather-edge"].map(token => [token, style.getPropertyValue(token).trim()])) }; });
  expect(appearance.background).not.toBe("rgba(0, 0, 0, 0)");
  const expected = biomeUiStyle(biomeUiTheme(theme, { season: "spring", weather: "rain" }));
  for (const [token, value] of Object.entries(appearance.tokens)) expect(value, token).toBe(expected[token as keyof typeof expected]);
  await page.keyboard.press("Tab"); await expect(panel.locator("summary")).toBeFocused(); await page.keyboard.press("Enter"); await page.keyboard.press("Tab"); await expect(panel.getByTestId("week-close-audiences")).toBeFocused();
  await page.keyboard.press("Escape"); await expect(panel).toBeVisible(); await expect(page.getByTestId("log")).toHaveText("[]");
  expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
});
