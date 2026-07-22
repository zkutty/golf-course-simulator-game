import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Terrain, WeekResult } from "../models/types";
import { advisorMessages, allowsMessage } from "../advisor/advisor";
import { TUTORIAL_STEPS, createTutorialProgress, reconcileTutorialProgress } from "./tutorial";
import { GOLFOPEDIA_ENTRIES } from "../../ui/help/golfopediaData";
import { TERRAIN_BUILD_COST, TERRAIN_SALVAGE_VALUE } from "../models/terrainEconomics";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSave } from "../../utils/save";
import { REPORT_HELP, tooltipForControl } from "../../ui/help/tooltipContent";

const terrains: Terrain[] = ["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"];

function week(profit: number): WeekResult {
  return {
    visitors: 40,
    revenue: 5_000,
    costs: 5_000 - profit,
    profit,
    avgSatisfaction: 70,
    reputationDelta: 0,
    visitorNoise: 0,
  };
}

describe("M14 onboarding data", () => {
  it("authors the complete twelve-step tutorial as data", () => {
    expect(TUTORIAL_STEPS).toHaveLength(12);
    expect(new Set(TUTORIAL_STEPS.map((step) => step.id)).size).toBe(12);
    expect(TUTORIAL_STEPS.at(-1)?.id).toBe("graduation");
  });

  it("captures a run baseline and accepts threshold-based painting", () => {
    const progress = createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD);
    const course = { ...DEFAULT_COURSE, tiles: [...DEFAULT_COURSE.tiles] };
    let changed = 0;
    for (let i = 0; i < course.tiles.length && changed < 4; i++) {
      if (course.tiles[i] !== "fairway") {
        course.tiles[i] = "fairway";
        changed++;
      }
    }
    const paintStep = TUTORIAL_STEPS.find((step) => step.id === "paint-corridor")!;
    expect(paintStep.canAdvance({ course, world: DEFAULT_WORLD, onCourse: 0 }, progress.baseline)).toBe(true);
  });

  it("round-trips the current tutorial step with a game save", () => {
    const progress = { ...createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD), stepIndex: 7 };
    const loaded = normalizeLoadedSave({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      course: DEFAULT_COURSE,
      world: DEFAULT_WORLD,
      tutorial: progress,
    });
    expect(loaded?.tutorial).toEqual(progress);
  });

  it("reconciles a ninth valid hole exactly once, including after resume", () => {
    const openCourseIndex = TUTORIAL_STEPS.findIndex((step) => step.id === "open-course");
    const progress = { ...createTutorialProgress(DEFAULT_COURSE, DEFAULT_WORLD), stepIndex: openCourseIndex };
    const width = 60;
    const height = 40;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway");
    const holes = Array.from({ length: 9 }, (_, index) => ({
      tee: { x: 4, y: 2 + index * 4 },
      green: { x: 50, y: 2 + index * 4 },
      parMode: "AUTO" as const,
    }));
    for (const hole of holes) {
      tiles[hole.tee.y * width + hole.tee.x] = "tee";
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) tiles[(hole.green.y + dy) * width + hole.green.x + dx] = "green";
    }
    const course = { ...DEFAULT_COURSE, width, height, tiles, elevations: new Array(width * height).fill(0), holes };
    expect(reconcileTutorialProgress(progress, { ...course, holes: holes.slice(0, 8) })).toBe(progress);
    const reconciled = reconcileTutorialProgress(progress, course);
    expect(TUTORIAL_STEPS[reconciled.stepIndex].id).toBe("watch-golfers");
    expect(reconcileTutorialProgress(reconciled, course)).toBe(reconciled);
  });
});

describe("M14 advisor", () => {
  it("prioritizes a low-cash warning and can silence it", () => {
    const messages = advisorMessages(DEFAULT_COURSE, { ...DEFAULT_WORLD, cash: 100 }, week(-500), undefined);
    expect(messages[0].priority).toBe("warning");
    expect(allowsMessage("important", messages[0])).toBe(true);
    expect(allowsMessage("off", messages[0])).toBe(false);
  });

  it("celebrates the first profitable week without requiring an exact value", () => {
    const messages = advisorMessages(DEFAULT_COURSE, DEFAULT_WORLD, week(1), week(-1));
    expect(messages.some((message) => message.priority === "celebration")).toBe(true);
  });

  it("offers a chatty hint before the course is complete", () => {
    const messages = advisorMessages(DEFAULT_COURSE, DEFAULT_WORLD, undefined, undefined);
    const hint = messages.find((message) => message.priority === "hint");
    expect(hint && allowsMessage("chatty", hint)).toBe(true);
  });
});

describe("M14 Golfopedia", () => {
  it("generates one live-economics entry for every terrain", () => {
    for (const terrain of terrains) {
      const entry = GOLFOPEDIA_ENTRIES.find((candidate) => candidate.id === `terrain-${terrain}`);
      expect(entry).toBeDefined();
      expect(entry?.facts).toContainEqual({ label: "Build", value: `$${TERRAIN_BUILD_COST[terrain].toLocaleString()} / tile` });
      expect(entry?.facts).toContainEqual({ label: "Salvage", value: `$${TERRAIN_SALVAGE_VALUE[terrain].toLocaleString()} / tile` });
    }
  });

  it("generates all six golfer archetype pages", () => {
    expect(GOLFOPEDIA_ENTRIES.filter((entry) => entry.section === "Golfers")).toHaveLength(6);
  });
});

describe("M14 shared tooltip content", () => {
  it("provides meaningful help for representative control types", () => {
    expect(tooltipForControl("Help")).toMatch(/Golfopedia/);
    expect(tooltipForControl("Simulate week")).toMatch(/aggregate week/);
    expect(tooltipForControl("Green fee", "input")).toMatch(/Adjust/);
    expect(tooltipForControl("Speed 3x")).toMatch(/triple speed/);
    expect(tooltipForControl("Editor")).toMatch(/terrain/);
    expect(tooltipForControl("Results")).toMatch(/revenue/);
    expect(tooltipForControl("Quick Start")).toMatch(/sandbox/);
    expect(tooltipForControl("Skip tutorial")).toMatch(/normal play/);
  });

  it("documents every weekly demand factor", () => {
    expect(Object.keys(REPORT_HELP)).toEqual(expect.arrayContaining([
      "Course quality", "Condition", "Reputation", "Price", "Marketing", "Staff",
    ]));
  });
});
