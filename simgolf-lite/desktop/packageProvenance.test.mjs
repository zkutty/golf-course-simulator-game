import assert from "node:assert/strict";
import test from "node:test";
import { resolveDesktopPackageProvenance } from "../scripts/desktop-package-provenance.mjs";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";

test("binds desktop package provenance to the checked-out full commit and native runner", () => {
  assert.deepEqual(resolveDesktopPackageProvenance({
    env: {
      GITHUB_SHA: COMMIT,
      COMMIT_SHA: COMMIT,
      ZK682_EXPECTED_COMMIT: COMMIT,
      ZK682_EXPECTED_PLATFORM: "darwin",
      ZK682_EXPECTED_ARCHITECTURE: "arm64",
    },
    currentCommit: COMMIT,
    platform: "darwin",
    architecture: "arm64",
  }), {
    sourceCommit: COMMIT,
    platform: "darwin",
    architecture: "arm64",
  });
});

test("uses the checked-out commit for ordinary local packaging", () => {
  assert.equal(resolveDesktopPackageProvenance({
    env: {},
    currentCommit: COMMIT,
    platform: "win32",
    architecture: "x64",
  }).sourceCommit, COMMIT);
});

test("rejects abbreviated, stale, or non-native workflow provenance", () => {
  const input = { currentCommit: COMMIT, platform: "win32", architecture: "x64" };
  assert.throws(() => resolveDesktopPackageProvenance({
    ...input,
    env: { ZK682_EXPECTED_COMMIT: COMMIT.slice(0, 12) },
  }), /full 40-character/);
  assert.throws(() => resolveDesktopPackageProvenance({
    ...input,
    env: { COMMIT_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  }), /does not match checked-out HEAD/);
  assert.throws(() => resolveDesktopPackageProvenance({
    ...input,
    env: { ZK682_EXPECTED_PLATFORM: "darwin" },
  }), /Expected native platform/);
  assert.throws(() => resolveDesktopPackageProvenance({
    ...input,
    env: { ZK682_EXPECTED_ARCHITECTURE: "arm64" },
  }), /Expected native architecture/);
});
