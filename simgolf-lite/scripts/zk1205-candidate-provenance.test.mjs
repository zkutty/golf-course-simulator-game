import assert from "node:assert/strict";
import test from "node:test";
import { captureZk1205CandidateProvenance } from "./zk1205-candidate-provenance.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);

function runnerFor(outputs, calls = []) {
  return (args) => {
    calls.push([...args]);
    if (!Object.hasOwn(outputs, args[0])) return null;
    return outputs[args[0]];
  };
}

test("clean checkout records checkout and CI labels separately", () => {
  const calls = [];
  const result = captureZk1205CandidateProvenance({
    runGit: runnerFor({ "rev-parse": `${A}\n`, status: "" }, calls),
    env: { GITHUB_SHA: A },
  });
  assert.deepEqual(result, {
    checkout: { commit: A, worktree: "clean", dirtyEntries: [] },
    ci: { source: "GITHUB_SHA", commit: A, state: "available" },
    relationship: "match",
  });
  assert.deepEqual(calls, [
    ["rev-parse", "--verify", "HEAD"],
    ["status", "--porcelain=v1", "--untracked-files=all"],
  ]);
});

test("dirty checkout is explicit and retains porcelain entries", () => {
  const result = captureZk1205CandidateProvenance({
    runGit: runnerFor({ "rev-parse": `${A}\n`, status: " M e2e/matrix.ts\n?? artifacts/report.json\n" }),
    env: { GITHUB_SHA: A },
  });
  assert.equal(result.checkout.commit, A);
  assert.equal(result.checkout.worktree, "dirty");
  assert.deepEqual(result.checkout.dirtyEntries, [" M e2e/matrix.ts", "?? artifacts/report.json"]);
});

test("failed checkout read stays unknown even when worktree status is available", () => {
  const result = captureZk1205CandidateProvenance({
    runGit: runnerFor({ "rev-parse": null, status: "" }),
    env: {},
  });
  assert.deepEqual(result.checkout, { commit: null, worktree: "clean", dirtyEntries: [] });
  assert.deepEqual(result.ci, { source: null, commit: null, state: "missing" });
  assert.equal(result.relationship, "unknown");
});

test("failed status read leaves worktree state unknown without erasing checkout", () => {
  const result = captureZk1205CandidateProvenance({
    runGit: runnerFor({ "rev-parse": `${A}\n`, status: null }),
    env: { GITHUB_SHA: A },
  });
  assert.deepEqual(result.checkout, { commit: A, worktree: "unknown", dirtyEntries: null });
  assert.equal(result.relationship, "match");
});

test("thrown Git runner failures become explicit unknown fields", () => {
  const result = captureZk1205CandidateProvenance({
    runGit: () => { throw new Error("injected runner failure"); },
    env: {},
  });
  assert.deepEqual(result.checkout, { commit: null, worktree: "unknown", dirtyEntries: null });
});

test("conflicting CI identity is preserved and flagged", () => {
  const result = captureZk1205CandidateProvenance({
    runGit: runnerFor({ "rev-parse": `${A}\n`, status: "" }),
    env: { GITHUB_SHA: B },
  });
  assert.equal(result.checkout.commit, A);
  assert.equal(result.ci.commit, B);
  assert.equal(result.relationship, "conflict");
});

test("invalid CI identity is explicit and never presented as a candidate SHA", () => {
  const result = captureZk1205CandidateProvenance({
    runGit: runnerFor({ "rev-parse": `${A}\n`, status: "" }),
    env: { GITHUB_SHA: "short" },
  });
  assert.deepEqual(result.ci, { source: "GITHUB_SHA", commit: null, state: "invalid" });
  assert.equal(result.relationship, "unknown");
});
