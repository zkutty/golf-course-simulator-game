// Fixed numeric observations only. This module supplies no source/runtime authority.
const LIMIT = 256;
const PHASES = Object.freeze(Array.from({ length: 15 }, (_, i) => i + 1));
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const stamp = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

export function createStartupRecorder({ now, start, timeOrigin }) {
  const events = [];
  const active = new Map();
  const ended = new Map();
  const generations = new Map();
  const finishedAttempts = new Set();
  let next = 0, attempt = 0, previous = start, ready = null, failure = null, overflow = false;
  const fail = (code) => { if (failure === null) failure = code; };
  if (typeof now !== "function" || !stamp(start) || !stamp(timeOrigin)) fail(10);
  const emit = (kind, phase, id, parent, ownerAttempt, generation) => {
    if (ready !== null) return null;
    let t;
    try { t = now(); } catch { fail(10); return null; }
    if (!stamp(t) || !stamp(previous) || t < previous) { fail(10); return null; }
    previous = t;
    if (events.length >= LIMIT) { overflow = true; fail(20); return null; }
    const row = [events.length, kind, phase, id, parent, ownerAttempt, generation, t];
    events.push(row);
    return row;
  };
  const owner = (generation) => {
    if (ready !== null) return 0;
    if (attempt >= LIMIT) { overflow = true; fail(20); return 0; }
    const id = ++attempt;
    if (!integer(generation)) { fail(32); generation = 0; }
    generations.set(id, generation);
    return id;
  };
  const begin = (phase, parent = null, ownerAttempt = 0) => {
    if (ready !== null) return null;
    if (!PHASES.includes(phase) || !integer(ownerAttempt) ||
        (ownerAttempt !== 0 && !generations.has(ownerAttempt))) { fail(30); return null; }
    if (parent !== null && !active.has(parent.id)) { fail(31); return null; }
    const token = Object.freeze({ id: ++next, phase, parent: parent?.id ?? 0,
      attempt: ownerAttempt, generation: generations.get(ownerAttempt) ?? 0 });
    if (!emit(0, phase, token.id, token.parent, token.attempt, token.generation)) return null;
    active.set(token.id, token);
    return token;
  };
  const end = (token, kind = 1) => {
    if (token === null || ready !== null) return;
    if (ended.get(token.id) === token) return;
    if (![1, 2, 3].includes(kind) || active.get(token.id) !== token) { fail(31); return; }
    emit(kind, token.phase, token.id, token.parent, token.attempt, token.generation);
    active.delete(token.id);
    ended.set(token.id, token);
  };
  const finishAttempt = (id, kind = 3) => {
    if (ready !== null || id === 0) return;
    if (!generations.has(id) || ![2, 3].includes(kind)) { fail(31); return; }
    if (finishedAttempts.has(id)) return;
    finishedAttempts.add(id);
    for (const token of [...active.values()]) if (token.attempt === id) end(token, kind);
    emit(kind === 3 ? 5 : 6, 0, 0, 0, id, generations.get(id));
  };
  const span = (phase, fn, parent = null, ownerAttempt = 0) => {
    const token = begin(phase, parent, ownerAttempt);
    let completed = false;
    try { const result = fn(token); completed = true; return result; }
    finally { end(token, completed ? 1 : 2); }
  };
  const markReady = () => {
    if (ready !== null) return;
    const row = emit(4, 0, 0, 0, 0, 0);
    if (row) ready = row[7];
  };
  const snapshot = () => ({ version: 1, clock: { start, timeOrigin },
    ready, failure, overflow, events: events.map((row) => row.slice()) });
  return Object.freeze({ owner, begin, end, finishAttempt, span, markReady, snapshot });
}

