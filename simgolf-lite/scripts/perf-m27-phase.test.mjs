import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { currentM27PhaseObservation, startM27PhaseObservation, summarizeM27Phases } from "../src/game/render/m27PhaseObservation.mjs";

function browserFixture(armed = true) {
  const href = "http://127.0.0.1:5199/?m27Fixture=1&perfTheme=parkland&perfMeasure=1";
  let now = 0;
  const matches = [];
  const document = { querySelectorAll: () => matches };
  const target = { location: new URL(href), document, __ccM27PhaseProbe: armed ? { generation: 0 } : undefined,
    performance: { timeOrigin: 10000, now: () => ++now, getEntriesByType: () => [{ type: "navigate", name: href }] } };
  return { target, matches, canvas: { isConnected: true, ownerDocument: document } };
}

test("the phase recorder stays inactive outside the armed Parkland M27 document", () => {
  const { target } = browserFixture(false);
  assert.equal(startM27PhaseObservation({}, target), null);
  const armed = browserFixture().target;
  armed.location.searchParams.set("perfTheme", "links");
  assert.equal(startM27PhaseObservation({}, armed), null);
  assert.equal(armed.__ccM27PhaseProbe.generation, 0);
});

test("cancelled StrictMode generation cannot contribute to the live canvas sample", () => {
  const { target, matches, canvas } = browserFixture();
  const abandoned = {};
  const first = startM27PhaseObservation(abandoned, target);
  first.stamp("appInitStart");
  first.dispose();
  assert.equal(target.__ccM27PhaseProbe.read(), null);
  const app = {};
  const current = startM27PhaseObservation(app, target);
  first.stamp("appInitEnd");
  first.attach(canvas);
  first.dispose();
  assert.equal(currentM27PhaseObservation(abandoned), null);
  assert.equal(currentM27PhaseObservation(app), current);
  current.stamp("appInitStart");
  current.stamp("unapproved-extra-field");
  matches.push(canvas);
  current.attach(canvas);
  const sample = target.__ccM27PhaseProbe.read();
  assert.equal(sample.generation, 2);
  assert.deepEqual(sample.times, { appInitStart: 2, canvasAttached: 3 });
  current.dispose();
  assert.equal(target.__ccM27PhaseProbe.read(), null);
  assert.equal(currentM27PhaseObservation(app), null);
});

test("a replaced, disconnected, or nonunique canvas cannot qualify", () => {
  const { target, matches, canvas } = browserFixture();
  const app = {};
  const observation = startM27PhaseObservation(app, target);
  observation.attach(canvas);
  matches.push(canvas, {});
  assert.equal(target.__ccM27PhaseProbe.read(), null);
  matches.pop();
  canvas.isConnected = false;
  assert.equal(target.__ccM27PhaseProbe.read(), null);
  canvas.isConnected = true;
  const replacement = {};
  const current = startM27PhaseObservation(replacement, target);
  current.attach(canvas);
  assert.equal(target.__ccM27PhaseProbe.read(), null);
  current.dispose();
});

test("the actual sync observation seam commits the first successful invocation after a throw", () => {
  const { target, matches, canvas } = browserFixture();
  const app = {};
  const observation = startM27PhaseObservation(app, target);
  observation.attach(canvas);
  matches.push(canvas);
  const stage = readFileSync(new URL("../src/ui/PixiStage.tsx", import.meta.url), "utf8");
  const seam = stage.match(/    const phaseSyncStart = [\s\S]*?(?=    const layers = layersRef.current;)/)?.[0];
  assert(seam);
  const sync = new Function("m27Phases", "host", "renderSnapshot", "appRef", "phaseApp", "sceneSystemHostRef",
    `${seam}\nreturn renderedScenes;`);
  const snapshot = {};
  let calls = 0;
  const host = { sync(input) {
    assert.equal(input, snapshot);
    if (++calls === 1) throw new Error("fixture sync failure");
    return ["terrain"];
  } };
  const invoke = () => sync(observation, host, snapshot, { current: app }, app, { current: host });
  assert.throws(invoke, /fixture sync failure/);
  assert.deepEqual(target.__ccM27PhaseProbe.read().times, { canvasAttached: 1 });
  assert.deepEqual(invoke(), ["terrain"]);
  assert.deepEqual(invoke(), ["terrain"]);
  assert.deepEqual(target.__ccM27PhaseProbe.read().times, { canvasAttached: 1, firstSyncStart: 4, firstSyncEnd: 5 });
  observation.dispose();
});

function summaryFixture() {
  return {
    host: { fixtureStart: 1000, domContentLoaded: 1200, sleepStart: 1200, sleepEnd: 1700,
      visibleStart: 1700, visibleEnd: 1760, dimensionsStart: 1761, dimensionsEnd: 1901, boundsStart: 1910, boundsEnd: 2000 },
    page: { generation: 2, timeOrigin: 10000, sampledAt: 4000,
      times: { appInitStart: 150, appInitEnd: 200, deferredStart: 201, deferredEnd: 340, atlasStart: 341, atlasEnd: 430,
        canvasAttached: 450, firstSyncStart: 460, firstSyncEnd: 550, firstRootPresented: 650 } },
    clockBefore: 5050, clockAfter: 5150, fixtureLoadMs: 1000,
  };
}

