import type { Point } from "../models/types";
import type { PlayerShotTrace } from "../models/playerProTypes";
import type { CalculatedShotEffects } from "./shotEffects";
import {
  deriveShotRuling,
  distanceBetween,
  type PenaltyRulesSnapshot,
} from "./penaltyAreas";
import {
  decodeControlledRoundSnapshotV2,
  type ControlledRoundSnapshotV2,
  type HolePenaltyClassification,
} from "./roundSnapshot";
import type {
  ReliefResolution,
  ShotRuling,
  SharedShotOutcome,
} from "./contracts";
import {
  resolveObstacleCollision,
  type ObstacleCollisionInput,
} from "./obstacleCollision";
import {
  resolveRelief,
  type ReliefCandidateSeed,
} from "./relief";

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function midpoint(from: Point, to: Point): Point {
  return {
    x: rounded(from.x + (to.x - from.x) * 0.5),
    y: rounded(from.y + (to.y - from.y) * 0.5),
  };
}

function fallbackRuling(args: {
  holed: boolean;
  legacyPenaltyStrokes: number;
}): ShotRuling {
  const penalty = args.legacyPenaltyStrokes > 0;
  return {
    status: args.holed ? "holed" : penalty ? "penalty" : "in_play",
    penaltyKind: penalty ? "penalty_area" : "none",
    penaltyStrokes: penalty ? 1 : 0,
    penaltyComponentId: null,
    penaltyAreaClassification: null,
    referencePoint: null,
    crossingPoint: null,
  };
}

function fallbackRelief(args: {
  ruling: ShotRuling;
  physicalRest: Point;
}): ReliefResolution {
  if (args.ruling.status !== "penalty") {
    return {
      status: "not_required",
      type: "none",
      candidates: [],
      selectedCandidateId: null,
      finalPosition: args.physicalRest,
    };
  }
  return {
    status: "unavailable",
    type: "none",
    candidates: [],
    selectedCandidateId: null,
    finalPosition: null,
  };
}

function holeClassification(
  snapshot: ControlledRoundSnapshotV2,
  holeId: string,
): HolePenaltyClassification | null {
  return snapshot.holeClassifications.find((candidate) => candidate.holeId === holeId) ?? null;
}

