import { getEconomicPressure, normalizeExperienceAxes } from "../balance/experience";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Difficulty, LandTheme, Terrain, World } from "../models/types";
import { createLoan } from "../sim/loans";

export type ReleasePropertySize = 9 | 18 | 36;
export type ReleaseStrategy = "conservative" | "aggressive-expansion" | "poor-management";

const propertyCache = new Map<string, Course>();
const propertyGeometryCache = new Map<ReleasePropertySize, Course>();

export function releaseBalanceProperty(
  theme: LandTheme,
  size: ReleasePropertySize,
): Course {
  const cacheKey = `${theme}:${size}`;
  const cached = propertyCache.get(cacheKey);
  if (cached) return cached;
  const cachedGeometry = propertyGeometryCache.get(size);
  if (cachedGeometry) {
    const course = {
      ...cachedGeometry,
      name: `M28 ${theme} ${size}`,
      theme,
    };
    propertyCache.set(cacheKey, course);
    return course;
  }
  // Compact, fully playable routings keep the 8,424-week matrix fast while
  // exercising the real demand, capacity, maintenance, loan, tax, distress,
  // reputation, and multi-course reconciliation paths.
  const width = 32;
  const height = size * 2 + 4;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway");
  const holes = Array.from({ length: size }, (_, index) => {
    const y = 3 + index * 2;
    const forward = index % 2 === 0;
    const tee = { x: forward ? 2 : width - 3, y };
    const green = { x: forward ? width - 3 : 2, y };
    tiles[y * width + tee.x] = "tee";
    tiles[y * width + green.x] = "green";
    return {
      id: `m28-${index + 1}`,
      name: `Release ${index + 1}`,
      tee,
      green,
      teeBoxes: { member: tee },
      pinPositions: { A: green },
      parMode: "MANUAL" as const,
      parManual: 4 as const,
      holeIndex: index + 1,
    };
  });
  const groups = size === 36 ? [holes.slice(0, 18), holes.slice(18)] : [holes];
  const layouts = groups.map((group, index) => ({
    id: `release-${index + 1}`,
    name: `Release ${index + 1}`,
    draftHoleIds: group.map((hole) => hole.id),
    publishedHoleIds: group.map((hole) => hole.id),
    roundLength: group.length === 9 ? 9 as const : 18 as const,
    state: "open" as const,
    greenFee: size === 9 ? 70 : 95,
  }));
  const course: Course = {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes,
    obstacles: [],
    buildings: [{ type: "clubhouse", x: 14, y: 0 }],
    decorations: [],
    yardsPerTile: 10,
    name: `M28 ${theme} ${size}`,
    baseGreenFee: size === 9 ? 70 : 95,
    condition: .85,
    theme,
    layouts,
    activeCourseId: layouts[0].id,
  };
  // Every management path starts from the same immutable physical property.
  // Sharing that identity lets the production hole-score dependency cache
  // reuse exact terrain/elevation solves across strategy and difficulty rows.
  // tickWeek commits new Course roots, so no scenario can mutate this fixture.
  propertyGeometryCache.set(size, course);
  propertyCache.set(cacheKey, course);
  return course;
}

export function releaseBalanceInitialWorld(
  difficulty: Difficulty,
  strategy: ReleaseStrategy,
  seed: number,
): World {
  const axes = normalizeExperienceAxes({ difficulty });
  const startingCash = Math.round(
    DEFAULT_WORLD.cash * getEconomicPressure(axes.economicPressure).startingCashMult,
  );
  if (strategy !== "aggressive-expansion") {
    return {
      ...DEFAULT_WORLD,
      ...axes,
      runSeed: seed,
      cash: strategy === "poor-management" ? Math.min(15_000, startingCash) : startingCash,
      reputation: strategy === "poor-management" ? 20 : DEFAULT_WORLD.reputation,
      loans: [],
      isBankrupt: false,
      distressWeeks: 0,
    };
  }
  const loan = createLoan({
    kind: "EXPANSION",
    principal: 150_000,
    apr: .12,
    termWeeks: 104,
    idSeed: seed,
  });
  return {
    ...DEFAULT_WORLD,
    ...axes,
    runSeed: seed,
    cash: startingCash + loan.principal,
    loans: [loan],
    isBankrupt: false,
    distressWeeks: 0,
  };
}

export function configureReleaseBalanceStrategy(
  course: Course,
  strategy: ReleaseStrategy,
): Course {
  if (strategy === "aggressive-expansion") {
    return { ...course, baseGreenFee: Math.max(110, course.baseGreenFee), condition: .9 };
  }
  if (strategy === "poor-management") {
    return { ...course, baseGreenFee: 150, condition: .45 };
  }
  return course;
}
