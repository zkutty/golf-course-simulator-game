import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CPU_SAMPLES, MAX_NETWORK_EVENTS, diagnosticsDirectory, summarizeCpuProfile, startStartupDiagnostics } from "./perf-startup-diagnostics.mjs";
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
  const profile = { startTime: 0, nodes: [node(1, "work")], samples: [1], timeDeltas: [1000] };
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
    const capture = await startStartupDiagnostics({ context: () => ({ newCDPSession: async () => cdp }) }, root, { commit: "candidate" });
    for (let index = 0; index < MAX_NETWORK_EVENTS + 2; index++) listeners.get("Network.requestWillBeSent")({ requestId: String(index), timestamp: index, request: { url: "http://localhost/" }, type: "Script" });
    for (const [index, name] of ["cold-start", "cold-ready", "fixture-start", "fixture-ready"].entries()) capture.mark(name, index);
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
