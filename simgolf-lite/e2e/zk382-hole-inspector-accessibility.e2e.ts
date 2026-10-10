import { expect, test, type Page } from "@playwright/test";

const fixture = "/e2e/fixtures/zk382-hole-inspector.html";
const panel = (page: Page) => page.locator(".cc-hole-inspector");
async function calls(page: Page) { return JSON.parse(await page.getByTestId("callback-log").evaluate((e: HTMLOutputElement) => e.value)) as unknown[][]; }

test("native tee selection and existing course callbacks remain independent", async ({ page }) => {
  await page.goto(fixture);
  const inspector = panel(page);
  await expect(inspector).toHaveAttribute("role", "region");
  await expect(inspector).toHaveAccessibleName("Hole 1");
  await expect(inspector.getByTestId("pin-fairness-A")).toContainText("99% tournament ready");
  await expect(inspector.getByTestId("pin-fairness-A")).toContainText("Difficulty 3% · edge 4.0 tiles");
  await expect(inspector.getByTestId("pin-cohorts-A")).toContainText("1.45 putts · -0.1 sat");
  await expect(inspector.getByTestId("pin-fairness-B")).toContainText("Physically invalid cup");
  await expect(inspector.getByTestId("pin-fairness-B")).toContainText("Cup lacks the required usable green coverage and clearance.");
  for (const text of ["400", "2.1", "3.4", "25.0", "85%", "$1,250"]) await expect(inspector).toContainText(text);
  await expect(inspector.locator(".cc-hole-terrain-row")).toHaveText([
    /Fairway:\s*11.6%/, /Rough:\s*72.6%/, /Green:\s*14.6%/, /Tee:\s*1.2%/,
    /Fairway:\s*17.1%/, /Rough:\s*60.5%/, /Green:\s*20.6%/, /Tee:\s*1.8%/,
  ]);
  const forward = inspector.getByRole("button", { name: "Select Forward tee", exact: true });
  await forward.focus(); await page.keyboard.press("Enter");
  await expect(forward).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.getByTestId("tee-row-forward")).toContainText("Selected tee");
  expect(await calls(page)).toEqual([["select", "forward"]]);
  await expect(inspector.getByTestId("tee-par-forward")).toHaveValue("AUTO");
  await page.keyboard.press("Space");
  expect(await calls(page)).toEqual([["select", "forward"], ["select", "forward"]]);
  await inspector.getByTestId("place-member-tee").click();
  expect((await calls(page)).slice(-2)).toEqual([["place-tee", "member"], ["select", "member"]]);
  await inspector.getByRole("button", { name: "Remove Member tee" }).click();
  expect((await calls(page)).slice(-2)).toEqual([["remove-tee", "member"], ["select", "member"]]);
  await expect(inspector.getByTestId("tee-par-member")).toHaveValue("4");
  for (const tee of ["forward", "championship"]) {
    await inspector.getByTestId(`place-${tee}-tee`).click();
    expect((await calls(page)).slice(-2)).toEqual([["place-tee", tee], ["select", tee]]);
  }
  await inspector.getByRole("button", { name: "Select Member tee", exact: true }).click();
  await inspector.getByTestId("tee-par-member").selectOption("5");
  await inspector.getByTestId("tee-par-member").selectOption("AUTO");
  for (const rotation of ["A", "B", "C"]) await inspector.getByRole("combobox", { name: "Active daily pin rotation" }).selectOption(rotation);
  for (const name of ["Fit", "Tee", "Landing", "Green", "▶ Flyover"]) await inspector.getByRole("button", { name, exact: true }).click();
  for (const rotation of ["A", "B", "C"]) await inspector.getByTestId(`place-pin-${rotation}`).click();
  await inspector.getByRole("button", { name: "Remove Pin A" }).click();
  await inspector.getByRole("button", { name: "Remove Pin B" }).click();
  const index = inspector.getByRole("spinbutton"); await expect(index).toHaveAccessibleName("Hole Index / Stroke Index");
  await index.fill("18"); await index.fill("19"); await index.fill("0");
  for (const name of ["Widen fairway +5y", "Widen fairway +10y", "Paint fairway along centerline"]) await inspector.getByRole("button", { name, exact: true }).click();
  await inspector.getByRole("checkbox").check();
  const log = await calls(page);
  for (const entry of [["par", "member", { mode: "MANUAL", par: 5 }], ["par", "member", { mode: "AUTO" }], ...["A", "B", "C"].map((r) => ["pin", r]), ...["fit", "tee", "landing", "green"].map((p) => ["fit", p]), ["flyover"], ...["A", "B", "C"].map((r) => ["place-pin", r]), ["remove-pin", "A"], ["remove-pin", "B"], ["stroke-index", 18], ["fairway", 5], ["fairway", 10], ["fairway", 30], ["fix", true]]) expect(log).toContainEqual(entry);
  expect(log).not.toContainEqual(["stroke-index", 19]); expect(log).not.toContainEqual(["stroke-index", 0]);
  await expect(page.getByTestId("immutable-inputs")).toHaveJSProperty("value", "true");
  const last = inspector.getByRole("button", { name: "Paint fairway along centerline" }); await last.focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Outside inspector" })).toBeFocused();
});

