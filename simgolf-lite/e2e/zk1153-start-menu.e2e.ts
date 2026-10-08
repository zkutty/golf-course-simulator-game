import { expect, test, type Page } from "@playwright/test";
import { contrastRatio } from "../src/ui/biomeUiTheme";

// A development-only fixture mounts the real menu, preserving install/demo
// coverage without test branches in the shipped component or game renderer.
async function fixture(page: Page, canLoad: boolean, optionalActions: boolean) {
  await page.goto("/e2e/start-menu-fixture.html");
  await page.evaluate(async ({ canLoad, optionalActions }) => {
    const fixture = await import("/e2e/start-menu-fixture.tsx");
    fixture.mountStartMenu(canLoad, optionalActions);
  }, { canLoad, optionalActions });
  await expect(page.getByTestId("start-menu")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function calls(page: Page) {
  return page.evaluate(async () => [...(await import("/e2e/start-menu-fixture.tsx")).calls]);
}

async function assertUsableControls(page: Page) {
  const menu = page.getByTestId("start-menu");
  expect(await menu.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const button of await menu.getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const geometry = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        fitsText: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
        hit: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("button") === element,
        width: box.width,
        height: box.height,
      };
    });
    expect(geometry.fitsText).toBe(true);
    expect(geometry.hit).toBe(true);
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
  }
  await menu.evaluate((element) => { element.scrollTop = 0; });
}

test("each action preserves its callback and audio contract, including optional actions", async ({ page }) => {
  await fixture(page, true, true);
  const actions = [
    { label: "The Vision", events: ["audio", "vision"] },
    { label: "Continue", events: ["audio", "continue"] },
    { label: "New Game", events: ["audio", "new"] },
    { label: "Quick Start", events: ["audio", "quick"] },
    { label: "First-hole operator demo", events: ["demo"] },
    { label: "Load Game", events: ["audio", "load"] },
    { label: "Options", events: ["audio", "options"] },
    { label: "Trophy Gallery", events: ["achievements"] },
    { label: "Install CourseCraft", events: ["install"] },
  ];
  const expected: string[] = [];
  for (const action of actions) {
    await page.getByRole("button", { name: action.label, exact: true }).click();
    expected.push(...action.events);
    expect(await calls(page)).toEqual(expected);
  }
  await page.evaluate(async () => (await import("/e2e/start-menu-fixture.tsx")).mountStartMenu(false, false));
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "First-hole operator demo", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Install CourseCraft", exact: true })).toHaveCount(0);
  const load = page.getByRole("button", { name: "Load Game", exact: true });
  await expect(load).toBeDisabled();
  await expect(load).toHaveAccessibleDescription("No saved game");
  await load.evaluate((button: HTMLButtonElement) => button.click());
  expect(await calls(page)).toEqual([]);
});

