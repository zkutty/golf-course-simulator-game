import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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

/**
 * Produces deterministic evidence from an Electron --dir output. It does not
 * depend on the host's `du` formatting or on a running desktop application.
 */
export async function collectDesktopPackageEvidence(outputDirectory) {
  const outputStat = await stat(outputDirectory).catch(() => null);
  if (!outputStat?.isDirectory()) {
    throw new Error("desktop-dist is missing; build an Electron directory package first.");
  }
  const files = await walk(outputDirectory);
  const relative = (file) => path.relative(outputDirectory, file).split(path.sep).join("/");
  const records = await Promise.all(files.map(async (file) => ({
    absolute: file,
    path: relative(file),
    bytes: (await stat(file)).size,
  })));
  const asar = records.filter((file) => path.basename(file.path) === "app.asar").sort((a, b) => a.path.localeCompare(b.path));
  if (!asar.length) throw new Error("Packaged application does not contain resources/app.asar.");

  const archives = [];
  for (const archive of asar) {
    const bytes = await readFile(archive.absolute);
    archives.push({
      path: archive.path,
      bytes: archive.bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return {
    fileCount: records.length,
    packageBytes: records.reduce((total, file) => total + file.bytes, 0),
    asarBytes: archives.reduce((total, archive) => total + archive.bytes, 0),
    archives,
  };
}
