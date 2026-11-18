// Render performance smoke (ZKU-160).
//
// Boots the app headless (Chromium via Playwright), builds a hole, runs the
// live day at 4x with a slow camera pan, then reads the renderer's perf
// counters (window.__ccPerf, exposed when the perf HUD flag is on) and
// asserts the p95 frame time stays under a generous budget. The goal is
// catching order-of-magnitude regressions, not micro-drift — headless GL
// varies, so the default budget is deliberately loose.
//
// What is asserted: the renderer's own per-tick JS work (workMs) — that is
// stable across machines. Raw frame spacing is also reported, but headless
// Chromium software-GL throttles rAF (~10fps regardless of our code), so
// the frame-time budget is only enforced when PERF_ASSERT_FRAME=1 (use on
// real hardware with a GPU).
//
// Usage: npm run test:perf   (requires playwright + a chromium; set
//        CHROMIUM_PATH if the bundled browser isn't installed)
// Env:   PERF_WORK_BUDGET_MS (default 8), PERF_BUDGET_MS (frame budget,
//        default 33, enforced only with PERF_ASSERT_FRAME=1),
//        PERF_MEASURE_S (default 20), PERF_HEADED=1 (visible GPU-backed run),
//        PERF_HARDWARE_CLASS / PERF_POWER_STATE / PERF_RUN_LABEL (evidence labels)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadBiomeKeys } from "./biome-registry.mjs";
import { flushM27PhaseLine, summarizeM27Phases } from "../src/game/render/m27PhaseObservation.mjs";

const WORK_BUDGET_MS = Number(process.env.PERF_WORK_BUDGET_MS || 8);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS || 33);
const ASSERT_FRAME = process.env.PERF_ASSERT_FRAME === "1";
const HEADED = process.env.PERF_HEADED === "1";
const MEASURE_S = Number(process.env.PERF_MEASURE_S || 20);
const BIOME_KEYS = loadBiomeKeys();
const PERF_THEME = BIOME_KEYS.includes(process.env.PERF_THEME) ? process.env.PERF_THEME : BIOME_KEYS[0];
const PERF_FIXTURE = process.env.PERF_FIXTURE === "m27" ? "m27Fixture" : "perfFixture";
const M27_PHASES = process.env.PERF_M27_PHASE_DIAGNOSTICS === "1" && PERF_FIXTURE === "m27Fixture" && PERF_THEME === "parkland";
const STARTUP_BUDGET_MS = Number(process.env.PERF_STARTUP_BUDGET_MS || 5000);
// M27 retains a 6000 ms optimization target; only its hard ceiling is 10000 ms.
const FIXTURE_LOAD_BUDGET_MS = PERF_FIXTURE === "m27Fixture" ? 10000 : 6000;
const FIXTURE_READY_TIMEOUT_MS = Number(process.env.PERF_FIXTURE_READY_TIMEOUT_MS || 120_000);
const WARMUP_S = 8;
const OUTPUT_PATH = process.env.PERF_OUTPUT_PATH
  ? resolve(process.env.PERF_OUTPUT_PATH)
  : new URL(`../artifacts/m28/performance-${PERF_THEME}.json`, import.meta.url);
const PORT = 5199;
const fixtureProfileHelpers = process.env.PERF_M27_FIXTURE_PROFILE === "1"
  ? await import("./perf-m27-fixture-profile.mjs")
  : null;
const fixtureProfileOutput = fixtureProfileHelpers?.profileOutputPath(process.env, M27_PHASES, OUTPUT_PATH);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("playwright is not installed — `npm i -D playwright` (or run from an env that has it)");
    process.exit(2);
  }
}

const { chromium } = await importPlaywright();

