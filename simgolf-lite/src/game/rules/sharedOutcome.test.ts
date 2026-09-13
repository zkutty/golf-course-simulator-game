import { describe, expect, it } from "vitest";
import {
  createControlledRoundSnapshotV2,
  decodeControlledRoundSnapshotV2,
} from "./roundSnapshot";
import { calculateShotEffects } from "./shotEffects";
import { createSharedShotOutcome, resolveSharedRules } from "./sharedOutcome";
import { isValidSharedShotOutcome } from "./contracts";

function snapshotFor(classification: "red" | "yellow") {
  const width = 10;
  const height = 6;
  const inBounds = Array.from({ length: width * height }, () => true);
  const penaltyMask = inBounds.map((_, index) => index === 2 * width + 4);
  const empty = createControlledRoundSnapshotV2({
    width,
    height,
    inBounds,
    penaltyMask,
    holeClassifications: [{ holeId: "hole-1", red: [], yellow: [] }],
  });
  expect(empty.ok).toBe(true);
  if (!empty.ok) throw new Error(empty.error.message);
  const decoded = decodeControlledRoundSnapshotV2(empty.value);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(decoded.error.message);
  const componentId = decoded.value.components[0]?.id;
  if (!componentId) throw new Error("Expected one penalty component");
  const classified = createControlledRoundSnapshotV2({
    width,
    height,
    inBounds,
    penaltyMask,
    holeClassifications: [{
      holeId: "hole-1",
      red: classification === "red" ? [componentId] : [],
      yellow: classification === "yellow" ? [componentId] : [],
    }],
  });
  expect(classified.ok).toBe(true);
  if (!classified.ok) throw new Error(classified.error.message);
  return classified.value;
}

