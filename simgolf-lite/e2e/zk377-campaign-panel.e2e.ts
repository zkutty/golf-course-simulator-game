import { expect, test } from "@playwright/test";
import { translate } from "../src/i18n/core";
import { formatCurrency, formatNumber } from "../src/i18n/format";
const fixture = "/e2e/fixtures/zk377-campaign-panel.html";

test("Campaign requirement status uses owned decorative SVG and visible localized states", async ({ page }) => {
  await page.goto(fixture);
  const panel = page.getByTestId("campaign-panel");
  await expect(panel.getByRole("button", { name: "Close campaign" }).locator("svg path")).toHaveCount(1);
  const statuses = panel.locator("[data-campaign-requirement]");
  await expect(statuses).toHaveCount(2);
  await expect(statuses.nth(0)).toHaveAttribute("data-campaign-status", "pending");
  await expect(statuses.nth(0)).toContainText("Not yet met · Pro skill gte 40 (0)");
  await expect(statuses.nth(1)).toHaveAttribute("data-campaign-status", "met");
  await expect(statuses.nth(1)).toContainText("Met · Design evidence gte 1 (1)");
  await expect(statuses.locator('svg[aria-hidden="true"]')).toHaveCount(2);
  expect(await panel.textContent()).not.toMatch(/[✓○×]/);
  await expect(panel).toContainText("Cash: $123,456");
  await expect(panel).toContainText("Green fee: $1,234");
  await expect(panel).toContainText("Staff level: 1,234");
  await expect(panel).toContainText("rowan +1,234");
  await expect(panel).toContainText("mara -1,234");
  await expect(panel.getByTestId("campaign-participation")).toContainText("Resolve this phase’s authored choice");
  await expect(panel.getByTestId("campaign-direct-evidence")).toHaveCount(0);
});

test("Campaign participation and direct mastery keep their distinct visible states", async ({ page }) => {
  for (const [variant, state, text] of [["mastery-pending", "pending", "Direct phase evidence still required"], ["mastery-complete", "met", "Direct phase evidence recorded"]] as const) {
    await page.goto(`${fixture}?state=${variant}`);
    const panel = page.getByTestId("campaign-panel");
    await expect(panel.getByTestId("campaign-participation")).toContainText("Direct authored choice recorded");
    await expect(panel.getByTestId("campaign-direct-evidence")).toHaveAttribute("data-campaign-status", state);
    await expect(panel.getByTestId("campaign-direct-evidence")).toContainText(text);
    await expect(panel.getByTestId("campaign-direct-evidence").locator('svg[aria-hidden="true"] path')).not.toHaveCount(0);
    await expect(page.getByTestId("callback-log")).toHaveText("");
  }
});

test("Campaign navigation and legacy recovery dispatch exact callbacks and retain owning phase", async ({ page }) => {
  await page.goto(`${fixture}?state=recovery`);
  const panel = page.getByTestId("campaign-panel");
  const before = JSON.parse((await page.getByTestId("campaign-state").textContent())!);
  const systems = panel.locator("[data-campaign-system]");
  expect(await systems.count()).toBe(10);
  const expected: string[] = [];
  for (let index = 0; index < await systems.count(); index++) {
    const system = await systems.nth(index).getAttribute("data-campaign-system");
    await systems.nth(index).focus(); await page.keyboard.press("Enter");
    expected.push(`navigate:${system}`);
    await expect(page.getByTestId("callback-log")).toHaveText(expected.join(","));
    expect(JSON.parse((await page.getByTestId("campaign-state").textContent())!)).toEqual(before);
  }
  const recovery = panel.getByTestId("campaign-legacy-recovery").getByRole("button");
  await recovery.focus(); await page.keyboard.press("Enter");
  expected.push("recovery");
  await expect(page.getByTestId("callback-log")).toHaveText(expected.join(","));
  await expect(panel.getByTestId("campaign-legacy-recovery")).toHaveCount(0);
  await expect(panel.getByTestId("campaign-participation")).toContainText("Legacy phase acknowledged for Bronze recovery");
  await expect(panel.getByTestId("campaign-direct-evidence")).toHaveCount(0);
  const after = JSON.parse((await page.getByTestId("campaign-state").textContent())!);
  expect(after.phaseIndex).toBe(before.phaseIndex);
  expect(after.participation.receipts).toEqual([expect.objectContaining({ source: "legacy-recovery", phaseId: "championship-stage" })]);
  await panel.getByRole("button", { name: "Close campaign" }).click();
  expected.push("close");
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("callback-log")).toHaveText(expected.join(","));
});

test("Campaign async match callback reports then clears its returned error without advancing state", async ({ page }) => {
  await page.goto(`${fixture}?state=match-idle`);
  const panel = page.getByTestId("campaign-panel");
  const before = await page.getByTestId("campaign-state").textContent();
  const start = panel.getByRole("button", { name: "Start playable match" });
  await start.focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("callback-log")).toHaveText("start");
  await expect(panel.getByRole("alert")).toHaveText("Fixture match unavailable; recover the published route first.");
  await expect(start).toBeEnabled();
  await start.click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("request-count")).toHaveText("2");
  await expect(page.getByTestId("callback-log")).toHaveText("start,start");
  expect(await page.getByTestId("campaign-state").textContent()).toBe(before);
  await expect(panel.getByTestId("campaign-match")).toContainText("Requires 12 Player Pro career points");
});

