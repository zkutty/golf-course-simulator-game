import { beforeEach, describe, expect, it } from "vitest";
import { SCENARIOS, createScenarioGame, getScenario } from "./scenarios";
import { scoreCourseHoles } from "../sim/holes";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE } from "../gameState";
import {
  __resetCareerForTests,
  isScenarioUnlocked,
  loadCareer,
  recordScenarioAttempt,
  recordScenarioCompleted,
} from "../../utils/careerStore";
import { normalizeLoadedSave } from "../../utils/save";
import { isOwnedTile } from "../estate/estate";

const METRICS = [
  "cash",
  "reputation",
  "courseRating",
  "holesBuilt",
  "weeklyProfit",
  "profitStreak",
  "totalRounds",
  "condition",
  "tournamentPlacement",
];

describe("scenario definitions (ZKU-164)", () => {
  it("six scenarios form a contiguous ladder with unique ids", () => {
    expect(SCENARIOS).toHaveLength(6);
    const orders = SCENARIOS.map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(6);
  });

  it("every goal uses the objective-engine vocabulary", () => {
    for (const s of SCENARIOS) {
      expect(s.goals.length).toBeGreaterThan(0);
      for (const g of s.goals) {
        for (const c of g.conditions) {
          expect(METRICS).toContain(c.metric);
          expect([">=", "<="]).toContain(c.comparator);
        }
      }
    }
  });

  it("createScenarioGame is deterministic and applies scenario framing", () => {
    for (const s of SCENARIOS) {
      const a = createScenarioGame(s);
      const b = createScenarioGame(s);
      expect(a.course).toEqual(b.course);
      expect(a.world).toEqual(b.world);
      expect(a.world.mode).toBe("career");
      expect(a.world.scenarioId).toBe(s.id);
      expect(a.world.difficulty).toBe(s.difficulty);
      expect(a.course.theme).toBe(s.theme);
      expect(a.world.objectives?.goals).toEqual(s.goals);
      expect(a.world.objectives?.outcome).toBe("OPEN");
      if (s.startingCash != null) expect(a.world.cash).toBe(s.startingCash);
      if (s.constraints) expect(a.world.constraints).toEqual(s.constraints);
    }
  });

  it("prebuilt fixtures load with nine complete, valid holes", { timeout: 40_000 }, () => {
    for (const id of ["muni-rescue", "members-club"]) {
      const s = getScenario(id)!;
      const { course } = createScenarioGame(s);
      const summary = scoreCourseHoles(course);
      const valid = summary.holes.filter((h) => h.isComplete && h.isValid).length;
      expect(course.holes).toHaveLength(9);
      expect(valid).toBe(9);
      expect(course.buildings.some((b) => b.type === "clubhouse")).toBe(true);
    }
  });

  it("muni is run-down and members is pristine with the committee fee", () => {
    const muni = createScenarioGame(getScenario("muni-rescue")!);
    expect(muni.course.condition).toBeLessThan(0.5);
    const members = createScenarioGame(getScenario("members-club")!);
    expect(members.course.condition).toBeGreaterThan(0.85);
    expect(members.course.baseGreenFee).toBe(110);
  });

  it("scenario fixtures survive save/load with constraints intact", () => {
    const { course, world } = createScenarioGame(getScenario("members-club")!);
    const loaded = normalizeLoadedSave({ schemaVersion: 1, savedAt: 0, course, world });
    expect(loaded).not.toBeNull();
    expect(loaded!.world.scenarioId).toBe("members-club");
    expect(loaded!.world.constraints).toEqual({
      noLoans: false,
      fixedGreenFee: 110,
      protectedTrees: false,
    });
    expect(loaded!.world.objectives?.goals).toEqual(getScenario("members-club")!.goals);
  });
});

describe("scenario constraints in the reducer", () => {
  it("protected trees can't be removed; bushes still can", () => {
    const { course, world } = createScenarioGame(getScenario("links-by-the-sea")!);
    const tree = course.obstacles.find((o) => o.type === "tree");
    const bush = course.obstacles.find((o) => o.type === "bush" && isOwnedTile(course, o.x, o.y));
    expect(tree).toBeDefined();
    expect(bush).toBeDefined();

    const state = { ...DEFAULT_STATE, course, world };
    const afterTree = applyAction(state, { type: "REMOVE_OBSTACLE", x: tree!.x, y: tree!.y });
    expect(afterTree.course.obstacles).toContainEqual(tree);

    const afterBush = applyAction(state, { type: "REMOVE_OBSTACLE", x: bush!.x, y: bush!.y });
    expect(afterBush.course.obstacles).not.toContainEqual(bush);
  });
});

describe("career store", () => {
  beforeEach(() => __resetCareerForTests());

  it("ladder unlocks sequentially; scenario 1 always open", () => {
    const ladder = SCENARIOS;
    expect(isScenarioUnlocked(loadCareer(), ladder, "back-nine")).toBe(true);
    expect(isScenarioUnlocked(loadCareer(), ladder, "muni-rescue")).toBe(false);
    expect(isScenarioUnlocked(loadCareer(), ladder, "championship-dream")).toBe(false);

    recordScenarioCompleted("back-nine", { week: 12, cash: 40_000 });
    expect(isScenarioUnlocked(loadCareer(), ladder, "muni-rescue")).toBe(true);
    expect(isScenarioUnlocked(loadCareer(), ladder, "swamp-deal")).toBe(false);
  });

  it("completion records best (earliest) week across replays", () => {
    recordScenarioAttempt("back-nine");
    recordScenarioCompleted("back-nine", { week: 20, cash: 30_000 });
    recordScenarioAttempt("back-nine");
    recordScenarioCompleted("back-nine", { week: 12, cash: 55_000 });
    recordScenarioCompleted("back-nine", { week: 30, cash: 99_999 }); // worse — ignored
    const rec = loadCareer().scenarios["back-nine"];
    expect(rec.completed).toBe(true);
    expect(rec.attempts).toBe(2);
    expect(rec.bestWeek).toBe(12);
    expect(rec.bestCash).toBe(55_000);
  });

  it("restarting a scenario never wipes medals (separate store)", () => {
    recordScenarioCompleted("back-nine", { week: 9, cash: 10_000 });
    recordScenarioAttempt("back-nine"); // replay
    expect(loadCareer().scenarios["back-nine"].completed).toBe(true);
  });
});
