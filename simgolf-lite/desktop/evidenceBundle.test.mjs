import assert from "node:assert/strict";
import test from "node:test";
import { createZk682DesktopEvidenceBundlePaths } from "../scripts/zk682-desktop-evidence-bundle.mjs";

test("creates co-locatable platform-qualified native evidence paths", () => {
  assert.deepEqual(createZk682DesktopEvidenceBundlePaths({
    platform: "darwin",
    architecture: "arm64",
    packageArchivePath: "mac-arm64/CourseCraft.app/Contents/Resources/app.asar",
    executablePath: "desktop-dist/mac-arm64/CourseCraft.app/Contents/MacOS/CourseCraft",
  }), {
    bundleRoot: "artifacts/zk682/raw/desktop-darwin-arm64",
    report: "artifacts/zk682/raw/desktop-darwin-arm64/persistence.json",
    manifest: "artifacts/zk682/raw/desktop-darwin-arm64/package-manifest.json",
    packageArchive: "artifacts/zk682/raw/desktop-darwin-arm64/package/mac-arm64/CourseCraft.app/Contents/Resources/app.asar",
    executable: "artifacts/zk682/raw/desktop-darwin-arm64/executable/CourseCraft",
  });
  assert.equal(createZk682DesktopEvidenceBundlePaths({
    platform: "win32",
    architecture: "x64",
    packageArchivePath: "win-unpacked/resources/app.asar",
    executablePath: "desktop-dist\\win-unpacked\\CourseCraft.exe",
  }).executable, "artifacts/zk682/raw/desktop-win32-x64/executable/CourseCraft.exe");
});

test("rejects unsupported or escaping evidence bundle inputs", () => {
  const valid = {
    platform: "win32",
    architecture: "x64",
    packageArchivePath: "win-unpacked/resources/app.asar",
    executablePath: "desktop-dist/win-unpacked/CourseCraft.exe",
  };
  assert.throws(() => createZk682DesktopEvidenceBundlePaths({ ...valid, platform: "linux" }));
  assert.throws(() => createZk682DesktopEvidenceBundlePaths({ ...valid, architecture: "ia32" }));
  assert.throws(() => createZk682DesktopEvidenceBundlePaths({ ...valid, packageArchivePath: "../app.asar" }));
  assert.throws(() => createZk682DesktopEvidenceBundlePaths({ ...valid, executablePath: "C:\\CourseCraft.exe" }));
});
