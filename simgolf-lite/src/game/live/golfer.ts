import type { Course, Point } from "../models/types";
import type { GolferProfile } from "../sim/golferProfiles";
import { solveShotsToGreen } from "../sim/shots/solveShotsToGreen";
import { scoreCourseHoles } from "../sim/holes";
import { LIVE } from "./liveConfig";
import { findWalkPath } from "./walkPath";
import type { Golfer, Segment } from "./types";

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function walkSeg(from: Point, to: Point, holeIndex: number, cap = Infinity): Segment {
  const d = dist(from, to);
  return { kind: "walk", from, to, holeIndex, dur: Math.min(cap, d * LIVE.pace.walkPerTile) };
}

// Routed walk: one segment per polyline leg along walkable tiles (around
// water, preferring short grass / paths). The whole walk is capped at `cap`
// game-minutes by scaling leg durations, so long detours read as brisk walks
// rather than stalling the round.
function walkSegs(
  course: Course,
  from: Point,
  to: Point,
  holeIndex: number,
  cap = Infinity
): Segment[] {
  const pts = findWalkPath(course, from, to);
  const legs: Segment[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dur = dist(pts[i - 1], pts[i]) * LIVE.pace.walkPerTile;
    total += dur;
    legs.push({ kind: "walk", from: pts[i - 1], to: pts[i], holeIndex, dur });
  }
  if (legs.length === 0) return [walkSeg(from, to, holeIndex, cap)];
  if (total > cap && total > 0) {
    const k = cap / total;
    for (const leg of legs) leg.dur *= k;
  }
  return legs;
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
  holeNumbers: number[]; // course hole index of each entry above
}

// Build a golfer's full itinerary across all valid holes, reusing the existing
// Dijkstra shot-planner to decide where each shot lands.
export function buildGolferRound(args: {
  course: Course;
  profile: GolferProfile;
  entry: Point;
  rng: () => number;
  puttVariance: number;
}): BuiltRound {
  const { course, profile, entry, rng, puttVariance } = args;
  const summary = scoreCourseHoles(course);
  const segments: Segment[] = [];
  const holePar: number[] = [];
  const holeStrokes: number[] = [];
  const holeNumbers: number[] = [];

  let cursor: Point = entry;

  for (let i = 0; i < course.holes.length; i++) {
    const hole = course.holes[i];
    const info = summary.holes[i];
    if (!hole.tee || !hole.green || !info?.isComplete || !info?.isValid) continue;

    const tee = hole.tee;
    const green = hole.green;
    const par = info.par ?? 4;

    // Walk from wherever we are to this tee, along walkable tiles. The final
    // approach leg is the hole's tee-time gate (ZKU-110).
    const approach = walkSegs(course, cursor, tee, i, LIVE.pace.interHoleWalkCap);
    approach[approach.length - 1].gate = true;
    segments.push(...approach);

    // Plan the shots to the green and play them out.
    const solved = solveShotsToGreen({ course, tee, green, golfer: profile });
    let shots = 0;
    if (solved.reachable && solved.plan.length > 0) {
      for (const step of solved.plan) {
        segments.push(pauseSeg(step.from, i, LIVE.pace.swingPause));
        segments.push(flightSeg(step.from, step.to, i));
        segments.push(...walkSegs(course, step.from, step.to, i));
        shots++;
      }
    } else {
      // Unreachable (e.g. water-blocked): a single frustrated hack straight up.
      segments.push(pauseSeg(tee, i, LIVE.pace.swingPause));
      segments.push(flightSeg(tee, green, i));
      segments.push(...walkSegs(course, tee, green, i));
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
    holeNumbers.push(i);
    cursor = green;
  }

  // Walk off to the exit.
  segments.push(...walkSegs(course, cursor, entry, -1, LIVE.pace.interHoleWalkCap));

  return { segments, holePar, holeStrokes, holeNumbers };
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
// golfer (mutated in place for the caller's array). `canEnter` is the
// tee-time gate check (ZKU-110): asked once per hole entry; returning false
// holds the golfer waiting at the tee and burns the rest of this tick.
export function advanceGolfer(
  g: Golfer,
  dtMin: number,
  condition: number,
  canEnter?: (holeIndex: number, g: Golfer) => boolean
): void {
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
      // About to move past this segment. A gate holds the golfer at the tee
      // until the hole ahead has room; waiting slowly sours their mood.
      if (seg.gate && canEnter && !canEnter(seg.holeIndex, g)) {
        g.segElapsed = seg.dur;
        g.pos = { ...seg.to };
        g.ball = null;
        g.waiting = true;
        g.waitMinutes += remaining;
        g.mood = clamp01(g.mood + remaining * LIVE.mood.perWaitMinute);
        if (seg.holeIndex >= 0) g.currentHole = seg.holeIndex;
        return;
      }
      g.waiting = false;
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
