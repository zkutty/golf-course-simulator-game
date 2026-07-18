import { describe, expect, it } from "vitest";
import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { getGolferProfile } from "../sim/golferProfiles";
import { buildGolferRound, advanceGolfer, entryPoint } from "./golfer";
import { createLiveState, stepLive } from "./simulation";
import { commitDay } from "./commitDay";
import { decidePurchase, planRoundStops, rollWallet } from "./concessions";
import { findWalkPath } from "./walkPath";
import { buildingFootprintSet } from "../models/buildings";
import { mulberry32 } from "../../utils/rng";
import type { Golfer, RoundReactions } from "./types";
import type { Personality } from "./personality";

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

// The live.test.ts single-hole course, plus a snack bar / pro shop / cart
// rental cluster near the entry so every stop type is plannable.
function makeCourse(withConcessions = true): Course {
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
    buildings: withConcessions
      ? [
          { type: "snackbar", x: 30, y: 10 },
          { type: "proshop", x: 6, y: 4 },
          { type: "cartrental", x: 6, y: 18 },
        ]
      : [],
    holes: [{ tee, green, parMode: "AUTO", name: "H1" }],
    obstacles: [],
    yardsPerTile: 10,
    baseGreenFee: 65,
    condition: 0.8,
  };
}

function world(): World {
  return { ...DEFAULT_WORLD, runSeed: 1234, cash: 10_000 };
}

function spender(course: Course, rngSeed = 7): Golfer {
  const personality = testPersonality({ spendPropensity: 1 });
  const round = buildGolferRound({
    course,
    profile: getGolferProfile("SCRATCH", course),
    entry: entryPoint(course),
    rng: mulberry32(rngSeed),
    personality,
  });
  return {
    id: 1,
    name: "Big Spender",
    archetype: "tourist",
    personality,
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
    mood: 0.9,
    thought: null,
    thoughtUntil: 0,
    finished: false,
    spent: 0,
    wallet: 500,
    purchaseSeed: 99,
    buyRolls: 0,
    pendingPurchases: [],
  };
}

describe("planRoundStops (ZKU-119)", () => {
  it("plans no stops when the course has no concessions", () => {
    const stops = planRoundStops({
      course: makeCourse(false),
      personality: testPersonality({ spendPropensity: 1 }),
      rng: mulberry32(1),
      entry: entryPoint(makeCourse(false)),
    });
    expect(stops.preRound).toHaveLength(0);
    expect(stops.postRound).toBeNull();
    expect(stops.snackAfterHole({ x: 30, y: 12 }, 3, 0)).toBeNull();
  });

  it("an eager spender picks up pre-round stops deterministically", () => {
    const course = makeCourse();
    const args = {
      course,
      personality: testPersonality({ spendPropensity: 1 }),
      rng: mulberry32(1),
      entry: entryPoint(course),
    };
    const a = planRoundStops({ ...args, rng: mulberry32(1) });
    const b = planRoundStops({ ...args, rng: mulberry32(1) });
    expect(a.preRound.map((s) => s.building.type)).toEqual(b.preRound.map((s) => s.building.type));
    expect(a.preRound.length).toBeGreaterThan(0);
  });

  it("snack stops respect the detour distance cap", () => {
    const course = makeCourse();
    const stops = planRoundStops({
      course,
      personality: testPersonality({ spendPropensity: 1 }),
      rng: mulberry32(1),
      entry: entryPoint(course),
    });
    // Far corner: snack bar at (30,10) is ~40 tiles away — beyond the cap.
    expect(stops.snackAfterHole({ x: 2, y: 2 }, 5, 0)).toBeNull();
  });

  it("a spender's round itinerary contains concession pauses", () => {
    const course = makeCourse();
    const g = spender(course);
    const stopSegs = g.segments.filter((s) => s.stop);
    expect(stopSegs.length).toBeGreaterThan(0);
    for (const s of stopSegs) {
      expect(s.kind).toBe("pause");
      expect(s.stop!.price).toBeGreaterThan(0);
    }
  });
});

describe("live walk routing vs buildings", () => {
  it("findWalkPath never routes through a building footprint", () => {
    const course = makeCourse();
    // Wall the direct line with a pro shop and route across it.
    course.buildings = [{ type: "proshop", x: 20, y: 11 }];
    const path = findWalkPath(course, { x: 10, y: 12 }, { x: 30, y: 12 })!;
    expect(path).not.toBeNull();
    const blocked = buildingFootprintSet(course);
    for (const p of path) {
      expect(blocked.has(p.y * course.width + p.x)).toBe(false);
    }
  });
});

