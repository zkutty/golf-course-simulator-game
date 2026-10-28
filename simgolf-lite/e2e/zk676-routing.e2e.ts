import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { ArchitectureReviewFilters } from "../src/game/architecture/review";
import type { ArchitectureRoutingHole } from "../src/game/architecture/reviewTypes";
import type { Course, Point } from "../src/game/models/types";
declare global { interface Window { __routingFixture: { state(): { filters: ArchitectureReviewFilters; routing: ArchitectureRoutingHole[]; calls: Array<{ point: Point; holeId: string }>; courseHash: string }; course(): Course; camera(zoom: number, rotation: 0 | 1 | 2 | 3): void; toggle(): void; unmount(): void; remount(): void } } }
const base = "/e2e/fixtures/zk676-routing.html";
async function ready(page: Page) {
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible();
  await expect(page.getByTestId("architecture-routing-map")).toHaveCount(1);
  await expect.poll(() => page.locator('.cc-routing-map button[data-fits="true"]').count()).toBeGreaterThan(0);
}
async function observeDuring<T>(command: Promise<void>, observation: Promise<T>): Promise<T> {
  // Settle both branches even on failure before allowing another mutation.
  const [action, observed] = await Promise.allSettled([command, observation]);
  if (action.status === "rejected") throw action.reason;
  if (observed.status === "rejected") throw observed.reason;
  return observed.value;
}
async function readyDuring(page: Page, command: Promise<void> = Promise.resolve()) {
  const results = await Promise.allSettled([
    // Preserve the original post-command canvas visibility observation.
    command.then(() => expect(page.locator(".cc-pixi-stage canvas")).toBeVisible()),
    expect(page.getByTestId("architecture-routing-map")).toHaveCount(1),
    expect.poll(() => page.locator('.cc-routing-map button[data-fits="true"]').count()).toBeGreaterThan(0),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
}
async function verifyPlacement(page: Page, expectedNumbers: number) {
  await expect(page.locator('.cc-routing-map button[data-role="number"]')).toHaveCount(expectedNumbers);
  const boxes = await page.locator(".cc-routing-map button").evaluateAll(nodes => nodes.map(node => { const b = node.getBoundingClientRect(); return { id: (node as HTMLElement).dataset.testid, hidden: (node as HTMLButtonElement).hidden, fits: (node as HTMLElement).dataset.fits, x: b.x, y: b.y, width: b.width, height: b.height }; }).filter(b => !b.hidden));
  verifyBoxes(boxes);
}
type RoutingBox = { id: string | undefined; hidden: boolean; fits: string | undefined; x: number; y: number; width: number; height: number };
function verifyBoxes(boxes: RoutingBox[]) {
  expect(boxes.every(box => box.fits === "true"), JSON.stringify(boxes.filter(b => b.fits !== "true"))).toBe(true);
  for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.id} overlaps ${b.id}`).toBe(true);
}
function readResponsiveSnapshot() {
  const input = window.__coursecraftPixiTest?.viewportInputState();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".cc-routing-map button"));
  const fontTargets = document.querySelectorAll<HTMLButtonElement>('[data-testid="routing-map-number-routing-1"]');
  return {
    rotation: input?.rotation.committed,
    zoom: input?.camera.zoom,
    numberCount: document.querySelectorAll('.cc-routing-map button[data-role="number"]').length,
    placementPublished: buttons.length > 0 && buttons.every(button => button.dataset.fits === "true" || button.dataset.fits === "false"),
    boxes: buttons.map(node => { const b = node.getBoundingClientRect(); return { id: node.dataset.testid, hidden: node.hidden, fits: node.dataset.fits, x: b.x, y: b.y, width: b.width, height: b.height }; }).filter(b => !b.hidden),
    fontTargetCount: fontTargets.length,
    fontSize: fontTargets.length === 1 ? getComputedStyle(fontTargets[0]).fontSize : null,
  };
}
type ResponsiveSnapshot = ReturnType<typeof readResponsiveSnapshot>;
async function responsiveSnapshot(page: Page, rotation: 0 | 1 | 2 | 3, zoom: number) {
  let snapshot: ResponsiveSnapshot | undefined;
  // Keep each original readiness stage's own default deadline and intervals.
  const stage = (getter: (value: ResponsiveSnapshot) => number | undefined) => {
    let first = true;
    return expect.poll(async () => {
      if (!first || !snapshot) snapshot = await page.evaluate(readResponsiveSnapshot);
      first = false;
      return getter(snapshot);
    });
  };
  await stage(value => value.rotation).toBe(rotation * 90);
  await stage(value => value.zoom).toBeCloseTo(zoom, 2);
  await stage(value => value.placementPublished ? value.numberCount : undefined).toBe(4);
  if (!snapshot) throw new Error("Routing snapshot unavailable after readiness checks");
  if (snapshot.fontTargetCount !== 1) {
    // Preserve the original strict attachment wait and remaining-test deadline.
    expect(await page.getByTestId("routing-map-number-routing-1").evaluate(el => getComputedStyle(el).fontSize)).toBe("20.8px");
    snapshot = await page.evaluate(readResponsiveSnapshot);
  }
  expect(snapshot.fontTargetCount).toBe(1);
  expect(snapshot.placementPublished).toBe(true);
  return snapshot;
}
for (const fixture of ["four", "compact", "overlapping", "crossing", "spread", "incomplete", "nine", "eighteen", "multi"]) {
  test(`ZK-676 native Pixi ${fixture} identity, selection and collision placement`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}?fixture=${fixture}`); await ready(page);
    const before = await page.evaluate(() => window.__routingFixture.state());
    const count = fixture === "eighteen" ? 18 : fixture === "nine" || fixture === "multi" ? 9 : 4;
    expect(before.routing!.map(h => h.number)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    await verifyPlacement(page, count);
    for (const role of ["number", "tee", "pin"] as const) {
      const target = page.getByTestId(`routing-map-${role}-routing-1`);
      await target.click();
      const after = await page.evaluate(() => window.__routingFixture.state());
      expect(after.filters.holeId).toBe("routing-1");
      expect(after.calls.at(-1)).toEqual({ point: role === "number" ? before.routing![0].anchor : role === "tee" ? before.routing![0].tee : before.routing![0].pin, holeId: "routing-1" });
      expect(after.courseHash).toBe(before.courseHash);
      await expect(page.locator('.cc-routing-map button[data-role="number"]')).toHaveCount(count);
    }
    const other = page.getByTestId("routing-map-number-routing-2"); await other.focus();
    await expect(other).toHaveAttribute("data-emphasized", "true");
    await expect(page.getByTestId("routing-map-number-routing-1")).toHaveAttribute("data-dimmed", "true");
    await other.press("Enter"); expect((await page.evaluate(() => window.__routingFixture.state())).filters.holeId).toBe("routing-2");
    await page.getByTestId("architecture-tee-filter").selectOption("championship");
    await page.getByTestId("architecture-pin-filter").selectOption("C");
    const alternate = await page.evaluate(() => window.__routingFixture.state());
    expect(alternate.routing![0].teeSet).toBe("championship"); expect(alternate.routing![0].pinRotation).toBe("C");
    await page.getByTestId("architecture-routing-order").selectOption("draft");
    expect((await page.evaluate(() => window.__routingFixture.state())).routing![0].holeId).toBe(`routing-${count}`);
    if (fixture === "multi") { await page.getByTestId("architecture-course-filter").selectOption("layout-2"); expect((await page.evaluate(() => window.__routingFixture.state())).routing!.map(h => h.holeId)).toEqual(Array.from({ length: 9 }, (_, i) => `routing-${18 - i}`)); }
    if (fixture === "incomplete") { await expect(page.getByTestId("routing-map-tee-routing-2")).toHaveCount(0); await expect(page.getByTestId("routing-map-pin-routing-3")).toHaveCount(0); await expect(page.getByTestId("architecture-routing-summary")).toContainText("Missing tee and green"); }
    await page.screenshot({ path: info.outputPath(`${fixture}.png`) });
    expect(errors).toEqual([]);
  });
}
for (const biome of ["parkland", "links", "desert"] as const) {
  test(`ZK-676 ${biome} zoom/rotation, pseudo, 130 percent and reduced motion`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    test.setTimeout(120_000); await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("coursecraft_locale", "pseudo"));
    await page.goto(`${base}?fixture=crossing&biome=${biome}`); await readyDuring(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    for (const rotation of [0, 1, 2, 3] as const) for (const zoom of [.18, .25, .45]) {
      const snapshot = await observeDuring(
        page.evaluate(({ zoom, rotation }) => window.__routingFixture.camera(zoom, rotation), { zoom, rotation }),
        responsiveSnapshot(page, rotation, zoom),
      );
      expect(snapshot.rotation).toBe(rotation * 90);
      expect(snapshot.zoom).toBeCloseTo(zoom, 2);
      expect(snapshot.numberCount).toBe(4);
      verifyBoxes(snapshot.boxes);
      expect(snapshot.fontSize).toBe("20.8px");
      await page.screenshot({ path: info.outputPath(`${biome}-${rotation}-${zoom}.png`) });
    }
    await expect(page.getByTestId("architecture-routing-summary")).toContainText("⟦");
    for (let i = 0; i < 6; i++) {
      await observeDuring(page.evaluate(() => window.__routingFixture.toggle()), expect(page.getByTestId("architecture-routing-map")).toHaveCount(0));
      await readyDuring(page, page.evaluate(() => window.__routingFixture.toggle()));
    }
    await observeDuring(page.evaluate(() => window.__routingFixture.unmount()), expect(page.getByTestId("architecture-routing-map")).toHaveCount(0));
    await readyDuring(page, page.evaluate(() => window.__routingFixture.remount()));
    expect(errors).toEqual([]);
  });
}

