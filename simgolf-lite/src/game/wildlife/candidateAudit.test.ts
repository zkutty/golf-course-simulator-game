import { describe, expect, it, vi } from "vitest";
import { auditWildlifeCandidate } from "./candidateAudit";
import { WILDLIFE_ANIMATION_FAMILIES, WILDLIFE_BIOMES, WILDLIFE_REVIEW_ROLES, WILDLIFE_ROADRUNNER_TRAVEL, WILDLIFE_SCALE_CANVASES } from "./contracts";
import type { WildlifeAtlasCandidate, WildlifeCandidateProvenance } from "./contracts";
import { WILDLIFE_REGISTRY } from "./registry";

const rawHash = "a".repeat(64);
const cleanedHash = "b".repeat(64);
const otherHash = "c".repeat(64);
function fixture(): { atlas: WildlifeAtlasCandidate; provenance: WildlifeCandidateProvenance } {
  return {
    atlas: { owner: "parkland", speciesId: "woodland-deer", family: "A", cycle: { clip: "idle", frames: 2, fps: 2 }, canvas: [96, 112], anchor: "G", pivot: [0.5, 1], naturalSupport: null, directionRows: 5, sourceSha256: cleanedHash, gutterPixels: 2, maximumContactDriftPixels: 2 },
    provenance: { source: "synthetic test fixture; no asset", licenseOrTerms: "synthetic declared terms", authorOrProvider: "synthetic provider", model: "synthetic model", createdAt: "2026-10-01T09:30:00Z", prompt: "Synthetic adult wildlife fixture metadata", referenceIdsAndHashes: [{ id: "synthetic-reference", sha256: otherHash }], rawSha256: rawHash, cleanupLineage: [{ step: "synthetic cleanup", sha256: cleanedHash }], productionSha256: cleanedHash, redistribution: "permitted", reviews: Object.fromEntries(WILDLIFE_REVIEW_ROLES.map(role => [role, { reviewer: "synthetic named reviewer", date: "2026-10-02", decision: "approved", assetSha256: cleanedHash, evidence: ["synthetic fixture evidence"], notes: "" }])) as unknown as WildlifeCandidateProvenance["reviews"] },
  };
}
const mutable = () => structuredClone(fixture()) as unknown as { atlas: Record<string, unknown>; provenance: Record<string, unknown> };
const errors = (input: ReturnType<typeof mutable>) => auditWildlifeCandidate(input.atlas, input.provenance).structuralErrors.join("\n");

