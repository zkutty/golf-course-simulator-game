/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import type { Course, Difficulty, LandTheme, Terrain, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { getDifficultyProfile } from "../balance/difficulty";
import { tickWeek } from "../sim/tickWeek";
import { createLoan } from "../sim/loans";
import { BIOME_KEYS } from "../models/biomes";
import { hashCanonicalValue } from "../../utils/stateHash";

type PropertySize = 9 | 18 | 36;
type Strategy = "conservative" | "aggressive-expansion" | "poor-management";
interface BalanceRow {
  theme: LandTheme; size: PropertySize; difficulty: Difficulty; strategy: Strategy; seed: number;
  weeks: number; bankrupt: boolean; firstProfitWeek: number | null; lossWeeks: number;
  finalCash: number; peakCash: number; minimumCash: number; reputation: number; condition: number;
}

const propertyCache = new Map<string, Course>();
const propertyGeometryCache = new Map<PropertySize, Course>();

function property(theme: LandTheme, size: PropertySize): Course {
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
    return { id: `m28-${index + 1}`, name: `Release ${index + 1}`, tee, green, teeBoxes: { member: tee }, pinPositions: { A: green }, parMode: "MANUAL" as const, parManual: 4 as const, holeIndex: index + 1 };
  });
  const groups = size === 36 ? [holes.slice(0, 18), holes.slice(18)] : [holes];
  const layouts = groups.map((group, index) => ({ id: `release-${index + 1}`, name: `Release ${index + 1}`, draftHoleIds: group.map((hole) => hole.id), publishedHoleIds: group.map((hole) => hole.id), roundLength: group.length === 9 ? 9 as const : 18 as const, state: "open" as const, greenFee: size === 9 ? 70 : 95 }));
  const course: Course = {
    width, height, tiles, elevations: new Array(width * height).fill(0), holes,
    obstacles: [], buildings: [{ type: "clubhouse", x: 14, y: 0 }], decorations: [],
    yardsPerTile: 10, name: `M28 ${theme} ${size}`, baseGreenFee: size === 9 ? 70 : 95,
    condition: .85, theme, layouts, activeCourseId: layouts[0].id,
  };
  // Every management path starts from the same immutable physical property.
  // Sharing that identity lets the production hole-score dependency cache
  // reuse exact terrain/elevation solves across strategy and difficulty rows.
  // tickWeek commits new Course roots, so no scenario can mutate this fixture.
  propertyGeometryCache.set(size, course);
  propertyCache.set(cacheKey, course);
  return course;
}

function initialWorld(difficulty: Difficulty, strategy: Strategy, seed: number): World {
  const startingCash = Math.round(DEFAULT_WORLD.cash * getDifficultyProfile(difficulty).startingCashMult);
  if (strategy !== "aggressive-expansion") return {
    ...DEFAULT_WORLD,
    difficulty,
    runSeed: seed,
    cash: strategy === "poor-management" ? Math.min(15_000, startingCash) : startingCash,
    reputation: strategy === "poor-management" ? 20 : DEFAULT_WORLD.reputation,
    loans: [],
    isBankrupt: false,
    distressWeeks: 0,
  };
  const loan = createLoan({ kind: "EXPANSION", principal: 150_000, apr: .12, termWeeks: 104, idSeed: seed });
  return { ...DEFAULT_WORLD, difficulty, runSeed: seed, cash: startingCash + loan.principal, loans: [loan], isBankrupt: false, distressWeeks: 0 };
}

const startedAt = performance.now();
const rows: BalanceRow[] = [];
const legacyProjectedRows: BalanceRow[] = [];
let runIndex = 0;
for (const theme of BIOME_KEYS) for (const size of [9, 18, 36] as const) for (const difficulty of ["easy", "normal", "hard"] as const) for (const strategy of ["conservative", "aggressive-expansion", "poor-management"] as const) {
  const seed: number = 280000 + runIndex++ * 97;
  let course = property(theme, size);
  if (strategy === "aggressive-expansion") course = { ...course, baseGreenFee: Math.max(110, course.baseGreenFee), condition: .9 };
  if (strategy === "poor-management") course = { ...course, baseGreenFee: 150, condition: .45 };
  let world = initialWorld(difficulty, strategy, seed);
  let firstProfitWeek: number | null = null;
  let lossWeeks = 0;
  let peakCash = world.cash;
  let minimumCash = world.cash;
  let legacyProjection: BalanceRow | null = null;
  for (let week = 0; week < 104; week++) {
    const wasBankrupt = world.isBankrupt;
    const result = tickWeek(course, world, seed + week);
    course = result.course;
    world = result.world;
    if (wasBankrupt && !world.isBankrupt) {
      throw new Error(`Bankruptcy recovered unexpectedly for ${theme}/${size}/${difficulty}/${strategy}`);
    }
    if (result.result.profit > 0 && firstProfitWeek == null) firstProfitWeek = world.week;
    if (result.result.profit < 0) lossWeeks++;
    peakCash = Math.max(peakCash, world.cash);
    minimumCash = Math.min(minimumCash, world.cash);
    // Capture the exact row the pre-ZK-699 early-stop harness would have
    // emitted. Continuing after this point verifies bankrupt state remains
    // finite and sticky through the complete 104-week contract.
    if (world.isBankrupt && legacyProjection == null) {
      legacyProjection = { theme, size, difficulty, strategy, seed, weeks: world.week - 1, bankrupt: true, firstProfitWeek, lossWeeks, finalCash: Math.round(world.cash), peakCash: Math.round(peakCash), minimumCash: Math.round(minimumCash), reputation: Number(world.reputation.toFixed(2)), condition: Number(course.condition.toFixed(3)) };
    }
  }
  const row = { theme, size, difficulty, strategy, seed, weeks: world.week - 1, bankrupt: world.isBankrupt, firstProfitWeek, lossWeeks, finalCash: Math.round(world.cash), peakCash: Math.round(peakCash), minimumCash: Math.round(minimumCash), reputation: Number(world.reputation.toFixed(2)), condition: Number(course.condition.toFixed(3)) } satisfies BalanceRow;
  rows.push(row);
  legacyProjectedRows.push(legacyProjection ?? row);
}

