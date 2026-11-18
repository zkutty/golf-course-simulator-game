import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createNetworkLedger, inspectCPUProfile, profileClockBounds, profileOutputPath, projectCPUProfile, startProfile, writeProfileOutput,
} from "./perf-m27-fixture-profile.mjs";

const origin = "http://127.0.0.1:5199";
const fixture = `${origin}/?m27Fixture=1&perfTheme=parkland&perfMeasure=1`;
const frameId = "frame";
const loaderId = "loader";
const nav = { frame: { id: frameId, loaderId, url: fixture } };
const rootFrame = { functionName: "(root)", url: "", lineNumber: -1, columnNumber: -1 };
const sampleFrame = { functionName: "createM27ReleaseReferenceCourse", url: `${origin}/src/game/testing/referenceCourse.ts?t=private`,
  lineNumber: 472, columnNumber: 0 };

function rawProfile(startTime = 1_000, endTime = 8_000) {
  return { startTime, endTime, nodes: [{ id: 1, callFrame: rootFrame, children: [2] },
    { id: 2, callFrame: sampleFrame }], samples: [2, 2], timeDeltas: [0, 0] };
}

function emitDocument(session, { responseAt = 5, finishAt = 6, failed = false, navigation = nav } = {}) {
  session.emit("Network.requestWillBeSent", { frameId, loaderId, type: "Document", requestId: "doc",
    request: { url: fixture, headers: { Cookie: "unsafe" } }, timestamp: 4, wallTime: 1_700_000_000 });
  session.emit("Page.frameNavigated", navigation);
  session.emit("Network.responseReceived", { requestId: "doc", timestamp: responseAt,
    response: { url: fixture, status: 200, headers: { Authorization: "unsafe" } } });
  if (finishAt !== null) session.emit(failed ? "Network.loadingFailed" : "Network.loadingFinished", { requestId: "doc", timestamp: finishAt });
}

class Session extends EventEmitter {
  calls = [];
  failedMethod = null;
  terminal = nav.frame;
  timeStarted = null;
  navigated = false;

  async send(method, params) {
    this.calls.push([method, params]);
    if (method === this.failedMethod) throw new Error("synthetic CDP error");
    if (method === "Page.getFrameTree") return { frameTree: { frame: this.navigated ? this.terminal : { id: frameId } } };
    if (method === "Profiler.start") this.timeStarted = Math.round(performance.now() * 1_000);
    if (method === "Profiler.stop") return { profile: rawProfile(this.timeStarted, Math.round(performance.now() * 1_000)) };
    return {};
  }

  async detach() { this.calls.push(["detach"]); }
}

test("profile flag is opt-in and the exclusive output cannot equal the canonical report", () => {
  assert.equal(profileOutputPath({}, false), null);
  const env = { PERF_M27_FIXTURE_PROFILE: "1", PERF_M27_FIXTURE_PROFILE_OUTPUT: "profile/m27-fixture-profile.json" };
  assert.throws(() => profileOutputPath(env, false, "canonical.json"), /requires Parkland/);
  assert.throws(() => profileOutputPath(env, true, "profile/m27-fixture-profile.json"), /aliases/);
  assert.match(profileOutputPath(env, true, "canonical.json"), /profile\/m27-fixture-profile\.json$/);
});

test("writes only bounded noncertifying report data and rejects a second output", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "coursecraft-profile-control-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "m27-fixture-profile.json");
  assert.equal(writeProfileOutput(path, { status: "observed", productionGateAcceptance: true }), "observed");
  const result = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(result.productionGateAcceptance, false);
  assert.equal(result.completeOriginalWorkload, false);
  assert.equal(result.diagnosticOnly, true);
  assert.throws(() => writeProfileOutput(path, { status: "observed" }), { code: "EEXIST" });
  const overflow = join(directory, "over-cap.json");
  assert.equal(writeProfileOutput(overflow, { status: "observed", enormous: "x".repeat(4 * 1024 * 1024) }), "incomplete");
  assert.equal(JSON.parse(readFileSync(overflow, "utf8")).reason, "retained-byte-cap");
});

