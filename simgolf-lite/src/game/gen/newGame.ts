import type { Course, Point, World } from "../models/types";
import type { GameSetup } from "../models/setup";
import type { GoalDefinition } from "../models/objectives";
import { createObjectiveState } from "../models/objectives";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { COURSE_WIDTH, COURSE_HEIGHT } from "../models/constants";
import { findClubhouseSpot } from "../models/buildings";
import { CHALLENGE_GOALS } from "../objectives/goals";
import { getDifficultyProfile } from "../balance/difficulty";
import { generateNewGameLandscape } from "./generateWildLand";
import { createEstate } from "../estate/estate";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { createDefaultPlayerPro } from "../playerPro/playerPro";
import { createSeasonalState } from "../seasons/seasons";
import { biomeCompatibilityMetadataFor } from "../models/biomes";

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
  const { tiles, obstacles, elevations } = generateNewGameLandscape(
    COURSE_WIDTH,
    COURSE_HEIGHT,
    seed,
    [], // no reserved zones — holes aren't placed yet
    setup.theme
  );

  const course: Course = {
    ...DEFAULT_COURSE,
    name: setup.courseName.trim() || DEFAULT_COURSE.name,
    theme: setup.theme,
    biomeCompatibility: biomeCompatibilityMetadataFor(setup.theme),
    tiles,
    elevations,
    holes: Array.from({ length: 9 }, (_, i) => ({
      id: `hole-${i + 1}`,
      tee: null,
      green: null,
      parMode: "AUTO" as const,
      name: `Hole ${i + 1}`,
    })),
    obstacles,
    buildings: [],
    layouts: [{
      id: "course-primary",
      name: setup.courseName.trim() || DEFAULT_COURSE.name,
      draftHoleIds: Array.from({ length: 9 }, (_, i) => `hole-${i + 1}`),
      publishedHoleIds: Array.from({ length: 9 }, (_, i) => `hole-${i + 1}`),
      roundLength: 9,
      state: "open",
      greenFee: DEFAULT_COURSE.baseGreenFee,
    }],
    activeCourseId: "course-primary",
  };
  // Starter clubhouse (ZKU-152): anchor the course visually from day one.
  const clubhouseSpot = findClubhouseSpot(course);
  course.buildings = clubhouseSpot ? [{ type: "clubhouse" as const, ...clubhouseSpot }] : [];
  if (clubhouseSpot) {
    // Deterministic cultivated planting ring. It decorates the arrival area
    // without entering the 3x3 building footprint or semantic golf surfaces.
    const occupied = new Set(course.obstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`));
    const candidates: Point[] = [];
    for (let dy = -6; dy <= 8; dy++) for (let dx = -6; dx <= 8; dx++) {
      const x = clubhouseSpot.x + dx;
      const y = clubhouseSpot.y + dy;
      const distance = Math.hypot(dx - 1, dy - 1);
      if (distance < 4 || distance > 7 || x < 0 || y < 0 || x >= course.width || y >= course.height) continue;
      const terrain = course.tiles[y * course.width + x];
      if ((terrain === "rough" || terrain === "deep_rough") && !occupied.has(`${x},${y}`)) candidates.push({ x, y });
    }
    candidates.sort((a, b) => {
      const ah = (Math.imul(a.x + 17, 73856093) ^ Math.imul(a.y + seed, 19349663)) >>> 0;
      const bh = (Math.imul(b.x + 17, 73856093) ^ Math.imul(b.y + seed, 19349663)) >>> 0;
      return ah - bh;
    });
    for (const [index, point] of candidates.slice(0, 10).entries()) {
      course.obstacles.push({ ...point, type: index % 4 === 0 ? "tree" : "bush" });
    }
  }
  course.estate = createEstate(course, seed);

  const effectiveGoals =
    goals !== undefined ? goals : setup.mode === "challenge" ? CHALLENGE_GOALS : null;

  // Explicit sandbox override wins; otherwise difficulty scales the default
  // (ZKU-165 — Normal is the identity, so this is today's 25k on normal).
  const startingCash =
    setup.mode === "sandbox" && setup.sandboxOverrides?.startingCash != null
      ? setup.sandboxOverrides.startingCash
      : Math.round(DEFAULT_WORLD.cash * getDifficultyProfile(setup.difficulty).startingCashMult);

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
    playerPro: createDefaultPlayerPro({
      seed,
      name: setup.playerPro?.name ?? setup.founderName,
      appearance: setup.playerPro?.appearance,
      handedness: setup.playerPro?.handedness,
      background: setup.playerPro?.background,
    }),
    seasonal: createSeasonalState({ runSeed: seed, theme: setup.theme }),
  };
  if (setup.founderName?.trim()) world.founderName = setup.founderName.trim();

  return { course: normalizeCourseLayouts(course), world };
}
