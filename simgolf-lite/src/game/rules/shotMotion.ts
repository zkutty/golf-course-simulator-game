import type { ObstacleType, Point } from "../models/types";
import {
  FLIGHT_SAMPLE_STEP_TILES,
  MAX_RETAINED_FLIGHT_DIVISIONS,
  isValidAuthoritativeFlightGeometryV1,
  sampleAuthoritativeFlightGeometry,
  type RetainedFlightResolutionV1,
} from "./obstacleCollision";

export const SHOT_MOTION_CONTRACT_VERSION = 1 as const;
export const MAX_SHOT_MOTION_PATH_POINTS = 2048;
export const MAX_SHOT_MOTION_EVENTS = 16;
const MAX_NUMBER = 1_000_000;
const EPSILON = 0.000002;

export interface ShotMotionPositionV1 {
  point: Point;
  /** Absolute height above the frozen course datum, in yards. */
  heightYards: number;
}

export interface ShotMotionIdentityV1 {
  shotId: string;
  holeId: string;
  shotNumber: number;
  seed: number;
  club: string;
  style: string;
  /** Frozen owning shot model, including collision/shape policy. */
  modelVersion: string;
}

export interface ShotMotionSampleV1 extends ShotMotionPositionV1 {
  /** Normalized time within this committed shot, not elapsed wall time. */
  time: number;
}

export type ShotMotionEventKind = "launch" | "collision" | "first_contact" | "rest" | "hole_out";

export interface ShotMotionEventV1 extends ShotMotionSampleV1 {
  kind: ShotMotionEventKind;
  /** Explicit association to the owning retained path, never nearest matching. */
  source: "flight" | "post_collision" | "ground";
  sourceIndex: number;
}

export interface RetainedShotMotionV1 {
  version: typeof SHOT_MOTION_CONTRACT_VERSION;
  identity: ShotMotionIdentityV1;
  units: { horizontal: "tiles"; height: "yards"; time: "normalized"; yardsPerTile: number };
  from: ShotMotionPositionV1;
  landing: ShotMotionPositionV1;
  physicalRest: ShotMotionPositionV1;
  /** Rules relocation is a separate static marker, outside physical motion. */
  reliefPosition: Point | null;
  facts: { launchAngleDegrees: number | null; landingAngleDegrees: number | null; spin: string | null };
  flight: (RetainedFlightResolutionV1 & { endTime: number }) | null;
  /** Only committed collision response geometry; no generated rebound/bounce. */
  postCollisionPath: readonly ShotMotionSampleV1[];
  /** Original resolved rollout vertices with frozen heights and timing. */
  groundPath: readonly ShotMotionSampleV1[];
  events: readonly ShotMotionEventV1[];
}

export interface CreateRetainedShotMotionInput {
  identity: ShotMotionIdentityV1;
  yardsPerTile: number;
  from: ShotMotionPositionV1;
  landing: ShotMotionPositionV1;
  physicalRest: ShotMotionPositionV1;
  flight: RetainedFlightResolutionV1 | null;
  rollPath: readonly ShotMotionPositionV1[];
  postCollisionPath?: readonly ShotMotionPositionV1[];
  reliefPosition?: Point | null;
  holed: boolean;
  facts?: RetainedShotMotionV1["facts"];
  /** Frozen normalized scheduling policy; this is not a second physics solve. */
  timing?: { flightEnd: number; landing: number };
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function keys(value: Record<string, unknown>, allowed: readonly string[], required = allowed): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}

function finite(value: unknown, minimum = -MAX_NUMBER, maximum = MAX_NUMBER): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function label(value: unknown, maximum = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && Array.from(value).every((character) => character.charCodeAt(0) >= 32);
}

function point(value: unknown): value is Point {
  return record(value) && keys(value, ["x", "y"]) && finite(value.x) && finite(value.y);
}

function position(value: unknown): value is ShotMotionPositionV1 {
  return record(value) && keys(value, ["point", "heightYards"]) && point(value.point) && finite(value.heightYards);
}

