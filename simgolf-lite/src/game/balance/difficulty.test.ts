import { describe, expect, it } from "vitest";
import { BALANCE } from "./balanceConfig";
import { DIFFICULTY_PROFILES, getEffectiveBalance, terrainCostMult } from "./difficulty";
import { computeTerrainChangeCost, computeElevationChangeCost, ELEVATION_COST_PER_STEP } from "../models/terrainEconomics";
import { tickWeek } from "../sim/tickWeek";
import { demandBreakdown } from "../sim/score";
import { createNewGame } from "../gen/newGame";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { GameSetup } from "../models/setup";
import type { Terrain } from "../models/types";

describe("difficulty resolver (ZKU-165)", () => {
  it("normal is the identity — the BALANCE object itself, bit-identical", () => {
    expect(getEffectiveBalance("normal")).toBe(BALANCE);
    expect(getEffectiveBalance(undefined)).toBe(BALANCE);
    const p = DIFFICULTY_PROFILES.normal;
    expect(Object.entries(p).filter(([k]) => k.endsWith("Mult")).every(([, v]) => v === 1)).toBe(true);
    expect(p.bridgeCooldownWeeksAdd).toBe(0);
  });

  it("easy softens demand, wear, reputation, and loans", () => {
    const b = getEffectiveBalance("easy");
    expect(b.visitors.scale).toBeGreaterThan(BALANCE.visitors.scale);
    expect(b.condition.wearCap).toBeLessThan(BALANCE.condition.wearCap);
    expect(b.condition.wearDivisor).toBeGreaterThan(BALANCE.condition.wearDivisor);
    expect(b.reputation.recoveryMult).toBeGreaterThan(BALANCE.reputation.recoveryMult);
    expect(b.reputation.declineMult).toBeLessThan(BALANCE.reputation.declineMult);
    expect(b.loans.bridge.apr).toBeLessThan(BALANCE.loans.bridge.apr);
  });

  it("hard tightens the same knobs and the bridge cooldown", () => {
    const b = getEffectiveBalance("hard");
    expect(b.visitors.scale).toBeLessThan(BALANCE.visitors.scale);
    expect(b.condition.wearCap).toBeGreaterThan(BALANCE.condition.wearCap);
    expect(b.reputation.declineMult).toBeGreaterThan(BALANCE.reputation.declineMult);
    expect(b.loans.bridge.apr).toBeGreaterThan(BALANCE.loans.bridge.apr);
    expect(b.loans.bridgeCooldownWeeks).toBe(
      BALANCE.loans.bridgeCooldownWeeks + DIFFICULTY_PROFILES.hard.bridgeCooldownWeeksAdd
    );
  });

  it("untouched knobs are unchanged on derived profiles", () => {
    const b = getEffectiveBalance("hard");
    expect(b.pricing).toEqual(BALANCE.pricing);
    expect(b.overhead).toEqual(BALANCE.overhead);
    expect(b.terrain).toEqual(BALANCE.terrain); // terrain scales at charge time, not here
    expect(b.golfers).toEqual(BALANCE.golfers);
  });

  it("resolver memoizes derived profiles", () => {
    expect(getEffectiveBalance("hard")).toBe(getEffectiveBalance("hard"));
  });
});

describe("terrain cost scaling", () => {
  it("scales build and salvage together; identity at mult 1", () => {
    const base = computeTerrainChangeCost("rough", "fairway");
    const easy = computeTerrainChangeCost("rough", "fairway", terrainCostMult("easy"));
    const hard = computeTerrainChangeCost("rough", "fairway", terrainCostMult("hard"));
    expect(computeTerrainChangeCost("rough", "fairway", 1)).toEqual(base);
    expect(easy.net).toBeCloseTo(base.net * DIFFICULTY_PROFILES.easy.terrainCostMult);
    expect(hard.net).toBeCloseTo(base.net * DIFFICULTY_PROFILES.hard.terrainCostMult);
    // Refund ratio difficulty-neutral
    const refundBase = computeTerrainChangeCost("fairway", "rough");
    const refundHard = computeTerrainChangeCost("fairway", "rough", terrainCostMult("hard"));
    expect(refundHard.refunded / refundBase.refunded).toBeCloseTo(
      DIFFICULTY_PROFILES.hard.terrainCostMult
    );
    expect(computeElevationChangeCost(3, 1.15).net).toBeCloseTo(3 * ELEVATION_COST_PER_STEP * 1.15);
  });
});

describe("sim under difficulty", () => {
  it("normal tickWeek is unchanged (regression: same result with/without field)", () => {
    const legacyWorld = { ...DEFAULT_WORLD };
    delete (legacyWorld as Partial<typeof legacyWorld>).difficulty;
    const a = tickWeek({ ...DEFAULT_COURSE }, legacyWorld, 42);
    const b = tickWeek({ ...DEFAULT_COURSE }, { ...DEFAULT_WORLD, difficulty: "normal" }, 42);
    expect(a.result).toEqual(b.result);
    expect(a.world.cash).toBe(b.world.cash);
  });

  it("demand curves separate by difficulty on a playable course", { timeout: 40_000 }, () => {
    // 9 valid fairway holes on separate rows → the course clears the
    // playability gate and demand-side multipliers become observable.
    const width = 60;
    const height = 40;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway" as Terrain);
    const set = (x: number, y: number, t: Terrain) => {
      tiles[y * width + x] = t;
    };
    const holes = Array.from({ length: 9 }, (_, i) => {
      const y = 2 + i * 4;
      set(4, y, "tee");
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) set(50 + dx, y + dy, "green");
      return { tee: { x: 4, y }, green: { x: 50, y }, parMode: "AUTO" as const };
    });
    const course = { ...DEFAULT_COURSE, width, height, tiles, holes, elevations: new Array(width * height).fill(0), condition: 0.8 };

    const visitors = (difficulty: "easy" | "normal" | "hard") =>
      demandBreakdown(course, { ...DEFAULT_WORLD, reputation: 60, difficulty }).segments!
        .totalBaseVisitors;
    expect(visitors("easy")).toBeGreaterThan(visitors("normal"));
    expect(visitors("hard")).toBeLessThan(visitors("normal"));
  });

  it("createNewGame scales starting cash by difficulty (override still wins)", () => {
    const base: GameSetup = {
      mode: "challenge",
      courseName: "T",
      seed: 7,
      theme: "parkland",
      difficulty: "easy",
    };
    expect(createNewGame(base).world.cash).toBe(
      Math.round(DEFAULT_WORLD.cash * DIFFICULTY_PROFILES.easy.startingCashMult)
    );
    expect(createNewGame({ ...base, difficulty: "hard" }).world.cash).toBe(
      Math.round(DEFAULT_WORLD.cash * DIFFICULTY_PROFILES.hard.startingCashMult)
    );
    expect(createNewGame({ ...base, difficulty: "normal" }).world.cash).toBe(DEFAULT_WORLD.cash);
    expect(
      createNewGame({
        ...base,
        mode: "sandbox",
        difficulty: "hard",
        sandboxOverrides: { startingCash: 90_000 },
      }).world.cash
    ).toBe(90_000);
  });
});
