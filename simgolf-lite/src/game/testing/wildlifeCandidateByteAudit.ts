import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { auditWildlifeCandidate } from "../wildlife/candidateAudit";
import type { WildlifeAtlasCandidate, WildlifeCandidateProvenance } from "../wildlife/contracts";

/** Operational read bounds, not wildlife delivery budgets or approval gates. */
export const WILDLIFE_BYTE_AUDIT_LIMITS = { jsonBytes: 1024 * 1024, fileBytes: 512 * 1024 * 1024, chunkBytes: 64 * 1024 } as const;
export interface WildlifeCandidateFileBindings {
  readonly atlas: string;
  readonly provenance: string;
  readonly production: string;
  readonly raw: string;
  readonly references: readonly { readonly id: string; readonly path: string }[];
  readonly cleanup: readonly { readonly index: number; readonly path: string }[];
}
export interface WildlifeCandidateByteFile {
  readonly role: "production" | "raw" | "reference" | "cleanup";
  readonly id?: string;
  readonly index?: number;
  readonly path: string;
  readonly declaredSha256: string;
  readonly atlasSourceSha256?: string;
  readonly actualSha256: string | null;
  readonly bytes: number | null;
  readonly matches: boolean;
}
export interface WildlifeCandidateByteReport {
  readonly version: 1;
  readonly ok: boolean;
  readonly metadataErrors: readonly string[];
  readonly bindingErrors: readonly string[];
  readonly files: readonly WildlifeCandidateByteFile[];
  readonly productionEligible: false;
  readonly productionBlockers: readonly string[];
}
const localFile = (value: string): boolean => typeof value === "string" && value.trim().length > 0
  && !value.includes("\0") && !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith("//") && !value.startsWith("\\\\");
const label = (file: Pick<WildlifeCandidateByteFile, "role" | "id" | "index">): string =>
  file.role === "reference" ? `reference[${file.id}]` : file.role === "cleanup" ? `cleanup[${file.index}]` : file.role;
const readCode = (error: unknown): string => {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return code === "ENOENT" ? "FILE_NOT_FOUND" : code === "EACCES" || code === "EPERM" ? "FILE_NOT_READABLE" : "FILE_READ_FAILED";
};

async function readExplicitFile(path: string, maximum: number, onChunk: (bytes: Buffer) => void): Promise<number> {
  if (!localFile(path)) throw Object.assign(new Error(), { auditCode: "LOCAL_FILE_REQUIRED" });
  // Only the named regular file is read. Never follow links, enumerate directories,
  // open devices, or derive a byte location from provenance text/evidence links.
  if (!(await lstat(path)).isFile()) throw Object.assign(new Error(), { auditCode: "REGULAR_FILE_REQUIRED" });
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Object.assign(new Error(), { auditCode: "REGULAR_FILE_REQUIRED" });
    if (stat.size > maximum) throw Object.assign(new Error(), { auditCode: "FILE_SIZE_LIMIT" });
    let total = 0;
    const stream = handle.createReadStream({ highWaterMark: WILDLIFE_BYTE_AUDIT_LIMITS.chunkBytes, autoClose: false });
    try {
      for await (const chunk of stream) {
        const bytes = chunk as Buffer;
        total += bytes.length;
        if (total > maximum) throw Object.assign(new Error(), { auditCode: "FILE_SIZE_LIMIT" });
        onChunk(bytes);
      }
    } finally { stream.destroy(); }
    return total;
  } finally { await handle.close(); }
}
const errorCode = (error: unknown): string => typeof error === "object" && error !== null && "auditCode" in error
  ? String(error.auditCode) : readCode(error);

async function readMetadata(path: string, name: string, errors: string[]): Promise<unknown> {
  const chunks: Buffer[] = [];
  try {
    await readExplicitFile(path, WILDLIFE_BYTE_AUDIT_LIMITS.jsonBytes, bytes => chunks.push(bytes));
  } catch (error) { errors.push(`${name}: ${errorCode(error)}`); return undefined; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  } catch { errors.push(`${name}: INVALID_UTF8_JSON`); return undefined; }
}

function bindingShapeErrors(bindings: WildlifeCandidateFileBindings): string[] {
  const errors: string[] = [];
  for (const role of ["atlas", "provenance", "production", "raw"] as const) {
    if (!localFile(bindings[role])) errors.push(`${role}: LOCAL_FILE_REQUIRED`);
  }
  const ids = new Set<string>();
  for (const entry of bindings.references) {
    if (typeof entry.id !== "string" || !entry.id.trim()) errors.push("reference: NONEMPTY_ID_REQUIRED");
    else if (ids.has(entry.id)) errors.push(`reference[${entry.id}]: DUPLICATE_BINDING`);
    else ids.add(entry.id);
    if (!localFile(entry.path)) errors.push(`reference[${entry.id}]: LOCAL_FILE_REQUIRED`);
  }
  const indexes = new Set<number>();
  for (const entry of bindings.cleanup) {
    if (!Number.isSafeInteger(entry.index) || entry.index < 0) errors.push("cleanup: NONNEGATIVE_INTEGER_INDEX_REQUIRED");
    else if (indexes.has(entry.index)) errors.push(`cleanup[${entry.index}]: DUPLICATE_BINDING`);
    else indexes.add(entry.index);
    if (!localFile(entry.path)) errors.push(`cleanup[${entry.index}]: LOCAL_FILE_REQUIRED`);
  }
  return errors.sort();
}