function sample(value: unknown): value is ShotMotionSampleV1 {
  return record(value) && keys(value, ["point", "heightYards", "time"])
    && point(value.point) && finite(value.heightYards) && finite(value.time, 0, 1);
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function samePosition(a: ShotMotionPositionV1, b: ShotMotionPositionV1): boolean {
  return samePoint(a.point, b.point) && Math.abs(a.heightYards - b.heightYards) <= EPSILON;
}

function copyPosition(value: ShotMotionPositionV1): ShotMotionPositionV1 {
  return { point: { ...value.point }, heightYards: value.heightYards };
}

function flightPosition(flight: RetainedFlightResolutionV1, index: number): ShotMotionPositionV1 {
  const source = sampleAuthoritativeFlightGeometry(flight.geometry, index / flight.sampleDivisions);
  return { point: source.point, heightYards: source.pathHeightYards };
}

function obstacleType(value: unknown): value is ObstacleType {
  return value === "tree" || value === "rock" || value === "bush";
}

function validCollision(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === "none") return keys(value, ["kind"]);
  if (!point(value.point) || !finite(value.distanceFromStartYards, 0)) return false;
  if (value.kind === "terrain") {
    return keys(value, ["kind", "point", "terrain", "distanceFromStartYards"])
      && typeof value.terrain === "string"
      && ["rough", "deep_rough", "fairway", "green", "tee", "water", "wetland", "sand", "waste_area", "path", "out_of_play"].includes(value.terrain);
  }
  if (value.kind !== "obstacle" || !obstacleType(value.obstacleType) || !record(value.clearance)) return false;
  const clearance = value.clearance;
  return keys(value, ["kind", "point", "obstacleType", "distanceFromStartYards", "clearance"])
    && keys(clearance, ["point", "pathHeightYards", "requiredHeightYards", "clearanceYards", "obstacleType", "relationship", "horizontalClearanceYards"],
      ["point", "pathHeightYards", "requiredHeightYards", "clearanceYards", "obstacleType", "relationship"])
    && point(clearance.point) && samePoint(value.point, clearance.point)
    && finite(clearance.pathHeightYards) && finite(clearance.requiredHeightYards) && finite(clearance.clearanceYards)
    && clearance.obstacleType === value.obstacleType && clearance.relationship === "through"
    && (clearance.horizontalClearanceYards === undefined || finite(clearance.horizontalClearanceYards, 0));
}

/** Validates the compact source association without consulting current terrain. */
export function isValidRetainedFlightResolutionV1(value: unknown): value is RetainedFlightResolutionV1 {
  if (!record(value) || !keys(value, ["geometry", "sampleDivisions", "endSampleIndex", "collision", "obstacle"],
    ["geometry", "sampleDivisions", "endSampleIndex", "collision"])
    || !isValidAuthoritativeFlightGeometryV1(value.geometry)
    || !Number.isSafeInteger(value.sampleDivisions) || !finite(value.sampleDivisions, 1, MAX_RETAINED_FLIGHT_DIVISIONS)
    || !Number.isSafeInteger(value.endSampleIndex) || !finite(value.endSampleIndex, 0, value.sampleDivisions)
    || !validCollision(value.collision)) return false;
  const geometry = value.geometry;
  const expectedDivisions = Math.max(1, Math.ceil((Math.hypot(geometry.to.x - geometry.from.x, geometry.to.y - geometry.from.y)
    + 4 * Math.abs(geometry.curve?.lateralOffsetTiles ?? 0)) / FLIGHT_SAMPLE_STEP_TILES));
  if (value.sampleDivisions !== expectedDivisions) return false;
  const collision = value.collision as Record<string, unknown>;
  if (collision.kind === "none") return value.endSampleIndex === value.sampleDivisions && value.obstacle === undefined;
  const endpoint = flightPosition(value as unknown as RetainedFlightResolutionV1, value.endSampleIndex);
  if (!samePoint(endpoint.point, collision.point as Point)) return false;
  if (collision.kind === "terrain") return value.obstacle === undefined;
  if (!record(value.obstacle) || !keys(value.obstacle, ["x", "y", "type"])
    || !finite(value.obstacle.x) || !finite(value.obstacle.y) || value.obstacle.type !== collision.obstacleType) return false;
  return Math.abs(endpoint.heightYards - (collision.clearance as Record<string, number>).pathHeightYards) <= EPSILON;
}

