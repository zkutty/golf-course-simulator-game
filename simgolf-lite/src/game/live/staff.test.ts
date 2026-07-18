import { describe, it, expect } from "vitest";
import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import {
  defaultRosterFor,
  derivedStaffLevel,
  sanitizeStaff,
  staffWeeklyWage,
} from "../models/staff";
import { BALANCE } from "../balance/balanceConfig";
import { normalizeLoadedSave } from "../../utils/save";
import { findWalkPath } from "./walkPath";
import { advanceGolfer, entryPoint } from "./golfer";
import { LIVE } from "./liveConfig";
import {
  createStaffEntities,
  marshaledHoles,
  onDutyCount,
  staffRenderData,
  stepStaffEntities,
  type StaffStepContext,
} from "./staff";
import { commitDay } from "./commitDay";
import { createLiveState, liveCondition, stepLive } from "./simulation";
import type { RoundReactions, Segment } from "./types";

// Same single-hole test course as live.test.ts.
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

function worldWith(staff: World["staff"]): World {
  return { ...DEFAULT_WORLD, staff, nextStaffId: 100 };
}

function ctxFor(course: Course, dayMinute: number, congested: number[] = []): StaffStepContext {
  return {
    course,
    dayMinute,
    route: (from, to) => findWalkPath(course, from, to),
    congested,
  };
}

describe("staff roster model (ZKU-121)", () => {
  it("migrated rosters keep legacy payroll to the dollar", () => {
    const roster = defaultRosterFor(3);
    expect(roster.length).toBe(3);
    const world = worldWith(roster);
    expect(staffWeeklyWage(world)).toBe(BALANCE.ops.staffCostPerLevel * 3);
    expect(derivedStaffLevel(roster)).toBe(3);
  });

  it("falls back to the aggregate formula for rosterless worlds", () => {
    const world: World = { ...DEFAULT_WORLD, staff: undefined, staffLevel: 4 };
    expect(staffWeeklyWage(world)).toBe(BALANCE.ops.staffCostPerLevel * 4);
  });

  it("sanitizes hostile roster data and preserves an explicit empty roster", () => {
    expect(sanitizeStaff(undefined)).toBeNull();
    expect(sanitizeStaff([])).toEqual([]);
    const cleaned = sanitizeStaff([
      { id: 1, name: "OK", role: "marshal", shift: "full", wage: 500 },
      { id: 1, name: "dup", role: "marshal", shift: "full", wage: 500 },
      { id: 2, name: "bad role", role: "wizard", shift: "full", wage: 500 },
      { id: 3, name: "", role: "proShop", shift: "morning", wage: 420 },
      { id: 4, name: "bad wage", role: "proShop", shift: "morning", wage: Infinity },
    ]);
    expect(cleaned?.map((s) => s.id)).toEqual([1, 3]);
    expect(cleaned?.[1].name).toBe("Staff #3");
  });

  it("expands pre-M5 saves into a roster on load", () => {
    const { staff: _s, nextStaffId: _n, ...legacyWorld } = DEFAULT_WORLD;
    const loaded = normalizeLoadedSave({
      schemaVersion: 1,
      savedAt: 0,
      course: makeTestCourse(),
      world: { ...legacyWorld, staffLevel: 2 },
    });
    expect(loaded).not.toBeNull();
    expect(loaded!.world.staff?.length).toBe(2);
    expect(loaded!.world.staffLevel).toBe(2);
    expect(staffWeeklyWage(loaded!.world)).toBe(BALANCE.ops.staffCostPerLevel * 2);
    expect(loaded!.world.nextStaffId).toBe(3);
  });
});

