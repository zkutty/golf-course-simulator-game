import type { Course, World } from "../models/types";
import type { GameSetup } from "../models/setup";
import type { GoalDefinition } from "../models/objectives";
import { createObjectiveState } from "../models/objectives";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { COURSE_WIDTH, COURSE_HEIGHT } from "../models/constants";
import { findClubhouseSpot } from "../models/buildings";
import { CHALLENGE_GOALS } from "../objectives/goals";
import { generateWildLandWithObstacles } from "./generateWildLand";

/**
 * THE new-game path (ZKU-162): every fresh run — wizard, quick start, defeat
 * retry, save reset — builds its course/world here, deterministically from
 * the setup. Same seed + theme + difficulty ⇒ identical starting state.
 *
 * `goals` overrides the mode's default goal set (used by defeat-retry to
 * keep a run's exact goals, and by scenarios in ZKU-164).
 */
export function createNewGame(
  setup: GameSetup,
  goals?: GoalDefinition[] | null
): { course: Course; world: World } {
  const seed = setup.seed | 0;
  const { tiles, obstacles, elevations } = generateWildLandWithObstacles(
    COURSE_WIDTH,
    COURSE_HEIGHT,
    seed,
    [] // no reserved zones — holes aren't placed yet
  );

  const course: Course = {
    ...DEFAULT_COURSE,
    name: setup.courseName.trim() || DEFAULT_COURSE.name,
    theme: setup.theme,
    tiles,
    elevations,
    holes: Array.from({ length: 9 }, (_, i) => ({
      tee: null,
      green: null,
      parMode: "AUTO" as const,
      name: `Hole ${i + 1}`,
    })),
    obstacles,
    buildings: [],
  };
  // Starter clubhouse (ZKU-152): anchor the course visually from day one.
  const clubhouseSpot = findClubhouseSpot(course);
  course.buildings = clubhouseSpot ? [{ type: "clubhouse" as const, ...clubhouseSpot }] : [];

  const effectiveGoals =
    goals !== undefined ? goals : setup.mode === "challenge" ? CHALLENGE_GOALS : null;

  const startingCash =
    setup.mode === "sandbox" && setup.sandboxOverrides?.startingCash != null
      ? setup.sandboxOverrides.startingCash
      : DEFAULT_WORLD.cash;

  const world: World = {
    ...DEFAULT_WORLD,
    cash: startingCash,
    runSeed: seed,
    distressWeeks: 0,
    isBankrupt: false,
    loans: [],
    lastBridgeLoanWeek: -999,
    lastWeekProfit: 0,
    mode: setup.mode,
    difficulty: setup.difficulty,
    objectives: effectiveGoals && effectiveGoals.length > 0 ? createObjectiveState(effectiveGoals) : null,
  };
  if (setup.founderName?.trim()) world.founderName = setup.founderName.trim();

  return { course, world };
}