function unionLength(intervals) {
  const sorted = intervals.map((pair) => pair.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0, low = null, high = null;
  for (const [a, b] of sorted) {
    if (low === null) { low = a; high = b; }
    else if (a > high) { total += high - low; low = a; high = b; }
    else high = Math.max(high, b);
  }
  return total + (low === null ? 0 : high - low);
}

export function analyzeStartupAttribution(journal) {
  const result = { structuralOnly: true, trusted: false, eligible: false,
    firstFailure: null, secondaryFailures: [], phases: [], coveredMs: null, residualMs: null };
  const fail = (code) => {
    if (result.firstFailure === null) result.firstFailure = code;
    else result.secondaryFailures.push(code);
  };
  if (journal && integer(journal.failure)) fail({ producerFailure: journal.failure });
  if (!journal || journal.version !== 1 || !journal.clock || !stamp(journal.clock.start) ||
      !stamp(journal.clock.timeOrigin) || !stamp(journal.ready) || journal.ready < journal.clock.start ||
      !Array.isArray(journal.events) || journal.events.length > LIMIT ||
      typeof journal.overflow !== "boolean" || !(journal.failure === null || integer(journal.failure))) {
    fail("schema-or-clock"); return result;
  }
  // A recorded zero failure code is still a failure; never truthiness-test it.
  if (journal.overflow) fail("event-overflow");
  const open = new Map(), complete = new Map(), ownerState = new Map(), generation = new Map();
  let previous = journal.clock.start, readyCount = 0;
  for (const row of journal.events) {
    if (!Array.isArray(row) || row.length !== 8 || !row.slice(0, 7).every(integer) ||
        row[0] !== journal.events.indexOf(row) || !stamp(row[7]) || row[7] < previous || row[7] > journal.ready) {
      fail("row-or-order"); continue;
    }
    previous = row[7];
    const [, kind, phase, id, parent, ownerAttempt, gen, t] = row;
    if (ownerAttempt !== 0) {
      if (generation.has(ownerAttempt) && generation.get(ownerAttempt) !== gen) fail("generation-drift");
      generation.set(ownerAttempt, gen);
    } else if (gen !== 0) fail("foreign-generation");
    if (kind === 4) {
      if (phase || id || parent || ownerAttempt || gen || t !== journal.ready || row[0] !== journal.events.length - 1) fail("ready-row");
      readyCount++;
    } else if (kind === 5 || kind === 6) {
      if (phase || id || parent || !ownerAttempt) fail("attempt-row");
      if (ownerState.has(ownerAttempt)) fail("duplicate-attempt-terminal");
      ownerState.set(ownerAttempt, kind);
      if (kind === 6) fail("renderer-attempt-failed");
    } else if (kind === 0) {
      if (!PHASES.includes(phase) || !id || open.has(id) || complete.has(id)) { fail("begin-row"); continue; }
      if (parent && !open.has(parent)) fail("parent-not-active");
      open.set(id, row);
    } else if ([1, 2, 3].includes(kind)) {
      const begin = open.get(id);
      if (!begin || begin.slice(2, 7).some((v, i) => v !== row[i + 2])) { fail("unmatched-terminal"); continue; }
      open.delete(id);
      complete.set(id, { phase, id, parent, attempt: ownerAttempt, generation: gen,
        start: begin[7], end: t, terminal: kind });
      if (kind === 2) fail("phase-threw");
    } else fail("unknown-event");
  }
  if (open.size) fail("missing-terminal");
  if (readyCount !== 1) fail("missing-or-duplicate-ready");
  const successful = [...complete.values()].filter((p) => p.terminal === 1 &&
    (!p.attempt || !ownerState.has(p.attempt)));
  for (const phase of PHASES) if (!successful.some((p) => p.phase === phase)) fail({ missingPhase: phase });
  const initializationAttempts = new Set(successful.filter((p) => p.phase === 8 && p.attempt).map((p) => p.attempt));
  if (![...initializationAttempts].some((id) => [8, 9, 10, 11].every((phase) =>
    successful.some((p) => p.phase === phase && p.attempt === id)))) fail("missing-current-initialization-cohort");
  for (const phase of complete.values()) {
    if (phase.parent) {
      const parent = complete.get(phase.parent);
      if (!parent || phase.start < parent.start || phase.end > parent.end) fail("parent-bounds");
    }
    if ([2, 3, 4, 5, 7].includes(phase.phase) && complete.get(phase.parent)?.phase !== 1) fail("fixture-parent");
    if (phase.phase === 6 && complete.get(phase.parent)?.phase !== 7) fail("restore-parent");
    if ([8, 9, 10, 11].includes(phase.phase) && (!phase.attempt || phase.parent)) fail("initialization-owner");
  }
  result.phases = successful.map((p) => {
    const children = successful.filter((c) => c.parent === p.id);
    return { ...p, inclusiveMs: p.end - p.start,
      exclusiveMs: p.end - p.start - unionLength(children.map((c) => [c.start, c.end])) };
  });
  result.coveredMs = unionLength(successful.map((p) => [p.start, p.end]));
  result.residualMs = journal.ready - journal.clock.start - result.coveredMs;
  if (result.residualMs < 0 || result.phases.some((p) => p.exclusiveMs < 0)) fail("coverage-bounds");
  result.eligible = result.firstFailure === null;
  return result;
}

// Bound parser rejects duplicate keys before ordinary JSON values can hide them.
export function parseStartupAttribution(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 65536) throw new Error("JSON cap");
  let i = 0, nodes = 0;
  const ws = () => { while (/[\t\n\r ]/.test(text[i] ?? "!") ) i++; };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i++] === '"') { const value = JSON.parse(text.slice(start, i)); if (value.length > 2048) throw new Error("string cap"); return value; }
    }
    throw new Error("unterminated string");
  };
  const value = (depth) => {
    if (++nodes > 4096 || depth > 16) throw new Error("JSON structure cap");
    ws();
    if (text[i] === '"') return string();
    if (text[i] === "{") {
      i++; const out = Object.create(null), keys = new Set(); ws();
      if (text[i] === "}") { i++; return out; }
      for (;;) {
        ws(); if (text[i] !== '"') throw new Error("object key");
        const key = string(); if (keys.has(key)) throw new Error("duplicate JSON key"); keys.add(key);
        ws(); if (text[i++] !== ":") throw new Error("object colon"); out[key] = value(depth + 1); ws();
        const end = text[i++]; if (end === "}") return out; if (end !== ",") throw new Error("object separator");
      }
    }
    if (text[i] === "[") {
      i++; const out = []; ws(); if (text[i] === "]") { i++; return out; }
      for (;;) { out.push(value(depth + 1)); ws(); const end = text[i++]; if (end === "]") return out; if (end !== ",") throw new Error("array separator"); }
    }
    for (const [token, decoded] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, i)) { i += token.length; return decoded; }
    }
    const match = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error("JSON token"); i += match[0].length;
    const n = Number(match[0]); if (!Number.isFinite(n)) throw new Error("nonfinite JSON"); return n;
  };
  const out = value(0); ws(); if (i !== text.length) throw new Error("JSON trailing bytes"); return out;
}

