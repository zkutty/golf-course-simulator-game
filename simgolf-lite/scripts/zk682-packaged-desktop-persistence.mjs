import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateZk682DesktopPersistenceSequence } from "./zk682-desktop-persistence-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const marker = "COURSECRAFT_DESKTOP_PERSISTENCE_CERT=";
const timeoutMs = 120_000;
const args = process.argv.slice(2);
let executableArg;
let outputArg;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--output") outputArg = args[++index];
  else if (!args[index].startsWith("--") && !executableArg) executableArg = args[index];
  else throw new Error(`Unknown argument: ${args[index]}`);
}
const candidates = process.platform === "win32"
  ? [path.join(root, "desktop-dist", "win-unpacked", "CourseCraft.exe")]
  : ["mac-arm64", "mac-universal", "mac"].map((directory) => path.join(root, "desktop-dist", directory, "CourseCraft.app", "Contents", "MacOS", "CourseCraft"));
const executable = path.resolve(executableArg ?? candidates.find(existsSync) ?? candidates[0]);
if (!existsSync(executable)) throw new Error(`Missing packaged CourseCraft executable: ${executable}`);

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
  const summary = validateZk682DesktopPersistenceSequence({ write, verify, recover, userDataPath });
  const evidence = {
    schemaVersion: 1,
    issue: "ZK-682",
    capturedAt: new Date().toISOString(),
    executable,
    userDataLifecycle: "temporary-and-removed-after-success",
    summary,
    filesystem: {
      activeRelativePath: path.relative(userDataPath, activePath),
      activeMode: (await stat(activePath)).mode & 0o777,
      validRevisionSha256: sha256(activeBefore),
      backupSha256: sha256(backupBefore),
      corruptedActiveSha256: sha256(await readFile(activePath)),
    },
    phases: { write, verify, recover },
  };
  evidence.evidenceSha256 = sha256(Buffer.from(JSON.stringify(evidence)));
  if (outputArg) {
    const output = path.resolve(outputArg);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, decision: summary.decision, canonicalHash: summary.canonicalHash, saveSchemaVersion: summary.saveSchemaVersion, relaunchVerified: summary.relaunchVerified, nativeRecoveryVerified: summary.nativeRecoveryVerified, evidenceSha256: evidence.evidenceSha256, output: outputArg ? path.resolve(outputArg) : null })}\n`);
  completed = true;
} finally {
  if (completed) await rm(userDataPath, { recursive: true, force: true });
  else process.stderr.write(`Retained failed certification user-data directory: ${userDataPath}\n`);
}