function unitDirection(from: Point, to: Point): Point | null {
  const length = distanceBetween(from, to);
  if (!Number.isFinite(length) || length <= 1e-9) return null;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

function candidatePoint(base: Point, direction: Point, distance: number): Point {
  return {
    x: rounded(base.x + direction.x * distance),
    y: rounded(base.y + direction.y * distance),
  };
}

/**
 * Produce a small, stable candidate set. `resolveRelief` remains the sole
 * owner of legality and selection; this function only supplies geometry seeds.
 */
export function generateReliefCandidateSeeds(args: {
  ruling: ShotRuling;
  hole: Point;
  physicalRest: Point;
  previousPosition: Point | null;
  clubLengthTiles: number;
}): readonly ReliefCandidateSeed[] {
  const candidates: ReliefCandidateSeed[] = [];
  if (args.previousPosition !== null) {
    candidates.push({
      id: "stroke-and-distance",
      type: "stroke_and_distance",
      position: { ...args.previousPosition },
      expectedNextShotCost: 100 + distanceBetween(args.previousPosition, args.hole),
    });
  }

  const reference = args.ruling.referencePoint ?? args.ruling.crossingPoint;
  const direction = reference ? unitDirection(args.hole, reference) : null;
  if (reference && direction) {
    const scale = Math.max(0.25, Math.min(1, args.clubLengthTiles));
    for (const [index, multiplier] of [0, 0.5, 1, 2].entries()) {
      const position = candidatePoint(reference, direction, scale * multiplier);
      candidates.push({
        id: `back-on-line-${index}`,
        type: "back_on_line",
        position,
        expectedNextShotCost: 2 + distanceBetween(position, args.hole) / 100,
      });
    }

    const perpendicular = { x: -direction.y, y: direction.x };
    const lateralDistance = Math.max(0.25, Math.min(args.clubLengthTiles, 4));
    for (const [index, sign] of [-1, 1, -2, 2].entries()) {
      const position = candidatePoint(reference, perpendicular, lateralDistance * sign / Math.abs(sign));
      candidates.push({
        id: `lateral-${index}`,
        type: "lateral",
        position,
        expectedNextShotCost: 1 + distanceBetween(position, args.hole) / 100,
      });
    }
  }
  return candidates;
}

export interface SharedRulesResolution {
  ruling: ShotRuling;
  relief: ReliefResolution;
  finalPosition: Point;
  usedFrozenSnapshot: boolean;
}

/** Resolve the frozen map and relief contract without throwing on old saves. */
export function resolveSharedRules(args: {
  rulesSnapshot?: unknown;
  holeId: string;
  hole: Point;
  previousPosition: Point | null;
  physicalRest: Point;
  rollPath: readonly Point[];
  clubLengthTiles: number;
  holed: boolean;
  legacyPenaltyStrokes?: number;
}): SharedRulesResolution {
  const fallback = (): SharedRulesResolution => {
    const ruling = fallbackRuling({
      holed: args.holed,
      legacyPenaltyStrokes: args.legacyPenaltyStrokes ?? 0,
    });
    const relief = fallbackRelief({ ruling, physicalRest: args.physicalRest });
    return {
      ruling,
      relief,
      finalPosition: args.physicalRest,
      usedFrozenSnapshot: false,
    };
  };

  const decoded = decodeControlledRoundSnapshotV2(args.rulesSnapshot);
  if (!decoded.ok) return fallback();
  const classification = holeClassification(decoded.value.snapshot, args.holeId);
  if (!classification) return fallback();
  const rulesSnapshot: PenaltyRulesSnapshot = {
    width: decoded.value.snapshot.width,
    height: decoded.value.snapshot.height,
    inBounds: decoded.value.inBounds,
    penaltyComponents: decoded.value.penaltyComponents,
    components: decoded.value.components,
  };
  const derived = deriveShotRuling({
    snapshot: rulesSnapshot,
    holeClassification: classification,
    rollPath: args.rollPath,
  });
  if (!derived.ok) return fallback();
  const ruling: ShotRuling = args.holed && derived.value.status === "in_play"
    ? { ...derived.value, status: "holed" }
    : derived.value;
  const candidates = ruling.status === "penalty"
    ? generateReliefCandidateSeeds({ ...args, ruling })
    : [];
  const relief = resolveRelief({
    snapshot: rulesSnapshot,
    ruling,
    hole: args.hole,
    physicalRest: args.physicalRest,
    previousPosition: args.previousPosition,
    clubLengthYards: Math.max(0.25, args.clubLengthTiles),
    candidates,
  });
  return {
    ruling,
    relief,
    finalPosition: relief.status === "resolved" && relief.finalPosition
      ? relief.finalPosition
      : args.physicalRest,
    usedFrozenSnapshot: true,
  };
}

/**
 * Adapts physical shot effects and the resolved M50 rules result into the
 * shared payload consumed by Player Pro, live rounds, previews, and replays.
 */
export function createSharedShotOutcome(args: {
  trace: PlayerShotTrace;
  effects: CalculatedShotEffects;
  requestedCarryYards: number;
  requestedDispersionTiles: number;
  physicalRest?: Point;
  ruling?: ShotRuling;
  relief?: ReliefResolution;
  finalPosition?: Point;
  /** Optional frozen physical context for authoritative terrain/obstacle checks. */
  obstacleCollision?: Omit<ObstacleCollisionInput, "from" | "to" | "flight">;
}): SharedShotOutcome {
  const { trace, effects } = args;
  const ruling = args.ruling ?? fallbackRuling({ holed: trace.holed, legacyPenaltyStrokes: trace.penaltyStrokes });
  const relief = args.relief ?? fallbackRelief({ ruling, physicalRest: trace.rest });
  const finalPosition = args.finalPosition ?? trace.rest;
  const obstacleResolution = args.obstacleCollision
    ? resolveObstacleCollision({
      ...args.obstacleCollision,
      from: trace.from,
      to: trace.landing,
      flight: {
        profile: effects.flight.profile,
        apexHeightYards: effects.flight.apexHeightYards,
      },
    })
    : null;
  return {
    rulesVersion: 1,
    lieEffect: effects.lieEffect,
    requestedCarryYards: rounded(args.requestedCarryYards),
    effectiveCarryYards: rounded(trace.carryYards),
    requestedDispersionTiles: rounded(args.requestedDispersionTiles),
    effectiveDispersionTiles: rounded(effects.dispersionTiles),
    flight: {
      profile: effects.flight.profile,
      launchAngleDegrees: effects.flight.launchAngleDegrees,
      apexHeightYards: effects.flight.apexHeightYards,
      apexPosition: midpoint(trace.from, trace.landing),
      carryEnd: { ...trace.landing },
      clearance: obstacleResolution?.clearance ?? [],
    },
    collision: obstacleResolution?.collision ?? { kind: "none" },
    physicalRest: { ...(args.physicalRest ?? trace.rest) },
    ruling,
    relief,
    finalPosition: { ...finalPosition },
  };
}
