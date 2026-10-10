import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This is a controlled scheduling/allocation model, not a V8 collection proof.
const here = dirname(fileURLToPath(import.meta.url));
const producerRoot = process.env.ZK1262_PROTOCOL_PRODUCER_ROOT;
const contractRoot = process.env.ZK1262_PROTOCOL_CONTRACT_ROOT ?? here;
const SPECS = [
  { kind: "resource", filename: "zk682-resource-growth.e2e.ts", ms: 150 },
  { kind: "stability", filename: "zk682-stability.e2e.ts", ms: 120 },
];
const resource = await import(pathToFileURL(resolve(contractRoot, "zk682-resource-growth-contract.mjs")));
const stability = await import(pathToFileURL(resolve(contractRoot, "zk682-stability-contract.mjs")));
const MiB = 1024 * 1024;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function source(spec) {
  return readFileSync(producerRoot ? resolve(producerRoot, spec.filename) : resolve(here, "../e2e", spec.filename), "utf8");
}
function occurrences(s, needle) { return s.split(needle).length - 1; }
function prefix(spec, s = source(spec)) {
  const re = spec.kind === "resource"
    ? /async function collectPostGcCheckpoint\([^\n]+\) \{\n([\s\S]*?)  const browser = await page\.evaluate/
    : /async function measure\([^\n]+\)[^\n]*\{\n([\s\S]*?)  const renderer = await page\.evaluate/;
  const matches = [...s.matchAll(new RegExp(re.source, "g"))];
  assert.equal(matches.length, 1, "unique actual measurement function");
  return matches[0][1];
}
function oldPrefix(spec) {
  // Reorder only the three actual measurement statements, retaining the
  // extracted resource guard and immediate heap query as the counterfactual.
  const body = prefix(spec);
  const cleanup = spec.kind === "resource"
    ? '  timingCleanup.push({ cycle, cleanup: await page.evaluate(clearReactComponentTimings) });\n'
    : '  timingCleanupSamples.push(await page.evaluate(clearReactComponentTimings));\n';
  const wait = `  await page.waitForTimeout(${spec.ms});\n`;
  const gc = '  await cdp.send("HeapProfiler.collectGarbage");\n';
  const settled = wait + cleanup + gc;
  const old = cleanup + gc + wait;
  if (body.includes(settled)) {
    assert.equal(occurrences(body, settled), 1);
    return body.replace(settled, old);
  }
  // The ROOT selected RED run supplies the original producer directly.
  assert.equal(occurrences(body, old), 1, "recognized actual old measurement sequence");
  return body;
}
function compile(body) {
  return new AsyncFunction("page", "cdp", "cycle", "timingCleanup", "timingCleanupSamples", "clearReactComponentTimings", body + "\nreturn heap;\n");
}
function model(spec, options = {}) {
  const events = [], timingCleanup = [], timingCleanupSamples = [], reachable = [];
  const state = { cycle: 0, garbage: 0, marks: ["application", "collision"], events, timingCleanup, timingCleanupSamples, reachable };
  const clearReactComponentTimings = function selectiveTimingCleanupIdentity() {};
  const record = (name, args) => { events.push([name, ...args]); if (options.failAt === name) throw options.failure; };
  const page = {
    async waitForTimeout(...args) {
      record("wait", args); assert.deepEqual(args, [spec.ms]);
      if (options.transient) state.garbage += state.cycle * MiB;
      state.marks.push("component");
    },
    async evaluate(...args) {
      record("cleanup", [args.length]); assert.deepEqual(args, [clearReactComponentTimings]);
      state.marks = state.marks.filter((mark) => mark !== "component");
      return { modeledSelectiveCleanup: true };
    },
  };
  const cdp = { async send(...args) {
    assert.equal(args.length, 1);
    const name = args[0] === "HeapProfiler.collectGarbage" ? "gc" : args[0] === "Runtime.getHeapUsage" ? "query" : "unknown";
    record(name, args); assert.notEqual(name, "unknown");
    if (name === "gc") { if (options.gcBarrier) await options.gcBarrier; state.garbage = 0; return {}; }
    return { usedSize: options.usedSize ?? (32 * MiB + state.garbage + reachable.reduce((sum, entry) => sum + entry.bytes, 0)), totalSize: 64 * MiB };
  }};
  state.run = (body = prefix(spec)) => compile(body)(page, cdp, state.cycle, timingCleanup, timingCleanupSamples, clearReactComponentTimings);
  return state;
}
function samples(values) {
  return values.map((used, cycle) => ({
    cycle, exercised: cycle === 0 ? null : { theme: "parkland", quality: "high" }, atlasResidency: {},
    rendererQuality: "high", elapsedGameMinutes: cycle * 20, courseHash: cycle.toString(16).padStart(8, "0"),
    state: { dayMinute: 100 + cycle, speed: "4x", onCourse: 1 },
    resources: { canvasConnected: true, displayObjects: 100, attachedTextures: 5, attachedTextureSources: 5, managedTextureSources: 5 },
    heap: { runtimeUsedBytes: used },
  }));
}
function verdict(spec, values) {
  return spec.kind === "resource" ? resource.evaluateZk682ResourceGrowth(samples(values))
    : stability.evaluateZk682Stability("long-session-resource-stability", samples(values));
}
async function series(spec, body, { transient = false, retained = false } = {}) {
  const m = model(spec, { transient }); const values = [];
  for (let cycle = 0; cycle <= 6; cycle++) {
    m.cycle = cycle;
    if (retained && cycle > 0) m.reachable.push(Object.freeze({ bytes: MiB, cycle }));
    values.push((await m.run(body)).usedSize);
  }
  return { m, values, result: verdict(spec, values) };
}
function expectedEvents(spec) {
  return [["wait", spec.ms], ["cleanup", 1], ["gc", "HeapProfiler.collectGarbage"], ["query", "Runtime.getHeapUsage"]];
}
async function validateSchedule(spec, body) {
  const m = model(spec); await m.run(body); assert.deepEqual(m.events, expectedEvents(spec));
  assert.deepEqual(m.marks, ["application", "collision"]);
  assert.equal(m.timingCleanup.length + m.timingCleanupSamples.length, 1);
}

test("package wiring and actual measurement prefixes retain required operations", () => {
  const packageJson = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));
  const testPath = "scripts/zk682-heap-measurement-protocol.test.mjs";
  for (const key of ["test:ci", "test:resource-growth", "test:stability:contract"])
    assert.equal(occurrences(packageJson.scripts[key], testPath), 1, `${key} runs this regression test once`);
  assert.equal(packageJson.scripts["test:resource-growth"].split(" && ").at(-1), "node scripts/zk682-run-resource-growth.mjs");
  for (const spec of SPECS) {
    const body = prefix(spec);
    assert.equal(occurrences(body, "await "), 4, "measurement keeps exactly four awaited boundaries");
    assert.equal(occurrences(body, "page.waitForTimeout("), 1);
    assert.equal(occurrences(body, "page.evaluate(clearReactComponentTimings)"), 1);
    assert.equal(occurrences(body, 'cdp.send("HeapProfiler.collectGarbage")'), 1);
    assert.equal(occurrences(body, 'cdp.send("Runtime.getHeapUsage")'), 1);
  }
});
test("all four heap reports declare their exact protocol and unchanged four MiB limits", () => {
  assert.equal(resource.ZK682_RESOURCE_GROWTH_THRESHOLDS.heap.maxEndGrowthBytes, 4 * MiB);
  for (const gate of ["save-load-resource-stability", "long-session-resource-stability"])
    assert.equal(stability.ZK682_STABILITY_THRESHOLDS[gate].resources.heap.maxEndGrowthBytes, 4 * MiB);
  for (const spec of SPECS) {
    const s = source(spec), label = `heapMeasurementProtocol: { id: "settle-cleanup-gc-query-v1", settlementMs: ${spec.ms} }`;
    assert.equal(occurrences(s, label), spec.kind === "resource" ? 1 : 3);
  }
});
for (const spec of SPECS) {
  test(`${spec.kind} actual settled protocol removes modeled transient growth; old source is RED`, async () => {
    const current = await series(spec, prefix(spec), { transient: true });
    const old = await series(spec, oldPrefix(spec), { transient: true });
    assert.equal(current.result.passed, true, current.result.errors.join("; "));
    assert.equal(current.result.metrics.heap.endGrowth, 0);
    assert.equal(old.result.passed, false);
    assert.equal(old.result.metrics.heap.endGrowth, 6 * MiB);
    assert.ok(old.result.errors.some((s) => s.includes("heap ended")));
  });
  test(`${spec.kind} reachable six MiB leak remains RED under BOTH protocols`, async () => {
    for (const body of [prefix(spec), oldPrefix(spec)]) {
      const r = await series(spec, body, { transient: true, retained: true });
      assert.equal(r.result.passed, false);
      assert.ok(r.result.metrics.heap.endGrowth >= 6 * MiB);
      assert.equal(r.m.reachable.length, 6);
      assert.equal(r.m.reachable.reduce((n, entry) => n + entry.bytes, 0), 6 * MiB);
      assert.ok(r.result.errors.some((s) => s.includes("heap ended")));
    }
  });
  test(`${spec.kind} stable heap keeps the same passing verdict`, async () => {
    const current = await series(spec, prefix(spec)), old = await series(spec, oldPrefix(spec));
    assert.deepEqual(current.values, old.values); assert.equal(current.result.passed, true); assert.equal(old.result.passed, true);
  });
  test(`${spec.kind} extracted prefix preserves waits calls arguments cleanup and seven measurements`, async () => {
    const r = await series(spec, prefix(spec), { transient: true });
    assert.deepEqual(r.m.events, Array.from({ length: 7 }, () => expectedEvents(spec)).flat());
    assert.deepEqual(r.m.marks, ["application", "collision"]);
    const receipts = spec.kind === "resource" ? r.m.timingCleanup : r.m.timingCleanupSamples;
    assert.equal(receipts.length, 7);
    if (spec.kind === "resource") assert.deepEqual(receipts.map((r) => r.cycle), [0, 1, 2, 3, 4, 5, 6]);
  });
  test(`${spec.kind} each rejected boundary preserves falsy failure and stops subsequent work`, async () => {
    for (const failure of [false, undefined, null, 0, new Error("injected")]) {
      for (const [index, failAt] of ["wait", "cleanup", "gc", "query"].entries()) {
        const m = model(spec, { failAt, failure }); let caught = false, error;
        try { await m.run(); } catch (e) { caught = true; error = e; }
        assert.equal(caught, true); assert.equal(error, failure);
        assert.deepEqual(m.events, expectedEvents(spec).slice(0, index + 1));
      }
    }
  });
  test(`${spec.kind} unchanged contract rejects invalid nonfinite missing heap`, async () => {
    for (const used of [NaN, Infinity, -Infinity, undefined, null, 0, -1]) {
      const values = Array(7).fill(32 * MiB); values[3] = used;
      const r = verdict(spec, values); assert.equal(r.passed, false); assert.ok(r.errors.some((s) => s.includes("heap diagnostics")));
    }
  });
  test(`${spec.kind} actual-source reordered skipped duplicate and altered-argument mutants are rejected`, async () => {
    const body = prefix(spec);
    const wait = `  await page.waitForTimeout(${spec.ms});\n`;
    const gc = '  await cdp.send("HeapProfiler.collectGarbage");\n';
    const query = '  const heap = await cdp.send("Runtime.getHeapUsage");\n';
    const cleanup = spec.kind === "resource"
      ? '  timingCleanup.push({ cycle, cleanup: await page.evaluate(clearReactComponentTimings) });\n'
      : '  timingCleanupSamples.push(await page.evaluate(clearReactComponentTimings));\n';
    const mutants = [oldPrefix(spec), body.replace(wait, ""), body.replace(gc, ""), body.replace(cleanup, ""),
      body.replace(gc, gc + gc), body.replace(wait, wait.replace(String(spec.ms), String(spec.ms + 1))),
      body.replace(gc, "").replace(query, query + gc), body.replace(query, '  const heap = {usedSize: 1};\n')];
    for (const mutant of mutants) {
      assert.notEqual(mutant, body); await assert.rejects(validateSchedule(spec, mutant));
    }
  });
  test(`${spec.kind} query waits for successful actual GC promise settlement`, async () => {
    let release; const barrier = new Promise((resolve) => { release = resolve; });
    const m = model(spec, { transient: true, gcBarrier: barrier }); m.cycle = 2;
    const pending = m.run();
    for (let turn = 0; turn < 12 && !m.events.some((e) => e[0] === "gc"); turn++) await Promise.resolve();
    assert.deepEqual(m.events, expectedEvents(spec).slice(0, 3)); assert.equal(m.garbage, 2 * MiB);
    release(); const heap = await pending;
    assert.equal(heap.usedSize, 32 * MiB); assert.deepEqual(m.events, expectedEvents(spec));
  });
}
test("resource seven-receipt guard rejects before settlement or any work", async () => {
  const spec = SPECS.find((s) => s.kind === "resource"), m = model(spec);
  m.timingCleanup.push(...Array(7).fill({}));
  await assert.rejects(m.run(), /Timing cleanup receipt bound exceeded/);
  assert.deepEqual(m.events, []);
});
