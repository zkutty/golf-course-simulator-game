import { expect, test, type Page } from "@playwright/test";
const fixture = "/e2e/fixtures/zk382-property-shell.html";
const keys = ["campus", "resort", "community", "ledger"];
const shellText = ".cc-property-eyebrow,.cc-property-heading h2,.cc-property-subtitle,.cc-property-metric > div,.cc-property-metric > strong,.cc-property-tabs button > span:last-child";

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  Object.assign(page, { propertyErrors: errors });
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { propertyErrors: string[] }).propertyErrors).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(0);
  if (await page.evaluate(() => !!window.__propertyShellFixture)) expect(await page.evaluate(() => window.__propertyShellFixture.immutable())).toBe(true);
});

test("Property shell tabs have one selected and tabbable key with keyboard routing", async ({ page }) => {
  await page.goto(fixture); const panel = page.getByTestId("property-management-panel"); const tabs = panel.getByRole("tab");
  await expect(tabs).toHaveCount(4); await tabs.first().focus();
  for (const [key, index] of [["ArrowRight", 1], ["End", 3], ["ArrowRight", 0], ["ArrowLeft", 3], ["Home", 0]] as const) {
    await page.keyboard.press(key); await expect(tabs.nth(index)).toBeFocused(); await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", `property-tab-${keys[index]}`);
    expect(await tabs.evaluateAll(elements => elements.filter(element => element.getAttribute("tabindex") === "0").length)).toBe(1);
    expect(await tabs.evaluateAll(elements => elements.filter(element => element.getAttribute("aria-selected") === "true").length)).toBe(1);
  }
  await expect(panel).toHaveAttribute("aria-modal", "false");
  await panel.getByRole("tabpanel").focus(); await page.keyboard.press("Escape"); await expect(panel).toBeVisible();
  const finalControl = panel.locator("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])").last();
  await finalControl.focus(); await expect(finalControl).toBeFocused(); await page.keyboard.press("Tab"); await expect(page.getByTestId("outside-after")).toBeFocused();
  expect(await page.evaluate(() => window.__propertyShellFixture.calls())).toEqual([]);
  await panel.locator(".cc-property-close").click(); await expect(panel).toHaveCount(0); await expect(page.getByTestId("close-count")).toHaveText("1");
});

test("Property shell metrics remain contained at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 }); await page.goto(`${fixture}?long`); const panel = page.getByTestId("property-management-panel");
  await expect(panel).toHaveAttribute("aria-busy", "false"); expect(await panel.locator("header").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const profile of ["relaxed", "classic", "simulation"] as const) {
  test(`Property ${profile} profile tab availability and Campus fallback`, async ({ page }) => {
    await page.goto(`${fixture}?profile=${profile}`); const panel = page.getByTestId("property-management-panel");
    await expect(panel.getByRole("tab")).toHaveCount(profile === "simulation" ? 4 : 3);
    for (const key of keys.slice(0, 3)) { await panel.getByTestId(`property-tab-${key}`).click(); await expect(panel.getByTestId(`property-tab-${key}`)).toHaveAttribute("aria-selected", "true"); }
    await page.evaluate(() => window.__propertyShellFixture.profile("simulation")); await panel.getByTestId("property-tab-ledger").click();
    await page.evaluate(() => window.__propertyShellFixture.profile("classic")); await expect(panel.getByTestId("property-tab-ledger")).toHaveCount(0);
    await expect(panel.getByTestId("property-tab-campus")).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByTestId("property-tab-campus")).toHaveAttribute("tabindex", "0");
    expect(await page.evaluate(() => window.__propertyShellFixture.calls())).toEqual([]);
  });
}

