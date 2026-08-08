/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import type { Difficulty, LandTheme } from "../models/types";
import { tickWeek } from "../sim/tickWeek";
import { BIOME_KEYS } from "../models/biomes";
import { hashCanonicalValue } from "../../utils/stateHash";
import {
  configureReleaseBalanceStrategy,
  releaseBalanceInitialWorld,
  releaseBalanceProperty,
  type ReleasePropertySize,
  type ReleaseStrategy,
} from "./releaseBalanceFixtures";

interface BalanceRow {
  theme: LandTheme; size: ReleasePropertySize; difficulty: Difficulty; strategy: ReleaseStrategy; seed: number;
  weeks: number; bankrupt: boolean; firstProfitWeek: number | null; lossWeeks: number;
  finalCash: number; peakCash: number; minimumCash: number; reputation: number; condition: number;
}

const startedAt = performance.now();
const rows: BalanceRow[] = [];
const legacyProjectedRows: BalanceRow[] = [];
let runIndex = 0;
for (const theme of BIOME_KEYS) for (const size of [9, 18, 36] as const) for (const difficulty of ["easy", "normal", "hard"] as const) for (const strategy of ["conservative", "aggressive-expansion", "poor-management"] as const) {
  const seed: number = 280000 + runIndex++ * 97;
  let course = configureReleaseBalanceStrategy(releaseBalanceProperty(theme, size), strategy);
  let world = releaseBalanceInitialWorld(difficulty, strategy, seed);
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
const expectedLegacyProjectedSimulatedWeeks = 8_227;
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
const expectedCanonicalHash = "499b7056";
const expectedLegacyProjectionHash = "b5a5a183";
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
