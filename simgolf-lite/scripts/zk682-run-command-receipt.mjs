import { fileURLToPath } from "node:url";
import { runZk682CommandReceipt } from "./zk682-command-receipt.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const separator = args.indexOf("--");
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 && index < separator ? args[index + 1] : undefined;
};
const receiptId = valueFor("--id");
const outputPath = valueFor("--output");
const candidateCommit = valueFor("--candidate") ?? process.env.ZK682_EXPECTED_COMMIT;
const command = separator >= 0 ? args.slice(separator + 1) : [];
const optionArgs = separator >= 0 ? args.slice(0, separator) : args;
const knownOptions = new Set(["--id", "--output", "--candidate", receiptId, outputPath, candidateCommit]);
if (!receiptId || !outputPath || !/^[0-9a-f]{40}$/.test(candidateCommit ?? "") || command.length === 0 || optionArgs.some((arg) => !knownOptions.has(arg))) {
  throw new Error("Usage: node scripts/zk682-run-command-receipt.mjs --id <id> --output <path> [--candidate <full-sha>] -- <command> [args...]");
}

const receipt = runZk682CommandReceipt({ receiptId, candidateCommit, command, cwd: root, outputPath });
process.stdout.write(`[zk682] ${receipt.receiptId}: ${receipt.passed ? "PASS" : "FAIL"} (${receipt.exitCode})\n`);
