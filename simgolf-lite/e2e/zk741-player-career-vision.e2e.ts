import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_APP_PROFILE, APP_PROFILE_STORAGE_KEY } from "../src/game/onboarding/profile";
import { pseudoLocalize, LOCALE_STORAGE_KEY } from "../src/i18n/core";
import { visionIntroEn } from "../src/i18n/visionIntroCatalog";

const evidenceRoot = process.env.VISION_CAREER_EVIDENCE_DIR;
const copy = Object.entries(visionIntroEn).filter(([key]) => key.startsWith("vision.playerCareer.")).map(([, value]) => value);
const viewports = [{ width: 320, height: 640 }, { width: 820, height: 900 }, { width: 1280, height: 800 }, { width: 1680, height: 1050 }];

// BEGIN EXACT VISION PAINT CHECKER
export async function inspectCareerPaint(page: Page, nativeKey: "PageUp" | "PageDown" | null = null) {
  return page.evaluate(async (nativeKey) => {
    const section = document.querySelector<HTMLElement>('[data-testid="vision-player-career"]');
    if (!section) throw new Error("Missing Player career section");
    const snapshot = () => {
    type RGBA = [number, number, number, number];
    const rgba = (value: string): RGBA => { const values = value.match(/[\d.]+/g)!.map(Number); return [values[0], values[1], values[2], values[3] ?? 1]; };
    const over = (fg: RGBA, bg: RGBA): RGBA => { const alpha = fg[3] + bg[3] * (1 - fg[3]); return [0, 1, 2].map((index) => alpha ? (fg[index] * fg[3] + bg[index] * bg[3] * (1 - fg[3])) / alpha : 0).concat(alpha) as RGBA; };
    const luminance = (value: RGBA) => value.slice(0, 3).map((channel) => { const normalized = channel / 255; return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const contrast = (foreground: RGBA, background: RGBA) => (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
    const splitLayers = (value: string) => { let depth = 0, start = 0; const layers: string[] = []; for (let index = 0; index < value.length; index += 1) { if (value[index] === "(") depth += 1; if (value[index] === ")") depth -= 1; if (value[index] === "," && depth === 0) { layers.push(value.slice(start, index)); start = index + 1; } } layers.push(value.slice(start)); return layers; };
    const palette = (css: CSSStyleDeclaration) => {
      let colors = [rgba(css.backgroundColor)];
      for (const layer of splitLayers(css.backgroundImage).reverse()) {
        if (layer.trim() === "none") continue;
        if (!layer.includes("gradient(")) throw new Error(`Unsupported glyph background: ${layer}`);
        const stops = layer.match(/rgba?\([^)]+\)/g);
        if (!stops?.length) throw new Error(`Missing gradient paint stops: ${layer}`);
        colors = stops.flatMap((stop) => colors.map((background) => over(rgba(stop), background)));
      }
      return colors;
    };
    const colorProof = (node: Element) => {
      let pairs = [{ foreground: rgba(getComputedStyle(node).color), background: [0, 0, 0, 0] as RGBA }];
      const layers = [];
      for (let parent: Element | null = node; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), colors = palette(css), opacity = Number(css.opacity);
        layers.push({ tag: parent.tagName, background: css.backgroundColor, image: css.backgroundImage, opacity, colors });
        pairs = pairs.flatMap((pair) => colors.map((background) => { const foreground = over(pair.foreground, background), composite = over(pair.background, background); foreground[3] *= opacity; composite[3] *= opacity; return { foreground, background: composite }; }));
      }
      const opaquePairs = pairs.map((pair) => ({ foreground: over(pair.foreground, [255, 255, 255, 1]), background: over(pair.background, [255, 255, 255, 1]) }));
      return { layers, opaquePairs, lowerBound: Math.min(...opaquePairs.map((pair) => contrast(pair.foreground, pair.background))) };
    };
    const bounds = (box: DOMRect) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
    const scroller = section.closest<HTMLElement>(".cc-vision")!;
    const port = scroller.getBoundingClientRect(), portStyle = getComputedStyle(scroller);
    const noContainingOrExplicitClip = (css: CSSStyleDeclaration) => css.transform === "none" && css.perspective === "none" && css.filter === "none" && css.backdropFilter === "none" && css.contain === "none" && css.willChange === "auto" && css.contentVisibility === "visible" && css.containerType === "normal" && css.clip === "auto" && css.clipPath === "none" && css.mask === "none";
    const above = []; let aboveViewportQualified = noContainingOrExplicitClip(portStyle) && portStyle.position === "fixed" && scroller.offsetParent === null && Math.abs(port.left) <= 1 && Math.abs(port.top) <= 1 && Math.abs(port.right - innerWidth) <= 1 && Math.abs(port.bottom - innerHeight) <= 1;
    for (let parent = scroller.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      const clip = { left: rect.left + parent.clientLeft, right: rect.left + parent.clientLeft + parent.clientWidth, top: rect.top + parent.clientTop, bottom: rect.top + parent.clientTop + parent.clientHeight };
      const containsPort = clip.left <= port.left + 1 && clip.right >= port.right - 1 && clip.top <= port.top + 1 && clip.bottom >= port.bottom - 1;
      const noAnomaly = noContainingOrExplicitClip(css); aboveViewportQualified &&= containsPort && noAnomaly;
      above.push({ tag: parent.tagName, clip, containsPort, noAnomaly, overflowX: css.overflowX, overflowY: css.overflowY });
    }
    const nav = scroller.querySelector("nav")!.getBoundingClientRect();
    const leaves = Array.from(section.querySelectorAll<HTMLElement>("h2,h3,p,small")).filter((node) => node.checkVisibility());
    const lines: { id: string; leaf: number; text: string; box: ReturnType<typeof bounds>; horizontalClips: string[]; nonScrollClips: string[]; painted: boolean }[] = [];
    const fonts = leaves.map((node, index) => {
      const css = getComputedStyle(node), range = document.createRange(); range.selectNodeContents(node);
      Array.from(range.getClientRects()).forEach((box, line) => {
        const horizontalClips: string[] = [], nonScrollClips: string[] = [];
        if (box.left < -1 || box.right > innerWidth + 1) horizontalClips.push("viewport");
        for (let parent: Element | null = node; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (/^(hidden|clip|auto|scroll)$/.test(style.overflowX) && (box.left < clip.left + parent.clientLeft - 1 || box.right > clip.left + parent.clientLeft + parent.clientWidth + 1)) horizontalClips.push(parent.tagName);
          const qualifiedAboveViewport = aboveViewportQualified && parent !== scroller && parent.contains(scroller);
          if (!qualifiedAboveViewport && (/^(hidden|clip)$/.test(style.overflowY) || (/^(auto|scroll)$/.test(style.overflowY) && parent.scrollHeight <= parent.clientHeight + 1)) && (box.top < clip.top + parent.clientTop - 1 || box.bottom > clip.top + parent.clientTop + parent.clientHeight + 1)) nonScrollClips.push(parent.tagName);
        }
        const inside = box.top >= Math.max(0, nav.bottom) - 1 && box.bottom <= innerHeight + 1;
        const hit = inside ? document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2) : null;
        lines.push({ id: `${index}:${line}`, leaf: index, text: node.innerText, box: bounds(box), horizontalClips, nonScrollClips, painted: inside && horizontalClips.length === 0 && nonScrollClips.length === 0 && Boolean(hit && (node === hit || node.contains(hit))) });
      });
      return { index, tag: node.tagName, text: node.textContent?.trim() ?? "", renderedText: node.innerText, size: Number.parseFloat(css.fontSize), color: css.color, paint: colorProof(node) };
    });
    const overlaps = [];
    for (let first = 0; first < lines.length; first += 1) for (let second = first + 1; second < lines.length; second += 1) {
      const a = lines[first], b = lines[second];
      if (a.leaf !== b.leaf && Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) overlaps.push({ a: a.id, b: b.id });
    }
    return { fonts, lines, overlaps, viewport: { width: innerWidth, height: innerHeight }, scroll: { top: scroller.scrollTop, height: scroller.scrollHeight, viewport: scroller.clientHeight, width: scroller.clientWidth, scrollWidth: scroller.scrollWidth }, aboveViewport: { qualified: aboveViewportQualified, fixed: portStyle.position, offsetParentNull: scroller.offsetParent === null, port: bounds(port), above } };
    };
    type Sample = { top: number; painted: string[]; sameGlyph: ReturnType<typeof snapshot>["lines"][number] | undefined; clipViolations: string[]; overlapCount: number };
    const initial = snapshot(), samples: Sample[] = [];
    if (!nativeKey) return { ...initial, samples, native: null };
    return await new Promise<ReturnType<typeof snapshot> & { samples: Sample[]; native: { key: string; trusted: boolean; moved: boolean; endpoint: boolean; frames: number } }>((resolve, reject) => {
      let raf = 0, stable = 0, last = initial.scroll.top, moved = false, frames = 0;
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Native ${nativeKey} observation did not settle within 5000ms`)); }, 5000);
      const cleanup = () => { clearTimeout(timer); cancelAnimationFrame(raf); document.removeEventListener("keydown", start, true); };
      const start = (event: KeyboardEvent) => {
        if (event.key !== nativeKey) return;
        document.removeEventListener("keydown", start, true);
        const tick = () => {
          const proof = snapshot(), top = proof.scroll.top;
          moved ||= Math.abs(top - initial.scroll.top) > .5; stable = Math.abs(top - last) <= .5 ? stable + 1 : 0; last = top; frames += 1;
          const endpoint = nativeKey === "PageUp" ? top <= 1 : top >= proof.scroll.height - proof.scroll.viewport - 1;
          samples.push({ top, painted: proof.lines.filter((line) => line.painted).map((line) => line.id), sameGlyph: proof.lines.find((line) => line.id === "4:0"), clipViolations: proof.lines.filter((line) => line.horizontalClips.length || line.nonScrollClips.length).map((line) => line.id), overlapCount: proof.overlaps.length });
          if (stable >= 3 && (moved || endpoint)) { cleanup(); resolve({ ...proof, samples, native: { key: event.key, trusted: event.isTrusted, moved, endpoint, frames } }); }
          else raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
      document.addEventListener("keydown", start, true);
    });
  }, nativeKey);
}
export function assertCareerPaint(proof: Awaited<ReturnType<typeof inspectCareerPaint>>) {
  expect(proof.fonts).toHaveLength(12);
  expect(proof.lines.filter((line) => line.horizontalClips.length || line.nonScrollClips.length)).toEqual([]);
  expect(proof.overlaps).toEqual([]);
  expect(proof.scroll.scrollWidth - proof.scroll.width).toBeLessThanOrEqual(1);
  expect(proof.fonts.filter((leaf) => leaf.paint.lowerBound < 4.5)).toEqual([]);
}
// END EXACT VISION PAINT CHECKER

// BEGIN EXACT VISION NATIVE OBSERVER
export async function nativeCareerStep(page: Page, key: "PageUp" | "PageDown") {
  const observation = inspectCareerPaint(page, key);
  // This page-bound protocol barrier follows observer registration before native input.
  await page.evaluate(() => true);
  await page.keyboard.press(key);
  const proof = await observation;
  expect(proof.native?.trusted).toBe(true);
  expect(proof.native?.moved || proof.native?.endpoint).toBe(true);
  assertCareerPaint(proof);
  expect(proof.samples.filter((sample) => sample.clipViolations.length || sample.overlapCount)).toEqual([]);
  return proof;
}
export async function nativeReach(page: Page) {
  const scroller = page.getByTestId("vision-page"), brand = scroller.locator("nav button").first();
  await brand.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(brand).toBeFocused();
  const initial = await inspectCareerPaint(page), pages = Math.ceil(initial.scroll.height / initial.scroll.viewport), cap = pages + Math.ceil(pages * .25) + 8;
  expect(cap).toBeLessThanOrEqual(512);
  const painted = new Set<string>(); const observations: { top: number; native: Awaited<ReturnType<typeof inspectCareerPaint>>["native"]; samples: Awaited<ReturnType<typeof inspectCareerPaint>>["samples"]; painted: string[] }[] = [];
  const record = (proof: Awaited<ReturnType<typeof inspectCareerPaint>>) => {
    observations.push({ top: proof.scroll.top, native: proof.native, samples: proof.samples, painted: proof.lines.filter((line) => line.painted).map((line) => line.id) });
    for (const line of proof.lines) if (line.painted) painted.add(line.id);
    for (const sample of proof.samples) for (const id of sample.painted) painted.add(id);
  };
  let up = 0;
  for (; up < cap; up += 1) { if (await scroller.evaluate((node) => node.scrollTop === 0)) break; await nativeCareerStep(page, "PageUp"); }
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
  record(await inspectCareerPaint(page));
  let down = 0;
  for (; down < cap; down += 1) {
    if (painted.size === initial.lines.length) break;
    record(await nativeCareerStep(page, "PageDown"));
  }
  expect(painted.size).toBe(initial.lines.length);
  return { cap, up, down, painted: Array.from(painted), observations, firstAndLastLeafPainted: [0, 11].every((leaf) => initial.lines.filter((line) => line.leaf === leaf).every((line) => painted.has(line.id))) };
}
// END EXACT VISION NATIVE OBSERVER

for (const locale of ["en", "pseudo"] as const) for (const viewport of viewports) {
  test(`Player career Vision ${locale} ${viewport.width} paired app profile100 and130`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const errors: string[] = [], posts: string[] = [];
    const consoleErrors: { text: string; url: string }[] = [], failedRequests: { url: string; error: string | null }[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? null }));
    const caseRoot = evidenceRoot ? `${evidenceRoot}/${locale}-${viewport.width}` : testInfo.outputPath("vision-career");
    mkdirSync(dirname(caseRoot), { recursive: true }); mkdirSync(caseRoot);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.method() === "POST") posts.push(request.url()); });
    await page.setViewportSize(viewport);
    const representative = locale === "en" && viewport.width === 1280;
    if (representative) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route((url) => url.pathname.endsWith("/vision/parkland.jpg"), (route) => route.abort());
      await page.addInitScript(() => {
        const recorded: string[] = [];
        (window as unknown as { visionClipboardURLs: string[] }).visionClipboardURLs = recorded;
        Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (url: string) => { recorded.push(url); } } });
      });
    }
    await page.addInitScript(({ profile, key, language, localeKey }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(profile)); localStorage.setItem(localeKey, language); }, { profile: DEFAULT_APP_PROFILE, key: APP_PROFILE_STORAGE_KEY, language: locale, localeKey: LOCALE_STORAGE_KEY });
    await page.goto("/?view=vision");
    const region = page.getByTestId("vision-player-career");
    await expect(region).toHaveCount(1); await expect(region).toHaveAttribute("aria-labelledby", "vision-player-career-title");
    await expect(region.locator("h2")).toHaveCount(1); await expect(region.locator("h3")).toHaveCount(3); await expect(region.locator("article")).toHaveCount(3);
    const expected = copy.map((value) => locale === "pseudo" ? pseudoLocalize(value) : value);
    await expect(page.getByRole("region", { name: expected[1], exact: true })).toHaveCount(1);
    const versions = [];
    for (const scale of [100, 130]) {
      if (scale === 130) {
        await page.evaluate((key) => { const profile = JSON.parse(localStorage.getItem(key)!); profile.accessibility.textScale = 130; localStorage.setItem(key, JSON.stringify(profile)); }, APP_PROFILE_STORAGE_KEY);
        await page.reload(); await expect(region).toHaveCount(1);
      }
      await expect.poll(() => page.locator("html").evaluate((node) => getComputedStyle(node).fontSize)).toBe(scale === 100 ? "16px" : "20.8px");
      const proof = await inspectCareerPaint(page); assertCareerPaint(proof);
      expect(proof.fonts.map((leaf) => leaf.text)).toEqual(expected);
      expect(proof.fonts.some((leaf) => leaf.text.includes("vision.playerCareer."))).toBe(false);
      const reach = await nativeReach(page); expect(reach.firstAndLastLeafPainted).toBe(true);
      versions.push({ scale, proof, reach, profile: await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), APP_PROFILE_STORAGE_KEY) });
      await page.screenshot({ path: `${caseRoot}/${scale}.png` });
    }
    expect(versions[0].proof.fonts.map(({ text, tag }) => ({ text, tag }))).toEqual(versions[1].proof.fonts.map(({ text, tag }) => ({ text, tag })));
    for (let index = 0; index < 12; index += 1) expect(Math.abs(versions[1].proof.fonts[index].size / versions[0].proof.fonts[index].size - 1.3)).toBeLessThan(.01);
    await expect(page.locator("#vision-play")).toHaveCount(1);
    const preserve = (value: string) => locale === "pseudo" ? pseudoLocalize(value) : value;
    await expect(page.getByRole("heading", { name: preserve("Build the course. Shape the world."), exact: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: preserve("Step onto your own fairways"), exact: true })).toHaveCount(1);
    await expect(page.locator("#vision-play")).toContainText(preserve("Choose the club, line, power, and technique. Live with the lie, study the result, and return to design with a sharper idea."));
    const brand = page.getByTestId("vision-page").locator("nav button").first(); await brand.focus(); await page.keyboard.press("Tab");
    expect(await page.locator(":focus").evaluate((node) => node.matches(".cc-vision nav a,.cc-vision nav button"))).toBe(true);
    let supplemental: unknown = null;
    if (representative) {
      const share = page.getByTestId("vision-page").locator("nav").getByRole("button", { name: "Share the vision", exact: true }); await share.focus(); await page.keyboard.press("Enter");
      await expect(page.getByTestId("vision-page").locator("nav").getByRole("button", { name: "Link copied", exact: true })).toBeVisible();
      const copiedURLs = await page.evaluate(() => (window as unknown as { visionClipboardURLs: string[] }).visionClipboardURLs);
      expect(copiedURLs).toEqual([page.url()]); expect(new URL(copiedURLs[0]).searchParams.get("view")).toBe("vision");
      const fallback = page.locator('[data-biome-id="parkland"]');
      const scroller = page.getByTestId("vision-page"); await expect(scroller).toBeVisible(); await brand.focus();
      for (let step = 0; step < 64 && !await fallback.evaluate((node) => node.getAttribute("data-image-state") === "unavailable"); step += 1) await page.keyboard.press("PageDown");
      await expect(fallback).toHaveAttribute("data-image-state", "unavailable");
      supplemental = { reducedMotion: await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), fallback: await fallback.getAttribute("data-image-state"), clipboardPath: "navigator.share unavailable; clipboard.writeText resolves", copiedURLs };
    }
    await brand.focus(); await page.keyboard.press("Enter"); await expect(page.getByTestId("vision-page")).toHaveCount(0);
    const expectedAborts = failedRequests.filter((request) => representative && new URL(request.url).pathname === "/vision/parkland.jpg" && request.error === "net::ERR_FAILED");
    const expectedURLs = new Set(expectedAborts.map((request) => request.url));
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !(expectedURLs.has(message.url) && message.text.includes("Failed to load resource") && message.text.includes("net::ERR_FAILED")));
    expect(failedRequests.filter((request) => !expectedAborts.includes(request))).toEqual([]);
    expect(unexpectedConsoleErrors).toEqual([]); expect(errors).toEqual([]); expect(posts).toEqual([]);
    const result = { locale, viewport, expected, versions, supplemental, errors, posts, consoleErrors, failedRequests, expectedAborts, unexpectedConsoleErrors };
    writeFileSync(`${caseRoot}/proof.json`, JSON.stringify(result, null, 2), { flag: "wx" });
    await testInfo.attach("Player career Vision verification", { body: JSON.stringify(result), contentType: "application/json" });
  });
}
