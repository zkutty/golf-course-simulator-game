import path from "node:path";

function safeRelativePath(value) {
  const normalized = typeof value === "string" ? value.replaceAll("\\", "/") : "";
  return normalized.length > 0
    && !path.posix.isAbsolute(normalized)
    && !/^[A-Za-z]:\//.test(normalized)
    && !value.split(/[\\/]/).includes("..")
    && !value.includes("\0");
}

export function createZk682DesktopEvidenceBundlePaths({
  platform,
  architecture,
  packageArchivePath,
  executablePath,
}) {
  if (!/^(darwin|win32)$/.test(platform ?? "")) throw new Error("Unsupported desktop evidence platform");
  if (!/^(arm64|x64)$/.test(architecture ?? "")) throw new Error("Unsupported desktop evidence architecture");
  if (!safeRelativePath(packageArchivePath)) throw new Error("Unsafe desktop package archive path");
  if (!safeRelativePath(executablePath)) throw new Error("Unsafe desktop executable path");

  const bundleRoot = `artifacts/zk682/raw/desktop-${platform}-${architecture}`;
  const normalizedArchive = packageArchivePath.replaceAll("\\", "/");
  const executableName = path.posix.basename(executablePath.replaceAll("\\", "/"));
  return {
    bundleRoot,
    report: `${bundleRoot}/persistence.json`,
    manifest: `${bundleRoot}/package-manifest.json`,
    packageArchive: `${bundleRoot}/package/${normalizedArchive}`,
    executable: `${bundleRoot}/executable/${executableName}`,
  };
}