test("the phase export reports original await durations and conservative cross-clock intervals", () => {
  const result = summarizeM27Phases(summaryFixture());
  assert.equal(result.schema, "coursecraft-m27-phase-v1");
  assert.equal(result.status, "observed");
  assert.deepEqual(result.hostAwaitMs, { domContentLoaded: 200, fixedSleep: 500, visible: 60, dimensions: 140, bounds: 90 });
  assert.deepEqual(result.clock.hostMinusBrowserMs, [1050, 1150]);
  assert.equal(result.clock.uncertaintyMs, 100);
  assert.deepEqual(result.fromFixtureStartMs, { canvasAttached: [500, 600], firstSyncEnd: [600, 700], firstRootPresented: [700, 800] });
  assert(Buffer.byteLength(JSON.stringify(result)) < 32 * 1024);
});

test("the summary rejects missing, forged, out-of-order, and wide-clock attribution", () => {
  const cases = [
    ["host-stamps", (f) => { f.fixtureLoadMs++; }],
    ["live-page-stamps", (f) => { f.page = null; }],
    ["live-page-stamps", (f) => { delete f.page.times.firstRootPresented; }],
    ["live-page-stamps", (f) => { f.page.times.firstSyncEnd = 1; }],
    ["live-page-stamps", (f) => { f.page.times.atlasEnd = Infinity; }],
    ["clock-window", (f) => { f.clockAfter += 501; }],
    ["navigation-or-canvas-window", (f) => { f.clockBefore -= 1000; f.clockAfter -= 1000; }],
    ["navigation-or-canvas-window", (f) => {
      Object.assign(f.page.times, { canvasAttached: 960, firstSyncStart: 1000, firstSyncEnd: 1100, firstRootPresented: 1200 });
    }],
  ];
  for (const [reason, alter] of cases) {
    const input = summaryFixture();
    alter(input);
    const result = summarizeM27Phases(input);
    assert.equal(result.status, "inconclusive");
    assert.equal(result.reason, reason);
    assert.equal(result.fromFixtureStartMs, undefined);
  }
});

test("uncertain cross-clock alignment retains fixed raw stamps and local durations only", () => {
  for (const [reason, alter] of [
    ["clock-window", (f) => { f.clockAfter = 5850; }],
    ["navigation-or-canvas-window", (f) => {
      Object.assign(f.page.times, { canvasAttached: 960, firstSyncStart: 970, firstSyncEnd: 1060, firstRootPresented: 1200 });
    }],
  ]) {
    const input = summaryFixture();
    alter(input);
    const result = summarizeM27Phases(input);
    assert.equal(result.status, "inconclusive");
    assert.equal(result.reason, reason);
    assert.deepEqual(result.hostStampsMs, input.host);
    assert.deepEqual(result.clockBracketMs, { hostBefore: input.clockBefore, browserSample: input.page.sampledAt,
      hostAfter: input.clockAfter });
    assert.deepEqual(result.browser.fromNavigationMs, input.page.times);
    assert.equal(result.browser.elapsedMs.firstSuccessfulSync, 90);
    assert.match(result.browser.firstRootMeaning, /independent .* may follow fixture timing/);
    assert.equal(result.clock, undefined);
    assert.equal(result.fromFixtureStartMs, undefined);
  }
});

test("the original red exit follows complete bounded phase output on a redirected pipe", { timeout: 5000 }, async () => {
  const helper = new URL("../src/game/render/m27PhaseObservation.mjs", import.meta.url).href;
  const producer = readFileSync(new URL("./perf-smoke.mjs", import.meta.url), "utf8");
  const flushAndExit = producer.match(/  await flushM27PhaseLine\(process\.stdout, phaseOutput\);\n}\nif \(failed\) process\.exit\(1\);/)?.[0];
  assert(flushAndExit);
  const phase = { schema: "coursecraft-m27-phase-v1", status: "inconclusive", reason: "clock-window" };
  const padding = 512 * 1024;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { flushM27PhaseLine } from ${JSON.stringify(helper)};
    process.stdout.write("p".repeat(${padding}) + "\\n");
    const failed = true;
    if (true) {
      const phaseOutput = ${JSON.stringify(JSON.stringify(phase))};
    ${flushAndExit}
  `], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const closed = once(child, "close");
    // Leave the pipe unread long enough for the child to queue the final write.
    await delay(40);
    const chunks = [];
    for await (const chunk of child.stdout) chunks.push(chunk);
    assert.deepEqual(await closed, [1, null]);
    assert.equal(Buffer.concat(chunks).toString(), `${"p".repeat(padding)}\n[perf-smoke] m27-phase ${JSON.stringify(phase)}\n`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});
