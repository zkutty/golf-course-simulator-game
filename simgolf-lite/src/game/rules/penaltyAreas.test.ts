import { describe, expect, it } from "vitest";
import {
  classifyPenaltyAreaComponents,
  deriveShotRuling,
  locatePenaltyAreaPoint,
} from "./penaltyAreas";

function snapshot() {
  return {
    width: 6,
    height: 4,
    inBounds: [
      true, true, true, true, true, false,
      true, true, true, true, true, true,
      true, true, true, true, true, true,
      true, true, true, true, true, true,
    ],
    penaltyComponents: [
      0, 0, 0, 0, 0, 0,
      0, 0, 1, 1, 0, 0,
      0, 0, 1, 1, 0, 0,
      0, 0, 0, 0, 0, 0,
    ],
    components: [{ id: 1, firstCell: 8, tileCount: 4 }],
  };
}

describe("ZK-549 penalty-area rules", () => {
  it("classifies connected components yellow when the frozen route intersects and red otherwise", () => {
    const base = snapshot();
    const yellow = classifyPenaltyAreaComponents({
      snapshot: base,
      holeId: "hole-01",
      route: [{ x: 0.5, y: 1.5 }, { x: 5.5, y: 1.5 }],
    });
    const red = classifyPenaltyAreaComponents({
      snapshot: base,
      holeId: "hole-01",
      route: [{ x: 0.5, y: 0.5 }, { x: 5.5, y: 0.5 }],
    });
    expect(yellow).toEqual({ ok: true, value: { holeId: "hole-01", red: [], yellow: [1] } });
    expect(red).toEqual({ ok: true, value: { holeId: "hole-01", red: [1], yellow: [] } });
  });

  it("gives map exterior and unowned cells OB precedence over terrain", () => {
    const base = snapshot();
    expect(locatePenaltyAreaPoint(base, { x: 6, y: 1 })).toEqual({ ok: true, value: { kind: "out_of_bounds" } });
    expect(locatePenaltyAreaPoint(base, { x: 5.5, y: 0.5 })).toEqual({ ok: true, value: { kind: "out_of_bounds" } });
    const ruling = deriveShotRuling({
      snapshot: base,
      holeClassification: { holeId: "hole-01", red: [], yellow: [1] },
      flightPath: [{ x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }],
      rollPath: [{ x: 1.5, y: 3.5 }, { x: 6.2, y: 3.5 }],
    });
    expect(ruling).toMatchObject({
      ok: true,
      value: { penaltyKind: "out_of_bounds", penaltyStrokes: 1, penaltyComponentId: null },
    });
  });

  it("does not penalize flight over water or OB when the authoritative roll finishes in bounds", () => {
    const base = snapshot();
    const ruling = deriveShotRuling({
      snapshot: base,
      holeClassification: { holeId: "hole-01", red: [], yellow: [1] },
      flightPath: [{ x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }],
      rollPath: [{ x: 1.5, y: 3.5 }, { x: 4.5, y: 3.5 }],
    });
    expect(ruling).toEqual({
      ok: true,
      value: {
        status: "in_play",
        penaltyKind: "none",
        penaltyStrokes: 0,
        penaltyComponentId: null,
        penaltyAreaClassification: null,
        referencePoint: null,
        crossingPoint: null,
      },
    });
  });

  it("returns the final penalty-area crossing and rejects malformed or hostile paths safely", () => {
    const base = snapshot();
    const ruling = deriveShotRuling({
      snapshot: base,
      holeClassification: { holeId: "hole-01", red: [1], yellow: [] },
      rollPath: [{ x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }, { x: 2.5, y: 2.5 }],
    });
    expect(ruling).toMatchObject({
      ok: true,
      value: {
        penaltyKind: "penalty_area",
        penaltyAreaClassification: "red",
        penaltyComponentId: 1,
        crossingPoint: { x: 2, y: 1.5 },
        referencePoint: { x: 2, y: 1.5 },
      },
    });
    const hostile = deriveShotRuling({
      snapshot: base,
      holeClassification: { holeId: "hole-01", red: [1], yellow: [] },
      rollPath: Array.from({ length: 4_097 }, (_, index) => ({ x: index, y: 0 })),
    });
    expect(hostile).toMatchObject({ ok: false, error: { code: "invalid-path" } });
  });

  it("is byte-for-byte deterministic for repeated classification", () => {
    const input = {
      snapshot: snapshot(),
      holeId: "hole-02",
      route: [{ x: 5.5, y: 3.5 }, { x: 0.5, y: 3.5 }],
    };
    expect(JSON.stringify(classifyPenaltyAreaComponents(input)))
      .toBe(JSON.stringify(classifyPenaltyAreaComponents({ ...input, route: input.route.slice() })));
  });
});