test("title screen launches setup, opens utilities and Vision, and continues a real save", async ({ page }, testInfo) => {
  await page.goto("/");
  const menu = page.getByTestId("start-menu");
  await expect(menu.getByRole("button", { name: "Load Game", exact: true })).toBeDisabled();
  await menu.getByRole("button", { name: "New Game", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screenBase)).toBe("setup-wizard");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await menu.getByRole("button", { name: "Options", exact: true }).click();
  await expect(page.getByTestId("options-screen")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await menu.getByRole("button", { name: "Trophy Gallery", exact: true }).click();
  await expect(page.getByTestId("retention-hub")).toBeVisible();
  await page.getByTestId("retention-hub").getByRole("button", { name: "Close", exact: true }).click();
  await menu.getByRole("button", { name: "The Vision", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("vision-page")).toBeVisible();
  await page.getByRole("button", { name: "Back to game", exact: true }).first().click();
  await menu.getByRole("button", { name: "Quick Start", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().screen)).toBe("game");
  await page.evaluate(() => window.__coursecraftTest!.runGoldenWeek());
  await page.reload();
  const continueButton = menu.getByRole("button", { name: "Continue", exact: true });
  await expect(continueButton).toHaveAccessibleDescription("Resume your most recent course");
  await page.setViewportSize({ width: 390, height: 844 });
  const prevented = await page.evaluate(() => {
    const state = window as typeof window & { __menuInstallPrompts: number };
    state.__menuInstallPrompts = 0;
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => { state.__menuInstallPrompts += 1; },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  const install = menu.getByRole("button", { name: "Install CourseCraft", exact: true });
  await expect(install).toBeVisible();
  const savedPhone = await page.screenshot({ path: "artifacts/zk1153/home-real-saved-phone-install.png" });
  await testInfo.attach("home-real-saved-phone-install", { body: savedPhone, contentType: "image/png" });
  await assertUsableControls(page);
  expect(await menu.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const reporter = page.getByRole("button", { name: "Report a bug", exact: true });
  await expect(reporter).toBeVisible();
  expect(await reporter.evaluate((element) => {
    const launcher = element.getBoundingClientRect();
    return [...document.querySelectorAll(".cc-start-menu button")].every((button) => {
      const action = button.getBoundingClientRect();
      return launcher.right <= action.left || launcher.left >= action.right || launcher.bottom <= action.top || launcher.top >= action.bottom;
    });
  })).toBe(true);
  expect(await reporter.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("button") === element;
  })).toBe(true);
  await menu.getByRole("button", { name: "Options", exact: true }).click();
  await expect(page.getByTestId("options-screen")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await install.click();
  expect(await page.evaluate(() => (window as typeof window & { __menuInstallPrompts: number }).__menuInstallPrompts)).toBe(1);
  await expect(install).toHaveCount(0);
  await continueButton.click();
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest?.state().week)).toBe(2);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, dpr: 1 },
  { name: "laptop", width: 1280, height: 720, dpr: 1 },
  { name: "phone", width: 390, height: 844, dpr: 1 },
  { name: "phone-retina", width: 390, height: 844, dpr: 2 },
  { name: "wide", width: 2560, height: 1080, dpr: 1 },
  { name: "desktop-retina", width: 1440, height: 900, dpr: 2 },
]) {
  test(`responsive hierarchy and controls at ${viewport.name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.dpr, reducedMotion: "reduce" });
    const page = await context.newPage();
    await fixture(page, false, true);
    await assertUsableControls(page);
    const menu = page.getByTestId("start-menu");
    const dimensions = await menu.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    const fresh = await page.screenshot({ path: `artifacts/zk1153/home-${viewport.name}.png` });
    await testInfo.attach(`home-${viewport.name}`, { body: fresh, contentType: "image/png" });
    await page.evaluate(async () => (await import("/e2e/start-menu-fixture.tsx")).mountStartMenu(true, true));
    await expect(menu.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await assertUsableControls(page);
    const savedDimensions = await menu.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
    expect(savedDimensions.scroll).toBeLessThanOrEqual(savedDimensions.client + 1);
    const saved = await page.screenshot({ path: `artifacts/zk1153/home-saved-${viewport.name}.png` });
    await testInfo.attach(`home-saved-${viewport.name}`, { body: saved, contentType: "image/png" });
    await menu.getByRole("button", { name: "Continue", exact: true }).focus();
    await page.keyboard.press("Enter");
    expect(await calls(page)).toEqual(["audio", "continue"]);
    await context.close();
  });
}

test("pseudo copy and 200% text stay readable and keyboard operable with reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("coursecraft_locale", "pseudo"));
  await fixture(page, true, true);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await assertUsableControls(page);
  const button = page.getByRole("button", { name: /Çôñtïñüë/ });
  await button.focus();
  await expect(button).toBeFocused();
  expect(await button.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  expect(await button.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.keyboard.press("Enter");
  expect(await calls(page)).toEqual(["audio", "continue"]);
  const enlarged = await page.screenshot({ path: "artifacts/zk1153/home-pseudo-200.png" });
  await testInfo.attach("home-pseudo-200", { body: enlarged, contentType: "image/png" });
});


test("rendered helper text, actions and keyboard focus meet contrast thresholds", async ({ page }) => {
  await fixture(page, false, true);
  const pairs = await page.getByTestId("start-menu").evaluate((menu) => {
    const paper = getComputedStyle(menu.querySelector(".cc-start-shell")!).backgroundColor;
    const forest = getComputedStyle(menu).backgroundColor;
    const pairs: { name: string; foreground: string; background: string; minimum: number }[] = [];
    for (const element of menu.querySelectorAll(".cc-start-action button, .cc-start-action p, .cc-start-version")) {
      const style = getComputedStyle(element);
      const background = style.backgroundColor === "rgba(0, 0, 0, 0)"
        ? element.closest(".cc-start-identity") ? forest : paper
        : style.backgroundColor;
      pairs.push({ name: element.textContent ?? "", foreground: style.color, background, minimum: 4.5 });
    }
    return pairs;
  });
  const colorHex = (color: string) => `#${color.match(/\d+/g)!.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  for (const pair of pairs) {
    expect(contrastRatio(colorHex(pair.foreground), colorHex(pair.background)), pair.name).toBeGreaterThanOrEqual(pair.minimum);
  }
  for (const label of ["The Vision", "New Game", "Quick Start", "Options"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.focus();
    const pair = await button.evaluate((element) => {
      const menu = element.closest(".cc-start-menu")!;
      const background = element.closest(".cc-start-identity")
        ? getComputedStyle(menu).backgroundColor
        : getComputedStyle(menu.querySelector(".cc-start-shell")!).backgroundColor;
      return { foreground: getComputedStyle(element).outlineColor, background };
    });
    expect(contrastRatio(colorHex(pair.foreground), colorHex(pair.background)), `${label} focus`).toBeGreaterThanOrEqual(3);
  }
});

test("Vision keeps its shared palette and editorial layout at the paired viewports", async ({ page }, testInfo) => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1280, height: 720 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?view=vision");
    const vision = page.getByTestId("vision-page");
    await expect(page.getByRole("heading", { name: "Build the course. Shape the world." })).toBeVisible();
    await expect(page.locator(".cc-vision-hero img")).toHaveJSProperty("complete", true);
    await page.evaluate(() => document.fonts.ready);
    expect(await vision.evaluate((element) => {
      const style = getComputedStyle(element);
      return ["ink", "forest", "moss", "cream", "paper", "gold", "rust"].every((name) =>
        style.getPropertyValue(`--vision-${name}`).trim() === style.getPropertyValue(`--brand-${name}`).trim());
    })).toBe(true);
    const screenshot = await page.screenshot({ path: `artifacts/zk1153/vision-${viewport.name}.png`, animations: "disabled" });
    await testInfo.attach(`vision-${viewport.name}`, { body: screenshot, contentType: "image/png" });
  }
});
