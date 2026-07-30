import type { ObstacleType, Point, Terrain } from "../models/types";
import type { ShotClearanceEvidence, ShotCollision, ShotFlightProfile } from "./contracts";

/** Elevation steps are rendered and balanced as approximately 2–3 yards. */
export const ELEVATION_STEP_YARDS = 2.5;

/** A small fixed step makes narrow trunks deterministic without random casts. */
export const FLIGHT_SAMPLE_STEP_TILES = 0.05;

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
  };
  width: number;
  height: number;
  yardsPerTile: number;
  elevations?: readonly number[];
  tiles?: readonly Terrain[];
  obstacles: readonly FlightObstacle[];
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
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function stableObstacles(obstacles: readonly FlightObstacle[]): FlightObstacle[] {
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
  const count = Math.max(1, Math.ceil(distance / FLIGHT_SAMPLE_STEP_TILES));
  const startTerrain = terrainAt(args, args.from).elevationYards;
  const endTerrain = terrainAt(args, args.to).elevationYards;
  const apex = Math.max(0, args.flight.apexHeightYards);
  const samples: FlightPathSample[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const point = {
      x: rounded(args.from.x + (args.to.x - args.from.x) * t),
      y: rounded(args.from.y + (args.to.y - args.from.y) * t),
    };
    const terrain = terrainAt(args, point).elevationYards;
    const baseHeight = startTerrain + (endTerrain - startTerrain) * t;
    samples.push({
      point,
      t: rounded(t),
      pathHeightYards: rounded(baseHeight + apex * 4 * t * (1 - t)),
      terrainHeightYards: rounded(terrain),
    });
  }
  return samples;
}

interface CandidateCollision {
  t: number;
  priority: number;
  collision: ShotCollision;
}

function obstacleEvidence(args: {
  obstacle: FlightObstacle;
  samples: readonly FlightPathSample[];
  input: ObstacleCollisionInput;
}): { evidence: ShotClearanceEvidence; collision: CandidateCollision | null } {
  const volumes = VOLUMES[args.obstacle.type];
  const baseHeight = terrainAt(args.input, args.obstacle).elevationYards;
  let closest = args.samples[0]!;
  let closestDistance = Infinity;
  let hit: { sample: FlightPathSample; volume: ObstacleVolume } | null = null;
  for (const sample of args.samples) {
    const distance = Math.hypot(sample.point.x - args.obstacle.x, sample.point.y - args.obstacle.y);
    if (distance < closestDistance) {
      closest = sample;
      closestDistance = distance;
    }
    for (const volume of volumes) {
      const lower = baseHeight + volume.minHeightYards;
      const upper = baseHeight + volume.maxHeightYards;
      if (distance <= volume.radiusTiles && sample.pathHeightYards >= lower && sample.pathHeightYards <= upper) {
        hit ??= { sample, volume };
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
      priority: 0,
      collision: {
        kind: "obstacle",
        point: { ...hit.sample.point },
        obstacleType: args.obstacle.type,
        distanceFromStartYards: rounded(hit.sample.t * Math.hypot(args.input.to.x - args.input.from.x, args.input.to.y - args.input.from.y) * args.input.yardsPerTile),
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
  const candidates: CandidateCollision[] = [];
  for (const sample of samples.slice(1, -1)) {
    if (sample.pathHeightYards < sample.terrainHeightYards) {
      const terrain = terrainAt(args, sample.point).terrain;
      candidates.push({
        t: sample.t,
        priority: 0,
        collision: {
          kind: "terrain",
          point: { ...sample.point },
          terrain,
          distanceFromStartYards: rounded(sample.t * Math.hypot(args.to.x - args.from.x, args.to.y - args.from.y) * args.yardsPerTile),
        },
      });
      break;
    }
  }
  const evidence: ShotClearanceEvidence[] = [];
  for (const [index, obstacle] of stableObstacles(args.obstacles).entries()) {
    const resolved = obstacleEvidence({ obstacle, samples, input: args });
    evidence.push(resolved.evidence);
    if (resolved.collision) candidates.push({ ...resolved.collision, priority: index + 1 });
  }
  candidates.sort((a, b) => a.t - b.t || a.priority - b.priority);
  return {
    samples,
    collision: candidates[0]?.collision ?? { kind: "none" },
    clearance: evidence,
  };
}
