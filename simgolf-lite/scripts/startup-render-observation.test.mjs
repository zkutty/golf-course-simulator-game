// ROOT-only pure controls. No browser, sockets, timers, filesystem writes or native GL.
// Targets are read as text; actual producer/helper/owner/validator blocks run in RAM.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";

const defaults = {
  helper: "../src/utils/startupRenderObservation.mjs",
  perf: "./perf-smoke.mjs", pixi: "../src/ui/PixiStage.tsx",
  owner: "../src/ui/renderer/nativeRendererOwner.ts",
  session: "../src/ui/renderer/nativeRendererSession.ts",
  core: "../src/utils/startupAttribution.mjs",
  gate: "./perf-readiness-budget.mjs",
};
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === "--counterfactual-old") options.old = true;
  else {
    assert.ok(key.startsWith("--") && key.slice(2) in defaults, "unknown target option");
    assert.ok(process.argv[i + 1], "target path required");
    options[key.slice(2)] = process.argv[++i];
  }
}
const source = Object.fromEntries(Object.entries(defaults).map(([key, relative]) =>
  [key, readFileSync(options[key] ?? fileURLToPath(new URL(relative, import.meta.url)), "utf8")]));
const hash = (s) => createHash("sha256").update(s).digest("hex");
const unique = (s, a) => { assert.equal(s.split(a).length - 1, 1, "unique source anchor: " + a); return s.indexOf(a); };
const block = (s, a, b) => s.slice(unique(s, a), unique(s, b));
const execute = (code, ctx) => new Script(code).runInContext(ctx);
const plain = (value) => JSON.parse(JSON.stringify(value));
const quiet = { log() {}, error() {} };
const init = block(source.perf, "await page.addInitScript(", "\nconst coldStartedAt");
const factory = block(source.pixi, "function createNativeRendererOwner():", "\n\nexport function PixiStage")
  .replace("function createNativeRendererOwner(): NativeRendererOwner<PIXI.Application, PIXI.Texture, NativeRendererConfiguration>",
    "function createNativeRendererOwner()");
assert.ok(factory.startsWith("function createNativeRendererOwner() {"), "exact admitted factory annotation");
const tailStart = unique(source.pixi, "      owner.markReady(generation);");
const tailEnd = unique(source.pixi, "      devLog(`initialized ${width}x${height}`);");
assert.ok(tailEnd > tailStart);
const postLayer = source.pixi.slice(tailStart, tailEnd + "      devLog(`initialized ${width}x${height}`);".length);
const evidenceStart = source.perf.includes("const { startupRenderObservation, ...browserEvidence }")
  ? "const { startupRenderObservation, ...browserEvidence } = await page.evaluate("
  : "const browserEvidence = await page.evaluate(";
const evidenceBlock = block(source.perf, evidenceStart, "\nlet startupJournalRaw");
const ownerJS = stripTypeScriptTypes(source.owner).replace(/^export /gm, "");
const sessionJS = stripTypeScriptTypes(source.session).replace(/^export /gm, "");
const gateJS = source.gate.replace(/^export /gm, "");
const coreJS = source.core.slice(0, unique(source.core, "\nlet recorder = null;")).replace(/^export /gm, "");

