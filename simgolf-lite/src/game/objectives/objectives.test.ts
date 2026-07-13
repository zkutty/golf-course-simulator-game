import { describe, expect, it } from "vitest";
import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { createObjectiveState, type GoalDefinition, type ObjectiveState } from "../models/objectives";
import { evaluateObjectives, withEvaluatedObjectives } from "./evaluate";
import { tickWeek } from "../sim/tickWeek";
import { commitDay } from "../live/commitDay";
import { computeCourseRatingAndSlope } from "../sim/courseRating";
import { normalizeLoadedSave } from "../../utils/save";

// A tiny but valid course: `holeCount` wide fairway holes on separate rows.
function makeCourse(holeCount = 1): Course {
  const width = 60;
  const height = 24;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const set = (x: number, y: number, t: Terrain) => {
    tiles[y * width + x] = t;
  };
  const rows = [4, 12, 20];
  const holes = Array.from({ length: holeCount }, (_, i) => {
    const y = rows[i % rows.length];
    const tee = { x: 4, y };
    const green = { x: 50, y };
    set(tee.x, tee.y, "tee");
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) set(green.x + dx, green.y + dy, "green");
    return { tee, green, parMode: "AUTO" as const, name: `H${i + 1}` };
  });
  return {
    name: "Test",
    width,
    height,
    tiles,
    elevations: Array.from({ length: width * height }, () => 0),
    buildings: [],
    holes,
    obstacles: [],
    yardsPerTile: 10,
    baseGreenFee: 65,
    condition: 0.8,
  };
}

function world(over: Partial<World> = {}): World {
  return { ...DEFAULT_WORLD, ...over };
}

function state(goals: GoalDefinition[]): ObjectiveState {
  return createObjectiveState(goals);
}

const weekCommit = (over: Partial<{ rounds: number; profit: number; weekCompleted: number }> = {}) => ({
  rounds: 0,
  profit: 0,
  weekCompleted: 1,
  ...over,
});

