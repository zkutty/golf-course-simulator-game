import { describe, it, expect } from "vitest";
import type { Course, World, Terrain } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { getGolferProfile } from "../sim/golferProfiles";
import { scoreCourseHoles } from "../sim/holes";
import { buildGolferRound, advanceGolfer, entryPoint } from "./golfer";
import {
  createLiveState,
  stepLive,
  avgSatisfactionSoFar,
  roundReactions,
  reconcileGolfers,
} from "./simulation";
import type { RoundReactions } from "./types";
import { planDay, plannedGolfersForDay } from "./spawn";
import { findWalkPath } from "./walkPath";
import { pickGolferAt } from "./pick";
import { archetypeAppeal, courseProfile } from "./demand";
import { commitDay } from "./commitDay";
import { rollPersonality, type Personality } from "./personality";
import { ARCHETYPES } from "./archetypes";
import { mulberry32 } from "../../utils/rng";
import type { Golfer } from "./types";

// A neutral, middling personality for tests that don't care about spread.
function testPersonality(over: Partial<Personality> = {}): Personality {
  return {
    skill: 0.6,
    consistency: 0.6,
    patience: 0.5,
    spendPropensity: 0.5,
    prefs: { difficulty: 0, scenery: 0, price: 0 },
    ...over,
  };
}

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
    elevations: Array.from({ length: width * height }, () => 0),
    buildings: [],
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
    personality: testPersonality({ skill: 0.85, consistency: 0.8 }),
  });
  return {
    id: 1,
    name: "Test G.",
    archetype: "lowHandicap",
    personality: testPersonality({ skill: 0.85, consistency: 0.8 }),
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
    wallet: 100,
    purchaseSeed: 42,
    buyRolls: 0,
    pendingPurchases: [],
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
      personality: testPersonality(),
    });
    expect(round.segments.length).toBeGreaterThan(0);
    expect(round.holeStrokes.length).toBe(1);
    expect(round.holePar.length).toBe(1);
    // Includes shots to green plus at least one putt.
    expect(round.holeStrokes[0]).toBeGreaterThanOrEqual(2);
  });
});

