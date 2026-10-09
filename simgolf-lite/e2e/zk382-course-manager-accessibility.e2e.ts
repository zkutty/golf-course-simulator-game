import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CourseManagerAction } from "./fixtures/zk382-course-manager.fixture";

const evidence = join(tmpdir(), "coursecraft-zk382-course-manager");
test.use({ video: "off", trace: "retain-on-failure" });
test.beforeEach(async ({ page }) => { page.setDefaultTimeout(15_000); await mkdir(evidence, { recursive: true }); });
async function open(page: Page, locale = "en") {
  await page.addInitScript((value) => localStorage.setItem("coursecraft_locale", value), locale);
  await page.goto("/e2e/fixtures/zk382-course-manager.html");
  await expect(page.getByTestId("course-manager")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function capture(page: Page, name: string, info: import("@playwright/test").TestInfo) {
  const screenshot = await page.screenshot({ path: join(evidence, `${name}.png`) });
  await info.attach(name, { body: screenshot, contentType: "image/png" });
}
async function expectChange(page: Page, action: CourseManagerAction, run: () => Promise<unknown>) {
  const before = await page.evaluate((value) => ({ expected: window.__courseManagerFixture.expected(value), count: window.__courseManagerFixture.calls().length }), action);
  await run();
  await expect.poll(() => page.evaluate(() => window.__courseManagerFixture.calls().length)).toBe(before.count + 1);
  const after = await page.evaluate(() => ({ calls: window.__courseManagerFixture.calls(), state: window.__courseManagerFixture.state() }));
  expect(after.calls.at(-1)).toEqual({ type: "change", course: before.expected });
  expect(after.state).toEqual(before.expected);
}
const activeLayout = (page: Page) => page.evaluate(() => {
  const course = window.__courseManagerFixture.state(); return course.layouts!.find(layout => layout.id === course.activeCourseId)!;
});
async function fontSizes(panel: Locator) {
  return panel.evaluate(element => ({
    header: Number.parseFloat(getComputedStyle(element.querySelector("header h2")!).fontSize),
    body: Number.parseFloat(getComputedStyle(element.querySelector("p")!).fontSize),
    button: Number.parseFloat(getComputedStyle(element.querySelector("[data-testid=create-course]")!).fontSize),
    input: Number.parseFloat(getComputedStyle(element.querySelector("input")!).fontSize),
    select: Number.parseFloat(getComputedStyle(element.querySelector("select")!).fontSize),
  }));
}

test("root text scaling reaches header, body and native controls without font overrides", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 }); await open(page, "pseudo");
  const panel = page.getByTestId("course-manager");
  const before = await fontSizes(panel);
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  await capture(page, "text-scale-after", testInfo);
  const after = await fontSizes(panel);
  expect(await page.locator("html").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(20.8);
  for (const key of Object.keys(before) as (keyof typeof before)[]) expect(after[key] / before[key], key).toBeCloseTo(1.3, 2);
});

