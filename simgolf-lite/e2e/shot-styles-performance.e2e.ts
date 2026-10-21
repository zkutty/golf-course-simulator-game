import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { PlayerShotRenderDiagnostics } from "../src/ui/renderer/scenes/overlaysDiagnosticsScene";

interface RendererPerfSample {
  fps: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  workMs: number;
  golfers: number;
  sections: Record<string, number>;
}

test("selected retained shot stays within renderer work budget with 100 background golfers", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("coursecraft_perfhud", "on");
    localStorage.setItem("coursecraft_ambience", "on");
  });
  await page.goto("/?perfFixture=1&perfMeasure=1");
  await expect(page.locator(".cc-pixi-stage canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const perf = (window as unknown as { __ccPerf?: RendererPerfSample }).__ccPerf;
    return perf?.golfers;
  })).toBe(100);
  // Match the standard perf-smoke fixture's eight-second renderer warmup.
  await page.waitForTimeout(8000);
  const baseline = await page.evaluate(() => (window as unknown as { __ccPerf: RendererPerfSample }).__ccPerf);
  await page.getByTestId("workspace-operate").click();
  await page.getByTestId("open-player-pro").click();
  await page.getByTestId("player-pro-tab-play").click();
  // A disabled control is a fixture/setup blocker; no production seam is added.
  await expect(page.getByTestId("start-player-round")).toBeEnabled();
  await page.getByTestId("start-player-round").click();
  await expect(page.getByTestId("player-shot-hud")).toBeVisible();
  await page.getByTestId("player-shot-club").selectOption("Driver");
  await page.getByTestId("player-shot-style").selectOption("straight_run");
  await expect(page.getByTestId("commit-player-shot")).toBeEnabled();
  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text!()).playerPro.activeRound);
  const input = await page.getByTestId("player-shot-hud").evaluate((element) => ({
    club: (element.querySelector('[data-testid="player-shot-club"]') as HTMLSelectElement).value,
    style: (element.querySelector('[data-testid="player-shot-style"]') as HTMLSelectElement).value,
    power: (element.querySelector('[data-testid="player-shot-power"]') as HTMLInputElement).value,
  }));
  await page.getByTestId("commit-player-shot").click();
  const measurement = await page.evaluate(async () => {
    const target = window as unknown as { __ccPerf?: RendererPerfSample; __ccPlayerShotPlayback?: PlayerShotRenderDiagnostics };
    const samples: Array<{ elapsedMs: number; phase: string; progress: number | null; shotId: string | null; perf: RendererPerfSample }> = [];
    const started = performance.now();
    let completedAt: number | null = null;
    while (performance.now() - started < 20_000) {
      const state = JSON.parse(window.render_game_to_text!());
      const round = state.playerPro.activeRound;
      const shot = target.__ccPlayerShotPlayback;
      const perf = target.__ccPerf;
      if (perf) samples.push({ elapsedMs: performance.now() - started,
        phase: round.phase === "flight" ? shot?.phase ?? "addressing" : "rest",
        progress: shot?.motionProgress ?? null, shotId: shot?.shotId ?? null,
        perf: { ...perf, sections: { ...perf.sections } } });
      if (round.phase !== "flight") completedAt ??= performance.now();
      if (completedAt !== null && performance.now() - completedAt >= 600) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const after = JSON.parse(window.render_game_to_text!());
    return { samples, durationMs: performance.now() - started, after, devicePixelRatio: window.devicePixelRatio,
      profile: JSON.parse(localStorage.getItem("coursecraft_app_profile_v5") ?? "{}") };
  });
  const samples = measurement.samples;
  const meanWorkMs = samples.reduce((sum, sample) => sum + sample.perf.workMs, 0) / Math.max(1, samples.length);
  const maxReportedWorkMs = Math.max(...samples.map((sample) => sample.perf.workMs));
  const airborne = samples.filter((sample) => sample.phase === "airborne");
  const rollout = samples.filter((sample) => sample.phase === "rollout");
  const rest = samples.filter((sample) => sample.phase === "rest");
  const evidence = { fixture: "perfFixture=1&perfMeasure=1", viewport: page.viewportSize(),
    warmupMs: 8000, pollMs: 50, rendererWorkBudgetMs: 8, headlessFrameTimingReportedOnly: true,
    // App's existing performance fixture explicitly uses run seed 12160.
    seed: 12160, baseline, input, beforeStrokes: before.strokes,
    phaseWork: Object.fromEntries([["airborne", airborne], ["rollout", rollout], ["rest", rest]].map(([phase, entries]) => {
      const phaseSamples = entries as typeof samples;
      return [phase, { samples: phaseSamples.length,
        meanWorkMs: phaseSamples.reduce((sum, sample) => sum + sample.perf.workMs, 0) / Math.max(1, phaseSamples.length),
        maxReportedWorkMs: Math.max(...phaseSamples.map((sample) => sample.perf.workMs)) }];
    })),
    meanWorkMs, maxReportedWorkMs, airborneSamples: airborne.length, rolloutSamples: rollout.length, restSamples: rest.length,
    measurement, errors };
  writeFileSync(info.outputPath("selected-shot-performance.json"), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: info.outputPath("selected-shot-100-golfers-rest.png"), fullPage: true });
  expect(samples.length).toBeGreaterThan(0);
  expect(new Set(samples.map((sample) => sample.perf.golfers))).toEqual(new Set([100]));
  expect(new Set(airborne.map((sample) => sample.progress)).size).toBeGreaterThanOrEqual(3);
  expect(rollout.length).toBeGreaterThan(0);
  expect(rest.length).toBeGreaterThan(0);
  expect(measurement.after.playerPro.activeRound.phase).not.toBe("flight");
  expect(measurement.after.playerPro.activeRound.strokes).toBe(before.strokes + 1);
  expect(measurement.after.playerPro.activeRound.recentTrace.shotStyle).toBe("straight_run");
  expect(Number.isFinite(meanWorkMs)).toBe(true);
  expect(meanWorkMs).toBeLessThanOrEqual(8);
  expect(maxReportedWorkMs).toBeLessThanOrEqual(8);
  expect(errors).toEqual([]);
});
