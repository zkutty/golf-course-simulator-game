import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditNativePackage } from "./scripts/desktop-native-architecture.mjs";
import { releasePreflight, assertReleaseCandidate } from "./scripts/desktop-release.mjs";
import { createHash } from "node:crypto";

const directory = path.dirname(fileURLToPath(import.meta.url));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
const base = packageMetadata.build;
function guard(platform) {
  const receipt = releasePreflight(platform, process.env);
  const auditSha256 = process.env.DESKTOP_RELEASE_AUDIT_SHA256;
  if (auditSha256 !== undefined) {
    const file = path.join(directory, 'desktop-dist/release/web-build-source-binding.json');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 2048) throw new Error('Build source binding unavailable or over cap');
    const binding = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (binding.candidateCommit !== receipt.candidateCommit || binding.sha256 !== auditSha256 || binding.path !== 'artifacts/m35/asset-audit.json' || binding.phase !== 'POST_WEB_BUILD') throw new Error('Build source binding mismatch');
  }
  assertReleaseCandidate(directory, receipt.candidateCommit, auditSha256);
  return receipt;
}

export default {
  ...base,
  directories: { ...base.directories, output: "desktop-dist/release" },
  forceCodeSigning: true,
  asarUnpack: ["**/*.node", "**/*.dylib", "**/*.dll", "**/*.exe", "**/*.so"],
  mac: {
    ...base.mac,
    target: [{ target: "dmg", arch: ["universal"] }, { target: "zip", arch: ["universal"] }],
    mergeASARs: true,
    hardenedRuntime: true,
    notarize: true,
  },
  win: { ...base.win, target: [{ target: "nsis", arch: ["x64"] }] },
  async beforeBuild(context) {
    guard(context.platform.nodeName);
    return true;
  },
  async beforePack(context) {
    guard(context.electronPlatformName);
  },
  async afterPack(context) {
    const { electronPlatformName: platform, arch } = context;
    const architectures = new Map([[1, ["x64"]], [3, ["arm64"]], [4, ["arm64", "x64"]]]).get(arch);
    if (!architectures || (platform === "win32" && arch !== 1)) throw new Error("Unsupported release build architecture");
    const name = context.packager.appInfo.productFilename;
    const root = platform === "darwin" ? path.join(context.appOutDir, `${name}.app`) : context.appOutDir;
    const requiredPaths = platform === "darwin" ? [
      `Contents/MacOS/${name}`,
      "Contents/Frameworks/Electron Framework.framework/Electron Framework",
      ...["", " (GPU)", " (Renderer)", " (Plugin)"].map((suffix) => `Contents/Frameworks/${name} Helper${suffix}.app/Contents/MacOS/${name} Helper${suffix}`),
    ] : [`${name}.exe`, "chrome_elf.dll"];
    const binding = guard(platform);
    const report = {
      ...auditNativePackage(root, { platform, requiredArchitectures: architectures, requiredPaths }),
      candidateCommit: binding.candidateCommit,
      generatedAuditSha256: process.env.DESKTOP_RELEASE_AUDIT_SHA256 ?? null,
      packageVersion: packageMetadata.version,
      sourceSha256: Object.fromEntries(["package.json", "desktop-release.config.mjs", "scripts/desktop-native-architecture.mjs", "scripts/desktop-release.mjs"].map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex")])),
    };
    const encoded = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw new Error("Architecture receipt cap exceeded");
    fs.writeFileSync(path.join(context.outDir, `native-architecture-${platform}-${arch}.json`), encoded, { flag: "wx" });
  },
};
