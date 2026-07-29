import type { Point } from "../models/types";
import type {
  ReliefCandidate,
  ReliefResolution,
  ReliefType,
  ShotRuling,
} from "./contracts";
import {
  distanceBetween,
  locatePenaltyAreaPoint,
  type PenaltyRulesSnapshot,
} from "./penaltyAreas";

export const MAX_RELIEF_CANDIDATES = 256 as const;
const RELIEF_EPSILON = 1e-9;

export interface ReliefCandidateSeed {
  id?: string;
  type: Exclude<ReliefType, "none">;
  position: Point;
  expectedNextShotCost: number;
}

export interface ReliefResolutionInput {
  snapshot: PenaltyRulesSnapshot;
  ruling: ShotRuling;
  hole: Point;
  physicalRest: Point;
  previousPosition: Point | null;
  clubLengthYards: number;
  candidates: readonly ReliefCandidateSeed[];
}

interface NormalizedCandidate {
  seed: ReliefCandidateSeed;
  id: string;
  legal: boolean;
  expectedNextShotCost: number;
  distanceFromReferenceYards: number;
}

const TYPE_ORDER: Record<Exclude<ReliefType, "none">, number> = {
  stroke_and_distance: 0,
  back_on_line: 1,
  lateral: 2,
  play_as_it_lies: 3,
};

function finitePoint(point: unknown): point is Point {
  if (typeof point !== "object" || point === null) return false;
  const value = point as { x?: unknown; y?: unknown };
  return typeof value.x === "number"
    && Number.isFinite(value.x)
    && typeof value.y === "number"
    && Number.isFinite(value.y);
}

function finiteCost(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(9)).toString();
}

function candidateId(seed: ReliefCandidateSeed): string {
  if (typeof seed.id === "string" && seed.id.trim().length > 0 && seed.id.length <= 128) return seed.id;
  return `${seed.type}:${formatCoordinate(seed.position.x)}:${formatCoordinate(seed.position.y)}`;
}

