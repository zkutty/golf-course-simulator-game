// ROOT-only RAM controls. No browser, sockets, timers, native GL or filesystem writes.
// Actual serialized producer, installed Pixi dispatch, native owner/session and gates run as source blocks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
const defaults = {
  helper: "../src/utils/startupRenderObservation.mjs", perf: "./perf-smoke.mjs",
  pixi: "../src/ui/PixiStage.tsx", owner: "../src/ui/renderer/nativeRendererOwner.ts",
  session: "../src/ui/renderer/nativeRendererSession.ts", core: "../src/utils/startupAttribution.mjs",
  gate: "./perf-readiness-budget.mjs", ticker: "../node_modules/pixi.js/lib/ticker/Ticker.mjs",
  listener: "../node_modules/pixi.js/lib/ticker/TickerListener.mjs",
  plugin: "../node_modules/pixi.js/lib/app/TickerPlugin.mjs",
  application: "../node_modules/pixi.js/lib/app/Application.mjs",
  registration: "../node_modules/pixi.js/lib/app/init.mjs",
};
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === "--groups") { assert.ok(process.argv[i + 1]); options.groups = process.argv[++i].split(","); }
  else if (key === "--counterfactual-old") options.old = true;
  else {
    assert.ok(key.startsWith("--") && key.slice(2) in defaults, "unknown target option");
    assert.ok(process.argv[i + 1], "target path required"); options[key.slice(2)] = process.argv[++i];
  }
}
const source = Object.fromEntries(Object.entries(defaults).map(([key, relative]) =>
  [key, readFileSync(options[key] ?? fileURLToPath(new URL(relative, import.meta.url)), "utf8")]));
const hash = s => createHash("sha256").update(s).digest("hex");
const expected = {
  perf: "6ae1dc23fdf635e55aec4841fb1bc83b17cfd246ea9ccecc6fb730677afc25f7",
  owner: "b13730d2af8a162a46432356f3d4148fbc5af2342ab3291d402542207779d38c",
  session: "374a1b70ab4a1084129817301e5860011ea4ac1223d68f892ea778f528d2c138",
  core: "e1c76958a21408f4c550965acc9b6f5efe3a94a73c5024f055cbab926d66458b",
  ticker: "596910a4265c92fbf2d37a9a66001ba6b0c2585dfb74256a05f9069b1c4a3ce7",
  listener: "956b672713c70376febd7fbd4f7576f076997991abfc609631854193c48cc8e9",
  plugin: "bb1c1e6c1cee827336f6344602273b555cab8a9a5d7a7d131a2d96ad26aaa49d",
  application: "8b4ad57b5b4ea1aa0ee104c4405c25716c5f7de6c8df71c71b6c2f2b3e4bb9ed",
  registration: "5fc9a7fa0da36862c42007c1c9a2322700dc171d5b551db8eead0d18e115398d",
};
for (const [key, pin] of Object.entries(expected)) assert.equal(hash(source[key]), pin, key + " protected pin");
const unique = (s, a) => { assert.equal(s.split(a).length - 1, 1, "unique source anchor: " + a); return s.indexOf(a); };
const block = (s, a, b) => s.slice(unique(s, a), unique(s, b));
const execute = (code, ctx) => new Script(code).runInContext(ctx);
const plain = x => JSON.parse(JSON.stringify(x));
const stripModule = s => s.replace(/^import .*;\n/gm, "").replace(/^export \{[^\n]*\};\n/gm, "");
const init = block(source.perf, "await page.addInitScript(", "\nconst coldStartedAt");
const factory = block(source.pixi, "function createNativeRendererOwner():", "\n\nexport function PixiStage")
  .replace("function createNativeRendererOwner(): NativeRendererOwner<PIXI.Application, PIXI.Texture, NativeRendererConfiguration>",
    "function createNativeRendererOwner()");
