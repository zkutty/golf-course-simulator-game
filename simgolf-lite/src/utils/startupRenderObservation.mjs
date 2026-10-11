// Diagnostic observation only; this module supplies no source, clock or release authority.
// This function is self-contained because Playwright serializes it into each document.
export function bootstrapStartupRenderObservation() {
  const params = new URLSearchParams(location.search);
  if (params.get("m27Fixture") === "1" && params.get("perfMeasure") === "1") {
    window.__ccStartupAttributionBootstrap = { version: 1, start: performance.now(), timeOrigin: performance.timeOrigin };
  }
  localStorage.setItem("coursecraft_perfhud", "on");
  localStorage.setItem("coursecraft_ambience", "on");
  if (params.get("m27Fixture") !== "1" || params.get("perfMeasure") !== "1") return;
  try {
    if (window.__ccStartupRenderObservation?.version === 1) return;
    const limit = 16;
    const renderers = new WeakMap();
    const tickers = new WeakMap();
    const tickerRAFs = new WeakMap();
    const tickRows = [];
    let tickerSerial = 0, installedTickers = 0, preActivationTickCalls = 0;
    const draws = [];
    const longTasks = [];
    let serial = 0, installed = 0, activations = 0, captureStart = null;
    let previous = window.__ccStartupAttributionBootstrap.start;
    let failure = null, truncated = false, late = false, frozen = false, cached = null;
    let observer = null, observerState = "UNSUPPORTED";
    const fail = (code) => { if (failure === null) failure = code; };
    const stamp = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
    const clock = () => {
      try {
        const value = performance.now();
        if (!stamp(value) || !stamp(previous) || value < previous) { fail("CLOCK"); return null; }
        previous = value;
        return value;
      } catch { fail("CLOCK"); return null; }
    };
    const overflow = () => { truncated = true; fail("ROW_CAP"); };
    const entries = (values) => {
      try {
        if (frozen || captureStart === null) return;
        if (!Array.isArray(values)) { fail("LONGTASK_SCHEMA"); return; }
        // Bounded processing as well as bounded retained rows.
        for (let i = 0; i < Math.min(values.length, limit + 1); i++) {
          const start = values[i].startTime;
          const duration = values[i].duration;
          const end = start + duration;
          if (!stamp(start) || !stamp(duration) || !stamp(end) || end < start) {
            fail("LONGTASK_CLOCK"); continue;
          }
          if (end < captureStart) continue;
          if (longTasks.length >= limit) { overflow(); break; }
          longTasks.push({ id: longTasks.length + 1, start, end, duration });
        }
        if (values.length > limit + 1) overflow();
      } catch { fail("LONGTASK_SCHEMA"); }
    };
    try {
      if (typeof PerformanceObserver === "function"
        && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        observer = new PerformanceObserver((list) => {
          try { entries(list.getEntries()); } catch { fail("LONGTASK_OBSERVER"); }
        });
        observer.observe({ type: "longtask", buffered: true });
        observerState = "SUPPORTED";
      } else fail("LONGTASK_UNSUPPORTED");
    } catch { observerState = "FAULT"; fail("LONGTASK_OBSERVER"); }
    const installRenderer = (renderer) => {
      try {
        if (frozen) return;
        if (renderer === null || (typeof renderer !== "object" && typeof renderer !== "function")) {
          fail("RENDERER_SCHEMA"); return;
        }
        const existing = renderers.get(renderer);
        if (existing) {
          const own = Object.getOwnPropertyDescriptor(renderer, "render");
          if (!own || own.value !== existing.wrapper) fail("WRAPPER_CHANGED");
          return;
        }
        let cursor = renderer, descriptor = null;
        for (let depth = 0; cursor && depth < 8; depth++) {
          descriptor = Object.getOwnPropertyDescriptor(cursor, "render");
          if (descriptor) break;
          cursor = Object.getPrototypeOf(cursor);
        }
        if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
          fail("RENDER_METHOD"); return;
        }
        const own = Object.getOwnPropertyDescriptor(renderer, "render");
        if ((own && !own.configurable && !own.writable) || (!own && !Object.isExtensible(renderer))) {
          fail("RENDER_DESCRIPTOR"); return;
        }
        if (serial >= limit) { fail("IDENTITY_CAP"); return; }
        const original = descriptor.value;
        const item = { serial: ++serial, installedAt: clock(), active: false, preActivationCalls: 0, wrapper: null };
        // The closure retains the original callable and scalar item only, never the renderer.
        const wrapper = function (...args) {
          let row = null;
          try {
            if (!frozen && item.active) {
              if (draws.length >= limit) overflow();
              else {
                const start = clock();
                row = { id: draws.length + 1, rendererSerial: item.serial, generation: null,
                  attempt: null, cohortQualified: false, start, end: null, duration: null, outcome: "pending" };
                draws.push(row);
              }
            } else if (!frozen && item.preActivationCalls < limit + 1) item.preActivationCalls++;
          } catch { fail("DRAW_BEGIN"); }
          let returned = false;
          try {
            const result = Reflect.apply(original, this, args);
            returned = true;
            return result;
          } finally {
            // Never inspect a real thrown value or let diagnostics mask any original result.
            try {
              if (row) {
                row.outcome = returned ? "returned" : "threw";
                row.end = clock();
                if (row.start !== null && row.end !== null && row.end >= row.start) row.duration = row.end - row.start;
                else fail("CLOCK");
              }
            } catch { fail("DRAW_END"); }
          }
        };
        item.wrapper = wrapper;
        Object.defineProperty(renderer, "render", {
          value: wrapper, writable: own ? own.writable : true,
          configurable: own ? own.configurable : true, enumerable: own ? own.enumerable : descriptor.enumerable,
        });
        renderers.set(renderer, item);
        installed++;
      } catch { fail("INSTALL"); }
    };
    const activateRenderer = (renderer) => {
      try {
        if (frozen) return;
        const item = renderers.get(renderer);
        if (!item) { late = true; fail("ACTIVATION_WITHOUT_INSTALL"); return; }
        const own = Object.getOwnPropertyDescriptor(renderer, "render");
        if (!own || own.value !== item.wrapper) { late = true; fail("WRAPPER_CHANGED"); return; }
        const at = clock();
        if (at === null || item.installedAt === null || at < item.installedAt) { late = true; fail("PLACEMENT"); }
        // Reuse/restore does not install a second wrapper or reset the global sampling caps.
        activations = Math.min(activations + 1, limit + 1);
        item.active = true;
        if (captureStart === null) captureStart = at;
      } catch { late = true; fail("ACTIVATION"); }
    };
    const installTicker = (renderer, ticker) => {
      try {
        if (frozen) return;
        const rendererItem = renderers.get(renderer);
        if (!rendererItem) { fail("TICKER_BINDING"); return; }
        if (ticker === null || (typeof ticker !== "object" && typeof ticker !== "function")) {
          fail("TICKER_MISSING"); return;
        }
        const raf = Object.getOwnPropertyDescriptor(ticker, "_tick");
        if (!raf || !("value" in raf) || typeof raf.value !== "function") {
          fail("TICKER_DISPATCH"); return;
        }
        const existing = tickers.get(ticker);
        if (existing) {
          if (tickerRAFs.get(raf.value) !== existing.serial) fail("TICKER_DISPATCH_CHANGED");
          const own = Object.getOwnPropertyDescriptor(ticker, "update");
          if (!own || own.value !== existing.wrapper) fail("TICKER_WRAPPER_CHANGED");
          if (existing.rendererSerial !== rendererItem.serial
            || rendererItem.tickerSerial !== existing.serial) fail("TICKER_BINDING");
          return;
        }
        if (rendererItem.tickerSerial !== undefined) { fail("TICKER_CHANGED"); return; }
        let cursor = ticker, descriptor = null;
        for (let depth = 0; cursor && depth < 8; depth++) {
          descriptor = Object.getOwnPropertyDescriptor(cursor, "update");
          if (descriptor) break;
          cursor = Object.getPrototypeOf(cursor);
        }
        if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
          fail("TICKER_METHOD"); return;
        }
        const own = Object.getOwnPropertyDescriptor(ticker, "update");
        if ((own && !own.configurable && !own.writable) || (!own && !Object.isExtensible(ticker))) {
          fail("TICKER_DESCRIPTOR"); return;
        }
        if (tickerSerial >= limit) { fail("TICKER_IDENTITY_CAP"); return; }
        const original = descriptor.value;
        const item = { serial: ++tickerSerial, rendererSerial: rendererItem.serial,
          installedAt: clock(), active: false, wrapper: null };
        // Only the callable and scalar item are retained, never the ticker or application.
        const wrapper = function (...args) {
          let row = null;
          try {
            if (!frozen && item.active) {
              if (tickRows.length >= limit) overflow();
              else {
                const start = clock();
                row = { id: tickRows.length + 1, tickerSerial: item.serial, generation: null,
                  attempt: null, cohortQualified: false, start, end: null, duration: null, outcome: "pending" };
                tickRows.push(row);
              }
            } else if (!frozen) preActivationTickCalls = Math.min(preActivationTickCalls + 1, limit + 1);
          } catch { fail("TICK_BEGIN"); }
          let returned = false;
          try {
            const result = Reflect.apply(original, this, args);
            returned = true;
            return result;
          } finally {
            try {
              if (row) {
                row.outcome = returned ? "returned" : "threw";
                row.end = clock();
                if (row.start !== null && row.end !== null && row.end >= row.start) row.duration = row.end - row.start;
                else fail("CLOCK");
              }
            } catch { fail("TICK_END"); }
          }
        };
        item.wrapper = wrapper;
        Object.defineProperty(ticker, "update", {
          value: wrapper, writable: own ? own.writable : true,
          configurable: own ? own.configurable : true, enumerable: own ? own.enumerable : descriptor.enumerable,
        });
        tickers.set(ticker, item);
        tickerRAFs.set(raf.value, item.serial);
        rendererItem.tickerSerial = item.serial;
        installedTickers++;
      } catch { fail("TICKER_INSTALL"); }
    };
    const activateTicker = (renderer, ticker) => {
      try {
        if (frozen) return;
        const rendererItem = renderers.get(renderer);
        const item = tickers.get(ticker);
        if (!rendererItem || !item) { late = true; fail("TICKER_ACTIVATION_WITHOUT_INSTALL"); return; }
        if (rendererItem.tickerSerial !== item.serial || item.rendererSerial !== rendererItem.serial) {
          late = true; fail("TICKER_BINDING"); return;
        }
        const own = Object.getOwnPropertyDescriptor(ticker, "update");
        if (!own || own.value !== item.wrapper) { late = true; fail("TICKER_WRAPPER_CHANGED"); return; }
        const raf = Object.getOwnPropertyDescriptor(ticker, "_tick");
        if (!raf || !("value" in raf) || tickerRAFs.get(raf.value) !== item.serial) {
          late = true; fail("TICKER_DISPATCH_CHANGED"); return;
        }
        const at = clock();
        if (at === null || item.installedAt === null || at < item.installedAt) { late = true; fail("TICKER_PLACEMENT"); }
        item.active = true;
      } catch { late = true; fail("TICKER_ACTIVATION"); }
    };
    // Dimensions rows are a separate unqualified observation, not document identity.
    const dimensionsRows = [];
    const dimensionsTickets = new WeakMap();
    let dimensionsCalls = 0, dimensionsPending = 0, dimensionsFailure = null;
    let dimensionsReentry = false, dimensionsLate = false, dimensionsReady = false;
    const failDimensions = (code) => { if (dimensionsFailure === null) dimensionsFailure = code; };
    const beginDimensions = () => {
      try {
        if (frozen) { dimensionsLate = true; failDimensions("LATE"); return null; }
        dimensionsCalls = Math.min(dimensionsCalls + 1, limit + 1);
        if (dimensionsReady) { dimensionsLate = true; failDimensions("AFTER_READY"); }
        if (dimensionsPending) { dimensionsReentry = true; failDimensions("REENTRY"); }
        dimensionsPending = Math.min(dimensionsPending + 1, limit + 1);
        const ticket = {};
        if (dimensionsRows.length >= limit) {
          overflow(); failDimensions("ROW_CAP"); dimensionsTickets.set(ticket, null); return ticket;
        }
        const start = clock();
        if (start === null) failDimensions("CLOCK");
        const row = { id: dimensionsRows.length + 1, start, end: null, duration: null,
          outcome: "pending", ready: null };
        dimensionsRows.push(row);
        dimensionsTickets.set(ticket, row);
        return ticket;
      } catch { failDimensions("BEGIN"); return null; }
    };
    const endDimensions = (ticket, returned, ready) => {
      try {
        if (ticket === null) return;
        if (!dimensionsTickets.has(ticket)) { failDimensions("TICKET"); return; }
        const row = dimensionsTickets.get(ticket);
        dimensionsTickets.delete(ticket);
        dimensionsPending = Math.max(0, dimensionsPending - 1);
        if (frozen) { dimensionsLate = true; failDimensions("LATE"); return; }
        if (typeof returned !== "boolean" || (ready !== null && typeof ready !== "boolean")) {
          failDimensions("SCHEMA"); return;
        }
        if (!row) return;
        row.outcome = returned ? "returned" : "threw";
        row.ready = returned ? ready : null;
        row.end = clock();
        if (row.start !== null && row.end !== null && row.end >= row.start) row.duration = row.end - row.start;
        else failDimensions("CLOCK");
        if (!returned) failDimensions("PREDICATE_THROW");
        if (returned && ready) dimensionsReady = true;
      } catch { failDimensions("END"); }
    };
    const snapshotDimensions = () => {
      if (!dimensionsRows.length) failDimensions("MISSING");
      if (dimensionsPending || dimensionsRows.some((row) => row.outcome === "pending" || row.duration === null)) {
        failDimensions("PENDING");
      }
      if (!dimensionsReady) failDimensions("NOT_READY");
      const rows = dimensionsRows.map((row) => Object.freeze({ ...row }));
      Object.freeze(rows);
      return Object.freeze({
        sourceUnit: "ZK-1339_SOURCE1", domain: "browser.performance.now", rows,
        calls: dimensionsCalls, pending: dimensionsPending, readyObserved: dimensionsReady,
        reentry: dimensionsReentry, late: dimensionsLate, rowLimit: limit,
        observationComplete: dimensionsFailure === null,
        status: "HOLD", eligible: false, failure: dimensionsFailure ?? "DOCUMENT_IDENTITY_UNKNOWN",
        documentIdentity: "UNKNOWN", candidateQualified: false, trusted: false,
        qualification: "First bounded synchronous dimensions callbacks including diagnostic overhead. Unknown document/candidate; no full-startup, scheduling, Node, native/GPU, cause or removable-time credit.",
      });
    };
    const install = (renderer, ticker) => { installRenderer(renderer); installTicker(renderer, ticker); };
    const activate = (renderer, ticker) => { activateRenderer(renderer); activateTicker(renderer, ticker); };
    const snapshot = () => {
      if (cached) return cached;
      try {
        if (observer) {
          try { entries(observer.takeRecords()); } catch { fail("LONGTASK_SNAPSHOT"); }
          try { observer.disconnect(); } catch { fail("LONGTASK_DISCONNECT"); }
        }
        const end = clock();
        frozen = true;
        if (captureStart === null || !installed || !draws.length
          || draws.some((row) => row.outcome === "pending" || row.duration === null)) fail("INCOMPLETE");
        if (!installedTickers || !tickRows.length
          || tickRows.some((row) => row.outcome === "pending" || row.duration === null)) fail("TICKER_INCOMPLETE");
        const output = {
          version: 1, sourceUnit: "ZK-1338_SOURCE1", domain: "browser.performance.now",
          clock: { start: window.__ccStartupAttributionBootstrap.start, timeOrigin: window.__ccStartupAttributionBootstrap.timeOrigin },
          capture: { start: captureStart, snapshotAt: end, installedRenderers: installed, installedTickers,
            activations, preActivationTickCalls,
            limits: { drawRows: limit, tickRows: limit, longTaskRows: limit, dimensionsRows: limit, bytes: 8192 }, truncated, late },
          observer: observerState,
          draws: draws.map((row) => Object.freeze({ ...row })),
          tickRows: tickRows.map((row) => Object.freeze({ ...row })),
          longTasks: longTasks.map((row) => Object.freeze({ ...row })),
          dimensionsPredicate: snapshotDimensions(),
          status: failure === null ? "COMPLETE" : "HOLD", eligible: failure === null, failure,
          trusted: false, numericPass: false, releaseCleared: false,
          candidateQualified: false, browserDocumentIdentity: false,
          qualification: "First bounded post-layer render/update calls and tasks; unknown cohorts. Pre-install/pre-activation and outside-update work are unmeasured. Call return is not GPU completion, Node alignment, cause or removable time. Later rows cause truncated HOLD.",
        };
        // Lossless positional rows; every header shares the unchanged complete UTF8 cap.
        const pack = (row, keys) => Object.freeze(keys.map((key) => row[key]));
        const wire = { ...output, wireVersion: 1,
          draws: output.draws.map((r) => pack(r, ["id","rendererSerial","generation","attempt","cohortQualified","start","end","duration","outcome"])),
          tickRows: output.tickRows.map((r) => pack(r, ["id","tickerSerial","generation","attempt","cohortQualified","start","end","duration","outcome"])),
          longTasks: output.longTasks.map((r) => pack(r, ["id","start","end","duration"])),
          dimensionsPredicate: { ...output.dimensionsPredicate, rows: output.dimensionsPredicate.rows.map((r) => pack(r, ["id","start","end","duration","outcome","ready"])) } };
        if (new TextEncoder().encode(JSON.stringify(wire)).length > 8192) { fail("JSON_CAP"); throw null; }
        Object.freeze(wire.draws); Object.freeze(wire.tickRows); Object.freeze(wire.longTasks);
        Object.freeze(wire.dimensionsPredicate.rows); Object.freeze(wire.dimensionsPredicate);
        Object.freeze(wire.capture.limits); Object.freeze(wire.capture); Object.freeze(wire.clock);
        cached = Object.freeze(wire);
      } catch {
        fail("SNAPSHOT");
        frozen = true;
        cached = { version: 1, sourceUnit: "ZK-1338_SOURCE1", status: "HOLD", eligible: false, failure,
          draws: [], tickRows: [], longTasks: [],
          dimensionsPredicate: { sourceUnit: "ZK-1339_SOURCE1", status: "HOLD", eligible: false,
            failure: "SNAPSHOT", rows: [], documentIdentity: "UNKNOWN", candidateQualified: false, trusted: false },
          trusted: false, numericPass: false, releaseCleared: false,
          candidateQualified: false, browserDocumentIdentity: false,
          qualification: "Snapshot incomplete; no renderer, cohort, clock or causal authority." };
        try { Object.freeze(cached.draws); Object.freeze(cached.tickRows); Object.freeze(cached.longTasks);
          Object.freeze(cached.dimensionsPredicate.rows); Object.freeze(cached.dimensionsPredicate); Object.freeze(cached); } catch { /* Bounded fallback. */ }
      }
      return cached;
    };
    window.__ccStartupRenderObservation = Object.freeze({ version: 1, install, activate, beginDimensions, endDimensions, snapshot });
  } catch { /* Optional diagnostic setup cannot change the existing bootstrap behavior. */ }
}

