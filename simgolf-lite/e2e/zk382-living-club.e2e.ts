import { expect, test, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const fixture = "/e2e/fixtures/zk382-living-club.html";
const fontSizes = (dialog: Locator) => dialog.locator("#living-club-title, p, small, strong, h3, h4, button, select, dt, dd").evaluateAll(elements => elements.map(e => ({ text: e.textContent?.slice(0,40), size: parseFloat(getComputedStyle(e).fontSize) })));
const rect = (locator: Locator) => locator.evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, client: e.clientWidth, scroll: e.scrollWidth }; });
for (const locale of ["en", "pseudo"]) for (const width of [320, 768, 1280]) {
  test(`Living Club scales and contains all views: ${locale} ${width}`, async ({ page }, testInfo) => {
    const height = width === 320 ? 640 : 800;
    await page.setViewportSize({ width, height });
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
    const errors: string[] = []; const pixiRequests: string[] = [];
    page.on("pageerror", e => errors.push(e.message)); page.on("request", r => { if (/PixiStage|pixi\.js/.test(r.url())) pixiRequests.push(r.url()); });
    await page.goto(fixture + "?state=stories"); await page.getByTestId("opener").click();
    const dialog = page.getByRole("dialog"); const tabs = dialog.getByRole("tab");
    await expect(tabs).toHaveCount(3); await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    const baseline = [];
    for (let i = 0; i < 3; i++) { await tabs.nth(i).click(); baseline.push(await fontSizes(dialog)); }
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    expect(await page.locator("html").evaluate(e => getComputedStyle(e).fontSize)).toBe("20.8px");
    const measurements = [];
    for (let i = 0; i < 3; i++) {
      await tabs.nth(i).click(); const scaled = await fontSizes(dialog);
      const ratios = scaled.map((f,j) => ({ ...f, baseline: baseline[i][j].size, ratio: f.size / baseline[i][j].size }));
      for (const f of ratios) expect(Math.abs(f.ratio - 1.3), `${f.text}: ${f.baseline}->${f.size}`).toBeLessThan(.01);
      expect(await tabs.evaluateAll(items => items.filter(e => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
      await expect(dialog.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await tabs.nth(i).getAttribute("id"))!);
      const section = dialog.locator(".cc-living-club"); const bounds = await rect(section);
      expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height);
      for (const region of [section, dialog.getByRole("tabpanel"), ...await dialog.locator("article").all()]) {
        const r = await rect(region); expect(r.scroll).toBeLessThanOrEqual(r.client);
      }
      const controls = dialog.locator("button:not([disabled]), select");
      for (let j = 0; j < await controls.count(); j++) {
        const control = controls.nth(j); await control.evaluate(e => e.scrollIntoView({ block: "center", inline: "nearest" })); await control.focus(); await expect(control).toBeFocused();
        const r = await rect(control); expect(r.left).toBeGreaterThanOrEqual(bounds.left); expect(r.right).toBeLessThanOrEqual(bounds.right); expect(r.top).toBeGreaterThanOrEqual(bounds.top); expect(r.bottom).toBeLessThanOrEqual(bounds.bottom); expect(r.scroll).toBeLessThanOrEqual(r.client);
      }
      const text = dialog.locator("p, small, strong, h3, h4, dt, dd");
      for (let j = 0; j < await text.count(); j++) {
        const item = text.nth(j); await item.evaluate(e => e.scrollIntoView({ block: "center" })); const r = await rect(item);
        expect(r.scroll).toBeLessThanOrEqual(r.client); expect(r.left).toBeGreaterThanOrEqual(bounds.left); expect(r.right).toBeLessThanOrEqual(bounds.right);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (locale === "pseudo") await expect(tabs.nth(i)).toHaveText(/^⟦/);
      const path = join(tmpdir(), `living-club-${locale}-${width}-${i}-green.png`);
      await testInfo.attach(`view-${i}`, { body: await page.screenshot({ path }), contentType: "image/png" });
      measurements.push({ view: i, bounds, fonts: ratios });
    }
    writeFileSync(join(tmpdir(), `living-club-${locale}-${width}-green.json`), JSON.stringify(measurements,null,2));
    expect(errors).toEqual([]); expect(pixiRequests).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
    expect(await page.getByTestId("immutable").textContent()).toBe("true");
  });
}
test("Living Club keyboard tabs, modal close paths and opener restoration", async ({ page }) => {
  await page.goto(fixture); const opener = page.getByTestId("opener"); await opener.click(); const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: "Close", exact: true }); await expect(close).toBeFocused(); await expect(close.locator("svg[aria-hidden=true]")).toHaveCount(1);
  await close.press("Shift+Tab"); expect(await dialog.locator(":focus").count()).toBe(1); await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  const tabs = dialog.getByRole("tab"); await tabs.first().focus(); await page.keyboard.press("ArrowRight"); await expect(tabs.nth(1)).toBeFocused(); await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End"); await expect(tabs.last()).toBeFocused(); await page.keyboard.press("Home"); await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await page.getByRole("button", { name: "Close", exact: true }).click(); await expect(opener).toBeFocused();
  await opener.click(); await page.getByRole("dialog").click({ position: { x: 1, y: 1 } }); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  expect(JSON.parse((await page.getByTestId("log").textContent())!)).toEqual([{type:"close"},{type:"close"},{type:"close"}]);
});
test("Living Club preserves favorite, follow and all staff command arguments", async ({ page }) => {
  await page.goto(fixture); await page.getByTestId("opener").click(); const dialog = page.getByRole("dialog");
  const initial = JSON.parse((await page.getByTestId("initial-profile").textContent())!);
  await dialog.getByTestId("favorite-regular").click(); await expect(dialog.getByTestId("favorite-regular")).toHaveAttribute("aria-pressed","true"); await expect(dialog.getByText("Favorite", {exact:true})).toBeVisible();
  await dialog.getByTestId("favorite-regular").click(); expect(JSON.parse((await page.getByTestId("profile").textContent())!)).toEqual(initial);
  await dialog.getByRole("button", { name: "Follow on course" }).click();
  await dialog.getByRole("tab", { name: "Staff" }).click();
  await dialog.locator("#staff-hire-role").selectOption("club_pro"); await dialog.getByRole("button", { name: "Hire · $900", exact: true }).click();
  const staff = dialog.locator('article[data-testid^="staff-"]').first(); const staffId = (await staff.getAttribute("data-testid"))!.slice(6);
  await expect(staff.getByRole("progressbar")).toHaveCount(2);
  await staff.getByRole("button", {name:"Train",exact:true}).click(); await staff.getByRole("button", {name:"Give raise",exact:true}).click(); await staff.getByRole("button", {name:"Dismiss",exact:true}).click();
  await expect(dialog.getByRole("status")).toHaveText("The club cannot afford that staff action.");
  const log = JSON.parse((await page.getByTestId("log").textContent())!);
  expect(log.slice(2)).toEqual([{type:"follow",id:42},{type:"hire",role:"club_pro",courseId:await page.getByTestId("course-id").textContent()},{type:"train",staffId},{type:"compensate",staffId,raise:50},{type:"dismiss",staffId}]);
  await expect(staff).not.toContainText("$$"); expect(await page.getByTestId("immutable").textContent()).toBe("true");
});
test("Living Club preserves story choice/defer IDs and reverse journal order", async ({ page }) => {
  await page.goto(fixture + "?state=stories"); await page.getByTestId("opener").click(); const dialog = page.getByRole("dialog");
  const choice = dialog.getByTestId("story-choice-card").locator('button[data-testid^="story-choice-"]').first(); const choiceId = (await choice.getAttribute("data-testid"))!.slice(13);
  await choice.click(); await dialog.getByRole("button", {name:/Decide later/}).click();
  expect(JSON.parse((await page.getByTestId("log").textContent())!)).toEqual([{type:"choice",instanceId:"story-fixture",choiceId},{type:"defer",instanceId:"story-fixture"}]);
  const journal = dialog.getByTestId("living-club-journal-entry"); await expect(journal.first()).toContainText("Week 2"); await expect(journal.last()).toContainText("Week 1");
  expect(await page.getByTestId("immutable").textContent()).toBe("true");
});
test("Living Club favorite bound, disabled follow and empty states", async ({ page }) => {
  await page.goto(fixture + "?state=bound"); await page.getByTestId("opener").click(); await page.getByTestId("favorite-regular").click();
  const profile = JSON.parse((await page.getByTestId("profile").textContent())!); expect(profile.favoritePersonIds).toHaveLength(100); expect(profile.favoritePersonIds[0]).toBe("existing-1"); expect(profile.favoritePersonIds[99]).toBe("person-fixture");
  await page.goto(fixture + "?state=off-course"); await page.getByTestId("opener").click(); await expect(page.getByRole("button", {name:"Not on today’s course",exact:true})).toBeDisabled();
  await page.goto(fixture + "?state=empty"); await page.getByTestId("opener").click(); await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected","true"); await expect(page.getByTestId("favorite-regular")).toHaveCount(0); await page.getByRole("tab",{name:"Staff"}).click(); await expect(page.locator('article[data-testid^="staff-"]')).toHaveCount(0);
});