async function environment(overrides = {}) {
  const state = { now: 1, duration: 5000, calls: 0, returned: {}, args: null, receiver: null,
    throwPresent: false, thrown: undefined, clockFault: false, storage: [], initCalls: 0,
    installCalls: 0, activateCalls: 0, order: [], observers: [], disconnects: 0,
    starts: 0, stops: 0, destroys: 0, ready: [], initFailurePresent: false, initFailure: undefined };
  Object.assign(state, overrides);
  class Observer {
    static supportedEntryTypes = overrides.unsupported ? [] : ["longtask"];
    constructor(callback) {
      if (state.observerCtorFault) throw null;
      this.callback = callback; this.pending = []; state.observers.push(this);
    }
    observe(value) {
      assert.deepEqual(plain(value), { type: "longtask", buffered: true });
      if (state.observeFault) throw false;
    }
    takeRecords() { if (state.takeFault) throw 0; const rows = this.pending; this.pending = []; return rows; }
    disconnect() { state.disconnects++; if (state.disconnectFault) throw undefined; }
  }
  class Renderer {
    render(...args) {
      state.order.push("draw"); state.calls++; state.receiver = this; state.args = args;
      state.now += state.duration;
      if (state.throwPresent) throw state.thrown;
      return state.returned;
    }
    resize() { state.order.push("resize"); }
    generateTexture() { throw new Error("unused texture port"); }
  }
  class Application {
    constructor() {
      this.renderer = new Renderer(); this.ticker = {}; this.canvas = { remove() { state.order.push("detach"); } };
      this.stage = { destroy() { state.destroys++; } };
    }
    async init(config) {
      state.order.push("init"); state.initCalls++;
      assert.equal(config.autoDensity, true);
      assert.equal("autoStart" in config, false);
      if (state.initFailurePresent) throw state.initFailure;
    }
    start() { state.starts++; state.order.push("start"); }
    stop() { state.stops++; state.order.push("stop"); }
    destroy() { state.destroys++; state.order.push("destroy"); }
  }
  const sandbox = {
    URLSearchParams, TextEncoder, queueMicrotask, console: quiet,
    location: { search: overrides.optout ? "?perfFixture=1&perfMeasure=1" : "?m27Fixture=1&perfMeasure=1" },
    performance: { now() { if (state.clockFault) throw null; return state.now; }, timeOrigin: 100000 },
    localStorage: { setItem(key, value) { state.storage.push([key, value]); } },
    PerformanceObserver: Observer, navigator: { userAgent: "pure-control" }, innerWidth: 1440,
    innerHeight: 900, devicePixelRatio: 1,
    document: { visibilityState: "visible", querySelectorAll() { return []; } },
    PIXI: { Application }, TILE_W: 64, TILE_H: 32,
  };
  const ctx = createContext(sandbox);
  // A context-owned ordinary window avoids accessors on the VM global bridge.
  execute("this.window = {};", ctx);
  assert.equal(execute("window !== globalThis && Object.getPrototypeOf(window) === Object.prototype", ctx), true);
  // Execute the actual exports, then the actual addInitScript argument after serialization.
  execute(source.helper.replace(/^export /gm, ""), ctx);
  sandbox.page = {
    async addInitScript(callback) {
      state.addInitCount = (state.addInitCount ?? 0) + 1;
      execute("(" + callback.toString() + ")()", ctx);
    },
    async evaluate(callback) { state.evaluateCount = (state.evaluateCount ?? 0) + 1; return callback(); },
  };
  await execute("(async () => {" + init + "})()", ctx);
  assert.equal(state.addInitCount, 1);
  assert.deepEqual(state.storage, [["coursecraft_perfhud", "on"], ["coursecraft_ambience", "on"]]);
  execute(ownerJS + "\n" + sessionJS + "\n" + factory +
    "\nthis.makeSession = () => new NativeRendererSession(createNativeRendererOwner);", ctx);
  const originalInstall = sandbox.observeStartupRenderer;
  sandbox.observeStartupRenderer = function (renderer) {
    state.order.push("install"); state.installCalls++; return originalInstall(renderer);
  };
  const originalActivate = sandbox.activateStartupRenderer;
  sandbox.activateStartupRenderer = function (renderer) {
    state.order.push("activate"); state.activateCalls++; return originalActivate(renderer);
  };
  sandbox.postLayer = execute("(function(owner,generation,app) { const width=100,height=100;" +
    "const startupLayerSpan={}; const setAppReady=(v)=>{state.ready.push(v);state.order.push('ready');};" +
    "const startupEnd=()=>state.order.push('layer-end'); const devLog=()=>state.order.push('log');" +
    postLayer + "})", ctx);
  sandbox.state = state;
  const session = sandbox.makeSession();
  const config = { width: 100, height: 100, resolution: 1, antialias: true };
  const lease = session.claim(config);
  return {
    state, sandbox, ctx, session, lease, config,
    async acquire() { return lease.owner.acquire(lease.generation); },
    activate(app, current = lease) { sandbox.postLayer(current.owner, current.generation, app); },
    collector() { return sandbox.window.__ccStartupRenderObservation; },
    async publishSnapshot() {
      return execute("(async () => {" + evidenceBlock + "\nreturn {" +
        (options.old ? "browserEvidence" : "startupRenderObservation,browserEvidence") + "};})()", ctx);
    },
  };
}
function unknown(snapshot) {
  for (const field of ["trusted", "numericPass", "releaseCleared", "candidateQualified", "browserDocumentIdentity"])
    assert.equal(snapshot[field], false, field);
  for (const row of snapshot.draws) {
    assert.equal(row.generation, null); assert.equal(row.attempt, null); assert.equal(row.cohortQualified, false);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 8192);
}
function held(snapshot) { assert.equal(snapshot.status, "HOLD"); assert.equal(snapshot.eligible, false); unknown(snapshot); }
async function active(overrides) { const env = await environment(overrides); const app = await env.acquire(); env.activate(app); return { env, app }; }

