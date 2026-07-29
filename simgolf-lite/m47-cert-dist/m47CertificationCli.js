import { mkdirSync, writeFileSync } from "node:fs";
const COURSE_WIDTH = 220;
const COURSE_HEIGHT = 140;
const PACE_PRESETS = {
  relaxed: { preset: "relaxed", teeIntervalMinutes: 12, maxGroupSize: 4, starterGapEveryGroups: 0, timeParStyle: "relaxed", teeGuidance: "open", enforcement: "advisory", lastTeeMinute: 600, daylightPolicy: "finish_started", compensationPolicy: "goodwill", beverage: { menu: "refreshments", passes: 2, alcoholLimit: 2, price: 8 } },
  balanced: { preset: "balanced", teeIntervalMinutes: 10, maxGroupSize: 4, starterGapEveryGroups: 10, timeParStyle: "standard", teeGuidance: "recommended", enforcement: "active", lastTeeMinute: 600, daylightPolicy: "finish_started", compensationPolicy: "credit", beverage: { menu: "refreshments", passes: 2, alcoholLimit: 2, price: 9 } },
  brisk: { preset: "brisk", teeIntervalMinutes: 12, maxGroupSize: 3, starterGapEveryGroups: 8, timeParStyle: "brisk", teeGuidance: "required", enforcement: "strict", lastTeeMinute: 570, daylightPolicy: "strict_sunset", compensationPolicy: "refund", beverage: { menu: "off", passes: 0, alcoholLimit: 1, price: 9 } }
};
function normalizeOperations(raw) {
  const preset = raw?.preset === "relaxed" || raw?.preset === "brisk" ? raw.preset : "balanced";
  const base = PACE_PRESETS[preset];
  const maxGroupSize = raw?.maxGroupSize === 2 || raw?.maxGroupSize === 3 ? raw.maxGroupSize : 4;
  const passes = raw?.beverage?.passes === 0 || raw?.beverage?.passes === 1 || raw?.beverage?.passes === 3 ? raw.beverage.passes : 2;
  const alcoholLimit = raw?.beverage?.alcoholLimit === 1 || raw?.beverage?.alcoholLimit === 3 || raw?.beverage?.alcoholLimit === 4 ? raw.beverage.alcoholLimit : 2;
  const daylightPolicy = raw?.daylightPolicy === "strict_sunset" || raw?.daylightPolicy === "finish_started" ? raw.daylightPolicy : base.daylightPolicy;
  const compensationPolicy = raw?.compensationPolicy === "refund" || raw?.compensationPolicy === "credit" || raw?.compensationPolicy === "goodwill" ? raw.compensationPolicy : base.compensationPolicy;
  return {
    ...base,
    ...raw,
    preset,
    teeIntervalMinutes: Math.max(7, Math.min(15, Math.round(raw?.teeIntervalMinutes ?? base.teeIntervalMinutes))),
    maxGroupSize,
    starterGapEveryGroups: Math.max(0, Math.min(12, Math.round(raw?.starterGapEveryGroups ?? base.starterGapEveryGroups))),
    lastTeeMinute: Math.max(240, Math.min(720, Math.round(raw?.lastTeeMinute ?? base.lastTeeMinute))),
    daylightPolicy,
    compensationPolicy,
    beverage: { ...base.beverage, ...raw?.beverage, passes, alcoholLimit, price: Math.max(1, Math.round(raw?.beverage?.price ?? base.beverage.price)) }
  };
}
function computeHoleDistanceTiles(tee2, green2) {
  const dx = tee2.x - green2.x;
  const dy = tee2.y - green2.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function computePathDistanceTiles(path) {
  if (path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}
function computeAutoPar(distanceTiles) {
  if (distanceTiles <= 14) return 3;
  if (distanceTiles <= 30) return 4;
  return 5;
}
const BALANCE = {
  // Visitors
  visitors: {
    baseFloor: 120,
    scale: 520,
    noiseMin: -40,
    noiseMax: 40,
    testingRoundsMax: 10,
    testingRoundFee: 5
  },
  pricing: {
    marketPrice: 80,
    highPriceHardness: 2.2,
    // exponent for above-market penalty
    repPremiumThreshold: 85,
    repDiscountThreshold: 70,
    lowRepPriceMult: 1.55,
    // harsher above-market penalty when rep < threshold
    highRepPriceMult: 0.85
    // slightly softer above-market penalty when rep > threshold
  },
  architecture: {
    // Architectural judgment informs demand without becoming an opening gate.
    // A 0/100 report can move demand by at most -/+ this fraction.
    demandEffectMax: 0.08,
    qualityBlend: 0.15
  },
  capacity: {
    roundsPerPlayableHolePerWeek: 300,
    soldOutRepBonus: 1,
    soldOutSatMin: 75
  },
  // Course validity gate
  coursePlayable: {
    minValidHoles: 9,
    minAvgPlayability: 40,
    minCondition: 0.4
  },
  // Fixed weekly overhead (always applies)
  overhead: {
    insurance: 140,
    utilities: 110,
    admin: 170,
    baseStaff: 280
  },
  // Variable operating costs
  ops: {
    staffCostPerLevel: 450,
    perAdditionalOperatingCourseStaff: 220,
    marketingCostPerLevel: 300
  },
  // Variable costs that scale with rounds / revenue (main margin control)
  variableCosts: {
    laborPerRoundBase: 8,
    laborPerRoundStaffBonusPerLevel: 0.45,
    // reduces labor per round a bit
    laborPerRoundMin: 5.5,
    consumablesPerRound: 1.5,
    merchantFeeRate: 0.03
    // fraction of revenue
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
    maxDurationSamplesPerDay: 160
  },
  // Condition wear & recovery
  condition: {
    wearCap: 0.06,
    wearDivisor: 2e4,
    maintEffectCap: 0.08,
    maintEffectDivisor: 2e4
  },
  // Required maintenance model
  requiredMaintenance: {
    base: 400,
    perDevelopedTile: 0.12,
    perAdditionalOperatingCourse: 180,
    perVisitorK: 0.08,
    // If budget < required, add extra wear and reputation penalty
    wearShortfallMult: 0.06,
    // extra wear (0..this) at 100% shortfall
    repPenaltyPer1000: 0.6,
    // up to ~-2 via rep cap
    // If budget > required, only a fraction of the excess counts for recovery
    excessEffectiveness: 0.25
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
    missedLoanPaymentPenalty: -2
  },
  // Distress / bankruptcy
  distress: {
    weeksToBankrupt: 2,
    liquidityTrapCash: -1e4
  },
  tax: {
    enabled: true,
    profitTaxRate: 0.25
    // applied only when profit > 0
  },
  // Loans
  loans: {
    aprMax: 0.3,
    aprMissedPaymentBump: 0.01,
    bridgeCooldownWeeks: 8,
    bridge: {
      maxPrincipal: 25e3,
      apr: 0.18,
      termWeeks: 26,
      repMin: 15,
      minValidHolesAlt: 6
    },
    expansion: {
      maxPrincipal: 15e4,
      apr: 0.12,
      termWeeks: 104,
      repMin: 50,
      minValidHoles: 9
    }
  },
  golfers: {
    // Deterministic, tunable golfer profiles for shot-based routing/grading.
    // Note: yardsPerTile here is the default yard model for the solver; the course also has yardsPerTile.
    scratch: {
      yardsPerTile: 10,
      ratingMultipliers: { hazard: 1, rough: 0.8, deepRough: 1, obstacle: 1 },
      clubs: [
        { name: "Driver", carryYards: 280, dispersionTilesBase: 3.5 },
        { name: "3W", carryYards: 250, dispersionTilesBase: 3 },
        { name: "5I", carryYards: 200, dispersionTilesBase: 2.4 },
        { name: "7I", carryYards: 170, dispersionTilesBase: 2 },
        { name: "PW", carryYards: 135, dispersionTilesBase: 1.5 }
      ]
    },
    bogey: {
      yardsPerTile: 10,
      ratingMultipliers: { hazard: 1.5, rough: 1.4, deepRough: 1.8, obstacle: 1.3 },
      clubs: [
        { name: "Driver", carryYards: 220, dispersionTilesBase: 4.2 },
        { name: "3W", carryYards: 200, dispersionTilesBase: 3.7 },
        { name: "5I", carryYards: 160, dispersionTilesBase: 3.1 },
        { name: "7I", carryYards: 140, dispersionTilesBase: 2.6 },
        { name: "PW", carryYards: 110, dispersionTilesBase: 2.1 }
      ]
    }
  },
  elevation: {
    // Uphill shots play longer: yards added per elevation step of rise
    // (negative rise plays shorter). Standard golf heuristic ~2-3 yd/step.
    shotYardsPerStep: 2.5,
    // Extra walking cost per 1-step slope crossed; 2+ step cliffs are
    // impassable on foot (matches the sculpting terracing constraint).
    walkSlopeCost: 0.8
  },
  courseSetup: {
    pinDifficulty: {
      edgeRadiusTiles: 4,
      edgePenaltyMax: 0.38,
      adjacentHazardPenalty: 0.14,
      elevationPenaltyPerStep: 0.055,
      penaltyCap: 0.75,
      bogeySensitivity: 1.35
    },
    ratingBands: { lowSlope: 90, averageSlope: 113, highSlope: 130 }
  },
  shots: {
    utilizationThreshold: 0.9,
    // beyond this, dispersion ramps up
    dispersionRamp: 2.2,
    // multiplier slope vs utilization over threshold
    water: {
      carryBufferYards: 10,
      maxExpectedShotsToGreen: 6,
      // Short-miss logic (lands along shot line)
      shortMissUtilStart: 0.92,
      shortMissMaxProb: 0.22,
      waterPenaltyStrokes: 2.6
      // landing in water is brutal
    },
    hole: {
      minHoleDistanceYards: 90,
      reachableInTwoThreshold: 2.3
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
        path: 0
      },
      // Sampling: higher values are more accurate but slower (grid is small, so modest is fine)
      maxRadiusTiles: 6
    }
  },
  // Land-theme gameplay flavor (ZKU-166) — data only, no new mechanics.
  // Parkland is the neutral identity theme.
  themes: {
    parkland: { waterBuildCostMult: 1, deepRoughPenaltyMult: 1 },
    links: { waterBuildCostMult: 1, deepRoughPenaltyMult: 1.15 },
    desert: { waterBuildCostMult: 1.5, deepRoughPenaltyMult: 1 }
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
      path: 40
    },
    salvageValue: {
      rough: 0,
      // Most construction cost is unrecoverable; refunds are intentionally low (20–40% max)
      deep_rough: 6,
      // 25 build → 24%
      fairway: 36,
      // 120 build → 30%
      green: 20,
      // 300 build → ~7% (minimal salvage)
      sand: 24,
      // 80 build → 30%
      waste_area: 12,
      water: 10,
      // 200 build → 5% (minimal salvage)
      wetland: 8,
      tee: 45,
      // 150 build → 30%
      path: 12
      // 40 build → 30%
    },
    // Sculpting: cost per tile per elevation step, charged for raising AND
    // lowering (earthworks are never refunded).
    earthworkCostPerStep: 60,
    maintWeight: {
      rough: 0.3,
      deep_rough: 0.6,
      fairway: 1,
      green: 2.5,
      sand: 1.2,
      waste_area: 0.25,
      water: 0.6,
      wetland: 0.35,
      tee: 1,
      path: 0.4
    },
    walkingCost: {
      fairway: 1,
      path: 1.2,
      tee: 1.2,
      green: 1.4,
      rough: 2.2,
      waste_area: 2.45,
      sand: 2.8,
      deep_rough: 3.4,
      water: Infinity,
      wetland: Infinity
    },
    rolloutTiles: {
      fairway: 1.6,
      path: 1.6,
      tee: 1.6,
      green: 0.5,
      rough: 0.35,
      deep_rough: 0.35,
      sand: 0.12,
      waste_area: 0.85,
      water: 0,
      wetland: 0
    },
    aestheticWeight: {
      fairway: 1,
      rough: 0.45,
      deep_rough: 0.7,
      sand: 1.1,
      waste_area: 0.75,
      water: 1.4,
      wetland: 1.2,
      green: 1.25,
      tee: 0.8,
      path: 0.35
    }
  }
};
function getGolferProfile(name, course) {
  const base = name === "SCRATCH" ? BALANCE.golfers.scratch : BALANCE.golfers.bogey;
  const yardsPerTile = course?.yardsPerTile ?? base.yardsPerTile;
  return {
    name,
    yardsPerTile,
    clubs: base.clubs.slice(),
    ratingMultipliers: { ...base.ratingMultipliers }
  };
}
function clamp$c(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function tileAt$3(course, p) {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return "rough";
  return course.tiles[p.y * course.width + p.x];
}
function computeExpectedLandingPenalty(args) {
  const { course, target } = args;
  const r0 = Math.max(0.5, args.dispersionTiles);
  const r = Math.min(BALANCE.shots.landing.maxRadiusTiles, Math.ceil(r0));
  const sigma = Math.max(0.8, r0 * 0.55);
  const twoSigma2 = 2 * sigma * sigma;
  let totalW = 0;
  const weightByTerrain = {};
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r0 * r0) continue;
      const w = Math.exp(-d2 / twoSigma2);
      totalW += w;
      const t = tileAt$3(course, { x: target.x + dx, y: target.y + dy });
      weightByTerrain[t] = (weightByTerrain[t] ?? 0) + w;
    }
  }
  const probs = {};
  let expected = 0;
  const pen = BALANCE.shots.landing.penaltyStrokes;
  const deepRoughMult = BALANCE.themes[course.theme ?? "parkland"].deepRoughPenaltyMult;
  if (totalW <= 0) {
    return { expectedPenalty: 0, probs: {} };
  }
  for (const [k, w] of Object.entries(weightByTerrain)) {
    const p = clamp$c(w / totalW, 0, 1);
    probs[k] = p;
    expected += p * (pen[k] ?? 0) * (k === "deep_rough" ? deepRoughMult : 1);
  }
  return { expectedPenalty: expected, probs };
}
function getElevation(course, x, y) {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height) return 0;
  return course.elevations?.[y * course.width + x] ?? 0;
}
function distTiles(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function evalShotBase(args) {
  const { from, to, golfer: golfer2, club, course } = args;
  const dTiles = distTiles(from, to);
  const flatYards = dTiles * golfer2.yardsPerTile;
  const elevDelta = course ? getElevation(course, to.x, to.y) - getElevation(course, from.x, from.y) : 0;
  const dYards = Math.max(
    flatYards * 0.5,
    flatYards + elevDelta * BALANCE.elevation.shotYardsPerStep
  );
  const utilization = club.carryYards <= 0 ? 99 : dYards / club.carryYards;
  const utilThresh = BALANCE.shots.utilizationThreshold;
  const utilOver = Math.max(0, utilization - utilThresh);
  const dispMult = 1 + utilOver * BALANCE.shots.dispersionRamp;
  const dispersionTiles = club.dispersionTilesBase * dispMult;
  const baseStrokeCost = 1;
  const expectedLandingPenalty = 0;
  const expectedCarryPenalty = 0;
  const expectedShotCost = baseStrokeCost + expectedLandingPenalty + expectedCarryPenalty;
  return {
    distanceYards: dYards,
    utilization,
    dispersionTiles,
    baseStrokeCost,
    expectedLandingPenalty,
    expectedCarryPenalty,
    expectedShotCost,
    isValid: true,
    debug: [
      elevDelta !== 0 ? `d=${dYards.toFixed(0)}y (flat ${flatYards.toFixed(0)}y, elev ${elevDelta > 0 ? "+" : ""}${elevDelta})` : `d=${dYards.toFixed(0)}y`,
      `club=${club.name}(${club.carryYards}y)`,
      `util=${(utilization * 100).toFixed(0)}%`,
      `disp=${dispersionTiles.toFixed(2)} tiles`
    ]
  };
}
function isWaterHazard(terrain) {
  return terrain === "water" || terrain === "wetland";
}
function isWalkableTerrain(terrain) {
  return Number.isFinite(BALANCE.terrain.walkingCost[terrain]);
}
function clamp01$6(x) {
  return Math.max(0, Math.min(1, x));
}
function bresenham(a, b) {
  const pts = [];
  let x0 = a.x | 0;
  let y0 = a.y | 0;
  const x1 = b.x | 0;
  const y1 = b.y | 0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    pts.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}
function tileAt$2(course, p) {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return "rough";
  return course.tiles[p.y * course.width + p.x];
}
function evalShotWithWaterCarry(args) {
  const { course, from, to, golfer: golfer2, club } = args;
  const base = evalShotBase({ from, to, golfer: golfer2, club, course });
  const line = bresenham(from, to);
  let run = 0;
  let best = 0;
  for (let i = 1; i < line.length; i++) {
    const t = tileAt$2(course, line[i]);
    if (isWaterHazard(t)) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  const waterCarryYards = best * golfer2.yardsPerTile;
  if (waterCarryYards > 0) {
    const required = waterCarryYards + BALANCE.shots.water.carryBufferYards;
    if (club.carryYards < required) {
      return {
        ...base,
        isValid: false,
        expectedCarryPenalty: Infinity,
        expectedShotCost: Infinity,
        debug: [...base.debug, `waterCarry=${waterCarryYards.toFixed(0)}y`, `invalid: carry<${required.toFixed(0)}y`]
      };
    }
    const u0 = BALANCE.shots.water.shortMissUtilStart;
    const p = clamp01$6((base.utilization - u0) / Math.max(1e-6, 1 - u0)) * BALANCE.shots.water.shortMissMaxProb;
    const expectedCarryPenalty = p * BALANCE.shots.water.waterPenaltyStrokes;
    return {
      ...base,
      expectedCarryPenalty,
      expectedShotCost: base.baseStrokeCost + base.expectedLandingPenalty + expectedCarryPenalty,
      debug: [
        ...base.debug,
        `waterCarry=${waterCarryYards.toFixed(0)}y`,
        `shortMissP=${(p * 100).toFixed(0)}%`,
        `carryPen=+${expectedCarryPenalty.toFixed(2)}`
      ]
    };
  }
  return base;
}
function evalShotExpectedCost(args) {
  const base = evalShotWithWaterCarry(args);
  if (!base.isValid) return base;
  const landing = computeExpectedLandingPenalty({
    course: args.course,
    target: args.to,
    dispersionTiles: base.dispersionTiles
  });
  const expectedLandingPenalty = landing.expectedPenalty;
  const expectedShotCost = base.baseStrokeCost + expectedLandingPenalty + base.expectedCarryPenalty;
  return {
    ...base,
    expectedLandingPenalty,
    expectedShotCost,
    debug: [...base.debug, `landPen=+${expectedLandingPenalty.toFixed(2)}`]
  };
}
function clamp$b(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function key(p) {
  return p.y * 1e4 + p.x;
}
function tileAt$1(course, p) {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return "rough";
  return course.tiles[p.y * course.width + p.x];
}
function inBounds$4(course, p) {
  return p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
}
class MinHeap {
  a = [];
  push(k, v) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (a.length === 0) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (; ; ) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}
function candidateOK(t) {
  return t !== "water";
}
const ANGLES_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];
function solveShotsToGreen(args) {
  const { course, tee: tee2, green: green2, golfer: golfer2 } = args;
  if (!inBounds$4(course, tee2) || !inBounds$4(course, green2)) {
    return { reachable: false, expectedShotsToGreen: Infinity, plan: [] };
  }
  if (!candidateOK(tileAt$1(course, tee2)) || !candidateOK(tileAt$1(course, green2))) {
    return { reachable: false, expectedShotsToGreen: Infinity, plan: [] };
  }
  const startK = key(tee2);
  const goalK = key(green2);
  const dist2 = /* @__PURE__ */ new Map();
  const prev = /* @__PURE__ */ new Map();
  const pq = new MinHeap();
  dist2.set(startK, 0);
  pq.push(0, startK);
  const fracs = [0.55, 0.75, 0.92, 1];
  let expansions = 0;
  const maxExpansions = 12e3;
  while (pq.size && expansions++ < maxExpansions) {
    const cur = pq.pop();
    const curK = cur.v;
    const curD = cur.k;
    const best2 = dist2.get(curK);
    if (best2 == null || curD !== best2) continue;
    if (curK === goalK) break;
    const cx = curK % 1e4;
    const cy = Math.floor(curK / 1e4);
    const from = { x: cx, y: cy };
    for (const club of golfer2.clubs) {
      const maxTiles = Math.max(1, Math.floor(club.carryYards / golfer2.yardsPerTile * 1.05));
      for (const frac of fracs) {
        const dTiles = clamp$b(Math.round(maxTiles * frac), 1, maxTiles);
        for (const [ax, ay] of ANGLES_8) {
          const to = { x: from.x + ax * dTiles, y: from.y + ay * dTiles };
          if (!inBounds$4(course, to)) continue;
          if (!candidateOK(tileAt$1(course, to))) continue;
          const ev = evalShotExpectedCost({ course, from, to, golfer: golfer2, club });
          if (!ev.isValid || !Number.isFinite(ev.expectedShotCost)) continue;
          const nd = curD + ev.expectedShotCost;
          const toK = key(to);
          const old = dist2.get(toK);
          if (old == null || nd < old) {
            dist2.set(toK, nd);
            prev.set(toK, {
              fromK: curK,
              step: {
                from,
                to,
                club: club.name,
                expectedShotCost: ev.expectedShotCost,
                utilization: ev.utilization,
                debug: ev.debug
              }
            });
            pq.push(nd, toK);
          }
        }
      }
      const evG = evalShotExpectedCost({ course, from, to: green2, golfer: golfer2, club });
      if (evG.isValid && Number.isFinite(evG.expectedShotCost)) {
        const nd = curD + evG.expectedShotCost;
        const old = dist2.get(goalK);
        if (old == null || nd < old) {
          dist2.set(goalK, nd);
          prev.set(goalK, {
            fromK: curK,
            step: {
              from,
              to: green2,
              club: club.name,
              expectedShotCost: evG.expectedShotCost,
              utilization: evG.utilization,
              debug: evG.debug
            }
          });
          pq.push(nd, goalK);
        }
      }
    }
  }
  const best = dist2.get(goalK);
  if (best == null || !Number.isFinite(best) || best > BALANCE.shots.water.maxExpectedShotsToGreen) {
    return { reachable: false, expectedShotsToGreen: best ?? Infinity, plan: [] };
  }
  const plan = [];
  let k0 = goalK;
  while (k0 !== startK) {
    const p = prev.get(k0);
    if (!p) break;
    plan.push(p.step);
    k0 = p.fromK;
  }
  plan.reverse();
  return { reachable: true, expectedShotsToGreen: best, plan };
}
function clamp$a(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function dist$1(a, b) {
  return computeHoleDistanceTiles(a, b);
}
function deriveAutoParFromShots(shotsToGreen) {
  const p = Math.round(shotsToGreen + 2);
  return clamp$a(p, 3, 5);
}
function inBounds$3(course, p) {
  return p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
}
function tileAt(course, p) {
  return course.tiles[p.y * course.width + p.x];
}
function sampleLine(a, b, samples = 13) {
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    pts.push({
      x: Math.round(a.x + (b.x - a.x) * t),
      y: Math.round(a.y + (b.y - a.y) * t)
    });
  }
  const seen = /* @__PURE__ */ new Set();
  return pts.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function scoreHoleUncached(course, hole, holeIndex) {
  const issues = [];
  if (!hole.tee || !hole.green) {
    const par2 = hole.parMode === "MANUAL" ? hole.parManual ?? 4 : 4;
    return {
      holeIndex,
      isComplete: false,
      isValid: false,
      par: par2,
      autoPar: 4,
      scratchShotsToGreen: Infinity,
      bogeyShotsToGreen: Infinity,
      reachableInTwo: false,
      straightDistance: 0,
      effectiveDistance: 0,
      path: [],
      shotPlan: [],
      playabilityScore: 0,
      difficultyScore: 0,
      aestheticsScore: 0,
      overallHoleScore: 0,
      corridor: {
        samples: 0,
        fairway: 0,
        rough: 0,
        deep_rough: 0,
        sand: 0,
        waste_area: 0,
        water: 0,
        wetland: 0,
        green: 0,
        tee: 0,
        path: 0
      },
      score: 0,
      layoutIssues: ["Missing tee/green placement"],
      issues: ["Missing tee/green placement"]
    };
  }
  const tee2 = hole.tee;
  const green2 = hole.green;
  const layoutIssues = [];
  if (!inBounds$3(course, tee2)) issues.push("Tee is out of bounds");
  if (!inBounds$3(course, green2)) issues.push("Green is out of bounds");
  if (tee2.x === green2.x && tee2.y === green2.y) issues.push("Tee and green overlap");
  for (const msg of issues) layoutIssues.push(msg);
  const straightDistance = dist$1(tee2, green2);
  const scratch = getGolferProfile("SCRATCH", course);
  const bogey = getGolferProfile("BOGEY", course);
  const scratchSolve = solveShotsToGreen({ course, tee: tee2, green: green2, golfer: scratch });
  const bogeySolve = solveShotsToGreen({ course, tee: tee2, green: green2, golfer: bogey });
  const scratchShotsToGreen = scratchSolve.expectedShotsToGreen;
  const bogeyShotsToGreen = bogeySolve.expectedShotsToGreen;
  const reachable = scratchSolve.reachable;
  const minDistOk = straightDistance * scratch.yardsPerTile >= BALANCE.shots.hole.minHoleDistanceYards;
  const maxOk = reachable && scratchShotsToGreen <= BALANCE.shots.water.maxExpectedShotsToGreen;
  const autoPar = reachable ? deriveAutoParFromShots(scratchShotsToGreen) : 4;
  const par = hole.parMode === "MANUAL" ? hole.parManual ?? autoPar : autoPar;
  const reachableInTwo = reachable && scratchShotsToGreen <= BALANCE.shots.hole.reachableInTwoThreshold;
  if (!minDistOk) issues.push("Hole too short (tee too close to green)");
  if (!reachable) issues.push("Green unreachable with club-based shot planning");
  if (reachable && !maxOk) issues.push("Routing is too costly (forced penalties / no safe layup)");
  const shotPlan = scratchSolve.plan;
  const poly = [];
  for (const s2 of shotPlan) {
    const pts2 = sampleLine(s2.from, s2.to, 9);
    for (const p of pts2) {
      if (poly.length === 0) poly.push(p);
      else {
        const last = poly[poly.length - 1];
        if (last.x !== p.x || last.y !== p.y) poly.push(p);
      }
    }
  }
  if (poly.length === 0) poly.push(tee2, green2);
  const effectiveDistance = computePathDistanceTiles(poly);
  const teeTile = inBounds$3(course, tee2) ? tileAt(course, tee2) : "rough";
  const greenTile = inBounds$3(course, green2) ? tileAt(course, green2) : "rough";
  if (teeTile === "water" || teeTile === "wetland" || teeTile === "sand") issues.push("Tee on hazard");
  if (greenTile === "water" || greenTile === "wetland" || greenTile === "sand") issues.push("Green on hazard");
  const pts = poly;
  const corridorCounts = pts.reduce(
    (acc, p) => {
      const t = tileAt(course, p);
      acc[t] += 1;
      acc.samples += 1;
      return acc;
    },
    {
      samples: 0,
      fairway: 0,
      rough: 0,
      deep_rough: 0,
      sand: 0,
      waste_area: 0,
      water: 0,
      wetland: 0,
      green: 0,
      tee: 0,
      path: 0
    }
  );
  const s = corridorCounts.samples || 1;
  const waterFrac = (corridorCounts.water + corridorCounts.wetland) / s;
  const sandFrac = corridorCounts.sand / s;
  const wasteFrac = corridorCounts.waste_area / s;
  const fairwayFrac = corridorCounts.fairway / s;
  const roughFrac = corridorCounts.rough / s;
  const deepRoughFrac = corridorCounts.deep_rough / s;
  const pathFrac = corridorCounts.path / s;
  const onHazardFrac = waterFrac + sandFrac;
  const onBadLieFrac = roughFrac + deepRoughFrac + wasteFrac + onHazardFrac;
  if (waterFrac > 0.25) issues.push("Lots of water on main line");
  if (roughFrac > 0.7) issues.push("Mostly rough on main line");
  if (deepRoughFrac > 0.25) issues.push("Deep rough dominates the main line");
  const nearCounts = pts.reduce(
    (acc, p) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (!inBounds$3(course, q)) continue;
          if (dx === 0 && dy === 0) continue;
          const t = tileAt(course, q);
          acc[t] += 1;
          acc.samples += 1;
        }
      }
      return acc;
    },
    {
      samples: 0,
      fairway: 0,
      rough: 0,
      deep_rough: 0,
      sand: 0,
      waste_area: 0,
      water: 0,
      wetland: 0,
      green: 0,
      tee: 0,
      path: 0
    }
  );
  const ns = nearCounts.samples || 1;
  const nearWaterFrac = (nearCounts.water + nearCounts.wetland) / ns;
  const nearSandFrac = nearCounts.sand / ns;
  const nearWasteFrac = nearCounts.waste_area / ns;
  const nearDeepRoughFrac = nearCounts.deep_rough / ns;
  const obstacleStats = scoreObstaclesAgainstCorridor(course.obstacles ?? [], pts);
  let playabilityScore = 90 + 35 * fairwayFrac + 10 * pathFrac - 70 * roughFrac - 120 * deepRoughFrac - 130 * waterFrac - 55 * sandFrac - 42 * wasteFrac;
  if (teeTile === "water" || teeTile === "wetland" || teeTile === "sand") playabilityScore -= 25;
  if (greenTile === "water" || greenTile === "wetland" || greenTile === "sand") playabilityScore -= 25;
  playabilityScore -= 20 * obstacleStats.treeOnLine;
  playabilityScore -= 10 * obstacleStats.bushOnLine;
  playabilityScore -= 10 * obstacleStats.treeNear;
  playabilityScore -= 5 * obstacleStats.bushNear;
  playabilityScore = clamp$a(playabilityScore, 0, 100);
  const distNorm = clamp$a(effectiveDistance / 40, 0, 1);
  const shotsNorm = reachable ? clamp$a((scratchShotsToGreen - 2) / 3, 0, 1) : 1;
  let difficultyScore = 20 + 65 * (0.85 * waterFrac + 0.55 * sandFrac + 0.38 * wasteFrac + 0.25 * roughFrac + 0.45 * deepRoughFrac) + 28 * distNorm + 38 * shotsNorm;
  if (teeTile === "water" || teeTile === "wetland" || teeTile === "sand") difficultyScore += 10;
  if (greenTile === "water" || greenTile === "wetland" || greenTile === "sand") difficultyScore += 10;
  difficultyScore += 12 * obstacleStats.treeOnLine;
  difficultyScore += 6 * obstacleStats.bushOnLine;
  difficultyScore += 6 * obstacleStats.treeNear;
  difficultyScore += 3 * obstacleStats.bushNear;
  difficultyScore = clamp$a(difficultyScore, 0, 100);
  let aestheticsScore = 55 + 75 * (nearWaterFrac + 0.6 * nearSandFrac + 0.35 * nearWasteFrac) - 120 * (waterFrac + 0.6 * sandFrac + 0.25 * wasteFrac);
  aestheticsScore += 10 * clamp$a(nearWaterFrac, 0, 0.12) / 0.12;
  aestheticsScore -= 35 * clamp$a(nearDeepRoughFrac - 0.12, 0, 1);
  aestheticsScore += 4 * obstacleStats.treeScenic + 3 * obstacleStats.bushScenic;
  aestheticsScore += 1 * obstacleStats.treeOff + 0.5 * obstacleStats.bushOff;
  aestheticsScore -= 12 * obstacleStats.treeOnLine + 6 * obstacleStats.bushOnLine;
  const obstacleTotal = obstacleStats.total;
  if (obstacleTotal > 22) aestheticsScore -= 2 * (obstacleTotal - 22);
  aestheticsScore = clamp$a(aestheticsScore, 0, 100);
  let overallHoleScore = 0.6 * playabilityScore + 0.25 * aestheticsScore + 0.15 * (100 - difficultyScore);
  overallHoleScore -= 30 * clamp$a(onHazardFrac - 0.25, 0, 1);
  overallHoleScore -= 18 * clamp$a(onBadLieFrac - 0.55, 0, 1);
  overallHoleScore = clamp$a(overallHoleScore, 0, 100);
  const score = overallHoleScore;
  const isValid = issues.length === 0 && maxOk && minDistOk;
  return {
    holeIndex,
    isComplete: true,
    isValid,
    par,
    autoPar,
    scratchShotsToGreen,
    bogeyShotsToGreen,
    reachableInTwo,
    straightDistance,
    effectiveDistance,
    path: poly,
    shotPlan,
    playabilityScore,
    difficultyScore,
    aestheticsScore,
    overallHoleScore,
    corridor: corridorCounts,
    score,
    layoutIssues,
    issues
  };
}
let holeScoreCache = /* @__PURE__ */ new WeakMap();
function numericIndex(property) {
  if (typeof property !== "string" || !/^\d+$/.test(property)) return null;
  return Number(property);
}
function trackArrayReads(values, dependencies) {
  return new Proxy(values, {
    get(target, property, receiver) {
      const index = numericIndex(property);
      if (index !== null) dependencies.set(index, target[index]);
      return Reflect.get(target, property, receiver);
    }
  });
}
function dependenciesMatch(dependencies, values) {
  for (const [index, previous] of dependencies) {
    if (values[index] !== previous) return false;
  }
  return true;
}
function scoreHole(course, hole, holeIndex) {
  const cached = holeScoreCache.get(hole);
  const elevations = course.elevations ?? [];
  if (cached && cached.width === course.width && cached.height === course.height && cached.yardsPerTile === (course.yardsPerTile ?? 10) && cached.holeIndex === holeIndex && cached.obstacles === course.obstacles && dependenciesMatch(cached.tileDependencies, course.tiles) && dependenciesMatch(cached.elevationDependencies, elevations)) {
    return cached.result;
  }
  const tileDependencies = /* @__PURE__ */ new Map();
  const elevationDependencies = /* @__PURE__ */ new Map();
  const trackedCourse = {
    ...course,
    tiles: trackArrayReads(course.tiles, tileDependencies),
    ...course.elevations ? { elevations: trackArrayReads(course.elevations, elevationDependencies) } : {}
  };
  const result = scoreHoleUncached(trackedCourse, hole, holeIndex);
  holeScoreCache.set(hole, {
    width: course.width,
    height: course.height,
    yardsPerTile: course.yardsPerTile ?? 10,
    holeIndex,
    obstacles: course.obstacles,
    tileDependencies,
    elevationDependencies,
    result
  });
  return result;
}
const summaryCache = /* @__PURE__ */ new WeakMap();
function scoreCourseHoles(course) {
  const cached = summaryCache.get(course);
  if (cached) return cached;
  const result = scoreCourseHolesUncached(course);
  summaryCache.set(course, result);
  return result;
}
function scoreCourseHolesUncached(course) {
  const holes = course.holes.map((h, i) => scoreHole(course, h, i));
  const scored = holes.filter((h) => h.isComplete);
  const holeQualityAvg = scored.length === 0 ? 0 : scored.reduce((acc, h) => acc + h.overallHoleScore, 0) / scored.length;
  const parCounts = /* @__PURE__ */ new Map();
  for (const h of holes) parCounts.set(h.par, (parCounts.get(h.par) ?? 0) + 1);
  const distinctPars = parCounts.size;
  const variety = clamp$a(20 + 40 * distinctPars, 0, 100);
  const total = course.tiles.length || 1;
  const pathFrac = course.tiles.filter((t) => t === "path").length / total;
  const waterFrac = course.tiles.filter((t) => t === "water").length / total;
  const deepRoughFrac = course.tiles.filter((t) => t === "deep_rough").length / total;
  const obstacleFrac = (course.obstacles?.length ?? 0) / total;
  const deepRoughPenalty = 12 * clamp$a(deepRoughFrac - 0.28, 0, 1);
  const obstaclePenalty = 10 * clamp$a(obstacleFrac - 0.06, 0, 1);
  const globalBonus = clamp$a(
    8 * pathFrac - 6 * Math.max(0, waterFrac - 0.08) - deepRoughPenalty - obstaclePenalty,
    -10,
    10
  );
  const courseQuality = clamp$a(holeQualityAvg + globalBonus + 0.15 * (variety - 70), 0, 100);
  return { holes, holeQualityAvg, variety, globalBonus, courseQuality };
}
function scoreObstaclesAgainstCorridor(obstacles, corridorPts) {
  if (corridorPts.length === 0 || obstacles.length === 0) {
    return {
      treeOnLine: 0,
      bushOnLine: 0,
      treeNear: 0,
      bushNear: 0,
      treeScenic: 0,
      bushScenic: 0,
      treeOff: 0,
      bushOff: 0,
      total: 0
    };
  }
  function cheb(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  let treeOnLine = 0;
  let bushOnLine = 0;
  let treeNear = 0;
  let bushNear = 0;
  let treeScenic = 0;
  let bushScenic = 0;
  let treeOff = 0;
  let bushOff = 0;
  for (const o of obstacles) {
    let d = Infinity;
    for (const p of corridorPts) d = Math.min(d, cheb(o, p));
    const isTree = o.type === "tree";
    if (d === 0) {
      if (isTree) treeOnLine++;
      else bushOnLine++;
    } else if (d === 1) {
      if (isTree) treeNear++;
      else bushNear++;
    } else if (d <= 3) {
      if (isTree) treeScenic++;
      else bushScenic++;
    } else {
      if (isTree) treeOff++;
      else bushOff++;
    }
  }
  const total = treeOnLine + bushOnLine + treeNear + bushNear + treeScenic + bushScenic + treeOff + bushOff;
  return { treeOnLine, bushOnLine, treeNear, bushNear, treeScenic, bushScenic, treeOff, bushOff, total };
}
const MAX_ESTATE_HOLES = 36;
const normalizedCourseCache = /* @__PURE__ */ new WeakMap();
const layoutViewCache = /* @__PURE__ */ new WeakMap();
function uniqueId(base, used) {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}
function normalizeCourseLayouts(input) {
  const cached = normalizedCourseCache.get(input);
  if (cached) return cached;
  const usedHoleIds = /* @__PURE__ */ new Set();
  const normalizedHoles = input.holes.slice(0, MAX_ESTATE_HOLES).map((hole, index) => {
    const id = uniqueId(typeof hole.id === "string" && hole.id.trim() ? hole.id.trim() : `hole-${index + 1}`, usedHoleIds);
    return hole.id === id ? hole : { ...hole, id };
  });
  const holes = normalizedHoles.length === input.holes.length && normalizedHoles.every((hole, index) => hole === input.holes[index]) ? input.holes : normalizedHoles;
  const holeIds = new Set(holes.map((hole) => hole.id));
  const usedLayoutIds = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const raw of input.layouts ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const id = uniqueId(typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `course-${normalized.length + 1}`, usedLayoutIds);
    const clean = (values) => Array.isArray(values) ? [...new Set(values.filter((value) => typeof value === "string" && holeIds.has(value)))] : [];
    const draftHoleIds = clean(raw.draftHoleIds);
    const publishedHoleIds = clean(raw.publishedHoleIds);
    normalized.push({
      id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Course ${normalized.length + 1}`,
      draftHoleIds,
      publishedHoleIds,
      roundLength: raw.roundLength === 18 ? 18 : 9,
      state: raw.state === "closed" ? "closed" : "open",
      greenFee: Number.isFinite(raw.greenFee) ? Math.max(0, Math.round(raw.greenFee)) : input.baseGreenFee,
      operations: normalizeOperations(raw.operations),
      legacyPartial: raw.legacyPartial === true || void 0
    });
  }
  if (normalized.length === 0) {
    const all = holes.map((hole) => hole.id);
    normalized.push({
      id: "course-primary",
      name: input.name,
      draftHoleIds: all,
      publishedHoleIds: all,
      roundLength: all.length >= 18 ? 18 : 9,
      state: "open",
      greenFee: input.baseGreenFee,
      operations: normalizeOperations(),
      legacyPartial: all.length !== 9 && all.length !== 18 ? true : void 0
    });
    usedLayoutIds.add("course-primary");
  }
  const publishedOwner = /* @__PURE__ */ new Set();
  const layouts = normalized.map((layout) => ({
    ...layout,
    publishedHoleIds: layout.publishedHoleIds.filter((id) => {
      if (publishedOwner.has(id)) return false;
      publishedOwner.add(id);
      return true;
    })
  }));
  const activeCourseId = layouts.some((layout) => layout.id === input.activeCourseId) ? input.activeCourseId : layouts[0].id;
  const active = layouts.find((layout) => layout.id === activeCourseId);
  const result = { ...input, holes, layouts, activeCourseId, baseGreenFee: active.greenFee };
  normalizedCourseCache.set(input, result);
  normalizedCourseCache.set(result, result);
  return result;
}
function activeCourseLayout(course) {
  const normalized = normalizeCourseLayouts(course);
  return normalized.layouts.find((layout) => layout.id === normalized.activeCourseId) ?? normalized.layouts[0];
}
function layoutById(course, courseId) {
  const normalized = normalizeCourseLayouts(course);
  return normalized.layouts.find((layout) => layout.id === courseId) ?? (courseId == null ? activeCourseLayout(normalized) : void 0);
}
function courseForLayout(course, courseId, draft = false) {
  const normalized = normalizeCourseLayouts(course);
  const layout = layoutById(normalized, courseId) ?? activeCourseLayout(normalized);
  let views = layoutViewCache.get(normalized);
  if (!views) {
    views = /* @__PURE__ */ new Map();
    layoutViewCache.set(normalized, views);
  }
  const cacheKey = `${layout.id}:${draft ? "draft" : "published"}`;
  const cached = views.get(cacheKey);
  if (cached) return cached;
  const ids = draft ? layout.draftHoleIds : layout.publishedHoleIds;
  const byId = new Map(normalized.holes.map((hole) => [hole.id, hole]));
  const result = {
    ...normalized,
    name: layout.name,
    holes: ids.map((id) => byId.get(id)).filter((hole) => !!hole),
    baseGreenFee: layout.greenFee,
    activeCourseId: layout.id
  };
  views.set(cacheKey, result);
  return result;
}
function operatingCourseViews(course) {
  const normalized = normalizeCourseLayouts(course);
  return normalized.layouts.filter((layout) => layout.state === "open" && layout.publishedHoleIds.length > 0).map((layout) => ({ layout, course: courseForLayout(normalized, layout.id) }));
}
const TERRAIN_CODES = {
  fairway: "f",
  rough: "r",
  deep_rough: "d",
  sand: "s",
  waste_area: "a",
  water: "w",
  wetland: "l",
  green: "g",
  tee: "t",
  path: "p"
};
const CODE_TERRAIN = Object.fromEntries(Object.entries(TERRAIN_CODES).map(([key2, value]) => [value, key2]));
function decodeStringRuns(encoded, expected) {
  const result = [];
  if (!encoded) return expected === 0 ? result : null;
  for (const run of encoded.split(",")) {
    const [value, rawCount] = run.split(":");
    const count = Number.parseInt(rawCount, 36);
    if (!value || !Number.isInteger(count) || count < 1 || result.length + count > expected) return null;
    for (let i = 0; i < count; i++) result.push(value);
  }
  return result.length === expected ? result : null;
}
function decodeNumberRuns(encoded, expected) {
  const strings2 = decodeStringRuns(encoded, expected);
  if (!strings2) return null;
  const values = strings2.map((value) => Number.parseInt(value, 36));
  return values.every(Number.isFinite) ? values : null;
}
function decodeTerrainBaseline(encoded, expected) {
  const codes = decodeStringRuns(encoded, expected);
  if (!codes || codes.some((code) => !CODE_TERRAIN[code])) return null;
  return codes.map((code) => CODE_TERRAIN[code]);
}
function decodeElevationBaseline(encoded, expected) {
  return decodeNumberRuns(encoded, expected);
}
const TEE_SETS = ["forward", "member", "championship"];
const PIN_ROTATIONS = ["A", "B", "C"];
function getTeeBox(hole, set = "member") {
  return hole.teeBoxes?.[set] ?? (set === "member" ? hole.tee : null) ?? null;
}
function getPinPosition(hole, rotation = "A") {
  return hole.pinPositions?.[rotation] ?? (rotation === "A" ? hole.green : null) ?? null;
}
function getParSetting(hole, set = "member") {
  const configured = hole.parByTee?.[set];
  if (configured?.mode === "MANUAL") return { mode: "MANUAL", par: configured.par };
  if (configured?.mode === "AUTO") return { mode: "AUTO" };
  if (set === "member" && hole.parMode === "MANUAL") return { mode: "MANUAL", par: hole.parManual ?? 4 };
  return { mode: "AUTO" };
}
function holeForCourseSetup(hole, teeSet, pinRotation) {
  const par = getParSetting(hole, teeSet);
  return {
    ...hole,
    tee: getTeeBox(hole, teeSet),
    green: getPinPosition(hole, pinRotation),
    parMode: par.mode,
    parManual: par.mode === "MANUAL" ? par.par : void 0
  };
}
function courseForCourseSetup(course, teeSet, pinRotation) {
  return { ...course, holes: course.holes.map((hole) => holeForCourseSetup(hole, teeSet, pinRotation)) };
}
function withNormalizedHoleSetup(hole) {
  const member = getTeeBox(hole, "member");
  const pinA = getPinPosition(hole, "A");
  const memberPar = getParSetting(hole, "member");
  return {
    ...hole,
    tee: member,
    green: pinA,
    teeBoxes: {
      forward: getTeeBox(hole, "forward"),
      member,
      championship: getTeeBox(hole, "championship")
    },
    pinPositions: {
      A: pinA,
      B: getPinPosition(hole, "B"),
      C: getPinPosition(hole, "C")
    },
    parByTee: {
      forward: getParSetting(hole, "forward"),
      member: memberPar,
      championship: getParSetting(hole, "championship")
    },
    parMode: memberPar.mode,
    parManual: memberPar.mode === "MANUAL" ? memberPar.par : void 0
  };
}
function resolveCourseSetup(hole, requestedTeeSet = "member", requestedPinRotation = "A") {
  const requestedTee = getTeeBox(hole, requestedTeeSet);
  const member = getTeeBox(hole, "member");
  const firstTee = TEE_SETS.map((set) => ({ set, point: getTeeBox(hole, set) })).find((entry) => entry.point);
  const tee2 = requestedTee ?? member ?? firstTee?.point ?? null;
  const teeSet = requestedTee ? requestedTeeSet : member ? "member" : firstTee?.set ?? requestedTeeSet;
  const requestedPin = getPinPosition(hole, requestedPinRotation);
  const pinA = getPinPosition(hole, "A");
  const firstPin = PIN_ROTATIONS.map((rotation) => ({ rotation, point: getPinPosition(hole, rotation) })).find((entry) => entry.point);
  const pin = requestedPin ?? pinA ?? firstPin?.point ?? null;
  const pinRotation = requestedPin ? requestedPinRotation : pinA ? "A" : firstPin?.rotation ?? requestedPinRotation;
  return {
    requestedTeeSet,
    teeSet,
    requestedPinRotation,
    pinRotation,
    tee: tee2,
    pin,
    usedTeeFallback: teeSet !== requestedTeeSet,
    usedPinFallback: pinRotation !== requestedPinRotation
  };
}
function preferredTeeForArchetype(archetype) {
  if (archetype === "pro") return "championship";
  if (archetype === "casual" || archetype === "senior" || archetype === "junior" || archetype === "tourist") return "forward";
  return "member";
}
const BUILDING_SPECS = {
  clubhouse: {
    type: "clubhouse",
    name: "Clubhouse",
    w: 3,
    d: 3,
    frame: "clubhouse",
    buildCost: 0
  },
  pro_shop: {
    type: "pro_shop",
    name: "Pro Shop",
    w: 2,
    d: 2,
    frame: "pro_shop",
    buildCost: 8e3,
    defaultPrice: 28,
    item: "Golf merchandise",
    serviceMinutes: 6,
    capacity: 3
  },
  snack_bar: {
    type: "snack_bar",
    name: "Snack Bar",
    w: 2,
    d: 2,
    frame: "snack_bar",
    buildCost: 4500,
    defaultPrice: 9,
    item: "Food & drink",
    serviceMinutes: 4,
    capacity: 4
  },
  cart_rental: {
    type: "cart_rental",
    name: "Cart Rental",
    w: 2,
    d: 2,
    frame: "cart_rental",
    buildCost: 6500,
    defaultPrice: 18,
    item: "Cart rental",
    serviceMinutes: 5,
    capacity: 5
  }
};
function isConcessionType(type) {
  return type !== "clubhouse";
}
function isConcession(building) {
  return isConcessionType(building.type);
}
function normalizedBuilding(building) {
  const identified = { ...building, id: building.id || `building-${building.type}-${building.x}-${building.y}` };
  if (!isConcession(identified)) return identified;
  const spec2 = BUILDING_SPECS[identified.type];
  const tier = [1, 2, 3].includes(identified.tier) ? identified.tier : 1;
  const price = Number.isFinite(identified.price) ? Math.max(1, Math.round(identified.price)) : spec2.defaultPrice;
  return { ...identified, tier, price };
}
function buildingSpec(b) {
  return BUILDING_SPECS[b.type];
}
function buildingTiles(b) {
  const spec2 = buildingSpec(b);
  const out = [];
  for (let y = b.y; y < b.y + spec2.d; y++) {
    for (let x = b.x; x < b.x + spec2.w; x++) out.push({ x, y });
  }
  return out;
}
function buildingAtTile(course, x, y) {
  return (course.buildings ?? []).find((building) => {
    const spec2 = buildingSpec(building);
    return x >= building.x && x < building.x + spec2.w && y >= building.y && y < building.y + spec2.d;
  });
}
function buildingEntrance(course, building) {
  const spec2 = buildingSpec(building);
  const candidates = [
    { x: building.x + Math.floor(spec2.w / 2), y: building.y + spec2.d },
    { x: building.x + spec2.w, y: building.y + Math.floor(spec2.d / 2) },
    { x: building.x - 1, y: building.y + Math.floor(spec2.d / 2) },
    { x: building.x + Math.floor(spec2.w / 2), y: building.y - 1 }
  ];
  return candidates.find((p) => {
    if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return false;
    return course.tiles[p.y * course.width + p.x] !== "water" && !buildingAtTile(course, p.x, p.y);
  }) ?? { x: building.x, y: building.y };
}
function buildingFootprintSet(course) {
  const set = /* @__PURE__ */ new Set();
  for (const b of course.buildings ?? []) {
    for (const t of buildingTiles(b)) {
      if (t.x >= 0 && t.y >= 0 && t.x < course.width && t.y < course.height) {
        set.add(t.y * course.width + t.x);
      }
    }
  }
  return set;
}
const themed = (frame, scale = 1, shadow = { radiusX: 17, radiusY: 7, alpha: 0.18 }) => ({
  parkland: { frame: `parkland_${frame}`, anchor: [0.5, 1], scale, shadow },
  links: { frame: `links_${frame}`, anchor: [0.5, 1], scale, shadow },
  desert: { frame: `desert_${frame}`, anchor: [0.5, 1], scale, shadow }
});
const DECORATION_SPECS = {
  fence: { kind: "fence", name: "Fence", category: "furniture", buildCost: 90, salvageRate: 0.5, blocksWalking: true, visuals: themed("fence", 1.05) },
  bench: { kind: "bench", name: "Bench", category: "furniture", buildCost: 140, salvageRate: 0.5, blocksWalking: false, visuals: themed("bench", 0.95) },
  tee_sign: { kind: "tee_sign", name: "Tee Sign", category: "furniture", buildCost: 110, salvageRate: 0.5, blocksWalking: false, visuals: themed("tee_sign", 0.9) },
  lamp: { kind: "lamp", name: "Lamp", category: "furniture", buildCost: 220, salvageRate: 0.45, blocksWalking: false, visuals: themed("lamp", 1) },
  bin: { kind: "bin", name: "Bin", category: "furniture", buildCost: 75, salvageRate: 0.5, blocksWalking: false, visuals: themed("bin", 0.72) },
  parked_cart: { kind: "parked_cart", name: "Parked Cart", category: "furniture", buildCost: 450, salvageRate: 0.55, blocksWalking: true, visuals: themed("parked_cart", 1.05) },
  flower_bed: { kind: "flower_bed", name: "Flower Bed", category: "planting", buildCost: 120, salvageRate: 0.35, blocksWalking: false, visuals: themed("flower_bed", 0.95, { radiusX: 15, radiusY: 5, alpha: 0.12 }) },
  planter: { kind: "planter", name: "Planter", category: "planting", buildCost: 160, salvageRate: 0.4, blocksWalking: false, visuals: themed("planter", 0.9) },
  ornamental_feature: { kind: "ornamental_feature", name: "Ornamental Feature", category: "planting", buildCost: 900, salvageRate: 0.35, blocksWalking: true, visuals: themed("ornamental_feature", 1.35, { radiusX: 23, radiusY: 9, alpha: 0.18 }) },
  bridge: { kind: "bridge", name: "Bridge", category: "structure", buildCost: 1200, salvageRate: 0.45, blocksWalking: false, allowedTerrain: ["water"], defaultSpan: 3, maxSpan: 6, visuals: themed("bridge", 1.05, { radiusX: 25, radiusY: 8, alpha: 0.14 }) },
  boardwalk: { kind: "boardwalk", name: "Boardwalk", category: "structure", buildCost: 800, salvageRate: 0.45, blocksWalking: false, allowedTerrain: ["wetland"], defaultSpan: 3, maxSpan: 8, visuals: themed("boardwalk", 1.05, { radiusX: 25, radiusY: 8, alpha: 0.14 }) }
};
const bridgeTilesByCourse = /* @__PURE__ */ new WeakMap();
const blockingTilesByCourse = /* @__PURE__ */ new WeakMap();
function decorationSpec(kind) {
  return DECORATION_SPECS[kind];
}
function rotationVector(rotation) {
  return rotation === 0 ? { x: 1, y: 0 } : rotation === 1 ? { x: 0, y: 1 } : rotation === 2 ? { x: -1, y: 0 } : { x: 0, y: -1 };
}
function decorationTiles(decoration) {
  if (decoration.kind !== "bridge" && decoration.kind !== "boardwalk") return [{ x: decoration.x, y: decoration.y }];
  const span = Math.max(1, Math.floor(decoration.span ?? decorationSpec(decoration.kind).defaultSpan ?? 1));
  const vector = rotationVector(decoration.rotation);
  return Array.from({ length: span + 2 }, (_, i) => ({ x: decoration.x + vector.x * i, y: decoration.y + vector.y * i }));
}
function bridgeTileSet(course) {
  const cached = bridgeTilesByCourse.get(course);
  if (cached) return cached;
  const set = /* @__PURE__ */ new Set();
  for (const decoration of course.decorations ?? []) {
    if (decoration.kind !== "bridge" && decoration.kind !== "boardwalk") continue;
    for (const tile of decorationTiles(decoration).slice(1, -1)) set.add(tile.y * course.width + tile.x);
  }
  bridgeTilesByCourse.set(course, set);
  return set;
}
function blockingDecorationSet(course) {
  const cached = blockingTilesByCourse.get(course);
  if (cached) return cached;
  const set = /* @__PURE__ */ new Set();
  for (const decoration of course.decorations ?? []) {
    if (!decorationSpec(decoration.kind).blocksWalking) continue;
    for (const tile of decorationTiles(decoration)) set.add(tile.y * course.width + tile.x);
  }
  blockingTilesByCourse.set(course, set);
  return set;
}
function inBounds$2(course, x, y) {
  return x >= 0 && y >= 0 && x < course.width && y < course.height;
}
function walkable(course, x, y, bridges, blocked) {
  if (!inBounds$2(course, x, y)) return false;
  const index = y * course.width + x;
  if (blocked.has(index)) return false;
  return bridges.has(index) || isWalkableTerrain(course.tiles[index]);
}
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];
function findWalkPath(course, from, to, maxExpansions = 12e3) {
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  const tx = Math.round(to.x);
  const ty = Math.round(to.y);
  const bridges = bridgeTileSet(course);
  const blocked = buildingFootprintSet(course);
  for (const index of blockingDecorationSet(course)) blocked.add(index);
  if (!walkable(course, sx, sy, bridges, blocked) || !walkable(course, tx, ty, bridges, blocked)) return null;
  if (sx === tx && sy === ty) return [{ x: to.x, y: to.y }];
  const W = course.width;
  const startK = sy * W + sx;
  const goalK = ty * W + tx;
  const prev = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set([startK]);
  let queue = [startK];
  let expansions = 0;
  let found = false;
  while (queue.length && expansions < maxExpansions) {
    const next = [];
    for (const cur of queue) {
      if (++expansions > maxExpansions) break;
      if (cur === goalK) {
        found = true;
        break;
      }
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkable(course, nx, ny, bridges, blocked)) continue;
        if (dx !== 0 && dy !== 0 && (!walkable(course, cx + dx, cy, bridges, blocked) || !walkable(course, cx, cy + dy, bridges, blocked))) continue;
        const nk = ny * W + nx;
        if (seen.has(nk)) continue;
        seen.add(nk);
        prev.set(nk, cur);
        next.push(nk);
      }
    }
    if (found) break;
    queue = next;
  }
  if (!found && !seen.has(goalK)) return null;
  const cells = [];
  let k = goalK;
  cells.push(k);
  while (k !== startK) {
    const p = prev.get(k);
    if (p === void 0) return null;
    cells.push(p);
    k = p;
  }
  cells.reverse();
  const pts = cells.map((c) => ({ x: c % W, y: (c - c % W) / W }));
  const simplified = [];
  let lastDir = null;
  for (let i = 1; i < pts.length; i++) {
    const d = dirOf(pts[i - 1], pts[i]);
    if (lastDir && (d.dx !== lastDir.dx || d.dy !== lastDir.dy)) {
      simplified.push(pts[i - 1]);
    }
    lastDir = d;
  }
  simplified.push(pts[pts.length - 1]);
  return simplified;
}
function dirOf(a, b) {
  return { dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
}
function lastItem(items) {
  if (!items || items.length === 0) return void 0;
  return items[items.length - 1];
}
const WEIGHTS = {
  routing: 0.25,
  naturalFit: 0.25,
  variety: 0.2,
  safety: 0.15,
  walkability: 0.15
};
const cache$1 = /* @__PURE__ */ new WeakMap();
const clamp$9 = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const distance$2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) });
function tee(hole) {
  return getTeeBox(hole, "member");
}
function green(hole) {
  return getPinPosition(hole, "A");
}
function route(hole) {
  const start = tee(hole);
  const end = green(hole);
  return start && end ? [start, ...hole.waypoints ?? [], end] : [];
}
function clubhouse(course) {
  const building = course.buildings.find((item) => item.type === "clubhouse");
  return building ? { x: building.x + 1, y: building.y + 1 } : null;
}
function angle(a, b) {
  const value = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return value < 0 ? value + 360 : value;
}
function angleDifference(a, b) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}
function orientation(a, b, c) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}
function segmentsCross(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function component(id, label, score, explanation, raw) {
  return { id, label, score: round(clamp$9(score)), weight: WEIGHTS[id], explanation, raw };
}
function routeSegments(hole) {
  const points = route(hole);
  return points.slice(1).map((point2, index) => [points[index], point2]);
}
function routedTransfer(course, from, to) {
  if (!course.estate) return { length: distance$2(from, to), path: [from, to] };
  const routed = findWalkPath(course, from, to, 1500);
  const path = routed ? [from, ...routed] : null;
  return { length: path ? computePathDistanceTiles(path) : distance$2(from, to) * 1.4, path };
}
function analyzeNaturalFit(course, warnings) {
  const expected = course.width * course.height;
  const terrain = course.estate ? decodeTerrainBaseline(course.estate.naturalBaseline.terrainRle, expected) : null;
  const elevation = course.estate ? decodeElevationBaseline(course.estate.naturalBaseline.elevationRle, expected) : null;
  if (!terrain || !elevation) return component("naturalFit", "Natural fit", 60, "No surveyed baseline is available, so natural fit is neutral.", { retainedTerrainPercent: 60, earthworkStepsPer100Tiles: 0 });
  let retained = 0;
  let earthwork = 0;
  let changed = 0;
  for (let index = 0; index < expected; index++) {
    if (course.tiles[index] === terrain[index]) retained++;
    else changed++;
    earthwork += Math.abs((course.elevations[index] ?? 0) - elevation[index]);
  }
  const retainedPercent = retained / expected * 100;
  const earthworkPer100 = earthwork / expected * 100;
  const score = retainedPercent * 0.72 + clamp$9(100 - earthworkPer100 * 13) * 0.28;
  if (earthworkPer100 > 2.5) warnings.push({ id: "earthwork-heavy", kind: "earthwork", severity: "warning", message: "Extensive earthwork weakens the course's relationship with its surveyed contours.", holeIds: [], measurement: `${round(earthworkPer100)} elevation steps per 100 tiles` });
  if (retainedPercent < 72) warnings.push({ id: "terrain-retention", kind: "terrain", severity: "info", message: "A large share of the natural surface has been rebuilt.", holeIds: [], measurement: `${round(retainedPercent)}% natural terrain retained` });
  return component("naturalFit", "Natural fit", score, `${round(retainedPercent)}% of surveyed terrain remains; earthwork averages ${round(earthworkPer100)} steps per 100 tiles.`, { retainedTerrainPercent: round(retainedPercent), changedTiles: changed, earthworkSteps: earthwork, earthworkStepsPer100Tiles: round(earthworkPer100) });
}
function analyzeVariety(course) {
  const holes = course.holes.filter((hole) => route(hole).length >= 2);
  const pars = /* @__PURE__ */ new Set();
  const lengthBands = /* @__PURE__ */ new Set();
  const directions = /* @__PURE__ */ new Set();
  const shapes = /* @__PURE__ */ new Set();
  const hazardMix = /* @__PURE__ */ new Set();
  const sceneryMix = /* @__PURE__ */ new Set();
  for (const hole of holes) {
    const points = route(hole);
    const length = computePathDistanceTiles(points);
    pars.add(hole.parMode === "MANUAL" && hole.parManual ? hole.parManual : computeAutoPar(length));
    lengthBands.add(length < 16 ? 0 : length < 28 ? 1 : length < 40 ? 2 : 3);
    directions.add(Math.floor(angle(points[0], points[points.length - 1]) / 45) % 8);
    const direct = distance$2(points[0], points[points.length - 1]);
    shapes.add(points.length > 2 && length > direct * 1.12 ? "dogleg" : "straight");
    for (const [a, b] of routeSegments(hole)) {
      const steps = Math.max(1, Math.ceil(distance$2(a, b)));
      for (let step = 0; step <= steps; step++) {
        const x = Math.max(0, Math.min(course.width - 1, Math.round(a.x + (b.x - a.x) * step / steps)));
        const y = Math.max(0, Math.min(course.height - 1, Math.round(a.y + (b.y - a.y) * step / steps)));
        const terrain = course.tiles[y * course.width + x];
        if (terrain === "water" || terrain === "wetland" || terrain === "sand" || terrain === "waste_area") hazardMix.add(terrain);
        if (terrain === "water" || terrain === "wetland" || terrain === "deep_rough" || terrain === "sand") sceneryMix.add(terrain);
      }
    }
  }
  const score = holes.length === 0 ? 0 : clamp$9(pars.size / 3 * 22 + lengthBands.size / 4 * 18 + directions.size / 6 * 24 + shapes.size / 2 * 14 + hazardMix.size / 4 * 12 + sceneryMix.size / 4 * 10);
  return component("variety", "Variety", score, `${pars.size} par types, ${lengthBands.size} length bands, ${directions.size} directions, and ${shapes.size} routing shapes create the playing mix.`, { parTypes: pars.size, lengthBands: lengthBands.size, directionBuckets: directions.size, shapeTypes: shapes.size, hazardTypes: hazardMix.size, sceneryTypes: sceneryMix.size });
}
function analyzeFlow(course, warnings) {
  const holes = course.holes.filter((hole) => route(hole).length >= 2);
  const home = clubhouse(course);
  const transfers = [];
  let routedTransfers = 0;
  for (let index = 0; index < holes.length - 1; index++) {
    const from = green(holes[index]);
    const to = tee(holes[index + 1]);
    const transfer = routedTransfer(course, from, to);
    const length = transfer.length;
    if (transfer.path) routedTransfers++;
    transfers.push(length);
    if (length > 18) warnings.push({ id: `transfer-${holes[index].id}-${holes[index + 1].id}`, kind: "transfer", severity: length > 30 ? "warning" : "info", message: `The transfer from ${holes[index].name ?? `hole ${index + 1}`} to ${holes[index + 1].name ?? `hole ${index + 2}`} is long.`, holeIds: [holes[index].id, holes[index + 1].id], location: midpoint(from, to), geometry: transfer.path ?? [from, to], measurement: `${round(length)} routed tiles` });
  }
  const firstDistance = home && holes.length ? routedTransfer(course, home, tee(holes[0])).length : 0;
  const finalDistance = home && holes.length ? routedTransfer(course, green(holes[holes.length - 1]), home).length : 0;
  const ninthDistance = home && holes.length >= 9 ? routedTransfer(course, green(holes[8]), home).length : 0;
  const averageTransfer = transfers.length ? transfers.reduce((sum, value) => sum + value, 0) / transfers.length : 0;
  const totalWalk = transfers.reduce((sum, value) => sum + value, 0) + firstDistance + finalDistance;
  const transferScore = clamp$9(100 - Math.max(0, averageTransfer - 6) * 3.2);
  const homeScore = home ? clamp$9(100 - (firstDistance + finalDistance) * 1.6 - Math.max(0, ninthDistance - 14) * 1.2) : 55;
  const compactScore = holes.length ? clamp$9(100 - totalWalk / holes.length * 2.1) : 0;
  const routingScore = transferScore * 0.42 + homeScore * 0.38 + compactScore * 0.2;
  const walkabilityScore = transferScore * 0.58 + compactScore * 0.27 + routedTransfers / Math.max(1, transfers.length) * 100 * 0.15;
  if (home && firstDistance > 18) warnings.push({ id: "clubhouse-first", kind: "clubhouse", severity: "warning", message: "The first tee sits far from the shared clubhouse.", holeIds: holes[0]?.id ? [holes[0].id] : [], location: tee(holes[0]), geometry: [home, tee(holes[0])], measurement: `${round(firstDistance)} routed tiles` });
  if (home && finalDistance > 18) warnings.push({ id: "clubhouse-final", kind: "clubhouse", severity: "warning", message: "The final green finishes far from the shared clubhouse.", holeIds: lastItem(holes)?.id ? [lastItem(holes).id] : [], location: green(lastItem(holes)), geometry: [green(lastItem(holes)), home], measurement: `${round(finalDistance)} routed tiles` });
  return {
    routing: component("routing", "Routing", routingScore, `Published order averages ${round(averageTransfer)} tiles between holes; first/final clubhouse access totals ${round(firstDistance + finalDistance)} tiles.`, { averageTransferTiles: round(averageTransfer), firstTeeClubhouseTiles: round(firstDistance), finalGreenClubhouseTiles: round(finalDistance), ninthGreenClubhouseTiles: round(ninthDistance), totalTransferTiles: round(totalWalk), compactnessScore: round(compactScore) }),
    walkability: component("walkability", "Walkability", walkabilityScore, `${routedTransfers} of ${transfers.length} green-to-tee transfers use playable routed paths; total off-hole walking is ${round(totalWalk)} tiles.`, { routedTransfers, transferCount: transfers.length, averageTransferTiles: round(averageTransfer), totalWalkingTiles: round(totalWalk) })
  };
}
function analyzeSafety(course, warnings) {
  const holes = course.holes.filter((hole) => route(hole).length >= 2);
  let crossings = 0;
  let parallels = 0;
  let repetitions = 0;
  for (let index = 1; index < holes.length; index++) {
    const previous = route(holes[index - 1]);
    const current = route(holes[index]);
    const directionDelta = angleDifference(angle(previous[0], lastItem(previous)), angle(current[0], lastItem(current)));
    const lengthDelta = Math.abs(computePathDistanceTiles(previous) - computePathDistanceTiles(current));
    if (directionDelta < 18 && lengthDelta < 5) {
      repetitions++;
      warnings.push({ id: `repeat-${holes[index - 1].id}-${holes[index].id}`, kind: "repetition", severity: "info", message: "Consecutive holes repeat a similar direction and length.", holeIds: [holes[index - 1].id, holes[index].id], location: midpoint(previous[0], current[0]), measurement: `${round(directionDelta)}° direction and ${round(lengthDelta)}-tile length difference` });
    }
  }
  for (let a = 0; a < holes.length; a++) for (let b = a + 1; b < holes.length; b++) {
    for (const [a0, a1] of routeSegments(holes[a])) for (const [b0, b1] of routeSegments(holes[b])) {
      if (segmentsCross(a0, a1, b0, b1)) {
        crossings++;
        const location = midpoint(midpoint(a0, a1), midpoint(b0, b1));
        warnings.push({ id: `cross-${holes[a].id}-${holes[b].id}-${crossings}`, kind: "crossing", severity: "warning", message: "Shot corridors cross and may expose golfers to play from another hole.", holeIds: [holes[a].id, holes[b].id], location, geometry: [a0, a1, b0, b1], measurement: `Hole ${a + 1} × hole ${b + 1}` });
      } else {
        const delta = angleDifference(angle(a0, a1), angle(b0, b1));
        const separation = distance$2(midpoint(a0, a1), midpoint(b0, b1));
        if (delta < 14 && separation < 6 && separation > 1.5) {
          parallels++;
          warnings.push({ id: `parallel-${holes[a].id}-${holes[b].id}-${parallels}`, kind: "parallel", severity: "warning", message: "Parallel shot corridors run close enough for wayward shots to overlap.", holeIds: [holes[a].id, holes[b].id], location: midpoint(midpoint(a0, a1), midpoint(b0, b1)), geometry: [a0, a1, b0, b1], measurement: `${round(separation)} tiles apart` });
        }
      }
    }
  }
  const score = clamp$9(100 - crossings * 18 - parallels * 8 - repetitions * 5);
  return component("safety", "Safety", score, `${crossings} corridor crossings, ${parallels} close parallel relationships, and ${repetitions} repetitive transitions were found.`, { crossings, parallelDangerZones: parallels, repetitions });
}
function analyzeArchitecture(course) {
  const cached = cache$1.get(course);
  if (cached) return cached;
  const completeCount = course.holes.filter((hole) => route(hole).length >= 2).length;
  if (completeCount < 9) {
    const pending = {
      total: 0,
      components: {
        routing: component("routing", "Routing", 0, "Complete a published nine to analyze routing.", { averageTransferTiles: 0, firstTeeClubhouseTiles: 0, finalGreenClubhouseTiles: 0, ninthGreenClubhouseTiles: 0, totalTransferTiles: 0, compactnessScore: 0 }),
        naturalFit: component("naturalFit", "Natural fit", 0, "Complete a published nine to compare construction with the survey.", { retainedTerrainPercent: 0, changedTiles: 0, earthworkSteps: 0, earthworkStepsPer100Tiles: 0 }),
        variety: component("variety", "Variety", 0, "Complete a published nine to analyze variety.", { parTypes: 0, lengthBands: 0, directionBuckets: 0, shapeTypes: 0, hazardTypes: 0, sceneryTypes: 0 }),
        safety: component("safety", "Safety", 0, "Complete a published nine to analyze safety.", { crossings: 0, parallelDangerZones: 0, repetitions: 0 }),
        walkability: component("walkability", "Walkability", 0, "Complete a published nine to analyze walking routes.", { routedTransfers: 0, transferCount: 0, averageTransferTiles: 0, totalWalkingTiles: 0 })
      },
      warnings: [],
      generatedFor: { courseId: course.activeCourseId, holeIds: course.holes.map((hole) => hole.id).filter(Boolean) }
    };
    cache$1.set(course, pending);
    return pending;
  }
  const warnings = [];
  const flow = analyzeFlow(course, warnings);
  const naturalFit = analyzeNaturalFit(course, warnings);
  const variety = analyzeVariety(course);
  const safety = analyzeSafety(course, warnings);
  const components = { routing: flow.routing, naturalFit, variety, safety, walkability: flow.walkability };
  const total = round(Object.values(components).reduce((sum, item) => sum + item.score * item.weight, 0));
  const report2 = { total, components, warnings: warnings.sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning") || a.id.localeCompare(b.id)), generatedFor: { courseId: course.activeCourseId, holeIds: course.holes.map((hole) => hole.id).filter(Boolean) } };
  cache$1.set(course, report2);
  return report2;
}
function architectureDemandMultiplier(course) {
  const score = analyzeArchitecture(course).total;
  const max = BALANCE.architecture.demandEffectMax;
  return 1 + (score - 50) / 50 * max;
}
function mulberry32(seed) {
  return function() {
    let t = seed += 1831565813;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const ARCHETYPES = {
  pro: {
    name: "pro",
    label: "Pro",
    color: "#f8fafc",
    weight: 0.4,
    personality: {
      skill: 0.95,
      consistency: 0.9,
      patience: 0.7,
      spendPropensity: 0.5,
      prefs: { difficulty: 0.6, scenery: 0.2, price: 0.3 },
      spread: 0.08
    }
  },
  lowHandicap: {
    name: "lowHandicap",
    label: "Low-handicap",
    color: "#38bdf8",
    weight: 1.6,
    personality: {
      skill: 0.8,
      consistency: 0.75,
      patience: 0.6,
      spendPropensity: 0.5,
      prefs: { difficulty: 0.4, scenery: 0.3, price: 0.1 },
      spread: 0.12
    }
  },
  casual: {
    name: "casual",
    label: "Casual",
    color: "#fbbf24",
    weight: 3,
    personality: {
      skill: 0.4,
      consistency: 0.45,
      patience: 0.4,
      spendPropensity: 0.7,
      prefs: { difficulty: -0.3, scenery: 0.4, price: -0.2 },
      spread: 0.18
    }
  },
  senior: {
    name: "senior",
    label: "Senior",
    color: "#a78bfa",
    weight: 1.6,
    personality: {
      skill: 0.5,
      consistency: 0.6,
      patience: 0.75,
      spendPropensity: 0.55,
      prefs: { difficulty: -0.2, scenery: 0.6, price: 0 },
      spread: 0.15
    }
  },
  junior: {
    name: "junior",
    label: "Junior",
    color: "#34d399",
    weight: 1,
    personality: {
      skill: 0.35,
      consistency: 0.35,
      patience: 0.3,
      spendPropensity: 0.4,
      prefs: { difficulty: 0.1, scenery: 0.1, price: -0.4 },
      spread: 0.2
    }
  },
  tourist: {
    name: "tourist",
    label: "Tourist",
    color: "#fb7185",
    weight: 1.2,
    personality: {
      skill: 0.4,
      consistency: 0.4,
      patience: 0.5,
      spendPropensity: 0.8,
      prefs: { difficulty: -0.1, scenery: 0.8, price: 0.2 },
      spread: 0.18
    }
  }
};
const FIRST_NAMES = [
  "Alex",
  "Sam",
  "Jordan",
  "Casey",
  "Riley",
  "Morgan",
  "Taylor",
  "Jamie",
  "Pat",
  "Drew",
  "Quinn",
  "Avery",
  "Robin",
  "Chris",
  "Dana",
  "Lee"
];
const LAST_INITIALS = "ABCDEFGHJKLMNPRSTW".split("");
function golferName(r1, r2) {
  const f = FIRST_NAMES[Math.floor(r1 * FIRST_NAMES.length) % FIRST_NAMES.length];
  const l = LAST_INITIALS[Math.floor(r2 * LAST_INITIALS.length) % LAST_INITIALS.length];
  return `${f} ${l}.`;
}
function clamp$8(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function estimateShotsToReachGreen(distanceYards, profile) {
  const clubs = profile.clubs.map((club) => club.carryYards).sort((a, b) => b - a);
  let remaining = Math.max(0, distanceYards);
  let shots = 0;
  let guard = 0;
  while (remaining > 5 && guard++ < 20) {
    const carry = clubs.find((c) => c <= remaining + 20) ?? clubs[clubs.length - 1];
    remaining = Math.max(0, remaining - carry);
    shots++;
  }
  return shots;
}
function hazardPenaltyStrokes(args) {
  const { waterFrac, sandFrac, wasteFrac, roughFrac, deepRoughFrac, obstaclePenalty, distanceYards, profile } = args;
  const distFactor = clamp$8(distanceYards / 480, 0.3, 1.4);
  const hazard = profile.ratingMultipliers.hazard * (2.2 * waterFrac + 0.9 * sandFrac + 0.62 * wasteFrac);
  const lie = profile.ratingMultipliers.rough * (0.9 * roughFrac) + profile.ratingMultipliers.deepRough * (1.2 * deepRoughFrac);
  const obst = profile.ratingMultipliers.obstacle * obstaclePenalty;
  const raw = distFactor * (hazard + lie + obst);
  return clamp$8(raw * 1.4, 0, 2.5);
}
function computeExpectedScoreForHole(course, holeIndex, profile, summary, puttingPenalty = 0) {
  const h = summary.holes[holeIndex];
  if (!h || !h.isComplete || !h.isValid) {
    return profile.name === "BOGEY" ? 9 : 7;
  }
  const yardsPerTile = course.yardsPerTile ?? 10;
  const distanceYards = h.effectiveDistance * yardsPerTile;
  const s = h.corridor.samples || 1;
  const waterFrac = (h.corridor.water + h.corridor.wetland) / s;
  const sandFrac = h.corridor.sand / s;
  const wasteFrac = h.corridor.waste_area / s;
  const roughFrac = h.corridor.rough / s;
  const deepRoughFrac = h.corridor.deep_rough / s;
  const obstaclePenalty = clamp$8((h.difficultyScore - 45) / 100, 0, 1);
  const baseShots = estimateShotsToReachGreen(distanceYards, profile);
  const penalty = hazardPenaltyStrokes({
    waterFrac,
    sandFrac,
    wasteFrac,
    roughFrac,
    deepRoughFrac,
    obstaclePenalty,
    distanceYards,
    profile
  });
  const puttingBaseline = 2;
  const sensitivity = profile.name === "BOGEY" ? BALANCE.courseSetup.pinDifficulty.bogeySensitivity : 1;
  const expected = baseShots + penalty + puttingBaseline + puttingPenalty * sensitivity;
  return expected;
}
function inBounds$1(course, point2) {
  return point2.x >= 0 && point2.y >= 0 && point2.x < course.width && point2.y < course.height;
}
function pinDifficultyPenalty(course, pin) {
  if (!pin || !inBounds$1(course, pin)) return 0;
  const cfg = BALANCE.courseSetup.pinDifficulty;
  let nearestNonGreen = cfg.edgeRadiusTiles;
  let adjacentHazards = 0;
  let elevationChange = 0;
  const pinElevation = course.elevations[pin.y * course.width + pin.x] ?? 0;
  for (let dy = -cfg.edgeRadiusTiles; dy <= cfg.edgeRadiusTiles; dy++) {
    for (let dx = -cfg.edgeRadiusTiles; dx <= cfg.edgeRadiusTiles; dx++) {
      if (dx === 0 && dy === 0) continue;
      const point2 = { x: pin.x + dx, y: pin.y + dy };
      if (!inBounds$1(course, point2)) continue;
      const distance2 = Math.hypot(dx, dy);
      const index = point2.y * course.width + point2.x;
      const terrain = course.tiles[index];
      if (terrain !== "green") nearestNonGreen = Math.min(nearestNonGreen, distance2);
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (terrain === "water" || terrain === "wetland" || terrain === "sand")) adjacentHazards++;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) elevationChange = Math.max(elevationChange, Math.abs((course.elevations[index] ?? 0) - pinElevation));
    }
  }
  const edge = clamp$8(1 - nearestNonGreen / cfg.edgeRadiusTiles, 0, 1) * cfg.edgePenaltyMax;
  const hazard = adjacentHazards * cfg.adjacentHazardPenalty;
  const elevation = elevationChange * cfg.elevationPenaltyPerStep;
  return clamp$8(edge + hazard + elevation, 0, cfg.penaltyCap);
}
function courseForSetup(course, teeSet, pinRotation) {
  return courseForCourseSetup(course, teeSet, pinRotation);
}
function round1(value) {
  return Math.round(value * 10) / 10;
}
const ratingGeometryCache = /* @__PURE__ */ new WeakMap();
const holeSignatureCache = /* @__PURE__ */ new WeakMap();
function ratingHoleSignature(course) {
  const cached = holeSignatureCache.get(course.holes);
  if (cached) return cached;
  const point2 = (value) => value ? `${value.x},${value.y}` : "-";
  const signature = course.holes.map((hole) => [
    ...TEE_SETS.map((teeSet) => point2(getTeeBox(hole, teeSet))),
    ...PIN_ROTATIONS.map((pinRotation) => point2(getPinPosition(hole, pinRotation))),
    ...TEE_SETS.map((teeSet) => {
      const par = hole.parByTee?.[teeSet];
      if (par?.mode === "MANUAL") return `M${par.par}`;
      if (par?.mode === "AUTO") return "A";
      if (teeSet === "member" && hole.parMode === "MANUAL") return `M${hole.parManual ?? 4}`;
      return "A";
    })
  ].join("|")).join(";");
  holeSignatureCache.set(course.holes, signature);
  return signature;
}
function ratingGeometry(course) {
  const entries = ratingGeometryCache.get(course.tiles) ?? [];
  if (entries.length === 0) ratingGeometryCache.set(course.tiles, entries);
  const holeSignature = ratingHoleSignature(course);
  const yardsPerTile = course.yardsPerTile ?? 10;
  const cached = entries.find(
    (entry) => entry.elevations === course.elevations && entry.obstacles === course.obstacles && entry.width === course.width && entry.height === course.height && entry.yardsPerTile === yardsPerTile && entry.holeSignature === holeSignature
  );
  if (cached) return cached;
  const created = {
    elevations: course.elevations,
    obstacles: course.obstacles,
    width: course.width,
    height: course.height,
    yardsPerTile,
    holeSignature,
    setups: /* @__PURE__ */ new Map()
  };
  entries.push(created);
  return created;
}
function computeRatingForSetup(course, teeSet, pinRotation) {
  const setups = ratingGeometry(course).setups;
  const cacheKey = `${teeSet}:${pinRotation}`;
  const cached = setups.get(cacheKey);
  if (cached) return cached;
  const setupCourse = courseForSetup(course, teeSet, pinRotation);
  const holeSummary = scoreCourseHoles(setupCourse);
  const scratch = getGolferProfile("SCRATCH", setupCourse);
  const bogey = getGolferProfile("BOGEY", setupCourse);
  const holesUsed = holeSummary.holes.length >= 18 ? 18 : 9;
  let scratchTotal = 0;
  let bogeyTotal = 0;
  let effectiveYardage = 0;
  let pinDelta = 0;
  let validHoles = 0;
  let setupComplete = true;
  for (let i = 0; i < Math.min(holesUsed, course.holes.length); i++) {
    const original = course.holes[i];
    const tee2 = getTeeBox(original, teeSet);
    const pin = getPinPosition(original, pinRotation);
    if (!tee2 || !pin) setupComplete = false;
    const penalty = pinDifficultyPenalty(setupCourse, pin);
    const info = holeSummary.holes[i];
    scratchTotal += computeExpectedScoreForHole(setupCourse, i, scratch, holeSummary, penalty);
    bogeyTotal += computeExpectedScoreForHole(setupCourse, i, bogey, holeSummary, penalty);
    if (info?.isComplete && info.isValid && tee2 && pin) {
      validHoles++;
      effectiveYardage += info.effectiveDistance * setupCourse.yardsPerTile;
      pinDelta += penalty;
    }
  }
  const mult = holesUsed === 9 ? 2 : 1;
  const expectedScratchScore = scratchTotal * mult;
  const expectedBogeyScore = bogeyTotal * mult;
  const slopeRaw = expectedBogeyScore - expectedScratchScore;
  const result = {
    teeSet,
    pinRotation,
    holesUsed,
    expectedScratchScore: round1(expectedScratchScore),
    expectedBogeyScore: round1(expectedBogeyScore),
    courseRating: round1(expectedScratchScore),
    slopeRaw: round1(slopeRaw),
    slope: Math.round(clamp$8(113 * slopeRaw / 20, 55, 155)),
    effectiveYardage: Math.round(effectiveYardage * mult),
    setupComplete: setupComplete && validHoles === Math.min(holesUsed, course.holes.length),
    validHoles,
    pinDifficultyDelta: round1(pinDelta * mult)
  };
  setups.set(cacheKey, result);
  return result;
}
function averageSetups(teeSet, setups) {
  const average2 = (key2) => setups.reduce((sum, setup) => sum + Number(setup[key2]), 0) / setups.length;
  const baseline = setups[0];
  const publishedRating = average2("courseRating");
  return {
    teeSet,
    holesUsed: baseline.holesUsed,
    expectedScratchScore: round1(average2("expectedScratchScore")),
    expectedBogeyScore: round1(average2("expectedBogeyScore")),
    courseRating: round1(publishedRating),
    slopeRaw: round1(average2("slopeRaw")),
    slope: Math.round(average2("slope")),
    effectiveYardage: Math.round(setups.reduce((sum, setup) => sum + setup.effectiveYardage, 0) / setups.length),
    setupComplete: setups.length === PIN_ROTATIONS.length && setups.every((setup) => setup.setupComplete),
    rotationsUsed: setups.map((setup) => setup.pinRotation),
    rotationDeltas: Object.fromEntries(setups.map((setup) => [setup.pinRotation, round1(setup.courseRating - publishedRating)])),
    setups: Object.fromEntries(setups.map((setup) => [setup.pinRotation, setup]))
  };
}
function emptyPublishedRating(course, teeSet) {
  return {
    teeSet,
    holesUsed: course.holes.length >= 18 ? 18 : 9,
    expectedScratchScore: 0,
    expectedBogeyScore: 0,
    courseRating: 0,
    slopeRaw: 0,
    slope: 55,
    effectiveYardage: 0,
    setupComplete: false,
    rotationsUsed: [],
    rotationDeltas: {},
    setups: {}
  };
}
function computeRatingsByTee(course) {
  const geometry = ratingGeometry(course);
  const cached = geometry.ratings;
  if (cached) return cached;
  const result = Object.fromEntries(TEE_SETS.map((teeSet) => {
    const configuredRotations = PIN_ROTATIONS.filter((rotation) => course.holes.some((hole) => getTeeBox(hole, teeSet) && getPinPosition(hole, rotation)));
    if (configuredRotations.length === 0) return [teeSet, emptyPublishedRating(course, teeSet)];
    return [teeSet, averageSetups(teeSet, configuredRotations.map((rotation) => computeRatingForSetup(course, teeSet, rotation)))];
  }));
  geometry.ratings = result;
  return result;
}
function computeCourseRatingAndSlope(course) {
  const geometry = ratingGeometry(course);
  const cached = geometry.rating;
  if (cached) return cached;
  const member = computeRatingsByTee(course).member;
  const result = {
    holesUsed: member.holesUsed,
    expectedScratchScore: member.expectedScratchScore,
    expectedBogeyScore: member.expectedBogeyScore,
    courseRating: member.courseRating,
    slopeRaw: member.slopeRaw,
    slope: member.slope
  };
  geometry.rating = result;
  return result;
}
const TOURNAMENT_COURSE_STANDARDS = {
  local: { teeSet: "member", rotationChoice: "easiest", minimumCompleteRotations: 1, rating: [64, 74.9], slope: [80, 130] },
  regional: { teeSet: "championship", rotationChoice: "median", minimumCompleteRotations: 2, rating: [68, 76.9], slope: [100, 145] },
  championship: { teeSet: "championship", rotationChoice: "hardest", minimumCompleteRotations: 3, rating: [72, 80], slope: [120, 155] }
};
const qualificationCache = /* @__PURE__ */ new WeakMap();
function meetsTournamentRange(value, bounds) {
  return value >= bounds[0] && value <= bounds[1];
}
function rangeLabel(bounds) {
  return `${bounds[0].toFixed(1)}–${bounds[1].toFixed(1)}`;
}
function requirement(requirement2) {
  return requirement2;
}
function chooseSetup(setups, choice2) {
  const sorted = [...setups].sort(
    (a, b) => a.courseRating - b.courseRating || a.pinDifficultyDelta - b.pinDifficultyDelta || PIN_ROTATIONS.indexOf(a.pinRotation) - PIN_ROTATIONS.indexOf(b.pinRotation)
  );
  if (choice2 === "easiest") return sorted[0];
  if (choice2 === "hardest") return lastItem(sorted);
  return sorted[Math.floor(sorted.length / 2)];
}
function evaluateTournamentCourseQualification(course, tier) {
  const cached = qualificationCache.get(course)?.[tier];
  if (cached) return cached;
  const standard = TOURNAMENT_COURSE_STANDARDS[tier];
  const setups = PIN_ROTATIONS.map((rotation) => computeRatingForSetup(course, standard.teeSet, rotation));
  const complete = setups.filter((setup) => setup.setupComplete);
  const chosen = chooseSetup(complete, standard.rotationChoice) ?? setups[0];
  const completeHoles = course.holes.filter((hole) => hole.tee && hole.green).length;
  const holePass = completeHoles >= 9;
  const rotationsPass = complete.length >= standard.minimumCompleteRotations;
  const routePass = !!chosen?.setupComplete;
  const ratingValue = chosen?.courseRating ?? 0;
  const slopeValue = chosen?.slope ?? 55;
  const ratingPass = routePass && meetsTournamentRange(ratingValue, standard.rating);
  const slopePass = routePass && meetsTournamentRange(slopeValue, standard.slope);
  const requirements = [
    requirement({ id: "holes", label: "Open course", passed: holePass, current: `${completeHoles} complete holes`, required: "9 or 18 complete holes", guidance: "Finish at least nine playable holes." }),
    requirement({ id: "rotations", label: "Pin rotations", passed: rotationsPass, current: `${complete.length} complete`, required: `${standard.minimumCompleteRotations} complete`, guidance: `Configure valid ${standard.teeSet} tee-to-pin routes on every hole.` }),
    requirement({ id: "route", label: "Prescribed route", passed: routePass, current: routePass ? `${standard.teeSet} / Pin ${chosen.pinRotation}` : "No complete route", required: `${standard.teeSet} tee route`, guidance: `Repair every invalid ${standard.teeSet} tee-to-pin corridor.` }),
    requirement({ id: "rating", label: "Course rating", passed: ratingPass, current: ratingValue.toFixed(1), required: rangeLabel(standard.rating), guidance: ratingValue < standard.rating[0] ? "Add strategic length or difficulty to the prescribed setup." : "Reduce excessive length or difficulty in the prescribed setup." }),
    requirement({ id: "slope", label: "Slope", passed: slopePass, current: `${slopeValue}`, required: `${standard.slope[0]}–${standard.slope[1]}`, guidance: slopeValue < standard.slope[0] ? "Add challenge that affects bogey golfers without overwhelming scratch golfers." : "Ease hazards and forced carries that disproportionately punish bogey golfers." })
  ];
  const result = {
    eligible: requirements.every((item) => item.passed),
    teeSet: standard.teeSet,
    pinRotation: chosen?.pinRotation ?? "A",
    rating: ratingValue,
    slope: slopeValue,
    effectiveYardage: chosen?.effectiveYardage ?? 0,
    completeRotations: complete.map((setup) => setup.pinRotation),
    requirements,
    blockingReasons: requirements.filter((item) => !item.passed).map((item) => `${item.label}: ${item.current}; requires ${item.required}. ${item.guidance}`)
  };
  const courseCache = qualificationCache.get(course) ?? {};
  courseCache[tier] = result;
  qualificationCache.set(course, courseCache);
  return result;
}
function evaluateTournamentEligibility(args) {
  const courseResult = evaluateTournamentCourseQualification(args.course, args.tier);
  const absolute = (Math.max(1, args.world.week) - 1) * 7 + args.currentDay + Math.max(1, Math.floor(args.daysAhead));
  const targetWeek = Math.floor(absolute / 7) + 1;
  const targetDay = absolute % 7;
  const events = args.world.tournaments?.events ?? [];
  const commercial = [
    requirement({ id: "reputation", label: "Reputation", passed: args.world.reputation >= args.minReputation, current: `${Math.round(args.world.reputation)}`, required: `${args.minReputation}`, guidance: "Improve golfer satisfaction and complete successful rounds." }),
    requirement({ id: "deposit", label: "Hosting deposit", passed: args.world.cash >= args.bookingCost, current: `$${Math.floor(args.world.cash).toLocaleString("en-US")}`, required: `$${args.bookingCost.toLocaleString("en-US")}`, guidance: "Build enough cash reserves to cover the non-refundable deposit." }),
    requirement({ id: "date", label: "Event date", passed: args.daysAhead >= 1, current: `${args.daysAhead} days ahead`, required: "A future date", guidance: "Choose tomorrow or a later date." }),
    requirement({ id: "calendar", label: "Calendar", passed: !events.some((event2) => event2.status === "scheduled" && event2.scheduledWeek === targetWeek && event2.scheduledDay === targetDay), current: `Week ${targetWeek}, day ${targetDay + 1}`, required: "An open date", guidance: "Choose a date without another scheduled tournament." })
  ];
  const requirements = [...commercial, ...courseResult.requirements];
  return {
    ...courseResult,
    eligible: requirements.every((item) => item.passed),
    requirements,
    blockingReasons: requirements.filter((item) => !item.passed).map((item) => `${item.label}: ${item.current}; requires ${item.required}. ${item.guidance}`)
  };
}
const TOURNAMENT_TIERS = {
  local: { label: "Club Open", fieldSize: 8, minReputation: 25, bookingCost: 1500, revenueAward: 6e3, reputationAward: 2, skillMin: 0.42, skillMax: 0.72 },
  regional: { label: "Regional Invitational", fieldSize: 12, minReputation: 45, bookingCost: 3500, revenueAward: 14e3, reputationAward: 4, skillMin: 0.62, skillMax: 0.88 },
  championship: { label: "CourseCraft Championship", fieldSize: 16, minReputation: 65, bookingCost: 7e3, revenueAward: 3e4, reputationAward: 7, skillMin: 0.78, skillMax: 0.99 }
};
const EMPTY_CALENDAR = { version: 2, events: [] };
function tournamentCalendar(world) {
  return world.tournaments ?? EMPTY_CALENDAR;
}
function absoluteGameDay(week, dayIndex) {
  return (Math.max(1, Math.floor(week)) - 1) * 7 + Math.max(0, Math.min(6, Math.floor(dayIndex)));
}
function gameDateAfter(week, dayIndex, daysAhead) {
  const absolute = absoluteGameDay(week, dayIndex) + Math.max(1, Math.floor(daysAhead));
  return { week: Math.floor(absolute / 7) + 1, day: absolute % 7 };
}
function archetypeForTier(tier, roll) {
  if (tier === "championship") return roll < 0.68 ? "pro" : "lowHandicap";
  if (tier === "regional") return roll < 0.18 ? "pro" : roll < 0.8 ? "lowHandicap" : "casual";
  return roll < 0.1 ? "pro" : roll < 0.42 ? "lowHandicap" : roll < 0.78 ? "casual" : "senior";
}
function eventSeed(world, tier, week, day) {
  const tierOffset = tier === "local" ? 101 : tier === "regional" ? 503 : 997;
  return (world.runSeed | 0) + week * 7919 + day * 431 + tierOffset;
}
function createTournamentEvent(args) {
  const spec2 = TOURNAMENT_TIERS[args.tier];
  const layout = layoutById(args.course, args.courseId);
  if (!layout || layout.state !== "open" || layout.publishedHoleIds.length !== 18) {
    return { ok: false, reason: "Tournament hosts must be an open, published 18-hole course." };
  }
  const hostCourse = layout ? courseForLayout(args.course, layout.id) : args.course;
  const qualification = evaluateTournamentEligibility({
    course: hostCourse,
    world: args.world,
    tier: args.tier,
    currentDay: args.currentDay,
    daysAhead: args.daysAhead,
    minReputation: spec2.minReputation,
    bookingCost: spec2.bookingCost
  });
  if (!qualification.eligible) return { ok: false, reason: qualification.blockingReasons[0] ?? "This course does not meet the event standard." };
  const date = gameDateAfter(args.world.week, args.currentDay, args.daysAhead);
  const seed = eventSeed(args.world, args.tier, date.week, date.day);
  const rng = mulberry32(seed);
  const field = Array.from({ length: spec2.fieldSize }, (_, index) => ({
    id: `entrant-${seed}-${index + 1}`,
    name: golferName(rng(), rng()),
    archetype: archetypeForTier(args.tier, rng()),
    skill: spec2.skillMin + rng() * (spec2.skillMax - spec2.skillMin)
  }));
  const id = `tournament-${seed}`;
  const eventName = args.tier === "local" ? `${hostCourse.name} Open` : args.tier === "regional" ? `${hostCourse.name} Regional Invitational` : `${hostCourse.name} Championship`;
  return {
    ok: true,
    event: {
      id,
      name: eventName,
      tier: args.tier,
      courseId: layout?.id,
      courseName: hostCourse.name,
      holeIds: hostCourse.holes.map((hole) => hole.id).filter(Boolean),
      scheduledWeek: date.week,
      scheduledDay: date.day,
      status: "scheduled",
      bookingCost: spec2.bookingCost,
      revenueAward: spec2.revenueAward,
      reputationAward: spec2.reputationAward,
      field,
      teeSet: qualification.teeSet,
      pinRotation: qualification.pinRotation,
      qualificationSnapshot: qualification,
      currentQualification: qualification
    }
  };
}
function scheduleTournament(world, event2) {
  const calendar = tournamentCalendar(world);
  if (world.cash < event2.bookingCost || calendar.events.some(
    (candidate) => candidate.id === event2.id || candidate.status === "scheduled" && candidate.scheduledWeek === event2.scheduledWeek && candidate.scheduledDay === event2.scheduledDay
  )) return world;
  return {
    ...world,
    cash: world.cash - event2.bookingCost,
    tournaments: { version: 2, events: [...calendar.events, event2] }
  };
}
function tournamentForDate(world, dayIndex, course) {
  const event2 = tournamentCalendar(world).events.find(
    (event22) => event22.status === "scheduled" && event22.scheduledWeek === world.week && event22.scheduledDay === dayIndex
  );
  if (!event2 || !course) return event2;
  if (event2.courseId && layoutById(course, event2.courseId)?.state !== "open") return void 0;
  const host = event2.courseId ? courseForLayout(course, event2.courseId) : course;
  return evaluateTournamentCourseQualification(host, event2.tier).eligible ? event2 : void 0;
}
function planTournamentDay(event2, openMinute, teeGapMinutes, groupSize = 3) {
  const size = Math.max(2, Math.min(4, Math.floor(groupSize)));
  return event2.field.map((entrant, index) => ({
    atMinute: openMinute + Math.floor(index / size) * teeGapMinutes,
    archetype: entrant.archetype,
    courseId: event2.courseId,
    groupId: `${event2.id}-group-${Math.floor(index / size) + 1}`,
    tournament: {
      eventId: event2.id,
      entrantId: entrant.id,
      name: entrant.name,
      skill: entrant.skill,
      teeSet: event2.teeSet ?? "member",
      pinRotation: event2.pinRotation ?? "A"
    }
  }));
}
function createLiveTournament(event2, course) {
  const host = event2.courseId ? courseForLayout(course, event2.courseId) : course;
  const qualification = event2.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event2.tier);
  return {
    eventId: event2.id,
    name: event2.name,
    tier: event2.tier,
    courseId: event2.courseId,
    teeSet: event2.teeSet ?? qualification.teeSet,
    pinRotation: event2.pinRotation ?? qualification.pinRotation,
    ordinaryPinRotation: course.activePinRotation ?? "A",
    qualificationSnapshot: qualification,
    standings: event2.field.map((entrant) => ({
      entrantId: entrant.id,
      golferId: null,
      name: entrant.name,
      archetype: entrant.archetype,
      holesCompleted: 0,
      score: 0,
      scoreToPar: 0,
      finished: false
    }))
  };
}
function updateTournamentStanding(tournament2, golfer2) {
  if (!golfer2.tournamentEntrantId) return;
  const standing = tournament2.standings.find((row) => row.entrantId === golfer2.tournamentEntrantId);
  if (!standing) return;
  standing.golferId = golfer2.id;
  standing.holesCompleted = golfer2.scoredHoles;
  standing.score = golfer2.strokes;
  standing.scoreToPar = golfer2.scoreToPar;
  standing.finished = golfer2.finished;
}
function sortedStandings(rows) {
  return [...rows].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.scoreToPar !== b.scoreToPar) return a.scoreToPar - b.scoreToPar;
    if (a.holesCompleted !== b.holesCompleted) return b.holesCompleted - a.holesCompleted;
    return a.name.localeCompare(b.name);
  });
}
function completeTournament(world, live) {
  const active = live.tournament;
  if (!active) return { world, revenue: 0, reputation: 0 };
  const calendar = tournamentCalendar(world);
  const event2 = calendar.events.find((candidate) => candidate.id === active.eventId);
  if (!event2 || event2.status === "completed") return { world, revenue: 0, reputation: 0, event: event2 };
  const results = sortedStandings(active.standings);
  const completed = { ...event2, status: "completed", results, winnerName: results[0]?.name };
  return {
    world: {
      ...world,
      tournaments: { version: 2, events: calendar.events.map((candidate) => candidate.id === event2.id ? completed : candidate) }
    },
    revenue: event2.revenueAward,
    reputation: event2.reputationAward,
    event: completed
  };
}
const choice = (id, effects, labelKey = `story.choice.${id}`, uncertain = false) => ({
  id,
  labelKey,
  previewKey: `story.preview.${id}`,
  uncertain,
  effects
});
const predicate = (fact2, op, value) => ({ fact: fact2, op, value });
function event(id, category, priority, participantRoles, predicates, choices, extra = {}) {
  return {
    id,
    titleKey: `story.event.${id}.title`,
    bodyKey: `story.event.${id}.body`,
    category,
    priority,
    cooldownWeeks: extra.cooldownWeeks ?? 8,
    predicates,
    participantRoles,
    choices,
    defaultChoiceId: extra.defaultChoiceId ?? choices[0].id,
    expiresAfterWeeks: extra.expiresAfterWeeks ?? (priority === "major" ? 2 : 1),
    testFixture: `${id}-fixture`,
    ...extra
  };
}
const SYSTEMIC_EVENT_DEFINITIONS = [
  event("regular-welcome", "golf", "notable", ["regular"], [predicate("regularCount", "gte", 1)], [
    choice("play", [{ type: "relationship", target: "regular", amount: 8 }, { type: "memory", target: "regular", summaryKey: "story.memory.firstRound" }, { type: "scheduleCallback", eventId: "regular-rematch", delayWeeks: 2 }]),
    choice("listen", [{ type: "relationship", target: "regular", amount: 5 }, { type: "reputation", amount: 1 }, { type: "scheduleCallback", eventId: "regular-rematch", delayWeeks: 3 }])
  ], { chainId: "regular-mentor", stage: 1 }),
  event("regular-rematch", "golf", "major", ["regular", "playerPro"], [], [
    choice("accept", [{ type: "relationship", target: "regular", amount: 10 }, { type: "reputation", amount: 2 }, { type: "memory", target: "regular", summaryKey: "story.memory.rematch" }]),
    choice("defer", [{ type: "relationship", target: "regular", amount: -2 }])
  ], { callbackOnly: true, chainId: "regular-mentor", stage: 2 }),
  event("superintendent-concern", "staff", "major", ["staff"], [predicate("condition", "lte", 65)], [
    choice("invest", [{ type: "cash", amount: -1800 }, { type: "condition", amount: 0.07 }, { type: "staffMorale", target: "staff", amount: 8 }, { type: "scheduleCallback", eventId: "superintendent-result", delayWeeks: 2 }]),
    choice("acceptRisk", [{ type: "staffMorale", target: "staff", amount: -7 }, { type: "scheduleCallback", eventId: "superintendent-result", delayWeeks: 1 }], void 0, true)
  ], { chainId: "grounds-team", stage: 1 }),
  event("superintendent-result", "staff", "notable", ["staff"], [], [
    choice("recognize", [{ type: "cash", amount: -350 }, { type: "staffMorale", target: "staff", amount: 7 }, { type: "memory", target: "staff", summaryKey: "story.memory.groundsTeam" }]),
    choice("thank", [{ type: "staffMorale", target: "staff", amount: 3 }])
  ], { callbackOnly: true, chainId: "grounds-team", stage: 2 }),
  event("community-access-request", "community", "major", ["regular"], [predicate("reputation", "gte", 35)], [
    choice("support", [{ type: "cash", amount: -700 }, { type: "reputation", amount: 3 }, { type: "relationship", target: "regular", amount: 6 }, { type: "scheduleCallback", eventId: "community-access-followup", delayWeeks: 3 }]),
    choice("compromise", [{ type: "cash", amount: -250 }, { type: "reputation", amount: 1 }, { type: "scheduleCallback", eventId: "community-access-followup", delayWeeks: 4 }])
  ], { chainId: "community-access", stage: 1, mutexGroup: "community-policy" }),
  event("community-access-followup", "community", "notable", ["regular"], [], [
    choice("celebrate", [{ type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 5 }, { type: "memory", target: "regular", summaryKey: "story.memory.accessDay" }]),
    choice("measure", [{ type: "reputation", amount: 1 }])
  ], { callbackOnly: true, chainId: "community-access", stage: 2 }),
  event("sponsor-offer", "finance", "major", ["staff"], [predicate("reputation", "gte", 50), predicate("cash", "lte", 6e4)], [
    choice("accept", [{ type: "cash", amount: 4500 }, { type: "reputation", amount: -1 }, { type: "scheduleCallback", eventId: "sponsor-renewal", delayWeeks: 5 }], void 0, true),
    choice("decline", [{ type: "reputation", amount: 1 }])
  ], { chainId: "sponsor-partnership", stage: 1, mutexGroup: "finance-partner" }),
  event("sponsor-renewal", "finance", "notable", ["staff"], [], [
    choice("renew", [{ type: "cash", amount: 2500 }, { type: "staffMorale", target: "staff", amount: -2 }]),
    choice("decline", [{ type: "reputation", amount: 2 }, { type: "staffMorale", target: "staff", amount: 2 }])
  ], { callbackOnly: true, chainId: "sponsor-partnership", stage: 2 }),
  event("chef-market-night", "hospitality", "notable", ["staff"], [predicate("staffCount", "gte", 2), predicate("cash", "gte", 2500)], [
    choice("invest", [{ type: "cash", amount: -1100 }, { type: "reputation", amount: 2 }, { type: "staffMorale", target: "staff", amount: 5 }, { type: "scheduleCallback", eventId: "chef-return", delayWeeks: 2 }]),
    choice("pilot", [{ type: "cash", amount: -450 }, { type: "reputation", amount: 1 }, { type: "scheduleCallback", eventId: "chef-return", delayWeeks: 3 }], void 0, true)
  ], { chainId: "hospitality-table", stage: 1 }),
  event("chef-return", "hospitality", "routine", ["staff"], [], [
    choice("expand", [{ type: "cash", amount: 900 }, { type: "staffMorale", target: "staff", amount: 3 }]),
    choice("keepSmall", [{ type: "reputation", amount: 1 }])
  ], { callbackOnly: true, chainId: "hospitality-table", stage: 2 }),
  event("safety-warning", "safety", "major", ["staff"], [predicate("openClaims", "gte", 1)], [
    choice("invest", [{ type: "cash", amount: -2400 }, { type: "reputation", amount: 1 }, { type: "staffMorale", target: "staff", amount: 4 }, { type: "scheduleCallback", eventId: "safety-review", delayWeeks: 2 }]),
    choice("acceptRisk", [{ type: "reputation", amount: -3 }, { type: "staffMorale", target: "staff", amount: -5 }, { type: "scheduleCallback", eventId: "safety-review", delayWeeks: 1 }], void 0, true)
  ], { chainId: "safety-culture", stage: 1, mutexGroup: "safety-response" }),
  event("safety-review", "safety", "notable", ["staff"], [], [
    choice("publish", [{ type: "reputation", amount: 2 }, { type: "memory", target: "staff", summaryKey: "story.memory.safetyReview" }]),
    choice("internal", [{ type: "staffMorale", target: "allStaff", amount: 2 }])
  ], { callbackOnly: true, chainId: "safety-culture", stage: 2 }),
  event("course-record-celebration", "golf", "routine", ["regular"], [predicate("regularCount", "gte", 2)], [
    choice("celebrate", [{ type: "cash", amount: -200 }, { type: "relationship", target: "regular", amount: 4 }, { type: "reputation", amount: 1 }]),
    choice("recognize", [{ type: "relationship", target: "regular", amount: 3 }])
  ]),
  event("junior-clinic", "community", "notable", ["staff"], [predicate("staffCount", "gte", 2), predicate("cash", "gte", 1e3)], [
    choice("support", [{ type: "cash", amount: -650 }, { type: "reputation", amount: 2 }, { type: "staffMorale", target: "staff", amount: 3 }]),
    choice("defer", [{ type: "reputation", amount: -1 }])
  ]),
  event("turf-recovery-window", "property", "notable", ["staff"], [predicate("condition", "lte", 72), predicate("cash", "gte", 1500)], [
    choice("invest", [{ type: "cash", amount: -1400 }, { type: "condition", amount: 0.06 }, { type: "staffMorale", target: "staff", amount: 4 }]),
    choice("acceptRisk", [{ type: "condition", amount: -0.02 }], void 0, true)
  ]),
  event("green-speed-debate", "golf", "routine", ["regular", "staff"], [predicate("regularCount", "gte", 1), predicate("staffCount", "gte", 1)], [
    choice("listen", [{ type: "relationship", target: "regular", amount: 3 }, { type: "staffMorale", target: "staff", amount: 2 }]),
    choice("competitive", [{ type: "relationship", target: "regular", amount: -1 }, { type: "reputation", amount: 1 }])
  ]),
  event("staff-training-slot", "staff", "routine", ["staff"], [predicate("cash", "gte", 900), predicate("averageStaffMorale", "gte", 45)], [
    choice("invest", [{ type: "cash", amount: -850 }, { type: "staffMorale", target: "staff", amount: 6 }, { type: "memory", target: "staff", summaryKey: "story.memory.training" }]),
    choice("defer", [])
  ]),
  event("member-price-feedback", "finance", "notable", ["regular"], [predicate("reputation", "gte", 55), predicate("regularCount", "gte", 2)], [
    choice("listen", [{ type: "relationship", target: "regular", amount: 4 }, { type: "reputation", amount: 1 }]),
    choice("holdLine", [{ type: "cash", amount: 700 }, { type: "relationship", target: "regular", amount: -3 }], void 0, true)
  ]),
  event("hospitality-overflow", "hospitality", "routine", ["staff"], [predicate("reputation", "gte", 45), predicate("staffCount", "lte", 3)], [
    choice("support", [{ type: "cash", amount: -500 }, { type: "staffMorale", target: "allStaff", amount: 4 }]),
    choice("acceptRisk", [{ type: "reputation", amount: -1 }, { type: "staffMorale", target: "allStaff", amount: -3 }])
  ]),
  event("tournament-volunteers", "tournament", "notable", ["regular", "staff"], [predicate("scheduledTournaments", "gte", 1)], [
    choice("support", [{ type: "cash", amount: -550 }, { type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 3 }]),
    choice("staffOnly", [{ type: "staffMorale", target: "allStaff", amount: -4 }])
  ]),
  event("local-paper-profile", "community", "routine", ["regular"], [predicate("reputation", "gte", 60), predicate("regularCount", "gte", 1)], [
    choice("shareCredit", [{ type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 4 }, { type: "staffMorale", target: "allStaff", amount: 3 }]),
    choice("focusCourse", [{ type: "reputation", amount: 1 }])
  ]),
  event("conservation-walk", "property", "routine", ["regular", "staff"], [predicate("condition", "gte", 70), predicate("regularCount", "gte", 1)], [
    choice("support", [{ type: "cash", amount: -300 }, { type: "reputation", amount: 1 }, { type: "relationship", target: "regular", amount: 2 }]),
    choice("decline", [])
  ]),
  event("pace-complaint", "golf", "notable", ["regular", "staff"], [predicate("regularCount", "gte", 1), predicate("staffCount", "gte", 1)], [
    choice("listen", [{ type: "relationship", target: "regular", amount: 3 }, { type: "staffMorale", target: "staff", amount: 2 }]),
    choice("holdLine", [{ type: "relationship", target: "regular", amount: -2 }])
  ], { cooldownWeeks: 12 }),
  event("architect-critique", "golf", "major", ["regular", "playerPro"], [predicate("architectureEvidence", "gte", 10)], [
    choice("redesign", [{ type: "cash", amount: -600 }, { type: "relationship", target: "regular", amount: 5 }, { type: "reputation", amount: 1 }, { type: "memory", target: "regular", summaryKey: "story.memory.architecture" }]),
    choice("defend", [{ type: "relationship", target: "regular", amount: -3 }], void 0, true)
  ], { cooldownWeeks: 16 }),
  event("pro-am-invite", "tournament", "major", ["regular", "playerPro"], [predicate("playerCareerPoints", "gte", 12), predicate("regularCount", "gte", 1)], [
    choice("accept", [{ type: "cash", amount: -750 }, { type: "reputation", amount: 3 }, { type: "relationship", target: "regular", amount: 6 }]),
    choice("defer", [{ type: "relationship", target: "regular", amount: -2 }])
  ], { cooldownWeeks: 18 }),
  event("claimant-conversation", "safety", "notable", ["regular", "staff"], [predicate("openClaims", "gte", 1), predicate("regularCount", "gte", 1)], [
    choice("listen", [{ type: "cash", amount: -500 }, { type: "reputation", amount: 1 }, { type: "relationship", target: "regular", amount: 4 }]),
    choice("formal", [{ type: "staffMorale", target: "staff", amount: 2 }, { type: "relationship", target: "regular", amount: -2 }])
  ], { mutexGroup: "safety-response" }),
  event("neighborhood-meeting", "community", "major", ["regular", "staff"], [predicate("communityComplaints", "gte", 2)], [
    choice("compromise", [{ type: "cash", amount: -900 }, { type: "reputation", amount: 2 }, { type: "relationship", target: "regular", amount: 3 }]),
    choice("holdLine", [{ type: "reputation", amount: -2 }, { type: "relationship", target: "regular", amount: -4 }], void 0, true)
  ], { mutexGroup: "community-policy" })
];
const FACTS = /* @__PURE__ */ new Set([
  "cash",
  "reputation",
  "condition",
  "lastWeekProfit",
  "regularCount",
  "staffCount",
  "averageStaffMorale",
  "architectureEvidence",
  "playerCareerPoints",
  "scheduledTournaments",
  "openClaims",
  "communityComplaints"
]);
const EFFECTS = /* @__PURE__ */ new Set([
  "cash",
  "reputation",
  "condition",
  "relationship",
  "staffMorale",
  "memory",
  "scheduleCallback"
]);
function validateStoryDefinitions(definitions = SYSTEMIC_EVENT_DEFINITIONS) {
  const errors = [];
  const ids = /* @__PURE__ */ new Set();
  for (const definition of definitions) {
    if (!definition.id || ids.has(definition.id)) errors.push(`duplicate-or-empty:${definition.id}`);
    ids.add(definition.id);
    if (!definition.titleKey || !definition.bodyKey || !definition.testFixture) errors.push(`copy-or-fixture:${definition.id}`);
    if (!Number.isFinite(definition.cooldownWeeks) || definition.cooldownWeeks < 0) errors.push(`cooldown:${definition.id}`);
    if (!definition.choices.length || !definition.choices.some((candidate) => candidate.id === definition.defaultChoiceId)) errors.push(`default:${definition.id}`);
    if (definition.predicates.some((item) => !FACTS.has(item.fact) || !Number.isFinite(item.value))) errors.push(`predicate:${definition.id}`);
    for (const option of definition.choices) {
      if (!option.id || !option.labelKey || !option.previewKey) errors.push(`choice-copy:${definition.id}:${option.id}`);
      if (option.effects.some((effect) => !EFFECTS.has(effect.type))) errors.push(`effect:${definition.id}:${option.id}`);
    }
  }
  for (const definition of definitions) for (const option of definition.choices) for (const effect of option.effects) {
    if (effect.type === "scheduleCallback" && !ids.has(effect.eventId)) errors.push(`callback:${definition.id}:${effect.eventId}`);
  }
  return errors;
}
const VALIDATION_ERRORS = validateStoryDefinitions();
if (VALIDATION_ERRORS.length) throw new Error(`Invalid M38 story definitions: ${VALIDATION_ERRORS.join(", ")}`);
const STORY_DEFINITION_BY_ID = new Map(SYSTEMIC_EVENT_DEFINITIONS.map((definition) => [definition.id, definition]));
const STAFF_TRAITS = ["steady", "meticulous", "mentor", "inventive", "warm", "frugal", "competitive", "safetyMinded"];
const clamp$7 = (value, min, max) => Math.max(min, Math.min(max, value));
const finite$3 = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function relationshipTier(score, rounds2) {
  if (rounds2 >= 12 && score >= 60) return "clubIcon";
  if (score <= -15) return "rival";
  if (score >= 25) return "friend";
  if (score >= 5) return "acquaintance";
  return "new";
}
function appearanceFor(id, staff = false) {
  const seed = hashText(id);
  return {
    portrait: staff ? seed % 2 ? "workwear" : "formal" : ["cap", "visor", "heritage", "sport"][seed % 4],
    palette: seed % 6,
    accent: Math.floor(seed / 7) % 6
  };
}
function emptyStoryState() {
  return {
    instances: [],
    callbacks: [],
    journal: [],
    cooldownUntil: {},
    chainStage: {},
    settlementLedger: []
  };
}
function emptyLivingClubState() {
  return {
    version: 1,
    sequence: 1,
    candidates: [],
    regulars: [],
    story: emptyStoryState(),
    architecture: { evidence: [], revisions: [], returnContext: null }
  };
}
function normalizeMemory(raw) {
  if (!raw || typeof raw !== "object") return null;
  const memory = raw;
  if (!memory.id || !memory.summary) return null;
  return {
    ...memory,
    week: Math.max(1, Math.floor(finite$3(memory.week, 1))),
    immutable: true,
    evidence: memory.evidence && typeof memory.evidence === "object" ? memory.evidence : void 0
  };
}
function normalizeRegular(raw) {
  if (!raw || typeof raw !== "object") return null;
  const regular = raw;
  if (!regular.id || !regular.name) return null;
  const score = clamp$7(finite$3(regular.relationship?.score), -100, 100);
  const rounds2 = Math.max(0, Math.floor(finite$3(regular.rounds)));
  return {
    ...regular,
    kind: "regular",
    appearance: regular.appearance ?? appearanceFor(regular.id),
    skill: clamp$7(finite$3(regular.skill, 0.5), 0, 1),
    loyalty: clamp$7(finite$3(regular.loyalty, 50), 0, 100),
    visits: Math.max(rounds2, Math.floor(finite$3(regular.visits, rounds2))),
    rounds: rounds2,
    bestToPar: Math.floor(finite$3(regular.bestToPar, 99)),
    member: regular.member === true,
    preferences: regular.preferences ?? { pace: "balanced", challenge: "balanced", hospitality: "club" },
    relationship: {
      score,
      tier: relationshipTier(score, rounds2),
      interactionIds: Array.isArray(regular.relationship?.interactionIds) ? regular.relationship.interactionIds.filter((item) => typeof item === "string").slice(-40) : []
    },
    memories: Array.isArray(regular.memories) ? regular.memories.map(normalizeMemory).filter((item) => item != null).slice(-16) : [],
    recentThoughts: Array.isArray(regular.recentThoughts) ? regular.recentThoughts.filter((item) => typeof item === "string").slice(-4) : [],
    history: Array.isArray(regular.history) ? regular.history.slice(-20) : []
  };
}
function normalizeCandidate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw;
  if (!candidate.key || !candidate.name) return null;
  return {
    ...candidate,
    visits: Math.max(1, Math.floor(finite$3(candidate.visits, 1))),
    firstWeek: Math.max(1, Math.floor(finite$3(candidate.firstWeek, 1))),
    lastWeek: Math.max(1, Math.floor(finite$3(candidate.lastWeek, 1))),
    lastDay: clamp$7(Math.floor(finite$3(candidate.lastDay)), 0, 6),
    loyalty: clamp$7(finite$3(candidate.loyalty, 50), 0, 100),
    bestToPar: Math.floor(finite$3(candidate.bestToPar, 99)),
    courseIds: Array.isArray(candidate.courseIds) ? [...new Set(candidate.courseIds.filter((item) => typeof item === "string"))].slice(-6) : []
  };
}
function normalizeStoryInstance(raw) {
  if (!raw || typeof raw !== "object") return null;
  const instance = raw;
  const definition = STORY_DEFINITION_BY_ID.get(instance.definitionId);
  if (!definition || !instance.id) return null;
  return {
    ...instance,
    week: Math.max(1, Math.floor(finite$3(instance.week, 1))),
    day: clamp$7(Math.floor(finite$3(instance.day)), 0, 6),
    priority: definition.priority,
    category: definition.category,
    participantIds: Array.isArray(instance.participantIds) ? instance.participantIds.filter((item) => typeof item === "string").slice(0, 4) : [],
    status: ["pending", "presented", "deferred", "resolved", "expired"].includes(instance.status) ? instance.status : "resolved",
    expiresWeek: Math.max(1, Math.floor(finite$3(instance.expiresWeek, instance.week + definition.expiresAfterWeeks))),
    resolution: instance.resolution === "chosen" || instance.resolution === "default" || instance.resolution === "expired" ? instance.resolution : null,
    facts: instance.facts && typeof instance.facts === "object" ? instance.facts : { key: instance.id, facts: {} }
  };
}
function normalizeEvidence(raw) {
  if (!raw || typeof raw !== "object") return null;
  const evidence = raw;
  const validPoint = (point2) => {
    if (!point2 || typeof point2 !== "object") return false;
    const { x, y } = point2;
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
  };
  if (!evidence.id || !evidence.courseId || !evidence.holeId || !evidence.geometryVersion || !validPoint(evidence.from) || !validPoint(evidence.landing) || !validPoint(evidence.rest)) return null;
  return {
    ...evidence,
    week: Math.max(1, Math.floor(finite$3(evidence.week, 1))),
    day: clamp$7(Math.floor(finite$3(evidence.day)), 0, 6),
    shotNumber: Math.max(1, Math.floor(finite$3(evidence.shotNumber, 1))),
    scoreToPar: Math.floor(finite$3(evidence.scoreToPar)),
    waitMinutes: Math.max(0, finite$3(evidence.waitMinutes))
  };
}
function normalizeCallback(raw) {
  if (!raw || typeof raw !== "object") return null;
  const callback = raw;
  if (!callback.id || !callback.sourceInstanceId || !STORY_DEFINITION_BY_ID.has(callback.eventId)) return null;
  return {
    ...callback,
    dueWeek: Math.max(1, Math.floor(finite$3(callback.dueWeek, 1))),
    participantIds: Array.isArray(callback.participantIds) ? callback.participantIds.filter((item) => typeof item === "string").slice(0, 4) : []
  };
}
function normalizeJournalEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw;
  if (!entry.id || !entry.eventInstanceId || !entry.choiceId || !STORY_DEFINITION_BY_ID.has(entry.definitionId)) return null;
  return {
    ...entry,
    week: Math.max(1, Math.floor(finite$3(entry.week, 1))),
    participantIds: Array.isArray(entry.participantIds) ? entry.participantIds.filter((item) => typeof item === "string").slice(0, 4) : [],
    resolution: entry.resolution === "default" || entry.resolution === "expired" ? entry.resolution : "chosen",
    facts: entry.facts && typeof entry.facts === "object" ? entry.facts : { key: entry.id, facts: {} }
  };
}
function normalizeRevision(raw) {
  if (!raw || typeof raw !== "object") return null;
  const revision = raw;
  if (!revision.id || !revision.geometryVersion || !revision.courseId) return null;
  return {
    ...revision,
    firstWeek: Math.max(1, Math.floor(finite$3(revision.firstWeek, 1))),
    lastWeek: Math.max(1, Math.floor(finite$3(revision.lastWeek, 1))),
    rounds: Math.max(0, Math.floor(finite$3(revision.rounds))),
    shots: Math.max(0, Math.floor(finite$3(revision.shots))),
    averageToPar: finite$3(revision.averageToPar),
    architectureScore: revision.architectureScore == null ? null : clamp$7(finite$3(revision.architectureScore), 0, 100),
    holeIds: Array.isArray(revision.holeIds) ? revision.holeIds.filter((item) => typeof item === "string").slice(0, 36) : []
  };
}
function normalizeLivingClub(raw) {
  const fallback = emptyLivingClubState();
  if (!raw || typeof raw !== "object") return fallback;
  const candidate = raw;
  const rawStory = candidate.story && typeof candidate.story === "object" ? candidate.story : fallback.story;
  const rawArchitecture = candidate.architecture && typeof candidate.architecture === "object" ? candidate.architecture : fallback.architecture;
  return {
    version: 1,
    sequence: Math.max(1, Math.floor(finite$3(candidate.sequence, 1))),
    candidates: Array.isArray(candidate.candidates) ? candidate.candidates.map(normalizeCandidate).filter((item) => item != null).slice(-64) : [],
    regulars: Array.isArray(candidate.regulars) ? candidate.regulars.map(normalizeRegular).filter((item) => item != null).slice(-24) : [],
    story: {
      instances: Array.isArray(rawStory.instances) ? rawStory.instances.map(normalizeStoryInstance).filter((item) => item != null).slice(-80) : [],
      callbacks: Array.isArray(rawStory.callbacks) ? rawStory.callbacks.map(normalizeCallback).filter((item) => item != null).slice(-24) : [],
      journal: Array.isArray(rawStory.journal) ? rawStory.journal.map(normalizeJournalEntry).filter((item) => item != null).slice(-120) : [],
      cooldownUntil: rawStory.cooldownUntil && typeof rawStory.cooldownUntil === "object" ? rawStory.cooldownUntil : {},
      chainStage: rawStory.chainStage && typeof rawStory.chainStage === "object" ? rawStory.chainStage : {},
      settlementLedger: Array.isArray(rawStory.settlementLedger) ? rawStory.settlementLedger.filter((item) => typeof item === "string").slice(-240) : [],
      lastEvaluationKey: typeof rawStory.lastEvaluationKey === "string" ? rawStory.lastEvaluationKey : void 0
    },
    architecture: {
      evidence: Array.isArray(rawArchitecture.evidence) ? rawArchitecture.evidence.map(normalizeEvidence).filter((item) => item != null).slice(-480) : [],
      revisions: Array.isArray(rawArchitecture.revisions) ? rawArchitecture.revisions.map(normalizeRevision).filter((item) => item != null).slice(-8) : [],
      returnContext: rawArchitecture.returnContext && typeof rawArchitecture.returnContext === "object" && typeof rawArchitecture.returnContext.roundId === "string" && typeof rawArchitecture.returnContext.holeId === "string" && typeof rawArchitecture.returnContext.courseId === "string" && rawArchitecture.returnContext.point && Number.isFinite(rawArchitecture.returnContext.point.x) && Number.isFinite(rawArchitecture.returnContext.point.y) ? rawArchitecture.returnContext : null
    }
  };
}
function normalizeStaffCharacter(member, index, week = 1) {
  const seed = hashText(member.id || `${member.name}:${index}`);
  const firstTrait = STAFF_TRAITS[seed % STAFF_TRAITS.length];
  const secondTrait = STAFF_TRAITS[(seed + 3 + index) % STAFF_TRAITS.length];
  const traits = firstTrait === secondTrait ? [firstTrait, STAFF_TRAITS[(STAFF_TRAITS.indexOf(secondTrait) + 1) % STAFF_TRAITS.length]] : [firstTrait, secondTrait];
  return {
    ...member,
    appearance: member.appearance ?? {
      portrait: seed % 4 === 0 ? "formal" : seed % 3 === 0 ? "sport" : "workwear",
      palette: seed % 6,
      accent: Math.floor(seed / 11) % 6
    },
    traits: member.traits?.length === 2 ? member.traits : traits,
    proficiency: clamp$7(finite$3(member.proficiency, 45 + seed % 21), 0, 100),
    tenureStartWeek: Math.max(1, Math.floor(finite$3(member.tenureStartWeek, week))),
    morale: clamp$7(finite$3(member.morale, 70), 0, 100),
    training: Array.isArray(member.training) ? member.training.slice(-16) : [],
    compensationHistory: Array.isArray(member.compensationHistory) && member.compensationHistory.length ? member.compensationHistory.slice(-16) : [{ week, weeklyWage: member.weeklyWage, reason: member.id.startsWith("legacy-") ? "migration" : "hire" }],
    notableActions: Array.isArray(member.notableActions) ? member.notableActions.slice(-16) : []
  };
}
function courseOperations(course, courseId) {
  return normalizeOperations((layoutById(course, courseId) ?? activeCourseLayout(course)).operations);
}
const STAFF_ROLES = ["groundskeeper", "cart_attendant", "pro_shop", "marshal", "tournament_director"];
const STAFF_NAMES = ["Avery", "Morgan", "Sam", "Jordan", "Riley"];
const STAFF_WAGES = {
  groundskeeper: 500,
  cart_attendant: 420,
  pro_shop: 480,
  marshal: 560,
  tournament_director: 650,
  club_pro: 1050,
  food_service: 620,
  locker_attendant: 440,
  front_desk: 590,
  housekeeping: 560,
  shuttle_driver: 540
};
function staffFromLevel(level, courseId) {
  return STAFF_ROLES.slice(0, Math.max(0, Math.min(5, Math.floor(level)))).map((role, index) => normalizeStaffCharacter({
    id: `legacy-staff-${index + 1}`,
    name: STAFF_NAMES[index],
    role,
    courseId,
    shiftStart: 0,
    shiftEnd: 840,
    weeklyWage: STAFF_WAGES[role]
  }, index));
}
function normalizedStaff(world, course) {
  const courseId = course ? activeCourseLayout(course).id : void 0;
  if (!world.staffRoster?.length) return staffFromLevel(world.staffLevel, courseId);
  if (world.staffRoster.every((member) => member.id.startsWith("legacy-staff-")) && world.staffRoster.length !== world.staffLevel) {
    return staffFromLevel(world.staffLevel, courseId);
  }
  return world.staffRoster.map((member, index) => normalizeStaffCharacter(member, index, world.week));
}
function groupTimeParMinutes(holeCount, groupSize, operations) {
  const perHole = holeCount >= 18 ? 13.3 : 12.5;
  const sizeFactor = 0.7 + Math.max(1, groupSize) * 0.075;
  const styleFactor = operations.timeParStyle === "relaxed" ? 1.1 : operations.timeParStyle === "brisk" ? 0.92 : 1;
  return holeCount * perHole * sizeFactor * styleFactor;
}
function emptyCohortDay() {
  return { samples: 0, durationMinutes: 0, timeParVarianceMinutes: 0, waitMinutes: 0, pickups: 0, abandonments: 0, satisfaction: 0 };
}
function emptyCoursePaceDayMetrics(courseId) {
  return {
    courseId,
    groupsStarted: 0,
    groupsFinished: 0,
    roundsCompleted: 0,
    roundsIncomplete: 0,
    roundDurations: [],
    totalWaitMinutes: 0,
    pickups: 0,
    incidents: 0,
    refunds: 0,
    credits: 0,
    goodwillVouchers: 0,
    overtimeCost: 0,
    compensationCost: 0,
    greenFeeRevenue: 0,
    beverageRevenue: 0,
    occupiedTeeMinutes: 0,
    satisfaction: 0,
    cohorts: {
      skilled_impatient: emptyCohortDay(),
      novice_social: emptyCohortDay(),
      general: emptyCohortDay()
    },
    holes: {}
  };
}
function emptyPaceDayMetrics(courseIds = []) {
  return {
    groupsStarted: 0,
    groupsFinished: 0,
    totalWaitMinutes: 0,
    marshalInterventions: 0,
    forcedPickups: 0,
    beverageRevenue: 0,
    alcoholicDrinks: 0,
    serviceRefusals: 0,
    disorderIncidents: 0,
    perCourse: Object.fromEntries(courseIds.map((courseId) => [courseId, emptyCoursePaceDayMetrics(courseId)]))
  };
}
function ensureCoursePaceMetrics(pace, courseId) {
  return pace.perCourse[courseId] ??= emptyCoursePaceDayMetrics(courseId);
}
function cohortFromGolfer(skill, patience) {
  if (skill >= 0.65 || patience <= 0.35) return "skilled_impatient";
  if (skill <= 0.45 || patience >= 0.7) return "novice_social";
  return "general";
}
const SURFACE_ORDER = ["grass", "dirt", "gravel", "asphalt", "paver"];
const FACILITY_MODULE_SPECS = {
  check_in: moduleSpec("check_in", "Check-in desk", 1, 2500, 24, 22, 2, "Greets golfers and routes members, outings, and resort guests."),
  pro_shop: moduleSpec("pro_shop", "Pro-shop room", 1, 5500, 14, 52, 3, "Adds merchandise and rental capacity inside the clubhouse shell."),
  restaurant: moduleSpec("restaurant", "Dining room", 2, 9e3, 28, 96, 8, "Adds seated dining; a kitchen and food-service coverage unlock full throughput."),
  kitchen: moduleSpec("kitchen", "Commercial kitchen", 2, 7500, 36, 88, 3, "Supports restaurant, catering, clinic, and function-room service."),
  bar: moduleSpec("bar", "Club bar", 2, 6500, 20, 70, 5, "Adds a staffed post-round and event beverage service."),
  lockers: moduleSpec("lockers", "Locker rooms", 2, 8e3, 36, 65, 4, "Supports members, academy students, and premium outing packages."),
  member_lounge: moduleSpec("member_lounge", "Member lounge", 3, 11e3, 24, 90, 4, "Raises member loyalty but consumes room, staff, and upkeep."),
  pro_office: moduleSpec("pro_office", "Club-pro office", 2, 6e3, 8, 46, 2, "Adds lesson administration and professional booking capacity."),
  fitting_studio: moduleSpec("fitting_studio", "Teaching and fitting studio", 3, 13e3, 10, 105, 3, "Unlocks premium fittings and reliable all-weather instruction."),
  function_room: moduleSpec("function_room", "Function room", 3, 15e3, 54, 138, 14, "Hosts catered outings, clinics, meetings, and destination events.")
};
const PROPERTY_ASSET_SPECS = {
  road: spec("road", "Main road", "🛣️", "access", "Connects the estate to the regional road. Better surfaces improve throughput and reliability.", 2500, 28, 0, 30, 5, [8, 2]),
  parking: spec("parking", "Guest parking", "🅿️", "access", "Every golfer, diner, student, and overnight guest needs an arrival space.", 3500, 32, 0, 24, 5, [6, 5]),
  valet: spec("valet", "Valet court", "🚘", "access", "Premium arrival service adds parking capacity and resort appeal.", 9e3, 18, 12, 80, 3, [4, 3]),
  overflow_parking: spec("overflow_parking", "Remote overflow parking", "🚐", "access", "Peak capacity that only becomes usable when a staffed shuttle connects it to the campus.", 7500, 42, 0, 48, 4, [8, 6]),
  shuttle: spec("shuttle", "Resort shuttle", "🚌", "access", "Moves overnight groups, luggage, and remote-parking guests without teleporting across the estate.", 12e3, 24, 8, 120, 4, [4, 2]),
  driving_range: spec("driving_range", "Driving range", "🏌️", "practice", "Sells buckets, develops customer skill, and supplies lesson demand.", 12e3, 28, 14, 110, 4, [12, 5]),
  putting_green: spec("putting_green", "Putting green", "⛳", "practice", "Low-cost practice amenity that improves loyalty and member value.", 5500, 18, 8, 45, 4, [5, 5]),
  short_game_area: spec("short_game_area", "Short-game area", "🎯", "practice", "Chipping and bunker sessions broaden the academy offer.", 8e3, 16, 11, 65, 4, [7, 5]),
  practice_holes: spec("practice_holes", "Practice loop", "🏳️", "practice", "A compact loop for playing lessons, fittings, and warm-up rounds.", 18e3, 20, 20, 155, 4, [10, 8]),
  practice_bays: spec("practice_bays", "Covered practice bays", "🏗️", "practice", "All-weather bays raise range capacity and destination appeal.", 15e3, 24, 19, 135, 4, [8, 4]),
  clubhouse: spec("clubhouse", "Clubhouse", "🏛️", "clubhouse", "A tiered shell whose size unlocks hospitality, retail, locker, and event modules.", 2e4, 24, 0, 180, 4, [7, 6]),
  pro_shop: spec("pro_shop", "Pro shop", "🧢", "clubhouse", "Merchandise, apparel, rental sets, and club fitting revenue.", 8e3, 16, 28, 75, 4, [3, 3]),
  restaurant: spec("restaurant", "Restaurant", "🍽️", "clubhouse", "Captures spend from golfers, residents, event guests, and hotel guests.", 14e3, 34, 26, 150, 4, [5, 4]),
  bar: spec("bar", "Club bar", "🍸", "clubhouse", "Extends dwell time and increases post-round and overnight spend.", 9e3, 26, 17, 105, 4, [4, 3]),
  locker_room: spec("locker_room", "Locker rooms", "🔐", "clubhouse", "Supports memberships, outings, lessons, and premium daily-fee guests.", 1e4, 40, 6, 95, 4, [4, 4]),
  event_space: spec("event_space", "Function rooms", "🎉", "clubhouse", "Hosts outings, weddings, meetings, and destination events.", 18e3, 70, 65, 170, 4, [7, 5]),
  lodge: spec("lodge", "Golf lodge", "🛎️", "resort", "A small overnight property that unlocks stay-and-play packages.", 35e3, 16, 145, 260, 4, [7, 6]),
  hotel: spec("hotel", "Resort hotel", "🏨", "resort", "High-capacity destination lodging with substantial staffing and access needs.", 85e3, 48, 185, 620, 4, [10, 8]),
  cottages: spec("cottages", "Golf cottages", "🏡", "resort", "Premium group accommodation for buddies trips, families, and events.", 48e3, 24, 225, 330, 4, [9, 7]),
  spa: spec("spa", "Spa and wellness", "🧖", "resort", "Raises length of stay, non-golfer appeal, and room rates.", 28e3, 24, 75, 250, 4, [6, 5]),
  houses: spec("houses", "Fairway homes", "🏘️", "community", "For-sale homes create development income, residents, and errant-ball exposure.", 6e4, 20, 0, 120, 4, [12, 8]),
  condos: spec("condos", "Golf condominiums", "🏢", "community", "Higher-density homes create more customers and more safety pressure.", 75e3, 32, 0, 165, 4, [9, 8]),
  community_club: spec("community_club", "Community club", "🤝", "community", "Resident amenity that improves sales, satisfaction, memberships, and dining.", 24e3, 42, 12, 205, 4, [7, 6]),
  safety_buffer: spec("safety_buffer", "Safety buffer", "🌲", "safety", "Landscaped setbacks reduce ball-strike frequency without changing course play.", 9e3, 0, 0, 35, 4, [10, 3]),
  netting: spec("netting", "Protective netting", "🥅", "safety", "Targeted protection strongly reduces incidents but carries visible upkeep.", 13e3, 0, 0, 75, 4, [10, 1]),
  screening: spec("screening", "Vegetation screening", "🌳", "safety", "Dense screening intercepts low shots, softens views, and needs healthy continuous coverage.", 7500, 0, 0, 42, 4, [8, 2]),
  safety_fence: spec("safety_fence", "Safety fence", "🚧", "safety", "A durable low barrier limits access and redirects retrieval without stopping high shots.", 6500, 0, 0, 28, 4, [8, 1]),
  berm: spec("berm", "Safety berm", "⛰️", "safety", "An earth berm intercepts low trajectories and adds separation at a substantial landscape cost.", 15e3, 0, 0, 38, 4, [10, 3]),
  warning_signage: spec("warning_signage", "Warning signage", "⚠️", "safety", "Discloses residual exposure and redirects pedestrians but does not physically stop a ball.", 1800, 0, 0, 8, 2, [2, 1])
};
function spec(kind, label, icon, category, description, buildCost, baseCapacity, basePrice, dailyUpkeep, maxTier, footprint) {
  return { kind, label, icon, category, description, buildCost, baseCapacity, basePrice, dailyUpkeep, maxTier, footprint };
}
function moduleSpec(kind, label, requiredShellTier, buildCost, capacity2, dailyUpkeep, parkingDemand, description) {
  return { kind, label, requiredShellTier, buildCost, capacity: capacity2, dailyUpkeep, parkingDemand, description };
}
const CUSTOMER_NAMES = ["Maya Chen", "Theo Brooks", "Sam Rivera", "Priya Shah", "Jordan Reed", "Ana Torres", "Eli Martin", "Nora Kim", "Luis Bennett", "Jamie Patel", "Riley Foster", "Avery Walker"];
function emptyPropertyCourse() {
  return {
    version: 2,
    assets: [],
    developments: [],
    units: [],
    easements: [],
    safetyPolicy: { restrictedTeeSets: [], closedHoleIds: [], exposureLimit: 70 }
  };
}
function emptyPropertyEnterprise() {
  return {
    version: 3,
    sequence: 1,
    ledger: [],
    customers: CUSTOMER_NAMES.map((name, index) => ({
      id: `customer-${index + 1}`,
      name,
      segment: index < 4 ? "local" : index < 7 ? "student" : index < 10 ? "tourist" : "event_guest",
      skill: 18 + index * 7 % 55,
      loyalty: 20 + index * 11 % 45,
      visits: 0,
      totalSpend: 0,
      member: false,
      lastVisitWeek: 0
    })),
    professionals: [],
    membership: { active: false, tier: 1, monthlyFee: 95, memberCount: 0, capacity: 40 },
    reservations: [],
    residents: [],
    incidents: [],
    complaints: [],
    claims: [],
    insurance: { policyId: "course-liability-1", deductible: 1250, coverageLimit: 25e4, dailyPremium: 95, riskMultiplier: 1, claimsFiled: 0, claimsSettled: 0 },
    outings: [],
    resort: { frontDesk: 0, housekeeping: 0, maintenance: 0, concierge: 0, shuttleDrivers: 0, foodService: 0, lockerAttendants: 0, dirtyRooms: 0, outOfOrderRooms: 0, serviceQueue: 0, transportWaitMinutes: 0 }
  };
}
function normalizePropertyCourse(raw) {
  if (!raw || typeof raw !== "object") return emptyPropertyCourse();
  const candidate = raw;
  const assets = Array.isArray(candidate.assets) ? candidate.assets.filter(validAsset).map((asset) => {
    const assetSpec = PROPERTY_ASSET_SPECS[asset.kind];
    const tier = clamp$6(Math.floor(asset.tier), 1, assetSpec.maxTier);
    const surface = assetSpec.category === "access" && asset.kind !== "valet" ? SURFACE_ORDER.includes(asset.surface) ? asset.surface : SURFACE_ORDER[Math.min(SURFACE_ORDER.length - 1, tier - 1)] : void 0;
    const openHour = clamp$6(Math.floor(asset.openHour ?? 7), 5, 20);
    const closeHour = clamp$6(Math.max(openHour + 4, Math.floor(asset.closeHour ?? 20)), 8, 24);
    return withPracticeGeometry({
      ...asset,
      id: asset.id || `property-${asset.kind}-${Math.floor(asset.x)}-${Math.floor(asset.y)}`,
      name: typeof asset.name === "string" && asset.name.trim().length >= 2 ? asset.name.trim().replace(/\s+/g, " ").slice(0, 40) : assetSpec.label,
      category: assetSpec.category,
      tier,
      x: Math.max(0, Math.floor(asset.x)),
      y: Math.max(0, Math.floor(asset.y)),
      width: assetSpec.footprint[0],
      height: assetSpec.footprint[1],
      capacity: Math.max(0, Math.floor(Number.isFinite(asset.capacity) ? asset.capacity : assetSpec.baseCapacity)),
      condition: clamp$6(Number.isFinite(asset.condition) ? asset.condition : 1, 0, 1),
      price: Math.max(0, Number.isFinite(asset.price) ? Math.round(asset.price) : assetSpec.basePrice),
      ...asset.kind === "clubhouse" ? { modules: Array.isArray(asset.modules) ? asset.modules.filter((module) => module && module.kind in FACILITY_MODULE_SPECS).map((module) => ({
        kind: module.kind,
        tier: clamp$6(Math.floor(module.tier || 1), 1, 4),
        enabled: module.enabled !== false
      })) : [] } : {},
      upkeepPolicy: ["lean", "standard", "premium"].includes(asset.upkeepPolicy) ? asset.upkeepPolicy : "standard",
      openHour,
      closeHour,
      constructionDaysRemaining: Math.max(0, Math.floor(asset.constructionDaysRemaining ?? 0)),
      ...asset.lastDay && Number.isFinite(asset.lastDay.demand) ? { lastDay: {
        demand: Math.max(0, Math.floor(asset.lastDay.demand)),
        served: Math.max(0, Math.floor(asset.lastDay.served)),
        denied: Math.max(0, Math.floor(asset.lastDay.denied)),
        revenue: Math.max(0, Math.round(asset.lastDay.revenue))
      } } : {},
      ...surface ? { surface } : {},
      enabled: asset.enabled !== false
    });
  }) : [];
  const unique = new Map(assets.map((asset) => [asset.id, asset]));
  const assetIds = new Set(unique.keys());
  const developments = normalizeDevelopments(candidate.developments, assetIds);
  const developmentIds = new Set(developments.map((development) => development.id));
  const units = normalizeResidentialUnits(candidate.units, developmentIds, assetIds);
  const unitIds = new Set(units.map((unit2) => unit2.id));
  const normalizedDevelopments = developments.map((development) => ({
    ...development,
    unitIds: development.unitIds.filter((id) => unitIds.has(id)).slice(0, 160)
  }));
  const easements = normalizeEasements(candidate.easements, developmentIds, assetIds);
  const rawPolicy = candidate.safetyPolicy && typeof candidate.safetyPolicy === "object" ? candidate.safetyPolicy : void 0;
  const teeSets = /* @__PURE__ */ new Set(["championship", "member", "forward"]);
  return {
    version: 2,
    assets: [...unique.values()],
    developments: normalizedDevelopments,
    units,
    easements,
    safetyPolicy: {
      restrictedTeeSets: Array.isArray(rawPolicy?.restrictedTeeSets) ? rawPolicy.restrictedTeeSets.filter((value) => teeSets.has(value)).slice(0, 3) : [],
      closedHoleIds: Array.isArray(rawPolicy?.closedHoleIds) ? [...new Set(rawPolicy.closedHoleIds.filter((value) => typeof value === "string"))].slice(0, 36) : [],
      exposureLimit: clamp$6(Number.isFinite(rawPolicy?.exposureLimit) ? rawPolicy.exposureLimit : 70, 20, 90)
    }
  };
}
function normalizePropertyEnterprise(raw) {
  const defaults = emptyPropertyEnterprise();
  if (!raw || typeof raw !== "object") return defaults;
  const candidate = raw;
  return {
    ...defaults,
    ...candidate,
    version: 3,
    sequence: Number.isInteger(candidate.sequence) ? Math.max(1, candidate.sequence) : 1,
    ledger: Array.isArray(candidate.ledger) ? candidate.ledger.slice(-420) : [],
    customers: normalizedCustomers(candidate.customers, defaults.customers),
    professionals: Array.isArray(candidate.professionals) ? candidate.professionals.slice(0, 8) : [],
    reservations: normalizedReservations(candidate.reservations),
    residents: normalizedResidents(candidate.residents),
    incidents: normalizedIncidents(candidate.incidents),
    complaints: normalizedComplaints(candidate.complaints),
    claims: normalizedClaims(candidate.claims),
    insurance: normalizedInsurance(candidate.insurance, defaults.insurance),
    outings: Array.isArray(candidate.outings) ? candidate.outings.slice(-80) : [],
    resort: normalizedResortOperations(candidate.resort, defaults.resort),
    membership: candidate.membership && typeof candidate.membership === "object" ? { ...defaults.membership, ...candidate.membership } : defaults.membership
  };
}
function normalizedResortOperations(raw, defaults) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  const staff = (value) => Number.isFinite(value) ? clamp$6(Math.floor(value), 0, 8) : 0;
  const count = (value, max = 1e3) => Number.isFinite(value) ? clamp$6(Math.floor(value), 0, max) : 0;
  return {
    ...defaults,
    frontDesk: staff(candidate.frontDesk),
    housekeeping: staff(candidate.housekeeping),
    maintenance: staff(candidate.maintenance),
    concierge: staff(candidate.concierge),
    shuttleDrivers: staff(candidate.shuttleDrivers),
    foodService: staff(candidate.foodService),
    lockerAttendants: staff(candidate.lockerAttendants),
    dirtyRooms: count(candidate.dirtyRooms),
    outOfOrderRooms: count(candidate.outOfOrderRooms),
    serviceQueue: count(candidate.serviceQueue),
    transportWaitMinutes: count(candidate.transportWaitMinutes, 1440)
  };
}
function normalizeDevelopments(raw, assetIds) {
  if (!Array.isArray(raw)) return [];
  const strategies = /* @__PURE__ */ new Set(["sell", "retain", "partner"]);
  const statuses = /* @__PURE__ */ new Set(["planned", "construction", "releasing", "complete", "sold_out", "reacquired"]);
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const item = value;
    return typeof item.id === "string" && !seen.has(item.id) && typeof item.assetId === "string" && assetIds.has(item.assetId);
  }).map((item) => {
    seen.add(item.id);
    return {
      ...item,
      strategy: strategies.has(item.strategy) ? item.strategy : "sell",
      status: statuses.has(item.status) ? item.status : "construction",
      phaseNumber: clamp$6(Math.floor(item.phaseNumber || 1), 1, 12),
      unitIds: Array.isArray(item.unitIds) ? [...new Set(item.unitIds.filter((id) => typeof id === "string"))] : [],
      approvedWeek: Math.max(0, Math.floor(item.approvedWeek || 0)),
      constructionDaysRemaining: clamp$6(Math.floor(item.constructionDaysRemaining || 0), 0, 365),
      releaseDaysRemaining: clamp$6(Math.floor(item.releaseDaysRemaining || 0), 0, 90),
      developmentCost: Math.max(0, Math.round(item.developmentCost || 0)),
      playerCapital: Math.max(0, Math.round(item.playerCapital || 0)),
      partnerShare: clamp$6(item.partnerShare || 0, 0, 0.8),
      projectedValueLow: Math.max(0, Math.round(item.projectedValueLow || 0)),
      projectedValueHigh: Math.max(0, Math.round(item.projectedValueHigh || 0)),
      safetyAtApproval: clamp$6(item.safetyAtApproval || 0, 0, 100),
      disclosedRisk: item.disclosedRisk === true,
      publicRoadConnected: item.publicRoadConnected !== false,
      emergencyAccess: item.emergencyAccess !== false,
      utilitiesEligible: item.utilitiesEligible !== false,
      parkingSpaces: Math.max(0, Math.floor(item.parkingSpaces || 0)),
      commonUpkeepDaily: Math.max(0, Math.round(item.commonUpkeepDaily || 0)),
      taxRate: clamp$6(item.taxRate || 0.012, 0, 0.05),
      insurancePremiumDaily: Math.max(0, Math.round(item.insurancePremiumDaily || 0))
    };
  }).slice(0, 24);
}
function normalizeResidentialUnits(raw, developmentIds, assetIds) {
  if (!Array.isArray(raw)) return [];
  const statuses = /* @__PURE__ */ new Set(["construction", "available", "sold", "leased", "partnered", "vacant", "reacquired"]);
  const types = /* @__PURE__ */ new Set(["detached_home", "villa", "townhome", "condo"]);
  const tenures = /* @__PURE__ */ new Set(["player", "private", "partner"]);
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const item = value;
    return typeof item.id === "string" && !seen.has(item.id) && developmentIds.has(item.developmentId) && assetIds.has(item.assetId);
  }).map((item) => {
    seen.add(item.id);
    return {
      ...item,
      lotNumber: Math.max(1, Math.floor(item.lotNumber || 1)),
      type: types.has(item.type) ? item.type : "detached_home",
      status: statuses.has(item.status) ? item.status : "construction",
      tenure: tenures.has(item.tenure) ? item.tenure : "player",
      marketValue: Math.max(0, Math.round(item.marketValue || 0)),
      closedValue: item.closedValue == null ? void 0 : Math.max(0, Math.round(item.closedValue)),
      weeklyRent: item.weeklyRent == null ? void 0 : Math.max(0, Math.round(item.weeklyRent))
    };
  }).slice(0, 720);
}
function normalizeEasements(raw, developmentIds, assetIds) {
  if (!Array.isArray(raw)) return [];
  const kinds = /* @__PURE__ */ new Set(["safety", "maintenance", "access", "utility"]);
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const item = value;
    return typeof item.id === "string" && !seen.has(item.id) && (!item.developmentId || developmentIds.has(item.developmentId)) && (!item.assetId || assetIds.has(item.assetId));
  }).map((item) => {
    seen.add(item.id);
    return {
      ...item,
      kind: kinds.has(item.kind) ? item.kind : "safety",
      x: Math.max(0, Math.floor(item.x || 0)),
      y: Math.max(0, Math.floor(item.y || 0)),
      width: Math.max(1, Math.floor(item.width || 1)),
      height: Math.max(1, Math.floor(item.height || 1)),
      protected: item.protected !== false,
      compensation: item.compensation == null ? void 0 : Math.max(0, Math.round(item.compensation))
    };
  }).slice(0, 120);
}
function normalizedResidents(raw) {
  if (!Array.isArray(raw)) return [];
  const archetypes = /* @__PURE__ */ new Set(["golf_family", "retiree", "professional", "second_home", "non_golfer"]);
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const item = value;
    return typeof item.id === "string" && !seen.has(item.id) && typeof item.assetId === "string";
  }).map((item) => {
    seen.add(item.id);
    return {
      ...item,
      units: clamp$6(Math.floor(item.units || 0), 0, 720),
      occupied: clamp$6(Math.floor(item.occupied || 0), 0, Math.max(0, Math.floor(item.units || 0))),
      satisfaction: clamp$6(item.satisfaction || 0, 0, 100),
      complaints: clamp$6(Math.floor(item.complaints || 0), 0, 999),
      unitIds: Array.isArray(item.unitIds) ? [...new Set(item.unitIds.filter((id) => typeof id === "string"))].slice(0, 80) : [],
      customerIds: Array.isArray(item.customerIds) ? [...new Set(item.customerIds.filter((id) => typeof id === "string"))].slice(0, 8) : [],
      archetype: archetypes.has(item.archetype ?? "non_golfer") ? item.archetype : "non_golfer",
      golfInterest: clamp$6(item.golfInterest ?? 35, 0, 100),
      riskTolerance: clamp$6(item.riskTolerance ?? 45, 0, 100),
      serviceExpectation: clamp$6(item.serviceExpectation ?? 60, 0, 100),
      advocacy: clamp$6(item.advocacy ?? 0, -100, 100),
      opposition: clamp$6(item.opposition ?? 0, 0, 100),
      localSpend: Math.max(0, item.localSpend ?? 0),
      membershipPropensity: clamp$6(item.membershipPropensity ?? 25, 0, 100)
    };
  }).slice(0, 240);
}
function normalizedIncidents(raw) {
  if (!Array.isArray(raw)) return [];
  const kinds = /* @__PURE__ */ new Set(["ball_strike", "boundary_entry", "near_miss", "roof_strike", "window_damage", "vehicle_damage", "serious_safety", "parking_overflow", "service_failure"]);
  return raw.filter((value) => !!value && typeof value === "object" && typeof value.id === "string").map((item) => ({
    ...item,
    kind: kinds.has(item.kind) ? item.kind : "service_failure",
    week: Math.max(0, Math.floor(item.week || 0)),
    day: clamp$6(Math.floor(item.day || 0), 0, 6),
    severity: clamp$6(Math.floor(item.severity || 1), 1, 5),
    cost: Math.max(0, Math.round(item.cost || 0)),
    priorWarnings: Math.max(0, Math.floor(item.priorWarnings || 0))
  })).slice(-240);
}
function normalizedComplaints(raw) {
  if (!Array.isArray(raw)) return [];
  const sources = /* @__PURE__ */ new Set(["errant_ball", "noise", "maintenance", "lights", "traffic", "dust", "alcohol", "tournament", "landscaping", "access", "common_area"]);
  const statuses = /* @__PURE__ */ new Set(["open", "acknowledged", "mitigated", "compensated", "resolved"]);
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((value) => !!value && typeof value === "object" && typeof value.id === "string" && !seen.has(value.id)).map((item) => {
    seen.add(item.id);
    return {
      ...item,
      source: sources.has(item.source) ? item.source : "common_area",
      severity: clamp$6(Math.floor(item.severity || 1), 1, 5),
      recurrence: clamp$6(Math.floor(item.recurrence || 1), 1, 99),
      status: statuses.has(item.status) ? item.status : "open",
      location: item.location && Number.isFinite(item.location.x) && Number.isFinite(item.location.y) ? item.location : { x: 0, y: 0 },
      cost: item.cost == null ? void 0 : Math.max(0, Math.round(item.cost))
    };
  }).slice(-240);
}
function normalizedClaims(raw) {
  if (!Array.isArray(raw)) return [];
  const statuses = /* @__PURE__ */ new Set(["open", "filed", "settled", "denied"]);
  const seen = /* @__PURE__ */ new Set();
  return raw.filter((value) => !!value && typeof value === "object" && typeof value.id === "string" && !seen.has(value.id)).map((item) => {
    seen.add(item.id);
    return {
      ...item,
      status: statuses.has(item.status) ? item.status : "open",
      damage: Math.max(0, Math.round(item.damage || 0)),
      deductible: Math.max(0, Math.round(item.deductible || 0)),
      insurerPayment: Math.max(0, Math.round(item.insurerPayment || 0)),
      playerPayment: Math.max(0, Math.round(item.playerPayment || 0)),
      priorWarnings: Math.max(0, Math.floor(item.priorWarnings || 0))
    };
  }).slice(-160);
}
function normalizedInsurance(raw, defaults) {
  const item = raw && typeof raw === "object" ? raw : {};
  return {
    policyId: typeof item.policyId === "string" ? item.policyId : defaults.policyId,
    deductible: Math.max(0, Math.round(item.deductible ?? defaults.deductible)),
    coverageLimit: Math.max(0, Math.round(item.coverageLimit ?? defaults.coverageLimit)),
    dailyPremium: Math.max(0, Math.round(item.dailyPremium ?? defaults.dailyPremium)),
    riskMultiplier: clamp$6(item.riskMultiplier ?? defaults.riskMultiplier, 0.5, 6),
    claimsFiled: Math.max(0, Math.floor(item.claimsFiled ?? defaults.claimsFiled)),
    claimsSettled: Math.max(0, Math.floor(item.claimsSettled ?? defaults.claimsSettled))
  };
}
function normalizedReservations(raw) {
  if (!Array.isArray(raw)) return [];
  const validPackages = /* @__PURE__ */ new Set(["room_only", "stay_and_play", "academy", "event"]);
  const validStatuses = /* @__PURE__ */ new Set(["booked", "checked_in", "checked_out", "cancelled"]);
  const validRoomClasses = /* @__PURE__ */ new Set(["standard", "deluxe", "suite", "villa"]);
  const validEntitlements = /* @__PURE__ */ new Set(["room", "golf", "practice", "dining", "spa"]);
  return raw.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const reservation = value;
    return typeof reservation.id === "string" && typeof reservation.assetId === "string" && typeof reservation.customerId === "string" && validPackages.has(reservation.package) && Number.isFinite(reservation.week) && Number.isFinite(reservation.nights) && Number.isFinite(reservation.value);
  }).map((reservation) => {
    const checkInWeek = Math.max(0, Math.floor(reservation.checkInWeek ?? reservation.week));
    const checkInDay = clamp$6(Math.floor(reservation.checkInDay ?? 0), 0, 6);
    const nights = clamp$6(Math.floor(reservation.nights), 1, 14);
    const checkout = ordinalToWeekDay(checkInWeek * 7 + checkInDay + nights);
    const entitlementIds = /* @__PURE__ */ new Set();
    const entitlements = (Array.isArray(reservation.entitlements) ? reservation.entitlements : []).filter((entitlement) => {
      if (!entitlement || typeof entitlement.id !== "string" || !validEntitlements.has(entitlement.kind) || entitlementIds.has(entitlement.id)) return false;
      entitlementIds.add(entitlement.id);
      return true;
    }).map((entitlement) => {
      const redeemed = entitlement.redeemed === true || entitlement.status === "fulfilled" || entitlement.status === "substituted";
      return {
        ...entitlement,
        quantity: clamp$6(Math.floor(entitlement.quantity ?? 1), 1, 16),
        scheduledWeek: Math.max(0, Math.floor(entitlement.scheduledWeek ?? checkInWeek)),
        scheduledDay: clamp$6(Math.floor(entitlement.scheduledDay ?? checkInDay), 0, 6),
        status: entitlement.status ?? (redeemed ? "fulfilled" : "pending"),
        redeemed,
        refundAmount: Math.max(0, Math.round(entitlement.refundAmount ?? 0))
      };
    });
    const folio = (Array.isArray(reservation.folio) ? reservation.folio : []).filter((item) => !!item && typeof item.id === "string" && Number.isFinite(item.amount)).slice(-80).map((item) => ({ ...item, amount: Math.round(item.amount * 100) / 100 }));
    return {
      ...reservation,
      week: checkInWeek,
      nights,
      value: Math.max(0, Math.round(reservation.value)),
      partySize: clamp$6(Math.floor(reservation.partySize ?? 1), 1, 16),
      roomCount: clamp$6(Math.floor(reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)), 1, 64),
      companionCount: clamp$6(Math.floor(reservation.companionCount ?? 0), 0, 12),
      checkInWeek,
      checkInDay,
      checkOutWeek: Math.max(checkInWeek, Math.floor(reservation.checkOutWeek ?? checkout.week)),
      checkOutDay: clamp$6(Math.floor(reservation.checkOutDay ?? checkout.day), 0, 6),
      deposit: Math.max(0, Math.round(reservation.deposit ?? 0)),
      refund: Math.max(0, Math.round(reservation.refund ?? 0)),
      status: validStatuses.has(reservation.status ?? "booked") ? reservation.status ?? "booked" : "booked",
      roomClass: validRoomClasses.has(reservation.roomClass ?? "standard") ? reservation.roomClass ?? "standard" : "standard",
      transportMode: reservation.transportMode ?? "self_drive",
      vehicleCount: clamp$6(Math.floor(reservation.vehicleCount ?? Math.ceil((reservation.partySize ?? 1) / 3)), 0, 6),
      luggageReady: reservation.luggageReady !== false,
      revalidation: reservation.revalidation ?? "valid",
      entitlements,
      folio
    };
  }).slice(-120);
}
function normalizedCustomers(raw, fallback) {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const normalized = raw.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const customer = value;
    return typeof customer.id === "string" && typeof customer.name === "string" && Number.isFinite(customer.skill) && Number.isFinite(customer.loyalty);
  }).map((customer) => ({
    ...customer,
    skill: clamp$6(customer.skill, 0, 100),
    loyalty: clamp$6(customer.loyalty, 0, 100),
    visits: Math.max(0, Math.floor(customer.visits || 0)),
    totalSpend: Math.max(0, customer.totalSpend || 0),
    lastVisitWeek: Math.max(0, Math.floor(customer.lastVisitWeek || 0)),
    member: customer.member === true
  }));
  if (normalized.length <= 256) return normalized;
  return normalized.sort((a, b) => Number(b.member) - Number(a.member) || b.lastVisitWeek - a.lastVisitWeek || b.loyalty - a.loyalty || a.id.localeCompare(b.id)).slice(0, 256);
}
function validAsset(value) {
  if (!value || typeof value !== "object") return false;
  const asset = value;
  return typeof asset.id === "string" && asset.kind in PROPERTY_ASSET_SPECS && Number.isFinite(asset.x) && Number.isFinite(asset.y) && Number.isFinite(asset.tier);
}
function clamp$6(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function propertyAccessCapacity(course, world) {
  const assets = normalizePropertyCourse(course.property).assets;
  const road = assets.find((asset) => asset.kind === "road" && asset.enabled);
  const parking = assets.find((asset) => asset.kind === "parking" && asset.enabled);
  if (!road || !parking) return 18;
  const valet = assets.find((asset) => asset.kind === "valet" && asset.enabled);
  const overflow = assets.find((asset) => asset.kind === "overflow_parking" && asset.enabled);
  const shuttle = assets.find((asset) => asset.kind === "shuttle" && asset.enabled);
  const shuttleDrivers = world ? normalizePropertyEnterprise(world.enterprise).resort.shuttleDrivers : 0;
  const quality = Math.min(surfaceLevel(road.surface), surfaceLevel(parking.surface));
  const condition = Math.min(road.condition, parking.condition);
  const connectedOverflow = overflow && shuttle && shuttleDrivers > 0 ? Math.min(overflow.capacity, shuttle.capacity * shuttleDrivers) : 0;
  return Math.max(12, Math.floor(Math.min(road.capacity, parking.capacity + (valet?.capacity ?? 0) + connectedOverflow) * (0.7 + quality * 0.1) * condition));
}
function propertyAccessMultiplier(course, plannedGolfers, world) {
  if (plannedGolfers <= 0) return 1;
  return clamp$6(propertyAccessCapacity(course, world) / plannedGolfers, 0.55, 1.15);
}
function surfaceLevel(surface) {
  return Math.max(1, SURFACE_ORDER.indexOf(surface ?? "grass") + 1);
}
function withPracticeGeometry(asset) {
  if (asset.category !== "practice") return asset;
  if (asset.route?.points.length && asset.stations?.length) return asset;
  const centerY = asset.y + Math.floor(asset.height / 2);
  return {
    ...asset,
    route: { id: `route-${asset.id}`, points: [{ x: asset.x, y: centerY }, { x: asset.x + asset.width - 1, y: centerY }] },
    stations: [
      { id: `station-${asset.id}-entry`, kind: asset.kind === "putting_green" ? "cup" : "tee", x: asset.x, y: centerY, capacity: Math.max(1, Math.floor(asset.capacity / 4)) },
      { id: `station-${asset.id}-target`, kind: asset.kind === "putting_green" ? "cup" : "target", x: asset.x + asset.width - 1, y: centerY, capacity: Math.max(1, Math.floor(asset.capacity / 4)) }
    ]
  };
}
function ordinalToWeekDay(ordinal) {
  return { week: Math.floor(ordinal / 7), day: (ordinal % 7 + 7) % 7 };
}
const SEASONS = ["spring", "summer", "autumn", "winter"];
const CLUB_CHARTERS = [
  "public-gem",
  "championship-venue",
  "destination-retreat",
  "member-institution"
];
const DAYS_PER_WEEK = 7;
const WEEKS_PER_SEASON = 8;
const WEEKS_PER_YEAR = 32;
const DAYS_PER_YEAR = DAYS_PER_WEEK * WEEKS_PER_YEAR;
const clamp$5 = (value, min, max) => Math.max(min, Math.min(max, value));
const finite$2 = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const integer = (value, fallback = 0) => Math.floor(finite$2(value, fallback));
const strings = (value, max) => Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string"))].slice(-max) : [];
function hash32(...values) {
  let hash = 2166136261;
  for (const value of values) {
    hash ^= value | 0;
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}
function unit$1(seed, day, salt) {
  return hash32(seed, day, salt) / 4294967296;
}
function absoluteDayFor(week, dayOfWeek) {
  return Math.max(0, (Math.max(1, integer(week, 1)) - 1) * DAYS_PER_WEEK + clamp$5(integer(dayOfWeek), 0, 6));
}
function calendarDate(absoluteDay) {
  const safe = Math.max(0, integer(absoluteDay));
  const dayOfYear = safe % DAYS_PER_YEAR;
  const weekOfYear = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;
  const seasonIndex = Math.floor((weekOfYear - 1) / WEEKS_PER_SEASON);
  return {
    absoluteDay: safe,
    year: Math.floor(safe / DAYS_PER_YEAR) + 1,
    weekOfYear,
    season: SEASONS[seasonIndex] ?? "winter",
    weekInSeason: (weekOfYear - 1) % WEEKS_PER_SEASON + 1,
    dayOfWeek: dayOfYear % DAYS_PER_WEEK
  };
}
const THEME_TEMP = { parkland: 59, links: 55, desert: 72 };
const SEASON_TEMP = { spring: 3, summer: 17, autumn: 5, winter: -12 };
const THEME_RAIN = { parkland: 0.26, links: 0.32, desert: 0.09 };
function rawStormCandidate(runSeed, theme, absoluteDay) {
  const date = calendarDate(absoluteDay);
  const seasonal = date.season === "summer" ? 0.025 : date.season === "autumn" ? 0.035 : 0.018;
  const themeChance = theme === "links" ? 0.025 : theme === "desert" ? -6e-3 : 8e-3;
  return unit$1(runSeed, absoluteDay, 41) < seasonal + themeChance;
}
function weatherForDay(runSeed, theme, absoluteDay) {
  const date = calendarDate(absoluteDay);
  const day = date.absoluteDay;
  const wave = Math.sin(day % DAYS_PER_YEAR / DAYS_PER_YEAR * Math.PI * 2 - Math.PI / 2) * 5;
  const temperatureF = Math.round(THEME_TEMP[theme] + SEASON_TEMP[date.season] + wave + (unit$1(runSeed, day, 11) - 0.5) * 15);
  const windBase = theme === "links" ? 12 : theme === "desert" ? 8 : 6;
  const windMph = Math.round(clamp$5(windBase + unit$1(runSeed, day, 17) * 18 + (date.season === "winter" ? 3 : 0), 2, 34));
  const rainChance = clamp$5(THEME_RAIN[theme] + (date.season === "spring" ? 0.08 : date.season === "summer" ? -0.04 : 0), 0.04, 0.42);
  const wetRoll = unit$1(runSeed, day, 23);
  const storm = rawStormCandidate(runSeed, theme, day) && !rawStormCandidate(runSeed, theme, day - 1) && !rawStormCandidate(runSeed, theme, day - 2);
  const drought = theme !== "links" && date.season === "summer" && unit$1(runSeed, day, 29) < (theme === "desert" ? 0.22 : 0.07);
  let kind = "clear";
  if (storm) kind = "storm";
  else if (temperatureF <= 34 && wetRoll < rainChance * 0.7) kind = "frost";
  else if (drought) kind = "drought";
  else if (temperatureF >= (theme === "desert" ? 100 : 91) && wetRoll > rainChance) kind = "heat";
  else if (wetRoll < rainChance * 0.22) kind = "heavy_rain";
  else if (wetRoll < rainChance) kind = "rain";
  else if (wetRoll < rainChance + 0.28) kind = "cloudy";
  const rainInches = kind === "storm" ? Number((0.8 + unit$1(runSeed, day, 31) * 1.2).toFixed(2)) : kind === "heavy_rain" ? Number((0.35 + unit$1(runSeed, day, 31) * 0.55).toFixed(2)) : kind === "rain" || kind === "frost" ? Number((0.05 + unit$1(runSeed, day, 31) * 0.28).toFixed(2)) : 0;
  const severity = clamp$5(
    kind === "storm" ? 0.8 + windMph / 180 : kind === "heavy_rain" ? 0.55 + rainInches / 4 : kind === "drought" || kind === "heat" || kind === "frost" ? 0.42 + Math.abs(68 - temperatureF) / 140 : kind === "rain" ? 0.25 + rainInches / 3 : windMph / 100,
    0,
    1
  );
  return { absoluteDay: day, kind, temperatureF, windMph, rainInches, severity, theme, season: date.season };
}
function forecastForDay(runSeed, theme, absoluteDay) {
  return Array.from({ length: 7 }, (_, offset) => weatherForDay(runSeed, theme, absoluteDay + offset));
}
function weatherModifiers(weather, drainageLevel = 0) {
  const wind = Math.max(0, weather.windMph - 7);
  const drainage = clamp$5(integer(drainageLevel), 0, 3);
  const wetRelief = 1 - drainage * 0.11;
  const base = {
    carryMultiplier: clamp$5(1 - wind * 25e-4, 0.89, 1),
    dispersionMultiplier: clamp$5(1 + wind * 0.012, 1, 1.36),
    demandMultiplier: 1,
    paceMultiplier: 1,
    turfWearMultiplier: 1,
    turfRecoveryMultiplier: 1,
    lodgingMultiplier: 1,
    eventCancellationRisk: 0
  };
  if (weather.kind === "rain") return { ...base, carryMultiplier: base.carryMultiplier * 0.97, dispersionMultiplier: base.dispersionMultiplier * 1.05, demandMultiplier: 0.88, paceMultiplier: 1.08, turfWearMultiplier: 1 + 0.14 * wetRelief, turfRecoveryMultiplier: 1.12, lodgingMultiplier: 1.03, eventCancellationRisk: 0.08 * wetRelief };
  if (weather.kind === "heavy_rain") return { ...base, carryMultiplier: base.carryMultiplier * 0.93, dispersionMultiplier: base.dispersionMultiplier * 1.12, demandMultiplier: 0.62, paceMultiplier: 1.2, turfWearMultiplier: 1 + 0.42 * wetRelief, turfRecoveryMultiplier: 1.08, lodgingMultiplier: 1.07, eventCancellationRisk: 0.34 * wetRelief };
  if (weather.kind === "storm") return { ...base, carryMultiplier: base.carryMultiplier * 0.86, dispersionMultiplier: base.dispersionMultiplier * 1.28, demandMultiplier: 0.2, paceMultiplier: 1.38, turfWearMultiplier: 1 + 0.72 * wetRelief, turfRecoveryMultiplier: 0.9, lodgingMultiplier: 1.12, eventCancellationRisk: clamp$5(0.8 * wetRelief, 0.4, 0.8) };
  if (weather.kind === "heat") return { ...base, demandMultiplier: 0.82, paceMultiplier: 1.08, turfWearMultiplier: 1.24, turfRecoveryMultiplier: 0.78, lodgingMultiplier: 1.04, eventCancellationRisk: 0.08 };
  if (weather.kind === "drought") return { ...base, demandMultiplier: 0.9, turfWearMultiplier: 1.34, turfRecoveryMultiplier: 0.62, lodgingMultiplier: 1.02, eventCancellationRisk: 0.04 };
  if (weather.kind === "frost") return { ...base, carryMultiplier: base.carryMultiplier * 0.94, dispersionMultiplier: base.dispersionMultiplier * 1.06, demandMultiplier: 0.7, paceMultiplier: 1.12, turfWearMultiplier: 1.12, turfRecoveryMultiplier: 0.72, eventCancellationRisk: 0.22 };
  if (weather.kind === "cloudy") return { ...base, demandMultiplier: 0.98, turfRecoveryMultiplier: 1.03 };
  return base;
}
const CHARTER_DEFINITIONS = {
  "public-gem": {
    id: "public-gem",
    name: "Public Gem",
    promise: "Accessible golf, local trust, and a course worth belonging to.",
    tradeoff: "Lower pricing power and greater community scrutiny.",
    eventPool: ["municipal-cup", "junior-day", "community-open"],
    masteryGoals: ["Keep fees accessible", "Build local trust", "Develop returning regulars"],
    benefits: { demandMultiplier: 1.08, reputationMultiplier: 1.08, operatingCostMultiplier: 1, lodgingMultiplier: 0.94, tournamentMultiplier: 0.96, relationshipMultiplier: 1.12 }
  },
  "championship-venue": {
    id: "championship-venue",
    name: "Championship Venue",
    promise: "Exacting golf, complete setups, and tournaments that test the best.",
    tradeoff: "Higher presentation costs and less tolerance for weak condition.",
    eventPool: ["regional-invitational", "national-qualifier", "course-setup-week"],
    masteryGoals: ["Qualify every tee", "Host a championship", "Produce a course record"],
    benefits: { demandMultiplier: 0.98, reputationMultiplier: 1.04, operatingCostMultiplier: 1.06, lodgingMultiplier: 1, tournamentMultiplier: 1.16, relationshipMultiplier: 0.98 }
  },
  "destination-retreat": {
    id: "destination-retreat",
    name: "Destination Retreat",
    promise: "A complete stay where golf, hospitality, and landscape reinforce one another.",
    tradeoff: "More capital is tied to service capacity and weather-sensitive trips.",
    eventPool: ["stay-and-play-week", "architects-retreat", "destination-cup"],
    masteryGoals: ["Sustain lodging service", "Complete guest itineraries", "Earn destination appeal"],
    benefits: { demandMultiplier: 0.96, reputationMultiplier: 1, operatingCostMultiplier: 1.04, lodgingMultiplier: 1.16, tournamentMultiplier: 1.04, relationshipMultiplier: 1.02 }
  },
  "member-institution": {
    id: "member-institution",
    name: "Member Institution",
    promise: "Continuity, relationships, and standards that compound over generations.",
    tradeoff: "A narrower audience and strong expectations around staff and tradition.",
    eventPool: ["captains-match", "founders-day", "member-guest"],
    masteryGoals: ["Retain members", "Develop named staff", "Complete a relationship arc"],
    benefits: { demandMultiplier: 0.92, reputationMultiplier: 1.03, operatingCostMultiplier: 1.02, lodgingMultiplier: 1.02, tournamentMultiplier: 1.02, relationshipMultiplier: 1.14 }
  }
};
function charterDefinition(charter) {
  return CHARTER_DEFINITIONS[charter];
}
function normalizeWeather(input, fallback) {
  if (!input || typeof input !== "object") return fallback;
  const candidate = input;
  const kinds = /* @__PURE__ */ new Set(["clear", "cloudy", "rain", "heavy_rain", "storm", "heat", "drought", "frost"]);
  return {
    ...fallback,
    absoluteDay: Math.max(0, integer(candidate.absoluteDay, fallback.absoluteDay)),
    kind: kinds.has(candidate.kind) ? candidate.kind : fallback.kind,
    temperatureF: clamp$5(integer(candidate.temperatureF, fallback.temperatureF), -20, 125),
    windMph: clamp$5(integer(candidate.windMph, fallback.windMph), 0, 70),
    rainInches: clamp$5(finite$2(candidate.rainInches, fallback.rainInches), 0, 5),
    severity: clamp$5(finite$2(candidate.severity, fallback.severity), 0, 1)
  };
}
function validCharter(value) {
  return CLUB_CHARTERS.includes(value);
}
function createSeasonalState(args) {
  const theme = args.theme ?? "parkland";
  const absoluteDay = absoluteDayFor(args.week ?? 1, args.day ?? 0);
  const currentWeather = weatherForDay(args.runSeed, theme, absoluteDay);
  return {
    version: 1,
    calendar: calendarDate(absoluteDay),
    lastCommittedAbsoluteDay: args.migrated ? absoluteDay - 1 : -1,
    currentWeather,
    forecast: forecastForDay(args.runSeed, theme, absoluteDay),
    forecastPublishedAbsoluteDay: absoluteDay,
    charter: "public-gem",
    charterSelectedYear: 1,
    charterReviewedYears: [],
    charterChanges: [],
    automation: {
      preset: "balanced",
      advancedOperations: args.migrated === true,
      overrides: args.migrated ? ["hours", "upkeep", "pricing", "staffing", "parking", "lodging", "community", "safety"] : [],
      lastAppliedAbsoluteDay: -1,
      decisions: [],
      baselineMaintenanceBudget: 0,
      baselineGreenFees: {},
      baselineAssetPrices: {}
    },
    operations: {
      turfPriority: "playability",
      waterPolicy: "balanced",
      drainageLevel: 0,
      drainageConstructionDays: 0,
      closedCourseIds: [],
      closedHoleIds: [],
      responses: []
    },
    yearbooks: [],
    timeline: [],
    hallOfFame: [],
    lastClosedYear: 0
  };
}
function normalizeSeasonalState(input, args) {
  const fallback = createSeasonalState(args);
  if (!input || typeof input !== "object") return fallback;
  const candidate = input;
  const calendar = calendarDate(Math.max(0, integer(candidate.calendar?.absoluteDay, fallback.calendar.absoluteDay)));
  const automationPresets = /* @__PURE__ */ new Set(["stewardship", "balanced", "growth"]);
  const turfPriorities = /* @__PURE__ */ new Set(["playability", "recovery", "presentation"]);
  const waterPolicies = /* @__PURE__ */ new Set(["conserve", "balanced", "irrigate"]);
  const yearbooks = Array.isArray(candidate.yearbooks) ? candidate.yearbooks.filter((book) => !!book && typeof book === "object" && Number.isInteger(book.year)).slice(-40) : [];
  const timeline = Array.isArray(candidate.timeline) ? candidate.timeline.filter((entry) => !!entry && typeof entry === "object" && typeof entry.id === "string").slice(-320) : [];
  const hallOfFame = Array.isArray(candidate.hallOfFame) ? candidate.hallOfFame.filter((award2) => !!award2 && typeof award2 === "object" && typeof award2.id === "string").slice(-120) : [];
  const weatherFallback = weatherForDay(args.runSeed, args.theme ?? "parkland", calendar.absoluteDay);
  return {
    version: 1,
    calendar,
    lastCommittedAbsoluteDay: integer(candidate.lastCommittedAbsoluteDay, fallback.lastCommittedAbsoluteDay),
    currentWeather: normalizeWeather(candidate.currentWeather, weatherFallback),
    forecast: Array.isArray(candidate.forecast) ? candidate.forecast.slice(0, 7).map((weather, offset) => normalizeWeather(weather, weatherForDay(args.runSeed, args.theme ?? "parkland", calendar.absoluteDay + offset))) : fallback.forecast,
    forecastPublishedAbsoluteDay: Math.max(0, integer(candidate.forecastPublishedAbsoluteDay, calendar.absoluteDay)),
    charter: validCharter(candidate.charter) ? candidate.charter : fallback.charter,
    charterSelectedYear: Math.max(1, integer(candidate.charterSelectedYear, 1)),
    charterReviewedYears: Array.isArray(candidate.charterReviewedYears) ? [...new Set(candidate.charterReviewedYears.map((year) => integer(year)).filter((year) => year > 0))].slice(-40) : [],
    charterChanges: Array.isArray(candidate.charterChanges) ? candidate.charterChanges.filter((entry) => entry && validCharter(entry.from) && validCharter(entry.to)).slice(-40) : [],
    automation: {
      preset: automationPresets.has(candidate.automation?.preset) ? candidate.automation.preset : fallback.automation.preset,
      advancedOperations: candidate.automation?.advancedOperations === true,
      overrides: strings(candidate.automation?.overrides, 8),
      lastAppliedAbsoluteDay: integer(candidate.automation?.lastAppliedAbsoluteDay, -1),
      decisions: strings(candidate.automation?.decisions, 16),
      baselineMaintenanceBudget: Math.max(0, finite$2(candidate.automation?.baselineMaintenanceBudget)),
      baselineGreenFees: candidate.automation?.baselineGreenFees && typeof candidate.automation.baselineGreenFees === "object" ? Object.fromEntries(Object.entries(candidate.automation.baselineGreenFees).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).slice(0, 36)) : {},
      baselineAssetPrices: candidate.automation?.baselineAssetPrices && typeof candidate.automation.baselineAssetPrices === "object" ? Object.fromEntries(Object.entries(candidate.automation.baselineAssetPrices).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).slice(0, 160)) : {}
    },
    operations: {
      turfPriority: turfPriorities.has(candidate.operations?.turfPriority ?? "") ? candidate.operations.turfPriority : fallback.operations.turfPriority,
      waterPolicy: waterPolicies.has(candidate.operations?.waterPolicy ?? "") ? candidate.operations.waterPolicy : fallback.operations.waterPolicy,
      drainageLevel: clamp$5(integer(candidate.operations?.drainageLevel), 0, 3),
      drainageConstructionDays: clamp$5(integer(candidate.operations?.drainageConstructionDays), 0, 60),
      closedCourseIds: strings(candidate.operations?.closedCourseIds, 36),
      closedHoleIds: strings(candidate.operations?.closedHoleIds, 36),
      responses: Array.isArray(candidate.operations?.responses) ? candidate.operations.responses.filter((response2) => response2 && typeof response2.id === "string").slice(-160) : []
    },
    yearbooks,
    timeline,
    hallOfFame,
    lastClosedYear: Math.max(0, integer(candidate.lastClosedYear)),
    ...typeof candidate.pendingYearbookId === "string" && yearbooks.some((book) => book.id === candidate.pendingYearbookId) ? { pendingYearbookId: candidate.pendingYearbookId } : {}
  };
}
function seasonalState(world, course, day = 0) {
  return normalizeSeasonalState(world.seasonal, {
    runSeed: world.runSeed,
    theme: course.theme,
    week: world.week,
    day,
    migrated: world.seasonal == null
  });
}
function activeWeather(world, course, day) {
  return weatherForDay(world.runSeed, course.theme ?? "parkland", absoluteDayFor(world.week, day));
}
function charterBenefits(world, course, day = 0) {
  const state = seasonalState(world, course, day);
  return charterDefinition(state.charter).benefits;
}
({
  tiles: Array.from({ length: COURSE_WIDTH * COURSE_HEIGHT }, () => "rough"),
  elevations: Array.from({ length: COURSE_WIDTH * COURSE_HEIGHT }, () => 0),
  holes: Array.from({ length: 9 }, (_, i) => ({
    id: `hole-${i + 1}`,
    teeBoxes: { forward: null, member: null, championship: null },
    pinPositions: { A: null, B: null, C: null },
    tee: null,
    green: null,
    parByTee: { forward: { mode: "AUTO" }, member: { mode: "AUTO" }, championship: { mode: "AUTO" } },
    parMode: "AUTO",
    parManual: void 0,
    name: `Hole ${i + 1}`
  })),
  layouts: [{
    id: "course-primary",
    name: "West Village Municipal",
    draftHoleIds: Array.from({ length: 9 }, (_, i) => `hole-${i + 1}`),
    publishedHoleIds: Array.from({ length: 9 }, (_, i) => `hole-${i + 1}`),
    roundLength: 9,
    state: "open",
    greenFee: 65,
    operations: normalizeOperations(),
    legacyPartial: void 0
  }]
});
const DEFAULT_WORLD = {
  week: 1,
  cash: 25e3,
  reputation: 40,
  staffLevel: 1,
  staffRoster: staffFromLevel(1, "course-primary"),
  marketingLevel: 0,
  maintenanceBudget: 900,
  runSeed: 1337,
  distressWeeks: 0,
  isBankrupt: false,
  lastWeekProfit: 0,
  lastBridgeLoanWeek: -999,
  loans: [],
  objectives: null,
  mode: "sandbox",
  difficulty: "normal",
  tournaments: { version: 2, events: [] },
  enterprise: emptyPropertyEnterprise(),
  livingClub: emptyLivingClubState(),
  seasonal: createSeasonalState({ runSeed: 1337, theme: "parkland" }),
  paceOperations: { version: 1, courses: {} }
};
const clamp$4 = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const clamp01$5 = (value) => Math.max(0, Math.min(1, value));
function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function jitter(seed, salt) {
  let x = (seed ^ Math.imul(salt, 73244475)) >>> 0;
  x = Math.imul(x ^ x >>> 16, 73244475) >>> 0;
  x = Math.imul(x ^ x >>> 16, 73244475) >>> 0;
  return ((x ^ x >>> 16) / 4294967295 - 0.5) * 2;
}
function styleFor(riskTolerance) {
  if (riskTolerance >= 0.67) return "aggressive";
  if (riskTolerance <= 0.35) return "conservative";
  return "balanced";
}
function labels(values) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  return {
    strengths: entries.slice(0, 2).map(([key2]) => key2),
    weaknesses: entries.slice(-2).reverse().map(([key2]) => key2)
  };
}
function stableGolferSeed(identity, fallback) {
  return hashSeed(identity || `golfer:${fallback >>> 0}`);
}
function createGolferCapabilities(args) {
  const { personality: p, seed } = args;
  const skill = clamp01$5(p.skill);
  const consistency = clamp01$5(p.consistency);
  const jittered = (base, salt, spread = 5) => clamp$4(base + jitter(seed, salt) * spread);
  const riskTolerance = clamp01$5(0.5 + p.prefs.difficulty * 0.36 + (skill - 0.5) * 0.18 + jitter(seed, 11) * 0.04);
  const challengeSeeking = clamp01$5(0.5 + p.prefs.difficulty * 0.5 + jitter(seed, 13) * 0.08);
  const values = {
    power: jittered(skill * 100 + p.prefs.difficulty * 4, 1),
    accuracy: jittered((skill * 0.7 + consistency * 0.3) * 100, 2),
    irons: jittered((skill * 0.62 + consistency * 0.38) * 100, 3),
    shortGame: jittered((skill * 0.45 + consistency * 0.55) * 100, 4),
    recovery: jittered((skill * 0.35 + consistency * 0.65 + (1 - Math.abs(p.prefs.difficulty)) * 0.08) * 100, 5),
    consistency: jittered(consistency * 100, 6)
  };
  const labelsForValues = labels(values);
  return {
    version: 1,
    seed: seed >>> 0,
    ...values,
    riskTolerance,
    challengeSeeking,
    sceneryAffinity: clamp01$5((p.prefs.scenery + 1) / 2),
    valueSensitivity: clamp01$5((1 - p.prefs.price) / 2),
    riskStyle: styleFor(riskTolerance),
    strengths: labelsForValues.strengths,
    weaknesses: labelsForValues.weaknesses
  };
}
function normalizeGolferCapabilities(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value;
  const number = (key2, defaultValue) => {
    const item = candidate[key2];
    return typeof item === "number" && Number.isFinite(item) ? item : defaultValue;
  };
  const riskTolerance = clamp01$5(number("riskTolerance", fallback.riskTolerance));
  const riskStyle = candidate.riskStyle === "aggressive" || candidate.riskStyle === "conservative" || candidate.riskStyle === "balanced" ? candidate.riskStyle : styleFor(riskTolerance);
  return {
    version: 1,
    seed: Math.max(0, Math.floor(number("seed", fallback.seed))) >>> 0,
    power: clamp$4(number("power", fallback.power)),
    accuracy: clamp$4(number("accuracy", fallback.accuracy)),
    irons: clamp$4(number("irons", fallback.irons)),
    shortGame: clamp$4(number("shortGame", fallback.shortGame)),
    recovery: clamp$4(number("recovery", fallback.recovery)),
    consistency: clamp$4(number("consistency", fallback.consistency)),
    riskTolerance,
    challengeSeeking: clamp01$5(number("challengeSeeking", fallback.challengeSeeking)),
    sceneryAffinity: clamp01$5(number("sceneryAffinity", fallback.sceneryAffinity)),
    valueSensitivity: clamp01$5(number("valueSensitivity", fallback.valueSensitivity)),
    riskStyle,
    strengths: Array.isArray(candidate.strengths) ? candidate.strengths.filter((item) => typeof item === "string").slice(0, 4) : fallback.strengths.slice(),
    weaknesses: Array.isArray(candidate.weaknesses) ? candidate.weaknesses.filter((item) => typeof item === "string").slice(0, 4) : fallback.weaknesses.slice()
  };
}
function capabilitiesToPlayerSkills(capabilities) {
  return {
    power: capabilities.power,
    driving: capabilities.accuracy,
    irons: capabilities.irons,
    shortGame: capabilities.shortGame,
    putting: (capabilities.shortGame + capabilities.consistency) / 2,
    recovery: capabilities.recovery
  };
}
function clamp01$4(n) {
  return Math.max(0, Math.min(1, n));
}
function rollDiscretionaryWallet(personality, rng) {
  return Math.round(12 + personality.spendPropensity * 70 + rng() * 35);
}
function planPurchase(args) {
  const options = args.course.buildings.filter(isConcession).filter((b) => b.type === args.type);
  if (options.length === 0) return null;
  const ranked = options.map((building) => ({
    building,
    entrance: buildingEntrance(args.course, building)
  })).sort(
    (a, b) => Math.hypot(a.entrance.x - args.from.x, a.entrance.y - args.from.y) - Math.hypot(b.entrance.x - args.from.x, b.entrance.y - args.from.y)
  );
  const pick = ranked[0];
  const spec2 = BUILDING_SPECS[pick.building.type];
  const amount = Math.max(1, Math.round(pick.building.price ?? spec2.defaultPrice));
  if (amount > args.wallet) return null;
  const distance2 = Math.hypot(pick.entrance.x - args.from.x, pick.entrance.y - args.from.y);
  const priceAppeal = clamp01$4(1.25 - amount / Math.max(8, spec2.defaultPrice * 2.5));
  const proximity = 1 / (1 + distance2 / 28);
  const tierAppeal = 0.9 + ((pick.building.tier ?? 1) - 1) * 0.12;
  const chance = clamp01$4(
    args.personality.spendPropensity * (0.45 + args.satisfaction * 0.55) * (0.55 + proximity * 0.45) * priceAppeal * tierAppeal
  );
  if (args.rng() >= chance) return null;
  return {
    building: pick.building,
    entrance: pick.entrance,
    amount,
    item: spec2.item,
    serviceMinutes: spec2.serviceMinutes / Math.max(1, pick.building.tier ?? 1)
  };
}
const LIVE = {
  day: {
    openMinute: 0,
    // 6 AM
    closeMinute: 840,
    // 14 hours of daylight -> 8:00 PM
    lastArrivalMinute: 600,
    // no new golfers after this
    firstArrivalMinute: 20,
    // Minimum game-minutes between successive tee-offs, so arriving golfers
    // queue at the first tee instead of all starting at once (ZKU-110).
    teeGapMinutes: 7
  },
  // Entry/exit is a point on the left edge of the course where golfers walk in.
  entry: { xFrac: 0.02, yFrac: 0.5 },
  // Segment pacing (game-minutes).
  pace: {
    swingPause: 0.4,
    flightPerTile: 0.05,
    flightMin: 0.3,
    flightMax: 1,
    walkPerTile: 0.15,
    interHoleWalkCap: 6,
    puttPause: 0.3,
    puttWalk: 0.2,
    recoverySearchPause: 2.5
  },
  // Golfers actually simulated & drawn per day. Derived from the blended demand
  // index, then clamped into a watchable range (you see every golfer on-course).
  volume: {
    minGolfers: 3,
    maxGolfers: 42,
    // Demand index treated as a "full house" — days at or above this fill the
    // course to maxGolfers. The blended index tops out around 1.2.
    demandFullHouse: 1
  },
  mood: {
    start: 0.7,
    // neutral-happy on arrival
    perStrokeOverPar: -0.06,
    // each stroke over par nudges mood down
    perStrokeUnderPar: 0.05,
    // course condition contribution
    min: 0,
    max: 1
  },
  // Thresholds that turn a finished golfer's mood into a discrete reaction,
  // aggregated into reputation (ZKU-116).
  reactions: {
    promoterMood: 0.8,
    // at/above this they'd recommend the course
    detractorMood: 0.45,
    // at/below this they leave disappointed
    returnMood: 0.55,
    // at/above this (after a patience nudge) they'd return
    returnPatienceNudge: 0.1
    // patient golfers forgive a so-so round
  }
};
const M47_MAX_PLANS = 36;
const M47_MAX_OUTCOMES = 240;
const M47_MAX_REACTIONS = 36;
function landingBehavior(terrain) {
  switch (terrain) {
    case "fairway":
    case "tee":
    case "path":
      return { rollTiles: 1.6, bounces: 2, bounceScale: 0.22, fx: "grass", sinks: false };
    case "green":
      return { rollTiles: 0.5, bounces: 1, bounceScale: 0.12, fx: "check", sinks: false };
    case "sand":
      return { rollTiles: 0.12, bounces: 0, bounceScale: 0, fx: "sand", sinks: false };
    case "waste_area":
      return { rollTiles: BALANCE.terrain.rolloutTiles.waste_area, bounces: 1, bounceScale: 0.08, fx: "sand", sinks: false };
    case "water":
    case "wetland":
      return { rollTiles: 0, bounces: 0, bounceScale: 0, fx: "splash", sinks: true };
    case "rough":
    case "deep_rough":
      return { rollTiles: 0.35, bounces: 1, bounceScale: 0.1, fx: "grass", sinks: false };
    default:
      return { rollTiles: 0.5, bounces: 1, bounceScale: 0.15, fx: null, sinks: false };
  }
}
const CLUBS$1 = [
  { name: "Driver", carryYards: 270, dispersionTilesBase: 3.7, skill: "driving", lies: ["tee", "fairway"] },
  { name: "3 Wood", carryYards: 235, dispersionTilesBase: 3.2, skill: "driving", lies: ["tee", "fairway", "rough"] },
  { name: "5 Iron", carryYards: 185, dispersionTilesBase: 2.55, skill: "irons", lies: ["tee", "fairway", "rough", "waste_area"] },
  { name: "7 Iron", carryYards: 155, dispersionTilesBase: 2.1, skill: "irons", lies: ["tee", "fairway", "rough", "waste_area", "sand"] },
  { name: "Pitching Wedge", carryYards: 115, dispersionTilesBase: 1.55, skill: "shortGame", lies: ["tee", "fairway", "rough", "deep_rough", "waste_area", "sand"] },
  { name: "Sand Wedge", carryYards: 78, dispersionTilesBase: 1.35, skill: "recovery", lies: ["fairway", "rough", "deep_rough", "sand", "waste_area"] },
  { name: "Chip", carryYards: 38, dispersionTilesBase: 0.82, skill: "shortGame", lies: ["fairway", "rough", "deep_rough", "green", "sand", "waste_area"] },
  { name: "Putter", carryYards: 28, dispersionTilesBase: 0.38, skill: "putting", lies: ["green", "fairway"] }
];
function clamp$3(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function courseFromSnapshot(snapshot) {
  return {
    width: snapshot.width,
    height: snapshot.height,
    tiles: snapshot.tiles,
    elevations: snapshot.elevations,
    holes: snapshot.holes.map((hole) => ({
      id: hole.id,
      name: hole.name,
      tee: hole.tee,
      green: hole.pin,
      waypoints: hole.waypoints,
      parMode: "MANUAL",
      parManual: hole.par
    })),
    layouts: [{
      id: snapshot.courseId,
      name: snapshot.courseName,
      draftHoleIds: snapshot.holes.map((hole) => hole.id),
      publishedHoleIds: snapshot.holes.map((hole) => hole.id),
      roundLength: snapshot.holes.length > 9 ? 18 : 9,
      state: "open",
      greenFee: 0,
      legacyPartial: snapshot.holes.length !== 9 && snapshot.holes.length !== 18
    }],
    activeCourseId: snapshot.courseId,
    obstacles: snapshot.obstacles,
    buildings: [],
    yardsPerTile: snapshot.yardsPerTile,
    name: snapshot.courseName,
    baseGreenFee: 0,
    condition: 1,
    theme: snapshot.theme
  };
}
function lieAt(snapshot, pointValue) {
  const x = clamp$3(Math.round(pointValue.x), 0, snapshot.width - 1);
  const y = clamp$3(Math.round(pointValue.y), 0, snapshot.height - 1);
  return snapshot.tiles[y * snapshot.width + x] ?? "rough";
}
function skillForClub(club, lie) {
  if (lie === "sand" || lie === "deep_rough" || lie === "waste_area" || club === "Sand Wedge") return "recovery";
  return CLUBS$1.find((candidate) => candidate.name === club)?.skill ?? "irons";
}
function profileForPlayer(snapshot, skills, club) {
  const skill = skillForClub(club.name, "fairway");
  const value = skills[skill];
  const power = skills.power;
  return {
    name: value >= 70 ? "SCRATCH" : "BOGEY",
    yardsPerTile: snapshot.yardsPerTile,
    clubs: [{
      ...club,
      carryYards: club.carryYards * (0.82 + power / 500) * (snapshot.weather?.carryMultiplier ?? 1),
      dispersionTilesBase: club.dispersionTilesBase * (1.42 - value / 180) * (snapshot.weather?.dispersionMultiplier ?? 1)
    }],
    ratingMultipliers: {
      hazard: 1.35 - skills.recovery / 180,
      rough: 1.3 - skills.recovery / 200,
      deepRough: 1.55 - skills.recovery / 170,
      obstacle: 1.35 - skills.recovery / 190
    }
  };
}
function gaussian(rng) {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function roundedPoint(value) {
  return { x: Number(value.x.toFixed(3)), y: Number(value.y.toFixed(3)) };
}
function resolvePlayableShot(args) {
  const club = CLUBS$1.find((candidate) => candidate.name === args.selection.club) ?? CLUBS$1[4];
  const course = courseFromSnapshot(args.snapshot);
  const profile = profileForPlayer(args.snapshot, args.skills, club);
  const adjustedClub = profile.clubs[0];
  const power = clamp$3(args.selection.power, 0.25, 1.15);
  const dx = args.selection.aim.x - args.from.x;
  const dy = args.selection.aim.y - args.from.y;
  const aimDistance = Math.max(1e-3, Math.hypot(dx, dy));
  const ux = dx / aimDistance;
  const uy = dy / aimDistance;
  const obstacleClose = args.snapshot.obstacles.some((obstacle) => Math.hypot(obstacle.x - args.from.x, obstacle.y - args.from.y) < 1.6);
  const obstructionPenalty = obstacleClose && args.selection.technique !== "punch" && club.name !== "Sand Wedge" && club.name !== "Chip";
  const maxTiles = adjustedClub.carryYards * power * (obstructionPenalty ? 0.78 : 1) / args.snapshot.yardsPerTile;
  const intendedTiles = Math.min(aimDistance, maxTiles);
  const evaluation = evalShotExpectedCost({ course, from: args.from, to: args.selection.aim, golfer: profile, club: adjustedClub });
  const techniqueDispersion = args.selection.technique === "normal" ? 1 : args.selection.technique === "punch" ? 0.82 : 1.12;
  const dispersion = Math.max(0.12, evaluation.dispersionTiles * techniqueDispersion * (obstructionPenalty ? 1.55 : 1));
  const rng = mulberry32(args.seed | 0);
  const lateral = gaussian(rng) * dispersion * 0.42;
  const longitudinal = gaussian(rng) * dispersion * 0.22;
  const curveSign = args.selection.technique === "draw" ? -1 : args.selection.technique === "fade" ? 1 : 0;
  const curve = curveSign * Math.min(2.2, intendedTiles * 0.055);
  let landing = {
    x: args.from.x + ux * (intendedTiles + longitudinal) - uy * (lateral + curve),
    y: args.from.y + uy * (intendedTiles + longitudinal) + ux * (lateral + curve)
  };
  const outside = landing.x < 0 || landing.y < 0 || landing.x >= args.snapshot.width || landing.y >= args.snapshot.height;
  landing = {
    x: clamp$3(landing.x, 0, args.snapshot.width - 1),
    y: clamp$3(landing.y, 0, args.snapshot.height - 1)
  };
  const landingTerrain = outside ? "out_of_play" : lieAt(args.snapshot, landing);
  const hazard = outside || landingTerrain === "water" || landingTerrain === "wetland";
  const behavior = landingBehavior(landingTerrain === "out_of_play" ? null : landingTerrain);
  let rollTiles = hazard || club.name === "Putter" ? 0 : behavior.rollTiles;
  if (args.snapshot.weather) {
    if (["rain", "heavy_rain", "storm"].includes(args.snapshot.weather.kind)) rollTiles *= 0.55;
    else if (args.snapshot.weather.kind === "drought" || args.snapshot.weather.kind === "heat") rollTiles *= 1.22;
    else if (args.snapshot.weather.kind === "frost") rollTiles *= 0.78;
  }
  if (args.selection.technique === "backspin" || args.selection.technique === "flop") rollTiles *= 0.25;
  if (args.selection.technique === "punch") rollTiles *= 1.65;
  if (club.name === "Chip") rollTiles *= 0.55;
  let rest = hazard ? { ...args.from } : {
    x: clamp$3(landing.x + ux * rollTiles, 0, args.snapshot.width - 1),
    y: clamp$3(landing.y + uy * rollTiles, 0, args.snapshot.height - 1)
  };
  const hole = args.snapshot.holes.find((candidate) => candidate.id === args.holeId);
  const puttingSkill = args.skills.putting;
  const cupRadius = club.name === "Putter" ? 0.42 + puttingSkill / 240 : 0.22;
  const holed = !hazard && Math.hypot(rest.x - hole.pin.x, rest.y - hole.pin.y) <= cupRadius;
  if (holed) rest = { ...hole.pin };
  const lieAfter = holed ? "cup" : hazard ? lieAt(args.snapshot, args.from) : lieAt(args.snapshot, rest);
  const demonstratedSkill = skillForClub(club.name, args.lie);
  const successful = !hazard && (lieAfter === "green" || lieAfter === "cup" || evaluation.expectedShotCost < 1.55);
  const evidence = [{
    id: `evidence-${args.holeId}-${args.shotNumber}-${demonstratedSkill}`,
    skill: demonstratedSkill,
    amount: successful ? 3 : 1,
    reason: `${club.name}:${args.lie}->${lieAfter}`,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    successful
  }];
  if (club.name === "Driver" && successful) evidence.push({
    id: `evidence-${args.holeId}-${args.shotNumber}-power`,
    skill: "power",
    amount: 2,
    reason: `carry:${Math.round(intendedTiles * args.snapshot.yardsPerTile)}`,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    successful: true
  });
  return {
    id: `shot-${args.holeId}-${args.shotNumber}`,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    club: club.name,
    technique: args.selection.technique,
    power,
    from: roundedPoint(args.from),
    aim: roundedPoint(args.selection.aim),
    landing: roundedPoint(landing),
    rest: roundedPoint(rest),
    carryYards: Number((Math.hypot(landing.x - args.from.x, landing.y - args.from.y) * args.snapshot.yardsPerTile).toFixed(1)),
    rollYards: Number((Math.hypot(rest.x - landing.x, rest.y - landing.y) * args.snapshot.yardsPerTile).toFixed(1)),
    lieBefore: args.lie,
    lieAfter,
    penaltyStrokes: hazard ? 1 : 0,
    holed,
    seed: args.seed,
    evidence
  };
}
function parFor(hole) {
  const setting = getParSetting(hole, "member");
  return setting.mode === "MANUAL" ? setting.par : 4;
}
function liveCourseSnapshot(args) {
  const holes = args.course.holes.map((hole, index) => {
    const setup = resolveCourseSetup(hole, args.teeSet, args.pinRotation);
    return {
      id: hole.id ?? `hole-${index + 1}`,
      name: hole.name ?? `Hole ${index + 1}`,
      par: parFor(hole),
      tee: setup.tee ?? hole.tee ?? { x: 0, y: 0 },
      pin: setup.pin ?? hole.green ?? { x: 0, y: 0 },
      waypoints: hole.waypoints?.map((point2) => ({ ...point2 })) ?? []
    };
  });
  return {
    courseId: args.course.activeCourseId ?? "course-primary",
    courseName: args.course.name ?? "Live course",
    geometryVersion: void 0,
    theme: args.course.theme ?? "parkland",
    width: args.course.width,
    height: args.course.height,
    yardsPerTile: args.course.yardsPerTile,
    tiles: args.course.tiles.slice(),
    elevations: args.course.elevations.slice(),
    obstacles: args.course.obstacles.map((obstacle) => ({ x: obstacle.x, y: obstacle.y, type: obstacle.type })),
    holes,
    weather: args.weather
  };
}
function resolveLiveShot(args) {
  const selection = {
    club: args.intent.club,
    aim: args.intent.target,
    power: args.intent.power,
    technique: args.intent.technique
  };
  const trace = resolvePlayableShot({
    snapshot: args.snapshot,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    from: args.from,
    lie: args.lie,
    skills: capabilitiesToPlayerSkills(args.capabilities),
    selection,
    seed: args.seed
  });
  const facts = args.intent.facts.slice();
  if (trace.penaltyStrokes > 0) facts.push({ code: "outcome", detail: `penalty:${trace.penaltyStrokes}` });
  facts.push({ code: "outcome", detail: `rest:${trace.lieAfter}` });
  return {
    version: 1,
    id: trace.id,
    holeId: trace.holeId,
    shotNumber: trace.shotNumber,
    intentId: args.intent.id,
    intent: args.intent.kind,
    club: trace.club,
    technique: trace.technique,
    from: { ...trace.from },
    aim: { ...trace.aim },
    landing: { ...trace.landing },
    rest: { ...trace.rest },
    lieBefore: trace.lieBefore,
    lieAfter: trace.lieAfter,
    carryYards: trace.carryYards,
    rollYards: trace.rollYards,
    penaltyStrokes: trace.penaltyStrokes,
    holed: trace.holed,
    seed: trace.seed,
    facts
  };
}
function terrainAt(course, point2) {
  const x = Math.max(0, Math.min(course.width - 1, Math.round(point2.x)));
  const y = Math.max(0, Math.min(course.height - 1, Math.round(point2.y)));
  return course.tiles[y * course.width + x] ?? "rough";
}
const clamp$2 = (value, min, max) => Math.max(min, Math.min(max, value));
const playable = /* @__PURE__ */ new Set(["tee", "fairway", "rough", "deep_rough", "green", "sand", "waste_area"]);
const INTENTS = ["safe", "hero", "positional", "recovery", "approach"];
const CLUBS = {
  Driver: { carry: 270, dispersion: 3.7 },
  "3 Wood": { carry: 235, dispersion: 3.2 },
  "5 Iron": { carry: 185, dispersion: 2.55 },
  "7 Iron": { carry: 155, dispersion: 2.1 },
  "Pitching Wedge": { carry: 115, dispersion: 1.55 },
  "Sand Wedge": { carry: 78, dispersion: 1.35 },
  Chip: { carry: 38, dispersion: 0.82 },
  Putter: { carry: 28, dispersion: 0.38 }
};
function distance$1(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function unit(a, b) {
  const d = Math.max(1e-3, distance$1(a, b));
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
function pointAt(a, b, fraction, offset = 0) {
  const u = unit(a, b);
  return { x: a.x + (b.x - a.x) * fraction - u.y * offset, y: a.y + (b.y - a.y) * fraction + u.x * offset };
}
function inBounds(course, point2) {
  return point2.x >= 0 && point2.y >= 0 && point2.x < course.width && point2.y < course.height;
}
function targetNear(course, raw, preferSafe) {
  const candidates = [];
  for (let radius = 0; radius <= 5; radius++) {
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
      const candidate = { x: Math.round(raw.x + x), y: Math.round(raw.y + y) };
      if (inBounds(course, candidate) && playable.has(terrainAt(course, candidate))) candidates.push(candidate);
    }
    if (candidates.length) break;
  }
  if (!candidates.length) return { x: clamp$2(Math.round(raw.x), 0, course.width - 1), y: clamp$2(Math.round(raw.y), 0, course.height - 1) };
  return candidates.sort((a, b) => {
    const terrainScore = (point2) => {
      const terrain = terrainAt(course, point2);
      if (terrain === "fairway" || terrain === "green" || terrain === "tee") return 0;
      if (terrain === "rough") return 1;
      if (terrain === "deep_rough") return 3;
      return 4;
    };
    return terrainScore(a) - terrainScore(b) || distance$1(a, raw) - distance$1(b, raw) || a.y - b.y || a.x - b.x;
  })[0];
}
function profileFor(capabilities, course) {
  const base = getGolferProfile(capabilities.accuracy >= 65 ? "SCRATCH" : "BOGEY", course);
  const scale = (club) => ({
    ...club,
    carryYards: club.carryYards * (0.84 + capabilities.power / 480),
    dispersionTilesBase: club.dispersionTilesBase * (1.38 - capabilities.accuracy / 220)
  });
  return {
    ...base,
    clubs: base.clubs.map(scale),
    ratingMultipliers: {
      hazard: 1.42 - capabilities.recovery / 190,
      rough: 1.34 - capabilities.recovery / 210,
      deepRough: 1.62 - capabilities.recovery / 175,
      obstacle: 1.42 - capabilities.recovery / 190
    }
  };
}
function chooseClub(kind, from, target, capabilities, lie) {
  const d = distance$1(from, target) * 10;
  const names = lie === "green" ? ["Putter", "Chip"] : kind === "hero" ? ["Driver", "3 Wood", "5 Iron"] : kind === "safe" ? ["3 Wood", "5 Iron", "Driver"] : ["Driver", "3 Wood", "5 Iron", "7 Iron", "Pitching Wedge"];
  const available = names.filter((name2) => CLUBS[name2]);
  const name = available.find((candidate) => CLUBS[candidate].carry * 1.1 >= d) ?? available[available.length - 1] ?? "7 Iron";
  const carry = CLUBS[name].carry * (0.84 + capabilities.power / 480);
  return { name, power: clamp$2(d / Math.max(1, carry), 0.35, kind === "hero" ? 1.12 : 0.98) };
}
function candidateTarget(course, hole, kind) {
  const tee2 = hole.tee;
  const green2 = hole.green;
  if (kind === "hero" || kind === "approach") return { ...green2 };
  if (kind === "safe") return targetNear(course, pointAt(tee2, green2, 0.66, 0));
  if (kind === "positional") {
    const waypoint = hole.waypoints?.[0];
    return targetNear(course, waypoint ? { ...waypoint } : pointAt(tee2, green2, 0.58, 3.5));
  }
  return targetNear(course, pointAt(tee2, green2, 0.46, -3.5));
}
function buildIntent(args) {
  const from = { ...args.hole.tee };
  const target = candidateTarget(args.course, args.hole, args.kind);
  const club = chooseClub(args.kind, from, target, args.capabilities, terrainAt(args.course, from));
  const clubSpec = args.profile.clubs.find((candidate) => candidate.name === club.name) ?? args.profile.clubs[0];
  const evaluation = evalShotExpectedCost({ course: args.course, from, to: target, golfer: args.profile, club: clubSpec });
  const terrain = terrainAt(args.course, target);
  const terrainRisk = terrain === "water" || terrain === "wetland" ? 0.95 : terrain === "deep_rough" ? 0.46 : terrain === "sand" || terrain === "waste_area" ? 0.32 : 0.08;
  const distanceRisk = clamp$2(evaluation.utilization - 0.82, 0, 0.4);
  const hazardRisk = clamp$2(terrainRisk + distanceRisk + clubSpec.dispersionTilesBase / 14, 0, 1);
  const variance = clamp$2((100 - args.capabilities.consistency) / 100 * 0.65 + hazardRisk * 0.35, 0.05, 1);
  const nextShotQuality = clamp$2((terrain === "fairway" || terrain === "green" ? 0.82 : terrain === "rough" ? 0.55 : 0.3) + args.capabilities.irons / 500, 0, 1);
  const capability = args.kind === "hero" ? args.capabilities.power : args.kind === "safe" ? args.capabilities.accuracy : args.kind === "recovery" ? args.capabilities.recovery : args.capabilities.irons;
  const facts = [
    { code: "capability-fit", detail: `${args.kind}:${Math.round(capability)}` },
    { code: "risk", detail: `hazard:${Math.round(hazardRisk * 100)}% variance:${Math.round(variance * 100)}%` },
    { code: "terrain", detail: `landing:${terrain}` },
    { code: "next-shot", detail: `quality:${Math.round(nextShotQuality * 100)}%` },
    { code: "context", detail: `preference:${args.personality.prefs.difficulty.toFixed(2)}` }
  ];
  return {
    id: `${args.hole.id ?? "hole"}-${args.kind}`,
    kind: args.kind,
    from,
    target,
    club: club.name,
    power: club.power,
    technique: args.kind === "recovery" ? "punch" : "normal",
    expectedStrokes: 1 + Math.max(0, evaluation.expectedShotCost - 1) + hazardRisk * (1.25 - args.capabilities.riskTolerance),
    variance,
    hazardRisk,
    nextShotQuality,
    facts
  };
}
function generateStrategicHolePlan(args) {
  const profile = profileFor(args.capabilities, args.course);
  const candidates = INTENTS.map((kind) => buildIntent({ ...args, kind, profile }));
  const score = (intent) => {
    const riskPenalty = intent.hazardRisk * (1 - args.capabilities.riskTolerance) * 1.4;
    const challengeBonus = intent.kind === "hero" ? args.capabilities.challengeSeeking * 0.25 : 0;
    const styleBonus = args.capabilities.riskStyle === "aggressive" && intent.kind === "hero" ? 0.18 : args.capabilities.riskStyle === "conservative" && intent.kind === "safe" ? 0.18 : args.capabilities.riskStyle === "balanced" && (intent.kind === "positional" || intent.kind === "approach") ? 0.1 : 0;
    return intent.expectedStrokes + riskPenalty - challengeBonus - styleBonus - intent.nextShotQuality * 0.08;
  };
  const ordered = candidates.slice().sort((a, b) => score(a) - score(b) || INTENTS.indexOf(a.kind) - INTENTS.indexOf(b.kind));
  const chosen = ordered[0];
  const rejected = ordered.slice(1, 4).map((alternative) => ({
    kind: alternative.kind,
    expectedStrokes: Number(alternative.expectedStrokes.toFixed(3)),
    reason: score(alternative) > score(chosen) + 0.25 ? "higher modeled risk or lower next-shot quality" : "slightly less fit for this golfer",
    facts: alternative.facts
  }));
  return {
    version: 1,
    holeId: args.hole.id ?? `hole-${args.course.holes.indexOf(args.hole) + 1}`,
    par: args.par,
    expectedScore: Number((args.par + score(chosen) - 1).toFixed(3)),
    chosen,
    rejected
  };
}
function followUpIntent(args) {
  const target = { ...args.hole.green };
  const kind = args.lie === "rough" || args.lie === "deep_rough" || args.lie === "sand" || args.lie === "waste_area" ? "recovery" : distance$1(args.from, target) <= 5 ? "approach" : "positional";
  const profile = profileFor(args.capabilities, args.course);
  const intent = buildIntent({ course: args.course, hole: { ...args.hole, tee: args.from, green: target }, kind, capabilities: args.capabilities, personality: args.personality, profile });
  return { ...intent, id: `${args.hole.id ?? "hole"}-follow-${args.shotNumber}`, from: { ...args.from } };
}
const clamp$1 = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
function evaluateHoleReaction(args) {
  const actualScore = args.outcomes.reduce((sum, outcome2) => sum + 1 + outcome2.penaltyStrokes, 0);
  const actualVsExpected = args.plan.expectedScore - actualScore;
  const heroSuccess = args.plan.chosen.kind === "hero" && args.outcomes.length > 0 && args.outcomes[0].penaltyStrokes === 0;
  const forcedMismatch = args.plan.chosen.hazardRisk > 0.7 && args.plan.chosen.kind !== "hero" && args.capabilities.power < 45;
  const voluntaryRisk = args.plan.chosen.kind === "hero" || args.plan.chosen.kind === "positional";
  const conditionDelta = (args.condition - 0.75) * 12;
  const scoreDelta = actualVsExpected * 13;
  const riskMoment = heroSuccess ? 9 : voluntaryRisk && actualVsExpected < 0 ? -2 : 0;
  const fairness = forcedMismatch ? -16 : 0;
  const satisfaction = clamp$1(67 + scoreDelta + riskMoment + conditionDelta + fairness + args.personality.prefs.scenery * 3);
  const facts = args.plan.chosen.facts.slice();
  facts.push({ code: "outcome", detail: `expected:${args.plan.expectedScore.toFixed(2)} actual:${actualScore}` });
  if (heroSuccess) facts.push({ code: "outcome", detail: "hero-success" });
  if (forcedMismatch) facts.push({ code: "outcome", detail: "forced-carry-mismatch" });
  if (args.condition < 0.55) facts.push({ code: "context", detail: `condition:${args.condition.toFixed(2)}` });
  const outcome = forcedMismatch ? "unfair" : satisfaction >= 82 ? "delighted" : satisfaction >= 68 ? "pleased" : satisfaction >= 52 ? "neutral" : "frustrated";
  const thought = forcedMismatch ? "That carry asked for more power than I had." : heroSuccess ? "The brave line paid off." : actualVsExpected >= 0.5 ? "That plan matched my game well." : actualVsExpected <= -0.5 ? "The hole asked more than the plan promised." : "The hole felt fair.";
  return {
    version: 1,
    holeId: args.plan.holeId,
    expectedScore: args.plan.expectedScore,
    actualScore,
    satisfaction: Number(satisfaction.toFixed(2)),
    outcome,
    facts,
    thought,
    memory: heroSuccess ? "A successful hero line became a signature moment." : forcedMismatch ? "A forced carry became a frustrating memory." : void 0
  };
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function walkSeg$1(from, to, holeIndex, cap = Infinity) {
  return { kind: "walk", from, to, holeIndex, dur: Math.min(cap, distance(from, to) * LIVE.pace.walkPerTile) };
}
function flightSeg$1(from, to, holeIndex, shot) {
  const d = distance(from, to);
  return { kind: "flight", from, to, holeIndex, dur: Math.max(LIVE.pace.flightMin, Math.min(LIVE.pace.flightMax, d * LIVE.pace.flightPerTile)), shot };
}
function pauseSeg$1(at, holeIndex, dur) {
  return { kind: "pause", from: at, to: at, holeIndex, dur };
}
function roundCourseSetup(course, teeSet, pinRotation) {
  return {
    ...course,
    holes: course.holes.map((hole) => {
      const setup = resolveCourseSetup(hole, teeSet, pinRotation);
      const par = getParSetting(hole, setup.teeSet);
      return { ...hole, tee: setup.tee, green: setup.pin, parMode: par.mode, parManual: par.mode === "MANUAL" ? par.par : void 0 };
    })
  };
}
function buildStrategicGolferRound(args) {
  const teeSet = args.teeSet ?? "member";
  const pinRotation = args.pinRotation ?? args.course.activePinRotation ?? "A";
  const course = roundCourseSetup(args.course, teeSet, pinRotation);
  const snapshot = liveCourseSnapshot({ course, teeSet, pinRotation });
  const summary = scoreCourseHoles(course);
  const segments = [];
  const holePar = [];
  const holeStrokes = [];
  const holePlans = [];
  const shotOutcomes = [];
  const holeReactions = [];
  let cursor = { ...args.entry };
  let planningWallet = args.wallet ?? 0;
  const pushWalk = (from, to, holeIndex, cap = Infinity) => {
    if (args.route) {
      const path = args.route(from, to);
      if (path?.length) {
        let current = from;
        for (const point2 of path) {
          segments.push(walkSeg$1(current, point2, holeIndex));
          current = point2;
        }
        return;
      }
    }
    segments.push(walkSeg$1(from, to, holeIndex, cap));
  };
  const pushPurchase = (type, holeIndex) => {
    const purchase = planPurchase({
      course,
      type,
      from: cursor,
      personality: args.personality,
      satisfaction: 0.7,
      wallet: planningWallet,
      rng: args.rng
    });
    if (!purchase) return;
    pushWalk(cursor, purchase.entrance, holeIndex, LIVE.pace.interHoleWalkCap);
    segments.push({
      kind: "pause",
      from: purchase.entrance,
      to: purchase.entrance,
      holeIndex,
      dur: purchase.serviceMinutes,
      concession: {
        buildingType: purchase.building.type,
        buildingX: purchase.building.x,
        buildingY: purchase.building.y,
        item: purchase.item,
        amount: purchase.amount
      }
    });
    cursor = purchase.entrance;
    planningWallet -= purchase.amount;
  };
  if (!args.skipPreRoundPurchases) {
    pushPurchase("pro_shop", -1);
    pushPurchase("cart_rental", -1);
  }
  const firstHole = Math.max(0, args.startHole ?? 0);
  const validHoleCount = summary.holes.slice(firstHole).filter((hole) => hole.isComplete && hole.isValid).length;
  let played = 0;
  for (let holeIndex = firstHole; holeIndex < course.holes.length; holeIndex++) {
    const hole = course.holes[holeIndex];
    const info = summary.holes[holeIndex];
    if (!hole.tee || !hole.green || !info?.isComplete || !info.isValid) continue;
    const holeId = hole.id ?? `hole-${holeIndex + 1}`;
    const par = info.par ?? 4;
    pushWalk(cursor, hole.tee, holeIndex);
    const plan = generateStrategicHolePlan({ course, hole, par, capabilities: args.capabilities, personality: args.personality });
    holePlans.push(plan);
    let from = { ...hole.tee };
    let lie = terrainAt(course, from);
    const outcomes = [];
    let shotNumber = 0;
    let holed = false;
    while (!holed && shotNumber < Math.max(4, par + 5)) {
      const intent = shotNumber === 0 ? plan.chosen : followUpIntent({
        course,
        hole: { ...hole, tee: from },
        from,
        lie,
        capabilities: args.capabilities,
        personality: args.personality,
        shotNumber
      });
      const outcome = resolveLiveShot({
        snapshot,
        capabilities: args.capabilities,
        holeId,
        shotNumber: shotNumber + 1,
        from,
        lie,
        intent,
        seed: args.rng() * 4294967295 >>> 0
      });
      outcomes.push(outcome);
      shotOutcomes.push(outcome);
      if (shotOutcomes.length > M47_MAX_OUTCOMES) shotOutcomes.shift();
      const putting = lie === "green" || intent.kind === "approach" && distance(from, hole.green) <= 5;
      segments.push(pauseSeg$1(from, holeIndex, putting ? LIVE.pace.puttPause : LIVE.pace.swingPause));
      segments.push(flightSeg$1(outcome.from, outcome.landing, holeIndex, putting ? "putt" : "swing"));
      if (distance(outcome.landing, outcome.rest) > 0.05) pushWalk(outcome.landing, outcome.rest, holeIndex);
      from = { ...outcome.rest };
      lie = outcome.lieAfter;
      holed = outcome.holed;
      shotNumber++;
    }
    holePlans[holePlans.length - 1] = plan;
    holeReactions.push(evaluateHoleReaction({
      plan,
      outcomes,
      capabilities: args.capabilities,
      personality: args.personality,
      condition: course.condition
    }));
    holePar.push(par);
    holeStrokes.push(outcomes.reduce((sum, outcome) => sum + 1 + outcome.penaltyStrokes, 0));
    cursor = { ...from };
    played++;
    if (!args.skipPreRoundPurchases && played === Math.max(1, Math.ceil(validHoleCount / 2))) pushPurchase("snack_bar", holeIndex);
  }
  pushWalk(cursor, args.exit ?? args.entry, -1, LIVE.pace.interHoleWalkCap);
  return { segments, holePar, holeStrokes, capabilities: args.capabilities, holePlans, shotOutcomes, holeReactions };
}
function clamp01$3(x) {
  return Math.max(0, Math.min(1, x));
}
function clampSigned(x) {
  return Math.max(-1, Math.min(1, x));
}
function bell(rng) {
  return ((rng() + rng() + rng()) / 3 - 0.5) * 2;
}
function rollPersonality(base, rng, mults = {}) {
  const s = base.spread;
  return {
    skill: clamp01$3(base.skill + bell(rng) * s),
    consistency: clamp01$3(base.consistency + bell(rng) * s),
    patience: clamp01$3((base.patience + bell(rng) * s) * (mults.patience ?? 1)),
    spendPropensity: clamp01$3((base.spendPropensity + bell(rng) * s) * (mults.spend ?? 1)),
    prefs: {
      difficulty: clampSigned(base.prefs.difficulty + bell(rng) * s),
      scenery: clampSigned(base.prefs.scenery + bell(rng) * s),
      price: clampSigned(base.prefs.price + bell(rng) * s)
    },
    pacePreference: clamp01$3(base.skill * 0.55 + (1 - base.patience) * 0.25 + 0.2 + bell(rng) * s)
  };
}
function solverProfileForSkill(skill) {
  return skill >= 0.5 ? "SCRATCH" : "BOGEY";
}
function mishitChance(p) {
  const base = (1 - p.skill) * 0.28 + (1 - p.consistency) * 0.12;
  return Math.max(0.01, Math.min(0.4, base));
}
function puttOutcome(p, roll) {
  const variance = (1 - p.consistency) * 0.5 + 0.1;
  const skillEdge = (p.skill - 0.5) * 0.3;
  const oneChance = Math.max(0, variance * 0.5 + skillEdge);
  const threeChance = Math.max(0, variance * 0.5 - skillEdge);
  if (roll < oneChance) return 1;
  if (roll > 1 - threeChance) return 3;
  return 2;
}
const setupCourseCache = /* @__PURE__ */ new WeakMap();
function courseForRoundSetup(course, teeSet, pinRotation) {
  let setups = setupCourseCache.get(course);
  if (!setups) {
    setups = /* @__PURE__ */ new Map();
    setupCourseCache.set(course, setups);
  }
  const key2 = `${teeSet}:${pinRotation}`;
  const cached = setups.get(key2);
  if (cached) return cached;
  const resolved = {
    ...course,
    holes: course.holes.map((hole) => {
      const setup = resolveCourseSetup(hole, teeSet, pinRotation);
      const par = getParSetting(hole, setup.teeSet);
      return {
        ...hole,
        tee: setup.tee,
        green: setup.pin,
        parMode: par.mode,
        parManual: par.mode === "MANUAL" ? par.par : void 0
      };
    })
  };
  setups.set(key2, resolved);
  return resolved;
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function walkSeg(from, to, holeIndex, cap = Infinity) {
  const d = dist(from, to);
  return { kind: "walk", from, to, holeIndex, dur: Math.min(cap, d * LIVE.pace.walkPerTile) };
}
function flightSeg(from, to, holeIndex, shot = "swing") {
  const d = dist(from, to);
  const dur = Math.max(LIVE.pace.flightMin, Math.min(LIVE.pace.flightMax, d * LIVE.pace.flightPerTile));
  return { kind: "flight", from, to, holeIndex, dur, shot };
}
function pauseSeg(at, holeIndex, dur, concession) {
  return { kind: "pause", from: at, to: at, holeIndex, dur, concession };
}
function buildGolferRound(args) {
  if (args.capabilities) return buildStrategicGolferRound({ ...args, capabilities: args.capabilities });
  return planFromHole({
    course: args.course,
    profile: args.profile,
    personality: args.personality,
    rng: args.rng,
    startHole: 0,
    cursor: args.entry,
    exit: args.entry,
    route: args.route,
    wallet: args.wallet,
    teeSet: args.teeSet,
    pinRotation: args.pinRotation
  });
}
function planFromHole(args) {
  const baseCourse = args.course;
  const course = courseForRoundSetup(baseCourse, args.teeSet ?? "member", args.pinRotation ?? baseCourse.activePinRotation ?? "A");
  const { profile, rng, personality, startHole, exit, route: route2 } = args;
  const summary = scoreCourseHoles(course);
  const segments = [];
  const holePar = [];
  const holeStrokes = [];
  const pushWalk = (from, to, holeIndex, cap = Infinity) => {
    if (route2) {
      const path = route2(from, to);
      if (path && path.length) {
        let cur = from;
        for (const wp of path) {
          segments.push(walkSeg(cur, wp, holeIndex));
          cur = wp;
        }
        return;
      }
    }
    segments.push(walkSeg(from, to, holeIndex, cap));
  };
  let cursor = args.cursor;
  let planningWallet = args.wallet ?? 0;
  const pushPurchase = (type, holeIndex) => {
    const purchase = planPurchase({
      course,
      type,
      from: cursor,
      personality,
      satisfaction: 0.7,
      wallet: planningWallet,
      rng
    });
    if (!purchase) return;
    pushWalk(cursor, purchase.entrance, holeIndex, LIVE.pace.interHoleWalkCap);
    segments.push(pauseSeg(purchase.entrance, holeIndex, purchase.serviceMinutes, {
      buildingType: purchase.building.type,
      buildingX: purchase.building.x,
      buildingY: purchase.building.y,
      item: purchase.item,
      amount: purchase.amount
    }));
    cursor = purchase.entrance;
    planningWallet -= purchase.amount;
  };
  pushPurchase("pro_shop", -1);
  pushPurchase("cart_rental", -1);
  const validHoleCount = summary.holes.filter((h) => h.isComplete && h.isValid).length;
  let playedValidHoles = 0;
  for (let i = Math.max(0, startHole); i < course.holes.length; i++) {
    const hole = course.holes[i];
    const info = summary.holes[i];
    if (!hole.tee || !hole.green || !info?.isComplete || !info?.isValid) continue;
    const tee2 = hole.tee;
    const green2 = hole.green;
    const par = info.par ?? 4;
    pushWalk(cursor, tee2, i, LIVE.pace.interHoleWalkCap);
    const solved = solveShotsToGreen({ course, tee: tee2, green: green2, golfer: profile });
    let shots = 0;
    let penalties = 0;
    if (solved.reachable && solved.plan.length > 0) {
      for (const step of solved.plan) {
        segments.push(pauseSeg(step.from, i, LIVE.pace.swingPause));
        segments.push(flightSeg(step.from, step.to, i));
        pushWalk(step.from, step.to, i);
        shots++;
        if (rng() < mishitChance(personality)) {
          penalties++;
          segments.push(pauseSeg(step.to, i, LIVE.pace.recoverySearchPause * (1.15 - personality.skill * 0.35)));
        }
      }
    } else {
      segments.push(pauseSeg(tee2, i, LIVE.pace.swingPause));
      segments.push(flightSeg(tee2, green2, i));
      pushWalk(tee2, green2, i);
      shots = par + 1;
    }
    const putts = puttOutcome(personality, rng());
    const near = { x: green2.x + 0.6, y: green2.y + 0.4 };
    segments.push(pauseSeg(green2, i, LIVE.pace.puttPause));
    segments.push(flightSeg(near, green2, i, "putt"));
    segments.push(walkSeg(near, green2, i, LIVE.pace.puttWalk));
    holePar.push(par);
    holeStrokes.push(shots + penalties + putts);
    cursor = green2;
    playedValidHoles++;
    if (playedValidHoles === Math.max(1, Math.ceil(validHoleCount / 2))) {
      pushPurchase("snack_bar", i);
    }
  }
  pushWalk(cursor, exit, -1, LIVE.pace.interHoleWalkCap);
  return { segments, holePar, holeStrokes };
}
function entryPoint(course) {
  return {
    x: Math.max(0, Math.min(course.width - 1, Math.round(course.width * LIVE.entry.xFrac))),
    y: Math.max(0, Math.min(course.height - 1, Math.round(course.height * LIVE.entry.yFrac)))
  };
}
function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function ballArc(from, to, t) {
  return lerp(from, to, t);
}
function advanceGolfer(g, dtMin, condition) {
  if (g.finished) return;
  let remaining = dtMin;
  let guard = 0;
  while (remaining > 0 && guard++ < 1e4) {
    if (g.segIndex >= g.segments.length) {
      while (g.scoredHoles < g.holeStrokes.length) scoreNextHole(g, condition);
      g.finished = true;
      g.ball = null;
      g.currentHole = -1;
      return;
    }
    const seg = g.segments[g.segIndex];
    const left = seg.dur - g.segElapsed;
    if (remaining < left) {
      g.segElapsed += remaining;
      remaining = 0;
    } else {
      remaining -= left;
      g.segElapsed = 0;
      g.segIndex++;
      const next = g.segments[g.segIndex];
      if (seg.holeIndex >= 0 && (!next || next.holeIndex !== seg.holeIndex)) {
        scoreNextHole(g, condition);
      }
      continue;
    }
    const t = seg.dur > 0 ? Math.max(0, Math.min(1, g.segElapsed / seg.dur)) : 1;
    if (seg.holeIndex >= 0) {
      g.currentHole = seg.holeIndex;
      g.currentHoleId = seg.holeId ?? g.holeIds?.[seg.holeIndex];
    }
    if (seg.kind === "walk") {
      g.pos = lerp(seg.from, seg.to, t);
      g.ball = null;
    } else if (seg.kind === "flight") {
      g.pos = seg.from;
      g.ball = ballArc(seg.from, seg.to, t);
    } else {
      g.pos = seg.from;
      g.ball = null;
    }
    if (g.holePlans && seg.holeIndex >= 0) {
      g.currentIntent = g.holePlans.find((plan) => plan.holeId === (seg.holeId ?? g.holeIds?.[seg.holeIndex]))?.chosen;
    }
  }
}
function scoreNextHole(g, condition) {
  if (g.scoredHoles >= g.holeStrokes.length) return;
  const i = g.scoredHoles;
  const delta = g.holeStrokes[i] - g.holePar[i];
  g.scoreToPar += delta;
  g.strokes += g.holeStrokes[i];
  const patienceRelief = 1 - g.personality.patience * 0.5;
  const m = delta > 0 ? LIVE.mood.perStrokeOverPar * delta * patienceRelief : LIVE.mood.perStrokeUnderPar * -delta;
  g.mood = clamp01$2(g.mood + m + (condition - 0.6) * 0.02);
  const reaction = g.holeReactions?.[i];
  if (reaction) {
    g.mood = clamp01$2(g.mood * 0.55 + reaction.satisfaction / 100 * 0.45);
    g.thought = reaction.thought;
    g.thoughtUntil = Math.max(g.thoughtUntil, reaction.satisfaction >= 70 ? 18 : 24);
  }
  g.scoredHoles++;
}
function clamp01$2(x) {
  return Math.max(LIVE.mood.min, Math.min(LIVE.mood.max, x));
}
const IDENTITY = {
  startingCashMult: 1,
  terrainCostMult: 1,
  demandMult: 1,
  patienceMult: 1,
  spendMult: 1,
  loanAprMult: 1,
  bridgeCooldownWeeksAdd: 0,
  wearMult: 1,
  repGainMult: 1,
  repLossMult: 1
};
const DIFFICULTY_PROFILES = {
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
    repLossMult: 0.85
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
    repLossMult: 1.2
  }
};
function getDifficultyProfile(difficulty) {
  return DIFFICULTY_PROFILES[difficulty ?? "normal"];
}
const cache = /* @__PURE__ */ new Map();
function getEffectiveBalance(difficulty) {
  const d = difficulty ?? "normal";
  if (d === "normal") return BALANCE;
  const hit = cache.get(d);
  if (hit) return hit;
  const p = DIFFICULTY_PROFILES[d];
  const b = structuredClone(BALANCE);
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
  const effective = b;
  cache.set(d, effective);
  return effective;
}
function clamp01$1(x) {
  return Math.max(0, Math.min(1, x));
}
const DEMAND_WEIGHTS = {
  courseQuality: 0.28,
  condition: 0.22,
  reputation: 0.22,
  priceAttractiveness: 0.16,
  marketing: 0.06,
  staff: 0.06
};
function priceAttractiveness(course) {
  const p = course.baseGreenFee;
  const penalty = Math.min(1, Math.abs(p - 70) / 60);
  return 1 - penalty;
}
function priceAttractivenessWithContext(course, world) {
  const BALANCE2 = getEffectiveBalance(world.difficulty);
  const p = course.baseGreenFee;
  const market = BALANCE2.pricing.marketPrice;
  const base = priceAttractiveness(course);
  if (p <= market) return base;
  const over = (p - market) / market;
  let mult = 1;
  if (world.reputation < BALANCE2.pricing.repDiscountThreshold) mult *= BALANCE2.pricing.lowRepPriceMult;
  if (world.reputation > BALANCE2.pricing.repPremiumThreshold) mult *= BALANCE2.pricing.highRepPriceMult;
  const harsh = Math.pow(over, BALANCE2.pricing.highPriceHardness) * 0.9 * mult;
  return Math.max(0, Math.min(1, base - harsh));
}
function demandBreakdown(course, world) {
  const BALANCE2 = getEffectiveBalance(world.difficulty);
  const holeSummary = scoreCourseHoles(course);
  const architecture = analyzeArchitecture(course);
  const q = clamp01$1(holeSummary.courseQuality / 100 * (1 - BALANCE2.architecture.qualityBlend) + architecture.total / 100 * BALANCE2.architecture.qualityBlend);
  const cond = course.condition;
  const rep = world.reputation / 100;
  const price = priceAttractivenessWithContext(course, world);
  const marketing = Math.min(1, world.marketingLevel * 0.12);
  const staff = Math.min(1, world.staffLevel * 0.1);
  const complete = holeSummary.holes.filter((h) => h.isComplete && h.isValid);
  const avgDiff = complete.length === 0 ? 100 : complete.reduce((a, h) => a + h.difficultyScore, 0) / complete.length;
  const avgAest = complete.length === 0 ? 0 : complete.reduce((a, h) => a + h.aestheticsScore, 0) / complete.length;
  const variety = clamp01$1(holeSummary.variety / 100);
  const ease = clamp01$1((100 - avgDiff) / 100);
  const rating = computeCourseRatingAndSlope(course);
  const courseRating01 = clamp01$1((rating.courseRating - 66) / 8);
  const repMod = world.reputation < BALANCE2.reputation.demandPenaltyThreshold ? BALANCE2.reputation.demandPenaltyMult : world.reputation > BALANCE2.reputation.demandBonusThreshold ? BALANCE2.reputation.demandBonusMult : 1;
  const coreCap = clamp01$1((world.reputation - 45) / 35) * courseRating01;
  const coreShare = clamp01$1(coreCap * 0.45);
  const casualShare = 1 - coreShare;
  const casualIndexBase = clamp01$1(
    0.33 * q + 0.26 * cond + 0.14 * rep + 0.17 * price + 0.08 * ease + 0.01 * marketing + 0.01 * staff
  ) * 1.15;
  const coreIndexBase = clamp01$1(
    0.26 * q + 0.18 * cond + 0.18 * rep + 0.07 * clamp01$1(avgAest / 100) + 0.07 * variety + 0.07 * clamp01$1(avgDiff / 100) + 0.05 * marketing + 0.05 * staff + 0.03 * price
  ) * 1.15;
  const casualIndex = Math.min(1.2, casualIndexBase * repMod);
  const coreIndex = Math.min(1.2, coreIndexBase * repMod);
  const contributions = {
    courseQuality: DEMAND_WEIGHTS.courseQuality * q,
    condition: DEMAND_WEIGHTS.condition * cond,
    reputation: DEMAND_WEIGHTS.reputation * rep,
    priceAttractiveness: DEMAND_WEIGHTS.priceAttractiveness * price,
    marketing: DEMAND_WEIGHTS.marketing * marketing,
    staff: DEMAND_WEIGHTS.staff * staff
  };
  const base = contributions.courseQuality + contributions.condition + contributions.reputation + contributions.priceAttractiveness + contributions.marketing + contributions.staff;
  const blended = casualShare * casualIndex + coreShare * coreIndex;
  const demand = Math.max(0, Math.min(1.2, (blended * 1.05 + base * 0.05) * architectureDemandMultiplier(course)));
  const floor = BALANCE2.visitors.baseFloor;
  const floorCasual = Math.round(floor * casualShare);
  const floorCore = floor - floorCasual;
  const baseVisitorsCasual = floorCasual + Math.round(BALANCE2.visitors.scale * casualIndex * casualShare);
  const baseVisitorsCore = floorCore + Math.round(BALANCE2.visitors.scale * coreIndex * coreShare);
  const totalBaseVisitors = baseVisitorsCasual + baseVisitorsCore;
  return {
    courseQuality: Math.round(q * 100),
    condition: Math.round(cond * 100),
    reputation: Math.round(rep * 100),
    priceAttractiveness: Math.round(price * 100),
    marketing: Math.round(marketing * 100),
    staff: Math.round(staff * 100),
    weights: { ...DEMAND_WEIGHTS },
    contributions,
    demandIndex: demand,
    architecture: { score: architecture.total, multiplier: architectureDemandMultiplier(course) },
    segments: {
      casual: { share: casualShare, demandIndex: casualIndex, baseVisitors: baseVisitorsCasual },
      core: { share: coreShare, demandIndex: coreIndex, baseVisitors: baseVisitorsCore, cap: coreCap },
      totalBaseVisitors
    }
  };
}
function demandIndex(course, world) {
  return demandBreakdown(course, world).demandIndex;
}
const COHORTS = ["skilled_impatient", "novice_social", "general"];
function finite$1(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function nonNegative(value, fallback = 0) {
  return Math.max(0, finite$1(value, fallback));
}
function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function emptyCohortHistory() {
  return {
    samples: 0,
    averageDurationMinutes: 0,
    averageTimeParVarianceMinutes: 0,
    averageWaitMinutes: 0,
    pickupRate: 0,
    abandonmentRate: 0,
    averageSatisfaction: 0
  };
}
function normalizeCohortHistory(value) {
  if (!value || typeof value !== "object") return emptyCohortHistory();
  const raw = value;
  return {
    samples: Math.min(1e3, Math.floor(nonNegative(raw.samples))),
    averageDurationMinutes: Math.min(1500, nonNegative(raw.averageDurationMinutes)),
    averageTimeParVarianceMinutes: Math.max(-1500, Math.min(1500, finite$1(raw.averageTimeParVarianceMinutes))),
    averageWaitMinutes: Math.min(1500, nonNegative(raw.averageWaitMinutes)),
    pickupRate: Math.max(0, Math.min(1, finite$1(raw.pickupRate))),
    abandonmentRate: Math.max(0, Math.min(1, finite$1(raw.abandonmentRate))),
    averageSatisfaction: Math.max(0, Math.min(100, finite$1(raw.averageSatisfaction)))
  };
}
function normalizeHistorySample(value) {
  if (!value || typeof value !== "object") return null;
  const raw = value;
  if (typeof raw.id !== "string" || typeof raw.courseId !== "string") return null;
  if (raw.preset !== "relaxed" && raw.preset !== "balanced" && raw.preset !== "brisk") return null;
  const holes = Array.isArray(raw.holes) ? raw.holes.filter(
    (hole) => !!hole && typeof hole.holeId === "string"
  ).slice(0, 36).map((hole) => ({
    holeId: hole.holeId,
    queueMinutes: Math.min(1e5, nonNegative(hole.queueMinutes)),
    occupancyMinutes: Math.min(1e5, nonNegative(hole.occupancyMinutes)),
    recoveryDelayMinutes: Math.min(1e5, nonNegative(hole.recoveryDelayMinutes)),
    visits: Math.min(1e4, Math.floor(nonNegative(hole.visits)))
  })) : [];
  return {
    id: raw.id,
    week: Math.max(1, Math.floor(nonNegative(raw.week, 1))),
    day: Math.max(0, Math.min(6, Math.floor(nonNegative(raw.day)))),
    courseId: raw.courseId,
    preset: raw.preset,
    staffing: typeof raw.staffing === "string" ? raw.staffing.slice(0, 200) : "none",
    groupsStarted: Math.floor(nonNegative(raw.groupsStarted)),
    groupsFinished: Math.floor(nonNegative(raw.groupsFinished)),
    roundsCompleted: Math.floor(nonNegative(raw.roundsCompleted)),
    roundsIncomplete: Math.floor(nonNegative(raw.roundsIncomplete)),
    averageDurationMinutes: nonNegative(raw.averageDurationMinutes),
    p50DurationMinutes: nonNegative(raw.p50DurationMinutes),
    p90DurationMinutes: nonNegative(raw.p90DurationMinutes),
    averageWaitMinutes: nonNegative(raw.averageWaitMinutes),
    pickups: Math.floor(nonNegative(raw.pickups)),
    incidents: Math.floor(nonNegative(raw.incidents)),
    refunds: nonNegative(raw.refunds),
    credits: nonNegative(raw.credits),
    goodwillVouchers: nonNegative(raw.goodwillVouchers),
    overtimeCost: nonNegative(raw.overtimeCost),
    compensationCost: nonNegative(raw.compensationCost),
    greenFeeRevenue: nonNegative(raw.greenFeeRevenue),
    beverageRevenue: nonNegative(raw.beverageRevenue),
    occupiedTeeHours: nonNegative(raw.occupiedTeeHours),
    averageSatisfaction: Math.max(0, Math.min(100, finite$1(raw.averageSatisfaction))),
    cohorts: Object.fromEntries(COHORTS.map((cohort) => [cohort, normalizeCohortHistory(raw.cohorts?.[cohort])])),
    holes
  };
}
function emptyPaceOperationsState() {
  return { version: 1, courses: {} };
}
function normalizePaceOperationsState(value) {
  if (!value || typeof value !== "object") return emptyPaceOperationsState();
  const raw = value;
  if (raw.version !== 1 || !raw.courses || typeof raw.courses !== "object" || Array.isArray(raw.courses)) {
    return emptyPaceOperationsState();
  }
  const courses = {};
  for (const [courseId, value2] of Object.entries(raw.courses).slice(0, 8)) {
    if (!value2 || typeof value2 !== "object") continue;
    const candidate = value2;
    const samples = Array.isArray(candidate.samples) ? candidate.samples.map(normalizeHistorySample).filter((sample) => !!sample && sample.courseId === courseId).slice(-BALANCE.paceOperations.historyDays) : [];
    courses[courseId] = { courseId, samples };
  }
  return { version: 1, courses };
}
function samplePaceScore(sample, cohort) {
  const variance = cohort ? sample.cohorts[cohort].averageTimeParVarianceMinutes : average(COHORTS.flatMap((name) => {
    const metrics = sample.cohorts[name];
    return metrics.samples ? [metrics.averageTimeParVarianceMinutes] : [];
  }));
  const wait = cohort ? sample.cohorts[cohort].averageWaitMinutes : sample.averageWaitMinutes;
  return Math.max(0, Math.min(1, 0.56 - variance / 180 - wait / 240 - sample.roundsIncomplete * 0.015));
}
function labelFor(score) {
  return score < 0.4 ? "relaxed" : score > 0.62 ? "brisk" : "balanced";
}
function paceIdentity(world, courseId, fallback = 0.5) {
  const samples = normalizePaceOperationsState(world.paceOperations).courses[courseId]?.samples ?? [];
  const priorWeight = BALANCE.paceOperations.identityPriorDays;
  const weighted = (cohort) => {
    let total = fallback * priorWeight;
    let weight = priorWeight;
    samples.forEach((sample, index) => {
      const recency = 1 + index / Math.max(1, samples.length - 1) * (BALANCE.paceOperations.identityRecentWeight - 1);
      const count = cohort ? sample.cohorts[cohort].samples : Math.max(1, sample.roundsCompleted);
      if (cohort && count === 0) return;
      const sampleWeight = recency * Math.min(4, Math.max(1, count / 4));
      total += samplePaceScore(sample, cohort) * sampleWeight;
      weight += sampleWeight;
    });
    return total / weight;
  };
  const score = weighted();
  return {
    score,
    label: labelFor(score),
    samples: samples.length,
    cohorts: Object.fromEntries(COHORTS.map((cohort) => [cohort, weighted(cohort)]))
  };
}
function paceRepeatIntentModifier(identity, preference) {
  const boundedIdentity = Math.max(0, Math.min(1, finite$1(identity, 0.5)));
  const boundedPreference = Math.max(0, Math.min(1, finite$1(preference, 0.5)));
  const match = 1 - Math.abs(boundedPreference - boundedIdentity);
  return (match - 0.5) * BALANCE.paceOperations.repeatIntentMatchWeight;
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function clamp01(x) {
  return clamp(x, 0, 1);
}
function courseProfile(course, world) {
  const summary = scoreCourseHoles(course);
  const complete = summary.holes.filter((h) => h.isComplete && h.isValid);
  const avg = (pick, fallback) => complete.length === 0 ? fallback : complete.reduce((a, h) => a + pick(h), 0) / complete.length;
  const difficulty = clamp01(avg((h) => h.difficultyScore, 50) / 100);
  const scenery = clamp01(avg((h) => h.aestheticsScore, 0) / 100);
  const premium = clamp(
    (course.baseGreenFee - BALANCE.pricing.marketPrice) / BALANCE.pricing.marketPrice,
    -1,
    1
  );
  const layout = activeCourseLayout(course);
  const presetFallback = courseOperations(course, layout.id).preset === "relaxed" ? 0 : courseOperations(course, layout.id).preset === "brisk" ? 1 : 0.5;
  return {
    quality: clamp01(summary.courseQuality / 100),
    difficulty,
    scenery,
    premium,
    prestige: clamp01(world.reputation / 100),
    pace: paceIdentity(world, layout.id, presetFallback).score
  };
}
function archetypeAppeal(profile) {
  const diffSigned = profile.difficulty * 2 - 1;
  const raw = {};
  let total = 0;
  for (const a of Object.values(ARCHETYPES)) {
    const p = a.personality;
    const difficultyMatch = 1 - Math.abs(p.prefs.difficulty - diffSigned) / 2;
    const sceneryAppeal = clamp01(0.5 + p.prefs.scenery * (profile.scenery - 0.5));
    const priceAppeal = clamp01(0.5 + profile.premium * p.prefs.price * 0.8);
    const prestigeGate = clamp01(1 - Math.max(0, p.skill - profile.prestige) * 1.5);
    const pacePreference = clamp01(p.skill * 0.6 + (1 - p.patience) * 0.3 + 0.1);
    const paceMatch = 1 - Math.abs(pacePreference - profile.pace);
    const w = a.weight * difficultyMatch * sceneryAppeal * priceAppeal * prestigeGate * (0.65 + paceMatch * 0.35);
    raw[a.name] = w;
    total += w;
  }
  if (total <= 1e-6) {
    let baseTotal = 0;
    for (const a of Object.values(ARCHETYPES)) baseTotal += a.weight;
    for (const a of Object.values(ARCHETYPES)) raw[a.name] = a.weight / baseTotal;
    return raw;
  }
  for (const name of Object.keys(raw)) raw[name] /= total;
  return raw;
}
function pickArchetypeFrom(appeal, r) {
  let t = r;
  let last = "casual";
  for (const name of Object.keys(appeal)) {
    last = name;
    t -= appeal[name];
    if (t <= 0) return name;
  }
  return last;
}
function plannedGolfersForDay(course, world) {
  const summary = scoreCourseHoles(course);
  const validHoles = summary.holes.filter((h) => h.isComplete && h.isValid).length;
  if (validHoles === 0) return 0;
  const di = demandIndex(course, world);
  const norm = clamp01(di / LIVE.volume.demandFullHouse);
  const span = LIVE.volume.maxGolfers - LIVE.volume.minGolfers;
  const raw = (LIVE.volume.minGolfers + norm * span) * getDifficultyProfile(world.difficulty).demandMult;
  const planned = clamp(raw, LIVE.volume.minGolfers, LIVE.volume.maxGolfers);
  return Math.max(1, Math.round(planned * propertyAccessMultiplier(course, planned, world)));
}
function planDay(course, world, seed, dayIndex = 0) {
  const seasonal = seasonalState(world, course, dayIndex);
  const weather = activeWeather(world, course, dayIndex);
  const demandMultiplier = weatherModifiers(weather, seasonal.operations.drainageLevel).demandMultiplier * charterBenefits(world, course, dayIndex).demandMultiplier;
  const count = Math.max(0, Math.floor(plannedGolfersForDay(course, world) * demandMultiplier));
  const rng = mulberry32(seed);
  const appeal = archetypeAppeal(courseProfile(course, world));
  const arrivals = [];
  const { firstArrivalMinute, lastArrivalMinute } = LIVE.day;
  const layout = activeCourseLayout(course);
  const operations = courseOperations(course, layout.id);
  let golferIndex = 0;
  let groupIndex = 0;
  let slotMinute = firstArrivalMinute;
  while (golferIndex < count && slotMinute <= lastArrivalMinute) {
    const remaining = count - golferIndex;
    const desired = 1 + Math.floor(rng() * operations.maxGroupSize);
    const groupSize = Math.min(remaining, operations.maxGroupSize, Math.max(1, desired));
    const groupId = `${layout.id}-g${groupIndex + 1}`;
    for (let member = 0; member < groupSize; member++) {
      arrivals.push({ atMinute: slotMinute, archetype: pickArchetypeFrom(appeal, rng()), courseId: layout.id, groupId });
      golferIndex++;
    }
    groupIndex++;
    slotMinute += operations.teeIntervalMinutes;
    if (operations.starterGapEveryGroups > 0 && groupIndex % operations.starterGapEveryGroups === 0) slotMinute += operations.teeIntervalMinutes;
  }
  arrivals.sort((a, b) => a.atMinute - b.atMinute);
  return arrivals;
}
function planEstateDay(course, world, seed, views = operatingCourseViews(course), dayIndex = 0) {
  const arrivals = views.flatMap(
    ({ layout, course: view }, index) => planDay(view, world, seed + index * 104729, dayIndex).slice(0, layout.roundLength * 4).map((arrival2) => ({ ...arrival2, courseId: layout.id }))
  );
  const regulars = normalizeLivingClub(world.livingClub).regulars.filter((regular) => !regular.favoriteCourseId || views.some(({ layout }) => layout.id === regular.favoriteCourseId)).sort((a, b) => b.loyalty - a.loyalty || a.id.localeCompare(b.id)).slice(0, Math.min(4, Math.floor(arrivals.length / 5)));
  const claimedArrivalIndices = /* @__PURE__ */ new Set();
  regulars.forEach((regular, index) => {
    const eligibleIndices = arrivals.map((arrival2, arrivalIndex) => ({ arrival: arrival2, arrivalIndex })).filter(
      ({ arrival: arrival2, arrivalIndex }) => !claimedArrivalIndices.has(arrivalIndex) && !arrival2.tournament && (!regular.favoriteCourseId || arrival2.courseId === regular.favoriteCourseId)
    ).map(({ arrivalIndex }) => arrivalIndex);
    if (!eligibleIndices.length) return;
    const chosenIndex = eligibleIndices[(hashCode(`${seed}:${regular.id}`) + index * 7) % eligibleIndices.length];
    claimedArrivalIndices.add(chosenIndex);
    arrivals[chosenIndex] = {
      ...arrivals[chosenIndex],
      personId: regular.id,
      name: regular.name,
      archetype: regular.archetype
    };
  });
  arrivals.sort((a, b) => a.atMinute - b.atMinute || (a.courseId ?? "").localeCompare(b.courseId ?? ""));
  return arrivals;
}
function hashCode(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash, 31) + value.charCodeAt(index) | 0;
  return Math.abs(hash);
}
function makeRouter(course, cache2) {
  return (from, to) => {
    const key2 = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
    const hit = cache2.get(key2);
    if (hit !== void 0) return hit;
    const path = findWalkPath(course, from, to);
    cache2.set(key2, path);
    return path;
  };
}
function createLiveState(course, world, dayIndex) {
  const seed = (world.runSeed | 0) + dayIndex * 7919;
  const courseViews = operatingCourseViews(course);
  const tournamentEvent = tournamentForDate(world, dayIndex, course);
  const rawArrivals = tournamentEvent ? planTournamentDay(
    tournamentEvent,
    LIVE.day.firstArrivalMinute,
    LIVE.day.teeGapMinutes,
    courseOperations(course, tournamentEvent.courseId).maxGroupSize
  ) : planEstateDay(course, world, seed, courseViews, dayIndex);
  const seasonal = seasonalState(world, course, dayIndex);
  const dailyWeather = activeWeather(world, course, dayIndex);
  const dailyWeatherModifiers = weatherModifiers(dailyWeather, seasonal.operations.drainageLevel);
  const arrivals = rawArrivals.map((arrival2, index) => {
    const courseId = arrival2.courseId ?? tournamentEvent?.courseId ?? activeCourseLayout(course).id;
    return {
      ...arrival2,
      groupId: arrival2.groupId ?? `${courseId}-solo-${index + 1}`,
      paceIdentityAtVisit: paceIdentity(world, courseId).score
    };
  });
  const perCourse = Object.fromEntries(courseViews.map(({ layout }) => [layout.id, {
    courseName: layout.name,
    arrivals: arrivals.filter((arrival2) => arrival2.courseId === layout.id).length,
    roundsStarted: 0,
    roundsFinished: 0,
    greenFees: 0,
    satisfactionSum: 0,
    promoters: 0,
    detractors: 0,
    willReturnCount: 0
  }]));
  const staff = normalizedStaff(world, course);
  const marshalCoverageByCourse = {};
  const beverageCoverageByCourse = {};
  const overtimeRateByCourse = {};
  for (const member of staff) {
    const courseId = member.courseId ?? courseViews[0]?.layout.id;
    if (!courseId) continue;
    if (member.role === "marshal") marshalCoverageByCourse[courseId] = (marshalCoverageByCourse[courseId] ?? 0) + 1;
    if (member.role === "cart_attendant") beverageCoverageByCourse[courseId] = (beverageCoverageByCourse[courseId] ?? 0) + 1;
    overtimeRateByCourse[courseId] = (overtimeRateByCourse[courseId] ?? 0) + member.weeklyWage / BALANCE.paceOperations.staffHoursPerWeek * BALANCE.paceOperations.overtimePremium;
  }
  const groups = [...new Map(arrivals.map((arrival2) => [arrival2.groupId, {
    id: arrival2.groupId,
    courseId: arrival2.courseId ?? courseViews[0]?.layout.id ?? "course-primary",
    bookedAt: arrival2.atMinute,
    startedAt: null,
    golferIds: [],
    waitMinutes: 0,
    blocked: false,
    interventions: 0,
    pickups: 0,
    finishedAt: null
  }])).values()];
  return {
    difficulty: world.difficulty,
    dayIndex,
    dayMinute: LIVE.day.openMinute,
    golfers: [],
    arrivals,
    nextArrivalIdx: 0,
    nextGolferId: 1,
    greenFeeCollected: 0,
    concessionCollected: 0,
    concessionTransactions: [],
    concessionByType: {},
    roundsStarted: 0,
    roundsFinished: 0,
    satisfactionSum: 0,
    promoters: 0,
    detractors: 0,
    willReturnCount: 0,
    reconcileEpoch: 0,
    nextTeeFreeAt: 0,
    nextTeeFreeAtByCourse: {},
    perCourse,
    walkCache: /* @__PURE__ */ new Map(),
    dayOver: false,
    seed,
    tournament: tournamentEvent ? createLiveTournament(tournamentEvent, course) : void 0,
    groups,
    pace: emptyPaceDayMetrics(courseViews.map(({ layout }) => layout.id)),
    marshalCoverageByCourse,
    beverageCoverageByCourse,
    overtimeRateByCourse,
    operationsByCourse: Object.fromEntries(courseViews.map(({ layout }) => {
      const operations = courseOperations(course, layout.id);
      return [layout.id, tournamentEvent?.courseId === layout.id || !tournamentEvent?.courseId && tournamentEvent ? { ...operations, daylightPolicy: "finish_started" } : operations];
    })),
    weather: { daily: dailyWeather, modifiers: dailyWeatherModifiers }
  };
}
function classifyReaction(g) {
  const r = LIVE.reactions;
  const returnScore = g.mood + (g.personality.patience - 0.5) * r.returnPatienceNudge + paceRepeatIntentModifier(g.paceIdentityAtVisit ?? 0.5, g.pacePreference ?? 0.5);
  return {
    promoter: g.mood >= r.promoterMood,
    detractor: g.mood <= r.detractorMood,
    willReturn: returnScore >= r.returnMood
  };
}
function spawnGolfer(state, course, arrival2) {
  const id = state.nextGolferId++;
  const arch = ARCHETYPES[arrival2.archetype];
  const rng = mulberry32(state.seed + id * 131);
  const dp = getDifficultyProfile(state.difficulty);
  const rolledPersonality = rollPersonality(arch.personality, rng, {
    patience: dp.patienceMult,
    spend: dp.spendMult
  });
  const personality = arrival2.tournament ? { ...rolledPersonality, skill: Math.max(0, Math.min(1, arrival2.tournament.skill)), consistency: Math.max(rolledPersonality.consistency, 0.62) } : rolledPersonality;
  const capabilities = createGolferCapabilities({
    personality,
    seed: stableGolferSeed(arrival2.personId ?? arrival2.tournament?.entrantId ?? `${state.seed}:${id}`, state.seed + id)
  });
  const courseId = arrival2.courseId ?? state.tournament?.courseId ?? activeCourseLayout(course).id;
  const roundCourse = courseForLayout(course, courseId);
  const layout = layoutById(course, courseId) ?? activeCourseLayout(course);
  const baseProfile = getGolferProfile(solverProfileForSkill(personality.skill), roundCourse);
  const profile = state.weather ? {
    ...baseProfile,
    clubs: baseProfile.clubs.map((club) => ({
      ...club,
      carryYards: club.carryYards * state.weather.modifiers.carryMultiplier,
      dispersionTilesBase: club.dispersionTilesBase * state.weather.modifiers.dispersionMultiplier
    }))
  } : baseProfile;
  const entry = entryPoint(roundCourse);
  const wallet = rollDiscretionaryWallet(personality, rng);
  const preferredTeeSet = preferredTeeForArchetype(arch.name);
  const operations = state.operationsByCourse?.[courseId] ?? courseOperations(course, courseId);
  const guidedTeeSet = operations.teeGuidance === "required" ? personality.skill < 0.48 ? "forward" : personality.skill > 0.86 ? "championship" : "member" : preferredTeeSet;
  const teeSet = arrival2.tournament?.teeSet ?? (roundCourse.holes.every((hole) => !getTeeBox(hole, "member") || !!getTeeBox(hole, guidedTeeSet)) ? guidedTeeSet : "member");
  const pinRotation = arrival2.tournament?.pinRotation ?? roundCourse.activePinRotation ?? "A";
  const round2 = buildGolferRound({
    course: roundCourse,
    profile,
    entry,
    rng,
    personality,
    route: makeRouter(course, state.walkCache),
    wallet,
    teeSet,
    pinRotation,
    capabilities
  });
  if (state.weather && state.weather.modifiers.paceMultiplier !== 1) {
    round2.segments = round2.segments.map((segment2) => segment2.kind === "walk" || segment2.kind === "pause" ? { ...segment2, dur: segment2.dur * state.weather.modifiers.paceMultiplier } : segment2);
  }
  const holeIds = roundCourse.holes.map((hole) => hole.id).filter(Boolean);
  round2.segments = round2.segments.map((segment2) => ({ ...segment2, holeId: segment2.holeIndex >= 0 ? holeIds[segment2.holeIndex] : void 0 }));
  return {
    id,
    personId: arrival2.personId,
    name: arrival2.tournament?.name ?? arrival2.name ?? golferName(rng(), rng()),
    archetype: arch.name,
    teeSet,
    pinRotation,
    courseId,
    courseName: layout.name,
    holeIds,
    personality,
    color: arch.color,
    segments: round2.segments,
    segIndex: 0,
    segElapsed: 0,
    pos: { ...entry },
    ball: null,
    holePar: round2.holePar,
    holeStrokes: round2.holeStrokes,
    scoredHoles: 0,
    currentHole: -1,
    strokes: 0,
    scoreToPar: 0,
    mood: LIVE.mood.start,
    thought: null,
    thoughtUntil: 0,
    finished: false,
    spent: 0,
    wallet,
    purchasedSegmentIndexes: [],
    tournamentId: arrival2.tournament?.eventId,
    tournamentEntrantId: arrival2.tournament?.entrantId,
    groupId: arrival2.groupId ?? `${courseId}-solo-${id}`,
    groupStartedAt: state.dayMinute,
    waitMinutes: 0,
    pacePreference: personality.pacePreference ?? personality.skill,
    paceIdentityAtVisit: arrival2.paceIdentityAtVisit ?? 0.5,
    marshalInterventions: 0,
    forcedPickups: 0,
    drinksServed: 0,
    alcoholUnits: 0,
    hospitalityDelay: 0,
    disorderIncidents: 0,
    completionStatus: "completed",
    capabilities: round2.capabilities ?? capabilities,
    holePlans: round2.holePlans,
    shotOutcomes: round2.shotOutcomes,
    holeReactions: round2.holeReactions
  };
}
function stepLive(state, course, dtMin) {
  if (state.dayOver || dtMin <= 0) return { cashDelta: 0, finishedThisStep: 0, completedRounds: [] };
  state.dayMinute += dtMin;
  let cashDelta = 0;
  let finishedThisStep = 0;
  const completedRounds = [];
  while (state.nextArrivalIdx < state.arrivals.length && state.arrivals[state.nextArrivalIdx].atMinute <= state.dayMinute) {
    const firstIndex = state.nextArrivalIdx;
    const first = state.arrivals[firstIndex];
    const groupId = first.groupId ?? `${first.courseId ?? "course"}-solo-${firstIndex}`;
    const batch = [];
    const courseId = first.courseId ?? activeCourseLayout(course).id;
    const operations = state.operationsByCourse?.[courseId] ?? courseOperations(course, courseId);
    if (state.dayMinute < (state.nextTeeFreeAtByCourse?.[courseId] ?? 0)) break;
    while (state.nextArrivalIdx < state.arrivals.length && (state.arrivals[state.nextArrivalIdx].groupId ?? `${state.arrivals[state.nextArrivalIdx].courseId ?? "course"}-solo-${state.nextArrivalIdx}`) === groupId) {
      batch.push(state.arrivals[state.nextArrivalIdx++]);
    }
    if (state.dayMinute > operations.lastTeeMinute || state.dayMinute > LIVE.day.closeMinute) {
      const group2 = state.groups?.find((candidate) => candidate.id === groupId);
      if (group2) group2.finishedAt = state.dayMinute;
      continue;
    }
    const golfers = batch.map((arrival2) => spawnGolfer(state, course, { ...arrival2, groupId }));
    state.golfers.push(...golfers);
    state.roundsStarted += golfers.length;
    state.nextTeeFreeAtByCourse ??= {};
    state.nextTeeFreeAtByCourse[courseId] = state.dayMinute + operations.teeIntervalMinutes;
    state.nextTeeFreeAt = Math.min(...Object.values(state.nextTeeFreeAtByCourse));
    const courseStats = state.perCourse?.[courseId];
    if (courseStats) courseStats.roundsStarted += golfers.length;
    const group = state.groups?.find((candidate) => candidate.id === groupId);
    if (group) {
      group.startedAt = state.dayMinute;
      group.golferIds = golfers.map((golfer2) => golfer2.id);
    }
    if (state.pace) {
      state.pace.groupsStarted++;
      const coursePace = ensureCoursePaceMetrics(state.pace, courseId);
      coursePace.groupsStarted++;
      coursePace.lastStartedAt = state.dayMinute;
    }
    if (!first.tournament) {
      const fee = layoutById(course, courseId)?.greenFee ?? course.baseGreenFee;
      cashDelta += fee * golfers.length;
      state.greenFeeCollected += fee * golfers.length;
      golfers.forEach((golfer2) => {
        golfer2.spent += fee;
      });
      if (courseStats) courseStats.greenFees += fee * golfers.length;
      if (state.pace) ensureCoursePaceMetrics(state.pace, courseId).greenFeeRevenue += fee * golfers.length;
    }
  }
  const activeByGroup = /* @__PURE__ */ new Map();
  for (const golfer2 of state.golfers) {
    const id = golfer2.groupId ?? `${golfer2.courseId}-solo-${golfer2.id}`;
    const list = activeByGroup.get(id) ?? [];
    list.push(golfer2);
    activeByGroup.set(id, list);
  }
  const blockedGroups = /* @__PURE__ */ new Set();
  for (const courseId of new Set(state.golfers.map((golfer2) => golfer2.courseId).filter(Boolean))) {
    const ordered = (state.groups ?? []).filter((group) => group.courseId === courseId && group.startedAt != null && group.finishedAt == null).sort((a, b) => a.startedAt - b.startedAt);
    for (let index = 1; index < ordered.length; index++) {
      const current = activeByGroup.get(ordered[index].id) ?? [];
      const ahead = activeByGroup.get(ordered[index - 1].id) ?? [];
      const currentHole = Math.min(...current.map((golfer2) => golfer2.currentHole).filter((hole) => hole >= 0));
      const aheadHole = Math.min(...ahead.map((golfer2) => golfer2.currentHole).filter((hole) => hole >= 0));
      if (Number.isFinite(currentHole) && Number.isFinite(aheadHole) && aheadHole <= currentHole) blockedGroups.add(ordered[index].id);
    }
  }
  for (const group of state.groups ?? []) {
    group.blocked = blockedGroups.has(group.id);
    const activeGolfers = activeByGroup.get(group.id) ?? [];
    if (group.startedAt != null && group.finishedAt == null && activeGolfers.length && state.pace) {
      const coursePace = ensureCoursePaceMetrics(state.pace, group.courseId);
      coursePace.occupiedTeeMinutes += dtMin;
      const lead = [...activeGolfers].sort((left, right) => right.currentHole - left.currentHole)[0];
      const holeId = lead?.currentHoleId ?? lead?.holeIds?.[lead.currentHole];
      if (holeId) {
        const hole = coursePace.holes[holeId] ??= { holeId, queueMinutes: 0, occupancyMinutes: 0, recoveryDelayMinutes: 0, visits: 0 };
        hole.occupancyMinutes += dtMin;
        if (group.blocked) hole.queueMinutes += dtMin;
        const recoveryDelay = activeGolfers.some((golfer2) => {
          const segment2 = golfer2.segments[golfer2.segIndex];
          if (!segment2 || segment2.kind !== "pause") return false;
          const x = Math.max(0, Math.min(course.width - 1, Math.round(segment2.from.x)));
          const y = Math.max(0, Math.min(course.height - 1, Math.round(segment2.from.y)));
          return ["rough", "deep_rough", "sand", "waste_area", "water", "wetland"].includes(course.tiles[y * course.width + x]);
        });
        if (recoveryDelay) hole.recoveryDelayMinutes += dtMin;
        if (group.lastRecordedHoleId !== holeId) {
          group.lastRecordedHoleId = holeId;
          hole.visits++;
        }
      }
    }
    if (group.blocked) {
      group.waitMinutes += dtMin;
      if (state.pace) state.pace.totalWaitMinutes += dtMin;
    }
  }
  const overtimeMinutes = Math.max(0, state.dayMinute - Math.max(LIVE.day.closeMinute, state.dayMinute - dtMin));
  if (overtimeMinutes > 0 && state.pace) {
    for (const courseId of new Set((state.groups ?? []).filter(
      (group) => group.courseId && group.startedAt != null && group.finishedAt == null
    ).map((group) => group.courseId))) {
      ensureCoursePaceMetrics(state.pace, courseId).overtimeCost += (state.overtimeRateByCourse?.[courseId] ?? 0) * overtimeMinutes / 60;
    }
  }
  const stillPlaying = [];
  for (const g of state.golfers) {
    const previousSegment = g.segIndex;
    const previousScored = g.scoredHoles;
    const group = state.groups?.find((candidate) => candidate.id === g.groupId);
    const operations = state.operationsByCourse?.[g.courseId ?? ""] ?? courseOperations(course, g.courseId);
    const blocked = !!g.groupId && blockedGroups.has(g.groupId);
    if (!g.finished && state.dayMinute >= LIVE.day.closeMinute && operations.daylightPolicy === "strict_sunset") {
      g.completionStatus = "daylight";
      g.finished = true;
      g.thought = "Play ended at the daylight cutoff";
      g.thoughtUntil = state.dayMinute + 25;
    }
    if (blocked) {
      g.waitMinutes = (g.waitMinutes ?? 0) + dtMin;
      g.hospitalityDelay = Math.max(0, (g.hospitalityDelay ?? 0) - dtMin);
      g.mood = Math.max(0, g.mood - dtMin * (15e-5 + (g.pacePreference ?? 0.5) * 35e-5));
      if (state.pace && g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).totalWaitMinutes += dtMin;
      if (!g.finished && (g.waitMinutes ?? 0) >= BALANCE.paceOperations.abandonmentWaitMinutes && g.mood <= BALANCE.paceOperations.abandonmentMood) {
        g.completionStatus = "congestion_abandonment";
        g.finished = true;
        g.thought = "The group left after an excessive wait";
        g.thoughtUntil = state.dayMinute + 25;
      }
    } else if ((g.hospitalityDelay ?? 0) > 0) {
      g.hospitalityDelay = Math.max(0, (g.hospitalityDelay ?? 0) - dtMin);
    } else {
      let paceDt = dtMin;
      if (group?.startedAt != null && g.currentHole >= 0 && (state.marshalCoverageByCourse?.[g.courseId ?? ""] ?? 0) > 0 && operations.enforcement !== "advisory") {
        const holes = Math.max(1, g.holePar.length);
        const expected = groupTimeParMinutes(holes, group.golferIds.length || 1, operations) * ((g.currentHole + 1) / holes);
        const behind = state.dayMinute - group.startedAt - expected;
        const tolerance = operations.enforcement === "strict" ? 6 : 12;
        if (behind > tolerance && state.dayMinute - (group.lastMarshalMinute ?? -999) >= 20) {
          group.lastMarshalMinute = state.dayMinute;
          group.interventions++;
          g.marshalInterventions = (g.marshalInterventions ?? 0) + 1;
          if (state.pace) state.pace.marshalInterventions++;
          g.thought = "A course marshal asked our group to close the gap";
          g.thoughtUntil = state.dayMinute + 20;
          g.mood = Math.max(0, g.mood - 0.015);
          if (behind > 30 && group.interventions >= 2 && group.lastPickupHole !== g.currentHole) {
            group.lastPickupHole = g.currentHole;
            group.pickups++;
            g.forcedPickups = (g.forcedPickups ?? 0) + 1;
            if (state.pace) {
              state.pace.forcedPickups++;
              if (g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).pickups++;
            }
            for (let index = g.segIndex; index < g.segments.length && g.segments[index].holeIndex === g.currentHole; index++) g.segments[index].dur = Math.min(g.segments[index].dur, 0.02);
            g.thought = "Picked up to restore position";
            g.mood = Math.max(0, g.mood - 0.07);
          }
        }
        if (behind > tolerance) paceDt *= 1.2;
      }
      advanceGolfer(g, paceDt, course.condition);
    }
    if (state.tournament) updateTournamentStanding(state.tournament, g);
    for (let i = previousSegment; i <= Math.min(g.segIndex, g.segments.length - 1); i++) {
      const concession = g.segments[i]?.concession;
      if (!concession || g.purchasedSegmentIndexes.includes(i) || g.wallet < concession.amount) continue;
      g.purchasedSegmentIndexes.push(i);
      g.wallet -= concession.amount;
      g.spent += concession.amount;
      g.thought = `Bought ${concession.item.toLowerCase()} for $${concession.amount}`;
      g.thoughtUntil = state.dayMinute + 18;
      const transaction = {
        id: `${state.seed}-${g.id}-${i}`,
        golferId: g.id,
        golferName: g.name,
        buildingType: concession.buildingType,
        buildingX: concession.buildingX,
        buildingY: concession.buildingY,
        item: concession.item,
        amount: concession.amount,
        atMinute: state.dayMinute
      };
      state.concessionTransactions.push(transaction);
      state.concessionCollected += concession.amount;
      state.concessionByType[concession.buildingType] = (state.concessionByType[concession.buildingType] ?? 0) + concession.amount;
      cashDelta += concession.amount;
    }
    if (g.scoredHoles > previousScored && (state.beverageCoverageByCourse?.[g.courseId ?? ""] ?? 0) > 0 && operations.beverage.menu !== "off" && operations.beverage.passes > 0) {
      const interval = Math.max(1, Math.ceil(g.holePar.length / operations.beverage.passes));
      if (g.scoredHoles % interval === 0 && g.wallet >= operations.beverage.price) {
        const alcoholic = operations.beverage.menu === "beer_wine" && g.archetype !== "junior";
        if (alcoholic && (g.alcoholUnits ?? 0) >= operations.beverage.alcoholLimit) {
          if (state.pace) state.pace.serviceRefusals++;
          g.thought = "Beverage service declined another drink";
          g.thoughtUntil = state.dayMinute + 18;
        } else {
          const amount = operations.beverage.price;
          g.wallet -= amount;
          g.spent += amount;
          g.drinksServed = (g.drinksServed ?? 0) + 1;
          g.hospitalityDelay = (g.hospitalityDelay ?? 0) + 2;
          if (alcoholic) {
            g.alcoholUnits = (g.alcoholUnits ?? 0) + 1;
            if (state.pace) state.pace.alcoholicDrinks++;
          }
          g.mood = Math.min(1, g.mood + 0.025);
          const transaction = { id: `${state.seed}-${g.id}-bev-${g.scoredHoles}`, golferId: g.id, golferName: g.name, buildingType: "snack_bar", buildingX: Math.round(g.pos.x), buildingY: Math.round(g.pos.y), item: alcoholic ? "Beer & snack" : "Refreshment", amount, atMinute: state.dayMinute };
          state.concessionTransactions.push(transaction);
          state.concessionCollected += amount;
          state.concessionByType.snack_bar = (state.concessionByType.snack_bar ?? 0) + amount;
          cashDelta += amount;
          if (state.pace) state.pace.beverageRevenue += amount;
          if (state.pace && g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).beverageRevenue += amount;
          if ((g.alcoholUnits ?? 0) >= 3 && (state.seed + g.id * 17 + g.scoredHoles * 13) % 11 === 0) {
            g.disorderIncidents = (g.disorderIncidents ?? 0) + 1;
            g.mood = Math.max(0, g.mood - 0.1);
            g.hospitalityDelay += 5;
            g.thought = "The group became disruptive";
            g.thoughtUntil = state.dayMinute + 25;
            if (state.pace) state.pace.disorderIncidents++;
            if (state.pace && g.courseId) ensureCoursePaceMetrics(state.pace, g.courseId).incidents++;
          }
        }
      }
    }
    if (g.finished) {
      const completed = g.completionStatus !== "daylight" && g.completionStatus !== "congestion_abandonment" && g.scoredHoles >= g.holePar.length;
      const courseId = g.courseId ?? activeCourseLayout(course).id;
      if (state.pace) {
        const coursePace = ensureCoursePaceMetrics(state.pace, courseId);
        const duration = Math.max(0, state.dayMinute - (g.groupStartedAt ?? group?.startedAt ?? state.dayMinute));
        const expected = groupTimeParMinutes(Math.max(1, g.holePar.length), group?.golferIds.length || 1, operations);
        const cohort = cohortFromGolfer(g.personality.skill, g.personality.patience);
        const cohortMetrics = coursePace.cohorts[cohort];
        coursePace.roundDurations.push(duration);
        if (coursePace.roundDurations.length > BALANCE.paceOperations.maxDurationSamplesPerDay) coursePace.roundDurations.shift();
        if (completed) {
          coursePace.roundsCompleted++;
          coursePace.satisfaction += g.mood * 100;
        } else {
          coursePace.roundsIncomplete++;
        }
        cohortMetrics.samples++;
        cohortMetrics.durationMinutes += duration;
        cohortMetrics.timeParVarianceMinutes += duration - expected;
        cohortMetrics.waitMinutes += g.waitMinutes ?? 0;
        cohortMetrics.pickups += g.forcedPickups ?? 0;
        cohortMetrics.abandonments += completed ? 0 : 1;
        cohortMetrics.satisfaction += g.mood * 100;
        const fee = layoutById(course, courseId)?.greenFee ?? course.baseGreenFee;
        const progress = g.holePar.length ? g.scoredHoles / g.holePar.length : 0;
        let compensationRate = 0;
        if (g.completionStatus === "daylight") {
          compensationRate = progress < 0.5 ? BALANCE.paceOperations.daylightEarlyRefundRate : BALANCE.paceOperations.daylightLateRefundRate;
        } else if (g.completionStatus === "congestion_abandonment") {
          compensationRate = BALANCE.paceOperations.congestionCreditRate;
        } else if ((g.forcedPickups ?? 0) > 0) {
          compensationRate = Math.min(0.5, (g.forcedPickups ?? 0) * BALANCE.paceOperations.marshalPickupCreditRate);
        }
        if (compensationRate > 0) {
          const amount = Math.round(fee * compensationRate * 100) / 100;
          coursePace.compensationCost += amount;
          if (operations.compensationPolicy === "refund" || g.completionStatus === "daylight") coursePace.refunds += amount;
          else if (operations.compensationPolicy === "credit") coursePace.credits += amount;
          else coursePace.goodwillVouchers += amount;
        }
      }
      state.satisfactionSum += g.mood * 100;
      state.roundsFinished++;
      const reaction = classifyReaction(g);
      if (reaction.promoter) state.promoters++;
      if (reaction.detractor) state.detractors++;
      if (reaction.willReturn) state.willReturnCount++;
      const courseStats = g.courseId ? state.perCourse?.[g.courseId] : void 0;
      if (courseStats) {
        if (completed) courseStats.roundsFinished++;
        courseStats.satisfactionSum += g.mood * 100;
        if (reaction.promoter) courseStats.promoters++;
        if (reaction.detractor) courseStats.detractors++;
        if (reaction.willReturn) courseStats.willReturnCount++;
      }
      finishedThisStep++;
      if (completed) completedRounds.push({
        golferId: g.id,
        golferName: g.name,
        archetype: g.archetype,
        score: g.strokes,
        scoreToPar: g.scoreToPar,
        holePar: g.holePar.slice(),
        holeStrokes: g.holeStrokes.slice(),
        mood: g.mood,
        courseId: g.courseId,
        courseName: g.courseName,
        holeIds: g.holeIds?.slice(),
        tournamentId: g.tournamentId,
        tournamentEntrantId: g.tournamentEntrantId,
        teeSet: g.teeSet,
        waitMinutes: g.waitMinutes ?? 0,
        capabilities: g.capabilities,
        holePlans: g.holePlans?.slice(),
        shotOutcomes: g.shotOutcomes?.slice(),
        holeReactions: g.holeReactions?.slice(),
        shots: g.shotOutcomes?.length ? g.shotOutcomes.map((outcome) => shotRecordFromOutcome(outcome)) : (() => {
          const numbers = /* @__PURE__ */ new Map();
          return g.segments.filter((segment2) => segment2.kind === "flight").map((segment2) => {
            const holeId = segment2.holeId ?? g.holeIds?.[segment2.holeIndex] ?? `hole-${segment2.holeIndex + 1}`;
            const shotNumber = (numbers.get(holeId) ?? 0) + 1;
            numbers.set(holeId, shotNumber);
            const x = Math.max(0, Math.min(course.width - 1, Math.round(segment2.from.x)));
            const y = Math.max(0, Math.min(course.height - 1, Math.round(segment2.from.y)));
            const lie = course.tiles[y * course.width + x] ?? "rough";
            const shotType = segment2.shot === "putt" ? "putt" : shotNumber === 1 && lie === "tee" ? "drive" : ["rough", "deep_rough", "sand", "waste_area", "water", "wetland"].includes(lie) ? "recovery" : "approach";
            return {
              id: `live-shot-${g.id}-${holeId}-${shotNumber}`,
              holeId,
              shotNumber,
              shotType,
              from: { ...segment2.from },
              landing: { ...segment2.to },
              rest: { ...segment2.to },
              lieBefore: lie,
              lieAfter: course.tiles[Math.max(0, Math.min(course.height - 1, Math.round(segment2.to.y))) * course.width + Math.max(0, Math.min(course.width - 1, Math.round(segment2.to.x)))] ?? "rough"
            };
          });
        })()
      });
    } else {
      stillPlaying.push(g);
    }
  }
  state.golfers = stillPlaying;
  const activeIds = new Set(stillPlaying.map((golfer2) => golfer2.id));
  for (const group of state.groups ?? []) if (group.startedAt != null && group.finishedAt == null && group.golferIds.length > 0 && group.golferIds.every((id) => !activeIds.has(id))) {
    group.finishedAt = state.dayMinute;
    if (state.pace) {
      state.pace.groupsFinished++;
      ensureCoursePaceMetrics(state.pace, group.courseId).groupsFinished++;
    }
  }
  const allArrived = state.nextArrivalIdx >= state.arrivals.length;
  const closedForBusiness = state.tournament ? true : state.dayMinute >= LIVE.day.closeMinute;
  if (closedForBusiness && allArrived && state.golfers.length === 0) {
    state.dayOver = true;
  }
  return { cashDelta, finishedThisStep, completedRounds };
}
function shotRecordFromOutcome(outcome) {
  const shotType = outcome.technique === "normal" && outcome.shotNumber === 1 && outcome.lieBefore === "tee" ? "drive" : outcome.intent === "recovery" || ["rough", "deep_rough", "sand", "waste_area", "water", "wetland"].includes(outcome.lieBefore) ? "recovery" : outcome.club === "Putter" || outcome.lieBefore === "green" ? "putt" : "approach";
  return {
    id: outcome.id,
    holeId: outcome.holeId,
    shotNumber: outcome.shotNumber,
    shotType,
    from: { ...outcome.from },
    landing: { ...outcome.landing },
    rest: { ...outcome.rest },
    lieBefore: outcome.lieBefore,
    lieAfter: outcome.lieAfter
  };
}
function createWeekLedger(week) {
  return { version: 1, week, days: [] };
}
function normalizeWeekLedger(value, fallbackWeek) {
  if (!value || typeof value !== "object") return createWeekLedger(fallbackWeek);
  const candidate = value;
  if (candidate.version !== 1 || !Number.isInteger(candidate.week) || !Array.isArray(candidate.days)) return createWeekLedger(fallbackWeek);
  const days = candidate.days.filter((day) => !!day && Number.isInteger(day.dayIndex) && day.dayIndex >= 0 && day.dayIndex < 7).slice(0, 7);
  return { version: 1, week: candidate.week, days };
}
const MAX_GOLFERS = 500;
const MAX_ARRIVALS = 1e3;
const MAX_SEGMENTS_PER_GOLFER = 5e3;
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function point(value, nullable = false) {
  if (nullable && value === null) return true;
  return isRecord(value) && finite(value.x) && finite(value.y);
}
function segment(value) {
  if (!isRecord(value)) return false;
  return (value.kind === "walk" || value.kind === "flight" || value.kind === "pause") && point(value.from) && point(value.to) && finite(value.dur) && value.dur >= 0 && Number.isInteger(value.holeIndex) && (value.shot == null || value.shot === "swing" || value.shot === "putt") && (value.concession == null || isRecord(value.concession) && typeof value.concession.buildingType === "string" && finite(value.concession.buildingX) && finite(value.concession.buildingY) && typeof value.concession.item === "string" && finite(value.concession.amount));
}
const intentKinds = /* @__PURE__ */ new Set(["safe", "hero", "positional", "recovery", "approach"]);
const techniques = /* @__PURE__ */ new Set(["normal", "draw", "fade", "punch", "flop", "backspin"]);
function fact(value) {
  return isRecord(value) && ["capability-fit", "risk", "terrain", "next-shot", "context", "outcome"].includes(String(value.code)) && typeof value.detail === "string";
}
function shotIntent(value) {
  return isRecord(value) && typeof value.id === "string" && intentKinds.has(value.kind) && point(value.from) && point(value.target) && typeof value.club === "string" && techniques.has(String(value.technique)) && ["power", "expectedStrokes", "variance", "hazardRisk", "nextShotQuality"].every((key2) => finite(value[key2])) && Array.isArray(value.facts) && value.facts.length <= 8 && value.facts.every(fact);
}
function holePlan(value) {
  return isRecord(value) && value.version === 1 && typeof value.holeId === "string" && finite(value.par) && finite(value.expectedScore) && shotIntent(value.chosen) && Array.isArray(value.rejected) && value.rejected.length <= 5 && value.rejected.every(
    (alternative) => isRecord(alternative) && intentKinds.has(alternative.kind) && finite(alternative.expectedStrokes) && typeof alternative.reason === "string" && Array.isArray(alternative.facts) && alternative.facts.length <= 8 && alternative.facts.every(fact)
  );
}
function shotOutcome(value) {
  return isRecord(value) && value.version === 1 && typeof value.id === "string" && typeof value.holeId === "string" && finite(value.shotNumber) && Number.isInteger(value.shotNumber) && value.shotNumber > 0 && intentKinds.has(value.intent) && typeof value.intentId === "string" && typeof value.club === "string" && techniques.has(String(value.technique)) && point(value.from) && point(value.aim) && point(value.landing) && point(value.rest) && typeof value.lieBefore === "string" && typeof value.lieAfter === "string" && ["carryYards", "rollYards", "penaltyStrokes", "seed"].every((key2) => finite(value[key2])) && typeof value.holed === "boolean" && Array.isArray(value.facts) && value.facts.length <= 12 && value.facts.every(fact);
}
function holeReaction(value) {
  return isRecord(value) && value.version === 1 && typeof value.holeId === "string" && ["expectedScore", "actualScore", "satisfaction"].every((key2) => finite(value[key2])) && ["delighted", "pleased", "neutral", "frustrated", "unfair"].includes(String(value.outcome)) && Array.isArray(value.facts) && value.facts.length <= 12 && value.facts.every(fact) && typeof value.thought === "string" && (value.memory == null || typeof value.memory === "string");
}
function golfer(value) {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.id) || typeof value.name !== "string" || typeof value.archetype !== "string") return false;
  if (!isRecord(value.personality) || typeof value.color !== "string") return false;
  if (!Array.isArray(value.segments) || value.segments.length > MAX_SEGMENTS_PER_GOLFER || value.segments.some((s) => !segment(s))) return false;
  if (!point(value.pos) || !point(value.ball, true)) return false;
  if (!Array.isArray(value.holePar) || value.holePar.some((n) => !finite(n))) return false;
  if (!Array.isArray(value.holeStrokes) || value.holeStrokes.some((n) => !finite(n))) return false;
  for (const key2 of ["segIndex", "segElapsed", "scoredHoles", "currentHole", "strokes", "scoreToPar", "mood", "thoughtUntil", "spent"]) {
    if (!finite(value[key2])) return false;
  }
  return typeof value.finished === "boolean" && (value.thought === null || typeof value.thought === "string") && (value.teeSet == null || value.teeSet === "forward" || value.teeSet === "member" || value.teeSet === "championship") && (value.pinRotation == null || value.pinRotation === "A" || value.pinRotation === "B" || value.pinRotation === "C") && (value.courseId == null || typeof value.courseId === "string") && (value.courseName == null || typeof value.courseName === "string") && (value.holeIds == null || Array.isArray(value.holeIds) && value.holeIds.every((id) => typeof id === "string")) && (value.currentHoleId == null || typeof value.currentHoleId === "string") && (value.paceIdentityAtVisit == null || finite(value.paceIdentityAtVisit) && value.paceIdentityAtVisit >= 0 && value.paceIdentityAtVisit <= 1) && (value.wallet == null || finite(value.wallet)) && (value.purchasedSegmentIndexes == null || Array.isArray(value.purchasedSegmentIndexes) && value.purchasedSegmentIndexes.every(Number.isInteger)) && (value.tournamentId == null || typeof value.tournamentId === "string") && (value.tournamentEntrantId == null || typeof value.tournamentEntrantId === "string") && (value.capabilities == null || isRecord(value.capabilities)) && (value.currentIntent == null || shotIntent(value.currentIntent)) && (value.holePlans == null || Array.isArray(value.holePlans) && value.holePlans.length <= M47_MAX_PLANS && value.holePlans.every(holePlan)) && (value.shotOutcomes == null || Array.isArray(value.shotOutcomes) && value.shotOutcomes.length <= M47_MAX_OUTCOMES && value.shotOutcomes.every(shotOutcome)) && (value.holeReactions == null || Array.isArray(value.holeReactions) && value.holeReactions.length <= M47_MAX_REACTIONS && value.holeReactions.every(holeReaction));
}
function arrival(value) {
  if (!isRecord(value) || !finite(value.atMinute) || typeof value.archetype !== "string") return false;
  if (value.courseId != null && typeof value.courseId !== "string") return false;
  if (value.paceIdentityAtVisit != null && (!finite(value.paceIdentityAtVisit) || value.paceIdentityAtVisit < 0 || value.paceIdentityAtVisit > 1)) return false;
  if (value.tournament == null) return true;
  return isRecord(value.tournament) && typeof value.tournament.eventId === "string" && typeof value.tournament.entrantId === "string" && typeof value.tournament.name === "string" && finite(value.tournament.skill) && (value.tournament.teeSet == null || value.tournament.teeSet === "forward" || value.tournament.teeSet === "member" || value.tournament.teeSet === "championship") && (value.tournament.pinRotation == null || value.tournament.pinRotation === "A" || value.tournament.pinRotation === "B" || value.tournament.pinRotation === "C");
}
function tournament(value) {
  if (value == null) return true;
  if (!isRecord(value) || typeof value.eventId !== "string" || typeof value.name !== "string") return false;
  if (value.courseId != null && typeof value.courseId !== "string") return false;
  if (value.tier !== "local" && value.tier !== "regional" && value.tier !== "championship") return false;
  if (!Array.isArray(value.standings) || value.standings.length > MAX_GOLFERS) return false;
  if (value.teeSet != null && value.teeSet !== "forward" && value.teeSet !== "member" && value.teeSet !== "championship") return false;
  if (value.pinRotation != null && value.pinRotation !== "A" && value.pinRotation !== "B" && value.pinRotation !== "C") return false;
  return value.standings.every((row) => isRecord(row) && typeof row.entrantId === "string" && (row.golferId === null || Number.isInteger(row.golferId)) && typeof row.name === "string" && typeof row.archetype === "string" && finite(row.holesCompleted) && finite(row.score) && finite(row.scoreToPar) && typeof row.finished === "boolean");
}
function normalizedSpeed(value) {
  if (value === "3x") return "4x";
  return value === "paused" || value === "1x" || value === "2x" || value === "4x" ? value : null;
}
function cloneSerializableState(state) {
  return JSON.parse(JSON.stringify(state));
}
function snapshotLiveSimulation(args) {
  const { walkCache: _walkCache, ...serializable } = args.state;
  return {
    version: 4,
    state: cloneSerializableState(serializable),
    pendingCash: args.pendingCash,
    speed: args.speed,
    selectedGolferId: args.selectedGolferId,
    clockRemainderMinutes: Math.max(0, args.clockRemainderMinutes ?? 0),
    weekLedger: args.weekLedger ?? createWeekLedger(1)
  };
}
function restoreLiveSimulation(input) {
  if (!isRecord(input) || input.version !== 1 && input.version !== 2 && input.version !== 3 && input.version !== 4 || !isRecord(input.state)) return null;
  const state = input.state;
  if (!Array.isArray(state.golfers) || state.golfers.length > MAX_GOLFERS || state.golfers.some((g) => !golfer(g))) return null;
  if (!Array.isArray(state.arrivals) || state.arrivals.length > MAX_ARRIVALS || state.arrivals.some((a) => !arrival(a))) return null;
  if (!tournament(state.tournament)) return null;
  if (state.nextTeeFreeAtByCourse != null && (!isRecord(state.nextTeeFreeAtByCourse) || Object.values(state.nextTeeFreeAtByCourse).some((value) => !finite(value)))) return null;
  if (state.perCourse != null && (!isRecord(state.perCourse) || Object.values(state.perCourse).some((value) => {
    if (!isRecord(value) || typeof value.courseName !== "string") return true;
    return ["arrivals", "roundsStarted", "roundsFinished", "greenFees", "satisfactionSum", "promoters", "detractors", "willReturnCount"].some((key2) => !finite(value[key2]));
  }))) return null;
  for (const key2 of [
    "dayIndex",
    "dayMinute",
    "nextArrivalIdx",
    "nextGolferId",
    "greenFeeCollected",
    "roundsStarted",
    "roundsFinished",
    "satisfactionSum",
    "promoters",
    "detractors",
    "willReturnCount",
    "reconcileEpoch",
    "nextTeeFreeAt",
    "seed"
  ]) {
    if (!finite(state[key2])) return null;
  }
  if (typeof state.dayOver !== "boolean") return null;
  const speed = normalizedSpeed(input.speed);
  if (!finite(input.pendingCash) || input.pendingCash < 0 || !speed) return null;
  if (input.clockRemainderMinutes != null && (!finite(input.clockRemainderMinutes) || input.clockRemainderMinutes < 0)) return null;
  if (input.selectedGolferId !== null && !Number.isInteger(input.selectedGolferId)) return null;
  const serializable = cloneSerializableState(state);
  const stateSeed = finite(state.seed) ? state.seed : 0;
  serializable.golfers = serializable.golfers.map((g) => {
    const fallbackCapabilities = createGolferCapabilities({
      personality: g.personality,
      seed: stableGolferSeed(g.personId ?? `${g.name}:${g.id}`, stateSeed + g.id)
    });
    return {
      ...g,
      capabilities: normalizeGolferCapabilities(g.capabilities, fallbackCapabilities),
      holePlans: Array.isArray(g.holePlans) ? g.holePlans.slice(-M47_MAX_PLANS) : [],
      shotOutcomes: Array.isArray(g.shotOutcomes) ? g.shotOutcomes.slice(-M47_MAX_OUTCOMES) : [],
      holeReactions: Array.isArray(g.holeReactions) ? g.holeReactions.slice(-M47_MAX_REACTIONS) : [],
      wallet: g.wallet ?? 0,
      purchasedSegmentIndexes: g.purchasedSegmentIndexes ?? [],
      teeSet: g.teeSet ?? "member",
      pinRotation: g.pinRotation ?? "A",
      groupId: g.groupId ?? `${g.courseId ?? "course"}-solo-${g.id}`,
      groupStartedAt: g.groupStartedAt ?? serializable.dayMinute,
      waitMinutes: g.waitMinutes ?? 0,
      pacePreference: g.pacePreference ?? g.personality.skill,
      paceIdentityAtVisit: g.paceIdentityAtVisit ?? 0.5,
      marshalInterventions: g.marshalInterventions ?? 0,
      forcedPickups: g.forcedPickups ?? 0,
      drinksServed: g.drinksServed ?? 0,
      alcoholUnits: g.alcoholUnits ?? 0,
      hospitalityDelay: g.hospitalityDelay ?? 0,
      disorderIncidents: g.disorderIncidents ?? 0,
      completionStatus: g.completionStatus === "daylight" || g.completionStatus === "congestion_abandonment" ? g.completionStatus : "completed"
    };
  });
  serializable.arrivals = serializable.arrivals.map((arrival2, index) => ({
    ...arrival2,
    groupId: arrival2.groupId ?? `${arrival2.courseId ?? "course"}-solo-arrival-${index}`,
    paceIdentityAtVisit: arrival2.paceIdentityAtVisit ?? 0.5
  }));
  serializable.groups ??= serializable.golfers.map((g) => ({ id: g.groupId, courseId: g.courseId ?? "course-primary", bookedAt: g.groupStartedAt ?? serializable.dayMinute, startedAt: g.groupStartedAt ?? serializable.dayMinute, golferIds: [g.id], waitMinutes: g.waitMinutes ?? 0, blocked: false, interventions: g.marshalInterventions ?? 0, pickups: g.forcedPickups ?? 0, finishedAt: null }));
  serializable.pace ??= emptyPaceDayMetrics();
  serializable.pace.perCourse ??= {};
  serializable.marshalCoverageByCourse ??= {};
  serializable.beverageCoverageByCourse ??= {};
  serializable.overtimeRateByCourse ??= {};
  serializable.operationsByCourse ??= {};
  serializable.concessionCollected ??= 0;
  serializable.concessionTransactions ??= [];
  serializable.concessionByType ??= {};
  if (serializable.tournament) {
    serializable.tournament.teeSet ??= "member";
    serializable.tournament.pinRotation ??= "A";
    serializable.tournament.ordinaryPinRotation ??= "A";
    serializable.tournament.qualificationSnapshot ??= {
      eligible: true,
      teeSet: serializable.tournament.teeSet,
      pinRotation: serializable.tournament.pinRotation,
      rating: 0,
      slope: 113,
      effectiveYardage: 0,
      completeRotations: [serializable.tournament.pinRotation],
      requirements: [],
      blockingReasons: []
    };
  }
  return {
    state: { ...serializable, walkCache: /* @__PURE__ */ new Map() },
    pendingCash: input.pendingCash,
    speed,
    selectedGolferId: input.selectedGolferId,
    clockRemainderMinutes: finite(input.clockRemainderMinutes) ? input.clockRemainderMinutes : 0,
    weekLedger: normalizeWeekLedger(input.weekLedger, 1)
  };
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).filter((key2) => record[key2] !== void 0).sort().map((key2) => `${JSON.stringify(key2)}:${canonical(record[key2])}`).join(",")}}`;
}
function hashCanonicalValue(value) {
  const text = canonical(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function hashGameState(value) {
  const normalized = normalizeCourseLayouts(value.course);
  const course = {
    ...normalized,
    decorations: value.course.decorations ?? [],
    buildings: (value.course.buildings ?? []).map(normalizedBuilding),
    activePinRotation: value.course.activePinRotation ?? "A",
    holes: normalized.holes.map(withNormalizedHoleSetup)
  };
  return hashCanonicalValue({ course, world: value.world, live: value.live });
}
function createRenderPerfCourse(theme = "parkland") {
  const width = 110;
  const height = 70;
  const tiles = Array.from({ length: width * height }, () => "rough");
  const elevations = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return Math.max(0, Math.min(7, Math.round(3 + Math.sin(x / 10) * 2 + Math.cos(y / 8) * 2)));
  });
  const holes = [];
  for (let i = 0; i < 18; i++) {
    const y = 5 + i * 3;
    const leftToRight = i % 2 === 0;
    const tee2 = { x: leftToRight ? 10 : 99, y };
    const green2 = { x: leftToRight ? 99 : 10, y };
    const lo = Math.min(tee2.x, green2.x);
    const hi = Math.max(tee2.x, green2.x);
    for (let yy = y - 1; yy <= y + 1; yy++) {
      for (let x = lo; x <= hi; x++) {
        const index = yy * width + x;
        tiles[index] = "fairway";
        elevations[index] = 2 + Math.round((Math.sin((x + i * 7) / 13) + 1) * 1.5);
      }
    }
    tiles[tee2.y * width + tee2.x] = "tee";
    for (let yy = green2.y - 1; yy <= green2.y + 1; yy++) {
      for (let x = green2.x - 1; x <= green2.x + 1; x++) tiles[yy * width + x] = "green";
    }
    holes.push({ tee: tee2, green: green2, parMode: "MANUAL", parManual: 5, name: `Performance Hole ${i + 1}`, holeIndex: i + 1 });
  }
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const index = y * width + x;
      if (tiles[index] !== "rough") continue;
      if ((x * 17 + y * 31) % 173 === 0) tiles[index] = "water";
      else if ((x * 29 + y * 11) % 137 === 0) tiles[index] = "sand";
    }
  }
  const obstacles = [];
  for (let y = 1; y < height - 1 && obstacles.length < 540; y++) {
    for (let x = 1; x < width - 1 && obstacles.length < 540; x++) {
      const terrain = tiles[y * width + x];
      if (terrain !== "rough" || (x * 37 + y * 19) % 3 !== 0) continue;
      obstacles.push({ x, y, type: obstacles.length % 40 === 0 ? "bush" : obstacles.length % 20 === 0 ? "rock" : "tree" });
    }
  }
  const decorations = [];
  for (let y = 2; y < height - 2 && decorations.length < 320; y += 2) for (let x = 2; x < width - 2 && decorations.length < 320; x += 3) {
    const terrain = tiles[y * width + x];
    if (terrain !== "rough" || obstacles.some((obstacle) => obstacle.x === x && obstacle.y === y)) continue;
    decorations.push({ kind: decorations.length % 7 === 0 ? "flower_bed" : decorations.length % 5 === 0 ? "lamp" : "bench", x, y, rotation: decorations.length % 4 });
  }
  return {
    width,
    height,
    tiles,
    elevations,
    holes,
    obstacles,
    buildings: [
      { type: "clubhouse", x: 2, y: 31 },
      { type: "pro_shop", x: 6, y: 31, tier: 3, price: 40 },
      { type: "snack_bar", x: 52, y: 31, tier: 3, price: 15 },
      { type: "cart_rental", x: 6, y: 36, tier: 3, price: 30 }
    ],
    decorations,
    yardsPerTile: 4,
    name: "M12 Render Performance Club",
    baseGreenFee: 120,
    condition: 0.92,
    theme
  };
}
function createTournamentStandardsCourse() {
  const base = createRenderPerfCourse();
  const tiles = base.tiles.slice();
  const holes = base.holes.map((hole, holeIndex) => {
    const member = hole.tee;
    const pinA = hole.green;
    const direction = pinA.x > member.x ? 1 : -1;
    const forward = { x: member.x + direction * 4, y: member.y };
    const championship = { x: member.x - direction * 4, y: member.y };
    const pinB = { x: pinA.x - direction, y: pinA.y };
    const pinC = { x: pinA.x, y: pinA.y + 1 };
    tiles[forward.y * base.width + forward.x] = "tee";
    tiles[championship.y * base.width + championship.x] = "tee";
    if (holeIndex < 9) for (let step = 1; step < 4; step++) {
      tiles[championship.y * base.width + championship.x + direction * step] = "water";
    }
    for (let yy = pinA.y - 1; yy <= pinA.y + 1; yy++) for (let xx = pinA.x - 1; xx <= pinA.x + 1; xx++) {
      const keepGreen = xx === pinA.x && yy === pinA.y || xx === pinB.x && yy === pinB.y || xx === pinC.x && yy === pinC.y;
      tiles[yy * base.width + xx] = keepGreen ? "green" : "sand";
    }
    return {
      ...hole,
      teeBoxes: { forward, member, championship },
      pinPositions: { A: pinA, B: pinB, C: pinC }
    };
  });
  return { ...base, name: "M24 Tournament Standards Club", tiles, holes, yardsPerTile: 3, activePinRotation: "B" };
}
const M47_ROUND_LENGTHS = [9, 18, 36];
const basePreferences = { scenery: 0.2, price: 0 };
function referencePersonality(overrides) {
  return {
    skill: 0.65,
    consistency: 0.65,
    patience: 0.55,
    spendPropensity: 0.5,
    ...overrides,
    prefs: { difficulty: 0, ...basePreferences, ...overrides.prefs }
  };
}
const M47_REFERENCE_GOLFERS = [
  { id: "power", name: "Parker Power", seed: 470101, personality: referencePersonality({ skill: 0.88, consistency: 0.62, prefs: { difficulty: 0.55 } }) },
  { id: "accuracy", name: "Avery Accurate", seed: 470102, personality: referencePersonality({ skill: 0.72, consistency: 0.94, prefs: { difficulty: -0.2 } }) },
  { id: "irons", name: "Iris Irons", seed: 470103, personality: referencePersonality({ skill: 0.76, consistency: 0.84, prefs: { difficulty: 0.1 } }) },
  { id: "short-game", name: "Shay Shortgame", seed: 470104, personality: referencePersonality({ skill: 0.58, consistency: 0.9, prefs: { difficulty: -0.1 } }) },
  { id: "recovery", name: "Rory Recovery", seed: 470105, personality: referencePersonality({ skill: 0.54, consistency: 0.88, prefs: { difficulty: 0 } }) },
  { id: "consistency", name: "Cameron Consistent", seed: 470106, personality: referencePersonality({ skill: 0.7, consistency: 0.99, prefs: { difficulty: -0.15 } }) },
  { id: "aggressive", name: "Arden Aggressive", seed: 470107, personality: referencePersonality({ skill: 0.8, consistency: 0.78, prefs: { difficulty: 1 } }) },
  { id: "conservative", name: "Connie Conservative", seed: 470108, personality: referencePersonality({ skill: 0.68, consistency: 0.86, prefs: { difficulty: -1 } }) },
  { id: "casual", name: "Casey Casual", seed: 470109, personality: referencePersonality({ skill: 0.34, consistency: 0.38, patience: 0.7, spendPropensity: 0.8, prefs: { difficulty: -0.75, scenery: 0.55, price: -0.25 } }) },
  { id: "balanced", name: "Bailey Balanced", seed: 470110, personality: referencePersonality({ skill: 0.67, consistency: 0.72, prefs: { difficulty: 0 } }) }
];
function setTile(tiles, width, point2, terrain) {
  if (point2.x < 0 || point2.y < 0 || point2.x >= width) return;
  const index = point2.y * width + point2.x;
  if (index >= 0 && index < tiles.length) tiles[index] = terrain;
}
function setRect(tiles, width, fromX, toX, centerY, radius, terrain) {
  for (let x = Math.min(fromX, toX); x <= Math.max(fromX, toX); x++) {
    for (let y = centerY - radius; y <= centerY + radius; y++) setTile(tiles, width, { x, y }, terrain);
  }
}
function createM47CertificationCourse(holeCount = 18) {
  const width = 84;
  const height = holeCount * 3 + 8;
  const tiles = Array.from({ length: width * height }, () => "rough");
  const elevations = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return Math.max(0, Math.min(4, Math.round(1 + Math.sin(x / 11) + Math.cos(y / 9))));
  });
  const holes = [];
  for (let index = 0; index < holeCount; index++) {
    const y = 4 + index * 3;
    const leftToRight = index % 2 === 0;
    const tee2 = { x: leftToRight ? 7 : 76, y };
    const green2 = { x: leftToRight ? 76 : 7, y };
    const direction = leftToRight ? 1 : -1;
    setRect(tiles, width, tee2.x, green2.x, y, 2, "fairway");
    setTile(tiles, width, tee2, "tee");
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) setTile(tiles, width, { x: green2.x + dx, y: green2.y + dy }, "green");
    const hazardX = Math.round((tee2.x + green2.x) / 2);
    for (let x = hazardX; x !== hazardX + direction * 3; x += direction) {
      for (let dy = -1; dy <= 1; dy++) setTile(tiles, width, { x, y: y + dy }, "water");
      setTile(tiles, width, { x, y: y - 2 }, "fairway");
      setTile(tiles, width, { x, y: y + 2 }, "fairway");
    }
    const waypoint = { x: hazardX - direction * 4, y: y + 2 };
    setTile(tiles, width, waypoint, "fairway");
    setTile(tiles, width, { x: waypoint.x + direction, y: waypoint.y }, "fairway");
    holes.push({
      id: `m47-hole-${index + 1}`,
      name: `M47 Decision ${index + 1}`,
      tee: tee2,
      green: green2,
      waypoints: [waypoint],
      parMode: "MANUAL",
      parManual: index % 6 === 0 ? 5 : index % 4 === 0 ? 3 : 4,
      holeIndex: index + 1
    });
  }
  return {
    width,
    height,
    tiles,
    elevations,
    holes,
    obstacles: [],
    buildings: [
      { id: "m47-clubhouse", type: "clubhouse", x: 2, y: Math.max(1, Math.floor(height / 2) - 2) },
      { id: "m47-pro-shop", type: "pro_shop", x: 5, y: Math.max(1, Math.floor(height / 2) - 2), tier: 3, price: 40 },
      { id: "m47-snack-bar", type: "snack_bar", x: 10, y: Math.max(1, Math.floor(height / 2) + 2), tier: 3, price: 15 },
      { id: "m47-cart-rental", type: "cart_rental", x: 15, y: Math.max(1, Math.floor(height / 2) + 2), tier: 2, price: 30 }
    ],
    yardsPerTile: 10,
    name: `M47 ${holeCount}-Hole Certification Course`,
    baseGreenFee: 125,
    condition: 0.92,
    theme: "parkland"
  };
}
function createM47TournamentCourse() {
  const standards = createTournamentStandardsCourse();
  const holes = standards.holes.map((hole, index) => {
    const tee2 = hole.tee;
    const green2 = hole.green;
    const direction = green2.x > tee2.x ? 1 : -1;
    const forward = hole.teeBoxes?.forward ?? { x: tee2.x + direction * 1, y: tee2.y };
    const championship = hole.teeBoxes?.championship ?? { x: tee2.x - direction * 1, y: tee2.y };
    const pinB = hole.pinPositions?.B ?? { x: green2.x, y: green2.y + (index % 2 ? 1 : -1) };
    const pinC = hole.pinPositions?.C ?? { x: green2.x - direction, y: green2.y };
    return {
      ...hole,
      id: `m47-tournament-hole-${index + 1}`,
      teeBoxes: { forward, member: tee2, championship },
      pinPositions: { A: green2, B: pinB, C: pinC },
      parByTee: { forward: { mode: "MANUAL", par: hole.parManual }, member: { mode: "MANUAL", par: hole.parManual }, championship: { mode: "MANUAL", par: hole.parManual } }
    };
  });
  const ids = holes.map((hole) => hole.id);
  return {
    ...standards,
    name: "M47 Tournament Certification Course",
    holes,
    layouts: [{ id: "m47-tournament", name: "M47 Tournament Course", draftHoleIds: ids, publishedHoleIds: ids, roundLength: 18, state: "open", greenFee: standards.baseGreenFee }],
    activeCourseId: "m47-tournament",
    activePinRotation: "B"
  };
}
function createM47StrategyMatrixCourse() {
  const width = 56;
  const height = 26;
  const tiles = Array.from({ length: width * height }, () => "fairway");
  const tee2 = { x: 4, y: 13 };
  const green2 = { x: 48, y: 13 };
  tiles[tee2.y * width + tee2.x] = "tee";
  for (let y = green2.y - 1; y <= green2.y + 1; y++) for (let x = green2.x - 1; x <= green2.x + 1; x++) tiles[y * width + x] = "green";
  for (let y = 2; y < height - 2; y++) tiles[y * width + 26] = y === 5 || y === 20 ? "fairway" : "water";
  return {
    name: "M47 Strategy Matrix Crossroads",
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{ id: "m47-matrix-hole", tee: tee2, green: green2, parMode: "MANUAL", parManual: 4, name: "The Five-Way Decision" }],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 65,
    condition: 0.8,
    theme: "parkland"
  };
}
function buildM47RoundResult(holeCount, golfer2) {
  const course = createM47CertificationCourse(holeCount);
  const capabilities = createGolferCapabilities({ personality: golfer2.personality, seed: golfer2.seed });
  const round2 = buildStrategicGolferRound({
    course,
    entry: entryPoint(course),
    exit: entryPoint(course),
    rng: mulberry32(golfer2.seed ^ holeCount),
    personality: golfer2.personality,
    capabilities,
    wallet: 250,
    skipPreRoundPurchases: true
  });
  return {
    golfer: golfer2,
    course,
    capabilities,
    plans: round2.holePlans ?? [],
    outcomes: round2.shotOutcomes ?? [],
    reactions: round2.holeReactions ?? [],
    holePar: round2.holePar,
    holeStrokes: round2.holeStrokes
  };
}
function buildM47StrategyMatrix() {
  const course = createM47StrategyMatrixCourse();
  const hole = course.holes[0];
  return M47_REFERENCE_GOLFERS.map((golfer2) => {
    const capabilities = createGolferCapabilities({ personality: golfer2.personality, seed: golfer2.seed });
    const plan = generateStrategicHolePlan({ course, hole, par: hole.parManual ?? 4, capabilities, personality: golfer2.personality });
    return {
      golferId: golfer2.id,
      riskStyle: capabilities.riskStyle,
      strengths: capabilities.strengths,
      chosen: plan.chosen.kind,
      rejected: plan.rejected.map((alternative) => alternative.kind),
      expectedScore: plan.expectedScore,
      hazardRisk: plan.chosen.hazardRisk
    };
  });
}
function hashM47Round(result) {
  const planHash = hashCanonicalValue({ capabilities: result.capabilities, holePar: result.holePar, plans: result.plans });
  const outcomeHash = hashCanonicalValue({ holeStrokes: result.holeStrokes, outcomes: result.outcomes });
  const reactionHash = hashCanonicalValue(result.reactions);
  const world = { ...DEFAULT_WORLD, runSeed: result.golfer.seed };
  const saveHash = hashGameState({
    course: result.course,
    world,
    live: void 0
  });
  return { planHash, outcomeHash, reactionHash, saveHash };
}
function runM47SaveHashFixture() {
  const course = createM47CertificationCourse(9);
  const world = { ...DEFAULT_WORLD, cash: 1e6, reputation: 95, runSeed: 470909 };
  const live = createLiveState(course, world, 0);
  let guard = 0;
  while (live.golfers.length === 0 && guard++ < 100) stepLive(live, course, 5);
  if (!live.golfers.length) throw new Error("M47 save fixture did not spawn a golfer");
  const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 123, speed: "paused", selectedGolferId: live.golfers[0].id });
  const beforeHash = hashGameState({ course, world, live: snapshot });
  const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot)));
  if (!restored) throw new Error("M47 save fixture did not restore");
  const restoredSnapshot = snapshotLiveSimulation({
    state: restored.state,
    pendingCash: restored.pendingCash,
    speed: restored.speed,
    selectedGolferId: restored.selectedGolferId,
    clockRemainderMinutes: restored.clockRemainderMinutes,
    weekLedger: restored.weekLedger
  });
  return {
    beforeHash,
    afterHash: hashGameState({ course, world, live: restoredSnapshot }),
    saveBytes: new TextEncoder().encode(JSON.stringify(snapshot)).byteLength,
    golferEvidence: {
      plans: live.golfers[0].holePlans?.length ?? 0,
      outcomes: live.golfers[0].shotOutcomes?.length ?? 0,
      reactions: live.golfers[0].holeReactions?.length ?? 0
    }
  };
}
function runM47TournamentFixture() {
  const course = createM47TournamentCourse();
  const baseWorld = { ...DEFAULT_WORLD, cash: 1e6, reputation: 95, runSeed: 470818 };
  const created = createTournamentEvent({ course, world: baseWorld, tier: "regional", currentDay: 0, daysAhead: 1, courseId: "m47-tournament" });
  if (!created.ok) throw new Error(`M47 tournament fixture is ineligible: ${created.reason}`);
  const scheduledWorld = scheduleTournament(baseWorld, created.event);
  const live = createLiveState(course, scheduledWorld, created.event.scheduledDay);
  let guard = 0;
  while (!live.dayOver && guard++ < 2e3) stepLive(live, course, 5);
  if (!live.dayOver) throw new Error("M47 tournament fixture did not terminate");
  const settled = completeTournament(scheduledWorld, live);
  return {
    field: created.event.field.length,
    roundsFinished: live.roundsFinished,
    daySteps: guard,
    allFinished: live.tournament?.standings.every((standing) => standing.finished && standing.holesCompleted === 18) ?? false,
    status: settled.event?.status ?? "missing",
    winner: settled.event?.winnerName ?? null
  };
}
const balanced = M47_REFERENCE_GOLFERS.find((golfer2) => golfer2.id === "balanced");
const rounds = M47_ROUND_LENGTHS.map((holeCount) => {
  const firstResult = buildM47RoundResult(holeCount, balanced);
  const secondResult = buildM47RoundResult(holeCount, balanced);
  const first = hashM47Round(firstResult);
  const second = hashM47Round(secondResult);
  return {
    holeCount,
    deterministic: JSON.stringify(first) === JSON.stringify(second),
    hashes: first,
    planCount: firstResult.plans.length,
    outcomeCount: firstResult.outcomes.length,
    reactionCount: firstResult.reactions.length,
    score: firstResult.holeStrokes.reduce((sum, strokes) => sum + strokes, 0)
  };
});
const matrix = buildM47StrategyMatrix();
const chosenCounts = Object.fromEntries([...new Set(matrix.map((row) => row.chosen))].map((kind) => [kind, matrix.filter((row) => row.chosen === kind).length]));
const saveReload = runM47SaveHashFixture();
const report = {
  ok: rounds.every((round2) => round2.deterministic) && saveReload.beforeHash === saveReload.afterHash,
  referenceGolfers: M47_REFERENCE_GOLFERS.map(({ id, seed }) => ({ id, seed })),
  rounds,
  strategyMatrix: { rows: matrix, chosenCounts },
  saveReload,
  tournament: runM47TournamentFixture()
};
const output = new URL("../artifacts/m47/certification.json", import.meta.url);
mkdirSync(new URL("../artifacts/m47", import.meta.url), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}
`);
console.log(JSON.stringify(report, null, 2));
