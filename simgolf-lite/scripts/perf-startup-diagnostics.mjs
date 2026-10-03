import { existsSync, mkdirSync, realpathSync, writeFileSync, renameSync, openSync, writeSync, closeSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_NETWORK_EVENTS = 4000;
export const MAX_CPU_SAMPLES = 200000;
const MAX_PROFILE_BYTES = 20 * 1024 * 1024;

function physicalPath(path) {
  let ancestor = resolve(path);
  const suffix = [];
  while (!existsSync(ancestor)) { suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor); }
  return join(realpathSync(ancestor), ...suffix);
}
export function diagnosticsDirectory(directory, outputPath, canonicalRawDirectory = new URL("../artifacts/zk682/raw", import.meta.url)) {
  const target = physicalPath(directory);
  const protectedDirectories = [
    dirname(outputPath instanceof URL ? fileURLToPath(outputPath) : resolve(outputPath)),
    canonicalRawDirectory instanceof URL ? fileURLToPath(canonicalRawDirectory) : canonicalRawDirectory,
  ];
  for (const protectedDirectory of protectedDirectories) {
    const raw = physicalPath(protectedDirectory);
    const nested = relative(raw, target);
    if (!nested || (!nested.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && nested !== ".." && !isAbsolute(nested))) {
      throw new Error("PERF_DIAGNOSTICS_DIR must be outside both canonical raw and performance evidence directories");
    }
  }
  return target;
}

export function summarizeCpuProfile(profile, phases = []) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const phaseTables = new Map(phases.map((phase) => [phase.name, { self: new Map(), inclusive: new Map(), sampledMs: 0 }]));
  const totals = { self: new Map(), inclusive: new Map(), sampledMs: 0 };
  let timestamp = profile.startTime;
  const label = (node) => ({ functionName: (node.callFrame.functionName || "(anonymous)").slice(0, 256), url: node.callFrame.url.slice(0, 1024), line: node.callFrame.lineNumber + 1, column: node.callFrame.columnNumber + 1 });
  const add = (table, id, ms) => table.set(id, (table.get(id) ?? 0) + ms);
  const sampleCount = Math.min(profile.samples?.length ?? 0, MAX_CPU_SAMPLES);
  for (let index = 0; index < sampleCount; index++) {
    const delta = profile.timeDeltas?.[index] ?? 0;
    timestamp += delta;
    const id = profile.samples[index];
    const ms = delta / 1000;
    const tables = [totals, ...phases.filter((phase) => timestamp >= phase.startUs && timestamp <= phase.endUs).map((phase) => phaseTables.get(phase.name))];
    for (const table of tables) {
      table.sampledMs += ms;
      add(table.self, id, ms);
      let ancestor = id;
      const seen = new Set();
      while (nodes.has(ancestor) && !seen.has(ancestor)) { seen.add(ancestor); add(table.inclusive, ancestor, ms); ancestor = parents.get(ancestor); }
    }
  }
  const top = (table) => [...table].filter(([id]) => nodes.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id, ms]) => {
    const stack = [];
    let ancestor = id;
    while (nodes.has(ancestor) && stack.length < 16) { stack.push(label(nodes.get(ancestor))); ancestor = parents.get(ancestor); }
    return { ...label(nodes.get(id)), ms, stack };
  });
  const pack = (table) => ({ sampledMs: table.sampledMs, topSelf: top(table.self), topInclusive: top(table.inclusive) });
  return { observedSamples: profile.samples?.length ?? 0, retainedSamples: sampleCount, truncated: (profile.samples?.length ?? 0) > sampleCount, overall: pack(totals), phases: Object.fromEntries([...phaseTables].map(([name, table]) => [name, pack(table)])) };
}