assert.ok(factory.startsWith("function createNativeRendererOwner() {"));
if (!options.old) {
  unique(source.pixi,"observeStartupRenderer(app.renderer, app.ticker);");
  unique(source.pixi,"activateStartupRenderer(app.renderer, app.ticker);");
}
const tailStart = unique(source.pixi, "      owner.markReady(generation);");
const tailEndAnchor = "      devLog(`initialized ${width}x${height}`);";
const tailEnd = unique(source.pixi, tailEndAnchor);
const postLayer = source.pixi.slice(tailStart, tailEnd + tailEndAnchor.length);
const evidenceBlock = block(source.perf, "let { startupRenderObservation, ...browserEvidence } = await page.evaluate(", "\nlet startupJournalRaw");
const ownerJS = stripTypeScriptTypes(source.owner).replace(/^export /gm, "");
const sessionJS = stripTypeScriptTypes(source.session).replace(/^export /gm, "");
const coreJS = source.core.slice(0, unique(source.core, "\nlet recorder = null;")).replace(/^export /gm, "");
const gateJS = source.gate.replace(/^export /gm, "");
const decodedCache = new WeakMap(), wireForDecoded = new WeakMap();
const codecContext = createContext({ TextEncoder });
execute(source.helper.replace(/^export /gm, ""), codecContext);
function semanticView(wire) {
  if (wire === null || wire === undefined) return wire;
  if (!decodedCache.has(wire)) { const view = codecContext.decodeStartupRenderObservation(wire); decodedCache.set(wire, view); wireForDecoded.set(view, wire); }
  return decodedCache.get(wire);
}
const quiet = { log() {}, error() {} };
async function environment(overrides = {}) {
  const state = { now: 1, duration: 5, normalWork: 0, calls: 0, updateCalls: 0, returned: {},
    initCalls: 0, order: [], storage: [], observers: [], disconnects: 0, rafs: new Map(), rafSerial: 0,
    rafRequests: 0, cancels: 0, starts: 0, stops: 0, destroys: 0, installCalls: 0, activateCalls: 0,
    throwPresent: false, thrown: undefined, initFailurePresent: false, initFailure: undefined,
    updateReturnPresent: false, updateReturned: undefined, ready: [] };
  Object.assign(state, overrides);
  class Observer {
    static supportedEntryTypes = state.unsupported ? [] : ["longtask"];
    constructor(callback) { if (state.observerCtorFault) throw null; this.callback = callback; this.pending = []; state.observers.push(this); }
    observe(value) { assert.deepEqual(plain(value), { type: "longtask", buffered: true }); if (state.observeFault) throw false; }
    takeRecords() { if (state.takeFault) throw 0; const rows = this.pending; this.pending = []; return rows; }
    disconnect() { state.disconnects++; if (state.disconnectFault) throw undefined; }
  }
  class Renderer {
    constructor() { this.canvas = { remove() { state.order.push("detach"); } }; }
    render(...args) {
      state.order.push("draw"); state.calls++; state.renderReceiver = this; state.renderArgs = args;
      state.now += state.duration; if (state.throwPresent) throw state.thrown; return state.returned;
    }
    resize() { state.order.push("resize"); }
    destroy() { state.destroys++; state.order.push("destroy"); }
    generateTexture() { throw new Error("unused texture port"); }
  }
  const sandbox = {
    URLSearchParams, TextEncoder, queueMicrotask, console: quiet, state,
    location: { search: state.optout ? "?perfFixture=1&perfMeasure=1" : "?m27Fixture=1&perfMeasure=1" },
    performance: { now() { if (state.clockFault) throw null; return state.now; }, timeOrigin: 100000 },
    localStorage: { setItem(key, value) { state.storage.push([key, value]); } }, PerformanceObserver: Observer,
    requestAnimationFrame(callback) { state.rafRequests++; const id = ++state.rafSerial; state.rafs.set(id, callback); return id; },
    cancelAnimationFrame(id) { state.cancels++; state.rafs.delete(id); },
    UPDATE_PRIORITY: { NORMAL: 0, LOW: -25 }, ExtensionType: { Application: "application" },
    Container: class { destroy() {} }, ApplicationInitHook: {}, deprecation() {}, v8_0_0: "8.0.0",
    async autoDetectRenderer(config) {
      state.order.push("init"); state.initCalls++; assert.equal(config.autoDensity, true);
      assert.equal("autoStart" in config, false); assert.equal("sharedTicker" in config, false);
      if (state.initFailurePresent) throw state.initFailure; return new Renderer();
    },
    navigator: { userAgent: "pure-control" }, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    document: { visibilityState: "visible", querySelectorAll() { return []; } }, TILE_W: 64, TILE_H: 32,
  };
  const ctx = createContext(sandbox);
  execute("this.window = {};", ctx);
  assert.equal(execute("window !== globalThis && Object.getPrototypeOf(window) === Object.prototype", ctx), true);
  execute(stripModule(source.listener) + "\n" + stripModule(source.ticker) + "\n" +
    stripModule(source.plugin) + "\nthis.Ticker=Ticker; this.TickerPlugin=TickerPlugin;", ctx);
  // The real registration body invokes this external extension-protocol seam.
  // ResizePlugin/global hooks and native GL are outside the admitted control scope.
  const registered=[]; sandbox.ResizePlugin={externalModule:true};
  sandbox.extensions={
    handleByList(type,plugins){assert.equal(type,"application");plugins.push(...registered);},
    add(plugin){if(plugin===sandbox.TickerPlugin){state.tickerRegistrations=(state.tickerRegistrations??0)+1;registered.push(plugin);}},
  };
  execute(stripModule(source.registration),ctx); assert.equal(state.tickerRegistrations,1);
  execute(stripModule(source.application) + "\nthis.PIXI={Application};", ctx);
  const start = sandbox.Ticker.prototype.start, stop = sandbox.Ticker.prototype.stop;
  sandbox.Ticker.prototype.start = function(...args) { state.starts++; return Reflect.apply(start, this, args); };
  sandbox.Ticker.prototype.stop = function(...args) { state.stops++; return Reflect.apply(stop, this, args); };
  execute(source.helper.replace(/^export /gm, ""), ctx);
  sandbox.page = {
    async addInitScript(callback) { state.addInitCount = (state.addInitCount ?? 0) + 1; execute("(" + callback.toString() + ")()", ctx); },
    async evaluate(callback) { state.evaluateCount = (state.evaluateCount ?? 0) + 1; return callback(); },
  };
  await execute("(async () => {" + init + "})()", ctx);
  assert.equal(state.addInitCount, 1);
  assert.deepEqual(state.storage, [["coursecraft_perfhud", "on"], ["coursecraft_ambience", "on"]]);
  execute(ownerJS + "\n" + sessionJS + "\n" + factory +
    "\nthis.makeSession=()=>new NativeRendererSession(createNativeRendererOwner);", ctx);
  const install = sandbox.observeStartupRenderer, activate = sandbox.activateStartupRenderer;
  sandbox.observeStartupRenderer = function(...args) {
    state.order.push("install"); state.installCalls++;
    // Invoke preparation before the real collector wraps the current native ticker.
    if (state.prepareTicker) state.prepareTicker(args[1], args[0]);
    if (args[1] && !state.noUpdateSpy) {
      const update = args[1].update;
      args[1].update = function(...values) {
        state.updateCalls++; state.updateReceiver = this; state.updateArgs = values;
        const result = Reflect.apply(update, this, values);
        return state.updateReturnPresent ? state.updateReturned : result;
      };
    }
    return Reflect.apply(install, this, args);
  };
  sandbox.activateStartupRenderer = function(...args) {
    state.order.push("activate"); state.activateCalls++; return Reflect.apply(activate, this, args);
  };
  sandbox.postLayer = execute("(function(owner,generation,app) { const width=100,height=100;" +
    "const startupLayerSpan={}; const setAppReady=v=>{state.ready.push(v);state.order.push('ready');};" +
    "const startupEnd=()=>state.order.push('layer-end'); const devLog=()=>state.order.push('log');" + postLayer + "})", ctx);
  const session = sandbox.makeSession(), config = { width: 100, height: 100, resolution: 1, antialias: true };
  const lease = session.claim(config);
  return {
    state, sandbox, ctx, session, lease, config,
    acquire: () => lease.owner.acquire(lease.generation),
    activate(app, current = lease) { sandbox.postLayer(current.owner, current.generation, app); },
    collector: () => { const port = sandbox.window.__ccStartupRenderObservation;
      return port && { ...port, snapshot() { return semanticView(port.snapshot()); } }; },
    fire(time) {
      const first = state.rafs.entries().next().value; assert.ok(first, "actual plugin scheduled RAF");
      state.rafs.delete(first[0]); state.now = time; return first[1](time);
    },
    async publish() { const result = await execute("(async()=>{" + evidenceBlock + "\nreturn {startupRenderObservation,browserEvidence};})()", ctx);
      result.startupRenderObservation = semanticView(result.startupRenderObservation); return result; },
  };
}
async function active(overrides = {}) {
  const env = await environment(overrides), app = await env.acquire(); env.activate(app);
  app.ticker.add(() => { env.state.now += env.state.normalWork; }, null, 0);
  return { env, app };
}
function unknown(snap) {
  for (const field of ["trusted","numericPass","releaseCleared","candidateQualified","browserDocumentIdentity"]) assert.equal(snap[field], false, field);
  for (const row of [...snap.draws, ...(snap.tickRows ?? [])]) {
    assert.equal(row.generation, null); assert.equal(row.attempt, null); assert.equal(row.cohortQualified, false);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(wireForDecoded.get(snap) ?? snap)) <= 8192, "canonical wire alone is capped");
}
function held(snap) { assert.equal(snap.status,"HOLD"); assert.equal(snap.eligible,false); unknown(snap); }
function complete(snap) {
  assert.equal(snap.status,"COMPLETE"); assert.equal(snap.eligible,true); unknown(snap);
  assert.ok(snap.tickRows.length > 0 && snap.draws.length > 0);
}
if (options.old) {
  assert.equal(hash(source.helper), "cc4b7da47afd6fefb35a60f7a11a00b12f3469f5a1bae31f6b61650dfe626b70");
  assert.equal(hash(source.pixi), "a7035f0a487b68258e898370249f3ca6b52c20240dc613b150b8dc210b6abdc8");
  const { env } = await active({ duration: 5000 });
  env.fire(10);
  const result = await env.publish();
  assert.equal(env.state.initCalls,1); assert.equal(env.state.calls,1);
  assert.equal(result.startupRenderObservation.draws[0].duration,5000);
  console.log("OLD_ACTUAL_INIT_RAF_UPDATE_DRAW_EXECUTED init=1 draw=1 duration=5000");
  assert.ok(result.startupRenderObservation.tickRows?.length > 0, "OLD_COLLECTOR_MISSING_TICK_OBSERVATION");
}
const groups = [];
async function group(name, fn) { if (options.groups && !options.groups.includes(name)) return; await fn(); groups.push(name); console.log("PASS " + name); }