function allowedType(ruling: ShotRuling, type: ReliefType): boolean {
  if (ruling.status !== "penalty") return type === "play_as_it_lies";
  if (ruling.penaltyKind === "out_of_bounds") return type === "stroke_and_distance";
  if (ruling.penaltyAreaClassification === "yellow") return type === "stroke_and_distance" || type === "back_on_line";
  if (ruling.penaltyAreaClassification === "red") {
    return type === "stroke_and_distance" || type === "back_on_line" || type === "lateral";
  }
  return false;
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function isBackOnLine(candidate: Point, hole: Point, reference: Point): boolean {
  const fromHole = subtract(reference, hole);
  const fromReference = subtract(candidate, reference);
  const lineLength = Math.hypot(fromHole.x, fromHole.y);
  if (lineLength <= RELIEF_EPSILON) return false;
  return Math.abs(cross(fromHole, fromReference)) <= RELIEF_EPSILON * Math.max(1, lineLength)
    && fromHole.x * fromReference.x + fromHole.y * fromReference.y >= -RELIEF_EPSILON;
}

function notNearerHole(candidate: Point, hole: Point, reference: Point): boolean {
  return distanceBetween(candidate, hole) + RELIEF_EPSILON >= distanceBetween(reference, hole);
}

function stableCompare(a: NormalizedCandidate, b: NormalizedCandidate): number {
  if (a.legal !== b.legal) return a.legal ? -1 : 1;
  const cost = a.expectedNextShotCost - b.expectedNextShotCost;
  if (cost !== 0) return cost;
  const type = TYPE_ORDER[a.seed.type] - TYPE_ORDER[b.seed.type];
  if (type !== 0) return type;
  const distance = a.distanceFromReferenceYards - b.distanceFromReferenceYards;
  if (distance !== 0) return distance;
  const x = a.seed.position.x - b.seed.position.x;
  if (x !== 0) return x;
  const y = a.seed.position.y - b.seed.position.y;
  if (y !== 0) return y;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isSamePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= RELIEF_EPSILON && Math.abs(a.y - b.y) <= RELIEF_EPSILON;
}

/**
 * Validate, order, and resolve a bounded candidate set. Candidate generation
 * stays upstream so callers can use their authoritative geometry sampler;
 * this function owns the rules, legality, cost ordering, and tie-breaks.
 */
export function resolveRelief(input: ReliefResolutionInput): ReliefResolution {
  const reference = input.ruling.referencePoint ?? input.ruling.crossingPoint;
  const validInput = finitePoint(input.hole)
    && finitePoint(input.physicalRest)
    && (input.previousPosition === null || finitePoint(input.previousPosition))
    && Number.isFinite(input.clubLengthYards)
    && input.clubLengthYards > 0
    && Array.isArray(input.candidates)
    && input.candidates.length <= MAX_RELIEF_CANDIDATES;
  if (!validInput) return { status: "unavailable", type: "none", candidates: [], selectedCandidateId: null, finalPosition: null };

  const normalized: NormalizedCandidate[] = [];
  const seenKeys = new Map<string, NormalizedCandidate>();
  for (const seed of input.candidates) {
    if (!seed || !finitePoint(seed.position) || !finiteCost(seed.expectedNextShotCost)) continue;
    if (!Object.prototype.hasOwnProperty.call(TYPE_ORDER, seed.type)) continue;
    const id = candidateId(seed);
    const key = `${seed.type}|${formatCoordinate(seed.position.x)}|${formatCoordinate(seed.position.y)}`;
    const location = locatePenaltyAreaPoint(input.snapshot, seed.position);
    const mapLegal = location.ok && location.value.kind === "in_bounds";
    const typeLegal = allowedType(input.ruling, seed.type);
    let geometryLegal = true;
    if (seed.type === "stroke_and_distance") {
      geometryLegal = input.previousPosition !== null && isSamePoint(seed.position, input.previousPosition);
    } else if (seed.type === "play_as_it_lies") {
      geometryLegal = isSamePoint(seed.position, input.physicalRest);
    } else if (reference === null || !notNearerHole(seed.position, input.hole, reference)) {
      geometryLegal = false;
    } else if (seed.type === "back_on_line") {
      geometryLegal = isBackOnLine(seed.position, input.hole, reference);
    } else if (seed.type === "lateral") {
      geometryLegal = distanceBetween(seed.position, reference) <= 2 * input.clubLengthYards + RELIEF_EPSILON;
    }
    const candidate: NormalizedCandidate = {
      seed,
      id,
      legal: mapLegal && typeLegal && geometryLegal,
      expectedNextShotCost: seed.expectedNextShotCost,
      distanceFromReferenceYards: reference === null ? 0 : distanceBetween(seed.position, reference),
    };
    const prior = seenKeys.get(key);
    if (!prior || stableCompare(candidate, prior) < 0) seenKeys.set(key, candidate);
  }
  normalized.push(...seenKeys.values());
  normalized.sort(stableCompare);
  const candidates: ReliefCandidate[] = normalized.map((candidate, order) => ({
    id: candidate.id,
    type: candidate.seed.type,
    position: candidate.seed.position,
    order,
    legal: candidate.legal,
    distanceFromReferenceYards: candidate.distanceFromReferenceYards,
  }));
  const selectedIndex = normalized.findIndex((candidate) => candidate.legal);
  if (input.ruling.status !== "penalty") {
    return {
      status: "not_required",
      type: "none",
      candidates,
      selectedCandidateId: null,
      finalPosition: input.physicalRest,
    };
  }
  if (selectedIndex < 0) {
    return { status: "unavailable", type: "none", candidates, selectedCandidateId: null, finalPosition: null };
  }
  const selected = candidates[selectedIndex];
  return {
    status: "resolved",
    type: selected.type,
    candidates,
    selectedCandidateId: selected.id,
    finalPosition: selected.position,
  };
}

export function orderReliefCandidates(input: ReliefResolutionInput): readonly ReliefCandidate[] {
  return resolveRelief(input).candidates;
}