describe("personality-driven scoring (ZKU-113)", () => {
  // Total strokes over par for a round planned with a fixed shot model but a
  // given personality + rng seed. Isolates the personality variance layer.
  function scoreToPar(course: Course, personality: Personality, seed: number): number {
    const round = buildGolferRound({
      course,
      profile: getGolferProfile("SCRATCH", course),
      entry: entryPoint(course),
      rng: mulberry32(seed),
      personality,
    });
    const strokes = round.holeStrokes.reduce((a, b) => a + b, 0);
    const par = round.holePar.reduce((a, b) => a + b, 0);
    return strokes - par;
  }

  it("is deterministic for the same personality and seed", () => {
    const course = makeTestCourse();
    const p = testPersonality({ skill: 0.5, consistency: 0.5 });
    expect(scoreToPar(course, p, 42)).toBe(scoreToPar(course, p, 42));
  });

  it("produces a spread of scores within one archetype", () => {
    const course = makeTestCourse();
    const rng = mulberry32(7);
    const scores = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const p = rollPersonality(ARCHETYPES.casual.personality, rng);
      scores.add(scoreToPar(course, p, 1000 + i));
    }
    // Same archetype, same hole, but not one uniform result.
    expect(scores.size).toBeGreaterThan(1);
  });

  it("scores better on average as skill rises", () => {
    const course = makeTestCourse();
    const N = 120;
    const mean = (skill: number, consistency: number) => {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += scoreToPar(course, testPersonality({ skill, consistency }), i * 31 + 5);
      }
      return sum / N;
    };
    const strong = mean(0.95, 0.9);
    const weak = mean(0.2, 0.3);
    expect(strong).toBeLessThan(weak);
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

describe("personality-driven demand (ZKU-115)", () => {
  it("derives a course profile from price and reputation", () => {
    const course = makeTestCourse();
    const cheap = courseProfile({ ...course, baseGreenFee: 40 }, { ...DEFAULT_WORLD });
    const dear = courseProfile({ ...course, baseGreenFee: 160 }, { ...DEFAULT_WORLD });
    expect(cheap.premium).toBeLessThan(0);
    expect(dear.premium).toBeGreaterThan(0);

    const lowRep = courseProfile(course, { ...DEFAULT_WORLD, reputation: 10 });
    const highRep = courseProfile(course, { ...DEFAULT_WORLD, reputation: 90 });
    expect(highRep.prestige).toBeGreaterThan(lowRep.prestige);
  });

  it("normalises appeal into a distribution that sums to 1", () => {
    const appeal = archetypeAppeal(courseProfile(makeTestCourse(), { ...DEFAULT_WORLD }));
    const sum = Object.values(appeal).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("draws more skilled players as reputation rises", () => {
    const course = makeTestCourse();
    const low = archetypeAppeal(courseProfile(course, { ...DEFAULT_WORLD, reputation: 15 }));
    const high = archetypeAppeal(courseProfile(course, { ...DEFAULT_WORLD, reputation: 95 }));
    // Pros are gated behind reputation; low-rep courses barely see them.
    expect(high.pro).toBeGreaterThan(low.pro);
    expect(low.pro).toBeLessThan(0.05);
  });

  it("repels price-sensitive golfers when the fee is premium", () => {
    const course = makeTestCourse();
    const world = { ...DEFAULT_WORLD };
    const market = archetypeAppeal(courseProfile({ ...course, baseGreenFee: 80 }, world));
    const pricey = archetypeAppeal(courseProfile({ ...course, baseGreenFee: 200 }, world));
    // Juniors are the most price-sensitive archetype (prefs.price = -0.4).
    expect(pricey.junior).toBeLessThan(market.junior);
  });

  it("scales daily volume with demand and stays in the watchable range", () => {
    const course = makeTestCourse();
    const weak = plannedGolfersForDay(course, { ...DEFAULT_WORLD, reputation: 5 });
    const strong = plannedGolfersForDay(course, { ...DEFAULT_WORLD, reputation: 100 });
    expect(strong).toBeGreaterThanOrEqual(weak);
    for (const n of [weak, strong]) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(42);
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

describe("commitDay reputation from real reactions (ZKU-116)", () => {
  function reactions(over: Partial<RoundReactions>): RoundReactions {
    return {
      rounds: 20,
      avgSatisfaction: 70,
      promoters: 0,
      detractors: 0,
      willReturnRate: 0.5,
      ...over,
    };
  }

  it("applies costs and moves reputation with the net-promoter balance", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD, reputation: 40 };

    const happy = commitDay({
      course,
      world,
      revenue: 20 * 65,
      reactions: reactions({ promoters: 15, detractors: 2, willReturnRate: 0.8 }),
    });
    expect(happy.result.costs).toBeGreaterThan(0);
    expect(happy.result.reputationDelta).toBeGreaterThan(0);

    const unhappy = commitDay({
      course,
      world,
      revenue: 20 * 65,
      reactions: reactions({ promoters: 1, detractors: 16, willReturnRate: 0.1 }),
    });
    expect(unhappy.result.reputationDelta).toBeLessThan(0);
    expect(unhappy.result.detractors).toBe(16);

    // No rounds => no reputation movement.
    const noPlay = commitDay({
      course,
      world,
      revenue: 0,
      reactions: reactions({ rounds: 0, promoters: 0, detractors: 0 }),
    });
    expect(noPlay.result.reputationDelta).toBe(0);
  });

  it("aggregates reactions from a simulated day", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD };
    const live = createLiveState(course, world, 0);
    let guard = 0;
    while (!live.dayOver && guard++ < 100_000) stepLive(live, course, 1);

    const r = roundReactions(live);
    expect(r.rounds).toBe(live.roundsFinished);
    expect(r.promoters + r.detractors).toBeLessThanOrEqual(r.rounds);
    expect(r.willReturnRate).toBeGreaterThanOrEqual(0);
    expect(r.willReturnRate).toBeLessThanOrEqual(1);
  });
});

describe("reconcileGolfers on mid-round edits (ZKU-136)", () => {
  it("re-plans in-progress golfers and still finishes a coherent round", () => {
    const course = makeTestCourse();
    const world: World = { ...DEFAULT_WORLD };
    const live = createLiveState(course, world, 0);

    // Run until at least one golfer is out on the course.
    let guard = 0;
    while (live.golfers.length === 0 && !live.dayOver && guard++ < 100_000) {
      stepLive(live, course, 1);
    }
    expect(live.golfers.length).toBeGreaterThan(0);

    const g = live.golfers[0];
    const scoredBefore = g.scoredHoles;
    const parBefore = g.holePar.slice(0, scoredBefore);

    // Edit the course: move the green. Then reconcile.
    const edited: Course = {
      ...course,
      tiles: course.tiles.slice(),
      holes: course.holes.map((h) => ({ ...h, green: { x: 40, y: 6 } })),
    };
    reconcileGolfers(live, edited);

    // Already-scored holes are preserved; the golfer resets onto the new plan.
    expect(g.holePar.slice(0, scoredBefore)).toEqual(parBefore);
    expect(g.segIndex).toBe(0);
    expect(g.ball).toBeNull();
    expect(live.reconcileEpoch).toBe(1);

    // The round still completes and scores every planned hole.
    guard = 0;
    while (!g.finished && guard++ < 100_000) advanceGolfer(g, 2, edited.condition);
    expect(g.finished).toBe(true);
    expect(g.scoredHoles).toBe(g.holeStrokes.length);
  });
});

describe("findWalkPath (ZKU-107)", () => {
  // A fairway field with an optional vertical water wall at x=10.
  function fieldWithWall(gapAtY: number | null): Course {
    const width = 24, height = 16;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway" as Terrain);
    for (let y = 0; y < height; y++) {
      if (gapAtY != null && y === gapAtY) continue; // leave a passable gap
      tiles[y * width + 10] = "water";
    }
    return {
      name: "wall", width, height, tiles,
      elevations: Array.from({ length: width * height }, () => 0),
      holes: [], obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 65, condition: 0.8,
    };
  }
  const isWater = (c: Course, p: { x: number; y: number }) => c.tiles[p.y * c.width + p.x] === "water";

  it("returns a route on open ground ending at the target", () => {
    const c = fieldWithWall(null);
    c.tiles.fill("fairway"); // remove the wall entirely
    const path = findWalkPath(c, { x: 2, y: 8 }, { x: 20, y: 8 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 20, y: 8 });
  });

  it("routes around a water wall through the gap, never onto water", () => {
    const c = fieldWithWall(2); // wall x=10 with a single gap at y=2
    const path = findWalkPath(c, { x: 4, y: 8 }, { x: 16, y: 8 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 16, y: 8 });
    for (const wp of path!) expect(isWater(c, wp)).toBe(false);
  });

  it("returns null when the target is unreachable (solid water wall)", () => {
    const c = fieldWithWall(null); // full wall, no gap
    expect(findWalkPath(c, { x: 4, y: 8 }, { x: 16, y: 8 })).toBeNull();
  });
});

describe("pickGolferAt (ZKU-134)", () => {
  const golfers = [
    { id: 1, x: 10, y: 10 },
    { id: 2, x: 20, y: 12 },
  ];
  it("selects the golfer whose tile-center is under the click", () => {
    expect(pickGolferAt(golfers, 10.5, 10.5)).toBe(1);
    expect(pickGolferAt(golfers, 20.6, 12.4)).toBe(2);
  });
  it("returns null when the click is beyond the pick radius", () => {
    expect(pickGolferAt(golfers, 15, 15)).toBe(null);
  });
});

describe("tee-time queueing (ZKU-110)", () => {
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
