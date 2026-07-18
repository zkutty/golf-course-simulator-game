import type { Course, Point } from "../models/types";
import type { GolferProfile } from "../sim/golferProfiles";
import { solveShotsToGreen } from "../sim/shots/solveShotsToGreen";
import { scoreCourseHoles } from "../sim/holes";
import { mulberry32 } from "../../utils/rng";
import { LIVE } from "./liveConfig";
import { mishitChance, puttOutcome, type Personality } from "./personality";
import { decidePurchase, planRoundStops, type PlannedStop } from "./concessions";
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

function flightSeg(from: Point, to: Point, holeIndex: number, shot: "swing" | "putt" = "swing"): Segment {
  const d = dist(from, to);
  const dur = Math.max(LIVE.pace.flightMin, Math.min(LIVE.pace.flightMax, d * LIVE.pace.flightPerTile));
  return { kind: "flight", from, to, holeIndex, dur, shot };
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
// Dijkstra shot-planner to decide where each shot lands. Starts from the entry
// point and walks off to the same exit at the end.
export function buildGolferRound(args: {
  course: Course;
  profile: GolferProfile;
  entry: Point;
  rng: () => number;
  personality: Personality;
  route?: WalkRouter;
}): BuiltRound {
  return planFromHole({
    course: args.course,
    profile: args.profile,
    personality: args.personality,
    rng: args.rng,
    startHole: 0,
    cursor: args.entry,
    exit: args.entry,
    route: args.route,
    freshRound: true,
  });
}

// Plan an itinerary for the valid holes from `startHole` onward, beginning at
// `cursor` (the golfer's current position) and ending with a walk-off to `exit`.
// Used both to build a fresh round (from the entry, hole 0) and to re-plan the
// remainder of a round in progress when the course is edited (ZKU-136).
export function planFromHole(args: {
  course: Course;
  profile: GolferProfile;
  personality: Personality;
  rng: () => number;
  startHole: number;
  cursor: Point;
  exit: Point;
  route?: WalkRouter;
  /** True on a brand-new round: enables pre-round concession stops (M4). */
  freshRound?: boolean;
}): BuiltRound {
  const { course, profile, rng, personality, startHole, exit, route, freshRound } = args;
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

  let cursor: Point = args.cursor;

  // Concession detours (ZKU-119): walk to the counter, wait to be served
  // (the pause carries the stop info that triggers the buy roll), walk on.
  const stops = planRoundStops({ course, personality, rng, entry: args.cursor });
  let stopIndex = 0;
  let snackStops = 0;
  const pushStop = (stop: PlannedStop, holeIndex: number) => {
    pushWalk(cursor, stop.point, holeIndex, LIVE.pace.interHoleWalkCap);
    segments.push({
      kind: "pause",
      from: stop.point,
      to: stop.point,
      holeIndex,
      dur: stop.serviceMinutes,
      stop: { ...stop.info, stopIndex: stopIndex++ },
    });
    cursor = stop.point;
  };

  if (freshRound) {
    for (const stop of stops.preRound) pushStop(stop, -1);
  }

  let holesPlayed = 0;
  for (let i = Math.max(0, startHole); i < course.holes.length; i++) {
    const hole = course.holes[i];
    const info = summary.holes[i];
    if (!hole.tee || !hole.green || !info?.isComplete || !info?.isValid) continue;

    const tee = hole.tee;
    const green = hole.green;
    const par = info.par ?? 4;

    // Between holes: maybe swing by a snack bar on the way to the next tee
    // (ZKU-119). Never before the first hole of this plan — pre-round shopping
    // is its own path above — and capped so pacing stays intact.
    if (holesPlayed > 0) {
      const snack = stops.snackAfterHole(cursor, holesPlayed, snackStops);
      if (snack) {
        snackStops++;
        pushStop(snack, i);
      }
    }

    // Walk from wherever we are to this tee (routed around water).
    pushWalk(cursor, tee, i, LIVE.pace.interHoleWalkCap);

    // Plan the shots to the green and play them out. The planner returns one
    // optimal line for the profile; personality then adds recovery strokes when
    // a shot is mishit, so the same hole yields a spread of scores (ZKU-113).
    const solved = solveShotsToGreen({ course, tee, green, golfer: profile });
    let shots = 0;
    let penalties = 0;
    if (solved.reachable && solved.plan.length > 0) {
      for (const step of solved.plan) {
        segments.push(pauseSeg(step.from, i, LIVE.pace.swingPause));
        segments.push(flightSeg(step.from, step.to, i));
        pushWalk(step.from, step.to, i); // walk to the ball, routed around water
        shots++;
        if (rng() < mishitChance(personality)) penalties++; // sprayed shot
      }
    } else {
      // Unreachable (e.g. water-blocked): a single frustrated hack straight up.
      segments.push(pauseSeg(tee, i, LIVE.pace.swingPause));
      segments.push(flightSeg(tee, green, i));
      pushWalk(tee, green, i);
      shots = par + 1;
    }

    // Putting: base 2, adjusted by personality (skill drains more, low
    // consistency swings both ways).
    const putts = puttOutcome(personality, rng());
    // A short putting flourish on the green (visuals independent of putt count).
    const near: Point = { x: green.x + 0.6, y: green.y + 0.4 };
    segments.push(pauseSeg(green, i, LIVE.pace.puttPause));
    segments.push(flightSeg(near, green, i, "putt"));
    segments.push(walkSeg(near, green, i, LIVE.pace.puttWalk));

    holePar.push(par);
    holeStrokes.push(shots + penalties + putts);
    cursor = green;
    holesPlayed++;
  }

  // A browse through the pro shop on the way out (ZKU-119), then the exit.
  if (stops.postRound && holesPlayed > 0) pushStop(stops.postRound, -1);

  // Walk off to the exit (routed around water).
  pushWalk(cursor, exit, -1, LIVE.pace.interHoleWalkCap);

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
      // Fold any hole whose segments we just walked off the end of.
      while (g.scoredHoles < g.holeStrokes.length) scoreNextHole(g, condition);
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
      // Leaving a concession counter (M4/ZKU-118): roll the purchase. The
      // roll is seeded per golfer+stop, so the outcome is identical no matter
      // how the frame timing sliced this segment.
      if (seg.stop) {
        const roll = mulberry32((g.purchaseSeed + seg.stop.stopIndex * 7919) | 0)();
        const buys = decidePurchase({
          personality: g.personality,
          mood: g.mood,
          wallet: g.wallet,
          info: seg.stop,
          roll,
        });
        if (buys) {
          g.wallet -= seg.stop.price;
          g.spent += seg.stop.price;
          g.mood = clamp01(g.mood + LIVE.mood.concessionLift);
          g.pendingPurchases.push({
            kind: seg.stop.kind,
            amount: seg.stop.price,
            goodsCost: seg.stop.goodsCost,
          });
        }
      }
      g.segIndex++;
      // Detect hole completion: we just left a real hole for a different one.
      // Each boundary scores exactly the next unscored hole, so the fold stays
      // correct even across invalid-hole gaps or a mid-round re-plan (ZKU-136).
      const next = g.segments[g.segIndex];
      if (seg.holeIndex >= 0 && (!next || next.holeIndex !== seg.holeIndex)) {
        scoreNextHole(g, condition);
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

// Fold the next unscored hole into the running score and mood. Called once per
// hole boundary, so exactly one hole is scored per completed hole.
function scoreNextHole(g: Golfer, condition: number): void {
  if (g.scoredHoles >= g.holeStrokes.length) return;
  const i = g.scoredHoles;
  const delta = g.holeStrokes[i] - g.holePar[i];
  g.scoreToPar += delta;
  g.strokes += g.holeStrokes[i];
  // Patient golfers shrug off a bad hole; impatient ones sour faster. Only the
  // downside is dampened — a birdie lifts everyone equally.
  const patienceRelief = 1 - g.personality.patience * 0.5; // 0.5 .. 1.0
  const m =
    delta > 0
      ? LIVE.mood.perStrokeOverPar * delta * patienceRelief
      : LIVE.mood.perStrokeUnderPar * -delta;
  g.mood = clamp01(g.mood + m + (condition - 0.6) * 0.02);
  g.scoredHoles++;
}

function clamp01(x: number): number {
  return Math.max(LIVE.mood.min, Math.min(LIVE.mood.max, x));
}