console.log(`[perf-smoke] starting vite on :${PORT} …`);
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: "inherit",
  detached: false,
});
process.on("exit", () => vite.kill());
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(1000);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}`);
    up = res.ok;
  } catch {
    /* not yet */
  }
}
if (!up) {
  console.error("[perf-smoke] vite never came up");
  process.exit(2);
}
console.log("[perf-smoke] vite ready; launching browser …");

const execCandidate = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch(
  { ...(execCandidate ? { executablePath: execCandidate } : {}), headless: !HEADED }
);
console.log("[perf-smoke] browser ready; loading fixture …");
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.error(`[perf-smoke] page error: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") console.error(`[perf-smoke] console error: ${message.text()}`);
});
await page.addInitScript((armM27Phases) => {
  localStorage.setItem("coursecraft_perfhud", "on");
  localStorage.setItem("coursecraft_ambience", "on");
  if (armM27Phases) window.__ccM27PhaseProbe = { generation: 0 };
}, M27_PHASES);
const coldStartedAt = performance.now();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.getByRole("button", { name: "Quick Start" }).waitFor({ state: "visible", timeout: 30_000 });
const coldStartupMs = performance.now() - coldStartedAt;
const fixtureURL = `http://127.0.0.1:${PORT}/?${PERF_FIXTURE}=1&perfTheme=${PERF_THEME}&perfMeasure=1`;
async function measureFixture() {
  const fixtureStartedAt = performance.now();
  const phaseHost = M27_PHASES ? { fixtureStart: fixtureStartedAt } : null;
  await page.goto(fixtureURL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (phaseHost) phaseHost.domContentLoaded = performance.now();
  console.log("[perf-smoke] document loaded; waiting for the visible course canvas …");
  if (phaseHost) phaseHost.sleepStart = performance.now();
  await sleep(500);
  if (phaseHost) phaseHost.sleepEnd = performance.now();
  const canvas = page.locator(".cc-pixi-stage canvas");
  try {
    if (phaseHost) phaseHost.visibleStart = performance.now();
    await canvas.waitFor({ state: "visible", timeout: FIXTURE_READY_TIMEOUT_MS });
    if (phaseHost) phaseHost.visibleEnd = performance.now();
  } catch (error) {
    const status = await page.evaluate(() => {
      const text = window.render_game_to_text?.();
      const parsed = text ? JSON.parse(text) : null;
      return {
        screen: parsed?.screen ?? null,
        course: parsed?.course?.name ?? null,
        theme: parsed?.course?.theme ?? null,
        holesOpen: parsed?.course?.holesOpen ?? null,
        canvasCount: document.querySelectorAll("canvas").length,
        bodyText: document.body.innerText.slice(0, 300),
      };
    });
    console.error(`[perf-smoke] fixture readiness timeout: ${JSON.stringify(status)}`);
    throw error;
  }
  if (phaseHost) phaseHost.dimensionsStart = performance.now();
  await page.waitForFunction(() => {
    const target = document.querySelector(".cc-pixi-stage canvas");
    return target && (target.width || target.clientWidth) > 0 && (target.height || target.clientHeight) > 0;
  }, null, { timeout: FIXTURE_READY_TIMEOUT_MS });
  if (phaseHost) phaseHost.dimensionsEnd = performance.now();
  if (phaseHost) phaseHost.boundsStart = performance.now();
  const box = await canvas.boundingBox();
  const fixtureMeasuredAt = performance.now();
  const fixtureLoadMs = fixtureMeasuredAt - fixtureStartedAt;
  if (phaseHost) phaseHost.boundsEnd = fixtureMeasuredAt;
  console.log(`[perf-smoke] game state ready in ${fixtureLoadMs.toFixed(0)}ms`);
  return { box, phaseHost, fixtureLoadMs };
}

async function runSecondaryFixtureProfile() {
  const { startProfile, withTimeout, writeProfileOutput } = fixtureProfileHelpers;
  let measurement = null;
  let capture = null;
  let setupFailed = false;
  let browserClosed = false;
  let measurementFailed = false;
  let measurementTimedOut = false;
  try {
    let abandoned = false;
    const acquisition = page.context().newCDPSession(page).then((session) => {
      if (abandoned) void withTimeout(() => session.detach(), 2_000).catch(() => {});
      return session;
    });
    let session;
    try {
      session = await withTimeout(() => acquisition, 2_000);
    } catch (error) {
      abandoned = true;
      throw error;
    }
    capture = await startProfile(session, fixtureURL);
  } catch {
    setupFailed = true;
  }
  if (capture) {
    try {
      measurement = await Promise.race([
        measureFixture(),
        capture.deadline.then(() => {
          measurementTimedOut = true;
          return null;
        }),
      ]);
    } catch {
      measurementFailed = true;
    }
  }
  const observed = capture && await capture.finish(
    measurement?.box ? "fixture-bounds" : "fixture-readiness-incomplete",
    measurement?.box ? async () => {
      const clockBefore = performance.now();
      const pageEvidence = await page.evaluate(() => {
        const canvas = document.querySelector(".cc-pixi-stage canvas");
        const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? null;
        const debug = gl?.getExtension("WEBGL_debug_renderer_info");
        return {
          phasePage: window.__ccM27PhaseProbe?.read?.() ?? null,
          userAgent: navigator.userAgent.slice(0, 512),
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          visibilityState: document.visibilityState,
          renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)).slice(0, 512) : null,
        };
      });
      return { ...pageEvidence, clockBefore, clockAfter: performance.now() };
    } : undefined,
  );
  const evidence = observed?.browserEvidence;
  const phase = measurement && evidence?.phasePage ? summarizeM27Phases({
    host: measurement.phaseHost,
    fixtureLoadMs: measurement.fixtureLoadMs,
    page: evidence.phasePage,
    clockBefore: evidence.clockBefore,
    clockAfter: evidence.clockAfter,
  }) : null;
  const browserVersion = browser.version();
  try {
    await withTimeout(() => browser.close(), 5_000);
    browserClosed = true;
  } catch {
    /* Outer process ownership is required for a wedged browser. */
  } finally {
    vite.kill();
  }
  const status = !setupFailed && !measurementFailed && measurement?.box && browserClosed
    && observed?.status === "observed" && phase?.status === "observed" ? "observed" : "incomplete";
  const exported = writeProfileOutput(fixtureProfileOutput, {
    status, setupFailed, measurementFailed, measurementTimedOut, browserClosed,
    productParent: "14c5d136c2247735782a7304bc68c11aa875477d",
    captureCommit: process.env.VITE_COMMIT_SHA ?? null,
    browserVersion,
    coldStartupMs, fixtureLoadMs: measurement?.fixtureLoadMs ?? null,
    fixtureBudgetMs: FIXTURE_LOAD_BUDGET_MS,
    originalTimedPrefixCompleted: Boolean(measurement?.box),
    phase,
    profile: observed,
  });
  process.exit(exported === "observed" ? 0 : 2);
}

