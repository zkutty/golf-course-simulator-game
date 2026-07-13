import type { Difficulty } from "../models/types";
import { BALANCE } from "./balanceConfig";

// Difficulty (ZKU-165): a principled multiplier layer over the ONE balance
// source. Normal is the identity — getEffectiveBalance("normal") returns the
// BALANCE object itself, bit-identical to today's tuning.

export interface DifficultyProfile {
  key: Difficulty;
  label: string;
  /** New-run starting cash multiplier (explicit sandbox override wins). */
  startingCashMult: number;
  /** Terrain build/salvage + earthworks multiplier, applied at charge time. */
  terrainCostMult: number;
  /** Weekly demand / live tee-sheet volume multiplier. */
  demandMult: number;
  /** Golfer patience multiplier (personality roll, M3 knobs). */
  patienceMult: number;
  /** Golfer spend-propensity multiplier (M4 concessions hook). */
  spendMult: number;
  /** Loan APR multiplier (bridge + expansion). */
  loanAprMult: number;
  /** Extra weeks added to the bridge-loan cooldown (availability screw). */
  bridgeCooldownWeeksAdd: number;
  /** Condition decay-rate multiplier (wear cap + wear accumulation). */
  wearMult: number;
  /** Reputation gain multiplier (recovery side of the asymmetry). */
  repGainMult: number;
  /** Reputation loss multiplier (decline side of the asymmetry). */
  repLossMult: number;
}

const IDENTITY: Omit<DifficultyProfile, "key" | "label"> = {
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
};

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    key: "easy",
    label: "Easy",
    startingCashMult: 1.4,
    terrainCostMult: 0.85,
    demandMult: 1.12,
    patienceMult: 1.2,
    spendMult: 1.15,
    loanAprMult: 0.8,
    bridgeCooldownWeeksAdd: 0,
    wearMult: 0.75,
    repGainMult: 1.2,
    repLossMult: 0.85,
  },
  normal: { key: "normal", label: "Normal", ...IDENTITY },
  hard: {
    key: "hard",
    label: "Hard",
    startingCashMult: 0.7,
    terrainCostMult: 1.15,
    demandMult: 0.92,
    patienceMult: 0.85,
    spendMult: 0.9,
    loanAprMult: 1.25,
    bridgeCooldownWeeksAdd: 4,
    wearMult: 1.35,
    repGainMult: 0.85,
    repLossMult: 1.2,
  },
};

export function getDifficultyProfile(difficulty: Difficulty | undefined): DifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty ?? "normal"];
}

/** Terrain cost multiplier for the run — the reducer/editor charge scaler. */
export function terrainCostMult(difficulty: Difficulty | undefined): number {
  return getDifficultyProfile(difficulty).terrainCostMult;
}

export type EffectiveBalance = typeof BALANCE;

const cache = new Map<Difficulty, EffectiveBalance>();

/**
 * Resolve the balance config for a difficulty. Normal returns BALANCE itself
 * (identity — current tests and tuning are untouched). Easy/Hard return a
 * memoized derived copy with the profile's multipliers applied to demand,
 * wear, reputation asymmetry, and loan terms. Terrain costs are NOT scaled
 * here — they apply at charge time via terrainCostMult so module-level cost
 * tables stay single-sourced.
 */
export function getEffectiveBalance(difficulty: Difficulty | undefined): EffectiveBalance {
  const d = difficulty ?? "normal";
  if (d === "normal") return BALANCE;
  const hit = cache.get(d);
  if (hit) return hit;

  const p = DIFFICULTY_PROFILES[d];
  // Deep-widen BALANCE's `as const` literal types to plain numbers for the
  // scaled copy; consumers only ever treat these as numbers, so casting the
  // result back to EffectiveBalance is safe.
  const b = structuredClone(BALANCE) as unknown as DeepWiden<typeof BALANCE>;

  b.visitors.baseFloor = Math.round(BALANCE.visitors.baseFloor * p.demandMult);
  b.visitors.scale = Math.round(BALANCE.visitors.scale * p.demandMult);

  b.condition.wearCap = BALANCE.condition.wearCap * p.wearMult;
  b.condition.wearDivisor = BALANCE.condition.wearDivisor / p.wearMult;
  b.requiredMaintenance.wearShortfallMult =
    BALANCE.requiredMaintenance.wearShortfallMult * p.wearMult;

  b.reputation.recoveryMult = BALANCE.reputation.recoveryMult * p.repGainMult;
  b.reputation.declineMult = BALANCE.reputation.declineMult * p.repLossMult;

  b.loans.bridge.apr = BALANCE.loans.bridge.apr * p.loanAprMult;
  b.loans.expansion.apr = BALANCE.loans.expansion.apr * p.loanAprMult;
  b.loans.bridgeCooldownWeeks = BALANCE.loans.bridgeCooldownWeeks + p.bridgeCooldownWeeksAdd;

  const effective = b as unknown as EffectiveBalance;
  cache.set(d, effective);
  return effective;
}

type DeepWiden<T> = T extends number
  ? number
  : T extends string
    ? string
    : T extends boolean
      ? boolean
      : T extends readonly (infer E)[]
        ? DeepWiden<E>[]
        : { -readonly [K in keyof T]: DeepWiden<T[K]> };
