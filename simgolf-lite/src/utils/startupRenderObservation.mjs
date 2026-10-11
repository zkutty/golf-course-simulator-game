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
            limits: { drawRows: limit, tickRows: limit, longTaskRows: limit, bytes: 8192 }, truncated, late },
          observer: observerState,
          draws: draws.map((row) => Object.freeze({ ...row })),
          tickRows: tickRows.map((row) => Object.freeze({ ...row })),
          longTasks: longTasks.map((row) => Object.freeze({ ...row })),
          status: failure === null ? "COMPLETE" : "HOLD", eligible: failure === null, failure,
          trusted: false, numericPass: false, releaseCleared: false,
          candidateQualified: false, browserDocumentIdentity: false,
          qualification: "First bounded post-layer render/update calls and tasks; unknown cohorts. Pre-install/pre-activation and outside-update work are unmeasured. Call return is not GPU completion, Node alignment, cause or removable time. Later rows cause truncated HOLD.",
        };
        if (new TextEncoder().encode(JSON.stringify(output)).length > 8192) { fail("JSON_CAP"); throw null; }
        Object.freeze(output.draws); Object.freeze(output.tickRows); Object.freeze(output.longTasks);
        Object.freeze(output.capture.limits); Object.freeze(output.capture); Object.freeze(output.clock);
        cached = Object.freeze(output);
      } catch {
        fail("SNAPSHOT");
        frozen = true;
        cached = { version: 1, sourceUnit: "ZK-1338_SOURCE1", status: "HOLD", eligible: false, failure,
          draws: [], tickRows: [], longTasks: [], trusted: false, numericPass: false, releaseCleared: false,
          candidateQualified: false, browserDocumentIdentity: false,
          qualification: "Snapshot incomplete; no renderer, cohort, clock or causal authority." };
        try { Object.freeze(cached.draws); Object.freeze(cached.tickRows); Object.freeze(cached.longTasks); Object.freeze(cached); } catch { /* Bounded fallback. */ }
      }
      return cached;
    };
    window.__ccStartupRenderObservation = Object.freeze({ version: 1, install, activate, snapshot });
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