test("ZK-676 36-hole native routing scoped work stays below the 8ms reference envelope", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto("/e2e/fixtures/zk676-routing-performance.html");
  await expect(page.getByTestId("architecture-routing-map")).toHaveCount(1);
  const receipt = await page.evaluate(async () => {
    const api = (window as unknown as { __routingPerformance: { start(): void; stop(): { durations: number[]; frames: number; holeCount: number; routeCount: number; beforeHash: string; afterHash: string }; dispose(): void } }).__routingPerformance;
    const originalRect = Element.prototype.getBoundingClientRect;
    let labelReads = 0;
    Element.prototype.getBoundingClientRect = function() { if (this.closest(".cc-routing-map")) labelReads++; return originalRect.call(this); };
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    labelReads = 0;
    await new Promise(resolve => setTimeout(resolve, 500));
    const idleLabelReads = labelReads;
    api.start(); await new Promise(resolve => setTimeout(resolve, 4000));
    const result = api.stop(); Element.prototype.getBoundingClientRect = originalRect;
    return { ...result, idleLabelReads, measuredLabelReads: labelReads };
  });
  expect(receipt.holeCount).toBe(36); expect(receipt.routeCount).toBe(36);
  expect(receipt.durations.length).toBeGreaterThanOrEqual(20);
  expect(receipt.idleLabelReads).toBe(0);
  const sorted = [...receipt.durations].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * .95)];
  expect(p95).toBeLessThan(8);
  expect(receipt.afterHash).toBe(receipt.beforeHash);
  await writeFile(info.outputPath("routing-performance.json"), JSON.stringify({ ...receipt, p95 }, null, 2));
  await info.attach("routing-performance.json", { path: info.outputPath("routing-performance.json"), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("36-hole-pan-zoom.png") });
});