for (const variant of ["match-active", "match-complete", "completed", "honorable-loss"] as const) {
  test(`Campaign ${variant} keeps disabled match actions and exact epilogue/sandbox callbacks`, async ({ page }) => {
    await page.goto(`${fixture}?state=${variant}`);
    const panel = page.getByTestId("campaign-panel");
    const match = panel.getByTestId("campaign-match").getByRole("button");
    if (variant === "match-active" || variant === "match-complete") {
      await expect(match).toBeDisabled();
      await expect(match).toHaveText(variant === "match-active" ? "Match in progress" : "Match complete");
      await match.evaluate((element) => (element as HTMLButtonElement).click());
    } else await expect(panel.getByTestId("campaign-match")).toHaveCount(0);
    await expect(page.getByTestId("callback-log")).toHaveText("");
    if (variant === "match-active" || variant === "match-complete") await expect(panel.getByTestId("campaign-epilogue")).toHaveCount(0);
    else {
      await expect(panel.getByTestId("campaign-direct-evidence")).toHaveAttribute("data-campaign-status", "met");
      const epilogue = panel.getByTestId("campaign-epilogue");
      await expect(epilogue).toContainText("Gold");
      await expect(epilogue).toContainText(variant === "honorable-loss" ? "The final result fell short" : "The championship belongs to your Player Pro");
      await expect(epilogue.getByRole("listitem")).toHaveCount(2);
      await epilogue.getByRole("button").focus(); await page.keyboard.press("Enter");
      await expect(page.getByTestId("callback-log")).toHaveText("sandbox");
    }
  });
}

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 1280]) {
  test(`Campaign measured actual 130% text/control fonts and containment: ${locale} ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = []; const rendererRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (/PixiStage|pixi\.js/.test(request.url())) rendererRequests.push(request.url()); });
    const height = width === 320 ? 640 : 800;
    await page.setViewportSize({ width, height });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    for (const variant of ["incomplete", "recovery", "completed"] as const) {
      await page.goto(`${fixture}?state=${variant}`);
      const panel = page.getByTestId("campaign-panel");
      const fonts = () => panel.evaluate((element) => [...element.querySelectorAll<HTMLElement>("h2, p, small, strong, span, button")].map((item) => ({ tag: item.tagName, text: item.textContent, size: parseFloat(getComputedStyle(item).fontSize) })));
      const before = await fonts(); // Read every baseline before changing the root size.
      await page.getByRole("button", { name: "Scale 130%" }).click();
      await expect(page.locator("html")).toHaveAttribute("style", "font-size: 130%;");
      const after = await fonts();
      expect(after.length).toBe(before.length);
      after.forEach((item, index) => expect(item.size / before[index].size, `${variant}: ${item.tag} ${item.text}`).toBeCloseTo(1.3, 2));
      await expect(panel).toContainText(`${translate(locale, "campaign.fact.cash")}: ${formatCurrency(123456, locale)}`);
      await expect(panel).toContainText(`${translate(locale, "campaign.fact.staffLevel")}: ${formatNumber(1234, locale)}`);
      if (variant !== "completed") {
        await expect(panel.locator("[data-campaign-requirement]").first()).toContainText(translate(locale, "campaign.requirement.pending"));
        await expect(panel.locator("[data-campaign-requirement]").last()).toContainText(translate(locale, "campaign.requirement.met"));
      }
      expect(await panel.textContent()).not.toMatch(/[✓○×]/);
      const bounds = await panel.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }; });
      expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const text = panel.locator("h2, p, small, strong, span, li");
      for (let index = 0; index < await text.count(); index++) {
        await text.nth(index).scrollIntoViewIfNeeded();
        const rect = await text.nth(index).evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left); expect(rect.right).toBeLessThanOrEqual(bounds.right);
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top); expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
      const controls = panel.locator("button:not(:disabled)");
      await controls.first().focus();
      for (let index = 0; index < await controls.count(); index++) {
        if (index > 0) await page.keyboard.press("Tab");
        await expect(controls.nth(index)).toBeFocused();
        const rect = await controls.nth(index).evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left); expect(rect.right).toBeLessThanOrEqual(bounds.right);
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top); expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
      await panel.evaluate((element) => { element.scrollTop = 0; });
      await testInfo.attach(`${variant}-${locale}-${width}`, { body: await panel.screenshot(), contentType: "image/png" });
      await testInfo.attach(`${variant}-font-ratios`, { body: JSON.stringify({ before, after }), contentType: "application/json" });
      await panel.getByRole("button", { name: translate(locale, "campaign.panel.close") }).focus(); await page.keyboard.press("Enter");
      await expect(panel).toHaveCount(0); await expect(page.getByTestId("callback-log")).toHaveText("close");
    }
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(rendererRequests).toEqual([]); expect(errors).toEqual([]);
  });
}