export function validateStartupAttribution(journal, expected) {
  const result = analyzeStartupAttribution(journal);
  const qualified = expected?.sourceQualified === true && expected?.clockQualified === true &&
    expected?.runQualified === true && expected?.publicationQualified === true &&
    expected?.timeOrigin === journal?.clock?.timeOrigin &&
    typeof expected?.authenticatedJournalSHA256 === "string" && /^[0-9a-f]{64}$/.test(expected.authenticatedJournalSHA256) &&
    expected.authenticatedJournalSHA256 === expected.actualJournalSHA256;
  const accepted = qualified && result.eligible;
  return { ...result, structuralOnly: !accepted, trusted: accepted,
    diagnosticQualified: accepted,
    numericPass: false, releaseCleared: false, nativeChildClosure: "UNKNOWN" };
}

let recorder = null;
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  const params = new URLSearchParams(window.location.search);
  const bootstrap = window.__ccStartupAttributionBootstrap;
  if (params.get("m27Fixture") === "1" && params.get("perfMeasure") === "1" && bootstrap?.version === 1) {
    recorder = createStartupRecorder({ now: () => performance.now(),
      start: bootstrap.start, timeOrigin: bootstrap.timeOrigin });
    window.__ccStartupAttribution = recorder;
  }
}
export const startupAttempt = (generation) => recorder?.owner(generation) ?? 0;
export const startupBegin = (phase, parent = null, attempt = 0) => recorder?.begin(phase, parent, attempt) ?? null;
export const startupEnd = (token, kind = 1) => { recorder?.end(token, kind); };
export const startupCancel = (attempt, kind = 3) => { recorder?.finishAttempt(attempt, kind); };
export const startupSpan = (phase, fn, parent = null, attempt = 0) => recorder
  ? recorder.span(phase, fn, parent, attempt) : fn(null);
