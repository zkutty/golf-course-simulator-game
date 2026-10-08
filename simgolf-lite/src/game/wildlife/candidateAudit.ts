import {
  WILDLIFE_ANIMATION_FAMILIES, WILDLIFE_BIOMES, WILDLIFE_REVIEW_ROLES,
  WILDLIFE_ROADRUNNER_TRAVEL, WILDLIFE_SCALE_CANVASES,
} from "./contracts";
import type { WildlifeBiome, WildlifeFamily, WildlifeScale } from "./contracts";
import { WILDLIFE_REGISTRY } from "./registry";

export interface WildlifeCandidateAudit {
  readonly structuralErrors: readonly string[];
  /** Metadata is untrusted evidence; this audit has no authoritative external proof boundary. */
  readonly productionEligible: false;
  readonly productionBlockers: readonly string[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const sameHash = (left: unknown, right: unknown): boolean => hash(left) && hash(right) && left.toLowerCase() === right.toLowerCase();
const pair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2
  && Array.from(value).every(item => typeof item === "number" && Number.isFinite(item));

/** Calendar-valid ISO date or UTC timestamp; never depends on the current clock. */
function date(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = new Date(parsed).toISOString();
  if (normalized.slice(0, 10) !== value.slice(0, 10)) return null;
  if (value.length > 10 && normalized.slice(0, 19) !== value.slice(0, 19)) return null;
  return parsed;
}

function precedes(reviewedAt: unknown, createdAt: unknown): boolean {
  const reviewed = date(reviewedAt);
  const created = date(createdAt);
  if (reviewed === null || created === null || typeof reviewedAt !== "string" || typeof createdAt !== "string") return false;
  // A date-only declaration cannot establish ordering within its calendar day.
  return reviewedAt.length === 10 || createdAt.length === 10
    ? reviewedAt.slice(0, 10) < createdAt.slice(0, 10)
    : reviewed < created;
}

function shape(value: unknown, fields: readonly string[], path: string, errors: string[]): Record<string, unknown> | null {
  if (!record(value)) { errors.push(`${path}: object is required`); return null; }
  for (const field of fields) if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: own field is required`);
  for (const field of Object.keys(value)) if (!fields.includes(field)) errors.push(`${path}.${field}: unsupported field`);
  // Do not treat inherited required values as imported evidence.
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}

/**
 * Pure authoring audit of WildlifeAtlasCandidate and WildlifeCandidateProvenance.
 * Does not fetch/hash bytes, inspect pixels, authenticate reviewers, or activate content.
 */
export function auditWildlifeCandidate(atlas: unknown, provenance: unknown): WildlifeCandidateAudit {
  const errors: string[] = [];
  const blockers = ["Authoritative external rights, exact-byte provenance and human adoption/review proof are required; metadata alone cannot certify production."];
  const candidate = shape(atlas, ["owner", "speciesId", "family", "cycle", "canvas", "anchor", "pivot", "naturalSupport", "directionRows", "sourceSha256", "gutterPixels", "maximumContactDriftPixels"], "candidate", errors);
  if (candidate) {
    const owner = WILDLIFE_BIOMES.includes(candidate.owner as WildlifeBiome) ? candidate.owner as WildlifeBiome : null;
    if (!owner) errors.push("candidate.owner: closed wildlife biome is required");
    const species = owner ? WILDLIFE_REGISTRY[owner].species.find(item => item.id === candidate.speciesId) : undefined;
    if (!species) errors.push("candidate.speciesId: species must belong to the declared owner");
    if (!species || candidate.family !== species.family) errors.push("candidate.family: family must match the owned species");
    const cycle = shape(candidate.cycle, ["clip", "frames", "fps"], "candidate.cycle", errors);
    if (cycle && species) {
      const expected = cycle.clip === "remote-travel" && owner === "desert" && species.id === "greater-roadrunners"
        ? WILDLIFE_ROADRUNNER_TRAVEL
        : WILDLIFE_ANIMATION_FAMILIES[species.family as WildlifeFamily].find(item => item.clip === cycle.clip);
      if (!expected || !species.clips.includes(cycle.clip as never)) errors.push("candidate.cycle.clip: prohibited or incompatible species/family clip");
      else if (cycle.frames !== expected.frames || cycle.fps !== expected.fps) errors.push("candidate.cycle: frames/fps must match the closed family target");
    }
    if (!species || !species.anchors.includes(candidate.anchor as never)) errors.push("candidate.anchor: attachment must match the owned species");
    if (cycle) {
      const clip = cycle.clip;
      if ((clip === "quiet-flight") !== (candidate.anchor === "F")) errors.push("candidate.anchor: quiet flight requires F and only quiet flight uses F");
      if ((clip === "perch" || clip === "branch-walk") && candidate.anchor !== "P") errors.push("candidate.anchor: perch/branch walk requires P");
      if (clip === "remote-travel" && candidate.anchor !== "G") errors.push("candidate.anchor: remote travel requires G");
      if (candidate.anchor === "W" && !(candidate.family === "D" && (clip === "still" || clip === "glide"))) errors.push("candidate.anchor: W is reserved for waterbird still/glide");
    }
    const scales: readonly WildlifeScale[] = candidate.anchor === "F" ? ["Flight"] : species?.scales.filter(scale => scale !== "Flight") ?? [];
    if (!pair(candidate.canvas) || !scales.some(scale => WILDLIFE_SCALE_CANVASES[scale].every((dimension, index) => dimension === (candidate.canvas as number[])[index]))) errors.push("candidate.canvas: exact source canvas must match the species scale or Flight cycle");
    if (!pair(candidate.pivot) || candidate.pivot.some(value => value < 0 || value > 1)) errors.push("candidate.pivot: normalized finite canvas coordinates in [0,1] are required");
    else if ((candidate.anchor === "G" || candidate.anchor === "W") && (candidate.pivot[0] !== 0.5 || candidate.pivot[1] !== 1)) errors.push("candidate.pivot: G/W contact is normalized bottom-center [0.5,1]");
    else if (candidate.anchor === "F" && candidate.pivot.some(value => value === 0 || value === 1)) errors.push("candidate.pivot: F body pivot must be inside the canvas");
    if (candidate.anchor === "P") {
      if (!text(candidate.naturalSupport)) errors.push("candidate.naturalSupport: P requires a declared natural support point");
    } else if (candidate.naturalSupport !== null) errors.push("candidate.naturalSupport: only P declares natural support");
    if (!Number.isInteger(candidate.directionRows) || (candidate.directionRows as number) < 5) errors.push("candidate.directionRows: at least five authored direction rows are required");
    if (!hash(candidate.sourceSha256)) errors.push("candidate.sourceSha256: SHA-256 is required");
    if (candidate.gutterPixels !== 2) errors.push("candidate.gutterPixels: two source pixels are required");
    if (candidate.maximumContactDriftPixels !== 2) errors.push("candidate.maximumContactDriftPixels: declared ceiling must be two source pixels");
  }
  const evidence = shape(provenance, ["source", "licenseOrTerms", "authorOrProvider", "model", "createdAt", "prompt", "referenceIdsAndHashes", "rawSha256", "cleanupLineage", "productionSha256", "redistribution", "reviews"], "provenance", errors);
  if (evidence) {
    for (const field of ["source", "licenseOrTerms", "authorOrProvider"]) if (!text(evidence[field])) errors.push(`provenance.${field}: nonempty evidence is required`);
    for (const field of ["model", "prompt"]) if (evidence[field] !== null && !text(evidence[field])) errors.push(`provenance.${field}: nonempty text or explicit null is required`);
    if (text(evidence.model) && !text(evidence.prompt)) errors.push("provenance.prompt: generated candidates require their full declared prompt");
    const created = date(evidence.createdAt);
    if (created === null) errors.push("provenance.createdAt: calendar-valid ISO date or UTC timestamp is required");
    for (const field of ["rawSha256", "productionSha256"]) if (!hash(evidence[field])) errors.push(`provenance.${field}: SHA-256 is required`);
    if (candidate && !sameHash(candidate.sourceSha256, evidence.productionSha256)) errors.push("candidate.sourceSha256: must match provenance.productionSha256");
    if (!Array.isArray(evidence.referenceIdsAndHashes)) errors.push("provenance.referenceIdsAndHashes: array is required");
    else {
      const ids = new Set<string>();
      Array.from(evidence.referenceIdsAndHashes).forEach((value, index) => {
        const path = `provenance.referenceIdsAndHashes[${index}]`;
        const reference = shape(value, ["id", "sha256"], path, errors);
        if (!reference) return;
        if (!text(reference.id) || ids.has(reference.id)) errors.push(`${path}.id: nonempty unique reference ID is required`);
        else ids.add(reference.id);
        if (!hash(reference.sha256)) errors.push(`${path}.sha256: SHA-256 is required`);
      });
    }
    if (!Array.isArray(evidence.cleanupLineage)) errors.push("provenance.cleanupLineage: array is required");
    else {
      Array.from(evidence.cleanupLineage).forEach((value, index) => {
        const path = `provenance.cleanupLineage[${index}]`;
        const step = shape(value, ["step", "sha256"], path, errors);
        if (!step) return;
        if (!text(step.step)) errors.push(`${path}.step: nonempty cleanup description is required`);
        if (!hash(step.sha256)) errors.push(`${path}.sha256: SHA-256 is required`);
      });
      const last = evidence.cleanupLineage.at(-1);
      if (evidence.cleanupLineage.length === 0 ? !sameHash(evidence.rawSha256, evidence.productionSha256) : !record(last) || !sameHash(last.sha256, evidence.productionSha256)) errors.push("provenance.cleanupLineage: terminal hash must match production; unchanged raw permits empty lineage");
    }
    if (evidence.redistribution !== "permitted" && evidence.redistribution !== "private-only") errors.push("provenance.redistribution: permitted or private-only declaration is required");
    if (evidence.redistribution === "private-only") blockers.push("Declared redistribution is private-only.");
    const reviews = shape(evidence.reviews, WILDLIFE_REVIEW_ROLES, "provenance.reviews", errors);
    if (reviews) for (const role of WILDLIFE_REVIEW_ROLES) {
      const path = `provenance.reviews.${role}`;
      const review = shape(reviews[role], ["reviewer", "date", "decision", "assetSha256", "evidence", "notes"], path, errors);
      if (!review) continue;
      if (!text(review.reviewer)) errors.push(`${path}.reviewer: named reviewer is required`);
      const reviewed = date(review.date);
      if (reviewed === null) errors.push(`${path}.date: calendar-valid ISO date or UTC timestamp is required`);
      else if (precedes(review.date, evidence.createdAt)) errors.push(`${path}.date: review cannot precede source creation`);
      if (review.decision !== "approved" && review.decision !== "rejected") errors.push(`${path}.decision: approved or rejected declaration is required`);
      if (review.decision === "rejected") blockers.push(`Declared ${role} review is rejected.`);
      if (!sameHash(review.assetSha256, evidence.productionSha256)) errors.push(`${path}.assetSha256: exact production SHA-256 is required`);
      if (!Array.isArray(review.evidence) || review.evidence.length === 0 || !Array.from(review.evidence).every(text)) errors.push(`${path}.evidence: nonempty evidence references are required`);
      if (typeof review.notes !== "string") errors.push(`${path}.notes: notes string is required (empty when no unresolved notes are declared)`);
    }
  }
  if (errors.length) blockers.push("Structural metadata errors remain.");
  return { structuralErrors: errors, productionEligible: false, productionBlockers: blockers };
}
