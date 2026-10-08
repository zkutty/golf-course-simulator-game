import { describe, expect, it } from "vitest";
import type { HoleTemplateProvenanceV1 } from "./types";
import { effectiveHoleTemplateFidelity, fidelityPolicyIssues, holeTemplateUsePolicy, placedHoleProvenanceIssues, provenancePolicyIssues } from "./provenancePolicy";

const provenance: HoleTemplateProvenanceV1 = { sourceKind: "manual", sourceLabel: "Player-built hole", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false };

describe("ZK-652 provenance boundary", () => {
  it.each([
    { rightsAttested: undefined }, { rightsAttested: "yes" }, { sourceLabel: " " },
    { importedAt: "2026-02-30T12:00:00.000Z" }, { sourceKind: "scraped" },
    { redistribution: undefined }, { redistribution: "public" }, { sourceAssetRetained: true },
    { sourcePixels: "embedded-pixels" }, { rightsAttested: false, redistribution: "allowed" },
    { sourceKind: "player_photo", redistribution: "allowed", licenseName: "Claimed license" },
    { sourceKind: "open_data", redistribution: "allowed" },
    { redistribution: "attribution", attribution: " " },
    { redistribution: "share_alike", attribution: "Credit" },
  ])("fails closed for malformed or contradictory rights %j", (change) => {
    const input = { ...provenance, ...change };
    expect(provenancePolicyIssues(input).length).toBeGreaterThan(0);
    expect(holeTemplateUsePolicy(input, "analysis").allowed).toBe(false);
    expect(holeTemplateUsePolicy(input, "redistribution").allowed).toBe(false);
  });

  it("requires attestation before analysis, while unattested private copies and unknown rights stay private", () => {
    const input = { ...provenance, rightsAttested: false, redistribution: "unknown" };
    expect(holeTemplateUsePolicy(input, "private_copy").allowed).toBe(true);
    expect(holeTemplateUsePolicy(input, "analysis").allowed).toBe(false);
    expect(holeTemplateUsePolicy(input, "redistribution").allowed).toBe(false);
    expect(holeTemplateUsePolicy({ ...input, rightsAttested: true }, "analysis").allowed).toBe(true);
    expect(holeTemplateUsePolicy({ ...provenance, sourceKind: "player_photo" }, "redistribution").allowed).toBe(false);
  });

  it("allows attested licensed redistribution with the required license and credit", () => {
    const input = { ...provenance, sourceKind: "open_data", redistribution: "share_alike", licenseName: "CC BY-SA 4.0", attribution: "Dataset author" };
    expect(holeTemplateUsePolicy(input, "redistribution").allowed).toBe(true);
  });

  it("defaults only to Sketch and requires explicit Calibrated evidence; reserves higher tiers", () => {
    expect(effectiveHoleTemplateFidelity()).toEqual({ tier: "sketch" });
    expect(fidelityPolicyIssues(undefined)).toEqual([]);
    expect(fidelityPolicyIssues({ tier: "sketch", verifiedYardage: 400 })).not.toEqual([]);
    expect(fidelityPolicyIssues({ tier: "calibrated", controlPointsReviewed: true, reviewedControlPointCount: 2, verifiedYardage: 400 })).toEqual([]);
    for (const input of [{ tier: "surveyed" }, { tier: "licensed" }, { tier: "calibrated" }, { tier: "calibrated", controlPointsReviewed: false, reviewedControlPointCount: 2, verifiedYardage: 400 }, { tier: "calibrated", controlPointsReviewed: true, reviewedControlPointCount: 1, verifiedYardage: 400 }, { tier: "calibrated", controlPointsReviewed: true, reviewedControlPointCount: 2, verifiedYardage: 0 }]) expect(fidelityPolicyIssues(input)).not.toEqual([]);
  });

  it("keeps historical placed credits readable without granting redistribution or accepting pixels", () => {
    const legacy = { templateId: "old-template", sourceLabel: "Historical credit", attribution: "Author" };
    expect(placedHoleProvenanceIssues(legacy, "hole")).toEqual([]);
    expect(holeTemplateUsePolicy(legacy, "redistribution").allowed).toBe(false);
    expect(placedHoleProvenanceIssues({ ...legacy, pixels: "image" }, "hole")).not.toEqual([]);
  });
});
