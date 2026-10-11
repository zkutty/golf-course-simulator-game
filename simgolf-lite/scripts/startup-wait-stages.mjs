// ZK-1331: bounded Node-clock observations only; no runtime or numerical authority.
export const STARTUP_WAIT_STAGES = Object.freeze([
  Object.freeze({ code: 1, name: "fixture-goto-domcontentloaded" }),
  Object.freeze({ code: 2, name: "existing-sleep-500" }),
  Object.freeze({ code: 3, name: "canvas-visible" }),
  Object.freeze({ code: 4, name: "canvas-positive-dimensions" }),
  Object.freeze({ code: 5, name: "canvas-bounding-box" }),
]);
const stamp = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const boundedText = (s, cap) => typeof s === "string" && s.length > 0 && s.length <= cap;

// Never accepts, formats, or reflects on a real awaited rejection.
// A diagnostic failure records HOLD and cannot throw over the real await.
export function createStartupWaitStages({
  now, fixtureURL, sourceUnit = "ZK-1331_SOURCE1", invocation = 1,
  measureBytes = (text) => new TextEncoder().encode(text).length,
}) {
  const rows = [];
  const tokens = new Map();
  let active = null, previous = null, failure = null, finished = false;
  const fail = (code) => { if (failure === null) failure = code; };
  if (typeof now !== "function" || typeof measureBytes !== "function") fail("diagnostic-function");
  const navigation = {
    sourceUnit: boundedText(sourceUnit, 64) ? sourceUnit : null,
    fixtureURL: boundedText(fixtureURL, 1024) ? fixtureURL : null,
    invocation: Number.isSafeInteger(invocation) && invocation > 0 ? invocation : null,
    candidateQualified: false, browserDocumentIdentity: false,
  };
  if (navigation.sourceUnit === null || navigation.fixtureURL === null || navigation.invocation === null) fail("navigation-identity");
  const observe = (supplied, explicit) => {
    let t = supplied;
    if (!explicit) {
      try { t = now(); }
      catch { fail("clock-threw"); return null; }
    }
    if (!stamp(t) || (previous !== null && t < previous)) { fail("clock-order"); return null; }
    previous = t;
    return t;
  };
  const begin = (code) => {
    if (finished) { fail("already-finished"); return null; }
    if (rows.length >= 5) { fail("row-cap"); return null; }
    if (active !== null) { fail("pending-stage"); return null; }
    const declared = STARTUP_WAIT_STAGES[rows.length];
    if (code !== declared.code) { fail("stage-order"); return null; }
    const row = { code, name: declared.name, start: observe(undefined, false), end: null, outcome: "pending" };
    const token = Object.freeze({});
    rows.push(row); tokens.set(token, row); active = token;
    return token;
  };
  const end = (token, outcome, canonicalEndpoint) => {
    if (finished || token === null || token !== active || !tokens.has(token)) { fail("stage-token"); return; }
    if (outcome !== "success" && outcome !== "rejected") { fail("stage-outcome"); return; }
    const row = tokens.get(token);
    row.end = observe(canonicalEndpoint, canonicalEndpoint !== undefined);
    row.outcome = outcome;
    if (outcome === "rejected") fail("real-await-rejected");
    active = null;
  };
  const finish = (start, endpoint, duration) => {
    if (finished) fail("already-finished");
    finished = true;
    const canonical = {
      start: stamp(start) ? start : null,
      end: stamp(endpoint) ? endpoint : null,
      duration: stamp(duration) ? duration : null,
    };
    if (!stamp(start) || !stamp(endpoint) || !stamp(duration) || endpoint < start || endpoint - start !== duration) fail("canonical-clock");
    if (active !== null || rows.length !== 5) fail("incomplete-stages");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.code !== STARTUP_WAIT_STAGES[i].code || !stamp(row.start) || !stamp(row.end) ||
          row.start < start || row.end < row.start || row.end > endpoint ||
          (i > 0 && row.start < rows[i - 1].end)) fail("stage-bounds");
      if (row.outcome !== "success") fail("unsuccessful-stage");
    }
    const snapshot = {
      version: 1, domain: "node.performance.now",
      navigation, canonical,
      rows: rows.map((row) => ({ ...row })),
      status: failure === null ? "COMPLETE" : "HOLD",
      eligible: failure === null,
      failure,
      numericPass: false, trusted: false, releaseCleared: false,
      qualification: "Observed await spans include overhead; no stage-sum, causal, removable-work, native, or browser-clock claim.",
    };
    try {
      const bytes = measureBytes(JSON.stringify(snapshot));
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 8192) fail("byte-cap");
    } catch { fail("diagnostic-serialization"); }
    if (failure !== snapshot.failure) {
      snapshot.navigation = { sourceUnit: null, fixtureURL: null, invocation: null,
        candidateQualified: false, browserDocumentIdentity: false };
      snapshot.failure = failure; snapshot.status = "HOLD"; snapshot.eligible = false;
    }
    // With five fixed rows, finite numeric stamps, and bounded/null identity,
    // even the serializer-failure fallback has a fixed structural byte bound.
    return snapshot;
  };
  return Object.freeze({ begin, end, finish });
}