test("projects eligible sampled source stacks without accepting cycles, duplicate IDs, oversize or impossible timing", () => {
  const projected = projectCPUProfile(rawProfile(), origin);
  assert.equal(projected.nodes[1].pathname, "/src/game/testing/referenceCourse.ts");
  assert.equal(projected.nodes[1].functionName, sampleFrame.functionName);
  assert.deepEqual(projected.samples, [2, 2]);
  const foreign = rawProfile();
  foreign.nodes[1].callFrame = { ...sampleFrame, url: "https://private.test/private?token=secret" };
  assert.equal(projectCPUProfile(foreign, origin).nodes[1].pathname, null);
  assert.equal(projectCPUProfile(foreign, origin).nodes[1].functionName, null);
  const cycle = rawProfile();
  cycle.nodes[1].children = [1];
  assert.equal(projectCPUProfile(cycle, origin), null);
  const duplicate = rawProfile();
  duplicate.nodes[1].id = 1;
  assert.equal(projectCPUProfile(duplicate, origin), null);
  assert.equal(projectCPUProfile({ ...rawProfile(), samples: Array(16_385).fill(2) }, origin), null);
  const timing = { ...rawProfile(), timeDeltas: [0, 8_001] };
  assert.equal(projectCPUProfile(timing, origin), null);
});

test("uses conservative intersecting profile clock brackets and rejects disjoint brackets", () => {
  const cpu = rawProfile(1_000, 10_000);
  assert.deepEqual(profileClockBounds(cpu, [2, 4], [12, 13]), [2, 3]);
  assert.equal(profileClockBounds(cpu, [2, 4], [25, 26]), null);
});

test("rejected CPU evidence retains bounded numerical rejection details without source strings", () => {
  const cases = [
    [{ ...rawProfile(), nodes: [] }, "shape-or-bounds", null, null],
    [{ ...rawProfile(), nodes: [...rawProfile().nodes, rawProfile().nodes[1]] }, "invalid-node", 2, 2],
    [{ ...rawProfile(), samples: [3, 2] }, "unknown-sample-node", 0, 3],
    [{ ...rawProfile(), timeDeltas: [-7, 0] }, "invalid-sample-delta", 0, -7],
    [{ ...rawProfile(), timeDeltas: [Infinity, 0] }, "invalid-sample-delta", 0, null],
    [{ ...rawProfile(), timeDeltas: [0, 8_001] }, "elapsed-exceeds-duration", 1, 8_001],
  ];
  for (const [input, reason, index, value] of cases) {
    const result = inspectCPUProfile(input, origin);
    assert.equal(result.cpu, null);
    assert.deepEqual(result.validation, { status: "rejected", reason, nodeCount: input.nodes.length,
      sampleCount: 2, deltaCount: 2, startTime: 1_000, endTime: 8_000, index, value });
    assert.doesNotMatch(JSON.stringify(result), /private|createM27|127\.0\.0\.1/);
  }
  const cycle = rawProfile();
  cycle.nodes[1].children = [1];
  assert.equal(inspectCPUProfile(cycle, origin).validation.reason, "invalid-tree-child");
  const missingChild = rawProfile();
  missingChild.nodes[0].children = [3];
  assert.equal(inspectCPUProfile(missingChild, origin).validation.reason, "invalid-tree-reference");
  const disconnected = rawProfile();
  disconnected.nodes[0].children = [];
  assert.equal(inspectCPUProfile(disconnected, origin).validation.reason, "disconnected-tree");
  assert.equal(inspectCPUProfile(undefined, origin).validation.nodeCount, null);
  assert.deepEqual(inspectCPUProfile(rawProfile(), origin).cpu, projectCPUProfile(rawProfile(), origin));
});

test("CPU rejection keeps the collector incomplete without fabricating a clock inconsistency", async () => {
  const session = new Session();
  const send = session.send.bind(session);
  session.send = async (method, params) => method === "Profiler.stop"
    ? { profile: { ...rawProfile(), timeDeltas: [-7, 0] } } : send(method, params);
  const capture = await startProfile(session, fixture);
  emitDocument(session);
  session.navigated = true;
  const result = await capture.finish("fixture-bounds", async () => ({ phasePage: { generation: 2 } }));
  assert.equal(result.status, "incomplete");
  assert.equal(result.cpu, null);
  assert.equal(result.candidateHostMinusProfileMs, null);
  assert.deepEqual(result.failures, ["invalid-or-capped-cpu-profile"]);
  assert.equal(result.cpuValidation.reason, "invalid-sample-delta");
  assert.equal(result.cpuValidation.value, -7);
  assert.equal(result.detached, true);
  assert.equal(session.eventNames().length, 0);
});

