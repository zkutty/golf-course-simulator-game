import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { analyzeStartupAttribution, parseStartupAttribution } from "../src/utils/startupAttribution.mjs";

// The paired installed copy changes this import to ../src/utils/startupAttribution.mjs.
// Both spellings are registered literals in the materialization recipe.
export function publishStartupAttribution({ raw, outputPath, declaredRoot, original }, ops = fs) {
  if (typeof outputPath !== "string" || typeof declaredRoot !== "string") throw new Error("declared attribution root required");
  const root = dirname(resolve(outputPath));
  if (dirname(outputPath) !== root || declaredRoot !== root || ops.realpathSync(root) !== root) throw new Error("canonical attribution root");
  const before = ops.lstatSync(root);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("attribution directory");
  const journal = parseStartupAttribution(raw);
  const analysis = analyzeStartupAttribution(journal);
  if (Buffer.byteLength(JSON.stringify(analysis)) > 32768) throw new Error("attribution summary cap");
  const data = Buffer.from(JSON.stringify({ version: 1, journal, analysis,
    original: { coldStartupMs: original.coldStartupMs, fixtureLoadMs: original.fixtureLoadMs,
      rendererWorkMs: original.rendererWorkMs, gateValidation: original.gateValidation },
    sourceQualified: false, numericPass: false, releaseCleared: false }) + "\n");
  if (data.length > 65536) throw new Error("attribution artifact cap");
  const path = join(root, "startup-attribution.json");
  const flags = fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  const fd = ops.openSync(path, flags, 0o600);
  let primaryFailure, primaryFailurePresent = false, publication;
  try {
    const opened = ops.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1) throw new Error("attribution single-link file");
    let written = 0;
    while (written < data.length) {
      const n = ops.writeSync(fd, data, written, data.length - written, written);
      if (!Number.isSafeInteger(n) || n <= 0 || n > data.length - written) throw new Error("attribution short write");
      written += n;
    }
    ops.fsyncSync(fd);
    const sealed = ops.fstatSync(fd), named = ops.lstatSync(path), after = ops.lstatSync(root);
    if (!sealed.isFile() || sealed.nlink !== 1 || sealed.size !== data.length || named.isSymbolicLink() ||
        named.nlink !== 1 || named.dev !== sealed.dev || named.ino !== sealed.ino ||
        before.dev !== after.dev || before.ino !== after.ino || ops.realpathSync(root) !== root) throw new Error("attribution publication drift");
    const reread = Buffer.alloc(data.length);
    let read = 0;
    while (read < reread.length) {
      const n = ops.readSync(fd, reread, read, reread.length - read, read);
      if (n <= 0) throw new Error("attribution truncated readback");
      read += n;
    }
    if (!reread.equals(data)) throw new Error("attribution readback mismatch");
    publication = { path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"),
      diagnosticEligible: analysis.eligible, trusted: false };
  } catch (error) { primaryFailure = error; primaryFailurePresent = true; }
  try { ops.closeSync(fd); }
  catch (error) { if (!primaryFailurePresent) { primaryFailure = error; primaryFailurePresent = true; } }
  if (primaryFailurePresent) throw primaryFailure;
  return publication;
}
