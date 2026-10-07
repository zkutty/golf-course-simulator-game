import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export function releasePreflight(platform, env) {
  if (!["darwin", "win32"].includes(platform)) throw new Error("Release packaging requires macOS or Windows");
  if (!/^[0-9a-f]{40}$/.test(env.VITE_COMMIT_SHA ?? "")) throw new Error("VITE_COMMIT_SHA must bind the exact committed candidate");
  if (env.GITHUB_SHA !== undefined && env.GITHUB_SHA !== env.VITE_COMMIT_SHA) throw new Error("Conflicting GITHUB_SHA candidate alias");
  const present = (names) => names.every((name) => typeof env[name] === "string" && env[name].trim().length > 0);
  const sign = platform === "darwin" ? present(["CSC_LINK", "CSC_KEY_PASSWORD"]) : present(["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]) || present(["CSC_LINK", "CSC_KEY_PASSWORD"]);
  if (!sign || env.CSC_IDENTITY_AUTO_DISCOVERY === "false") throw new Error("Required release signing credentials unavailable; unsigned smoke is not release evidence");
  if (platform === "darwin" && !(present(["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) || present(["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]))) throw new Error("Required notarization credentials unavailable");
  return { platform, candidateCommit: env.VITE_COMMIT_SHA, signingAuthorityVerified: false, credentialPresenceChecked: true, credentialValuesLogged: false };
}

export const GENERATED_AUDIT = "artifacts/m35/asset-audit.json";
export function releaseChildEnvironment(env, commit, auditBinding) {
  if (env.GITHUB_SHA !== undefined && env.GITHUB_SHA !== commit) throw new Error("Conflicting GITHUB_SHA candidate alias");
  return { ...env, GITHUB_SHA: commit, VITE_COMMIT_SHA: commit, ...(auditBinding ? { DESKTOP_RELEASE_AUDIT_SHA256: auditBinding.sha256 } : {}) };
}
function git(app, args) {
  const result = spawnSync("git", args, { cwd: app, encoding: "utf8", timeout: 10000 });
  if (result.error || result.status !== 0) throw new Error("Release source Git check failed");
  return result.stdout;
}
export function assertReleaseCandidate(app, commit, auditSha256) {
  if (git(app, ['rev-parse', 'HEAD']).trim() !== commit) throw new Error("Release candidate HEAD guard failed");
  if (auditSha256 !== undefined && (!/^[0-9a-f]{64}$/.test(auditSha256) || bindGeneratedAudit(app).sha256 !== auditSha256)) throw new Error('Generated audit binding mismatch');
  const status = git(app, ['status', '--porcelain', '-z']);
  if (!status) return;
  // Only the known tracked build-generated audit may differ, and only with an exact binding.
  const unstaged = git(app, ['diff', '--name-only', '-z', '--relative']).split('\0').filter(Boolean);
  const staged = git(app, ['diff', '--cached', '--name-only', '-z']);
  const untracked = git(app, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (status.split('\0').filter(Boolean).length !== 1 || staged || untracked || unstaged.length !== 1 || unstaged[0] !== GENERATED_AUDIT || !/^[0-9a-f]{64}$/.test(auditSha256 ?? '')) throw new Error("Release candidate cleanliness guard failed");
  const actual = bindGeneratedAudit(app);
  if (actual.sha256 !== auditSha256) throw new Error("Generated audit binding mismatch");
}
export function bindGeneratedAudit(app) {
  const file = path.join(app, GENERATED_AUDIT);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("Generated audit unavailable or over cap");
  const bytes = fs.readFileSync(file);
  JSON.parse(bytes.toString('utf8'));
  return { path: GENERATED_AUDIT, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, phase: 'POST_WEB_BUILD', attribution: 'CLI successful build:desktop output; not signing or runtime evidence' };
}

export function writeGeneratedAuditBinding(app, commit, binding) {
  const output = path.join(app, 'desktop-dist/release');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'web-build-source-binding.json'), JSON.stringify({ ...binding, candidateCommit: commit }) + '\n', { flag: 'wx' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.slice(2).includes("--check");
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Unknown release argument");
  const receipt = releasePreflight(process.platform, process.env);
  if (checkOnly) console.log(JSON.stringify(receipt));
  else {
    if (!process.env.npm_execpath) throw new Error("Run release packaging through npm");
    const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    // Require clean source and exact HEAD before creating any release output.
    assertReleaseCandidate(app, receipt.candidateCommit);
    const childEnv = releaseChildEnvironment(process.env, receipt.candidateCommit);
    delete childEnv.DESKTOP_RELEASE_AUDIT_SHA256;
    for (const [index, args] of [[process.env.npm_execpath, "run", "build:desktop"], [path.join(app, "node_modules/electron-builder/cli.js"), "--config", "desktop-release.config.mjs", process.platform === "darwin" ? "--mac" : "--win", "--publish", "never"]].entries()) {
      const result = spawnSync(process.execPath, args, { cwd: app, stdio: "inherit", env: childEnv });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
      if (index === 0) {
        const binding = bindGeneratedAudit(app);
        assertReleaseCandidate(app, receipt.candidateCommit, binding.sha256);
        childEnv.DESKTOP_RELEASE_AUDIT_SHA256 = binding.sha256;
        writeGeneratedAuditBinding(app, receipt.candidateCommit, binding);
      }
    }
  }
}
