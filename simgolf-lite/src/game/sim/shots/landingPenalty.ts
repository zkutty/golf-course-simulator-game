import type { Course, Terrain } from "../../models/types";
import type { Point } from "../../models/types";
import { BALANCE } from "../../balance/balanceConfig";

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function tileAt(course: Course, p: Point): Terrain {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return "rough";
  return course.tiles[p.y * course.width + p.x];
}

export interface LandingPenaltyResult {
  expectedPenalty: number;
  probs: Partial<Record<Terrain, number>>;
}

export function computeExpectedLandingPenalty(args: {
  course: Course;
  target: Point;
  dispersionTiles: number;
}): LandingPenaltyResult {
  const { course, target } = args;
  const r0 = Math.max(0.5, args.dispersionTiles);
  const r = Math.min(BALANCE.shots.landing.maxRadiusTiles, Math.ceil(r0));

  // Simple Gaussian-ish weight: closer tiles more likely.
  const sigma = Math.max(0.8, r0 * 0.55);
  const twoSigma2 = 2 * sigma * sigma;

  let totalW = 0;
  const weightByTerrain: Partial<Record<Terrain, number>> = {};

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r0 * r0) continue;
      const w = Math.exp(-d2 / twoSigma2);
      totalW += w;
      const t = tileAt(course, { x: target.x + dx, y: target.y + dy });
      weightByTerrain[t] = (weightByTerrain[t] ?? 0) + w;
    }
  }

  const probs: Partial<Record<Terrain, number>> = {};
  let expected = 0;
  const pen = BALANCE.shots.landing.penaltyStrokes;

  if (totalW <= 0) {
    return { expectedPenalty: 0, probs: {} };
  }

  for (const [k, w] of Object.entries(weightByTerrain) as Array<[Terrain, number]>) {
    const p = clamp(w / totalW, 0, 1);
    probs[k] = p;
    expected += p * (pen[k] ?? 0);
  }

  return { expectedPenalty: expected, probs };
}


