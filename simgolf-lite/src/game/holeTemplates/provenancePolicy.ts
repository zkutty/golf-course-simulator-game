import type { HoleTemplateFidelityV1, HoleTemplateProvenanceV1, HoleTemplateValidationIssue } from "./types";

const SOURCE_KINDS = new Set(["player_photo", "course_web_page", "open_data", "licensed_provider", "manual"]);
const REDISTRIBUTION = new Set(["allowed", "attribution", "share_alike", "private_only", "unknown"]);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Shared boundary for package import, analysis adapters, and export. Never
 * interpret missing, contradictory, or malformed claims as a grant of rights. */
export function provenancePolicyIssues(value: unknown, path = "template.provenance"): HoleTemplateValidationIssue[] {
  const issues: HoleTemplateValidationIssue[] = [];
  const invalid = (key: string, message: string) => issues.push({ code: "invalid_value", path: `${path}.${key}`, message });
  if (!record(value)) return [{ code: "missing_value", path, message: "Provenance is required." }];
  const fields = ["sourceKind", "sourceLabel", "importedAt", "rightsAttested", "licenseName", "attribution", "redistribution", "sourceAssetRetained"];
  for (const key of Object.keys(value)) if (!fields.includes(key)) issues.push({ code: "unknown_field", path: `${path}.${key}`, message: "Unsupported provenance field; source pixels cannot be saved." });
  if (!SOURCE_KINDS.has(value.sourceKind as string)) invalid("sourceKind", "Unsupported source kind.");
  for (const key of ["sourceLabel", "licenseName", "attribution"]) {
    if (key !== "sourceLabel" && value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !(value[key] as string).trim() || (value[key] as string).length > 4096) invalid(key, "Use nonempty text of at most 4,096 characters.");
  }
  if (typeof value.importedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.importedAt) || Number.isNaN(Date.parse(value.importedAt)) || new Date(value.importedAt).toISOString() !== value.importedAt) invalid("importedAt", "Use a canonical ISO-8601 UTC timestamp.");
  if (typeof value.rightsAttested !== "boolean") invalid("rightsAttested", "Rights attestation must be true or false.");
  if (!REDISTRIBUTION.has(value.redistribution as string)) invalid("redistribution", "Unsupported redistribution policy.");
  if (value.sourceAssetRetained !== false) invalid("sourceAssetRetained", "Source pixels must be discarded before content is saved.");
  const shareable = value.redistribution === "allowed" || value.redistribution === "attribution" || value.redistribution === "share_alike";
  if (shareable && value.rightsAttested !== true) invalid("rightsAttested", "Redistribution requires an explicit rights attestation.");
  if (shareable && value.sourceKind === "player_photo") invalid("redistribution", "Player photos are private-only in this release.");
  if (shareable && value.sourceKind !== "manual" && (typeof value.licenseName !== "string" || !value.licenseName.trim())) invalid("licenseName", "External sources require an explicit license before redistribution.");
  if ((value.redistribution === "attribution" || value.redistribution === "share_alike") && (typeof value.attribution !== "string" || !value.attribution.trim())) invalid("attribution", "This redistribution policy requires retained attribution.");
  if (value.redistribution === "share_alike" && (typeof value.licenseName !== "string" || !value.licenseName.trim())) invalid("licenseName", "Share-alike content requires its license name.");
  return issues;
}

export function fidelityPolicyIssues(value: unknown, path = "template.fidelity"): HoleTemplateValidationIssue[] {
  if (value === undefined) return [];
  const invalid = (message: string): HoleTemplateValidationIssue[] => [{ code: "invalid_value", path, message }];
  if (!record(value)) return invalid("Expected fidelity evidence.");
  const fields = value.tier === "sketch" ? ["tier"] : ["tier", "controlPointsReviewed", "reviewedControlPointCount", "verifiedYardage"];
  if (Object.keys(value).some((key) => !fields.includes(key))) return invalid("Unsupported fidelity evidence field.");
  if (value.tier === "sketch") return [];
  if (value.tier !== "calibrated") return invalid("Surveyed and Licensed fidelity are reserved and cannot be produced in this release.");
  if (value.controlPointsReviewed !== true || !Number.isInteger(value.reviewedControlPointCount) || (value.reviewedControlPointCount as number) < 2 || !Number.isFinite(value.verifiedYardage) || (value.verifiedYardage as number) <= 0) return invalid("Calibrated requires at least two reviewed control points and positive verified yardage.");
  return [];
}

export function effectiveHoleTemplateFidelity(value?: HoleTemplateFidelityV1): HoleTemplateFidelityV1 {
  return value ?? { tier: "sketch" };
}

export type HoleTemplateExportIntent = "private_copy" | "redistribution";

export function holeTemplateUsePolicy(value: unknown, operation: "analysis" | HoleTemplateExportIntent): { allowed: boolean; issues: HoleTemplateValidationIssue[] } {
  const issues = provenancePolicyIssues(value);
  if (operation !== "analysis" && operation !== "private_copy" && operation !== "redistribution") issues.push({ code: "invalid_value", path: "operation", message: "Choose analysis, a private copy, or redistribution explicitly." });
  if (record(value) && (operation === "analysis" || operation === "redistribution") && value.rightsAttested !== true) issues.push({ code: "invalid_value", path: "template.provenance.rightsAttested", message: "Attest your right to use the source before analysis or redistribution." });
  if (record(value) && operation === "redistribution" && (value.redistribution === "private_only" || value.redistribution === "unknown")) issues.push({ code: "invalid_value", path: "template.provenance.redistribution", message: "Private-only and unknown-rights content can only be exported as a private copy." });
  return { allowed: issues.length === 0, issues };
}

export function requiredHoleTemplateAttribution(value: HoleTemplateProvenanceV1): string | undefined {
  return value.redistribution === "attribution" || value.redistribution === "share_alike" ? value.attribution : undefined;
}

/** Historical installed-hole credits remain readable, with no implied rights.
 * Modern metadata must carry a complete, internally consistent policy. */
export function placedHoleProvenanceIssues(value: unknown, path: string): HoleTemplateValidationIssue[] {
  if (!record(value)) return [{ code: "invalid_value", path, message: "Expected bounded placed-hole provenance." }];
  const fields = ["templateId", "sourceKind", "sourceLabel", "importedAt", "rightsAttested", "licenseName", "attribution", "redistribution", "sourceAssetRetained", "fidelity"];
  const issues: HoleTemplateValidationIssue[] = [];
  for (const key of Object.keys(value)) if (!fields.includes(key)) issues.push({ code: "unknown_field", path: `${path}.${key}`, message: "Source pixels and extra template data cannot be saved on a placed hole." });
  for (const key of ["templateId", "sourceLabel", "licenseName", "attribution"]) {
    if (key !== "templateId" && key !== "sourceLabel" && value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !(value[key] as string).trim() || (value[key] as string).length > 4096) issues.push({ code: "invalid_value", path: `${path}.${key}`, message: "Expected bounded nonempty provenance text." });
  }
  if (["sourceKind", "importedAt", "rightsAttested", "redistribution", "sourceAssetRetained"].some((key) => key in value)) {
    const { templateId: _templateId, fidelity: _fidelity, ...provenance } = value;
    issues.push(...provenancePolicyIssues(provenance, path));
  }
  issues.push(...fidelityPolicyIssues(value.fidelity, `${path}.fidelity`));
  return issues;
}
