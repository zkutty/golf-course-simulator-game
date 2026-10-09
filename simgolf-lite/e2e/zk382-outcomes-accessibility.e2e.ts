import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { translate } from "../src/i18n/core";
import { formatWeekLabel } from "../src/i18n/format";

test.use({ video: "off" });
test.setTimeout(30000);
const fixture = "/e2e/fixtures/zk382-outcomes.html";
const open = async (page: Page, query = "") => { await page.goto(fixture + query); await page.getByTestId("opener").click(); };

test("outcome dialogs are named and initially focus their required action", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Run ended: Time ran out" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByRole("button", { name: "Retry this run" })).toBeFocused();
});

for (const variant of ["deadline", "bankrupt", "victory", "victory-no-week"]) for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) test(`outcome scales ${variant} ${locale} ${width}`, async ({ page }, info) => {
  const errors: string[] = [], renderer: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
  const height = width === 320 ? 640 : 800;
  await page.setViewportSize({ width, height });
  await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
  await open(page, `?variant=${variant.startsWith("victory") ? "victory" : variant}&long=1${variant === "victory-no-week" ? "&noWonWeek=1&noNote=1" : ""}`);
  const textFonts = () => page.locator(".cc-main").evaluate(el => Array.from(el.querySelectorAll<HTMLElement>("*"))
    .filter(item => item.getClientRects().length && Array.from(item.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
    .filter(item => !item.matches('[data-testid="opener"], [data-testid="outside"]'))
    .map(item => ({ text: item.textContent, size: parseFloat(getComputedStyle(item).fontSize) })));
  const baseline = await textFonts();
  await page.evaluate(() => document.documentElement.style.fontSize = "130%");
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).fontSize)).toBe("20.8px");
  const measurements = (await textFonts()).map((item, i) => ({ ...item, baseline: baseline[i].size, ratio: item.size / baseline[i].size }));
  const evidencePath = `/private/tmp/zk382-outcomes-${variant}-${locale}-${width}-${process.env.OUTCOME_EVIDENCE_SUFFIX ?? "attempt3"}`;
  writeFileSync(`${evidencePath}-fonts.json`, JSON.stringify(measurements, null, 2));
  await info.attach("font growth", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
  await info.attach("expanded outcome", { body: await page.screenshot({ path: `${evidencePath}-actions.png` }), contentType: "image/png" });
  for (const item of measurements) expect(Math.abs(item.ratio - 1.3), `${item.text}: ${item.baseline} → ${item.size}`).toBeLessThan(.01);
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const body = dialog.getByTestId("outcome-body");
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await body.focus(); await body.evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: `${evidencePath}-heading.png` });
  if (await body.evaluate(el => el.scrollHeight > el.clientHeight)) { await page.keyboard.press("PageDown"); await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0); }
  // Native PageDown can continue across animation frames. Measure only after it settles.
  await body.evaluate(el => new Promise<void>(resolve => {
    let previous = el.scrollTop, stableFrames = 0;
    const settle = () => { const current = el.scrollTop; stableFrames = current === previous ? stableFrames + 1 : 0; previous = current; if (stableFrames >= 5) resolve(); else requestAnimationFrame(settle); };
    requestAnimationFrame(settle);
  }));
  // Check every authored text and action can be brought into the viewport without clipping.
  for (const item of await dialog.locator("h2,p,dt,dd,li strong,li span,label,input,button").all()) {
    await item.evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
    const bounds = (await item.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y, await item.textContent() ?? "input").toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
    expect(await item.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.keyboard.press("Tab");
  const action = dialog.getByRole("button").first(); await action.focus();
  const focusStyle = await action.evaluate(el => { const s = getComputedStyle(el); return { width: s.outlineWidth, style: s.outlineStyle, color: s.outlineColor, offset: s.outlineOffset, background: s.backgroundColor, shadow: s.boxShadow, keyboardFocus: el.matches(":focus-visible") }; });
  expect(parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(3); expect(focusStyle.style).toBe("solid"); const luminance = (color: string) => {
    const rgb = color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const inset = focusStyle.shadow.includes("inset");
  const indicatorColor = inset ? focusStyle.shadow.match(/rgba?\([^)]+\)/)![0] : focusStyle.color;
  const shadowLengths = inset ? focusStyle.shadow.replace(/rgba?\([^)]+\)/, "").match(/-?\d+(?:\.\d+)?px/g)!.map(parseFloat) : [];
  const visibleInsetWidth = inset ? shadowLengths[3] - Math.max(0, -parseFloat(focusStyle.offset)) : 0;
  const ring = luminance(indicatorColor), surface = luminance(focusStyle.background);
  const contrast = (Math.max(ring, surface) + .05) / (Math.min(ring, surface) + .05);
  writeFileSync(`${evidencePath}-focus.json`, JSON.stringify({ ...focusStyle, indicatorColor, visibleInsetWidth, contrast }, null, 2));
  await page.screenshot({ path: `${evidencePath}-focus.png` });
  expect(focusStyle.keyboardFocus).toBe(true);
  expect(contrast).toBeGreaterThanOrEqual(3);
  expect(visibleInsetWidth).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Escape"); await page.mouse.click(1, 1); await expect(dialog).toBeVisible(); await expect(page.getByTestId("log")).toHaveText("[]");
  await expect(page.getByTestId("immutable")).toHaveText("true");
  expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
});