for (const locale of ["en", "pseudo"] as const) for (const viewport of [{ width: 320, height: 640 }, { width: 768, height: 800 }, { width: 1280, height: 800 }]) {
  test(`all text and controls scale and remain reachable: ${locale} ${viewport.width}`, async ({ page }) => {
    const errors: string[] = []; const rendererRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (/pixi|\/render\/|\/renderer\/|\.wasm(?:\?|$)/i.test(r.url())) rendererRequests.push(r.url()); });
    await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
    await page.setViewportSize(viewport); await page.goto(fixture);
    const inspector = panel(page);
    const baseline = await inspector.evaluate((root) => [...root.querySelectorAll<HTMLElement>("*")].filter((e) => e.matches("input,select,button") || [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())).map((e) => Number.parseFloat(getComputedStyle(e).fontSize)));
    await page.evaluate(() => document.documentElement.style.fontSize = "20.8px");
    const scaled = await inspector.evaluate((root) => [...root.querySelectorAll<HTMLElement>("*")].filter((e) => e.matches("input,select,button") || [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())).map((e) => Number.parseFloat(getComputedStyle(e).fontSize)));
    expect(scaled.length).toBe(baseline.length); for (let i = 0; i < scaled.length; i++) expect(Math.abs(scaled[i] / baseline[i] - 1.3), `text ${i}`).toBeLessThan(.01);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20.8px");
    const overflow = await inspector.evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      return [...root.querySelectorAll<HTMLElement>("*")].filter((e) => {
        if (["OPTION", "INPUT"].includes(e.tagName)) return false;
        const rect = e.getBoundingClientRect();
        return rect.width > 0 && (rect.left < bounds.left || rect.right > bounds.right || e.scrollWidth > e.clientWidth + 1);
      }).map((e) => `${e.tagName} ${e.className} ${e.textContent?.slice(0, 70)}`);
    });
    expect(overflow).toEqual([]);
    if (locale === "pseudo" && viewport.width === 320) await inspector.screenshot({ path: "/tmp/hole-inspector-320px-130pct-pseudo.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    for (const control of await inspector.locator("button,input,select").all()) {
      await control.focus(); await expect(control).toBeFocused();
      const within = await control.evaluate((e) => { const r = e.getBoundingClientRect(); const p = e.closest(".cc-hole-inspector")!.getBoundingClientRect(); return r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom; });
      expect(within).toBe(true);
    }
    const textBlocks = inspector.locator("*").filter({ hasText: /\S/ });
    for (const block of await textBlocks.all()) {
      const ownText = await block.evaluate((e) => e.tagName !== "OPTION" && [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()));
      if (!ownText) continue;
      await block.scrollIntoViewIfNeeded();
      expect(await block.evaluate((e) => { const r = e.getBoundingClientRect(); const p = e.closest(".cc-hole-inspector")!.getBoundingClientRect(); return r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom; })).toBe(true);
    }
    await inspector.evaluate((e) => e.scrollTop = 0);
    const box = (await inspector.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => inspector.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    expect(await contrastFailures(inspector)).toEqual([]);
    expect(await inspector.locator("canvas").count()).toBe(0); expect(errors).toEqual([]); expect(rendererRequests).toEqual([]);
  });
}

test("missing, blocked and no-issues variants preserve distances, shots and messages", async ({ page }) => {
  for (const variant of ["missing", "blocked", "noissues"]) {
    await page.goto(`${fixture}?variant=${variant}`);
    const inspector = panel(page);
    await expect(inspector).toContainText("520");
    await expect(inspector.getByRole("combobox", { name: "Active daily pin rotation" })).toHaveValue("B");
    await expect(inspector).toContainText(variant === "noissues" ? "No issues found" : "Not playable");
    if (variant === "blocked") await expect(inspector).toContainText("Not reachable in two");
    if (variant === "missing") { await expect(inspector).toContainText("Not erected"); await expect(inspector.getByRole("button", { name: "Remove Pin A" })).toHaveCount(0); }
    if (variant === "noissues") await expect(inspector.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByTestId("immutable-inputs")).toHaveJSProperty("value", "true");
  }
});

// Composite the live surfaces and the darkest painted gradient stop. Using the
// darkest stop gives a conservative contrast bound for the preserved paper texture.
async function contrastFailures(inspector: import("@playwright/test").Locator) {
  return inspector.evaluate((root) => {
    type Color = [number, number, number, number];
    const parse = (value: string): Color => {
      if (value.startsWith("#")) {
        const hex = value.slice(1); const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
        return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1];
      }
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
    };
    const over = (a: Color, b: Color): Color => [a[0] * a[3] + b[0] * (1 - a[3]), a[1] * a[3] + b[1] * (1 - a[3]), a[2] * a[3] + b[2] * (1 - a[3]), 1];
    const luminance = (c: Color) => c.slice(0, 3).map((v) => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a: Color, b: Color) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const surface = (e: Element | null): Color => {
      if (!e) return [255, 255, 255, 1];
      const style = getComputedStyle(e);
      let color = over(parse(style.backgroundColor), surface(e.parentElement));
      for (const layer of style.backgroundImage.split(/\), (?=(?:repeating-)?linear-gradient)/)) {
        const stops = layer.match(/rgba?\([^)]+\)|#[0-9a-f]+/gi) ?? [];
        if (stops.length) color = stops.map((stop) => over(parse(stop), color)).sort((a, b) => luminance(a) - luminance(b))[0];
      }
      return color;
    };
    const failures: string[] = [];
    for (const e of root.querySelectorAll<HTMLElement>("*")) {
      if (e.tagName === "OPTION" || ![...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
      const contrast = ratio(parse(getComputedStyle(e).color), surface(e));
      if (contrast < 4.5) failures.push(`${e.tagName} ${e.textContent?.slice(0, 55)}: ${contrast.toFixed(2)}`);
    }
    const focus = root.querySelector<HTMLElement>(":focus-visible");
    if (focus) {
      const style = getComputedStyle(focus);
      if (parseFloat(style.outlineWidth) < 2 || style.outlineStyle === "none") failures.push("Missing visible focus outline");
      if (ratio(parse(style.outlineColor), surface(focus.parentElement)) < 3) failures.push("Focus outline contrast below 3:1");
    } else failures.push("No visible keyboard focus");
    return failures;
  });
}
