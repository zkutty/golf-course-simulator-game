import { expect, test, type Page } from "@playwright/test";
import { translate } from "../src/i18n/core";
import type { ReviewCall, ReviewMode } from "./fixtures/zk382-architecture-review.fixture";
const url = "/e2e/fixtures/zk382-architecture-review.html";
const modes: ReviewMode[] = ["empty", "current", "historical", "reference-absent", "reference-selected", "green-loading", "green-ready", "mobility"];
const kinds = ["reference", "traces", "dispersion", "heatmap", "recovery", "scoring", "hazards", "walking", "mobility", "congestion", "options", "advantage", "bailouts", "carries", "misses", "green-preferred", "green-putts", "green-leaves", "green-misses", "green-rollout", "green-risk"];
async function reset(page: Page, mode: ReviewMode) {
  const expected = await page.evaluate(value => window.__architectureFixture.reset(value), mode);
  await expect.poll(() => page.evaluate(() => window.__architectureFixture.state())).toEqual(expected);
  await expect(page.getByTestId("architecture-review")).toBeVisible();
}
async function calls(page: Page): Promise<ReviewCall[]> { return page.evaluate(() => window.__architectureFixture.calls()); }

for (const locale of ["en", "pseudo"] as const) for (const [width, height] of [[320, 640], [768, 800], [1280, 800]]) {
  test(`architecture all states at ${width}x${height}, ${locale}, native 130 percent text`, async ({ page }) => {
    const errors: string[] = [];
    const rendererRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/pixi|\.wasm(?:\?|$)/i.test(request.url())) rendererRequests.push(request.url()); });
    await page.addInitScript(value => localStorage.setItem("coursecraft_locale", value), locale);
    await page.setViewportSize({ width, height });
    await page.goto(url);
    const panel = page.getByTestId("architecture-review");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-modal", "false");
    const closeIcon = panel.locator(":scope > header button svg");
    await expect(closeIcon).toHaveCount(1);
    await expect(closeIcon).toHaveAttribute("aria-hidden", "true");
    await expect(closeIcon).toHaveAttribute("viewBox", "0 0 24 24");
    await expect(closeIcon.locator("path")).toHaveAttribute("d", "m6 6 12 12M18 6 6 18");
    await expect(panel.getByRole("tab")).toHaveCount(0);
    const teeValues = ["all", "forward", "member", "championship"] as const;
    const teeFilter = panel.getByTestId("architecture-tee-filter");
    await expect(teeFilter.locator("option")).toHaveText(teeValues.map(value => value === "all" ? translate(locale, "architecture.review.all") : translate(locale, `playerPro.play.tee.${value}`)));
    expect(await teeFilter.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(teeValues);
    for (const teeSet of teeValues) {
      const previous = await page.evaluate(() => window.__architectureFixture.state().filters);
      await teeFilter.selectOption(teeSet);
      expect((await calls(page)).at(-1)).toEqual({ type: "filters", filters: { ...previous, teeSet } });
    }
    for (const mode of modes) {
      await reset(page, mode);
      await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
      const baseline = await panel.evaluate(node => [...node.querySelectorAll<HTMLElement>("header, button, select, strong, p, small, summary")].map(element => parseFloat(getComputedStyle(element).fontSize)));
      await page.evaluate(() => { document.documentElement.style.fontSize = "20.8px"; });
      const enlarged = await panel.evaluate(node => [...node.querySelectorAll<HTMLElement>("header, button, select, strong, p, small, summary")].map(element => parseFloat(getComputedStyle(element).fontSize)));
      expect(enlarged).toHaveLength(baseline.length);
      for (let index = 0; index < baseline.length; index++) expect(Math.abs(enlarged[index] / baseline[index] - 1.3)).toBeLessThan(0.01);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20.8px");
      for (const details of await panel.locator("details").all()) { await details.locator("summary").click(); await expect(details).toHaveAttribute("open", ""); }
      await page.keyboard.press("Tab");
      for (const control of await panel.locator("button, select, summary").all()) {
        await control.focus();
        await expect(control).toBeFocused();
        const state = await control.evaluate(element => {
          const bounds = element.getBoundingClientRect(); const parent = element.closest<HTMLElement>("[data-testid=architecture-review]")!; const clip = parent.getBoundingClientRect();
          return { fits: bounds.left >= clip.left && bounds.right <= clip.right && bounds.top >= clip.top && bounds.bottom <= clip.bottom, outline: getComputedStyle(element).outlineStyle, name: element instanceof HTMLSelectElement ? element.closest("label")?.textContent?.trim() : element.textContent?.trim() || element.getAttribute("aria-label") };
        });
        expect(state.fits, `${mode} control ${state.name}`).toBe(true);
        expect(state.name).toBeTruthy();
        expect(state.outline).not.toBe("none");
      }
      const layout = await panel.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const range = document.createRange();
        const textWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const clipped: string[] = [];
        while (textWalker.nextNode()) {
          const text = textWalker.currentNode; const parent = text.parentElement!;
          if (!text.textContent?.trim() || parent.closest("select, option") || !parent.getClientRects().length) continue;
          range.selectNodeContents(text);
          for (const rect of range.getClientRects()) if (rect.left < bounds.left || rect.right > bounds.right) clipped.push(text.textContent!);
        }
        return { left: bounds.left, right: bounds.right, overflow: node.scrollWidth - node.clientWidth, documentWidth: document.documentElement.scrollWidth, clipped };
      });
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(width);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.documentWidth).toBeLessThanOrEqual(width);
      expect(layout.clipped).toEqual([]);
      const state = await page.evaluate(() => window.__architectureFixture.state());
      await expect(panel).toContainText(state.explanation);
      if (state.comparison) await expect(panel).toContainText(state.comparison.explanation);
      if (state.selectedReferencePlan) { await expect(panel).toContainText(state.selectedReferencePlan.explanation); for (const warning of state.selectedReferencePlan.warnings) await expect(panel).toContainText(warning); }
      if (state.greenStrategy) { await expect(panel).toContainText(state.greenStrategy.textSummary); await expect(panel.getByTestId("architecture-green-history")).toContainText("7"); }
      for (const item of state.rules.feedback) await expect(panel).toContainText(item.message);
      for (const warning of state.mobility?.missingLinkWarnings ?? []) await expect(panel).toContainText(warning);
      await panel.getByTestId("architecture-practice-round").focus();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("outside-after")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toBeVisible();
      await panel.locator(":scope > header button").focus();
      await page.keyboard.press("Tab");
      const beforeScroll = await panel.evaluate(node => node.scrollTop);
      await page.keyboard.press("PageDown");
      await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(beforeScroll);
      await page.getByTestId("outside-before").focus();
      await panel.evaluate(node => new Promise<void>(resolve => {
        const finish = () => { node.scrollTop = 0; resolve(); };
        node.addEventListener("scrollend", finish, { once: true });
        setTimeout(finish, 350);
      }));
      const titleFits = await panel.locator("#architecture-review-title").evaluate(element => {
        const title = element.getBoundingClientRect(); const clip = element.closest<HTMLElement>("[data-testid=architecture-review]")!.getBoundingClientRect();
        return title.top >= clip.top && title.bottom <= clip.bottom && title.left >= clip.left && title.right <= clip.right;
      });
      expect(titleFits, `${mode} complete title reachable`).toBe(true);
      if (mode === "green-ready") await panel.screenshot({ path: `artifacts/zk382/architecture-${width}px-${locale}-130pct.png` });
    }
    expect(errors).toEqual([]);
    expect(rendererRequests).toEqual([]);
    await expect(page.locator("canvas")).toHaveCount(0);
  });
}