await group("installed-dynamic-RAF-native-placement-and-two-timing-cases", async () => {
  for (const normalWork of [995,0]) {
    const { env, app } = await active({ normalWork });
    const raf = app.ticker._tick, originalRequests = env.state.rafRequests;
    assert.equal(env.state.starts,1); assert.equal(originalRequests,1);
    assert.equal(Object.getOwnPropertyDescriptor(app.ticker,"update").value,app.ticker.update);
    assert.equal(env.fire(10),undefined);
    assert.equal(app.ticker._tick,raf); assert.equal(env.state.rafRequests,originalRequests+1);
    assert.equal(env.state.updateCalls,1); assert.equal(env.state.calls,1);
    assert.equal(env.state.updateReceiver,app.ticker); assert.deepEqual(env.state.updateArgs,[10]);
    assert.deepEqual(env.state.order,["init","install","ready","layer-end","activate","log","draw"]);
    env.state.observers[0].pending=[{ startTime:10,duration:1000 }];
    env.state.now=Math.max(env.state.now,1010);
    const result = await env.publish(), snap = result.startupRenderObservation;
    complete(snap); assert.equal(snap.tickRows[0].duration,normalWork+5);
    assert.equal(snap.draws[0].duration,5); assert.equal(snap.longTasks[0].duration,1000);
    assert.equal(snap.tickRows[0].outcome,"returned"); assert.equal(snap.capture.installedTickers,1);
    assert.equal(snap.capture.limits.tickRows,16); assert.equal(snap.capture.limits.bytes,8192);
    assert.equal(env.state.evaluateCount,1); assert.equal(env.state.disconnects,1);
    assert.deepEqual(plain(result.browserEvidence),{ userAgent:"pure-control",
      viewport:{width:1440,height:900,devicePixelRatio:1},visibilityState:"visible",renderer:null,vendor:null,context:null });
    assert.deepEqual(plain(env.collector().snapshot()), plain(snap), "decoded views preserve the cached wire values");
    assert.ok(Object.isFrozen(snap.tickRows)&&Object.isFrozen(snap.tickRows[0]));
    env.fire(2000); assert.equal(env.state.calls,2); assert.equal(snap.tickRows.length,1);
    assert.equal(env.state.disconnects,1);
    // No task-minus-call residual or causal classification is asserted.
  }
});