/** Offline authoring evidence only. Matching bytes cannot authenticate claims. */
export async function auditWildlifeCandidateBytes(bindings: WildlifeCandidateFileBindings): Promise<WildlifeCandidateByteReport> {
  const metadataErrors: string[] = [];
  const bindingErrors = bindingShapeErrors(bindings);
  const files: WildlifeCandidateByteFile[] = [];
  let blockers: readonly string[] = auditWildlifeCandidate(undefined, undefined).productionBlockers.slice(0, 1);
  const result = (): WildlifeCandidateByteReport => ({
    version: 1, ok: metadataErrors.length === 0 && bindingErrors.length === 0,
    metadataErrors, bindingErrors, files, productionEligible: false,
    productionBlockers: [...blockers, "Local byte matching does not authenticate rights, reviewers, human adoption or approval, pixels, or intermediate parent relationships."],
  });
  // Known malformed/duplicate bindings stop before even metadata reads.
  if (bindingErrors.length) return result();
  const atlasInput = await readMetadata(bindings.atlas, "atlas", metadataErrors);
  const provenanceInput = await readMetadata(bindings.provenance, "provenance", metadataErrors);
  if (metadataErrors.length) return result();
  const metadata = auditWildlifeCandidate(atlasInput, provenanceInput);
  metadataErrors.push(...metadata.structuralErrors);
  blockers = metadata.productionBlockers;
  if (metadataErrors.length) return result();
  // The existing validator has now established the exact interfaces. It remains
  // the single authority for owned species and structural metadata semantics.
  const atlas = atlasInput as WildlifeAtlasCandidate;
  const provenance = provenanceInput as WildlifeCandidateProvenance;
  const references = new Map(provenance.referenceIdsAndHashes.map(entry => [entry.id, entry.sha256]));
  const boundIds = new Set(bindings.references.map(entry => entry.id));
  for (const id of [...references.keys()].sort()) if (!boundIds.has(id)) bindingErrors.push(`reference[${id}]: MISSING_BINDING`);
  for (const id of [...boundIds].sort()) if (!references.has(id)) bindingErrors.push(`reference[${id}]: UNDECLARED_BINDING`);
  const boundIndexes = new Set(bindings.cleanup.map(entry => entry.index));
  for (let index = 0; index < provenance.cleanupLineage.length; index++) if (!boundIndexes.has(index)) bindingErrors.push(`cleanup[${index}]: MISSING_BINDING`);
  for (const index of [...boundIndexes].sort((a, b) => a - b)) if (index >= provenance.cleanupLineage.length) bindingErrors.push(`cleanup[${index}]: UNDECLARED_BINDING`);
  // Reject the entire binding set before opening any candidate/reference/cleanup
  // bytes, including extra paths. Only the two explicit metadata files were read.
  if (bindingErrors.length) return result();
  const pending: Omit<WildlifeCandidateByteFile, "actualSha256" | "bytes" | "matches">[] = [
    { role: "production", path: bindings.production, declaredSha256: provenance.productionSha256, atlasSourceSha256: atlas.sourceSha256 },
    { role: "raw", path: bindings.raw, declaredSha256: provenance.rawSha256 },
    ...[...bindings.references].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(entry => ({ role: "reference" as const, ...entry, declaredSha256: references.get(entry.id)! })),
    ...[...bindings.cleanup].sort((a, b) => a.index - b.index).map(entry => ({ role: "cleanup" as const, ...entry, declaredSha256: provenance.cleanupLineage[entry.index].sha256 })),
  ];
  for (const file of pending) {
    const hash = createHash("sha256");
    try {
      const bytes = await readExplicitFile(file.path, WILDLIFE_BYTE_AUDIT_LIMITS.fileBytes, chunk => { hash.update(chunk); });
      const actualSha256 = hash.digest("hex");
      const matches = actualSha256 === file.declaredSha256.toLowerCase()
        && (!file.atlasSourceSha256 || actualSha256 === file.atlasSourceSha256.toLowerCase());
      files.push({ ...file, actualSha256, bytes, matches });
      if (!matches) bindingErrors.push(`${label(file)}: SHA256_MISMATCH`);
    } catch (error) {
      files.push({ ...file, actualSha256: null, bytes: null, matches: false });
      bindingErrors.push(`${label(file)}: ${errorCode(error)}`);
    }
  }
  return result();
}
