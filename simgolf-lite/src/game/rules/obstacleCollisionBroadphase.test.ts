// Frozen exhaustive oracle from db5e34500a3849516ea9d3ce89c5421cc773c49a.
// Retains the original full curved nearest scan and full first-contact scan.
// Kept test-local so production never imports a second collision authority.
import { describe, expect, it } from "vitest";
import { resolveObstacleCollision as optimized, sampleAuthoritativeFlightGeometry as optimizedGeometry } from "./obstacleCollision";
import type { ObstacleType, Point, Terrain } from "../models/types";
import type { ShotClearanceEvidence, ShotCollision, ShotFlightProfile } from "./contracts";

/** Elevation steps are rendered and balanced as approximately 2–3 yards. */
export const ELEVATION_STEP_YARDS = 2.5;

/** A small fixed step makes narrow trunks deterministic without random casts. */
export const FLIGHT_SAMPLE_STEP_TILES = 0.05;

export const MAX_FLIGHT_CURVE_TILES = 8;
export const MAX_RETAINED_FLIGHT_DIVISIONS = 32768;

/** Signed displacement at the middle of the from → to chord, in tiles. */
export interface FlightCurveV1 {
  kind: "lateral_quadratic_v1";
  lateralOffsetTiles: number;
}

/** Compact frozen geometry; heights are absolute yards above the course datum. */
export interface AuthoritativeFlightGeometryV1 {
  version: 1;
  from: Point;
  to: Point;
  startHeightYards: number;
  endHeightYards: number;
  apexHeightYards: number;
  curve?: FlightCurveV1;
}

export interface RetainedFlightResolutionV1 {
  geometry: AuthoritativeFlightGeometryV1;
  sampleDivisions: number;
  /** Exact source sample, never a nearest-point match against a later path. */
  endSampleIndex: number;
  collision: ShotCollision;
  /** x/y/type are the existing frozen obstacle identity. */
  obstacle?: FlightObstacle;
}

type VolumeName = "trunk" | "canopy" | "body";

interface ObstacleVolume {
  name: VolumeName;
  radiusTiles: number;
  minHeightYards: number;
  maxHeightYards: number;
}

const VOLUMES: Readonly<Record<ObstacleType, readonly ObstacleVolume[]>> = {
  tree: [
    { name: "trunk", radiusTiles: 0.24, minHeightYards: 0, maxHeightYards: 8 },
    { name: "canopy", radiusTiles: 0.9, minHeightYards: 8, maxHeightYards: 24 },
  ],
  bush: [{ name: "body", radiusTiles: 0.7, minHeightYards: 0, maxHeightYards: 3 }],
  rock: [{ name: "body", radiusTiles: 0.6, minHeightYards: 0, maxHeightYards: 2.4 }],
};

export interface FlightObstacle {
  x: number;
  y: number;
  type: ObstacleType;
}

export interface ObstacleCollisionInput {
  from: Point;
  to: Point;
  flight: {
    profile: ShotFlightProfile;
    apexHeightYards: number;
    curve?: FlightCurveV1;
  };
  width: number;
  height: number;
  yardsPerTile: number;
  /** Optional already sampled physical surface heights, frozen at shot resolve. */
  endpointHeightsYards?: { from: number; to: number };
  /** Frozen physical surface authority for modern shots; absent preserves legacy nearest-tile sampling. */
  terrainHeightAtYards?: (point: Point) => number;
  elevations?: readonly number[];
  tiles?: readonly Terrain[];
  obstacles: readonly FlightObstacle[];
  /** Set when the caller supplies the output of prepareObstacleInput. */
  obstaclesAreStable?: boolean;
  /** Versioned new-shot callers opt in; legacy result bytes remain unchanged. */
  retainGeometry?: boolean;
}

export interface FlightPathSample {
  point: Point;
  t: number;
  pathHeightYards: number;
  terrainHeightYards: number;
}

export interface ObstacleCollisionResolution {
  samples: readonly FlightPathSample[];
  collision: ShotCollision;
  clearance: readonly ShotClearanceEvidence[];
  retained?: RetainedFlightResolutionV1;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

export function prepareObstacleInput(obstacles: readonly FlightObstacle[]): readonly FlightObstacle[] {
  const typeOrder: Readonly<Record<ObstacleType, number>> = { bush: 0, rock: 1, tree: 2 };
  return obstacles
    .filter((obstacle): obstacle is FlightObstacle =>
      Number.isFinite(obstacle.x)
      && Number.isFinite(obstacle.y)
      && (obstacle.type === "tree" || obstacle.type === "bush" || obstacle.type === "rock"),
    )
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y || typeOrder[a.type] - typeOrder[b.type]);
}

function segmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return Math.hypot(point.x - from.x, point.y - from.y);
  const progress = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(
    point.x - (from.x + dx * progress),
    point.y - (from.y + dy * progress),
  );
}

function nearestSample(samples: readonly FlightPathSample[], obstacle: FlightObstacle, curved: boolean): { sample: FlightPathSample; distance: number } {
  const lastIndex = Math.max(0, samples.length - 1);
  const first = samples[0]!;
  const last = samples[lastIndex]!;
  const dx = last.point.x - first.point.x;
  const dy = last.point.y - first.point.y;
  const lengthSquared = dx * dx + dy * dy;
  const projected = lengthSquared <= 1e-9
    ? 0
    : Math.max(0, Math.min(1, ((obstacle.x - first.point.x) * dx + (obstacle.y - first.point.y) * dy) / lengthSquared));
  const center = Math.round(projected * lastIndex);
  // A chord projection is not a nearest-point proof for a curved trajectory.
  const start = curved ? 0 : Math.max(0, center - 2);
  const end = curved ? lastIndex : Math.min(lastIndex, center + 2);
  let closest = first;
  let closestDistance = Infinity;
  for (let index = start; index <= end; index += 1) {
    const sample = samples[index]!;
    const distance = Math.hypot(sample.point.x - obstacle.x, sample.point.y - obstacle.y);
    if (distance < closestDistance) {
      closest = sample;
      closestDistance = distance;
    }
  }
  return { sample: closest, distance: closestDistance };
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function geometryRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function geometryPoint(value: unknown): value is Point {
  if (!geometryRecord(value)) return false;
  const point = value;
  return Object.keys(point).every((key) => key === "x" || key === "y")
    && boundedNumber(point.x, -1_000_000, 1_000_000) && boundedNumber(point.y, -1_000_000, 1_000_000);
}

export function isValidFlightCurveV1(value: unknown): value is FlightCurveV1 {
  if (!geometryRecord(value)) return false;
  const curve = value;
  return Object.keys(curve).every((key) => key === "kind" || key === "lateralOffsetTiles")
    && curve.kind === "lateral_quadratic_v1"
    && boundedNumber(curve.lateralOffsetTiles, -MAX_FLIGHT_CURVE_TILES, MAX_FLIGHT_CURVE_TILES);
}

export function isValidAuthoritativeFlightGeometryV1(value: unknown): value is AuthoritativeFlightGeometryV1 {
  if (!geometryRecord(value)) return false;
  const geometry = value;
  if (!Object.keys(geometry).every((key) => ["version", "from", "to", "startHeightYards", "endHeightYards", "apexHeightYards", "curve"].includes(key))
    || geometry.version !== 1 || !geometryPoint(geometry.from) || !geometryPoint(geometry.to)
    || !boundedNumber(geometry.startHeightYards, -1_000_000, 1_000_000)
    || !boundedNumber(geometry.endHeightYards, -1_000_000, 1_000_000)
    || !boundedNumber(geometry.apexHeightYards, 0, 10_000)
    || (geometry.curve !== undefined && !isValidFlightCurveV1(geometry.curve))) return false;
  const travelBound = Math.hypot(geometry.to.x - geometry.from.x, geometry.to.y - geometry.from.y)
    + 4 * Math.abs((geometry.curve as FlightCurveV1 | undefined)?.lateralOffsetTiles ?? 0);
  const lateralBound = Math.abs((geometry.curve as FlightCurveV1 | undefined)?.lateralOffsetTiles ?? 0);
  return travelBound <= MAX_RETAINED_FLIGHT_DIVISIONS * FLIGHT_SAMPLE_STEP_TILES
    && Math.max(Math.abs(geometry.from.x), Math.abs(geometry.to.x), Math.abs(geometry.from.y), Math.abs(geometry.to.y)) + lateralBound <= 1_000_000
    && Math.max(geometry.startHeightYards, geometry.endHeightYards) + geometry.apexHeightYards <= 1_000_000;
}

export function createAuthoritativeFlightGeometry(args: ObstacleCollisionInput): AuthoritativeFlightGeometryV1 {
  if (args.flight.curve !== undefined && !isValidFlightCurveV1(args.flight.curve)) {
    throw new RangeError("Invalid authoritative flight curve");
  }
  if (args.endpointHeightsYards !== undefined
    && (!geometryRecord(args.endpointHeightsYards)
      || !boundedNumber(args.endpointHeightsYards.from, -1_000_000, 1_000_000)
      || !boundedNumber(args.endpointHeightsYards.to, -1_000_000, 1_000_000))) {
    throw new RangeError("Invalid authoritative flight endpoint heights");
  }
  return {
    version: 1,
    from: { ...args.from },
    to: { ...args.to },
    startHeightYards: args.endpointHeightsYards?.from ?? terrainAt(args, args.from).elevationYards,
    endHeightYards: args.endpointHeightsYards?.to ?? terrainAt(args, args.to).elevationYards,
    apexHeightYards: Math.max(0, args.flight.apexHeightYards),
    ...(args.flight.curve ? { curve: { ...args.flight.curve } } : {}),
  };
}

/** The sole airborne geometry function, shared by collision and retained playback. */
export function sampleAuthoritativeFlightGeometry(geometry: AuthoritativeFlightGeometryV1, progress: number): Omit<FlightPathSample, "terrainHeightYards"> {
  const t = Math.max(0, Math.min(1, typeof progress !== "number" || Number.isNaN(progress) ? 0 : progress));
  const dx = geometry.to.x - geometry.from.x;
  const dy = geometry.to.y - geometry.from.y;
  const distance = Math.hypot(dx, dy);
  const offset = (geometry.curve?.lateralOffsetTiles ?? 0) * 4 * t * (1 - t);
  const x = geometry.from.x + dx * t;
  const y = geometry.from.y + dy * t;
  return {
    point: {
      x: rounded(x + (distance > 0 ? -dy / distance * offset : 0)),
      y: rounded(y + (distance > 0 ? dx / distance * offset : 0)),
    },
    t: rounded(t),
    pathHeightYards: rounded(geometry.startHeightYards + (geometry.endHeightYards - geometry.startHeightYards) * t
      + geometry.apexHeightYards * 4 * t * (1 - t)),
  };
}

function terrainAt(args: ObstacleCollisionInput, point: Point): { elevationYards: number; terrain: Terrain } {
  const x = Math.max(0, Math.min(args.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(args.height - 1, Math.round(point.y)));
  const index = y * args.width + x;
  const elevation = args.elevations?.[index] ?? 0;
  return {
    elevationYards: Number.isFinite(elevation) ? elevation * ELEVATION_STEP_YARDS : 0,
    terrain: args.tiles?.[index] ?? "rough",
  };
}

/**
 * Samples the same parabolic flight used by the shared outcome: terrain is
 * linearly interpolated between endpoints, while flight height is a stable
 * 4t(1-t) arc above that ground reference.
 */
export function sampleAuthoritativeFlightPath(args: ObstacleCollisionInput): readonly FlightPathSample[] {
  const distance = Math.hypot(args.to.x - args.from.x, args.to.y - args.from.y);
  const geometry = createAuthoritativeFlightGeometry(args);
  if ((args.flight.curve || args.retainGeometry) && !isValidAuthoritativeFlightGeometryV1(geometry)) {
    throw new RangeError("Authoritative flight exceeds retained geometry bounds");
  }
  // Integral of speed is at most chord length + integral of |offset'|;
  // this conservative bound preserves the existing maximum sample spacing.
  const travelBound = distance + 4 * Math.abs(args.flight.curve?.lateralOffsetTiles ?? 0);
  const count = Math.max(1, Math.ceil(travelBound / FLIGHT_SAMPLE_STEP_TILES));
  const samples: FlightPathSample[] = [];
  for (let index = 0; index <= count; index += 1) {
    const sample = sampleAuthoritativeFlightGeometry(geometry, index / count);
    const terrain = args.terrainHeightAtYards?.(sample.point) ?? terrainAt(args, sample.point).elevationYards;
    samples.push({
      ...sample,
      terrainHeightYards: rounded(terrain),
    });
  }
  return samples;
}

interface CandidateCollision {
  t: number;
  sampleIndex: number;
  priority: number;
  collision: ShotCollision;
  obstacle?: FlightObstacle;
}

function obstacleEvidence(args: {
  obstacle: FlightObstacle;
  samples: readonly FlightPathSample[];
  input: ObstacleCollisionInput;
  pathDistancesYards?: readonly number[];
}): { evidence: ShotClearanceEvidence; collision: CandidateCollision | null } {
  const volumes = VOLUMES[args.obstacle.type];
  const baseHeight = args.input.terrainHeightAtYards?.(args.obstacle) ?? terrainAt(args.input, args.obstacle).elevationYards;
  const nearest = nearestSample(args.samples, args.obstacle, !!args.input.flight.curve);
  const closest = nearest.sample;
  const closestDistance = nearest.distance;
  let hit: { sample: FlightPathSample; volume: ObstacleVolume; index: number } | null = null;
  // A prior contact can leave the ball one sampling step inside a volume.
  // Permit an outward departure from that overlap, but never an inward shot
  // through the trunk. Re-entry later in the same curved flight still collides.
  const departing = new Set<ObstacleVolume>();
  if (args.input.retainGeometry && args.samples.length > 1) {
    const first = args.samples[0]!;
    const second = args.samples[1]!;
    const radial = { x: first.point.x - args.obstacle.x, y: first.point.y - args.obstacle.y };
    const outward = Math.hypot(second.point.x - args.obstacle.x, second.point.y - args.obstacle.y)
      > Math.hypot(radial.x, radial.y) + 1e-9;
    if (outward) for (const volume of volumes) {
      if (Math.hypot(radial.x, radial.y) <= volume.radiusTiles
        && first.pathHeightYards >= baseHeight + volume.minHeightYards
        && first.pathHeightYards <= baseHeight + volume.maxHeightYards) departing.add(volume);
    }
  }
  const maxRadius = Math.max(...volumes.map((volume) => volume.radiusTiles));
  const curveBound = Math.abs(args.input.flight.curve?.lateralOffsetTiles ?? 0);
  if (segmentDistance(args.obstacle, args.input.from, args.input.to) <= maxRadius + curveBound) {
    for (const [index, sample] of args.samples.entries()) {
      const distance = Math.hypot(sample.point.x - args.obstacle.x, sample.point.y - args.obstacle.y);
      for (const volume of volumes) {
        const lower = baseHeight + volume.minHeightYards;
        const upper = baseHeight + volume.maxHeightYards;
        const inside = distance <= volume.radiusTiles && sample.pathHeightYards >= lower && sample.pathHeightYards <= upper;
        if (departing.has(volume)) {
          if (!inside) departing.delete(volume);
          continue;
        }
        if (inside) {
          hit ??= { sample, volume, index };
        }
      }
    }
  }

  const nearby = volumes.filter((volume) => closestDistance <= volume.radiusTiles);
  const selected = hit?.volume ?? nearby[nearby.length - 1] ?? volumes[volumes.length - 1]!;
  const sample = hit?.sample ?? closest;
  const requiredHeightYards = baseHeight + selected.maxHeightYards;
  const horizontalClearanceYards = Math.max(0, closestDistance - selected.radiusTiles) * args.input.yardsPerTile;
  const relationship = hit
    ? "through"
    : nearby.length === 0
      ? "around"
      : sample.pathHeightYards < baseHeight + selected.minHeightYards
        ? "under"
        : "over";
  const clearanceYards = relationship === "around"
    ? horizontalClearanceYards
    : sample.pathHeightYards - requiredHeightYards;
  const evidence: ShotClearanceEvidence = {
    point: { ...sample.point },
    pathHeightYards: rounded(sample.pathHeightYards),
    requiredHeightYards: rounded(requiredHeightYards),
    clearanceYards: rounded(clearanceYards),
    obstacleType: args.obstacle.type,
    relationship,
    ...(relationship === "around" ? { horizontalClearanceYards: rounded(horizontalClearanceYards) } : {}),
  };
  return {
    evidence,
    collision: hit ? {
      t: hit.sample.t,
      sampleIndex: hit.index,
      priority: 0,
      obstacle: { ...args.obstacle },
      collision: {
        kind: "obstacle",
        point: { ...hit.sample.point },
        obstacleType: args.obstacle.type,
        distanceFromStartYards: args.pathDistancesYards?.[hit.index]
          ?? rounded(hit.sample.t * Math.hypot(args.input.to.x - args.input.from.x, args.input.to.y - args.input.from.y) * args.input.yardsPerTile),
        clearance: evidence,
      },
    } : null,
  };
}

/**
 * Resolve the first physical interruption of a deterministic flight. Terrain
 * is considered first at equal sample distance, then obstacles are ordered by
 * x/y/type so caller array order cannot affect the outcome.
 */
export function resolveObstacleCollision(args: ObstacleCollisionInput): ObstacleCollisionResolution {
  const samples = sampleAuthoritativeFlightPath(args);
  let pathDistancesYards: number[] | undefined;
  if (args.flight.curve) {
    let distance = 0;
    pathDistancesYards = samples.map((sample, index) => {
      if (index > 0) distance += Math.hypot(sample.point.x - samples[index - 1]!.point.x,
        sample.point.y - samples[index - 1]!.point.y) * args.yardsPerTile;
      return rounded(distance);
    });
  }
  const candidates: CandidateCollision[] = [];
  for (let sampleIndex = 1; sampleIndex < samples.length - 1; sampleIndex += 1) {
    const sample = samples[sampleIndex]!;
    if (sample.pathHeightYards < sample.terrainHeightYards) {
      const terrain = terrainAt(args, sample.point).terrain;
      candidates.push({
        t: sample.t,
        sampleIndex,
        priority: 0,
        collision: {
          kind: "terrain",
          point: { ...sample.point },
          terrain,
          distanceFromStartYards: pathDistancesYards?.[sampleIndex]
            ?? rounded(sample.t * Math.hypot(args.to.x - args.from.x, args.to.y - args.from.y) * args.yardsPerTile),
        },
      });
      break;
    }
  }
  const evidence: ShotClearanceEvidence[] = [];
  const orderedObstacles = args.obstaclesAreStable ? args.obstacles : prepareObstacleInput(args.obstacles);
  for (const [index, obstacle] of orderedObstacles.entries()) {
    const resolved = obstacleEvidence({ obstacle, samples, input: args, pathDistancesYards });
    evidence.push(resolved.evidence);
    if (resolved.collision) candidates.push({ ...resolved.collision, priority: index + 1 });
  }
  candidates.sort((a, b) => a.t - b.t || a.priority - b.priority);
  const first = candidates[0];
  return {
    samples,
    collision: first?.collision ?? { kind: "none" },
    clearance: evidence,
    ...(args.retainGeometry ? {
      retained: {
        geometry: createAuthoritativeFlightGeometry(args),
        sampleDivisions: samples.length - 1,
        endSampleIndex: first?.sampleIndex ?? samples.length - 1,
        collision: first?.collision ?? { kind: "none" },
        ...(first?.obstacle ? { obstacle: { ...first.obstacle } } : {}),
      },
    } : {}),
  };
}

function compare(input: ObstacleCollisionInput) {
  const expected = resolveObstacleCollision(input);
  const actual = optimized(input);
  expect(actual.samples).toEqual(expected.samples);
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}
const inputFor = (value: Partial<ObstacleCollisionInput> = {}): ObstacleCollisionInput => ({
  from: { x: -12, y: -8 }, to: { x: 39, y: 24 },
  flight: { profile: "standard", apexHeightYards: 13, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 5 } },
  width: 64, height: 64, yardsPerTile: 10, elevations: Array(4096).fill(0), tiles: Array(4096).fill("fairway"),
  endpointHeightsYards: { from: 0, to: 0 }, retainGeometry: true,
  obstacles: [], ...value,
});
describe("curved collision broadphase matches the frozen exhaustive authority", () => {
  it("preserves original numeric rounding for integers, signed zero, tiny fractions, huge and nonfinite values", () => {
    for (const value of [0, -0, 1, -1, 24, -24, 2 ** 53, -(2 ** 53), 1e21, -1e21, 1e100, -1e100,
      Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-12, -1e-12,
      .0000005, -.0000005, 1.2345675, -1.2345675, Number.NaN, Infinity, -Infinity]) {
      for (const progress of [0, .5, 1]) {
        const geometry: AuthoritativeFlightGeometryV1 = { version: 1, from: { x: value, y: -value },
          to: { x: value, y: -value }, startHeightYards: 0, endHeightYards: value, apexHeightYards: 0 };
        expect(optimizedGeometry(geometry, progress)).toEqual(sampleAuthoritativeFlightGeometry(geometry, progress));
      }
    }
    compare(inputFor({ endpointHeightsYards: { from: -1e-12, to: -1e-12 }, retainGeometry: false,
      flight: { profile: "low", apexHeightYards: 0 }, obstacles: [{ type: "tree", x: -12, y: -8 }] }));
  });
  it("keeps raw prefix sums exact when terrain queries a later index before obstacle contacts", () => {
    const input = inputFor({ from: { x: 1, y: 1 }, to: { x: 35, y: 1 },
      flight: { profile: "standard", apexHeightYards: 10, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 4 } },
      terrainHeightAtYards: ({ x }) => x > 30 ? 100 : 0,
      obstacles: [{ type: "tree", x: 10, y: 4 }, { type: "tree", x: 4, y: 2.3 }, { type: "bush", x: 24, y: 4.5 }] });
    compare(input);
    expect(optimized(input).collision.kind).toBe("obstacle");
  });
  it("keeps every sample, clearance, contact and tie across seeded negative and curved inputs", () => {
    let seed = 734413;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let run = 0; run < 72; run++) {
      const from = { x: random() * 40 - 20, y: random() * 40 - 20 };
      const to = { x: random() * 70 - 20, y: random() * 70 - 20 };
      const input = inputFor({ from, to, flight: { profile: "standard", apexHeightYards: random() * 32,
        ...(run % 6 ? { curve: { kind: "lateral_quadratic_v1" as const, lateralOffsetTiles: random() * 16 - 8 } } : {}) },
        retainGeometry: run % 5 !== 0,
        obstacles: Array.from({ length: 24 }, (_, index) => ({ type: (["tree", "rock", "bush"] as const)[index % 3], x: random() * 90 - 30, y: random() * 90 - 30 })) });
      compare(input);
    }
  });
  it("preserves block-border points, radius boundaries and sub-ulp nearest ties", () => {
    for (const offset of [0, 8, -8]) {
      const input = inputFor({ from: { x: -3.2, y: -1 }, to: { x: 3.2, y: -1 },
        flight: { profile: "standard", apexHeightYards: 14, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: offset } } });
      const samples = sampleAuthoritativeFlightPath(input);
      const obstacles: FlightObstacle[] = [];
      for (let index = 15; index < samples.length - 1; index += 16) {
        const at = samples[index]!.point, next = samples[index + 1]!.point;
        for (const shift of [0, Number.EPSILON, -Number.EPSILON, 1e-12, -1e-12]) {
          obstacles.push({ type: "tree", x: (at.x + next.x) / 2 + shift, y: (at.y + next.y) / 2 });
          for (const radius of [.24, .6, .7, .9]) obstacles.push({ type: "tree", x: at.x, y: at.y + radius + shift });
        }
      }
      compare({ ...input, obstacles });
    }
  });
  it("handles degenerate paths, zero curves, huge coordinates, terrain and outward overlaps", () => {
    for (const length of [0, 1e-10, 3]) for (const offset of [0, 8, -8]) {
      compare(inputFor({ from: { x: -2, y: -2 }, to: { x: -2 + length, y: -2 },
        flight: { profile: "low", apexHeightYards: 0, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: offset } },
        terrainHeightAtYards: ({ x }) => x > 0 ? 2 : 0,
        obstacles: [{ type: "tree", x: -2, y: -2 }, { type: "bush", x: -1.8, y: -2 },
          { type: "rock", x: -2.2, y: -2 }, { type: "tree", x: 1e100, y: -1e100 }] }));
    }
  });
  it("preserves block-edge nearest ties near both retained coordinate bounds", () => {
    for (const sign of [-1, 1]) {
      const input = inputFor({ from: { x: sign * 999900, y: sign * 999900 }, to: { x: sign * 999950, y: sign * 999920 } });
      const samples = sampleAuthoritativeFlightPath(input);
      const obstacles: FlightObstacle[] = [];
      for (let index = 15; index < samples.length - 1; index += 16) {
        const at = samples[index]!.point, next = samples[index + 1]!.point;
        for (const shift of [0, Number.EPSILON * 1e6, -Number.EPSILON * 1e6]) {
          obstacles.push({ type: "tree", x: (at.x + next.x) / 2 + shift, y: (at.y + next.y) / 2 });
          obstacles.push({ type: "tree", x: at.x, y: at.y + .9 + shift });
        }
      }
      compare({ ...input, obstacles });
    }
  });
  it("does not reuse answers after mutable input changes", () => {
    const input = inputFor({ obstacles: [{ type: "tree", x: 10, y: 8 }] });
    compare(input);
    input.obstacles[0]!.x = -4; input.obstacles[0]!.y = 7;
    input.to.x = -10;
    compare(input);
  });
  it("preserves every physical sample and terrain contact when no obstacle bounds are needed", () => {
    compare(inputFor());
    compare(inputFor({ terrainHeightAtYards: ({ x }) => x > 20 ? 30 : 0 }));
  });
});