// The inherited prototype descriptor is the current native production shape.
{
  const {env}=await active({noUpdateSpy:true}); env.fire(10);
  complete(env.collector().snapshot()); assert.equal(env.state.calls,1); assert.equal(env.state.updateCalls,0);
}
for(const flags of [{writable:false,configurable:true,enumerable:false},{writable:true,configurable:false,enumerable:true}]){
  const {env,app}=await active({noUpdateSpy:true,prepareTicker(ticker){
    Object.defineProperty(ticker,"update",{value:ticker.update,...flags});
  }});
  const actual=Object.getOwnPropertyDescriptor(app.ticker,"update");
  for(const key of ["writable","configurable","enumerable"])assert.equal(actual[key],flags[key]);
  env.fire(10);complete(env.collector().snapshot());assert.equal(env.state.calls,1);
}

await group("raw-update-and-render-semantics-all-falsy-faults", async () => {
  const sentinel = {};
  for (const returned of [null,false,0,undefined,sentinel,Promise.resolve(9)]) {
    const { env, app } = await active({ updateReturnPresent:true,updateReturned:returned,returned });
    const receiver = Object.create(app.ticker), args=[10,null,false,0,undefined,sentinel];
    env.state.now=10;
    assert.equal(Reflect.apply(app.ticker.update,receiver,args),returned);
    assert.equal(env.state.updateReceiver,receiver);
    args.forEach((arg,i)=>assert.equal(env.state.updateArgs[i],arg));
    assert.equal(env.state.updateCalls,1); assert.equal(env.state.calls,1);
    complete(env.collector().snapshot());
    const { env:r,app:a } = await active({ returned });
    const rr={}, ra=[sentinel,null,false,0,undefined];
    assert.equal(Reflect.apply(a.renderer.render,rr,ra),returned);
    assert.equal(r.state.renderReceiver,rr); ra.forEach((arg,i)=>assert.equal(r.state.renderArgs[i],arg));
    assert.equal(r.state.calls,1); held(r.collector().snapshot());
    assert.equal(r.collector().snapshot().failure,"TICKER_INCOMPLETE");
  }
  let inspected=0;
  const hostile=Object.defineProperty({},"message",{get(){inspected++;throw 99;}});
  for (const thrown of [null,false,0,undefined,hostile]) {
    for (const clockFault of [false,true]) {
      const { env } = await active({throwPresent:true,thrown});
      env.state.clockFault=clockFault;
      let caught=false,value;
      try { env.fire(10); } catch(error) {caught=true;value=error;}
      assert.ok(caught); assert.equal(value,thrown);
      assert.equal(env.state.calls,1); assert.equal(env.state.updateCalls,1);
      const snap=env.collector().snapshot(); unknown(snap);
      assert.equal(snap.tickRows[0].outcome,"threw"); assert.equal(snap.draws[0].outcome,"threw");
      if(clockFault) held(snap);
    }
  }
  assert.equal(inspected,0);
  for (const bad of [NaN,Infinity,-1,0]) {
    const { env,app } = await active(); env.state.now=bad;
    app.ticker.update(10); held(env.collector().snapshot());
    assert.equal(env.state.calls,1); assert.equal(env.state.updateCalls,1);
  }
});