export function cpuProfileCoverage(profile, phases) {
  const validSamples = Array.isArray(profile?.nodes) && profile.nodes.length > 0
    && Array.isArray(profile.samples) && profile.samples.length > 0
    && Array.isArray(profile.timeDeltas) && profile.timeDeltas.length === profile.samples.length
    && profile.timeDeltas.every(value => Number.isFinite(value) && value >= 0);
  const coverage = phases.map(phase => ({ name: phase.name, covered: validSamples
    && Number.isFinite(profile.startTime) && Number.isFinite(profile.endTime)
    && Number.isFinite(phase.startUs) && Number.isFinite(phase.endUs)
    && phase.startUs <= phase.endUs && profile.startTime <= phase.startUs && profile.endTime >= phase.endUs }));
  return { complete: validSamples && coverage.length === 2 && coverage.every(phase => phase.covered),
    startUs: profile?.startTime ?? null, endUs: profile?.endTime ?? null, phases: coverage };
}

export async function startStartupDiagnostics(page, directory, metadata, { trace = false } = {}) {
  let browserTrace;
  let cdp;
  let offsetUs;
  let clockBefore;
  let clockAfter;
  let profiling = false;
  let stopPromise;
  let disposed = false;
  let finishStarted = false;
  const failures = [];
  const events = [];
  const boundaries = [];
  let observedEvents = 0;
  const listeners = [];
  const reportFailure = (stage, error) => {
    const message = String(error?.message ?? error).slice(0, 2048);
    console.error(`[perf-smoke] startup diagnostics ${stage} failed: ${message}`);
    if (failures.length < 8) failures.push({ stage, message });
    try {
      mkdirSync(directory, { recursive: true });
      atomicJson(join(directory, "startup-error.json"), { diagnosticOnly: true, ...metadata, failures });
    } catch (writeError) { console.error(`[perf-smoke] diagnostic error file unavailable: ${writeError.message}`); }
  };
  const record = (type, data) => { observedEvents++; if (events.length < MAX_NETWORK_EVENTS) events.push({ type, ...data }); };
  const listen = (event, handler) => { cdp.on(event, handler); listeners.push([event, handler]); };
  const stop = () => {
    if (!stopPromise && profiling) stopPromise = boundedCommand(cdp, "Profiler.stop");
    return stopPromise;
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (!finishStarted && !failures.length) reportFailure("incomplete", new Error("Startup capture ended before readiness"));
    for (const [event, handler] of listeners.splice(0)) {
      try { cdp.off(event, handler); } catch (error) { reportFailure("listener teardown", error); }
    }
    try { await stop(); } catch (error) { reportFailure("stop", error); }
    try { await browserTrace?.dispose(); } catch (error) { reportFailure("trace teardown", error); }
    try { await cdp?.detach(); } catch (error) { reportFailure("detach", error); }
  };
  try {
    mkdirSync(directory, { recursive: true });
    for (const name of ["startup.cpuprofile", "startup-network.json", "startup-summary.json", "startup-error.json", "startup.trace.json"]) {
      rmSync(join(directory, name), { force: true });
      rmSync(join(directory, `${name}.part`), { force: true });
    }
    cdp = await page.context().newCDPSession(page);
    listen("Network.requestWillBeSent", (event) => record("request", { id: event.requestId, timestamp: event.timestamp, url: event.request.url.slice(0, 1024), resourceType: event.type, initiator: event.initiator?.type }));
    listen("Network.responseReceived", (event) => record("response", { id: event.requestId, timestamp: event.timestamp, status: event.response.status, mimeType: event.response.mimeType, fromDiskCache: event.response.fromDiskCache }));
    listen("Network.loadingFinished", (event) => record("finished", { id: event.requestId, timestamp: event.timestamp, encodedBytes: event.encodedDataLength }));
    listen("Network.loadingFailed", (event) => record("failed", { id: event.requestId, timestamp: event.timestamp, error: event.errorText }));
    listen("Page.domContentEventFired", (event) => record("domContentLoaded", { timestamp: event.timestamp }));
    listen("Page.loadEventFired", (event) => record("load", { timestamp: event.timestamp }));
    await boundedCommand(cdp, "Network.enable");
    await boundedCommand(cdp, "Page.enable");
    await boundedCommand(cdp, "Performance.enable");
    await boundedCommand(cdp, "Profiler.enable");
    await boundedCommand(cdp, "Profiler.setSamplingInterval", { interval: 1000 });
    profiling = true;
    await boundedCommand(cdp, "Profiler.start");
    clockBefore = performance.now();
    const { metrics } = await boundedCommand(cdp, "Performance.getMetrics");
    clockAfter = performance.now();
    const browserSeconds = metrics.find((metric) => metric.name === "Timestamp")?.value;
    if (!Number.isFinite(browserSeconds)) throw new Error("Diagnostic browser monotonic clock unavailable");
    offsetUs = browserSeconds * 1e6 - (clockBefore + clockAfter) / 2 * 1000;
    if (trace) browserTrace = await startBrowserTrace(page.context().browser(), directory, reportFailure);
  } catch (error) { reportFailure("start", error); await dispose(); }
  return {
    mark(name, nodeMs) { if (!disposed && boundaries.length < 16) boundaries.push({ name, nodeMs, browserUs: nodeMs * 1000 + offsetUs }); },
    dispose,
    async finish(readiness) {
      finishStarted = true;
      if (disposed) return { ok: false };
      let captured = false;
      let summary;
      const boundary = (name) => boundaries.find((entry) => entry.name === name)?.browserUs;
      const phases = [
        { name: "cold", startUs: boundary("cold-start"), endUs: boundary("cold-ready") },
        { name: "fixture", startUs: boundary("fixture-start"), endUs: boundary("fixture-ready") },
      ];

      try {
        // Both stops are requested synchronously after the captured readiness boundary.
        const profileResult = stop();
        const traceResult = browserTrace?.finish(phases);
        const [profileOutcome, traceOutcome] = await Promise.allSettled([profileResult, traceResult]);
        if (profileOutcome.status === "rejected") throw profileOutcome.reason;
        if (traceOutcome.status === "rejected") throw traceOutcome.reason;
        const { profile } = profileOutcome.value;
      const traceSummary = traceOutcome.value ?? null;
      const requests = new Map();
      for (const event of events) {
        if (event.type === "request") requests.set(event.id, { url: event.url, start: event.timestamp, resourceType: event.resourceType });
        if (event.type === "finished" || event.type === "failed") { const request = requests.get(event.id); if (request) Object.assign(request, { end: event.timestamp, durationMs: (event.timestamp - request.start) * 1000, encodedBytes: event.encodedBytes, error: event.error }); }
      }
      const serializedProfile = JSON.stringify(profile);
      const profileWritten = Buffer.byteLength(serializedProfile) <= MAX_PROFILE_BYTES;
      if (profileWritten) atomicWrite(join(directory, "startup.cpuprofile"), serializedProfile);
      else reportFailure("profile bytes", new Error("CPU profile byte limit exceeded"));
      const cpu = summarizeCpuProfile(profile, phases);
      const cpuCoverage = cpuProfileCoverage(profile, phases);
      if (!cpuCoverage.complete) reportFailure("CPU coverage", new Error("CPU profile does not cover both startup phases"));
      if (cpu.truncated) reportFailure("CPU samples", new Error("CPU sample limit exceeded"));
      if (observedEvents > events.length) reportFailure("network events", new Error("Network event limit exceeded"));
      if (trace && !traceSummary?.complete) reportFailure("trace completeness", new Error("Requested browser trace is incomplete"));
      atomicJson(join(directory, "startup-network.json"), { observedEvents, retainedEvents: events.length, truncated: observedEvents > events.length, events });
      summary = {
        schemaVersion: 1, diagnosticOnly: true,
        caution: "Profiler/network/browser-trace instrumentation adds overhead; this diagnostic run cannot establish uninstrumented acceptance.",
        ...metadata, readiness, boundaries, clockCalibrationUncertaintyMs: (clockAfter - clockBefore) / 2,
        traceRequested: trace, trace: traceSummary,
        profileWritten, profileBytes: Buffer.byteLength(serializedProfile), limits: { maxCpuSamples: MAX_CPU_SAMPLES, maxNetworkEvents: MAX_NETWORK_EVENTS, maxProfileBytes: MAX_PROFILE_BYTES },
        cpu, cpuCoverage,
        network: { observedEvents, retainedEvents: events.length, truncated: observedEvents > events.length, slowestRequests: [...requests.values()].filter((request) => request.durationMs != null).sort((a, b) => b.durationMs - a.durationMs).slice(0, 30) },
      };
      } catch (error) { reportFailure("capture", error); }
      finally { await dispose(); }
      if (summary) {
        try {
          summary.complete = failures.length === 0;
          summary.errorCount = failures.length;
          atomicJson(join(directory, "startup-summary.json"), summary);
          captured = summary.complete;
        } catch (error) { reportFailure("summary persistence", error); }
      }
      return { ok: captured && failures.length === 0 };
    },
  };
}

