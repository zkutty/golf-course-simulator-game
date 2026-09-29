import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZk682DesktopPersistenceReport } from "./zk682-desktop-persistence-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const marker = "COURSECRAFT_DESKTOP_PERSISTENCE_CERT=";
const timeoutMs = 120_000;
const args = process.argv.slice(2);
let executableArg;
let outputArg;
let expectedCommitArg;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--output") outputArg = args[++index];
  else if (args[index] === "--expected-commit") expectedCommitArg = args[++index];
  else if (!args[index].startsWith("--") && !executableArg) executableArg = args[index];
  else throw new Error(`Unknown argument: ${args[index]}`);
}
const currentCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (currentCommit.status !== 0) throw new Error(`Unable to resolve candidate commit: ${currentCommit.stderr}`);
const expectedCommit = expectedCommitArg ?? process.env.ZK682_EXPECTED_COMMIT ?? process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? currentCommit.stdout.trim();
if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? "")) {
  throw new Error("Packaged persistence certification requires --expected-commit with a full 40-character SHA");
}
if (expectedCommit !== currentCommit.stdout.trim()) {
  throw new Error(`Expected candidate ${expectedCommit} does not match checked-out HEAD ${currentCommit.stdout.trim()}`);
}
const candidates = process.platform === "win32"
  ? [path.join(root, "desktop-dist", "win-unpacked", "CourseCraft.exe")]
  : ["mac-arm64", "mac-universal", "mac"].map((directory) => path.join(root, "desktop-dist", directory, "CourseCraft.app", "Contents", "MacOS", "CourseCraft"));
const executable = path.resolve(executableArg ?? candidates.find(existsSync) ?? candidates[0]);
if (!existsSync(executable)) throw new Error(`Missing packaged CourseCraft executable: ${executable}`);
const reportOutput = path.resolve(outputArg ?? `artifacts/zk682/raw/desktop-${process.platform}-${process.arch}.json`);

async function launch(phase, userDataPath) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, [
      `--zk682-desktop-persistence-user-data=${userDataPath}`,
      `--zk682-desktop-persistence-cert=${phase}`,
    ], {
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Packaged persistence ${phase} phase timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Packaged persistence ${phase} phase exited ${code}: ${stderr || stdout}`));
      else resolve({ stdout, stderr });
    });
  });
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith(marker));
  if (!line) throw new Error(`Packaged persistence ${phase} phase emitted no report: ${result.stderr || result.stdout}`);
  return JSON.parse(line.slice(marker.length));
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

const packageManifestPath = path.join(root, "desktop-dist", "coursecraft-desktop-manifest.json");
const packageManifestBytes = await readFile(packageManifestPath);
const packageManifest = JSON.parse(packageManifestBytes);
assert.equal(packageManifest.sourceCommit, expectedCommit, "desktop package manifest candidate commit mismatch");
assert.equal(packageManifest.platform, process.platform, "desktop package manifest platform mismatch");
assert.equal(packageManifest.architecture, process.arch, "desktop package manifest architecture mismatch");
const executableRelative = path.relative(root, executable).split(path.sep).join("/");
const packagePrefix = path.relative(path.join(root, "desktop-dist"), executable).split(path.sep)[0];
const packageArchive = packageManifest.files.find((file) => file.path.startsWith(`${packagePrefix}/`));
assert(packageArchive, `desktop package manifest has no archive for ${packagePrefix}`);
const userDataPath = await mkdtemp(path.join(os.tmpdir(), "coursecraft-zk682-persistence-"));
let completed = false;
try {
  const write = await launch("write", userDataPath);
  const verify = await launch("verify", userDataPath);
  assert.equal(path.resolve(write.userDataPath), path.resolve(userDataPath));
  assert.equal(path.resolve(verify.userDataPath), path.resolve(userDataPath));
  const storageKey = write.renderer.storageKey;
  const activePath = path.join(userDataPath, "saves", `${storageKey}.json`);
  const backupPath = `${activePath}.bak1`;
  const activeBefore = await readFile(activePath);
  const backupBefore = await readFile(backupPath);
  assert.equal(sha256(activeBefore), sha256(backupBefore));
  await writeFile(activePath, "{controlled-corrupt-active", { encoding: "utf8", mode: 0o600 });
  const recover = await launch("recover", userDataPath);
  const evidence = createZk682DesktopPersistenceReport({
    candidateCommit: expectedCommit,
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    command: "npm run desktop:package:persistence",
    packageArtifact: {
      path: `desktop-dist/${packageArchive.path}`,
      sha256: packageArchive.sha256,
      manifestPath: "desktop-dist/coursecraft-desktop-manifest.json",
      manifestSha256: sha256(packageManifestBytes),
    },
    executable: {
      path: executableRelative,
      sha256: await sha256File(executable),
    },
    userDataPath,
    filesystem: {
      activeRelativePath: path.relative(userDataPath, activePath),
      activeMode: (await stat(activePath)).mode & 0o777,
      validRevisionSha256: sha256(activeBefore),
      backupSha256: sha256(backupBefore),
      corruptedActiveSha256: sha256(await readFile(activePath)),
    },
    phases: { write, verify, recover },
  });
  await mkdir(path.dirname(reportOutput), { recursive: true });
  await writeFile(reportOutput, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, decision: evidence.summary.decision, canonicalHash: evidence.summary.canonicalHash, saveSchemaVersion: evidence.summary.saveSchemaVersion, relaunchVerified: evidence.summary.relaunchVerified, nativeRecoveryVerified: evidence.summary.nativeRecoveryVerified, candidateCommit: evidence.candidateCommit, platform: evidence.platform, output: reportOutput })}\n`);
  completed = true;
} finally {
  if (completed) await rm(userDataPath, { recursive: true, force: true });
  else process.stderr.write(`Retained failed certification user-data directory: ${userDataPath}\n`);
}