if (options.old) {
  assert.equal(Buffer.byteLength(source.perf), 15246);
  assert.equal(hash(source.perf), "ee8c9df19bdb73a35e8c20848faa8d3e0e237da3b97c26aff34e866748b8b8a1");
  assert.equal(Buffer.byteLength(source.pixi), 200163);
  assert.equal(hash(source.pixi), "763717641cef5fbe3f3da2ad6b38e1b7643e497e7e259d0feca97d0774e66575");
  const { env, app } = await active();
  assert.equal(app.renderer.render({ actual: "old" }), env.state.returned);
  assert.equal(env.state.calls, 1);
  const result = await env.publishSnapshot();
  console.log("OLD_ORIGINAL_EXECUTED init=1 draw=1 duration=5000");
  // This assertion really fails after running the original producer and renderer.
  assert.ok(result.startupRenderObservation, "OLD_PRODUCER_MISSING_DRAW_OBSERVATION");
  throw new Error("old producer unexpectedly satisfied the new observation proof");
}

const groups = [];
async function group(name, fn) { await fn(); groups.push(name); console.log("PASS " + name); }

await group("actual-producer-draw5000-placement-serialization-publication", async () => {
  const { env, app } = await active();
  const args = [{ container: {} }, null, false, 0, undefined];
  const receiver = {};
  assert.equal(Reflect.apply(app.renderer.render, receiver, args), env.state.returned);
  assert.equal(env.state.receiver, receiver);
  args.forEach((arg, i) => assert.equal(env.state.args[i], arg));
  assert.equal(env.state.calls, 1);
  assert.deepEqual(env.state.order, ["init", "install", "ready", "layer-end", "activate", "log", "draw"]);
  const result = await env.publishSnapshot();
  const snapshot = result.startupRenderObservation;
  assert.equal(snapshot.status, "COMPLETE"); assert.equal(snapshot.eligible, true);
  assert.equal(snapshot.draws.length, 1); assert.equal(snapshot.draws[0].duration, 5000);
  assert.equal(snapshot.draws[0].outcome, "returned"); unknown(snapshot);
  assert.equal(env.state.evaluateCount, 1); assert.equal(env.state.disconnects, 1);
  assert.deepEqual(plain(result.browserEvidence), {
    userAgent: "pure-control", viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
    visibilityState: "visible", renderer: null, vendor: null, context: null,
  });
  assert.equal(env.collector().snapshot(), snapshot);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.draws) && Object.isFrozen(snapshot.draws[0]));
  app.renderer.render("after-freeze");
  assert.equal(env.state.calls, 2); assert.equal(snapshot.draws.length, 1);
  assert.equal(env.state.disconnects, 1);
});

