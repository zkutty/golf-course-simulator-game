import { describe, it, expect } from "vitest";
import type { Course, World, Terrain } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { getGolferProfile } from "../sim/golferProfiles";
import { scoreCourseHoles } from "../sim/holes";
import { buildGolferRound, advanceGolfer, entryPoint } from "./golfer";
import { createLiveState, stepLive, avgSatisfactionSoFar, snapshotGolfer } from "./simulation";
import { planDay, plannedGolfersForDay } from "./spawn";
import { commitDay } from "./commitDay";
import { findWalkPath, pathLength } from "./walkPath";
import type { Golfer } from "./types";

// A tiny but valid course: a single wide fairway hole from left to right.
function makeTestCourse(): Course {
  const width = 60;
  const height = 24;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const set = (x: number, y: number, t: Terrain) => {
    tiles[y * width + x] = t;
  };
  const tee = { x: 4, y: 12 };
  const green = { x: 50, y: 12 };
  set(tee.x, tee.y, "tee");
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) set(green.x + dx, green.y + dy, "green");
  return {
    name: "Test",
    width,
    height,
    tiles,
    holes: [{ tee, green, parMode: "AUTO", name: "H1" }],
    obstacles: [],
    yardsPerTile: 10,
    baseGreenFee: 65,
    condition: 0.8,
  };
}

function freshGolfer(course: Course): Golfer {
  const round = buildGolferRound({
    course,
    profile: getGolferProfile("SCRATCH", course),
    entry: entryPoint(course),
    rng: (() => {
      let s = 0.5;
      return () => (s = (s * 9301 + 49297) % 1) as number;
    })(),
    puttVariance: 0.2,
  });
  return {
    id: 1,
    name: "Test G.",
    archetype: "lowHandicap",
    color: "#fff",
    segments: round.segments,
    segIndex: 0,
    segElapsed: 0,
    pos: { ...entryPoint(course) },
    ball: null,
    holePar: round.holePar,
    holeStrokes: round.holeStrokes,
    holeNumbers: round.holeNumbers,
    scoredHoles: 0,
    currentHole: -1,
    strokes: 0,
    scoreToPar: 0,
    mood: 0.7,
    waiting: false,
    waitMinutes: 0,
    thought: null,
    thoughtUntil: 0,
    finished: false,
    spent: 0,
  };
}

describe("test course validity", () => {
  it("has one complete, valid hole", () => {
    const course = makeTestCourse();
    const summary = scoreCourseHoles(course);
    expect(summary.holes[0].isComplete).toBe(true);
    expect(summary.holes[0].isValid).toBe(true);
  });
});

describe("buildGolferRound", () => {
  it("produces an itinerary and per-hole scores", () => {
    const course = makeTestCourse();
    const round = buildGolferRound({
      course,
      profile: getGolferProfile("SCRATCH", course),
      entry: entryPoint(course),
      rng: () => 0.5,
      puttVariance: 0.2,
    });
    expect(round.segments.length).toBeGreaterThan(0);
    expect(round.holeStrokes.length).toBe(1);
    expect(round.holePar.length).toBe(1);
    // Includes shots to green plus at least one putt.
    expect(round.holeStrokes[0]).toBeGreaterThanOrEqual(2);
  });
});

describe("advanceGolfer", () => {
  it("walks the full itinerary to completion and scores every hole", () => {
    const course = makeTestCourse();
    const g = freshGolfer(course);
    // Advance well past the total round duration.
    for (let i = 0; i < 400 && !g.finished; i++) {
      advanceGolfer(g, 2, course.condition);
    }
    expect(g.finished).toBe(true);
    expect(g.scoredHoles).toBe(g.holeStrokes.length);
    expect(g.strokes).toBeGreaterThan(0);
  });

  it("shows a ball only while a shot is in flight", () => {
    const course = makeTestCourse();
    const g = freshGolfer(course);
    let sawBall = false;
    for (let i = 0; i < 400 && !g.finished; i++) {
      advanceGolfer(g, 0.25, course.condition);
      if (g.ball) sawBall = true;
    }
    expect(sawBall).toBe(true);
  });
});

describe("planDay + volume", () => {
  it("clamps daily golfers into the watchable range", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD };
    const n = plannedGolfersForDay(course, world);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(42);
    const arrivals = planDay(course, world, 123);
    expect(arrivals.length).toBe(n);
    // sorted ascending
    for (let i = 1; i < arrivals.length; i++) {
      expect(arrivals[i].atMinute).toBeGreaterThanOrEqual(arrivals[i - 1].atMinute);
    }
  });
});

describe("stepLive", () => {
  it("spawns golfers, banks green fees, and finishes the day", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD };
    const live = createLiveState(course, world, 0);
    const planned = live.arrivals.length;

    let totalCash = 0;
    let guard = 0;
    while (!live.dayOver && guard++ < 100_000) {
      const ev = stepLive(live, course, 1);
      totalCash += ev.cashDelta;
    }

    expect(live.dayOver).toBe(true);
    expect(live.roundsStarted).toBe(planned);
    expect(live.roundsFinished).toBe(planned);
    expect(totalCash).toBe(planned * course.baseGreenFee);
    expect(live.greenFeeCollected).toBe(planned * course.baseGreenFee);
    expect(avgSatisfactionSoFar(live)).toBeGreaterThan(0);
  });
});

