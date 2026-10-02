import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CENSUS_BASELINE = "23ffa497e2e4271964e43eb73a2e50483ed1e12d";
export const MAX_CENSUS_RECORDS = 256;
export const MAX_CENSUS_BYTES = 256 * 1024;

// Self-contained so Playwright can serialize it into each original navigation.
export function installStartupCensus({ baseline, commit, maxRecords, maxBytes }) {
  const ids = new WeakMap();
  let nextId = 1;
  let stackCount = 0;
  let bytes = 0;
  const report = { version: 1, baseline, diagnosticCommit: commit, instrumented: true,
    identityOnly: true, complete: true, overflow: false, errors: 0, records: [],
    missingDependencies: ["terrainPatterns"], documentUrl: location.href };
  const identity = (value) => {
    if (value !== null && (typeof value === "object" || typeof value === "function")) {
      let id = ids.get(value);
      if (!id) { id = nextId++; ids.set(value, id); }
      return { objectId: id };
    }
    return { primitiveType: typeof value, value: typeof value === "number" && Object.is(value, -0) ? "-0" : String(value) };
  };
  const observer = {
    begin(kind, owner, inputs) {
      if (!report.complete) return undefined;
      try {
        if (report.records.length >= maxRecords) { report.complete = false; report.overflow = true; return undefined; }
        const entry = { kind, owner: identity(owner), inputs: {}, startedAtMs: performance.now(), endedAtMs: null };
        for (const [key, value] of Object.entries(inputs)) entry.inputs[key] = identity(value);
        if (stackCount < 8) { entry.caller = String(new Error().stack ?? "").slice(0, 4096); stackCount++; }
        // Reserve bounded space for the eventual ending timestamp, not just the initial record.
        const size = new TextEncoder().encode(JSON.stringify(entry)).length + 64;
        if (bytes + size > maxBytes - 4096) { report.complete = false; report.overflow = true; return undefined; }
        bytes += size;
        report.records.push(entry);
        return report.records.length - 1;
      } catch { report.errors++; report.complete = false; return undefined; }
    },
    end(token) {
      if (!Number.isInteger(token) || !report.records[token]) return;
      try { report.records[token].endedAtMs = performance.now(); }
      catch { report.errors++; report.complete = false; }
    },
  };
  globalThis.__ccStartupCensus = observer;
  globalThis.__ccStartupCensusRead = () => {
    delete globalThis.__ccStartupCensus;
    if (report.records.some((entry) => entry.endedAtMs === null)) report.complete = false;
    return report;
  };
}

async function physicalPath(path) {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(await physicalPath(parent), relative(parent, absolute));
  }
}
export async function validateCensusDirectory(directory, outputPath, canonicalRaw) {
  const target = await physicalPath(directory);
  for (const forbidden of [canonicalRaw, dirname(outputPath instanceof URL ? fileURLToPath(outputPath) : outputPath)]) {
    const root = await physicalPath(forbidden);
    const rel = relative(root, target);
    if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) throw new Error("Census output must be outside canonical raw and performance output directory");
  }
  return target;
}

export async function createStartupCensus({ page, directory, outputPath, canonicalRaw, commit = process.env.PERF_CENSUS_COMMIT ?? process.env.GITHUB_SHA ?? null, io = { mkdir, writeFile, rename, rm }, log = console.error }) {
  if (!directory) return null;
  let target;
  const errors = [];
  const phases = [];
  let finished = false;
  const failure = (error) => { errors.push(String(error?.message ?? error).slice(0, 1000)); try { log(`[startup-census] diagnostic error: ${errors.at(-1)}`); } catch { /* reporting cannot affect producer */ } };
  if (!commit) failure(new Error("Diagnostic commit provenance is unavailable; set PERF_CENSUS_COMMIT or GITHUB_SHA"));
  try {
    target = await validateCensusDirectory(directory, outputPath, canonicalRaw);
    await page.addInitScript(installStartupCensus, { baseline: CENSUS_BASELINE, commit,
      maxRecords: MAX_CENSUS_RECORDS / 2, maxBytes: MAX_CENSUS_BYTES / 2 - 4096 });
  } catch (error) { failure(error); }
  return {
    async collect(phase) {
      if (!target) return;
      try {
        const report = await page.evaluate(() => globalThis.__ccStartupCensusRead?.() ?? null);
        if (!report) throw new Error("Census observer was not installed");
        const serialized = JSON.stringify(report);
        if (Buffer.byteLength(serialized) > MAX_CENSUS_BYTES || report.records?.length > MAX_CENSUS_RECORDS) throw new Error("Census exceeds record/byte bound");
        phases.push({ phase, report });
      } catch (error) { failure(error); }
    },
    async finish() {
      if (finished) return;
      finished = true;
      if (!target) return;
      const report = { version: 1, baseline: CENSUS_BASELINE, diagnosticCommit: commit,
        instrumented: true, identityOnly: true, complete: errors.length === 0 && phases.length === 2 && phases.every((entry) => entry.report.complete), errors, phases };
      const part = resolve(target, `startup-census.json.${randomUUID()}.part`);
      try {
        const data = `${JSON.stringify(report, null, 2)}\n`;
        if (Buffer.byteLength(data) > MAX_CENSUS_BYTES) throw new Error("Combined census exceeds byte bound");
        await io.mkdir(target, { recursive: true });
        await io.writeFile(part, data, { flag: "wx" });
        await io.rename(part, resolve(target, "startup-census.json"));
      } catch (error) {
        failure(error);
        await io.rm(part, { force: true }).catch(() => {});
        // A previous run's complete receipt must never stand in for a failed publication.
        await io.rm(resolve(target, "startup-census.json"), { force: true }).catch(() => {});
      }
    },
  };
}
