import type { Terrain } from "../models/types";

export const BALANCE = {
  // Visitors
  visitors: {
    baseFloor: 120,
    scale: 520,
    noiseMin: -40,
    noiseMax: 40,
    testingRoundsMax: 10,
    testingRoundFee: 5,
  },

  // Course validity gate
  coursePlayable: {
    minValidHoles: 9,
    minAvgPlayability: 40,
    minCondition: 0.4,
  },

  // Fixed weekly overhead (always applies)
  overhead: {
    insurance: 140,
    utilities: 110,
    admin: 170,
    baseStaff: 280,
  },

  // Variable operating costs
  ops: {
    staffCostPerLevel: 450,
    marketingCostPerLevel: 300,
  },

  // Condition wear & recovery
  condition: {
    wearCap: 0.06,
    wearDivisor: 20_000,
    maintEffectCap: 0.08,
    maintEffectDivisor: 20_000,
  },

  // Reputation dynamics
  reputation: {
    satPivot: 60,
    satDivisor: 10,
    recoveryMult: 0.55,
    declineMult: 1.05,
    capPerWeek: 2,
    demandPenaltyThreshold: 30,
    demandPenaltyMult: 0.85,
    demandBonusThreshold: 70,
    demandBonusMult: 1.08,
    missedLoanPaymentPenalty: -2,
  },

  // Distress / bankruptcy
  distress: {
    weeksToBankrupt: 2,
    liquidityTrapCash: -10_000,
  },

  // Loans
  loans: {
    aprMax: 0.30,
    aprMissedPaymentBump: 0.01,
    bridgeCooldownWeeks: 8,
    bridge: {
      maxPrincipal: 25_000,
      apr: 0.18,
      termWeeks: 26,
      repMin: 15,
      minValidHolesAlt: 6,
    },
    expansion: {
      maxPrincipal: 150_000,
      apr: 0.12,
      termWeeks: 104,
      repMin: 50,
      minValidHoles: 9,
    },
  },

  // Terrain economics
  terrain: {
    buildCost: {
      rough: 10,
      deep_rough: 25,
      fairway: 120,
      green: 300,
      sand: 80,
      water: 200,
      tee: 150,
      path: 40,
    } satisfies Record<Terrain, number>,
    salvageValue: {
      rough: 0,
      // Most construction cost is unrecoverable; refunds are intentionally low (20–40% max)
      deep_rough: 6, // 25 build → 24%
      fairway: 36, // 120 build → 30%
      green: 20, // 300 build → ~7% (minimal salvage)
      sand: 24, // 80 build → 30%
      water: 10, // 200 build → 5% (minimal salvage)
      tee: 45, // 150 build → 30%
      path: 12, // 40 build → 30%
    } satisfies Record<Terrain, number>,
    maintWeight: {
      rough: 0.3,
      deep_rough: 0.6,
      fairway: 1.0,
      green: 2.5,
      sand: 1.2,
      water: 0.6,
      tee: 1.0,
      path: 0.4,
    } satisfies Record<Terrain, number>,
  },
} as const;


