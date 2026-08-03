import { describe, expect, it } from "vitest";
import { createNewGame } from "./newGame";
import { generateNewGameLandscape, generateWildLandWithObstacles } from "./generateWildLand";
import type { GameSetup } from "../models/setup";
import { CHALLENGE_GOALS } from "../objectives/goals";
import { DEFAULT_WORLD } from "../models/defaults";
import { COURSE_HEIGHT, COURSE_WIDTH, STARTER_PARCEL_HEIGHT, STARTER_PARCEL_WIDTH } from "../models/constants";
import { isOwnedTile, starterParcelOffset } from "../estate/estate";

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

  it("uses one estate-wide natural baseline instead of regenerating the starter parcel", () => {
    const seed = 250025;
    const generated = generateWildLandWithObstacles(COURSE_WIDTH, COURSE_HEIGHT, seed, [], "links");
    const { course } = createNewGame(setup({ seed, theme: "links" }));

    expect(course.tiles).toEqual(generated.tiles);
    expect(course.elevations).toEqual(generated.elevations);
    for (const obstacle of generated.obstacles) {
      expect(course.obstacles).toContainEqual(obstacle);
    }
  });

  it("uses the exact setup-preview landscape when committing a Parkland run", () => {
    const seed = 7;
    const preview = generateNewGameLandscape(COURSE_WIDTH, COURSE_HEIGHT, seed, [], "parkland");
    const { course } = createNewGame(setup({ seed, theme: "parkland" }));

    expect(course.tiles).toEqual(preview.tiles);
    expect(course.elevations).toEqual(preview.elevations);
    for (const obstacle of preview.obstacles) expect(course.obstacles).toContainEqual(obstacle);
  });

  it("keeps Parkland's owned starter property visibly natural across representative seeds", () => {
    for (const seed of [1, 7, 42, 1234, 424242, 99001]) {
      const { course } = createNewGame(setup({ seed, theme: "parkland" }));
      const owned = course.tiles.flatMap((terrain, index) =>
        isOwnedTile(course, index % course.width, Math.floor(index / course.width))
          ? [{ terrain, elevation: course.elevations[index] ?? 0 }]
          : [],
      );
      const ownedObstacles = course.obstacles.filter((obstacle) =>
        isOwnedTile(course, obstacle.x, obstacle.y),
      );

      expect(owned.some(({ terrain }) => terrain === "water")).toBe(true);
      expect(new Set(owned.map(({ terrain }) => terrain)).size).toBeGreaterThanOrEqual(3);
      expect(Math.max(...owned.map(({ elevation }) => elevation)) - Math.min(...owned.map(({ elevation }) => elevation))).toBeGreaterThanOrEqual(2);
      expect(ownedObstacles.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("keeps Parkland starter landscapes seed-stable, distinct, and serializable", () => {
    const landscape = (seed: number) => {
      const run = createNewGame(setup({ seed, theme: "parkland" }));
      return {
        tiles: run.course.tiles.filter((_, index) => isOwnedTile(run.course, index % run.course.width, Math.floor(index / run.course.width))),
        elevations: run.course.elevations.filter((_, index) => isOwnedTile(run.course, index % run.course.width, Math.floor(index / run.course.width))),
        obstacles: run.course.obstacles.filter((obstacle) => isOwnedTile(run.course, obstacle.x, obstacle.y)),
      };
    };
    const first = landscape(42);
    expect(landscape(42)).toEqual(first);
    expect(landscape(424242)).not.toEqual(first);

    const run = createNewGame(setup({ seed: 42, theme: "parkland" }));
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
  });

  it("lets an estate coastline cross the starter boundary without a clipped water seam", () => {
    const { course } = createNewGame(setup({ seed: 7, theme: "links" }));
    const offset = starterParcelOffset();
    const insideStarter = (index: number) => {
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      return x >= offset.x && x < offset.x + STARTER_PARCEL_WIDTH
        && y >= offset.y && y < offset.y + STARTER_PARCEL_HEIGHT;
    };
    const water = course.tiles
      .map((terrain, index) => terrain === "water" ? index : -1)
      .filter((index) => index >= 0);
    const edgeWater = water.filter((index) => {
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      return x === 0 || y === 0 || x === course.width - 1 || y === course.height - 1;
    });
    const connected = new Set(edgeWater);
    const queue = [...edgeWater];
    while (queue.length > 0) {
      const index = queue.shift()!;
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < course.width ? index + 1 : -1,
        y > 0 ? index - course.width : -1,
        y + 1 < course.height ? index + course.width : -1,
      ];
      for (const next of neighbors) {
        if (next >= 0 && course.tiles[next] === "water" && !connected.has(next)) {
          connected.add(next);
          queue.push(next);
        }
      }
    }

    expect(water.some(insideStarter)).toBe(true);
    expect(water.some((index) => !insideStarter(index))).toBe(true);
    expect(water.every((index) => connected.has(index))).toBe(true);
    expect(water.some((index) => {
      if (!insideStarter(index)) return false;
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      return [
        x > 0 ? index - 1 : -1,
        x + 1 < course.width ? index + 1 : -1,
        y > 0 ? index - course.width : -1,
        y + 1 < course.height ? index + course.width : -1,
      ].some((next) => next >= 0 && !insideStarter(next) && course.tiles[next] === "water");
    })).toBe(true);
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
