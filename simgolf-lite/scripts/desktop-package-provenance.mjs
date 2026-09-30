const FULL_COMMIT = /^[0-9a-f]{40}$/;

export function resolveDesktopPackageProvenance({
  env,
  currentCommit,
  platform,
  architecture,
}) {
  if (!FULL_COMMIT.test(currentCommit ?? "")) {
    throw new Error("Desktop packaging requires a full 40-character checked-out commit SHA");
  }

  const declaredCommits = [
    ["ZK682_EXPECTED_COMMIT", env.ZK682_EXPECTED_COMMIT],
    ["COMMIT_SHA", env.COMMIT_SHA],
    ["GITHUB_SHA", env.GITHUB_SHA],
  ].filter(([, value]) => value !== undefined && value !== "");
  for (const [name, value] of declaredCommits) {
    if (!FULL_COMMIT.test(value)) {
      throw new Error(`${name} must be a full 40-character commit SHA`);
    }
    if (value !== currentCommit) {
      throw new Error(`${name} ${value} does not match checked-out HEAD ${currentCommit}`);
    }
  }

  const expectedPlatform = env.ZK682_EXPECTED_PLATFORM;
  if (expectedPlatform && expectedPlatform !== platform) {
    throw new Error(`Expected native platform ${expectedPlatform}, received ${platform}`);
  }
  const expectedArchitecture = env.ZK682_EXPECTED_ARCHITECTURE;
  if (expectedArchitecture && expectedArchitecture !== architecture) {
    throw new Error(`Expected native architecture ${expectedArchitecture}, received ${architecture}`);
  }

  return {
    sourceCommit: currentCommit,
    platform,
    architecture,
  };
}
