import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { WILDLIFE_REVIEW_ROLES } from "../wildlife/contracts";
import type { WildlifeAtlasCandidate, WildlifeCandidateProvenance } from "../wildlife/contracts";
import { auditWildlifeCandidateBytes, WILDLIFE_BYTE_AUDIT_LIMITS, type WildlifeCandidateFileBindings } from "./wildlifeCandidateByteAudit";
import { runWildlifeByteAuditCli } from "./wildlifeCandidateByteAuditCli";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wildlife-byte-test-")); roots.push(root);
  const bytes = { production: Buffer.from("synthetic final bytes"), raw: Buffer.alloc(150_000, 29), referenceA: Buffer.from("synthetic reference A"), referenceZ: Buffer.from("synthetic reference Z"), cleanup: Buffer.from("synthetic intermediate bytes") };
  const paths = Object.fromEntries(Object.keys(bytes).map(key => [key, join(root, `${key}.bin`)])) as Record<keyof typeof bytes, string>;
  await Promise.all(Object.entries(bytes).map(([key, value]) => writeFile(paths[key as keyof typeof bytes], value)));
  const atlas: WildlifeAtlasCandidate = { owner: "parkland", speciesId: "woodland-deer", family: "A", cycle: { clip: "idle", frames: 2, fps: 2 }, canvas: [96, 112], anchor: "G", pivot: [0.5, 1], naturalSupport: null, directionRows: 5, sourceSha256: sha(bytes.production), gutterPixels: 2, maximumContactDriftPixels: 2 };
  const provenance: WildlifeCandidateProvenance = {
    source: "synthetic byte fixture only", licenseOrTerms: "synthetic declared terms", authorOrProvider: "synthetic provider", model: null, createdAt: "2026-10-01", prompt: null,
    referenceIdsAndHashes: [{ id: "ref-z", sha256: sha(bytes.referenceZ) }, { id: "ref-a", sha256: sha(bytes.referenceA) }], rawSha256: sha(bytes.raw), cleanupLineage: [{ step: "synthetic intermediate", sha256: sha(bytes.cleanup) }, { step: "synthetic final", sha256: sha(bytes.production) }], productionSha256: sha(bytes.production), redistribution: "permitted",
    reviews: Object.fromEntries(WILDLIFE_REVIEW_ROLES.map(role => [role, { reviewer: "synthetic reviewer", date: "2026-10-02", decision: "approved", assetSha256: sha(bytes.production), evidence: ["https://invalid.example/do-not-fetch"], notes: "" }])) as unknown as WildlifeCandidateProvenance["reviews"],
  };
  const bindings: WildlifeCandidateFileBindings = { atlas: join(root, "atlas.json"), provenance: join(root, "provenance.json"), production: paths.production, raw: paths.raw, references: [{ id: "ref-z", path: paths.referenceZ }, { id: "ref-a", path: paths.referenceA }], cleanup: [{ index: 1, path: paths.production }, { index: 0, path: paths.cleanup }] };
  const metadata = async (a: unknown = atlas, p: unknown = provenance) => { await writeFile(bindings.atlas, JSON.stringify(a)); await writeFile(bindings.provenance, JSON.stringify(p)); };
  await metadata();
  const args = ["--atlas", bindings.atlas, "--provenance", bindings.provenance, "--production", bindings.production, "--raw", bindings.raw, ...bindings.references.flatMap(entry => ["--reference", entry.id, entry.path]), ...bindings.cleanup.flatMap(entry => ["--cleanup", String(entry.index), entry.path])];
  vi.mocked(open).mockClear();
  return { root, bytes, paths, atlas, provenance, bindings, metadata, args };
}

