import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const samplingIntervalUs = 2_000;
const captureMs = 20_000;
const stopMs = 5_000;
const maxNodes = 8_192;
const maxSamples = 16_384;
const maxRequests = 2_048;
const maxTerminalIssueExamples = 8;
const maxBytes = 4 * 1024 * 1024;

export function profileOutputPath(env, enabledFixture, canonicalOutput) {
  if (env.PERF_M27_FIXTURE_PROFILE !== "1") return null;
  const value = env.PERF_M27_FIXTURE_PROFILE_OUTPUT;
  if (!enabledFixture || !value || basename(value) !== "m27-fixture-profile.json") {
    throw new Error("Secondary profile requires Parkland/M27 phase diagnostics and its own m27-fixture-profile.json output");
  }
  const output = resolve(value);
  if (output === (typeof canonicalOutput === "string" ? resolve(canonicalOutput) : fileURLToPath(canonicalOutput))) {
    throw new Error("Secondary profile output aliases canonical performance output");
  }
  return output;
}

function withTimeout(operation, ms) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic-command-timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const validId = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value, max) => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const clock = (value) => Number.isFinite(value) && value >= 0;

function localPath(url, origin) {
  if (!text(url, 2_048)) return null;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    if (parsed.origin !== origin || parsed.username || parsed.password || !text(pathname, 384)) return null;
    if (pathname === "/" || pathname === "/@react-refresh"
      || ["/src/", "/node_modules/.vite/", "/@vite/"].some((prefix) => pathname.startsWith(prefix))) return pathname;
  } catch { /* anonymous/internal frames have no local path */ }
  return null;
}

export function inspectCPUProfile(profile, origin) {
  const { nodes, samples, timeDeltas, startTime, endTime } = profile ?? {};
  const scalar = (value) => Number.isSafeInteger(value) ? value : null;
  const shape = {
    nodeCount: Array.isArray(nodes) ? nodes.length : null,
    sampleCount: Array.isArray(samples) ? samples.length : null,
    deltaCount: Array.isArray(timeDeltas) ? timeDeltas.length : null,
    startTime: scalar(startTime), endTime: scalar(endTime),
  };
  const reject = (reason, index = null, value = null) => ({
    cpu: null, validation: { status: "rejected", reason, ...shape, index, value: scalar(value) },
  });
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > maxNodes
    || !Array.isArray(samples) || samples.length === 0 || samples.length > maxSamples
    || !Array.isArray(timeDeltas) || samples.length !== timeDeltas.length
    || !validId(startTime) || !validId(endTime) || endTime <= startTime) return reject("shape-or-bounds");
  const ids = new Set();
  const byId = new Map();
  for (const [index, node] of nodes.entries()) {
    const id = node?.id;
    const children = node?.children ?? [];
    const frame = node?.callFrame;
    if (!validId(id) || ids.has(id) || !Array.isArray(children) || children.length >= nodes.length
      || !frame || !Number.isSafeInteger(frame.lineNumber) || !Number.isSafeInteger(frame.columnNumber)) return reject("invalid-node", index, id);
    const pathname = localPath(frame.url, origin);
    const internal = frame.url === "" && ["(root)", "(program)", "(idle)", "(garbage collector)"].includes(frame.functionName);
    const functionName = (pathname || internal) && text(frame.functionName, 128) ? frame.functionName : null;
    ids.add(id);
    byId.set(id, { id, children, pathname, functionName, line: frame.lineNumber, column: frame.columnNumber });
  }
  const visited = new Set();
  const pending = [nodes[0].id];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id) || !byId.has(id)) return reject("invalid-tree-reference", null, id);
    visited.add(id);
    for (const child of byId.get(id).children) {
      if (!validId(child) || pending.length + visited.size >= nodes.length) return reject("invalid-tree-child", null, child);
      pending.push(child);
    }
  }
  if (visited.size !== ids.size) return reject("disconnected-tree", null, visited.size);
  let elapsed = 0;
  for (let index = 0; index < samples.length; index++) {
    if (!ids.has(samples[index])) return reject("unknown-sample-node", index, samples[index]);
    if (!validId(timeDeltas[index])) return reject("invalid-sample-delta", index, timeDeltas[index]);
    elapsed += timeDeltas[index];
    if (elapsed > endTime - startTime) return reject("elapsed-exceeds-duration", index, elapsed);
  }
  return { cpu: { startTime, endTime, nodes: [...byId.values()], samples, timeDeltas },
    validation: { status: "accepted", reason: null, ...shape, index: null, value: null } };
}

export function projectCPUProfile(profile, origin) {
  return inspectCPUProfile(profile, origin).cpu;
}

export function profileClockBounds(cpu, begin, end) {
  if (!cpu || !begin || !end) return null;
  const start = cpu.startTime / 1_000;
  const stop = cpu.endTime / 1_000;
  const lower = Math.max(begin[0] - start, end[0] - stop);
  const upper = Math.min(begin[1] - start, end[1] - stop);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) return null;
  // Candidate constant-offset bracket only. It does not align Network time.
  return [lower, upper];
}