test("deadline filtering, ordering, raw labels and passed statistics remain exact", async ({ page }) => {
  await open(page); const dialog = page.getByRole("dialog");
  expect(await dialog.locator("li strong").allTextContents()).toEqual(["Cash", "Goal 4 raw authored label"]);
  await expect(dialog.getByText("Missed deadline", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("week 1,201", { exact: false })).toBeVisible();
  expect(await dialog.locator("dd").allTextContents()).toEqual(["1,235", "87", "$1,234,567", "72.3 / 131"]);
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("spinbutton")).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByTestId("outcome-body")).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "New game", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(dialog.getByTestId("outcome-body")).toBeFocused();
  await page.getByTestId("outside").evaluate(el => (el as HTMLElement).focus()); expect(await page.getByTestId("outside").evaluate(el => el === document.activeElement)).toBe(false);
  expect(await page.locator(".cc-main").evaluate(el => (el as HTMLElement).inert)).toBe(false);
});

for (const variant of ["bankrupt", "deadline"]) test(`defeat ${variant} with absent objectives still offers actions`, async ({ page }) => {
  await open(page, `?variant=${variant}&noObjectives=1`); const dialog = page.getByRole("dialog");
  await expect(dialog.locator("li")).toHaveCount(0); await expect(dialog.getByRole("button")).toHaveCount(3);
  await dialog.getByRole("button", { name: "New game", exact: true }).click(); await expect(page.getByTestId("log")).toHaveText('[{"type":"new"}]'); await expect(page.getByTestId("opener")).toBeFocused();
});

for (const [input, expected] of [["19.9", 19], ["-19.9", -19], ["4294967297", 1], ["", 0]] as const) test(`retry preserves bitwise seed normalization ${input || "empty"}`, async ({ page }) => {
  await open(page); const dialog = page.getByRole("dialog"); await dialog.getByRole("spinbutton").fill(input);
  await dialog.getByRole("button", { name: "Retry this run" }).click(); await expect(page.getByTestId("log")).toHaveText(JSON.stringify([{ type: "retry", seed: expected }])); await expect(page.getByTestId("opener")).toBeFocused();
});

test("real nested SaveLoad takes focus and Cancel returns focus to Load", async ({ page }) => {
  await open(page); const defeat = page.getByRole("dialog", { name: "Run ended: Time ran out" }); const load = defeat.getByRole("button", { name: "Load a save" });
  await load.click(); const nested = page.getByTestId("save-load-screen"); await expect(nested).toBeVisible();
  await expect(nested.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(nested.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(nested.getByRole("button").first()).toBeFocused();
  await nested.getByRole("button", { name: "Close", exact: true }).click(); await expect(nested).toHaveCount(0); await expect(load).toBeFocused(); await expect(defeat).toBeVisible();
  await expect(page.getByTestId("log")).toHaveText('[{"type":"load"}]');
  await page.keyboard.press("Escape"); await expect(page.getByTestId("log")).toHaveText('[{"type":"load"}]');
});

for (const locale of ["en", "pseudo"] as const) test(`victory preserves summary and all goal weeks ${locale}`, async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale); await open(page, "?variant=victory"); const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: translate(locale, "auto.ui.victorymodal.keep.playing") })).toBeFocused();
  await expect(dialog.getByText(translate(locale, "outcome.victory.summaryDeadline", { course: "Long Meadow", week: formatWeekLabel(1234, locale, "week") }), { exact: true })).toBeVisible();
  expect(await dialog.locator("li strong").allTextContents()).toEqual(["Goal 1 raw authored label", translate(locale, "stat.cash"), "Goal 3 raw authored label", "Goal 4 raw authored label"]);
  await expect(dialog.getByText(formatWeekLabel(1199, locale, "week"), { exact: true })).toBeVisible();
  expect(await dialog.locator("dd").allTextContents()).toEqual(["1,235", "$1,234,567", "87/100", "72.3"]);
  await dialog.getByRole("button").click(); await expect(page.getByTestId("log")).toHaveText('[{"type":"continue"}]'); await expect(page.getByTestId("opener")).toBeFocused();
});

