import type { Hole, Point, Terrain } from "../models/types";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  GREEN_SURFACE_SAMPLES_PER_AXIS,
  greenSurfaceHash,
  normalizeGreenLocalState,
  normalizeGreenProgram,
  normalizeGreenSurfaceV1,
  type GreenCourseCarrier,
  type GreenHoleConditionV1,
  type GreenProgram,
  type GreenSurfaceV1,
  type GreenZoneConditionV1,
} from "./greenSurface";

export const GREEN_ROLLOUT_VERSION = 1 as const;
export const GREEN_ROLLOUT_MAX_STEPS = 192 as const;
export const GREEN_ROLLOUT_MAX_PATH_POINTS = 98 as const;
export const GREEN_ROLLOUT_MAX_TRANSITIONS = 32 as const;

export type GreenRolloutSpin = "neutral" | "draw" | "fade" | "backspin";
export type GreenRolloutPace = "slow" | "medium" | "fast";

export interface GreenRolloutTransitionV1 {
  step: number;
  from: string;
  to: string;
  at: Point;
}

export interface GreenRolloutEvidenceV1 {
  geometryHash: string;
  program: GreenProgram["preset"];
  realizedSpeedFeet: number;
  realizedFirmness: number;
  effectiveMoisture: number;
  weatherKind: string;
  rainInches: number;
  drainageLevel: number;
  requestedRollYards: number;
  club: string;
  sourceLie: string;
  trajectory: "low" | "standard" | "high";
  launchAngleDegrees: number;
  landingAngleDegrees: number;
  spin: GreenRolloutSpin;
  steps: number;
  workloadCapped: boolean;
}

/**
 * Immutable, JSON-safe green ground-path authority retained by previews,
 * committed shots, live golfers, replays, and architecture evidence.
 */
export interface GreenRolloutV1 {
  version: typeof GREEN_ROLLOUT_VERSION;
  seed: number;
  landing: Point;
  path: Point[];
  rest: Point;
  lieAfter: string;
  rollYards: number;
  breakTiles: number;
  downhillTiles: number;
  pace: GreenRolloutPace;
  transitions: GreenRolloutTransitionV1[];
  evidence: GreenRolloutEvidenceV1;
}

export interface FrozenGreenRolloutCourse extends Pick<
  GreenCourseCarrier,
  "width" | "height" | "tiles" | "elevations" | "greenSurface" | "greenProgram" | "greenLocalState"
> {
  holes: readonly Pick<Hole, "id" | "green">[];
}

export interface ResolveGreenRolloutInput {
  course: FrozenGreenRolloutCourse;
  holeId: string;
  landing: Point;
  direction: Point;
  requestedRollYards: number;
  yardsPerTile: number;
  club: string;
  sourceLie: string;
  launchAngleDegrees: number;
  landingAngleDegrees: number;
  trajectory: "low" | "standard" | "high";
  spin: GreenRolloutSpin;
  weather?: { kind?: string; rainInches?: number };
  drainageLevel?: number;
  seed: number;
}

interface SurfaceSample {
  height: number;
  gradient: Point;
  terrain: string;
}

const SAMPLE_DIVISIONS = GREEN_SURFACE_SAMPLES_PER_AXIS - 1;
const TIME_STEP = 0.1;
const PATH_STRIDE = 2;
const STOP_SPEED = 0.022;
const BASE_GREEN_FRICTION = 0.22;