await group("preactivation-reuse-current-binding-dispatch-and-descriptors", async () => {
  {
    const env=await environment(),app=await env.acquire();
    const wrapper=app.ticker.update,render=app.renderer.render;
    env.fire(10); env.activate(app); env.collector().install(app.renderer,app.ticker); env.fire(20);
    assert.equal(app.ticker.update,wrapper); assert.equal(app.renderer.render,render);
    const snap=env.collector().snapshot(); complete(snap);
    assert.equal(snap.tickRows.length,1); assert.equal(snap.draws.length,1);
    assert.equal(snap.capture.preActivationTickCalls,1); assert.equal(snap.capture.installedTickers,1);
    assert.equal(env.state.calls,2); assert.equal(env.state.updateCalls,2);
  }
  for (const field of ["update","_tick"]) {
    const {env,app}=await active(); env.fire(10);
    if(field==="update") app.ticker.update=()=>9; else app.ticker._tick=()=>9;
    env.collector().activate(app.renderer,app.ticker);
    const snap=env.collector().snapshot(); held(snap);
    assert.equal(snap.failure,field==="update"?"TICKER_WRAPPER_CHANGED":"TICKER_DISPATCH_CHANGED");
    assert.equal(snap.capture.late,true);
    if(field==="update") assert.equal(app.ticker.update(),9); else assert.equal(app.ticker._tick(),9);
  }
  {
    const {env,app}=await active(); env.fire(10);
    env.collector().activate(app.renderer,new env.sandbox.Ticker());
    const snap=env.collector().snapshot(); held(snap); assert.equal(snap.failure,"TICKER_ACTIVATION_WITHOUT_INSTALL");
  }
  for (const kind of ["missing","accessor","readonly","nonextensible","noRAF","getterRAF"]) {
    const env=await environment(); const app=new env.sandbox.PIXI.Application();
    await app.init({ ...env.config, autoDensity:true });
    const ticker=app.ticker; let getters=0;
    if(kind==="accessor") Object.defineProperty(ticker,"update",{get(){getters++;throw 0;},configurable:true});
    if(kind==="readonly") Object.defineProperty(ticker,"update",{value:ticker.update,writable:false,configurable:false});
    if(kind==="nonextensible") Object.preventExtensions(ticker);
    if(kind==="noRAF") delete ticker._tick;
    if(kind==="getterRAF") Object.defineProperty(ticker,"_tick",{get(){getters++;throw undefined;},configurable:true});
    env.collector().install(app.renderer,kind==="missing"?undefined:ticker);
    const snap=env.collector().snapshot(); held(snap); assert.equal(getters,0);
    assert.equal(snap.failure,{missing:"TICKER_MISSING",accessor:"TICKER_METHOD",readonly:"TICKER_DESCRIPTOR",
      nonextensible:"TICKER_DESCRIPTOR",noRAF:"TICKER_DISPATCH",getterRAF:"TICKER_DISPATCH"}[kind]);
    assert.equal(app.renderer.render(),env.state.returned); assert.equal(env.state.calls,1);
  }
  {
    const {env,app}=await active(); env.fire(10);
    env.collector().install(app.renderer,new env.sandbox.Ticker()); held(env.collector().snapshot());
    assert.equal(env.collector().snapshot().failure,"TICKER_CHANGED");
  }
});

