import assert from "node:assert/strict";
import test from "node:test";
import { inspectZk682CommandReceipt } from "./zk682-command-receipt.mjs";

const COMMIT = "1".repeat(40);
const receipt = (overrides = {}) => ({
  schemaVersion: 1,
  kind: "command-receipt",
  receiptId: "core-build",
  candidateCommit: COMMIT,
  capturedAt: "2026-09-29T12:00:00.000Z",
  command: ["npm", "run", "build"],
  exitCode: 0,
  durationMs: 10,
  passed: true,
  ...overrides,
});

test("accepts a candidate-bound pass and a structurally valid failed command", () => {
  assert.deepEqual(inspectZk682CommandReceipt(receipt(), { candidateCommit: COMMIT, receiptId: "core-build" }), { valid: true, passed: true, errors: [] });
  assert.deepEqual(inspectZk682CommandReceipt(receipt({ exitCode: 1, passed: false }), { candidateCommit: COMMIT, receiptId: "core-build" }), { valid: true, passed: false, errors: [] });
});

test("rejects manual pass flags, short candidates, and receipt substitution", () => {
  assert(inspectZk682CommandReceipt(receipt({ exitCode: 1 }), { candidateCommit: COMMIT, receiptId: "core-build" }).errors.includes("passed must be derived from exitCode"));
  assert(inspectZk682CommandReceipt(receipt({ candidateCommit: "local" }), { candidateCommit: COMMIT, receiptId: "core-build" }).errors.some((error) => error.includes("full SHA")));
  assert(inspectZk682CommandReceipt(receipt({ receiptId: "core-unit" }), { candidateCommit: COMMIT, receiptId: "core-build" }).errors.some((error) => error.includes("receiptId must be")));
});
