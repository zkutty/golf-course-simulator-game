import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const fixture = "/e2e/fixtures/zk382-campaign-scene.html";
const receiptsOverride = process.env.CAMPAIGN_EVIDENCE_DIR ?? null;
const receiptPath = (info: TestInfo, filename: string) => {
  if (receiptsOverride !== null) {
    mkdirSync(receiptsOverride, { recursive: true });
    return `${receiptsOverride}/${filename}`;
  }
  return info.outputPath(filename);
};
const active = (page: Page) => page.evaluate(() => ({ testId: document.activeElement?.getAttribute("data-testid"), text: document.activeElement?.textContent, inScene: Boolean(document.activeElement?.closest('[data-testid="campaign-scene"]')) }));

for (const strict of [false, true]) for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) {
  test(`standalone campaign authored text and reachability ${strict ? "StrictMode" : "normal"} ${locale} ${width}`, async ({ page }, info) => {
    const errors: string[] = [], renderer: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
    const height = width === 320 ? 640 : 800;
    await page.setViewportSize({ width, height });
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture + (strict ? "?strict=1" : ""));
    await page.evaluate(() => document.documentElement.style.fontSize = "100%");
    await page.getByTestId("campaign-opener").click();
    const scene = page.getByTestId("campaign-scene");
    await expect(scene).toBeVisible();
    const fonts = () => scene.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>("*"))
      .filter(item => item.getClientRects().length && Array.from(item.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      .map(item => ({ tag: item.tagName, text: item.textContent, size: Number.parseFloat(getComputedStyle(item).fontSize) })));
    const baseline = await fonts();
    const baselinePanel = await scene.boundingBox();
    expect(await page.locator("html").evaluate(element => getComputedStyle(element).fontSize)).toBe("16px");
    await page.evaluate(() => document.documentElement.style.fontSize = "130%");
    expect(await page.locator("html").evaluate(element => getComputedStyle(element).fontSize)).toBe("20.8px");
    const scaled = await fonts();
    expect(scaled.length).toBe(baseline.length);
    expect(scaled.map(({ tag, text }) => ({ tag, text }))).toEqual(baseline.map(({ tag, text }) => ({ tag, text })));
    const measurements = scaled.map((item, index) => ({ ...item, baseline: baseline[index].size, ratio: item.size / baseline[index].size }));
    const geometry = [];
    for (const item of await scene.locator("h2,p,small,span,button,strong").all()) {
      await item.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      geometry.push(await item.evaluate(element => { const rect = element.getBoundingClientRect(); return { text: element.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: element.scrollWidth - element.clientWidth }; }));
    }
    const scroll = await scene.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const panelBounds = await scene.boundingBox();
    const record = { strict, locale, width, height, measurements, baselinePanel, panelBounds, geometry, scroll, pageWidth, errors, renderer, initialFocus: await active(page) };
    const prefix = `text-${strict ? "strict" : "normal"}-${locale}-${width}`;
    writeFileSync(receiptPath(info, `${prefix}.json`), JSON.stringify(record, null, 2));
    await info.attach("measured text and layout", { body: JSON.stringify(record, null, 2), contentType: "application/json" });
    await page.screenshot({ path: receiptPath(info, `${prefix}.png`) });
    expect.soft(measurements.filter(item => Math.abs(item.ratio - 1.3) >= .01), "all visible authored and control text must grow with root text").toEqual([]);
    expect.soft(geometry.filter(item => item.left < 0 || item.right > width + 1 || item.top < 0 || item.bottom > height + 1 || item.overflow > 1), "every authored/control element must be reachable without clipping").toEqual([]);
    expect.soft(pageWidth).toBeLessThanOrEqual(width);
    expect.soft(scroll.scrollWidth - scroll.width).toBeLessThanOrEqual(1);
    expect.soft([baselinePanel, panelBounds].filter(bounds => !bounds || bounds.x < 0 || bounds.x + bounds.width > width + 1 || bounds.y < 0 || bounds.y + bounds.height > height + 1), "scene panel must remain within the viewport at both root sizes").toEqual([]);
    await expect(page.getByTestId("campaign-immutable")).toHaveText("true");
    expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
  });
}

