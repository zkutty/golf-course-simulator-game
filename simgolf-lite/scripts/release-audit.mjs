import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { auditAudioAssets } from "./audit-audio-assets.mjs";

const root = new URL("../", import.meta.url);
const repo = new URL("../../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const config = JSON.parse(readFileSync(new URL("release/rc-config.json", root), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("dist/manifest.webmanifest", root), "utf8"));
const worker = readFileSync(new URL("dist/sw.js", root), "utf8");
const index = readFileSync(new URL("dist/index.html", root), "utf8");
const buildRevision = (process.env.GITHUB_SHA ?? process.env.VITE_COMMIT_SHA ?? "local").trim().slice(0, 12) || "local";

const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const status = git("status", "--porcelain").split("\n").filter(Boolean);
const releaseSourceChanges = status.filter((line) => !/simgolf-lite\/(artifacts|test-results|soak-dist|balance-dist|dist)\//.test(line));

const sourceFiles = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) sourceFiles.push(path);
  }
}
walk(new URL("src", root).pathname);
const secretPattern = /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)/;
const secretHits = sourceFiles.filter((path) => secretPattern.test(readFileSync(path, "utf8"))).map((path) => relative(root.pathname, path));
const consoleAllowlist = new Set(["src/ui/AppErrorBoundary.tsx", "src/utils/debugLog.ts", "src/utils/performance.ts", "src/render/atlas.ts", "src/ui/PixiStage.tsx"]);
const consoleHits = sourceFiles
  .filter((path) => /console\.(log|debug|info|warn|error)\s*\(/.test(readFileSync(path, "utf8")))
  .map((path) => relative(root.pathname, path))
  .filter((path) => !path.includes(".test."))
  .filter((path) => !consoleAllowlist.has(path) && !path.startsWith("src/game/testing/") && !path.startsWith("src/game/tuning/"));
let audioAudit;
try {
  audioAudit = auditAudioAssets();
} catch (error) {
  audioAudit = { ok: false, error: error instanceof Error ? error.message : String(error) };
}

const checks = {
  versionMatches: pkg.version === config.version,
  immutableVersionedCache: worker.includes(`coursecraft-${pkg.version}-${buildRevision}`),
  scopedPrecache: worker.includes(".map(scoped)") && worker.includes("self.registration.scope"),
  relativeManifest: manifest.id === "./" && manifest.start_url === "./" && manifest.scope === "./" && manifest.icons.every((icon) => !icon.src.startsWith("/")),
  deploymentBaseBuilt: config.deploymentBase === "/"
    ? /(?:src|href)="\/(?:assets|icons|manifest)/.test(index) && !index.includes("/golf-course-simulator-game/")
    : index.includes(config.deploymentBase),
  noSourceMaps: !readdirSync(new URL("dist/assets", root)).some((name) => name.endsWith(".map")),
  noSecretPatterns: secretHits.length === 0,
  noRoutineConsoleOutsideReviewedGuards: consoleHits.length === 0,
  shippedAudioMatchesSunoManifest: audioAudit.ok,
  playtestNoIndex: index.includes('name="robots" content="noindex, nofollow, noarchive"'),
  releaseSourceClean: releaseSourceChanges.length === 0,
};
const report = {
  ok: Object.values(checks).every(Boolean),
  version: pkg.version,
  commit: git("rev-parse", "HEAD"),
  branch: git("branch", "--show-current"),
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  checks,
  findings: { secretHits, consoleHits, releaseSourceChanges, audioAudit },
  acceptedWarnings: [
    "Vite reports the existing saveStore static/dynamic import overlap.",
    "The main minified application chunk is approximately 1.10 MB (approximately 343 KB gzip).",
    "ESLint reports eleven pre-existing react-hooks warnings and zero errors."
  ]
};
mkdirSync(new URL("artifacts/m28", root), { recursive: true });
writeFileSync(new URL("artifacts/m28/rc-audit.json", root), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
