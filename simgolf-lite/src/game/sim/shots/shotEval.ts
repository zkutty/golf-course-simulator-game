import type { Point } from "../../models/types";
import type { ClubSpec, GolferProfile } from "../golferProfiles";
import { BALANCE } from "../../balance/balanceConfig";

export interface ShotEval {
  distanceYards: number;
  utilization: number; // d / carry
  dispersionTiles: number;
  baseStrokeCost: number; // always 1 for now
  // downstream components (filled in later prompts)
  expectedLandingPenalty: number;
  expectedCarryPenalty: number;
  expectedShotCost: number;
  debug: string[];
  isValid: boolean;
}

function distTiles(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function evalShotBase(args: {
  from: Point;
  to: Point;
  golfer: GolferProfile;
  club: ClubSpec;
}): ShotEval {
  const { from, to, golfer, club } = args;
  const dTiles = distTiles(from, to);
  const dYards = dTiles * golfer.yardsPerTile;
  const utilization = club.carryYards <= 0 ? 99 : dYards / club.carryYards;

  // Dispersion grows as utilization pushes beyond 90% of carry.
  const utilThresh = BALANCE.shots.utilizationThreshold;
  const utilOver = Math.max(0, utilization - utilThresh);
  const dispMult = 1 + utilOver * BALANCE.shots.dispersionRamp;
  const dispersionTiles = club.dispersionTilesBase * dispMult;

  const baseStrokeCost = 1;
  const expectedLandingPenalty = 0;
  const expectedCarryPenalty = 0;
  const expectedShotCost = baseStrokeCost + expectedLandingPenalty + expectedCarryPenalty;

  return {
    distanceYards: dYards,
    utilization,
    dispersionTiles,
    baseStrokeCost,
    expectedLandingPenalty,
    expectedCarryPenalty,
    expectedShotCost,
    isValid: true,
    debug: [
      `d=${dYards.toFixed(0)}y`,
      `club=${club.name}(${club.carryYards}y)`,
      `util=${(utilization * 100).toFixed(0)}%`,
      `disp=${dispersionTiles.toFixed(2)} tiles`,
    ],
  };
}


