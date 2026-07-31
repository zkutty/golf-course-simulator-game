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
//        PERF_MEASURE_S (default 20)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadBiomeKeys } from "./biome-registry.mjs";

const WORK_BUDGET_MS = Number(process.env.PERF_WORK_BUDGET_MS || 8);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS || 33);
const ASSERT_FRAME = process.env.PERF_ASSERT_FRAME === "1";
const MEASURE_S = Number(process.env.PERF_MEASURE_S || 20);
const BIOME_KEYS = loadBiomeKeys();
const PERF_THEME = BIOME_KEYS.includes(process.env.PERF_THEME) ? process.env.PERF_THEME : BIOME_KEYS[0];
const PERF_FIXTURE = process.env.PERF_FIXTURE === "m27" ? "m27Fixture" : "perfFixture";
const STARTUP_BUDGET_MS = Number(process.env.PERF_STARTUP_BUDGET_MS || 5000);
const WARMUP_S = 8;
const OUTPUT_PATH = process.env.PERF_OUTPUT_PATH
  ? resolve(process.env.PERF_OUTPUT_PATH)
  : new URL(`../artifacts/m28/performance-${PERF_THEME}.json`, import.meta.url);
const PORT = 5199;

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
  execCandidate ? { executablePath: execCandidate } : {}
);
console.log("[perf-smoke] browser ready; loading fixture …");
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem("coursecraft_perfhud", "on");
  localStorage.setItem("coursecraft_ambience", "on");
});
const coldStartedAt = performance.now();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.getByRole("button", { name: "Quick Start" }).waitFor({ state: "visible", timeout: 30_000 });
const coldStartupMs = performance.now() - coldStartedAt;
const fixtureStartedAt = performance.now();
await page.goto(`http://127.0.0.1:${PORT}/?${PERF_FIXTURE}=1&perfTheme=${PERF_THEME}&perfMeasure=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
console.log("[perf-smoke] document loaded; waiting for game state …");
await sleep(500);
const canvasHandle = await page.evaluateHandle(() => {
  let best = null;
  let area = 0;
  for (const canvas of document.querySelectorAll("canvas")) {
    const candidateArea = (canvas.width || canvas.clientWidth) * (canvas.height || canvas.clientHeight);
    if (candidateArea > area) { best = canvas; area = candidateArea; }
  }
  return best;
});
const canvas = canvasHandle.asElement();
const box = canvas ? await canvas.boundingBox() : null;
await page.waitForFunction(() => {
  const text = window.render_game_to_text?.();
  return text && JSON.parse(text).screen === "game";
}, null, { timeout: 30_000 });
const fixtureLoadMs = performance.now() - fixtureStartedAt;
console.log(`[perf-smoke] game state ready in ${fixtureLoadMs.toFixed(0)}ms`);
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
await browser.close();
vite.kill();

if (!perf) {
  console.error("[perf-smoke] window.__ccPerf missing — is the perf HUD flag wired?");
  process.exit(2);
}
console.log("[perf-smoke] result:", JSON.stringify(perf, null, 2));
console.log(`[perf-smoke] cold startup ${coldStartupMs.toFixed(0)}ms; 36-hole fixture load ${fixtureLoadMs.toFixed(0)}ms`);
let failed = false;
if (coldStartupMs > STARTUP_BUDGET_MS) {
  console.error(`[perf-smoke] FAIL: cold startup ${coldStartupMs.toFixed(0)}ms > budget ${STARTUP_BUDGET_MS}ms`);
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
  rendererWorkWithinBudget: perf.workMs <= WORK_BUDGET_MS,
  frameWithinBudget: ASSERT_FRAME ? perf.p95Ms <= BUDGET_MS : null,
  passed: !failed,
};
const evidence = {
  version: 1,
  theme: PERF_THEME,
  fixture: PERF_FIXTURE,
  coldStartupMs: Math.round(coldStartupMs),
  fixtureLoadMs: Math.round(fixtureLoadMs),
  renderer: perf,
  effective: {
    theme: PERF_THEME,
    fixture: PERF_FIXTURE,
    measureSeconds: MEASURE_S,
    warmupSeconds: WARMUP_S,
    frameAssertion: ASSERT_FRAME,
    budgets: {
      rendererWorkMilliseconds: WORK_BUDGET_MS,
      coldStartupMilliseconds: STARTUP_BUDGET_MS,
      frameMilliseconds: BUDGET_MS,
    },
  },
  gateValidation,
};
mkdirSync(typeof OUTPUT_PATH === "string"
  ? dirname(OUTPUT_PATH)
  : new URL(".", OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
if (failed) process.exit(1);
console.log(
  `[perf-smoke] PASS: tick work ${perf.workMs.toFixed(2)}ms ≤ ${WORK_BUDGET_MS}ms` +
    (ASSERT_FRAME
      ? `, p95 frame ${perf.p95Ms.toFixed(2)}ms ≤ ${BUDGET_MS}ms`
      : ` (frame p95 ${perf.p95Ms.toFixed(2)}ms reported, not asserted headless)`)
);
