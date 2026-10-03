import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CPU_SAMPLES, MAX_NETWORK_EVENTS, MAX_TRACE_EVENTS, summarizeTrace, startBrowserTrace, diagnosticsDirectory, summarizeCpuProfile, startStartupDiagnostics, cpuProfileCoverage } from "./perf-startup-diagnostics.mjs";
const node = (id, name, children = []) => ({ id, callFrame: { functionName: name, url: "http://localhost/module.js", lineNumber: id, columnNumber: 0 }, children });
test("CPU summary retains exact self/inclusive sampling and phase boundaries", () => {
  const profile = { startTime: 1000, nodes: [node(1, "root", [2]), node(2, "caller", [3]), node(3, "work")], samples: [2, 3, 2], timeDeltas: [1000, 2000, 1000] };
  const result = summarizeCpuProfile(profile, [{ name: "cold", startUs: 1000, endUs: 2500 }, { name: "fixture", startUs: 2501, endUs: 5000 }]);
  assert.equal(result.overall.sampledMs, 4);
  assert.equal(result.overall.topSelf.find((entry) => entry.functionName === "caller").ms, 2);
  assert.equal(result.overall.topInclusive.find((entry) => entry.functionName === "caller").ms, 4);
  assert.equal(result.phases.cold.sampledMs, 1);
  assert.equal(result.phases.fixture.sampledMs, 3);
  assert.deepEqual(result.overall.topSelf.find((entry) => entry.functionName === "work").stack.map((entry) => entry.functionName), ["work", "caller", "root"]);
});
test("CPU summary explicitly bounds retained samples instead of implying complete capture", () => {
  const result = summarizeCpuProfile({ startTime: 0, nodes: [node(1, "work")], samples: Array(MAX_CPU_SAMPLES + 1).fill(1), timeDeltas: Array(MAX_CPU_SAMPLES + 1).fill(1) });
  assert.equal(result.retainedSamples, MAX_CPU_SAMPLES);
  assert.equal(result.observedSamples, MAX_CPU_SAMPLES + 1);
  assert.equal(result.truncated, true);
});
test("diagnostics stay outside raw output, including directory aliases", () => {
  const root = mkdtempSync(join(tmpdir(), "perf-diagnostic-contract-"));
  try {
    const raw = join(root, "raw"); mkdirSync(raw);
    assert.throws(() => diagnosticsDirectory(raw, join(raw, "perf.json")), /outside/);
    assert.throws(() => diagnosticsDirectory(join(raw, "nested"), join(raw, "perf.json")), /outside/);
    const alias = join(root, "alias"); symlinkSync(raw, alias, "dir");
    assert.throws(() => diagnosticsDirectory(join(alias, "nested"), join(raw, "perf.json")), /outside/);
    assert.equal(diagnosticsDirectory(join(root, "diagnostics"), join(raw, "perf.json")), join(realpathSync(root), "diagnostics"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("capture bounds events, preserves explicit readiness markers and reports failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "perf-diagnostic-capture-"));
  const listeners = new Map();
  const commands = [];
  const profile = { startTime: 0, endTime: 1e12, nodes: [node(1, "work")], samples: [1], timeDeltas: [1000] };
  const cdp = {
    on(event, handler) { listeners.set(event, handler); },
    off(event) { listeners.delete(event); },
    async send(command) {
      commands.push(command);
      if (command === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
      if (command === "Profiler.stop") return { profile };
      return {};
    },
    async detach() { commands.push("detach"); },
  };
  try {
    const capture = await startStartupDiagnostics({ context: () => ({ newCDPSession: async () => cdp, browser: () => { throw new Error("Opt-out must not access browser tracing"); } }) }, root, { commit: "candidate" });
    for (let index = 0; index < MAX_NETWORK_EVENTS + 2; index++) listeners.get("Network.requestWillBeSent")({ requestId: String(index), timestamp: index, request: { url: "http://localhost/" }, type: "Script" });
    for (const [index, name] of ["cold-start", "cold-ready", "fixture-start", "fixture-ready"].entries()) capture.mark(name, performance.now() + index);
    assert.equal(commands.includes("Profiler.stop"), false);
    await capture.finish({ coldStartupMs: 1, fixtureLoadMs: 1 });
    const { readFileSync } = await import("node:fs");
    const summary = JSON.parse(readFileSync(join(root, "startup-summary.json")));
    assert.equal(summary.diagnosticOnly, true);
    assert.equal(summary.network.retainedEvents, MAX_NETWORK_EVENTS);
    assert.equal(summary.network.observedEvents, MAX_NETWORK_EVENTS + 2);
    assert.equal(summary.network.truncated, true);
    assert.deepEqual(summary.boundaries.map((entry) => entry.name), ["cold-start", "cold-ready", "fixture-start", "fixture-ready"]);
    assert.deepEqual(summary.readiness, { coldStartupMs: 1, fixtureLoadMs: 1 });
    assert.equal(listeners.size, 0);
    cdp.send = async (command) => { if (command === "Profiler.stop") throw new Error("capture failed"); return command === "Performance.getMetrics" ? { metrics: [{ name: "Timestamp", value: 1 }] } : {}; };
    const failing = await startStartupDiagnostics({ context: () => ({ newCDPSession: async () => cdp }) }, root, {});
    assert.deepEqual(await failing.finish({}), { ok: false });
    assert.equal(listeners.size, 0);
    const failure = JSON.parse(readFileSync(join(root, "startup-error.json")));
    assert.ok(failure.failures.some((entry) => entry.message === "capture failed"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("custom perf output does not permit diagnostics inside canonical raw aliases", () => {
  const root = mkdtempSync(join(tmpdir(), "perf-diagnostic-canonical-"));
  try {
    const raw = join(root, "canonical-raw"); mkdirSync(raw);
    const custom = join(root, "custom", "perf.json");
    assert.throws(() => diagnosticsDirectory(join(raw, "nested"), custom, raw), /canonical raw/);
    const alias = join(root, "alias"); symlinkSync(raw, alias, "dir");
    assert.throws(() => diagnosticsDirectory(join(alias, "nested"), custom, raw), /canonical raw/);
    assert.equal(diagnosticsDirectory(join(root, "outside"), custom, raw), join(realpathSync(root), "outside"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("partial start and navigation abort clean listeners/session exactly once without throwing", async () => {
  const root = mkdtempSync(join(tmpdir(), "perf-diagnostic-teardown-"));
  try {
    for (const failStart of [true, false]) {
      const listeners = new Map();
      let detachCount = 0;
      let stopCount = 0;
      const cdp = {
        on(event, handler) { listeners.set(event, handler); }, off(event) { listeners.delete(event); },
        async detach() { detachCount++; },
        async send(command) {
          if (command === "Network.enable" && failStart) throw new Error("enable failed");
          if (command === "Profiler.stop") { stopCount++; return { profile: { nodes: [], samples: [], startTime: 0 } }; }
          return command === "Performance.getMetrics" ? { metrics: [{ name: "Timestamp", value: 1 }] } : {};
        },
      };
      const capture = await startStartupDiagnostics({ context: () => ({ newCDPSession: async () => cdp }) }, root, {});
      await capture.dispose(); // Models finally after navigation/readiness failure.
      await capture.dispose();
      assert.equal(listeners.size, 0);
      assert.equal(detachCount, 1);
      assert.equal(stopCount, failStart ? 0 : 1);
      assert.deepEqual(await capture.finish({}), { ok: false });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function traceBrowser({ fail = null, payload = null } = {}) {
  const listeners = new Map(), commands = [];
  let reads = 0, detaches = 0;
  const session = {
    on(name, handler) { listeners.set(name, handler); },
    off(name) { listeners.delete(name); },
    async detach() { detaches++; },
    async send(name, params) {
      commands.push({ name, params });
      if (fail === name) throw new Error(`Injected ${name} failure`);
      if (name === "Tracing.getCategories") return { categories: ["toplevel", "disabled-by-default-devtools.timeline", "devtools.timeline", "gpu", "screenshot", "disabled-by-default-memory-infra"] };
      if (name === "Tracing.end" && fail === "full-buffer") listeners.get("Tracing.bufferUsage")?.({ percentFull: 1 });
      if (name === "Tracing.end") listeners.get("Tracing.tracingComplete")?.({ stream: "trace-stream", dataLossOccurred: fail === "data-loss" });
      if (name === "IO.read") {
        reads++;
        return { data: payload ?? JSON.stringify({ traceEvents: [{ ph: "X", pid: 1, tid: 2, name: "DrawFrame", cat: "gpu", ts: 1000, dur: 2000 }, ... (fail === "missing-marker" ? [] : [{ ph: "c", name: "clock_sync", ts: 0, args: { sync_id: "coursecraft-startup-before-cold" } }, { ph: "c", name: "clock_sync", ts: 4000, args: { sync_id: "coursecraft-startup-after-fixture-ready" } }])] }), eof: true };
      }
      return {};
    },
  };
  return { browser: { async newBrowserCDPSession() { return session; } }, commands, listeners, stats: () => ({ reads, detaches }) };
}

test("browser trace starts before navigation, stops once after readiness, streams and detaches", async () => {
  const root = mkdtempSync(join(tmpdir(), "perf-trace-order-"));
  const mock = traceBrowser(), failures = [];
  try {
    const capture = await startBrowserTrace(mock.browser, root, (stage, error) => failures.push([stage, error.message]));
    mock.commands.push({ name: "original-cold-navigation" }, { name: "original-fixture-ready-timestamp" });
    const pending = capture.finish([{ name: "fixture", startUs: 1000, endUs: 3000 }]);
    assert.equal(capture.finish([]), pending);
    const result = await pending;
    await capture.dispose();
    assert.equal(result.complete, true);
    assert.equal(result.phases.fixture[0].wallUnionMs, 2);
    const names = mock.commands.map(command => command.name);
    assert.ok(names.indexOf("Tracing.start") < names.indexOf("original-cold-navigation"));
    assert.ok(names.indexOf("Tracing.end") > names.indexOf("original-fixture-ready-timestamp"));
    assert.equal(names.filter(name => name === "Tracing.end").length, 1);
    assert.deepEqual(mock.commands.find(command => command.name === "Tracing.start").params.traceConfig.includedCategories, ["disabled-by-default-devtools.timeline", "devtools.timeline", "gpu"]);
    assert.equal(mock.commands.find(command => command.name === "Tracing.start").params.traceConfig.includedCategories.includes("toplevel"), false);
    assert.equal(mock.commands.find(command => command.name === "IO.read").params.size, 65536);
    assert.deepEqual(mock.stats(), { reads: 1, detaches: 1 });
    assert.equal(mock.listeners.size, 0);
    assert.equal(failures.length, 0);
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(join(root, "startup.trace.json")), true);
    assert.equal(existsSync(join(root, "startup.trace.json.part")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("trace uses clipped per-thread/name unions instead of adding nested or parallel time", () => {
  const event = (pid, start, dur) => ({ ph: "X", pid, tid: 1, name: "DrawFrame", cat: "gpu", ts: start, dur });
  const result = summarizeTrace([event(1, 500, 3000), event(1, 1000, 1000), event(2, 1000, 1000)], [{ name: "fixture", startUs: 1000, endUs: 3000 }]);
  assert.deepEqual(result.phases.fixture.map(row => [row.pid, row.wallUnionMs]), [[1, 2], [2, 1]]);
  const bounded = summarizeTrace(Array(MAX_TRACE_EVENTS + 1).fill({ ph: "M", name: "process_name" }));
  assert.equal(bounded.retainedEvents, MAX_TRACE_EVENTS);
  assert.equal(bounded.observedEvents, MAX_TRACE_EVENTS + 1);
  assert.equal(bounded.truncated, true);
});

test("trace capture and persistence failures resolve without rejection and release resources", async () => {
  const root = mkdtempSync(join(tmpdir(), "perf-trace-failure-"));
  try {
    for (const fail of ["Tracing.start", "Tracing.end", "IO.read", "data-loss", "oversize", "persist", "full-buffer", "missing-marker"]) {
      const mock = traceBrowser({ fail, payload: fail === "oversize" ? "too much data" : null });
      const failures = [];
      const capture = await startBrowserTrace(mock.browser, fail === "persist" ? join(root, "missing") : root, (stage, error) => failures.push([stage, error.message]), { maxBytes: fail === "oversize" ? 4 : undefined });
      // Capture is awaited by the producer: rejection would prevent its normal
      // final gate evaluation/exit, whereas a diagnostic failure result does not.
      await assert.doesNotReject(async () => {
        assert.equal((await capture.finish([{ name: "fixture", startUs: 1000, endUs: 3000 }])).complete, false);
      });
      await capture.dispose();
      assert.ok(failures.length > 0, fail);
      assert.equal(mock.listeners.size, 0, fail);
      assert.equal(mock.stats().detaches, 1, fail);
      if (["IO.read", "oversize", "persist"].includes(fail)) assert.ok(mock.commands.some(command => command.name === "IO.close"), fail);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("navigation abort closes a completed trace stream and listeners without a readiness capture", async () => {
  const root = mkdtempSync(join(tmpdir(), "perf-trace-abort-"));
  const mock = traceBrowser();
  try {
    const capture = await startBrowserTrace(mock.browser, root, () => {});
    await capture.dispose();
    await capture.dispose();
    assert.equal((await capture.finish([])).complete, false);
    assert.equal(mock.listeners.size, 0);
    assert.equal(mock.stats().detaches, 1);
    assert.equal(mock.commands.filter(command => command.name === "IO.close").length, 1);
    assert.equal(mock.stats().reads, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("failed browser tracing retains CPU/readiness receipt while reporting separate diagnostic errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "perf-trace-integration-"));
  const mock = traceBrowser({ fail: "Tracing.start" });
  const listeners = new Map();
  const profile = { startTime: 0, endTime: 1e12, nodes: [node(1, "work")], samples: [1], timeDeltas: [1000] };
  const cdp = {
    on(name, handler) { listeners.set(name, handler); }, off(name) { listeners.delete(name); }, async detach() {},
    async send(name) {
      if (name === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
      if (name === "Profiler.stop") return { profile };
      return {};
    },
  };
  try {
    const capture = await startStartupDiagnostics({ context: () => ({ browser: () => mock.browser, newCDPSession: async () => cdp }) }, root, { commit: "candidate" }, { trace: true });
    const readiness = Object.freeze({ coldStartupMs: 3545, fixtureLoadMs: 10183 });
    for (const [index, name] of ["cold-start", "cold-ready", "fixture-start", "fixture-ready"].entries()) capture.mark(name, performance.now() + index);
    assert.deepEqual(await capture.finish(readiness), { ok: false });
    const { readFileSync } = await import("node:fs");
    const summary = JSON.parse(readFileSync(join(root, "startup-summary.json")));
    const error = JSON.parse(readFileSync(join(root, "startup-error.json")));
    assert.deepEqual(summary.readiness, readiness);
    assert.equal(summary.profileWritten, true);
    assert.equal(summary.traceRequested, true);
    assert.equal(summary.trace.complete, false);
    assert.ok(error.failures.some(entry => entry.stage === "trace start"));
    assert.equal(listeners.size, 0);
    assert.equal(mock.listeners.size, 0);
    assert.equal(mock.stats().detaches, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("diagnostic setup failure leaves real passing/failing budget consumer process exits at zero/one", () => {
  const root = mkdtempSync(join(tmpdir(), "perf-trace-exit-"));
  try {
    const helper = new URL("./perf-startup-diagnostics.mjs", import.meta.url).href;
    const budget = new URL("./perf-readiness-budget.mjs", import.meta.url).href;
    for (const [fixtureLoadMs, expectedExit] of [[3500, 0], [10183, 1]]) {
      const code = `
        import { startBrowserTrace } from ${JSON.stringify(helper)};
        import { readinessBudgetValidation } from ${JSON.stringify(budget)};
        const session = { on() {}, off() {}, async detach() {}, async send() { throw new Error("unsupported tracing"); } };
        const capture = await startBrowserTrace({ async newBrowserCDPSession() { return session; } }, ${JSON.stringify(root)}, () => {});
        await capture.finish([]);
        const gate = readinessBudgetValidation({ coldStartupMs: 500, fixtureLoadMs: ${fixtureLoadMs}, startupBudgetMs: 5000, fixtureBudgetMs: 6000 });
        process.exit(gate.passed ? 0 : 1);
      `;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, expectedExit, result.stderr);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CPU/network publish atomically and write/rename errors never publish partial final files", async () => {
  const { existsSync, statSync, readFileSync } = await import("node:fs");
  for (const blocker of [null, "startup.cpuprofile.part", "startup.cpuprofile", "startup-network.json"]) {
    const root = mkdtempSync(join(tmpdir(), "perf-atomic-artifact-"));
    const listeners = new Map();
    const profile = { startTime: 0, endTime: 1e12, nodes: [node(1, "work")], samples: [1], timeDeltas: [1000] };
    const cdp = {
      on(name, handler) { listeners.set(name, handler); }, off(name) { listeners.delete(name); }, async detach() {},
      async send(name) {
        if (name === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 1 }] };
        if (name === "Profiler.stop") return { profile };
        return {};
      },
    };
    try {
      if (blocker) mkdirSync(join(root, blocker));
      const capture = await startStartupDiagnostics({ context: () => ({ newCDPSession: async () => cdp }) }, root, {});
      for (const [index, name] of ["cold-start", "cold-ready", "fixture-start", "fixture-ready"].entries()) capture.mark(name, performance.now() + index);
      const outcome = await capture.finish({ coldStartupMs: 300, fixtureLoadMs: 3500 });
      assert.equal(outcome.ok, blocker === null);
      assert.equal(listeners.size, 0);
      if (blocker === null) {
        assert.deepEqual(JSON.parse(readFileSync(join(root, "startup.cpuprofile"))), profile);
        assert.equal(JSON.parse(readFileSync(join(root, "startup-network.json"))).retainedEvents, 0);
        for (const name of ["startup.cpuprofile", "startup-network.json", "startup-summary.json"]) assert.equal(existsSync(join(root, `${name}.part`)), false);
      } else {
        assert.ok(JSON.parse(readFileSync(join(root, "startup-error.json"))).failures.some(entry => ["start", "capture", "summary persistence"].includes(entry.stage)));
        assert.equal(existsSync(join(root, "startup-summary.json")), false);
        const target = blocker.replace(/\.part$/, "");
        if (target === blocker) assert.equal(statSync(join(root, target)).isDirectory(), true);
        else assert.equal(existsSync(join(root, target)), false);
        if (!blocker.endsWith(".part")) assert.equal(existsSync(join(root, `${blocker}.part`)), false);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

function originalProducerProjection(source) {
  return source.replace(/\/\/ STARTUP-DIAGNOSTIC-BEGIN\n[\s\S]*?\/\/ STARTUP-DIAGNOSTIC-END\n/g, "")
    .replace('import { spawn, execFileSync }', 'import { spawn }')
    .replace(/^import .*perf-startup-diagnostics.mjs.*\n/gm, "")
    .replace(/^.*startupDiagnostics\?\.mark.*\n/gm, "")
    .replace('await startupDiagnosticResult;\n', '')
    .replace('//        PERF_HARDWARE_CLASS / PERF_POWER_STATE / PERF_RUN_LABEL (evidence labels),\n//        PERF_DIAGNOSTICS_DIR (opt-in startup CPU/network artifacts outside evidence)\n//        PERF_DIAGNOSTICS_TRACE=1 (also capture bounded browser/native timeline)\n', '//        PERF_HARDWARE_CLASS / PERF_POWER_STATE / PERF_RUN_LABEL (evidence labels)\n');
}
test("diagnostic additions project exactly to the original7f producer and reject changed warmup", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const source = readFileSync(new URL("./perf-smoke.mjs", import.meta.url), "utf8");
  const digest = value => createHash("sha256").update(originalProducerProjection(value)).digest("hex");
  const original = "329071c2de7c06eeb9739fdb0fa70a87a1953ecf21fdc1f26677b1f504d59de9";
  assert.equal(digest(source), original);
  assert.notEqual(digest(source.replace('const WARMUP_S = 8;', 'const WARMUP_S = 9;')), original);
  assert.match(source, /if \(process.env.PERF_DIAGNOSTICS_DIR\) \{/);
  assert.match(source, /DIAGNOSTICS_DIRECTORY \? await startStartupDiagnostics/);
});
test("CPU complete requires nonempty consistent samples and both complete phase intervals", () => {
  const profile = { nodes: [node(1, "work")], startTime: 0, endTime: 100, samples: [1], timeDeltas: [100] };
  const phases = [{ name: "cold", startUs: 1, endUs: 20 }, { name: "fixture", startUs: 21, endUs: 99 }];
  assert.equal(cpuProfileCoverage(profile, phases).complete, true);
  for (const bad of [{ ...profile, endTime: 98 }, { ...profile, startTime: 2 }, { ...profile, samples: [] }, { ...profile, timeDeltas: [] }]) {
    assert.equal(cpuProfileCoverage(bad, phases).complete, false);
  }
  assert.equal(cpuProfileCoverage(profile, [{ ...phases[0], endUs: undefined }, phases[1]]).complete, false);
});
test("summary completeness reflects CPU coverage, metadata and final detach errors; stale outputs cannot pass", async () => {
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  for (const defect of [null, "missing-end", "missing-marker", "detach"]) {
    const root = mkdtempSync(join(tmpdir(), "startup-completeness-"));
    try {
      writeFileSync(join(root, "startup-summary.json"), '{"complete":true}');
      writeFileSync(join(root, "startup-error.json"), 'stale');
      writeFileSync(join(root, "startup.trace.json"), 'stale');
      const profile = { startTime: 0, endTime: defect === "missing-end" ? undefined : 1e12, nodes: [node(1, "work")], samples: [1], timeDeltas: [1000] };
      const cdp = { on() {}, off() {}, async detach() { if (defect === "detach") throw new Error("detach rejected"); }, async send(command) {
        if (command === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 100 }] };
        if (command === "Profiler.stop") return { profile };
        return {};
      } };
      const capture = await startStartupDiagnostics({ context: () => ({ newCDPSession: async () => cdp }) }, root, { commit: "diagnostic-head", applicationBaseline: "7f" });
      assert.equal(existsSync(join(root, "startup-summary.json")), false);
      assert.equal(existsSync(join(root, "startup.trace.json")), false);
      for (const [index, name] of ["cold-start", "cold-ready", "fixture-start", "fixture-ready"].entries()) {
        if (!(defect === "missing-marker" && name === "fixture-ready")) capture.mark(name, performance.now() + index);
      }
      const result = await capture.finish({ coldStartupMs: 1, fixtureLoadMs: 1 });
      const summary = JSON.parse(readFileSync(join(root, "startup-summary.json")));
      assert.equal(result.ok, defect === null);
      assert.equal(summary.complete, defect === null);
      assert.equal(summary.errorCount === 0, defect === null);
      assert.equal(summary.commit, "diagnostic-head");
      assert.equal(summary.applicationBaseline, "7f");
      assert.equal(summary.cpuCoverage.complete, defect === null || defect === "detach");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
test("defaultoff helper import performs no diagnostic filesystem mutations", () => {
  const helper = new URL("./perf-startup-diagnostics.mjs", import.meta.url).href;
  const code = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';let calls=0;for(const name of ['mkdirSync','writeFileSync','renameSync','writeSync','rmSync']) fs[name]=()=>{calls++;throw Error('unexpected filesystem')};syncBuiltinESMExports();await import(${JSON.stringify(helper)});if(calls)throw Error('side effects');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});
test("a bounded but truncated CPU summary cannot report complete capture", async () => {
  const { readFileSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "startup-cpu-cap-"));
  try {
    const profile = { startTime: 0, endTime: 1e12, nodes: [node(1, "work")], samples: Array(MAX_CPU_SAMPLES + 1).fill(1), timeDeltas: Array(MAX_CPU_SAMPLES + 1).fill(1) };
    const cdp = { on() {}, off() {}, async detach() {}, async send(command) {
      if (command === "Performance.getMetrics") return { metrics: [{ name: "Timestamp", value: 100 }] };
      if (command === "Profiler.stop") return { profile };
      return {};
    } };
    const capture = await startStartupDiagnostics({ context: () => ({ newCDPSession: async () => cdp }) }, root, {});
    for (const [index, name] of ["cold-start", "cold-ready", "fixture-start", "fixture-ready"].entries()) capture.mark(name, performance.now() + index);
    assert.deepEqual(await capture.finish({}), { ok: false });
    const summary = JSON.parse(readFileSync(join(root, "startup-summary.json")));
    assert.equal(summary.complete, false);
    assert.equal(summary.cpu.truncated, true);
    assert.equal(summary.cpu.retainedSamples, MAX_CPU_SAMPLES);
    assert.ok(summary.errorCount > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
