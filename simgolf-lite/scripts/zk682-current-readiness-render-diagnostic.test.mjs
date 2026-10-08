import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, symlinkSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
// Verify source pins BEFORE either diagnostic candidate module is imported.
const requiredModulePins = {"./zk682-browser-readiness-render-observer.mjs": "572c2f59a06a37ef43f1273393d0b97dff839270299f743deeb1073a9bcec2e4", "./zk682-current-readiness-render-diagnostic.mjs": "02d8b0363e114f34b3abec7d7a6aa715d87e26e229971ea453d8e98884688318"};
for (const [name,pin] of Object.entries(requiredModulePins)) {
  const bytes=readFileSync(new URL(name,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pin,'candidate source pin before imports:'+name);
}
const {createReadinessHostObserver,OPERATIONS,LEDGER_BASENAME,DONOR_SHA256,DONOR_BYTES,MAX_ROWS,MAX_BYTES,transformReadinessProducer,inverseReadinessProducer,validateReadinessProducer,extractReadinessSegment}=await import('./zk682-current-readiness-render-diagnostic.mjs');
const {installBrowserReadinessRenderObserver}=await import('./zk682-browser-readiness-render-observer.mjs');

const donorPath = process.env.ZK682_STARTUP_DONOR_PATH || "/Users/zbkutlow/.codex/worktrees/startup-review-demand-eebb/golf-course-simulator-game/simgolf-lite/scripts/perf-smoke.mjs";
const donor = readFileSync(donorPath, "utf8");
const observerModuleUrl = new URL("./zk682-current-readiness-render-diagnostic.mjs", import.meta.url).href;
const optionsFor = (dir, enabled = true) => ({ observerModuleUrl, ledgerPath: join(dir, LEDGER_BASENAME), driverCommit: "a".repeat(40), enabled });
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
  const inventoryArgs = (args) => args.map((arg) => typeof arg === "function" ? arg.toString().replace(/\/\* zk682-readiness-render:begin \*\/[\s\S]*?\/\* zk682-readiness-render:end \*\/\n/g, "") : arg);
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
  const code = mode === "baseline" ? baselineSegment : extractReadinessSegment(transformReadinessProducer(donor, options), options);
  const run = new AsyncFunction("page", "sleep", "performance", "console", "PORT", "PERF_FIXTURE", "PERF_THEME", "FIXTURE_READY_TIMEOUT_MS", "__zk682CreatePhase", code);
  const create = (args) => {
    observer = createReadinessHostObserver({ ...args, ...(faultClock ? { clock() { throw undefined; } } : {}) });
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

test("R66 SYNTHETIC transform: full actual donor byte/hash inverse and whole producer await/reaction/timer/browser/gate cardinality", () => {
  const options = optionsFor(tmpdir());
  assert.equal(Buffer.byteLength(donor), DONOR_BYTES); assert.equal(sha(donor), DONOR_SHA256);
  const generated = transformReadinessProducer(donor, options);
  assert.strictEqual(inverseReadinessProducer(generated), donor);
  assert.equal(validateReadinessProducer(generated, options), true);
  assert.deepEqual(inventory(generated), inventory(donor));
  assert.equal((baselineSegment.match(/\bawait\s/g) || []).length, 6); // five + original rejection-only text evaluate
  assert.equal(generated.includes('  const status = await page.evaluate(() => {'), true);
});

test("R66 SYNTHETIC transform: arbitrary, missing, duplicated and modified-operation donors are rejected", () => {
  const options = optionsFor(tmpdir());
  for (const bad of ["", donor + "\n", donor.replace("await sleep(500);", "await sleep(501);"), donor.replace(startAnchor, ""), donor + startAnchor]) {
    assert.throws(() => transformReadinessProducer(bad, options), /donor identity/);
  }
});

test("R66 SYNTHETIC transform: actual extra await, browser API, Promise reaction and timer in insertion fail source admission", () => {
  const options = optionsFor(tmpdir()); const source = transformReadinessProducer(donor, options);
  for (const forbidden of ['await Promise.resolve();', 'page.evaluate(() => null);', 'Promise.resolve().then(() => {});', 'setTimeout(() => {}, 1);']) {
    const mutated = source.replace('/* zk682-readiness-render:begin */\n', `/* zk682-readiness-render:begin */\n${forbidden}\n`);
    assert.equal(inverseReadinessProducer(mutated), donor);
    assert.throws(() => validateReadinessProducer(mutated, options), /insertion mismatch/);
  }
  assert.throws(() => inverseReadinessProducer(source.replace("await sleep(500);", "await sleep(501);")), /inverse mismatch/);
});

test("R66 SYNTHETIC transform: absolute observer URL and exact ledger basename are mandatory", () => {
  assert.throws(() => transformReadinessProducer(donor, { observerModuleUrl: "https://example.com/observer.mjs", ledgerPath: join(tmpdir(), LEDGER_BASENAME) }));
  assert.throws(() => transformReadinessProducer(donor, { observerModuleUrl, ledgerPath: "relative.json" }));
  assert.throws(() => transformReadinessProducer(donor, { observerModuleUrl, ledgerPath: join(tmpdir(), "wrong.json") }));
});

test("R66 SYNTHETIC transform: actual extracted immediate and delayed five-await paths match original outputs, calls and args", async () => {
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

test("R66 SYNTHETIC transform: actual extracted rejection at each await preserves falsy/Error identity and exact original API order", async () => {
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

test("R66 SYNTHETIC transform: original timeout text-evaluate secondary rejection replaces producer throw without replacing first observed phase failure", async () => {
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

test("R66 SYNTHETIC transform: observer clock and publication faults cannot alter actual extracted producer results/errors", async () => {
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

test("R66 SYNTHETIC transform: later producer failures cannot rewrite normal frozen readiness ledger", async () => {
  const result = await harness();
  assert.equal(result.snapshot.status, "returned");
  assert.deepEqual(result.snapshot, result.ledger);
  // Exercise the actual generated outer handler after the phase already froze.
  const dir = mkdtempSync(join(tmpdir(), "zk682-startup-late-"));
  try {
    const options = optionsFor(dir); const generated = transformReadinessProducer(donor, options);
    const marker = "/* zk682-readiness-render:begin */";
    const handler = generated.slice(generated.lastIndexOf(marker));
    const o = createReadinessHostObserver({ clock: () => 100 }); o.start(100);
    OPERATIONS.forEach((operation) => { o.enter(operation); o.returned(operation); }); o.finish(0); o.publish(options.ledgerPath);
    const before = readFileSync(options.ledgerPath, "utf8"); const primary = null;
    const run = new Function("__zk682Phase", "primary", "try { throw primary;\n" + handler);
    assert.throws(() => run(o, primary), (value) => value === primary);
    assert.equal(readFileSync(options.ledgerPath, "utf8"), before);
    assert.equal(o.freeze().firstFailedOperation, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("R66 SYNTHETIC transform: original finite budgets and readiness/renderer gates remain operational and byte exact", async () => {
  const budgetModule = new URL("./perf-readiness-budget.mjs", pathToFileURL(donorPath));
  const { readinessBudgetValidation, rendererBudgetValidation } = await import(budgetModule.href);
  const result = await harness({ duration: [4, 6500, 6, 7, 8] });
  assert.equal(result.ledger.observerInvalid, false);
  const readiness = readinessBudgetValidation({ coldStartupMs: 5001, fixtureLoadMs: result.returned.fixtureLoadMs, startupBudgetMs: 5000, fixtureBudgetMs: 6000 });
  assert.equal(readiness.passed, false);
  const renderer = rendererBudgetValidation({ workMs: 9, p95Ms: 20, workBudgetMs: 8, frameBudgetMs: 33, assertFrame: false });
  assert.equal(renderer.passed, false);
  const generated = transformReadinessProducer(donor, optionsFor(tmpdir()));
  const afterPhase = donor.slice(donor.indexOf(endAnchor) + endAnchor.length);
  assert.equal(inverseReadinessProducer(generated).endsWith(afterPhase), true);
});

function fixture(options = {}) {
  let now = 100;
  const observer = createReadinessHostObserver({ clock: () => now, ...options });
  observer.start(now);
  return { observer, set: (value) => { now = value; }, run() {
    OPERATIONS.forEach((operation, i) => {
      now = 101 + i * 10; observer.enter(operation);
      now += i + 1; observer.returned(operation);
    });
    observer.finish(50);
    return observer;
  } };
}
function directory(fn) {
  const dir = mkdtempSync(join(tmpdir(), "zk682-startup-observer-"));
  try { return fn(dir, join(dir, LEDGER_BASENAME)); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("R66 SYNTHETIC host: normal twelve primitive rows use existing total boundary and frozen copies", () => {
  const f = fixture(); const o = f.run(); const s = o.freeze();
  assert.equal(s.records.length, MAX_ROWS);
  assert.deepEqual(s.records[0], { operation: "total", kind: "start", offsetMs: 0 });
  assert.deepEqual(s.records.at(-1), { operation: "total", kind: "return", offsetMs: 50 });
  OPERATIONS.forEach((operation, i) => {
    assert.equal(s.records[1 + i * 2].operation, operation);
    assert.equal(s.records[2 + i * 2].offsetMs - s.records[1 + i * 2].offsetMs, i + 1);
  });
  assert.equal(s.observerInvalid, false);
  assert.equal(s.firstFailedOperation, null);
  assert.equal(s.status, "returned");
  assert.throws(() => { s.records[1].offsetMs = 99; }, TypeError);
  assert.throws(() => { s.records.push({}); }, TypeError);
  f.set(200); o.rejected(new Error("late")); o.enter(OPERATIONS[0]);
  assert.strictEqual(o.freeze(), s);
});

test("R66 SYNTHETIC host: each boundary records one falsy-safe error and one terminal, never unreached rows", () => {
  for (let failed = 0; failed < OPERATIONS.length; failed += 1) {
    for (const value of [false, null, undefined, new Error("primary")]) {
      const f = fixture(); const o = f.observer;
      for (let i = 0; i <= failed; i += 1) {
        f.set(101 + i * 10); o.enter(OPERATIONS[i]);
        f.set(102 + i * 10);
        if (i < failed) o.returned(OPERATIONS[i]);
        else { o.failed(OPERATIONS[i], value); o.failed(OPERATIONS[i], "secondary"); }
      }
      f.set(103 + failed * 10); o.rejected(value);
      const s = o.freeze();
      assert.equal(s.records.length, 2 * failed + 4);
      assert.equal(s.records.filter((r) => r.kind === "error").length, 2);
      assert.equal(s.firstFailedOperation, OPERATIONS[failed]);
      assert.equal(s.firstErrorPresent, true);
      assert.equal(s.firstErrorKind, value === null ? "null" : typeof value);
      assert.equal(s.observerInvalid, false);
      assert.equal(s.records.at(-1).kind, "error");
      assert.equal(s.records.some((r) => OPERATIONS.indexOf(r.operation) > failed), false);
    }
  }
});

test("R66 SYNTHETIC host: observer never reads thrown object properties", () => {
  const hostile = new Proxy({}, { get() { throw new Error("property read"); } });
  const f = fixture(); f.observer.enter(OPERATIONS[0]);
  assert.doesNotThrow(() => f.observer.failed(OPERATIONS[0], hostile));
  f.observer.rejected(hostile);
  assert.equal(f.observer.freeze().firstErrorKind, "object");
});

test("R66 SYNTHETIC host: throwing, nonfinite and backwards clocks are sticky invalid without escaping", () => {
  for (const clock of [() => { throw false; }, () => NaN, () => Infinity, () => 99]) {
    const f = fixture({ clock });
    assert.doesNotThrow(() => { f.observer.enter(OPERATIONS[0]); f.observer.failed(OPERATIONS[0], null); f.observer.rejected(undefined); });
    assert.equal(f.observer.freeze().observerInvalid, true);
    assert.ok(f.observer.freeze().records.length <= MAX_ROWS);
  }
  const f = fixture(); f.observer.enter(OPERATIONS[0]); f.set(99); f.observer.returned(OPERATIONS[0]);
  f.set(200); f.observer.rejected(false);
  assert.equal(f.observer.freeze().observerInvalid, true);
});

test("R66 SYNTHETIC host: wrong order, duplicate boundaries and missing start/terminal fail closed", () => {
  const f = fixture(); f.observer.enter(OPERATIONS[1]); f.run();
  assert.equal(f.observer.freeze().observerInvalid, true);
  const o = createReadinessHostObserver(); o.enter(OPERATIONS[0]);
  assert.equal(o.freeze().observerInvalid, true);
  const early = fixture().observer.freeze();
  assert.equal(early.terminal, false); assert.equal(early.status, "UNKNOWN");
  assert.deepEqual(early.records.map((r) => r.operation), ["total"]);
});

test("R66 SYNTHETIC host: disabled observer performs no clock or publication work", () => {
  let reads = 0;
  const f = fixture({ enabled: false, clock: () => { reads += 1; throw false; } });
  f.run(); f.observer.rejected(null);
  directory((dir, path) => {
    assert.equal(f.observer.publish(path).published, false);
    assert.equal(existsSync(path), false);
  });
  assert.equal(reads, 0);
});

test("R66 SYNTHETIC host: actual wx publication is bounded and exactly once with frozen provenance", () => directory((dir, path) => {
  const o = fixture().run(); const result = o.publish(path);
  assert.deepEqual(result, { published: true, observerInvalid: false, reason: null });
  const text = readFileSync(path, "utf8");
  assert.ok(Buffer.byteLength(text) <= MAX_BYTES);
  assert.deepEqual(JSON.parse(text), o.freeze());
  assert.strictEqual(o.publish(path), result);
  assert.equal(readFileSync(path, "utf8"), text);
  assert.equal(statSync(path).mode & 0o777, 0o600);
}));

test("R66 SYNTHETIC host: actual preexisting file and symlink retain all foreign bytes", () => directory((dir, path) => {
  writeFileSync(path, "foreign");
  const o = fixture().run(); assert.equal(o.publish(path).published, false);
  assert.equal(readFileSync(path, "utf8"), "foreign");
  rmSync(path); const foreign = join(dir, "foreign"); writeFileSync(foreign, "target"); symlinkSync(foreign, path);
  const second = fixture().run(); assert.equal(second.publish(path).published, false);
  assert.equal(readFileSync(foreign, "utf8"), "target");
}));

test("R66 SYNTHETIC host: publication errors are typed, bounded, frozen and cannot change the producer primary", () => directory((dir, path) => {
  const primary = false; const f = fixture(); f.observer.enter(OPERATIONS[0]); f.observer.rejected(primary);
  let thrown;
  try { f.observer.publish(path, { write() { throw null; } }); throw primary; } catch (error) { thrown = error; }
  assert.strictEqual(thrown, primary);
  assert.equal(f.observer.freeze().status, "rejected");
  assert.equal(f.observer.publish(path).observerInvalid, true);
  assert.equal(existsSync(path), false);
}));

test("R66 SYNTHETIC host: cyclic, substituted, oversized and UTF8 serializers cannot publish false facts", () => directory((dir, path) => {
  const cycle = {}; cycle.self = cycle;
  const serializers = [
    () => JSON.stringify(cycle), () => "{}", () => "x".repeat(MAX_BYTES),
    () => "é".repeat(MAX_BYTES / 2), () => { throw undefined; }, () => ({ toString() { throw false; } }),
  ];
  for (const serialize of serializers) {
    const o = fixture().run(); assert.doesNotThrow(() => o.publish(path, { serialize }));
    assert.equal(o.publish(path).observerInvalid, true); assert.equal(existsSync(path), false);
  }
}));

test("R66 SYNTHETIC host: hostile serializer mutation and reentrant publication cannot mutate frozen observations", () => directory((dir, path) => {
  const o = fixture().run(); let writes = 0;
  const result = o.publish(path, { serialize(snapshot) {
    assert.throws(() => { snapshot.records[1].offsetMs = 4; }, TypeError);
    assert.equal(o.publish(path).reason, "publication-in-progress");
    o.enter(OPERATIONS[0]); o.rejected(false);
    return JSON.stringify(snapshot);
  }, write(filename, data, options) { writes += 1; writeFileSync(filename, data, options); } });
  assert.equal(writes, 1); assert.equal(result.published, true);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).records.length, MAX_ROWS);
}));

test("R66 SYNTHETIC host: invalid path and incomplete phase produce missing/invalid evidence, never fabricated completion", () => directory((dir, path) => {
  assert.equal(fixture().run().publish(join(dir, "other.json")).reason, "invalid-path");
  const o = fixture().observer;
  assert.equal(o.publish(path).reason, "missing-terminal");
  assert.equal(existsSync(path), false);
  assert.equal(o.freeze().terminal, false);
}));


test("R66 SYNTHETIC host: reentrant hostile clock mutation is sticky invalid and cannot fabricate accepted phase order", () => {
  let o;
  o = createReadinessHostObserver({ clock() { o.rejected(false); return 101; } });
  o.start(100);
  assert.doesNotThrow(() => o.enter(OPERATIONS[0]));
  assert.doesNotThrow(() => o.rejected(undefined));
  const snapshot = o.freeze();
  assert.equal(snapshot.observerInvalid, true);
  assert.equal(snapshot.records.length <= MAX_ROWS, true);
  assert.equal(snapshot.firstErrorKind, "undefined");
});

// All browser contexts below are explicitly SYNTHETIC; no real browser is launched.
function browserFixture(spec={}) {
  let now=10,nodes,rafId=0,mut,po,frame,hidden=false,style={display:'block',visibility:'visible',opacity:'1'},rect={width:2,height:1};
  const calls=[],events=new Map(),canceled=[],receiverError=new Error('synthetic native receiver');
  class Element {checkVisibility(){return !hidden;}closest(){return null;}}
  class Canvas extends Element {constructor(){super();this.ownerDocument=document;this.isConnected=true;this.width=2;this.height=1;this.clientWidth=2;this.clientHeight=1;this.nodeType=1;this.firstChild=null;}getBoundingClientRect(){return {...rect};}}
  const document={querySelectorAll(selector){assert.equal(selector,'.cc-pixi-stage canvas');return nodes;},createRange(){return {selectNode(){},getBoundingClientRect:()=>({width:1,height:1})};}};
  const canvas=new Canvas();nodes=[canvas];
  const nativeCanvases=new WeakMap();class GL2 {constructor(node=canvas){nativeCanvases.set(this,node);}get canvas(){if(!nativeCanvases.has(this))throw receiverError;return nativeCanvases.get(this);}}
  const originals={};for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const fn=function(...args){calls.push({method,receiver:this,args});if(!(this instanceof GL2))throw receiverError;if(spec.coerceMode)Number(args[0]);if(spec.coerceNative){const count=args[method==='drawArrays'||method==='drawArraysInstanced'?2:1];Number(count);}if(Object.hasOwn(spec,'throwValue'))throw spec.throwValue;return Object.hasOwn(spec,'returnValue')?spec.returnValue:37;};Object.defineProperty(GL2.prototype,method,{value:fn,writable:true,configurable:true,enumerable:false});originals[method]=Object.getOwnPropertyDescriptor(GL2.prototype,method);}
  class Mutation {constructor(fn){mut=this;this.fn=fn;this.disconnected=false;}observe(){}disconnect(){this.disconnected=true;}}
  class Tasks {static supportedEntryTypes=spec.longtaskUnsupported?[]:['longtask'];constructor(fn){po=this;this.fn=fn;this.disconnected=false;}observe(args){assert.deepEqual(structuredClone(args),{type:'longtask',buffered:true});}disconnect(){this.disconnected=true;}}
  const window={getComputedStyle:()=>style,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}};
  if(spec.preexisting)Object.defineProperty(window,'__zk682ReadinessRender66',{value:spec.preexisting,writable:true,configurable:true});
  const context={window,document,HTMLCanvasElement:Canvas,Element,WebGL2RenderingContext:spec.glUnsupported?undefined:GL2,MutationObserver:Mutation,PerformanceObserver:Tasks,performance:{get timeOrigin(){return 1000000;},now(){if(spec.clockError)throw spec.clockError;return now;}},location:{href:spec.route||'http://127.0.0.1:5199/?m27Fixture=1&perfTheme=parkland&perfMeasure=1'},requestAnimationFrame:fn=>{frame=fn;return ++rafId;},cancelAnimationFrame:id=>canceled.push(id),URL,TextEncoder,options:{enabled:spec.enabled!==false,targetCommit:'66cedcc724308a622045455e8fbfa648afc89b81',driverCommit:'a'.repeat(40)}};
  const api=runInNewContext('('+installBrowserReadinessRenderObserver.toString()+')(options)',context);
  return {api,window,context,canvas,GL2,originals,calls,receiverError,events,canceled,mutate(){now++;mut?.fn([]);},raf(){now++;const fn=frame;frame=null;fn?.();},longtasks(entries){now++;po?.fn({getEntries:()=>entries});},replace(){nodes=[new Canvas()];return nodes[0];},duplicate(){nodes=[canvas,canvas];},disconnect(){canvas.isConnected=false;},style(value){style={...style,...value};},hidden(value){hidden=value;},rect(value){rect={...rect,...value};},node(){return nodes[0];},setNow(value){now=value;},snapshot(){return structuredClone(api?.snapshot()??null);},stopped(){return {mutation:mut?.disconnected,tasks:po?.disconnected};}};
}

test('R66 SYNTHETIC browser wrappers preserve native receiver arguments returns and every falsy primary',()=>{
  for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])for(const result of [undefined,null,false,0,'',Symbol('result'),{identity:true}]){
    const f=browserFixture({returnValue:result}),gl=new f.GL2(),argument={identity:true},args=method==='drawArrays'?[1,argument,3]:method==='drawElements'?[1,3,argument,0]:method==='drawArraysInstanced'?[1,argument,3,2]:[1,3,argument,0,2];
    assert.strictEqual(Reflect.apply(f.GL2.prototype[method],gl,args),result);assert.equal(f.calls.length,1);assert.strictEqual(f.calls[0].receiver,gl);assert.strictEqual(f.calls[0].args[method==='drawArrays'||method==='drawArraysInstanced'?1:2],argument);
    const snapshot=f.snapshot(),counts=snapshot.contexts[0].methods.find(x=>x.name===method);assert.equal(counts.invocations,1);assert.equal(counts.returns,1);assert.equal(counts.throws,0);assert.equal(snapshot.observerIncomplete,false);
    for(const name of Object.keys(f.originals))assert.deepEqual(Object.getOwnPropertyDescriptor(f.GL2.prototype,name),f.originals[name]);
  }
  for(const primary of [undefined,null,false,0,'',Symbol('primary'),new Error('primary')]){const f=browserFixture({throwValue:primary}),gl=new f.GL2();let caught=false,value;try{gl.drawArrays(1,2,3);}catch(error){caught=true;value=error;}assert.equal(caught,true);assert.strictEqual(value,primary);assert.equal(f.calls.length,1);const counts=f.snapshot().contexts[0].methods[0];assert.deepEqual([counts.invocations,counts.returns,counts.throws,counts.firstThrownPresent],[1,0,1,true]);assert.equal(counts.firstThrownKind,primary===null?'null':typeof primary);}
  const f=browserFixture();let value;try{Reflect.apply(f.GL2.prototype.drawElements,null,[1,2,3,4]);}catch(error){value=error;}assert.strictEqual(value,f.receiverError);assert.strictEqual(f.calls[0].receiver,null);f.snapshot();
});

test('R66 SYNTHETIC descriptor restoration retains foreign replacement and recorder faults never suppress original draw',()=>{
  const f=browserFixture(),foreign=function(){return 'foreign';};Object.defineProperty(f.GL2.prototype,'drawArrays',{...f.originals.drawArrays,value:foreign});f.snapshot();assert.strictEqual(f.GL2.prototype.drawArrays,foreign);for(const name of ['drawElements','drawArraysInstanced','drawElementsInstanced'])assert.deepEqual(Object.getOwnPropertyDescriptor(f.GL2.prototype,name),f.originals[name]);
  const g=browserFixture();g.context.performance.now=()=>{throw undefined;};const gl=new g.GL2();assert.equal(gl.drawArrays(1,2,3),37);assert.equal(g.calls.length,1);const s=g.snapshot();assert.equal(s.observerIncomplete,true);assert.equal(s.observerErrorPresent,true);assert.equal(s.observerErrorKind,'undefined');assert.strictEqual(g.GL2.prototype.drawArrays,g.originals.drawArrays.value);
  const h=browserFixture({preexisting:{foreign:true}});assert.equal(h.api,null);assert.equal(h.window.__zk682ReadinessRender66.foreign,true);assert.strictEqual(h.GL2.prototype.drawArrays,h.originals.drawArrays.value);
});

test('R66 SYNTHETIC course route canvas and context identities isolate duplicate disconnected and replacement lifecycle',()=>{
  const f=browserFixture(),old=new f.GL2(),foreignCanvas={isConnected:true},foreign=new f.GL2(foreignCanvas);old.drawArrays(1,2,3);foreign.drawArrays(1,2,3);const newCanvas=f.replace(),fresh=new f.GL2(newCanvas);f.mutate();old.drawArrays(1,2,3);fresh.drawArrays(1,2,3);const s=f.snapshot();assert.equal(s.flags.replaced,true);assert.equal(s.observerIncomplete,true);assert.equal(s.contexts.length,2);assert.notEqual(s.contexts[0].canvasId,s.contexts[1].canvasId);assert.equal(s.contexts[0].methods[0].invocations,1);assert.equal(s.contexts[1].methods[0].invocations,1);assert.equal(s.foreignDraws,4); // invocation+return of foreign and retired context
  for(const kind of ['duplicate','disconnect']){const g=browserFixture();g[kind]();g.mutate();new g.GL2().drawArrays(1,2,3);const t=g.snapshot();assert.equal(t.contexts.length,0);assert.equal(t.flags[kind==='duplicate'?'duplicate':'disconnected'],true);assert.equal(t.observerIncomplete,true);}
  const other=browserFixture({route:'http://127.0.0.1:5199/'});new other.GL2().drawArrays(1,2,3);const o=other.snapshot();assert.equal(o.routeEligible,false);assert.equal(o.contexts.length,0);assert.equal(o.observerIncomplete,true);assert.equal(o.stopReason,'route-ineligible');assert.strictEqual(other.GL2.prototype.drawArrays,other.originals.drawArrays.value);
});

test('R66 SYNTHETIC visibility preserves installed Playwright rule and original nonzero truthiness once',()=>{
  const f=browserFixture();f.style({opacity:'0'});f.mutate();assert.equal(f.snapshot().records.some(x=>x.name==='visible'),true,'opacity is not the PW visibility predicate');
  for(const kind of ['hidden','zero']){const g=browserFixture({enabled:false});g.hidden(kind==='hidden');if(kind==='zero')g.rect({width:0});g.context.options.enabled=true;const api=runInNewContext('('+installBrowserReadinessRenderObserver.toString()+')(options)',g.context);assert.equal(structuredClone(api.snapshot()).records.some(x=>x.name==='visible'),false);}
  const h=browserFixture();for(const value of [null,undefined,false,0,''])assert.strictEqual(h.api.markNonzero(value),value);assert.equal(h.snapshot().records.some(x=>x.name==='nonzero-predicate'),false);
  const k=browserFixture();assert.equal(k.api.markNonzero(true),true);assert.equal(k.api.markNonzero(true),true);assert.equal(k.snapshot().records.filter(x=>x.name==='nonzero-predicate').length,1);
  const generated=transformReadinessProducer(donor,optionsFor(tmpdir())),from=generated.indexOf('await page.waitForFunction(() => {\n  const target ='),to=generated.indexOf('}, null, { timeout: FIXTURE_READY_TIMEOUT_MS });',from);assert(from>=0&&to>from);const actual=generated.slice(from+'await page.waitForFunction('.length,to)+'}';
  for(const node of [null,{width:0,clientWidth:0,height:1,clientHeight:1},{width:2,height:1}]){let marks=0;const context={document:{querySelector:()=>node},window:{__zk682ReadinessRender66:{markNonzero:value=>{assert.equal(Boolean(value),true);marks++;}}}};const value=runInNewContext('('+actual+')()',context);const expected=node&&(node.width||node.clientWidth)>0&&(node.height||node.clientHeight)>0;assert.strictEqual(value,expected);assert.equal(marks,expected?1:0);}
});

test('R66 SYNTHETIC callback longtask context clock caps freeze unknown and release owned descriptors',()=>{
  const f=browserFixture();for(let i=0;i<512;i++)f.raf();const s=f.snapshot();assert.equal(s.callbacks,512);assert.equal(s.stopReason,'callback-cap');assert.equal(s.observerIncomplete,true);assert(s.records.length<=12);assert(s.longtasks.length<=256);assert(Buffer.byteLength(JSON.stringify(s))<=65536);assert.equal(f.stopped().mutation,true);assert.equal(f.stopped().tasks,true);assert.strictEqual(f.GL2.prototype.drawArrays,f.originals.drawArrays.value);
  const g=browserFixture();g.longtasks(Array.from({length:257},(_,i)=>({startTime:i,duration:1})));const t=g.snapshot();assert.equal(t.longtasks.length,256);assert.equal(t.stopReason,'longtask-cap');assert.equal(t.observerIncomplete,true);
  const h=browserFixture();for(let i=0;i<9;i++)new h.GL2().drawArrays(1,2,3);const u=h.snapshot();assert.equal(u.contexts.length,8);assert.equal(u.stopReason,'context-cap');assert.equal(h.calls.length,9);
  const k=browserFixture();k.setNow(1);k.mutate();assert.equal(k.snapshot().observerIncomplete,true);
  const n=browserFixture();const hide=n.events.get('pagehide');hide();const v=n.snapshot();assert.equal(v.stopReason,'navigation');assert.equal(v.observerIncomplete,true);assert.strictEqual(n.GL2.prototype.drawArrays,n.originals.drawArrays.value);
});

test('R66 SYNTHETIC unsupported GL2 longtask and immutable snapshots never claim GPU or presentation proof',()=>{
  for(const spec of [{glUnsupported:true},{longtaskUnsupported:true}]){const f=browserFixture(spec),s=f.snapshot();assert.equal(s.observerIncomplete,true);assert.equal(s.stopReason,'unsupported-capability');assert.strictEqual(f.GL2.prototype.drawArrays,f.originals.drawArrays.value);assert.equal(f.stopped().mutation,true);}
  const f=browserFixture(),snapshot=f.api.snapshot();assert.equal(snapshot.clockDomain,'browser-document-performance');assert.equal(snapshot.timeOriginMs,1000000);assert.equal(snapshot.originMs,10);assert(Object.isFrozen(snapshot));assert(Object.isFrozen(snapshot.records));const before=JSON.stringify(snapshot),browserTypeError=runInNewContext('TypeError',f.context);assert.notStrictEqual(browserTypeError,TypeError);assert.throws(()=>{snapshot.records.push({});},error=>error instanceof browserTypeError&&error.name==='TypeError');assert.equal(JSON.stringify(snapshot),before);assert(Object.isFrozen(snapshot.records));assert.strictEqual(f.api.snapshot(),snapshot);assert.match(snapshot.qualification,/GPU.*UNKNOWN/);assert.match(snapshot.qualification,/no host\/browser crossclock/);
});

test('R66 SYNTHETIC opaque count and hostile receiver do not introduce coercion or own canvas getter reads',()=>{
  for(const primary of [undefined,null,false,0,'']){let coercions=0;const count={valueOf(){coercions++;throw primary;}},f=browserFixture({coerceNative:true}),gl=new f.GL2();let caught=false,value;try{gl.drawArrays(1,0,count);}catch(error){caught=true;value=error;}assert.equal(caught,true);assert.strictEqual(value,primary);assert.equal(coercions,1);assert.equal(f.calls.length,1);const s=f.snapshot();assert.equal(s.flags.opaqueDrawArguments,true);assert.equal(s.observerIncomplete,true);assert.equal(s.contexts[0].methods[0].opaqueCountInvocations,1);assert.equal(s.contexts[0].methods[0].positiveCountInvocations,0);}
  const f=browserFixture(),gl=new f.GL2();let reads=0;Object.defineProperty(gl,'canvas',{get(){reads++;throw false;}});assert.equal(gl.drawArrays(1,0,3),37);assert.equal(reads,0);assert.equal(f.calls.length,1);assert.equal(f.snapshot().contexts[0].methods[0].positiveCountReturns,1);
  const g=browserFixture(),target=new g.GL2();let prototypeReads=0;const proxy=new Proxy(target,{getPrototypeOf(object){prototypeReads++;return Reflect.getPrototypeOf(object);},get(){throw undefined;}});const original=g.originals.drawArrays.value;let baselineError,before=prototypeReads;try{Reflect.apply(original,proxy,[1,0,3]);}catch(error){baselineError=error;}const baselineReads=prototypeReads-before;g.calls.length=0;before=prototypeReads;let wrappedError;try{Reflect.apply(g.GL2.prototype.drawArrays,proxy,[1,0,3]);}catch(error){wrappedError=error;}assert.strictEqual(wrappedError,baselineError);assert.equal(prototypeReads-before,baselineReads);assert.equal(g.calls.length,1);g.snapshot();
});

test('R66 SYNTHETIC actual initScript and final evidence callbacks retain original storage and GL call inventory',()=>{
  const extract=(source,start,end)=>{const a=source.indexOf(start);assert(a>=0);const z=source.indexOf(end,a);assert(z>a);return source.slice(a+start.length,z)+'}';};
  const initStart='await page.addInitScript(() => {\n',initEnd='});\nconst coldStartedAt';
  const evidenceStart='const browserEvidence = await page.evaluate(() => {\n',evidenceEnd='});\nawait browser.close();';
  const originalInit='() => {\n'+extract(donor,initStart,initEnd),originalEvidence='() => {\n'+extract(donor,evidenceStart,evidenceEnd);
  for(const enabled of [false,true]){
    const generated=transformReadinessProducer(donor,optionsFor(tmpdir(),enabled)),f=browserFixture({enabled:false}),storage=[],queries=[];
    f.context.localStorage={setItem:(...args)=>storage.push(args)};
    runInNewContext('('+('() => {\n'+extract(generated,initStart,initEnd))+')()',f.context);
    assert.deepEqual(storage,[['coursecraft_perfhud','on'],['coursecraft_ambience','on']]);
    if(enabled){new f.GL2().drawArrays(1,0,3);f.window.__zk682ReadinessRender66.markNonzero(true);}
    f.canvas.getContext=name=>{queries.push(name);return null;};
    const query=f.context.document.querySelectorAll;f.context.document.querySelectorAll=selector=>selector==='canvas'?[f.canvas]:query(selector);
    Object.assign(f.context,{navigator:{userAgent:'SYNTHETIC'},innerWidth:1440,innerHeight:900,devicePixelRatio:1});f.context.document.visibilityState='visible';
    const evidence=structuredClone(runInNewContext('('+('() => {\n'+extract(generated,evidenceStart,evidenceEnd))+')()',f.context));
    assert.deepEqual(queries,['webgl2','webgl']);queries.length=0;
    const baseline=structuredClone(runInNewContext('('+originalEvidence+')()',f.context));assert.deepEqual(queries,['webgl2','webgl']);
    const {readinessRenderDiagnostic,...originalFields}=evidence;assert.deepEqual(originalFields,baseline);
    assert.equal(readinessRenderDiagnostic===null,!enabled);if(enabled){assert.equal(readinessRenderDiagnostic.driverCommit,'a'.repeat(40));assert.equal(readinessRenderDiagnostic.contexts[0].methods[0].positiveCountReturns,1);}
    storage.length=0;runInNewContext('('+originalInit+')()',f.context);assert.deepEqual(storage,[['coursecraft_perfhud','on'],['coursecraft_ambience','on']]);
  }
});

test('R66 SYNTHETIC frozen browser schema accepts qualified observations and types absent unsupported or malformed evidence',async()=>{
  const {validateBrowserSnapshot}=await import('./zk682-current-readiness-render-diagnostic.mjs');const options={expectedDriver:'a'.repeat(40)};
  const f=browserFixture();new f.GL2().drawArrays(1,0,3);f.api.markNonzero(true);f.raf();const s=f.snapshot();const valid=validateBrowserSnapshot(s,options);assert.equal(valid.valid,true);assert.equal(valid.complete,true);assert.equal(valid.credit,false);assert.equal(valid.positiveCountReturns,1);assert.equal(valid.drawObservation,'primitive-positive-count-normal-return');
  assert.equal(validateBrowserSnapshot(null,options).status,'UNKNOWN');const u=browserFixture({glUnsupported:true}).snapshot();assert.equal(validateBrowserSnapshot(u,options).complete,false);
  for(const mutate of [x=>x.targetCommit='b'.repeat(40),x=>x.driverCommit='c'.repeat(40),x=>x.clockDomain='host-node-performance',x=>x.records.push(x.records[0]),x=>x.callbacks=513,x=>x.contexts[0].methods[0].returns=2,x=>x.flags.duplicate='false',x=>x.extra=true]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateBrowserSnapshot(bad,options));}
});

test('R66 SYNTHETIC pinned installed Chromium visibility implementation matches actual observer samples',()=>{
  const bundle=process.env.ZK682_READINESS_PW_BUNDLE||join(dirname(donorPath),'../node_modules/playwright-core/lib/coreBundle.js'),fd=openSync(bundle,'r'),bytes=Buffer.alloc(2200);try{assert.equal(readSync(fd,bytes,0,2200,831553),2200);}finally{closeSync(fd);}assert.equal(createHash('sha256').update(bytes).digest('hex'),'b174d660a825c6caaea893551ece7e8435dd81f731da8f519eb5947ec709cb1b');
  const decoded=bytes.toString().replace(/\\n/g,'\n').replace(/\\"/g,'"'),oracleSource=decoded.slice(0,decoded.indexOf('function elementSafeTagName'))+'\nisElementVisible(node);';assert(oracleSource.includes('function computeBox(')&&oracleSource.includes('function isElementVisible('));
  for(const kind of ['visible','opacity0','hidden','zero','contents']){
    const f=browserFixture({enabled:false});if(kind==='opacity0')f.style({opacity:'0'});if(kind==='hidden')f.hidden(true);if(kind==='zero')f.rect({width:0});if(kind==='contents'){f.style({display:'contents'});const child=Object.create(f.context.HTMLCanvasElement.prototype);Object.assign(child,{nodeType:1,firstChild:null,nextSibling:null,getBoundingClientRect:()=>({width:1,height:1})});f.canvas.firstChild=child;const style=f.window.getComputedStyle;f.window.getComputedStyle=node=>node===f.canvas?style(node):{display:'block',visibility:'visible'};}
    const expected=runInNewContext(oracleSource,{Element:f.context.Element,node:f.canvas,getElementComputedStyle:node=>f.window.getComputedStyle(node),globalOptions:{browserNameForWorkarounds:'chromium'}});
    f.context.options.enabled=true;const api=runInNewContext('('+installBrowserReadinessRenderObserver.toString()+')(options)',f.context),s=structuredClone(api.snapshot());assert.equal(s.records.some(row=>row.name==='visible'),expected,kind);
  }
});

test('R66 SYNTHETIC native mode coercion and descriptor flag ownership remain transparent',()=>{
  for(const primary of [undefined,null,false,0,'']){let coercions=0;const mode={valueOf(){coercions++;throw primary;}},f=browserFixture({coerceMode:true});let caught=false,value;try{new f.GL2().drawArrays(mode,0,3);}catch(error){caught=true;value=error;}assert.equal(caught,true);assert.strictEqual(value,primary);assert.equal(coercions,1);assert.equal(f.calls.length,1);f.snapshot();}
  const f=browserFixture(),installed=Object.getOwnPropertyDescriptor(f.GL2.prototype,'drawArrays');Object.defineProperty(f.GL2.prototype,'drawArrays',{...installed,enumerable:true});f.snapshot();assert.deepEqual(Object.getOwnPropertyDescriptor(f.GL2.prototype,'drawArrays'),{...installed,enumerable:true});
});
test('R66 SYNTHETIC one-shot rAF completes while lifecycle and longtask observation continue',()=>{
  const f=browserFixture();new f.GL2().drawArrays(1,0,3);f.api.markNonzero(true);f.raf();for(let i=0;i<600;i++)f.raf();f.longtasks([{startTime:12,duration:5}]);f.replace();f.mutate();const s=f.snapshot();assert(s.callbacks<512);assert.equal(s.records.filter(row=>row.name==='first-rAF-after-draw').length,1);assert.equal(s.longtasks.length,1);assert.equal(s.flags.replaced,true);assert.equal(s.stopReason,'snapshot');assert.equal(s.observerIncomplete,true);
});