test("architecture preserves exact filter objects, jump IDs and coordinates, practice outcomes and illustration focus", async ({ page }) => {
  await page.goto(url);
  const panel = page.getByTestId("architecture-review");
  await expect(panel).toBeVisible();
  for (const kind of kinds) {
    const previous = await page.evaluate(() => window.__architectureFixture.state().filters);
    await panel.getByTestId(`architecture-overlay-${kind}`).click();
    expect((await calls(page)).at(-1)).toEqual({ type: "filters", filters: { ...previous, kind } });
    await expect(panel.getByTestId(`architecture-overlay-${kind}`)).toHaveAttribute("aria-pressed", "true");
    expect(await panel.getByTestId(`architecture-overlay-${kind}`).evaluate(node => getComputedStyle(node).borderStyle)).toBe("double");
  }
  const selections = [["architecture-course-filter", "south", "courseId"], ["architecture-hole-filter", "all", "holeId"], ["architecture-tee-filter", "championship", "teeSet"], ["architecture-pin-filter", "C", "pinRotation"], ["architecture-segment-filter", "members", "sourceSegment"], ["architecture-green-cohort", "accuracy", "cohortId"], ["architecture-age-filter", "historical", "recency"]] as const;
  for (const [id, value, key] of selections) {
    const previous = await page.evaluate(() => window.__architectureFixture.state().filters);
    await panel.getByTestId(id).selectOption(value);
    expect((await calls(page)).at(-1)).toEqual({ type: "filters", filters: { ...previous, [key]: value } });
  }
  await panel.getByTestId("architecture-overlay-mobility").click();
  for (const mobilityMode of ["walk", "pushcart", "riding_cart", "all"]) {
    const previous = await page.evaluate(() => window.__architectureFixture.state().filters);
    await panel.getByTestId("architecture-mobility-mode").selectOption(mobilityMode);
    expect((await calls(page)).at(-1)).toEqual({ type: "filters", filters: { ...previous, mobilityMode } });
  }
  await reset(page, "current");
  const state = await page.evaluate(() => window.__architectureFixture.state());
  await panel.getByTestId("architecture-return-jump").click();
  expect((await calls(page)).at(-1)).toEqual({ type: "jump", point: state.returnToDesign!.point, holeId: state.returnToDesign!.holeId });
  for (const cohort of state.selectedStrategicHole!.cohorts) {
    const before = (await calls(page)).length;
    await panel.getByTestId(`architecture-cohort-${cohort.cohortId}`).click();
    const option = state.selectedStrategicHole!.options.find(item => item.kind === cohort.preferredOption);
    if (option) expect((await calls(page)).at(-1)).toEqual({ type: "jump", point: option.location, holeId: state.selectedStrategicHole!.holeId });
    else expect(await calls(page)).toHaveLength(before);
  }
  for (const item of state.recommendations) { await panel.getByTestId(`architecture-recommendation-${item.id}`).click(); expect((await calls(page)).at(-1)).toEqual({ type: "jump", point: item.location, holeId: item.holeId }); }
  for (const item of state.evidence.slice(-6).reverse()) { await panel.getByTestId(`architecture-evidence-${item.id}`).click(); expect((await calls(page)).at(-1)).toEqual({ type: "jump", point: item.rest, holeId: item.holeId }); }
  await expect(panel.getByTestId("architecture-evidence-evidence-6")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByTestId("architecture-evidence-evidence-6")).toContainText("Selected evidence");
  await panel.getByTestId("architecture-revision-compare").selectOption("revision-2");
  await expect(panel.getByTestId("architecture-comparison")).toContainText("4.75");
  await expect(panel.getByTestId("architecture-comparison")).toContainText("55");
  await expect(panel.getByTestId("architecture-comparison")).toContainText("-1.5");
  await panel.getByTestId("architecture-practice-round").click();
  expect((await calls(page)).at(-1)).toEqual({ type: "practice", courseId: "north" });
  await expect(panel.getByRole("status")).toContainText("Practice round started");
  const reason = "Authored blocked practice reason with its complete qualifier.";
  await page.evaluate(value => window.__architectureFixture.practiceReason(value), reason);
  await panel.getByTestId("architecture-practice-round").click();
  await expect(panel.getByRole("status")).toHaveText(reason);
  await reset(page, "green-ready");
  const green = await page.evaluate(() => window.__architectureFixture.state().greenStrategy!);
  for (const item of green.recommendations) {
    const button = panel.getByTestId(`architecture-green-recommendation-${item.id}`);
    await expect(button).toContainText(item.severity === "warning" ? "Warning" : "Advice");
    await button.click(); expect((await calls(page)).at(-1)).toEqual({ type: "jump", point: item.location, holeId: item.holeId });
  }
  await reset(page, "current");
  const launcher = panel.getByTestId("architecture-create-hole-illustration");
  await launcher.click();
  const preview = panel.getByTestId("hole-illustration-preview");
  await expect(preview).toBeVisible();
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  const image = preview.locator("img");
  await expect(image).toHaveAttribute("alt", /.+/);
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect(page.locator("canvas")).toHaveCount(0);
  await preview.getByRole("button", { name: "Close hole illustration preview" }).click();
  await expect(preview).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  expect((await calls(page)).at(-1)).toEqual({ type: "close" });
  await expect(panel).toHaveCount(0);
});
