import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
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

export async function startStartupDiagnostics(page, directory, metadata) {
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
      writeFileSync(join(directory, "startup-error.json"), JSON.stringify({ diagnosticOnly: true, ...metadata, failures }, null, 2));
    } catch (writeError) { console.error(`[perf-smoke] diagnostic error file unavailable: ${writeError.message}`); }
  };
  const record = (type, data) => { observedEvents++; if (events.length < MAX_NETWORK_EVENTS) events.push({ type, ...data }); };
  const listen = (event, handler) => { cdp.on(event, handler); listeners.push([event, handler]); };
  const stop = () => {
    if (!stopPromise && profiling) stopPromise = cdp.send("Profiler.stop");
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
    try { await cdp?.detach(); } catch (error) { reportFailure("detach", error); }
  };
  try {
    mkdirSync(directory, { recursive: true });
    cdp = await page.context().newCDPSession(page);
    listen("Network.requestWillBeSent", (event) => record("request", { id: event.requestId, timestamp: event.timestamp, url: event.request.url.slice(0, 1024), resourceType: event.type, initiator: event.initiator?.type }));
    listen("Network.responseReceived", (event) => record("response", { id: event.requestId, timestamp: event.timestamp, status: event.response.status, mimeType: event.response.mimeType, fromDiskCache: event.response.fromDiskCache }));
    listen("Network.loadingFinished", (event) => record("finished", { id: event.requestId, timestamp: event.timestamp, encodedBytes: event.encodedDataLength }));
    listen("Network.loadingFailed", (event) => record("failed", { id: event.requestId, timestamp: event.timestamp, error: event.errorText }));
    listen("Page.domContentEventFired", (event) => record("domContentLoaded", { timestamp: event.timestamp }));
    listen("Page.loadEventFired", (event) => record("load", { timestamp: event.timestamp }));
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Performance.enable");
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
    profiling = true;
    await cdp.send("Profiler.start");
    clockBefore = performance.now();
    const { metrics } = await cdp.send("Performance.getMetrics");
    clockAfter = performance.now();
    const browserSeconds = metrics.find((metric) => metric.name === "Timestamp")?.value;
    if (!Number.isFinite(browserSeconds)) throw new Error("Diagnostic browser monotonic clock unavailable");
    offsetUs = browserSeconds * 1e6 - (clockBefore + clockAfter) / 2 * 1000;
  } catch (error) { reportFailure("start", error); await dispose(); }
  return {
    mark(name, nodeMs) { if (!disposed && boundaries.length < 16) boundaries.push({ name, nodeMs, browserUs: nodeMs * 1000 + offsetUs }); },
    dispose,
    async finish(readiness) {
      finishStarted = true;
      if (disposed) return { ok: false };
      let captured = false;
      try {
        const { profile } = await stop();
      const boundary = (name) => boundaries.find((entry) => entry.name === name)?.browserUs;
      const phases = [
        { name: "cold", startUs: boundary("cold-start"), endUs: boundary("cold-ready") },
        { name: "fixture", startUs: boundary("fixture-start"), endUs: boundary("fixture-ready") },
      ];
      const requests = new Map();
      for (const event of events) {
        if (event.type === "request") requests.set(event.id, { url: event.url, start: event.timestamp, resourceType: event.resourceType });
        if (event.type === "finished" || event.type === "failed") { const request = requests.get(event.id); if (request) Object.assign(request, { end: event.timestamp, durationMs: (event.timestamp - request.start) * 1000, encodedBytes: event.encodedBytes, error: event.error }); }
      }
      const serializedProfile = JSON.stringify(profile);
      const profileWritten = Buffer.byteLength(serializedProfile) <= MAX_PROFILE_BYTES;
      if (profileWritten) writeFileSync(join(directory, "startup.cpuprofile"), serializedProfile);
      writeFileSync(join(directory, "startup-network.json"), JSON.stringify({ observedEvents, retainedEvents: events.length, truncated: observedEvents > events.length, events }, null, 2));
      writeFileSync(join(directory, "startup-summary.json"), JSON.stringify({
        schemaVersion: 1, diagnosticOnly: true,
        caution: "Profiler/network instrumentation adds overhead; this diagnostic run cannot establish uninstrumented acceptance.",
        ...metadata, readiness, boundaries, clockCalibrationUncertaintyMs: (clockAfter - clockBefore) / 2,
        profileWritten, profileBytes: Buffer.byteLength(serializedProfile), limits: { maxCpuSamples: MAX_CPU_SAMPLES, maxNetworkEvents: MAX_NETWORK_EVENTS, maxProfileBytes: MAX_PROFILE_BYTES },
        cpu: summarizeCpuProfile(profile, phases),
        network: { observedEvents, retainedEvents: events.length, truncated: observedEvents > events.length, slowestRequests: [...requests.values()].filter((request) => request.durationMs != null).sort((a, b) => b.durationMs - a.durationMs).slice(0, 30) },
      }, null, 2));
        captured = true;
      } catch (error) { reportFailure("capture", error); }
      finally { await dispose(); }
      return { ok: captured && failures.length === 0 };
    },
  };
}
