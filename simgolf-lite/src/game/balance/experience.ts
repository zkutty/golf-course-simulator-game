import type {
  Difficulty,
  EconomicPressure,
  ExperienceProfile,
  World,
} from "../models/types";
import { BALANCE } from "./balanceConfig";

export type ExperienceWorkspace = "design" | "operate" | "legacy";
export type TutorialModule =
  | "course-basics"
  | "operations"
  | "player-pro"
  | "advanced-design"
  | "enterprise"
  | "legacy";
export type FailurePolicy = "guided-recovery" | "standard" | "strict";

export interface ExperienceProfileDefinition {
  key: ExperienceProfile;
  label: string;
  description: string;
  defaultEconomicPressure: EconomicPressure;
  failurePolicy: FailurePolicy;
  visibleWorkspaces: readonly ExperienceWorkspace[];
  tutorialModules: readonly TutorialModule[];
  automationDefaults: {
    enabled: boolean;
    preset: "stewardship" | "balanced" | "growth";
    showAdvancedOperations: boolean;
  };
}

export interface EconomicPressureDefinition {
  key: EconomicPressure;
  label: string;
  description: string;
  /** New-run starting cash multiplier (explicit sandbox override wins). */
  startingCashMult: number;
  /** Terrain build/salvage + earthworks multiplier, applied at charge time. */
  terrainCostMult: number;
  /** Weekly demand / live tee-sheet volume multiplier. */
  demandMult: number;
  /** Golfer patience multiplier (personality roll). */
  patienceMult: number;
  /** Golfer spend-propensity multiplier. */
  spendMult: number;
  /** Loan APR multiplier (bridge + expansion). */
  loanAprMult: number;
  /** Extra weeks added to the bridge-loan cooldown. */
  bridgeCooldownWeeksAdd: number;
  /** Condition decay-rate multiplier. */
  wearMult: number;
  /** Reputation gain multiplier. */
  repGainMult: number;
  /** Reputation loss multiplier. */
  repLossMult: number;
}

const ALL_WORKSPACES = ["design", "operate", "legacy"] as const;
const ALL_TUTORIALS = [
  "course-basics",
  "operations",
  "player-pro",
  "advanced-design",
  "enterprise",
  "legacy",
] as const;

/** One authoritative catalog for player-facing experience policy. */
export const EXPERIENCE_PROFILES: Record<ExperienceProfile, ExperienceProfileDefinition> = {
  relaxed: {
    key: "relaxed",
    label: "Relaxed",
    description: "Guided course building with a smaller initial workspace and protective recovery defaults.",
    defaultEconomicPressure: "friendly",
    failurePolicy: "guided-recovery",
    visibleWorkspaces: ["design", "operate"],
    tutorialModules: ["course-basics", "operations", "player-pro"],
    automationDefaults: { enabled: true, preset: "stewardship", showAdvancedOperations: false },
  },
  classic: {
    key: "classic",
    label: "Classic",
    description: "The complete CourseCraft ruleset with the established presentation and neutral assistance policy.",
    defaultEconomicPressure: "balanced",
    failurePolicy: "standard",
    visibleWorkspaces: ALL_WORKSPACES,
    tutorialModules: ALL_TUTORIALS,
    automationDefaults: { enabled: true, preset: "balanced", showAdvancedOperations: false },
  },
  simulation: {
    key: "simulation",
    label: "Simulation",
    description: "All systems visible, advanced operations exposed, and failures resolved without protective intervention.",
    defaultEconomicPressure: "balanced",
    failurePolicy: "strict",
    visibleWorkspaces: ALL_WORKSPACES,
    tutorialModules: ["course-basics", "advanced-design", "operations", "enterprise", "player-pro", "legacy"],
    automationDefaults: { enabled: false, preset: "balanced", showAdvancedOperations: true },
  },
};

