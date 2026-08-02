import { BALANCE } from "../balance/balanceConfig";
import type { Point } from "./types";

/**
 * Stable, serializable slope facts captured when a shot is evaluated.  They
 * deliberately contain no course reference: a saved/complete shot must keep
 * its original lie even if the course is sculpted later.
 */
export const SHOT_SLOPE_CONTEXT_VERSION = 1 as const;

export type ShotHandedness = "right" | "left";
export type ShotSidehill = "flat" | "ball_above_feet" | "ball_below_feet";

/**
 * Elevation change per tile in the target-line coordinate system.
 * `crossTargetLine` is positive when the ground rises to the right of the
 * from → target line (screen/world coordinates: +x east, +y south).
 */
export interface ShotSlopeGradient {
  alongTargetLine: number;
  crossTargetLine: number;
}

export interface ShotSlopeContextV1 {
  version: typeof SHOT_SLOPE_CONTEXT_VERSION;
  flatDistanceYards: number;
  targetElevationDelta: number;
  playsLikeDistanceYards: number;
  localGradient: ShotSlopeGradient;
  handedness: ShotHandedness;
  sidehill: ShotSidehill;
  /**
   * A bounded lateral tendency in tiles. Negative is left of the target line,
   * positive is right. It is a natural-lie tendency only; technique and RNG
   * remain the owning systems for actual shot shape.
   */
  naturalCurveBiasTiles: number;
}

export type ShotSlopeContext = ShotSlopeContextV1;

/**
 * Optional carrier shape shared by new and legacy shot records. `slopeContext`
 * is accepted only as a read compatibility alias; new serializers emit
 * `shotSlope`.
 */
export interface ShotSlopeCompatible {
  shotSlope?: ShotSlopeContext;
  slopeContext?: ShotSlopeContext;
}

/** The minimal immutable elevation snapshot consumed by the analyzer. */
export interface FrozenCourseElevation {
  readonly width: number;
  readonly height: number;
  readonly elevations?: readonly number[] | Float64Array;
}

export interface AnalyzeShotSlopeInput {
  course: FrozenCourseElevation;
  from: Point;
  to: Point;
  yardsPerTile: number;
  handedness?: ShotHandedness;
  /** Kept injectable for deterministic balance experiments. */
  yardsPerElevationStep?: number;
}

const SIDEHILL_EPSILON = 0.025;
const MAX_NATURAL_CURVE_BIAS_TILES = 0.35;
const CURVE_BIAS_PER_CROSS_SLOPE = 0.18;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finitePositive(value: unknown, fallback: number): number {
  const result = finite(value, fallback);
  return result > 0 ? result : fallback;
}

function boundedCell(value: number, size: number): number {
  if (size < 1) return 0;
  return clamp(Math.round(finite(value)), 0, size - 1);
}

/**
 * Reads only from the supplied frozen grid. Coordinates are rounded to the
 * same tile center used by aimed shots and clamped at the edge, avoiding a
 * synthetic downhill gradient when a ball is beside the course boundary.
 */
export function elevationAtFrozenPoint(course: FrozenCourseElevation, point: Point): number {
  const width = Math.max(0, Math.floor(finite(course.width)));
  const height = Math.max(0, Math.floor(finite(course.height)));
  if (width < 1 || height < 1) return 0;
  const x = boundedCell(point.x, width);
  const y = boundedCell(point.y, height);
  return finite(course.elevations?.[y * width + x]);
}

function frozenGradient(course: FrozenCourseElevation, point: Point): { x: number; y: number } {
  const width = Math.max(0, Math.floor(finite(course.width)));
  const height = Math.max(0, Math.floor(finite(course.height)));
  if (width < 1 || height < 1) return { x: 0, y: 0 };
  const x = boundedCell(point.x, width);
  const y = boundedCell(point.y, height);
  const sample = (sampleX: number, sampleY: number) => elevationAtFrozenPoint(course, { x: sampleX, y: sampleY });
  const left = sample(Math.max(0, x - 1), y);
  const right = sample(Math.min(width - 1, x + 1), y);
  const up = sample(x, Math.max(0, y - 1));
  const down = sample(x, Math.min(height - 1, y + 1));
  // Divide by the actual sample span so edge gradients remain one-sided but
  // physically scaled like their interior neighbors.
  return {
    x: (right - left) / Math.max(1, Math.min(width - 1, x + 1) - Math.max(0, x - 1)),
    y: (down - up) / Math.max(1, Math.min(height - 1, y + 1) - Math.max(0, y - 1)),
  };
}

function freezeContext(context: ShotSlopeContextV1): ShotSlopeContextV1 {
  return Object.freeze({
    ...context,
    localGradient: Object.freeze({ ...context.localGradient }),
  });
}

/**
 * The single authoritative shot-slope analyzer. Its output is independent of
 * mutable course objects, deterministic, and safe to persist with a shot.
 */
