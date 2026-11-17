const browserStages = ["appInitStart", "appInitEnd", "deferredStart", "deferredEnd", "atlasStart", "atlasEnd",
  "canvasAttached", "firstSyncStart", "firstSyncEnd", "firstRootPresented"];
const hostStages = ["fixtureStart", "domContentLoaded", "sleepStart", "sleepEnd", "visibleStart", "visibleEnd",
  "dimensionsStart", "dimensionsEnd", "boundsStart", "boundsEnd"];
const selector = ".cc-pixi-stage canvas";
let active;

/** Own one document-local generation, without retaining the app or canvas. */
export function startM27PhaseObservation(app, target = window) {
  const arm = target.__ccM27PhaseProbe;
  if (!arm || typeof WeakRef !== "function" || !Number.isSafeInteger(arm.generation)
    || arm.generation < 0 || arm.generation >= Number.MAX_SAFE_INTEGER) return null;
  const query = new URLSearchParams(target.location.search);
  if (query.get("m27Fixture") !== "1" || query.get("perfMeasure") !== "1" || query.get("perfTheme") !== "parkland") return null;

  const generation = ++arm.generation;
  const timeOrigin = target.performance.timeOrigin;
  const owner = new WeakRef(app);
  const times = {};
  let canvasRef;
  let cancelled = false;
  const current = () => !cancelled && target.__ccM27PhaseProbe === arm && arm.generation === generation
    && target.performance.timeOrigin === timeOrigin;
  const observation = {
    stamp(phase) {
      if (!current() || !browserStages.includes(phase) || phase === "firstSyncStart" || phase === "firstSyncEnd"
        || Object.hasOwn(times, phase)) return;
      times[phase] = target.performance.now();
    },
    startSync() {
      if (current() && !Object.hasOwn(times, "firstSyncEnd")) return target.performance.now();
    },
    finishSync(start) {
      if (!current() || !Number.isFinite(start) || Object.hasOwn(times, "firstSyncEnd")) return;
      times.firstSyncStart = start;
      times.firstSyncEnd = target.performance.now();
    },
    attach(canvas) {
      if (!current()) return;
      if (arm.canvasGeneration !== undefined) arm.ambiguousCanvas = true;
      arm.canvasGeneration = generation;
      canvasRef = new WeakRef(canvas);
      observation.stamp("canvasAttached");
    },
    dispose() {
      cancelled = true;
      canvasRef = undefined;
      if (active?.observation === observation) active = undefined;
    },
  };
  active = { owner, observation };
  arm.read = () => {
    const canvas = canvasRef?.deref();
    if (!current() || arm.ambiguousCanvas || arm.canvasGeneration !== generation || !owner.deref()
      || !canvas?.isConnected || canvas.ownerDocument !== target.document) return null;
    const matches = target.document.querySelectorAll(selector);
    if (matches.length !== 1 || matches[0] !== canvas) return null;
    const navigation = target.performance.getEntriesByType("navigation");
    if (navigation.length !== 1 || navigation[0].type !== "navigate" || navigation[0].name !== target.location.href) return null;
    return { generation, timeOrigin, sampledAt: target.performance.now(), times: { ...times } };
  };
  return observation;
}

export function currentM27PhaseObservation(app) {
  return active && active.owner.deref() === app ? active.observation : null;
}

function ordered(record, keys) {
  if (record === null || typeof record !== "object" || Object.keys(record).length !== keys.length) return false;
  return keys.every((key, index) => Number.isFinite(record[key]) && record[key] >= 0
    && (index === 0 || record[key] >= record[keys[index - 1]]));
}

