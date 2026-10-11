// ROOT-only selective RAM controls. No browser, SDK hooks, sockets, timers or file writes.
// Actual serialized bootstrap and actual original/candidate dimensions bodies are executed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
const defaults = {
  helper: "../src/utils/startupRenderObservation.mjs",
  perf: "./perf-smoke.mjs", gate: "./perf-readiness-budget.mjs",
};
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === "--counterfactual-old") options.counterfactualOld = true;
  else {
    assert.ok(["--helper", "--perf", "--gate", "--old-perf"].includes(flag), "unknown source option");
    assert.ok(process.argv[i + 1], "source path required");
    options[flag.slice(2)] = process.argv[++i];
  }
}
const source = Object.fromEntries(Object.entries(defaults).map(([key, relative]) =>
  [key, readFileSync(options[key] ?? fileURLToPath(new URL(relative, import.meta.url)), "utf8")]));
const sha = value => createHash("sha256").update(value).digest("hex");
const originalPerfPin = "9a0086ef355de629ba6c32faf2e3c1c3a560ba0ae34067cbe39314ca1d36cd0c";
assert.equal(sha(source.gate), "7a43de0555c13182a368996d8a26a7edfbb770b2c6e49e36e843b93d83e377b3", "actual original gate");
const unique = (text, anchor) => {
  assert.equal(text.split(anchor).length - 1, 1, "unique source anchor: " + anchor);
  return text.indexOf(anchor);
};
const callbackOpen = "  await page.waitForFunction(() => {\n";
const callbackClose = "  }, null, { timeout: FIXTURE_READY_TIMEOUT_MS });";
function callbackBody(text) {
  const a = unique(text, callbackOpen) + callbackOpen.length;
  const b = text.indexOf(callbackClose, a); assert.ok(b > a, "callback end");
  return text.slice(a, b);
}
const candidateBody = callbackBody(source.perf);
const innerOpen = "    const evaluateDimensions = () => {\n";
const innerClose = "    };\n    let dimensionsReturned";
const innerStart = unique(candidateBody, innerOpen) + innerOpen.length;
const innerEnd = candidateBody.indexOf(innerClose, innerStart); assert.ok(innerEnd > innerStart);
const originalBody = candidateBody.slice(innerStart, innerEnd);
const restored = source.perf.replace(candidateBody, originalBody);
assert.equal(sha(restored), originalPerfPin, "whole perf body inverse including all five waits/gates/endpoints");
let oldPerf = restored;
if (options["old-perf"]) {
  oldPerf = readFileSync(options["old-perf"], "utf8");
  assert.equal(sha(oldPerf), originalPerfPin, "actual frozen old perf");
  assert.equal(callbackBody(oldPerf), originalBody, "original literal body byte exact");
}
const bootstrapStart = unique(source.helper, "export function bootstrapStartupRenderObservation() {");
const bootstrapEnd = unique(source.helper, "\nexport function observeStartupRenderer");
const bootstrap = source.helper.slice(bootstrapStart, bootstrapEnd).replace(/^export /, "");
const initStart = unique(source.perf, "await page.addInitScript(");
const initEnd = unique(source.perf, "\nconst coldStartedAt");
const init = source.perf.slice(initStart, initEnd);
assert.equal(init, "await page.addInitScript(bootstrapStartupRenderObservation);");
const execute = (code, context) => new Script(code).runInContext(context);
const plain = value => JSON.parse(JSON.stringify(value));
async function environment(body, changes = {}) {
  const state = { now: 1, clockCalls: 0, queryCalls: 0, marks: 0, initCalls: 0,
    targetKind: "object", width: 2, clientWidth: 3, height: 4, clientHeight: 5,
    log: [], clockThrowPresent: false, clockThrown: undefined, markThrowPresent: false,
    markThrown: undefined, accessThrowPresent: false, accessThrown: undefined,
    accessThrowAt: "", queryThrowPresent: false, queryThrown: undefined,
    queryWorkMs: 0, reentered: false, queryReentry: false, markReentry: false,
    snapshotInBody: false, publicationFault: false, storage: [], disconnects: 0, observerRows: [] };
  Object.assign(state, changes);
  const ctx = createContext({ state, URLSearchParams, TextEncoder, console: { log() {}, error() {} } });
  execute(`
    window = {};
    if (state.publicationFault) Object.defineProperty(window, "__ccStartupRenderObservation", {
      get() { throw state.diagnosticThrown; }, set() { throw state.diagnosticThrown; }
    });
    location = { search: "?m27Fixture=1&perfMeasure=1" };
    localStorage = { setItem(key, value) { state.storage.push([key, value]); } };
    performance = { timeOrigin: 100, now() {
      state.clockCalls++;
      if (state.clockThrowPresent) throw state.clockThrown;
      if (state.clockValuePresent) return state.clockValue;
      return state.now++;
    }};
    PerformanceObserver = class {
      static supportedEntryTypes = ["longtask"];
      constructor(callback) { if (state.observerCtorFault) throw state.diagnosticThrown; this.callback = callback; }
      observe() { if (state.observerObserveFault) throw state.diagnosticThrown; }
      takeRecords() { if (state.observerTakeFault) throw state.diagnosticThrown; return state.observerRows; }
      disconnect() { state.disconnects++; if (state.observerDisconnectFault) throw state.diagnosticThrown; }
    };
    const target = {};
    for (const key of ["width", "clientWidth", "height", "clientHeight"]) {
      Object.defineProperty(target, key, { get() {
        state.log.push(key);
        if (state.accessThrowPresent && state.accessThrowAt === key) throw state.accessThrown;
        return state[key];
      }});
    }
    document = { querySelector(selector) {
      state.queryCalls++; state.log.push(selector); state.now += state.queryWorkMs;
      if (state.queryThrowPresent) throw state.queryThrown;
      if (state.queryReentry && !state.reentered) { state.reentered = true; state.nested = callback(); }
      if (state.snapshotInBody) state.insideSnapshot = window.__ccStartupRenderObservation.snapshot();
      if (state.targetKind === "null") return null;
      if (state.targetKind === "false") return false;
      if (state.targetKind === "zero") return 0;
      return target;
    }};
    window.__ccStartupAttribution = { markReady() {
      state.marks++; state.log.push("markReady");
      if (state.markReentry && !state.reentered) { state.reentered = true; state.nested = callback(); }
      if (state.markThrowPresent) throw state.markThrown;
    }};
  `, ctx);
  execute(bootstrap, ctx);
  ctx.page = { addInitScript(fn) {
    state.initCalls++; state.serializedBootstrap = fn.toString();
    return execute("(" + state.serializedBootstrap + ")()", ctx);
  }};
  await execute("(async () => { " + init + " })()", ctx);
  assert.equal(state.initCalls, 1, "actual existing init call once");
  execute("callback = () => {\n" + body + "\n};", ctx);
  return { state, ctx, invoke() {
    try { return { threw: false, value: execute("callback()", ctx) }; }
    catch (value) { return { threw: true, value }; }
  }, seedRenderer() {
    execute(`
      const rendererPort = { render() { return "rendered"; } };
      const tickerPort = { _tick() { return this.update(); }, update() { return rendererPort.render(); } };
      window.__ccStartupRenderObservation.install(rendererPort, tickerPort);
      window.__ccStartupRenderObservation.activate(rendererPort, tickerPort);
      tickerPort._tick();
    `, ctx);
  }, snapshot() { return execute("window.__ccStartupRenderObservation.snapshot()", ctx); } };
}
function sameResult(a, b) { assert.equal(a.threw, b.threw); assert.strictEqual(a.value, b.value); }
function predicate(snapshot) {
  const d = snapshot.dimensionsPredicate;
  assert.ok(d, "dimensions snapshot delivered by existing object");
  assert.equal(d.status, "HOLD"); assert.equal(d.eligible, false);
  assert.equal(d.documentIdentity, "UNKNOWN"); assert.equal(d.candidateQualified, false); assert.equal(d.trusted, false);
  assert.ok(d.rows.length <= 16);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 8192, "real aggregate byte cap");
  return d;
}
const reports = [];
async function group(name, run) { await run(); reports.push(name); console.log(JSON.stringify({ group: name, state: "PASS" })); }
if (options.counterfactualOld) {
  assert.ok(options["old-perf"], "counterfactual requires explicit frozen old perf");
  const e = await environment(callbackBody(oldPerf));
  const result = e.invoke();
  assert.equal(result.threw, false); assert.equal(result.value, true);
  assert.equal(e.state.queryCalls, 1); assert.equal(e.state.marks, 1);
  console.log(JSON.stringify({ control: "actual-old-initialize-and-predicate", initCalls: e.state.initCalls,
    queryCalls: e.state.queryCalls, marks: e.state.marks, result: result.value }));
  const d = predicate(e.snapshot());
  assert.equal(d.rows.length, 1, "actual old producer executed but lacks required predicate observation");
} else {
  await group("01_original_raw_readiness_and_getter_order", async () => {
    const cases = [
      [{ targetKind: "null" }, null, [".cc-pixi-stage canvas"]],
      [{ targetKind: "false" }, false, [".cc-pixi-stage canvas"]],
      [{ targetKind: "zero" }, 0, [".cc-pixi-stage canvas"]],
      [{ width: 0, clientWidth: 0 }, false, [".cc-pixi-stage canvas", "width", "clientWidth"]],
      [{ width: 0, clientWidth: 2, height: 0, clientHeight: 0 }, false,
        [".cc-pixi-stage canvas", "width", "clientWidth", "height", "clientHeight"]],
      [{ width: 2, height: 0, clientHeight: 4 }, true,
        [".cc-pixi-stage canvas", "width", "height", "clientHeight", "markReady"]],
      [{}, true, [".cc-pixi-stage canvas", "width", "height", "markReady"]],
    ];
    for (const [model, expected, log] of cases) {
      const original = await environment(originalBody, model), current = await environment(candidateBody, model);
      const a = original.invoke(), b = current.invoke(); sameResult(a, b);
      assert.strictEqual(b.value, expected); assert.equal(current.state.queryCalls, 1);
      assert.deepEqual(current.state.log, log); assert.deepEqual(current.state.log, original.state.log);
      assert.equal(current.state.marks, expected ? 1 : 0);
      const d = predicate(current.snapshot()); assert.equal(d.rows.length, 1);
      assert.equal(d.rows[0].outcome, "returned"); assert.strictEqual(d.rows[0].ready, !!expected);
      assert.equal(d.observationComplete, !!expected);
      assert.ok(Object.isFrozen(d) && Object.isFrozen(d.rows) && Object.isFrozen(d.rows[0]));
    }
  });
  await group("02_first_falsy_original_throw_survives_finally", async () => {
    const hostile = { toString() { throw "forbidden error inspection"; }, valueOf() { throw null; } };
    for (const thrown of [null, false, undefined, 0, hostile]) {
      for (const port of ["query", "width", "clientWidth", "height", "clientHeight", "mark"]) {
        const changes = port === "query" ? { queryThrowPresent: true, queryThrown: thrown }
          : port === "mark" ? { markThrowPresent: true, markThrown: thrown }
          : { accessThrowPresent: true, accessThrown: thrown, accessThrowAt: port,
              ...(port === "clientWidth" ? { width: 0 } : {}),
              ...(port === "clientHeight" ? { height: 0 } : {}) };
        const original = await environment(originalBody, changes), current = await environment(candidateBody, changes);
        const a = original.invoke(), b = current.invoke(); sameResult(a, b);
        assert.equal(b.threw, true); assert.strictEqual(b.value, thrown);
        assert.deepEqual(current.state.log, original.state.log);
        const d = predicate(current.snapshot());
        assert.equal(d.rows[0].outcome, "threw"); assert.equal(d.rows[0].ready, null);
        assert.equal(d.failure, "PREDICATE_THROW");
      }
    }
  });
  await group("03_optional_port_clock_observer_fault_fidelity", async () => {
    for (const thrown of [null, false, undefined, 0]) {
      for (const setup of [
        "delete window.__ccStartupRenderObservation;",
        "window.__ccStartupRenderObservation = new Proxy({}, { getOwnPropertyDescriptor() { throw state.diagnosticThrown; } });",
        "window.__ccStartupRenderObservation = null;",
        "Object.defineProperty(window, '__ccStartupRenderObservation', { configurable: true, get() { state.portGetterCalls = (state.portGetterCalls || 0) + 1; throw state.diagnosticThrown; } });",
        "window.__ccStartupRenderObservation = { get beginDimensions() { throw state.diagnosticThrown; }, endDimensions() { throw state.diagnosticThrown; } };",
        "window.__ccStartupRenderObservation = { beginDimensions() { throw state.diagnosticThrown; }, endDimensions() { throw state.diagnosticThrown; } };",
        "window.__ccStartupRenderObservation = { beginDimensions() { return {}; }, endDimensions() { throw state.diagnosticThrown; } };",
      ]) {
        for (const originalThrows of [false, true]) {
          const e = await environment(candidateBody, { diagnosticThrown: thrown,
            markThrowPresent: originalThrows, markThrown: thrown });
          execute(setup, e.ctx); const result = e.invoke();
          assert.equal(result.threw, originalThrows); assert.strictEqual(result.value, originalThrows ? thrown : true);
          assert.equal(e.state.queryCalls, 1); assert.equal(e.state.marks, 1);
          assert.equal(e.state.portGetterCalls ?? 0, 0, "diagnostics do not invoke collector accessors");
        }
      }
      for (const fault of ["observerCtorFault", "observerObserveFault", "observerTakeFault", "observerDisconnectFault"]) {
        for (const realThrows of [false, true]) {
          const observed = await environment(candidateBody, { [fault]: true, diagnosticThrown: thrown,
            markThrowPresent: realThrows, markThrown: thrown });
          const observedResult = observed.invoke();
          assert.equal(observedResult.threw, realThrows); assert.strictEqual(observedResult.value, realThrows ? thrown : true);
          assert.equal(observed.state.queryCalls, 1); assert.equal(observed.state.marks, 1);
          const observedDimensions = predicate(observed.snapshot());
          assert.equal(observedDimensions.rows.length, 1);
          assert.equal(observedDimensions.failure, realThrows ? "PREDICATE_THROW" : "DOCUMENT_IDENTITY_UNKNOWN");
        }
      }
      const unpublished = await environment(candidateBody, { publicationFault: true, diagnosticThrown: thrown,
        markThrowPresent: true, markThrown: thrown });
      const unpublishedResult = unpublished.invoke();
      assert.equal(unpublishedResult.threw, true); assert.strictEqual(unpublishedResult.value, thrown);
      assert.equal(unpublished.state.queryCalls, 1); assert.equal(unpublished.state.marks, 1);
      for (const clockModel of [
        { clockThrowPresent: true, clockThrown: thrown },
        { clockValuePresent: true, clockValue: NaN },
        { clockValuePresent: true, clockValue: -1 },
        { clockValuePresent: true, clockValue: 0 },
      ]) {
        const e = await environment(candidateBody);
        Object.assign(e.state, clockModel);
        const result = e.invoke(); assert.equal(result.threw, false); assert.equal(result.value, true);
        assert.equal(e.state.queryCalls, 1); assert.equal(e.state.marks, 1);
        const d = predicate(e.snapshot()); assert.equal(d.failure, "CLOCK");
        assert.equal(d.observationComplete, false);
      }
    }
  });
  await group("04_reentry_pending_late_and_existing_freeze", async () => {
    for (const model of [{ queryReentry: true }, { markReentry: true }]) {
      const original = await environment(originalBody, model), current = await environment(candidateBody, model);
      sameResult(original.invoke(), current.invoke());
      assert.deepEqual(current.state.log, original.state.log);
      assert.equal(current.state.queryCalls, 2); assert.equal(current.state.marks, 2);
      const d = predicate(current.snapshot()); assert.equal(d.rows.length, 2);
      assert.equal(d.reentry, true); assert.equal(d.failure, "REENTRY"); assert.equal(d.pending, 0);
      for (const row of d.rows) assert.equal(row.outcome, "returned");
    }
    const e = await environment(candidateBody, { snapshotInBody: true });
    const result = e.invoke(); assert.equal(result.threw, false); assert.equal(result.value, true);
    const frozen = e.state.insideSnapshot, d = predicate(frozen);
    assert.equal(d.failure, "PENDING"); assert.equal(d.pending, 1); assert.equal(d.rows[0].outcome, "pending");
    e.state.snapshotInBody = false;
    assert.equal(e.invoke().value, true);
    assert.strictEqual(e.snapshot(), frozen, "closed snapshot never gains post-freeze rows or qualification");
    const late = await environment(candidateBody);
    assert.equal(late.invoke().value, true); assert.equal(late.invoke().value, true);
    assert.equal(predicate(late.snapshot()).failure, "AFTER_READY");
  });
  await group("05_first16_row_and_aggregate8192_caps", async () => {
    for (const count of [16, 17]) {
      const e = await environment(candidateBody, { width: 0, clientWidth: 0 });
      for (let i = 0; i < count; i++) assert.equal(e.invoke().value, false);
      const snapshot = e.snapshot(), d = predicate(snapshot);
      assert.equal(d.rows.length, 16); assert.equal(d.calls, count); assert.equal(d.pending, 0);
      assert.equal(e.state.queryCalls, count); assert.equal(e.state.marks, 0);
      assert.equal(d.failure, count === 17 ? "ROW_CAP" : "NOT_READY");
      assert.equal(snapshot.capture.truncated, count === 17);
      for (const row of d.rows) {
        assert.equal(row.outcome, "returned"); assert.equal(row.ready, false);
        assert.ok(Number.isFinite(row.start) && Number.isFinite(row.end) && row.end >= row.start);
        assert.equal(row.duration, row.end - row.start);
      }
    }
    for (const size of [8192, 8193]) {
      const e = await environment(candidateBody); assert.equal(e.invoke().value, true); e.seedRenderer();
      execute("TextEncoder = class { encode(text) { state.serializedLength = text.length; return { length: state.capLength }; } };", e.ctx);
      e.state.capLength = size;
      const snapshot = e.snapshot(); const d = predicate(snapshot);
      assert.ok(e.state.serializedLength > 0, "actual shared snapshot serialized before cap comparison");
      assert.equal(snapshot.failure, size === 8193 ? "JSON_CAP" : null);
      assert.equal(d.rows.length, size === 8193 ? 0 : 1);
      assert.equal(d.failure, size === 8193 ? "SNAPSHOT" : "DOCUMENT_IDENTITY_UNKNOWN");
      assert.equal(e.state.disconnects, 1); assert.strictEqual(e.snapshot(), snapshot);
    }
    const capFault = await environment(candidateBody); assert.equal(capFault.invoke().value, true); capFault.seedRenderer();
    execute("TextEncoder = class { encode() { throw undefined; } };", capFault.ctx);
    const fallback = capFault.snapshot(); assert.equal(predicate(fallback).failure, "SNAPSHOT");
    assert.equal(capFault.state.disconnects, 1);
  });
  await group("06_actual_original_gate_and_same_clock_observation", async () => {
    const e = await environment(candidateBody, { queryWorkMs: 5000 });
    assert.equal(e.invoke().value, true);
    const d = predicate(e.snapshot()); assert.equal(d.rows.length, 1);
    assert.ok(d.rows[0].duration >= 5000, "actual bracket sees fake-clock work in the existing body");
    assert.equal(d.observationComplete, true); assert.equal(d.failure, "DOCUMENT_IDENTITY_UNKNOWN");
    execute(source.gate.replace(/^export /gm, ""), e.ctx);
    const gate = execute("readinessBudgetValidation({ coldStartupMs: 500, fixtureLoadMs: 9000, startupBudgetMs: 5000, fixtureBudgetMs: 6000 })", e.ctx);
    assert.equal(gate.fixtureLoadWithinBudget, false); assert.equal(gate.passed, false);
    const renderer = execute("rendererBudgetValidation({ workMs: 1, p95Ms: 999, workBudgetMs: 8, frameBudgetMs: 33, assertFrame: false })", e.ctx);
    assert.equal(renderer.passed, true); assert.equal(renderer.frameWithinBudget, null);
    assert.equal(d.trusted, false); assert.equal(d.candidateQualified, false);
  });
  await group("07_actual_old_predicate_absence_and_protected_inverse", async () => {
    assert.equal(sha(restored), originalPerfPin);
    const old = await environment(callbackBody(oldPerf)), current = await environment(candidateBody);
    sameResult(old.invoke(), current.invoke());
    assert.equal(old.state.queryCalls, 1); assert.equal(old.state.marks, 1);
    assert.equal(predicate(old.snapshot()).rows.length, 0, "actual old body has no observation");
    assert.equal(predicate(current.snapshot()).rows.length, 1);
    assert.equal(current.state.initCalls, old.state.initCalls);
    assert.equal(source.perf.split("page.addInitScript(").length - 1, 1);
    assert.equal(source.perf.split("page.evaluate(").length - 1, oldPerf.split("page.evaluate(").length - 1);
    assert.equal(source.perf.split("page.waitForFunction(").length - 1, oldPerf.split("page.waitForFunction(").length - 1);
    assert.equal(source.perf.split("document.querySelector(").length - 1, oldPerf.split("document.querySelector(").length - 1);
    console.log(JSON.stringify({ authority: "STATIC_SOURCE_CONTROLS_ONLY", sameDocument: false,
      causalCredit: false, numericalImprovementOracle: false, runtimeGrant: 0 }));
  });
  assert.equal(reports.length, 7);
}