export function createNetworkLedger(fixtureURL, frameId) {
  const origin = new URL(fixtureURL).origin;
  const rows = new Map();
  const failures = new Set();
  const terminalIssueExamples = [];
  let navigation = null;
  let documentRequest = null;

  function onRequest({ frameId: frame, loaderId, requestId, request, timestamp, wallTime, type, initiator, redirectResponse }) {
    if (frame !== frameId || !request || !text(request.url, 2_048)) return;
    const isDocument = type === "Document";
    const pathname = localPath(request.url, origin);
    if (isDocument && request.url !== fixtureURL) {
      failures.add("unexpected-document-request");
      return;
    }
    if (!pathname || !["Document", "Script", "Stylesheet"].includes(type)) return;
    if (!text(requestId, 128) || !text(loaderId, 128) || !loaderId || !clock(timestamp)
      || redirectResponse || rows.has(requestId) || (isDocument && documentRequest)) {
      failures.add("ambiguous-network-request");
      return;
    }
    if (rows.size >= maxRequests) {
      failures.add("network-row-cap");
      return;
    }
    const row = { pathname, type, loaderId, started: timestamp, initiatorPath: localPath(initiator?.url, origin),
      cacheEvidence: null };
    rows.set(requestId, row);
    if (isDocument) {
      if (!clock(wallTime)) failures.add("missing-document-wall-anchor");
      documentRequest = { requestId, loaderId, timestamp, wallTime: clock(wallTime) ? wallTime : null };
    }
  }

  function recordCacheEvidence(row, evidence) {
    const seen = row.cacheEvidence ?? [];
    if (!seen.includes(evidence)) row.cacheEvidence = [...seen, evidence];
  }

  function onResponse({ requestId, timestamp, response }) {
    const row = rows.get(requestId);
    if (!row) return;
    if (!clock(timestamp) || timestamp < row.started || row.headersAt !== undefined
      || localPath(response?.url, origin) !== row.pathname || !validId(response?.status)) {
      failures.add("invalid-network-response");
      return;
    }
    row.headersAt = timestamp;
    row.httpStatus = response.status;
    if (response.fromDiskCache === true) recordCacheEvidence(row, "disk-cache-flag");
    if (response.fromServiceWorker === true) recordCacheEvidence(row, "service-worker-flag");
    if (response.fromPrefetchCache === true) recordCacheEvidence(row, "prefetch-cache-flag");
  }

  function onEnd({ requestId, timestamp }, failed) {
    const row = rows.get(requestId);
    if (!row) return;
    let reason;
    if (!clock(timestamp)) reason = "invalid-timestamp";
    else if (row.ended !== undefined) reason = "duplicate-terminal";
    else if (timestamp < row.started) reason = "before-request-start";
    else if (failed && row.headersAt !== undefined && timestamp < row.headersAt) reason = "failure-before-response-event";
    // A successful event carries the loader completion tick, which can
    // precede the inspector's responseReceived timestamp.
    if (reason) {
      failures.add("invalid-network-terminal");
      if (terminalIssueExamples.length < maxTerminalIssueExamples) {
        terminalIssueExamples.push({
          pathname: row.pathname, type: row.type, started: row.started, headersAt: row.headersAt ?? null,
          terminalAt: Number.isFinite(timestamp) ? timestamp : null, failed, reason,
        });
      }
      return;
    }
    row.ended = timestamp;
    row.failed = failed;
  }

  function onNavigation({ frame }) {
    if (frame.id !== frameId) return;
    if (navigation || frame.url !== fixtureURL || !text(frame.loaderId, 128) || !frame.loaderId) {
      failures.add("unexpected-main-frame-navigation");
      return;
    }
    navigation = { frameId, loaderId: frame.loaderId };
  }

  const listeners = [
    ["Page.frameNavigated", onNavigation],
    ["Page.frameDetached", (event) => { if (event.frameId === frameId) failures.add("main-frame-detached"); }],
    ["Page.navigatedWithinDocument", (event) => { if (event.frameId === frameId) failures.add("same-document-navigation"); }],
    ["Network.requestWillBeSent", onRequest],
    ["Network.responseReceived", onResponse],
    ["Network.requestServedFromCache", ({ requestId }) => {
      const row = rows.get(requestId);
      if (row) recordCacheEvidence(row, "request-served-from-cache-event");
    }],
    ["Network.loadingFinished", (event) => onEnd(event, false)],
    ["Network.loadingFailed", (event) => onEnd(event, true)],
  ];

  function report() {
    const document = documentRequest && rows.get(documentRequest.requestId);
    if (!navigation || !document || document.loaderId !== navigation.loaderId || document.ended === undefined
      || document.failed || document.httpStatus !== 200) failures.add("missing-qualified-main-document");
    return {
      timeUnit: "seconds in CDP Network monotonic time",
      timestampMeaning: {
        headersAt: "responseReceived event emission, not network header arrival",
        ended: "terminal event timestamp; successful loader completion can precede responseReceived emission",
      },
      status: failures.size ? "incomplete" : "observed",
      failures: [...failures],
      terminalIssueExamples,
      navigation,
      documentRequest,
      requests: [...rows.values()].filter((row) => row.loaderId === navigation?.loaderId),
    };
  }

  return { listeners, report };
}

