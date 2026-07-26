import { expect, test } from "@playwright/test";

// Building the 36-hole, 100-golfer M27 fixture is the heaviest scene boot in
// the suite, and its load time is dominated by container CPU contention, not
// renderer work (see workMs below). docs/M35_CERTIFICATION.md §3-4 measured
// ~26.5s via scripts/perf-smoke.mjs on one shared, GPU-less container; a
// slower one observed while fixing ZK-504 measured 141.7s for the identical
// fixture on the identical code. Configurable so a known-slow box can raise
// it further without a code change; default gives several times the worst
// measurement seen so far rather than the old fixed 60s, which failed before
// the renderer-budget assertion below was ever reached.
const FIXTURE_LOAD_TIMEOUT_MS = Number(process.env.PERF_FIXTURE_LOAD_TIMEOUT_MS || 240_000);

// Same env var and default as scripts/perf-smoke.mjs's PERF_WORK_BUDGET_MS:
// the renderer's own per-tick JS work is stable across machines, but
// headless/software-GL containers add scheduling noise on top of it. Default
// stays at the real product budget (8ms); only a documented sandbox run
// should override it.
const WORK_BUDGET_MS = Number(process.env.PERF_WORK_BUDGET_MS || 8);

test("M27 reports architecture for a live 36-hole, two-course estate", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem("coursecraft_perfhud", "on"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?m27Fixture=1");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").course?.holesOpen), { timeout: FIXTURE_LOAD_TIMEOUT_MS }).toBe(36);

  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  expect(state.course.layouts).toHaveLength(2);
  expect(state.course.layouts.map((layout: { publishedHoleIds: string[] }) => layout.publishedHoleIds.length)).toEqual([18, 18]);
  expect(state.course.estate.ownedParcelIds).toHaveLength(9);
  expect(state.course.architecture.total).toBeGreaterThanOrEqual(0);
  expect(Object.keys(state.course.architecture.components)).toEqual(["routing", "naturalFit", "variety", "safety", "walkability"]);
  expect(state.simulation.golfers).toHaveLength(100);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ccPerf?: { workMs: number } }).__ccPerf?.workMs ?? -1), { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
  // __ccPerf is a rolling window (PerfWindow, 180 frames) that starts filling
  // the instant the perf HUD mounts — i.e. during the one-time cost of laying
  // out 36 holes' worth of chunks, sprites, and 100 golfers. Reading it right
  // away catches that construction spike, not steady-state per-tick work.
  // scripts/perf-smoke.mjs — the gate this budget is actually calibrated
  // against — warms up 8s before measuring for the same reason; do the same
  // here so this assertion reflects steady state rather than page-load noise.
  await page.waitForTimeout(8_000);
  const perf = await page.evaluate(() => (window as unknown as { __ccPerf?: { workMs: number; p95Ms: number; fps: number } }).__ccPerf!);
  expect(perf.workMs).toBeLessThanOrEqual(WORK_BUDGET_MS);

  const report = page.getByTestId("architect-report");
  await expect(report).toBeVisible();
  await expect(report.getByTestId("architecture-total")).toHaveText(String(state.course.architecture.total));
  await expect(report.getByRole("progressbar")).toHaveCount(5);
  const warning = report.getByTestId("architecture-warnings").getByRole("button").first();
  if (await warning.count()) await warning.click();
  await expect(page.getByTestId("course-manager")).toBeVisible();
  const shot = await page.screenshot({ path: "artifacts/m27-architect-report.png", fullPage: true });
  await testInfo.attach("m27-architect-report", { body: shot, contentType: "image/png" });
  await testInfo.attach("m27-performance", { body: JSON.stringify(perf, null, 2), contentType: "application/json" });
  expect(errors).toEqual([]);
});

test("M27 report remains usable with pseudo locale, text scaling, reduced motion, and color-safe terrain", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_locale", "pseudo");
    localStorage.setItem("coursecraft_app_profile_v5", JSON.stringify({
      version: 5, tutorialOffered: true, tutorialCompleted: true, advisorFrequency: "normal", advisorSeen: [],
      gameplay: { autosaveCadence: "weekly", edgeScroll: true, edgeScrollSpeed: 1, cameraSmoothing: true, confirmBulldoze: true, confirmSalvage: true, defaultGameSpeed: "1x", tickerVisible: true, momentCamera: false },
      graphics: { quality: "auto", animations: true, ambienceFx: true, waterAnimation: true, treeSway: true, resolutionScale: 1, gridOverlays: false },
      audio: { masterVolume: 0, musicVolume: 0, sfxVolume: 0, ambienceVolume: 0, masterMuted: true, muteWhenHidden: true },
      accessibility: { colorVision: "deuteranopia", terrainPatterns: true, reducedMotion: true, textScale: 130, keybindings: {} },
      achievements: { earned: [] },
    }));
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?m27Fixture=1");
  await expect(page.getByTestId("architect-report")).toBeVisible({ timeout: FIXTURE_LOAD_TIMEOUT_MS });
  await expect(page.locator("html")).toHaveAttribute("data-locale", "pseudo");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator("html")).toHaveAttribute("data-color-vision", "deuteranopia");
  const box = await page.getByTestId("course-manager").boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1280);
  const shot = await page.screenshot({ path: "artifacts/m27-pseudo-130.png", fullPage: true });
  await testInfo.attach("m27-pseudo-130", { body: shot, contentType: "image/png" });
});
