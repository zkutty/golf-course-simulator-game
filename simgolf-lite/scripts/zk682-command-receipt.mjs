import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const ZK682_COMMAND_RECEIPT_SCHEMA_VERSION = 1;

export function inspectZk682CommandReceipt(receipt, { candidateCommit, receiptId } = {}) {
  const errors = [];
  const exact = [
    "schemaVersion",
    "kind",
    "receiptId",
    "candidateCommit",
    "capturedAt",
    "command",
    "exitCode",
    "durationMs",
    "passed",
  ];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { valid: false, passed: false, errors: ["receipt must be an object"] };
  }
  if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(exact.sort())) {
    errors.push(`receipt keys must be exactly ${exact.sort().join(", ")}`);
  }
  if (receipt.schemaVersion !== ZK682_COMMAND_RECEIPT_SCHEMA_VERSION) errors.push("wrong command receipt schema");
  if (receipt.kind !== "command-receipt") errors.push("kind must be command-receipt");
  if (typeof receipt.receiptId !== "string" || !/^[a-z0-9][a-z0-9-]+$/.test(receipt.receiptId)) errors.push("receiptId is invalid");
  if (receiptId && receipt.receiptId !== receiptId) errors.push(`receiptId must be ${receiptId}`);
  if (typeof receipt.candidateCommit !== "string" || !/^[0-9a-f]{40}$/.test(receipt.candidateCommit)) errors.push("candidateCommit must be a full SHA");
  if (candidateCommit && receipt.candidateCommit !== candidateCommit) errors.push("candidate commit mismatch");
  if (typeof receipt.capturedAt !== "string" || Number.isNaN(Date.parse(receipt.capturedAt))) errors.push("capturedAt is invalid");
  if (!Array.isArray(receipt.command) || receipt.command.length === 0 || receipt.command.some((part) => typeof part !== "string" || part.length === 0)) errors.push("command must be a non-empty argv array");
  if (!Number.isInteger(receipt.exitCode) || receipt.exitCode < 0) errors.push("exitCode must be a non-negative integer");
  if (!Number.isFinite(receipt.durationMs) || receipt.durationMs < 0) errors.push("durationMs must be non-negative");
  if (typeof receipt.passed !== "boolean" || receipt.passed !== (receipt.exitCode === 0)) errors.push("passed must be derived from exitCode");
  return { valid: errors.length === 0, passed: errors.length === 0 && receipt.exitCode === 0, errors };
}

export function runZk682CommandReceipt({ receiptId, candidateCommit, command, cwd, outputPath, env = process.env }) {
  const started = Date.now();
  const result = spawnSync(command[0], command.slice(1), { cwd, env, stdio: "inherit" });
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const receipt = {
    schemaVersion: ZK682_COMMAND_RECEIPT_SCHEMA_VERSION,
    kind: "command-receipt",
    receiptId,
    candidateCommit,
    capturedAt: new Date().toISOString(),
    command,
    exitCode,
    durationMs: Date.now() - started,
    passed: exitCode === 0,
  };
  const inspected = inspectZk682CommandReceipt(receipt, { candidateCommit, receiptId });
  if (!inspected.valid) throw new Error(inspected.errors.join("; "));
  const absolute = resolve(cwd, outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}
