import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { collectDesktopPackageEvidence } from "./desktop-package-evidence.mjs";
import { assertDeliveryBudgets, DELIVERY_BUDGETS } from "./zk680-delivery-evidence.mjs";

const output = fileURLToPath(new URL("../desktop-dist/", import.meta.url));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageBaselines = {
  // ZK-680's retained baseline was recorded on the macOS desktop runner.
  darwin: 495_074_219,
  // Exact ZK-1106 merge base 665dd76 + packaging seams only (20a3705),
  // windows-2022 x64, Electron Builder 26.15.3, unsigned `--dir` output.
  win32: 572_377_001,
};
const packageHeadroomBytes = 4 * 1024 * 1024;

const evidence = await collectDesktopPackageEvidence(output);
const webDelivery = await assertDeliveryBudgets();
const packageBaseline = packageBaselines[process.platform];
if (!packageBaseline) throw new Error(`Desktop package budget has no ${process.platform} baseline.`);
const packageBudget = packageBaseline + packageHeadroomBytes;
if (evidence.packageBytes > packageBudget) {
  throw new Error(`desktopPackageBytes is ${evidence.packageBytes} B; ${process.platform} budget is ${packageBudget} B`);
}
if (evidence.asarBytes > DELIVERY_BUDGETS.desktopAsarBytes) {
  throw new Error(`desktopAsarBytes is ${evidence.asarBytes} B; budget is ${DELIVERY_BUDGETS.desktopAsarBytes} B`);
}
const desktopPackageCheck = {
  baseline: packageBaseline,
  value: evidence.packageBytes,
  deltaBytes: evidence.packageBytes - packageBaseline,
  budget: packageBudget,
  ok: true,
  error: null,
};
const desktopAsarCheck = {
  baseline: 206_569_606,
  value: evidence.asarBytes,
  deltaBytes: evidence.asarBytes - 206_569_606,
  budget: DELIVERY_BUDGETS.desktopAsarBytes,
  ok: true,
  error: null,
};
const delivery = {
  ...webDelivery,
  budgets: { ...webDelivery.budgets, desktopPackageBytes: packageBudget },
  checks: {
    ...webDelivery.checks,
    desktopPackageBytes: desktopPackageCheck,
    desktopAsarBytes: desktopAsarCheck,
  },
};
const run = promisify(execFile);
const benchmarkArgs = ["scripts/zk681-packaged-worker-benchmark.mjs"];
if (process.platform === "win32") benchmarkArgs.push(path.join(output, "win-unpacked", "CourseCraft.exe"));
await run(process.execPath, benchmarkArgs, {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  timeout: 150_000,
});

const manifest = {
  schemaVersion: 2,
  product: packageJson.name,
  version: packageJson.version,
  packageKind: "electron-directory",
  unsigned: true,
  signing: "deferred-to-release-gate",
  platform: process.platform,
  architecture: process.arch,
  sourceCommit: process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
  packageBytes: evidence.packageBytes,
  asarBytes: evidence.asarBytes,
  deliveryBudget: delivery,
  fileCount: evidence.fileCount,
  files: evidence.archives,
};
await writeFile(path.join(output, "coursecraft-desktop-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, package: evidence.archives[0].path, checksums: evidence.archives.length, packageBytes: evidence.packageBytes, asarBytes: evidence.asarBytes, deliveryBudget: delivery.ok, unsigned: true })}\n`);