describe("ZK-549 shared runtime ruling adapter", () => {
  it("accepts directional applied evidence and rejects hostile persisted variants", () => {
    const base = {
      rulesVersion: 1, lieEffect: { sourceLie: "fairway", effectiveLie: "fairway", carryMultiplier: 1, dispersionMultiplier: 1, rollMultiplier: 1 },
      requestedCarryYards: 10, effectiveCarryYards: 10, requestedDispersionTiles: 1, effectiveDispersionTiles: 1,
      flight: { profile: "standard", launchAngleDegrees: 1, apexHeightYards: 1, apexPosition: { x: 1, y: 1 }, carryEnd: { x: 2, y: 1 }, clearance: [] },
      collision: { kind: "none" }, physicalRest: { x: 2, y: 1 }, ruling: { status: "in_play", penaltyKind: "none", penaltyStrokes: 0, penaltyComponentId: null, penaltyAreaClassification: null, referencePoint: null, crossingPoint: null },
      relief: { status: "not_required", type: "none", candidates: [], selectedCandidateId: null, finalPosition: { x: 2, y: 1 } }, finalPosition: { x: 2, y: 1 },
      appliedWind: { version: 1, sourceMode: "directional", headwindMph: 70, crosswindMph: -70, carryMultiplier: 1, lateralCenterlineTiles: 0 },
    } as const;
    expect(isValidSharedShotOutcome(base)).toBe(true);
    expect(isValidSharedShotOutcome({ ...base, appliedWind: { ...base.appliedWind, sourceMode: "legacy_scalar" } })).toBe(false);
    expect(isValidSharedShotOutcome({ ...base, appliedWind: { ...base.appliedWind, headwindMph: 71 } })).toBe(false);
    expect(isValidSharedShotOutcome({ ...base, appliedWind: { ...base.appliedWind, crosswindMph: Infinity } })).toBe(false);
    expect(isValidSharedShotOutcome({ ...base, appliedWind: { ...base.appliedWind, lateralCenterlineTiles: 9 } })).toBe(false);
  });
  it("includes frozen obstacle collision evidence in the shared authoritative outcome", () => {
    const effects = calculateShotEffects({
      clubId: "chip",
      lie: "fairway",
      recoverySkill: 50,
      technique: "normal",
      flightProfile: "standard",
    });
    expect(effects.ok).toBe(true);
    if (!effects.ok) throw new Error(effects.blocker.message);
    const outcome = createSharedShotOutcome({
      trace: {
        id: "shot-1",
        holeId: "hole-1",
        shotNumber: 1,
        club: "Chip",
        technique: "normal",
        power: 1,
        from: { x: 1, y: 2 },
        aim: { x: 7, y: 2 },
        landing: { x: 7, y: 2 },
        rest: { x: 7, y: 2 },
        carryYards: 60,
        rollYards: 0,
        lieBefore: "fairway",
        lieAfter: "fairway",
        penaltyStrokes: 0,
        holed: false,
        seed: 1,
        evidence: [],
      },
      effects: effects.value,
      requestedCarryYards: 60,
      requestedDispersionTiles: 1,
      obstacleCollision: {
        width: 10,
        height: 5,
        yardsPerTile: 10,
        elevations: new Array(50).fill(0),
        obstacles: [{ type: "tree", x: 4, y: 2 }],
      },
    });

    expect(outcome.collision).toMatchObject({ kind: "obstacle", obstacleType: "tree" });
    expect(outcome.flight.clearance).toMatchObject([{ relationship: "through", obstacleType: "tree" }]);
  });

  it("ignores a flight-over-hazard when landing and rest are in bounds", () => {
    const result = resolveSharedRules({
      rulesSnapshot: snapshotFor("yellow"),
      holeId: "hole-1",
      hole: { x: 8, y: 2 },
      previousPosition: { x: 1, y: 2 },
      physicalRest: { x: 8, y: 2 },
      rollPath: [{ x: 1, y: 2 }, { x: 8, y: 2 }],
      clubLengthTiles: 2,
      holed: false,
    });

    expect(result.usedFrozenSnapshot).toBe(true);
    expect(result.ruling).toMatchObject({ status: "in_play", penaltyStrokes: 0 });
    expect(result.relief.status).toBe("not_required");
    expect(result.finalPosition).toEqual({ x: 8, y: 2 });
  });

  it("applies one OB penalty and resolves deterministic stroke-and-distance", () => {
    const result = resolveSharedRules({
      rulesSnapshot: snapshotFor("yellow"),
      holeId: "hole-1",
      hole: { x: 8, y: 2 },
      previousPosition: { x: 2, y: 2 },
      physicalRest: { x: 12, y: 2 },
      rollPath: [{ x: 2, y: 2 }, { x: 12, y: 2 }],
      clubLengthTiles: 2,
      holed: false,
    });

    expect(result.ruling).toMatchObject({
      status: "penalty",
      penaltyKind: "out_of_bounds",
      penaltyStrokes: 1,
    });
    expect(result.relief.status).toBe("resolved");
    expect(result.relief.type).toBe("stroke_and_distance");
    expect(result.finalPosition).toEqual({ x: 2, y: 2 });
  });

  it("keeps yellow lateral seeds illegal and selects red lateral relief", () => {
    const yellow = resolveSharedRules({
      rulesSnapshot: snapshotFor("yellow"),
      holeId: "hole-1",
      hole: { x: 8, y: 2 },
      previousPosition: { x: 1, y: 2 },
      physicalRest: { x: 4, y: 2 },
      rollPath: [{ x: 1, y: 2 }, { x: 4, y: 2 }],
      clubLengthTiles: 2,
      holed: false,
    });
    expect(yellow.ruling.penaltyAreaClassification).toBe("yellow");
    expect(yellow.relief.candidates.some((candidate) => candidate.type === "lateral" && candidate.legal)).toBe(false);

    const red = resolveSharedRules({
      rulesSnapshot: snapshotFor("red"),
      holeId: "hole-1",
      hole: { x: 8, y: 2 },
      previousPosition: { x: 1, y: 2 },
      physicalRest: { x: 4, y: 2 },
      rollPath: [{ x: 1, y: 2 }, { x: 4, y: 2 }],
      clubLengthTiles: 2,
      holed: false,
    });
    expect(red.ruling.penaltyAreaClassification).toBe("red");
    expect(red.relief.candidates.some((candidate) => candidate.type === "lateral" && candidate.legal)).toBe(true);
    expect(red.relief.type).toBe("lateral");
    expect(red.finalPosition).not.toEqual({ x: 4, y: 2 });
  });
});
