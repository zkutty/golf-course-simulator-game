// ROOT-only controls. No application imports or browser/server/Git/network calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
const OLD_SHA = "6cda11062c9344a23a604d4d324ef01d462cb4be31db463e3e41beb89852e701";
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(["--producer", "--producer-sha", "--helper", "--helper-sha", "--old-producer", "--mode"].includes(key));
  assert(!args.has(key) && typeof value === "string"); args.set(key, value);
}
const mode = args.get("--mode") ?? "verify";
assert(["verify", "old-producer-red"].includes(mode));
function pinned(path, sha, expectedBytes) {
  assert.equal(typeof path, "string");
  if (sha !== undefined) { assert.equal(typeof sha, "string"); assert.match(sha, /^[0-9a-f]{64}$/); }
  const bytes = readFileSync(path);
  assert(bytes.length <= 65536);
  if (expectedBytes !== undefined) assert.equal(bytes.length, expectedBytes);
  if (sha !== undefined) assert.equal(createHash("sha256").update(bytes).digest("hex"), sha);
  return bytes.toString("utf8");
}
const producerPath = args.get("--producer") ?? fileURLToPath(new URL("./perf-smoke.mjs", import.meta.url));
const helperPath = args.get("--helper") ?? fileURLToPath(new URL("./startup-wait-stages.mjs", import.meta.url));
const source = pinned(producerPath, args.get("--producer-sha"));
const old = args.has("--old-producer") ? pinned(args.get("--old-producer"), OLD_SHA, 13442) : null;
pinned(helperPath, args.get("--helper-sha"));
const { createStartupWaitStages, STARTUP_WAIT_STAGES } = await import(pathToFileURL(helperPath).href);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function unique(text, literal) {
  const at = text.indexOf(literal);
  assert(at >= 0 && text.indexOf(literal, at + literal.length) < 0, "unique actual source anchor");
  return at;
}
function awaitBlock(text) {
  const anchor = "const coldStartupMs = performance.now() - coldStartedAt;\n";
  const first = unique(text, anchor) + anchor.length;
  const last = unique(text, "console.log(" + String.fromCharCode(96) + "[perf-smoke] game state ready in ");
  assert(first < last);
  return text.slice(first, last);
}
function compileBlock(text) {
  return new AsyncFunction("page", "sleep", "performance", "console", "PERF_FIXTURE", "PERF_THEME",
    "FIXTURE_READY_TIMEOUT_MS", "PORT", "createStartupWaitStages", "document", "window",
    awaitBlock(text) + "\nreturn { fixtureStartedAt, fixtureLoadMs, box," +
    " fixtureEndedAt: typeof fixtureEndedAt === 'undefined' ? null : fixtureEndedAt," +
    " startupWaitStages: typeof startupWaitStages === 'undefined' ? null : startupWaitStages };");
}
const runCurrent = compileBlock(source), runOld = old === null ? null : compileBlock(old);
if (mode === "old-producer-red") assert(runOld !== null, "ROOT must explicitly pass the frozen old producer");
function rig(options = {}) {
  const durations = options.durations ?? [1001, 500, 3002, 11, 37];
  const trace = [], recorders = [];
  let t = 0, readyCount = 0, messageReads = 0;
  const performance = { now() { const at = t; t += options.clockOverhead ?? 0; return at; } };
  const hostile = Object.defineProperty({}, "message", { get() { messageReads++; throw new Error("message getter invoked"); } });
  const reason = Object.hasOwn(options, "reason") ? options.reason : hostile;
  async function transition(code) {
    trace.push(code); t += durations[code - 1];
    if (options.rejectAt === code) throw reason;
  }
  let target = null;
  const document = { querySelector(selector) { assert.equal(selector, ".cc-pixi-stage canvas"); return target; } };
  const window = { __ccStartupAttribution: { markReady() { readyCount++; } } };
  const canvas = {
    async waitFor(actual) { assert.deepEqual(actual, { state: "visible", timeout: 120000 }); await transition(3); },
    async boundingBox() { await transition(5); return { x: 10, y: 20, width: 100, height: 100 }; },
  };
  const page = {
    async goto(url, actual) {
      assert.equal(url, "http://127.0.0.1:5199/?m27Fixture=1&perfTheme=parkland&perfMeasure=1");
      assert.deepEqual(actual, { waitUntil: "domcontentloaded", timeout: 30000 });
      await transition(1);
    },
    locator(selector) { assert.equal(selector, ".cc-pixi-stage canvas"); t += options.locatorGap ?? 0; return canvas; },
    async waitForFunction(predicate, parameter, actual) {
      assert.equal(parameter, null); assert.deepEqual(actual, { timeout: 120000 });
      trace.push(4);
      if (options.rejectAt === 4) { t += durations[3]; throw reason; }
      const candidates = [null,
        { width: 0, clientWidth: 0, height: 100, clientHeight: 100 },
        { width: 100, clientWidth: 100, height: 0, clientHeight: 0 },
        { width: 100, clientWidth: 100, height: 100, clientHeight: 100 }];
      for (let i = 0; i < candidates.length; i++) {
        target = candidates[i];
        const value = predicate();
        if (i < 3) { assert(!value); assert.equal(readyCount, 0); }
        else assert.equal(value, true);
      }
      t += durations[3]; assert.equal(readyCount, 1);
    },
    async evaluate(callback) {
      assert.equal(typeof callback, "function"); trace.push("existing-visible-catch-evaluate");
      if (Object.hasOwn(options, "evaluateReason")) throw options.evaluateReason;
      return { screen: null, course: null, theme: null, holesOpen: null, canvasCount: 0, bodyText: "" };
    },
  };
  const sleep = async (ms) => { assert.equal(ms, 500); await transition(2); };
  const console = {
    log() { t += options.logGap ?? 0; },
    error() {},
  };
  let diagnosticReads = 0;
  const factory = (actual) => {
    assert.equal(actual.sourceUnit, "ZK-1331_SOURCE1"); assert.equal(actual.invocation, 1);
    const injected = { ...actual };
    if (options.diagnosticThrows) injected.now = () => { throw hostile; };
    if (options.diagnosticTimes) injected.now = () => options.diagnosticTimes[diagnosticReads++];
    if (options.serializationThrows) injected.measureBytes = () => { throw hostile; };
    if (options.serializationBytes !== undefined) injected.measureBytes = () => options.serializationBytes;
    const recorder = createStartupWaitStages(injected); recorders.push(recorder); return recorder;
  };
  return {
    args: [page, sleep, performance, console, "m27Fixture", "parkland", 120000, 5199, factory, document, window],
    trace, recorders, reason,
    get time() { return t; }, get readyCount() { return readyCount; }, get messageReads() { return messageReads; },
  };
}
function requireDiagnostic(result) {
  const report = result.startupWaitStages;
  assert(report && report.version === 1, "actual producer must emit stage evidence");
  assert.equal(report.domain, "node.performance.now");
  assert.equal(report.status, "COMPLETE"); assert.equal(report.eligible, true);
  assert.deepEqual(report.rows.map((row) => row.code), [1, 2, 3, 4, 5]);
  assert.deepEqual(report.rows.map((row) => row.name), STARTUP_WAIT_STAGES.map((row) => row.name));
  assert(report.rows.every((row) => row.outcome === "success"));
  assert.equal(report.canonical.start, result.fixtureStartedAt);
  assert.equal(report.canonical.end, result.fixtureEndedAt);
  assert.equal(report.canonical.duration, result.fixtureLoadMs);
  assert.equal(report.numericPass, false); assert.equal(report.trusted, false); assert.equal(report.releaseCleared, false);
  assert.equal(report.navigation.candidateQualified, false);
  assert.equal(report.navigation.browserDocumentIdentity, false);
  assert(Buffer.byteLength(JSON.stringify(report)) <= 8192);
  return report;
}
function held(report) {
  assert.equal(report.status, "HOLD"); assert.equal(report.eligible, false);
  assert(report.rows.length <= 5); assert(Buffer.byteLength(JSON.stringify(report)) <= 8192);
  assert.equal(report.numericPass, false); assert.equal(report.trusted, false);
}
if (mode === "old-producer-red") {
  const controls = rig(); const result = await runOld(...controls.args);
  assert.deepEqual(controls.trace, [1, 2, 3, 4, 5]); assert.equal(result.fixtureLoadMs, 4551);
  console.log("OLD_REAL_PRODUCER_EXECUTED canonical4551 five-original-awaits; requiring current evidence next");
  requireDiagnostic(result); // Must actually exit nonzero: the pinned old producer has no rows.
  assert.fail("old real producer was unexpectedly accepted");
}
const passed = [];
async function group(name, body) { await body(); passed.push(name); console.log("PASS " + name); }
await group("01_actual_current_block_canonical_and_old_original_RED", async () => {
  const controls = rig(), result = await runCurrent(...controls.args), report = requireDiagnostic(result);
  assert.deepEqual(controls.trace, [1, 2, 3, 4, 5]); assert.equal(controls.readyCount, 1);
  assert.equal(result.fixtureStartedAt, 0); assert.equal(result.fixtureEndedAt, 4551);
  assert.equal(result.fixtureLoadMs, 4551);
  assert.deepEqual(report.rows.map((row) => row.end - row.start), [1001, 500, 3002, 11, 37]);
  assert.equal(report.navigation.invocation, 1);
  assert.equal(report.navigation.fixtureURL, "http://127.0.0.1:5199/?m27Fixture=1&perfTheme=parkland&perfMeasure=1");
  if (runOld !== null) {
    const prior = rig(), original = await runOld(...prior.args);
    assert.equal(original.fixtureLoadMs, 4551); assert.deepEqual(prior.trace, [1, 2, 3, 4, 5]);
    assert.throws(() => requireDiagnostic(original), assert.AssertionError);
  }
});
await group("02_independent_slowstages_and_nonzero_observation_gaps", async () => {
  for (const slow of [0, 2, 3, 4]) {
    const durations = [2, 500, 2, 2, 2]; durations[slow] = 4000;
    const controls = rig({ durations }), result = await runCurrent(...controls.args), report = requireDiagnostic(result);
    assert.deepEqual(controls.trace, [1, 2, 3, 4, 5]);
    const actual = report.rows.map((row) => row.end - row.start);
    assert.deepEqual(actual, durations);
    assert.deepEqual(actual.map((value, index) => value >= 1000 ? index : null).filter((value) => value !== null), [slow]);
  }
  const controls = rig({ clockOverhead: 3, logGap: 17, locatorGap: 11 });
  const result = await runCurrent(...controls.args), report = requireDiagnostic(result);
  const spanSum = report.rows.reduce((sum, row) => sum + row.end - row.start, 0);
  assert(result.fixtureLoadMs > spanSum); assert(result.fixtureLoadMs > 4551);
  assert(!Object.hasOwn(report, "causalMs") && !Object.hasOwn(report, "removableMs") && !Object.hasOwn(report, "stageSumEqualsFixture"));
});
await group("03_actual_falsy_rejections_and_diagnostic_hostile_errors", async () => {
  for (const rejectAt of [1, 2, 3, 4, 5]) for (const reason of [null, false, 0, undefined]) {
    const controls = rig({ rejectAt, reason, diagnosticThrows: true });
    let caught = false, actual;
    try { await runCurrent(...controls.args); } catch (cause) { caught = true; actual = cause; }
    assert.equal(caught, true); assert.strictEqual(actual, reason);
    assert.equal(controls.messageReads, 0);
    const report = controls.recorders[0].finish(0, controls.time, controls.time);
    held(report); assert.equal(report.rows.at(-1).code, rejectAt); assert.equal(report.rows.at(-1).outcome, "rejected");
    if (rejectAt === 3) assert(controls.trace.includes("existing-visible-catch-evaluate"));
  }
  const controls = rig({ diagnosticThrows: true }), result = await runCurrent(...controls.args);
  assert.equal(result.fixtureLoadMs, 4551); held(result.startupWaitStages); assert.equal(controls.messageReads, 0);
  for (const options of [{ serializationThrows: true }, { serializationBytes: 8193 }, { serializationBytes: Infinity }]) {
    const diagnostics = rig(options), observed = await runCurrent(...diagnostics.args);
    assert.equal(observed.fixtureLoadMs, 4551); held(observed.startupWaitStages);
    assert.equal(observed.startupWaitStages.rows.length, 5); assert.equal(diagnostics.messageReads, 0);
  }
  const prior = rig({ rejectAt: 3, reason: false, evaluateReason: 0 });
  const current = rig({ rejectAt: 3, reason: false, evaluateReason: 0 });
  for (const [runner, controls] of (runOld === null ? [[runCurrent, current]] : [[runOld, prior], [runCurrent, current]])) {
    let caught = false, actual; try { await runner(...controls.args); } catch (cause) { caught = true; actual = cause; }
    assert(caught); assert.strictEqual(actual, 0); // Preserve the original protected visibility catch behavior.
  }
});
await group("04_clock_order_caps_identity_and_pending_refusals", async () => {
  for (const times of [
    [0, 1001, 1001, 1501, 1501, 4503, 4503, 4514, 4514],
    [0, -1, 1001, 1501, 1501, 4503, 4503, 4514, 4514],
    [0, NaN, 1001, 1501, 1501, 4503, 4503, 4514, 4514],
    [0, Infinity, 1001, 1501, 1501, 4503, 4503, 4514, 4514],
    [0, 1001, 1000, 1501, 1501, 4503, 4503, 4514, 4514],
  ]) {
    const controls = rig({ diagnosticTimes: times }), result = await runCurrent(...controls.args);
    assert.equal(result.fixtureLoadMs, 4551);
    if (times[1] === 1001 && times[2] === 1001) requireDiagnostic(result); else held(result.startupWaitStages);
  }
  function direct(extra = {}) {
    return createStartupWaitStages({ now: () => 0, fixtureURL: "http://fixture/", ...extra });
  }
  for (const extra of [{ invocation: 0 }, { fixtureURL: "x".repeat(1025) }, { sourceUnit: false }]) {
    const recorder = direct(extra);
    for (const code of [1, 2, 3, 4, 5]) { const token = recorder.begin(code); recorder.end(token, "success"); }
    held(recorder.finish(0, 0, 0));
  }
  const order = direct(); assert.equal(order.begin(2), null);
  for (const code of [1, 2, 3, 4, 5]) { const token = order.begin(code); order.end(token, "success"); }
  held(order.finish(0, 0, 0));
  const excess = direct();
  for (const code of [1, 2, 3, 4, 5]) { const token = excess.begin(code); excess.end(token, "success"); }
  assert.equal(excess.begin(6), null); const capped = excess.finish(0, 0, 0); held(capped); assert.equal(capped.rows.length, 5);
  const pending = direct(); pending.begin(1); const incomplete = pending.finish(0, 0, 0); held(incomplete);
  assert.equal(incomplete.rows[0].outcome, "pending");
  const token = direct(), real = token.begin(1); token.end({}, "success"); token.end(real, "success");
  held(token.finish(0, 0, 0));
  assert(Object.isFrozen(STARTUP_WAIT_STAGES)); assert(STARTUP_WAIT_STAGES.every(Object.isFrozen));
});
function gateBlock(text) {
  return text.slice(unique(text, "const readiness = readinessBudgetValidation("),
    unique(text, "const evidence = {"));
}
const runGate = new AsyncFunction("coldStartupMs", "fixtureLoadMs", "perf", "STARTUP_BUDGET_MS", "FIXTURE_LOAD_BUDGET_MS",
  "WORK_BUDGET_MS", "BUDGET_MS", "ASSERT_FRAME", "readinessBudgetValidation", "rendererBudgetValidation", "console",
  gateBlock(source) + "\nreturn { failed, gateValidation };");
