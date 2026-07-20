import { describe, expect, it } from "vitest";
import { createNewGame } from "./newGame";
import type { GameSetup } from "../models/setup";
import { CHALLENGE_GOALS } from "../objectives/goals";
import { DEFAULT_WORLD } from "../models/defaults";

function setup(over: Partial<GameSetup> = {}): GameSetup {
  return {
    mode: "challenge",
    courseName: "Willow Creek",
    seed: 424242,
    theme: "parkland",
    difficulty: "normal",
    ...over,
  };
}

describe("createNewGame (ZKU-162)", () => {
  it("same seed + theme + difficulty reproduces identical starting state", () => {
    const a = createNewGame(setup());
    const b = createNewGame(setup());
    expect(a.course).toEqual(b.course);
    expect(a.world).toEqual(b.world);
  });

  it("different seeds produce different land", () => {
    const a = createNewGame(setup({ seed: 1 }));
    const b = createNewGame(setup({ seed: 2 }));
    expect(a.course.tiles).not.toEqual(b.course.tiles);
  });

  it("records name, theme, mode, difficulty, founder on the run", () => {
    const { course, world } = createNewGame(
      setup({ theme: "desert", difficulty: "hard", founderName: "Zach K." })
    );
    expect(course.name).toBe("Willow Creek");
    expect(course.theme).toBe("desert");
    expect(world.mode).toBe("challenge");
    expect(world.difficulty).toBe("hard");
    expect(world.founderName).toBe("Zach K.");
    expect(world.runSeed).toBe(424242);
  });

  it("challenge mode gets the standard goal set; sandbox is free play", () => {
    const challenge = createNewGame(setup());
    expect(challenge.world.objectives?.goals).toEqual(CHALLENGE_GOALS);
    expect(challenge.world.objectives?.outcome).toBe("OPEN");
    const sandbox = createNewGame(setup({ mode: "sandbox" }));
    expect(sandbox.world.objectives).toBeNull();
  });

  it("goal override wins over the mode default (retry / scenarios)", () => {
    const goals = [CHALLENGE_GOALS[0]];
    const { world } = createNewGame(setup(), goals);
    expect(world.objectives?.goals).toEqual(goals);
    const freePlay = createNewGame(setup(), null);
    expect(freePlay.world.objectives).toBeNull();
  });

  it("sandbox starting-cash override applies only in sandbox", () => {
    const sandbox = createNewGame(
      setup({ mode: "sandbox", sandboxOverrides: { startingCash: 80_000 } })
    );
    expect(sandbox.world.cash).toBe(80_000);
    const challenge = createNewGame(setup({ sandboxOverrides: { startingCash: 80_000 } }));
    expect(challenge.world.cash).toBe(DEFAULT_WORLD.cash);
  });

  it("blank course name falls back to the default", () => {
    const { course } = createNewGame(setup({ courseName: "   " }));
    expect(course.name.length).toBeGreaterThan(0);
  });

  it("starts with a clubhouse and empty holes", () => {
    const { course } = createNewGame(setup());
    expect(course.buildings.some((b) => b.type === "clubhouse")).toBe(true);
    expect(course.holes).toHaveLength(9);
    expect(course.holes.every((h) => h.tee === null && h.green === null)).toBe(true);
  });

  it("adds a deterministic cultivated planting ring clear of the clubhouse footprint", () => {
    const { course } = createNewGame(setup());
    const clubhouse = course.buildings.find((building) => building.type === "clubhouse")!;
    const nearby = course.obstacles.filter((obstacle) => Math.hypot(obstacle.x - clubhouse.x - 1, obstacle.y - clubhouse.y - 1) <= 8);
    expect(nearby.length).toBeGreaterThanOrEqual(6);
    for (const obstacle of nearby) {
      expect(obstacle.x >= clubhouse.x && obstacle.x < clubhouse.x + 3 && obstacle.y >= clubhouse.y && obstacle.y < clubhouse.y + 3).toBe(false);
      expect(["rough", "deep_rough"]).toContain(course.tiles[obstacle.y * course.width + obstacle.x]);
    }
  });
});
