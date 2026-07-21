// Render performance smoke (ZKU-160).
//
// Boots the app headless (Chromium via Playwright), builds a hole, runs the
// live day at 3x with a slow camera pan, then reads the renderer's perf
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
import { existsSync } from "node:fs";

const WORK_BUDGET_MS = Number(process.env.PERF_WORK_BUDGET_MS || 8);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS || 33);
const ASSERT_FRAME = process.env.PERF_ASSERT_FRAME === "1";
const MEASURE_S = Number(process.env.PERF_MEASURE_S || 20);
const PERF_THEME = ["parkland", "links", "desert"].includes(process.env.PERF_THEME) ? process.env.PERF_THEME : "parkland";
const PERF_FIXTURE = process.env.PERF_FIXTURE === "m27" ? "m27Fixture" : "perfFixture";
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
const vite = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: "inherit",
  detached: false,
});
process.on("exit", () => vite.kill());
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(1000);
  try {
    const res = await fetch(`http://localhost:${PORT}`);
    up = res.ok;
  } catch {
    /* not yet */
  }
}
if (!up) {
  console.error("[perf-smoke] vite never came up");
  process.exit(2);
}

const execCandidate = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch(
  execCandidate ? { executablePath: execCandidate } : {}
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem("coursecraft_perfhud", "on");
  localStorage.setItem("coursecraft_ambience", "on");
});
await page.goto(`http://localhost:${PORT}/?${PERF_FIXTURE}=1&perfTheme=${PERF_THEME}`);
await page.waitForFunction(() => {
  const text = window.render_game_to_text?.();
  return text && JSON.parse(text).screen === "game";
}, null, { timeout: 30_000 });
await sleep(1200);
const box = await page.locator("canvas").first().boundingBox();
if (!box) throw new Error("performance fixture did not create a renderer canvas");

// Run the day at 3x with a slow keyboard pan; warm up, then measure.
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // focus + skip any flyover
console.log("[perf-smoke] warmup 8s …");
await sleep(8000);
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
let failed = false;
if (perf.workMs > WORK_BUDGET_MS) {
  console.error(`[perf-smoke] FAIL: renderer tick work ${perf.workMs.toFixed(2)}ms > budget ${WORK_BUDGET_MS}ms`);
  failed = true;
}
if (ASSERT_FRAME && perf.p95Ms > BUDGET_MS) {
  console.error(`[perf-smoke] FAIL: p95 frame time ${perf.p95Ms.toFixed(2)}ms > budget ${BUDGET_MS}ms`);
  failed = true;
}
if (failed) process.exit(1);
console.log(
  `[perf-smoke] PASS: tick work ${perf.workMs.toFixed(2)}ms ≤ ${WORK_BUDGET_MS}ms` +
    (ASSERT_FRAME
      ? `, p95 frame ${perf.p95Ms.toFixed(2)}ms ≤ ${BUDGET_MS}ms`
      : ` (frame p95 ${perf.p95Ms.toFixed(2)}ms reported, not asserted headless)`)
);
