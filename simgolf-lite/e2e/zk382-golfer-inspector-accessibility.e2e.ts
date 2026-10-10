import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const fixture = "/e2e/fixtures/zk382-golfer-inspector.html";
const errors = new WeakMap<object, string[]>();
const rendererRequests = new WeakMap<object, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []); rendererRequests.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("request", (request) => { if (/pixi|\/renderer\//i.test(request.url())) rendererRequests.get(page)!.push(request.url()); });
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(rendererRequests.get(page)).toEqual([]);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("ZK382 golfer has named nonmodal semantics, accessible mood and exact scorecard facts", async ({ page }) => {
  await page.goto(fixture);
  const panel = page.locator(".cc-golfer-inspector");
  await expect(panel).toHaveAttribute("role", "region");
  await expect(panel).toHaveAccessibleName("Golfer details: Alexandria María de los Ángeles Montgomery-Worthington Championship Guest");
  await expect(panel).not.toHaveAttribute("aria-modal");
  const meter = panel.getByRole("meter");
  await expect(meter).toHaveAttribute("aria-valuenow", "80");
  await expect(meter).toHaveAttribute("aria-valuetext", "Mood: 80% — Delighted");
  const entries = panel.locator(".cc-golfer-scorecard-entry");
  await expect(entries).toHaveCount(36);
  for (let i = 0; i < 36; i++) {
    const par = 3 + i % 3, delta = [-1, 0, 1, 2][i % 4];
    const text = `Hole ${i + 1} · Par ${par} · ${par + delta} strokes · ${delta === 0 ? "Even" : delta > 0 ? `+${delta}` : delta}`;
    await expect(entries.nth(i)).toHaveText(text);
  }
  for (const text of ["Hole 36", "-3", "36", "$123,457", "$987,654", "Championship", "Pin C", "1.3", "Riding cart", "48 min", "32", "6 min", "17 tiles", "power 82", "accuracy 94", "Irons 74", "short game 62", "recovery 55", "Precision around difficult protected greens"]) {
    expect(await panel.textContent()).toContain(text);
  }
  await expect(panel.getByTestId("golfer-shot-evidence")).toHaveAttribute("data-phase", "unavailable");
  await expect(panel.getByTestId("golfer-shot-evidence")).toHaveAttribute("aria-live", "polite");
  await expect(panel.getByTestId("golfer-shot-evidence")).toHaveAttribute("aria-atomic", "true");
  await expect(panel.locator(".cc-golfer-thought-label")).toHaveText(["Trouble!", "Bogey…", "Loving it", "Great hole!"]);
  expect(await panel.locator("[data-emote-kind]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-emote-kind")))).toEqual(["alert", "angry", "happy", "star"]);
  await expect(page.getByTestId("immutable-input")).toHaveText("true");
});

for (const locale of ["en", "pseudo"] as const) for (const size of [{ width: 320, height: 640 }, { width: 768, height: 800 }, { width: 1280, height: 800 }]) {
  test(`ZK382 golfer all text grows 1.3 and remains reachable: ${locale} ${size.width}`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.setViewportSize(size);
    await page.goto(fixture);
    const panel = page.locator(".cc-golfer-inspector");
    const readText = () => panel.evaluate((element) => Array.from(element.querySelectorAll<HTMLElement>("*"))
      .filter((node) => Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()))
      .map((node) => ({ text: node.textContent, font: parseFloat(getComputedStyle(node).fontSize) })));
    const baseline = await readText();
    await page.evaluate(() => document.documentElement.style.fontSize = "20.8px");
    const scaled = await readText();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20.8px");
    expect(scaled.length).toBe(baseline.length);
    for (let i = 0; i < scaled.length; i++) expect(Math.abs(scaled[i].font / baseline[i].font - 1.3), scaled[i].text ?? "text").toBeLessThan(0.01);
    const layout = await panel.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, bottom: box.bottom, client: element.clientWidth, scroll: element.scrollWidth,
        document: document.documentElement.scrollWidth, clipped: Array.from(element.querySelectorAll<HTMLElement>("*"))
          .filter((child) => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).display !== "inline").map((child) => child.className) };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(size.width);
    expect(layout.bottom).toBeLessThanOrEqual(size.height); expect(layout.scroll).toBeLessThanOrEqual(layout.client);
    expect(layout.document).toBeLessThanOrEqual(size.width); expect(layout.clipped).toEqual([]);
    const last = panel.locator(".cc-golfer-scorecard-entry").last();
    await panel.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await last.scrollIntoViewIfNeeded();
    const boxes = await last.evaluate((node) => ({ child: node.getBoundingClientRect().toJSON(), parent: node.closest(".cc-golfer-inspector")!.getBoundingClientRect().toJSON() }));
    expect(boxes.child.bottom).toBeLessThanOrEqual(boxes.parent.bottom);
    expect(boxes.child.top).toBeGreaterThanOrEqual(boxes.parent.top);
    await expect(panel.getByRole("button").first()).toHaveAccessibleName(locale === "en" ? "Close" : /Çlôsë/);
    await testInfo.attach(`golfer-${locale}-${size.width}-130-percent`, { body: await panel.screenshot(), contentType: "image/png" });
    await testInfo.attach("actual-font-growth", { body: JSON.stringify({ baseline, scaled, layout }), contentType: "application/json" });
  });
}