test("binds request rows to the exact main document and strips queries, headers and unrelated URLs", () => {
  const ledger = createNetworkLedger(fixture, frameId);
  const session = new Session();
  for (const [event, handler] of ledger.listeners) session.on(event, handler);
  emitDocument(session);
  for (const [requestId, url] of [["module", `${origin}/src/ui/PixiStage.tsx?token=secret`], ["external", "https://private.test/unsafe"]]) {
    session.emit("Network.requestWillBeSent", { frameId, loaderId, requestId, request: { url }, type: "Script", timestamp: 8,
      initiator: { url: `${origin}/src/App.tsx?also=secret` } });
  }
  session.emit("Network.requestServedFromCache", { requestId: "module" });
  session.emit("Network.requestServedFromCache", { requestId: "module" });
  session.emit("Network.loadingFinished", { timestamp: 9, requestId: "module" });
  const observed = ledger.report();
  assert.equal(observed.status, "observed");
  assert.deepEqual(observed.requests.map((row) => [row.pathname, row.ended]), [["/", 6], ["/src/ui/PixiStage.tsx", 9]]);
  assert.equal(observed.requests[1].initiatorPath, "/src/App.tsx");
  assert.equal(observed.requests[0].cacheEvidence, null);
  assert.deepEqual(observed.requests[1].cacheEvidence, ["request-served-from-cache-event"]);
  assert.doesNotMatch(JSON.stringify(observed), /secret|unsafe|private/);
  session.emit("Page.navigatedWithinDocument", { frameId });
  assert.ok(ledger.report().failures.includes("same-document-navigation"));
});

test("network overflow stays incomplete with all retained rows charged", () => {
  const ledger = createNetworkLedger(fixture, frameId);
  const session = new Session();
  for (const [event, handler] of ledger.listeners) session.on(event, handler);
  emitDocument(session);
  for (let index = 0; index <= 2_048; index++) {
    session.emit("Network.requestWillBeSent", { frameId, loaderId, requestId: `r-${index}`,
      request: { url: `${origin}/src/mod${index}.ts` }, timestamp: 8, type: "Script" });
  }
  assert.equal(ledger.report().requests.length, 2_048);
  assert.ok(ledger.report().failures.includes("network-row-cap"));
});

test("a valid loader completion may precede the response emission for the document and a module", () => {
  const ledger = createNetworkLedger(fixture, frameId);
  const session = new Session();
  for (const [event, handler] of ledger.listeners) session.on(event, handler);
  emitDocument(session, { responseAt: 6, finishAt: 5 });
  const url = `${origin}/src/ui/PixiStage.tsx`;
  session.emit("Network.requestWillBeSent", { frameId, loaderId, requestId: "script", request: { url }, type: "Script", timestamp: 8 });
  session.emit("Network.responseReceived", { requestId: "script", timestamp: 10, response: { url, status: 200 } });
  session.emit("Network.loadingFinished", { requestId: "script", timestamp: 9 });
  const observed = ledger.report();
  assert.equal(observed.status, "observed");
  assert.deepEqual(observed.terminalIssueExamples, []);
  assert.deepEqual(observed.requests.map(({ started, headersAt, ended, failed, cacheEvidence }) =>
    [started, headersAt, ended, failed, cacheEvidence]), [[4, 6, 5, false, null], [8, 10, 9, false, null]]);
});

