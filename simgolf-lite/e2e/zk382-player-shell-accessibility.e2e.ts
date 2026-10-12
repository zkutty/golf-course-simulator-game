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

async function shortParentRing(control: import("@playwright/test").Locator, authored: boolean, testInfo: import("@playwright/test").TestInfo) {
  const paint = await control.evaluate((node) => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect();
    const extra = Math.max(0, Number.parseFloat(css.outlineWidth) + Number.parseFloat(css.outlineOffset));
    const ring = { left: box.left - extra, right: box.right + extra, top: box.top - extra, bottom: box.bottom + extra };
    const clips = [{ left: 0, right: innerWidth, top: 0, bottom: innerHeight }];
    // The alpha-over formulas are pinned to the accepted tournament V paint authority.
    type RGBA = [number, number, number, number];
    const rgba = (value: string): RGBA => { const values = value.match(/[\d.]+/g)!.map(Number); return [values[0], values[1], values[2], values[3] ?? 1]; };
    const over = (fg: RGBA, bg: RGBA): RGBA => { const alpha = fg[3] + bg[3] * (1 - fg[3]); return [0, 1, 2].map((index) => alpha ? (fg[index] * fg[3] + bg[index] * bg[3] * (1 - fg[3])) / alpha : 0).concat(alpha) as RGBA; };
    let pairs = [{ foreground: rgba(css.outlineColor), background: [0, 0, 0, 0] as RGBA }];
    const layers = [];
    const inset = extra === 0 && css.boxShadow.includes("inset") ? css.boxShadow.match(/rgba?\([^)]+\)/)?.[0] : null;
    for (let parent: Element | null = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), outside = parent === node && extra > 0;
      const base: RGBA = outside ? [0, 0, 0, 0] : rgba(style.backgroundColor);
      const gradient = outside ? null : style.backgroundImage.match(/rgba?\([^)]+\)/g);
      let colors = gradient?.map((value) => over(rgba(value), base)) ?? [base];
      if (parent === node && inset) colors = colors.map((color) => over(rgba(inset), color));
      const opacity = Number(style.opacity);
      layers.push({ tag: parent.tagName, background: style.backgroundColor, image: style.backgroundImage, opacity, outside, inset: parent === node ? inset : null });
      pairs = pairs.flatMap((pair) => colors.map((background) => {
        const foreground = over(pair.foreground, background), composite = over(pair.background, background);
        foreground[3] *= opacity; composite[3] *= opacity;
        return { foreground, background: composite };
      }));
      if (parent.matches(".cc-player-pro-panel, .cc-player-pro-header, [role=tablist], [role=tabpanel]")) {
        const bounds = parent.getBoundingClientRect();
        clips.push({ left: bounds.left + parent.clientLeft, right: bounds.left + parent.clientLeft + parent.clientWidth, top: bounds.top + parent.clientTop, bottom: bounds.top + parent.clientTop + parent.clientHeight });
      }
    }
    const opaquePairs = pairs.map((pair) => ({ foreground: over(pair.foreground, [255, 255, 255, 1]), background: over(pair.background, [255, 255, 255, 1]) }));
    return { text: node.textContent, ring, clips, layers, opaquePairs, color: css.outlineColor, style: css.outlineStyle, width: Number.parseFloat(css.outlineWidth), visible: node.matches(":focus-visible") };
  });
  const ratios = paint.opaquePairs.map((pair) => contrast(`rgb(${pair.foreground.slice(0, 3).join(",")})`, `rgb(${pair.background.slice(0, 3).join(",")})`));
  await testInfo.attach("focused ring paint", { body: JSON.stringify({ ...paint, contrastRatios: ratios }), contentType: "application/json" });
  expect(paint.visible).toBe(true); expect(paint.style).not.toBe("none"); expect(paint.width).toBeGreaterThan(0);
  if (authored) { expect(paint.width).toBe(3); expect(paint.style).toBe("solid"); }
  expect(ratios.length).toBeGreaterThan(0); expect(Math.min(...ratios)).toBeGreaterThanOrEqual(3);
  for (const clip of paint.clips) {
    expect(paint.ring.left).toBeGreaterThanOrEqual(clip.left - 1); expect(paint.ring.right).toBeLessThanOrEqual(clip.right + 1);
    expect(paint.ring.top).toBeGreaterThanOrEqual(clip.top - 1); expect(paint.ring.bottom).toBeLessThanOrEqual(clip.bottom + 1);
  }
  return { ...paint, contrastRatios: ratios };
}
async function shortParentGlyphs(body: import("@playwright/test").Locator) {
  return body.evaluate((pane) => {
    const panel = pane.closest<HTMLElement>(".cc-player-pro-panel")!, bounds = pane.getBoundingClientRect(), outer = panel.getBoundingClientRect();
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT), lines: { id: string; text: string | null; horizontal: boolean; painted: boolean }[] = [];
    let textIndex = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!node.textContent?.trim() || !parent?.checkVisibility() || parent.closest("select,option,button")) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      Array.from(range.getClientRects()).forEach((box, index) => lines.push({ id: `${textIndex}:${index}`, text: node.textContent,
        horizontal: box.left >= Math.max(bounds.left, outer.left, 0) - 1 && box.right <= Math.min(bounds.right, outer.right, innerWidth) + 1,
        painted: box.top >= Math.max(bounds.top, outer.top, 0) - 1 && box.bottom <= Math.min(bounds.bottom, outer.bottom, innerHeight) + 1 }));
      textIndex += 1;
    }
    return lines;
  });
}
for (const locale of ["en", "pseudo"] as const) for (const scale of [100, 130]) {
  test(`ZK-1351 short parent ${locale} ${scale} percent preserves mobile shell and native reachability`, async ({ page }, testInfo) => {
    test.setTimeout(45_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, "?shortParent=1");
    await page.evaluate((value) => { document.documentElement.style.fontSize = `${16 * value / 100}px`; }, scale);
    const panel = page.getByTestId("player-pro-panel"), parent = page.getByTestId("short-player-parent"), body = panel.getByRole("tabpanel"), tab = panel.getByTestId("player-pro-tab-career"), close = panel.locator(".cc-player-pro-close");
    const geometry = await panel.evaluate((node) => {
      const box = node.getBoundingClientRect(), header = node.querySelector("header")!.getBoundingClientRect(), tabs = node.querySelector('[role=tablist]')!.getBoundingClientRect(), pane = node.querySelector<HTMLElement>('[role=tabpanel]')!;
      return { position: getComputedStyle(node).position, offsetParent: (node as HTMLElement).offsetParent?.tagName ?? null, left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height, headerHeight: header.height, tabsHeight: tabs.height, bodyHeight: pane.clientHeight, bodyTop: pane.getBoundingClientRect().top, bodyBottom: pane.getBoundingClientRect().bottom };
    });
    expect(await parent.evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight, position: getComputedStyle(node).position, overflow: getComputedStyle(node).overflow, containerType: getComputedStyle(node).containerType }))).toEqual({ width: 274, height: 170, position: "relative", overflow: "hidden", containerType: "inline-size" });
    expect(geometry.position).toBe("fixed"); expect(geometry.offsetParent).toBeNull(); expect(geometry.left).toBe(10); expect(geometry.top).toBe(54);
    expect(geometry.right).toBe(310); expect(geometry.bottom).toBeLessThanOrEqual(640);
    expect(geometry.bodyHeight).toBeGreaterThan(geometry.headerHeight); expect(geometry.bodyBottom).toBeLessThanOrEqual(geometry.bottom);
    await expect(panel).toHaveAttribute("aria-modal", "false"); await expect(panel.locator("h2")).toHaveText(fullName);
    const headerGlyphs = await panel.locator("h2").evaluate((node) => {
      const range = document.createRange(); range.selectNodeContents(node); const clip = node.closest("header")!.getBoundingClientRect();
      return Array.from(range.getClientRects()).every((box) => box.left >= clip.left && box.right <= clip.right && box.top >= clip.top && box.bottom <= clip.bottom);
    });
    expect(headerGlyphs).toBe(true);
    await page.getByTestId("outside-before").focus(); await page.keyboard.press("Tab"); await expect(close).toBeFocused();
    const rings = [await shortParentRing(close, true, testInfo)];
    await page.keyboard.press("Tab"); await expect(tab).toBeFocused(); rings.push(await shortParentRing(tab, true, testInfo));
    await page.keyboard.press("Tab"); await expect(body).toBeFocused(); rings.push(await shortParentRing(body, true, testInfo));
    const controls = body.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary');
    for (const control of await controls.all()) {
      if (!await control.evaluate((node) => node.checkVisibility())) continue;
      await page.keyboard.press("Tab"); await expect(control).toBeFocused(); rings.push(await shortParentRing(control, false, testInfo));
    }
    await page.keyboard.press("Tab"); await expect(page.getByTestId("outside-after")).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(controls.last()).toBeFocused();
    await body.focus(); await expect(body).toBeFocused();
    const metrics = await body.evaluate((node) => ({ height: node.scrollHeight, viewport: node.clientHeight }));
    const pages = Math.ceil(metrics.height / metrics.viewport), cap = pages + Math.ceil(pages * .25) + 8; expect(cap).toBeLessThanOrEqual(512);
    const frames = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    let upSteps = 0;
    for (; upSteps < cap; upSteps += 1) { if (await body.evaluate((node) => node.scrollTop === 0)) break; await page.keyboard.press("PageUp"); await frames(); }
    await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBe(0);
    const painted = new Set<string>(), initialGlyphs = await shortParentGlyphs(body);
    const observe = async () => { for (const line of await shortParentGlyphs(body)) { expect(line.horizontal).toBe(true); if (line.painted) painted.add(line.id); } };
    await observe();
    let downSteps = 0;
    for (; downSteps < cap; downSteps += 1) { if (await body.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop <= 1)) break; await page.keyboard.press("PageDown"); await frames(); await observe(); }
    await expect.poll(() => body.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
    expect(painted.size).toBe(initialGlyphs.length); await expect(body.locator("section").last()).toBeInViewport();
    const boundaries = [];
    for (const width of [768, 769, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const position = await panel.evaluate((node) => getComputedStyle(node).position);
      expect(position).toBe(width === 768 ? "fixed" : "absolute"); boundaries.push({ width, position });
    }
    await page.setViewportSize({ width: 320, height: 640 });
    await immutable(page); expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`short-parent-${locale}-${scale}.png`) });
    await close.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(close).toBeFocused();
    await page.keyboard.press("Enter"); await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("callback-log")).toHaveJSProperty("value", JSON.stringify([{ name: "close", args: [] }]));
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY"); await immutable(page); expect(errors).toEqual([]);
    await testInfo.attach("short parent acceptance", { body: JSON.stringify({ locale, scale, geometry, rings, metrics, cap, upSteps, downSteps, paintedGlyphLines: painted.size, totalGlyphLines: initialGlyphs.length, boundaries, errors, close: "once", activeAfterClose: "BODY" }), contentType: "application/json" });
  });
}
