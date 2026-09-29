import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildZk682Report,
  zk682ReportJson,
  zk682ReportMarkdown,
} from "./zk682-certification-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputArg = valueFor("--input");
const outputArg = valueFor("--output-dir");
const expectedCommit = valueFor("--expected-commit") ?? process.env.ZK682_EXPECTED_COMMIT;
if (!inputArg || !outputArg || !/^[0-9a-f]{40}$/.test(expectedCommit ?? "") || args.some((arg) => arg.startsWith("--") && !["--input", "--output-dir", "--expected-commit"].includes(arg))) {
  throw new Error("Usage: node scripts/zk682-certify.mjs --input <manifest.json> --output-dir <directory> --expected-commit <full-sha>");
}

function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: root, encoding });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr ?? "").trim()}`);
  return result.stdout;
}

const repositoryRoot = String(git(["rev-parse", "--show-toplevel"])).trim();
const packagePrefix = relative(repositoryRoot, root).split(sep).join("/").replace(/\/$/, "");
const manifestPath = join(root, inputArg);
const outputDirectory = join(root, outputArg);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const report = buildZk682Report(manifest, {
  root,
  expectedCommit,
  commitExists: (commit) => spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root }).status === 0,
  readCandidateFile: (commit, path) => git(["show", `${commit}:${packagePrefix ? `${packagePrefix}/` : ""}${path}`], null),
});

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "certification-report.json"), zk682ReportJson(report));
writeFileSync(join(outputDirectory, "CERTIFICATION.md"), zk682ReportMarkdown(report));
process.stdout.write(`${report.decision} ${report.reportDigest}\n`);