await group("first16-streams-8192-cap-observer-and-snapshot-faults", async () => {
  {
    const {env}=await active({duration:0});
    for(let i=0;i<17;i++)env.fire(10+i);
    const snap=env.collector().snapshot(); held(snap); assert.equal(snap.failure,"ROW_CAP");
    assert.equal(snap.capture.truncated,true); assert.equal(snap.draws.length,16); assert.equal(snap.tickRows.length,16);
    assert.equal(env.state.calls,17); assert.equal(env.state.updateCalls,17);
  }
  {
    const {env}=await active(); env.fire(10);
    env.state.observers[0].pending=Array.from({length:17},(_,i)=>({startTime:10+i,duration:50}));
    env.state.now=100;
    const snap=env.collector().snapshot(); held(snap);
    assert.equal(snap.longTasks.length,16); assert.equal(snap.capture.truncated,true);
    assert.equal(snap.tickRows.length,1);
  }
  for (const override of [{unsupported:true},{observerCtorFault:true},{observeFault:true},
    {takeFault:true},{disconnectFault:true}]) {
    const {env}=await active(override); env.fire(10); held(env.collector().snapshot());
    assert.equal(env.state.calls,1); assert.equal(env.state.updateCalls,1);
    assert.ok(env.state.disconnects<=1);
  }
  {
    const {env}=await active(); env.fire(10);
    env.state.observers[0].callback({getEntries(){throw false;}});
    const snap=env.collector().snapshot(); held(snap); assert.equal(snap.failure,"LONGTASK_OBSERVER");
  }
  {
    const {env}=await active(); env.fire(10);
    env.state.observers[0].pending=[{startTime:NaN,duration:1}];
    const snap=env.collector().snapshot(); held(snap); assert.equal(snap.failure,"LONGTASK_CLOCK");
  }
  for (const kind of ["bytes","encoder","freeze"]) {
    const {env}=await active(); env.fire(10);
    if(kind==="bytes") env.sandbox.TextEncoder=class {encode(){return {length:8193};}};
    if(kind==="encoder") env.sandbox.TextEncoder=class {encode(){throw null;}};
    if(kind==="freeze") execute("Object.freeze=()=>{throw 0;};",env.ctx);
    const snap=env.collector().snapshot(); held(snap);
    if(kind==="bytes"){assert.equal(snap.failure,"JSON_CAP");assert.equal(snap.tickRows.length,0);}
    assert.equal(env.state.calls,1); assert.equal(env.state.updateCalls,1); assert.equal(env.state.disconnects,1);
  }
  {
    const {env,app}=await active();
    app.ticker.add(()=>env.collector().snapshot(),null,1);
    env.fire(10); held(env.collector().snapshot()); assert.equal(env.state.calls,1);
    assert.equal(env.state.updateCalls,1); assert.equal(env.state.disconnects,1);
  }
  {
    const {env}=await active({unsupported:true,duration:0});
    for(let i=0;i<17;i++)env.fire(10+i);
    const snap=env.collector().snapshot(); held(snap);
    assert.equal(snap.failure,"LONGTASK_UNSUPPORTED"); assert.equal(snap.capture.truncated,true);
  }
});

