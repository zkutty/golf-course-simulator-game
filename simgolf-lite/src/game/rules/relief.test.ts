import { describe, expect, it } from "vitest";
import type { ShotRuling } from "./contracts";
import { resolveRelief, type ReliefCandidateSeed } from "./relief";

const map = {
  width: 8,
  height: 8,
  inBounds: Array.from({ length: 64 }, () => true),
  penaltyComponents: Array.from({ length: 64 }, () => 0),
  components: [],
};

function ruling(overrides: Partial<ShotRuling> = {}): ShotRuling {
  return { ...baseRuling(), ...overrides };
}

function baseRuling(): ShotRuling {
  return {
    status: "penalty" as const,
    penaltyKind: "penalty_area" as const,
    penaltyStrokes: 1,
    penaltyComponentId: 1,
    penaltyAreaClassification: "red" as const,
    referencePoint: { x: 3, y: 3 },
    crossingPoint: { x: 3, y: 3 },
  };
}

function candidate(type: ReliefCandidateSeed["type"], position: { x: number; y: number }, expectedNextShotCost: number, id?: string): ReliefCandidateSeed {
  return { type, position, expectedNextShotCost, id };
}

describe("ZK-549 deterministic relief", () => {
  it("allows OB stroke-and-distance only and selects the lowest-cost legal candidate", () => {
    const result = resolveRelief({
      snapshot: map,
      ruling: ruling({ penaltyKind: "out_of_bounds", penaltyComponentId: null, penaltyAreaClassification: null }),
      hole: { x: 7, y: 7 },
      physicalRest: { x: 7.5, y: 7.5 },
      previousPosition: { x: 2, y: 2 },
      clubLengthYards: 1,
      candidates: [
        candidate("back_on_line", { x: 2, y: 2 }, 0.1, "illegal-option"),
        candidate("stroke_and_distance", { x: 2, y: 2 }, 4, "previous"),
        candidate("stroke_and_distance", { x: 1, y: 1 }, 1, "wrong-position"),
      ],
    });
    expect(result.status).toBe("resolved");
    expect(result.type).toBe("stroke_and_distance");
    expect(result.selectedCandidateId).toBe("previous");
    expect(result.candidates.map(({ id, legal, order }) => ({ id, legal, order }))).toEqual([
      { id: "previous", legal: true, order: 0 },
      { id: "illegal-option", legal: false, order: 1 },
      { id: "wrong-position", legal: false, order: 2 },
    ]);
  });

  it("orders yellow and red option sets with stable cost, type, geometry, and ID tie-breaks", () => {
    const seeds = [
      candidate("lateral", { x: 3, y: 4 }, 2, "lateral"),
      candidate("back_on_line", { x: 4, y: 4 }, 2, "back"),
      candidate("stroke_and_distance", { x: 2, y: 2 }, 2, "stroke"),
    ];
    const yellow = resolveRelief({
      snapshot: map,
      ruling: ruling({ penaltyAreaClassification: "yellow" }),
      hole: { x: 1, y: 1 },
      physicalRest: { x: 3, y: 3 },
      previousPosition: { x: 2, y: 2 },
      clubLengthYards: 1,
      candidates: seeds,
    });
    const red = resolveRelief({
      snapshot: map,
      ruling: ruling({ penaltyAreaClassification: "red" }),
      hole: { x: 1, y: 1 },
      physicalRest: { x: 3, y: 3 },
      previousPosition: { x: 2, y: 2 },
      clubLengthYards: 1,
      candidates: seeds,
    });
    expect(yellow.candidates.map((item) => [item.id, item.legal])).toEqual([
      ["stroke", true], ["back", true], ["lateral", false],
    ]);
    expect(red.candidates.map((item) => [item.id, item.legal])).toEqual([
      ["stroke", true], ["back", true], ["lateral", true],
    ]);
    expect(red.selectedCandidateId).toBe("stroke");
  });

  it("requires back-on-line geometry, rejects nearer-hole and penalty-area drops, and handles no candidate", () => {
    const blockedMap = {
      ...map,
      penaltyComponents: map.penaltyComponents.map((_, index) => index === 28 ? 1 : 0),
      components: [{ id: 1, firstCell: 28, tileCount: 1 }],
    };
    const result = resolveRelief({
      snapshot: blockedMap,
      ruling: ruling({ penaltyAreaClassification: "red" }),
      hole: { x: 1, y: 1 },
      physicalRest: { x: 3, y: 3 },
      previousPosition: { x: 2, y: 2 },
      clubLengthYards: 1,
      candidates: [
        candidate("back_on_line", { x: 2.5, y: 2.6 }, 1, "off-line"),
        candidate("back_on_line", { x: 1.5, y: 1.5 }, 1, "nearer-hole"),
        candidate("lateral", { x: 5.5, y: 4.5 }, 1, "too-far"),
        candidate("lateral", { x: 4.5, y: 3.5 }, 1, "blocked"),
      ],
    });
    expect(result.status).toBe("unavailable");
    expect(result.selectedCandidateId).toBeNull();
    expect(result.candidates.every((item) => !item.legal)).toBe(true);
  });

  it("returns play-as-it-lies as not-required and remains deterministic under reordered input", () => {
    const candidates = [candidate("play_as_it_lies", { x: 3, y: 3 }, 0, "lies")];
    const input = {
      snapshot: map,
      ruling: ruling({ status: "in_play", penaltyKind: "none", penaltyStrokes: 0, penaltyComponentId: null, penaltyAreaClassification: null, referencePoint: null, crossingPoint: null }),
      hole: { x: 7, y: 7 },
      physicalRest: { x: 3, y: 3 },
      previousPosition: null,
      clubLengthYards: 1,
      candidates,
    };
    expect(resolveRelief(input)).toEqual(resolveRelief({ ...input, candidates: candidates.slice().reverse() }));
    expect(resolveRelief(input)).toMatchObject({ status: "not_required", type: "none", finalPosition: { x: 3, y: 3 } });
  });

  it("bounds hostile candidate inputs without throwing", () => {
    const result = resolveRelief({
      snapshot: map,
      ruling: ruling(),
      hole: { x: Number.NaN, y: 1 },
      physicalRest: { x: 3, y: 3 },
      previousPosition: null,
      clubLengthYards: 1,
      candidates: [],
    });
    expect(result).toEqual({ status: "unavailable", type: "none", candidates: [], selectedCandidateId: null, finalPosition: null });
  });
});