describe("offline wildlife candidate byte audit", () => {
  it("hashes synthetic explicit bytes in deterministic order without production certification", async () => {
    const input = await fixture();
    const report = await auditWildlifeCandidateBytes(input.bindings);
    expect(report).toMatchObject({ version: 1, ok: true, metadataErrors: [], bindingErrors: [], productionEligible: false });
    expect(report.files.map(file => file.id ?? file.index ?? file.role)).toEqual(["production", "raw", "ref-a", "ref-z", 0, 1]);
    expect(report.files.every(file => file.matches && file.actualSha256 === file.declaredSha256)).toBe(true);
    expect(report.files.find(file => file.role === "raw")?.bytes).toBeGreaterThan(WILDLIFE_BYTE_AUDIT_LIMITS.chunkBytes * 2);
    expect(report.files[0].atlasSourceSha256).toBe(input.atlas.sourceSha256);
    expect(report.productionBlockers.join("\n")).toContain("does not authenticate rights");
    expect(await auditWildlifeCandidateBytes({ ...input.bindings, references: [...input.bindings.references].reverse(), cleanup: [...input.bindings.cleanup].reverse() })).toEqual(report);
  });

  it.each(["production", "raw", "referenceA", "referenceZ", "cleanup"] as const)("rejects one-byte mutation of %s", async (role) => {
    const input = await fixture(); const changed = Buffer.from(input.bytes[role]); changed[0] ^= 1;
    await writeFile(input.paths[role], changed);
    const report = await auditWildlifeCandidateBytes(input.bindings);
    expect(report.ok).toBe(false); expect(report.productionEligible).toBe(false);
    expect(report.bindingErrors.join("\n")).toContain("SHA256_MISMATCH");
    expect(report.files.some(file => file.path === input.paths[role] && !file.matches)).toBe(true);
  });

  it.each(["production", "raw", "referenceA", "cleanup"] as const)("rejects missing explicit %s file", async (role) => {
    const input = await fixture(); await rm(input.paths[role]);
    const report = await auditWildlifeCandidateBytes(input.bindings);
    expect(report.ok).toBe(false); expect(report.bindingErrors.join("\n")).toContain("FILE_NOT_FOUND");
  });

  it.each(["references-duplicate", "references-missing", "references-extra", "cleanup-duplicate", "cleanup-missing", "cleanup-extra"])("rejects %s before any asset reads", async (kind) => {
    const input = await fixture();
    const references = [...input.bindings.references]; const cleanup = [...input.bindings.cleanup];
    if (kind === "references-duplicate") references.push(references[0]);
    if (kind === "references-missing") references.pop();
    if (kind === "references-extra") references.push({ id: "undeclared", path: join(input.root, "never-open.bin") });
    if (kind === "cleanup-duplicate") cleanup.push(cleanup[0]);
    if (kind === "cleanup-missing") cleanup.pop();
    if (kind === "cleanup-extra") cleanup.push({ index: 2, path: join(input.root, "never-open.bin") });
    const report = await auditWildlifeCandidateBytes({ ...input.bindings, references, cleanup });
    expect(report.ok).toBe(false); expect(report.files).toEqual([]);
    expect(report.bindingErrors.join("\n")).toMatch(/DUPLICATE_BINDING|MISSING_BINDING|UNDECLARED_BINDING/);
    expect(vi.mocked(open).mock.calls.map(call => call[0])).toEqual(kind.includes("duplicate") ? [] : [input.bindings.atlas, input.bindings.provenance]);
  });

  it.each(["atlas-hash", "review-hash", "terminal-lineage", "reference-duplicate", "prohibited-clip"])("uses existing metadata authority for %s and skips asset reads", async (kind) => {
    const input = await fixture();
    const atlas = structuredClone(input.atlas); const provenance = structuredClone(input.provenance);
    const wrong = "0".repeat(64);
    if (kind === "atlas-hash") Object.assign(atlas, { sourceSha256: wrong });
    if (kind === "review-hash") Object.assign(provenance.reviews.visual, { assetSha256: wrong });
    if (kind === "terminal-lineage") Object.assign(provenance.cleanupLineage[1], { sha256: wrong });
    if (kind === "reference-duplicate") Object.assign(provenance, { referenceIdsAndHashes: [...provenance.referenceIdsAndHashes, provenance.referenceIdsAndHashes[0]] });
    if (kind === "prohibited-clip") Object.assign(atlas.cycle, { clip: "forage" });
    await input.metadata(atlas, provenance);
    const report = await auditWildlifeCandidateBytes(input.bindings);
    expect(report.ok).toBe(false); expect(report.metadataErrors.length).toBeGreaterThan(0); expect(report.files).toEqual([]);
    expect(vi.mocked(open).mock.calls.map(call => call[0])).toEqual([input.bindings.atlas, input.bindings.provenance]);
  });

  it("rejects changed reference/lineage bytes even when metadata remains structurally consistent", async () => {
    const input = await fixture();
    await input.metadata(input.atlas, { ...input.provenance, referenceIdsAndHashes: input.provenance.referenceIdsAndHashes.map(ref => ({ ...ref, sha256: "0".repeat(64) })), cleanupLineage: [{ ...input.provenance.cleanupLineage[0], sha256: "1".repeat(64) }, input.provenance.cleanupLineage[1]] });
    const report = await auditWildlifeCandidateBytes(input.bindings);
    expect(report.metadataErrors).toEqual([]); expect(report.bindingErrors).toEqual(["reference[ref-a]: SHA256_MISMATCH", "reference[ref-z]: SHA256_MISMATCH", "cleanup[0]: SHA256_MISMATCH"]);
  });

  it("accepts unchanged raw with empty lineage only when byte bindings agree", async () => {
    const input = await fixture();
    await input.metadata(input.atlas, { ...input.provenance, rawSha256: input.provenance.productionSha256, cleanupLineage: [], referenceIdsAndHashes: [] });
    const report = await auditWildlifeCandidateBytes({ ...input.bindings, raw: input.paths.production, references: [], cleanup: [] });
    expect(report.ok).toBe(true); expect(report.productionEligible).toBe(false); expect(report.files).toHaveLength(2);
  });

  it("retains private-only/rejected blockers while byte/structure validity can pass", async () => {
    const input = await fixture();
    const provenance = structuredClone(input.provenance); Object.assign(provenance, { redistribution: "private-only" }); Object.assign(provenance.reviews.ecology, { decision: "rejected" });
    await input.metadata(input.atlas, provenance);
    const report = await auditWildlifeCandidateBytes(input.bindings);
    expect(report.ok).toBe(true); expect(report.productionEligible).toBe(false);
    expect(report.productionBlockers.join("\n")).toMatch(/private-only/); expect(report.productionBlockers.join("\n")).toMatch(/ecology.*rejected/);
  });

  it.each(["invalid-json", "invalid-utf8", "too-large", "missing-json", "directory-json"])("fails bounded metadata reads: %s", async (kind) => {
    const input = await fixture(); let atlas = input.bindings.atlas;
    if (kind === "invalid-json") await writeFile(atlas, "{");
    if (kind === "invalid-utf8") await writeFile(atlas, Buffer.from([0xff, 0xfe]));
    if (kind === "too-large") await writeFile(atlas, Buffer.alloc(WILDLIFE_BYTE_AUDIT_LIMITS.jsonBytes + 1, 32));
    if (kind === "missing-json") await rm(atlas);
    if (kind === "directory-json") atlas = input.root;
    const report = await auditWildlifeCandidateBytes({ ...input.bindings, atlas });
    expect(report.ok).toBe(false); expect(report.metadataErrors.length).toBeGreaterThan(0); expect(report.files).toEqual([]);
  });

  it.each(["directory", "symlink", "too-large"])("requires bounded explicit regular asset files: %s", async (kind) => {
    const input = await fixture(); let production = input.bindings.production;
    if (kind === "directory") production = input.root;
    if (kind === "symlink") { production = join(input.root, "link.bin"); await symlink(input.paths.production, production); }
    if (kind === "too-large") { const handle = await open(production, "r+"); await handle.truncate(WILDLIFE_BYTE_AUDIT_LIMITS.fileBytes + 1); await handle.close(); }
    const report = await auditWildlifeCandidateBytes({ ...input.bindings, production });
    expect(report.ok).toBe(false); expect(report.bindingErrors.join("\n")).toMatch(/REGULAR_FILE_REQUIRED|FILE_SIZE_LIMIT/);
    expect(report.files[0]).toMatchObject({ actualSha256: null, bytes: null, matches: false });
  });

  it.each(["https://invalid.example/asset", "file:///tmp/asset", "//remote/asset", "\\\\remote\\asset"])("rejects nonlocal binding %s before file reads", async (production) => {
    const input = await fixture(); const report = await auditWildlifeCandidateBytes({ ...input.bindings, production });
    expect(report.bindingErrors).toContain("production: LOCAL_FILE_REQUIRED"); expect(open).not.toHaveBeenCalled();
  });

  it("fresh import and audit make zero fetch calls, including declared evidence URLs", async () => {
    const input = await fixture(); const fetch = vi.fn(() => { throw new Error("network forbidden"); }); vi.stubGlobal("fetch", fetch); vi.resetModules();
    const audit = await import("./wildlifeCandidateByteAudit");
    expect((await audit.auditWildlifeCandidateBytes(input.bindings)).ok).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });

  it("returns deterministic JSON and exit 0/1/2 for valid, failed and usage input", async () => {
    const input = await fixture(); let stdout = ""; const write = (text: string) => { stdout += text; };
    expect(await runWildlifeByteAuditCli(input.args, write)).toBe(0); const first = stdout; stdout = "";
    expect(await runWildlifeByteAuditCli(input.args, write)).toBe(0); expect(stdout).toBe(first);
    await writeFile(input.paths.raw, "mutated"); stdout = "";
    expect(await runWildlifeByteAuditCli(input.args, write)).toBe(1); expect(JSON.parse(stdout).ok).toBe(false);
    for (const args of [[], [...input.args, "--raw", input.paths.raw], [...input.args, "--cleanup", "-1", input.paths.raw], ["--directory", input.root]]) {
      stdout = ""; expect(await runWildlifeByteAuditCli(args, write)).toBe(2); expect(JSON.parse(stdout).usageErrors.length).toBeGreaterThan(0);
    }
    stdout = ""; expect(await runWildlifeByteAuditCli(["--help"], write)).toBe(0); expect(JSON.parse(stdout).productionEligible).toBe(false);
  });

  it("package command repeats exact machine JSON, exits correctly and performs no fetch", async () => {
    const input = await fixture(); const guard = join(input.root, "no-fetch.mjs"); await writeFile(guard, 'globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };\n');
    const run = (args: string[]) => spawnSync("npm", ["run", "--silent", "audit:wildlife-candidate", "--", ...args], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: `--import ${guard}` }, timeout: 30_000 });
    const first = run(input.args); const second = run(input.args);
    expect(first.status, first.stderr).toBe(0); expect(second.status, second.stderr).toBe(0); expect(second.stdout).toBe(first.stdout);
    expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, productionEligible: false });
    await writeFile(input.paths.production, "one-byte changed input"); const failed = run(input.args);
    expect(failed.status).toBe(1); expect(JSON.parse(failed.stdout).ok).toBe(false);
    const usage = run([]); expect(usage.status).toBe(2); expect(JSON.parse(usage.stdout).usageErrors.length).toBeGreaterThan(0);
  }, 60_000);

  it("authoring audit has no runtime imports from the actual browser entry graph", () => {
    const seen = new Set<string>();
    const visit = (path: string) => {
      if (seen.has(path)) return; seen.add(path);
      const source = readFileSync(path, "utf8");
      const imports = [...source.matchAll(/\b(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/g), ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map(match => match[1]);
      for (const specifier of imports) {
        const base = specifier.startsWith(".") ? resolve(dirname(path), specifier) : specifier.startsWith("@/") ? resolve("src", specifier.slice(2)) : null;
        if (!base) continue;
        const target = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(candidate => /\.tsx?$/.test(candidate) && existsSync(candidate));
        if (target) visit(target);
      }
    };
    visit(resolve("src/main.tsx"));
    expect(seen.size).toBeGreaterThan(50);
    expect([...seen].filter(path => /wildlifeCandidateByteAudit|wildlife\/candidateAudit/.test(path))).toEqual([]);
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts.build).not.toContain("wildlife-candidate");
  });
});