describe("objective conditions", () => {
  it("cash >= / <=", () => {
    const goals: GoalDefinition[] = [
      { id: "rich", label: "", conditions: [{ metric: "cash", comparator: ">=", target: 50_000 }] },
    ];
    const c = makeCourse();
    let s = evaluateObjectives(state(goals), c, world({ cash: 49_999 }), weekCommit());
    expect(s.progress[0].met).toBe(false);
    expect(s.progress[0].conditions[0].value).toBe(49_999);
    s = evaluateObjectives(s, c, world({ cash: 50_000 }), weekCommit({ weekCompleted: 2 }));
    expect(s.progress[0].met).toBe(true);
    expect(s.outcome).toBe("WON");
    expect(s.wonWeek).toBe(2);
  });

  it("reputation and condition (percent scale)", () => {
    const goals: GoalDefinition[] = [
      {
        id: "g",
        label: "",
        conditions: [
          { metric: "reputation", comparator: ">=", target: 60 },
          { metric: "condition", comparator: ">=", target: 75 },
        ],
      },
    ];
    const c = { ...makeCourse(), condition: 0.8 };
    const s = evaluateObjectives(state(goals), c, world({ reputation: 65 }), weekCommit());
    expect(s.progress[0].conditions[1].value).toBeCloseTo(80);
    expect(s.outcome).toBe("WON");
  });

  it("holesBuilt counts complete + valid holes", () => {
    const goals: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "holesBuilt", comparator: ">=", target: 3 }] },
    ];
    let s = evaluateObjectives(state(goals), makeCourse(1), world(), weekCommit());
    expect(s.progress[0].conditions[0].value).toBe(1);
    expect(s.progress[0].met).toBe(false);
    s = evaluateObjectives(s, makeCourse(3), world(), weekCommit({ weekCompleted: 2 }));
    expect(s.progress[0].conditions[0].value).toBe(3);
    expect(s.outcome).toBe("WON");
  });

  it("courseRating uses the sim's rating", () => {
    const c = makeCourse(3);
    const rating = computeCourseRatingAndSlope(c).courseRating;
    const goals: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "courseRating", comparator: ">=", target: rating }] },
    ];
    const s = evaluateObjectives(state(goals), c, world(), weekCommit());
    expect(s.progress[0].conditions[0].value).toBeCloseTo(rating);
    expect(s.outcome).toBe("WON");
  });

  it("weeklyProfit reads the profit of the week that just closed", () => {
    const goals: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "weeklyProfit", comparator: ">=", target: 1000 }] },
    ];
    const c = makeCourse();
    let s = evaluateObjectives(state(goals), c, world(), weekCommit({ profit: 999 }));
    expect(s.outcome).toBe("OPEN");
    s = evaluateObjectives(s, c, world(), weekCommit({ profit: 1500, weekCompleted: 2 }));
    expect(s.outcome).toBe("WON");
  });

  it("profitStreak counts consecutive profitable weeks and resets on a loss", () => {
    const goals: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "profitStreak", comparator: ">=", target: 2 }] },
    ];
    const c = makeCourse();
    let s = state(goals);
    s = evaluateObjectives(s, c, world(), weekCommit({ profit: 100, weekCompleted: 1 }));
    expect(s.profitStreak).toBe(1);
    s = evaluateObjectives(s, c, world(), weekCommit({ profit: -50, weekCompleted: 2 }));
    expect(s.profitStreak).toBe(0);
    s = evaluateObjectives(s, c, world(), weekCommit({ profit: 100, weekCompleted: 3 }));
    s = evaluateObjectives(s, c, world(), weekCommit({ profit: 100, weekCompleted: 4 }));
    expect(s.profitStreak).toBe(2);
    expect(s.outcome).toBe("WON");
  });

  it("totalRounds accumulates across commits", () => {
    const goals: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "totalRounds", comparator: ">=", target: 300 }] },
    ];
    const c = makeCourse();
    let s = state(goals);
    s = evaluateObjectives(s, c, world(), weekCommit({ rounds: 150, weekCompleted: 1 }));
    expect(s.totalRounds).toBe(150);
    expect(s.outcome).toBe("OPEN");
    s = evaluateObjectives(s, c, world(), weekCommit({ rounds: 150, weekCompleted: 2 }));
    expect(s.outcome).toBe("WON");
  });

  it("tournamentPlacement is never met until tournaments exist (M6 hook)", () => {
    const goals: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "tournamentPlacement", comparator: "<=", target: 3 }] },
    ];
    const s = evaluateObjectives(state(goals), makeCourse(), world(), weekCommit());
    expect(s.progress[0].met).toBe(false);
    expect(s.outcome).toBe("OPEN");
  });

  it("any-composition completes on a single met condition", () => {
    const goals: GoalDefinition[] = [
      {
        id: "g",
        label: "",
        match: "any",
        conditions: [
          { metric: "cash", comparator: ">=", target: 1_000_000 },
          { metric: "reputation", comparator: ">=", target: 40 },
        ],
      },
    ];
    const s = evaluateObjectives(state(goals), makeCourse(), world({ reputation: 40 }), weekCommit());
    expect(s.outcome).toBe("WON");
  });

  it("goal completion is sticky even if the metric later regresses", () => {
    const goals: GoalDefinition[] = [
      { id: "a", label: "", conditions: [{ metric: "cash", comparator: ">=", target: 10_000 }] },
      { id: "b", label: "", conditions: [{ metric: "reputation", comparator: ">=", target: 90 }] },
    ];
    const c = makeCourse();
    let s = evaluateObjectives(state(goals), c, world({ cash: 15_000 }), weekCommit());
    expect(s.progress[0].met).toBe(true);
    expect(s.progress[0].completedWeek).toBe(1);
    s = evaluateObjectives(s, c, world({ cash: 500 }), weekCommit({ weekCompleted: 2 }));
    expect(s.progress[0].met).toBe(true);
    expect(s.progress[0].completedWeek).toBe(1);
    expect(s.outcome).toBe("OPEN"); // goal b still open
  });
});