for (const reducedMotion of ["reduce", "no-preference"] as const) test(`confetti respects ${reducedMotion}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion }); await open(page, "?variant=victory"); const field = page.getByTestId("outcome-confetti");
  await expect(field).toHaveAttribute("aria-hidden", "true");
  const motion = await field.evaluate(el => ({ display: getComputedStyle(el).display, animations: Array.from(el.querySelectorAll("span")).map(piece => getComputedStyle(piece).animationName) }));
  if (reducedMotion === "reduce") { expect(motion.display).toBe("none"); expect(motion.animations.every(name => name === "none")).toBe(true); }
  else { expect(motion.display).not.toBe("none"); expect(motion.animations.every(name => name !== "none")).toBe(true); }
});


for (const timing of ["existing", "late"]) for (const interaction of ["pointer", "keyboard"]) test(`existing campaign authority ${timing} ${interaction}`, async ({ page }) => {
  await open(page, `?variant=victory&campaign=${timing}`);
  const outcome = page.getByRole("dialog", { name: "Objectives complete!" });
  const frame = page.getByTestId("course-frame");
  if (timing === "late") {
    await expect.poll(() => frame.evaluate(el => (el as HTMLElement).inert)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("fixture-open-campaign")));
  }
  const scene = page.getByTestId("campaign-scene");
  await expect(scene).toBeVisible();
  const choice = scene.getByRole("button").first();
  await expect(choice).toBeFocused();
  await expect.poll(() => outcome.evaluate(el => (el as HTMLElement).inert)).toBe(true);
  await page.keyboard.press("Shift+Tab"); await expect(scene.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Tab"); await expect(choice).toBeFocused();
  await page.keyboard.press("Tab"); await expect(scene.getByRole("button").last()).toBeFocused();
  await page.getByTestId("course-controls").evaluate(el => el.appendChild(document.createElement("span")));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(scene.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(choice).toBeFocused();
  await page.screenshot({ path: `/private/tmp/zk382-outcome-campaign-${timing}-${interaction}-top.png` });
  await expect.poll(() => frame.evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await expect.poll(() => scene.evaluate(el => { let node: HTMLElement | null = el as HTMLElement; while (node) { if (node.inert) return true; node = node.parentElement; } return false; })).toBe(false);
  for (const control of ["outside", "course-action", "course-nested-action", "campaign-sibling-action"]) {
    await page.getByTestId(control).evaluate(el => (el as HTMLElement).focus());
    expect(await page.getByTestId(control).evaluate(el => el === document.activeElement)).toBe(false);
  }
  if (interaction === "pointer") await choice.click();
  else { await expect(choice).toBeFocused(); await page.keyboard.press("Enter"); }
  await expect(scene).toHaveCount(0);
  const contract = JSON.parse((await page.getByTestId("campaign-contract").textContent())!);
  await expect(page.getByTestId("campaign-log")).toHaveText(JSON.stringify([contract]));
  await expect(page.getByTestId("log")).toHaveText("[]");
  await expect.poll(() => frame.evaluate(el => (el as HTMLElement).inert)).toBe(true);
  await expect(outcome).toBeVisible();
  await expect(outcome.getByRole("button", { name: "Keep playing" })).toBeFocused();
  await expect.poll(() => outcome.evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await page.screenshot({ path: `/private/tmp/zk382-outcome-campaign-${timing}-${interaction}-return.png` });
  await outcome.getByRole("button", { name: "Keep playing" }).click();
  await expect(page.getByTestId("log")).toHaveText('[{"type":"continue"}]');
  await expect(page.getByTestId("opener")).toBeFocused();
  await expect.poll(() => frame.evaluate(el => (el as HTMLElement).inert)).toBe(false);
  for (const control of ["course-action", "course-nested-action", "campaign-sibling-action"]) {
    await page.getByTestId(control).focus(); await expect(page.getByTestId(control)).toBeFocused();
  }
  await expect(page.getByTestId("campaign-immutable")).toHaveText("true");
});


test("campaign removal preserves pre-existing inert state and cleanup authority", async ({ page }) => {
  await page.goto(fixture + "?variant=victory&campaign=existing");
  const controls = page.getByTestId("course-controls");
  await controls.evaluate(el => { (el as HTMLElement).inert = true; el.setAttribute("aria-hidden", "false"); });
  await page.getByTestId("opener").click();
  const scene = page.getByTestId("campaign-scene"); await expect(scene.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Enter"); await expect(scene).toHaveCount(0);
  const outcome = page.getByRole("dialog", { name: "Objectives complete!" });
  await expect(outcome.getByRole("button")).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("opener")).toBeFocused();
  await expect.poll(() => controls.evaluate(el => (el as HTMLElement).inert)).toBe(true);
  await expect(controls).toHaveAttribute("aria-hidden", "false");
  await expect.poll(() => page.getByTestId("course-frame").evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await expect(page.getByTestId("log")).toHaveText('[{"type":"continue"}]');
});

test("campaign child z-index respects its lower ancestor stacking context", async ({ page }) => {
  await open(page, "?variant=victory&campaign=existing&lowerCampaignStack=1");
  const outcome = page.getByRole("dialog", { name: "Objectives complete!" });
  await expect(outcome.getByRole("button")).toBeFocused();
  expect(await outcome.evaluate(el => (el as HTMLElement).inert)).toBe(false);
  const lowerChoice = page.getByTestId("campaign-scene").getByRole("button").first();
  await lowerChoice.evaluate(el => (el as HTMLElement).focus());
  expect(await lowerChoice.evaluate(el => el === document.activeElement)).toBe(false);
  await expect.poll(() => page.getByTestId("course-frame").evaluate(el => (el as HTMLElement).inert)).toBe(true);
  await expect(outcome.getByRole("button")).toBeFocused();
  await page.keyboard.press("Tab"); await expect(outcome.getByTestId("outcome-body")).toBeFocused();
  await page.keyboard.press("Tab"); await expect(outcome.getByRole("button")).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByTestId("log")).toHaveText('[{"type":"continue"}]');
});


test("Defeat late campaign hands back native focus to Retry without extra actions", async ({ page }) => {
  await open(page, "?variant=deadline&campaign=late");
  const defeat = page.getByRole("dialog", { name: "Run ended: Time ran out" });
  await expect(defeat.getByRole("button", { name: "Retry this run" })).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-open-campaign")));
  const scene = page.getByTestId("campaign-scene"), choice = scene.getByRole("button").first();
  await expect(choice).toBeFocused(); await expect.poll(() => defeat.evaluate(el => (el as HTMLElement).inert)).toBe(true);
  await page.keyboard.press("Shift+Tab"); await expect(scene.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Tab"); await expect(choice).toBeFocused(); await page.keyboard.press("Enter");
  await expect(scene).toHaveCount(0); await expect(defeat.getByRole("button", { name: "Retry this run" })).toBeFocused();
  const contract = JSON.parse((await page.getByTestId("campaign-contract").textContent())!);
  await expect(page.getByTestId("campaign-log")).toHaveText(JSON.stringify([contract]));
  await expect(page.getByTestId("log")).toHaveText("[]");
  await page.keyboard.press("Escape"); await expect(page.getByTestId("log")).toHaveText("[]");
  await page.keyboard.press("Enter"); await expect(page.getByTestId("log")).toHaveText('[{"type":"retry","seed":12345}]');
  await expect(page.getByTestId("opener")).toBeFocused(); await expect(page.getByTestId("campaign-immutable")).toHaveText("true");
});