await group("original-falsy-throws-returns-and-diagnostic-clock-faults", async () => {
  let inspected = 0;
  const hostile = Object.defineProperty({}, "message", { get() { inspected++; throw new Error("inspected"); } });
  for (const thrown of [null, false, 0, undefined, hostile]) {
    const { env, app } = await active({ throwPresent: true, thrown });
    let caught = false, value;
    try { app.renderer.render(thrown); } catch (error) { caught = true; value = error; }
    assert.ok(caught); assert.equal(value, thrown); assert.equal(env.state.calls, 1);
    const snap = env.collector().snapshot(); assert.equal(snap.draws[0].outcome, "threw"); unknown(snap);
  }
  assert.equal(inspected, 0);
  for (const returned of [null, false, 0, undefined, Promise.resolve(9)]) {
    const { env, app } = await active({ returned });
    assert.equal(app.renderer.render(), returned);
    assert.equal(env.state.calls, 1);
  }
  for (const bad of [NaN, Infinity, -1, 0]) {
    const { env, app } = await active();
    env.state.now = bad; app.renderer.render(); held(env.collector().snapshot());
    assert.equal(env.state.calls, 1);
  }
  const { env, app } = await active({ throwPresent: true, thrown: false });
  env.state.clockFault = true;
  let caught = false;
  try { app.renderer.render(); } catch (error) { caught = true; assert.equal(error, false); }
  assert.ok(caught); held(env.collector().snapshot()); assert.equal(env.state.calls, 1);
});

await group("observer-faults-incomplete-late-schema-and-missing-publication", async () => {
  for (const override of [{ unsupported: true }, { observerCtorFault: true }, { observeFault: true },
    { takeFault: true }, { disconnectFault: true }]) {
    const { env, app } = await active(override); app.renderer.render(); held(env.collector().snapshot());
  }
  {
    const { env, app } = await active();
    env.state.observers[0].callback({ getEntries() { throw false; } });
    app.renderer.render(); held(env.collector().snapshot());
  }
  {
    const env = await environment();
    const foreign = { render() { return 2; } };
    env.collector().activate(foreign); held(env.collector().snapshot());
    assert.equal(env.collector().snapshot().capture.late, true);
  }
  {
    const { env } = await active(); held(env.collector().snapshot());
    assert.equal(env.collector().snapshot().failure, "INCOMPLETE");
  }
  {
    const env = await environment(); let getterCalls = 0;
    env.collector().install(Object.defineProperty({}, "render", { get() { getterCalls++; throw 0; } }));
    assert.equal(getterCalls, 0); held(env.collector().snapshot());
    assert.equal(env.collector().snapshot().failure, "RENDER_METHOD");
  }
  {
    const env = await environment();
    env.collector().install(Object.defineProperty({}, "render", { value() {}, writable: false, configurable: false }));
    held(env.collector().snapshot());
    assert.equal(env.collector().snapshot().failure, "RENDER_DESCRIPTOR");
  }
  {
    const { env, app } = await active(); app.renderer.render = () => 9;
    env.collector().activate(app.renderer); assert.equal(app.renderer.render(), 9);
    held(env.collector().snapshot()); assert.equal(env.collector().snapshot().capture.late, true);
  }
  {
    const env = await environment(); execute("delete window.__ccStartupRenderObservation;", env.ctx);
    const result = await env.publishSnapshot(); held(result.startupRenderObservation);
    assert.equal(result.startupRenderObservation.failure, "MISSING");
  }
  for (const fault of [{ code: "null", value: null }, { code: "false", value: false },
    { code: "0", value: 0 }, { code: "undefined", value: undefined }]) {
    const env = await environment();
    execute("this.windowGetterCalls = 0; Object.defineProperty(window, '__ccStartupRenderObservation', " +
      "{ configurable: true, get() { windowGetterCalls++; throw " + fault.code + "; } });", env.ctx);
    // Confirm the fault inside the same realm; never accept a normalized missing value.
    const fidelity = execute("(() => { let caught=false,value; try { window.__ccStartupRenderObservation; } " +
      "catch(error) { caught=true; value=error; } return {caught,value,calls:windowGetterCalls}; })()", env.ctx);
    assert.equal(fidelity.caught, true); assert.equal(fidelity.value, fault.value); assert.equal(fidelity.calls, 1);
    const result = await env.publishSnapshot(); held(result.startupRenderObservation);
    assert.equal(result.startupRenderObservation.failure, "SNAPSHOT_ACCESS");
    assert.equal(env.sandbox.windowGetterCalls, 2);
  }
  {
    const { env, app } = await active();
    env.sandbox.TextEncoder = class { encode() { throw null; } };
    app.renderer.render(); held(env.collector().snapshot());
    assert.equal(env.state.calls, 1);
  }
  {
    const { env, app } = await active();
    execute("Object.freeze = () => { throw 0; };", env.ctx);
    app.renderer.render(); held(env.collector().snapshot());
    assert.equal(env.state.calls, 1);
  }
});

