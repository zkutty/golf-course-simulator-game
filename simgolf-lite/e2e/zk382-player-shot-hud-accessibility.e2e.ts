import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const fixture = "/e2e/fixtures/zk382-player-shot-hud.html";
const evidenceOverride = process.env.HUD_EVIDENCE_DIR ?? null;
const evidencePath = (info: TestInfo, filename: string) => {
  if (evidenceOverride !== null) {
    mkdirSync(evidenceOverride, { recursive: true });
    return `${evidenceOverride}/${filename}`;
  }
  return info.outputPath(filename);
};
const nativeOptionText = async (page: Page, text: string) => {
  const session = await page.context().newCDPSession(page);
  try {
    for (const key of text) {
      await session.send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key, unmodifiedText: key, windowsVirtualKeyCode: 0 });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: 0 });
    }
  } finally { await session.detach(); }
};
const collect = (page: Page) => page.getByTestId("player-shot-hud").evaluate(panel => {
  type RGBA = [number, number, number, number];
  const rgba = (value: string): RGBA => { const values = value.match(/[\d.]+/g)!.map(Number); return [values[0], values[1], values[2], values[3] ?? 1]; };
  const over = (fg: RGBA, bg: RGBA): RGBA => { const alpha = fg[3] + bg[3] * (1 - fg[3]); return [0, 1, 2].map(i => alpha ? (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / alpha : 0).concat(alpha) as RGBA; };
  const lum = (value: RGBA) => value.slice(0, 3).map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a: RGBA, b: RGBA) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const paint = (element: Element, foreground = getComputedStyle(element).color, outline = false) => {
    let pairs = [{ foreground: rgba(foreground), background: [0, 0, 0, 0] as RGBA }];
    const layers = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const css = getComputedStyle(node), gradient = outline && node === element ? null : css.backgroundImage.match(/rgba?\([^)]+\)/g), base = outline && node === element ? [0, 0, 0, 0] as RGBA : rgba(css.backgroundColor), opacity = Number(css.opacity);
      const colors = gradient?.map(value => over(rgba(value), base)) ?? [base];
      layers.push({ tag: node.tagName, background: css.backgroundColor, image: css.backgroundImage, opacity });
      pairs = pairs.flatMap(pair => colors.map(background => { const fg = over(pair.foreground, background), bg = over(pair.background, background); fg[3] *= opacity; bg[3] *= opacity; return { foreground: fg, background: bg }; }));
    }
    pairs = pairs.map(pair => ({ foreground: over(pair.foreground, [255, 255, 255, 1]), background: over(pair.background, [255, 255, 255, 1]) }));
    return { pairs, layers, contrast: Math.min(...pairs.map(pair => contrast(pair.foreground, pair.background))) };
  };
  return Array.from(panel.querySelectorAll<HTMLElement>("*")).filter(element => element.getClientRects().length && (Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) || element.matches("select,input,button,summary"))).map((element, index) => {
    const css = getComputedStyle(element), box = element.getBoundingClientRect(), painted = paint(element);
    return { index, tag: element.tagName, id: element.dataset.testid ?? "", text: element.textContent, size: Number.parseFloat(css.fontSize), color: css.color, painted, contrast: painted.contrast, opacity: css.opacity, focus: document.activeElement === element ? { visible: element.matches(":focus-visible"), width: Number.parseFloat(css.outlineWidth), contrast: paint(element, css.outlineColor, true).contrast, color: css.outlineColor } : null, scorecard: Boolean(element.closest('[data-testid="player-round-scorecard"]')), rect: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, overflow: element.scrollWidth - element.clientWidth };
  });
});
for (const phase of ["awaiting", "result"]) for (const locale of ["en", "pseudo"]) for (const width of [320, 768, 1280]) {
  test(`authored player HUD text native reachability ${phase} ${locale} ${width}`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 320 ? 640 : 800 });
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
    await page.goto(`${fixture}?phase=${phase}`);
    const hud = page.getByTestId("player-shot-hud"); await expect(hud).toBeVisible(); await hud.locator("summary").focus(); await page.keyboard.press("Enter"); await expect(hud.locator("details")).toHaveAttribute("open", ""); await expect(hud).toHaveAttribute("role", "region"); expect(await hud.getAttribute("aria-modal")).toBeNull();
    await page.evaluate(() => document.documentElement.style.fontSize = "100%");
    const baseline = await collect(page); expect(await page.locator("html").evaluate(element => getComputedStyle(element).fontSize)).toBe("16px");
    await page.evaluate(() => document.documentElement.style.fontSize = "130%");
    const scaled = await collect(page); expect(await page.locator("html").evaluate(element => getComputedStyle(element).fontSize)).toBe("20.8px");
    expect(scaled.length).toBe(baseline.length); expect(scaled.map(({ index, tag, id, text }) => ({ index, tag, id, text }))).toEqual(baseline.map(({ index, tag, id, text }) => ({ index, tag, id, text })));
    const samples = scaled.map((item, index) => ({ ...item, baseline: baseline[index].size, ratio: item.size / baseline[index].size }));
    const nativeSelections = [];
    for (const select of await hud.locator("select").all()) {
      await select.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp");
      const selected = await select.evaluate(element => {
        const node = element as HTMLSelectElement, css = getComputedStyle(node), context = document.createElement("canvas").getContext("2d")!; context.font = css.font;
        const text = node.selectedOptions[0].textContent!, textWidth = context.measureText(text).width, available = node.clientWidth - Number.parseFloat(css.paddingLeft) - Number.parseFloat(css.paddingRight) - 20;
        return { text, value: node.value, font: css.font, textWidth, available, selectedIndex: node.selectedIndex, focused: document.activeElement === node, box: node.getBoundingClientRect().toJSON() };
      }); nativeSelections.push(selected);
      await page.screenshot({ path: evidencePath(info, `native-value-${phase}-${locale}-${width}-${nativeSelections.length}.png`) });
    }
    const geometry = [];
    for (const element of await hud.locator("*").all()) {
      if (!await element.isVisible()) continue;
      if (!await element.evaluate(node => node.matches("select,input,button,summary") || Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()))) continue;
      await element.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      geometry.push(await element.evaluate(node => {
        const rect = (box: DOMRect) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
        const glyphs = Array.from(node.childNodes).filter(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()).flatMap(child => { const range = document.createRange(); range.selectNodeContents(child); return Array.from(range.getClientRects()).map(rect); });
        const clips = [{ name: "viewport", x: true, y: true, left: 0, right: innerWidth, top: 0, bottom: innerHeight }];
        for (let parent: Element | null = node; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent), x = /^(hidden|clip|scroll|auto)$/.test(css.overflowX), y = /^(hidden|clip|scroll|auto)$/.test(css.overflowY), box = parent.getBoundingClientRect();
          if (x || y) clips.push({ name: parent.getAttribute("data-testid") ?? parent.tagName, x, y, left: box.left + parent.clientLeft, right: box.left + parent.clientLeft + parent.clientWidth, top: box.top + parent.clientTop, bottom: box.top + parent.clientTop + parent.clientHeight });
        }
        const intersections = glyphs.flatMap(glyph => clips.filter(clip => (clip.x && (glyph.left < clip.left - 1 || glyph.right > clip.right + 1)) || (clip.y && (glyph.top < clip.top - 1 || glyph.bottom > clip.bottom + 1))).map(clip => ({ glyph, clip })));
        const css = getComputedStyle(node);
        const own = rect(node.getBoundingClientRect()), isControl = node.matches("select,input,button,summary");
        const controlIntersections = isControl ? clips.filter(clip => (clip.x && (own.left < clip.left - 1 || own.right > clip.right + 1)) || (clip.y && (own.top < clip.top - 1 || own.bottom > clip.bottom + 1))) : [];
        return { isControl, tag: node.tagName, text: node.textContent, glyphs, clips, intersections, controlIntersections, own, overflow: node.scrollWidth - node.clientWidth, overflowX: css.overflowX, overflowY: css.overflowY };
      }));
    }
    await hud.locator("header").evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
    const header = await hud.locator("header").evaluate(node => {
      const ranges = (element: Element) => { const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), boxes = []; while(walker.nextNode()) { if (!walker.currentNode.textContent?.trim()) continue; const range = document.createRange(); range.selectNodeContents(walker.currentNode); boxes.push(...Array.from(range.getClientRects()).map(box => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom }))); } return boxes; };
      const labels = ranges(node.firstElementChild!), score = ranges(node.lastElementChild!);
      return { labels, score, overlaps: score.flatMap(a => labels.filter(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1).map(b => ({ score: a, label: b }))) };
    });
    const panel = await hud.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, rect: element.getBoundingClientRect().toJSON() }));
    const footer = hud.getByRole("button").last(); await footer.focus();
    for (let index = 0; index < 12; index++) await page.keyboard.press("PageUp");
    await expect.poll(() => hud.evaluate(element => element.scrollTop)).toBe(0);
    const nativeTop = await hud.evaluate(element => element.scrollTop);
    for (let index = 0; index < 12; index++) await page.keyboard.press("PageDown");
    await expect.poll(() => hud.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
    const nativeBottom = await hud.evaluate(element => element.scrollTop);
    await expect(footer).toBeInViewport();
    const focused = await footer.evaluate(element => { const css = getComputedStyle(element); const lum = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => { const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, index) => sum + v * [.2126, .7152, .0722][index], 0); const outline = lum(css.outlineColor), panel = element.closest('[data-testid="player-shot-hud"]')!, gradient = getComputedStyle(panel).backgroundImage.match(/rgba?\([^)]+\)/g)!; const contrast = Math.min(...gradient.map(value => { const bg = lum(value); return (Math.max(outline, bg) + .05) / (Math.min(outline, bg) + .05); })); return { contrast, visible: element.matches(":focus-visible"), outlineColor: css.outlineColor, width: css.outlineWidth, offset: css.outlineOffset, background: css.backgroundColor, rect: element.getBoundingClientRect().toJSON() }; });
    const record = { header, nativeSelections, phase, emittedPhase: await page.getByTestId("phase").textContent(), locale, width, samples, geometry, panel, nativeTop, nativeBottom, focused, errors, immutable: await page.getByTestId("immutable").textContent(), input: JSON.parse((await page.getByTestId("input-snapshot").textContent())!) };
    writeFileSync(evidencePath(info, `${phase}-${locale}-${width}.json`), JSON.stringify(record, null, 2)); await page.screenshot({ path: evidencePath(info, `${phase}-${locale}-${width}.png`) }); await info.attach("authored HUD measurements", { body: JSON.stringify(record), contentType: "application/json" });
    await expect(page.getByTestId("immutable")).toHaveText("true"); expect(errors).toEqual([]);
    expect.soft(nativeSelections.filter(item => item.textWidth > item.available), "selected native values must fit painted font/content area; native focus screenshots retained").toEqual([]);
    expect.soft(panel.rect.left).toBeGreaterThanOrEqual(0); expect.soft(panel.rect.right).toBeLessThanOrEqual(width);
    expect.soft(focused.visible).toBe(true); expect.soft(Number.parseFloat(focused.width)).toBeGreaterThanOrEqual(3); expect.soft(focused.contrast).toBeGreaterThanOrEqual(3);
    expect.soft(focused.rect.left - 6).toBeGreaterThanOrEqual(panel.rect.left); expect.soft(focused.rect.right + 6).toBeLessThanOrEqual(panel.rect.right); expect.soft(focused.rect.top - 6).toBeGreaterThanOrEqual(panel.rect.top); expect.soft(focused.rect.bottom + 6).toBeLessThanOrEqual(panel.rect.bottom);
    expect.soft(samples.filter(item => Math.abs(item.ratio - 1.3) >= .01), "all visible descendant/control text including actual scorecard must scale").toEqual([]);
    expect.soft(panel.scrollWidth - panel.clientWidth, "HUD must avoid horizontal clipping").toBeLessThanOrEqual(1);
    expect.soft(geometry.filter(item => (!item.isControl && !item.glyphs.length) || item.intersections.length || item.controlIntersections.length), "every authored glyph/native control must fit actual clipping ancestors and viewport").toEqual([]);
    expect.soft(header.overlaps, "stroke count and adjacent header glyphs must not overlap").toEqual([]);
    expect.soft(samples.filter(item => item.contrast < 4.5), "actual painted text contrast").toEqual([]);
  });
}
for (const locale of ["en", "pseudo"]) for (const scale of [100, 130]) {
  test(`nonmodal HUD native callbacks and focus ${locale} ${scale}`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale); await page.goto(fixture);
    await page.evaluate(value => document.documentElement.style.fontSize = `${value}%`, scale);
    const hud = page.getByTestId("player-shot-hud"), club = page.getByTestId("player-shot-club"), power = page.getByTestId("player-shot-power");
    await club.focus(); await page.keyboard.press("Shift+Tab"); await expect(page.getByTestId("outside-before")).toBeFocused();
    await page.keyboard.press("Enter"); await page.keyboard.press("KeyW"); await expect(page.getByTestId("background")).toHaveText("2");
    await hud.getByRole("button").last().focus(); await page.keyboard.press("Tab"); await expect(page.getByTestId("outside-after")).toBeFocused();
    await page.keyboard.press("Enter"); await expect(page.getByTestId("background")).toHaveText("3");
    const caddie = page.getByTestId("commit-player-shot").locator("xpath=preceding-sibling::button"); await caddie.focus(); await page.keyboard.press("Enter");
    const guidance = JSON.parse((await page.getByTestId("guidance").textContent())!); await expect(page.getByTestId("aim")).toHaveText(JSON.stringify(guidance.aim));
    const initialClub = await club.inputValue(), alternateClub = await club.locator("option").nth(1).getAttribute("value");
    await club.focus(); await nativeOptionText(page, (await club.locator("option").nth(1).textContent())!); await page.keyboard.press("Enter"); await expect(club).toHaveValue(alternateClub!); expect(await club.inputValue()).not.toBe(initialClub);
    await power.focus(); await page.keyboard.press("ArrowRight");
    const technique = hud.locator("select").nth(1); await technique.focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Tab");
    await page.getByTestId("player-shot-flight-high").focus(); await page.keyboard.press("Enter");
    const expected = { club: await club.inputValue(), aim: guidance.aim, power: Number(await power.inputValue()) / 100, technique: await technique.inputValue(), flightProfile: await page.getByTestId("player-shot-flight-high").getAttribute("aria-pressed") === "true" ? "high" : "low" };
    await page.getByTestId("commit-player-shot").focus(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("calls")).toHaveText(JSON.stringify([{ name: "aim", value: guidance.aim }, { name: "commit", value: expected }]));
    await expect(page.getByTestId("immutable")).toHaveText("true"); expect(errors).toEqual([]);
    writeFileSync(evidencePath(info, `native-${locale}-${scale}.json`), JSON.stringify({ locale, scale, expected, guidance, errors, calls: JSON.parse((await page.getByTestId("calls").textContent())!) }, null, 2)); await page.screenshot({ path: evidencePath(info, `native-${locale}-${scale}.png`) }); await info.attach("native callback payload", { body: JSON.stringify(expected), contentType: "application/json" });
  });
}
for (const phase of ["flight", "conceded"]) test(`actual emitted HUD footer ${phase}`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); await page.goto(`${fixture}?phase=${phase}`);
  const hud = page.getByTestId("player-shot-hud"); await expect(page.getByTestId("phase")).toHaveText(phase);
  if (phase === "conceded") { await page.getByTestId("return-to-design").focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("calls")).toHaveText('[{"name":"return"}]'); }
  else { const footer = hud.getByRole("button"); await footer.nth(0).focus(); await page.keyboard.press("Enter"); await footer.nth(1).focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("calls")).toHaveText('[{"name":"auto"},{"name":"concede"}]'); }
  await expect(page.getByTestId("immutable")).toHaveText("true"); expect(errors).toEqual([]);
});