if (fixtureProfileOutput) await runSecondaryFixtureProfile();
const { box, phaseHost, fixtureLoadMs } = await measureFixture();
await sleep(1200);
if (!box) throw new Error("performance fixture did not create a renderer canvas");

// Run the day at 4x with a slow keyboard pan; warm up, then measure.
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // focus + skip any flyover
await page.keyboard.press("Digit3");
await page.waitForFunction(() => JSON.parse(window.render_game_to_text?.() ?? "{}").simulation?.speed === "4x", null, { timeout: 10_000 });
console.log(`[perf-smoke] warmup ${WARMUP_S}s …`);
await sleep(WARMUP_S * 1000);
console.log(`[perf-smoke] measuring ${MEASURE_S}s with slow pan …`);
const t0 = Date.now();
let dir = "d";
while (Date.now() - t0 < MEASURE_S * 1000) {
  await page.keyboard.down(dir);
  await sleep(900);
  await page.keyboard.up(dir);
  dir = dir === "d" ? "a" : "d";
  await sleep(400);
}
const perf = await page.evaluate(() => window.__ccPerf ?? null);
const phaseClockBefore = M27_PHASES ? performance.now() : null;
const observedBrowserEvidence = await page.evaluate((readM27Phases) => {
  const canvas = [...document.querySelectorAll("canvas")]
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  let renderer = null;
  let vendor = null;
  let context = null;
  try {
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? null;
    const debug = gl?.getExtension("WEBGL_debug_renderer_info") ?? null;
    renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    vendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null;
    context = gl ? (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl") : null;
  } catch {
    // Evidence stays explicitly unknown rather than failing an otherwise valid
    // physical run on browsers that withhold debug renderer information.
  }
  let phasePage = null;
  if (readM27Phases) {
    try { phasePage = window.__ccM27PhaseProbe?.read?.() ?? null; } catch { /* diagnostic only */ }
  }
  return {
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    visibilityState: document.visibilityState,
    renderer,
    vendor,
    context,
    ...(readM27Phases ? { phasePage } : {}),
  };
}, M27_PHASES);
const phaseClockAfter = M27_PHASES ? performance.now() : null;
const { phasePage, ...browserEvidence } = observedBrowserEvidence;
await browser.close();
vite.kill();

if (!perf) {
  console.error("[perf-smoke] window.__ccPerf missing — is the perf HUD flag wired?");
  process.exit(2);
}
console.log("[perf-smoke] result:", JSON.stringify(perf, null, 2));
console.log(`[perf-smoke] cold startup ${coldStartupMs.toFixed(0)}ms; ${PERF_FIXTURE} load ${fixtureLoadMs.toFixed(0)}ms`);
let failed = false;
const fixtureLoadWithinBudget = Number.isFinite(fixtureLoadMs) && fixtureLoadMs >= 0 && fixtureLoadMs <= FIXTURE_LOAD_BUDGET_MS;
if (coldStartupMs > STARTUP_BUDGET_MS) {
  console.error(`[perf-smoke] FAIL: cold startup ${coldStartupMs.toFixed(0)}ms > budget ${STARTUP_BUDGET_MS}ms`);
  failed = true;
}
if (!Number.isFinite(fixtureLoadMs) || fixtureLoadMs < 0) {
  console.error(`[perf-smoke] FAIL: ${PERF_FIXTURE} load timing ${String(fixtureLoadMs)}ms is invalid; expected finite non-negative timing within ${FIXTURE_LOAD_BUDGET_MS}ms`);
  failed = true;
} else if (fixtureLoadMs > FIXTURE_LOAD_BUDGET_MS) {
  console.error(`[perf-smoke] FAIL: ${PERF_FIXTURE} load ${fixtureLoadMs.toFixed(3)}ms > budget ${FIXTURE_LOAD_BUDGET_MS}ms`);
  failed = true;
}
if (perf.workMs > WORK_BUDGET_MS) {
  console.error(`[perf-smoke] FAIL: renderer tick work ${perf.workMs.toFixed(2)}ms > budget ${WORK_BUDGET_MS}ms`);
  failed = true;
}
if (ASSERT_FRAME && perf.p95Ms > BUDGET_MS) {
  console.error(`[perf-smoke] FAIL: p95 frame time ${perf.p95Ms.toFixed(2)}ms > budget ${BUDGET_MS}ms`);
  failed = true;
}
const gateValidation = {
  coldStartupWithinBudget: coldStartupMs <= STARTUP_BUDGET_MS,
  fixtureLoadWithinBudget,
  rendererWorkWithinBudget: perf.workMs <= WORK_BUDGET_MS,
  frameWithinBudget: ASSERT_FRAME ? perf.p95Ms <= BUDGET_MS : null,
  passed: !failed,
};
const evidence = {
  version: 1,
  theme: PERF_THEME,
  fixture: PERF_FIXTURE,
  coldStartupMs: Math.round(coldStartupMs),
  // Preserve the exact threshold decision for downstream evidence recomputation.
  fixtureLoadMs,
  renderer: perf,
  effective: {
    theme: PERF_THEME,
    fixture: PERF_FIXTURE,
    measureSeconds: MEASURE_S,
    warmupSeconds: WARMUP_S,
    frameAssertion: ASSERT_FRAME,
    browserMode: HEADED ? "headed" : "headless",
    budgets: {
      rendererWorkMilliseconds: WORK_BUDGET_MS,
      coldStartupMilliseconds: STARTUP_BUDGET_MS,
      fixtureLoadMilliseconds: FIXTURE_LOAD_BUDGET_MS,
      frameMilliseconds: BUDGET_MS,
    },
  },
  physicalRun: {
    hardwareClass: process.env.PERF_HARDWARE_CLASS || null,
    powerState: process.env.PERF_POWER_STATE || null,
    runLabel: process.env.PERF_RUN_LABEL || null,
    browser: browserEvidence,
  },
  gateValidation,
};
mkdirSync(typeof OUTPUT_PATH === "string"
  ? dirname(OUTPUT_PATH)
  : new URL(".", OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
if (M27_PHASES) {
  const fallback = (reason) => JSON.stringify({ schema: "coursecraft-m27-phase-v1", status: "inconclusive", reason });
  let phaseOutput;
  try {
    phaseOutput = JSON.stringify(summarizeM27Phases({ host: phaseHost, page: phasePage,
      clockBefore: phaseClockBefore, clockAfter: phaseClockAfter, fixtureLoadMs }));
    if (Buffer.byteLength(phaseOutput) > 32 * 1024) phaseOutput = fallback("output-cap");
  } catch {
    phaseOutput = fallback("summary-error");
  }
  await flushM27PhaseLine(process.stdout, phaseOutput);
}
if (failed) process.exit(1);
console.log(
  `[perf-smoke] PASS: tick work ${perf.workMs.toFixed(2)}ms ≤ ${WORK_BUDGET_MS}ms` +
    (ASSERT_FRAME
      ? `, p95 frame ${perf.p95Ms.toFixed(2)}ms ≤ ${BUDGET_MS}ms`
      : ` (frame p95 ${perf.p95Ms.toFixed(2)}ms reported, not asserted headless)`)
);
