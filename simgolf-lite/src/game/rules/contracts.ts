import type { ObstacleType, Point, Terrain } from "../models/types";

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
}

export type SharedShotOutcome = ShotOutcome;

const SHARED_OUTCOME_MAX_ABS_NUMBER = 1_000_000;
const SHARED_OUTCOME_MAX_CLEARANCE = 30_800;
const SHARED_OUTCOME_MAX_RELIEF_CANDIDATES = 256;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function boundedFinite(value: unknown, minimum = -SHARED_OUTCOME_MAX_ABS_NUMBER): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= SHARED_OUTCOME_MAX_ABS_NUMBER;
}

function validPoint(value: unknown): value is Point {
  return record(value) && boundedFinite(value.x) && boundedFinite(value.y);
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
  return value.relief.status !== "resolved"
    || (
      value.relief.finalPosition?.x === value.finalPosition.x
      && value.relief.finalPosition?.y === value.finalPosition.y
    );
}
