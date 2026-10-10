import { expect, test, type Page } from "@playwright/test";
const fixture = "/e2e/fixtures/zk382-live-overview.html";
const keys = ["golfers", "leaderboard", "staff", "pace", "mobility"];
function contrast(first: string, second: string) {
  const luminance = (color: string) => { const rgb = color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(channel => { const value=channel/255; return value<=.04045?value/12.92:((value+.055)/1.055)**2.4; }); return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]; };
  const a=luminance(first),b=luminance(second); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (/pixi|PixiStage/.test(request.url())) requests.push(request.url()); });
  Object.assign(page, { liveErrors: errors, liveRequests: requests });
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { liveErrors: string[] }).liveErrors).toEqual([]); expect((page as Page & { liveRequests: string[] }).liveRequests).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(0); expect(await page.evaluate(() => window.__liveOverviewFixture.immutable())).toBe(true);
});
test("Live overview has one linked keyboard tab and leaves native focus free", async ({ page }) => {
  await page.goto(fixture); const panel = page.getByTestId("live-overview"), tabs = panel.getByRole("tab");
  await tabs.first().focus();
  for (const [key, index] of [["ArrowRight", 1], ["End", 4], ["ArrowRight", 0], ["ArrowLeft", 4], ["Home", 0]] as const) {
    await page.keyboard.press(key); await expect(tabs.nth(index)).toBeFocused(); await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    expect(await tabs.evaluateAll(elements => elements.filter(element => element.tabIndex === 0).length)).toBe(1);
    const control = await tabs.nth(index).getAttribute("aria-controls"); expect(control).toBeTruthy(); await expect(panel.getByRole("tabpanel")).toHaveAttribute("id", control!);
    await expect(panel.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await tabs.nth(index).getAttribute("id"))!);
  }
  await page.keyboard.press("Escape"); await expect(panel).toBeVisible();
  await panel.locator("button").last().focus(); await page.keyboard.press("Tab"); await expect(page.getByTestId("outside-after")).toBeFocused();
  expect(await page.evaluate(() => window.__liveOverviewFixture.calls())).toEqual([]);
  await panel.getByRole("button", { name: "Close live overview", exact: true }).click(); expect(await page.evaluate(() => window.__liveOverviewFixture.calls())).toEqual([["close"]]);
});
test("Live overview preserves callbacks, profile restrictions and operation focus", async ({ page }) => {
  await page.goto(fixture); const panel = page.getByTestId("live-overview");
  await panel.locator("button:has(b)").first().click(); expect(await page.evaluate(() => window.__liveOverviewFixture.calls())).toEqual([["golfer", 41]]);
  await panel.getByRole("tab", { name: "Staff", exact: true }).click(); await panel.getByRole("combobox").selectOption("course-secondary");
  const shift = panel.getByTestId("staff-shift-controls-staff-exact"); await expect(shift.getByRole("button")).toBeDisabled(); await shift.locator("input").first().fill("16:00"); await shift.locator("input").nth(1).fill("16:30"); await expect(shift.getByRole("button")).toBeDisabled(); await shift.locator("input").first().fill("08:30"); await shift.locator("input").nth(1).fill("17:00"); await shift.getByRole("button").click();
  await panel.getByRole("tab", { name: "Pace", exact: true }).click(); await panel.getByRole("button", { name: "Brisk", exact: true }).click(); await panel.getByRole("spinbutton", { name: "Tee interval minutes" }).fill("12");
  expect(await page.evaluate(() => window.__liveOverviewFixture.calls())).toEqual([["golfer",41],["assign","staff-exact","course-secondary"],["schedule","staff-exact",150,660],["preset","brisk"],["pace",{teeIntervalMinutes:12}]]);
  await page.evaluate(() => window.__liveOverviewFixture.visibility({ pace: "hidden", mobility: "hidden", staff: "summary" })); await expect(panel.getByRole("tab")).toHaveCount(3); await expect(panel.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab", { name: "Staff", exact: true }).click(); await expect(panel.locator('[data-testid^="staff-shift-controls"]')).toHaveCount(0);
  await page.evaluate(() => window.__liveOverviewFixture.visibility({ pace: "summary", mobility: "hidden", staff: "summary" })); await panel.getByRole("tab", { name: "Pace", exact: true }).click(); await expect(panel.getByTestId("pace-summary-surface")).toBeVisible(); await expect(panel.getByRole("spinbutton")).toHaveCount(0);
  await page.evaluate(() => window.__liveOverviewFixture.visibility({ pace: "full", mobility: "full", staff: "full" }));
  for (const [index, system] of (["staffing", "pace", "mobility", "mobility"] as const).entries()) { await page.evaluate(value => window.__liveOverviewFixture.focus(value), system); await expect.poll(() => page.evaluate(() => window.__liveOverviewFixture.calls().filter(row => row[0] === "focus").length)).toBe(index + 1); }
});
test("Live overview preserves list caps, standings order, report periods and locale selection", async ({ page }) => {
  await page.goto(`${fixture}?many`); const panel=page.getByTestId("live-overview"); await expect(panel.locator("button:has(b)")).toHaveCount(24);
  await panel.getByRole("tab", {name:"Leaderboard",exact:true}).click(); await expect(panel.locator("li")).toHaveCount(12);
  const names=await panel.locator("li b").allTextContents(); expect(names.map(name=>Number(name.split("_").at(-1)))).toEqual(Array.from({length:12},(_,index)=>index));
  await panel.getByRole("tab", {name:"Pace",exact:true}).click(); await expect(panel.getByTestId("pace-history")).toContainText("19 / 2");
  await panel.getByTestId("pace-history").getByRole("combobox").last().selectOption("28"); await expect(panel.getByTestId("pace-history")).toContainText("33 / 2");
  await panel.getByRole("tab", {name:"Staff",exact:true}).click(); await page.evaluate(()=>window.__liveOverviewFixture.locale("pseudo"));
  await expect(panel.getByRole("tab").nth(2)).toHaveAttribute("aria-selected","true"); await expect(panel.getByRole("tabpanel")).toContainText("Alexandria_");
  expect(await page.evaluate(()=>window.__liveOverviewFixture.calls())).toEqual([]);
});
test("Live overview fleet guards preserve exact configure, purchase and salvage boundaries", async ({ page }) => {
  await page.goto(`${fixture}?fleet`); const panel=page.getByTestId("live-overview"); await panel.getByRole("tab",{name:"Mobility",exact:true}).click();
  const product=panel.getByTestId("mobility-product-rental-exact-pushcart"), preview=await page.evaluate(()=>window.__liveOverviewFixture.preview()); expect(preview).not.toBeNull();
  await expect(product.getByRole("button",{name:"Apply standing policy"})).toBeDisabled(); await product.getByRole("spinbutton").fill("999"); await product.getByRole("button",{name:"Apply standing policy"}).click();
  expect(await page.evaluate(()=>window.__liveOverviewFixture.calls())).toEqual([["configure","rental-exact","pushcart",{enabled:preview!.enabled,price:250}]]);
  page.once("dialog",dialog=>dialog.dismiss()); await product.getByRole("button",{name:/Buy 1/}).click(); expect((await page.evaluate(()=>window.__liveOverviewFixture.calls())).length).toBe(1);
  page.once("dialog",dialog=>dialog.accept()); await product.getByRole("button",{name:/Buy 1/}).click();
  page.once("dialog",dialog=>dialog.dismiss()); await product.getByRole("button",{name:"Salvage 1",exact:true}).click(); expect((await page.evaluate(()=>window.__liveOverviewFixture.calls())).length).toBe(2);
  page.once("dialog",dialog=>dialog.accept()); await product.getByRole("button",{name:"Salvage 1",exact:true}).click();
  expect(await page.evaluate(()=>window.__liveOverviewFixture.calls())).toEqual([["configure","rental-exact","pushcart",{enabled:preview!.enabled,price:250}],["purchase","rental-exact","pushcart",1],["salvage","rental-exact","pushcart",1]]);
  await page.evaluate(()=>window.__liveOverviewFixture.reserveAll()); await expect(product.getByRole("button",{name:"Salvage 1",exact:true})).toBeDisabled();
  await page.evaluate(()=>window.__liveOverviewFixture.poor()); await expect(product.getByRole("button",{name:/Buy 1/})).toBeDisabled();
});
test("Live selected state and keyboard focus have measured painted contrast", async ({ page }) => {
  await page.goto(fixture); const panel=page.getByTestId("live-overview"), tab=panel.getByRole("tab").first(); await page.getByTestId("outside-before").focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await expect(tab).toBeFocused();
  const style=await tab.evaluate(node=>{const s=getComputedStyle(node);return {color:s.color,background:s.backgroundColor,outline:s.outlineColor,outlineWidth:parseFloat(s.outlineWidth),underline:parseFloat(s.borderBottomWidth)};});
  expect(contrast(style.color,style.background)).toBeGreaterThanOrEqual(4.5); expect(contrast(style.outline,style.background)).toBeGreaterThanOrEqual(3); expect(style.outlineWidth).toBeGreaterThanOrEqual(3); expect(style.underline).toBeGreaterThan(1);
});
for (const locale of ["en", "pseudo"] as const) for (const viewport of [{ width:320,height:640 },{width:768,height:800},{width:1280,height:800}]) {
  test(`Live overview ${locale} ${viewport.width} grows 130 percent and preserves complete text`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale); await page.setViewportSize(viewport); await page.goto(fixture);
    const panel = page.getByTestId("live-overview"), title = panel.locator("header strong"); const before = await title.evaluate(node => parseFloat(getComputedStyle(node).fontSize)); await page.evaluate(() => document.documentElement.style.fontSize = "20.8px");
    expect(Math.abs(await title.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) / before - 1.3)).toBeLessThan(.01);
    for (const key of keys) {
      await panel.getByRole("tab").nth(keys.indexOf(key)).click();
      const text = panel.locator('[style*="font-size"],button,input,select,label,small,b,strong');
      await page.evaluate(() => document.documentElement.style.fontSize = "16px"); const baseline = await text.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
      await page.evaluate(() => document.documentElement.style.fontSize = "20.8px"); const scaled = await text.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
      expect(scaled.length).toBeGreaterThan(4); expect(scaled).toHaveLength(baseline.length); for (let i=0;i<scaled.length;i++) expect(Math.abs(scaled[i]/baseline[i]-1.3)).toBeLessThan(.01);
      expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const nodes = panel.locator("header strong,header div > div,button,label,small,b");
      for (const node of await nodes.all()) { await node.scrollIntoViewIfNeeded(); expect(await node.evaluate(element => { const range=document.createRange(); range.selectNodeContents(element); const box=element.closest('[data-testid="live-overview"]')!.getBoundingClientRect(); return [...range.getClientRects()].every(rect => rect.width===0 || (rect.left>=box.left-1 && rect.right<=box.right+1 && rect.top>=box.top-1 && rect.bottom<=box.bottom+1)); })).toBe(true); }
    }
    await page.screenshot({path:testInfo.outputPath(`live-${locale}-${viewport.width}.png`)});
  });
}