for (const strict of [false, true]) for (const scale of [100, 130]) for (const interaction of ["Enter", "pointer"]) {
  test(`standalone mandatory campaign native ownership ${strict ? "StrictMode" : "normal"} ${scale}% ${interaction}`, async ({ page }, info) => {
    const errors: string[] = [], renderer: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/PixiStage|pixi(?:\.js|__js)|\/assets\/.*(?:atlas|texture)/i.test(request.url())) renderer.push(request.url()); });
    await page.goto(fixture + (strict ? "?strict=1" : ""));
    await page.evaluate(value => document.documentElement.style.fontSize = `${value}%`, scale);
    const opener = page.getByTestId("campaign-opener");
    await opener.click();
    const scene = page.getByTestId("campaign-scene"), choices = scene.getByRole("button");
    await expect(scene).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Find the first hole", exact: true })).toHaveAttribute("aria-modal", "true");
    const initialFocus = await active(page);
    await choices.first().focus(); await page.keyboard.press("Shift+Tab");
    const reverseFocus = await active(page);
    const reverseWrapped = await choices.last().evaluate(element => document.activeElement === element);
    await choices.last().focus(); await page.keyboard.press("Tab");
    const forwardFocus = await active(page);
    const forwardWrapped = await choices.first().evaluate(element => document.activeElement === element);
    await choices.first().focus(); await page.keyboard.press("Escape");
    const afterEscape = await active(page);
    await page.keyboard.press("KeyW");
    await page.mouse.click(1, 1);
    const afterBackdrop = await active(page);
    await expect(scene).toBeVisible(); await expect(page.getByTestId("campaign-log")).toHaveText("[]");
    const backgroundFocus = [];
    for (const id of ["outside-action", "ordinary-action", "nested-action"]) {
      await page.getByTestId(id).focus(); backgroundFocus.push({ id, active: await page.getByTestId(id).evaluate(element => document.activeElement === element) });
    }
    const contract = JSON.parse((await page.getByTestId("campaign-contract").textContent())!) as { sceneId: string; choiceIds: string[] };
    const choiceIndex = interaction === "Enter" ? 0 : contract.choiceIds.length - 1;
    await choices.nth(choiceIndex).focus();
    await page.screenshot({ path: receiptPath(info, `native-${strict ? "strict" : "normal"}-${scale}-${interaction}.png`) });
    if (interaction === "Enter") await page.keyboard.press("Enter"); else await choices.nth(choiceIndex).click();
    await expect(scene).toHaveCount(0);
    await expect(page.getByTestId("campaign-log")).toHaveText(JSON.stringify([{ sceneId: contract.sceneId, choiceId: contract.choiceIds[choiceIndex] }]));
    const returnedFocus = await active(page);
    const gameplayKeys = await page.getByTestId("gameplay-keys").textContent();
    const record = { strict, scale, interaction, rootFont: await page.locator("html").evaluate(element => getComputedStyle(element).fontSize), initialFocus, reverseFocus, reverseWrapped, forwardFocus, forwardWrapped, afterEscape, afterBackdrop, backgroundFocus, returnedFocus, contract, log: await page.getByTestId("campaign-log").textContent(), gameplayKeys, errors, renderer };
    writeFileSync(receiptPath(info, `native-${strict ? "strict" : "normal"}-${scale}-${interaction}.json`), JSON.stringify(record, null, 2));
    await info.attach("native focus phases and callbacks", { body: JSON.stringify(record, null, 2), contentType: "application/json" });
    expect.soft(initialFocus.inScene, "native opener must transfer focus into the mandatory scene").toBe(true);
    expect.soft(reverseWrapped, "Shift+Tab must wrap inside the scene").toBe(true);
    expect.soft(forwardWrapped, "Tab must wrap inside the scene").toBe(true);
    expect.soft(afterEscape.inScene, "Escape must retain focus inside the mandatory scene").toBe(true);
    expect.soft(afterBackdrop.inScene, "backdrop clicks must retain focus inside the mandatory scene").toBe(true);
    expect.soft(backgroundFocus.filter(item => item.active), "ordinary background must not acquire focus while mandatory scene is open").toEqual([]);
    expect.soft(gameplayKeys, "Escape and gameplay keys must not reach the window gameplay listener").toBe("[]");
    expect.soft(returnedFocus.testId, "choosing must restore the original native opener").toBe("campaign-opener");
    await expect(page.getByTestId("outside-actions")).toHaveText("0");
    await expect(page.getByTestId("campaign-immutable")).toHaveText("true");
    expect(errors).toEqual([]); expect(renderer).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
  });
}