describe("findWalkPath", () => {
  it("routes around water instead of walking through it", () => {
    const course = makeTestCourse();
    // Vertical water strip at x=20..21, leaving a gap only at the top (y=0..1).
    for (let y = 2; y < course.height; y++) {
      for (const x of [20, 21]) course.tiles[y * course.width + x] = "water";
    }
    const from = { x: 4, y: 12 };
    const to = { x: 50, y: 12 };
    const pts = findWalkPath(course, from, to);
    expect(pts.length).toBeGreaterThan(2); // detoured, not a straight beeline
    // No waypoint sits on a water tile.
    for (const p of pts) {
      const t = course.tiles[Math.round(p.y) * course.width + Math.round(p.x)];
      expect(t).not.toBe("water");
    }
    // The detour is meaningfully longer than the beeline (it goes via the gap).
    expect(pathLength(pts)).toBeGreaterThan(Math.hypot(to.x - from.x, to.y - from.y) + 5);
  });

  it("falls back to a straight line when fully blocked", () => {
    const course = makeTestCourse();
    for (let y = 0; y < course.height; y++) {
      for (const x of [20, 21]) course.tiles[y * course.width + x] = "water";
    }
    const pts = findWalkPath(course, { x: 4, y: 12 }, { x: 50, y: 12 });
    expect(pts.length).toBe(2); // golfers never get stuck
  });

  it("keeps golfer rounds walkable end to end on a course with water", () => {
    const course = makeTestCourse();
    // Pond in the fairway the shot flies over but a walker must skirt.
    for (let y = 9; y <= 15; y++) {
      for (let x = 24; x <= 28; x++) course.tiles[y * course.width + x] = "water";
    }
    const g = freshGolfer(course);
    for (let i = 0; i < 2000 && !g.finished; i++) {
      advanceGolfer(g, 0.5, course.condition);
      // Walking golfers must never stand in water.
      const t = course.tiles[Math.round(g.pos.y) * course.width + Math.round(g.pos.x)];
      if (!g.ball && t === "water") {
        throw new Error(`golfer walked into water at ${g.pos.x},${g.pos.y}`);
      }
    }
    expect(g.finished).toBe(true);
  });
});

describe("snapshotGolfer (inspector + scorecard)", () => {
  it("snapshots an active golfer, hides unplayed holes, and keeps finished rounds", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD };
    const live = createLiveState(course, world, 0);

    // Step until at least one golfer is on the course.
    let guard = 0;
    while (live.golfers.length === 0 && guard++ < 10_000) stepLive(live, course, 1);
    const id = live.golfers[0].id;

    const snap = snapshotGolfer(live, id);
    expect(snap).not.toBeNull();
    expect(snap!.finished).toBe(false);
    expect(snap!.holes.length).toBe(1);
    // Hole not scored yet => strokes hidden.
    if (live.golfers.find((g) => g.id === id)!.scoredHoles === 0) {
      expect(snap!.holes[0].strokes).toBeNull();
    }
    expect(snap!.spent).toBe(course.baseGreenFee);

    // Run the day out; the golfer must survive as a finished-round snapshot.
    guard = 0;
    while (!live.dayOver && guard++ < 100_000) stepLive(live, course, 1);
    const done = snapshotGolfer(live, id);
    expect(done).not.toBeNull();
    expect(done!.finished).toBe(true);
    expect(done!.holes[0].strokes).toBe(done!.strokes); // single-hole course: all revealed
    expect(done!.strokes).toBeGreaterThan(0);
    expect(live.finishedRounds.length).toBe(live.roundsFinished);

    expect(snapshotGolfer(live, 999_999)).toBeNull();
  });
});

describe("tee-time queueing (ZKU-110)", () => {
  it("caps concurrent golfers per hole and makes the rest wait at the tee", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD };
    const live = createLiveState(course, world, 0);
    // Force a morning rush: everyone arrives at the same minute.
    live.arrivals = live.arrivals.map((a) => ({ ...a, atMinute: 5 }));

    let sawWaiting = false;
    let guard = 0;
    while (!live.dayOver && guard++ < 100_000) {
      stepLive(live, course, 1);
      // Count golfers actually playing the single hole (past its gate).
      let playing = 0;
      for (const g of live.golfers) {
        const seg = g.segments[g.segIndex];
        if (seg && seg.holeIndex === 0 && !seg.gate) playing++;
        if (g.waiting) sawWaiting = true;
      }
      expect(playing).toBeLessThanOrEqual(2); // LIVE.pace.holeCapacity
    }

    expect(live.dayOver).toBe(true); // queue drains; nobody gets stuck
    expect(live.roundsFinished).toBe(live.arrivals.length);
    expect(sawWaiting).toBe(true);
    // Waiting golfers paid a mood price.
    const anyWait = live.finishedRounds.some((r) => r.mood < 0.7);
    expect(anyWait).toBe(true);
  });
});

describe("commitDay", () => {
  it("applies costs and nudges reputation toward satisfaction", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD, reputation: 40 };
    const highSat = commitDay({ course, world, rounds: 20, revenue: 20 * 65, avgSatisfaction: 90 });
    expect(highSat.result.costs).toBeGreaterThan(0);
    expect(highSat.result.reputationDelta).toBeGreaterThan(0);

    const lowSat = commitDay({ course, world, rounds: 20, revenue: 20 * 65, avgSatisfaction: 20 });
    expect(lowSat.result.reputationDelta).toBeLessThan(0);

    // No rounds => no reputation movement.
    const noPlay = commitDay({ course, world, rounds: 0, revenue: 0, avgSatisfaction: 70 });
    expect(noPlay.result.reputationDelta).toBe(0);
  });
});
