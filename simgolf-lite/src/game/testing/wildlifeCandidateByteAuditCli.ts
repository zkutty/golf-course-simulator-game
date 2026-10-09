import { auditWildlifeCandidateBytes, type WildlifeCandidateFileBindings } from "./wildlifeCandidateByteAudit";

const usage = "--atlas FILE --provenance FILE --production FILE --raw FILE [--reference ID FILE]... [--cleanup INDEX FILE]...";
type Parsed = { bindings: WildlifeCandidateFileBindings } | { help: true } | { errors: readonly string[] };
export function parseWildlifeByteAuditArgs(args: readonly string[]): Parsed {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const errors: string[] = [];
  const singles: Partial<Record<"atlas" | "provenance" | "production" | "raw", string>> = {};
  const references: { id: string; path: string }[] = [];
  const cleanup: { index: number; path: string }[] = [];
  for (let cursor = 0; cursor < args.length;) {
    const flag = args[cursor++];
    if (["--atlas", "--provenance", "--production", "--raw"].includes(flag)) {
      const key = flag.slice(2) as keyof typeof singles;
      const value = args[cursor++];
      if (!value || value.startsWith("--")) { errors.push(`${flag}: FILE_REQUIRED`); break; }
      if (Object.hasOwn(singles, key)) errors.push(`${flag}: DUPLICATE_ARGUMENT`);
      else singles[key] = value;
    } else if (flag === "--reference" || flag === "--cleanup") {
      const key = args[cursor++];
      const path = args[cursor++];
      if (!key || !path || key.startsWith("--") || path.startsWith("--")) { errors.push(`${flag}: KEY_AND_FILE_REQUIRED`); break; }
      if (flag === "--reference") references.push({ id: key, path });
      else if (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(Number(key))) errors.push("--cleanup: NONNEGATIVE_INTEGER_INDEX_REQUIRED");
      else cleanup.push({ index: Number(key), path });
    } else { errors.push(`${flag}: UNKNOWN_ARGUMENT`); break; }
  }
  for (const key of ["atlas", "provenance", "production", "raw"] as const) if (!Object.hasOwn(singles, key)) errors.push(`--${key}: REQUIRED_ARGUMENT`);
  if (errors.length) return { errors };
  return { bindings: { atlas: singles.atlas!, provenance: singles.provenance!, production: singles.production!, raw: singles.raw!, references, cleanup } };
}

export async function runWildlifeByteAuditCli(args: readonly string[], write: (text: string) => void = text => { process.stdout.write(text); }): Promise<number> {
  const parsed = parseWildlifeByteAuditArgs(args);
  if ("help" in parsed) {
    write(`${JSON.stringify({ version: 1, usage, limits: { jsonBytes: 1048576, fileBytes: 536870912 }, productionEligible: false }, null, 2)}\n`);
    return 0;
  }
  if ("errors" in parsed) {
    write(`${JSON.stringify({ version: 1, ok: false, usageErrors: parsed.errors, usage, productionEligible: false }, null, 2)}\n`);
    return 2;
  }
  const report = await auditWildlifeCandidateBytes(parsed.bindings);
  write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 1;
}
