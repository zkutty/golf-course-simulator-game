import { runZk682CommandReceipt } from "./zk682-command-receipt.mjs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const unknown = args.find((arg) => arg.startsWith("--") && !["--output", "--expected-commit"].includes(arg));
if (unknown) throw new Error(`Unknown argument: ${unknown}`);

const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (gitHead.status !== 0) throw new Error(`Unable to resolve candidate commit: ${gitHead.stderr}`);
const candidateCommit = valueFor("--expected-commit")
  ?? process.env.ZK682_EXPECTED_COMMIT
  ?? gitHead.stdout.trim();
if (!/^[0-9a-f]{40}$/.test(candidateCommit)) {
  throw new Error("Resource-growth certification requires a full 40-character candidate SHA");
}
if (candidateCommit !== gitHead.stdout.trim()) {
  throw new Error(`Expected candidate ${candidateCommit} does not match checked-out HEAD ${gitHead.stdout.trim()}`);
}
const outputPath = resolve(valueFor("--output")
  ?? process.env.COURSECRAFT_ZK682_RESOURCE_REPORT
  ?? "artifacts/zk682/raw/renderer-resource-growth.json");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const receipt = runZk682CommandReceipt({
  receiptId: "renderer-resource-growth", candidateCommit,
  outputPath: resolve(dirname(outputPath), "renderer-resource-growth-command.json"),
  command: [
    executable,
    "playwright",
    "test",
    "e2e/zk1262-capture-phase-diagnostic.e2e.ts",
    "--workers=1",
    "--retries=0",
  ],
  cwd: root,
  env: {
    ...process.env,
    ZK682_EXPECTED_COMMIT: candidateCommit,
    VITE_COMMIT_SHA: candidateCommit,
    COURSECRAFT_ZK682_RESOURCE_REPORT: outputPath,
  },
});
if (!receipt.passed) process.exit(receipt.exitCode);
process.stdout.write(`${JSON.stringify({ ok: true, candidateCommit, output: outputPath })}\n`);