const expectedRuns = BIOME_KEYS.length * 3 * 3 * 3;
if (rows.length !== expectedRuns) throw new Error(`Expected ${expectedRuns} release balance runs, got ${rows.length}`);
const expectedSimulatedWeeks = expectedRuns * 104;
const simulatedWeeks = rows.reduce((sum, row) => sum + row.weeks, 0);
if (simulatedWeeks !== expectedSimulatedWeeks) {
  throw new Error(`Expected ${expectedSimulatedWeeks} simulated weeks, got ${simulatedWeeks}`);
}
const legacyProjectedSimulatedWeeks = legacyProjectedRows.reduce((sum, row) => sum + row.weeks, 0);
const expectedLegacyProjectedSimulatedWeeks = 8_218;
if (legacyProjectedSimulatedWeeks !== expectedLegacyProjectedSimulatedWeeks) {
  throw new Error(`Expected legacy early-stop projection of ${expectedLegacyProjectedSimulatedWeeks} weeks, got ${legacyProjectedSimulatedWeeks}`);
}
if (rows.some((row) => row.weeks !== 104)) throw new Error("Every release balance row must execute exactly 104 weeks");
if (rows.some((row) => !Number.isFinite(row.finalCash) || !Number.isFinite(row.reputation))) throw new Error("Balance matrix produced non-finite state");
const normalPaths = rows.filter((row) => row.strategy !== "poor-management");
if (normalPaths.some((row) => row.firstProfitWeek == null)) {
  const failures = normalPaths.filter((row) => row.firstProfitWeek == null).map((row) => `${row.theme}/${row.size}/${row.difficulty}/${row.strategy}`);
  throw new Error(`Required play paths never reached profit: ${failures.join(", ")}`);
}

const canonical = {
  ok: true,
  weeksPerRun: 104,
  simulatedWeeks,
  legacyProjectedSimulatedWeeks,
  postBankruptcyWeeks: simulatedWeeks - legacyProjectedSimulatedWeeks,
  runs: rows.length,
  matrix: { themes: BIOME_KEYS.length, propertySizes: 3, difficulties: 3, strategies: 3 },
  summary: {
    normalPathBankruptcies: normalPaths.filter((row) => row.bankrupt).length,
    poorManagementBankruptcies: rows.filter((row) => row.strategy === "poor-management" && row.bankrupt).length,
    latestNormalFirstProfitWeek: Math.max(...normalPaths.map((row) => row.firstProfitWeek ?? 0)),
  },
  rows,
};
const elapsedMs = Math.round(performance.now() - startedAt);
const runtimeBudgetMs = 12 * 60_000;
if (elapsedMs > runtimeBudgetMs) {
  throw new Error(`Release balance runtime ${elapsedMs}ms exceeded ${runtimeBudgetMs}ms budget`);
}
const canonicalHash = hashCanonicalValue(canonical);
const legacyProjectionHash = hashCanonicalValue({ weeksPerRun: 104, rows: legacyProjectedRows });
const expectedCanonicalHash = "38b861f9";
const expectedLegacyProjectionHash = "6dc8d6f2";
if (canonicalHash !== expectedCanonicalHash) {
  throw new Error(`Release balance canonical hash changed: expected ${expectedCanonicalHash}, got ${canonicalHash}`);
}
if (legacyProjectionHash !== expectedLegacyProjectionHash) {
  throw new Error(`Release balance legacy projection hash changed: expected ${expectedLegacyProjectionHash}, got ${legacyProjectionHash}`);
}
const report = {
  ...canonical,
  canonicalHash,
  legacyProjectionHash,
  performance: { elapsedMs, runtimeBudgetMs },
};
mkdirSync(new URL("../artifacts/m28", import.meta.url), { recursive: true });
writeFileSync(new URL("../artifacts/m28/balance-matrix.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