describe("deadlines and defeat", () => {
  const goals: GoalDefinition[] = [
    {
      id: "g",
      label: "",
      conditions: [{ metric: "cash", comparator: ">=", target: 50_000 }],
      deadlineWeek: 20,
    },
  ];

  it("winning ON the deadline week counts", () => {
    const s = evaluateObjectives(
      state(goals),
      makeCourse(),
      world({ cash: 60_000 }),
      weekCommit({ weekCompleted: 20 })
    );
    expect(s.outcome).toBe("WON");
  });

  it("missing the deadline loses the run at week close", () => {
    let s = evaluateObjectives(
      state(goals),
      makeCourse(),
      world({ cash: 100 }),
      weekCommit({ weekCompleted: 19 })
    );
    expect(s.outcome).toBe("OPEN");
    s = evaluateObjectives(s, makeCourse(), world({ cash: 100 }), weekCommit({ weekCompleted: 20 }));
    expect(s.outcome).toBe("LOST");
    expect(s.lostReason).toBe("DEADLINE");
    expect(s.lostWeek).toBe(20);
  });

  it("mid-week live commits do not fire deadlines", () => {
    const s = evaluateObjectives(state(goals), makeCourse(), world({ cash: 100, week: 25 }), {
      rounds: 10,
      profit: 50,
    });
    expect(s.outcome).toBe("OPEN");
  });

  it("bankruptcy loses through the same pipeline", () => {
    const s = evaluateObjectives(
      state(goals),
      makeCourse(),
      world({ cash: -20_000, isBankrupt: true }),
      weekCommit({ weekCompleted: 5 })
    );
    expect(s.outcome).toBe("LOST");
    expect(s.lostReason).toBe("BANKRUPT");
  });

  it("a LOST run stays lost", () => {
    let s = evaluateObjectives(state(goals), makeCourse(), world({ cash: 1 }), weekCommit({ weekCompleted: 20 }));
    expect(s.outcome).toBe("LOST");
    s = evaluateObjectives(s, makeCourse(), world({ cash: 99_000 }), weekCommit({ weekCompleted: 21 }));
    expect(s.outcome).toBe("LOST");
  });

  it("a WON run stays won but can still record bankruptcy", () => {
    const noDeadline: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "cash", comparator: ">=", target: 1_000 }] },
    ];
    let s = evaluateObjectives(state(noDeadline), makeCourse(), world({ cash: 5_000 }), weekCommit());
    expect(s.outcome).toBe("WON");
    s = evaluateObjectives(s, makeCourse(), world({ cash: -20_000, isBankrupt: true }), weekCommit({ weekCompleted: 9 }));
    expect(s.outcome).toBe("LOST");
    expect(s.lostReason).toBe("BANKRUPT");
  });
});

describe("live-day accumulation", () => {
  it("accumulates week profit across days and closes the streak on day 7", () => {
    const goals: GoalDefinition[] = [
      { id: "g", label: "", conditions: [{ metric: "profitStreak", comparator: ">=", target: 1 }] },
    ];
    const c = makeCourse();
    let s = state(goals);
    for (let day = 0; day < 6; day++) {
      s = evaluateObjectives(s, c, world(), { rounds: 5, profit: 100 });
      expect(s.profitStreak).toBe(0);
    }
    expect(s.weekProfitAccum).toBe(600);
    s = evaluateObjectives(s, c, world(), { rounds: 5, profit: 100, weekCompleted: 1 });
    expect(s.profitStreak).toBe(1);
    expect(s.weekProfitAccum).toBe(0);
    expect(s.totalRounds).toBe(35);
    expect(s.outcome).toBe("WON");
  });

  it("commitDay evaluates objectives and closes the week on the last day", () => {
    const c = makeCourse();
    const w = world({
      cash: 100_000,
      objectives: createObjectiveState([
        { id: "g", label: "", conditions: [{ metric: "totalRounds", comparator: ">=", target: 3 }] },
      ]),
    });
    const reactions = { rounds: 4, avgSatisfaction: 70, promoters: 2, detractors: 0, willReturnRate: 0.8 };
    const midWeek = commitDay({ course: c, world: w, revenue: 500, reactions, dayIndex: 2 });
    expect(midWeek.world.objectives!.totalRounds).toBe(4);
    expect(midWeek.world.objectives!.outcome).toBe("WON");
    const endWeek = commitDay({ course: c, world: w, revenue: 500, reactions, dayIndex: 6 });
    expect(endWeek.world.objectives!.weekProfitAccum).toBe(0); // week closed
  });
});

