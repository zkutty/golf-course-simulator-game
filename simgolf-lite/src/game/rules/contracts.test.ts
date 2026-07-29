import { describe, expect, it } from "vitest";
import {
  SHOT_RULES_CONTRACT_VERSION,
  type LieEffect,
  type ReliefCandidate,
  type ReliefResolution,
  type ShotCollision,
  type ShotOutcome,
  type ShotRuling,
} from "./contracts";

describe("authoritative shot-rules contracts", () => {
  it("represents one explainable physical and rules outcome", () => {
    const lieEffect: LieEffect = {
      sourceLie: "deep_rough",
      effectiveLie: "deep_rough",
      carryMultiplier: 0.82,
      dispersionMultiplier: 1.35,
      rollMultiplier: 0.6,
    };
    const collision: ShotCollision = {
      kind: "obstacle",
      point: { x: 12.5, y: 9 },
      obstacleType: "tree",
      distanceFromStartYards: 84,
      clearance: {
        point: { x: 12.5, y: 9 },
        pathHeightYards: 7,
        requiredHeightYards: 9,
        clearanceYards: -2,
      },
    };
    const ruling: ShotRuling = {
      status: "penalty",
      penaltyKind: "penalty_area",
      penaltyStrokes: 1,
      penaltyComponentId: 3,
      penaltyAreaClassification: "red",
      referencePoint: { x: 17, y: 11 },
      crossingPoint: { x: 16.5, y: 10.75 },
    };
    const candidate: ReliefCandidate = {
      id: "lateral-1",
      type: "lateral",
      position: { x: 15, y: 12 },
      order: 0,
      legal: true,
      distanceFromReferenceYards: 18,
    };
    const relief: ReliefResolution = {
      status: "resolved",
      type: "lateral",
      candidates: [candidate],
      selectedCandidateId: candidate.id,
      finalPosition: candidate.position,
    };
    const outcome: ShotOutcome = {
      rulesVersion: SHOT_RULES_CONTRACT_VERSION,
      lieEffect,
      requestedCarryYards: 145,
      effectiveCarryYards: 118.9,
      requestedDispersionTiles: 2,
      effectiveDispersionTiles: 2.7,
      flight: {
        profile: "standard",
        launchAngleDegrees: 20,
        apexHeightYards: 18,
        apexPosition: { x: 10, y: 8 },
        carryEnd: { x: 17, y: 11 },
        clearance: [collision.clearance],
      },
      collision,
      physicalRest: { x: 17, y: 11 },
      ruling,
      relief,
      finalPosition: candidate.position,
    };

    expect(outcome).toMatchObject({
      rulesVersion: 1,
      lieEffect: { effectiveLie: "deep_rough" },
      collision: { kind: "obstacle" },
      ruling: { penaltyAreaClassification: "red" },
      relief: { type: "lateral" },
      finalPosition: { x: 15, y: 12 },
    });
  });
});
