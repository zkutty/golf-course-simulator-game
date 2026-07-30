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

  architecture: {
    // Architectural judgment informs demand without becoming an opening gate.
    // A 0/100 report can move demand by at most -/+ this fraction.
    demandEffectMax: 0.08,
    qualityBlend: 0.15,
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
    perAdditionalOperatingCourseStaff: 220,
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

  paceOperations: {
    /** A neutral prior prevents one unusual day from redefining course identity. */
    identityPriorDays: 4,
    identityRecentWeight: 1.6,
    repeatIntentMatchWeight: 0.12,
    historyDays: 28,
    abandonmentWaitMinutes: 60,
    abandonmentMood: 0.25,
    overtimePremium: 1.5,
    staffHoursPerWeek: 40,
    marshalPickupCreditRate: 0.15,
    daylightLateRefundRate: 0.5,
    daylightEarlyRefundRate: 1,
    congestionCreditRate: 0.4,
    goodwillVoucherRate: 0.2,
    bottleneckMinimumMinutes: 2,
    bottleneckSevereMinutes: 8,
    maxDurationSamplesPerDay: 160,
  },

  // M51 group mobility, fleet, and bounded operating evidence.
  mobility: {
    pushcartDefaultPrice: 9,
    dailyHistoryDays: 28,
    weeklyHistoryWeeks: 28,
    maxProducts: 72,
    maxFleetUnits: 360,
    maxHistoryTransactions: 360,
    maxObservedEvidence: 360,
    maxLiveSelections: 180,
    maxLiveAssignments: 180,
    maxLiveTransactions: 360,
    maxLiveEvidence: 360,
    maxCourseAggregates: 36,
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
    perDevelopedTile: 0.12,
    perAdditionalOperatingCourse: 180,
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
    // Live model (ZKU-116): reputation is pulled by the net-promoter balance of
    // real finished rounds. This scales how far a full day of promoters (or
    // detractors) can move reputation.
    npsGain: 2.2,
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

  golfers: {
    // Deterministic, tunable golfer profiles for shot-based routing/grading.
    // Note: yardsPerTile here is the default yard model for the solver; the course also has yardsPerTile.
    scratch: {
      yardsPerTile: 10,
      ratingMultipliers: { hazard: 1.0, rough: 0.8, deepRough: 1.0, obstacle: 1.0 },
      clubs: [
        { name: "Driver", carryYards: 280, dispersionTilesBase: 3.5 },
        { name: "3W", carryYards: 250, dispersionTilesBase: 3.0 },
        { name: "5I", carryYards: 200, dispersionTilesBase: 2.4 },
        { name: "7I", carryYards: 170, dispersionTilesBase: 2.0 },
        { name: "PW", carryYards: 135, dispersionTilesBase: 1.5 },
      ],
    },
    bogey: {
      yardsPerTile: 10,
      ratingMultipliers: { hazard: 1.5, rough: 1.4, deepRough: 1.8, obstacle: 1.3 },
      clubs: [
        { name: "Driver", carryYards: 220, dispersionTilesBase: 4.2 },
        { name: "3W", carryYards: 200, dispersionTilesBase: 3.7 },
        { name: "5I", carryYards: 160, dispersionTilesBase: 3.1 },
        { name: "7I", carryYards: 140, dispersionTilesBase: 2.6 },
        { name: "PW", carryYards: 110, dispersionTilesBase: 2.1 },
      ],
    },
  },

  elevation: {
    // Uphill shots play longer: yards added per elevation step of rise
    // (negative rise plays shorter). Standard golf heuristic ~2-3 yd/step.
    shotYardsPerStep: 2.5,
    // Extra walking cost per 1-step slope crossed; 2+ step cliffs are
    // impassable on foot (matches the sculpting terracing constraint).
    walkSlopeCost: 0.8,
  },
  courseSetup: {
    pinDifficulty: {
      edgeRadiusTiles: 4,
      edgePenaltyMax: 0.38,
      adjacentHazardPenalty: 0.14,
      elevationPenaltyPerStep: 0.055,
      penaltyCap: 0.75,
      bogeySensitivity: 1.35,
    },
    ratingBands: { lowSlope: 90, averageSlope: 113, highSlope: 130 },
  },
  shots: {
    utilizationThreshold: 0.9, // beyond this, dispersion ramps up
    dispersionRamp: 2.2, // multiplier slope vs utilization over threshold
    water: {
      carryBufferYards: 10,
      maxExpectedShotsToGreen: 6,
      // Short-miss logic (lands along shot line)
      shortMissUtilStart: 0.92,
      shortMissMaxProb: 0.22,
      waterPenaltyStrokes: 2.6, // landing in water is brutal
    },
    hole: {
      minHoleDistanceYards: 90,
      reachableInTwoThreshold: 2.3,
    },
    landing: {
      // Terrain penalties (expected strokes added when landing there)
      penaltyStrokes: {
        water: 2.6,
        sand: 0.6,
        waste_area: 0.42,
        wetland: 2.6,
        deep_rough: 0.85,
        rough: 0.2,
        fairway: 0,
        green: 0,
        tee: 0,
        path: 0,
      },
      // Sampling: higher values are more accurate but slower (grid is small, so modest is fine)
      maxRadiusTiles: 6,
    },
  },

  // Land-theme gameplay flavor (ZKU-166) — data only, no new mechanics.
  // Parkland is the neutral identity theme.
  themes: {
    parkland: { waterBuildCostMult: 1, deepRoughPenaltyMult: 1 },
    links: { waterBuildCostMult: 1, deepRoughPenaltyMult: 1.15 },
    desert: { waterBuildCostMult: 1.5, deepRoughPenaltyMult: 1 },
  },

  // Terrain economics
  terrain: {
    buildCost: {
      rough: 10,
      deep_rough: 25,
      fairway: 120,
      green: 300,
      sand: 80,
      waste_area: 45,
      water: 200,
      wetland: 110,
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
      waste_area: 12,
      water: 10, // 200 build → 5% (minimal salvage)
      wetland: 8,
      tee: 45, // 150 build → 30%
      path: 12, // 40 build → 30%
    } satisfies Record<Terrain, number>,
    // Sculpting: cost per tile per elevation step, charged for raising AND
    // lowering (earthworks are never refunded).
    earthworkCostPerStep: 60,
    maintWeight: {
      rough: 0.3,
      deep_rough: 0.6,
      fairway: 1.0,
      green: 2.5,
      sand: 1.2,
      waste_area: 0.25,
      water: 0.6,
      wetland: 0.35,
      tee: 1.0,
      path: 0.4,
    } satisfies Record<Terrain, number>,
    walkingCost: {
      fairway: 1, path: 1.2, tee: 1.2, green: 1.4, rough: 2.2,
      waste_area: 2.45, sand: 2.8, deep_rough: 3.4, water: Infinity, wetland: Infinity,
    } satisfies Record<Terrain, number>,
    rolloutTiles: {
      fairway: 1.6, path: 1.6, tee: 1.6, green: 0.5, rough: 0.35,
      deep_rough: 0.35, sand: 0.12, waste_area: 0.85, water: 0, wetland: 0,
    } satisfies Record<Terrain, number>,
    aestheticWeight: {
      fairway: 1, rough: 0.45, deep_rough: 0.7, sand: 1.1, waste_area: 0.75,
      water: 1.4, wetland: 1.2, green: 1.25, tee: 0.8, path: 0.35,
    } satisfies Record<Terrain, number>,
  },
} as const;