describe("decidePurchase (ZKU-118)", () => {
  const info = { price: 9, appeal: 0 };

  it("never spends money the golfer doesn't have", () => {
    expect(
      decidePurchase({
        personality: testPersonality({ spendPropensity: 1 }),
        mood: 1,
        wallet: 5,
        info,
        roll: 0,
      })
    ).toBe(false);
  });

  it("spend propensity and mood raise the buy chance monotonically", () => {
    // Compare thresholds via a mid roll: eager+happy buys where broke-averse won't.
    const buyEager = decidePurchase({
      personality: testPersonality({ spendPropensity: 1 }),
      mood: 0.9,
      wallet: 100,
      info,
      roll: 0.6,
    });
    const buyAverse = decidePurchase({
      personality: testPersonality({ spendPropensity: 0 }),
      mood: 0.2,
      wallet: 100,
      info,
      roll: 0.6,
    });
    expect(buyEager).toBe(true);
    expect(buyAverse).toBe(false);
  });

  it("wallets scale with spend propensity", () => {
    const rich = rollWallet(testPersonality({ spendPropensity: 1 }), mulberry32(5));
    const poor = rollWallet(testPersonality({ spendPropensity: 0 }), mulberry32(5));
    expect(rich).toBeGreaterThan(poor);
  });
});

describe("live purchases and itemized day income (ZKU-118/120)", () => {
  it("advancing a spender through their round produces transactions", () => {
    const course = makeCourse();
    const g = spender(course);
    // Play the whole round out in one big step.
    advanceGolfer(g, 100_000, course.condition);
    expect(g.finished).toBe(true);
    expect(g.pendingPurchases.length).toBeGreaterThan(0);
    const spentOnGoods = g.pendingPurchases.reduce((a, p) => a + p.amount, 0);
    expect(g.spent).toBe(spentOnGoods);
    expect(g.wallet).toBe(500 - spentOnGoods);
  });

  it("purchases are deterministic regardless of step slicing", () => {
    const course = makeCourse();
    const a = spender(course);
    const b = spender(course);
    advanceGolfer(a, 100_000, course.condition);
    for (let i = 0; i < 100_000 / 7; i++) advanceGolfer(b, 7, course.condition);
    expect(b.finished).toBe(true);
    expect(a.spent).toBe(b.spent);
    expect(a.pendingPurchases).toEqual(b.pendingPurchases);
  });

  it("stepLive banks purchases into cash and itemized day lines", () => {
    const course = makeCourse();
    const state = createLiveState(course, world(), 0);
    let cash = 0;
    let guard = 0;
    while (!state.dayOver && guard++ < 20_000) {
      cash += stepLive(state, course, 10).cashDelta;
    }
    expect(state.dayOver).toBe(true);
    const itemized = Object.values(state.concessionSales).reduce((a, l) => a + l.revenue, 0);
    expect(state.concessionRevenue).toBe(itemized);
    expect(state.concessionRevenue).toBeGreaterThan(0);
    expect(state.concessionGoodsCost).toBeGreaterThan(0);
    // Every dollar collected is green fees + concession transactions.
    expect(cash).toBeCloseTo(state.greenFeeCollected + state.concessionRevenue, 6);
  });

  it("commitDay folds concessions into revenue, costs, and the breakdown", () => {
    const reactions: RoundReactions = {
      rounds: 10,
      avgSatisfaction: 70,
      promoters: 4,
      detractors: 1,
      willReturnRate: 0.6,
    };
    const base = commitDay({
      course: makeCourse(false),
      world: world(),
      revenue: 650,
      reactions,
    });
    const withShops = commitDay({
      course: makeCourse(),
      world: world(),
      revenue: 650,
      concessions: {
        revenue: 200,
        goodsCost: 70,
        sales: { snackbar: { count: 10, revenue: 90 }, proshop: { count: 2, revenue: 110 } },
      },
      reactions,
    });
    expect(withShops.result.revenue).toBe(850);
    expect(withShops.result.revenueBreakdown.greenFees.revenue).toBe(650);
    expect(withShops.result.revenueBreakdown.concessionsTotal).toBe(200);
    expect(withShops.result.revenueBreakdown.total).toBe(850);
    expect(withShops.result.revenueBreakdown.concessions.snackbar?.count).toBe(10);
    // COGS lands in costs: same day is more expensive by exactly the goods.
    expect(withShops.result.costs).toBeGreaterThan(base.result.costs);
  });
});