export async function startProfile(session, fixtureURL) {
  const setup = () => withTimeout(async () => {
    const { frameTree } = await session.send("Page.getFrameTree");
    const frameId = frameTree?.frame?.id;
    if (!text(frameId, 128) || !frameId) throw new Error("missing-main-frame");
    return frameId;
  }, 2_000);
  let ledger;
  let timer;
  let begin;
  let finishing;
  try {
    const frameId = await setup();
    await withTimeout(() => session.send("Page.enable"), 2_000);
    await withTimeout(() => session.send("Network.enable", { maxPostDataSize: 0 }), 2_000);
    ledger = createNetworkLedger(fixtureURL, frameId);
    for (const [event, handler] of ledger.listeners) session.on(event, handler);
    await withTimeout(() => session.send("Profiler.enable"), 2_000);
    await withTimeout(() => session.send("Profiler.setSamplingInterval", { interval: samplingIntervalUs }), 2_000);
    const before = performance.now();
    await withTimeout(() => session.send("Profiler.start"), 2_000);
    begin = [before, performance.now()];
  } catch {
    for (const [event, handler] of ledger?.listeners ?? []) session.off(event, handler);
    await withTimeout(() => session.detach(), 2_000).catch(() => {});
    throw new Error("secondary-profile-start-failed");
  }

  function finish(reason, readDocument) {
    if (finishing) return finishing;
    clearTimeout(timer);
    finishing = (async () => {
      // Freeze resource timings at the stop request and keep main-frame
      // navigation checks live until the current-document read completes.
      for (const [event, handler] of ledger.listeners) if (event.startsWith("Network.")) session.off(event, handler);
      const before = performance.now();
      let end = null;
      let cpu = null;
      let cpuValidation = { status: "unavailable", reason: "profiler-stop-unavailable" };
      let browserEvidence = null;
      let terminalFrame = null;
      let detached = false;
      const failures = [];
      if (reason !== "fixture-bounds") failures.push(reason);
      if (before - begin[0] > captureMs) failures.push("capture-deadline");
      try {
        const result = await withTimeout(() => session.send("Profiler.stop"), stopMs);
        end = [before, performance.now()];
        ({ cpu, validation: cpuValidation } = inspectCPUProfile(result?.profile, new URL(fixtureURL).origin));
        if (!cpu) failures.push("invalid-or-capped-cpu-profile");
      } catch {
        failures.push("profiler-stop-failed");
      }
      if (readDocument) {
        try {
          browserEvidence = await withTimeout(readDocument, 2_000);
          const { frameTree } = await withTimeout(() => session.send("Page.getFrameTree"), 2_000);
          terminalFrame = frameTree?.frame;
        } catch {
          failures.push("terminal-document-read-failed");
        }
      }
      const network = ledger.report();
      if (!network.navigation || terminalFrame?.url !== fixtureURL
        || terminalFrame?.id !== network.navigation.frameId || terminalFrame?.loaderId !== network.navigation.loaderId
        || !browserEvidence?.phasePage) failures.push("terminal-document-unbound");
      for (const [event, handler] of ledger.listeners) if (event.startsWith("Page.")) session.off(event, handler);
      try {
        await withTimeout(() => session.detach(), 2_000);
        detached = true;
      } catch {
        failures.push("session-detach-failed");
      }
      const candidateHostMinusProfileMs = profileClockBounds(cpu, begin, end);
      if (cpu && !candidateHostMinusProfileMs) failures.push("cpu-clock-bracket-inconsistent");
      if (network.status !== "observed") failures.push("network-incomplete");
      return { status: failures.length ? "incomplete" : "observed", failures, reason, samplingIntervalUs,
        profileHostStartBracketMs: begin, profileHostEndBracketMs: end, candidateHostMinusProfileMs,
        detached, network, cpu, cpuValidation, browserEvidence };
    })();
    return finishing;
  }

  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      void finish("capture-deadline");
      resolve();
    }, Math.max(0, captureMs - (performance.now() - begin[0])));
  });
  return { finish, deadline };
}

export function writeProfileOutput(path, evidence) {
  const record = { ...evidence, schema: "coursecraft-m27-fixture-profile-v1", diagnosticOnly: true,
    productionGateAcceptance: false, completeOriginalWorkload: false };
  let raw = JSON.stringify(record);
  if (Buffer.byteLength(raw) + 1 > maxBytes) {
    raw = JSON.stringify({ schema: record.schema, diagnosticOnly: true, productionGateAcceptance: false,
      completeOriginalWorkload: false, status: "incomplete", reason: "retained-byte-cap" });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${raw}\n`, { flag: "wx" });
  return JSON.parse(raw).status;
}

export { withTimeout };
