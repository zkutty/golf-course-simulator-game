import type { Course, Terrain, World } from "./types";

export const DEFAULT_COURSE: Course = {
  name: "West Village Municipal",
  width: 36,
  height: 24,
  tiles: Array.from({ length: 36 * 24 }, () => "rough" as Terrain),
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
};


