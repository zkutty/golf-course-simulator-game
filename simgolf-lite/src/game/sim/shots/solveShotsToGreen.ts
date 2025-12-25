import type { Course, Point, Terrain } from "../../models/types";
import type { GolferProfile } from "../golferProfiles";
import { evalShotExpectedCost } from "./evalShotExpectedCost";
import { BALANCE } from "../../balance/balanceConfig";

export interface ShotPlanStep {
  from: Point;
  to: Point;
  club: string;
  expectedShotCost: number;
  utilization: number;
  debug: string[];
}

export interface ShotSolveResult {
  reachable: boolean;
  expectedShotsToGreen: number; // expected strokes to reach green (excludes putting)
  plan: ShotPlanStep[];
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function key(p: Point) {
  return p.y * 10_000 + p.x;
}

function tileAt(course: Course, p: Point): Terrain {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return "rough";
  return course.tiles[p.y * course.width + p.x];
}

function inBounds(course: Course, p: Point) {
  return p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
}

class MinHeap<T> {
  private a: Array<{ k: number; v: T }> = [];
  push(k: number, v: T) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { k: number; v: T } | null {
    const a = this.a;
    if (a.length === 0) return null;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

function candidateOK(t: Terrain) {
  return t !== "water";
}

const ANGLES_8: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function solveShotsToGreen(args: {
  course: Course;
  tee: Point;
  green: Point;
  golfer: GolferProfile;
}): ShotSolveResult {
  const { course, tee, green, golfer } = args;

  if (!inBounds(course, tee) || !inBounds(course, green)) {
    return { reachable: false, expectedShotsToGreen: Infinity, plan: [] };
  }
  if (!candidateOK(tileAt(course, tee)) || !candidateOK(tileAt(course, green))) {
    return { reachable: false, expectedShotsToGreen: Infinity, plan: [] };
  }

  const startK = key(tee);
  const goalK = key(green);

  const dist = new Map<number, number>();
  const prev = new Map<number, { fromK: number; step: ShotPlanStep }>();
  const pq = new MinHeap<number>();

  dist.set(startK, 0);
  pq.push(0, startK);

  // Sampled landing distances (fractions of carry) to keep branching under control.
  const fracs = [0.55, 0.75, 0.92, 1.0];

  // Hard cap to prevent runaway compute (holes are small; this is mostly a safety net).
  let expansions = 0;
  const maxExpansions = 12_000;

  while (pq.size && expansions++ < maxExpansions) {
    const cur = pq.pop()!;
    const curK = cur.v;
    const curD = cur.k;
    const best = dist.get(curK);
    if (best == null || curD !== best) continue;
    if (curK === goalK) break;

    const cx = curK % 10_000;
    const cy = Math.floor(curK / 10_000);
    const from: Point = { x: cx, y: cy };

    for (const club of golfer.clubs) {
      const maxTiles = Math.max(1, Math.floor((club.carryYards / golfer.yardsPerTile) * 1.05));
      for (const frac of fracs) {
        const dTiles = clamp(Math.round(maxTiles * frac), 1, maxTiles);
        for (const [ax, ay] of ANGLES_8) {
          const to: Point = { x: from.x + ax * dTiles, y: from.y + ay * dTiles };
          if (!inBounds(course, to)) continue;
          if (!candidateOK(tileAt(course, to))) continue;
          const ev = evalShotExpectedCost({ course, from, to, golfer, club });
          if (!ev.isValid || !Number.isFinite(ev.expectedShotCost)) continue;
          const nd = curD + ev.expectedShotCost;
          const toK = key(to);
          const old = dist.get(toK);
          if (old == null || nd < old) {
            dist.set(toK, nd);
            prev.set(toK, {
              fromK: curK,
              step: {
                from,
                to,
                club: club.name,
                expectedShotCost: ev.expectedShotCost,
                utilization: ev.utilization,
                debug: ev.debug,
              },
            });
            pq.push(nd, toK);
          }
        }
      }

      // Always consider direct-to-green as a candidate landing (important for doglegs).
      const evG = evalShotExpectedCost({ course, from, to: green, golfer, club });
      if (evG.isValid && Number.isFinite(evG.expectedShotCost)) {
        const nd = curD + evG.expectedShotCost;
        const old = dist.get(goalK);
        if (old == null || nd < old) {
          dist.set(goalK, nd);
          prev.set(goalK, {
            fromK: curK,
            step: {
              from,
              to: green,
              club: club.name,
              expectedShotCost: evG.expectedShotCost,
              utilization: evG.utilization,
              debug: evG.debug,
            },
          });
          pq.push(nd, goalK);
        }
      }
    }
  }

  const best = dist.get(goalK);
  if (best == null || !Number.isFinite(best) || best > BALANCE.shots.water.maxExpectedShotsToGreen) {
    return { reachable: false, expectedShotsToGreen: best ?? Infinity, plan: [] };
  }

  // Reconstruct plan
  const plan: ShotPlanStep[] = [];
  let k0 = goalK;
  while (k0 !== startK) {
    const p = prev.get(k0);
    if (!p) break;
    plan.push(p.step);
    k0 = p.fromK;
  }
  plan.reverse();

  return { reachable: true, expectedShotsToGreen: best, plan };
}



