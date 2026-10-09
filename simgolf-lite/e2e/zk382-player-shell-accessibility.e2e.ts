import { expect, test, type Page } from "@playwright/test";
const keys = ["career", "play", "training", "matches", "tournaments", "people", "challenges", "teamBuilder", "equipment", "wardrobe", "collection", "custody"] as const;
const fullName = "Alexandra Isabella Montgomery-Wellington of the Riverside Golf Club";
function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

async function open(page: Page, query = "") {
  await page.goto(`/e2e/fixtures/zk382-player-shell.html${query}`);
  await expect(page.getByTestId("player-pro-panel")).toBeVisible();
}
async function immutable(page: Page) {
  expect(await page.evaluate(() => {
    const source = (window as unknown as { playerShellFixture: { fixture: unknown; initial: string } }).playerShellFixture;
    return JSON.stringify(source.fixture) === source.initial;
  })).toBe(true);
}
test("ZK-382 Player shell has one twelve-key roving model, stable routes and nonmodal exit", async ({ page }) => {
  await open(page);
  const panel = page.getByTestId("player-pro-panel");
  await expect(panel).toHaveAttribute("aria-modal", "false");
  await expect(panel.getByRole("tablist")).toHaveCount(1);
  await expect(panel.getByRole("tab")).toHaveCount(12);
  await expect(panel.getByTestId("player-pro-tab-career")).toHaveAttribute("aria-selected", "true");
  for (const key of keys) {
    const tab = panel.getByTestId(`player-pro-tab-${key}`);
    await tab.click();
    await expect(tab).toHaveAttribute("id", `player-pro-tab-${key}`);
    await expect(tab).toHaveAttribute("aria-controls", `player-pro-surface-${key}`);
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("tabpanel")).toHaveAttribute("id", `player-pro-surface-${key}`);
    await expect(panel.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", `player-pro-tab-${key}`);
    await expect(panel.locator('[role=tab][aria-selected=true]')).toHaveCount(1);
    await expect(panel.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
    await expect(panel).not.toContainText("UNREVEALED RIVAL VAULT");
  }
  for (const [key, target] of [["ArrowRight", "career"], ["ArrowLeft", "custody"], ["Home", "career"], ["ArrowRight", "play"], ["End", "custody"]]) {
    await page.keyboard.press(key);
    await expect(panel.getByTestId(`player-pro-tab-${target}`)).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("tabpanel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await page.getByTestId("outside-after").focus();
  await expect(page.getByTestId("outside-after")).toBeFocused();
  await immutable(page);
  await panel.getByRole("button", { name: "Close Player Pro" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("callback-log")).toHaveJSProperty("value", JSON.stringify([{ name: "close", args: [] }]));
});
test("ZK-382 Player shell preserves form values, command arguments, notices and hidden carriers", async ({ page }) => {
  await open(page);
  const panel = page.getByTestId("player-pro-panel");
  await panel.getByRole("textbox").fill("Casey Fixture");
  await panel.getByRole("button", { name: "Save profile" }).click();
  await panel.getByTestId("player-pro-tab-play").click();
  const route = panel.getByTestId("player-pro-route");
  const routeId = await route.inputValue();
  const selects = panel.getByRole("combobox");
  await selects.nth(1).selectOption("forward");
  await selects.nth(2).selectOption("C");
  await panel.getByTestId("start-player-round").click();
  await expect(panel.getByRole("status").first()).toHaveText("Returned round notice");
  await panel.getByTestId("player-pro-tab-people").click();
  await expect(panel).toContainText("Rival One");
  await expect(panel).toContainText("Rival Ordinary Keepsake");
  await expect(panel).not.toContainText("UNREVEALED RIVAL VAULT");
  await panel.getByTestId("player-pro-tab-play").click();
  await expect(route).toHaveValue(routeId);
  await expect(selects.nth(1)).toHaveValue("forward");
  await expect(selects.nth(2)).toHaveValue("C");
  await expect(panel.getByRole("status").first()).toHaveText("Returned round notice");
  const calls = JSON.parse(await page.getByTestId("callback-log").evaluate((node: HTMLOutputElement) => node.value));
  expect(calls).toEqual([{ name: "identity", args: [expect.objectContaining({ name: "Casey Fixture", appearance: "classic", handedness: "right", background: "architect" })] }, { name: "start", args: [routeId, "forward", "C"] }]);
  await immutable(page);
});
test("ZK-382 Player shell retains active-round initial Play and resume", async ({ page }) => {
  await open(page, "?activeRound=1");
  const panel = page.getByTestId("player-pro-panel");
  await expect(panel.getByTestId("player-pro-tab-play")).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("tabpanel")).toHaveAttribute("id", "player-pro-surface-play");
  await panel.getByTestId("resume-player-round").click();
  await expect(page.getByTestId("callback-log")).toHaveJSProperty("value", JSON.stringify([{ name: "resume", args: [] }]));
  await immutable(page);
});
for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`ZK-382 Player shell ${locale} ${width}px scales shell text 130 percent and keeps body controls reachable`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.setViewportSize({ width, height: width === 320 ? 640 : 800 });
    await open(page);
    const panel = page.getByTestId("player-pro-panel");
    const sizes = () => panel.evaluate((node) => [node.querySelector("h2")!, node.querySelector("small")!, node.querySelector('[role=tab]')!].map((el) => parseFloat(getComputedStyle(el).fontSize)));
    const baseline = await sizes();
    await page.evaluate(() => { document.documentElement.style.fontSize = "20.8px"; });
    (await sizes()).forEach((size, index) => expect(Math.abs(size / baseline[index] - 1.3)).toBeLessThan(.01));
    await expect(panel.locator("h2")).toHaveText(fullName);
    await expect(page.locator("canvas")).toHaveCount(0);
    for (const key of keys) {
      const tab = panel.getByTestId(`player-pro-tab-${key}`);
      await tab.click();
      const metrics = await panel.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const body = node.querySelector<HTMLElement>('[role=tabpanel]')!;
        return { left: bounds.left, right: bounds.right, bottom: bounds.bottom, width: node.clientWidth, scrollWidth: node.scrollWidth, bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth, documentWidth: document.documentElement.scrollWidth };
      });
      expect(metrics.left).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(width);
      expect(metrics.bottom).toBeLessThanOrEqual(width === 320 ? 640 : 800);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
      expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.bodyWidth + 1);
      expect(metrics.documentWidth).toBeLessThanOrEqual(width);
      const controls = panel.getByRole("tabpanel").locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary');
      await panel.getByRole("tabpanel").focus();
      for (const control of await controls.all()) {
        if (!await control.isVisible()) continue;
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
        const contained = await control.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const pane = node.closest('[role=tabpanel]')!.getBoundingClientRect();
          return rect.left >= pane.left - 1 && rect.right <= pane.right + 1 && rect.top >= pane.top - 1 && rect.bottom <= pane.bottom + 1;
        });
        expect(contained).toBe(true);
      }
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("outside-after")).toBeFocused();
      await tab.focus();
      expect(await tab.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const strip = node.closest('[role=tablist]')!.getBoundingClientRect();
        return node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1
          && bounds.left >= strip.left - 1 && bounds.right <= strip.right + 1;
      })).toBe(true);
      const outline = await tab.evaluate((node) => ({ style: getComputedStyle(node).outlineStyle, color: getComputedStyle(node).outlineColor }));
      expect(outline.style).toBe("solid");
      expect(outline.color).toBe("rgb(11, 103, 163)");
      const state = await tab.evaluate((node) => {
        const selected = getComputedStyle(node);
        const unselected = getComputedStyle(node.closest('[role=tablist]')!.querySelector('[aria-selected=false]')!);
        return {
          selectedText: selected.color, selectedBackground: selected.backgroundColor,
          unselectedText: unselected.color, unselectedBackground: unselected.backgroundColor,
          decoration: selected.textDecorationLine, thickness: selected.textDecorationThickness,
          shadow: selected.boxShadow, outlineOffset: selected.outlineOffset, borderWidth: selected.borderTopWidth,
        };
      });
      expect(contrast(state.selectedText, state.selectedBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(state.unselectedText, state.unselectedBackground)).toBeGreaterThanOrEqual(4.5);
      expect(state.decoration).toContain("underline");
      expect(state.thickness).toBe("2px");
      expect(state.shadow).toContain("inset");
      const focusRing = state.shadow.match(/rgba?\([^)]*\)/)![0];
      const spread = Number.parseFloat(state.shadow.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+px/g)![3]);
      const outlineInset = Math.max(0, -Number.parseFloat(state.outlineOffset));
      expect(spread - outlineInset - Number.parseFloat(state.borderWidth)).toBeGreaterThanOrEqual(2);
      expect(contrast(focusRing, state.selectedBackground)).toBeGreaterThanOrEqual(3);
      expect(contrast(outline.color, state.unselectedBackground)).toBeGreaterThanOrEqual(3);
      await expect(panel).not.toContainText("UNREVEALED RIVAL VAULT");
      if (key === "career") await panel.screenshot({ path: testInfo.outputPath(`player-shell-keyboard-focus-${locale}-${width}.png`) });
    }
    await panel.getByTestId("player-pro-tab-career").click();
    await panel.screenshot({ path: testInfo.outputPath(`player-shell-${locale}-${width}.png`) });
    await immutable(page);
    expect(errors).toEqual([]);
  });
}
