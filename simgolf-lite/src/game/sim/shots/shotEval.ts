import type { Course, Point } from "../../models/types";
import type { ClubSpec, GolferProfile } from "../golferProfiles";
import { BALANCE } from "../../balance/balanceConfig";
import { getElevation } from "../../models/elevation";

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
  // Optional: enables elevation-aware effective distance (ZKU-146). All
  // production callers pass it; it stays optional so geometry-only tests
  // and tools keep working.
  course?: Course;
}): ShotEval {
  const { from, to, golfer, club, course } = args;
  const dTiles = distTiles(from, to);
  const flatYards = dTiles * golfer.yardsPerTile;
  // Uphill plays longer, downhill shorter (never below half the flat
  // distance, so extreme drops can't make shots free).
  const elevDelta = course
    ? getElevation(course, to.x, to.y) - getElevation(course, from.x, from.y)
    : 0;
  const dYards = Math.max(
    flatYards * 0.5,
    flatYards + elevDelta * BALANCE.elevation.shotYardsPerStep
  );
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
      elevDelta !== 0 ? `d=${dYards.toFixed(0)}y (flat ${flatYards.toFixed(0)}y, elev ${elevDelta > 0 ? "+" : ""}${elevDelta})` : `d=${dYards.toFixed(0)}y`,
      `club=${club.name}(${club.carryYards}y)`,
      `util=${(utilization * 100).toFixed(0)}%`,
      `disp=${dispersionTiles.toFixed(2)} tiles`,
    ],
  };
}


