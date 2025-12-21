import type { Course, Terrain, World } from "./types";
import { COURSE_WIDTH, COURSE_HEIGHT } from "./constants";

export const DEFAULT_COURSE: Course = {
  name: "West Village Municipal",
  width: COURSE_WIDTH,
  height: COURSE_HEIGHT,
  tiles: Array.from({ length: COURSE_WIDTH * COURSE_HEIGHT }, () => "rough" as Terrain),
  holes: Array.from({ length: 9 }, (_, i) => ({
    tee: null,
    green: null,
    parMode: "AUTO" as const,
    name: `Hole ${i + 1}`,
  })),
  obstacles: [],
  yardsPerTile: 10,
  baseGreenFee: 65,
  condition: 0.75,
};

export const DEFAULT_WORLD: World = {
  week: 1,
  cash: 25_000,
  reputation: 40,
  staffLevel: 1,
  marketingLevel: 0,
  maintenanceBudget: 900,
  runSeed: 1337,
  distressWeeks: 0,
  isBankrupt: false,
  lastWeekProfit: 0,
  lastBridgeLoanWeek: -999,
  loans: [],
};