const readiness = ({ coldStartupMs, fixtureLoadMs, startupBudgetMs, fixtureBudgetMs }) => ({
  coldStartupWithinBudget: coldStartupMs <= startupBudgetMs,
  fixtureLoadWithinBudget: fixtureLoadMs <= fixtureBudgetMs,
  passed: coldStartupMs <= startupBudgetMs && fixtureLoadMs <= fixtureBudgetMs,
});
const renderer = () => ({ passed: true, rendererWorkWithinBudget: true, frameWithinBudget: null });
await group("05_original_gate_failure_despite_complete_wait_evidence", async () => {
  if (old !== null) assert.equal(gateBlock(source), gateBlock(old));
  const controls = rig({ durations: [1, 500, 9000, 1, 1] }), result = await runCurrent(...controls.args);
  requireDiagnostic(result); assert(result.fixtureLoadMs > 6000);
  const actual = await runGate(662, result.fixtureLoadMs, { workMs: 0.82, p95Ms: 100 },
    5000, 6000, 8, 33, false, readiness, renderer, { error() {} });
  assert.equal(actual.failed, true); assert.equal(actual.gateValidation.fixtureLoadWithinBudget, false);
  assert.equal(actual.gateValidation.passed, false);
  if (old !== null) assert.equal(source.slice(unique(source, "if (failed) process.exit(1);")), old.slice(unique(old, "if (failed) process.exit(1);")));
});
function publicationBlock(text) {
  const first = unique(text, 'mkdirSync(typeof OUTPUT_PATH === "string"');
  const after = text.indexOf('\nif (PERF_FIXTURE === "m27Fixture") {', first);
  assert(after > first); return text.slice(first, after);
}
const publish = new AsyncFunction("OUTPUT_PATH", "dirname", "mkdirSync", "writeFileSync", "evidence", publicationBlock(source));
await group("06_additive_existing_report_and_unchanged_publication_failures", async () => {
  if (old !== null) assert.equal(publicationBlock(source), publicationBlock(old));
  const added = "  fixtureLoadMs: Math.round(fixtureLoadMs),\n  startupWaitStages,\n  renderer: perf,";
  assert(source.includes(added)); if (old !== null) assert(!old.includes(added));
  let serialized;
  const controls = rig(), result = await runCurrent(...controls.args);
  const evidence = { fixtureLoadMs: Math.round(result.fixtureLoadMs), startupWaitStages: result.startupWaitStages };
  await publish("/RAM/performance.json", () => "/RAM", () => {}, (path, text) => {
    assert.equal(path, "/RAM/performance.json"); serialized = JSON.parse(text);
  }, evidence);
  assert.equal(serialized.fixtureLoadMs, 4551); assert.equal(serialized.startupWaitStages.rows.length, 5);
  for (const operation of ["mkdir", "write"]) for (const reason of [null, false, 0, undefined]) {
    let caught = false, actual;
    try {
      await publish("/RAM/performance.json", () => "/RAM",
        () => { if (operation === "mkdir") throw reason; },
        () => { if (operation === "write") throw reason; }, evidence);
    } catch (cause) { caught = true; actual = cause; }
    assert(caught); assert.strictEqual(actual, reason);
  }
});
console.log(JSON.stringify({ passed, actualSourceExtracted: true, originalOldProducerRedAsserted: old !== null,
  oldCounterfactualSupplied: old !== null, browserCalls: 0, applicationImports: 0, runtimeGranted: false, numericPass: false, trusted: false }));
