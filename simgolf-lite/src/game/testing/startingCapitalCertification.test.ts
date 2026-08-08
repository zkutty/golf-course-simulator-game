import { describe, expect, it } from "vitest";
import { startingCapitalForAxes, normalizeExperienceAxes, terrainCostMult } from "../balance/experience";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { computeElevationChangeCost, computeTerrainChangeCost } from "../models/terrainEconomics";
import { naturalFeatureRemovalQuote } from "../models/plantRegistry";
import type { Course, Difficulty, LandTheme, Obstacle, Terrain, World } from "../models/types";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { isCoursePlayable } from "../sim/isCoursePlayable";
import { tickWeek } from "../sim/tickWeek";
import { hashCanonicalValue } from "../../utils/stateHash";

type RouteSpec = { par: 3 | 4 | 5; tiles: number };
const ROUTES: readonly RouteSpec[] = [
  { par: 3, tiles: 9 }, { par: 3, tiles: 10 }, { par: 3, tiles: 11 },
  { par: 4, tiles: 18 }, { par: 4, tiles: 19 }, { par: 4, tiles: 20 },
  { par: 5, tiles: 26 }, { par: 5, tiles: 27 }, { par: 5, tiles: 28 },
];
const CORRECTION_BUFFER = 5_000;

export interface StartingCapitalCertificationRow {
  theme: LandTheme;
  difficulty: Difficulty;
  capital: number;
  constructionCost: number;
  remainingAfterConstruction: number;
  constructionShare: number;
  correctionBuffer: number;
  minimumCash: number;
  finalCash: number;
  open: boolean;
  playable: boolean;
  averageFairwayCorridor: number;
  routeYards: number[];
}

function index(width: number, x: number, y: number): number {
  return y * width + x;
}

/**
 * A compact public 9: realistic lower-end Par 3/4/5 yardages at 17 yards per
 * tile, two maintained fairway lanes throughout, nine tee/green setups, and
 * a small real clearing/earthwork allowance. It is intentionally the cheapest
 * credible opening, not a zero-cost synthetic board.
 */
function openingCourse(theme: LandTheme, costMult: number): { course: Course; constructionCost: number; averageFairwayCorridor: number } {
  const width = 38;
  const height = 58;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "rough");
  const elevations = new Array<number>(width * height).fill(0);
  const obstacleTypes: Obstacle["type"][] = ["tree", "bush", "rock"];
  const obstacles: Obstacle[] = [];
  const changed = new Map<number, Terrain>();
  const set = (x: number, y: number, terrain: Terrain) => {
    const tile = index(width, x, y);
    tiles[tile] = terrain;
    changed.set(tile, terrain);
  };
  const holes = ROUTES.map((route, holeIndex) => {
    const y = 3 + holeIndex * 6;
    const championship = { x: 1, y };
    const member = { x: 2, y };
    const forward = { x: 3, y };
    const green = { x: 1 + route.tiles, y };
    // Exactly two fairway tiles wide from the championship tee to the green.
    for (let x = championship.x; x <= green.x; x++) {
      set(x, y, "fairway");
      set(x, y + 1, "fairway");
    }
    set(championship.x, championship.y, "tee");
    set(member.x, member.y, "tee");
    set(forward.x, forward.y, "tee");
    set(green.x, green.y, "green");
    set(green.x, green.y + 1, "green");
    // One natural obstacle is genuinely cleared per hole. It does not remain
    // on the line when the course opens, but its removal is included in cost.
    obstacles.push({ type: obstacleTypes[holeIndex % obstacleTypes.length], x: 5, y, origin: "natural" });
    return {
      id: `capital-${holeIndex + 1}`,
      name: `Capital ${holeIndex + 1}`,
      tee: member,
      green,
      teeBoxes: { forward, member, championship },
      pinPositions: { A: green, B: { x: green.x, y: green.y + 1 }, C: null },
      parMode: "MANUAL" as const,
      parManual: route.par,
      parByTee: {
        forward: { mode: "MANUAL" as const, par: route.par },
        member: { mode: "MANUAL" as const, par: route.par },
        championship: { mode: "MANUAL" as const, par: route.par },
      },
      holeIndex: holeIndex + 1,
    };
  });
  const terrainCost = [...changed.values()].reduce(
    (total, terrain) => total + computeTerrainChangeCost("rough", terrain, costMult, theme).net,
    0,
  );
  const clearingCost = obstacles.reduce((total, obstacle) => {
    return total + naturalFeatureRemovalQuote({ theme, obstacle, costMult }).net;
  }, 0);
  // Nine small, deterministic finish-grade corrections on the corridor.
  const earthworkCost = ROUTES.reduce(
    (total) => total + computeElevationChangeCost(1, costMult, theme).net,
    0,
  );
  const course = normalizeCourseLayouts({
    ...DEFAULT_COURSE,
    name: `ZK-773 ${theme} compact public nine`,
    width,
    height,
    tiles,
    elevations,
    holes,
    obstacles: [],
    decorations: [],
    yardsPerTile: 17,
    condition: 0.82,
    theme,
    layouts: [{
      id: "capital-nine",
      name: "Capital Nine",
      draftHoleIds: holes.map((hole) => hole.id),
      publishedHoleIds: holes.map((hole) => hole.id),
      roundLength: 9,
      state: "open",
      greenFee: 70,
    }],
    activeCourseId: "capital-nine",
  });
  return { course, constructionCost: terrainCost + clearingCost + earthworkCost, averageFairwayCorridor: 2 };
}

