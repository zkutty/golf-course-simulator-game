import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { createNewGame } from "../gen/newGame";
import { tickWeek } from "../sim/tickWeek";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult, payloadForPersistence } from "../../utils/save";
import { hashGameState } from "../../utils/stateHash";
import { BALANCE } from "./balanceConfig";
import {
  ECONOMIC_PRESSURES,
  EXPERIENCE_PROFILES,
  LEGACY_DIFFICULTY_AXES,
  getEffectiveBalance,
  normalizeExperienceAxes,
  startingCapitalForAxes,
} from "./experience";
import type { Difficulty, EconomicPressure, ExperienceProfile, World } from "../models/types";

const setup = (experienceProfile: ExperienceProfile, economicPressure: EconomicPressure) => ({
  mode: "sandbox" as const,
  courseName: "Independent Axes",
  seed: 683_029,
  theme: "parkland" as const,
  experienceProfile,
  economicPressure,
});

describe("ZK-683 independent experience axes", () => {
  it("publishes complete centralized policy catalogs without economic multipliers on profiles", () => {
    expect(Object.keys(EXPERIENCE_PROFILES)).toEqual(["relaxed", "classic", "simulation"]);
    expect(Object.keys(ECONOMIC_PRESSURES)).toEqual(["friendly", "balanced", "tight"]);
    for (const profile of Object.values(EXPERIENCE_PROFILES)) {
      expect(profile.description.length).toBeGreaterThan(20);
      expect(profile.visibleWorkspaces.length).toBeGreaterThan(0);
      expect(profile.tutorialModules.length).toBeGreaterThan(0);
      expect(profile.automationDefaults.preset).toMatch(/^(stewardship|balanced|growth)$/);
      expect(Object.keys(profile).some((key) => key.endsWith("Mult"))).toBe(false);
    }
    expect(EXPERIENCE_PROFILES.relaxed.defaultEconomicPressure).toBe("friendly");
    expect(EXPERIENCE_PROFILES.classic.defaultEconomicPressure).toBe("balanced");
    expect(EXPERIENCE_PROFILES.simulation.defaultEconomicPressure).toBe("balanced");
  });

  it("keeps Balanced byte-for-byte identical and pressure owns every historical multiplier", () => {
    expect(getEffectiveBalance("balanced")).toBe(BALANCE);
    expect(ECONOMIC_PRESSURES.balanced).toMatchObject({
      startingCashMult: 1,
      terrainCostMult: 1,
      demandMult: 1,
      patienceMult: 1,
      spendMult: 1,
      loanAprMult: 1,
      bridgeCooldownWeeksAdd: 0,
      wearMult: 1,
      repGainMult: 1,
      repLossMult: 1,
    });
  });

  it("uses explicit new-run capital for legacy pairs and every independent axis combination", () => {
    expect(startingCapitalForAxes({ difficulty: "easy" })).toBe(200_000);
    expect(startingCapitalForAxes({ difficulty: "normal" })).toBe(100_000);
    expect(startingCapitalForAxes({ difficulty: "hard" })).toBe(85_000);
    // Presentation/complexity does not silently alter the economy. Pressure
    // is the financial axis even when a caller chooses axes independently.
    expect(startingCapitalForAxes({ experienceProfile: "simulation", economicPressure: "balanced" })).toBe(100_000);
    expect(startingCapitalForAxes({ experienceProfile: "relaxed", economicPressure: "tight" })).toBe(85_000);
  });

  it("maps every legacy difficulty losslessly and respects explicit independent axes", () => {
    const expected: Record<Difficulty, [ExperienceProfile, EconomicPressure]> = {
      easy: ["relaxed", "friendly"],
      normal: ["classic", "balanced"],
      hard: ["simulation", "tight"],
    };
    for (const difficulty of Object.keys(expected) as Difficulty[]) {
      const axes = normalizeExperienceAxes({ difficulty });
      expect(axes).toEqual({
        experienceProfile: expected[difficulty][0],
        economicPressure: expected[difficulty][1],
      });
      expect(LEGACY_DIFFICULTY_AXES[difficulty]).toEqual(axes);
    }
    expect(normalizeExperienceAxes({ experienceProfile: "simulation", economicPressure: "friendly" }))
      .toEqual({ experienceProfile: "simulation", economicPressure: "friendly" });
  });

  it("round-trips all profile/pressure combinations through current browser/native payloads", () => {
    for (const experienceProfile of Object.keys(EXPERIENCE_PROFILES) as ExperienceProfile[]) {
      for (const economicPressure of Object.keys(ECONOMIC_PRESSURES) as EconomicPressure[]) {
        const run = createNewGame(setup(experienceProfile, economicPressure));
        const persisted = payloadForPersistence(run);
        expect(persisted.world.difficulty).toBeUndefined();
        const loaded = normalizeLoadedSaveResult({
          schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
          savedAt: 683,
          ...persisted,
        });
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) continue;
        expect(loaded.payload.world).toMatchObject({ experienceProfile, economicPressure });
        expect(loaded.payload.world.difficulty).toBeUndefined();
      }
    }
  });

  it("migrates v28 without changing any normalized state beyond replacing difficulty", () => {
    const baseRun = createNewGame(setup("classic", "balanced"));
    const { experienceProfile: _profile, economicPressure: _pressure, ...legacyBase } = structuredClone(baseRun.world);
    void _profile;
    void _pressure;
    const common = { ...legacyBase, cash: 68_300, founderName: "Migration Proof" };
    const legacy = normalizeLoadedSaveResult({
      schemaVersion: 28,
      savedAt: 28,
      course: structuredClone(baseRun.course),
      world: { ...common, difficulty: "hard" },
    });
    const current = normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 29,
      course: structuredClone(baseRun.course),
      world: { ...common, experienceProfile: "simulation", economicPressure: "tight" },
    });
    expect(legacy.ok).toBe(true);
    expect(current.ok).toBe(true);
    if (!legacy.ok || !current.ok) return;
    expect(legacy.migratedFrom).toBe(28);
    expect(legacy.payload).toEqual(current.payload);
    expect(legacy.payload.world.cash).toBe(68_300);
  });

  it("keeps same-seed actions deterministic and profiles economically inert", () => {
    const relaxed = createNewGame(setup("relaxed", "balanced"));
    const simulation = createNewGame(setup("simulation", "balanced"));
    expect(relaxed.course).toEqual(simulation.course);
    expect(relaxed.world.cash).toBe(simulation.world.cash);
    const relaxedWeek = tickWeek(relaxed.course, relaxed.world, 683);
    const simulationWeek = tickWeek(simulation.course, simulation.world, 683);
    expect(relaxedWeek.result).toEqual(simulationWeek.result);
    expect(relaxedWeek.world.cash).toBe(simulationWeek.world.cash);
    expect(relaxedWeek.course).toEqual(simulationWeek.course);

    const friendly = createNewGame(setup("simulation", "friendly"));
    const tight = createNewGame(setup("simulation", "tight"));
    expect(friendly.course).toEqual(tight.course);
    expect(friendly.world.experienceProfile).toBe(tight.world.experienceProfile);
    expect(friendly.world.cash).not.toBe(tight.world.cash);
  });

  it("canonicalizes equivalent legacy/current axes but distinguishes real axis changes", () => {
    const { experienceProfile: _profile, economicPressure: _pressure, ...legacyBase } = structuredClone(DEFAULT_WORLD);
    void _profile;
    void _pressure;
    const legacyWorld: World = { ...legacyBase, difficulty: "hard" };
    const currentWorld: World = { ...legacyBase, experienceProfile: "simulation", economicPressure: "tight" };
    expect(hashGameState({ course: DEFAULT_COURSE, world: legacyWorld }))
      .toBe(hashGameState({ course: DEFAULT_COURSE, world: currentWorld }));
    expect(hashGameState({ course: DEFAULT_COURSE, world: currentWorld }))
      .not.toBe(hashGameState({ course: DEFAULT_COURSE, world: { ...currentWorld, economicPressure: "friendly" } }));
    expect(hashGameState({ course: DEFAULT_COURSE, world: currentWorld }))
      .not.toBe(hashGameState({ course: DEFAULT_COURSE, world: { ...currentWorld, experienceProfile: "classic" } }));
  });
});