for (const strict of [false, true]) for (const timing of ["existing", "late"]) for (const stack of ["lower", "equal", "higher"]) {
  test(`campaign outcome transition ${strict ? "StrictMode" : "normal"} ${timing} ${stack}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture}?stack=${stack}&timing=${timing}${strict ? "&strict=1" : ""}`);
    const opener = page.getByTestId("campaign-opener"); await opener.click();
    const scene = page.getByTestId("campaign-scene"), first = scene.getByRole("button").first();
    if (timing === "late") { await expect(first).toBeFocused(); await page.evaluate(() => window.dispatchEvent(new Event("fixture-open-outcome"))); }
    const outcome = page.getByRole("dialog", { name: "Objectives complete!", exact: true });
    const keepPlaying = outcome.getByRole("button", { name: "Keep playing", exact: true });
    await expect(outcome).toBeVisible();
    if (stack === "lower") {
      await expect(first).toBeFocused();
      await page.keyboard.press("Shift+Tab"); await expect(scene.getByRole("button").last()).toBeFocused();
      await page.keyboard.press("Tab"); await expect(first).toBeFocused();
      await page.keyboard.press("Escape"); await page.keyboard.press("KeyW");
      await expect(page.getByTestId("gameplay-keys")).toHaveText("[]");
      await page.getByTestId("outside-main-action").focus(); await expect(first).toBeFocused();
      // A foreign lower owner's removal must release its own inert footprint.
      await page.evaluate(() => window.dispatchEvent(new Event("fixture-remove-outcome")));
    } else {
      await expect(keepPlaying).toBeFocused();
      await page.keyboard.press("Shift+Tab"); await expect(outcome.getByTestId("outcome-body")).toBeFocused();
      await page.keyboard.press("Tab"); await expect(keepPlaying).toBeFocused();
      await page.keyboard.press("Enter"); await expect(page.getByTestId("outcome-count")).toHaveText("1");
    }
    await expect(outcome).toHaveCount(0); await expect(first).toBeFocused();
    await expect(page.getByTestId("campaign-log")).toHaveText("[]");
    await page.keyboard.press("Escape"); await page.keyboard.press("KeyW");
    await expect(page.getByTestId("gameplay-keys")).toHaveText("[]");
    await page.keyboard.press("Enter"); await expect(scene).toHaveCount(0);
    await expect(page.getByTestId("campaign-log")).toHaveText('[{"sceneId":"back-nine-discover-intro","choiceId":"listen"}]');
    await expect(opener).toBeFocused(); await expect(page.getByTestId("campaign-immutable")).toHaveText("true");
    expect(errors).toEqual([]);
  });
}

for (const strict of [false, true]) for (const variant of ["hidden", "portal", "preinert", "earlier"]) {
  test(`campaign foreign dialog lifecycle ${strict ? "StrictMode" : "normal"} ${variant}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture}?case=${variant}${strict ? "&strict=1" : ""}`);
    const outside = page.getByTestId("outside-main-action");
    if (variant === "preinert") await outside.evaluate(element => { (element as HTMLElement).inert = true; element.setAttribute("aria-hidden", "false"); });
    const opener = page.getByTestId("campaign-opener"); await opener.click();
    const scene = page.getByTestId("campaign-scene"), first = scene.getByRole("button").first();
    await expect(first).toBeFocused();
    if (variant === "portal") {
      await page.evaluate(() => window.dispatchEvent(new Event("fixture-open-portal")));
      const portal = page.getByTestId("save-load-screen"); await expect(portal).toBeVisible();
      expect(await portal.evaluate(element => Boolean(element.closest(".cc-main")))).toBe(false);
      await expect(portal.getByRole("button").first()).toBeFocused();
      await page.keyboard.press("Shift+Tab"); await expect(portal.getByRole("button", { name: "Close", exact: true })).toBeFocused();
      await page.keyboard.press("Enter"); await expect(portal).toHaveCount(0); await expect(first).toBeFocused();
    }
    if (variant === "hidden") { await expect(page.getByTestId("hidden-dialog")).toBeAttached(); await expect(page.getByTestId("hidden-dialog")).toBeHidden(); }
    if (variant !== "preinert") { await outside.focus(); await expect(first).toBeFocused(); }
    await page.keyboard.press("Escape"); await page.keyboard.press("KeyW"); await expect(page.getByTestId("gameplay-keys")).toHaveText("[]");
    await page.keyboard.press("Enter"); await expect(scene).toHaveCount(0);
    await expect(opener).toBeFocused();
    if (variant === "earlier") await expect(page.getByTestId("earlier-dialog")).toBeVisible();
    if (variant === "preinert") { expect(await outside.evaluate(element => (element as HTMLElement).inert)).toBe(true); await expect(outside).toHaveAttribute("aria-hidden", "false"); }
    await expect(page.getByTestId("campaign-log")).toHaveText('[{"sceneId":"back-nine-discover-intro","choiceId":"listen"}]');
    await expect(page.getByTestId("campaign-immutable")).toHaveText("true"); expect(errors).toEqual([]);
  });
}

