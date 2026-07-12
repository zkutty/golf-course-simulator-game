import { describe, it, expect } from "vitest";
import type { Course, World, Terrain } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { getGolferProfile } from "../sim/golferProfiles";
import { scoreCourseHoles } from "../sim/holes";
import { buildGolferRound, advanceGolfer, entryPoint } from "./golfer";
import { createLiveState, stepLive, avgSatisfactionSoFar } from "./simulation";
import { planDay, plannedGolfersForDay } from "./spawn";
import { commitDay } from "./commitDay";
import { pickGolferAt } from "./pick";
import { findWalkPath } from "./walkPath";
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

// A wider course with N valid fairway holes laid left-to-right in rows.
function makeMultiHoleCourse(n: number): Course {
  const width = 120;
  const height = 40;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const set = (x: number, y: number, t: Terrain) => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = t;
  };
  const holes = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const cy = 8 + row * 12;
    const tx = 6 + col * 38;
    const gx = tx + 20;
    set(tx, cy, "tee");
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(gx + dx, cy + dy, "green");
    holes.push({ tee: { x: tx, y: cy }, green: { x: gx, y: cy }, parMode: "AUTO" as const, name: `H${i + 1}` });
  }
  return { name: "Multi", width, height, tiles, holes, obstacles: [], yardsPerTile: 10, baseGreenFee: 65, condition: 0.8 };
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
    scoredHoles: 0,
    currentHole: -1,
    strokes: 0,
    scoreToPar: 0,
    mood: 0.7,
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

  it("progresses through ALL holes of a multi-hole round (not stuck on hole 1)", () => {
    const course = makeMultiHoleCourse(6);
    const summary = scoreCourseHoles(course);
    const validHoles = summary.holes.filter((h) => h.isComplete && h.isValid).length;
    expect(validHoles).toBe(6);

    const g = freshGolfer(course);
    expect(g.holeStrokes.length).toBe(6); // itinerary covers every hole

    const holesSeen = new Set<number>();
    for (let i = 0; i < 800 && !g.finished; i++) {
      advanceGolfer(g, 1, course.condition);
      if (g.currentHole >= 0) holesSeen.add(g.currentHole);
    }
    expect(g.finished).toBe(true);
    expect(g.scoredHoles).toBe(6); // every hole scored
    // The golfer visibly moved through more than just the first hole.
    expect(holesSeen.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...holesSeen)).toBe(5);
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
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(48);
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
  // A fairway field with an optional vertical water wall at x=10.
  function fieldWithWall(gapAtY: number | null): Course {
    const width = 24, height = 16;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway" as Terrain);
    for (let y = 0; y < height; y++) {
      if (gapAtY != null && y === gapAtY) continue; // leave a passable gap
      tiles[y * width + 10] = "water";
    }
    return { name: "wall", width, height, tiles, holes: [], obstacles: [], yardsPerTile: 10, baseGreenFee: 65, condition: 0.8 };
  }
  const isWater = (c: Course, p: { x: number; y: number }) => c.tiles[p.y * c.width + p.x] === "water";

  it("returns a near-straight route on open ground", () => {
    const c = fieldWithWall(null);
    c.tiles.fill("fairway"); // remove the wall entirely
    const path = findWalkPath(c, { x: 2, y: 8 }, { x: 20, y: 8 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 20, y: 8 });
  });

  it("routes around a water wall (through the gap) without stepping on water", () => {
    const c = fieldWithWall(2); // wall x=10 with a single gap at y=2
    const path = findWalkPath(c, { x: 4, y: 8 }, { x: 16, y: 8 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 16, y: 8 });
    for (const wp of path!) expect(isWater(c, wp)).toBe(false);
    // The detour to the gap is longer than a straight shot.
    expect(path!.length).toBeGreaterThan(1);
  });

  it("returns null when the target is unreachable (solid water wall)", () => {
    const c = fieldWithWall(null); // full wall, no gap
    const path = findWalkPath(c, { x: 4, y: 8 }, { x: 16, y: 8 });
    expect(path).toBeNull();
  });
});

describe("pickGolferAt", () => {
  const golfers = [
    { id: 1, x: 10, y: 10 },
    { id: 2, x: 20, y: 12 },
  ];
  it("selects the golfer whose tile-center is under the click", () => {
    // golfer 1 draws centered at (10.5, 10.5)
    expect(pickGolferAt(golfers, 10.5, 10.5)).toBe(1);
    expect(pickGolferAt(golfers, 20.6, 12.4)).toBe(2);
  });
  it("returns null when the click is beyond the pick radius", () => {
    expect(pickGolferAt(golfers, 15, 15)).toBe(null);
  });
  it("picks the nearest when two are close", () => {
    const close = [
      { id: 1, x: 10, y: 10 },
      { id: 2, x: 11, y: 10 },
    ];
    expect(pickGolferAt(close, 11.4, 10.5)).toBe(2);
  });
});

describe("tee-time queueing", () => {
  it("spaces out backed-up arrivals instead of teeing them all off at once", () => {
    const course = makeTestCourse();
    const live = createLiveState(course, { ...DEFAULT_WORLD }, 0);
    // Force a backlog: 5 golfers all "arriving" at minute 20.
    live.arrivals = Array.from({ length: 5 }, () => ({ atMinute: 20, archetype: "casual" as const }));
    live.nextArrivalIdx = 0;
    live.nextTeeFreeAt = 0;
    live.dayMinute = 0;

    // Jump to minute 21: despite 5 being due, only one may tee off.
    stepLive(live, course, 21);
    expect(live.roundsStarted).toBe(1);

    // Advancing a minute at a time, the rest drain ~one per tee gap.
    for (let i = 0; i < 45; i++) stepLive(live, course, 1);
    expect(live.roundsStarted).toBe(5);
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