describe("staff entities, shifts, and tasks (ZKU-121)", () => {
  it("clocks staff in at shift start and walks them off at shift end", () => {
    const course = makeTestCourse();
    const world = worldWith([
      { id: 1, name: "Early E.", role: "groundskeeper", shift: "morning", wage: 450 },
    ]);
    const staff = createStaffEntities(world, course, 7);
    expect(staff[0].onCourse).toBe(false);

    stepStaffEntities(staff, 1, ctxFor(course, 10));
    expect(staff[0].onCourse).toBe(true);
    expect(onDutyCount(staff, "groundskeeper")).toBe(1);

    // Past the morning shift the entity leaves and eventually clocks out.
    for (let m = 0; m < 60 && staff[0].onCourse; m++) {
      stepStaffEntities(staff, 1, ctxFor(course, LIVE.staff.shifts.morning.end + m));
    }
    expect(staff[0].onCourse).toBe(false);
  });

  it("advances deterministically for the same seed", () => {
    const course = makeTestCourse();
    const world = worldWith(defaultRosterFor(3));
    const a = createStaffEntities(world, course, 42);
    const b = createStaffEntities(world, course, 42);
    for (let m = 0; m < 200; m++) {
      stepStaffEntities(a, 1, ctxFor(course, m));
      stepStaffEntities(b, 1, ctxFor(course, m));
    }
    expect(a.map((s) => s.pos)).toEqual(b.map((s) => s.pos));
    expect(a.map((s) => s.taskCount)).toEqual(b.map((s) => s.taskCount));
  });

  it("renders only on-course staff, with negated ids and role uniforms", () => {
    const course = makeTestCourse();
    const world = worldWith([
      { id: 5, name: "On D.", role: "marshal", shift: "full", wage: 500 },
      { id: 6, name: "Off D.", role: "proShop", shift: "afternoon", wage: 420 },
    ]);
    const staff = createStaffEntities(world, course, 1);
    stepStaffEntities(staff, 1, ctxFor(course, 30)); // morning: only #5 clocks in
    const data = staffRenderData(staff);
    expect(data.map((d) => d.id)).toEqual([-5]);
    expect(data[0].shot).toBeNull();
  });
});

describe("groundskeeper upkeep loop (ZKU-122)", () => {
  it("completes maintenance tasks that lift live condition and day-commit recovery", () => {
    const course = makeTestCourse();
    const world = worldWith([
      { id: 1, name: "Mow M.", role: "groundskeeper", shift: "full", wage: 450 },
    ]);
    const live = createLiveState(course, world, 0);
    live.arrivals = []; // isolate staff from golfer noise
    for (let m = 0; m < 500; m++) stepLive(live, course, 1);

    expect(live.upkeepTasksDone).toBeGreaterThan(0);
    expect(liveCondition(live, course)).toBeGreaterThan(course.condition);
    expect(liveCondition(live, course)).toBeLessThanOrEqual(
      course.condition + LIVE.staff.liveConditionCap
    );

    const reactions: RoundReactions = {
      rounds: 10,
      avgSatisfaction: 70,
      promoters: 5,
      detractors: 1,
      willReturnRate: 0.6,
    };
    const withStaff = commitDay({
      course,
      world,
      revenue: 650,
      reactions,
      staffUpkeepTasks: live.upkeepTasksDone,
    });
    const without = commitDay({ course, world, revenue: 650, reactions });
    const expected = Math.min(
      BALANCE.staff.upkeepConditionCapPerDay,
      live.upkeepTasksDone * BALANCE.staff.upkeepConditionPerTask
    );
    expect(withStaff.result.conditionDelta - without.result.conditionDelta).toBeCloseTo(
      expected,
      6
    );
  });

  it("charges payroll from the roster in commitDay", () => {
    const course = makeTestCourse();
    const reactions: RoundReactions = {
      rounds: 0,
      avgSatisfaction: 70,
      promoters: 0,
      detractors: 0,
      willReturnRate: 0,
    };
    const small = commitDay({ course, world: worldWith([]), revenue: 0, reactions });
    const big = commitDay({
      course,
      world: worldWith(defaultRosterFor(5)),
      revenue: 0,
      reactions,
    });
    expect(big.result.costs - small.result.costs).toBeCloseTo(
      (BALANCE.ops.staffCostPerLevel * 5) / 7,
      6
    );
  });
});

