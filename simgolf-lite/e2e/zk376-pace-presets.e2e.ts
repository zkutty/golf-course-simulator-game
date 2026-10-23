import { expect, test, type Page } from "@playwright/test";
import { formatStaffShiftMinute } from "../src/ui/liveOverviewPresentation";
import { formatCurrency } from "../src/i18n/format";
import { PACE_PRESETS } from "../src/game/models/courseOperations";
import type { PacePreset } from "../src/game/models/types";
import { translate, type Locale } from "../src/i18n/core";
import { registerPacePreviewCatalog } from "../src/i18n/pacePreviewCatalog";

// The browser picker registers its deferred copy when loaded; initialize the
// same catalog in the Node assertion context before computing expected labels.
registerPacePreviewCatalog();

const hosts = ["inspector", "live"] as const;
type Host = typeof hosts[number];
async function open(page: Page, host: Host, locale: Locale = "en") {
  await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
  await page.goto(`/e2e/fixtures/zk382-${host === "inspector" ? "contextual-inspector" : "live-overview"}.html`);
  const panel = page.getByTestId(host === "inspector" ? "contextual-inspector" : "live-overview");
  await panel.getByRole("tab").nth(host === "inspector" ? 1 : 3).click();
  return panel.getByTestId("pace-preset-picker");
}
async function calls(page: Page, host: Host) {
  return host === "inspector"
    ? page.getByTestId("callback-log").evaluate((node: HTMLOutputElement) => node.value ? node.value.split(",") : [])
    : page.evaluate(() => window.__liveOverviewFixture.calls());
}

