/**
 * @deprecated Compatibility facade for pre-v29 callers and authored content.
 * New code must import the independent-axis API from `experience.ts`.
 */
import type { Difficulty, EconomicPressure } from "../models/types";
import {
  ECONOMIC_PRESSURES,
  LEGACY_DIFFICULTY_AXES,
  getEconomicPressure,
  getEffectiveBalance as getPressureBalance,
  terrainCostMult as pressureTerrainCostMult,
  type EconomicPressureDefinition,
  type EffectiveBalance,
} from "./experience";

export type DifficultyProfile = Omit<EconomicPressureDefinition, "key" | "label"> & {
  key: Difficulty;
  label: "Easy" | "Normal" | "Hard";
};

function asPressure(value: Difficulty | EconomicPressure | undefined): EconomicPressure {
  if (value === "easy" || value === "normal" || value === "hard") {
    return LEGACY_DIFFICULTY_AXES[value].economicPressure;
  }
  return value ?? "balanced";
}

function compatibilityProfile(
  key: Difficulty,
  label: DifficultyProfile["label"],
  pressure: EconomicPressure,
): DifficultyProfile {
  const { key: _pressureKey, label: _pressureLabel, ...definition } = ECONOMIC_PRESSURES[pressure];
  void _pressureKey;
  void _pressureLabel;
  return { key, label, ...definition };
}

/** Derived legacy view; all values still originate in ECONOMIC_PRESSURES. */
export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: compatibilityProfile("easy", "Easy", "friendly"),
  normal: compatibilityProfile("normal", "Normal", "balanced"),
  hard: compatibilityProfile("hard", "Hard", "tight"),
};

export function getDifficultyProfile(value: Difficulty | undefined): DifficultyProfile;
export function getDifficultyProfile(value: EconomicPressure): EconomicPressureDefinition;
export function getDifficultyProfile(value: Difficulty | EconomicPressure | undefined): DifficultyProfile | EconomicPressureDefinition {
  if (value == null) return DIFFICULTY_PROFILES.normal;
  if (value === "easy" || value === "normal" || value === "hard") return DIFFICULTY_PROFILES[value];
  return getEconomicPressure(value);
}

export function terrainCostMult(value: Difficulty | EconomicPressure | undefined): number {
  return pressureTerrainCostMult(asPressure(value));
}

export function getEffectiveBalance(value: Difficulty | EconomicPressure | undefined): EffectiveBalance {
  return getPressureBalance(asPressure(value));
}

export type { EffectiveBalance } from "./experience";
