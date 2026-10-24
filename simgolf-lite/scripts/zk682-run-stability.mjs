import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ZK682_STABILITY_PRODUCER_VERSION } from "./zk682-stability-producer.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export function parseStabilityArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--output-dir", "--expected-commit"].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value: ${flag}`);
    if (Object.hasOwn(values, flag)) throw new Error(`Duplicate argument: ${flag}`);
    values[flag] = args[index + 1];
  }
  return values;
}

export function stabilityCommands(node, appRoot, buildDirectory) {
  return {
    build: [node, resolve(appRoot, "node_modules/vite/bin/vite.js"), "build", "--mode", "e2e", "--outDir", buildDirectory, "--emptyOutDir"],
    test: [node, resolve(appRoot, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.stability.config.ts", "--workers=1", "--retries=0"],
  };
}

export function quoteStabilityShellArgument(value, platform = process.platform) {
  if (/[\0\r\n]/.test(value)) throw new Error("Invalid preview command argument");
  if (platform === "win32") {
    if (/[%!"]/.test(value)) throw new Error("Unsupported shell expansion in Windows preview path");
    return `"${value.replace(/(\\+)$/, "$1$1")}"`;
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function stabilityPreviewCommand(node, vite, buildDirectory, port, platform = process.platform) {
  return [node, vite, "preview", "--outDir", buildDirectory, "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
    .map(value => quoteStabilityShellArgument(value, platform)).join(" ");
}

export function stabilitySourceProblems(tracked, untracked, appPrefix) {
  // These exact generated reports are written before stability in the existing
  // certification workflow. Neither is an application/build input.
  const generated = new Set([`${appPrefix}artifacts/m35/asset-audit.json`, `${appPrefix}artifacts/m28/performance-parkland.json`]);
  const raw = `${appPrefix}artifacts/zk682/raw/`;
  const evidenceExtensions = new Set([".json", ".txt", ".log", ".png", ".jpg", ".jpeg", ".webp", ".zip", ".webm", ".mp4", ".md", ".gz"]);
  return [...tracked.filter(path => !generated.has(path)), ...untracked.filter(path => !path.startsWith(raw) || !evidenceExtensions.has(extname(path).toLowerCase()))];
}

const canonicalPath = path => existsSync(path) ? realpathSync(path) : join(canonicalPath(dirname(path)), basename(path));
const within = (parent, child) => { const part = relative(parent, child); return part === "" || (!part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part)); };
export function validateStabilityOutputDirectory(appRoot, repositoryRoot, output) {
  const directory = canonicalPath(output);
  const evidenceRoot = resolve(appRoot, "artifacts/zk682/raw");
  if (canonicalPath(evidenceRoot) !== evidenceRoot) throw new Error("Stability evidence root must not redirect through a symlink");
  if (within(repositoryRoot, directory)) {
    if (!within(evidenceRoot, directory)) throw new Error("Repository stability output must stay in artifacts/zk682/raw");
  } else {
    const temporaryRoots = [realpathSync(tmpdir()), ...(existsSync("/tmp") ? [realpathSync("/tmp")] : [])];
    if (!temporaryRoots.some(path => within(path, directory))) throw new Error("External stability output must use a temporary directory");
  }
  return directory;
}

export function runStability(args = process.argv.slice(2)) {
  const flags = parseStabilityArguments(args);
  let gitRoot = root;
  const git = (...arguments_) => {
    const result = spawnSync("git", arguments_, { cwd: gitRoot, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Git candidate check failed: ${result.stderr}`);
    return result.stdout;
  };
  const head = git("rev-parse", "HEAD").trim();
  const repositoryRoot = realpathSync(git("rev-parse", "--show-toplevel").trim());
  gitRoot = repositoryRoot;
  const relativeApp = relative(repositoryRoot, realpathSync(root)).split(sep).join("/");
  const appPrefix = relativeApp ? `${relativeApp}/` : "";
  const candidateCommit = flags["--expected-commit"] ?? process.env.ZK682_EXPECTED_COMMIT ?? head;
  if (!/^[0-9a-f]{40}$/.test(candidateCommit)) throw new Error("Stability certification requires a full 40-character candidate SHA");
  if (candidateCommit !== head) throw new Error(`Expected candidate ${candidateCommit} does not match checked-out HEAD ${head}`);
  const assertCandidate = () => {
    const tracked = git("diff", "--name-only", "-z", "HEAD", "--").split("\0").filter(Boolean);
    const untracked = git("ls-files", "--others", "--exclude-standard", "-z", "--").split("\0").filter(Boolean);
    if (git("rev-parse", "HEAD").trim() !== candidateCommit || stabilitySourceProblems(tracked, untracked, appPrefix).length > 0) throw new Error("Stability build requires unchanged candidate source; only declared generated evidence outputs are permitted");
  };
  assertCandidate();
  const runDirectory = mkdtempSync(join(tmpdir(), "coursecraft-zk682-stability-"));
  const buildDirectory = join(runDirectory, "build");
  const buildId = randomUUID();
  const receiptPath = join(runDirectory, "build-receipt.json");
  const outputDirectory = validateStabilityOutputDirectory(realpathSync(root), repositoryRoot, resolve(flags["--output-dir"] ?? process.env.COURSECRAFT_ZK682_STABILITY_DIR ?? "artifacts/zk682/raw"));
  for (const gate of ["save-load-resource-stability", "long-session-resource-stability", "editing-overlay-sleep-recovery"]) {
    if (existsSync(join(outputDirectory, `${gate}.json`))) throw new Error("Stability output directory already contains reports; preserve them and select a fresh output directory");
  }
  mkdirSync(outputDirectory, { recursive: true });
  const env = {
    ...process.env,
    NODE_ENV: "production",
    GITHUB_SHA: candidateCommit,
    VITE_COMMIT_SHA: candidateCommit,
    VITE_BASE: "/",
    VITE_ZK682_STABILITY_FIXTURE: "1",
    COURSECRAFT_ZK682_STABILITY_BUILD: "1",
    ZK682_EXPECTED_COMMIT: candidateCommit,
    ZK682_STABILITY_BUILD_ID: buildId,
    ZK682_STABILITY_BUILD_DIR: buildDirectory,
    ZK682_STABILITY_BUILD_RECEIPT: receiptPath,
    COURSECRAFT_ZK682_STABILITY_DIR: outputDirectory,
  };
  const commands = stabilityCommands(process.execPath, root, buildDirectory);
  const run = (command) => {
    const result = spawnSync(command[0], command.slice(1), { cwd: root, stdio: "inherit", env });
    if (result.status !== 0) throw new Error(`Stability subprocess failed (${result.status ?? result.error?.message ?? "terminated"}): ${command[1]}`);
  };
  const startedAt = new Date().toISOString();
  run(commands.build);
  assertCandidate();
  const indexBytes = readFileSync(join(buildDirectory, "index.html"));
  writeFileSync(receiptPath, `${JSON.stringify({ producerVersion: ZK682_STABILITY_PRODUCER_VERSION, candidateCommit, buildId, buildDirectory, mode: "e2e", nodeEnv: "production", startedAt, completedAt: new Date().toISOString(), indexSha256: createHash("sha256").update(indexBytes).digest("hex") }, null, 2)}\n`, { flag: "wx" });
  run(commands.test);
  assertCandidate();
  process.stdout.write(`${JSON.stringify({ ok: true, producerVersion: ZK682_STABILITY_PRODUCER_VERSION, candidateCommit, buildId, buildDirectory, receiptPath, outputDirectory })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runStability();