describe("pure wildlife candidate metadata audit", () => {
  it("accepts structural synthetic completeness without certifying production, rights or human approval", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = auditWildlifeCandidate(input.atlas, input.provenance);
    expect(result.structuralErrors).toEqual([]);
    expect(result.productionEligible).toBe(false);
    expect(result.productionBlockers.join("\n")).toContain("metadata alone cannot certify production");
    expect(input).toEqual(before);
  });

  it("checks all 35 registry entries and eight biome owners with closed cycles and scale canvases", () => {
    let entries = 0;
    for (const owner of WILDLIFE_BIOMES) for (const species of WILDLIFE_REGISTRY[owner].species) {
      entries++;
      for (const clip of species.clips) {
        const input = fixture();
        const cycle = clip === "remote-travel" ? WILDLIFE_ROADRUNNER_TRAVEL : WILDLIFE_ANIMATION_FAMILIES[species.family].find(item => item.clip === clip)!;
        const anchor = clip === "quiet-flight" ? "F" : clip === "perch" || clip === "branch-walk" ? "P" : species.anchors.includes("G") ? "G" : "P";
        const scale = anchor === "F" ? "Flight" : species.scales.find(item => item !== "Flight")!;
        const atlas: WildlifeAtlasCandidate = { ...input.atlas, owner, speciesId: species.id, family: species.family, cycle, anchor, canvas: WILDLIFE_SCALE_CANVASES[scale], pivot: anchor === "G" ? [0.5, 1] : [0.5, 0.65], naturalSupport: anchor === "P" ? "synthetic natural branch/rock point" : null };
        expect(auditWildlifeCandidate(atlas, input.provenance).structuralErrors, `${owner}/${species.id}/${clip}`).toEqual([]);
      }
    }
    expect(entries).toBe(35);
  });

  it.each([
    ["owner", "moonbase", "candidate.owner"], ["owner", "links", "species must belong"],
    ["speciesId", "tree-squirrels", "family must match"], ["speciesId", "unlisted-animal", "species must belong"],
    ["family", "B", "family must match"], ["family", "__proto__", "family must match"],
    ["cycle", { clip: "forage", frames: 2, fps: 2 }, "prohibited or incompatible"],
    ["cycle", { clip: "quiet-flight", frames: 6, fps: 6 }, "prohibited or incompatible"],
    ["cycle", { clip: "idle", frames: 6, fps: 2 }, "frames/fps"],
    ["cycle", { clip: "idle", frames: 2, fps: 4 }, "frames/fps"],
    ["canvas", [48, 48], "exact source canvas"], ["canvas", [96, 112, 1], "exact source canvas"],
    ["anchor", "P", "attachment must match"], ["anchor", "W", "attachment must match"],
    ["pivot", [48, 112], "normalized"], ["pivot", [0.5, 0.99], "bottom-center"],
    ["pivot", [NaN, 1], "normalized"], ["pivot", [0.5, Infinity], "normalized"],
    ["naturalSupport", "flag", "only P"], ["directionRows", 4, "five authored"],
    ["directionRows", 8.5, "five authored"], ["directionRows", NaN, "five authored"],
    ["sourceSha256", "invalid", "SHA-256"], ["sourceSha256", otherHash, "must match provenance"],
    ["gutterPixels", 1, "two source pixels"], ["maximumContactDriftPixels", 3, "two source pixels"],
  ])("rejects atlas mutation %s=%j", (field, value, expected) => {
    const input = mutable(); input.atlas[field] = value;
    expect(errors(input)).toContain(expected);
  });

  it("enforces perch and flight semantics with explicit normalized pivots and Flight canvas", () => {
    const input = mutable();
    Object.assign(input.atlas, { speciesId: "tree-squirrels", family: "C", cycle: { clip: "perch", frames: 2, fps: 2 }, canvas: [48, 48], anchor: "P", pivot: [0.5, 0.7], naturalSupport: "branch point" });
    expect(errors(input)).toBe(""); // Tail may extend below the declared foot pivot.
    input.atlas.pivot = new Array(2); expect(errors(input)).toContain("normalized finite");
    input.atlas.pivot = [0.5, 0.7];
    input.atlas.naturalSupport = " "; expect(errors(input)).toContain("P requires");
    input.atlas.naturalSupport = "branch point"; input.atlas.anchor = "G"; expect(errors(input)).toContain("perch/branch walk requires P");
    Object.assign(input.atlas, { speciesId: "mallards", family: "D", cycle: { clip: "quiet-flight", frames: 6, fps: 6 }, canvas: [96, 64], anchor: "F", pivot: [0.5, 0.5], naturalSupport: null });
    expect(errors(input)).toBe("");
    input.atlas.pivot = new Array(2); expect(errors(input)).toContain("normalized finite");
    input.atlas.pivot = [0.5, 0.5];
    input.atlas.canvas = new Array(2); expect(errors(input)).toContain("exact source canvas");
    input.atlas.canvas = [48, 48]; expect(errors(input)).toContain("exact source canvas");
    input.atlas.canvas = [96, 64]; input.atlas.pivot = [0.5, 1]; expect(errors(input)).toContain("F body pivot");
    input.atlas.pivot = [0.5, 0.5]; input.atlas.naturalSupport = "ground"; expect(errors(input)).toContain("only P");
    Object.assign(input.atlas, { cycle: { clip: "glide", frames: 4, fps: 4 }, anchor: "W", canvas: [48, 48], pivot: [0.5, 1], naturalSupport: null });
    expect(errors(input)).toContain("prohibited or incompatible"); // Conservative mallard staging overrides D.
  });

  it.each([
    ["source", " ", "nonempty evidence"], ["licenseOrTerms", null, "nonempty evidence"],
    ["authorOrProvider", "", "nonempty evidence"], ["model", "", "explicit null"],
    ["prompt", null, "full declared prompt"], ["createdAt", "2026-02-30", "calendar-valid"],
    ["createdAt", "2026-10-01T24:00:00Z", "calendar-valid"], ["createdAt", "yesterday", "calendar-valid"],
    ["rawSha256", "a".repeat(63), "SHA-256"], ["productionSha256", otherHash, "must match provenance"],
    ["cleanupLineage", [], "terminal hash"], ["cleanupLineage", [{ step: "cleanup", sha256: otherHash }], "terminal hash"],
    ["cleanupLineage", [{ step: "", sha256: cleanedHash }], "cleanup description"],
    ["cleanupLineage", [{ step: "cleanup", sha256: "invalid" }], "SHA-256"],
    ["referenceIdsAndHashes", [{ id: "", sha256: otherHash }], "reference ID"],
    ["referenceIdsAndHashes", [{ id: "a", sha256: "invalid" }], "SHA-256"],
    ["referenceIdsAndHashes", [{ id: "a", sha256: otherHash }, { id: "a", sha256: otherHash }], "unique reference ID"],
    ["redistribution", "all-rights-cleared", "private-only declaration"],
  ])("rejects provenance mutation %s=%j", (field, value, expected) => {
    const input = mutable(); input.provenance[field] = value;
    expect(errors(input)).toContain(expected);
  });

  it("accepts explicitly unchanged originals and case-independent hex identity", () => {
    const input = mutable();
    Object.assign(input.provenance, { rawSha256: cleanedHash.toUpperCase(), cleanupLineage: [], model: null, prompt: null, referenceIdsAndHashes: [] });
    input.atlas.sourceSha256 = cleanedHash.toUpperCase();
    expect(errors(input)).toBe("");
  });

  it.each(WILDLIFE_REVIEW_ROLES)("checks exact %s review hash, date, identity, decision and evidence", role => {
    for (const [field, value, expected] of [
      ["reviewer", " ", "named reviewer"], ["assetSha256", otherHash, "exact production"],
      ["date", "2026-02-30", "calendar-valid"], ["date", "2026-09-30", "cannot precede"],
      ["decision", "pending", "approved or rejected"], ["evidence", [], "nonempty evidence"],
      ["evidence", [" "], "nonempty evidence"], ["notes", null, "notes string"],
    ] as const) {
      const input = mutable();
      const reviews = input.provenance.reviews as Record<string, Record<string, unknown>>;
      reviews[role][field] = value;
      expect(errors(input), `${role}/${field}`).toContain(`provenance.reviews.${role}`);
      expect(errors(input)).toContain(expected);
    }
  });

  it("explicitly blocks private-only or rejected declarations even when structurally complete", () => {
    const input = fixture();
    for (const role of WILDLIFE_REVIEW_ROLES) {
      const provenance: WildlifeCandidateProvenance = { ...input.provenance, redistribution: "private-only", reviews: { ...input.provenance.reviews, [role]: { ...input.provenance.reviews[role], decision: "rejected" } } };
      const result = auditWildlifeCandidate(input.atlas, provenance);
      expect(result.structuralErrors).toEqual([]);
      expect(result.productionEligible).toBe(false);
      expect(result.productionBlockers).toContain("Declared redistribution is private-only.");
      expect(result.productionBlockers).toContain(`Declared ${role} review is rejected.`);
    }
  });

  it("fails closed on malformed, inherited, missing, extra and sparse records without throwing", () => {
    const valid = fixture();
    for (const invalid of [null, [], {}, Object.create(valid.atlas), { ...valid.atlas, productionEligible: true }, { ...valid.atlas, pivot: new Array(2) }, { ...valid.atlas, cycle: null }]) expect(auditWildlifeCandidate(invalid, valid.provenance).structuralErrors.length).toBeGreaterThan(0);
    for (const invalid of [null, [], {}, Object.create(valid.provenance), { ...valid.provenance, trusted: true }, { ...valid.provenance, reviews: null }, { ...valid.provenance, referenceIdsAndHashes: new Array(1) }, { ...valid.provenance, cleanupLineage: new Array(1) }]) expect(auditWildlifeCandidate(valid.atlas, invalid).structuralErrors.length).toBeGreaterThan(0);
    const input = mutable();
    const reviews = input.provenance.reviews as Record<string, Record<string, unknown>>;
    reviews.visual.evidence = new Array(1); expect(errors(input)).toContain("nonempty evidence");
    delete reviews.visual; expect(errors(input)).toContain("reviews.visual: own field");
    delete input.atlas.owner; expect(errors(input)).toContain("candidate.owner: own field");
  });

  it("imports freshly and audits with zero network requests", async () => {
    const request = vi.fn(() => { throw new Error("candidate metadata must not request assets"); });
    vi.stubGlobal("fetch", request);
    try {
      vi.resetModules();
      const module = await import("./candidateAudit");
      const input = fixture();
      expect(module.auditWildlifeCandidate(input.atlas, input.provenance).structuralErrors).toEqual([]);
      expect(request).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