for (const strict of [false, true]) for (const locale of ["en", "pseudo"] as const) {
  test(`campaign painted contrast and native scrolling ${strict ? "StrictMode" : "normal"} ${locale} 320 130%`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(fixture + (strict ? "?strict=1" : ""));
    await page.evaluate(() => document.documentElement.style.fontSize = "130%");
    await page.getByTestId("campaign-opener").click();
    const scene = page.getByTestId("campaign-scene"), first = scene.getByRole("button").first();
    await expect(first).toBeFocused(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    const paint = await scene.evaluate(panel => {
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (value: string) => rgb(value).map(channel => { const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, index) => sum + v * [.2126, .7152, .0722][index], 0);
      const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const backgrounds = (element: HTMLElement): string[] => {
        for (let node: HTMLElement | null = element; node; node = node.parentElement) {
          const css = getComputedStyle(node), gradient = css.backgroundImage.match(/rgba?\([^)]+\)/g);
          if (gradient?.length) return gradient;
          if (css.backgroundColor !== "rgba(0, 0, 0, 0)" && css.backgroundColor !== "transparent") return [css.backgroundColor];
        }
        throw new Error("No painted background");
      };
      const texts = Array.from(panel.querySelectorAll<HTMLElement>("*")).filter(element => element.getClientRects().length && Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())).map(element => {
        const color = getComputedStyle(element).color, background = backgrounds(element);
        return { text: element.textContent, color, background, contrast: Math.min(...background.map(value => contrast(color, value))) };
      });
      const focused = document.activeElement as HTMLElement, css = getComputedStyle(focused), box = focused.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
      return { texts, focus: { color: css.outlineColor, width: Number.parseFloat(css.outlineWidth), style: css.outlineStyle, offset: Number.parseFloat(css.outlineOffset), visible: focused.matches(":focus-visible"), contrast: Math.min(...[...backgrounds(focused), ...backgrounds(panel as HTMLElement)].map(value => contrast(css.outlineColor, value))), ringInside: box.left - 6 >= panelBox.left && box.right + 6 <= panelBox.right && box.top - 6 >= panelBox.top && box.bottom + 6 <= panelBox.bottom }, scroll: { height: panel.clientHeight, total: panel.scrollHeight, top: panel.scrollTop } };
    });
    expect(paint.texts.length).toBeGreaterThan(10);
    expect(paint.texts.filter(item => item.contrast < 4.5), "all authored, facts and control text must meet painted contrast").toEqual([]);
    expect(paint.focus.visible).toBe(true); expect(paint.focus.width).toBeGreaterThanOrEqual(3); expect(paint.focus.style).toBe("solid"); expect(paint.focus.contrast).toBeGreaterThanOrEqual(3); expect(paint.focus.ringInside).toBe(true);
    expect(paint.scroll.total).toBeGreaterThan(paint.scroll.height);
    for (let index = 0; index < 6; index++) await page.keyboard.press("PageUp");
    await expect.poll(() => scene.evaluate(element => element.scrollTop)).toBe(0);
    await expect(scene.locator("h2")).toBeInViewport();
    const prefix = `paint-scroll-${strict ? "strict" : "normal"}-${locale}`;
    await page.screenshot({ path: receiptPath(info, `${prefix}-top.png`) });
    for (let index = 0; index < 6; index++) await page.keyboard.press("PageDown");
    await expect.poll(() => scene.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
    await expect(scene.getByRole("button").last()).toBeInViewport();
    const bottom = await scene.evaluate(element => element.scrollTop);
    await page.screenshot({ path: receiptPath(info, `${prefix}-bottom.png`) });
    await expect(page.getByTestId("campaign-log")).toHaveText("[]"); await expect(page.getByTestId("outside-actions")).toHaveText("0");
    expect(errors).toEqual([]);
    const record = { strict, locale, rootFont: await page.locator("html").evaluate(element => getComputedStyle(element).fontSize), paint, bottom, errors };
    writeFileSync(receiptPath(info, `${prefix}.json`), JSON.stringify(record, null, 2)); await info.attach("paint and native scrolling", { body: JSON.stringify(record), contentType: "application/json" });
  });
}
