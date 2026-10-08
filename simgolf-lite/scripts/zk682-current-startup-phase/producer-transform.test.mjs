import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createStartupPhaseObserver, OPERATIONS, LEDGER_BASENAME, DONOR_SHA256 } from "./observer.mjs";
import { DONOR_BYTES, transformStartupProducer, inverseStartupProducer, validateStartupProducer, extractStartupPhaseSegment } from "./producer-transform.mjs";

const donorPath = process.env.ZK682_STARTUP_DONOR_PATH || "/Users/zbkutlow/.codex/worktrees/startup-review-demand-eebb/golf-course-simulator-game/simgolf-lite/scripts/perf-smoke.mjs";
const donor = readFileSync(donorPath, "utf8");
const observerModuleUrl = new URL("./observer.mjs", import.meta.url).href;
const optionsFor = (dir, enabled = true) => ({ observerModuleUrl, ledgerPath: join(dir, LEDGER_BASENAME), enabled });
const sha = (text) => createHash("sha256").update(text).digest("hex");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const startAnchor = "const fixtureStartedAt = performance.now();\n";
const endAnchor = "const fixtureLoadMs = performance.now() - fixtureStartedAt;\n";
const baselineSegment = donor.slice(donor.indexOf(startAnchor), donor.indexOf(endAnchor) + endAnchor.length) + "return { box, fixtureLoadMs };\n";

async function harness(input = {}) {
  const { mode = "enabled", failed = -1, statusFailure = false, statusValue = undefined, duration = [4, 500, 6, 7, 8], delayed = false, foreign = false, faultClock = false } = input;
  const primary = Object.hasOwn(input, "primary") ? input.primary : false;
  const dir = mkdtempSync(join(tmpdir(), "zk682-startup-transform-"));
  const options = optionsFor(dir, mode !== "disabled");
  if (foreign) writeFileSync(options.ledgerPath, "foreign");
  let now = 100;
  let observer;
  const calls = [];
  const inventoryArgs = (args) => args.map((arg) => typeof arg === "function" ? arg.toString() : arg);
  const operation = (index, args, result) => {
    calls.push({ operation: OPERATIONS[index], args: inventoryArgs(args) });
    const settle = () => {
      now += duration[index];
      if (index === failed) return Promise.reject(primary);
      return result;
    };
    return delayed ? Promise.resolve().then(settle) : settle();
  };
  const canvas = {
    waitFor: (...args) => operation(2, args, undefined),
    boundingBox: (...args) => operation(4, args, { x: 1, y: 2, width: 3, height: 4 }),
  };
  const page = {
    goto: (...args) => operation(0, args, undefined),
    locator: (...args) => { calls.push({ operation: "locator", args }); return canvas; },
    waitForFunction: (...args) => operation(3, args, undefined),
    evaluate: (...args) => {
      calls.push({ operation: "timeout-text-evaluate", args: inventoryArgs(args) });
      now += 9;
      if (statusFailure) return Promise.reject(statusValue);
      return { screen: "menu", course: null, theme: null, holesOpen: null, canvasCount: 0, bodyText: "loading" };
    },
  };
  const code = mode === "baseline" ? baselineSegment : extractStartupPhaseSegment(transformStartupProducer(donor, options), options);
  const run = new AsyncFunction("page", "sleep", "performance", "console", "PORT", "PERF_FIXTURE", "PERF_THEME", "FIXTURE_READY_TIMEOUT_MS", "__zk682CreatePhase", code);
  const create = (args) => {
    observer = createStartupPhaseObserver({ ...args, ...(faultClock ? { clock() { throw undefined; } } : {}) });
    return observer;
  };
  let returned, error, rejected = false;
  try {
    returned = await run(page, (...args) => operation(1, args, undefined), { now: () => now }, { log() {}, error() {} }, 5199, "m27Fixture", "parkland", 300_000, create);
  } catch (value) { rejected = true; error = value; }
  const ledger = existsSync(options.ledgerPath) && !foreign ? JSON.parse(readFileSync(options.ledgerPath, "utf8")) : null;
  const foreignBytes = foreign ? readFileSync(options.ledgerPath, "utf8") : null;
  const snapshot = observer?.freeze();
  rmSync(dir, { recursive: true, force: true });
  return { returned, error, rejected, calls, ledger, snapshot, foreignBytes, now };
}

