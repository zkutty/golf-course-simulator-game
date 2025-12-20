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

  pricing: {
    marketPrice: 80,
    highPriceHardness: 2.2, // exponent for above-market penalty
    repPremiumThreshold: 85,
    repDiscountThreshold: 70,
    lowRepPriceMult: 1.55, // harsher above-market penalty when rep < threshold
    highRepPriceMult: 0.85, // slightly softer above-market penalty when rep > threshold
  },

  capacity: {
    roundsPerPlayableHolePerWeek: 300,
    soldOutRepBonus: 1,
    soldOutSatMin: 75,
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

  // Variable costs that scale with rounds / revenue (main margin control)
  variableCosts: {
    laborPerRoundBase: 8,
    laborPerRoundStaffBonusPerLevel: 0.45, // reduces labor per round a bit
    laborPerRoundMin: 5.5,
    consumablesPerRound: 1.5,
    merchantFeeRate: 0.03, // fraction of revenue
  },

  // Condition wear & recovery
  condition: {
    wearCap: 0.06,
    wearDivisor: 20_000,
    maintEffectCap: 0.08,
    maintEffectDivisor: 20_000,
  },

  // Required maintenance model
  requiredMaintenance: {
    base: 400,
    perVisitorK: 0.08,
    // If budget < required, add extra wear and reputation penalty
    wearShortfallMult: 0.06, // extra wear (0..this) at 100% shortfall
    repPenaltyPer1000: 0.6, // up to ~-2 via rep cap
    // If budget > required, only a fraction of the excess counts for recovery
    excessEffectiveness: 0.25,
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

  tax: {
    enabled: true,
    profitTaxRate: 0.25, // applied only when profit > 0
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