export function analyzeShotSlope(input: AnalyzeShotSlopeInput): ShotSlopeContextV1 {
  const handedness: ShotHandedness = input.handedness === "left" ? "left" : "right";
  const dx = finite(input.to.x) - finite(input.from.x);
  const dy = finite(input.to.y) - finite(input.from.y);
  const distanceTiles = Math.hypot(dx, dy);
  const flatDistanceYards = distanceTiles * finitePositive(input.yardsPerTile, 10);
  const unitX = distanceTiles > 1e-9 ? dx / distanceTiles : 1;
  const unitY = distanceTiles > 1e-9 ? dy / distanceTiles : 0;
  const targetElevationDelta = elevationAtFrozenPoint(input.course, input.to)
    - elevationAtFrozenPoint(input.course, input.from);
  const stepYards = finitePositive(input.yardsPerElevationStep, BALANCE.elevation.shotYardsPerStep);
  const playsLikeDistanceYards = Math.max(
    flatDistanceYards * 0.5,
    flatDistanceYards + targetElevationDelta * stepYards,
  );
  const gradient = frozenGradient(input.course, input.from);
  const localGradient: ShotSlopeGradient = {
    alongTargetLine: gradient.x * unitX + gradient.y * unitY,
    crossTargetLine: gradient.x * -unitY + gradient.y * unitX,
  };
  const handednessSign = handedness === "right" ? 1 : -1;
  const playerRelativeCrossSlope = localGradient.crossTargetLine * handednessSign;
  const sidehill: ShotSidehill = playerRelativeCrossSlope > SIDEHILL_EPSILON
    ? "ball_above_feet"
    : playerRelativeCrossSlope < -SIDEHILL_EPSILON
      ? "ball_below_feet"
      : "flat";
  const naturalCurveBiasTiles = sidehill === "flat"
    ? 0
    : clamp(
        -handednessSign * Math.sign(playerRelativeCrossSlope) * Math.abs(localGradient.crossTargetLine)
          * CURVE_BIAS_PER_CROSS_SLOPE,
        -MAX_NATURAL_CURVE_BIAS_TILES,
        MAX_NATURAL_CURVE_BIAS_TILES,
      );

  return freezeContext({
    version: SHOT_SLOPE_CONTEXT_VERSION,
    flatDistanceYards,
    targetElevationDelta,
    playsLikeDistanceYards,
    localGradient,
    handedness,
    sidehill,
    naturalCurveBiasTiles,
  });
}

/** Compatibility spelling for consumers that name their value a context. */
export const analyzeShotSlopeContext = analyzeShotSlope;

/**
 * Produces a canonical, JSON-safe V1 context. Invalid optional payloads are
 * ignored rather than changing historical shot outcomes during a save load.
 */
export function normalizeShotSlopeContext(value: unknown): ShotSlopeContextV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const gradient = candidate.localGradient;
  if (
    candidate.version !== SHOT_SLOPE_CONTEXT_VERSION
    || !gradient || typeof gradient !== "object" || Array.isArray(gradient)
    || (candidate.handedness !== "right" && candidate.handedness !== "left")
    || !["flat", "ball_above_feet", "ball_below_feet"].includes(String(candidate.sidehill))
  ) return undefined;
  const local = gradient as Record<string, unknown>;
  const numbers = [
    candidate.flatDistanceYards,
    candidate.targetElevationDelta,
    candidate.playsLikeDistanceYards,
    local.alongTargetLine,
    local.crossTargetLine,
    candidate.naturalCurveBiasTiles,
  ];
  if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) return undefined;
  return freezeContext({
    version: SHOT_SLOPE_CONTEXT_VERSION,
    flatDistanceYards: candidate.flatDistanceYards as number,
    targetElevationDelta: candidate.targetElevationDelta as number,
    playsLikeDistanceYards: Math.max(0, candidate.playsLikeDistanceYards as number),
    localGradient: {
      alongTargetLine: local.alongTargetLine as number,
      crossTargetLine: local.crossTargetLine as number,
    },
    handedness: candidate.handedness,
    sidehill: candidate.sidehill as ShotSidehill,
    naturalCurveBiasTiles: clamp(candidate.naturalCurveBiasTiles as number, -MAX_NATURAL_CURVE_BIAS_TILES, MAX_NATURAL_CURVE_BIAS_TILES),
  });
}

/** Explicit adapter for save/trace serializers; field order is deliberate. */
export function serializeShotSlopeContext(context: ShotSlopeContext): ShotSlopeContextV1 {
  const normalized = normalizeShotSlopeContext(context);
  if (!normalized) throw new Error("Cannot serialize an invalid shot-slope context.");
  return {
    version: normalized.version,
    flatDistanceYards: normalized.flatDistanceYards,
    targetElevationDelta: normalized.targetElevationDelta,
    playsLikeDistanceYards: normalized.playsLikeDistanceYards,
    localGradient: {
      alongTargetLine: normalized.localGradient.alongTargetLine,
      crossTargetLine: normalized.localGradient.crossTargetLine,
    },
    handedness: normalized.handedness,
    sidehill: normalized.sidehill,
    naturalCurveBiasTiles: normalized.naturalCurveBiasTiles,
  };
}

/**
 * Deterministic adapter for a persisted shot-like record. Records with no
 * slope data are returned unchanged, preserving historical shots byte-for-
 * byte; malformed optional data is discarded without invalidating the shot.
 */
export function normalizeShotSlopeCarrier<T extends Record<string, unknown>>(record: T): T & { shotSlope?: ShotSlopeContextV1 } {
  if (!("shotSlope" in record) && !("slopeContext" in record)) return record;
  const context = normalizeShotSlopeContext(record.shotSlope ?? record.slopeContext);
  const { slopeContext: _legacySlopeContext, shotSlope: _shotSlope, ...rest } = record;
  return (context
    ? { ...rest, shotSlope: serializeShotSlopeContext(context) }
    : rest) as T & { shotSlope?: ShotSlopeContextV1 };
}
