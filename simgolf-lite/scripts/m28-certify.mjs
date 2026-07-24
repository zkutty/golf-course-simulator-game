import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("release/m28-certification.json", root), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const required = Array.from({ length: 9 }, (_, index) => `ZK-${253 + index}`);
const byId = new Map(manifest.gates.map((gate) => [gate.id, gate]));
const errors = [];

if (manifest.release !== pkg.version) errors.push(`Manifest release ${manifest.release} does not match package ${pkg.version}`);
for (const id of required) if (!byId.has(id)) errors.push(`Missing M28 gate: ${id}`);
for (const gate of manifest.gates) {
  if (gate.kind === "automated" && !gate.command) errors.push(`${gate.id}: automated gate lacks a command`);
  if (gate.status === "passed" && !gate.evidence) errors.push(`${gate.id}: passed gate lacks evidence`);
  if (gate.kind === "external" && gate.status === "passed" && typeof gate.evidence !== "string") {
    errors.push(`${gate.id}: external evidence must be a stable file or URL reference`);
  }
}

const blockers = manifest.gates
  .filter((gate) => gate.id !== "ZK-261" && gate.status !== "passed")
  .map((gate) => gate.id);
const decision = blockers.length === 0 ? "GO" : "HOLD";
if (manifest.decision !== decision) errors.push(`Decision must be ${decision} while ${blockers.length} prerequisite gate(s) are not passed`);
const finalGate = byId.get("ZK-261");
if (finalGate && finalGate.status === "passed" && manifest.decision !== "GO") {
  errors.push("ZK-261 cannot pass while the release decision is HOLD");
}

const report = {
  ok: errors.length === 0,
  schemaVersion: manifest.schemaVersion,
  release: manifest.release,
  decision,
  decisionReason: manifest.decisionReason,
  generatedAt: new Date().toISOString(),
  blockers,
  errors,
  gates: manifest.gates,
};
mkdirSync(new URL("artifacts/m28/", root), { recursive: true });
writeFileSync(new URL("artifacts/m28/certification-report.json", root), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