for (const locale of ["en", "pseudo"]) test(`genuine trained Punch flight state contrast and callbacks ${locale} 320 130`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 640 }); await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
  await page.goto(fixture + "?trained=1"); await page.evaluate(() => document.documentElement.style.fontSize = "130%");
  const training = JSON.parse((await page.getByTestId("training-output").textContent())!) as { week: number; day: number; cost: number; available: boolean; recovery: number }[];
  expect(training.length).toBe(18); expect(training.at(-1)!.recovery).toBe(46); expect(training.every(record => record.available && record.day >= 0 && record.day <= 6 && record.cost === 60)).toBe(true);
  const dates = training.map(record => `${record.week}/${record.day}`); expect(Math.max(...dates.map(date => dates.filter(value => value === date).length))).toBe(2);
  const hud = page.getByTestId("player-shot-hud"), technique = hud.locator("select").nth(1), low = page.getByTestId("player-shot-flight-low"), high = page.getByTestId("player-shot-flight-high");
  await high.focus(); await page.keyboard.press("Enter"); await expect(high).toHaveAttribute("aria-pressed", "true");
  const normalHigh = await collect(page);
  await low.focus(); await page.keyboard.press("Enter"); await expect(low).toHaveAttribute("aria-pressed", "true");
  const normalLow = await collect(page);
  await technique.focus(); await nativeOptionText(page, (await technique.locator("option[value=punch]").textContent())!); await page.keyboard.press("Enter"); await expect(technique).toHaveValue("punch");
  const unfocusedBlockedOpacity = await high.evaluate(node => getComputedStyle(node).opacity); expect(unfocusedBlockedOpacity).toBe("0.64");
  await high.focus(); await page.keyboard.press("Enter"); await expect(high).toHaveAttribute("aria-pressed", "false"); await expect(low).toHaveAttribute("aria-pressed", "true");
  const blocked = await collect(page), flightSamples = [...normalHigh, ...normalLow, ...blocked].filter(sample => sample.id.startsWith("player-shot-flight-"));
  expect.soft(flightSamples.filter(sample => sample.contrast < 4.5)).toEqual([]);
  const focused = blocked.find(sample => sample.id === "player-shot-flight-high")!.focus!;
  expect.soft(focused.visible).toBe(true); expect.soft(focused.width).toBeGreaterThanOrEqual(3); expect.soft(focused.contrast).toBeGreaterThanOrEqual(3);
  expect(blocked.find(sample => sample.id === "player-shot-flight-high")!.opacity).toBe("1");
  const ringBounds = await high.evaluate(node => { const css = getComputedStyle(node), box = node.getBoundingClientRect(), panel = node.closest('[data-testid="player-shot-hud"]')!.getBoundingClientRect(), extra = Number.parseFloat(css.outlineWidth) + Number.parseFloat(css.outlineOffset); return { left: box.left - extra, right: box.right + extra, top: box.top - extra, bottom: box.bottom + extra, clip: { left: Math.max(0, panel.left), right: Math.min(innerWidth, panel.right), top: Math.max(0, panel.top), bottom: Math.min(innerHeight, panel.bottom) } }; });
  expect(ringBounds.left).toBeGreaterThanOrEqual(ringBounds.clip.left); expect(ringBounds.right).toBeLessThanOrEqual(ringBounds.clip.right); expect(ringBounds.top).toBeGreaterThanOrEqual(ringBounds.clip.top); expect(ringBounds.bottom).toBeLessThanOrEqual(ringBounds.clip.bottom);
  const expected = { club: await page.getByTestId("player-shot-club").inputValue(), aim: JSON.parse((await page.getByTestId("aim").textContent())!), power: Number(await page.getByTestId("player-shot-power").inputValue()) / 100, technique: "punch", flightProfile: "low" };
  await page.getByTestId("commit-player-shot").focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("calls")).toHaveText(JSON.stringify([{ name: "commit", value: expected }]));
  await expect(page.getByTestId("immutable")).toHaveText("true"); expect(errors).toEqual([]); expect(await high.evaluate(node => getComputedStyle(node).opacity)).toBe("0.64");
  const record = { locale, training, normalHigh, normalLow, blocked, focused, ringBounds, unfocusedBlockedOpacity, expected, errors }; writeFileSync(evidencePath(info, `trained-${locale}.json`), JSON.stringify(record, null, 2)); await page.screenshot({ path: evidencePath(info, `trained-${locale}.png`) }); await info.attach("genuine training/flight paint", { body: JSON.stringify(record), contentType: "application/json" });
});