describe("end-to-end via tickWeek (acceptance scenario)", () => {
  const scenarioGoals: GoalDefinition[] = [
    {
      id: "target",
      label: "Reach $50k and 3 holes by week 20",
      conditions: [
        { metric: "cash", comparator: ">=", target: 50_000 },
        { metric: "holesBuilt", comparator: ">=", target: 3 },
      ],
      deadlineWeek: 20,
    },
  ];

  it(
    "wins when cash and holes are reached before the deadline",
    () => {
      // A 3-hole course is below the 9-hole playability gate, so weeks lose a
      // little money — start above the target so the goal is genuinely met.
      let course = makeCourse(3);
      let w = world({ cash: 60_000, reputation: 70, objectives: createObjectiveState(scenarioGoals) });
      for (let i = 0; i < 19 && w.objectives!.outcome === "OPEN"; i++) {
        const out = tickWeek(course, w, w.runSeed);
        course = out.course;
        w = out.world;
      }
      expect(w.objectives!.outcome).toBe("WON");
      expect(w.objectives!.wonWeek).toBeLessThanOrEqual(20);
    },
    20_000
  );

  it(
    "loses on timeout when the target is unreachable",
    () => {
      let course = makeCourse(1); // only 1 hole — goal can't be met
      let w = world({ cash: 30_000, objectives: createObjectiveState(scenarioGoals) });
      for (let i = 0; i < 30 && w.objectives!.outcome === "OPEN" && !w.isBankrupt; i++) {
        const out = tickWeek(course, w, w.runSeed);
        course = out.course;
        w = out.world;
      }
      expect(w.objectives!.outcome).toBe("LOST");
    },
    20_000
  );

  it(
    "is deterministic: same seed + same actions → identical objective state",
    () => {
      const run = () => {
        let course = makeCourse(3);
        let w = world({ cash: 40_000, objectives: createObjectiveState(scenarioGoals) });
        for (let i = 0; i < 10; i++) {
          const out = tickWeek(course, w, 777);
          course = out.course;
          w = out.world;
        }
        return w.objectives;
      };
      expect(run()).toEqual(run());
    },
    20_000
  );

  it("free play (no objectives) is untouched by evaluation", () => {
    const w = world({ objectives: null });
    const evaluated = withEvaluatedObjectives(makeCourse(), w, { rounds: 5, profit: 10, weekCompleted: 1 });
    expect(evaluated).toBe(w);
  });
});

describe("save round-trip", () => {
  it("restores objective progress exactly", () => {
    const goals: GoalDefinition[] = [
      { id: "g", label: "Goal", conditions: [{ metric: "cash", comparator: ">=", target: 50_000 }], deadlineWeek: 20 },
    ];
    const objectives = evaluateObjectives(
      createObjectiveState(goals),
      makeCourse(),
      world({ cash: 30_000 }),
      weekCommit({ rounds: 40, profit: 900 })
    );
    const w = world({ cash: 30_000, objectives });
    const loaded = normalizeLoadedSave({
      schemaVersion: 1,
      savedAt: 0,
      course: DEFAULT_COURSE,
      world: w,
    });
    expect(loaded).not.toBeNull();
    expect(loaded!.world.objectives).toEqual(objectives);
  });

  it("pre-M13 saves (no objectives field) load as free play", () => {
    const w = { ...DEFAULT_WORLD } as Partial<World>;
    delete w.objectives;
    const loaded = normalizeLoadedSave({ schemaVersion: 1, savedAt: 0, course: DEFAULT_COURSE, world: w });
    expect(loaded).not.toBeNull();
    expect(loaded!.world.objectives).toBeNull();
  });

  it("malformed objectives degrade to free play instead of failing the load", () => {
    const loaded = normalizeLoadedSave({
      schemaVersion: 1,
      savedAt: 0,
      course: DEFAULT_COURSE,
      world: { ...DEFAULT_WORLD, objectives: { goals: "nope", outcome: "MAYBE" } },
    });
    expect(loaded).not.toBeNull();
    expect(loaded!.world.objectives).toBeNull();
  });
});