export function certifyStartingCapital(): StartingCapitalCertificationRow[] {
  const rows: StartingCapitalCertificationRow[] = [];
  for (const theme of ["parkland", "links", "desert"] as const) {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const axes = normalizeExperienceAxes({ difficulty });
      const capital = startingCapitalForAxes(axes);
      const { course: initialCourse, constructionCost, averageFairwayCorridor } = openingCourse(
        theme,
        terrainCostMult(axes.economicPressure),
      );
      let course = initialCourse;
      let world: World = {
        ...DEFAULT_WORLD,
        ...axes,
        mode: "challenge",
        runSeed: 773_000 + rows.length,
        cash: capital - constructionCost,
        isBankrupt: false,
        distressWeeks: 0,
        loans: [],
        lastBridgeLoanWeek: -999,
      };
      let minimumCash = world.cash;
      const openingCash = world.cash;
      for (let week = 0; week < 4; week++) {
        const output = tickWeek(course, world, world.runSeed + week);
        course = output.course;
        world = output.world;
        minimumCash = Math.min(minimumCash, world.cash);
      }
      // Hold a modest correction reserve even if this deterministic opening
      // earns a first-week profit. This prevents a one-tick windfall from
      // certifying a capital amount with no room to repair an early mistake.
      const correctionBuffer = Math.max(CORRECTION_BUFFER, openingCash - minimumCash);
      const open = course.layouts?.every((layout) => layout.state === "open") ?? false;
      rows.push({
        theme,
        difficulty,
        capital,
        constructionCost: Math.round(constructionCost),
        remainingAfterConstruction: Math.round(openingCash),
        constructionShare: Number((constructionCost / capital).toFixed(4)),
        correctionBuffer: Math.round(correctionBuffer),
        minimumCash: Math.round(minimumCash),
        finalCash: Math.round(world.cash),
        open,
        playable: isCoursePlayable(initialCourse),
        averageFairwayCorridor,
        routeYards: ROUTES.map((route) => route.tiles * 17),
      });
    }
  }
  return rows;
}

describe("ZK-773 starting-capital certification", () => {
  it("keeps every profile/pressure opening viable through construction and four operating weeks", { timeout: 30_000 }, () => {
    const rows = certifyStartingCapital();
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.playable).toBe(true);
      expect(row.open).toBe(true);
      expect(row.averageFairwayCorridor).toBeGreaterThanOrEqual(2);
      expect(row.routeYards.filter((yards) => yards >= 150 && yards <= 190)).toHaveLength(3);
      expect(row.routeYards.filter((yards) => yards >= 300 && yards <= 345)).toHaveLength(3);
      expect(row.routeYards.filter((yards) => yards >= 440 && yards <= 480)).toHaveLength(3);
      expect(row.remainingAfterConstruction).toBeGreaterThan(row.correctionBuffer);
      expect(row.minimumCash).toBeGreaterThan(-10_000);
      expect(row.constructionShare).toBeLessThan(1);
    }
    expect(rows.find((row) => row.theme === "desert" && row.difficulty === "hard")).toMatchObject({ capital: 85_000 });
    expect(hashCanonicalValue(rows)).toBe("3121e95f");
  });
});
