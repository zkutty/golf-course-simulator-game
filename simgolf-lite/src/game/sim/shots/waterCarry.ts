import type { Course, Point } from "../../models/types";
import type { ClubSpec, GolferProfile } from "../golferProfiles";
import { BALANCE } from "../../balance/balanceConfig";
import { evalShotBase } from "./shotEval";

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function bresenham(a: Point, b: Point): Point[] {
  const pts: Point[] = [];
  let x0 = a.x | 0;
  let y0 = a.y | 0;
  const x1 = b.x | 0;
  const y1 = b.y | 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pts.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

function tileAt(course: Course, p: Point) {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return "rough";
  return course.tiles[p.y * course.width + p.x];
}

export function evalShotWithWaterCarry(args: {
  course: Course;
  from: Point;
  to: Point;
  golfer: GolferProfile;
  club: ClubSpec;
}) {
  const { course, from, to, golfer, club } = args;
  const base = evalShotBase({ from, to, golfer, club });

  const line = bresenham(from, to);
  // compute longest contiguous water segment crossed along the shot line (excluding the start tile)
  let run = 0;
  let best = 0;
  for (let i = 1; i < line.length; i++) {
    const t = tileAt(course, line[i]);
    if (t === "water") {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  const waterCarryYards = best * golfer.yardsPerTile;

  if (waterCarryYards > 0) {
    const required = waterCarryYards + BALANCE.shots.water.carryBufferYards;
    if (club.carryYards < required) {
      return {
        ...base,
        isValid: false,
        expectedCarryPenalty: Infinity,
        expectedShotCost: Infinity,
        debug: [...base.debug, `waterCarry=${waterCarryYards.toFixed(0)}y`, `invalid: carry<${required.toFixed(0)}y`],
      };
    }

    // Short miss probability rises when utilization is high. Short miss lands along shot line,
    // and for water carries we approximate that it often splashes.
    const u0 = BALANCE.shots.water.shortMissUtilStart;
    const p = clamp01((base.utilization - u0) / Math.max(1e-6, 1 - u0)) * BALANCE.shots.water.shortMissMaxProb;
    const expectedCarryPenalty = p * BALANCE.shots.water.waterPenaltyStrokes;
    return {
      ...base,
      expectedCarryPenalty,
      expectedShotCost: base.baseStrokeCost + base.expectedLandingPenalty + expectedCarryPenalty,
      debug: [
        ...base.debug,
        `waterCarry=${waterCarryYards.toFixed(0)}y`,
        `shortMissP=${(p * 100).toFixed(0)}%`,
        `carryPen=+${expectedCarryPenalty.toFixed(2)}`,
      ],
    };
  }

  return base;
}





