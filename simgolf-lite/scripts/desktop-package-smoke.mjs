import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { collectDesktopPackageEvidence } from "./desktop-package-evidence.mjs";
import { assertDeliveryBudgets } from "./zk680-delivery-evidence.mjs";

const output = fileURLToPath(new URL("../desktop-dist/", import.meta.url));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const evidence = await collectDesktopPackageEvidence(output);
const delivery = await assertDeliveryBudgets({ desktopDirectory: output });
const run = promisify(execFile);
await run(process.execPath, ["scripts/zk681-packaged-worker-benchmark.mjs"], {
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