// This counts the whole donor too, not merely a mirror implementation. Marker
// reconstruction additionally rejects arbitrary forbidden code in insertions.
function inventory(source) {
  return {
    awaits: (source.match(/\bawait\s/g) || []).length,
    reactions: (source.match(/\.(?:then|catch|finally)\s*\(/g) || []).length,
    timers: (source.match(/\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\s*\(/g) || []).length,
    browser: (source.match(/\b(?:page|canvas|browser|chromium)\.[A-Za-z]+\s*\(/g) || []).map((v) => v.trim()),
    gates: (source.match(/\b(?:readinessBudgetValidation|rendererBudgetValidation)\s*\(/g) || []).length,
  };
}

test("full actual donor byte/hash inverse and whole producer await/reaction/timer/browser/gate cardinality", () => {
  const options = optionsFor(tmpdir());
  assert.equal(Buffer.byteLength(donor), DONOR_BYTES); assert.equal(sha(donor), DONOR_SHA256);
  const generated = transformStartupProducer(donor, options);
  assert.strictEqual(inverseStartupProducer(generated), donor);
  assert.equal(validateStartupProducer(generated, options), true);
  assert.deepEqual(inventory(generated), inventory(donor));
  assert.equal((baselineSegment.match(/\bawait\s/g) || []).length, 6); // five + original rejection-only text evaluate
  assert.equal(generated.includes('  const status = await page.evaluate(() => {'), true);
});

test("arbitrary, missing, duplicated and modified-operation donors are rejected", () => {
  const options = optionsFor(tmpdir());
  for (const bad of ["", donor + "\n", donor.replace("await sleep(500);", "await sleep(501);"), donor.replace(startAnchor, ""), donor + startAnchor]) {
    assert.throws(() => transformStartupProducer(bad, options), /donor identity/);
  }
});

test("actual extra await, browser API, Promise reaction and timer in insertion fail source admission", () => {
  const options = optionsFor(tmpdir()); const source = transformStartupProducer(donor, options);
  for (const forbidden of ['await Promise.resolve();', 'page.evaluate(() => null);', 'Promise.resolve().then(() => {});', 'setTimeout(() => {}, 1);']) {
    const mutated = source.replace('/* zk682-startup-phase:begin */\n', `/* zk682-startup-phase:begin */\n${forbidden}\n`);
    assert.equal(inverseStartupProducer(mutated), donor);
    assert.throws(() => validateStartupProducer(mutated, options), /insertion mismatch/);
  }
  assert.throws(() => inverseStartupProducer(source.replace("await sleep(500);", "await sleep(501);")), /inverse mismatch/);
});

test("absolute observer URL and exact ledger basename are mandatory", () => {
  assert.throws(() => transformStartupProducer(donor, { observerModuleUrl: "https://example.com/observer.mjs", ledgerPath: join(tmpdir(), LEDGER_BASENAME) }));
  assert.throws(() => transformStartupProducer(donor, { observerModuleUrl, ledgerPath: "relative.json" }));
  assert.throws(() => transformStartupProducer(donor, { observerModuleUrl, ledgerPath: join(tmpdir(), "wrong.json") }));
});

test("actual extracted immediate and delayed five-await paths match original outputs, calls and args", async () => {
  for (const delayed of [false, true]) {
    const baseline = await harness({ mode: "baseline", delayed });
    const disabled = await harness({ mode: "disabled", delayed });
    const enabled = await harness({ delayed });
    for (const result of [disabled, enabled]) {
      assert.deepEqual(result.calls, baseline.calls); assert.deepEqual(result.returned, baseline.returned);
      assert.equal(result.rejected, false); assert.equal(result.now, baseline.now);
      assert.equal(result.calls.filter((c) => c.operation === "timeout-text-evaluate").length, 0);
    }
    assert.equal(disabled.ledger, null);
    assert.equal(enabled.ledger.records.length, 12);
    assert.equal(enabled.ledger.observerInvalid, false);
    assert.equal(enabled.ledger.records.at(-1).offsetMs, 525);
    OPERATIONS.forEach((operation, index) => {
      const rows = enabled.ledger.records.filter((r) => r.operation === operation);
      assert.equal(rows.length, 2); assert.equal(rows[1].offsetMs - rows[0].offsetMs, [4, 500, 6, 7, 8][index]);
    });
  }
});

test("actual extracted rejection at each await preserves falsy/Error identity and exact original API order", async () => {
  for (let failed = 0; failed < 5; failed += 1) {
    for (const primary of [false, null, undefined, new Error("primary")]) {
      const baseline = await harness({ mode: "baseline", failed, primary, delayed: true });
      for (const mode of ["enabled", "disabled"]) {
        const result = await harness({ mode, failed, primary, delayed: true });
        assert.equal(result.rejected, true); assert.strictEqual(result.error, primary);
        assert.deepEqual(result.calls, baseline.calls);
        assert.equal(result.now, baseline.now);
        assert.equal(result.calls.filter((c) => c.operation === "timeout-text-evaluate").length, failed === 2 ? 1 : 0);
        if (mode === "enabled") {
          assert.equal(result.ledger.status, "rejected"); assert.equal(result.ledger.firstFailedOperation, OPERATIONS[failed]);
          assert.equal(result.ledger.records.length, 2 * failed + 4);
          assert.equal(result.ledger.observerInvalid, false);
        }
      }
    }
  }
});

test("original timeout text-evaluate secondary rejection replaces producer throw without replacing first observed phase failure", async () => {
  for (const secondary of [null, undefined, new Error("status failure")]) {
    const baseline = await harness({ mode: "baseline", failed: 2, primary: false, statusFailure: true, statusValue: secondary });
    const result = await harness({ failed: 2, primary: false, statusFailure: true, statusValue: secondary });
    assert.equal(result.rejected, true); assert.strictEqual(result.error, secondary);
    assert.deepEqual(result.calls, baseline.calls);
    assert.equal(result.ledger.firstFailedOperation, "canvas-visible");
    assert.equal(result.ledger.firstErrorKind, "boolean");
    assert.equal(result.ledger.records.filter((r) => r.kind === "error").length, 2);
    assert.equal(result.ledger.records.length, 8);
  }
});

test("observer clock and publication faults cannot alter actual extracted producer results/errors", async () => {
  const baseline = await harness({ mode: "baseline" });
  const fault = await harness({ faultClock: true });
  assert.deepEqual(fault.returned, baseline.returned); assert.deepEqual(fault.calls, baseline.calls);
  assert.equal(fault.ledger, null); // invalid clock prevents a complete observed sequence
  assert.equal(fault.snapshot.observerInvalid, true);
  const rejected = await harness({ failed: 4, primary: undefined, foreign: true });
  assert.equal(rejected.rejected, true); assert.strictEqual(rejected.error, undefined);
  assert.equal(rejected.foreignBytes, "foreign");
  const normal = await harness({ foreign: true }); assert.deepEqual(normal.returned, baseline.returned); assert.equal(normal.foreignBytes, "foreign");
});

test("later producer failures cannot rewrite normal frozen readiness ledger", async () => {
  const result = await harness();
  assert.equal(result.snapshot.status, "returned");
  assert.deepEqual(result.snapshot, result.ledger);
  // Exercise the actual generated outer handler after the phase already froze.
  const dir = mkdtempSync(join(tmpdir(), "zk682-startup-late-"));
  try {
    const options = optionsFor(dir); const generated = transformStartupProducer(donor, options);
    const marker = "/* zk682-startup-phase:begin */";
    const handler = generated.slice(generated.lastIndexOf(marker));
    const o = createStartupPhaseObserver({ clock: () => 100 }); o.start(100);
    OPERATIONS.forEach((operation) => { o.enter(operation); o.returned(operation); }); o.finish(0); o.publish(options.ledgerPath);
    const before = readFileSync(options.ledgerPath, "utf8"); const primary = null;
    const run = new Function("__zk682Phase", "primary", "try { throw primary;\n" + handler);
    assert.throws(() => run(o, primary), (value) => value === primary);
    assert.equal(readFileSync(options.ledgerPath, "utf8"), before);
    assert.equal(o.freeze().firstFailedOperation, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("original finite budgets and readiness/renderer gates remain operational and byte exact", async () => {
  const budgetModule = new URL("./perf-readiness-budget.mjs", pathToFileURL(donorPath));
  const { readinessBudgetValidation, rendererBudgetValidation } = await import(budgetModule.href);
  const result = await harness({ duration: [4, 6500, 6, 7, 8] });
  assert.equal(result.ledger.observerInvalid, false);
  const readiness = readinessBudgetValidation({ coldStartupMs: 5001, fixtureLoadMs: result.returned.fixtureLoadMs, startupBudgetMs: 5000, fixtureBudgetMs: 6000 });
  assert.equal(readiness.passed, false);
  const renderer = rendererBudgetValidation({ workMs: 9, p95Ms: 20, workBudgetMs: 8, frameBudgetMs: 33, assertFrame: false });
  assert.equal(renderer.passed, false);
  const generated = transformStartupProducer(donor, optionsFor(tmpdir()));
  const afterPhase = donor.slice(donor.indexOf(endAnchor) + endAnchor.length);
  assert.equal(inverseStartupProducer(generated).endsWith(afterPhase), true);
});