export function observeStartupRenderer(renderer, ticker) {
  try {
    if (typeof window !== "undefined") window.__ccStartupRenderObservation?.install(renderer, ticker);
  } catch { /* Only the original renderer call may fail the renderer path. */ }
}

export function activateStartupRenderer(renderer, ticker) {
  try {
    if (typeof window !== "undefined") window.__ccStartupRenderObservation?.activate(renderer, ticker);
  } catch { /* Optional observation never changes native readiness. */ }
}

const wireDrawKeys=["id","rendererSerial","generation","attempt","cohortQualified","start","end","duration","outcome"];
const wireTickKeys=["id","tickerSerial","generation","attempt","cohortQualified","start","end","duration","outcome"];
const wireTaskKeys=["id","start","end","duration"];
const wireDKeys=["id","start","end","duration","outcome","ready"];
const wireFailures=new Set(["ACTIVATION","ACTIVATION_WITHOUT_INSTALL","AFTER_READY","BEGIN","CLOCK","DOCUMENT_IDENTITY_UNKNOWN","DRAW_BEGIN","DRAW_END","END","IDENTITY_CAP","INCOMPLETE","INSTALL","JSON_CAP","LATE","LONGTASK_CLOCK","LONGTASK_DISCONNECT","LONGTASK_OBSERVER","LONGTASK_SCHEMA","LONGTASK_SNAPSHOT","LONGTASK_UNSUPPORTED","MISSING","NOT_READY","PENDING","PLACEMENT","PREDICATE_THROW","REENTRY","RENDERER_SCHEMA","RENDER_DESCRIPTOR","RENDER_METHOD","ROW_CAP","SCHEMA","SNAPSHOT","SNAPSHOT_ACCESS","TICKER_ACTIVATION","TICKER_ACTIVATION_WITHOUT_INSTALL","TICKER_BINDING","TICKER_CHANGED","TICKER_DESCRIPTOR","TICKER_DISPATCH","TICKER_DISPATCH_CHANGED","TICKER_IDENTITY_CAP","TICKER_INCOMPLETE","TICKER_INSTALL","TICKER_METHOD","TICKER_MISSING","TICKER_PLACEMENT","TICKER_WRAPPER_CHANGED","TICKET","TICK_BEGIN","TICK_END","WIRE_SCHEMA","WRAPPER_CHANGED"]);
const wireRQ="First bounded post-layer render/update calls and tasks; unknown cohorts. Pre-install/pre-activation and outside-update work are unmeasured. Call return is not GPU completion, Node alignment, cause or removable time. Later rows cause truncated HOLD.";
const wireDQ="First bounded synchronous dimensions callbacks including diagnostic overhead. Unknown document/candidate; no full-startup, scheduling, Node, native/GPU, cause or removable-time credit.";
function wireAssert(ok){if(!ok)throw new TypeError("WIRE_SCHEMA");}
function wireFreeze(v){if(v&&typeof v==="object"){for(const c of Object.values(v))wireFreeze(c);Object.freeze(v);}return v;}
function wireData(value){let nodes=0;const copy=(v,depth)=>{
wireAssert(++nodes<=4096&&depth<=8);
if(v===null||typeof v==="boolean"||typeof v==="string"){wireAssert(typeof v!=="string"||v.length<=8192);return v;}
if(typeof v==="number"){wireAssert(Number.isFinite(v));return v;}
wireAssert(v&&typeof v==="object");const a=Array.isArray(v),p=Object.getPrototypeOf(v);
wireAssert(a||p===null||(p&&Object.getPrototypeOf(p)===null));
const keys=Reflect.ownKeys(v);wireAssert(keys.length<=64&&keys.every(k=>typeof k==="string"));
if(a){const d=Object.getOwnPropertyDescriptor(v,"length");wireAssert(d&&"value"in d&&Number.isInteger(d.value)&&d.value>=0&&d.value<=17);
wireAssert(keys.length===d.value+1&&keys.includes("length"));const out=[];
for(let i=0;i<d.value;i++){const e=Object.getOwnPropertyDescriptor(v,String(i));wireAssert(e&&"value"in e&&e.enumerable);out.push(copy(e.value,depth+1));}return out;}
const out=Object.create(null);for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);wireAssert(d&&"value"in d&&d.enumerable);out[k]=copy(d.value,depth+1);}return out;
};return copy(value,0);}
function wireKeys(v,keys){wireAssert(v&&!Array.isArray(v)&&typeof v==="object");wireAssert(Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)));}
const wireStamp=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
const wireCount=(v,cap)=>Number.isInteger(v)&&v>=0&&v<=cap;
function wireTiming(r,nullable,task=false){for(const k of ["start","end","duration"])wireAssert(wireStamp(r[k])||(nullable&&r[k]===null));
if(r.start!==null&&r.end!==null){wireAssert(r.end>=r.start);wireAssert(task?r.end===r.start+r.duration:r.duration===r.end-r.start);}else wireAssert(r.duration===null);}
function wireRows(rows,keys,check){wireAssert(Array.isArray(rows)&&rows.length<=16);return rows.map((v,i)=>{wireAssert(Array.isArray(v)&&v.length===keys.length);
const r=Object.fromEntries(keys.map((k,j)=>[k,v[j]]));wireAssert(r.id===i+1);check(r);return r;});}
function wireFallback(w){const common=["version","sourceUnit","status","eligible","failure","draws","longTasks","trusted","numericPass","releaseCleared","candidateQualified","browserDocumentIdentity"];
if(w.sourceUnit==="ZK-1335_SOURCE1"){wireKeys(w,common);wireAssert(["MISSING","SNAPSHOT_ACCESS"].includes(w.failure));}
else{wireKeys(w,[...common,"tickRows","dimensionsPredicate","qualification"]);wireAssert(w.sourceUnit==="ZK-1338_SOURCE1"&&wireFailures.has(w.failure));
wireAssert(w.qualification==="Snapshot incomplete; no renderer, cohort, clock or causal authority.");wireAssert(Array.isArray(w.tickRows)&&!w.tickRows.length);
const d=w.dimensionsPredicate;wireKeys(d,["sourceUnit","status","eligible","failure","rows","documentIdentity","candidateQualified","trusted"]);
wireAssert(d.sourceUnit==="ZK-1339_SOURCE1"&&d.status==="HOLD"&&d.eligible===false&&d.failure==="SNAPSHOT"&&Array.isArray(d.rows)&&!d.rows.length&&d.documentIdentity==="UNKNOWN"&&d.candidateQualified===false&&d.trusted===false);}
wireAssert(w.version===1&&w.status==="HOLD"&&w.eligible===false);for(const k of ["trusted","numericPass","releaseCleared","candidateQualified","browserDocumentIdentity"])wireAssert(w[k]===false);
wireAssert(Array.isArray(w.draws)&&!w.draws.length&&Array.isArray(w.longTasks)&&!w.longTasks.length);return w;}
export function decodeStartupRenderObservation(raw){const w=wireData(raw);wireAssert(new TextEncoder().encode(JSON.stringify(w)).length<=8192);
if(!Object.hasOwn(w,"wireVersion"))return wireFreeze(wireFallback(w));
wireKeys(w,["version","wireVersion","sourceUnit","domain","clock","capture","observer","draws","tickRows","longTasks","dimensionsPredicate","status","eligible","failure","trusted","numericPass","releaseCleared","candidateQualified","browserDocumentIdentity","qualification"]);
wireAssert(w.version===1&&w.wireVersion===1&&w.sourceUnit==="ZK-1338_SOURCE1"&&w.domain==="browser.performance.now"&&w.qualification===wireRQ);
for(const k of ["trusted","numericPass","releaseCleared","candidateQualified","browserDocumentIdentity"])wireAssert(w[k]===false);
wireAssert(w.failure===null||wireFailures.has(w.failure));wireAssert(w.status===(w.failure===null?"COMPLETE":"HOLD")&&w.eligible===(w.failure===null));
wireKeys(w.clock,["start","timeOrigin"]);wireAssert(wireStamp(w.clock.start)&&wireStamp(w.clock.timeOrigin));const c=w.capture;
wireKeys(c,["start","snapshotAt","installedRenderers","installedTickers","activations","preActivationTickCalls","limits","truncated","late"]);
for(const k of ["start","snapshotAt"])wireAssert(wireStamp(c[k])||(w.status==="HOLD"&&c[k]===null));
if(c.start!==null)wireAssert(c.start>=w.clock.start);if(c.snapshotAt!==null)wireAssert(c.snapshotAt>=w.clock.start&&(c.start===null||c.snapshotAt>=c.start));
wireAssert(wireCount(c.installedRenderers,16)&&wireCount(c.installedTickers,16)&&wireCount(c.activations,17)&&wireCount(c.preActivationTickCalls,17));
wireAssert(typeof c.truncated==="boolean"&&typeof c.late==="boolean"&&(!(c.truncated||c.late)||w.status==="HOLD"));
wireKeys(c.limits,["drawRows","tickRows","longTaskRows","dimensionsRows","bytes"]);wireAssert(c.limits.drawRows===16&&c.limits.tickRows===16&&c.limits.longTaskRows===16&&c.limits.dimensionsRows===16&&c.limits.bytes===8192);
wireAssert(["SUPPORTED","UNSUPPORTED","FAULT"].includes(w.observer));
const call=(r,key,cap)=>{wireAssert(Number.isInteger(r[key])&&r[key]>=1&&r[key]<=cap&&r.generation===null&&r.attempt===null&&r.cohortQualified===false);
wireAssert(["pending","returned","threw"].includes(r.outcome));wireTiming(r,w.status==="HOLD");if(r.outcome==="pending")wireAssert(w.status==="HOLD"&&r.end===null&&r.duration===null);
if(r.start!==null)wireAssert(c.start!==null&&r.start>=c.start);if(r.end!==null&&c.snapshotAt!==null)wireAssert(r.end<=c.snapshotAt);};
const draws=wireRows(w.draws,wireDrawKeys,r=>call(r,"rendererSerial",c.installedRenderers));const tickRows=wireRows(w.tickRows,wireTickKeys,r=>call(r,"tickerSerial",c.installedTickers));
const longTasks=wireRows(w.longTasks,wireTaskKeys,r=>{wireTiming(r,false,true);wireAssert(c.start!==null&&r.end>=c.start);});
if(w.status==="COMPLETE")wireAssert(c.start!==null&&c.snapshotAt!==null&&draws.length>0&&tickRows.length>0&&w.observer==="SUPPORTED");
const d=w.dimensionsPredicate;wireKeys(d,["sourceUnit","domain","rows","calls","pending","readyObserved","reentry","late","rowLimit","observationComplete","status","eligible","failure","documentIdentity","candidateQualified","trusted","qualification"]);
wireAssert(d.sourceUnit==="ZK-1339_SOURCE1"&&d.domain===w.domain&&d.rowLimit===16&&d.qualification===wireDQ);
wireAssert(d.status==="HOLD"&&d.eligible===false&&d.documentIdentity==="UNKNOWN"&&d.candidateQualified===false&&d.trusted===false);
for(const k of ["readyObserved","reentry","late","observationComplete"])wireAssert(typeof d[k]==="boolean");
wireAssert(wireCount(d.calls,17)&&wireCount(d.pending,17)&&d.pending<=d.calls&&wireFailures.has(d.failure));
const rows=wireRows(d.rows,wireDKeys,r=>{wireAssert(["pending","returned","threw"].includes(r.outcome)&& (r.ready===null||typeof r.ready==="boolean"));wireTiming(r,!d.observationComplete);
if(r.start!==null)wireAssert(r.start>=w.clock.start);if(r.end!==null&&c.snapshotAt!==null)wireAssert(r.end<=c.snapshotAt);
if(r.outcome==="pending")wireAssert(!d.observationComplete&&r.end===null&&r.duration===null&&r.ready===null);
if(r.outcome==="threw")wireAssert(!d.observationComplete&&r.ready===null);if(r.outcome==="returned")wireAssert(typeof r.ready==="boolean");});
wireAssert(d.calls>=rows.length&&d.pending>=rows.filter(r=>r.outcome==="pending").length);
if(d.observationComplete)wireAssert(d.failure==="DOCUMENT_IDENTITY_UNKNOWN"&&rows.length>0&&d.readyObserved&&d.pending===0&&!d.reentry&&!d.late&&rows.every(r=>r.outcome==="returned"&&r.duration!==null));else wireAssert(d.failure!=="DOCUMENT_IDENTITY_UNKNOWN");
if(d.readyObserved)wireAssert(rows.some(r=>r.outcome==="returned"&&r.ready===true));
const decoded={...w,draws,tickRows,longTasks,dimensionsPredicate:{...d,rows}};delete decoded.wireVersion;return wireFreeze(decoded);}
function packStartupWire(v){const pack=(rows,keys)=>rows.map(r=>keys.map(k=>r[k]));return{...v,wireVersion:1,draws:pack(v.draws,wireDrawKeys),tickRows:pack(v.tickRows,wireTickKeys),longTasks:pack(v.longTasks,wireTaskKeys),dimensionsPredicate:{...v.dimensionsPredicate,rows:pack(v.dimensionsPredicate.rows,wireDKeys)}};}
export function encodeStartupRenderObservation(value){const v=wireData(value);wireAssert(!Object.hasOwn(v,"wireVersion"));
for(const [rows,keys]of [[v.draws,wireDrawKeys],[v.tickRows,wireTickKeys],[v.longTasks,wireTaskKeys],[v.dimensionsPredicate?.rows,wireDKeys]]){wireAssert(Array.isArray(rows)&&rows.length<=16);for(const r of rows)wireKeys(r,keys);}
const wire=packStartupWire(v);decodeStartupRenderObservation(wire);return wireFreeze(wire);}
export function readStartupRenderObservation(raw){try{const semantic=decodeStartupRenderObservation(raw);return Object.hasOwn(raw,"wireVersion")?wireFreeze(packStartupWire(semantic)):semantic;}catch{
let failure="WIRE_SCHEMA";try{const d=Object.getOwnPropertyDescriptor(raw,"failure");if(d&&"value"in d&&(typeof d.value==="boolean"||(typeof d.value==="number"&&Number.isFinite(d.value))||(typeof d.value==="string"&&d.value.length<=128)))failure=d.value;}catch{}
return wireFreeze({version:1,sourceUnit:"ZK-1338_SOURCE1",status:"HOLD",eligible:false,failure,secondaryFailures:["WIRE_SCHEMA"],draws:[],tickRows:[],longTasks:[],dimensionsPredicate:{sourceUnit:"ZK-1339_SOURCE1",status:"HOLD",eligible:false,failure:"WIRE_SCHEMA",rows:[],documentIdentity:"UNKNOWN",candidateQualified:false,trusted:false},trusted:false,numericPass:false,releaseCleared:false,candidateQualified:false,browserDocumentIdentity:false,qualification:"Malformed wire refused; no renderer, cohort, clock or causal authority."});}}