test("layout tabs select exact IDs with roving arrows and stable associations despite duplicate and edited names", async ({ page }) => {
  await open(page); const panel = page.getByTestId("course-manager");
  const north = panel.locator('[role="tab"][data-layout-id="north"]');
  const south = panel.locator('[role="tab"][data-layout-id="south"]');
  await expect(north).toHaveText("Willow Creek Championship Course"); await expect(south).toHaveText("Willow Creek Championship Course");
  await expect(north).toHaveAttribute("tabindex", "0"); await expect(south).toHaveAttribute("tabindex", "-1");
  const ids = { north: await north.getAttribute("id"), south: await south.getAttribute("id") };
  await north.focus();
  for (const [key, id] of [["ArrowRight", "south"], ["ArrowRight", "north"], ["ArrowLeft", "south"], ["Home", "north"], ["End", "south"]] as const) {
    await expectChange(page, { type: "select", id }, () => page.keyboard.press(key));
    const tab = panel.locator(`[role="tab"][data-layout-id="${id}"]`);
    await expect(tab).toBeFocused(); await expect(tab).toHaveAttribute("aria-selected", "true");
    expect(await panel.getByRole("tab").evaluateAll(tabs => tabs.filter(tab => (tab as HTMLElement).tabIndex === 0).length)).toBe(1);
    await expect(panel.getByRole("tabpanel")).toHaveAttribute("id", (await tab.getAttribute("aria-controls"))!);
    await expect(panel.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
  }
  await expectChange(page, { type: "rename", name: "South course renamed and still selected by ID" }, () => panel.getByLabel("Course name", { exact: true }).fill("South course renamed and still selected by ID"));
  await expect(south).toHaveAttribute("id", ids.south!); await expect(north).toHaveAttribute("id", ids.north!);
  await expect(south).toHaveAttribute("aria-selected", "true");
  const count = await page.evaluate(() => window.__courseManagerFixture.calls().length);
  await south.focus(); await page.keyboard.press("End");
  expect(await page.evaluate(() => window.__courseManagerFixture.calls().length)).toBe(count);
  await expectChange(page, { type: "select", id: "north" }, () => north.click());
  await expect(north).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("button", { name: "Create course", exact: true }).focus(); await page.keyboard.press("Escape");
  await expect(panel).toHaveAttribute("aria-modal", "false"); await expect(panel).toBeVisible();
  expect(await page.evaluate(() => window.__courseManagerFixture.calls().length)).toBe(count + 1);
  await page.getByTestId("outside-after").focus(); await expect(page.getByTestId("outside-after")).toBeFocused();
});

test("course edits and routing operations emit unchanged domain-helper results and preserve published arrays", async ({ page }) => {
  await open(page); const panel = page.getByTestId("course-manager");
  for (const [action, locator, value] of [
    [{ type: "rename", name: "Renamed championship course" }, "Course name", "Renamed championship course"],
    [{ type: "fee", value: 73 }, "Green fee", "73"],
  ] as const) await expectChange(page, action, () => panel.getByLabel(locator, { exact: true }).fill(value));
  await expectChange(page, { type: "operating", value: "closed" }, () => panel.getByRole("combobox", { name: "Operating state", exact: true }).selectOption("closed"));
  await expectChange(page, { type: "operating", value: "open" }, () => panel.getByRole("combobox", { name: "Operating state", exact: true }).selectOption("open"));
  const original = await activeLayout(page);
  const routing = panel.getByTestId("draft-routing");
  await expect(routing.getByLabel("Move up", { exact: true }).first()).toBeDisabled();
  await expect(routing.getByLabel("Move down", { exact: true }).last()).toBeDisabled();
  const count = await page.evaluate(() => window.__courseManagerFixture.calls().length);
  await routing.getByLabel("Move up", { exact: true }).first().evaluate((button: HTMLButtonElement) => button.click());
  await routing.getByLabel("Move down", { exact: true }).last().evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => window.__courseManagerFixture.calls().length)).toBe(count);
  await expectChange(page, { type: "reorder", index: 0, delta: 1 }, () => routing.getByLabel("Move down", { exact: true }).first().click());
  expect((await activeLayout(page)).publishedHoleIds).toEqual(original.publishedHoleIds);
  expect((await activeLayout(page)).draftHoleIds).not.toEqual(original.draftHoleIds);
  await expectChange(page, { type: "publish" }, () => panel.getByTestId("publish-routing").click());
  await expect(panel.getByRole("status")).toHaveText("Routing published atomically.");
  const published = await activeLayout(page); expect(published.publishedHoleIds).toEqual(published.draftHoleIds);
  await expectChange(page, { type: "remove", holeId: published.draftHoleIds[0] }, () => routing.getByLabel("Remove from draft", { exact: true }).first().click());
  expect((await activeLayout(page)).publishedHoleIds).toEqual(published.publishedHoleIds);
  await expect(panel.getByTestId("publish-routing")).toBeDisabled();
  expect(await panel.getByTestId("routing-errors").locator("li").allTextContents()).toEqual(await page.evaluate(() => window.__courseManagerFixture.report().validation.reasons));
  await panel.getByRole("combobox", { name: "Unassigned hole", exact: true }).selectOption(published.draftHoleIds[0]);
  await expectChange(page, { type: "assign", holeId: published.draftHoleIds[0] }, () => panel.getByRole("button", { name: "Assign hole", exact: true }).click());
  await expect(panel.getByRole("combobox", { name: "Unassigned hole", exact: true })).toHaveValue("");
  await expect(panel.getByRole("button", { name: "Assign hole", exact: true })).toBeDisabled();
  await expectChange(page, { type: "create" }, () => panel.getByTestId("create-course").click());
  await expect(panel.getByTestId("publish-routing")).toBeDisabled();
  const created = await activeLayout(page); expect(created.draftHoleIds).toEqual([]); expect(created.publishedHoleIds).toEqual([]);
  await expectChange(page, { type: "add" }, () => panel.getByTestId("add-estate-hole").click());
  expect((await activeLayout(page)).draftHoleIds).toHaveLength(1); expect((await activeLayout(page)).publishedHoleIds).toEqual([]);
  await page.evaluate(() => window.__courseManagerFixture.reset("limit"));
  await expectChange(page, { type: "add" }, () => panel.getByTestId("add-estate-hole").click());
  await expect(panel.getByTestId("add-estate-hole")).toBeDisabled();
  expect(await page.evaluate(() => window.__courseManagerFixture.state().holes.length)).toBe(36);
  const limitCount = await page.evaluate(() => window.__courseManagerFixture.calls().length);
  await panel.getByTestId("add-estate-hole").evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => window.__courseManagerFixture.calls().length)).toBe(limitCount);
});

