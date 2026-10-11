// ROOT-only static recorder regression: no browser, native owner, or global collector.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const originalCounterfactual = args.length === 2 && args[0] === "--original-core";
if (args.length && !originalCounterfactual) throw new Error("Expected no arguments or --original-core ABSOLUTE_PATH");
const coreURL = originalCounterfactual
  ? pathToFileURL(resolve(args[1]))
  : new URL("../src/utils/startupAttribution.mjs", import.meta.url);
if (originalCounterfactual) {
  const bytes = readFileSync(fileURLToPath(coreURL));
  assert.equal(bytes.length, 12659, "Counterfactual must use the whole admitted original core");
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "82d917040a73dbba7fd739bb7f5f32e400a53bd5321d61774a94535444b4c9c2",
    "Counterfactual core must be the actual frozen original");
}
const core = await import(coreURL.href);
const { createStartupRecorder, analyzeStartupAttribution, validateStartupAttribution, parseStartupAttribution } = core;
// The original wrapper forwarded the token directly to owner. This fallback is
// allowed only for the pinned original counterfactual, so failure proves the
// token/scalar defect rather than a missing newly exported symbol.
const rendererAttempt = (recorder, token) => originalCounterfactual
  ? recorder.owner(token)
  : core.recordRendererStartupAttempt(recorder, token);
const makeRecorder = () => {
  let t = 0;
  return createStartupRecorder({ now: () => ++t, start: 0, timeOrigin: 1234 });
};
const clone = (journal) => JSON.parse(JSON.stringify(journal));

function completeCohort() {
  const recorder = makeRecorder();
  const canceled = rendererAttempt(recorder, Object.freeze({ generation: 101 }));
  recorder.begin(8, null, canceled);
  recorder.begin(9, null, canceled);
  recorder.finishAttempt(canceled);
  const beforeRepeatedCancel = recorder.snapshot().events.length;
  recorder.finishAttempt(canceled);
  assert.equal(recorder.snapshot().events.length, beforeRepeatedCancel, "Cancellation must be idempotent");

  const current = rendererAttempt(recorder, Object.freeze({ generation: 702 }));
  const fixture = recorder.begin(1);
  for (const phase of [2, 3, 4, 5]) recorder.end(recorder.begin(phase, fixture));
  const restore = recorder.begin(7, fixture);
  recorder.end(recorder.begin(6, restore));
  recorder.end(restore);
  recorder.end(fixture);
  for (const phase of [8, 9, 10, 11]) recorder.end(recorder.begin(phase, null, current));
  for (const phase of [12, 13, 14, 15]) {
    const token = recorder.begin(phase);
    recorder.end(token);
    recorder.end(token);
  }
  recorder.markReady();
  return { recorder, canceled, current, journal: recorder.snapshot() };
}

const { recorder, canceled, current, journal } = completeCohort();
if (originalCounterfactual) {
  assert.equal(journal.failure, 32, "The pinned original must reproduce producer failure 32");
  assert.deepEqual(analyzeStartupAttribution(journal).firstFailure, { producerFailure: 32 });
  console.log("Pinned original counterfactual reproduced producerFailure 32 at the native token/scalar boundary");
}
// This is intentionally the first positive regression assertion in the original
// counterfactual. It must exit nonzero after the actual producer defect is seen.
assert.equal(journal.failure, null, "A valid native generation token must not produce failure 32");
assert.equal(typeof core.recordRendererStartupAttempt, "function");
assert.deepEqual([canceled, current], [1, 2]);
assert.notEqual(canceled, 101);
assert.notEqual(current, 702, "Native serial and recorder attempt ID are distinct");
const analysis = analyzeStartupAttribution(journal);
assert.equal(analysis.eligible, true);
assert.equal(analysis.firstFailure, null);
assert.deepEqual(analysis.secondaryFailures, []);
assert.deepEqual([...new Set(analysis.phases.map((phase) => phase.phase))].sort((a, b) => a - b),
  Array.from({ length: 15 }, (_, i) => i + 1));
assert.equal(analysis.phases.some((phase) => phase.attempt === canceled), false);
assert.equal(journal.events.filter((row) => row[1] === 3 && row[5] === canceled).length, 2);
assert.equal(journal.events.filter((row) => row[1] === 5 && row[5] === canceled).length, 1);
for (const phase of [8, 9, 10, 11]) {
  const observed = analysis.phases.find((p) => p.phase === phase);
  assert.equal(observed.attempt, current);
  assert.equal(observed.generation, 702);
}
assert.equal(journal.events.filter((row) => row[5] === canceled).every((row) => row[6] === 101), true);
assert.equal(journal.events.filter((row) => row[5] === current).every((row) => row[6] === 702), true);
assert.equal(journal.events.filter((row) => row[5] === 0).every((row) => row[6] === 0), true);
assert.equal(journal.events.every((row, i) => row.length === 8 && row[0] === i), true);
assert.equal(journal.events.filter((row) => row[1] === 4).length, 1);
assert.equal(journal.events.at(-1)[1], 4);
assert.equal(analysis.phases.every((phase) => phase.exclusiveMs >= 0), true);
assert.equal(analysis.residualMs >= 0, true);
assert.deepEqual(parseStartupAttribution(JSON.stringify(journal)).events, journal.events);
const unqualified = validateStartupAttribution(journal);
assert.equal(unqualified.eligible, true);
for (const field of ["trusted", "diagnosticQualified", "numericPass", "releaseCleared"]) assert.equal(unqualified[field], false);
assert.equal(unqualified.structuralOnly, true);
assert.equal(unqualified.nativeChildClosure, "UNKNOWN");
assert.equal(core.startupAttempt(Object.freeze({ generation: 42 })), 0, "No global collector was forged by this test");
assert.equal(recorder.snapshot().failure, null);