describe("marshals and pace of play (ZKU-123)", () => {
  // Flood the tee sheet so hole 0 stacks past the congestion threshold: hold
  // the tee gate open until every arrival is out on the course at once.
  function congestedDay(world: World) {
    const course = makeTestCourse();
    const live = createLiveState(course, world, 0);
    live.arrivals = Array.from({ length: 8 }, () => ({
      atMinute: 0,
      archetype: "casual" as const,
    }));
    live.nextArrivalIdx = 0;
    let guard = 0;
    while (live.nextArrivalIdx < live.arrivals.length && guard++ < 100) {
      live.nextTeeFreeAt = 0;
      stepLive(live, course, 0.1);
    }
    return { course, live };
  }

  it("detects congestion and drains unattended golfers' moods", () => {
    const { course, live } = congestedDay(worldWith([]));
    let sawCongestion = false;
    let sawDrain = false;
    for (let m = 0; m < 120; m++) {
      stepLive(live, course, 1);
      if (live.congestedHoles.includes(0)) sawCongestion = true;
      for (const g of live.golfers) {
        if (g.scoredHoles === 0 && g.waitedMin > 0 && g.mood < LIVE.mood.start) sawDrain = true;
      }
    }
    expect(sawCongestion).toBe(true);
    expect(sawDrain).toBe(true);
  });

  it("sends a marshal to the congested hole, shielding moods there", () => {
    const world = worldWith([
      { id: 1, name: "Marsha L.", role: "marshal", shift: "full", wage: 500 },
    ]);
    const { course, live } = congestedDay(world);
    let attendedWhileCongested = false;
    let marshaledWaited = 0;
    for (let m = 0; m < 240; m++) {
      stepLive(live, course, 1);
      if (live.congestedHoles.includes(0) && marshaledHoles(live.staff).has(0)) {
        attendedWhileCongested = true;
      }
      marshaledWaited = Math.max(
        marshaledWaited,
        live.golfers.reduce((a, g) => a + g.waitedMin, 0)
      );
    }
    expect(attendedWhileCongested).toBe(true);

    // While attended, waiting stops accruing and play speeds up — the same
    // flood without a marshal racks up strictly more waiting.
    const bare = congestedDay(worldWith([]));
    let bareWaited = 0;
    for (let m = 0; m < 240; m++) {
      stepLive(bare.live, bare.course, 1);
      bareWaited = Math.max(
        bareWaited,
        bare.live.golfers.reduce((a, g) => a + g.waitedMin, 0)
      );
    }
    expect(marshaledWaited).toBeLessThan(bareWaited);
  });

  it("walk multiplier speeds walking segments only", () => {
    const seg: Segment = {
      kind: "walk",
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      dur: 10,
      holeIndex: 0,
    };
    const mkGolfer = () => ({
      id: 1,
      name: "t",
      archetype: "casual" as const,
      personality: {
        skill: 0.5,
        consistency: 0.5,
        patience: 0.5,
        spendPropensity: 0.5,
        prefs: { difficulty: 0, scenery: 0, price: 0 },
      },
      color: "#fff",
      segments: [{ ...seg }],
      segIndex: 0,
      segElapsed: 0,
      pos: { x: 0, y: 0 },
      ball: null,
      holePar: [4],
      holeStrokes: [4],
      scoredHoles: 0,
      currentHole: 0,
      strokes: 0,
      scoreToPar: 0,
      mood: 0.7,
      thought: null,
      thoughtUntil: 0,
      finished: false,
      spent: 0,
      waitedMin: 0,
    });
    const slow = mkGolfer();
    const fast = mkGolfer();
    advanceGolfer(slow, 2, 0.8, 1);
    advanceGolfer(fast, 2, 0.8, 1.5);
    expect(slow.segElapsed).toBeCloseTo(2, 6);
    expect(fast.segElapsed).toBeCloseTo(3, 6);
    expect(fast.pos.x).toBeGreaterThan(slow.pos.x);
  });

  it("keeps a full simulated day with staff deterministic and finishable", () => {
    const course = makeTestCourse();
    const world = worldWith(defaultRosterFor(5));
    const run = () => {
      const live = createLiveState(course, world, 0);
      let guard = 0;
      while (!live.dayOver && guard++ < 200_000) stepLive(live, course, 1);
      return live;
    };
    const a = run();
    const b = run();
    expect(a.dayOver).toBe(true);
    expect(a.roundsFinished).toBe(a.roundsStarted);
    expect(a.upkeepTasksDone).toBe(b.upkeepTasksDone);
    expect(a.greenFeeCollected).toBe(b.greenFeeCollected);
    expect(a.satisfactionSum).toBeCloseTo(b.satisfactionSum, 9);
  });
});

describe("staff entry point sanity", () => {
  it("staff clock in at the course entrance", () => {
    const course = makeTestCourse();
    const world = worldWith(defaultRosterFor(1));
    const staff = createStaffEntities(world, course, 3);
    stepStaffEntities(staff, 0.01, ctxFor(course, 0));
    const entry = entryPoint(course);
    expect(Math.hypot(staff[0].pos.x - entry.x, staff[0].pos.y - entry.y)).toBeLessThan(2);
  });
});