for (const failure of [false, true]) {
  test(`Property notice preserves real ${failure ? "error" : "success"} message and exact command`, async ({ page }) => {
    await page.goto(`${fixture}${failure ? "?failure" : ""}`); const panel = page.getByTestId("property-management-panel");
    await panel.getByTestId("property-asset-driving_range").getByRole("button").click();
    const outcome = await page.evaluate(() => window.__propertyShellFixture.results()[0]);
    expect(outcome.ok).toBe(!failure); await expect(panel.getByTestId("property-notice-message")).toHaveText(outcome.message);
    await expect(panel.getByTestId("property-notice")).toContainText(failure ? "Needs attention" : "Success");
    expect(await page.evaluate(() => window.__propertyShellFixture.calls())).toEqual([{ type: "BUILD", kind: "driving_range" }]);
    await expect(panel.getByTestId("property-notice").locator("svg[aria-hidden=true]")).toHaveCount(1);
  });
}

test("Property loading waits for async reference module and applies latest nonce focus", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/src/game/architecture/referencePlan.ts*", async route => { await gate; await route.continue(); });
  await page.goto(fixture, { waitUntil: "domcontentloaded" }); const panel = page.getByTestId("property-management-panel");
  await expect(panel).toHaveAttribute("aria-busy", "true"); await expect(panel).toHaveAttribute("aria-modal", "false");
  await expect(panel.locator(".cc-property-close")).toBeVisible();
  await page.evaluate(() => window.__propertyShellFixture.focus("resort")); release();
  await expect(panel).toHaveAttribute("aria-busy", "false"); await expect(panel.getByTestId("property-tab-resort")).toBeFocused();
  for (const system of ["community", "property", "memberships", "resort", "resort"] as const) {
    await page.evaluate(value => window.__propertyShellFixture.focus(value), system);
    const tab = system === "memberships" || system === "property" ? "campus" : system;
    await expect(panel.getByTestId(`property-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
    if (system === "memberships") await expect(panel.getByTestId("membership-operations").getByRole("button")).toBeFocused();
    else await expect(panel.getByTestId(`property-tab-${tab}`)).toBeFocused();
    await page.getByTestId("outside-after").focus();
  }
  expect(await page.evaluate(() => window.__propertyShellFixture.calls())).toEqual([]);
});

test("Property loading can close before async completion", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/src/game/architecture/referencePlan.ts*", async route => { await gate; await route.continue(); });
  await page.setViewportSize({ width: 320, height: 640 }); await page.addInitScript(() => localStorage.setItem("coursecraft_locale", "pseudo"));
  await page.goto(fixture, { waitUntil: "domcontentloaded" }); const panel = page.getByTestId("property-management-panel");
  await expect(panel).toHaveAttribute("aria-busy", "true");
  const baseline = await panel.locator("p").evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  await page.evaluate(() => { document.documentElement.style.fontSize = "20.8px"; });
  expect(Math.abs(await panel.locator("p").evaluate(node => parseFloat(getComputedStyle(node).fontSize)) / baseline - 1.3)).toBeLessThan(.01);
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await panel.locator(".cc-property-close").click(); release();
  await expect(panel).toHaveCount(0); await expect(page.getByTestId("close-count")).toHaveText("1");
});

for (const locale of ["en", "pseudo"] as const) for (const viewport of [{ width: 320, height: 640 }, { width: 768, height: 800 }, { width: 1280, height: 800 }]) {
  test(`Property ${locale} ${viewport.width} shell grows exactly 130 percent and remains reachable`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale); await page.setViewportSize(viewport); await page.goto(`${fixture}?long`);
    const panel = page.getByTestId("property-management-panel"); await expect(panel).toHaveAttribute("aria-busy", "false");
    const baseline = await panel.locator(shellText).evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
    await page.evaluate(() => { document.documentElement.style.fontSize = "20.8px"; });
    const grown = await panel.locator(shellText).evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
    expect(grown).toHaveLength(baseline.length); for (let i = 0; i < grown.length; i++) expect(Math.abs(grown[i] / baseline[i] - 1.3)).toBeLessThan(.01);
    expect(await panel.locator(".cc-property-metric > strong").allTextContents()).toEqual(await page.evaluate(() => window.__propertyShellFixture.metrics()));
    const containment = await panel.evaluate(element => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, doc: document.documentElement.scrollWidth, header: element.querySelector("header")!.scrollWidth <= element.querySelector("header")!.clientWidth, nav: element.querySelector("nav")!.scrollWidth <= element.querySelector("nav")!.clientWidth }; });
    expect(containment.left).toBeGreaterThanOrEqual(0); expect(containment.right).toBeLessThanOrEqual(viewport.width); expect(containment.doc).toBeLessThanOrEqual(viewport.width); expect(containment.header).toBe(true); expect(containment.nav).toBe(true);
    for (const element of await panel.locator(shellText).all()) {
      await element.scrollIntoViewIfNeeded();
      expect(await element.evaluate(node => { const r = document.createRange(); r.selectNodeContents(node); const panel = node.closest(".cc-property-shell")!.getBoundingClientRect(); return Array.from(r.getClientRects()).every(rect => rect.left >= panel.left && rect.right <= panel.right && rect.top >= panel.top && rect.bottom <= panel.bottom); })).toBe(true);
    }
    for (const control of await panel.locator(".cc-property-close,[role=tab]").all()) {
      await control.focus(); await expect(control).toBeFocused();
      expect(await control.evaluate(node => { const a = node.getBoundingClientRect(), b = node.closest(".cc-property-shell")!.getBoundingClientRect(); return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom; })).toBe(true);
      const focus = await control.evaluate(node => ({ width: getComputedStyle(node).outlineWidth, color: getComputedStyle(node).outlineColor })); expect(focus.width).toBe("3px"); expect(focus.color).not.toBe("rgba(0, 0, 0, 0)");
      const colors = await control.evaluate(node => ({ foreground: getComputedStyle(node).outlineColor, background: getComputedStyle(node).backgroundColor })); expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(3);
    }
    const body = panel.getByRole("tabpanel"); await body.focus(); const before = await body.evaluate(node => node.scrollTop); await page.keyboard.press("PageDown"); await expect.poll(() => body.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.__propertyShellFixture.calls())).toEqual([]);
    await expect(panel.locator(".cc-property-metric.is-warning svg[aria-hidden=true]")).toHaveCount(1);
    expect(await panel.locator(".cc-property-metric.is-warning").evaluate(node => getComputedStyle(node).borderTopStyle)).toBe("dashed");
    await panel.getByTestId("property-asset-driving_range").getByRole("button").click();
    const outcome = await page.evaluate(() => window.__propertyShellFixture.results()[0]);
    await expect(panel.getByTestId("property-notice-message")).toHaveText(outcome.message);
    const notice = panel.getByTestId("property-notice");
    await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    const noticeBaseline = await notice.locator("strong, [data-testid=property-notice-message]").evaluateAll(elements => elements.map(node => parseFloat(getComputedStyle(node).fontSize)));
    await page.evaluate(() => { document.documentElement.style.fontSize = "20.8px"; });
    const noticeGrown = await notice.locator("strong, [data-testid=property-notice-message]").evaluateAll(elements => elements.map(node => parseFloat(getComputedStyle(node).fontSize)));
    for (let i = 0; i < noticeGrown.length; i++) expect(Math.abs(noticeGrown[i] / noticeBaseline[i] - 1.3)).toBeLessThan(.01);
    await notice.scrollIntoViewIfNeeded(); expect(await notice.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`property-${locale}-${viewport.width}-130pct.png`) });
    expect(await page.evaluate(() => window.__propertyShellFixture.calls())).toEqual([{ type: "BUILD", kind: "driving_range" }]);
  });
}

declare global { interface Window { __propertyShellFixture: { results: () => { ok: boolean; message: string }[]; calls: () => unknown[]; immutable: () => boolean; profile: (profile: "relaxed" | "classic" | "simulation") => void; focus: (system: "memberships" | "property" | "resort" | "community") => void; metrics: () => string[] } } }

function contrast(a: string, b: string) {
  const luminance = (color: string) => { const values = color.match(/[\d.]+/g)!.slice(0, 3).map(value => { const channel = Number(value) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; };
  const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