export const MAX_TRACE_BYTES = 32 * 1024 * 1024;
export const MAX_TRACE_EVENTS = 200000;
const TRACE_TIMEOUT_MS = 20000;
const TRACE_START_MARKER = "coursecraft-startup-before-cold";
const TRACE_END_MARKER = "coursecraft-startup-after-fixture-ready";
// Chromium149 emits the needed RunTask interval here without broad task/mojo
// metadata from toplevel (thread_controller_with_message_pump_impl.cc:412).
const TRACE_CATEGORIES = ["disabled-by-default-devtools.timeline", "devtools.timeline", "gpu", "v8"];
function atomicWrite(path, serialized) {
  try {
    writeFileSync(`${path}.part`, serialized);
    renameSync(`${path}.part`, path);
  } catch (error) {
    // Remove only our file; preserve the original write/rename error if cleanup
    // itself fails (for example when an existing directory blocks the write).
    try { rmSync(`${path}.part`, { force: true }); } catch { /* reported original error */ }
    throw error;
  }
}
function atomicJson(path, value) {
  atomicWrite(path, JSON.stringify(value, null, 2));
}
const boundedCommand = (session, command, params, timeoutMs = TRACE_TIMEOUT_MS) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Trace command timed out: ${command}`)), Math.max(1, timeoutMs));
  Promise.resolve().then(() => session.send(command, params)).then(resolve, reject).finally(() => clearTimeout(timer));
});

// Wall-time unions are calculated separately for each thread and event name.
// Nested events and simultaneously active GPU/renderer threads must not be added
// together to claim an amount of total startup time explained.
export function summarizeTrace(traceEvents, phases = []) {
  const events = traceEvents.slice(0, MAX_TRACE_EVENTS);
  const threads = new Map();
  for (const event of events) if (event.ph === "M" && event.name === "thread_name") threads.set(`${event.pid}:${event.tid}`, String(event.args?.name ?? "").slice(0, 256));
  const union = (intervals) => {
    let total = 0, end = -Infinity;
    for (const [start, finish] of intervals.sort((a, b) => a[0] - b[0])) {
      total += Math.max(0, finish - Math.max(start, end));
      end = Math.max(end, finish);
    }
    return total / 1000;
  };
  const tables = new Map(phases.map(phase => [phase.name, new Map()]));
  const pending = new Map();
  const completed = [];
  for (const event of events) {
    const thread = `${event.pid}:${event.tid}`;
    if (event.ph === "B") { const stack = pending.get(thread) ?? []; stack.push(event); pending.set(thread, stack); }
    if (event.ph === "E") {
      const begin = pending.get(thread)?.pop();
      if (begin) completed.push({ ...begin, dur: event.ts - begin.ts });
    }
    if (event.ph === "X") completed.push(event);
  }
  for (const event of completed) {
    if (!Number.isFinite(event.ts) || !Number.isFinite(event.dur) || event.dur < 0) continue;
    const thread = `${event.pid}:${event.tid}`;
    for (const phase of phases) {
      const start = Math.max(event.ts, phase.startUs), end = Math.min(event.ts + event.dur, phase.endUs);
      if (!(end > start)) continue;
      const key = `${thread}|${event.name}|${event.cat}`;
      const table = tables.get(phase.name);
      const row = table.get(key) ?? { pid: event.pid, tid: event.tid, thread: threads.get(thread) ?? null, name: String(event.name).slice(0, 256), category: String(event.cat ?? "").slice(0, 256), intervals: [], count: 0 };
      row.intervals.push([start, end]); row.count++; table.set(key, row);
    }
  }
  return {
    observedEvents: traceEvents.length, retainedEvents: events.length, truncated: traceEvents.length > events.length,
    phases: Object.fromEntries([...tables].map(([name, table]) => [name, [...table.values()].map(({ intervals, ...row }) => ({ ...row, wallUnionMs: union(intervals) })).sort((a, b) => b.wallUnionMs - a.wallUnionMs).slice(0, 40)])),
    caution: "Per-thread/name unions overlap across names and processes; do not sum them. Native attribution requires matching event timelines to CPU program intervals.",
  };
}

export async function startBrowserTrace(browser, directory, reportFailure, limits = {}) {
  const byteLimit = Math.min(limits.maxBytes ?? MAX_TRACE_BYTES, MAX_TRACE_BYTES);
  let session, started = false, disposed = false, ending, finishing, stream, fd;
  let completeResolve;
  const complete = new Promise(resolve => { completeResolve = resolve; });
  let highestBufferUsage = 0;
  const completion = event => { stream = event.stream; completeResolve(event); };
  const waitForComplete = (timeoutMs = TRACE_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Trace completion timed out")), Math.max(1, timeoutMs));
    complete.then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const bufferUsage = event => { highestBufferUsage = Math.max(highestBufferUsage, event.percentFull ?? 0); };
  let categories = [];
  const part = join(directory, "startup.trace.json.part");
  const end = () => {
    if (started && !ending) ending = boundedCommand(session, "Tracing.end");
    return ending;
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try { if (started) { await end(); await waitForComplete(); } } catch (error) { reportFailure("trace stop", error); }
    if (fd !== undefined) { try { closeSync(fd); } catch (error) { reportFailure("trace file close", error); } fd = undefined; }
    if (stream) { try { await boundedCommand(session, "IO.close", { handle: stream }); } catch (error) { reportFailure("trace stream close", error); } stream = null; }
    if (session) {
      for (const [name, handler] of [["Tracing.tracingComplete", completion], ["Tracing.bufferUsage", bufferUsage]]) {
        try { session.off(name, handler); } catch (error) { reportFailure("trace listener teardown", error); }
      }
      try { await session.detach(); } catch (error) { reportFailure("trace detach", error); }
    }
    try { rmSync(part, { force: true }); } catch (error) { reportFailure("trace partial cleanup", error); }
  };
  try {
    if (!Number.isInteger(byteLimit) || byteLimit <= 0) throw new Error("Trace byte limit must be positive and finite");
    session = await browser.newBrowserCDPSession();
    const available = (await boundedCommand(session, "Tracing.getCategories")).categories;
    categories = TRACE_CATEGORIES.filter(category => available.includes(category));
    if (!categories.includes("disabled-by-default-devtools.timeline") || !categories.includes("devtools.timeline")) throw new Error("Required browser tracing categories unavailable");
    session.on("Tracing.tracingComplete", completion); session.on("Tracing.bufferUsage", bufferUsage);
    started = true;
    await boundedCommand(session, "Tracing.start", { traceConfig: { recordMode: "recordUntilFull", traceBufferSizeInKb: 16384, includedCategories: categories }, transferMode: "ReturnAsStream", streamFormat: "json", streamCompression: "none", bufferUsageReportingInterval: 1000 });
    await boundedCommand(session, "Tracing.recordClockSyncMarker", { syncId: TRACE_START_MARKER });
  } catch (error) { reportFailure("trace start", error); await dispose(); }
  return {
    dispose,
    finish(phases) {
      if (finishing) return finishing;
      finishing = (async () => {
        if (disposed) return { complete: false, categories };
        let bytes = 0;
        const deadline = performance.now() + TRACE_TIMEOUT_MS;
        try {
          // Called after the existing fixture-ready timestamp is captured.
          // This marker verifies trace coverage without changing that timestamp.
          await boundedCommand(session, "Tracing.recordClockSyncMarker", { syncId: TRACE_END_MARKER });
          const stopping = end();
          await stopping;
          const result = await waitForComplete(deadline - performance.now());
          stream = result.stream;
          if (!stream) throw new Error("Trace stream unavailable");
          if (result.dataLossOccurred) throw new Error("Browser trace reported data loss");
          fd = openSync(part, "w");
          for (let reads = 0; ; reads++) {
            if (reads >= 1024) throw new Error("Trace stream read limit exceeded");
            const remaining = deadline - performance.now();
            if (remaining <= 0) throw new Error("Trace stream deadline exceeded");
            const chunk = await boundedCommand(session, "IO.read", { handle: stream, size: 64 * 1024 }, remaining);
            const data = Buffer.from(chunk.data ?? "", chunk.base64Encoded ? "base64" : "utf8");
            bytes += data.length;
            if (bytes > byteLimit) throw new Error("Trace byte limit exceeded");
            writeSync(fd, data);
            if (chunk.eof) break;
          }
          closeSync(fd); fd = undefined;
          const trace = JSON.parse(readFileSync(part, "utf8"));
          if (!Array.isArray(trace.traceEvents)) throw new Error("Trace event array unavailable");
          const summary = summarizeTrace(trace.traceEvents, phases);
          const marker = id => trace.traceEvents.find(event => event.name === "clock_sync" && event.args?.sync_id === id);
          const startMarkerUs = marker(TRACE_START_MARKER)?.ts;
          const endMarkerUs = marker(TRACE_END_MARKER)?.ts;
          const coverage = {
            clock: "Chromium monotonic TimeTicks (microseconds); verified by clock_sync markers bracketing calibrated phase boundaries",
            startMarkerUs, endMarkerUs,
            phases: (phases ?? []).map(phase => ({ name: phase.name, covered: Number.isFinite(startMarkerUs) && Number.isFinite(endMarkerUs)
              && Number.isFinite(phase.startUs) && Number.isFinite(phase.endUs)
              && startMarkerUs <= phase.startUs && endMarkerUs >= phase.endUs })),
          };
          const covered = coverage.phases.length > 0 && coverage.phases.every(phase => phase.covered);
          if (!covered) reportFailure("trace coverage", new Error("Trace clock markers do not bracket the measured startup phases"));
          if (highestBufferUsage >= 1) reportFailure("trace buffer", new Error("Browser trace buffer filled before capture completed"));
          renameSync(part, join(directory, "startup.trace.json"));
          if (summary.truncated) reportFailure("trace events", new Error("Trace summary event limit exceeded"));
          return { complete: !summary.truncated && covered && highestBufferUsage < 1, coverage, categories, bytes, highestBufferUsage, limits: { maxBytes: byteLimit, maxEvents: MAX_TRACE_EVENTS }, ...summary };
        } catch (error) { reportFailure("trace capture", error); return { complete: false, categories, bytes, highestBufferUsage }; }
        finally { await dispose(); }
      })();
      return finishing;
    },
  };
}