await group("first16-draw-longtask-byte-caps-and-sticky-first-failure", async () => {
  {
    const { env, app } = await active({ duration: 0 });
    for (let i = 0; i < 17; i++) app.renderer.render();
    const snap = env.collector().snapshot(); held(snap);
    assert.equal(snap.failure, "ROW_CAP"); assert.equal(snap.capture.truncated, true);
    assert.equal(snap.draws.length, 16); assert.equal(env.state.calls, 17);
  }
  {
    const { env, app } = await active({ duration: 0 });
    app.renderer.render();
    env.state.observers[0].pending = Array.from({ length: 17 }, (_, i) => ({ startTime: 1 + i, duration: 50 }));
    const snap = env.collector().snapshot(); held(snap);
    assert.equal(snap.longTasks.length, 16); assert.equal(snap.capture.truncated, true);
  }
  {
    const { env, app } = await active({ unsupported: true, duration: 0 });
    for (let i = 0; i < 17; i++) app.renderer.render();
    const snap = env.collector().snapshot(); held(snap);
    assert.equal(snap.failure, "LONGTASK_UNSUPPORTED"); assert.equal(snap.capture.truncated, true);
  }
  {
    const { env, app } = await active();
    env.sandbox.TextEncoder = class { encode() { return { length: 8193 }; } };
    app.renderer.render(); const snap = env.collector().snapshot(); held(snap);
    assert.equal(snap.failure, "JSON_CAP"); assert.equal(snap.draws.length, 0);
  }
  {
    const { env, app } = await active({ duration: 0 });
    env.state.observers[0].pending = [{ startTime: NaN, duration: 1 }];
    app.renderer.render(); held(env.collector().snapshot());
    assert.equal(env.collector().snapshot().failure, "LONGTASK_CLOCK");
  }
});

await group("actual-native-owner-session-restore-no-second-wrap-no-cohort-credit", async () => {
  const { env, app } = await active({ duration: 0 });
  const wrapper = app.renderer.render;
  app.renderer.render("old-generation");
  env.session.beginRestore(); env.session.invalidate(env.lease);
  await env.session.completeCleanup(env.lease);
  const current = env.session.claim(env.config);
  assert.notEqual(current.generation, env.lease.generation);
  const reused = await current.owner.acquire(current.generation);
  assert.equal(reused, app); assert.equal(reused.renderer.render, wrapper);
  env.activate(reused, current); reused.renderer.render("current-generation");
  assert.equal(env.state.initCalls, 1); assert.equal(env.state.installCalls, 1);
  assert.equal(env.state.starts, 1); assert.equal(env.state.activateCalls, 2);
  for (let i = 0; i < 15; i++) reused.renderer.render("restored-cap");
  const snap = env.collector().snapshot(); held(snap); assert.equal(snap.draws.length, 16);
  assert.equal(snap.failure, "ROW_CAP"); assert.equal(snap.capture.truncated, true);
  assert.equal(env.state.calls, 17);
  assert.equal(snap.capture.installedRenderers, 1); assert.equal(snap.capture.activations, 2); unknown(snap);
  // Exercise the unchanged recorder with actual native tokens, distinct scalar attempt IDs.
  execute(coreJS + "\nthis.makeRecorder = createStartupRecorder; this.recordAttempt=recordRendererStartupAttempt;", env.ctx);
  const recorder = env.sandbox.makeRecorder({ now: () => env.state.now, start: 1, timeOrigin: 100000 });
  recorder.owner(99);
  const oldAttempt = env.sandbox.recordAttempt(recorder, env.lease.generation);
  const canceled = recorder.begin(8, null, oldAttempt); recorder.finishAttempt(oldAttempt, 3);
  const currentAttempt = env.sandbox.recordAttempt(recorder, current.generation);
  assert.notEqual(currentAttempt, current.generation.generation);
  const global = recorder.begin(15); recorder.end(global);
  const owned = recorder.begin(8, null, currentAttempt); recorder.end(owned); recorder.markReady();
  const journal = recorder.snapshot();
  assert.equal(journal.failure, null);
  assert.ok(journal.events.some((row) => row[1] === 3 && row[3] === canceled.id));
  assert.ok(journal.events.some((row) => row[5] === 0 && row[6] === 0 && row[2] === 15));
  assert.ok(journal.events.some((row) => row[5] === currentAttempt && row[6] === current.generation.generation));
  // Observation identities grant none of that recorder cohort ownership.
  assert.ok(snap.draws.every((row) => row.generation === null && row.attempt === null));
  env.session.invalidate(current); await env.session.completeCleanup(current); await env.session.close();
});

