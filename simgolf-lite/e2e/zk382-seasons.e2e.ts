import { expect, test, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
test.setTimeout(60000);
const fixture = "/e2e/fixtures/zk382-seasons.html";
const fonts = (surface: Locator) => surface.evaluate(el => Array.from(el.querySelectorAll<HTMLElement>("*" )).filter(item => Array.from(item.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map(item => ({ tag: item.tagName, text: item.textContent, size: parseFloat(getComputedStyle(item).fontSize) })));
for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) test(`Seasons scalable readable nonmodal views ${locale} ${width}`, async ({ page }, info) => {
  const errors: string[] = []; const renderer: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
  await page.setViewportSize({ width, height: width === 320 ? 640 : 800 });
  await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
  await page.goto(fixture);
  const panel = page.getByTestId("seasons-legacy-panel");
  const measurements: unknown[] = [];
  for (let view = 0; view < 3; view++) {
    const tabs = panel.getByRole("tab");
    if (await tabs.count()) await tabs.nth(view).click(); else await panel.locator("nav button").nth(view).click();
    await page.evaluate(() => document.documentElement.style.fontSize = "100%");
    const before = await fonts(panel);
    await page.evaluate(() => document.documentElement.style.fontSize = "130%");
    expect(await page.locator("html").evaluate(el => getComputedStyle(el).fontSize)).toBe("20.8px");
    const after = await fonts(panel);
    const measurement = after.map((item, i) => ({ ...item, baseline: before[i].size, ratio: item.size / before[i].size }));
    measurements.push({ view, measurement });
    writeFileSync(`/private/tmp/zk382-seasons-${locale}-${width}-${view}.json`, JSON.stringify(measurement, null, 2));
    for (const item of measurement) expect(Math.abs(item.ratio - 1.3), `${item.tag} ${item.text}: ${item.baseline}→${item.size}`).toBeLessThan(.01);
    await expect(panel).toHaveAttribute("aria-modal", "false");
    for (const select of await panel.locator("select").all()) expect(await select.evaluate(el => (el as HTMLSelectElement).labels?.[0]?.textContent?.trim())).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    for (const control of await panel.locator("button,select,summary,h3,strong,p,small").all()) {
      if (!await control.isVisible()) continue;
      if (await control.evaluate(el => !!el.closest(".cc-seasons-forecast"))) continue;
      await control.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
      const bounds = await control.boundingBox(); expect(bounds).not.toBeNull();
      const viewportHeight = width === 320 ? 640 : 800;
      expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewportHeight + 1);
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await control.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
  }
  await info.attach("scaled seasons", { body: await page.screenshot({ path: `/private/tmp/golf-batch7-seasons-${locale}-${width}-green.png` }), contentType: "image/png" });
  await info.attach("font measurements", { body: JSON.stringify(measurements), contentType: "application/json" });
  await expect(panel.getByRole("tab")).toHaveCount(3);
  await panel.getByRole("tab").first().focus(); await page.keyboard.press("End"); await expect(panel.getByRole("tab").nth(2)).toBeFocused();
  await page.keyboard.press("ArrowRight"); await expect(panel.getByRole("tab").first()).toBeFocused(); await page.keyboard.press("Home");
  const active = panel.getByRole("tab", { selected: true });
  await expect(panel.getByRole("tabpanel")).toHaveAttribute("id", (await active.getAttribute("aria-controls"))!);
  await expect(panel.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await active.getAttribute("id"))!);
  const forecast = panel.getByTestId("seven-day-forecast"); await forecast.focus(); await expect(forecast).toBeFocused();
  await forecast.evaluate(el => el.scrollLeft = 0);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => forecast.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await forecast.evaluate(el => new Promise<void>(resolve => {
    let previous = el.scrollLeft; let stableFrames = 0;
    const settle = () => { const current = el.scrollLeft; stableFrames = current === previous ? stableFrames + 1 : 0; previous = current; if (stableFrames >= 5) resolve(); else requestAnimationFrame(settle); }; requestAnimationFrame(settle);
  }));
  for (const day of await forecast.locator("> div").all()) {
    await day.evaluate(el => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }));
    const dayBounds = await day.boundingBox(); const regionBounds = await forecast.boundingBox();
    expect(dayBounds!.x).toBeGreaterThanOrEqual(regionBounds!.x - 1); expect(dayBounds!.x + dayBounds!.width).toBeLessThanOrEqual(regionBounds!.x + regionBounds!.width + 1);
    expect(await day.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  const body = panel.locator(".cc-seasons-body"); await body.focus(); await page.keyboard.press("PageDown"); await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.getByTestId("outside").focus(); await expect(page.getByTestId("outside")).toBeFocused(); await page.keyboard.press("Escape"); await expect(panel).toBeVisible();
  await expect(panel.locator("svg")).toHaveAttribute("aria-hidden", "true"); expect(await panel.locator("svg").evaluate(el => el.tabIndex)).toBe(-1);
  await panel.locator(".cc-seasons-close").click();
  await expect(page.getByTestId("log")).toHaveText('[{"type":"close"}]'); await expect(page.getByTestId("immutable")).toHaveText("true");
  expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
});

test("Seasons preserves exact command, repair and navigation payloads", async ({ page }) => {
  await page.goto(fixture);
  const panel = page.getByTestId("seasons-legacy-panel");
  await expect(panel.getByTestId("seven-day-forecast").locator("> div")).toHaveCount(7);
  await panel.getByTestId("turf-priority").selectOption("recovery");
  await panel.getByTestId("water-policy").selectOption("irrigate");
  await panel.getByTestId("improve-drainage").click();
  await panel.getByRole("button", { name: "Close for forecast", exact: true }).click();
  await panel.getByRole("button", { name: "Reopen", exact: true }).click();
  const repairKey = await page.getByTestId("repair-key").textContent();
  const absoluteDay = Number(await page.getByTestId("absolute-day").textContent());
  await panel.getByTestId(`reseed-${repairKey}`).click(); await panel.getByTestId(`resod-${repairKey}`).click();
  await panel.getByRole("tab").nth(1).click();
  await expect(panel.locator('[data-testid^="charter-"]')).toHaveCount(4);
  const selected = await panel.locator('[data-testid^="charter-"]').filter({ has: page.getByRole("button", { name: "Current charter", exact: true }) }).getAttribute("data-testid");
  const charter = selected === "charter-championship-venue" ? "public-gem" : "championship-venue";
  await panel.getByTestId(`charter-${charter}`).getByRole("button").click();
  await panel.getByTestId("automation-preset").selectOption("growth");
  await panel.getByTestId("system-operation-open-maintenance").click();
  await panel.getByTestId("system-operation-open-irrigation").click();
  await expect(panel.locator('[data-operation-system="irrigation"]')).toBeFocused();
  await expect(panel.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab").nth(2).click();
  await expect(panel.locator('[data-testid^="yearbook-"]').filter({ has: page.locator("h3") }).first()).toHaveAttribute("data-testid", "yearbook-2");
  await panel.getByTestId("acknowledge-yearbook").click();
  await expect(panel.locator("section").last().locator("ol li")).toHaveCount(30);
  await expect(panel.locator("section").last().locator("ol li").first()).toContainText("Authored timeline title 34");
  await expect(page.getByTestId("log")).toHaveText(JSON.stringify([
    { type: "SET_TURF_PRIORITY", priority: "recovery" }, { type: "SET_WATER_POLICY", policy: "irrigate" }, { type: "IMPROVE_DRAINAGE" },
    { type: "SET_COURSE_CLOSED", courseId: "course-primary", closed: true, currentDay: 3 }, { type: "SET_COURSE_CLOSED", courseId: "course-closed", closed: false, currentDay: 3 },
    { type: "repair", key: repairKey, kind: "reseed", absoluteDay }, { type: "repair", key: repairKey, kind: "resod", absoluteDay },
    { type: "SELECT_CHARTER", charter, confirmed: true }, { type: "SET_AUTOMATION", preset: "growth" }, { type: "navigate", system: "maintenance" }, { type: "ACKNOWLEDGE_YEARBOOK", yearbookId: "yearbook-authored-2" },
  ]));
  await expect(page.getByTestId("immutable")).toHaveText("true");
});

for (const profile of ["classic", "relaxed", "simulation"]) test(`Seasons keeps ${profile} policy visibility and graduation`, async ({ page }) => {
  await page.goto(`${fixture}?profile=${profile}`);
  const panel = page.getByTestId("seasons-legacy-panel");
  for (const id of ["turf-priority", "water-policy", "improve-drainage"]) await expect(panel.getByTestId(id)).toHaveCount(profile === "simulation" ? 1 : 0);
  await panel.getByRole("tab").nth(1).click();
  await expect(panel.getByTestId("simulation-operations")).toHaveCount(profile === "simulation" ? 1 : 0);
  if (profile !== "simulation") {
    await panel.getByTestId("classic-back-office-systems").locator("summary").click();
    await panel.getByTestId("back-office-policy-drainage").getByRole("button").click();
    await panel.getByTestId("graduate-experience-profile").click();
    await expect(page.getByTestId("log")).toHaveText(JSON.stringify([{ type: "TAKE_SYSTEM_CONTROL", system: "drainage" }, { type: "GRADUATE_EXPERIENCE_PROFILE", target: profile === "relaxed" ? "classic" : "simulation" }]));
  } else {
    await expect(panel.getByTestId("graduate-experience-profile")).toHaveCount(0);
    await expect(panel.getByTestId("system-policy-drainage").getByRole("button")).toBeDisabled();
  }
  if (profile === "relaxed") {
    const audit = panel.getByTestId("relaxed-recovery-audit"); await audit.locator("summary").click();
    await expect(audit.locator('[data-testid^="recovery-receipt-"]')).toHaveCount(8);
    await expect(audit.locator('[data-testid^="recovery-receipt-"]').first()).toHaveAttribute("data-testid", "recovery-receipt-receipt-11");
  }
  await expect(page.getByTestId("immutable")).toHaveText("true");
});

test("Seasons preserves disabled previews, active repair, return control, empty history and handled focus nonce", async ({ page }) => {
  await page.goto(`${fixture}?state=poor`);
  let panel = page.getByTestId("seasons-legacy-panel");
  await expect(panel.getByTestId("improve-drainage")).toBeDisabled();
  for (const control of await panel.locator('[data-testid^="reseed-"],[data-testid^="resod-"]').all()) await expect(control).toBeDisabled();
  await panel.getByRole("tab").nth(1).click();
  for (const control of await panel.locator('[data-testid^="charter-"] button').all()) await expect(control).toBeDisabled();
  await expect(page.getByTestId("log")).toHaveText("[]");
  await page.goto(`${fixture}?state=repair`); panel = page.getByTestId("seasons-legacy-panel");
  const key = await page.getByTestId("repair-key").textContent();
  await expect(panel.getByTestId(`surface-repair-active-${key}`)).toContainText("1.5/8 suitable days"); await expect(panel.getByTestId(`reseed-${key}`)).toHaveCount(0);
  await page.goto(`${fixture}?profile=classic&state=override`); panel = page.getByTestId("seasons-legacy-panel");
  await panel.getByRole("tab").nth(1).click(); await panel.getByText("Manual system overrides", { exact: true }).click();
  await panel.getByTestId("system-policy-drainage").getByRole("button").click();
  await expect(page.getByTestId("log")).toHaveText('[{"type":"RETURN_SYSTEM_TO_PROFILE","system":"drainage"}]');
  await page.goto(`${fixture}?state=empty`); panel = page.getByTestId("seasons-legacy-panel"); await panel.getByRole("tab").nth(2).click();
  await expect(panel.getByTestId("yearbook-empty-state")).toBeVisible(); await expect(panel.getByTestId("timeline-empty-state")).toBeVisible();
  await page.goto(`${fixture}?focus=1`); panel = page.getByTestId("seasons-legacy-panel");
  await expect(panel.locator('[data-operation-system="drainage"]')).toBeFocused();
  await expect(page.getByTestId("log")).toHaveText('[{"type":"handled","nonce":73}]');
  await panel.getByRole("tab").nth(1).click(); await panel.getByRole("tab").nth(0).click();
  await expect(page.getByTestId("log")).toHaveText('[{"type":"handled","nonce":73}]');
});