const IDENTITY: Omit<EconomicPressureDefinition, "key" | "label" | "description"> = {
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

/** The only multiplier catalog. Experience profiles never participate here. */
export const ECONOMIC_PRESSURES: Record<EconomicPressure, EconomicPressureDefinition> = {
  friendly: {
    key: "friendly",
    label: "Friendly",
    description: "More forgiving demand, costs, credit, wear, and reputation recovery.",
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
  balanced: {
    key: "balanced",
    label: "Balanced",
    description: "The established economy with no multipliers or retuning.",
    ...IDENTITY,
  },
  tight: {
    key: "tight",
    label: "Tight",
    description: "Less forgiving demand, costs, credit, wear, and reputation recovery.",
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

export const LEGACY_DIFFICULTY_AXES: Record<Difficulty, {
  experienceProfile: ExperienceProfile;
  economicPressure: EconomicPressure;
}> = {
  easy: { experienceProfile: "relaxed", economicPressure: "friendly" },
  normal: { experienceProfile: "classic", economicPressure: "balanced" },
  hard: { experienceProfile: "simulation", economicPressure: "tight" },
};

export function isExperienceProfile(value: unknown): value is ExperienceProfile {
  return value === "relaxed" || value === "classic" || value === "simulation";
}

export function isEconomicPressure(value: unknown): value is EconomicPressure {
  return value === "friendly" || value === "balanced" || value === "tight";
}

export function isLegacyDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

export function normalizeExperienceAxes(value: {
  experienceProfile?: unknown;
  economicPressure?: unknown;
  difficulty?: unknown;
} | null | undefined): {
  experienceProfile: ExperienceProfile;
  economicPressure: EconomicPressure;
} {
  const legacy = isLegacyDifficulty(value?.difficulty)
    ? LEGACY_DIFFICULTY_AXES[value.difficulty]
    : LEGACY_DIFFICULTY_AXES.normal;
  const experienceProfile = isExperienceProfile(value?.experienceProfile)
    ? value.experienceProfile
    : legacy.experienceProfile;
  const economicPressure = isEconomicPressure(value?.economicPressure)
    ? value.economicPressure
    : isExperienceProfile(value?.experienceProfile) && !isLegacyDifficulty(value?.difficulty)
      ? EXPERIENCE_PROFILES[experienceProfile].defaultEconomicPressure
      : legacy.economicPressure;
  return { experienceProfile, economicPressure };
}

export function economicPressureForWorld(world: Pick<World, "economicPressure" | "difficulty">): EconomicPressure {
  return normalizeExperienceAxes(world).economicPressure;
}

export function getExperienceProfile(profile: ExperienceProfile | undefined): ExperienceProfileDefinition {
  return EXPERIENCE_PROFILES[profile ?? "classic"];
}

export function getEconomicPressure(pressure: EconomicPressure | undefined): EconomicPressureDefinition {
  return ECONOMIC_PRESSURES[pressure ?? "balanced"];
}

/** Terrain cost multiplier for the run — the reducer/editor charge scaler. */
export function terrainCostMult(pressure: EconomicPressure | undefined): number {
  return getEconomicPressure(pressure).terrainCostMult;
}

export type EffectiveBalance = typeof BALANCE;
const balanceCache = new Map<EconomicPressure, EffectiveBalance>();

/** Balanced returns the exact BALANCE object; friendly/tight are memoized copies. */
export function getEffectiveBalance(pressure: EconomicPressure | undefined): EffectiveBalance {
  const key = pressure ?? "balanced";
  if (key === "balanced") return BALANCE;
  const hit = balanceCache.get(key);
  if (hit) return hit;
  const p = ECONOMIC_PRESSURES[key];
  const b = structuredClone(BALANCE) as unknown as DeepWiden<typeof BALANCE>;
  b.visitors.baseFloor = Math.round(BALANCE.visitors.baseFloor * p.demandMult);
  b.visitors.scale = Math.round(BALANCE.visitors.scale * p.demandMult);
  b.condition.wearCap = BALANCE.condition.wearCap * p.wearMult;
  b.condition.wearDivisor = BALANCE.condition.wearDivisor / p.wearMult;
  b.requiredMaintenance.wearShortfallMult = BALANCE.requiredMaintenance.wearShortfallMult * p.wearMult;
  b.reputation.recoveryMult = BALANCE.reputation.recoveryMult * p.repGainMult;
  b.reputation.declineMult = BALANCE.reputation.declineMult * p.repLossMult;
  b.loans.bridge.apr = BALANCE.loans.bridge.apr * p.loanAprMult;
  b.loans.expansion.apr = BALANCE.loans.expansion.apr * p.loanAprMult;
  b.loans.bridgeCooldownWeeks = BALANCE.loans.bridgeCooldownWeeks + p.bridgeCooldownWeeksAdd;
  const effective = b as unknown as EffectiveBalance;
  balanceCache.set(key, effective);
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