for (const biome of ["parkland", "links", "desert"]) test(`ZK-676 ${biome} close zoom labels and text equivalent remain accessible`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}?fixture=crossing&biome=${biome}`); await ready(page);
  for (const rotation of [0, 1, 2, 3] as const) {
    await page.evaluate(rotation => window.__routingFixture.camera(1.2, rotation), rotation);
    await expect.poll(() => page.evaluate(() => window.__coursecraftPixiTest?.viewportInputState()?.camera.zoom)).toBeCloseTo(1.2, 2);
    await verifyPlacement(page, 4);
    await expect(page.locator('.cc-routing-map button[data-role="number"]:visible').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${biome}-close-${rotation}.png`) });
  }
  await expect(page.getByTestId("architecture-routing-summary")).toContainText("Bends are not shot targets");
  await expect(page.locator(".cc-routing-list li")).toHaveCount(4);
  await page.getByTestId("routing-map-number-routing-1").hover();
  await expect(page.getByTestId("routing-map-number-routing-1")).toHaveAttribute("data-emphasized", "true");
  await expect(page.getByTestId("routing-map-number-routing-2")).toHaveAttribute("data-dimmed", "true");
  expect(errors).toEqual([]);
});

test("ZK-676 real App selection reaches existing hole details without changing game authority", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?m26Fixture=1");
  await expect(page.getByTestId("open-architecture-review")).toBeVisible();
  if (await page.evaluate(() => window.__coursecraftTest!.state().speed !== "paused")) await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__coursecraftTest!.state().speed)).toBe("paused");
  await page.getByTestId("open-architecture-review").click();
  await page.getByTestId("architecture-overlay-routing").click();
  await expect(page.getByTestId("architecture-routing-map")).toHaveCount(1);
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  await expect(page.getByTestId("routing-map-number-north-2")).toBeVisible();
  const before = await page.evaluate(() => ({ authority: window.__coursecraftTest!.state(), text: JSON.parse(window.render_game_to_text!()) }));
  for (const role of ["number", "tee", "pin"]) {
    await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
    const target = page.getByTestId(`routing-map-${role}-north-2`);
    await expect(target).toHaveAttribute("data-fits", "true");
    await target.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).architectureReview.filters.holeId)).toBe("north-2");
    await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor.activeHole)).toBe(2);
    await expect(page.locator('.cc-routing-map button[data-role="number"]')).toHaveCount(9);
    const current = await page.evaluate(() => window.__coursecraftTest!.state());
    expect(current.courseHash).toBe(before.authority.courseHash); expect(current.terrainVersion).toBe(before.authority.terrainVersion); expect(current.economyVersion).toBe(before.authority.economyVersion);
  }
  await page.getByTestId("architecture-course-filter").selectOption("south");
  await page.evaluate(() => window.__coursecraftPixiTest!.fitWholeCourse());
  const south = page.getByTestId("routing-map-number-south-1"); await south.focus(); await south.press("Enter");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).architectureReview.filters.holeId)).toBe("south-1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).editor.activeHole)).toBe(10);
  const after = await page.evaluate(() => ({ authority: window.__coursecraftTest!.state(), text: JSON.parse(window.render_game_to_text!()) }));
  expect(after.authority.courseHash).toBe(before.authority.courseHash);
  await writeFile(info.outputPath("real-app-selection.json"), JSON.stringify({ before, after }, null, 2));
  await page.screenshot({ path: info.outputPath("real-app-south-selection.png") });
  await page.getByTestId("architecture-review").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("architecture-routing-map")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("ZK-676 removed controls detach every owned interaction listener", async ({ page }) => {
  await page.goto(`${base}?fixture=four`); await ready(page);
  const before = await page.evaluate(() => {
    const old = document.querySelector<HTMLButtonElement>('[data-testid="routing-map-number-routing-1"]')!;
    Object.assign(window, { __removedRoutingControl: old });
    const count = window.__routingFixture.state().calls.length;
    window.__routingFixture.toggle();
    return count;
  });
  await expect(page.getByTestId("architecture-routing-map")).toHaveCount(0);
  const result = await page.evaluate(() => {
    const holder = window as unknown as { __removedRoutingControl?: HTMLButtonElement };
    const old = holder.__removedRoutingControl!;
    old.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    old.dispatchEvent(new Event("focus")); old.dispatchEvent(new Event("pointerenter"));
    delete holder.__removedRoutingControl;
    return { after: window.__routingFixture.state().calls.length, connected: old.isConnected, roots: document.querySelectorAll(".cc-routing-map").length };
  });
  expect(result).toEqual({ after: before, connected: false, roots: 0 });
});
