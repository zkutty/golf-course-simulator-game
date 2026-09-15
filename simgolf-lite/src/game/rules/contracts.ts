import type { ObstacleType, Point, Terrain } from "../models/types";
import type { AppliedShotWindV1 } from "./shotEnvironment";
import { BIVARIATE_DISPERSION_MODEL_VERSION, dispersionClub, type ShotClubId } from "./dispersionRegistry";
import {
  isValidAppliedShotWindV1,
  resolveBivariateDispersionShot,
} from "./dispersionRuntime";

export const SHOT_RULES_CONTRACT_VERSION = 1 as const;

export type ShotLie = Terrain | "out_of_bounds";

/**
 * The authoritative modifiers applied to a shot before its physical path is
 * resolved. `effectiveLie` can differ from `sourceLie` after free relief or a
 * rules-driven placement.
 */
export interface LieEffect {
  sourceLie: ShotLie;
  effectiveLie: ShotLie;
  carryMultiplier: number;
  dispersionMultiplier: number;
  rollMultiplier: number;
}

export type ShotFlightProfile = "low" | "standard" | "high";

export interface ShotClearanceEvidence {
  point: Point;
  pathHeightYards: number;
  requiredHeightYards: number;
  clearanceYards: number;
  /** Present for terrain-feature clearance checks. */
  obstacleType?: ObstacleType;
  /** How the sampled trajectory related to this obstacle volume. */
  relationship?: "around" | "under" | "over" | "through";
  /** Horizontal clearance is reported when the path goes around a volume. */
  horizontalClearanceYards?: number;
}

export interface ShotFlight {
  profile: ShotFlightProfile;
  launchAngleDegrees: number;
  apexHeightYards: number;
  apexPosition: Point;
  carryEnd: Point;
  clearance: readonly ShotClearanceEvidence[];
}

export type ShotCollision =
  | {
    kind: "none";
  }
  | {
    kind: "terrain";
    point: Point;
    terrain: Terrain;
    distanceFromStartYards: number;
  }
  | {
    kind: "obstacle";
    point: Point;
    obstacleType: ObstacleType;
    distanceFromStartYards: number;
    clearance: ShotClearanceEvidence;
  };

export type PenaltyAreaClassification = "red" | "yellow";
export type ShotRulingStatus = "in_play" | "holed" | "penalty";
export type ShotPenaltyKind = "none" | "out_of_bounds" | "penalty_area";

/**
 * A ruling describes why relief is (or is not) required. Physical rest and the
 * eventual playable position remain separate on `ShotOutcome`.
 */
export interface ShotRuling {
  status: ShotRulingStatus;
  penaltyKind: ShotPenaltyKind;
  penaltyStrokes: number;
  penaltyComponentId: number | null;
  penaltyAreaClassification: PenaltyAreaClassification | null;
  referencePoint: Point | null;
  crossingPoint: Point | null;
}

export type ReliefType =
  | "none"
  | "play_as_it_lies"
  | "stroke_and_distance"
  | "back_on_line"
  | "lateral";

export interface ReliefCandidate {
  id: string;
  type: Exclude<ReliefType, "none">;
  position: Point;
  order: number;
  legal: boolean;
  distanceFromReferenceYards: number;
}

export type ReliefResolutionStatus = "not_required" | "resolved" | "unavailable";

export interface ReliefResolution {
  status: ReliefResolutionStatus;
  type: ReliefType;
  candidates: readonly ReliefCandidate[];
  selectedCandidateId: string | null;
  finalPosition: Point | null;
}

/**
 * Shared rules payload for Player Pro, live rounds, previews, tournaments,
 * replays, and analysis. Callers may add presentation or strategy fields, but
 * this physical/rules core should remain byte-stable for identical inputs.
 */
