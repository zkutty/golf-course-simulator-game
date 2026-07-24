import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("release/m44-certification.json", root), "utf8"));
const required = [
  "unit",
  "production-build",
  "demo-build",
  "desktop-store",
  "content-packages",
  "fuzz",
  "signing-notarization",
  "licensing-store-review",
  "hardware-matrix",
  "ten-player-playtest",
  "release-council"
];
const byId = new Map(manifest.gates.map((gate) => [gate.id, gate]));
const errors = [];
for (const id of required) if (!byId.has(id)) errors.push(`Missing gate: ${id}`);
for (const gate of manifest.gates) {
  if (gate.kind === "automated" && !gate.command) errors.push(`${gate.id}: automated gate lacks a command`);
  if (gate.kind === "external" && gate.status === "passed" && !gate.evidence) {
    errors.push(`${gate.id}: external gate cannot pass without evidence`);
  }
}
const blockers = manifest.gates.filter((gate) => gate.status !== "passed").map((gate) => gate.id);
const decision = blockers.length === 0 ? "GO" : "HOLD";
if (manifest.decision !== decision) errors.push(`Decision must be ${decision} while ${blockers.length} gate(s) are not passed`);
const report = {
  ok: errors.length === 0,
  schemaVersion: manifest.schemaVersion,
  release: manifest.release,
  decision,
  generatedAt: new Date().toISOString(),
  blockers,
  errors,
  gates: manifest.gates
};
mkdirSync(new URL("artifacts/m44/", root), { recursive: true });
writeFileSync(new URL("artifacts/m44/certification-report.json", root), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
