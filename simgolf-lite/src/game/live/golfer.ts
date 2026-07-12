import type { Course, Point } from "../models/types";
import type { GolferProfile } from "../sim/golferProfiles";
import { solveShotsToGreen } from "../sim/shots/solveShotsToGreen";
import { scoreCourseHoles } from "../sim/holes";
import { LIVE } from "./liveConfig";
import type { Golfer, Segment } from "./types";

// Optional tile-aware router; returns waypoints from just-after `from` to `to`,
// or null to fall back to a straight-line walk.
export type WalkRouter = (from: Point, to: Point) => Point[] | null;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function walkSeg(from: Point, to: Point, holeIndex: number, cap = Infinity): Segment {
  const d = dist(from, to);
  return { kind: "walk", from, to, holeIndex, dur: Math.min(cap, d * LIVE.pace.walkPerTile) };
}

function flightSeg(from: Point, to: Point, holeIndex: number): Segment {
  const d = dist(from, to);
  const dur = Math.max(LIVE.pace.flightMin, Math.min(LIVE.pace.flightMax, d * LIVE.pace.flightPerTile));
  return { kind: "flight", from, to, holeIndex, dur };
}

function pauseSeg(at: Point, holeIndex: number, dur: number): Segment {
  return { kind: "pause", from: at, to: at, holeIndex, dur };
}

export interface BuiltRound {
  segments: Segment[];
  holePar: number[];
  holeStrokes: number[];
}

// Build a golfer's full itinerary across all valid holes, reusing the existing
// Dijkstra shot-planner to decide where each shot lands.
export function buildGolferRound(args: {
  course: Course;
  profile: GolferProfile;
  entry: Point;
  rng: () => number;
  puttVariance: number;
  route?: WalkRouter;
}): BuiltRound {
  const { course, profile, entry, rng, puttVariance, route } = args;
  const summary = scoreCourseHoles(course);
  const segments: Segment[] = [];
  const holePar: number[] = [];
  const holeStrokes: number[] = [];

  // Push a walk from -> to, routed around water when a router is provided,
  // otherwise a single straight segment (optionally duration-capped).
  const pushWalk = (from: Point, to: Point, holeIndex: number, cap = Infinity) => {
    if (route) {
      const path = route(from, to);
      if (path && path.length) {
        let cur = from;
        for (const wp of path) {
          segments.push(walkSeg(cur, wp, holeIndex));
          cur = wp;
        }
        return;
      }
    }
    segments.push(walkSeg(from, to, holeIndex, cap));
  };

  let cursor: Point = entry;

  for (let i = 0; i < course.holes.length; i++) {
    const hole = course.holes[i];
    const info = summary.holes[i];
    if (!hole.tee || !hole.green || !info?.isComplete || !info?.isValid) continue;

    const tee = hole.tee;
    const green = hole.green;
    const par = info.par ?? 4;

    // Walk from wherever we are to this tee (routed around water).
    pushWalk(cursor, tee, i, LIVE.pace.interHoleWalkCap);

    // Plan the shots to the green and play them out.
    const solved = solveShotsToGreen({ course, tee, green, golfer: profile });
    let shots = 0;
    if (solved.reachable && solved.plan.length > 0) {
      for (const step of solved.plan) {
        segments.push(pauseSeg(step.from, i, LIVE.pace.swingPause));
        segments.push(flightSeg(step.from, step.to, i));
        pushWalk(step.from, step.to, i); // walk to the ball, routed around water
        shots++;
      }
    } else {
      // Unreachable (e.g. water-blocked): a single frustrated hack straight up.
      segments.push(pauseSeg(tee, i, LIVE.pace.swingPause));
      segments.push(flightSeg(tee, green, i));
      segments.push(walkSeg(tee, green, i));
      shots = par + 1;
    }

    // Putting: base putts with skill-based variance.
    let putts: number = LIVE.scoring.basePutts;
    const roll = rng();
    if (roll < puttVariance * 0.5) putts += 1; // 3-putt
    else if (roll > 1 - puttVariance * 0.5) putts = Math.max(1, putts - 1); // 1-putt
    // A short putting flourish on the green (visuals independent of putt count).
    const near: Point = { x: green.x + 0.6, y: green.y + 0.4 };
    segments.push(pauseSeg(green, i, LIVE.pace.puttPause));
    segments.push(flightSeg(near, green, i));
    segments.push(walkSeg(near, green, i, LIVE.pace.puttWalk));

    holePar.push(par);
    holeStrokes.push(shots + putts);
    cursor = green;
  }

  // Walk off to the exit (routed around water).
  pushWalk(cursor, entry, -1, LIVE.pace.interHoleWalkCap);

  return { segments, holePar, holeStrokes };
}