export interface ShotOutcome {
  rulesVersion: typeof SHOT_RULES_CONTRACT_VERSION;
  lieEffect: LieEffect;
  requestedCarryYards: number;
  effectiveCarryYards: number;
  requestedDispersionTiles: number;
  effectiveDispersionTiles: number;
  flight: ShotFlight;
  collision: ShotCollision;
  physicalRest: Point;
  ruling: ShotRuling;
  relief: ReliefResolution;
  finalPosition: Point;
  /** Additive Wave 1 evidence; absent on historical outcomes. */
  appliedWind?: AppliedShotWindV1;
  /** Additive ZK-772 bivariate audit evidence; absent on historical shots. */
  appliedDispersion?: AppliedDispersionV1;
}

export type SharedShotOutcome = ShotOutcome;

/** Compact replay certificate; registry geometry remains the single authority. */
export interface AppliedDispersionV1 {
  version: 1;
  mode: "bivariate_v1";
  modelVersion: typeof BIVARIATE_DISPERSION_MODEL_VERSION;
  clubId: ShotClubId;
  seed: number;
  /** Canonical nine-decimal bivariate input; rounds to owning requestedDispersionTiles. */
  effectiveDispersionTiles: number;
  accuracy: number;
  consistency: number;
  centerlineLongitudinalTiles: number;
  /** Curve/sidehill centerline before the separately-owned wind shift. */
  centerlineLateralInputTiles: number;
  centerlineLateralTiles: number;
  /** Retained separately so a replay can reconstruct the wind-owned shift. */
  appliedWindLateralTiles: number;
  sample: {
    isTail: boolean;
    mahalanobisRadius: number;
    longitudinalTiles: number;
    lateralTiles: number;
  };
}