test("report metrics and warnings retain domain authority and exact navigation callbacks", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await open(page); const panel = page.getByTestId("course-manager");
  const report = await page.evaluate(() => window.__courseManagerFixture.report());
  await expect(panel.getByRole("button", { name: "Close Course Manager", exact: true }).locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(panel.getByTestId("architecture-total")).toHaveText(String(report.architecture.total));
  for (const item of Object.values(report.architecture.components)) {
    await expect(panel.getByTestId(`architecture-${item.id}`).getByRole("progressbar")).toHaveAttribute("value", String(item.score));
  }
  const metric = report.metrics[0];
  await expect(panel.getByTestId("course-metrics")).toContainText(`Rating ${metric.rating.toFixed(1)} · Slope ${metric.slope} · Quality ${Math.round(metric.quality)} · Demand ${metric.demand.toFixed(2)} · ${metric.dailyVisitors}/${metric.dailyCapacity} daily rounds`);
  await panel.getByTestId("draft-routing").locator('[data-hole-id="north-1"]').getByRole("button").first().click();
  expect(await page.evaluate(() => window.__courseManagerFixture.calls())).toEqual([{ type: "select-hole", holeId: "north-1" }]);
  const warning = report.architecture.warnings[0]; expect(warning).toBeDefined();
  await panel.getByTestId("architecture-warnings").getByRole("button").first().click();
  const warningCalls = [...(warning.holeIds[0] ? [{ type: "select-hole", holeId: warning.holeIds[0] }] : []), ...(warning.location ? [{ type: "center", point: warning.location }] : [])];
  expect(await page.evaluate(() => window.__courseManagerFixture.calls())).toEqual([{ type: "select-hole", holeId: "north-1" }, ...warningCalls]);
  await panel.getByRole("button", { name: "Read architecture concepts", exact: true }).click();
  await panel.getByTestId("architecture-review-from-report").click();
  await panel.getByRole("button", { name: "Close Course Manager", exact: true }).click();
  expect(await page.evaluate(() => window.__courseManagerFixture.calls())).toEqual([{ type: "select-hole", holeId: "north-1" }, ...warningCalls, { type: "help", entry: "management-architecture" }, { type: "review" }, { type: "close" }]);
  await expect(panel).toHaveCount(0); expect(errors).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
});

for (const locale of ["en", "pseudo"]) for (const viewport of [
  { width: 320, height: 640 }, { width: 768, height: 800 }, { width: 1280, height: 800 },
]) {
  test(`${locale} ${viewport.width}x${viewport.height}: root 130 percent, contained text and keyboard reachable controls`, async ({ page }, testInfo) => {
    const errors: string[] = []; const requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", request => requests.push(request.url()));
    await page.setViewportSize(viewport); await open(page, locale);
    const panel = page.getByTestId("course-manager"); const baseline = await fontSizes(panel);
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    expect(await page.locator("html").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(20.8);
    const scaled = await fontSizes(panel);
    for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) expect(scaled[key] / baseline[key], key).toBeCloseTo(1.3, 2);
    await expect(panel).toHaveAttribute("aria-modal", "false");
    const geometry = await panel.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, documentWidth: document.documentElement.scrollWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth); expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    const textBounds = await panel.evaluate(element => {
      const panelBox = element.getBoundingClientRect(); const failures: string[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.textContent?.trim() || !parent || parent.closest("[hidden], option, select, input, svg")) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const box of range.getClientRects()) if (box.width && (box.left < panelBox.left || box.right > panelBox.right)) failures.push(node.textContent!);
      }
      return failures;
    });
    expect(textBounds).toEqual([]);
    await capture(page, `course-manager-${locale}-${viewport.width}-130-header`, testInfo);
    const controls = panel.locator('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled)');
    await controls.first().focus();
    for (let index = 0; index < await controls.count(); index++) {
      const control = controls.nth(index);
      if (index) await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      const contained = await control.evaluate(element => {
        const bounds = element.getBoundingClientRect(); const panel = element.closest('[data-testid="course-manager"]')!.getBoundingClientRect();
        return bounds.left >= panel.left && bounds.right <= panel.right && bounds.top >= panel.top && bounds.bottom <= panel.bottom
          && (element.matches("input, select") || (element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1));
      });
      expect(contained, `control ${index}`).toBe(true);
      expect(await control.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
    }
    await capture(page, `course-manager-${locale}-${viewport.width}-130-routing`, testInfo);
    await page.keyboard.press("Tab"); await expect(page.getByTestId("outside-after")).toBeFocused();
    await page.getByTestId("outside-after").focus(); await page.keyboard.press("Escape"); await expect(panel).toBeVisible();
    await page.evaluate(() => window.__courseManagerFixture.reset("invalid"));
    await expect(panel.getByTestId("publish-routing")).toBeDisabled(); await expect(panel.getByTestId("routing-errors")).toBeVisible();
    await expect(panel.getByTestId("routing-errors")).toContainText("Routing must contain exactly 9 or 18 holes.");
    await panel.getByTestId("routing-errors").scrollIntoViewIfNeeded();
    await capture(page, `course-manager-${locale}-${viewport.width}-130-errors`, testInfo);
    expect(errors).toEqual([]); await expect(page.locator("canvas")).toHaveCount(0);
    expect(requests.filter(url => /pixi|PixiStage|\/atlases\//i.test(url))).toEqual([]);
  });
}
