import { describe, expect, it } from "vitest";
import type { Difficulty, LandTheme } from "../models/types";
import { tickWeek } from "../sim/tickWeek";
import {
  configureReleaseBalanceStrategy,
  releaseBalanceInitialWorld,
  releaseBalanceProperty,
  type ReleasePropertySize,
  type ReleaseStrategy,
} from "./releaseBalanceFixtures";

interface ReleasePath {
  theme: LandTheme;
  size: ReleasePropertySize;
  difficulty: Difficulty;
  strategy: ReleaseStrategy;
  seed: number;
}

function runPath(path: ReleasePath) {
  let course = configureReleaseBalanceStrategy(
    releaseBalanceProperty(path.theme, path.size),
    path.strategy,
  );
  let world = releaseBalanceInitialWorld(path.difficulty, path.strategy, path.seed);
  let firstBankruptWeek: number | null = null;
  let minimumCash = world.cash;
  for (let week = 0; week < 104; week++) {
    const output = tickWeek(course, world, path.seed + week);
    course = output.course;
    world = output.world;
    minimumCash = Math.min(minimumCash, world.cash);
    if (world.isBankrupt && firstBankruptWeek == null) firstBankruptWeek = world.week;
  }
  return { course, world, firstBankruptWeek, minimumCash };
}

describe("release balance viability (ZK-701)", () => {
  it("keeps the normal Desert 36-hole conservative estate viable for 104 weeks", { timeout: 60_000 }, () => {
    const result = runPath({
      theme: "desert",
      size: 36,
      difficulty: "normal",
      strategy: "conservative",
      seed: 287275,
    });
    expect(result.firstBankruptWeek).toBeNull();
    expect(result.world.isBankrupt).toBe(false);
    expect(result.world.week).toBe(105);
    // The estate may use its distress runway; viability must come from the
    // aggregate two-course ledger, not a cash grant or weaker fail threshold.
    expect(result.minimumCash).toBeLessThan(0);
    expect(result.minimumCash).toBeGreaterThan(-10_000);
  });

  it("preserves representative poor-management bankruptcies as sticky", { timeout: 60_000 }, () => {
    const paths: ReleasePath[] = [
      { theme: "desert", size: 9, difficulty: "easy", strategy: "poor-management", seed: 285432 },
      { theme: "desert", size: 9, difficulty: "hard", strategy: "poor-management", seed: 286014 },
      { theme: "desert", size: 36, difficulty: "normal", strategy: "poor-management", seed: 287469 },
    ];

    for (const path of paths) {
      const result = runPath(path);
      expect(result.firstBankruptWeek, `${path.size}/${path.difficulty}`).not.toBeNull();
      expect(result.world.isBankrupt, `${path.size}/${path.difficulty}`).toBe(true);
      expect(result.world.week, `${path.size}/${path.difficulty}`).toBe(105);
    }
  });
});