test("ZK382 golfer native keyboard can leave, callbacks preserve state and painted focus has contrast", async ({ page }) => {
  await page.goto(fixture);
  const panel = page.locator(".cc-golfer-inspector");
  const close = panel.getByRole("button", { name: "Close", exact: true });
  await expect(close.locator("svg[aria-hidden=true]")).toHaveCount(1);
  await close.focus();
  await page.keyboard.press("Tab");
  const follow = panel.locator(".cc-golfer-follow");
  await expect(follow).toHaveAccessibleName("Follow golfer");
  await expect(follow).toBeFocused();
  const bounds = await follow.boundingBox();
  const png = PNG.sync.read(await page.screenshot());
  const index = (Math.round(bounds!.y - 5) * png.width + Math.round(bounds!.x + bounds!.width / 2)) * 4;
  expect(Array.from(png.data.subarray(index, index + 3))).toEqual([255, 255, 255]);
  const colors = await follow.evaluate((node) => ({ outline: getComputedStyle(node).outlineColor, background: getComputedStyle(node.closest(".cc-golfer-inspector")!).backgroundColor }));
  expect(colors.outline).toBe("rgb(255, 255, 255)"); expect(colors.background).toBe("rgb(24, 33, 26)");
  await page.keyboard.press("Enter");
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect(follow).toHaveText(/Following/);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "After inspector" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("callback-log")).toHaveText("follow");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await close.click();
  await expect(page.getByTestId("callback-log")).toHaveText("follow,follow,close");
  await expect(page.getByTestId("immutable-input")).toHaveText("true");
});

test("ZK382 golfer thresholds, locale labels, optional facts and null selection remain exact", async ({ page }) => {
  for (const [value, label] of [[0.8, "Delighted"], [0.799, "Happy"], [0.6, "Happy"], [0.599, "Okay"], [0.4, "Okay"], [0.399, "Frustrated"], [0.2, "Frustrated"], [0.199, "Fed up"]] as const) {
    await page.goto(`${fixture}?mood=${value}`);
    await expect(page.getByRole("meter")).toHaveAttribute("aria-valuetext", `Mood: ${Math.round(value * 100)}% — ${label}`);
  }
  for (const [tee, mobility, archetype, expected] of [["forward", "walk", "pro", ["Forward", "Walk", "Professional golfer"]], ["member", "pushcart", "junior", ["Member", "Pushcart", "Junior golfer"]]] as const) {
    await page.goto(`${fixture}?tee=${tee}&mobility=${mobility}&archetype=${archetype}&hole=-1&score=0&pending&played=0`);
    const text = await page.locator(".cc-golfer-inspector").textContent();
    for (const value of [...expected, "Clubhouse", "Even", "pending", "0 min", "0 tiles"]) expect(text).toContain(value);
    await expect(page.locator(".cc-golfer-scorecard-entry")).toHaveCount(0);
  }
  for (const phase of ["intent", "reaction", "result"] as const) {
    await page.goto(`${fixture}?phase=${phase}`);
    const channel = page.getByTestId("golfer-shot-evidence");
    await expect(channel).toHaveAttribute("data-phase", phase);
    for (const text of phase === "intent" ? ["2", "7 Iron", "12.5", "33.25"] : phase === "reaction" ? ["4.2", "5", "0.37"] : ["2", "1", "legacy"]) expect((await channel.textContent())?.toLowerCase()).toContain(text.toLowerCase());
  }
  await page.goto(`${fixture}?minimal&no-follow&played=0&no-emotes`);
  await expect(page.getByTestId("golfer-mobility-inspector")).toHaveCount(0);
  await expect(page.locator(".cc-golfer-capabilities")).toHaveCount(0);
  await expect(page.locator(".cc-golfer-inspector button")).toHaveCount(1);
  await expect(page.locator(".cc-golfer-thoughts")).toHaveCount(0);
  await page.goto(`${fixture}?empty-strengths&score=7&archetype=guest`);
  await expect(page.locator(".cc-golfer-identity")).toContainText("guest");
  await expect(page.locator(".cc-golfer-capabilities")).toContainText("balanced");
  await expect(page.locator(".cc-golfer-stats")).toContainText("+7");
  await page.goto(`${fixture}?null`);
  await expect(page.locator(".cc-golfer-inspector")).toHaveCount(0);
});

test("ZK382 golfer rendered text meets contrast on each actual scoped surface", async ({ page }, testInfo) => {
  await page.goto(fixture);
  const ratios = await page.locator(".cc-golfer-inspector").evaluate((panel) => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const luminance = (color: number[]) => color.slice(0, 3).map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    return Array.from(panel.querySelectorAll<HTMLElement>("*")).filter((node) => !node.closest("[aria-hidden=true]") &&
      Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map((node) => {
        let surface: Element | null = node;
        while (surface && rgb(getComputedStyle(surface).backgroundColor)[3] === 0) surface = surface.parentElement;
        const foreground = getComputedStyle(node).color, background = getComputedStyle(surface!).backgroundColor;
        const values = [luminance(rgb(foreground)), luminance(rgb(background))].sort((a, b) => b - a);
        return { text: node.textContent, foreground, background, contrast: (values[0] + .05) / (values[1] + .05) };
      });
  });
  expect(ratios.length).toBeGreaterThan(50);
  for (const value of ratios) expect(value.contrast, value.text ?? "text").toBeGreaterThanOrEqual(4.5);
  await testInfo.attach("scoped-text-contrast", { body: JSON.stringify(ratios), contentType: "application/json" });
});