await group("actual-native-owner-restore-and-distinct-uncredited-cohorts", async () => {
  const {env,app}=await active({duration:0}); const wrapper=app.ticker.update,draw=app.renderer.render;
  env.fire(10); env.session.beginRestore(); env.session.invalidate(env.lease);
  await env.session.completeCleanup(env.lease);
  const current=env.session.claim(env.config),reused=await current.owner.acquire(current.generation);
  assert.notEqual(current.generation,env.lease.generation); assert.equal(reused,app);
  assert.equal(reused.ticker.update,wrapper); assert.equal(reused.renderer.render,draw);
  env.activate(reused,current); env.fire(20);
  assert.equal(env.state.initCalls,1); assert.equal(env.state.installCalls,1);
  assert.equal(env.state.starts,2); assert.equal(env.state.activateCalls,2);
  const snap=env.collector().snapshot(); complete(snap);
  assert.equal(snap.capture.installedRenderers,1); assert.equal(snap.capture.installedTickers,1);
  assert.equal(snap.capture.activations,2); assert.equal(snap.tickRows.length,2);
  assert.equal(snap.tickRows[0].tickerSerial,snap.tickRows[1].tickerSerial); unknown(snap);
  execute(coreJS+"\nthis.makeRecorder=createStartupRecorder;this.recordAttempt=recordRendererStartupAttempt;",env.ctx);
  const recorder=env.sandbox.makeRecorder({now:()=>env.state.now,start:1,timeOrigin:100000}); recorder.owner(99);
  const oldAttempt=env.sandbox.recordAttempt(recorder,env.lease.generation);
  const canceled=recorder.begin(8,null,oldAttempt); recorder.finishAttempt(oldAttempt,3);
  const currentAttempt=env.sandbox.recordAttempt(recorder,current.generation);
  assert.notEqual(currentAttempt,current.generation.generation);
  const global=recorder.begin(15); recorder.end(global);
  const owned=recorder.begin(8,null,currentAttempt); recorder.end(owned); recorder.markReady();
  const journal=recorder.snapshot(); assert.equal(journal.failure,null);
  assert.ok(journal.events.some(row=>row[1]===3&&row[3]===canceled.id));
  assert.ok(journal.events.some(row=>row[5]===0&&row[6]===0&&row[2]===15));
  assert.ok(journal.events.some(row=>row[5]===currentAttempt&&row[6]===current.generation.generation));
  assert.ok(snap.tickRows.every(row=>row.generation===null&&row.attempt===null));
  env.session.invalidate(current); await env.session.completeCleanup(current); await env.session.close();
});

