import type { Course } from "../models/types";
import { scoreCourseHoles } from "./holes";

export interface RatingSummary {
  holesUsed: number; // 9 or 18
  expectedScratchScore: number; // 18-hole equivalent
  expectedBogeyScore: number; // 18-hole equivalent
  courseRating: number; // ≈ expectedScratchScore (18-hole), typical 67–75
  slopeRaw: number; // bogey - scratch
  slope: number; // USGA-like range ~55–155, 113 avg
}

interface GolferProfile {
  // carry distances (yards)
  driver: number;
  wood3: number;
  iron5: number;
  iron7: number;
  pw: number;
  // penalty multipliers
  hazardMult: number;
  roughMult: number;
  deepRoughMult: number;
  obstacleMult: number;
}

const SCRATCH: GolferProfile = {
  driver: 280,
  wood3: 250,
  iron5: 200,
  iron7: 170,
  pw: 135,
  hazardMult: 1.0,
  roughMult: 0.8,
  deepRoughMult: 1.0,
  obstacleMult: 1.0,
};

const BOGEY: GolferProfile = {
  driver: 220,
  wood3: 200,
  iron5: 160,
  iron7: 140,
  pw: 110,
  hazardMult: 1.5,
  roughMult: 1.4,
  deepRoughMult: 1.8,
  obstacleMult: 1.3,
};

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function estimateShotsToReachGreen(distanceYards: number, profile: GolferProfile) {
  // Greedy "longest club that doesn't overshoot too badly" approximation.
  // This intentionally stays simple + deterministic.
  const clubs = [profile.driver, profile.wood3, profile.iron5, profile.iron7, profile.pw].sort(
    (a, b) => b - a
  );

  let remaining = Math.max(0, distanceYards);
  let shots = 0;
  let guard = 0;

  while (remaining > 5 && guard++ < 20) {
    const carry = clubs.find((c) => c <= remaining + 20) ?? clubs[clubs.length - 1];
    remaining = Math.max(0, remaining - carry);
    shots++;
  }

  return shots;
}

function hazardPenaltyStrokes(args: {
  // fractions along the playable route
  waterFrac: number;
  sandFrac: number;
  roughFrac: number;
  deepRoughFrac: number;
  // obstacle "density" proxy
  obstaclePenalty: number;
  distanceYards: number;
  profile: GolferProfile;
}) {
  const { waterFrac, sandFrac, roughFrac, deepRoughFrac, obstaclePenalty, distanceYards, profile } =
    args;

  // Long holes amplify the impact.
  const distFactor = clamp(distanceYards / 480, 0.3, 1.4);

  // Water is the biggest "forced layup" driver; sand moderate.
  const hazard = profile.hazardMult * (2.2 * waterFrac + 0.9 * sandFrac);
  const lie = profile.roughMult * (0.9 * roughFrac) + profile.deepRoughMult * (1.2 * deepRoughFrac);
  const obst = profile.obstacleMult * obstaclePenalty;

  // Convert to strokes (fractional) and cap to keep it MVP-friendly.
  const raw = distFactor * (hazard + lie + obst);
  return clamp(raw * 1.4, 0, 2.5);
}

function computeExpectedScoreForHole(course: Course, holeIndex: number, profile: GolferProfile) {
  const summary = scoreCourseHoles(course);
  const h = summary.holes[holeIndex];
  if (!h || !h.isComplete || !h.isValid) {
    // Treat invalid holes as very punishing (forces redesign); bogey punished more.
    return profile === BOGEY ? 9 : 7;
  }

  const yardsPerTile = course.yardsPerTile ?? 10;
  const distanceYards = h.effectiveDistance * yardsPerTile;

  const s = h.corridor.samples || 1;
  const waterFrac = h.corridor.water / s;
  const sandFrac = h.corridor.sand / s;
  const roughFrac = h.corridor.rough / s;
  const deepRoughFrac = h.corridor.deep_rough / s;

  // Obstacle proxy: difficulty above baseline indicates more forced shots.
  const obstaclePenalty = clamp((h.difficultyScore - 45) / 100, 0, 1);

  const baseShots = estimateShotsToReachGreen(distanceYards, profile);
  const penalty = hazardPenaltyStrokes({
    waterFrac,
    sandFrac,
    roughFrac,
    deepRoughFrac,
    obstaclePenalty,
    distanceYards,
    profile,
  });

  // Two putts baseline; keep MVP simple.
  const puttingBaseline = 2;
  const expected = baseShots + penalty + puttingBaseline;
  return expected;
}

export function computeCourseRatingAndSlope(course: Course): RatingSummary {
  const holeSummary = scoreCourseHoles(course);
  const n = holeSummary.holes.length;
  const holesUsed = n >= 18 ? 18 : 9;

  const scratch9 = Array.from({ length: Math.min(holesUsed, n) }, (_, i) =>
    computeExpectedScoreForHole(course, i, SCRATCH)
  ).reduce((a, b) => a + b, 0);

  const bogey9 = Array.from({ length: Math.min(holesUsed, n) }, (_, i) =>
    computeExpectedScoreForHole(course, i, BOGEY)
  ).reduce((a, b) => a + b, 0);

  const mult = holesUsed === 9 ? 2 : 1;
  const expectedScratchScore = scratch9 * mult;
  const expectedBogeyScore = bogey9 * mult;

  const slopeRaw = expectedBogeyScore - expectedScratchScore;

  // USGA-like mapping:
  // We choose the baseline that a "typical" course has bogey-scratch spread ≈ 20 strokes over 18 holes,
  // and that corresponds to slope 113 (average).
  // So: slope = 113 * (slopeRaw / 20), clamped to [55, 155].
  const slope = Math.round(clamp((113 * slopeRaw) / 20, 55, 155));

  // Course rating is expected scratch score (keep in realistic band via calibration + clamp for display).
  const courseRating = Math.round(expectedScratchScore * 10) / 10;

  return {
    holesUsed,
    expectedScratchScore: Math.round(expectedScratchScore * 10) / 10,
    expectedBogeyScore: Math.round(expectedBogeyScore * 10) / 10,
    courseRating,
    slopeRaw: Math.round(slopeRaw * 10) / 10,
    slope,
  };
}