export function entryPoint(course: Course): Point {
  return {
    x: Math.max(0, Math.min(course.width - 1, Math.round(course.width * LIVE.entry.xFrac))),
    y: Math.max(0, Math.min(course.height - 1, Math.round(course.height * LIVE.entry.yFrac))),
  };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function ballArc(from: Point, to: Point, t: number): Point {
  // Straight-line ground track; the render layer adds a visual hop.
  return lerp(from, to, t);
}

// Advance a single golfer by `dtMin` game-minutes, walking through its segment
// itinerary. Updates position, ball, running score, and mood. Returns the
// golfer (mutated in place for the caller's array).
export function advanceGolfer(g: Golfer, dtMin: number, condition: number): void {
  if (g.finished) return;
  let remaining = dtMin;
  let guard = 0;

  while (remaining > 0 && guard++ < 10_000) {
    if (g.segIndex >= g.segments.length) {
      finishHole(g, g.segments.length); // score any trailing hole
      g.finished = true;
      g.ball = null;
      g.currentHole = -1;
      return;
    }
    const seg = g.segments[g.segIndex];
    const left = seg.dur - g.segElapsed;

    if (remaining < left) {
      g.segElapsed += remaining;
      remaining = 0;
    } else {
      remaining -= left;
      g.segElapsed = 0;
      g.segIndex++;
      // Detect hole completion: we just left a real hole for a different one.
      const next = g.segments[g.segIndex];
      if (seg.holeIndex >= 0 && (!next || next.holeIndex !== seg.holeIndex)) {
        finishHole(g, seg.holeIndex + 1, condition);
      }
      continue;
    }

    // Interpolate position/ball for the (partial) current segment.
    const t = seg.dur > 0 ? Math.max(0, Math.min(1, g.segElapsed / seg.dur)) : 1;
    if (seg.holeIndex >= 0) g.currentHole = seg.holeIndex;
    if (seg.kind === "walk") {
      g.pos = lerp(seg.from, seg.to, t);
      g.ball = null;
    } else if (seg.kind === "flight") {
      g.pos = seg.from;
      g.ball = ballArc(seg.from, seg.to, t);
    } else {
      g.pos = seg.from;
      g.ball = null;
    }
  }
}

// Fold all holes with index < upTo that haven't been scored yet into the
// running scoreToPar, and update mood accordingly.
function finishHole(g: Golfer, upTo: number, condition = 0.75): void {
  while (g.scoredHoles < upTo && g.scoredHoles < g.holeStrokes.length) {
    const i = g.scoredHoles;
    const delta = g.holeStrokes[i] - g.holePar[i];
    g.scoreToPar += delta;
    g.strokes += g.holeStrokes[i];
    const m =
      delta > 0
        ? LIVE.mood.perStrokeOverPar * delta
        : LIVE.mood.perStrokeUnderPar * -delta;
    g.mood = clamp01(g.mood + m + (condition - 0.6) * 0.02);
    g.scoredHoles++;
  }
}

function clamp01(x: number): number {
  return Math.max(LIVE.mood.min, Math.min(LIVE.mood.max, x));
}
