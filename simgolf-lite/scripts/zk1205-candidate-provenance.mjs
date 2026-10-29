import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 1_500;
const GIT_MAX_BUFFER_BYTES = 256 * 1024;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Normalize independently observed checkout and CI identities.
 * @param {{ checkoutCommit?: unknown, dirtyEntries?: string[] | null, ciCommit?: unknown, ciSource?: string | null }} input
 */
export function normalizeZk1205CandidateProvenance(input = {}) {
  const checkoutCommit = typeof input.checkoutCommit === "string" && FULL_SHA.test(input.checkoutCommit)
    ? input.checkoutCommit
    : null;
  const dirtyKnown = Array.isArray(input.dirtyEntries) && input.dirtyEntries.every((entry) => typeof entry === "string");
  const dirtyEntries = dirtyKnown ? [...input.dirtyEntries] : null;
  const ciCommit = typeof input.ciCommit === "string" && FULL_SHA.test(input.ciCommit)
    ? input.ciCommit
    : null;
  const ciState = input.ciCommit == null || input.ciCommit === ""
    ? "missing"
    : ciCommit ? "available" : "invalid";
  const ciSource = typeof input.ciSource === "string" && input.ciSource.length > 0 ? input.ciSource : null;
  const relationship = checkoutCommit && ciCommit
    ? checkoutCommit === ciCommit ? "match" : "conflict"
    : "unknown";

  return {
    checkout: {
      commit: checkoutCommit,
      worktree: dirtyKnown ? (dirtyEntries.length === 0 ? "clean" : "dirty") : "unknown",
      dirtyEntries,
    },
    ci: { source: ciSource, commit: ciCommit, state: ciState },
    relationship,
  };
}

function safeRead(runGit, args) {
  try {
    const output = runGit(args);
    return typeof output === "string" ? output : null;
  } catch {
    return null;
  }
}

/**
 * Assemble provenance using an injected read-only Git runner and environment.
 * Tests inject deterministic results; this function itself performs no Git/network I/O.
 * @param {(args: string[]) => string | null} runGit
 * @param {Record<string, string | undefined>} env
 */
export function collectZk1205CandidateProvenance(runGit, env = {}) {
  const checkoutOutput = safeRead(runGit, ["rev-parse", "--verify", "HEAD"]);
  const statusOutput = safeRead(runGit, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const dirtyEntries = statusOutput === null
    ? null
    : statusOutput.split(/\r?\n/).filter(Boolean);
  const ciCommit = env.GITHUB_SHA ?? null;
  return normalizeZk1205CandidateProvenance({
    checkoutCommit: checkoutOutput?.trim() ?? null,
    dirtyEntries,
    ciCommit,
    ciSource: ciCommit ? "GITHUB_SHA" : null,
  });
}

function boundedGitRead(args) {
  try {
    const result = spawnSync("git", args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
    });
    if (result.status !== 0 || result.error || typeof result.stdout !== "string") return null;
    return result.stdout;
  } catch {
    return null;
  }
}

/** Capture the checkout and CI labels separately; failures remain explicit unknowns. */
export function captureZk1205CandidateProvenance({ runGit = boundedGitRead, env = process.env } = {}) {
  return collectZk1205CandidateProvenance(runGit, env);
}