await group("optout-falsy-init-failure-and-realm-property-fault-fidelity", async () => {
  {
    const {env}=await active({optout:true}); env.fire(10);
    assert.equal(env.collector(),undefined); assert.equal((await env.publish()).startupRenderObservation,null);
    assert.equal(env.state.calls,1);
  }
  for (const thrown of [null,false,0,undefined]) {
    const env=await environment({initFailurePresent:true,initFailure:thrown});
    let caught=false; try {await env.acquire();}catch(error){caught=true;assert.equal(error,thrown);}
    assert.ok(caught); assert.equal(env.state.installCalls,0); await env.session.completeCleanup(env.lease);
  }
  for (const fault of [{code:"null",value:null},{code:"false",value:false},{code:"0",value:0},{code:"undefined",value:undefined}]) {
    const env=await environment();
    execute("this.windowGetterCalls=0;Object.defineProperty(window,'__ccStartupRenderObservation',"+
      "{configurable:true,get(){windowGetterCalls++;throw "+fault.code+";}});",env.ctx);
    const fidelity=execute("(()=>{let caught=false,value;try{window.__ccStartupRenderObservation;}"+
      "catch(error){caught=true;value=error;}return {caught,value,calls:windowGetterCalls};})()",env.ctx);
    assert.equal(fidelity.caught,true);assert.equal(fidelity.value,fault.value);assert.equal(fidelity.calls,1);
    const result=await env.publish();held(result.startupRenderObservation);
    assert.equal(result.startupRenderObservation.failure,"SNAPSHOT_ACCESS");assert.equal(env.sandbox.windowGetterCalls,2);
    const app=await env.acquire();env.activate(app);env.fire(10);
    assert.equal(env.state.calls,1);assert.equal(env.state.ready.length,1);
  }
  {
    const env=await environment();execute("delete window.__ccStartupRenderObservation;",env.ctx);
    const result=await env.publish();held(result.startupRenderObservation);
    assert.equal(result.startupRenderObservation.failure,"MISSING");
  }
});

await group("actual-original-gate9000-red-single-existing-publication", async () => {
  const {env}=await active({duration:5000});env.fire(10);
  const snapshot=(await env.publish()).startupRenderObservation;complete(snapshot);
  assert.equal(snapshot.draws[0].duration,5000);assert.equal(snapshot.tickRows[0].duration,5000);
  const gateBlock=block(source.perf,"const readiness = readinessBudgetValidation(","\nconst evidence =");
  const publishBlock=block(source.perf,"const evidence = {","\nif (PERF_FIXTURE === \"m27Fixture\") {\n  try {\n    if (startupDiagnosticFailurePresent)");
  const exitBlock="if (failed) process.exit(1);";unique(source.perf,exitBlock);
  const writes=[];
  Object.assign(env.sandbox,{
    coldStartupMs:100,fixtureLoadMs:9000,STARTUP_BUDGET_MS:5000,FIXTURE_LOAD_BUDGET_MS:6000,
    WORK_BUDGET_MS:8,BUDGET_MS:33,ASSERT_FRAME:false,perf:{workMs:1,p95Ms:100},
    PERF_THEME:"control",PERF_FIXTURE:"m27Fixture",MEASURE_S:20,WARMUP_S:8,HEADED:false,
    startupWaitStages:{},startupRenderObservation:wireForDecoded.get(snapshot),browserEvidence:{},OUTPUT_PATH:"ram-only.json",
    dirname:()=>".",mkdirSync(){},writeFileSync(path,raw){writes.push({path,raw});},
    process:{env:{},exit(code){throw {exitCode:code};}},
  });
  execute(gateJS+"\n"+gateBlock+"\nthis.actualGate=gateValidation;",env.ctx);
  assert.equal(env.sandbox.actualGate.fixtureLoadWithinBudget,false);assert.equal(env.sandbox.actualGate.passed,false);
  execute(publishBlock,env.ctx);assert.equal(writes.length,1);
  const published=JSON.parse(writes[0].raw);assert.equal(published.fixtureLoadMs,9000);
  assert.equal(published.effective.budgets.fixtureLoadMilliseconds,6000);assert.equal(published.gateValidation.passed,false);
  assert.equal(published.startupRenderObservation.wireVersion,1);
  assert.ok(Array.isArray(published.startupRenderObservation.tickRows[0]));
  assert.equal(semanticView(published.startupRenderObservation).tickRows[0].duration,5000);
  let exited=false;try{execute(exitBlock,env.ctx);}catch(error){exited=true;assert.equal(error.exitCode,1);}
  assert.ok(exited);
});
assert.equal(groups.length,options.groups ? options.groups.length : 7);
console.log("ROOT_PURE_TICKER_CONTROLS_PASS groups="+groups.length+"; no actual browser/runtime authority");
