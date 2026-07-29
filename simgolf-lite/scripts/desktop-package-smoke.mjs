import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(new URL("../desktop-dist/", import.meta.url).pathname);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const outputStat = await stat(output).catch(() => null);
if (!outputStat?.isDirectory()) throw new Error("desktop-dist is missing; build an Electron directory package first.");
const files = await walk(output);
const asar = files.filter((file) => path.basename(file) === "app.asar");
if (!asar.length) throw new Error("Packaged application does not contain resources/app.asar.");
const relative = (file) => path.relative(output, file).split(path.sep).join("/");
const checksums = [];
for (const file of asar.sort()) {
  const bytes = await readFile(file);
  checksums.push({ path: relative(file), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const hasRenderer = files.some((file) => relative(file).toLowerCase().includes("resources/app.asar"));
if (!hasRenderer) throw new Error("Packaged application is missing its renderer archive.");

const manifest = {
  schemaVersion: 1,
  product: packageJson.name,
  version: packageJson.version,
  packageKind: "electron-directory",
  unsigned: true,
  signing: "deferred-to-release-gate",
  platform: process.platform,
  architecture: process.arch,
  sourceCommit: process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
  files: checksums,
};
await writeFile(path.join(output, "coursecraft-desktop-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, package: relative(asar[0]), checksums: checksums.length, unsigned: true })}\n`);