const TERRAIN_FRICTION: Readonly<Record<string, number>> = Object.freeze({
  green: BASE_GREEN_FRICTION,
  fairway: 0.3,
  tee: 0.31,
  path: 0.18,
  rough: 0.62,
  deep_rough: 0.9,
  sand: 1.1,
  waste_area: 0.82,
  water: 4,
  wetland: 2.8,
  out_of_bounds: 0.7,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  const result = Math.round(value * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function roundedPoint(point: Point): Point {
  return { x: round(point.x), y: round(point.y) };
}

function inBounds(course: FrozenGreenRolloutCourse, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
}

function terrainAt(course: FrozenGreenRolloutCourse, point: Point): string {
  if (!inBounds(course, point)) return "out_of_bounds";
  const x = clamp(Math.floor(point.x), 0, course.width - 1);
  const y = clamp(Math.floor(point.y), 0, course.height - 1);
  return String(course.tiles[y * course.width + x] ?? "rough");
}

function coarseHeight(course: FrozenGreenRolloutCourse, x: number, y: number): number {
  if (course.width < 1 || course.height < 1) return 0;
  const sx = clamp(x, 0, Math.max(0, course.width - 1.000001));
  const sy = clamp(y, 0, Math.max(0, course.height - 1.000001));
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(course.width - 1, x0 + 1);
  const y1 = Math.min(course.height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const elevation = (cx: number, cy: number) => finite(course.elevations?.[cy * course.width + cx]);
  const top = elevation(x0, y0) * (1 - tx) + elevation(x1, y0) * tx;
  const bottom = elevation(x0, y1) * (1 - tx) + elevation(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function fineHeight(
  course: FrozenGreenRolloutCourse,
  surfaceTiles: ReadonlyMap<number, readonly number[]>,
  point: Point,
): number | null {
  if (terrainAt(course, point) !== "green") return null;
  const x = clamp(Math.floor(point.x), 0, course.width - 1);
  const y = clamp(Math.floor(point.y), 0, course.height - 1);
  const offsets = surfaceTiles.get(y * course.width + x);
  const localX = clamp(point.x - x, 0, 0.999999) * SAMPLE_DIVISIONS;
  const localY = clamp(point.y - y, 0, 0.999999) * SAMPLE_DIVISIONS;
  const sampleX = Math.min(SAMPLE_DIVISIONS - 1, Math.floor(localX));
  const sampleY = Math.min(SAMPLE_DIVISIONS - 1, Math.floor(localY));
  const tx = localX - sampleX;
  const ty = localY - sampleY;
  const offset = (dx: number, dy: number) => offsets?.[(sampleY + dy) * GREEN_SURFACE_SAMPLES_PER_AXIS + sampleX + dx] ?? 0;
  const top = offset(0, 0) * (1 - tx) + offset(1, 0) * tx;
  const bottom = offset(0, 1) * (1 - tx) + offset(1, 1) * tx;
  const base = finite(course.elevations?.[y * course.width + x]);
  return base + (top * (1 - ty) + bottom * ty) / GREEN_SURFACE_FIXED_POINT_SCALE;
}

/** Bilinear fine-surface height with a bounded central-difference gradient. */
function preparedSurfaceSampler(
  course: FrozenGreenRolloutCourse,
  surfaceValue: GreenSurfaceV1 | undefined,
): (point: Point) => SurfaceSample {
  const surface = normalizeGreenSurfaceV1(surfaceValue, course);
  const surfaceTiles = new Map(surface.tiles.map((tile) => [tile.y * course.width + tile.x, tile.offsets] as const));
  const height = (candidate: Point) => fineHeight(course, surfaceTiles, candidate)
    ?? coarseHeight(course, candidate.x, candidate.y);
  return (point: Point): SurfaceSample => {
    const epsilon = 1 / 24;
    const left = height({ x: point.x - epsilon, y: point.y });
    const right = height({ x: point.x + epsilon, y: point.y });
    const top = height({ x: point.x, y: point.y - epsilon });
    const bottom = height({ x: point.x, y: point.y + epsilon });
    return {
      height: round(height(point), 6),
      gradient: {
        x: round(clamp((right - left) / (2 * epsilon), -4, 4), 6),
        y: round(clamp((bottom - top) / (2 * epsilon), -4, 4), 6),
      },
      terrain: terrainAt(course, point),
    };
  };
}

export function sampleGreenRolloutSurface(
  course: FrozenGreenRolloutCourse,
  surfaceValue: GreenSurfaceV1 | undefined,
  point: Point,
): SurfaceSample {
  return preparedSurfaceSampler(course, surfaceValue)(point);
}

function zoneFor(hole: GreenHoleConditionV1 | undefined, point: Point, pin: Point | undefined): GreenZoneConditionV1 {
  const usePin = pin != null && Math.hypot(point.x - pin.x, point.y - pin.y) <= 2.25;
  const zone = hole?.zones?.find((candidate) => candidate.zone === (usePin ? "pin" : "landing"));
  return zone ?? {
    zone: usePin ? "pin" : "landing",
    health: hole?.health ?? 1,
    moisture: hole?.moisture ?? 0.58,
    compaction: hole?.compaction ?? 0,
    wear: hole?.wear ?? 0,
    traffic: 0,
  };
}

function realizedCondition(args: {
  program: GreenProgram;
  zone: GreenZoneConditionV1;
  rainInches: number;
  drainageLevel: number;
  weatherKind: string;
}): { speed: number; firmness: number; moisture: number } {
  const rainRetention = args.rainInches * (0.55 - args.drainageLevel * 0.11);
  const drying = args.weatherKind === "drought" ? 0.11 : args.weatherKind === "heat" ? 0.06 : args.weatherKind === "frost" ? -0.025 : 0;
  const moisture = clamp(args.zone.moisture + rainRetention - drying, 0, 1);
  const healthPenalty = (1 - args.zone.health) * 2.2;
  const wearPenalty = args.zone.wear * 1.25;
  const moistureSpeed = (0.56 - moisture) * 1.8;
  const mowGain = (3.5 - args.program.mowingHeightMillimeters) * 0.18;
  const rollGain = (args.program.rollingPasses - 1) * 0.12;
  const speed = clamp(args.program.targetSpeedFeet + mowGain + rollGain + moistureSpeed - healthPenalty - wearPenalty, 5.5, 15.5);
  const firmness = clamp(
    args.program.targetFirmness + (0.55 - moisture) * 0.48 + args.zone.compaction * 0.16 - (1 - args.zone.health) * 0.22,
    0,
    1,
  );
  return { speed: round(speed, 2), firmness: round(firmness, 3), moisture: round(moisture, 3) };
}

function frictionFor(terrain: string, condition: ReturnType<typeof realizedCondition>): number {
  if (terrain !== "green") return TERRAIN_FRICTION[terrain] ?? TERRAIN_FRICTION.rough;
  const speedFactor = clamp(9.5 / Math.max(5.5, condition.speed), 0.58, 1.7);
  const firmnessFactor = 1.12 - condition.firmness * 0.24;
  const moistureFactor = 0.92 + condition.moisture * 0.28;
  return BASE_GREEN_FRICTION * speedFactor * firmnessFactor * moistureFactor;
}

function pathDistance(path: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index++) total += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
  return total;
}

function spinEnergy(spin: GreenRolloutSpin): number {
  if (spin === "backspin") return 0.72;
  return spin === "draw" || spin === "fade" ? 0.96 : 1;
}

function legacyWeatherRollMultiplier(kind: string): number {
  if (kind === "rain" || kind === "heavy_rain" || kind === "storm") return 0.55;
  if (kind === "drought" || kind === "heat") return 1.22;
  if (kind === "frost") return 0.78;
  return 1;
}

function lineTouchesGreen(course: FrozenGreenRolloutCourse, from: Point, direction: Point, distanceTiles: number): boolean {
  const samples = Math.min(96, Math.max(1, Math.ceil(distanceTiles * 4)));
  for (let index = 0; index <= samples; index++) {
    const distance = distanceTiles * index / samples;
    if (terrainAt(course, { x: from.x + direction.x * distance, y: from.y + direction.y * distance }) === "green") return true;
  }
  return false;
}

function validPoint(value: unknown): value is Point {
  return value != null && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);
}

/** Strict guard for optional persisted rollout evidence. */
export function isValidGreenRollout(value: unknown): value is GreenRolloutV1 {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as GreenRolloutV1;
  if (
    candidate.version !== GREEN_ROLLOUT_VERSION
    || !Number.isSafeInteger(candidate.seed)
    || !validPoint(candidate.landing)
    || !validPoint(candidate.rest)
    || !Array.isArray(candidate.path)
    || candidate.path.length < 1
    || candidate.path.length > GREEN_ROLLOUT_MAX_PATH_POINTS
    || !candidate.path.every(validPoint)
    || candidate.path[0].x !== candidate.landing.x
    || candidate.path[0].y !== candidate.landing.y
    || candidate.path.at(-1)?.x !== candidate.rest.x
    || candidate.path.at(-1)?.y !== candidate.rest.y
    || !Number.isFinite(candidate.rollYards)
    || candidate.rollYards < 0
    || !Number.isFinite(candidate.breakTiles)
    || !Number.isFinite(candidate.downhillTiles)
    || !["slow", "medium", "fast"].includes(candidate.pace)
    || typeof candidate.lieAfter !== "string"
    || !Array.isArray(candidate.transitions)
    || candidate.transitions.length > GREEN_ROLLOUT_MAX_TRANSITIONS
  ) return false;
  const evidence = candidate.evidence;
  return evidence != null && typeof evidence === "object" && !Array.isArray(evidence)
    && typeof evidence.geometryHash === "string"
    && typeof evidence.program === "string"
    && Number.isFinite(evidence.realizedSpeedFeet)
    && Number.isFinite(evidence.realizedFirmness)
    && Number.isFinite(evidence.effectiveMoisture)
    && Number.isFinite(evidence.steps)
    && typeof evidence.club === "string"
    && typeof evidence.sourceLie === "string"
    && ["low", "standard", "high"].includes(evidence.trajectory)
    && Number.isFinite(evidence.landingAngleDegrees)
    && evidence.steps >= 0
    && evidence.steps <= GREEN_ROLLOUT_MAX_STEPS
    && typeof evidence.workloadCapped === "boolean"
    && candidate.transitions.every((transition) => Number.isSafeInteger(transition.step)
      && typeof transition.from === "string" && typeof transition.to === "string" && validPoint(transition.at));
}

/**
 * One deterministic ground-path resolver for every shot consumer. The fixed
 * step and bounded retained path make pathological tiers/false fronts safe.
 */
export function resolveGreenRollout(input: ResolveGreenRolloutInput): GreenRolloutV1 {
  const surface = normalizeGreenSurfaceV1(input.course.greenSurface, input.course);
  const program = normalizeGreenProgram(input.course.greenProgram);
  const local = normalizeGreenLocalState(input.course.greenLocalState, input.course);
  const hole = input.course.holes.find((candidate) => candidate.id === input.holeId);
  const conditionHole = local.holes.find((candidate) => candidate.holeId === input.holeId);
  const pin = hole && "green" in hole && hole.green && typeof hole.green === "object" ? hole.green as Point : undefined;
  const rainInches = clamp(finite(input.weather?.rainInches), 0, 4);
  const weatherKind = String(input.weather?.kind ?? "unknown").slice(0, 32);
  const drainageLevel = clamp(Math.round(finite(input.drainageLevel)), 0, 3);
  const condition = realizedCondition({
    program,
    zone: zoneFor(conditionHole, input.landing, pin),
    rainInches,
    drainageLevel,
    weatherKind,
  });
  const requestedTiles = clamp(finite(input.requestedRollYards) / Math.max(1, finite(input.yardsPerTile, 10)), 0, 24);
  const directionLength = Math.hypot(finite(input.direction.x), finite(input.direction.y));
  const direction = directionLength > 1e-9
    ? { x: input.direction.x / directionLength, y: input.direction.y / directionLength }
    : { x: 1, y: 0 };
  const landing = roundedPoint(input.landing);
  const initialTerrain = terrainAt(input.course, landing);
  const legacyRequestedTiles = requestedTiles * legacyWeatherRollMultiplier(weatherKind);
  let path: Point[] = [landing];
  let transitions: GreenRolloutTransitionV1[] = [];
  let rest = landing;
  let steps = 0;
  let workloadCapped = false;
  const fineInteraction = initialTerrain === "green"
    || lineTouchesGreen(input.course, landing, direction, legacyRequestedTiles);
  // Preserve the established non-green physical line exactly when a shot
  // never interacts with a green. The same resolver still owns the result;
  // green entry, exit, and re-entry switch to the bounded fine-surface solver.
  if (!fineInteraction) {
    rest = roundedPoint({
      x: landing.x + direction.x * legacyRequestedTiles,
      y: landing.y + direction.y * legacyRequestedTiles,
    });
    const lieAfter = terrainAt(input.course, rest);
    path = legacyRequestedTiles > 0 ? [landing, rest] : [landing];
    transitions = lieAfter !== initialTerrain
      ? [{ step: 1, from: initialTerrain, to: lieAfter, at: rest }]
      : [];
    steps = legacyRequestedTiles > 0 ? 1 : 0;
  } else {
    const sampleSurface = preparedSurfaceSampler(input.course, surface);
    // Club/strike energy is independent of maintenance condition. Surface
    // speed, moisture, and firmness act through deceleration after impact.
    const initialFriction = initialTerrain === "green" ? BASE_GREEN_FRICTION : frictionFor(initialTerrain, condition);
    const angleEnergy = input.club === "Putter"
      ? 1
      : clamp(1.1 - clamp(finite(input.landingAngleDegrees), 0, 90) / 135, 0.5, 1.05);
    const lieEnergy = input.sourceLie === "green" || input.sourceLie === "fairway" || input.sourceLie === "tee"
      ? 1
      : input.sourceLie === "rough" ? 0.94 : input.sourceLie === "sand" || input.sourceLie === "deep_rough" ? 0.82 : 0.9;
    const trajectoryEnergy = input.trajectory === "low" ? 1.04 : input.trajectory === "high" ? 0.94 : 1;
    let speed = Math.sqrt(Math.max(0, 2 * Math.max(0.08, initialFriction) * requestedTiles))
      * spinEnergy(input.spin) * angleEnergy * lieEnergy * trajectoryEnergy;
    let velocity = { x: direction.x * speed, y: direction.y * speed };
    let position = { ...landing };
    let terrain = initialTerrain;
    for (; steps < GREEN_ROLLOUT_MAX_STEPS && requestedTiles > 0.0001; steps++) {
      speed = Math.hypot(velocity.x, velocity.y);
      const sample = sampleSurface(position);
      const friction = frictionFor(sample.terrain, condition);
      const gravity = {
        x: clamp(-sample.gradient.x * 0.34, -0.58, 0.58),
        y: clamp(-sample.gradient.y * 0.34, -0.58, 0.58),
      };
      const alongGravity = speed > 1e-9 ? (gravity.x * velocity.x + gravity.y * velocity.y) / speed : 0;
      if (speed <= STOP_SPEED && alongGravity <= friction * 0.78) break;
      const drag = speed > 1e-9 ? { x: velocity.x / speed * friction, y: velocity.y / speed * friction } : { x: 0, y: 0 };
      let nextVelocity = {
        x: velocity.x + (gravity.x - drag.x) * TIME_STEP,
        y: velocity.y + (gravity.y - drag.y) * TIME_STEP,
      };
      if (speed > 0 && nextVelocity.x * velocity.x + nextVelocity.y * velocity.y < 0 && Math.hypot(gravity.x, gravity.y) < friction) nextVelocity = { x: 0, y: 0 };
      const nextSpeed = Math.hypot(nextVelocity.x, nextVelocity.y);
      if (nextSpeed > 4) {
        nextVelocity.x *= 4 / nextSpeed;
        nextVelocity.y *= 4 / nextSpeed;
      }
      const next = {
        x: position.x + (velocity.x + nextVelocity.x) * 0.5 * TIME_STEP,
        y: position.y + (velocity.y + nextVelocity.y) * 0.5 * TIME_STEP,
      };
      const nextTerrain = terrainAt(input.course, next);
      if (nextTerrain !== terrain && transitions.length < GREEN_ROLLOUT_MAX_TRANSITIONS) transitions.push({ step: steps + 1, from: terrain, to: nextTerrain, at: roundedPoint(next) });
      position = next;
      velocity = nextVelocity;
      terrain = nextTerrain;
      if ((steps + 1) % PATH_STRIDE === 0 && path.length < GREEN_ROLLOUT_MAX_PATH_POINTS - 1) path.push(roundedPoint(position));
      if (terrain === "water" || terrain === "wetland") break;
    }
    workloadCapped = steps >= GREEN_ROLLOUT_MAX_STEPS;
    rest = roundedPoint(position);
    if (path.at(-1)?.x !== rest.x || path.at(-1)?.y !== rest.y) path.push(rest);
  }
  const displacement = { x: rest.x - landing.x, y: rest.y - landing.y };
  const lateral = displacement.x * -direction.y + displacement.y * direction.x;
  const forward = displacement.x * direction.x + displacement.y * direction.y;
  const rollYards = pathDistance(path) * Math.max(1, finite(input.yardsPerTile, 10));
  const pace: GreenRolloutPace = condition.speed < 8.8 ? "slow" : condition.speed > 10.6 ? "fast" : "medium";
  return {
    version: GREEN_ROLLOUT_VERSION,
    seed: input.seed | 0,
    landing,
    path,
    rest,
    lieAfter: terrainAt(input.course, rest),
    rollYards: round(rollYards, 1),
    breakTiles: fineInteraction ? round(lateral, 3) : 0,
    downhillTiles: fineInteraction ? round(forward - requestedTiles, 3) : 0,
    pace,
    transitions,
    evidence: {
      geometryHash: greenSurfaceHash(surface),
      program: program.preset,
      realizedSpeedFeet: condition.speed,
      realizedFirmness: condition.firmness,
      effectiveMoisture: condition.moisture,
      weatherKind,
      rainInches: round(rainInches, 3),
      drainageLevel,
      requestedRollYards: round(Math.max(0, finite(input.requestedRollYards)), 1),
      club: String(input.club).slice(0, 40),
      sourceLie: String(input.sourceLie).slice(0, 32),
      trajectory: input.trajectory,
      launchAngleDegrees: round(clamp(finite(input.launchAngleDegrees), 0, 90), 2),
      landingAngleDegrees: round(clamp(finite(input.landingAngleDegrees), 0, 90), 2),
      spin: input.spin,
      steps: Math.min(steps, GREEN_ROLLOUT_MAX_STEPS),
      workloadCapped,
    },
  };
}

export function terrainForGreenRollout(course: FrozenGreenRolloutCourse, point: Point): Terrain | "out_of_bounds" {
  return terrainAt(course, point) as Terrain | "out_of_bounds";
}