function timedPath(path: readonly ShotMotionPositionV1[], start: number, end: number, yardsPerTile = 1): ShotMotionSampleV1[] {
  const distances = path.map((value, index) => index === 0 ? 0 : Math.hypot(
    (value.point.x - path[index - 1]!.point.x) * yardsPerTile,
    (value.point.y - path[index - 1]!.point.y) * yardsPerTile,
    value.heightYards - path[index - 1]!.heightYards,
  ));
  const rawTotal = distances.reduce((sum, value) => sum + value, 0);
  // Keep stationary source vertices, with strictly increasing retained times.
  const weights = distances.map((distance, index) => index === 0 ? 0 : distance + (rawTotal > 0 ? rawTotal * 1e-9 : 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let distance = 0;
  return path.map((value, index) => {
    distance += weights[index]!;
    const progress = index === path.length - 1 ? 1 : total > 0 ? distance / total : index / Math.max(1, path.length - 1);
    return { ...copyPosition(value), time: start + (end - start) * progress };
  });
}

function validPath(value: unknown, minimum: number): value is readonly ShotMotionSampleV1[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_SHOT_MOTION_PATH_POINTS) return false;
  return Array.from(value).every((entry, index) => sample(entry) && (index === 0 || entry.time > value[index - 1].time));
}

function event(kind: ShotMotionEventKind, source: ShotMotionEventV1["source"], sourceIndex: number, value: ShotMotionSampleV1): ShotMotionEventV1 {
  return { ...copyPosition(value), time: value.time, kind, source, sourceIndex };
}

function expectedEvents(motion: Omit<RetainedShotMotionV1, "events">, holed: boolean): ShotMotionEventV1[] {
  const events: ShotMotionEventV1[] = [event("launch", motion.flight ? "flight" : "ground", 0, { ...motion.from, time: 0 })];
  if (motion.flight && motion.flight.collision.kind !== "none") {
    events.push(event("collision", "flight", motion.flight.endSampleIndex, {
      ...flightPosition(motion.flight, motion.flight.endSampleIndex), time: motion.flight.endTime,
    }));
  }
  const firstGround = motion.groundPath[0]!;
  events.push(event("first_contact", "ground", 0, firstGround));
  events.push(event(holed ? "hole_out" : "rest", "ground", motion.groundPath.length - 1, motion.groundPath[motion.groundPath.length - 1]!));
  return events;
}

/**
 * Freeze already resolved geometry. Missing paths (including automatic putt
 * counts and legacy saves) stay unavailable. No collision, rollout or RNG here.
 */
export function createRetainedShotMotion(input: CreateRetainedShotMotionInput): RetainedShotMotionV1 | null {
  if (!record(input) || !finite(input.yardsPerTile, .001, 1000) || !position(input.from) || !position(input.landing) || !position(input.physicalRest)
    || !Array.isArray(input.rollPath) || input.rollPath.length < 1 || input.rollPath.length > MAX_SHOT_MOTION_PATH_POINTS
    || !Array.from(input.rollPath).every(position) || !samePosition(input.rollPath[0]!, input.landing)
    || !samePosition(input.rollPath[input.rollPath.length - 1]!, input.physicalRest)
    || typeof input.holed !== "boolean") return null;
  const contactPath = input.postCollisionPath ?? [];
  if (!Array.isArray(contactPath) || contactPath.length > MAX_SHOT_MOTION_PATH_POINTS || !Array.from(contactPath).every(position)) return null;
  if (input.flight !== null && !isValidRetainedFlightResolutionV1(input.flight)) return null;
  const flightEnd = input.flight ? input.timing?.flightEnd ?? (contactPath.length ? .6 : .72) : 0;
  const landingTime = input.flight ? input.timing?.landing ?? .72 : 0;
  if (!finite(flightEnd, 0, 1) || !finite(landingTime, 0, 1) || landingTime >= 1 || flightEnd > landingTime
    || (input.flight !== null && flightEnd <= 0)) return null;
  if (input.flight) {
    if (!samePosition(input.from, flightPosition(input.flight, 0))) return null;
    const impact = flightPosition(input.flight, input.flight.endSampleIndex);
    if (contactPath.length > 0) {
      if (input.flight.collision.kind === "none" || contactPath.length < 2 || flightEnd >= landingTime
        || !samePosition(contactPath[0]!, impact) || !samePosition(contactPath[contactPath.length - 1]!, input.landing)) return null;
    } else if (flightEnd !== landingTime || !samePosition(impact, input.landing)) return null;
  } else if (contactPath.length || !samePosition(input.from, input.landing)) return null;
  const identity = { ...input.identity };
  const base: Omit<RetainedShotMotionV1, "events"> = {
    version: SHOT_MOTION_CONTRACT_VERSION,
    identity,
    units: { horizontal: "tiles", height: "yards", time: "normalized", yardsPerTile: input.yardsPerTile },
    from: copyPosition(input.from), landing: copyPosition(input.landing), physicalRest: copyPosition(input.physicalRest),
    reliefPosition: input.reliefPosition ? { ...input.reliefPosition } : null,
    facts: input.facts ? { ...input.facts } : { launchAngleDegrees: null, landingAngleDegrees: null, spin: null },
    flight: input.flight ? structuredClone({ ...input.flight, endTime: flightEnd }) : null,
    postCollisionPath: timedPath(contactPath, flightEnd, landingTime, input.yardsPerTile),
    groundPath: timedPath(input.rollPath.length === 1 ? [input.rollPath[0]!, input.rollPath[0]!] : input.rollPath, landingTime, 1, input.yardsPerTile),
  };
  const motion: RetainedShotMotionV1 = { ...base, events: expectedEvents(base, input.holed) };
  return isValidRetainedShotMotionV1(motion) ? motion : null;
}

/** Strict, finite, bounded JSON carrier guard with origin/event/end coherence. */
export function isValidRetainedShotMotionV1(value: unknown): value is RetainedShotMotionV1 {
  if (!record(value) || !keys(value, ["version", "identity", "units", "from", "landing", "physicalRest", "reliefPosition", "facts", "flight", "postCollisionPath", "groundPath", "events"])
    || value.version !== SHOT_MOTION_CONTRACT_VERSION || !record(value.identity)
    || !keys(value.identity, ["shotId", "holeId", "shotNumber", "seed", "club", "style", "modelVersion"])
    || !label(value.identity.shotId) || !label(value.identity.holeId) || !label(value.identity.club, 64)
    || !label(value.identity.style, 64) || !label(value.identity.modelVersion, 64)
    || !Number.isSafeInteger(value.identity.shotNumber) || !finite(value.identity.shotNumber, 1, 4096)
    || !Number.isSafeInteger(value.identity.seed) || !finite(value.identity.seed, 0, 0xffffffff)
    || !record(value.units) || !keys(value.units, ["horizontal", "height", "time", "yardsPerTile"])
    || value.units.horizontal !== "tiles" || value.units.height !== "yards" || value.units.time !== "normalized"
    || !finite(value.units.yardsPerTile, .001, 1000)
    || !position(value.from) || !position(value.landing) || !position(value.physicalRest)
    || (value.reliefPosition !== null && !point(value.reliefPosition))
    || !record(value.facts) || !keys(value.facts, ["launchAngleDegrees", "landingAngleDegrees", "spin"])
    || (value.facts.launchAngleDegrees !== null && !finite(value.facts.launchAngleDegrees, 0, 90))
    || (value.facts.landingAngleDegrees !== null && !finite(value.facts.landingAngleDegrees, 0, 90))
    || (value.facts.spin !== null && !label(value.facts.spin, 64))
    || !validPath(value.groundPath, 2) || !validPath(value.postCollisionPath, 0)) return false;
  let flight: RetainedShotMotionV1["flight"] = null;
  if (value.flight !== null) {
    if (!record(value.flight) || !keys(value.flight, ["geometry", "sampleDivisions", "endSampleIndex", "collision", "obstacle", "endTime"],
      ["geometry", "sampleDivisions", "endSampleIndex", "collision", "endTime"])
      || !finite(value.flight.endTime, 0, 1) || value.flight.endTime <= 0) return false;
    const { endTime: _time, ...resolution } = value.flight;
    if (!isValidRetainedFlightResolutionV1(resolution)) return false;
    flight = value.flight as unknown as RetainedShotMotionV1["flight"];
  }
  const ground = value.groundPath;
  const contact = value.postCollisionPath;
  if (!samePosition(ground[0]!, value.landing) || !samePosition(ground[ground.length - 1]!, value.physicalRest)
    || ground[ground.length - 1]!.time !== 1) return false;
  if (flight) {
    if (!samePosition(value.from, flightPosition(flight, 0))) return false;
    const impact = flightPosition(flight, flight.endSampleIndex);
    if (contact.length) {
      if (contact.length < 2 || flight.collision.kind === "none" || contact[0]!.time !== flight.endTime
        || !samePosition(contact[0]!, impact) || contact[contact.length - 1]!.time !== ground[0]!.time
        || !samePosition(contact[contact.length - 1]!, value.landing)) return false;
    } else if (ground[0]!.time !== flight.endTime || !samePosition(value.landing, impact)) return false;
  } else if (contact.length || ground[0]!.time !== 0 || !samePosition(value.from, value.landing)) return false;
  if (!Array.isArray(value.events) || value.events.length > MAX_SHOT_MOTION_EVENTS || value.events.length < 3) return false;
  const motion = value as unknown as RetainedShotMotionV1;
  const finalEvent = motion.events[motion.events.length - 1]!;
  if (!record(finalEvent) || (finalEvent.kind !== "rest" && finalEvent.kind !== "hole_out")) return false;
  const expected = expectedEvents(motion, finalEvent.kind === "hole_out");
  return value.events.length === expected.length && Array.from(value.events).every((entry, index) => {
    if (!record(entry) || !keys(entry, ["point", "heightYards", "time", "kind", "source", "sourceIndex"])) return false;
    const target = expected[index]!;
    return point(entry.point) && finite(entry.heightYards) && finite(entry.time, 0, 1)
      && entry.kind === target.kind && entry.source === target.source && entry.sourceIndex === target.sourceIndex
      && entry.time === target.time && samePosition(entry as unknown as ShotMotionPositionV1, target);
  });
}

export interface RetainedShotMotionPoseV1 extends ShotMotionSampleV1 {
  phase: "launch" | "airborne" | "collision" | "post_collision" | "first_contact" | "rollout" | "rest" | "hole_out";
  reliefPosition: Point | null;
}

function interpolate(path: readonly ShotMotionSampleV1[], time: number): ShotMotionPositionV1 {
  for (let index = 1; index < path.length; index += 1) {
    const to = path[index]!;
    if (time > to.time) continue;
    const from = path[index - 1]!;
    const t = Math.max(0, Math.min(1, (time - from.time) / (to.time - from.time)));
    return { point: { x: from.point.x + (to.point.x - from.point.x) * t, y: from.point.y + (to.point.y - from.point.y) * t },
      heightYards: from.heightYards + (to.heightYards - from.heightYards) * t };
  }
  return copyPosition(path[path.length - 1]!);
}

/** Pure read-only sampling: no current course, camera, clock, RNG or solver. */
export function sampleRetainedShotMotion(value: unknown, progress: number): RetainedShotMotionPoseV1 | null {
  if (!isValidRetainedShotMotionV1(value)) return null;
  const time = Math.max(0, Math.min(1, typeof progress !== "number" || Number.isNaN(progress) ? 0 : progress));
  const reliefPosition = value.reliefPosition ? { ...value.reliefPosition } : null;
  const at = value.events.find((entry) => entry.time === time);
  if (at) return { ...copyPosition(at), time, phase: at.kind, reliefPosition };
  if (value.flight && time < value.flight.endTime) {
    const position = flightPosition(value.flight, time / value.flight.endTime * value.flight.endSampleIndex);
    return { ...position, time, phase: "airborne", reliefPosition };
  }
  if (value.postCollisionPath.length && time < value.groundPath[0]!.time) {
    return { ...interpolate(value.postCollisionPath, time), time, phase: "post_collision", reliefPosition };
  }
  return { ...interpolate(value.groundPath, time), time, phase: "rollout", reliefPosition };
}