const invalidMembers = [undefined, null, 0, -0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1,
  NaN, Infinity, -Infinity, "42", true, false, 42n, Symbol("generation"), {}, []];
function expectStickyFailure32(attemptFactory, value) {
  const isolated = makeRecorder();
  const invalid = attemptFactory(isolated, value);
  isolated.end(isolated.begin(8, null, invalid));
  const valid = rendererAttempt(isolated, Object.freeze({ generation: 933 }));
  isolated.end(isolated.begin(9, null, valid));
  isolated.markReady();
  const failed = isolated.snapshot();
  assert.equal(failed.failure, 32);
  assert.equal(failed.events.some((row) => row[5] === valid && row[6] === 933), true);
  assert.equal(analyzeStartupAttribution(failed).eligible, false);
  assert.deepEqual(analyzeStartupAttribution(failed).firstFailure, { producerFailure: 32 });
}
for (const value of invalidMembers) {
  expectStickyFailure32(rendererAttempt, Object.freeze({ generation: value }));
  expectStickyFailure32((r, v) => r.owner(v), value);
}
expectStickyFailure32((r, v) => r.owner(v), Object.freeze({ generation: 42 }));
const malformedTokens = [undefined, null, 0, 42, "token", true, Symbol("token"), 42n,
  {}, [], Object.create({ generation: 42 }), Object.assign([], { generation: 42 }),
  Object.assign(() => {}, { generation: 42 }),
  new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("malformed token"); } })];
for (const token of malformedTokens) expectStickyFailure32(rendererAttempt, token);
let getterReads = 0;
expectStickyFailure32(rendererAttempt, { get generation() { getterReads++; return 42; } });
assert.equal(getterReads, 0, "The adapter must not invoke a generation accessor");
const largest = makeRecorder();
const largestAttempt = rendererAttempt(largest, Object.freeze({ generation: Number.MAX_SAFE_INTEGER }));
largest.end(largest.begin(8, null, largestAttempt));
largest.markReady();
assert.equal(largest.snapshot().failure, null);
assert.equal(largest.snapshot().events[0][6], Number.MAX_SAFE_INTEGER);

// A producer's failure=null claim cannot launder owned fallback zero.
const ownedZero = clone(journal);
for (const row of ownedZero.events) if (row[5] > 0) row[6] = 0;
assert.equal(ownedZero.failure, null);
assert.equal(analyzeStartupAttribution(ownedZero).eligible, false);
assert.equal(analyzeStartupAttribution(ownedZero).firstFailure, "invalid-owned-generation");
ownedZero.failure = 32;
assert.deepEqual(analyzeStartupAttribution(ownedZero).firstFailure, { producerFailure: 32 });
assert.equal(validateStartupAttribution(ownedZero).trusted, false);
assert.equal(analyzeStartupAttribution(journal).eligible, true, "Global 0/0 rows remain valid");

const failures = (result) => [result.firstFailure, ...result.secondaryFailures];
const rowOrder = clone(journal);
rowOrder.events[0][0] = 99;
assert.equal(failures(analyzeStartupAttribution(rowOrder)).includes("row-or-order"), true);
const drift = clone(journal);
drift.events.find((row) => row[5] === current && row[1] === 1)[6] = 703;
assert.equal(failures(analyzeStartupAttribution(drift)).includes("generation-drift"), true);
const missingTerminal = clone(journal);
const removed = missingTerminal.events.findIndex((row) => row[2] === 8 && row[5] === current && row[1] === 1);
missingTerminal.events.splice(removed, 1);
missingTerminal.events.forEach((row, i) => { row[0] = i; });
assert.equal(failures(analyzeStartupAttribution(missingTerminal)).includes("missing-terminal"), true);
const badParent = clone(journal);
for (const row of badParent.events) if (row[2] === 2) row[4] = 0;
assert.equal(failures(analyzeStartupAttribution(badParent)).includes("fixture-parent"), true);
const overflow = makeRecorder();
for (let i = 0; i < 128; i++) overflow.end(overflow.begin(12));
overflow.begin(12);
assert.equal(overflow.snapshot().events.length, 256);
assert.equal(overflow.snapshot().overflow, true);
assert.equal(overflow.snapshot().failure, 20);
assert.throws(() => parseStartupAttribution(" ".repeat(65537)), /JSON cap/);
console.log("Startup generation boundary regression passed: adapter, positive serials, cancellation, sticky refusal, owned zero, schema limits, and absent authority");