for (const host of hosts) {
  test(`Pace preview ${host} renders authoritative settings and mutates only on explicit apply`, async ({ page }) => {
    const picker = await open(page, host);
    for (const preset of ["relaxed", "balanced", "brisk"] as PacePreset[]) {
      const operations = PACE_PRESETS[preset];
      await picker.getByRole("button", { name: translate("en", `live.pace.preset.${preset}`), exact: true }).click();
      expect(await calls(page, host)).toEqual([]);
      const preview = picker.getByTestId("pace-preset-preview");
      await expect(preview).toContainText("including any manual overrides");
      const values: Record<string, string> = {
        preset: translate("en", `live.pace.preset.${operations.preset}`),
        teeIntervalMinutes: `${operations.teeIntervalMinutes} min`, maxGroupSize: String(operations.maxGroupSize),
        starterGapEveryGroups: operations.starterGapEveryGroups === 0 ? "No extra gap" : `Every ${operations.starterGapEveryGroups} groups`,
        timeParStyle: translate("en", `pacePreview.timePar.${operations.timeParStyle}`),
        teeGuidance: translate("en", `pacePreview.teeGuidance.${operations.teeGuidance}`),
        enforcement: translate("en", `pacePreview.enforcement.${operations.enforcement}`),
        lastTeeMinute: formatStaffShiftMinute(operations.lastTeeMinute),
        daylightPolicy: operations.daylightPolicy === "finish_started" ? "Let started groups finish" : "Stop at sunset",
        compensationPolicy: operations.compensationPolicy === "goodwill" ? "Goodwill voucher" : operations.compensationPolicy === "credit" ? "Club credit" : "Cash refund",
        "beverage.menu": operations.beverage.menu === "off" ? "Off" : "Refreshments",
        "beverage.passes": String(operations.beverage.passes), "beverage.alcoholLimit": String(operations.beverage.alcoholLimit),
        "beverage.price": formatCurrency(operations.beverage.price),
      };
      expect(Object.keys(values)).toHaveLength(Object.keys(operations).length - 1 + Object.keys(operations.beverage).length);
      await expect(preview.locator("[data-setting]")).toHaveCount(Object.keys(values).length);
      for (const [setting, expected] of Object.entries(values)) await expect(preview.locator(`[data-setting="${setting}"] dd`)).toHaveText(expected);
      await preview.getByRole("button", { name: "Cancel preview", exact: true }).click();
      await expect(preview).toHaveCount(0);
      expect(await calls(page, host)).toEqual([]);
    }
    const trigger = picker.getByRole("button", { name: "Brisk", exact: true });
    await trigger.focus(); await page.keyboard.press("Enter");
    await expect(picker.getByRole("heading")).toBeFocused();
    await page.keyboard.press("Tab"); await expect(picker.getByRole("button", { name: "Cancel preview" })).toBeFocused();
    await page.keyboard.press("Enter"); await expect(trigger).toBeFocused(); expect(await calls(page, host)).toEqual([]);
    await page.keyboard.press("Enter"); await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); expect(await calls(page, host)).toEqual([]);
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    await expect(picker.getByRole("button", { name: "Apply preset" })).toBeFocused(); await page.keyboard.press("Enter");
    await expect(trigger).toBeFocused(); await expect(picker.getByTestId("pace-preset-preview")).toHaveCount(0);
    expect(await calls(page, host)).toEqual(host === "inspector" ? ["pace-brisk"] : [["preset", "brisk"]]);
    if (host === "live") {
      expect(await page.evaluate(() => window.__liveOverviewFixture.immutable())).toBe(true);
      await page.getByRole("spinbutton", { name: "Tee interval minutes" }).fill("12");
      await page.getByRole("combobox", { name: "Beverage service", exact: true }).selectOption("beer_wine");
      await page.getByRole("spinbutton", { name: "Last tee minute", exact: true }).fill("555");
      await page.getByRole("combobox", { name: "Daylight policy", exact: true }).selectOption("strict_sunset");
      await page.getByRole("combobox", { name: "Guest recovery", exact: true }).selectOption("refund");
      expect(await calls(page, host)).toEqual([["preset", "brisk"], ["pace", { teeIntervalMinutes: 12 }], ["pace", { beverage: { menu: "beer_wine" } }], ["pace", { lastTeeMinute: 555 }], ["pace", { daylightPolicy: "strict_sunset" }], ["pace", { compensationPolicy: "refund" }]]);
    }
  });
  for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768]) {
    test(`Pace preview ${host} ${locale} ${width} scales and fits at 100 and 130 percent`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const picker = await open(page, host, locale);
      await picker.getByRole("button", { name: translate(locale, "live.pace.preset.balanced"), exact: true }).click();
      const text = picker.locator("button,h3,p,dt,dd");
      await page.evaluate(() => document.documentElement.style.fontSize = "16px");
      const baseline = await text.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
      for (const scale of [1, 1.3]) {
        await page.evaluate(value => document.documentElement.style.fontSize = `${16 * value}px`, scale);
        const actual = await text.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
        expect(actual.length).toBe(baseline.length);
        actual.forEach((value, index) => expect(value / baseline[index]).toBeCloseTo(scale, 2));
        expect(await picker.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        for (const node of await text.all()) {
          await node.scrollIntoViewIfNeeded();
          expect(await node.evaluate(element => {
            const panel = element.closest('[data-testid="contextual-inspector"], [data-testid="live-overview"]')!.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(element);
            return [...range.getClientRects()].every(rect => rect.width === 0 || (rect.left >= panel.left - 1 && rect.right <= panel.right + 1 && rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1));
          })).toBe(true);
        }
      }
      await picker.getByRole("button", { name: translate(locale, "pacePreview.cancel"), exact: true }).focus();
      await page.keyboard.press("Enter"); expect(await calls(page, host)).toEqual([]);
      const trigger = picker.getByRole("button", { name: translate(locale, "live.pace.preset.balanced"), exact: true });
      await expect(trigger).toBeFocused(); await page.keyboard.press("Enter");
      await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
      expect(await calls(page, host)).toEqual(host === "inspector" ? ["pace-balanced"] : [["preset", "balanced"]]);
      await trigger.click();
      await picker.getByRole("button", { name: translate(locale, "pacePreview.apply"), exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`pace-${host}-${locale}-${width}-130.png`) });
    });
  }
}