test("pre-start, non-finite and duplicate terminal events remain rejected with bounded scalar examples", () => {
  const ledger = createNetworkLedger(fixture, frameId);
  const session = new Session();
  for (const [event, handler] of ledger.listeners) session.on(event, handler);
  emitDocument(session, { finishAt: 3 });
  session.emit("Network.loadingFinished", { requestId: "doc", timestamp: Infinity });
  session.emit("Network.loadingFinished", { requestId: "doc", timestamp: 6 });
  for (let index = 0; index < 10; index++) {
    session.emit("Network.loadingFinished", { requestId: "doc", timestamp: 7 + index });
  }
  const observed = ledger.report();
  assert.equal(observed.status, "incomplete");
  assert.ok(observed.failures.includes("invalid-network-terminal"));
  assert.equal(observed.requests[0].ended, 6);
  assert.equal(observed.terminalIssueExamples.length, 8);
  assert.deepEqual(observed.terminalIssueExamples.slice(0, 3), [
    { pathname: "/", type: "Document", started: 4, headersAt: 5, terminalAt: 3, failed: false, reason: "before-request-start" },
    { pathname: "/", type: "Document", started: 4, headersAt: 5, terminalAt: null, failed: false, reason: "invalid-timestamp" },
    { pathname: "/", type: "Document", started: 4, headersAt: 5, terminalAt: 7, failed: false, reason: "duplicate-terminal" },
  ]);
});

test("failure timestamp ordering and exact successful main-document qualification stay strict", () => {
  for (const [options, issue] of [
    [{ responseAt: 6, finishAt: 5, failed: true }, "failure-before-response-event"],
    [{ finishAt: 6, failed: true }, null],
    [{ finishAt: null }, null],
    [{ navigation: { frame: { ...nav.frame, loaderId: "another-loader" } } }, null],
  ]) {
    const ledger = createNetworkLedger(fixture, frameId);
    const session = new Session();
    for (const [event, handler] of ledger.listeners) session.on(event, handler);
    emitDocument(session, options);
    const observed = ledger.report();
    assert.equal(observed.status, "incomplete");
    assert.ok(observed.failures.includes("missing-qualified-main-document"));
    assert.equal(observed.terminalIssueExamples[0]?.reason ?? null, issue);
  }
});

test("the collector stops once and only qualifies the current loader through terminal read", async () => {
  const session = new Session();
  const capture = await startProfile(session, fixture);
  emitDocument(session);
  session.navigated = true;
  const finish = capture.finish("fixture-bounds", async () => ({ phasePage: { generation: 2 } }));
  assert.equal(finish, capture.finish("capture-deadline"));
  const observed = await finish;
  assert.equal(observed.status, "observed", JSON.stringify(observed.failures));
  assert.equal(observed.detached, true);
  assert.equal(session.eventNames().length, 0);
  assert.deepEqual(session.calls.filter(([method]) => method === "Profiler.setSamplingInterval"), [
    ["Profiler.setSamplingInterval", { interval: 2_000 }],
  ]);
  assert.equal(session.calls.filter(([method]) => method === "Profiler.stop").length, 1);
});

test("replacement loader is incomplete and does not bypass detach", async () => {
  const session = new Session();
  const capture = await startProfile(session, fixture);
  emitDocument(session);
  session.navigated = true;
  session.terminal = { ...nav.frame, loaderId: "unexpected" };
  const observed = await capture.finish("fixture-bounds", async () => ({ phasePage: { generation: 2 } }));
  assert.equal(observed.status, "incomplete");
  assert.ok(observed.failures.includes("terminal-document-unbound"));
  assert.equal(observed.detached, true);
});

test("capture deadline is armed independently of fixture bounds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = new Session();
  const capture = await startProfile(session, fixture);
  t.mock.timers.tick(20_001);
  await capture.deadline;
  const observed = await capture.finish("fixture-bounds", async () => { throw new Error("deadline should own exit"); });
  assert.equal(observed.reason, "capture-deadline");
  assert.equal(observed.status, "incomplete");
  assert.equal(observed.detached, true);
  assert.equal(session.calls.filter(([method]) => method === "Profiler.stop").length, 1);
});

test("a failed start does not stop an unowned profile and removes its listeners", async () => {
  const session = new Session();
  session.failedMethod = "Profiler.start";
  await assert.rejects(startProfile(session, fixture), /secondary-profile-start-failed/);
  assert.equal(session.calls.filter(([method]) => method === "Profiler.stop").length, 0);
  assert.equal(session.calls.at(-1)[0], "detach");
  assert.equal(session.eventNames().length, 0);
});
