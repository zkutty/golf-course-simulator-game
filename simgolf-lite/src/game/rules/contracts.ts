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
