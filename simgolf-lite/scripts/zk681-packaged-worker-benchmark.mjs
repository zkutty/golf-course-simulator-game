import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const defaultExecutable = path.join(
  root,
  "desktop-dist",
  "mac-arm64",
  "CourseCraft.app",
  "Contents",
  "MacOS",
  "CourseCraft",
);
const executable = process.argv[2] ?? defaultExecutable;
const marker = "COURSECRAFT_ANALYSIS_WORKER_BENCHMARK=";
const timeoutMs = 120_000;

if (!existsSync(executable)) {
  throw new Error(`Missing packaged CourseCraft executable: ${executable}`);
}

const result = await new Promise((resolve, reject) => {
  const child = spawn(executable, ["--analysis-worker-benchmark"], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    reject(new Error(`Packaged Worker benchmark timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0) reject(new Error(`Packaged Worker benchmark exited ${code}: ${stderr || stdout}`));
    else resolve({ stdout, stderr });
  });
});

const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith(marker));
if (!line) throw new Error(`Packaged Worker benchmark emitted no report: ${result.stderr || result.stdout}`);
const report = JSON.parse(line.slice(marker.length));
assert.equal(report.decision, "adopt-advisory-worker");
assert.equal(report.measurements.every((measurement) => measurement.outputEquivalent), true);
assert.equal(report.semantics.cancellationRejectedCallback, true);
assert.equal(report.semantics.staleRevisionRejectedCallback, true);
assert.equal(report.semantics.sessionTeardownTerminatesWorker, true);
assert.equal(report.measurements.some((measurement) => measurement.transferBytes > 0), true);
assert.equal(report.measurements.every((measurement) => Number.isFinite(measurement.mainInputDelayMs)), true);
assert.equal(report.measurements.every((measurement) => Number.isFinite(measurement.workerInputDelayMs)), true);

const artifactDirectory = path.join(root, "artifacts", "zk-681");
await mkdir(artifactDirectory, { recursive: true });
await writeFile(path.join(artifactDirectory, "packaged-worker-benchmark.json"), `${JSON.stringify({
  capturedAt: new Date().toISOString(),
  engine: "Packaged Electron renderer",
  executable: path.relative(root, executable),
  report,
}, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  engine: "Packaged Electron renderer",
  workloads: report.measurements.map((measurement) => measurement.workload),
  decision: report.decision,
}));
