import { expect, test, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
import type { TournamentQualificationSnapshot, TournamentTier } from "../src/game/tournaments/types";
const fixture = "/e2e/fixtures/zk382-tournament.html";
const sizes = (panel: Locator) => panel.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>("*"))
  .filter((item) => item.tagName !== "OPTION" && getComputedStyle(item).display !== "none" && Array.from(item.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
  .map((item) => ({ text: item.textContent, tag: item.tagName, size: parseFloat(getComputedStyle(item).fontSize) })));
const bounds = (item: Locator) => item.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; });
for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`Tournament measured fonts and complete readable content: ${locale} ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = []; const renderer: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("request", (request) => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
    const height = width === 320 ? 640 : 800; await page.setViewportSize({ width, height });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale); await page.goto(fixture); await page.evaluate(() => document.fonts.ready);
    const input = await page.evaluate(() => JSON.stringify((window as unknown as { tournamentFixture: unknown }).tournamentFixture));
    const panel = page.getByTestId("tournament-panel");
    await panel.locator("details").evaluateAll((items) => items.forEach((el) => (el as HTMLDetailsElement).open = true));
    const baseline = await sizes(panel); await page.evaluate(() => document.documentElement.style.fontSize = "130%"); const scaled = await sizes(panel);
    const measurements = { root: await page.locator("html").evaluate((el) => getComputedStyle(el).fontSize), panel: await bounds(panel), fonts: scaled.map((item, i) => ({ ...item, baseline: baseline[i].size, ratio: item.size / baseline[i].size })) };
    writeFileSync(`/private/tmp/zk382-tournament-${locale}-${width}.json`, JSON.stringify(measurements, null, 2));
    await testInfo.attach("font-and-layout-measurements", { body: JSON.stringify(measurements), contentType: "application/json" });
    expect(measurements.root).toBe("20.8px");
    for (const item of measurements.fonts) expect(Math.abs(item.ratio - 1.3), `${item.tag} ${item.text}`).toBeLessThan(.01);
    expect(measurements.panel.left).toBeGreaterThanOrEqual(0); expect(measurements.panel.right).toBeLessThanOrEqual(width); expect(measurements.panel.bottom).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(panel).toHaveAttribute("aria-modal", "false");
    await page.getByTestId("operations-focus").click(); await expect(panel).toBeFocused();
    await page.keyboard.press("PageDown"); await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await panel.evaluate(async (el) => {
      let stable = 0; let previous = el.scrollTop;
      while (stable < 4) { await new Promise(requestAnimationFrame); const current = el.scrollTop; stable = current === previous ? stable + 1 : 0; previous = current; }
    });
    const texts = panel.locator("h2, h3, label, .cc-tournament__requirement, .cc-tournament__entrant, .cc-tournament__progress, .cc-tournament__score, .cc-tournament__event > strong, summary, .cc-tournament__warning, .cc-tournament__stats, button");
    for (let i = 0; i < await texts.count(); i++) {
      const item = texts.nth(i); await item.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      const r = await bounds(item); const container = await bounds(panel);
      expect(r.left).toBeGreaterThanOrEqual(container.left); expect(r.right).toBeLessThanOrEqual(container.right);
      expect(r.top, await item.textContent() ?? "text").toBeGreaterThanOrEqual(container.top); expect(r.bottom, await item.textContent() ?? "text").toBeLessThanOrEqual(container.bottom);
      expect(r.scrollWidth, await item.textContent() ?? "text").toBeLessThanOrEqual(r.clientWidth);
    }
    const controls = panel.locator("button, select, summary");
    for (let i = 0; i < await controls.count(); i++) {
      await controls.nth(i).focus(); await expect(controls.nth(i)).toBeFocused();
      const r = await bounds(controls.nth(i)); const container = await bounds(panel);
      expect(r.top).toBeGreaterThanOrEqual(container.top); expect(r.bottom).toBeLessThanOrEqual(container.bottom);
    }
    await expect(panel.getByTestId("tournament-tier")).toHaveAccessibleName(locale === "en" ? "Prestige tier" : /Prëstïgë tïër/);
    await expect(panel.getByTestId("tournament-date")).toHaveAccessibleName(locale === "en" ? "Tournament date" : /Tôürñámëñt dátë/);
    for (const tier of ["local", "regional", "championship"]) {
      await panel.getByTestId("tournament-tier").selectOption(tier);
      const label = panel.locator(".cc-tournament__selected-tier"); await label.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      if (locale === "pseudo" && width === 320 && tier === "championship") {
        const nativeMeasurement = await panel.getByTestId("tournament-tier").evaluate((el) => {
          const select = el as HTMLSelectElement; const span = document.createElement("span"); span.textContent = select.selectedOptions[0].text;
          span.style.cssText = `font:${getComputedStyle(select).font};position:absolute;white-space:nowrap;visibility:hidden;width:max-content`; document.body.append(span);
          const intrinsic = span.getBoundingClientRect().width; const style = getComputedStyle(select); const control = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); span.remove(); return { intrinsic, control };
        });
        await testInfo.attach("native-select-full-label-measurement", { body: JSON.stringify(nativeMeasurement), contentType: "application/json" });
        expect(nativeMeasurement.intrinsic).toBeGreaterThan(nativeMeasurement.control);
      }
      const selected = await panel.getByTestId("tournament-tier").locator("option:checked").textContent(); await expect(label).toHaveText(selected!);
      const r = await bounds(label); const container = await bounds(panel); expect(r.left).toBeGreaterThanOrEqual(container.left); expect(r.right).toBeLessThanOrEqual(container.right); expect(r.top).toBeGreaterThanOrEqual(container.top); expect(r.bottom).toBeLessThanOrEqual(container.bottom); expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth);
    }
    await panel.getByTestId("tournament-tier").selectOption("local");
    await expect(panel.locator("svg")).toHaveCount(11);
    expect(await panel.locator("svg").evaluateAll((icons) => icons.every((el) => el.getAttribute("aria-hidden") === "true"))).toBe(true);
    await expect(panel.locator(".cc-tournament__state")).toHaveText(Array(10).fill(locale === "en" ? "Met" : "⟦Mët ···⟧"));
    await page.getByTestId("outside-after").focus(); await expect(page.getByTestId("outside-after")).toBeFocused();
    await page.keyboard.press("Escape"); await expect(panel).toBeVisible(); await expect(page.getByTestId("close-count")).toHaveText("0");
    await panel.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
    await testInfo.attach("scaled-tournament", { body: await page.screenshot({ path: `/private/tmp/zk382-tournament-${locale}-${width}-green.png` }), contentType: "image/png" });
    await panel.getByRole("button", { name: locale === "en" ? "Close tournaments" : /Çlôsë tôürñámëñts/ }).click();
    await expect(panel).toHaveCount(0); await expect(page.getByTestId("close-count")).toHaveText("1");
    expect(await page.evaluate(() => JSON.stringify((window as unknown as { tournamentFixture: unknown }).tournamentFixture))).toBe(input);
    for (const scenario of ["ineligible", "live"]) {
      await page.goto(`${fixture}?scenario=${scenario}`); await page.evaluate(() => document.fonts.ready);
      const branch = page.getByTestId("tournament-panel");
      if (scenario === "ineligible") await branch.getByTestId("schedule-tournament").click();
      const before = await sizes(branch); await page.evaluate(() => document.documentElement.style.fontSize = "130%"); const after = await sizes(branch);
      for (let i = 0; i < before.length; i++) expect(Math.abs(after[i].size / before[i].size - 1.3), `${scenario} ${before[i].tag} ${before[i].text}`).toBeLessThan(.01);
      const branchText = branch.locator(".cc-tournament__warning:visible, .cc-tournament__notice:visible, .cc-tournament__state:visible, .cc-tournament__entrant:visible, .cc-tournament__progress:visible, .cc-tournament__score:visible");
      for (let i = 0; i < await branchText.count(); i++) {
        const item = branchText.nth(i); await item.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        const r = await bounds(item); const container = await bounds(branch);
        expect(r.left).toBeGreaterThanOrEqual(container.left); expect(r.right).toBeLessThanOrEqual(container.right); expect(r.top).toBeGreaterThanOrEqual(container.top); expect(r.bottom).toBeLessThanOrEqual(container.bottom); expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth);
      }
    }
    expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
  });
}
for (const locale of ["en", "pseudo"] as const) {
  test(`Tournament preserves eligibility values, tier/date callbacks and async notices: ${locale}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale); await page.goto(`${fixture}?scenario=ready`);
    const panel = page.getByTestId("tournament-panel");
    expect(await panel.getByTestId("tournament-tier").locator("option").evaluateAll((options) => options.map((el) => el.getAttribute("value")))).toEqual(["local", "regional", "championship"]);
    expect(await panel.getByTestId("tournament-date").locator("option").evaluateAll((options) => options.map((el) => el.getAttribute("value")))).toEqual(["1", "3", "7"]);
    if (locale === "en") await expect(panel.getByTestId("tournament-tier").locator("option")).toHaveText(["Club Open", "Regional Invitational", "CourseCraft Championship"]);
    else expect(await panel.getByTestId("tournament-tier").locator("option").allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/^⟦/)]));
    const expectedCalls: unknown[] = [];
    for (const tier of ["local", "regional", "championship"] as TournamentTier[]) for (const daysAhead of [1, 3, 7]) {
      await panel.getByTestId("tournament-tier").selectOption(tier); await panel.getByTestId("tournament-date").selectOption(String(daysAhead));
      const qualification: TournamentQualificationSnapshot = await page.evaluate(({ tier, daysAhead }) => (window as unknown as { tournamentEligibility: (tier: TournamentTier, days: number) => TournamentQualificationSnapshot }).tournamentEligibility(tier, daysAhead), { tier, daysAhead });
      const requirements = panel.locator("[data-requirement]"); await expect(requirements).toHaveCount(qualification.requirements.length);
      for (const item of qualification.requirements) {
        const row = panel.locator(`[data-requirement="${item.id}"]`); await expect(row).toHaveAttribute("data-passed", String(item.passed));
        const text = await row.locator("small").textContent();
        const pseudo = (value: string) => value.replace(/[AaEeIiOoUuCcNnYy]/g, (c) => ({ a:"á",A:"Á",e:"ë",E:"Ë",i:"ï",I:"Ï",o:"ô",O:"Ô",u:"ü",U:"Ü",c:"ç",C:"Ç",n:"ñ",N:"Ñ",y:"ÿ",Y:"Ÿ" }[c]!));
        expect(text).toContain(locale === "en" ? item.current : pseudo(item.current)); expect(text).toContain(locale === "en" ? item.required : pseudo(item.required));
        await expect(row.locator(".cc-tournament__state")).toHaveText(locale === "en" ? item.passed ? "Met" : "Unmet" : item.passed ? "⟦Mët ···⟧" : "⟦Üñmët ···⟧");
      }
      expect(qualification.eligible).toBe(true); await panel.getByTestId("schedule-tournament").click(); expectedCalls.push({ tier, daysAhead });
      await expect.poll(() => page.evaluate(() => (window as unknown as { tournamentCalls: unknown[] }).tournamentCalls)).toEqual(expectedCalls);
      await expect(panel.locator(".cc-tournament__notice")).toContainText(locale === "en" ? "Tournament booked." : "Tôürñámëñt bôôkëd.");
    }
    await page.goto(`${fixture}?scenario=ready&failure=1`); await page.getByTestId("schedule-tournament").click(); await expect(page.getByTestId("tournament-panel").getByRole("status")).toHaveText("Returned booking failure");
  });
  test(`Tournament history and live scores retain ordering and complete names: ${locale}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale); await page.goto(fixture);
    const panel = page.getByTestId("tournament-panel");
    expect(await panel.locator("[data-event-id]").evaluateAll((events) => events.map((el) => el.getAttribute("data-event-id")))).toEqual(["upcoming-earlier", "upcoming-later", "completed-5", "completed-4", "completed-3", "completed-2", "cancelled-4", "cancelled-3", "cancelled-2"]);
    await expect(panel.locator("[data-event-id=upcoming-earlier]")).toContainText(locale === "en" ? "member · Pin B" : "mëmbër · Pïñ B");
    await expect(panel.getByRole("alert").first()).toContainText(locale === "en" ? "member / Pin B is invalid" : "mëmbër / Pïñ B ïs ïñválïd");
    await expect(panel.getByTestId("tournament-cancellation")).toContainText(locale === "en" ? "Hosting deposit forfeited" : "Hôstïñg dëpôsït fôrfëïtëd");
    await page.goto(`${fixture}?scenario=live`); const live = page.getByTestId("active-tournament");
    await expect(page.getByTestId("schedule-tournament")).toHaveCount(0); await expect(page.getByTestId("tournament-tier")).toHaveCount(0);
    const names = await page.evaluate(() => (window as unknown as { tournamentFixture: { rows: { name: string }[] } }).tournamentFixture.rows.map((row) => row.name));
    await expect(live.locator(".cc-tournament__entrant")).toHaveText(names);
    await expect(live.locator(".cc-tournament__score")).toHaveText(["-4", locale === "en" ? "Even" : "⟦Ëvëñ ···⟧", "+3"]);
    await expect(live.locator(".cc-tournament__progress")).toHaveText(locale === "en" ? ["Finished", "8 thru", "11 thru"] : ["⟦Fïñïshëd ···⟧", "⟦8 thrü ···⟧", "⟦11 thrü ···⟧"]);
  });
}
for (const profile of ["relaxed", "classic", "simulation"]) {
  test(`Tournament ${profile} confirmation preserves schedule operation`, async ({ page }) => {
    await page.goto(`${fixture}?scenario=ready&profile=${profile}`);
    const dialogs: string[] = []; page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.getByTestId("schedule-tournament").click();
    if (profile === "simulation") { expect(dialogs).toHaveLength(1); expect(await page.evaluate(() => (window as unknown as { tournamentCalls: unknown[] }).tournamentCalls)).toEqual([]);
      page.removeAllListeners("dialog"); page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
      await page.getByTestId("tournament-tier").selectOption("regional"); await page.getByTestId("tournament-date").selectOption("7"); await page.getByTestId("schedule-tournament").click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { tournamentCalls: unknown[] }).tournamentCalls)).toEqual([{ tier: "regional", daysAhead: 7 }]);
      expect(dialogs[1]).toContain("$3,500"); expect(dialogs[1]).toContain("$14,000");
    } else { expect(dialogs).toEqual([]); await expect.poll(() => page.evaluate(() => (window as unknown as { tournamentCalls: unknown[] }).tournamentCalls)).toEqual([{ tier: "local", daysAhead: 1 }]); }
  });
}
test("Tournament ineligible never schedules or asks for confirmation", async ({ page }) => {
  await page.goto(`${fixture}?scenario=ineligible&profile=simulation`); const dialogs: string[] = []; page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await expect(page.locator('[data-requirement=reputation] .cc-tournament__state')).toHaveText("Unmet");
  await expect(page.locator('[data-requirement=deposit] .cc-tournament__state')).toHaveText("Unmet");
  await page.getByTestId("schedule-tournament").click(); await expect(page.getByTestId("tournament-panel").getByRole("status")).toContainText("Not eligible");
  expect(await page.evaluate(() => (window as unknown as { tournamentCalls: unknown[] }).tournamentCalls)).toEqual([]); expect(dialogs).toEqual([]);
});
