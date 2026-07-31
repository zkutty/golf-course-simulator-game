import type { Course, Point } from "../../models/types";
import type { ClubSpec, GolferProfile } from "../golferProfiles";
import { BALANCE } from "../../balance/balanceConfig";
import {
  analyzeShotSlope,
  normalizeShotSlopeContext,
  type ShotHandedness,
  type ShotSlopeContext,
} from "../../models/shotSlope";

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
  /** Optional immutable context for consumers that persist a completed shot. */
  shotSlope?: ShotSlopeContext;
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
  /** A previously captured frozen slope context takes precedence over course. */
  shotSlope?: ShotSlopeContext;
  /** Compatibility alias while callers converge on `shotSlope`. */
  slopeContext?: ShotSlopeContext;
  handedness?: ShotHandedness;
}): ShotEval {
  const { from, to, golfer, club, course } = args;
  const dTiles = distTiles(from, to);
  const flatYards = dTiles * golfer.yardsPerTile;
  const shotSlope = normalizeShotSlopeContext(args.shotSlope ?? args.slopeContext)
    ?? (course ? analyzeShotSlope({
      course,
      from,
      to,
      yardsPerTile: golfer.yardsPerTile,
      handedness: args.handedness,
      yardsPerElevationStep: BALANCE.elevation.shotYardsPerStep,
    }) : undefined);
  const elevDelta = shotSlope?.targetElevationDelta ?? 0;
  // Uphill plays longer, downhill shorter (never below half the flat
  // distance, so extreme drops can't make shots free). The frozen context
  // lets retained/replayed shots stay independent of later sculpting.
  const dYards = shotSlope?.playsLikeDistanceYards ?? flatYards;
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
    ...(shotSlope ? { shotSlope } : {}),
    debug: [
      elevDelta !== 0 ? `d=${dYards.toFixed(0)}y (flat ${flatYards.toFixed(0)}y, elev ${elevDelta > 0 ? "+" : ""}${elevDelta})` : `d=${dYards.toFixed(0)}y`,
      `club=${club.name}(${club.carryYards}y)`,
      `util=${(utilization * 100).toFixed(0)}%`,
      `disp=${dispersionTiles.toFixed(2)} tiles`,
    ],
  };
}

