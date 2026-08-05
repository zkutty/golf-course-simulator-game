import { describe, expect, it } from "vitest";
import type { RegularGolfer } from "../livingClub/types";
import { assignPersonProfile, AUTHORED_ANCHOR_BACKSTORY, occupationPackageFor, revealBackstoryFact } from "./characters";

function regular(overrides: Partial<RegularGolfer> = {}): RegularGolfer {
  return {
    id: "regular-stable-7",
    kind: "regular",
    name: "June Mercer",
    archetype: "casual",
    appearance: { portrait: "cap", palette: 1, accent: 2 },
    skill: 0.61,
    preferences: { pace: "balanced", challenge: "social", hospitality: "club" },
    loyalty: 40,
    visits: 6,
    rounds: 3,
    bestToPar: 4,
    favoriteCourseId: "course-1",
    favoriteHoleId: "hole-4",
    member: false,
    relationship: { score: 80, tier: "friend", interactionIds: ["conversation-old"] },
    memories: [],
    recentThoughts: [],
    history: [],
    ...overrides,
  };
}

describe("ZK-722 authored people", () => {
  it("uses world seed and stable person ID deterministically without changing golf skill", () => {
    const first = assignPersonProfile(regular(), 90210);
    const reloaded = assignPersonProfile(regular(), 90210);
    expect(reloaded).toEqual(first);
    expect(first.skill).toBe(0.61);
    expect(first.name).toBe("June Mercer");
    expect(first.backstory?.generatedDetails).toMatchObject({ favoriteCourseId: "course-1", favoriteHoleId: "hole-4" });
    expect(first.backstory?.holdings[0].definitionId).toBe(occupationPackageFor(90210, first.id).holdingDefinitionId);
  });

  it("covers all twelve curated occupation packages with authored item definitions", () => {
    const occupations = new Set(Array.from({ length: 600 }, (_, index) => occupationPackageFor(71, `regular-${index}`).occupation));
    expect(occupations.size).toBe(12);
    for (const occupation of occupations) expect(typeof occupation).toBe("string");
  });

  it("never overwrites authored anchors or existing named relationships", () => {
    const anchor = regular({ id: "anchor-mara-vale", name: "Mara Vale", backstory: AUTHORED_ANCHOR_BACKSTORY });
    const assigned = assignPersonProfile(anchor, 22);
    expect(assigned).toBe(anchor);
    expect(assigned.backstory?.source).toBe("authored-anchor");
    expect(assigned.relationship).toEqual(anchor.relationship);
    const migratedAnchor = assignPersonProfile(regular({ id: "anchor-mara-vale", name: "Mara Vale" }), 22);
    expect(migratedAnchor.backstory).toBe(AUTHORED_ANCHOR_BACKSTORY);
    expect(migratedAnchor.rivalProfile?.signatureTechnique).toBe("soft-hands");
  });

  it("reveals facts only through an explicitly allowed conversation, round, rematch, or story trigger", () => {
    const assigned = assignPersonProfile(regular(), 90210);
    const holding = assigned.backstory!.hiddenFacts.find((fact) => fact.id.endsWith(":holding"))!;
    expect(assigned.backstory?.revealedHistory).toEqual([]);
    expect(revealBackstoryFact(assigned, holding.id, { kind: "conversation", id: "talk-1" })).toBe(assigned);
    const revealed = revealBackstoryFact(assigned, holding.id, { kind: "rematch", challengeId: "challenge-2" });
    expect(revealed.backstory?.revealedHistory[0]).toMatchObject({ id: holding.id, revealedBy: { kind: "rematch" } });
    expect(revealed.backstory?.knownHoldingIds).toEqual([assigned.backstory?.holdings[0].id]);
    expect(revealed.rivalProfile?.knownHoldingIds).toEqual(revealed.backstory?.knownHoldingIds);
  });
});