const SHARED_OUTCOME_MAX_ABS_NUMBER = 1_000_000;
const SHARED_OUTCOME_MAX_CLEARANCE = 30_800;
const SHARED_OUTCOME_MAX_RELIEF_CANDIDATES = 256;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function boundedFinite(
  value: unknown,
  minimum = -SHARED_OUTCOME_MAX_ABS_NUMBER,
  maximum = SHARED_OUTCOME_MAX_ABS_NUMBER,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function validPoint(value: unknown): value is Point {
  return record(value) && boundedFinite(value.x) && boundedFinite(value.y);
}

export { isValidAppliedShotWindV1 } from "./dispersionRuntime";

/** Strict guard for the additive bivariate replay certificate. */
export function isValidAppliedDispersionV1(value: unknown): value is AppliedDispersionV1 {
  if (!record(value) || value.version !== 1 || value.mode !== "bivariate_v1"
    || value.modelVersion !== BIVARIATE_DISPERSION_MODEL_VERSION
    || typeof value.clubId !== "string" || !dispersionClub(value.clubId)
    || !Number.isSafeInteger(value.seed)
    || !boundedFinite(value.effectiveDispersionTiles, .05, 16)
    || !boundedFinite(value.accuracy, 0, 100)
    || !boundedFinite(value.consistency, 0, 100)
    || !boundedFinite(value.centerlineLongitudinalTiles, -8, 8)
    || !boundedFinite(value.centerlineLateralInputTiles, -8, 8)
    || !boundedFinite(value.centerlineLateralTiles, -24, 24)
    || !boundedFinite(value.appliedWindLateralTiles, -8, 8)
    || value.centerlineLateralTiles !== Number((value.centerlineLateralInputTiles + value.appliedWindLateralTiles).toFixed(9))
    || !record(value.sample)
    || typeof value.sample.isTail !== "boolean"
    || !boundedFinite(value.sample.mahalanobisRadius, 0, 8)
    || !boundedFinite(value.sample.longitudinalTiles, -32, 32)
    || !boundedFinite(value.sample.lateralTiles, -32, 32)
  ) return false;
  return true;
}

/**
 * Reconstruct the compact certificate through the released resolver/sampler.
 * This keeps saved evidence fail-closed without storing a second copy of the
 * registry covariance table on every shot.
 */
function isCoherentAppliedDispersionV1(
  evidence: AppliedDispersionV1,
  appliedWind: AppliedShotWindV1 | undefined,
): boolean {
  const resolved = resolveBivariateDispersionShot({
    clubId: evidence.clubId,
    effectiveDispersionTiles: evidence.effectiveDispersionTiles,
    accuracy: evidence.accuracy,
    consistency: evidence.consistency,
    centerlineLongitudinalTiles: evidence.centerlineLongitudinalTiles,
    centerlineLateralTiles: evidence.centerlineLateralInputTiles,
    appliedWind,
  }, evidence.seed);
  return resolved != null
    && resolved.centerline.longitudinalTiles === evidence.centerlineLongitudinalTiles
    && resolved.centerline.lateralTiles === evidence.centerlineLateralTiles
    && resolved.appliedWindLateralTiles === evidence.appliedWindLateralTiles
    && resolved.sample.isTail === evidence.sample.isTail
    && resolved.sample.mahalanobisRadius === evidence.sample.mahalanobisRadius
    && resolved.sample.offset.longitudinalTiles === evidence.sample.longitudinalTiles
    && resolved.sample.offset.lateralTiles === evidence.sample.lateralTiles;
}

function validNullablePoint(value: unknown): value is Point | null {
  return value === null || validPoint(value);
}

function validClearanceEvidence(value: unknown): value is ShotClearanceEvidence {
  if (
    !record(value)
    || !validPoint(value.point)
    || !boundedFinite(value.pathHeightYards)
    || !boundedFinite(value.requiredHeightYards)
    || !boundedFinite(value.clearanceYards)
  ) {
    return false;
  }
  if (value.obstacleType != null && !["tree", "bush", "rock"].includes(String(value.obstacleType))) return false;
  if (value.relationship != null && !["around", "under", "over", "through"].includes(String(value.relationship))) return false;
  return value.horizontalClearanceYards == null || boundedFinite(value.horizontalClearanceYards, 0);
}

function validCollision(value: unknown): value is ShotCollision {
  if (!record(value) || !["none", "terrain", "obstacle"].includes(String(value.kind))) return false;
  if (value.kind === "none") return true;
  if (!validPoint(value.point) || !boundedFinite(value.distanceFromStartYards, 0)) return false;
  if (value.kind === "terrain") return typeof value.terrain === "string" && value.terrain.length <= 32;
  return ["tree", "bush", "rock"].includes(String(value.obstacleType))
    && validClearanceEvidence(value.clearance);
}

/** Strict runtime guard for optional persisted M50 ruling evidence. */
export function isValidShotRuling(value: unknown): value is ShotRuling {
  if (
    !record(value)
    || !["in_play", "holed", "penalty"].includes(String(value.status))
    || !["none", "out_of_bounds", "penalty_area"].includes(String(value.penaltyKind))
    || !Number.isSafeInteger(value.penaltyStrokes)
    || (value.penaltyStrokes as number) < 0
    || (value.penaltyStrokes as number) > 1
    || !validNullablePoint(value.referencePoint)
    || !validNullablePoint(value.crossingPoint)
  ) {
    return false;
  }
  if (
    value.penaltyComponentId !== null
    && (!Number.isSafeInteger(value.penaltyComponentId) || (value.penaltyComponentId as number) < 1)
  ) {
    return false;
  }
  if (
    value.penaltyAreaClassification !== null
    && value.penaltyAreaClassification !== "red"
    && value.penaltyAreaClassification !== "yellow"
  ) {
    return false;
  }
  const penalized = value.status === "penalty";
  return penalized
    ? value.penaltyStrokes === 1 && value.penaltyKind !== "none"
    : value.penaltyStrokes === 0 && value.penaltyKind === "none";
}

function validReliefCandidate(value: unknown): value is ReliefCandidate {
  return record(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 128
    && ["play_as_it_lies", "stroke_and_distance", "back_on_line", "lateral"].includes(String(value.type))
    && validPoint(value.position)
    && Number.isSafeInteger(value.order)
    && (value.order as number) >= 0
    && typeof value.legal === "boolean"
    && boundedFinite(value.distanceFromReferenceYards, 0);
}

/** Strict runtime guard for optional persisted M50 automatic-relief evidence. */
export function isValidReliefResolution(value: unknown): value is ReliefResolution {
  if (
    !record(value)
    || !["not_required", "resolved", "unavailable"].includes(String(value.status))
    || !["none", "play_as_it_lies", "stroke_and_distance", "back_on_line", "lateral"].includes(String(value.type))
    || !Array.isArray(value.candidates)
    || value.candidates.length > SHARED_OUTCOME_MAX_RELIEF_CANDIDATES
    || !value.candidates.every(validReliefCandidate)
    || !validNullablePoint(value.finalPosition)
  ) {
    return false;
  }
  const candidateIds = new Set(value.candidates.map((candidate) => candidate.id));
  if (candidateIds.size !== value.candidates.length) return false;
  if (value.candidates.some((candidate, index) => candidate.order !== index)) return false;
  if (value.status === "resolved") {
    if (typeof value.selectedCandidateId !== "string" || value.type === "none" || value.finalPosition === null) return false;
    const selected = value.candidates.find((candidate) => candidate.id === value.selectedCandidateId);
    return selected?.legal === true
      && selected.type === value.type
      && selected.position.x === value.finalPosition.x
      && selected.position.y === value.finalPosition.y;
  }
  return value.selectedCandidateId === null
    && value.type === "none"
    && (value.status === "not_required" ? value.finalPosition !== null : value.finalPosition === null);
}

/** Strict runtime guard for optional persisted M50 physical/rules payloads. */
export function isValidSharedShotOutcome(value: unknown): value is SharedShotOutcome {
  if (!record(value) || value.rulesVersion !== SHOT_RULES_CONTRACT_VERSION) return false;
  const lieEffect = value.lieEffect;
  if (
    !record(lieEffect)
    || typeof lieEffect.sourceLie !== "string"
    || typeof lieEffect.effectiveLie !== "string"
    || !boundedFinite(lieEffect.carryMultiplier, 0)
    || !boundedFinite(lieEffect.dispersionMultiplier, 0)
    || !boundedFinite(lieEffect.rollMultiplier, 0)
  ) {
    return false;
  }
  if (
    !boundedFinite(value.requestedCarryYards, 0)
    || !boundedFinite(value.effectiveCarryYards, 0)
    || !boundedFinite(value.requestedDispersionTiles, 0)
    || !boundedFinite(value.effectiveDispersionTiles, 0)
    || !record(value.flight)
    || !["low", "standard", "high"].includes(String(value.flight.profile))
    || !boundedFinite(value.flight.launchAngleDegrees)
    || !boundedFinite(value.flight.apexHeightYards, 0)
    || !validPoint(value.flight.apexPosition)
    || !validPoint(value.flight.carryEnd)
    || !Array.isArray(value.flight.clearance)
    || value.flight.clearance.length > SHARED_OUTCOME_MAX_CLEARANCE
    || !value.flight.clearance.every(validClearanceEvidence)
    || !validCollision(value.collision)
    || !validPoint(value.physicalRest)
    || !isValidShotRuling(value.ruling)
    || !isValidReliefResolution(value.relief)
    || !validPoint(value.finalPosition)
  ) {
    return false;
  }
  const appliedWind = value.appliedWind;
  if (appliedWind === null) return false;
  if (appliedWind !== undefined && !isValidAppliedShotWindV1(appliedWind)) return false;
  const appliedDispersion = value.appliedDispersion;
  if (appliedDispersion != null && (!isValidAppliedDispersionV1(appliedDispersion)
    || Number(appliedDispersion.effectiveDispersionTiles.toFixed(6)) !== value.requestedDispersionTiles
    || !isCoherentAppliedDispersionV1(appliedDispersion, appliedWind))) return false;
  if (appliedDispersion != null && appliedWind == null
    && appliedDispersion.appliedWindLateralTiles !== 0) return false;
  if (appliedDispersion != null && appliedWind != null
    && appliedDispersion.appliedWindLateralTiles !== appliedWind.lateralCenterlineTiles) return false;
  return value.relief.status !== "resolved"
    || (
      value.relief.finalPosition?.x === value.finalPosition.x
      && value.relief.finalPosition?.y === value.finalPosition.y
    );
}