/** Keep the clocks separate and publish bounds only when the current navigation is plausible. */
export function summarizeM27Phases({ host, page, clockBefore, clockAfter, fixtureLoadMs }) {
  const schema = "coursecraft-m27-phase-v1";
  const raw = { schema, fixtureLoadMs: Number.isFinite(fixtureLoadMs) ? fixtureLoadMs : null };
  if (ordered(host, hostStages)) {
    raw.hostStampsMs = Object.fromEntries(hostStages.map((key) => [key, host[key]]));
    raw.hostAwaitMs = {
      domContentLoaded: host.domContentLoaded - host.fixtureStart,
      fixedSleep: host.sleepEnd - host.sleepStart,
      visible: host.visibleEnd - host.visibleStart,
      dimensions: host.dimensionsEnd - host.dimensionsStart,
      bounds: host.boundsEnd - host.boundsStart,
    };
  }
  const times = page?.times;
  if (page && Number.isSafeInteger(page.generation) && page.generation >= 1 && Number.isFinite(page.timeOrigin)
    && page.timeOrigin > 0 && ordered(times, browserStages) && Number.isFinite(page.sampledAt)
    && page.sampledAt >= times.firstRootPresented) {
    raw.browser = {
      generation: page.generation, timeOrigin: page.timeOrigin, sampledAt: page.sampledAt,
      fromNavigationMs: Object.fromEntries(browserStages.map((key) => [key, times[key]])),
      elapsedMs: {
        appInit: times.appInitEnd - times.appInitStart,
        deferred: times.deferredEnd - times.deferredStart,
        atlas: times.atlasEnd - times.atlasStart,
        firstSuccessfulSync: times.firstSyncEnd - times.firstSyncStart,
      },
      firstSyncMeaning: "first successful host.sync for this app generation",
      firstRootMeaning: "first qualifying populated root, independent of this sync and may follow fixture timing",
    };
  }
  if (Number.isFinite(clockBefore) && Number.isFinite(clockAfter) && Number.isFinite(page?.sampledAt)) {
    raw.clockBracketMs = { hostBefore: clockBefore, browserSample: page.sampledAt, hostAfter: clockAfter };
  }
  const incomplete = (reason) => ({ ...raw, status: "inconclusive", reason });
  if (!raw.hostStampsMs || host.boundsEnd - host.fixtureStart !== fixtureLoadMs) return incomplete("host-stamps");
  if (!raw.browser) return incomplete("live-page-stamps");

  const low = clockBefore - page.sampledAt;
  const high = clockAfter - page.sampledAt;
  const uncertaintyMs = high - low;
  if (!raw.clockBracketMs || !Number.isFinite(low) || !Number.isFinite(high)
    || clockBefore < host.boundsEnd || uncertaintyMs < 0 || uncertaintyMs > 500) {
    return incomplete("clock-window");
  }
  const navigationLow = Math.max(low, host.fixtureStart);
  const navigationHigh = Math.min(high, host.domContentLoaded);
  if (navigationLow > navigationHigh || navigationHigh + times.canvasAttached > host.boundsEnd) {
    return incomplete("navigation-or-canvas-window");
  }

  const relativeToFixtureStart = (stamp) => [navigationLow + stamp - host.fixtureStart, navigationHigh + stamp - host.fixtureStart];
  return {
    ...raw, status: "observed",
    clock: { hostMinusBrowserMs: [low, high], uncertaintyMs,
      navigationConstrainedHostMinusBrowserMs: [navigationLow, navigationHigh] },
    fromFixtureStartMs: {
      canvasAttached: relativeToFixtureStart(times.canvasAttached),
      firstSyncEnd: relativeToFixtureStart(times.firstSyncEnd),
      firstRootPresented: relativeToFixtureStart(times.firstRootPresented),
    },
  };
}

/** Await completion on a redirected stdout stream before the caller's original exit. */
export function flushM27PhaseLine(stdout, json) {
  return new Promise((resolve) => {
    const onError = () => resolve();
    stdout.once("error", onError);
    try {
      stdout.write(`[perf-smoke] m27-phase ${json}\n`, (error) => {
        // Node emits the error after running the failed write's callback.
        if (!error) stdout.off("error", onError);
        resolve();
      });
    } catch {
      stdout.off("error", onError);
      resolve();
    }
  });
}
