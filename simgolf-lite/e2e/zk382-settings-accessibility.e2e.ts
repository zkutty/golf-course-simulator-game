import { expect, test } from "@playwright/test";

const fixture = "/e2e/fixtures/zk382-settings-accessibility.html";

test("GameTabs roves focus and calls selection for Arrow, Home, End and click", async ({ page }) => {
  await page.goto(fixture);
  const tabs = page.getByTestId("tabs-demo").getByRole("tab");
  await tabs.nth(0).focus();
  const expectedCalls: string[] = [];
  for (const [key, index] of [["ArrowRight", 1], ["End", 2], ["ArrowRight", 0], ["ArrowLeft", 2], ["Home", 0]] as const) {
    await page.keyboard.press(key);
    expectedCalls.push(["One", "Two", "Three"][index]);
    await expect(page.getByTestId("tab-log")).toHaveText(expectedCalls.join(","));
    await expect(tabs.nth(index)).toBeFocused();
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
    expect(await tabs.evaluateAll((items) => items.filter((item) => (item as HTMLButtonElement).tabIndex === 0).length)).toBe(1);
  }
  await tabs.nth(1).click();
  await expect(page.getByTestId("tab-log")).toHaveText("Two,Three,One,Three,One,Two");
});

test("Settings tab relationships, profile callbacks, reset and nested remapping preserve focus", async ({ page }) => {
  await page.goto(fixture);
  const opener = page.getByTestId("open-settings");
  await opener.click();
  const screen = page.getByTestId("options-screen");
  const tabs = screen.getByRole("tab");
  await expect(screen.getByRole("button", { name: "Close options" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(screen.getByRole("button", { name: "Done", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(screen.getByRole("button", { name: "Close options" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(tabs.first()).toBeFocused();
  for (const [key, index] of [["ArrowRight", 1], ["ArrowRight", 2], ["End", 3], ["Home", 0]] as const) {
    await page.keyboard.press(key);
    await expect(tabs.nth(index)).toBeFocused();
    const id = await tabs.nth(index).getAttribute("id");
    const panel = screen.getByRole("tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", id!);
    await expect(tabs.nth(index)).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);
  }
  await screen.getByLabel("Autosave cadence").selectOption("off");
  await expect(page.getByTestId("change-count")).toHaveText("1");
  let profile = JSON.parse((await page.getByTestId("profile").textContent())!);
  expect(profile).toMatchObject({ version: 5, gameplay: { autosaveCadence: "off" } });
  await screen.getByLabel("Advisor frequency").selectOption("important");
  profile = JSON.parse((await page.getByTestId("profile").textContent())!);
  expect(profile).toMatchObject({ advisorFrequency: "important", gameplay: { autosaveCadence: "off" } });
  page.once("dialog", (dialog) => dialog.accept());
  await screen.getByRole("button", { name: "Reset Gameplay" }).click();
  profile = JSON.parse((await page.getByTestId("profile").textContent())!);
  expect(profile).toMatchObject({ version: 5, advisorFrequency: "important", gameplay: { autosaveCadence: "weekly" } });
  await tabs.nth(3).click();
  await screen.getByRole("button", { name: "Configure keybindings…" }).click();
  const nested = page.getByTestId("keybindings-panel");
  const pause = nested.getByRole("button", { name: "Rebind Pause / resume" });
  await pause.click();
  await page.keyboard.press("KeyP");
  await expect(pause).toHaveText("P");
  const speed = nested.getByRole("button", { name: "Rebind Speed 1×" });
  await speed.click();
  await page.keyboard.press("KeyP");
  await expect(nested.getByRole("alert")).toContainText("already assigned");
  await page.keyboard.press("Escape");
  await expect(nested).toBeVisible();
  await expect(speed).toHaveText("1");
  await expect(page.getByTestId("close-count")).toHaveText("0");
  await page.keyboard.press("Escape");
  await expect(nested).toHaveCount(0);
  await expect(screen).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(screen).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByTestId("close-count")).toHaveText("1");
  await page.reload();
  await opener.click();
  await tabs.nth(3).click();
  await screen.getByRole("button", { name: "Configure keybindings…" }).click();
  await expect(pause).toHaveText("P");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("coursecraft_app_profile_v5")!).version)).toBe(5);
});

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`Settings contains reachable controls with measured 130% text: ${locale} ${width}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const height = width === 320 ? 640 : 800;
    await page.setViewportSize({ width, height });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture);
    await page.getByTestId("open-settings").click();
    const screen = page.getByTestId("options-screen");
    const panel = screen.locator(".cc-options-panel");
    const tabs = screen.getByRole("tab");
    const fontSizes = () => panel.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("header *, [role=tab], [role=tabpanel] *, footer button")).map((item) => Number.parseFloat(getComputedStyle(item).fontSize)));
    const baselines: number[][] = [];
    for (let index = 0; index < 4; index++) { await tabs.nth(index).click(); baselines.push(await fontSizes()); }
    await screen.getByRole("tabpanel").locator("select").nth(1).selectOption("130");
    await expect(page.locator("html")).toHaveAttribute("style", "font-size: 130%;");
    for (let index = 0; index < 4; index++) {
      await tabs.nth(index).click();
      const scaled = await fontSizes();
      expect(scaled.length).toBe(baselines[index].length);
      scaled.forEach((fontSize, item) => expect(Math.abs(fontSize / baselines[index][item] - 1.3), `tab ${index} element ${item}: ${baselines[index][item]} -> ${fontSize}`).toBeLessThan(.01));
      const bounds = await panel.evaluate((element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: element.clientWidth, scrollWidth: element.scrollWidth }; });
      expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const controls = panel.locator('button:not([tabindex="-1"]), input, select');
      for (let controlIndex = 0; controlIndex < await controls.count(); controlIndex++) {
        const control = controls.nth(controlIndex);
        await control.focus(); await expect(control).toBeFocused();
        const rect = await control.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left); expect(rect.right).toBeLessThanOrEqual(bounds.right);
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top); expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
    }
    await screen.getByRole("tabpanel").getByRole("button").click();
    const nested = page.getByTestId("keybindings-panel");
    const controls = nested.getByRole("button");
    for (let index = 0; index < await controls.count(); index++) {
      await controls.nth(index).focus();
      const bounds = await controls.nth(index).evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height);
    }
    await page.keyboard.press("Escape"); await expect(nested).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(screen).toHaveCount(0);
    await expect(page.getByTestId("open-settings")).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("Golfopedia shared tabs preserve keyboard selection and content", async ({ page }) => {
  await page.goto(fixture);
  await page.getByTestId("open-golfopedia").click();
  const dialog = page.getByRole("dialog");
  const tabs = dialog.getByRole("tab");
  await tabs.first().focus(); await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused(); await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await tabs.nth(1).getAttribute("id"))!);
  await expect(dialog.getByTestId("golfopedia-entry")).toContainText("Golfers");
  await page.keyboard.press("End");
  await expect(dialog.getByTestId("current-keybindings")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
});