await group("optout-original-init-failure-and-guarded-port-faults", async () => {
  {
    const { env, app } = await active({ optout: true });
    app.renderer.render(); assert.equal(env.collector(), undefined);
    assert.equal((await env.publishSnapshot()).startupRenderObservation, null);
    assert.equal(env.state.calls, 1);
  }
  for (const thrown of [null, false, 0, undefined]) {
    const env = await environment({ initFailurePresent: true, initFailure: thrown });
    let caught = false;
    try { await env.acquire(); } catch (error) { caught = true; assert.equal(error, thrown); }
    assert.ok(caught); assert.equal(env.state.installCalls, 0);
    await env.session.completeCleanup(env.lease);
  }
  {
    const env = await environment();
    execute("Object.defineProperty(window, '__ccStartupRenderObservation', " +
      "{ configurable: true, get() { throw false; } });", env.ctx);
    const app = await env.acquire(); env.activate(app);
    assert.equal(app.renderer.render(), env.state.returned);
    assert.equal(env.state.ready.length, 1);
    assert.equal(env.state.calls, 1);
  }
});

await group("actual-original-gate9000-red-one-existing-publication", async () => {
  const { env, app } = await active(); app.renderer.render();
  const snapshot = (await env.publishSnapshot()).startupRenderObservation;
  assert.equal(snapshot.status, "COMPLETE");
  const gateBlock = block(source.perf, "const readiness = readinessBudgetValidation(", "\nconst evidence =");
  const publishBlock = block(source.perf, "const evidence = {", "\nif (PERF_FIXTURE === \"m27Fixture\") {\n  try {\n    if (startupDiagnosticFailurePresent)");
  const exitBlock = "if (failed) process.exit(1);";
  unique(source.perf, exitBlock);
  const writes = [];
  Object.assign(env.sandbox, {
    coldStartupMs: 100, fixtureLoadMs: 9000, STARTUP_BUDGET_MS: 5000, FIXTURE_LOAD_BUDGET_MS: 6000,
    WORK_BUDGET_MS: 8, BUDGET_MS: 33, ASSERT_FRAME: false, perf: { workMs: 1, p95Ms: 100 },
    PERF_THEME: "control", PERF_FIXTURE: "m27Fixture", MEASURE_S: 20, WARMUP_S: 8, HEADED: false,
    startupWaitStages: {}, startupRenderObservation: snapshot, browserEvidence: {},
    OUTPUT_PATH: "ram-only.json", dirname: () => ".", mkdirSync() {},
    writeFileSync(path, raw) { writes.push({ path, raw }); },
    process: { env: {}, exit(code) { throw { exitCode: code }; } },
  });
  execute(gateJS + "\n" + gateBlock + "\nthis.actualGate = gateValidation;", env.ctx);
  assert.equal(env.sandbox.actualGate.fixtureLoadWithinBudget, false);
  assert.equal(env.sandbox.actualGate.passed, false);
  execute(publishBlock, env.ctx);
  assert.equal(writes.length, 1);
  const published = JSON.parse(writes[0].raw);
  assert.equal(published.fixtureLoadMs, 9000);
  assert.equal(published.effective.budgets.fixtureLoadMilliseconds, 6000);
  assert.equal(published.gateValidation.passed, false);
  assert.equal(published.startupRenderObservation.draws[0].duration, 5000);
  let exited = false;
  try { execute(exitBlock, env.ctx); } catch (error) { exited = true; assert.equal(error.exitCode, 1); }
  assert.ok(exited);
});
assert.equal(groups.length, 7);
console.log("ROOT_PURE_CONTROLS_PASS groups=" + groups.length + "; no actual browser/runtime authority");
