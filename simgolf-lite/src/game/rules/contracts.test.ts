import { describe, expect, it } from "vitest";
import {
  isValidSharedShotOutcome,
  isValidAppliedShotWindV1,
  SHOT_RULES_CONTRACT_VERSION,
  type LieEffect,
  type ReliefCandidate,
  type ReliefResolution,
  type ShotCollision,
  type ShotOutcome,
  type ShotRuling,
} from "./contracts";
import { resolveBivariateDispersion, sampleBivariateDispersion } from "./dispersionModel";

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
    expect(isValidSharedShotOutcome(outcome)).toBe(true);
    expect(isValidSharedShotOutcome({
      ...outcome,
      collision: { ...collision, point: { x: Number.NaN, y: 9 } },
    })).toBe(false);
    expect(isValidSharedShotOutcome({
      ...outcome,
      relief: { ...relief, selectedCandidateId: "missing" },
    })).toBe(false);
    expect(isValidSharedShotOutcome({
      ...outcome,
      ruling: { ...ruling, penaltyStrokes: 0 },
    })).toBe(false);

    const appliedWind = {
      version: 1 as const,
      sourceMode: "directional" as const,
      headwindMph: 12,
      crosswindMph: -4,
      carryMultiplier: .97,
      lateralCenterlineTiles: -.2,
    };
    expect(isValidAppliedShotWindV1(appliedWind)).toBe(true);
    expect(isValidAppliedShotWindV1({ ...appliedWind, headwindMph: 71 })).toBe(false);

    const model = resolveBivariateDispersion({
      clubId: "driver",
      effectiveDispersionTiles: 2,
      accuracy: 60,
      consistency: 65,
      centerlineLateralTiles: .5,
    });
    expect(model.ok).toBe(true);
    if (!model.ok) throw new Error("expected bivariate model");
    const sample = sampleBivariateDispersion(model.value, 77);
    expect(sample.ok).toBe(true);
    if (!sample.ok) throw new Error("expected bivariate sample");
    const appliedDispersion = {
      version: 1 as const,
      mode: "bivariate_v1" as const,
      modelVersion: model.value.version,
      clubId: model.value.clubId,
      seed: sample.value.seed,
      effectiveDispersionTiles: model.value.resolvedFrom.effectiveDispersionTiles,
      accuracy: model.value.resolvedFrom.accuracy,
      consistency: model.value.resolvedFrom.consistency,
      centerlineLongitudinalTiles: model.value.centerline.longitudinalTiles,
      centerlineLateralInputTiles: model.value.resolvedFrom.centerlineLateralTiles,
      centerlineLateralTiles: model.value.centerline.lateralTiles,
      appliedWindLateralTiles: 0,
      sample: {
        isTail: sample.value.isTail,
        mahalanobisRadius: sample.value.mahalanobisRadius,
        longitudinalTiles: sample.value.offset.longitudinalTiles,
        lateralTiles: sample.value.offset.lateralTiles,
      },
    };
    expect(isValidSharedShotOutcome({ ...outcome, appliedDispersion })).toBe(true);
    expect(isValidSharedShotOutcome({
      ...outcome,
      requestedDispersionTiles: 2.1,
      appliedDispersion,
    })).toBe(false);
    expect(isValidSharedShotOutcome({
      ...outcome,
      appliedDispersion: { ...appliedDispersion, sample: { ...appliedDispersion.sample, lateralTiles: 0 } },
    })).toBe(false);
    expect(isValidSharedShotOutcome({
      ...outcome,
      appliedDispersion: { ...appliedDispersion, centerlineLateralTiles: appliedDispersion.centerlineLateralTiles + .1 },
    })).toBe(false);
    expect(isValidSharedShotOutcome({
      ...outcome,
      appliedDispersion: { ...appliedDispersion, modelVersion: 2 },
    })).toBe(false);

    const windModel = resolveBivariateDispersion({
      clubId: "driver", effectiveDispersionTiles: 2, accuracy: 60, consistency: 65,
      centerlineLateralTiles: .5, appliedWind,
    });
    expect(windModel.ok).toBe(true);
    if (!windModel.ok) throw new Error("expected wind model");
    const windSample = sampleBivariateDispersion(windModel.value, 77);
    expect(windSample.ok).toBe(true);
    if (!windSample.ok) throw new Error("expected wind sample");
    const windEvidence = {
      ...appliedDispersion,
      centerlineLongitudinalTiles: windModel.value.centerline.longitudinalTiles,
      centerlineLateralTiles: windModel.value.centerline.lateralTiles,
      appliedWindLateralTiles: windModel.value.appliedWindLateralTiles,
      sample: {
        isTail: windSample.value.isTail,
        mahalanobisRadius: windSample.value.mahalanobisRadius,
        longitudinalTiles: windSample.value.offset.longitudinalTiles,
        lateralTiles: windSample.value.offset.lateralTiles,
      },
    };
    expect(isValidSharedShotOutcome({ ...outcome, appliedWind, appliedDispersion: windEvidence })).toBe(true);
    expect(isValidSharedShotOutcome({
      ...outcome,
      appliedWind: { ...appliedWind, lateralCenterlineTiles: .1 },
      appliedDispersion: windEvidence,
    })).toBe(false);
  });
});
