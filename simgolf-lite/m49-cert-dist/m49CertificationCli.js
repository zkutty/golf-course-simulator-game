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
function clamp$l(x, a, b) {
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
    const p = clamp$l(w / totalW, 0, 1);
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
function clamp01$7(x) {
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
    const p = clamp01$7((base.utilization - u0) / Math.max(1e-6, 1 - u0)) * BALANCE.shots.water.shortMissMaxProb;
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
function clamp$k(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function key(p) {
  return p.y * 1e4 + p.x;
}
function tileAt$1(course, p) {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return "rough";
  return course.tiles[p.y * course.width + p.x];
}
function inBounds$5(course, p) {
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
  if (!inBounds$5(course, tee2) || !inBounds$5(course, green2)) {
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
        const dTiles = clamp$k(Math.round(maxTiles * frac), 1, maxTiles);
        for (const [ax, ay] of ANGLES_8) {
          const to = { x: from.x + ax * dTiles, y: from.y + ay * dTiles };
          if (!inBounds$5(course, to)) continue;
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
function clamp$j(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function dist$1(a, b) {
  return computeHoleDistanceTiles(a, b);
}
function deriveAutoParFromShots(shotsToGreen) {
  const p = Math.round(shotsToGreen + 2);
  return clamp$j(p, 3, 5);
}
function inBounds$4(course, p) {
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
  if (!inBounds$4(course, tee2)) issues.push("Tee is out of bounds");
  if (!inBounds$4(course, green2)) issues.push("Green is out of bounds");
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
  const teeTile = inBounds$4(course, tee2) ? tileAt(course, tee2) : "rough";
  const greenTile = inBounds$4(course, green2) ? tileAt(course, green2) : "rough";
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
          if (!inBounds$4(course, q)) continue;
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
  playabilityScore = clamp$j(playabilityScore, 0, 100);
  const distNorm = clamp$j(effectiveDistance / 40, 0, 1);
  const shotsNorm = reachable ? clamp$j((scratchShotsToGreen - 2) / 3, 0, 1) : 1;
  let difficultyScore = 20 + 65 * (0.85 * waterFrac + 0.55 * sandFrac + 0.38 * wasteFrac + 0.25 * roughFrac + 0.45 * deepRoughFrac) + 28 * distNorm + 38 * shotsNorm;
  if (teeTile === "water" || teeTile === "wetland" || teeTile === "sand") difficultyScore += 10;
  if (greenTile === "water" || greenTile === "wetland" || greenTile === "sand") difficultyScore += 10;
  difficultyScore += 12 * obstacleStats.treeOnLine;
  difficultyScore += 6 * obstacleStats.bushOnLine;
  difficultyScore += 6 * obstacleStats.treeNear;
  difficultyScore += 3 * obstacleStats.bushNear;
  difficultyScore = clamp$j(difficultyScore, 0, 100);
  let aestheticsScore = 55 + 75 * (nearWaterFrac + 0.6 * nearSandFrac + 0.35 * nearWasteFrac) - 120 * (waterFrac + 0.6 * sandFrac + 0.25 * wasteFrac);
  aestheticsScore += 10 * clamp$j(nearWaterFrac, 0, 0.12) / 0.12;
  aestheticsScore -= 35 * clamp$j(nearDeepRoughFrac - 0.12, 0, 1);
  aestheticsScore += 4 * obstacleStats.treeScenic + 3 * obstacleStats.bushScenic;
  aestheticsScore += 1 * obstacleStats.treeOff + 0.5 * obstacleStats.bushOff;
  aestheticsScore -= 12 * obstacleStats.treeOnLine + 6 * obstacleStats.bushOnLine;
  const obstacleTotal = obstacleStats.total;
  if (obstacleTotal > 22) aestheticsScore -= 2 * (obstacleTotal - 22);
  aestheticsScore = clamp$j(aestheticsScore, 0, 100);
  let overallHoleScore = 0.6 * playabilityScore + 0.25 * aestheticsScore + 0.15 * (100 - difficultyScore);
  overallHoleScore -= 30 * clamp$j(onHazardFrac - 0.25, 0, 1);
  overallHoleScore -= 18 * clamp$j(onBadLieFrac - 0.55, 0, 1);
  overallHoleScore = clamp$j(overallHoleScore, 0, 100);
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
  const variety = clamp$j(20 + 40 * distinctPars, 0, 100);
  const total = course.tiles.length || 1;
  const pathFrac = course.tiles.filter((t) => t === "path").length / total;
  const waterFrac = course.tiles.filter((t) => t === "water").length / total;
  const deepRoughFrac = course.tiles.filter((t) => t === "deep_rough").length / total;
  const obstacleFrac = (course.obstacles?.length ?? 0) / total;
  const deepRoughPenalty = 12 * clamp$j(deepRoughFrac - 0.28, 0, 1);
  const obstaclePenalty = 10 * clamp$j(obstacleFrac - 0.06, 0, 1);
  const globalBonus = clamp$j(
    8 * pathFrac - 6 * Math.max(0, waterFrac - 0.08) - deepRoughPenalty - obstaclePenalty,
    -10,
    10
  );
  const courseQuality = clamp$j(holeQualityAvg + globalBonus + 0.15 * (variety - 70), 0, 100);
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
function courseLayouts(course) {
  return normalizeCourseLayouts(course).layouts;
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
function inBounds$3(course, x, y) {
  return x >= 0 && y >= 0 && x < course.width && y < course.height;
}
function walkable(course, x, y, bridges, blocked) {
  if (!inBounds$3(course, x, y)) return false;
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
const clamp$i = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const clamp01$6 = (value) => Math.max(0, Math.min(1, value));
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
  const skill = clamp01$6(p.skill);
  const consistency = clamp01$6(p.consistency);
  const jittered = (base, salt, spread = 5) => clamp$i(base + jitter(seed, salt) * spread);
  const riskTolerance = clamp01$6(0.5 + p.prefs.difficulty * 0.36 + (skill - 0.5) * 0.18 + jitter(seed, 11) * 0.04);
  const challengeSeeking = clamp01$6(0.5 + p.prefs.difficulty * 0.5 + jitter(seed, 13) * 0.08);
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
    sceneryAffinity: clamp01$6((p.prefs.scenery + 1) / 2),
    valueSensitivity: clamp01$6((1 - p.prefs.price) / 2),
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
  const riskTolerance = clamp01$6(number("riskTolerance", fallback.riskTolerance));
  const riskStyle = candidate.riskStyle === "aggressive" || candidate.riskStyle === "conservative" || candidate.riskStyle === "balanced" ? candidate.riskStyle : styleFor(riskTolerance);
  return {
    version: 1,
    seed: Math.max(0, Math.floor(number("seed", fallback.seed))) >>> 0,
    power: clamp$i(number("power", fallback.power)),
    accuracy: clamp$i(number("accuracy", fallback.accuracy)),
    irons: clamp$i(number("irons", fallback.irons)),
    shortGame: clamp$i(number("shortGame", fallback.shortGame)),
    recovery: clamp$i(number("recovery", fallback.recovery)),
    consistency: clamp$i(number("consistency", fallback.consistency)),
    riskTolerance,
    challengeSeeking: clamp01$6(number("challengeSeeking", fallback.challengeSeeking)),
    sceneryAffinity: clamp01$6(number("sceneryAffinity", fallback.sceneryAffinity)),
    valueSensitivity: clamp01$6(number("valueSensitivity", fallback.valueSensitivity)),
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
function clamp$h(x, a, b) {
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
  const distFactor = clamp$h(distanceYards / 480, 0.3, 1.4);
  const hazard = profile.ratingMultipliers.hazard * (2.2 * waterFrac + 0.9 * sandFrac + 0.62 * wasteFrac);
  const lie = profile.ratingMultipliers.rough * (0.9 * roughFrac) + profile.ratingMultipliers.deepRough * (1.2 * deepRoughFrac);
  const obst = profile.ratingMultipliers.obstacle * obstaclePenalty;
  const raw = distFactor * (hazard + lie + obst);
  return clamp$h(raw * 1.4, 0, 2.5);
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
  const obstaclePenalty = clamp$h((h.difficultyScore - 45) / 100, 0, 1);
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
function inBounds$2(course, point2) {
  return point2.x >= 0 && point2.y >= 0 && point2.x < course.width && point2.y < course.height;
}
function pinDifficultyPenalty(course, pin) {
  if (!pin || !inBounds$2(course, pin)) return 0;
  const cfg = BALANCE.courseSetup.pinDifficulty;
  let nearestNonGreen = cfg.edgeRadiusTiles;
  let adjacentHazards = 0;
  let elevationChange = 0;
  const pinElevation = course.elevations[pin.y * course.width + pin.x] ?? 0;
  for (let dy = -cfg.edgeRadiusTiles; dy <= cfg.edgeRadiusTiles; dy++) {
    for (let dx = -cfg.edgeRadiusTiles; dx <= cfg.edgeRadiusTiles; dx++) {
      if (dx === 0 && dy === 0) continue;
      const point2 = { x: pin.x + dx, y: pin.y + dy };
      if (!inBounds$2(course, point2)) continue;
      const distance2 = Math.hypot(dx, dy);
      const index = point2.y * course.width + point2.x;
      const terrain = course.tiles[index];
      if (terrain !== "green") nearestNonGreen = Math.min(nearestNonGreen, distance2);
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (terrain === "water" || terrain === "wetland" || terrain === "sand")) adjacentHazards++;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) elevationChange = Math.max(elevationChange, Math.abs((course.elevations[index] ?? 0) - pinElevation));
    }
  }
  const edge = clamp$h(1 - nearestNonGreen / cfg.edgeRadiusTiles, 0, 1) * cfg.edgePenaltyMax;
  const hazard = adjacentHazards * cfg.adjacentHazardPenalty;
  const elevation = elevationChange * cfg.elevationPenaltyPerStep;
  return clamp$h(edge + hazard + elevation, 0, cfg.penaltyCap);
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
    slope: Math.round(clamp$h(113 * slopeRaw / 20, 55, 155)),
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
const M49_ECONOMY_VERSION = 1;
const M49_MAX_COURSES = 36;
const M49_MAX_SEGMENT_ROUNDS = 500;
const M49_MAX_HOLE_EVIDENCE = 72;
const M49_SEGMENTS = [
  "pro",
  "lowHandicap",
  "casual",
  "senior",
  "junior",
  "tourist"
];
const clamp$g = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round$6 = (value, digits = 3) => Number(value.toFixed(digits));
const STRATEGIC_COHORT = {
  pro: "power",
  lowHandicap: "accuracy",
  casual: "casual",
  senior: "recovery",
  junior: "shortGame",
  tourist: "casual"
};
const BASE_WILLINGNESS_TO_PAY = {
  pro: 125,
  lowHandicap: 105,
  casual: 58,
  senior: 68,
  junior: 42,
  tourist: 92
};
const BASE_PRICE_ELASTICITY = {
  pro: 0.42,
  lowHandicap: 0.68,
  casual: 1.42,
  senior: 1.08,
  junior: 1.7,
  tourist: 0.86
};
const strategicCache = /* @__PURE__ */ new WeakMap();
function strategicPortfolio(course) {
  const cached = strategicCache.get(course);
  if (cached) return cached;
  const portfolio = buildStrategicPortfolio(course, { samplesPerOption: 1, seed: 494001 });
  strategicCache.set(course, portfolio);
  return portfolio;
}
function strategicFit$1(course, golfer2) {
  const portfolio = strategicPortfolio(course);
  const cohort = STRATEGIC_COHORT[golfer2.archetype];
  const holeIds = new Set(golfer2.holeIds ?? []);
  const holes = portfolio.evaluation.holes.filter((hole) => !holeIds.size || holeIds.has(hole.holeId));
  const fits = holes.map((hole) => hole.cohorts.find((candidate) => candidate.cohortId === cohort)?.viability ?? 0).filter((value) => Number.isFinite(value));
  const localFit = fits.length ? fits.reduce((sum, value) => sum + value, 0) / fits.length / 100 : 0.5;
  const portfolioFit = portfolio.summary.total / 100;
  return clamp$g(localFit * 0.72 + portfolioFit * 0.28);
}
function causeList(golfer2, condition, paceDelayMinutes, hospitalityDelayMinutes) {
  const causes = /* @__PURE__ */ new Set();
  for (const reaction of golfer2.holeReactions ?? []) {
    for (const fact2 of reaction.facts) causes.add(`${fact2.code}:${fact2.detail}`);
    if (reaction.outcome === "unfair") causes.add("hole:forced-mismatch");
    if (reaction.outcome === "frustrated") causes.add("hole:frustration");
  }
  if (condition < 0.55) causes.add("condition:below-55");
  if (paceDelayMinutes >= 12) causes.add("pace:meaningful-delay");
  if (hospitalityDelayMinutes >= 8) causes.add("hospitality:service-delay");
  return [...causes].slice(0, 24);
}
function holeEvidence(golfer2) {
  const holeIds = golfer2.holeIds ?? [];
  const observations = [];
  for (let index = 0; index < Math.min(holeIds.length, golfer2.holeStrokes.length, 72); index++) {
    const reaction = golfer2.holeReactions?.[index];
    observations.push({
      holeId: holeIds[index] ?? `hole-${index + 1}`,
      expectedScore: round$6(golfer2.holePlans?.[index]?.expectedScore ?? (golfer2.holePar[index] ?? 4) + 1, 2),
      actualScore: golfer2.holeStrokes[index] ?? 0,
      satisfaction: round$6(reaction?.satisfaction ?? golfer2.mood * 100, 2),
      outcome: reaction?.outcome ?? "neutral",
      causes: (reaction?.facts ?? []).map((fact2) => `${fact2.code}:${fact2.detail}`).slice(0, 12)
    });
  }
  return observations;
}
function observeM49Round(args) {
  const { golfer: golfer2 } = args;
  const holes = holeEvidence(golfer2);
  const expectedScore = golfer2.holePlans?.length ? golfer2.holePlans.reduce((sum, plan) => sum + plan.expectedScore, 0) : golfer2.holePar.reduce((sum, par) => sum + par + 1, 0);
  const actualScore = golfer2.strokes || golfer2.holeStrokes.slice(0, golfer2.scoredHoles).reduce((sum, score) => sum + score, 0);
  const fit = strategicFit$1(args.course, golfer2);
  const paceDelayMinutes = golfer2.waitMinutes ?? 0;
  const hospitalityDelayMinutes = golfer2.hospitalityDelay ?? 0;
  const paceValue = clamp$g(1 - paceDelayMinutes / 90);
  const hospitalityValue = clamp$g(1 - hospitalityDelayMinutes / 45);
  const satValue = clamp$g(golfer2.mood);
  const priceAnchor = BASE_WILLINGNESS_TO_PAY[golfer2.archetype];
  const pricePressure = Math.max(0, args.greenFee / Math.max(1, priceAnchor) - 0.72);
  const valueReceived = clamp$g(
    satValue * 0.42 + fit * 0.3 + args.condition * 0.14 + paceValue * 0.08 + hospitalityValue * 0.06 - pricePressure * 0.12
  );
  const priceElasticity = BASE_PRICE_ELASTICITY[golfer2.archetype] * (1.22 - valueReceived * 0.42);
  const willingnessToPay = clamp$g(
    priceAnchor * (0.64 + valueReceived * 0.5) * (args.returnIntent ? 1.04 : 0.96) / 150,
    0.18,
    1.5
  ) * 150;
  const causes = causeList(golfer2, args.condition, paceDelayMinutes, hospitalityDelayMinutes);
  if (args.greenFee > willingnessToPay) causes.push("price:above-observed-willingness");
  if (fit < 0.45) causes.push("fit:unsupported-strength");
  return {
    version: 1,
    id: `m49-round-${args.courseId}-${golfer2.id}-${golfer2.currentHoleId ?? "complete"}`,
    courseId: args.courseId,
    segment: golfer2.archetype,
    ...golfer2.tournamentId ? { tournamentId: golfer2.tournamentId } : {},
    completed: args.completed,
    holesPlayed: Math.max(0, golfer2.scoredHoles),
    holesTotal: golfer2.holePar.length,
    expectedScore: round$6(expectedScore, 2),
    actualScore: round$6(actualScore, 2),
    satisfaction: round$6(golfer2.mood * 100, 2),
    condition: round$6(args.condition, 3),
    greenFee: Math.max(0, round$6(args.greenFee, 2)),
    strategicFit: round$6(fit),
    valueReceived: round$6(valueReceived),
    willingnessToPay: round$6(willingnessToPay, 2),
    priceElasticity: round$6(priceElasticity, 3),
    returnIntent: args.returnIntent,
    recommend: args.recommend,
    churnRisk: round$6(clamp$g(1 - valueReceived + (args.completed ? 0 : 0.18) + (paceDelayMinutes > 30 ? 0.12 : 0))),
    paceDelayMinutes: round$6(paceDelayMinutes, 2),
    hospitalityDelayMinutes: round$6(hospitalityDelayMinutes, 2),
    holeEvidence: holes,
    causes: [...new Set(causes)].slice(0, 28)
  };
}
function strategicCohortForSegment(segment2) {
  return STRATEGIC_COHORT[segment2];
}
function baseWillingnessToPay(segment2) {
  return BASE_WILLINGNESS_TO_PAY[segment2];
}
function basePriceElasticity(segment2) {
  return BASE_PRICE_ELASTICITY[segment2];
}
const clamp$f = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
function emptySegment(segment2) {
  return {
    observedRounds: 0,
    completedRounds: 0,
    evidenceWeight: 0,
    averageValue: 0.58,
    averageSatisfaction: 65,
    returnRate: 0.55,
    recommendationRate: 0.5,
    churnRate: 0.45,
    willingnessToPay: baseWillingnessToPay(segment2),
    priceElasticity: basePriceElasticity(segment2),
    lastObservedWeek: 0,
    holeEvidence: {}
  };
}
function emptyM49State() {
  return { version: M49_ECONOMY_VERSION, courses: {}, marketingPromises: [] };
}
function validNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function normalizeSegment(raw, segment2) {
  const base = emptySegment(segment2);
  if (!raw || typeof raw !== "object") return base;
  const candidate = raw;
  const holeEvidence2 = {};
  if (candidate.holeEvidence && typeof candidate.holeEvidence === "object") {
    for (const [holeId, value] of Object.entries(candidate.holeEvidence).slice(0, M49_MAX_HOLE_EVIDENCE)) {
      if (!value || typeof value !== "object") continue;
      const row = value;
      const causes = {};
      if (row.causes && typeof row.causes === "object") {
        for (const [cause, count] of Object.entries(row.causes).slice(0, 24)) {
          if (typeof count === "number" && Number.isFinite(count) && count > 0) causes[cause.slice(0, 80)] = clampInt(count, 0, M49_MAX_SEGMENT_ROUNDS);
        }
      }
      holeEvidence2[holeId.slice(0, 120)] = {
        observations: clampInt(validNumber(row.observations, 0), 0, M49_MAX_SEGMENT_ROUNDS),
        averageSatisfaction: clamp$f(validNumber(row.averageSatisfaction, 65), 0, 100),
        frustrationRate: clamp$f(validNumber(row.frustrationRate, 0.45)),
        causes
      };
    }
  }
  return {
    observedRounds: clampInt(validNumber(candidate.observedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    completedRounds: clampInt(validNumber(candidate.completedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    evidenceWeight: clamp$f(validNumber(candidate.evidenceWeight, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    averageValue: clamp$f(validNumber(candidate.averageValue, base.averageValue)),
    averageSatisfaction: clamp$f(validNumber(candidate.averageSatisfaction, base.averageSatisfaction), 0, 100),
    returnRate: clamp$f(validNumber(candidate.returnRate, base.returnRate)),
    recommendationRate: clamp$f(validNumber(candidate.recommendationRate, base.recommendationRate)),
    churnRate: clamp$f(validNumber(candidate.churnRate, base.churnRate)),
    willingnessToPay: clamp$f(validNumber(candidate.willingnessToPay, base.willingnessToPay), 10, 500),
    priceElasticity: clamp$f(validNumber(candidate.priceElasticity, base.priceElasticity), 0.1, 4),
    lastObservedWeek: clampInt(validNumber(candidate.lastObservedWeek, 0), 0, 1e7),
    holeEvidence: holeEvidence2
  };
}
function normalizeCourse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw;
  const segments = {};
  if (candidate.segments && typeof candidate.segments === "object") {
    for (const segment2 of M49_SEGMENTS) {
      if (candidate.segments[segment2]) segments[segment2] = normalizeSegment(candidate.segments[segment2], segment2);
    }
  }
  return {
    version: M49_ECONOMY_VERSION,
    observedRounds: clampInt(validNumber(candidate.observedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    completedRounds: clampInt(validNumber(candidate.completedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    lastObservedWeek: clampInt(validNumber(candidate.lastObservedWeek, 0), 0, 1e7),
    segments
  };
}
function normalizeM49State(raw) {
  if (!raw || typeof raw !== "object") return emptyM49State();
  const candidate = raw;
  if (candidate.version !== M49_ECONOMY_VERSION || !candidate.courses || typeof candidate.courses !== "object") return emptyM49State();
  const courses = {};
  for (const [courseId, value] of Object.entries(candidate.courses).slice(0, M49_MAX_COURSES)) {
    const normalized = normalizeCourse(value);
    if (normalized) courses[courseId.slice(0, 120)] = normalized;
  }
  const marketingPromises = Array.isArray(candidate.marketingPromises) ? candidate.marketingPromises.filter((promise) => promise && typeof promise.id === "string" && typeof promise.courseId === "string" && typeof promise.segment === "string" && Number.isFinite(promise.reach) && Number.isFinite(promise.cost)).slice(-24).map((promise) => ({
    ...promise,
    reach: clamp$f(validNumber(promise.reach, 0), 0, 1),
    cost: Math.max(0, validNumber(promise.cost, 0)),
    credibility: clamp$f(validNumber(promise.credibility, 0.5)),
    disappointmentRisk: clamp$f(validNumber(promise.disappointmentRisk, 0.5)),
    playedRounds: clampInt(validNumber(promise.playedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS),
    disappointedRounds: clampInt(validNumber(promise.disappointedRounds, 0), 0, M49_MAX_SEGMENT_ROUNDS)
  })) : [];
  return { version: M49_ECONOMY_VERSION, courses, marketingPromises };
}
function m49CourseHistory(world, courseId) {
  return normalizeM49State(world.m49).courses[courseId];
}
function smooth(previous, sample, observations, min = 0, max = 1) {
  const alpha = Math.min(0.34, 1 / Math.max(3, observations + 2));
  return Math.max(min, Math.min(max, previous + (sample - previous) * alpha));
}
function mergeHoleEvidence(history, observation2) {
  const next = { ...history.holeEvidence };
  for (const hole of observation2.holeEvidence.slice(0, M49_MAX_HOLE_EVIDENCE)) {
    if (!next[hole.holeId] && Object.keys(next).length >= M49_MAX_HOLE_EVIDENCE) continue;
    const current = next[hole.holeId] ?? { observations: 0, averageSatisfaction: 65, frustrationRate: 0.45, causes: {} };
    const observations = current.observations + 1;
    const causes = { ...current.causes };
    for (const cause of hole.causes.slice(0, 12)) causes[cause] = Math.min(M49_MAX_SEGMENT_ROUNDS, (causes[cause] ?? 0) + 1);
    next[hole.holeId] = {
      observations: Math.min(M49_MAX_SEGMENT_ROUNDS, observations),
      averageSatisfaction: smooth(current.averageSatisfaction, hole.satisfaction, observations, 0, 100),
      frustrationRate: smooth(current.frustrationRate, hole.outcome === "frustrated" || hole.outcome === "unfair" ? 1 : 0, observations),
      causes
    };
  }
  return next;
}
function mergeObservation(previous, observation2, week) {
  const current = previous ?? emptySegment(observation2.segment);
  const observations = current.observedRounds + 1;
  const completed = current.completedRounds + (observation2.completed ? 1 : 0);
  const weight = Math.min(M49_MAX_SEGMENT_ROUNDS, current.evidenceWeight + (observation2.completed ? 1 : 0.5));
  return {
    ...current,
    observedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, observations),
    completedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, completed),
    evidenceWeight: weight,
    averageValue: smooth(current.averageValue, observation2.valueReceived, observations),
    averageSatisfaction: smooth(current.averageSatisfaction, observation2.satisfaction, observations, 0, 100),
    returnRate: smooth(current.returnRate, observation2.completed && observation2.returnIntent ? 1 : 0, observations),
    recommendationRate: smooth(current.recommendationRate, observation2.completed && observation2.recommend ? 1 : 0, observations),
    churnRate: smooth(current.churnRate, observation2.churnRisk, observations),
    willingnessToPay: smooth(current.willingnessToPay, observation2.willingnessToPay, observations, 10, 500),
    priceElasticity: smooth(current.priceElasticity, observation2.priceElasticity, observations, 0.1, 4),
    lastObservedWeek: Math.max(current.lastObservedWeek, week),
    holeEvidence: mergeHoleEvidence(current, observation2)
  };
}
function recordM49Observations(world, observations, week) {
  if (!observations.length) return world;
  const state = normalizeM49State(world.m49);
  const courses = { ...state.courses };
  for (const observation2 of observations.slice(0, M49_MAX_SEGMENT_ROUNDS)) {
    if (!observation2 || observation2.version !== M49_ECONOMY_VERSION || !observation2.courseId) continue;
    const current = courses[observation2.courseId] ?? { version: M49_ECONOMY_VERSION, observedRounds: 0, completedRounds: 0, lastObservedWeek: 0, segments: {} };
    const segment2 = mergeObservation(current.segments[observation2.segment], observation2, week);
    courses[observation2.courseId] = {
      ...current,
      observedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, current.observedRounds + 1),
      completedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, current.completedRounds + (observation2.completed ? 1 : 0)),
      lastObservedWeek: Math.max(current.lastObservedWeek, week),
      segments: { ...current.segments, [observation2.segment]: segment2 }
    };
  }
  const marketingPromises = (state.marketingPromises ?? []).map((promise) => {
    const matches = observations.filter((observation2) => observation2.courseId === promise.courseId && observation2.segment === promise.segment && week >= promise.createdWeek);
    if (!matches.length) return promise;
    const disappointed = matches.filter((observation2) => !observation2.completed || observation2.valueReceived < 0.55).length;
    return {
      ...promise,
      playedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, promise.playedRounds + matches.length),
      disappointedRounds: Math.min(M49_MAX_SEGMENT_ROUNDS, promise.disappointedRounds + disappointed),
      credibility: clamp$f(promise.credibility - disappointed * 0.035 + (matches.length - disappointed) * 8e-3),
      disappointmentRisk: clamp$f(promise.disappointmentRisk + disappointed * 0.028 - (matches.length - disappointed) * 6e-3)
    };
  });
  return { ...world, m49: { version: M49_ECONOMY_VERSION, courses, marketingPromises } };
}
function m49ReputationDelta(observations) {
  const completed = observations.filter((observation2) => observation2.version === M49_ECONOMY_VERSION && observation2.completed && observation2.holesPlayed > 0);
  if (!completed.length) return { delta: 0, observedRounds: 0 };
  const sentiment = completed.reduce((sum, observation2) => {
    const satisfaction = (observation2.satisfaction - 65) / 35;
    const loyalty = observation2.returnIntent ? 0.18 : -0.18;
    const recommendation = observation2.recommend ? 0.16 : -0.16;
    return sum + clamp$f(satisfaction * 0.68 + loyalty + recommendation - observation2.churnRisk * 0.12, -1, 1);
  }, 0) / completed.length;
  return { delta: Math.max(-2.5, Math.min(2.5, sentiment * 1.8)), observedRounds: completed.length };
}
const clamp$e = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round$5 = (value, digits = 3) => Number(value.toFixed(digits));
function profileSignals(course, world, signals) {
  const summary = scoreCourseHoles(course);
  const portfolio = buildStrategicPortfolio(course, { samplesPerOption: signals.samplesPerOption ?? 4, seed: 494002 });
  return {
    quality: clamp$e(signals.quality ?? summary.courseQuality / 100 * 0.62 + portfolio.summary.total / 100 * 0.38),
    difficulty: clamp$e(signals.difficulty ?? (summary.holes.length ? summary.holes.filter((hole) => hole.isComplete && hole.isValid).reduce((sum, hole) => sum + hole.difficultyScore, 0) / Math.max(1, summary.holes.filter((hole) => hole.isComplete && hole.isValid).length) / 100 : 0.5)),
    scenery: clamp$e(signals.scenery ?? (summary.holes.length ? summary.holes.filter((hole) => hole.isComplete && hole.isValid).reduce((sum, hole) => sum + hole.aestheticsScore, 0) / Math.max(1, summary.holes.filter((hole) => hole.isComplete && hole.isValid).length) / 100 : 0.5)),
    condition: clamp$e(signals.condition ?? course.condition),
    price: clamp$e(signals.price ?? 1),
    marketing: clamp$e(signals.marketing ?? world.marketingLevel / 5),
    staff: clamp$e(signals.staff ?? world.staffLevel / 5),
    reputation: clamp$e(signals.reputation ?? world.reputation / 100),
    portfolio
  };
}
function strategicFit(segment2, portfolio) {
  const cohort = strategicCohortForSegment(segment2);
  const fits = portfolio.evaluation.holes.map((hole) => hole.cohorts.find((candidate) => candidate.cohortId === cohort)?.viability ?? 0).filter((value) => Number.isFinite(value));
  const local = fits.length ? fits.reduce((sum, value) => sum + value, 0) / fits.length / 100 : 0.5;
  return clamp$e(local * 0.72 + portfolio.summary.total / 100 * 0.28);
}
function priceAppeal(price, willingnessToPay, elasticity) {
  const ratio = price / Math.max(1, willingnessToPay);
  const overValue = Math.max(0, ratio - 0.62);
  return clamp$e(Math.exp(-elasticity * overValue * 0.72));
}
function buildM49DemandPlan(course, world, signals = {}) {
  const layout = activeCourseLayout(course);
  const profile = profileSignals(course, world, signals);
  const history = m49CourseHistory(world, layout.id);
  const price = layout.greenFee ?? course.baseGreenFee;
  const marketingPromises = normalizeM49State(world.m49).marketingPromises ?? [];
  const raw = M49_SEGMENTS.map((segment2) => {
    const archetype = ARCHETYPES[segment2];
    const observed = history?.segments[segment2];
    const fit = strategicFit(segment2, profile.portfolio);
    const observedValue = clamp$e(observed?.averageValue ?? fit * 0.62 + profile.condition * 0.38);
    const willingnessToPay = observed?.willingnessToPay ?? baseWillingnessToPay(segment2) * (0.8 + observedValue * 0.24);
    const elasticity = observed?.priceElasticity ?? basePriceElasticity(segment2) * (1.18 - observedValue * 0.3);
    const priceFit = priceAppeal(price, willingnessToPay, elasticity);
    const promise = marketingPromises.filter((candidate) => candidate.courseId === layout.id && candidate.segment === segment2).sort((a, b) => b.createdWeek - a.createdWeek)[0];
    const difficultyTarget = archetype.personality.prefs.difficulty;
    const difficultyFit = clamp$e(1 - Math.abs(difficultyTarget - (profile.difficulty * 2 - 1)) / 2);
    const sceneryFit = clamp$e(0.72 + archetype.personality.prefs.scenery * (profile.scenery - 0.5));
    const prestigeFit = clamp$e(1 - Math.max(0, archetype.personality.skill - profile.reputation) * 1.35);
    const marketingSupport = clamp$e(1 - Math.max(0, profile.marketing - (fit * 0.62 + observedValue * 0.38)) * 0.78);
    const promiseSupport = promise ? clamp$e(promise.credibility * 0.82 + (1 - promise.disappointmentRisk) * 0.18) : 1;
    const bookingAppeal = clamp$e(
      (profile.quality * 0.22 + fit * 0.27 + observedValue * 0.13 + profile.condition * 0.12 + difficultyFit * 0.08 + sceneryFit * 0.05 + prestigeFit * 0.06 + priceFit * 0.07 + profile.staff * 0.03) * marketingSupport * promiseSupport * (1 + profile.marketing * 0.045)
    );
    const confidence = clamp$e((observed?.observedRounds ?? 0) / 18);
    const causes = [
      `fit:${Math.round(fit * 100)}`,
      `value:${Math.round(observedValue * 100)}`,
      `price:${Math.round(priceFit * 100)}`,
      ...marketingSupport < 0.86 ? ["marketing:unsupported-strength"] : [],
      ...promise && promiseSupport < 0.78 ? ["marketing:promise-disappointment"] : [],
      ...observed?.churnRate && observed.churnRate > 0.55 ? ["observed:churn-risk"] : []
    ];
    return {
      segment: segment2,
      strategicCohort: strategicCohortForSegment(segment2),
      share: 0,
      bookingAppeal: round$5(bookingAppeal),
      willingnessToPay: round$5(willingnessToPay, 2),
      priceElasticity: round$5(elasticity),
      strategicFit: round$5(fit),
      observedValue: round$5(observedValue),
      confidence: round$5(confidence),
      returnRate: round$5(observed?.returnRate ?? 0.55),
      churnRate: round$5(observed?.churnRate ?? 1 - observedValue),
      evidenceRounds: observed?.observedRounds ?? 0,
      evidenceLabel: observed ? "mixed" : "predicted",
      causes
    };
  });
  const weightedTotal = raw.reduce((sum, item) => sum + item.bookingAppeal * ARCHETYPES[item.segment].weight, 0);
  const segments = Object.fromEntries(raw.map((item) => [
    item.segment,
    { ...item, share: round$5(item.bookingAppeal * ARCHETYPES[item.segment].weight / Math.max(1e-4, weightedTotal)) }
  ]));
  const rows = Object.values(segments);
  const totalIndex = clamp$e(rows.reduce((sum, item) => sum + item.bookingAppeal * item.share, 0) * 1.2, 0, 1.2);
  const supportedSegments = rows.filter((item) => item.strategicFit >= 0.52 || item.observedValue >= 0.62).map((item) => item.segment);
  const broadAppeal = clamp$e(rows.filter((item) => item.bookingAppeal >= 0.58).length / M49_SEGMENTS.length);
  const nicheIdentity = clamp$e(Math.max(...rows.map((item) => item.bookingAppeal), 0) - broadAppeal * 0.45);
  return {
    version: M49_ECONOMY_VERSION,
    courseId: layout.id,
    totalIndex: round$5(totalIndex),
    broadAppeal: round$5(broadAppeal),
    nicheIdentity: round$5(nicheIdentity),
    supportedSegments,
    segments,
    evidenceRounds: rows.reduce((sum, item) => sum + item.evidenceRounds, 0)
  };
}
const clamp$d = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round$4 = (value, digits = 3) => Number(value.toFixed(digits));
const AMENITY_NEEDS = {
  pro: ["practice_bays", "short_game_area", "event_space", "pro_shop"],
  lowHandicap: ["practice_bays", "putting_green", "short_game_area", "pro_shop"],
  casual: ["parking", "clubhouse", "restaurant", "snack_bar"],
  senior: ["parking", "clubhouse", "restaurant", "locker_room", "shuttle"],
  junior: ["practice_bays", "short_game_area", "putting_green", "clubhouse"],
  tourist: ["hotel", "lodge", "cottages", "restaurant", "spa", "shuttle"]
};
const CHARTER_TARGET = {
  "public-gem": "casual",
  "championship-venue": "pro",
  "destination-retreat": "tourist",
  "member-institution": "lowHandicap"
};
function amenitySupport(course, segment2) {
  const available = new Set((course.property?.assets ?? []).filter((asset) => asset.enabled && asset.condition > 0.35).map((asset) => asset.kind));
  const needs = AMENITY_NEEDS[segment2];
  const supportedBy = needs.filter((need) => available.has(need));
  return {
    segment: segment2,
    score: round$4(clamp$d(supportedBy.length / Math.max(1, Math.min(4, needs.length)))),
    supportedBy,
    missing: needs.filter((need) => !available.has(need)).slice(0, 4)
  };
}
function strategicIdentity(course, world) {
  const plan = buildM49DemandPlan(course, world, { samplesPerOption: 1 });
  const amenities = Object.fromEntries(Object.keys(AMENITY_NEEDS).map((segment2) => [segment2, amenitySupport(course, segment2)]));
  const charter = world.seasonal?.charter ?? "public-gem";
  const charterTarget = CHARTER_TARGET[charter] ?? "casual";
  const charterFit = plan.segments[charterTarget].bookingAppeal;
  const segmentAppeal = (segment2) => plan.segments[segment2].bookingAppeal * 0.72 + amenities[segment2].score * 100 * 0.28;
  const tournamentFieldFit = {
    local: round$4((segmentAppeal("casual") + segmentAppeal("senior")) / 200),
    regional: round$4((segmentAppeal("lowHandicap") + segmentAppeal("pro") + segmentAppeal("casual")) / 300),
    championship: round$4((segmentAppeal("pro") + segmentAppeal("lowHandicap")) / 200)
  };
  const strengths = Object.keys(plan.segments).sort((a, b) => plan.segments[b].bookingAppeal - plan.segments[a].bookingAppeal || a.localeCompare(b)).slice(0, 3).map((segment2) => `${segment2}:${Math.round(plan.segments[segment2].bookingAppeal * 100)}`);
  const tags = [
    ...plan.broadAppeal >= 0.62 ? ["broad-welcome"] : [],
    ...plan.nicheIdentity >= 0.18 ? ["coherent-niche"] : [],
    ...plan.supportedSegments.slice(0, 4).map((segment2) => `supports-${segment2}`),
    ...tournamentFieldFit.championship >= 0.62 ? ["championship-ready"] : [],
    ...charterFit >= 0.58 ? [`charter-${charter}`] : ["charter-mismatch"]
  ];
  return {
    courseId: plan.courseId,
    strategicScore: round$4(plan.totalIndex * 100),
    broadAppeal: plan.broadAppeal,
    nicheIdentity: plan.nicheIdentity,
    supportedSegments: plan.supportedSegments,
    strengths,
    tags: [...new Set(tags)],
    amenities,
    tournamentFieldFit,
    charterFit: round$4(charterFit)
  };
}
function launchM49Marketing(args) {
  const plan = buildM49DemandPlan(args.course, args.world);
  const identity = strategicIdentity(args.course, args.world);
  const row = plan.segments[args.segment];
  const claimSupported = identity.strengths.some((strength) => strength.endsWith(`:${args.strength}`)) || args.strength === args.segment;
  const reach = clamp$d(0.18 + args.world.marketingLevel / 5 * 0.5 + row.bookingAppeal * 0.34);
  const cost = Math.round(180 + reach * 520 + (claimSupported ? 0 : 160));
  if (args.world.cash < cost) return { ok: false, world: args.world, reason: `Marketing needs $${cost.toLocaleString("en-US")}.` };
  const credibility = clamp$d(row.strategicFit * 0.58 + row.observedValue * 0.42 - (claimSupported ? 0 : 0.24));
  const promise = {
    id: `m49-campaign-${args.world.runSeed}-${args.world.week}-${args.segment}-${args.strength}`,
    courseId: plan.courseId,
    segment: args.segment,
    strength: args.strength,
    reach: round$4(reach),
    cost,
    credibility: round$4(credibility),
    disappointmentRisk: round$4(clamp$d(1 - credibility + (claimSupported ? 0 : 0.18))),
    createdWeek: args.world.week,
    playedRounds: 0,
    disappointedRounds: 0
  };
  const m49 = normalizeM49State(args.world.m49);
  return {
    ok: true,
    world: {
      ...args.world,
      cash: args.world.cash - cost,
      m49: {
        ...m49,
        marketingPromises: [...m49.marketingPromises ?? [], promise].slice(-24)
      }
    },
    promise
  };
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
const EMPTY_CALENDAR = { version: 2, events: [] };
function tournamentCalendar(world) {
  return world.tournaments ?? EMPTY_CALENDAR;
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
function normalizeTournamentCalendar(raw, course) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.events)) return { version: 2, events: [] };
  const events = raw.events.filter((event2) => {
    if (!event2 || typeof event2 !== "object") return false;
    return typeof event2.id === "string" && typeof event2.name === "string" && (event2.tier === "local" || event2.tier === "regional" || event2.tier === "championship") && (event2.status === "scheduled" || event2.status === "completed" || event2.status === "cancelled") && Number.isFinite(event2.scheduledWeek) && Number.isFinite(event2.scheduledDay) && Number.isFinite(event2.bookingCost) && Number.isFinite(event2.revenueAward) && Number.isFinite(event2.reputationAward) && event2.scheduledWeek >= 1 && event2.scheduledDay >= 0 && event2.scheduledDay <= 6 && Array.isArray(event2.field) && event2.field.length > 0 && event2.field.length <= 64 && event2.field.every((entrant) => entrant && typeof entrant.id === "string" && typeof entrant.name === "string" && typeof entrant.archetype === "string" && Number.isFinite(entrant.skill)) && (event2.results == null || Array.isArray(event2.results) && event2.results.length <= 64 && event2.results.every(
      (row) => row && typeof row.entrantId === "string" && typeof row.name === "string" && typeof row.archetype === "string" && (row.golferId === null || Number.isInteger(row.golferId)) && Number.isFinite(row.holesCompleted) && Number.isFinite(row.score) && Number.isFinite(row.scoreToPar) && typeof row.finished === "boolean"
    ));
  }).slice(-24);
  if (!course) return { version: 2, events };
  const starter = activeCourseLayout(course);
  return { version: 2, events: events.map((event2) => ({
    ...event2,
    courseId: event2.courseId ?? starter.id,
    courseName: event2.courseName ?? starter.name,
    holeIds: event2.holeIds?.length ? event2.holeIds : courseForLayout(course, event2.courseId ?? starter.id).holes.map((hole) => hole.id).filter(Boolean)
  })) };
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
    const tier = clamp$c(Math.floor(asset.tier), 1, assetSpec.maxTier);
    const surface = assetSpec.category === "access" && asset.kind !== "valet" ? SURFACE_ORDER.includes(asset.surface) ? asset.surface : SURFACE_ORDER[Math.min(SURFACE_ORDER.length - 1, tier - 1)] : void 0;
    const openHour = clamp$c(Math.floor(asset.openHour ?? 7), 5, 20);
    const closeHour = clamp$c(Math.max(openHour + 4, Math.floor(asset.closeHour ?? 20)), 8, 24);
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
      condition: clamp$c(Number.isFinite(asset.condition) ? asset.condition : 1, 0, 1),
      price: Math.max(0, Number.isFinite(asset.price) ? Math.round(asset.price) : assetSpec.basePrice),
      ...asset.kind === "clubhouse" ? { modules: Array.isArray(asset.modules) ? asset.modules.filter((module) => module && module.kind in FACILITY_MODULE_SPECS).map((module) => ({
        kind: module.kind,
        tier: clamp$c(Math.floor(module.tier || 1), 1, 4),
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
      exposureLimit: clamp$c(Number.isFinite(rawPolicy?.exposureLimit) ? rawPolicy.exposureLimit : 70, 20, 90)
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
  const staff = (value) => Number.isFinite(value) ? clamp$c(Math.floor(value), 0, 8) : 0;
  const count = (value, max = 1e3) => Number.isFinite(value) ? clamp$c(Math.floor(value), 0, max) : 0;
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
      phaseNumber: clamp$c(Math.floor(item.phaseNumber || 1), 1, 12),
      unitIds: Array.isArray(item.unitIds) ? [...new Set(item.unitIds.filter((id) => typeof id === "string"))] : [],
      approvedWeek: Math.max(0, Math.floor(item.approvedWeek || 0)),
      constructionDaysRemaining: clamp$c(Math.floor(item.constructionDaysRemaining || 0), 0, 365),
      releaseDaysRemaining: clamp$c(Math.floor(item.releaseDaysRemaining || 0), 0, 90),
      developmentCost: Math.max(0, Math.round(item.developmentCost || 0)),
      playerCapital: Math.max(0, Math.round(item.playerCapital || 0)),
      partnerShare: clamp$c(item.partnerShare || 0, 0, 0.8),
      projectedValueLow: Math.max(0, Math.round(item.projectedValueLow || 0)),
      projectedValueHigh: Math.max(0, Math.round(item.projectedValueHigh || 0)),
      safetyAtApproval: clamp$c(item.safetyAtApproval || 0, 0, 100),
      disclosedRisk: item.disclosedRisk === true,
      publicRoadConnected: item.publicRoadConnected !== false,
      emergencyAccess: item.emergencyAccess !== false,
      utilitiesEligible: item.utilitiesEligible !== false,
      parkingSpaces: Math.max(0, Math.floor(item.parkingSpaces || 0)),
      commonUpkeepDaily: Math.max(0, Math.round(item.commonUpkeepDaily || 0)),
      taxRate: clamp$c(item.taxRate || 0.012, 0, 0.05),
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
      units: clamp$c(Math.floor(item.units || 0), 0, 720),
      occupied: clamp$c(Math.floor(item.occupied || 0), 0, Math.max(0, Math.floor(item.units || 0))),
      satisfaction: clamp$c(item.satisfaction || 0, 0, 100),
      complaints: clamp$c(Math.floor(item.complaints || 0), 0, 999),
      unitIds: Array.isArray(item.unitIds) ? [...new Set(item.unitIds.filter((id) => typeof id === "string"))].slice(0, 80) : [],
      customerIds: Array.isArray(item.customerIds) ? [...new Set(item.customerIds.filter((id) => typeof id === "string"))].slice(0, 8) : [],
      archetype: archetypes.has(item.archetype ?? "non_golfer") ? item.archetype : "non_golfer",
      golfInterest: clamp$c(item.golfInterest ?? 35, 0, 100),
      riskTolerance: clamp$c(item.riskTolerance ?? 45, 0, 100),
      serviceExpectation: clamp$c(item.serviceExpectation ?? 60, 0, 100),
      advocacy: clamp$c(item.advocacy ?? 0, -100, 100),
      opposition: clamp$c(item.opposition ?? 0, 0, 100),
      localSpend: Math.max(0, item.localSpend ?? 0),
      membershipPropensity: clamp$c(item.membershipPropensity ?? 25, 0, 100)
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
    day: clamp$c(Math.floor(item.day || 0), 0, 6),
    severity: clamp$c(Math.floor(item.severity || 1), 1, 5),
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
      severity: clamp$c(Math.floor(item.severity || 1), 1, 5),
      recurrence: clamp$c(Math.floor(item.recurrence || 1), 1, 99),
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
    riskMultiplier: clamp$c(item.riskMultiplier ?? defaults.riskMultiplier, 0.5, 6),
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
    const checkInDay = clamp$c(Math.floor(reservation.checkInDay ?? 0), 0, 6);
    const nights = clamp$c(Math.floor(reservation.nights), 1, 14);
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
        quantity: clamp$c(Math.floor(entitlement.quantity ?? 1), 1, 16),
        scheduledWeek: Math.max(0, Math.floor(entitlement.scheduledWeek ?? checkInWeek)),
        scheduledDay: clamp$c(Math.floor(entitlement.scheduledDay ?? checkInDay), 0, 6),
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
      partySize: clamp$c(Math.floor(reservation.partySize ?? 1), 1, 16),
      roomCount: clamp$c(Math.floor(reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)), 1, 64),
      companionCount: clamp$c(Math.floor(reservation.companionCount ?? 0), 0, 12),
      checkInWeek,
      checkInDay,
      checkOutWeek: Math.max(checkInWeek, Math.floor(reservation.checkOutWeek ?? checkout.week)),
      checkOutDay: clamp$c(Math.floor(reservation.checkOutDay ?? checkout.day), 0, 6),
      deposit: Math.max(0, Math.round(reservation.deposit ?? 0)),
      refund: Math.max(0, Math.round(reservation.refund ?? 0)),
      status: validStatuses.has(reservation.status ?? "booked") ? reservation.status ?? "booked" : "booked",
      roomClass: validRoomClasses.has(reservation.roomClass ?? "standard") ? reservation.roomClass ?? "standard" : "standard",
      transportMode: reservation.transportMode ?? "self_drive",
      vehicleCount: clamp$c(Math.floor(reservation.vehicleCount ?? Math.ceil((reservation.partySize ?? 1) / 3)), 0, 6),
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
    skill: clamp$c(customer.skill, 0, 100),
    loyalty: clamp$c(customer.loyalty, 0, 100),
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
function clamp$c(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function assetOf(course, kind) {
  return normalizePropertyCourse(course.property).assets.find((asset) => asset.kind === kind && isOperational(asset));
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
  return clamp$c(propertyAccessCapacity(course, world) / plannedGolfers, 0.55, 1.15);
}
function surfaceLevel(surface) {
  return Math.max(1, SURFACE_ORDER.indexOf(surface ?? "grass") + 1);
}
function isOperational(asset) {
  return asset.enabled && (asset.constructionDaysRemaining ?? 0) <= 0;
}
function operatingHoursFactor(asset) {
  return clamp$c(((asset.closeHour ?? 20) - (asset.openHour ?? 7)) / 13, 0.25, 1.25);
}
function upkeepCostFactor(policy) {
  return policy === "lean" ? 0.65 : policy === "premium" ? 1.55 : 1;
}
function hasFacilityCapability(course, standalone, module) {
  const property = normalizePropertyCourse(course.property);
  return property.assets.some((asset) => isOperational(asset) && (asset.kind === standalone || asset.kind === "clubhouse" && asset.modules?.some((candidate) => candidate.kind === module && candidate.enabled)));
}
function roomClassFor(asset) {
  if (asset.kind === "cottages") return "villa";
  if (asset.kind === "hotel" && asset.tier >= 3) return "suite";
  if (asset.tier >= 2) return "deluxe";
  return "standard";
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
function analyzeResidentialSafety(course, assetId) {
  const property = normalizePropertyCourse(course.property);
  const assets = property.assets;
  const residential = assets.filter((asset) => (asset.kind === "houses" || asset.kind === "condos") && true);
  if (residential.length === 0) return { score: 0, eligibility: "safe", expectedExposure: 0, outlierExposure: 0, mitigation: 0, contributions: [], heatmap: [], measuredSetback: Number.POSITIVE_INFINITY, blockingReasons: [] };
  const safetyAssets = assets.filter((asset) => asset.enabled && asset.category === "safety");
  const contributionMap = /* @__PURE__ */ new Map();
  const heatmap = [];
  let expectedExposure = 0;
  let outlierExposure = 0;
  let mitigation = 0;
  let measuredSetback = Number.POSITIVE_INFINITY;
  for (const homes of residential) {
    const target = { x: homes.x + homes.width / 2, y: homes.y + homes.height / 2 };
    const unitFactor = Math.sqrt(Math.max(1, homes.units ?? 1)) / 4;
    for (const [index, hole] of course.holes.entries()) {
      if (!hole.tee || !hole.green) continue;
      const key2 = hole.id ?? `hole-${index + 1}`;
      if (property.safetyPolicy.closedHoleIds.includes(key2)) continue;
      const teeEntries = Object.entries(hole.teeBoxes ?? {}).filter(([teeSet, tee2]) => !!tee2 && !property.safetyPolicy.restrictedTeeSets.includes(teeSet));
      if (teeEntries.length === 0) teeEntries.push(["member", hole.tee]);
      let holeDistance = Number.POSITIVE_INFINITY;
      let holeExpected = 0;
      let holeOutlier = 0;
      for (const [teeSet, rawTee] of teeEntries) {
        const tee2 = rawTee ?? hole.tee;
        const dx = hole.green.x - tee2.x;
        const dy = hole.green.y - tee2.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / length, y: dx / length };
        const firstLanding = { x: tee2.x + dx * 0.58, y: tee2.y + dy * 0.58 };
        const recovery = { x: firstLanding.x + normal.x * 3, y: firstLanding.y + normal.y * 3 };
        const segments = [
          [tee2, firstLanding, 1],
          [firstLanding, hole.green, 0.82],
          [recovery, hole.green, 0.48]
        ];
        const teeWidth = teeSet === "championship" ? 1.12 : teeSet === "forward" ? 0.88 : 1;
        for (const [from, to, segmentWeight] of segments) {
          const distance2 = pointSegmentDistance(target, from, to);
          holeDistance = Math.min(holeDistance, distance2);
          measuredSetback = Math.min(measuredSetback, distance2);
          const expected = (distance2 < 4 ? 38 : distance2 < 8 ? 23 : distance2 < 14 ? 9 : distance2 < 22 ? 2.5 : 0) * teeWidth * segmentWeight / teeEntries.length;
          const outlier = (distance2 < 10 ? 17 : distance2 < 18 ? 9 : distance2 < 30 ? 3.5 : 0) * teeWidth * segmentWeight / teeEntries.length;
          holeExpected += expected;
          holeOutlier += outlier;
        }
      }
      if (holeExpected + holeOutlier <= 0) continue;
      const previous = contributionMap.get(key2);
      contributionMap.set(key2, {
        holeId: key2,
        holeName: hole.name ?? `Hole ${index + 1}`,
        distanceTiles: previous ? Math.min(previous.distanceTiles, holeDistance) : holeDistance,
        expectedRisk: (previous?.expectedRisk ?? 0) + holeExpected * unitFactor,
        outlierRisk: (previous?.outlierRisk ?? 0) + holeOutlier * unitFactor
      });
      expectedExposure += holeExpected * unitFactor;
      outlierExposure += holeOutlier * unitFactor;
    }
    for (const safety of safetyAssets) {
      const center = { x: safety.x + safety.width / 2, y: safety.y + safety.height / 2 };
      const distance2 = Math.hypot(center.x - target.x, center.y - target.y);
      if (distance2 > 30) continue;
      const base = safety.kind === "netting" ? 19 : safety.kind === "berm" ? 12 : safety.kind === "screening" ? 9 : safety.kind === "safety_buffer" ? 8 : safety.kind === "safety_fence" ? 4 : 1.5;
      const heightFactor = safety.kind === "netting" ? clamp$c((safety.coverageHeight ?? 18) / 18, 0.25, 1.2) : safety.kind === "warning_signage" ? 0.3 : clamp$c((safety.coverageHeight ?? 5) / 7, 0.35, 1);
      mitigation += base * safety.tier * safety.condition * heightFactor * (1 - distance2 / 36);
    }
    for (let y = homes.y; y < homes.y + homes.height; y += 2) for (let x = homes.x; x < homes.x + homes.width; x += 2) {
      const point2 = { x: x + 0.5, y: y + 0.5 };
      const contributingHoleIds = [];
      let rawRisk = 0;
      for (const [index, hole] of course.holes.entries()) {
        if (!hole.tee || !hole.green) continue;
        const holeId = hole.id ?? `hole-${index + 1}`;
        if (property.safetyPolicy.closedHoleIds.includes(holeId)) continue;
        const distance2 = pointSegmentDistance(point2, hole.tee, hole.green);
        if (distance2 < 26) {
          rawRisk += distance2 < 5 ? 25 : distance2 < 10 ? 14 : distance2 < 18 ? 6 : 2;
          contributingHoleIds.push(holeId);
        }
      }
      const localMitigation = safetyAssets.reduce((sum, safety) => {
        const distance2 = Math.hypot(point2.x - (safety.x + safety.width / 2), point2.y - (safety.y + safety.height / 2));
        if (distance2 > 20) return sum;
        const strength = safety.kind === "netting" ? 18 : safety.kind === "berm" ? 11 : safety.kind === "screening" ? 8 : safety.kind === "safety_buffer" ? 7 : 2;
        return sum + strength * safety.tier * safety.condition * (1 - distance2 / 24);
      }, 0);
      const mitigatedRisk = clamp$c(rawRisk - localMitigation, 0, 100);
      heatmap.push({ x, y, risk: clamp$c(rawRisk, 0, 100), mitigatedRisk, class: mitigatedRisk >= 70 ? "severe" : mitigatedRisk >= 40 ? "high" : mitigatedRisk >= 18 ? "guarded" : "low", contributingHoleIds: contributingHoleIds.slice(0, 6) });
    }
  }
  const score = clamp$c(expectedExposure * 0.7 + outlierExposure * 0.3 - mitigation, 0, 100);
  const exposureLimit = property.safetyPolicy.exposureLimit;
  const blockingReasons = [
    ...score >= exposureLimit ? [`Residual exposure ${Math.round(score)}/100 exceeds policy limit ${Math.round(exposureLimit)}/100.`] : [],
    ...measuredSetback < 4 ? [`Measured setback ${measuredSetback.toFixed(1)} tiles is below the four-tile hard minimum.`] : []
  ];
  return {
    score,
    eligibility: blockingReasons.length > 0 ? "blocked" : score >= 35 ? "marginal" : "safe",
    expectedExposure,
    outlierExposure,
    mitigation,
    contributions: [...contributionMap.values()].sort((a, b) => b.expectedRisk + b.outlierRisk - (a.expectedRisk + a.outlierRisk)).slice(0, 12).map((item) => ({ ...item, normalRisk: item.expectedRisk, extremeRisk: item.outlierRisk, exposedAssets: residential.map((asset) => asset.id) })),
    heatmap: heatmap.slice(0, 360),
    measuredSetback,
    blockingReasons
  };
}
function pointSegmentDistance(point2, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0) return Math.hypot(point2.x - from.x, point2.y - from.y);
  const t = clamp$c(((point2.x - from.x) * dx + (point2.y - from.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point2.x - (from.x + dx * t), point2.y - (from.y + dy * t));
}
function settlePropertyDay(course, world, day, coreGolfers, shotTraces = []) {
  const property = normalizePropertyCourse(course.property);
  let enterprise = normalizePropertyEnterprise(world.enterprise);
  const settlementKey = `${world.week}-${day}`;
  if (enterprise.lastSettlementKey === settlementKey) return { course: { ...course, property }, world: { ...world, enterprise }, report: { revenue: 0, costs: 0, visitors: 0, accessCapacity: propertyAccessCapacity(course, world), demand: 0, denied: 0, entries: [], incidents: [] } };
  let sequence = enterprise.sequence;
  const entries = [];
  const incidents = [];
  const newComplaints = [];
  const newClaims = [];
  const facilityStats = /* @__PURE__ */ new Map();
  const enabled = property.assets.filter(isOperational);
  const accessCapacity = propertyAccessCapacity(course, world);
  const resortBeds = capacity(enabled, ["lodge", "hotel", "cottages"]);
  const residentCount = enterprise.residents.reduce((sum, resident) => sum + resident.occupied, 0);
  const baseDemand = Math.max(0, Math.round(4 + world.reputation * 0.13 + world.marketingLevel * 3 + residentCount * 0.12 + resortBeds * 0.1));
  let remainingAccess = Math.max(0, accessCapacity - coreGolfers);
  let propertyVisitors = 0;
  const add = (asset, category, description, visitors, revenue2, cost = 0, demand = visitors) => {
    if (revenue2 <= 0 && cost <= 0 && visitors <= 0) return;
    const grossRevenue = Math.round(revenue2);
    const variableCost = Math.round(grossRevenue * categoryCogs(category));
    const totalCost = Math.round(cost) + variableCost;
    const denied = Math.max(0, demand - visitors);
    entries.push({ id: `commercial-${sequence++}`, week: world.week, day, assetId: asset?.id, category, description, revenue: grossRevenue, cost: totalCost, visitors, grossRevenue, variableCost, netContribution: grossRevenue - totalCost, demand, served: visitors, denied });
    if (asset) {
      const previous = facilityStats.get(asset.id) ?? { demand: 0, served: 0, denied: 0, revenue: 0 };
      facilityStats.set(asset.id, { demand: previous.demand + demand, served: previous.served + visitors, denied: previous.denied + denied, revenue: previous.revenue + grossRevenue });
    }
  };
  const practiceAssets = enabled.filter((asset) => asset.category === "practice");
  const memberShare = enterprise.customers.filter((customer) => customer.member).length / Math.max(1, enterprise.customers.length);
  const phaseAssetUpdates = /* @__PURE__ */ new Map();
  let nextUnits = property.units.slice();
  const nextDevelopments = property.developments.map((development) => {
    if (development.status === "reacquired" || development.status === "sold_out" || development.status === "complete") {
      const activeUnits = nextUnits.filter((unit2) => unit2.developmentId === development.id);
      if (development.strategy === "retain" && activeUnits.length > 0) {
        const leased = activeUnits.filter((unit2) => unit2.status === "leased");
        const rent = leased.reduce((sum, unit2) => sum + (unit2.weeklyRent ?? 0) / 7, 0);
        const assessed = activeUnits.reduce((sum, unit2) => sum + unit2.marketValue, 0);
        const costs2 = development.commonUpkeepDaily + development.insurancePremiumDaily + assessed * development.taxRate / 365;
        add(property.assets.find((asset) => asset.id === development.assetId), "real_estate", `${development.name} retained rent (${leased.length}/${activeUnits.length} occupied)`, leased.length, rent, costs2, activeUnits.length);
      } else if (development.strategy === "partner" && activeUnits.length > 0 && day === 0) {
        const occupied = activeUnits.filter((unit2) => unit2.status === "partnered").length;
        const communityFees = occupied * 38 * (1 - development.partnerShare);
        add(property.assets.find((asset) => asset.id === development.assetId), "real_estate", `${development.name} partner revenue share`, occupied, communityFees, development.commonUpkeepDaily * 7 * (1 - development.partnerShare), activeUnits.length);
      }
      return development;
    }
    const constructionDaysRemaining = Math.max(0, development.constructionDaysRemaining - 1);
    const releaseDaysRemaining = constructionDaysRemaining === 0 ? Math.max(0, development.releaseDaysRemaining - 1) : development.releaseDaysRemaining;
    if (constructionDaysRemaining > 0) {
      phaseAssetUpdates.set(development.assetId, { tenure: "committed", constructionDaysRemaining });
      return { ...development, constructionDaysRemaining };
    }
    if (releaseDaysRemaining > 0) {
      phaseAssetUpdates.set(development.assetId, { tenure: "committed", constructionDaysRemaining: 0 });
      nextUnits = nextUnits.map((unit2) => unit2.developmentId === development.id && unit2.status === "construction" ? { ...unit2, status: "available" } : unit2);
      return { ...development, status: "releasing", constructionDaysRemaining: 0, releaseDaysRemaining };
    }
    const developmentUnits = nextUnits.filter((unit2) => unit2.developmentId === development.id);
    const occupancyRate = development.strategy === "sell" ? 0.78 : development.strategy === "retain" ? 0.68 : 0.82;
    const occupiedCount = Math.max(1, Math.floor(developmentUnits.length * occupancyRate));
    const occupiedIds = new Set(developmentUnits.slice(0, occupiedCount).map((unit2) => unit2.id));
    const tenure = development.strategy === "sell" ? "sold" : development.strategy === "retain" ? "retained" : "partnered";
    nextUnits = nextUnits.map((unit2) => {
      if (unit2.developmentId !== development.id) return unit2;
      const occupied = occupiedIds.has(unit2.id);
      return {
        ...unit2,
        status: development.strategy === "sell" ? "sold" : development.strategy === "partner" ? "partnered" : occupied ? "leased" : "vacant",
        tenure: development.strategy === "sell" ? "private" : development.strategy === "partner" ? "partner" : "player",
        closedValue: development.strategy === "sell" || development.strategy === "partner" ? unit2.marketValue : void 0,
        householdId: occupied ? `household-${unit2.id}` : void 0
      };
    });
    const existingHouseholdIds = new Set(enterprise.residents.map((resident) => resident.id));
    const archetypes = ["golf_family", "retiree", "professional", "second_home", "non_golfer"];
    const newHouseholds = developmentUnits.filter((unit2) => occupiedIds.has(unit2.id) && !existingHouseholdIds.has(`household-${unit2.id}`)).map((unit2, index) => {
      const archetype = archetypes[(unit2.lotNumber + development.phaseNumber) % archetypes.length];
      const golfInterest = archetype === "golf_family" ? 82 : archetype === "retiree" ? 62 : archetype === "non_golfer" ? 12 : 42;
      return {
        id: `household-${unit2.id}`,
        developmentId: development.id,
        assetId: development.assetId,
        units: 1,
        occupied: 1,
        satisfaction: 74 + index % 5,
        complaints: 0,
        unitIds: [unit2.id],
        customerIds: [`resident-customer-${unit2.id}`],
        archetype,
        golfInterest,
        riskTolerance: 28 + unit2.lotNumber * 11 % 50,
        serviceExpectation: 52 + unit2.lotNumber * 7 % 35,
        advocacy: 4,
        opposition: 0,
        localSpend: 0,
        membershipPropensity: Math.round(golfInterest * 0.72)
      };
    });
    const customerIds = new Set(enterprise.customers.map((customer) => customer.id));
    const newCustomers = newHouseholds.flatMap((household, index) => (household.customerIds ?? []).filter((id) => !customerIds.has(id)).map((id) => ({
      id,
      name: `Resident ${development.phaseNumber}-${index + 1}`,
      segment: "resident",
      skill: Math.round((household.golfInterest ?? 30) * 0.55),
      loyalty: 58,
      visits: 0,
      totalSpend: 0,
      member: false,
      lastVisitWeek: world.week
    })));
    enterprise = {
      ...enterprise,
      residents: [...enterprise.residents, ...newHouseholds].slice(0, 240),
      customers: normalizedCustomers([...enterprise.customers, ...newCustomers], enterprise.customers)
    };
    const gross = developmentUnits.reduce((sum, unit2) => sum + unit2.marketValue, 0);
    if (development.strategy === "sell") add(property.assets.find((asset) => asset.id === development.assetId), "real_estate", `${development.name} unit closings`, occupiedCount, gross, 0, developmentUnits.length);
    if (development.strategy === "partner") add(property.assets.find((asset) => asset.id === development.assetId), "real_estate", `${development.name} developer-partner closing share`, occupiedCount, gross * (1 - development.partnerShare), 0, developmentUnits.length);
    phaseAssetUpdates.set(development.assetId, { tenure, constructionDaysRemaining: 0 });
    return {
      ...development,
      status: development.strategy === "sell" ? "sold_out" : "complete",
      constructionDaysRemaining: 0,
      releaseDaysRemaining: 0
    };
  });
  const today = world.week * 7 + day;
  let dirtyRooms = Math.max(0, enterprise.resort.dirtyRooms - enterprise.resort.housekeeping * 6);
  const outOfOrderRooms = Math.max(0, enterprise.resort.outOfOrderRooms - enterprise.resort.maintenance * 2);
  let serviceQueue = 0;
  let transportWaitMinutes = 0;
  const staffedLodging = enterprise.resort.frontDesk > 0 && enterprise.resort.housekeeping > 0;
  let reservationsState = enterprise.reservations.map((reservation) => {
    const checkout = (reservation.checkOutWeek ?? reservation.week) * 7 + (reservation.checkOutDay ?? 6);
    if (reservation.status === "checked_in" && checkout <= today) {
      dirtyRooms += reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2);
      return { ...reservation, status: "checked_out" };
    }
    return reservation;
  });
  const occupiedByAsset = /* @__PURE__ */ new Map();
  for (const reservation of reservationsState) {
    if (reservation.status !== "checked_in") continue;
    occupiedByAsset.set(reservation.assetId, (occupiedByAsset.get(reservation.assetId) ?? 0) + (reservation.roomCount ?? Math.ceil((reservation.partySize ?? 1) / 2)));
  }
  reservationsState = reservationsState.map((reservation) => {
    const checkin = (reservation.checkInWeek ?? reservation.week) * 7 + (reservation.checkInDay ?? 0);
    if (reservation.status !== "booked" || checkin !== today) return reservation;
    const lodging = property.assets.find((asset) => asset.id === reservation.assetId && isOperational(asset));
    const party = reservation.partySize ?? 1;
    const roomCount = reservation.roomCount ?? Math.ceil(party / 2);
    const roomsAvailable = Math.max(0, (lodging?.capacity ?? 0) - dirtyRooms - outOfOrderRooms - (occupiedByAsset.get(reservation.assetId) ?? 0));
    if (!staffedLodging || !lodging || roomsAvailable < roomCount || remainingAccess < party) {
      const refund = reservation.deposit ?? 0;
      serviceQueue += party;
      const incident = { id: `incident-${sequence++}`, week: world.week, day, assetId: lodging?.id ?? reservation.assetId, kind: "service_failure", severity: 2, cost: refund, description: !staffedLodging ? "An overnight package was cancelled because reception or housekeeping was not staffed." : "An overnight package was cancelled because room or arrival capacity was unavailable." };
      incidents.push(incident);
      add(lodging, "lodging", incident.description, 0, 0, refund, party);
      const refundFolio = { id: `${reservation.id}-folio-refund`, week: world.week, day, category: "refund", description: "Cancelled-stay deposit refund", amount: -refund, included: false };
      return {
        ...reservation,
        refund,
        status: "cancelled",
        revalidation: "cancelled",
        folio: [...reservation.folio ?? [], refundFolio],
        entitlements: reservation.entitlements?.map((entitlement) => ({ ...entitlement, status: "refunded", redeemed: false, refundAmount: entitlement.kind === "room" ? refund : 0, note: incident.description }))
      };
    }
    remainingAccess -= party;
    propertyVisitors += party;
    occupiedByAsset.set(reservation.assetId, (occupiedByAsset.get(reservation.assetId) ?? 0) + roomCount);
    const balance = Math.max(0, reservation.value - (reservation.deposit ?? 0));
    add(lodging, "lodging", `${reservation.package.replaceAll("_", " ")} package check-in`, party, balance, 0, party);
    const roomFolio = { id: `${reservation.id}-folio-room`, week: world.week, day, category: "room", description: `${roomCount} ${reservation.roomClass ?? "standard"} room${roomCount === 1 ? "" : "s"} for ${reservation.nights} nights`, amount: balance, included: false };
    return {
      ...reservation,
      status: "checked_in",
      revalidation: "valid",
      folio: [...reservation.folio ?? [], roomFolio],
      entitlements: reservation.entitlements?.map((entitlement) => entitlement.kind === "room" ? { ...entitlement, status: "fulfilled", redeemed: true, note: "Room inventory assigned at check-in." } : entitlement)
    };
  });
  const shuttle = enabled.find((asset) => asset.kind === "shuttle");
  const transportCapacity = (shuttle?.capacity ?? 0) * enterprise.resort.shuttleDrivers;
  reservationsState = reservationsState.map((reservation) => {
    if (reservation.status !== "checked_in") return reservation;
    const scheduled = reservation.entitlements?.filter((entitlement) => (entitlement.status ?? (entitlement.redeemed ? "fulfilled" : "pending")) === "pending" && (entitlement.scheduledWeek ?? reservation.checkInWeek ?? reservation.week) === world.week && (entitlement.scheduledDay ?? reservation.checkInDay ?? 0) === day) ?? [];
    if (scheduled.length === 0) return reservation;
    const party = reservation.partySize ?? 1;
    const transportReady = reservation.transportMode !== "shuttle" || transportCapacity >= party;
    const nextFolio = [...reservation.folio ?? []];
    let refund = reservation.refund ?? 0;
    let disrupted = false;
    const nextEntitlements = reservation.entitlements?.map((entitlement) => {
      if (!scheduled.some((candidate) => candidate.id === entitlement.id)) return entitlement;
      const quantity = entitlement.quantity ?? party;
      const serviceAsset = entitlement.kind === "practice" ? practiceAssets[0] : entitlement.kind === "dining" ? enabled.find((asset) => asset.kind === "restaurant" || asset.kind === "clubhouse") : entitlement.kind === "spa" ? enabled.find((asset) => asset.kind === "spa") : property.assets.find((asset) => asset.id === reservation.assetId);
      const serviceAvailable = transportReady && (entitlement.kind === "golf" ? course.holes.some((hole) => hole.tee && hole.green) : entitlement.kind === "practice" ? practiceAssets.length > 0 : entitlement.kind === "dining" ? hasFacilityCapability(course, "restaurant", "restaurant") && enterprise.resort.foodService > 0 : entitlement.kind === "spa" ? !!serviceAsset : true);
      const category = entitlement.kind === "golf" ? "green_fee" : entitlement.kind === "practice" ? "practice" : entitlement.kind === "dining" ? "food_beverage" : entitlement.kind === "spa" ? "lodging" : "lodging";
      if (serviceAvailable) {
        add(serviceAsset, category, `Included ${entitlement.kind} entitlement fulfilled`, quantity, 0, 0, quantity);
        nextFolio.push({ id: `${entitlement.id}-folio`, week: world.week, day, category: entitlement.kind === "golf" ? "golf" : entitlement.kind, description: `Included ${entitlement.kind} service`, amount: 0, included: true });
        return { ...entitlement, status: "fulfilled", redeemed: true, note: "Fulfilled through reserved package capacity." };
      }
      const ratio = entitlement.kind === "golf" ? 0.18 : entitlement.kind === "practice" ? 0.12 : entitlement.kind === "dining" ? 0.1 : 0.14;
      const entitlementRefund = Math.min(Math.max(0, reservation.value - refund), Math.round(reservation.value * ratio));
      refund += entitlementRefund;
      disrupted = true;
      serviceQueue += quantity;
      const reason = transportReady ? `${entitlement.kind} capacity became unavailable after booking.` : "A shuttle overload caused the party to miss the included service.";
      add(serviceAsset, category, `Package service refund: ${reason}`, 0, 0, entitlementRefund, quantity);
      nextFolio.push({ id: `${entitlement.id}-folio-refund`, week: world.week, day, category: "refund", description: reason, amount: -entitlementRefund, included: false });
      return { ...entitlement, status: "refunded", redeemed: false, refundAmount: entitlementRefund, note: reason };
    });
    if (!transportReady) {
      const waiting = Math.max(1, party - transportCapacity);
      transportWaitMinutes = Math.max(transportWaitMinutes, Math.ceil(waiting / Math.max(1, transportCapacity)) * 18);
    }
    return { ...reservation, refund, revalidation: disrupted ? "substituted" : reservation.revalidation, entitlements: nextEntitlements, folio: nextFolio.slice(-80) };
  });
  let practiceVisitors = 0;
  for (const asset of practiceAssets) {
    const serviceCapacity = Math.floor(asset.capacity * operatingHoursFactor(asset));
    const visitors = Math.min(remainingAccess, serviceCapacity, Math.max(0, Math.round(baseDemand * (0.32 + asset.tier * 0.1) * asset.condition / Math.max(1, practiceAssets.length))));
    remainingAccess -= visitors;
    practiceVisitors += visitors;
    propertyVisitors += visitors;
    const priceFit = clamp$c(1.18 - asset.price / Math.max(1, PROPERTY_ASSET_SPECS[asset.kind].basePrice * 2.2), 0.45, 1.08);
    add(asset, "practice", `${asset.name} sessions and bucket sales`, visitors, visitors * asset.price * priceFit * (1 - memberShare * 0.1), 0, Math.max(visitors, Math.round(baseDemand / Math.max(1, practiceAssets.length))));
  }
  const clubhouse2 = enabled.find((asset) => asset.kind === "clubhouse");
  const proOffice = clubhouse2?.modules?.some((module) => module.kind === "pro_office" && module.enabled);
  const fittingStudio = clubhouse2?.modules?.some((module) => module.kind === "fitting_studio" && module.enabled);
  const lessonCapacity = enterprise.professionals.length * (proOffice ? 7 : 5);
  const lessons = Math.min(lessonCapacity, Math.floor(practiceVisitors * 0.28));
  if (lessons > 0) {
    const averagePrice = enterprise.professionals.reduce((sum, pro) => sum + pro.lessonPrice, 0) / enterprise.professionals.length;
    add(practiceAssets[0], "lessons", "Club professional lessons", lessons, lessons * averagePrice);
    enterprise = { ...enterprise, professionals: enterprise.professionals.map((pro, index) => ({ ...pro, bookings: pro.bookings + Math.floor((lessons + index) / enterprise.professionals.length) })) };
  }
  if (enterprise.membership.active && day === 0) {
    add(assetOf(course, "clubhouse"), "membership", "Weekly membership dues", enterprise.membership.memberCount, enterprise.membership.memberCount * enterprise.membership.monthlyFee / 4);
  }
  const lodgingAssets = enabled.filter((asset) => asset.category === "resort" && ["lodge", "hotel", "cottages"].includes(asset.kind));
  const reservations = [];
  let overnightGuests = reservationsState.filter((reservation) => reservation.status === "checked_in").reduce((sum, reservation) => sum + (reservation.partySize ?? 1), 0);
  for (const asset of lodgingAssets) {
    if (!staffedLodging) {
      serviceQueue += Math.round(asset.capacity * 0.25);
      continue;
    }
    const availableRooms = Math.max(0, asset.capacity - dirtyRooms - outOfOrderRooms - (occupiedByAsset.get(asset.id) ?? 0));
    const baseRate = PROPERTY_ASSET_SPECS[asset.kind].basePrice;
    const rateFit = clamp$c(1.3 - asset.price / Math.max(1, baseRate * 1.45), 0, 1.05);
    const targetOccupancy = clamp$c((0.18 + world.reputation / 220 + enabled.filter((item) => item.category === "practice").length * 0.035) * rateFit, 0, 0.9);
    const roomCount = Math.min(availableRooms, Math.ceil(remainingAccess / 2), Math.round(asset.capacity * targetOccupancy / Math.max(1, lodgingAssets.length)));
    const guests = Math.min(remainingAccess, roomCount * 2);
    if (guests <= 0 || roomCount <= 0) continue;
    remainingAccess -= guests;
    overnightGuests += guests;
    propertyVisitors += guests;
    const nights = 1 + (world.week + day + asset.tier) % 3;
    const packageType = practiceAssets.length ? "stay_and_play" : "room_only";
    const value = roomCount * asset.price * nights;
    add(asset, "lodging", `${asset.name} ${packageType.replaceAll("_", " ")} stays`, guests, value);
    const checkout = ordinalToWeekDay(today + nights);
    const reservationId = `reservation-${sequence++}`;
    const serviceDay = ordinalToWeekDay(today + 1);
    reservations.push({
      id: reservationId,
      assetId: asset.id,
      customerId: enterprise.customers[(world.week + day) % enterprise.customers.length]?.id ?? "walk-in",
      week: world.week,
      nights,
      package: packageType,
      value: Math.round(value),
      partySize: guests,
      roomCount,
      roomClass: roomClassFor(asset),
      travelerSegment: packageType === "stay_and_play" ? "buddies" : "couples",
      companionCount: packageType === "stay_and_play" ? 0 : Math.floor(guests / 2),
      checkInWeek: world.week,
      checkInDay: day,
      checkOutWeek: checkout.week,
      checkOutDay: checkout.day,
      deposit: 0,
      refund: 0,
      status: "checked_in",
      transportMode: asset.kind === "hotel" || asset.kind === "cottages" ? "shuttle" : "self_drive",
      vehicleCount: asset.kind === "cottages" ? Math.ceil(guests / 3) : 0,
      luggageReady: true,
      revalidation: "valid",
      folio: [{ id: `${reservationId}-folio-room`, week: world.week, day, category: "room", description: `${roomCount} ${roomClassFor(asset)} room${roomCount === 1 ? "" : "s"} for ${nights} nights`, amount: Math.round(value), included: false }],
      entitlements: [
        { id: `${reservationId}-room`, kind: "room", scheduledWeek: world.week, scheduledDay: day, quantity: roomCount * nights, status: "fulfilled", redeemed: true, refundAmount: 0 },
        ...packageType === "stay_and_play" ? [{ id: `${reservationId}-golf`, kind: "golf", scheduledWeek: serviceDay.week, scheduledDay: serviceDay.day, quantity: guests, status: "pending", redeemed: false, refundAmount: 0 }] : []
      ]
    });
    occupiedByAsset.set(asset.id, (occupiedByAsset.get(asset.id) ?? 0) + roomCount);
  }
  const clubhouseGuests = coreGolfers + practiceVisitors + overnightGuests + Math.round(residentCount * 0.08);
  for (const asset of enabled.filter((item) => item.category === "clubhouse" && item.kind !== "clubhouse" && item.kind !== "locker_room")) {
    const share = asset.kind === "restaurant" ? 0.34 : asset.kind === "bar" ? 0.27 : asset.kind === "pro_shop" ? 0.22 : 0.06;
    const staffingCap = asset.kind === "restaurant" || asset.kind === "bar" ? enterprise.resort.foodService * 24 : asset.kind === "locker_room" ? enterprise.resort.lockerAttendants * 30 : Number.POSITIVE_INFINITY;
    const demand = Math.round(clubhouseGuests * share * asset.condition);
    const visitors = Math.min(Math.floor(asset.capacity * operatingHoursFactor(asset)), staffingCap, demand);
    const category = asset.kind === "pro_shop" ? "retail" : asset.kind === "event_space" ? "events" : "food_beverage";
    if (asset.kind === "pro_shop") {
      const merchandise = Math.ceil(visitors * 0.58);
      const rentals = asset.tier >= 2 ? Math.ceil(visitors * 0.18) : 0;
      const repairs = asset.tier >= 3 ? Math.floor(visitors * 0.12) : 0;
      const fittings = asset.tier >= 4 && enterprise.professionals.length > 0 ? Math.min(enterprise.professionals.length * (fittingStudio ? 3 : 1), Math.floor(visitors * 0.12)) : 0;
      add(asset, "retail", "Equipment and apparel sales", merchandise, merchandise * asset.price, 0, Math.ceil(demand * 0.58));
      if (asset.tier >= 2) add(asset, "retail", "Club rental service", rentals, rentals * Math.round(asset.price * 0.72), 0, Math.ceil(demand * 0.18));
      if (asset.tier >= 3) add(asset, "retail", "Repair service", repairs, repairs * Math.round(asset.price * 0.9), 0, Math.ceil(demand * 0.12));
      if (asset.tier >= 4) add(asset, "retail", "Club fittings", fittings, fittings * Math.round(asset.price * 1.85), 0, Math.ceil(demand * 0.12));
    } else {
      add(asset, category, asset.kind === "event_space" ? "Function-space service" : `${asset.name} sales`, visitors, visitors * asset.price, 0, demand);
    }
  }
  if (clubhouse2) {
    const modules = clubhouse2.modules?.filter((module) => module.enabled) ?? [];
    const addModuleService = (moduleKind, standalone, category, share, price, staffingCap = Number.POSITIVE_INFINITY) => {
      if (enabled.some((asset) => asset.kind === standalone)) return;
      const module = modules.find((candidate) => candidate.kind === moduleKind);
      if (!module) return;
      const moduleSpec2 = FACILITY_MODULE_SPECS[moduleKind];
      const demand = Math.round(clubhouseGuests * share * clubhouse2.condition);
      const visitors = Math.min(moduleSpec2.capacity * module.tier, staffingCap, demand);
      add(clubhouse2, category, `${moduleSpec2.label} service`, visitors, visitors * price, 0, demand);
    };
    addModuleService("pro_shop", "pro_shop", "retail", 0.16, 24);
    addModuleService("restaurant", "restaurant", "food_beverage", 0.28, 25, enterprise.resort.foodService * 24);
    addModuleService("bar", "bar", "food_beverage", 0.2, 18, enterprise.resort.foodService * 20);
    addModuleService("function_room", "event_space", "events", 0.04, 62, enterprise.resort.foodService * 30);
  }
  const outings = enterprise.outings.map((outing) => {
    if (outing.status !== "scheduled" || outing.week !== world.week || outing.day !== day) return outing;
    const venue = assetOf(course, "event_space") ?? clubhouse2;
    const needsFood = outing.package === "golf_catering" || outing.package === "destination_event";
    const needsPro = outing.package === "golf_clinic";
    const canFulfill = !!venue && (!needsFood || hasFacilityCapability(course, "restaurant", "restaurant") && enterprise.resort.foodService > 0) && (!needsPro || enterprise.professionals.length > 0) && accessCapacity - coreGolfers - propertyVisitors >= outing.guests;
    if (!canFulfill) {
      add(venue, "events", "Cancelled outing refund", 0, 0, outing.deposit, outing.guests);
      serviceQueue += outing.guests;
      return { ...outing, status: "cancelled" };
    }
    propertyVisitors += outing.guests;
    add(venue, "events", `${outing.package.replaceAll("_", " ")} outing fulfillment`, outing.guests, outing.gross - outing.deposit, 0, outing.guests);
    return { ...outing, status: "fulfilled" };
  });
  const shuttleGuests = [...reservationsState, ...reservations].filter((reservation) => reservation.status === "checked_in" && reservation.transportMode === "shuttle").reduce((sum, reservation) => sum + (reservation.partySize ?? 1), 0);
  if (shuttleGuests > 0) {
    const waiting = Math.max(0, shuttleGuests - transportCapacity);
    transportWaitMinutes = Math.max(transportWaitMinutes, waiting > 0 ? Math.ceil(waiting / Math.max(1, transportCapacity)) * 18 : 0);
    serviceQueue += waiting;
    if (transportCapacity > 0) add(shuttle, "access", "Resort shuttle circulation", Math.min(shuttleGuests, transportCapacity), 0, Math.round(Math.min(shuttleGuests, transportCapacity) * 3), shuttleGuests);
  }
  if (enterprise.residents.length > 0) {
    const safety = analyzeResidentialSafety({ ...course, property });
    const residentialAssets = property.assets.filter((asset) => asset.kind === "houses" || asset.kind === "condos");
    const modeledTraces = shotTraces.length > 0 ? [...shotTraces] : coreGolfers > 0 ? course.holes.flatMap((hole, holeIndex) => {
      if (!hole.tee || !hole.green) return [];
      const holeId = hole.id ?? `hole-${holeIndex + 1}`;
      if (property.safetyPolicy.closedHoleIds.includes(holeId)) return [];
      return [{
        golferId: holeIndex,
        holeId,
        holeName: hole.name ?? `Hole ${holeIndex + 1}`,
        teeSet: "member",
        shotType: "drive",
        from: hole.tee,
        to: hole.green
      }];
    }) : [];
    const exposed = modeledTraces.flatMap((trace) => residentialAssets.map((asset) => {
      const target = { x: asset.x + asset.width / 2, y: asset.y + asset.height / 2 };
      return { trace, asset, distance: pointSegmentDistance(target, trace.from, trace.to), target };
    }).filter((candidate2) => candidate2.distance < 22)).sort((a, b) => a.distance - b.distance || (a.trace.holeId ?? "").localeCompare(b.trace.holeId ?? "") || a.asset.id.localeCompare(b.asset.id));
    const candidate = exposed[0];
    const roll = (world.runSeed + world.week * 31 + day * 17 + sequence * 13 + (candidate?.trace.golferId ?? 0) * 7 >>> 0) % 1e3 / 1e3;
    const geometricMitigation = candidate ? property.assets.filter((asset) => asset.enabled && asset.category === "safety").reduce((sum, mitigationAsset) => {
      const center = { x: mitigationAsset.x + mitigationAsset.width / 2, y: mitigationAsset.y + mitigationAsset.height / 2 };
      const onTrajectory = pointSegmentDistance(center, candidate.trace.from, candidate.trace.to) <= Math.max(2, mitigationAsset.width / 2 + 1);
      const nearHome = Math.hypot(center.x - candidate.target.x, center.y - candidate.target.y) < 26;
      if (!onTrajectory || !nearHome) return sum;
      const height = mitigationAsset.coverageHeight ?? (mitigationAsset.kind === "netting" ? 18 : 5);
      const strength = mitigationAsset.kind === "netting" ? 0.14 : mitigationAsset.kind === "berm" ? 0.09 : mitigationAsset.kind === "screening" ? 0.07 : mitigationAsset.kind === "safety_buffer" ? 0.05 : mitigationAsset.kind === "safety_fence" ? 0.025 : 0.01;
      return sum + strength * mitigationAsset.tier * mitigationAsset.condition * clamp$c(height / 12, 0.2, 1.2);
    }, 0) : 0;
    const strikeChance = candidate ? clamp$c((22 - candidate.distance) * 6e-3 + safety.score * 12e-4 - geometricMitigation, 0, 0.34) : 0;
    if (candidate && roll < strikeChance) {
      const resident = enterprise.residents.find((item) => item.assetId === candidate.asset.id) ?? enterprise.residents[(world.week + day) % enterprise.residents.length];
      const previousWarnings = enterprise.incidents.filter((incident2) => incident2.assetId === resident.assetId && incident2.sourceHoleId === candidate.trace.holeId).length;
      const severity = clamp$c(Math.ceil((22 - candidate.distance) / 4) + Math.min(2, previousWarnings), 1, 5);
      const kinds = ["boundary_entry", "near_miss", "roof_strike", "window_damage", "vehicle_damage", "serious_safety"];
      const kind = kinds[Math.min(kinds.length - 1, Math.max(0, severity - 1))];
      const cost = kind === "boundary_entry" || kind === "near_miss" ? 0 : Math.round(320 + severity * severity * 540);
      const incidentId = `incident-${sequence++}`;
      const claimId = cost > 0 ? `claim-${sequence++}` : void 0;
      const incident = {
        id: incidentId,
        week: world.week,
        day,
        assetId: resident.assetId,
        householdId: resident.id,
        claimId,
        kind,
        severity,
        cost,
        sourceHoleId: candidate.trace.holeId,
        sourceHoleName: candidate.trace.holeName,
        teeSet: candidate.trace.teeSet,
        shotType: candidate.trace.shotType,
        from: candidate.trace.from,
        to: candidate.trace.to,
        impact: candidate.target,
        mitigated: geometricMitigation > 0.05,
        priorWarnings: previousWarnings,
        description: `${kind.replaceAll("_", " ")} from ${candidate.trace.holeName ?? candidate.trace.holeId ?? "a live shot"} at ${candidate.asset.name}; ${geometricMitigation > 0.05 ? "mitigation reduced impact energy but residual exposure remained" : "no effective mitigation intersected the trajectory"}.`
      };
      incidents.push(incident);
      const recurrence = enterprise.complaints.filter((complaint) => complaint.householdId === resident.id && complaint.source === "errant_ball").length + 1;
      newComplaints.push({
        id: `complaint-${sequence++}`,
        householdId: resident.id,
        assetId: resident.assetId,
        week: world.week,
        day,
        source: "errant_ball",
        severity,
        recurrence,
        evidence: `${candidate.trace.shotType} trace from ${candidate.trace.holeName ?? candidate.trace.holeId ?? "unknown hole"} passed ${candidate.distance.toFixed(1)} tiles from the occupied unit and produced a ${kind.replaceAll("_", " ")}.`,
        sourceId: candidate.trace.holeId,
        location: candidate.target,
        status: "open"
      });
      if (claimId) newClaims.push({
        id: claimId,
        incidentId,
        assetId: resident.assetId,
        householdId: resident.id,
        week: world.week,
        status: "open",
        damage: cost,
        deductible: enterprise.insurance.deductible,
        insurerPayment: 0,
        playerPayment: 0,
        priorWarnings: previousWarnings
      });
      enterprise = {
        ...enterprise,
        residents: enterprise.residents.map((item) => item.id === resident.id ? {
          ...item,
          complaints: item.complaints,
          satisfaction: clamp$c(item.satisfaction - severity * 2 - recurrence, 0, 100),
          opposition: clamp$c((item.opposition ?? 0) + severity * 3 + recurrence, 0, 100),
          advocacy: clamp$c((item.advocacy ?? 0) - severity * 2, -100, 100)
        } : item)
      };
    }
  }
  const totalArrivals = coreGolfers + propertyVisitors;
  if (totalArrivals > accessCapacity) {
    const overflow = totalArrivals - accessCapacity;
    const cost = overflow * 18;
    const incident = { id: `incident-${sequence++}`, week: world.week, day, assetId: assetOf(course, "parking")?.id ?? "informal-parking", kind: "parking_overflow", severity: clamp$c(Math.ceil(overflow / 12), 1, 5), cost, description: `${overflow} arrivals could not find formal parking.` };
    incidents.push(incident);
    add(assetOf(course, "parking"), "access", incident.description, 0, 0, cost);
    const resident = enterprise.residents[0];
    if (resident) newComplaints.push({ id: `complaint-${sequence++}`, householdId: resident.id, assetId: resident.assetId, week: world.week, day, source: "traffic", severity: incident.severity, recurrence: enterprise.complaints.filter((complaint) => complaint.householdId === resident.id && complaint.source === "traffic").length + 1, evidence: `${overflow} arrivals exceeded measured formal parking capacity ${accessCapacity}.`, sourceId: incident.assetId, location: { x: assetOf(course, "parking")?.x ?? 0, y: assetOf(course, "parking")?.y ?? 0 }, status: "open" });
  }
  if (day === 6 && enterprise.residents.length > 0) {
    const lean = property.assets.find((asset) => asset.upkeepPolicy === "lean" && asset.category !== "safety");
    const resident = enterprise.residents[(world.week + enterprise.residents.length) % enterprise.residents.length];
    if (lean && lean.condition < 0.8) {
      const recurrence = enterprise.complaints.filter((complaint) => complaint.householdId === resident.id && complaint.source === "maintenance").length + 1;
      newComplaints.push({ id: `complaint-${sequence++}`, householdId: resident.id, assetId: resident.assetId, week: world.week, day, source: "maintenance", severity: clamp$c(Math.ceil((0.85 - lean.condition) * 10), 1, 4), recurrence, evidence: `${lean.name} condition fell to ${Math.round(lean.condition * 100)}% under lean upkeep.`, sourceId: lean.id, location: { x: lean.x, y: lean.y }, status: "open" });
    }
  }
  if (newComplaints.length > 0) {
    enterprise = {
      ...enterprise,
      residents: enterprise.residents.map((resident) => {
        const householdComplaints = newComplaints.filter((complaint) => complaint.householdId === resident.id);
        if (householdComplaints.length === 0) return resident;
        const severity = householdComplaints.reduce((sum, complaint) => sum + complaint.severity, 0);
        return {
          ...resident,
          complaints: resident.complaints + householdComplaints.length,
          satisfaction: clamp$c(resident.satisfaction - severity * 0.8, 0, 100),
          opposition: clamp$c((resident.opposition ?? 0) + severity, 0, 100)
        };
      })
    };
  }
  let upkeep = 0;
  const nextAssets = property.assets.map((asset) => {
    const phaseUpdate = phaseAssetUpdates.get(asset.id);
    const constructionDaysRemaining = phaseUpdate?.constructionDaysRemaining ?? Math.max(0, (asset.constructionDaysRemaining ?? 0) - 1);
    const stats = facilityStats.get(asset.id) ?? { demand: 0, served: 0, denied: 0, revenue: 0 };
    if (!asset.enabled) return { ...asset, ...phaseUpdate, constructionDaysRemaining, lastDay: stats };
    const policy = asset.upkeepPolicy ?? "standard";
    const moduleUpkeep = asset.modules?.filter((module) => module.enabled).reduce((sum, module) => sum + FACILITY_MODULE_SPECS[module.kind].dailyUpkeep * module.tier, 0) ?? 0;
    const daily = (PROPERTY_ASSET_SPECS[asset.kind].dailyUpkeep * (0.8 + asset.tier * 0.28) + moduleUpkeep) * upkeepCostFactor(policy);
    upkeep += daily;
    const baseWear = asset.category === "access" ? 28e-4 : asset.category === "resort" ? 22e-4 : 16e-4;
    const wearFactor = policy === "lean" ? 1.65 : policy === "premium" ? 0.55 : 1;
    const recovery = policy === "premium" ? 4e-3 : policy === "standard" ? 1e-3 : 0;
    const condition = clamp$c(asset.condition - baseWear * wearFactor * (1 + stats.served / Math.max(1, asset.capacity * 8)) + recovery, 0.25, 1);
    return { ...asset, ...phaseUpdate, condition, constructionDaysRemaining, lastDay: stats };
  });
  const serviceHeadcount = enterprise.resort.frontDesk + enterprise.resort.housekeeping + enterprise.resort.maintenance + enterprise.resort.concierge + enterprise.resort.shuttleDrivers + enterprise.resort.foodService + enterprise.resort.lockerAttendants;
  const wages = enterprise.professionals.reduce((sum, pro) => sum + pro.weeklyWage / 7, 0) + serviceHeadcount * 590 / 7;
  add(void 0, "upkeep", "Property upkeep, utilities, and club-professional wages", 0, 0, upkeep + wages);
  if (enterprise.residents.length > 0) add(void 0, "liability", "Course liability insurance premium", 0, 0, enterprise.insurance.dailyPremium * enterprise.insurance.riskMultiplier);
  const visitPool = Math.min(enterprise.customers.length, Math.max(0, practiceVisitors + Math.floor(overnightGuests / 2)));
  const customerSpend = entries.filter((entry) => entry.revenue > 0).reduce((sum, entry) => sum + entry.revenue, 0) / Math.max(1, propertyVisitors);
  const deniedTotal = entries.reduce((sum, entry) => sum + (entry.denied ?? 0), 0) + serviceQueue;
  const servicePenalty = clamp$c(deniedTotal / Math.max(1, propertyVisitors + deniedTotal), 0, 1);
  const customers = enterprise.customers.map((customer, index) => index < visitPool ? {
    ...customer,
    visits: customer.visits + 1,
    skill: clamp$c(customer.skill + (practiceVisitors > 0 ? (0.3 + practiceAssets.length * 0.07 + lessons / Math.max(1, practiceVisitors) * 1.1) * (1 - customer.skill / 105) : 0), 0, 100),
    loyalty: clamp$c(customer.loyalty + 0.6 + (customer.member ? 0.4 : 0) - servicePenalty * 2.4 - incidents.length * 0.18, 0, 100),
    totalSpend: customer.totalSpend + customerSpend,
    lastVisitWeek: world.week
  } : customer);
  const residentSpend = Math.round(entries.filter((entry) => ["practice", "lessons", "retail", "food_beverage", "membership"].includes(entry.category)).reduce((sum, entry) => sum + entry.revenue, 0) * clamp$c(residentCount / Math.max(1, coreGolfers + propertyVisitors + residentCount), 0, 0.65));
  if (enterprise.residents.length > 0 && residentSpend > 0) {
    const perHousehold = residentSpend / enterprise.residents.length;
    enterprise = { ...enterprise, residents: enterprise.residents.map((resident) => ({
      ...resident,
      localSpend: (resident.localSpend ?? 0) + perHousehold,
      advocacy: clamp$c((resident.advocacy ?? 0) + (servicePenalty < 0.15 ? 0.4 : -0.2), -100, 100)
    })) };
  }
  let membership = enterprise.membership;
  let retainedCustomers = customers.map((customer) => {
    if (!enterprise.membership.active || customer.segment !== "resident" || customer.member) return customer;
    const household = enterprise.residents.find((resident) => resident.customerIds?.includes(customer.id));
    const threshold = (household?.membershipPropensity ?? 0) / 100;
    const roll = (world.runSeed + world.week * 19 + customer.id.length * 13 >>> 0) % 100 / 100;
    return roll < threshold && enterprise.membership.memberCount < enterprise.membership.capacity ? { ...customer, member: true } : customer;
  });
  membership = { ...membership, memberCount: Math.min(membership.capacity, Math.max(membership.memberCount, retainedCustomers.filter((customer) => customer.member).length)) };
  if (membership.active && day === 6) {
    const memberCustomers = retainedCustomers.filter((customer) => customer.member);
    const churn = memberCustomers.filter((customer) => customer.loyalty < 32 || servicePenalty > 0.45).slice(0, Math.ceil(memberCustomers.length * clamp$c(servicePenalty * 0.35, 0, 0.2)));
    const churnIds = new Set(churn.map((customer) => customer.id));
    retainedCustomers = retainedCustomers.map((customer) => churnIds.has(customer.id) ? { ...customer, member: false, segment: "local" } : customer);
    const growth = servicePenalty < 0.12 && enabled.some((asset) => asset.kind === "locker_room") ? Math.min(3, membership.capacity - membership.memberCount) : 0;
    membership = { ...membership, memberCount: clamp$c(membership.memberCount - churn.length + growth, 0, membership.capacity) };
  }
  const revenue = entries.reduce((sum, entry) => sum + entry.revenue, 0);
  const costs = entries.reduce((sum, entry) => sum + entry.cost, 0);
  enterprise = {
    ...enterprise,
    sequence,
    lastSettlementKey: settlementKey,
    ledger: [...enterprise.ledger, ...entries].slice(-420),
    customers: retainedCustomers,
    membership,
    reservations: [...reservationsState, ...reservations].slice(-120),
    incidents: [...enterprise.incidents, ...incidents].slice(-240),
    complaints: [...enterprise.complaints, ...newComplaints].slice(-240),
    claims: [...enterprise.claims, ...newClaims].slice(-160),
    outings,
    resort: { ...enterprise.resort, dirtyRooms, outOfOrderRooms, serviceQueue, transportWaitMinutes }
  };
  return {
    course: { ...course, property: { ...property, assets: nextAssets, developments: nextDevelopments, units: nextUnits } },
    world: { ...world, enterprise },
    report: { revenue, costs, visitors: propertyVisitors, accessCapacity, demand: baseDemand, denied: entries.reduce((sum, entry) => sum + (entry.denied ?? 0), 0), entries, incidents }
  };
}
function capacity(assets, kinds) {
  return assets.filter((asset) => kinds.includes(asset.kind)).reduce((sum, asset) => sum + asset.capacity, 0);
}
function ordinalToWeekDay(ordinal) {
  return { week: Math.floor(ordinal / 7), day: (ordinal % 7 + 7) % 7 };
}
function categoryCogs(category) {
  switch (category) {
    case "retail":
      return 0.46;
    case "food_beverage":
      return 0.34;
    case "lodging":
      return 0.27;
    case "events":
      return 0.3;
    case "practice":
      return 0.12;
    case "lessons":
      return 0.08;
    case "membership":
      return 0.04;
    default:
      return 0;
  }
}
function recordCoreCommerce(world, day, input) {
  let enterprise = normalizePropertyEnterprise(world.enterprise);
  let sequence = enterprise.sequence;
  const rows = [];
  const push = (category, description, revenue) => {
    if (revenue <= 0) return;
    rows.push({ id: `commercial-${sequence++}`, week: world.week, day, category, description, revenue, cost: 0, visitors: 0, grossRevenue: revenue, variableCost: 0, netContribution: revenue, demand: 0, served: 0, denied: 0 });
  };
  push("green_fee", "Golf green fees", input.greenFees);
  for (const [type, revenue] of Object.entries(input.byConcession)) {
    push(type === "cart_rental" ? "cart" : type === "pro_shop" ? "retail" : "food_beverage", `${type.replaceAll("_", " ")} transactions`, revenue);
  }
  const itemized = Object.values(input.byConcession).reduce((sum, value) => sum + (value ?? 0), 0);
  push("food_beverage", "Other concession transactions", Math.max(0, input.concessions - itemized));
  push("tournament", "Tournament and event revenue", input.tournaments);
  enterprise = { ...enterprise, sequence, ledger: [...enterprise.ledger, ...rows].slice(-420) };
  return { ...world, enterprise };
}
const SEASONS = ["spring", "summer", "autumn", "winter"];
const CLUB_CHARTERS = [
  "public-gem",
  "championship-venue",
  "destination-retreat",
  "member-institution"
];
const DAYS_PER_WEEK$1 = 7;
const WEEKS_PER_SEASON = 8;
const WEEKS_PER_YEAR = 32;
const DAYS_PER_YEAR = DAYS_PER_WEEK$1 * WEEKS_PER_YEAR;
const clamp$b = (value, min, max) => Math.max(min, Math.min(max, value));
const finite$4 = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const integer = (value, fallback = 0) => Math.floor(finite$4(value, fallback));
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
  return Math.max(0, (Math.max(1, integer(week, 1)) - 1) * DAYS_PER_WEEK$1 + clamp$b(integer(dayOfWeek), 0, 6));
}
function calendarDate(absoluteDay) {
  const safe = Math.max(0, integer(absoluteDay));
  const dayOfYear = safe % DAYS_PER_YEAR;
  const weekOfYear = Math.floor(dayOfYear / DAYS_PER_WEEK$1) + 1;
  const seasonIndex = Math.floor((weekOfYear - 1) / WEEKS_PER_SEASON);
  return {
    absoluteDay: safe,
    year: Math.floor(safe / DAYS_PER_YEAR) + 1,
    weekOfYear,
    season: SEASONS[seasonIndex] ?? "winter",
    weekInSeason: (weekOfYear - 1) % WEEKS_PER_SEASON + 1,
    dayOfWeek: dayOfYear % DAYS_PER_WEEK$1
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
  const windMph = Math.round(clamp$b(windBase + unit$1(runSeed, day, 17) * 18 + (date.season === "winter" ? 3 : 0), 2, 34));
  const rainChance = clamp$b(THEME_RAIN[theme] + (date.season === "spring" ? 0.08 : date.season === "summer" ? -0.04 : 0), 0.04, 0.42);
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
  const severity = clamp$b(
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
  const drainage = clamp$b(integer(drainageLevel), 0, 3);
  const wetRelief = 1 - drainage * 0.11;
  const base = {
    carryMultiplier: clamp$b(1 - wind * 25e-4, 0.89, 1),
    dispersionMultiplier: clamp$b(1 + wind * 0.012, 1, 1.36),
    demandMultiplier: 1,
    paceMultiplier: 1,
    turfWearMultiplier: 1,
    turfRecoveryMultiplier: 1,
    lodgingMultiplier: 1,
    eventCancellationRisk: 0
  };
  if (weather.kind === "rain") return { ...base, carryMultiplier: base.carryMultiplier * 0.97, dispersionMultiplier: base.dispersionMultiplier * 1.05, demandMultiplier: 0.88, paceMultiplier: 1.08, turfWearMultiplier: 1 + 0.14 * wetRelief, turfRecoveryMultiplier: 1.12, lodgingMultiplier: 1.03, eventCancellationRisk: 0.08 * wetRelief };
  if (weather.kind === "heavy_rain") return { ...base, carryMultiplier: base.carryMultiplier * 0.93, dispersionMultiplier: base.dispersionMultiplier * 1.12, demandMultiplier: 0.62, paceMultiplier: 1.2, turfWearMultiplier: 1 + 0.42 * wetRelief, turfRecoveryMultiplier: 1.08, lodgingMultiplier: 1.07, eventCancellationRisk: 0.34 * wetRelief };
  if (weather.kind === "storm") return { ...base, carryMultiplier: base.carryMultiplier * 0.86, dispersionMultiplier: base.dispersionMultiplier * 1.28, demandMultiplier: 0.2, paceMultiplier: 1.38, turfWearMultiplier: 1 + 0.72 * wetRelief, turfRecoveryMultiplier: 0.9, lodgingMultiplier: 1.12, eventCancellationRisk: clamp$b(0.8 * wetRelief, 0.4, 0.8) };
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
    temperatureF: clamp$b(integer(candidate.temperatureF, fallback.temperatureF), -20, 125),
    windMph: clamp$b(integer(candidate.windMph, fallback.windMph), 0, 70),
    rainInches: clamp$b(finite$4(candidate.rainInches, fallback.rainInches), 0, 5),
    severity: clamp$b(finite$4(candidate.severity, fallback.severity), 0, 1)
  };
}
function validCharter$1(value) {
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
    charter: validCharter$1(candidate.charter) ? candidate.charter : fallback.charter,
    charterSelectedYear: Math.max(1, integer(candidate.charterSelectedYear, 1)),
    charterReviewedYears: Array.isArray(candidate.charterReviewedYears) ? [...new Set(candidate.charterReviewedYears.map((year) => integer(year)).filter((year) => year > 0))].slice(-40) : [],
    charterChanges: Array.isArray(candidate.charterChanges) ? candidate.charterChanges.filter((entry) => entry && validCharter$1(entry.from) && validCharter$1(entry.to)).slice(-40) : [],
    automation: {
      preset: automationPresets.has(candidate.automation?.preset) ? candidate.automation.preset : fallback.automation.preset,
      advancedOperations: candidate.automation?.advancedOperations === true,
      overrides: strings(candidate.automation?.overrides, 8),
      lastAppliedAbsoluteDay: integer(candidate.automation?.lastAppliedAbsoluteDay, -1),
      decisions: strings(candidate.automation?.decisions, 16),
      baselineMaintenanceBudget: Math.max(0, finite$4(candidate.automation?.baselineMaintenanceBudget)),
      baselineGreenFees: candidate.automation?.baselineGreenFees && typeof candidate.automation.baselineGreenFees === "object" ? Object.fromEntries(Object.entries(candidate.automation.baselineGreenFees).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).slice(0, 36)) : {},
      baselineAssetPrices: candidate.automation?.baselineAssetPrices && typeof candidate.automation.baselineAssetPrices === "object" ? Object.fromEntries(Object.entries(candidate.automation.baselineAssetPrices).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).slice(0, 160)) : {}
    },
    operations: {
      turfPriority: turfPriorities.has(candidate.operations?.turfPriority ?? "") ? candidate.operations.turfPriority : fallback.operations.turfPriority,
      waterPolicy: waterPolicies.has(candidate.operations?.waterPolicy ?? "") ? candidate.operations.waterPolicy : fallback.operations.waterPolicy,
      drainageLevel: clamp$b(integer(candidate.operations?.drainageLevel), 0, 3),
      drainageConstructionDays: clamp$b(integer(candidate.operations?.drainageConstructionDays), 0, 60),
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
function automationPolicy(preset, weather, charter) {
  const severe = weather.severity >= 0.55;
  const wet = weather.kind === "rain" || weather.kind === "heavy_rain" || weather.kind === "storm";
  const upkeep = preset === "stewardship" || severe ? "premium" : preset === "growth" ? "lean" : "standard";
  const hours = severe ? [9, 17] : preset === "growth" ? [6, 22] : [7, 20];
  const priceMultiplier = charter === "public-gem" ? 0.94 : charter === "championship-venue" ? 1.12 : charter === "destination-retreat" ? 1.08 : 1.03;
  const maintenanceMultiplier = preset === "stewardship" ? 1.22 : preset === "growth" ? 0.94 : 1.05;
  return {
    upkeep,
    openHour: hours[0],
    closeHour: hours[1],
    priceMultiplier,
    maintenanceMultiplier: maintenanceMultiplier * (severe || wet ? 1.15 : weather.kind === "drought" ? 1.2 : 1)
  };
}
function automatedAsset(asset, baselinePrice, policy, overrides) {
  return {
    ...asset,
    ...!overrides.has("hours") && ["practice", "clubhouse", "resort"].includes(asset.category) ? { openHour: policy.openHour, closeHour: policy.closeHour } : {},
    ...!overrides.has("upkeep") && !["access", "community", "safety"].includes(asset.category) ? { upkeepPolicy: policy.upkeep } : {},
    ...!overrides.has("pricing") && baselinePrice > 0 ? { price: Math.max(1, Math.round(baselinePrice * policy.priceMultiplier)) } : {}
  };
}
function applyAutomation(course, world, state, weather) {
  if (state.automation.advancedOperations || state.automation.lastAppliedAbsoluteDay === state.calendar.absoluteDay) {
    return { course, world, state };
  }
  const overrides = new Set(state.automation.overrides);
  const policy = automationPolicy(state.automation.preset, weather, state.charter);
  const normalized = normalizeCourseLayouts(course);
  const baselineGreenFees = {
    ...Object.fromEntries(normalized.layouts.map((layout) => [layout.id, layout.greenFee])),
    ...state.automation.baselineGreenFees
  };
  const property = normalizePropertyCourse(normalized.property);
  const baselineAssetPrices = {
    ...Object.fromEntries(property.assets.map((asset) => [asset.id, asset.price])),
    ...state.automation.baselineAssetPrices
  };
  const layouts = normalized.layouts.map((layout) => !overrides.has("pricing") ? { ...layout, greenFee: Math.max(10, Math.round((baselineGreenFees[layout.id] ?? layout.greenFee) * policy.priceMultiplier)) } : layout);
  const nextCourse = {
    ...normalized,
    layouts,
    baseGreenFee: layouts.find((layout) => layout.id === normalized.activeCourseId)?.greenFee ?? normalized.baseGreenFee,
    property: { ...property, assets: property.assets.map((asset) => automatedAsset(asset, baselineAssetPrices[asset.id] ?? asset.price, policy, overrides)) }
  };
  const baseMaintenance = Math.max(350, state.automation.baselineMaintenanceBudget || world.maintenanceBudget);
  const nextWorld = overrides.has("upkeep") ? world : { ...world, maintenanceBudget: Math.round(baseMaintenance * policy.maintenanceMultiplier) };
  const decisions = [
    `${state.automation.preset} hours ${policy.openHour}:00–${policy.closeHour}:00`,
    `${policy.upkeep} upkeep`,
    `weather reserve ${Math.round((policy.maintenanceMultiplier - 1) * 100)}%`
  ];
  return {
    course: nextCourse,
    world: nextWorld,
    state: {
      ...state,
      automation: {
        ...state.automation,
        lastAppliedAbsoluteDay: state.calendar.absoluteDay,
        decisions,
        baselineMaintenanceBudget: baseMaintenance,
        baselineGreenFees,
        baselineAssetPrices
      }
    }
  };
}
function award(id, title, recipient, fact2) {
  return { id, title, recipient, fact: fact2 };
}
function annualRankings(course, world, year) {
  const playerScore = Math.round(clamp$b(
    world.reputation * 0.52 + course.condition * 25 + Math.min(18, (world.playerPro?.rounds.length ?? 0) * 0.4) + Math.min(10, (world.tournaments?.events.filter((event2) => event2.status === "completed").length ?? 0) * 1.5),
    0,
    100
  ));
  const rivals = ["Alder Heath", "Northbank Golf", "Saltmere Club", "Red Mesa Links"].map((name, index) => ({
    clubId: `annual-rival-${index + 1}`,
    clubName: name,
    score: 44 + Math.floor(unit$1(world.runSeed + year * 101, index, 77) * 48),
    player: false
  }));
  return [{ clubId: "player-club", clubName: course.name, score: playerScore, player: true }, ...rivals].sort((a, b) => b.score - a.score || a.clubId.localeCompare(b.clubId)).map((entry, index) => ({ ...entry, rank: index + 1 }));
}
function annualYearbook(course, world, state, year, absoluteDay) {
  const living = world.livingClub;
  const tournamentChampions = (world.tournaments?.events ?? []).filter((event2) => event2.status === "completed" && event2.winnerName).slice(-8).map((event2) => event2.winnerName);
  const notablePeople = [
    ...(living?.regulars ?? []).sort((a, b) => b.loyalty - a.loyalty).slice(0, 3).map((person) => ({ id: person.id, name: person.name, note: `${person.visits} visits · ${person.loyalty} loyalty` })),
    ...(world.staffRoster ?? []).sort((a, b) => (b.proficiency ?? 0) - (a.proficiency ?? 0)).slice(0, 2).map((person) => ({ id: person.id, name: person.name, note: `${person.role.replaceAll("_", " ")} · ${Math.round(person.morale ?? 65)} morale` }))
  ].slice(0, 5);
  const completedRounds = (living?.regulars ?? []).reduce((sum, regular) => sum + regular.rounds, 0);
  const playerProRounds = world.playerPro?.rounds.length ?? 0;
  const constructionCount = normalizePropertyCourse(course.property).assets.filter((asset) => (asset.constructionDaysRemaining ?? 0) === 0 && asset.category !== "access").length;
  const enterprise = normalizePropertyEnterprise(world.enterprise);
  const incidentCount = enterprise.incidents.length;
  const storyCount = living?.story.instances.filter((instance) => instance.status === "resolved").length ?? 0;
  const awards = [
    award(`year-${year}-course`, "Course of the Year", course.name, `${Math.round(course.condition * 100)} condition · ${Math.round(world.reputation)} reputation`),
    award(`year-${year}-golfer`, "Golfer of the Year", tournamentChampions[0] ?? notablePeople[0]?.name ?? world.playerPro?.identity.name ?? "The Player Pro", `${completedRounds + playerProRounds} recorded club rounds`),
    award(`year-${year}-steward`, "Club Steward", notablePeople.find((person) => (world.staffRoster ?? []).some((staff) => staff.id === person.id))?.name ?? world.founderName ?? "The club team", `${constructionCount} operating facilities · ${storyCount} resolved stories`)
  ];
  return {
    id: `yearbook-${year}`,
    year,
    charter: state.charter,
    generatedAbsoluteDay: absoluteDay,
    cash: Math.round(world.cash),
    reputation: Math.round(world.reputation * 10) / 10,
    courseCondition: Math.round(course.condition * 1e3) / 1e3,
    completedRounds,
    playerProRounds,
    tournamentChampions,
    notablePeople,
    constructionCount,
    incidentCount,
    storyCount,
    awards,
    rankings: annualRankings(course, world, year),
    dismissed: false,
    rewardSettled: true
  };
}
function closeYear(course, world, state, absoluteDay) {
  const year = calendarDate(absoluteDay).year;
  if (state.lastClosedYear >= year) return { world, state };
  const yearbook = annualYearbook(course, world, state, year, absoluteDay);
  const ranking = yearbook.rankings.find((entry) => entry.player)?.rank ?? 5;
  const reward = ranking === 1 ? 5e3 : ranking <= 3 ? 2500 : 1e3;
  const timelineEntry = {
    id: `year-close-${year}`,
    absoluteDay,
    year,
    kind: "year-close",
    title: `Year ${year} entered the club history`,
    detail: `${CHARTER_DEFINITIONS[state.charter].name} · ranking #${ranking} · ${yearbook.awards.length} annual awards`,
    courseId: normalizeCourseLayouts(course).activeCourseId
  };
  return {
    world: { ...world, cash: world.cash + reward },
    state: {
      ...state,
      yearbooks: [...state.yearbooks.filter((book) => book.year !== year), yearbook].slice(-40),
      timeline: [...state.timeline.filter((entry) => entry.id !== timelineEntry.id), timelineEntry].slice(-320),
      hallOfFame: [...state.hallOfFame, ...yearbook.awards].slice(-120),
      lastClosedYear: year,
      pendingYearbookId: yearbook.id
    }
  };
}
function advanceSeasonalDay(course, world, dayIndex) {
  const absoluteDay = absoluteDayFor(world.week, dayIndex);
  let state = normalizeSeasonalState(world.seasonal, {
    runSeed: world.runSeed,
    theme: course.theme,
    week: world.week,
    day: dayIndex,
    migrated: world.seasonal == null
  });
  const weather = weatherForDay(world.runSeed, course.theme ?? "parkland", absoluteDay);
  const modifiers = weatherModifiers(weather, state.operations.drainageLevel);
  if (absoluteDay <= state.lastCommittedAbsoluteDay) return { course, world: { ...world, seasonal: state }, weather, modifiers };
  state = {
    ...state,
    calendar: calendarDate(absoluteDay),
    lastCommittedAbsoluteDay: absoluteDay,
    currentWeather: weather,
    forecast: forecastForDay(world.runSeed, course.theme ?? "parkland", absoluteDay + 1),
    forecastPublishedAbsoluteDay: absoluteDay,
    operations: {
      ...state.operations,
      drainageConstructionDays: Math.max(0, state.operations.drainageConstructionDays - 1)
    }
  };
  const automated = applyAutomation(course, world, state, weather);
  course = automated.course;
  world = automated.world;
  state = automated.state;
  if (absoluteDay % DAYS_PER_YEAR === DAYS_PER_YEAR - 1) {
    const closed = closeYear(course, world, state, absoluteDay);
    world = closed.world;
    state = closed.state;
  }
  return { course, world: { ...world, seasonal: state }, weather, modifiers };
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
function clamp$a(value, min, max) {
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
  const x = clamp$a(Math.round(pointValue.x), 0, snapshot.width - 1);
  const y = clamp$a(Math.round(pointValue.y), 0, snapshot.height - 1);
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
  const power = clamp$a(args.selection.power, 0.25, 1.15);
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
    x: clamp$a(landing.x, 0, args.snapshot.width - 1),
    y: clamp$a(landing.y, 0, args.snapshot.height - 1)
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
    x: clamp$a(landing.x + ux * rollTiles, 0, args.snapshot.width - 1),
    y: clamp$a(landing.y + uy * rollTiles, 0, args.snapshot.height - 1)
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
function terrainAt$1(course, point2) {
  const x = Math.max(0, Math.min(course.width - 1, Math.round(point2.x)));
  const y = Math.max(0, Math.min(course.height - 1, Math.round(point2.y)));
  return course.tiles[y * course.width + x] ?? "rough";
}
const clamp$9 = (value, min, max) => Math.max(min, Math.min(max, value));
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
function distance$3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function unit(a, b) {
  const d = Math.max(1e-3, distance$3(a, b));
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
function pointAt$1(a, b, fraction, offset = 0) {
  const u = unit(a, b);
  return { x: a.x + (b.x - a.x) * fraction - u.y * offset, y: a.y + (b.y - a.y) * fraction + u.x * offset };
}
function inBounds$1(course, point2) {
  return point2.x >= 0 && point2.y >= 0 && point2.x < course.width && point2.y < course.height;
}
function targetNear(course, raw, preferSafe) {
  const candidates = [];
  for (let radius = 0; radius <= 5; radius++) {
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
      const candidate = { x: Math.round(raw.x + x), y: Math.round(raw.y + y) };
      if (inBounds$1(course, candidate) && playable.has(terrainAt$1(course, candidate))) candidates.push(candidate);
    }
    if (candidates.length) break;
  }
  if (!candidates.length) return { x: clamp$9(Math.round(raw.x), 0, course.width - 1), y: clamp$9(Math.round(raw.y), 0, course.height - 1) };
  return candidates.sort((a, b) => {
    const terrainScore = (point2) => {
      const terrain = terrainAt$1(course, point2);
      if (terrain === "fairway" || terrain === "green" || terrain === "tee") return 0;
      if (terrain === "rough") return 1;
      if (terrain === "deep_rough") return 3;
      return 4;
    };
    return terrainScore(a) - terrainScore(b) || distance$3(a, raw) - distance$3(b, raw) || a.y - b.y || a.x - b.x;
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
  const d = distance$3(from, target) * 10;
  const names = lie === "green" ? ["Putter", "Chip"] : kind === "hero" ? ["Driver", "3 Wood", "5 Iron"] : kind === "safe" ? ["3 Wood", "5 Iron", "Driver"] : ["Driver", "3 Wood", "5 Iron", "7 Iron", "Pitching Wedge"];
  const available = names.filter((name2) => CLUBS[name2]);
  const name = available.find((candidate) => CLUBS[candidate].carry * 1.1 >= d) ?? available[available.length - 1] ?? "7 Iron";
  const carry = CLUBS[name].carry * (0.84 + capabilities.power / 480);
  return { name, power: clamp$9(d / Math.max(1, carry), 0.35, kind === "hero" ? 1.12 : 0.98) };
}
function candidateTarget(course, hole, kind) {
  const tee2 = hole.tee;
  const green2 = hole.green;
  if (kind === "hero" || kind === "approach") return { ...green2 };
  if (kind === "safe") return targetNear(course, pointAt$1(tee2, green2, 0.66, 0));
  if (kind === "positional") {
    const waypoint = hole.waypoints?.[0];
    return targetNear(course, waypoint ? { ...waypoint } : pointAt$1(tee2, green2, 0.58, 3.5));
  }
  return targetNear(course, pointAt$1(tee2, green2, 0.46, -3.5));
}
function buildIntent(args) {
  const from = { ...args.hole.tee };
  const target = candidateTarget(args.course, args.hole, args.kind);
  const club = chooseClub(args.kind, from, target, args.capabilities, terrainAt$1(args.course, from));
  const clubSpec = args.profile.clubs.find((candidate) => candidate.name === club.name) ?? args.profile.clubs[0];
  const evaluation = evalShotExpectedCost({ course: args.course, from, to: target, golfer: args.profile, club: clubSpec });
  const terrain = terrainAt$1(args.course, target);
  const terrainRisk = terrain === "water" || terrain === "wetland" ? 0.95 : terrain === "deep_rough" ? 0.46 : terrain === "sand" || terrain === "waste_area" ? 0.32 : 0.08;
  const distanceRisk = clamp$9(evaluation.utilization - 0.82, 0, 0.4);
  const hazardRisk2 = clamp$9(terrainRisk + distanceRisk + clubSpec.dispersionTilesBase / 14, 0, 1);
  const variance = clamp$9((100 - args.capabilities.consistency) / 100 * 0.65 + hazardRisk2 * 0.35, 0.05, 1);
  const nextShotQuality = clamp$9((terrain === "fairway" || terrain === "green" ? 0.82 : terrain === "rough" ? 0.55 : 0.3) + args.capabilities.irons / 500, 0, 1);
  const capability = args.kind === "hero" ? args.capabilities.power : args.kind === "safe" ? args.capabilities.accuracy : args.kind === "recovery" ? args.capabilities.recovery : args.capabilities.irons;
  const facts = [
    { code: "capability-fit", detail: `${args.kind}:${Math.round(capability)}` },
    { code: "risk", detail: `hazard:${Math.round(hazardRisk2 * 100)}% variance:${Math.round(variance * 100)}%` },
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
    expectedStrokes: 1 + Math.max(0, evaluation.expectedShotCost - 1) + hazardRisk2 * (1.25 - args.capabilities.riskTolerance),
    variance,
    hazardRisk: hazardRisk2,
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
  const kind = args.lie === "rough" || args.lie === "deep_rough" || args.lie === "sand" || args.lie === "waste_area" ? "recovery" : distance$3(args.from, target) <= 5 ? "approach" : "positional";
  const profile = profileFor(args.capabilities, args.course);
  const intent = buildIntent({ course: args.course, hole: { ...args.hole, tee: args.from, green: target }, kind, capabilities: args.capabilities, personality: args.personality, profile });
  return { ...intent, id: `${args.hole.id ?? "hole"}-follow-${args.shotNumber}`, from: { ...args.from } };
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).filter((key2) => record[key2] !== void 0).sort().map((key2) => `${JSON.stringify(key2)}:${canonical(record[key2])}`).join(",")}}`;
}
function hashCanonicalValue(value) {
  const text2 = canonical(value);
  let hash = 2166136261;
  for (let i = 0; i < text2.length; i++) {
    hash ^= text2.charCodeAt(i);
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
const M48_STRATEGY_VERSION = 1;
const M48_DEFAULT_SAMPLES = 8;
const M48_MAX_HOLES = 36;
const M48_MAX_OPTIONS = 6;
const cache$2 = /* @__PURE__ */ new Map();
const clamp$8 = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round$3 = (value, digits = 3) => Number(value.toFixed(digits));
const HAZARDS = /* @__PURE__ */ new Set(["water", "wetland", "sand", "waste_area", "deep_rough"]);
const personality = (skill, consistency, difficulty, scenery = 0) => ({
  skill,
  consistency,
  patience: difficulty < 0 ? 0.78 : 0.5,
  spendPropensity: 0.5,
  prefs: { difficulty, scenery, price: 0 }
});
function m48Cohorts(seed = 480001) {
  const definitions = [
    ["power", "Power player", "Long carry creates opportunities, but accuracy and recovery still matter.", personality(0.82, 0.68, 0.55)],
    ["accuracy", "Accuracy player", "Dispersion control makes narrow safe lines and precise layups valuable.", personality(0.72, 0.95, -0.05)],
    ["shortGame", "Short-game player", "Approach, run-up, and putting skill can rescue a conservative line.", personality(0.64, 0.9, -0.1)],
    ["recovery", "Recovery player", "Misses are acceptable when the design leaves a playable recovery.", personality(0.58, 0.86, 0.15)],
    ["casual", "Casual golfer", "A fair route and visible mercy matter more than a forced test of skill.", personality(0.36, 0.42, -0.78, 0.45)]
  ];
  return definitions.map(([id, label, explanation, p], index) => ({
    id,
    label,
    explanation,
    capabilities: createGolferCapabilities({ personality: p, seed: seed + index * 977 >>> 0 })
  }));
}
function strategicGeometryVersion(course) {
  return `m48-${hashCanonicalValue({
    width: course.width,
    height: course.height,
    tiles: course.tiles,
    elevations: course.elevations,
    obstacles: course.obstacles,
    holes: course.holes.map((hole) => ({
      id: hole.id,
      tee: hole.tee,
      green: hole.green,
      teeBoxes: hole.teeBoxes,
      pinPositions: hole.pinPositions,
      waypoints: hole.waypoints
    }))
  })}`;
}
function inBounds(course, point2) {
  return point2.x >= 0 && point2.y >= 0 && point2.x < course.width && point2.y < course.height;
}
function terrainAt(course, point2) {
  const x = Math.round(point2.x);
  const y = Math.round(point2.y);
  return x >= 0 && y >= 0 && x < course.width && y < course.height ? course.tiles[y * course.width + x] ?? null : null;
}
function distance$2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function pointAt(a, b, fraction, offset = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1e-3, Math.hypot(dx, dy));
  return { x: a.x + dx * fraction - dy / length * offset, y: a.y + dy * fraction + dx / length * offset };
}
function routePoints(hole) {
  if (!hole.tee || !hole.green) return [];
  return [hole.tee, ...hole.waypoints ?? [], hole.green];
}
function densePath(points, samples = 24) {
  if (points.length < 2) return points.slice();
  const segments = points.slice(1).map((point2, index) => [points[index], point2]);
  const total = segments.reduce((sum, [from, to]) => sum + distance$2(from, to), 0);
  if (!total) return [points[0]];
  const result = [];
  for (let index = 0; index < samples; index++) {
    let remaining = total * (index / Math.max(1, samples - 1));
    for (const [from, to] of segments) {
      const length = distance$2(from, to);
      if (remaining <= length || to === segments[segments.length - 1][1]) {
        const fraction = length ? remaining / length : 0;
        result.push({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
        break;
      }
      remaining -= length;
    }
  }
  return result;
}
function hazardRisk(terrain) {
  if (terrain === "water" || terrain === "wetland") return 0.98;
  if (terrain === "deep_rough") return 0.58;
  if (terrain === "waste_area") return 0.46;
  if (terrain === "sand") return 0.36;
  if (terrain === "rough") return 0.14;
  return terrain ? 0.03 : 1;
}
function lineFacts(course, path) {
  const samples = densePath(path, Math.max(28, Math.ceil(computePathDistanceTiles(path) * 2)));
  let risk = 0;
  let visual = 0;
  let safe = 0;
  let longestHazard = 0;
  let currentHazard = 0;
  for (const point2 of samples) {
    const terrain = terrainAt(course, point2);
    const riskAtPoint = hazardRisk(terrain);
    risk += riskAtPoint;
    if (HAZARDS.has(terrain)) {
      currentHazard++;
      visual += terrain === "water" || terrain === "wetland" ? 1 : 0.45;
    } else {
      safe++;
      longestHazard = Math.max(longestHazard, currentHazard);
      currentHazard = 0;
    }
  }
  longestHazard = Math.max(longestHazard, currentHazard);
  const count = Math.max(1, samples.length);
  return {
    hazardRisk: clamp$8(risk / count),
    safeSurface: clamp$8(safe / count),
    visualChallenge: clamp$8(visual / count * 1.45),
    contiguousHazard: longestHazard / count,
    sampleCount: samples.length
  };
}
function deterministic(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value = Math.imul(value ^ value >>> 15, 1 | value);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function optionPath(course, hole, kind) {
  const tee2 = hole.tee;
  const green2 = hole.green;
  if (!tee2 || !green2) return [];
  const waypoint = hole.waypoints?.[0];
  if (kind === "hero") return [tee2, green2];
  if (kind === "positional") return waypoint ? [tee2, waypoint, green2] : [tee2, pointAt(tee2, green2, 0.58, 3), green2];
  if (kind === "runup") return [tee2, pointAt(tee2, green2, 0.72, -3.5), green2];
  if (kind === "recovery") return [tee2, pointAt(tee2, green2, 0.42, -4.5), pointAt(tee2, green2, 0.72, -4.5), green2];
  const candidates = [
    [tee2, pointAt(tee2, green2, 0.56, 4.5), pointAt(tee2, green2, 0.78, 4.5), green2],
    [tee2, pointAt(tee2, green2, 0.56, -4.5), pointAt(tee2, green2, 0.78, -4.5), green2],
    waypoint ? [tee2, waypoint, green2] : [tee2, pointAt(tee2, green2, 0.66, 0), green2]
  ];
  return candidates.map((path) => ({ path, risk: lineFacts(course, path).hazardRisk, distance: computePathDistanceTiles(path) })).sort((a, b) => a.risk - b.risk || a.distance - b.distance)[0].path;
}
function planKind(kind) {
  return kind === "runup" ? "positional" : kind;
}
function setupKey(hole, teeSet, pinRotation) {
  const resolved = resolveCourseSetup(hole, teeSet, pinRotation);
  return { teeSet: resolved.teeSet, pinRotation: resolved.pinRotation, usedTeeFallback: resolved.usedTeeFallback, usedPinFallback: resolved.usedPinFallback };
}
function evaluateOption(args) {
  const path = optionPath(args.course, args.hole, args.kind);
  const facts = lineFacts(args.course, path);
  const plan = generateStrategicHolePlan({
    course: args.course,
    hole: args.hole,
    par: args.par,
    capabilities: args.cohort.capabilities,
    personality: personality(0.5, args.cohort.capabilities.consistency / 100, args.cohort.capabilities.riskTolerance > 0.66 ? 0.6 : -0.15)
  });
  const relevant = [plan.chosen, ...plan.rejected.map((item) => ({ expectedStrokes: item.expectedStrokes, kind: item.kind }))].find((candidate) => candidate.kind === planKind(args.kind)) ?? plan.chosen;
  const powerCarry = 2.2 + args.cohort.capabilities.power / 55;
  const forcedCarry = clamp$8(facts.contiguousHazard * computePathDistanceTiles(path) / Math.max(3, 3 + powerCarry * 1.2));
  const skillRiskReduction = args.cohort.capabilities.accuracy / 100 * 0.22 + args.cohort.capabilities.recovery / 100 * 0.13;
  const adjustedRisk = clamp$8((facts.hazardRisk + facts.contiguousHazard * 0.42) * (1 - skillRiskReduction));
  const viable = facts.safeSurface >= 0.42 && forcedCarry < 0.7 && adjustedRisk < 0.62;
  const riskPenalty = adjustedRisk * (1.18 - args.cohort.capabilities.riskTolerance * 0.42) + forcedCarry * (1 - args.cohort.capabilities.riskTolerance) * 0.78;
  const capabilityBonus = args.kind === "hero" ? args.cohort.capabilities.power / 650 : args.kind === "safe" ? args.cohort.capabilities.accuracy / 720 : args.cohort.capabilities.shortGame / 740;
  const base = Number.isFinite(relevant.expectedStrokes) ? relevant.expectedStrokes : args.par + 1;
  const rng = deterministic(args.seed);
  const scores = [];
  for (let index = 0; index < args.samples; index++) {
    const noise = (rng() - 0.5) * (1 - args.cohort.capabilities.consistency / 100) * 0.62;
    scores.push(Math.max(1, base + riskPenalty - capabilityBonus + noise));
  }
  const expected = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
  const variance = scores.reduce((sum, value) => sum + (value - expected) ** 2, 0) / Math.max(1, scores.length);
  const bailoutQuality = clamp$8(facts.safeSurface * (1 - adjustedRisk) * (args.kind === "safe" || args.kind === "recovery" ? 1.12 : 0.72));
  const heroReward = 0;
  return {
    id: `${args.hole.id ?? "hole"}-${args.kind}`,
    kind: args.kind,
    label: args.kind === "hero" ? "Hero line" : args.kind === "safe" ? "Safe route" : args.kind === "runup" ? "Run-up" : args.kind === "recovery" ? "Recovery line" : "Positional line",
    geometry: path,
    location: path[Math.floor(path.length / 2)] ?? args.hole.green ?? args.hole.tee,
    viable,
    safeSurface: round$3(facts.safeSurface),
    hazardRisk: round$3(adjustedRisk),
    forcedCarryBurden: round$3(forcedCarry),
    bailoutQuality: round$3(bailoutQuality),
    heroLineReward: round$3(heroReward),
    expectedStrokes: round$3(expected),
    variance: round$3(variance),
    recoveryBurden: round$3(adjustedRisk * (1 - args.cohort.capabilities.recovery / 100)),
    sampleCount: args.samples,
    sampleStatus: args.samples > 0 ? "simulated" : "insufficient",
    facts: [
      `surface:${Math.round(facts.safeSurface * 100)}%`,
      `hazard:${Math.round(adjustedRisk * 100)}%`,
      `carry:${Math.round(forcedCarry * 100)}%`,
      `capability:${args.cohort.capabilities.strengths.join(",")}`
    ]
  };
}
function holeEvaluation(args) {
  const id = `${args.hole.id ?? `hole-${args.holeIndex + 1}`}:${args.setup.teeSet}:${args.setup.pinRotation}`;
  if (!args.hole.tee || !args.hole.green || !inBounds(args.course, args.hole.tee) || !inBounds(args.course, args.hole.green)) {
    return { version: M48_STRATEGY_VERSION, id, holeId: args.hole.id ?? `hole-${args.holeIndex + 1}`, holeIndex: args.holeIndex, setup: args.setup, geometryVersion: args.geometryVersion, status: "incomplete", sampleCount: 0, safeRouteViability: 0, optionCount: 0, forcedCarryBurden: 0, bailoutQuality: 0, heroLineReward: 0, expectedStrokes: 0, variance: 0, recoveryBurden: 0, visualChallenge: 0, fairnessFloor: 0, strategicSeparation: 0, unavoidablePunishment: 0, cohorts: [], options: [], warnings: ["Complete the tee and pin setup before evaluating strategy."] };
  }
  const parSetting = getParSetting(args.hole, args.setup.teeSet);
  const par = parSetting.mode === "MANUAL" ? parSetting.par : computeAutoPar(computePathDistanceTiles(routePoints(args.hole)));
  const definitions = m48Cohorts(args.seed);
  const kinds = ["safe", "hero", "positional", "runup", "recovery"];
  const options = definitions.flatMap((cohort, cohortIndex) => kinds.map((kind) => evaluateOption({ course: args.course, hole: args.hole, cohort, kind, samples: args.samples, seed: args.seed + cohortIndex * 101 + kinds.indexOf(kind) * 17, par })));
  const byKind = kinds.map((kind) => options.filter((option2) => option2.kind === kind));
  const optionSummary = byKind.map((items) => ({ ...items[0], expectedStrokes: items.reduce((sum, item) => sum + item.expectedStrokes, 0) / Math.max(1, items.length), viable: items.some((item) => item.viable), bailoutQuality: items.reduce((sum, item) => sum + item.bailoutQuality, 0) / Math.max(1, items.length), forcedCarryBurden: items.reduce((sum, item) => sum + item.forcedCarryBurden, 0) / Math.max(1, items.length), heroLineReward: items.reduce((sum, item) => sum + item.heroLineReward, 0) / Math.max(1, items.length) }));
  const cohortEvidence = definitions.map((cohort) => {
    const items = options.filter((option2) => option2.facts.some((fact2) => fact2 === `capability:${cohort.capabilities.strengths.join(",")}`));
    const safeItem = items.find((item) => item.kind === "safe");
    const heroItem = items.find((item) => item.kind === "hero");
    if (safeItem && heroItem) heroItem.heroLineReward = round$3(clamp$8((safeItem.expectedStrokes - heroItem.expectedStrokes) / 2));
    const viable = items.filter((item) => item.viable);
    const ordered = items.slice().sort((a, b) => a.expectedStrokes - b.expectedStrokes || a.id.localeCompare(b.id));
    const preferred = ordered[0];
    const mean = items.length ? items.reduce((sum, item) => sum + item.expectedStrokes, 0) / items.length : args.course.yardsPerTile;
    return {
      cohortId: cohort.id,
      viability: round$3(clamp$8((viable.length ? viable.length / Math.max(1, items.length) : 0) * 0.65 + (preferred?.viable ? 0.35 : 0)) * 100, 1),
      preferredOption: preferred?.kind ?? null,
      expectedStrokes: round$3(preferred?.expectedStrokes ?? mean, 2),
      variance: round$3(preferred?.variance ?? 1, 3),
      recoveryBurden: round$3(preferred?.recoveryBurden ?? 1, 3),
      skillAdvantageDelta: 0,
      options: items.map((item) => ({ optionId: item.id, viable: item.viable, expectedStrokes: item.expectedStrokes, variance: item.variance, advantageDelta: 0 })),
      facts: [`${viable.length} of ${items.length} options remain viable`, `preferred:${preferred?.label ?? "none"}`]
    };
  });
  const meanExpected = cohortEvidence.length ? cohortEvidence.reduce((sum, item) => sum + item.expectedStrokes, 0) / cohortEvidence.length : 0;
  for (const cohort of cohortEvidence) {
    cohort.skillAdvantageDelta = round$3(meanExpected - cohort.expectedStrokes, 2);
    cohort.options = cohort.options.map((item) => ({ ...item, advantageDelta: round$3(meanExpected - item.expectedStrokes, 2) }));
  }
  const safe = cohortEvidence.length ? cohortEvidence.reduce((sum, item) => sum + item.viability, 0) / cohortEvidence.length : 0;
  const optionCount = optionSummary.filter((item) => item.viable && item.bailoutQuality > 0.18).length;
  const fairnessFloor = Math.min(...cohortEvidence.map((item) => item.viability), 0);
  const separation = cohortEvidence.length ? clamp$8((Math.max(...cohortEvidence.map((item) => item.skillAdvantageDelta), 0) - Math.min(...cohortEvidence.map((item) => item.skillAdvantageDelta), 0)) / 2) * 100 : 0;
  const hero = optionSummary.find((item) => item.kind === "hero");
  const safeOption = optionSummary.find((item) => item.kind === "safe");
  const forcedCarry = hero?.forcedCarryBurden ?? 0;
  const unavoidable = clamp$8(1 - optionSummary.filter((item) => item.viable).length / kinds.length);
  const visualChallenge = clamp$8(optionSummary.reduce((sum, item) => sum + item.hazardRisk, 0) / Math.max(1, optionSummary.length) * 1.1) * 100;
  const warnings = [];
  if (fairnessFloor < 42) warnings.push("One or more representative cohorts have no fair route.");
  if (optionCount < 2) warnings.push("The design offers fewer than two meaningful options.");
  if (forcedCarry > 0.72 && unavoidable > 0.5) warnings.push("The most visible challenge behaves like an unavoidable carry.");
  if (separation < 8) warnings.push("The hole does not visibly reward a distinct capability.");
  return {
    version: M48_STRATEGY_VERSION,
    id,
    holeId: args.hole.id ?? `hole-${args.holeIndex + 1}`,
    holeIndex: args.holeIndex,
    setup: args.setup,
    geometryVersion: args.geometryVersion,
    status: "complete",
    sampleCount: args.samples,
    safeRouteViability: round$3(safe, 1),
    optionCount,
    forcedCarryBurden: round$3(forcedCarry * 100, 1),
    bailoutQuality: round$3((safeOption?.bailoutQuality ?? 0) * 100, 1),
    heroLineReward: round$3((hero?.heroLineReward ?? 0) * 100, 1),
    expectedStrokes: round$3(meanExpected, 2),
    variance: round$3(cohortEvidence.reduce((sum, item) => sum + item.variance, 0) / Math.max(1, cohortEvidence.length), 3),
    recoveryBurden: round$3(cohortEvidence.reduce((sum, item) => sum + item.recoveryBurden, 0) / Math.max(1, cohortEvidence.length), 3),
    visualChallenge: round$3(visualChallenge, 1),
    fairnessFloor: round$3(fairnessFloor, 1),
    strategicSeparation: round$3(separation, 1),
    unavoidablePunishment: round$3(unavoidable * 100, 1),
    cohorts: cohortEvidence,
    options: optionSummary.slice(0, M48_MAX_OPTIONS).map((option2) => ({ ...option2, expectedStrokes: round$3(option2.expectedStrokes), bailoutQuality: round$3(option2.bailoutQuality), forcedCarryBurden: round$3(option2.forcedCarryBurden), heroLineReward: round$3(option2.heroLineReward) })),
    warnings
  };
}
function availableSetups(hole) {
  const tees = ["forward", "member", "championship"].filter((set) => !!getTeeBox(hole, set));
  const pins = ["A", "B", "C"].filter((rotation) => !!getPinPosition(hole, rotation));
  const resolvedTees = tees.length ? tees : ["member"];
  const resolvedPins = pins.length ? pins : ["A"];
  return resolvedTees.flatMap((teeSet) => resolvedPins.map((pinRotation) => ({ teeSet, pinRotation })));
}
function evaluateStrategicArchitecture(course, options = {}) {
  const selected = courseForLayout(course, options.courseId ?? course.activeCourseId);
  const samplesPerOption = Math.max(0, Math.min(M48_DEFAULT_SAMPLES, Math.floor(options.samplesPerOption ?? M48_DEFAULT_SAMPLES)));
  const geometryVersion = strategicGeometryVersion(selected);
  const conditionKey = Math.round(clamp$8(selected.condition, 0, 1) * 100);
  const key2 = `${selected.activeCourseId ?? "course"}:${geometryVersion}:${conditionKey}:${samplesPerOption}:${options.seed ?? 480001}`;
  const cached = cache$2.get(key2);
  if (cached) return cached;
  const published = selected.holes.slice(0, M48_MAX_HOLES);
  const holes = [];
  for (let holeIndex = 0; holeIndex < published.length; holeIndex++) {
    const sourceHole = published[holeIndex];
    for (const setup of availableSetups(sourceHole)) {
      const resolved = resolveCourseSetup(sourceHole, setup.teeSet, setup.pinRotation);
      const parSetting = getParSetting(sourceHole, resolved.teeSet);
      const hole = { ...sourceHole, tee: resolved.tee, green: resolved.pin, parMode: parSetting.mode, parManual: parSetting.mode === "MANUAL" ? parSetting.par : void 0 };
      holes.push(holeEvaluation({ course: selected, hole, holeIndex, setup: setupKey(sourceHole, setup.teeSet, setup.pinRotation), geometryVersion, samples: samplesPerOption, seed: (options.seed ?? 480001) + holeIndex * 811 + setup.teeSet.length * 31 + setup.pinRotation.charCodeAt(0) }));
    }
  }
  const result = { version: M48_STRATEGY_VERSION, geometryVersion, courseId: selected.activeCourseId ?? "course-primary", conditionKey, samplesPerOption, holes, cohorts: m48Cohorts(options.seed ?? 480001) };
  cache$2.set(key2, result);
  return result;
}
const clamp$7 = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round$2 = (value, digits = 1) => Number(value.toFixed(digits));
const COHORTS$1 = ["power", "accuracy", "shortGame", "recovery", "casual"];
function holeWarnings(hole) {
  const warnings = hole.warnings.slice();
  const greenFunnel = hole.optionCount <= 1 && hole.options.some((option2) => option2.kind === "hero" && option2.hazardRisk > 0.65);
  if (greenFunnel) warnings.push("Funnel-like finish: most cohorts are rewarded for the same narrow landing.");
  if (hole.options.filter((option2) => option2.viable).length >= 2 && hole.options.every((option2) => Math.abs(option2.expectedStrokes - hole.expectedStrokes) < 0.08)) warnings.push("Fake choice: alternate lines exist but do not change the decision.");
  if (hole.options.filter((option2) => option2.hazardRisk > 0.65).length >= 3) warnings.push("Hazard spam: too many visible options carry severe risk.");
  return [...new Set(warnings)];
}
function holeScore(hole) {
  const warnings = holeWarnings(hole);
  const cohortScores = hole.cohorts.map((cohort) => cohort.skillAdvantageDelta);
  const favoredCohorts = hole.cohorts.slice().sort((a, b) => b.skillAdvantageDelta - a.skillAdvantageDelta || a.cohortId.localeCompare(b.cohortId)).filter((cohort) => cohort.skillAdvantageDelta >= 0.12).map((cohort) => cohort.cohortId);
  const fairness = hole.status === "complete" ? hole.fairnessFloor : 0;
  const genuineChoice = clamp$7(hole.optionCount / 3 * 100 - (warnings.some((warning) => warning.startsWith("Fake choice")) ? 24 : 0));
  const spectacleWithMercy = clamp$7(hole.visualChallenge * 0.56 + hole.safeRouteViability * 0.44 - hole.unavoidablePunishment * 0.34);
  const separation = clamp$7(Math.abs(Math.max(...cohortScores, 0) - Math.min(...cohortScores, 0)) * 24);
  const penalties = warnings.length * 4 + hole.unavoidablePunishment * 0.18;
  const strategicScore = round$2(clamp$7(fairness * 0.34 + genuineChoice * 0.24 + spectacleWithMercy * 0.2 + separation * 0.22 - penalties));
  return {
    holeId: hole.holeId,
    setup: hole.setup,
    strategicScore,
    fairnessFloor: fairness,
    genuineChoice: round$2(genuineChoice),
    spectacleWithMercy: round$2(spectacleWithMercy),
    strategyWarnings: warnings,
    favoredCohorts,
    opportunityCount: favoredCohorts.length
  };
}
function entropy(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total || values.length <= 1) return 0;
  return clamp$7(-values.reduce((sum, value) => {
    if (!value) return sum;
    const share = value / total;
    return sum + share * Math.log(share);
  }, 0) / Math.log(values.length) * 100);
}
function portfolioSummary(holes, evaluation) {
  const complete = evaluation.holes.filter((hole) => hole.status === "complete");
  const scores = holes.map((hole) => hole.strategicScore);
  const favoredCohorts = Object.fromEntries(COHORTS$1.map((cohort) => [cohort, holes.filter((hole) => hole.favoredCohorts.includes(cohort)).length]));
  const warningCount = (prefix) => holes.filter((hole) => hole.strategyWarnings.some((warning) => warning.toLowerCase().startsWith(prefix))).length;
  const oneDominant = holes.length && Math.max(...Object.values(favoredCohorts)) / holes.length > 0.7 ? 100 : 0;
  const repeated = holes.length > 1 && holes.every((hole) => hole.favoredCohorts[0] === holes[0].favoredCohorts[0]) ? 100 : 0;
  const opportunityRotation = entropy(Object.values(favoredCohorts));
  const average2 = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const fairnessFloor = complete.length ? complete.reduce((sum, hole) => sum + hole.fairnessFloor, 0) / complete.length : 0;
  const strategicSeparation = complete.length ? complete.reduce((sum, hole) => sum + hole.strategicSeparation, 0) / complete.length : 0;
  const genuineChoice = complete.length ? complete.reduce((sum, hole) => sum + clamp$7(hole.optionCount / 3 * 100), 0) / complete.length : 0;
  const spectacleWithMercy = complete.length ? complete.reduce((sum, hole) => sum + clamp$7(hole.visualChallenge * 0.56 + hole.safeRouteViability * 0.44), 0) / complete.length : 0;
  const penalties = {
    funnelGreens: warningCount("funnel-like"),
    fakeChoices: warningCount("fake choice"),
    mandatoryCarries: complete.filter((hole) => hole.unavoidablePunishment > 50).length,
    hazardSpam: warningCount("hazard spam"),
    repetitiveStrategy: repeated ? Math.max(1, holes.length - 1) : 0,
    oneCohortDominance: oneDominant
  };
  const penaltyPoints = penalties.funnelGreens * 5 + penalties.fakeChoices * 4 + penalties.mandatoryCarries * 5 + penalties.hazardSpam * 3 + (penalties.repetitiveStrategy ? 8 : 0) + penalties.oneCohortDominance * 0.12;
  const total = round$2(clamp$7(average2 * 0.22 + fairnessFloor * 0.27 + strategicSeparation * 0.15 + genuineChoice * 0.17 + spectacleWithMercy * 0.11 + opportunityRotation * 0.08 - penaltyPoints));
  return { total, fairnessFloor: round$2(fairnessFloor), strategicSeparation: round$2(strategicSeparation), genuineChoice: round$2(genuineChoice), spectacleWithMercy: round$2(spectacleWithMercy), opportunityRotation: round$2(opportunityRotation), penalties, favoredCohorts, holeCount: holes.length };
}
function buildStrategicPortfolio(course, options = {}) {
  const evaluation = evaluateStrategicArchitecture(course, options);
  const holes = evaluation.holes.map(holeScore);
  return { evaluation, holes, summary: portfolioSummary(holes, evaluation) };
}
const WEIGHTS = {
  routing: 0.25,
  naturalFit: 0.25,
  variety: 0.2,
  safety: 0.15,
  walkability: 0.15
};
const cache$1 = /* @__PURE__ */ new WeakMap();
const clamp$6 = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round$1 = (value, digits = 1) => Number(value.toFixed(digits));
const distance$1 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: round$1((a.x + b.x) / 2), y: round$1((a.y + b.y) / 2) });
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
  return { id, label, score: round$1(clamp$6(score)), weight: WEIGHTS[id], explanation, raw };
}
function routeSegments(hole) {
  const points = route(hole);
  return points.slice(1).map((point2, index) => [points[index], point2]);
}
function routedTransfer(course, from, to) {
  if (!course.estate) return { length: distance$1(from, to), path: [from, to] };
  const routed = findWalkPath(course, from, to, 1500);
  const path = routed ? [from, ...routed] : null;
  return { length: path ? computePathDistanceTiles(path) : distance$1(from, to) * 1.4, path };
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
  const score = retainedPercent * 0.72 + clamp$6(100 - earthworkPer100 * 13) * 0.28;
  if (earthworkPer100 > 2.5) warnings.push({ id: "earthwork-heavy", kind: "earthwork", severity: "warning", message: "Extensive earthwork weakens the course's relationship with its surveyed contours.", holeIds: [], measurement: `${round$1(earthworkPer100)} elevation steps per 100 tiles` });
  if (retainedPercent < 72) warnings.push({ id: "terrain-retention", kind: "terrain", severity: "info", message: "A large share of the natural surface has been rebuilt.", holeIds: [], measurement: `${round$1(retainedPercent)}% natural terrain retained` });
  return component("naturalFit", "Natural fit", score, `${round$1(retainedPercent)}% of surveyed terrain remains; earthwork averages ${round$1(earthworkPer100)} steps per 100 tiles.`, { retainedTerrainPercent: round$1(retainedPercent), changedTiles: changed, earthworkSteps: earthwork, earthworkStepsPer100Tiles: round$1(earthworkPer100) });
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
    const direct = distance$1(points[0], points[points.length - 1]);
    shapes.add(points.length > 2 && length > direct * 1.12 ? "dogleg" : "straight");
    for (const [a, b] of routeSegments(hole)) {
      const steps = Math.max(1, Math.ceil(distance$1(a, b)));
      for (let step = 0; step <= steps; step++) {
        const x = Math.max(0, Math.min(course.width - 1, Math.round(a.x + (b.x - a.x) * step / steps)));
        const y = Math.max(0, Math.min(course.height - 1, Math.round(a.y + (b.y - a.y) * step / steps)));
        const terrain = course.tiles[y * course.width + x];
        if (terrain === "water" || terrain === "wetland" || terrain === "sand" || terrain === "waste_area") hazardMix.add(terrain);
        if (terrain === "water" || terrain === "wetland" || terrain === "deep_rough" || terrain === "sand") sceneryMix.add(terrain);
      }
    }
  }
  const score = holes.length === 0 ? 0 : clamp$6(pars.size / 3 * 22 + lengthBands.size / 4 * 18 + directions.size / 6 * 24 + shapes.size / 2 * 14 + hazardMix.size / 4 * 12 + sceneryMix.size / 4 * 10);
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
    if (length > 18) warnings.push({ id: `transfer-${holes[index].id}-${holes[index + 1].id}`, kind: "transfer", severity: length > 30 ? "warning" : "info", message: `The transfer from ${holes[index].name ?? `hole ${index + 1}`} to ${holes[index + 1].name ?? `hole ${index + 2}`} is long.`, holeIds: [holes[index].id, holes[index + 1].id], location: midpoint(from, to), geometry: transfer.path ?? [from, to], measurement: `${round$1(length)} routed tiles` });
  }
  const firstDistance = home && holes.length ? routedTransfer(course, home, tee(holes[0])).length : 0;
  const finalDistance = home && holes.length ? routedTransfer(course, green(holes[holes.length - 1]), home).length : 0;
  const ninthDistance = home && holes.length >= 9 ? routedTransfer(course, green(holes[8]), home).length : 0;
  const averageTransfer = transfers.length ? transfers.reduce((sum, value) => sum + value, 0) / transfers.length : 0;
  const totalWalk = transfers.reduce((sum, value) => sum + value, 0) + firstDistance + finalDistance;
  const transferScore = clamp$6(100 - Math.max(0, averageTransfer - 6) * 3.2);
  const homeScore = home ? clamp$6(100 - (firstDistance + finalDistance) * 1.6 - Math.max(0, ninthDistance - 14) * 1.2) : 55;
  const compactScore = holes.length ? clamp$6(100 - totalWalk / holes.length * 2.1) : 0;
  const routingScore = transferScore * 0.42 + homeScore * 0.38 + compactScore * 0.2;
  const walkabilityScore = transferScore * 0.58 + compactScore * 0.27 + routedTransfers / Math.max(1, transfers.length) * 100 * 0.15;
  if (home && firstDistance > 18) warnings.push({ id: "clubhouse-first", kind: "clubhouse", severity: "warning", message: "The first tee sits far from the shared clubhouse.", holeIds: holes[0]?.id ? [holes[0].id] : [], location: tee(holes[0]), geometry: [home, tee(holes[0])], measurement: `${round$1(firstDistance)} routed tiles` });
  if (home && finalDistance > 18) warnings.push({ id: "clubhouse-final", kind: "clubhouse", severity: "warning", message: "The final green finishes far from the shared clubhouse.", holeIds: lastItem(holes)?.id ? [lastItem(holes).id] : [], location: green(lastItem(holes)), geometry: [green(lastItem(holes)), home], measurement: `${round$1(finalDistance)} routed tiles` });
  return {
    routing: component("routing", "Routing", routingScore, `Published order averages ${round$1(averageTransfer)} tiles between holes; first/final clubhouse access totals ${round$1(firstDistance + finalDistance)} tiles.`, { averageTransferTiles: round$1(averageTransfer), firstTeeClubhouseTiles: round$1(firstDistance), finalGreenClubhouseTiles: round$1(finalDistance), ninthGreenClubhouseTiles: round$1(ninthDistance), totalTransferTiles: round$1(totalWalk), compactnessScore: round$1(compactScore) }),
    walkability: component("walkability", "Walkability", walkabilityScore, `${routedTransfers} of ${transfers.length} green-to-tee transfers use playable routed paths; total off-hole walking is ${round$1(totalWalk)} tiles.`, { routedTransfers, transferCount: transfers.length, averageTransferTiles: round$1(averageTransfer), totalWalkingTiles: round$1(totalWalk) })
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
      warnings.push({ id: `repeat-${holes[index - 1].id}-${holes[index].id}`, kind: "repetition", severity: "info", message: "Consecutive holes repeat a similar direction and length.", holeIds: [holes[index - 1].id, holes[index].id], location: midpoint(previous[0], current[0]), measurement: `${round$1(directionDelta)}° direction and ${round$1(lengthDelta)}-tile length difference` });
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
        const separation = distance$1(midpoint(a0, a1), midpoint(b0, b1));
        if (delta < 14 && separation < 6 && separation > 1.5) {
          parallels++;
          warnings.push({ id: `parallel-${holes[a].id}-${holes[b].id}-${parallels}`, kind: "parallel", severity: "warning", message: "Parallel shot corridors run close enough for wayward shots to overlap.", holeIds: [holes[a].id, holes[b].id], location: midpoint(midpoint(a0, a1), midpoint(b0, b1)), geometry: [a0, a1, b0, b1], measurement: `${round$1(separation)} tiles apart` });
        }
      }
    }
  }
  const score = clamp$6(100 - crossings * 18 - parallels * 8 - repetitions * 5);
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
  const baseTotal = round$1(Object.values(components).reduce((sum, item) => sum + item.score * item.weight, 0));
  const strategic = buildStrategicPortfolio(course);
  const total = round$1(strategic.evaluation.holes.length ? baseTotal * 0.58 + strategic.summary.total * 0.42 : baseTotal);
  const report2 = { total, components, strategic, warnings: warnings.sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning") || a.id.localeCompare(b.id)), generatedFor: { courseId: course.activeCourseId, holeIds: course.holes.map((hole) => hole.id).filter(Boolean) } };
  cache$1.set(course, report2);
  return report2;
}
function architectureDemandMultiplier(course) {
  const score = analyzeArchitecture(course).total;
  const max = BALANCE.architecture.demandEffectMax;
  return 1 + (score - 50) / 50 * max;
}
function normalizeM48DesignTestSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw;
  if (candidate.version !== 1 || typeof candidate.id !== "string" || typeof candidate.courseId !== "string" || typeof candidate.holeId !== "string" || typeof candidate.geometryVersion !== "string") return null;
  if (candidate.teeSet !== "forward" && candidate.teeSet !== "member" && candidate.teeSet !== "championship") return null;
  if (candidate.pinRotation !== "A" && candidate.pinRotation !== "B" && candidate.pinRotation !== "C") return null;
  const stage = candidate.stage === "watched" || candidate.stage === "played" || candidate.stage === "returned" || candidate.stage === "compared" ? candidate.stage : "designed";
  return {
    version: 1,
    id: candidate.id,
    courseId: candidate.courseId,
    holeId: candidate.holeId,
    teeSet: candidate.teeSet,
    pinRotation: candidate.pinRotation,
    geometryVersion: candidate.geometryVersion,
    conditionKey: typeof candidate.conditionKey === "number" ? Math.max(0, Math.min(100, Math.round(candidate.conditionKey))) : 0,
    startedWeek: typeof candidate.startedWeek === "number" ? Math.max(1, Math.floor(candidate.startedWeek)) : 1,
    seed: typeof candidate.seed === "number" ? candidate.seed >>> 0 : 0,
    noEconomy: true,
    stage,
    selectedCohortId: candidate.selectedCohortId ?? null,
    selectedShotId: candidate.selectedShotId ?? null,
    before: candidate.before,
    after: candidate.after
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
    for (const option2 of definition.choices) {
      if (!option2.id || !option2.labelKey || !option2.previewKey) errors.push(`choice-copy:${definition.id}:${option2.id}`);
      if (option2.effects.some((effect) => !EFFECTS.has(effect.type))) errors.push(`effect:${definition.id}:${option2.id}`);
    }
  }
  for (const definition of definitions) for (const option2 of definition.choices) for (const effect of option2.effects) {
    if (effect.type === "scheduleCallback" && !ids.has(effect.eventId)) errors.push(`callback:${definition.id}:${effect.eventId}`);
  }
  return errors;
}
const VALIDATION_ERRORS$1 = validateStoryDefinitions();
if (VALIDATION_ERRORS$1.length) throw new Error(`Invalid M38 story definitions: ${VALIDATION_ERRORS$1.join(", ")}`);
const STORY_DEFINITION_BY_ID = new Map(SYSTEMIC_EVENT_DEFINITIONS.map((definition) => [definition.id, definition]));
const STAFF_TRAITS = ["steady", "meticulous", "mentor", "inventive", "warm", "frugal", "competitive", "safetyMinded"];
const clamp$5 = (value, min, max) => Math.max(min, Math.min(max, value));
const finite$3 = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
function hashText(text2) {
  let hash = 2166136261;
  for (let index = 0; index < text2.length; index++) {
    hash ^= text2.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function relationshipTier(score, rounds) {
  if (rounds >= 12 && score >= 60) return "clubIcon";
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
    architecture: { evidence: [], revisions: [], returnContext: null, testSession: null, comparison: null }
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
  const score = clamp$5(finite$3(regular.relationship?.score), -100, 100);
  const rounds = Math.max(0, Math.floor(finite$3(regular.rounds)));
  return {
    ...regular,
    kind: "regular",
    appearance: regular.appearance ?? appearanceFor(regular.id),
    skill: clamp$5(finite$3(regular.skill, 0.5), 0, 1),
    loyalty: clamp$5(finite$3(regular.loyalty, 50), 0, 100),
    visits: Math.max(rounds, Math.floor(finite$3(regular.visits, rounds))),
    rounds,
    bestToPar: Math.floor(finite$3(regular.bestToPar, 99)),
    member: regular.member === true,
    preferences: regular.preferences ?? { pace: "balanced", challenge: "balanced", hospitality: "club" },
    relationship: {
      score,
      tier: relationshipTier(score, rounds),
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
    lastDay: clamp$5(Math.floor(finite$3(candidate.lastDay)), 0, 6),
    loyalty: clamp$5(finite$3(candidate.loyalty, 50), 0, 100),
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
    day: clamp$5(Math.floor(finite$3(instance.day)), 0, 6),
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
    day: clamp$5(Math.floor(finite$3(evidence.day)), 0, 6),
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
    architectureScore: revision.architectureScore == null ? null : clamp$5(finite$3(revision.architectureScore), 0, 100),
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
      returnContext: rawArchitecture.returnContext && typeof rawArchitecture.returnContext === "object" && typeof rawArchitecture.returnContext.roundId === "string" && typeof rawArchitecture.returnContext.holeId === "string" && typeof rawArchitecture.returnContext.courseId === "string" && rawArchitecture.returnContext.point && Number.isFinite(rawArchitecture.returnContext.point.x) && Number.isFinite(rawArchitecture.returnContext.point.y) ? rawArchitecture.returnContext : null,
      testSession: normalizeM48DesignTestSession(rawArchitecture.testSession),
      comparison: rawArchitecture.comparison && typeof rawArchitecture.comparison === "object" ? rawArchitecture.comparison : null
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
    proficiency: clamp$5(finite$3(member.proficiency, 45 + seed % 21), 0, 100),
    tenureStartWeek: Math.max(1, Math.floor(finite$3(member.tenureStartWeek, week))),
    morale: clamp$5(finite$3(member.morale, 70), 0, 100),
    training: Array.isArray(member.training) ? member.training.slice(-16) : [],
    compensationHistory: Array.isArray(member.compensationHistory) && member.compensationHistory.length ? member.compensationHistory.slice(-16) : [{ week, weeklyWage: member.weeklyWage, reason: member.id.startsWith("legacy-") ? "migration" : "hire" }],
    notableActions: Array.isArray(member.notableActions) ? member.notableActions.slice(-16) : []
  };
}
function storyFacts(course, world, living) {
  const staff = (world.staffRoster ?? []).map((item, index) => normalizeStaffCharacter(item, index, world.week));
  const tournaments = normalizeTournamentCalendar(world.tournaments, course).events.filter((event2) => event2.status === "scheduled").length;
  const facts = {
    cash: world.cash,
    reputation: world.reputation,
    condition: course.condition * 100,
    lastWeekProfit: world.lastWeekProfit,
    regularCount: living.regulars.length,
    staffCount: staff.length,
    averageStaffMorale: staff.length ? staff.reduce((sum, item) => sum + (item.morale ?? 70), 0) / staff.length : 0,
    architectureEvidence: living.architecture.evidence.length,
    playerCareerPoints: world.playerPro?.careerPoints ?? 0,
    scheduledTournaments: tournaments,
    openClaims: world.enterprise?.claims.filter((claim) => claim.status === "open" || claim.status === "filed").length ?? 0,
    communityComplaints: world.enterprise?.complaints.filter((complaint) => complaint.status !== "resolved").length ?? 0
  };
  return { key: `${world.runSeed}:${world.week}:${Object.values(facts).map((value) => Math.round(value * 100) / 100).join(":")}`, facts };
}
function eligible(definition, facts) {
  return definition.predicates.every((item) => {
    const value = facts.facts[item.fact] ?? 0;
    return item.op === "eq" ? value === item.value : item.op === "gte" ? value >= item.value : value <= item.value;
  });
}
function participantsFor(definition, world, living, salt) {
  const result = [];
  for (const role of definition.participantRoles) {
    if (role === "regular") {
      if (!living.regulars.length) return null;
      const regular = [...living.regulars].sort((a, b) => a.id.localeCompare(b.id))[salt % living.regulars.length];
      result.push(regular.id);
    } else if (role === "staff") {
      const staff = [...world.staffRoster ?? []].sort((a, b) => a.id.localeCompare(b.id));
      if (!staff.length) return null;
      result.push(staff[salt % staff.length].id);
    } else {
      if (!world.playerPro) return null;
      result.push(world.playerPro.identity.id);
    }
  }
  return result;
}
function createStoryInstance(definition, world, living, day, participantIds, facts) {
  const sequence = living.sequence;
  const instance = {
    id: `story-${world.runSeed >>> 0}-${world.week}-${day}-${sequence}-${definition.id}`,
    definitionId: definition.id,
    week: world.week,
    day,
    priority: definition.priority,
    category: definition.category,
    participantIds,
    facts,
    status: "pending",
    expiresWeek: world.week + definition.expiresAfterWeeks,
    resolution: null
  };
  return {
    instance,
    living: {
      ...living,
      sequence: sequence + 1,
      story: {
        ...living.story,
        instances: [...living.story.instances, instance].slice(-80)
      }
    }
  };
}
function applyRegularEffect(living, targetId, effect, instance, choice2) {
  if (!targetId) return living;
  return {
    ...living,
    regulars: living.regulars.map((regular) => {
      if (regular.id !== targetId) return regular;
      if (effect.type === "relationship") {
        const score = clamp$5(regular.relationship.score + effect.amount, -100, 100);
        return {
          ...regular,
          relationship: {
            score,
            tier: relationshipTier(score, regular.rounds),
            interactionIds: [...regular.relationship.interactionIds, `${instance.id}:${choice2.id}`].slice(-40)
          }
        };
      }
      if (effect.type === "memory") {
        const memory = {
          id: `memory-${instance.id}-${choice2.id}-${regular.id}`,
          week: instance.week,
          kind: "story",
          summary: effect.summaryKey,
          immutable: true,
          evidence: { eventId: instance.definitionId }
        };
        return { ...regular, memories: [...regular.memories, memory].slice(-16) };
      }
      return regular;
    })
  };
}
function targetForRole(role, instance, world, living) {
  if (role === "regular") return instance.participantIds.find((id) => living.regulars.some((regular) => regular.id === id));
  if (role === "staff") return instance.participantIds.find((id) => world.staffRoster?.some((staff) => staff.id === id));
  return instance.participantIds.find((id) => id === world.playerPro?.identity.id);
}
function applyChoiceEffects(course, world, living, instance, choice2) {
  let nextCourse = course;
  let nextWorld = world;
  let nextLiving = living;
  for (const effect of choice2.effects) {
    if (effect.type === "cash") nextWorld = { ...nextWorld, cash: nextWorld.cash + effect.amount };
    else if (effect.type === "reputation") nextWorld = { ...nextWorld, reputation: clamp$5(nextWorld.reputation + effect.amount, 0, 100) };
    else if (effect.type === "condition") nextCourse = { ...nextCourse, condition: clamp$5(nextCourse.condition + effect.amount, 0, 1) };
    else if (effect.type === "relationship" || effect.type === "memory") {
      nextLiving = applyRegularEffect(nextLiving, targetForRole(effect.target, instance, nextWorld, nextLiving), effect, instance, choice2);
    } else if (effect.type === "staffMorale") {
      const target = targetForRole("staff", instance, nextWorld, nextLiving);
      nextWorld = {
        ...nextWorld,
        staffRoster: (nextWorld.staffRoster ?? []).map((staff, index) => {
          const normalized = normalizeStaffCharacter(staff, index, nextWorld.week);
          if (effect.target === "staff" && normalized.id !== target) return normalized;
          return { ...normalized, morale: clamp$5((normalized.morale ?? 70) + effect.amount, 0, 100) };
        })
      };
    } else if (effect.type === "scheduleCallback") {
      const callback = {
        id: `callback-${instance.id}-${choice2.id}-${effect.eventId}`,
        eventId: effect.eventId,
        dueWeek: nextWorld.week + effect.delayWeeks,
        sourceInstanceId: instance.id,
        participantIds: [...instance.participantIds]
      };
      nextLiving = {
        ...nextLiving,
        story: {
          ...nextLiving.story,
          callbacks: [...nextLiving.story.callbacks.filter((item) => item.id !== callback.id), callback].slice(-24)
        }
      };
    }
  }
  return { course: nextCourse, world: nextWorld, living: nextLiving };
}
function resolveInstance(course, world, living, instanceId, choiceId, resolution) {
  const instance = living.story.instances.find((item) => item.id === instanceId);
  if (!instance || instance.status === "resolved" || instance.status === "expired") return { course, world, living, ok: false };
  const definition = STORY_DEFINITION_BY_ID.get(instance.definitionId);
  const choice2 = definition?.choices.find((item) => item.id === choiceId);
  const ledgerId = `${instance.id}:${choiceId}`;
  if (!definition || !choice2 || living.story.settlementLedger.includes(ledgerId)) return { course, world, living, ok: false };
  const applied = applyChoiceEffects(course, world, living, instance, choice2);
  const status = "expired";
  const resolvedInstance = {
    ...instance,
    status,
    choiceId,
    resolvedWeek: world.week,
    resolution
  };
  const journalEntry = {
    id: `journal-${instance.id}`,
    eventInstanceId: instance.id,
    definitionId: instance.definitionId,
    week: world.week,
    participantIds: [...instance.participantIds],
    choiceId,
    resolution,
    facts: instance.facts
  };
  const nextLiving = {
    ...applied.living,
    story: {
      ...applied.living.story,
      instances: applied.living.story.instances.map((item) => item.id === instance.id ? resolvedInstance : item),
      journal: [...applied.living.story.journal.filter((item) => item.id !== journalEntry.id), journalEntry].slice(-120),
      cooldownUntil: { ...applied.living.story.cooldownUntil, [definition.id]: world.week + definition.cooldownWeeks },
      chainStage: definition.chainId ? { ...applied.living.story.chainStage, [definition.chainId]: Math.max(definition.stage ?? 1, applied.living.story.chainStage[definition.chainId] ?? 0) } : applied.living.story.chainStage,
      settlementLedger: [...applied.living.story.settlementLedger, ledgerId].slice(-240)
    }
  };
  return { course: applied.course, world: applied.world, living: nextLiving, ok: true };
}
function advanceLivingClubDay(course, world, day) {
  let living = normalizeLivingClub(world.livingClub);
  let nextCourse = course;
  let nextWorld = {
    ...world,
    staffRoster: (world.staffRoster ?? []).map((staff, index) => {
      const normalized = normalizeStaffCharacter(staff, index, world.week);
      const daily = world.lastWeekProfit >= 0 ? 0.15 : -0.2;
      return { ...normalized, morale: clamp$5((normalized.morale ?? 70) + daily, 0, 100) };
    })
  };
  for (const instance of living.story.instances) {
    if (!["pending", "presented", "deferred"].includes(instance.status) || nextWorld.week <= instance.expiresWeek) continue;
    const definition = STORY_DEFINITION_BY_ID.get(instance.definitionId);
    if (!definition) continue;
    const resolved = resolveInstance(nextCourse, nextWorld, living, instance.id, definition.defaultChoiceId, "expired");
    nextCourse = resolved.course;
    nextWorld = resolved.world;
    living = resolved.living;
  }
  const evaluationKey = `${nextWorld.week}:${day}`;
  if (living.story.lastEvaluationKey === evaluationKey) return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
  living = { ...living, story: { ...living.story, lastEvaluationKey: evaluationKey } };
  if (living.story.instances.some((instance) => ["pending", "presented", "deferred"].includes(instance.status))) {
    return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
  }
  const facts = storyFacts(nextCourse, nextWorld, living);
  const due = [...living.story.callbacks].filter((item) => item.dueWeek <= nextWorld.week).sort((a, b) => a.dueWeek - b.dueWeek || a.id.localeCompare(b.id))[0];
  if (due) {
    const definition = STORY_DEFINITION_BY_ID.get(due.eventId);
    if (definition) {
      const created = createStoryInstance(definition, nextWorld, living, day, due.participantIds, facts);
      living = {
        ...created.living,
        story: { ...created.living.story, callbacks: created.living.story.callbacks.filter((item) => item.id !== due.id) }
      };
      return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
    }
  }
  const resolvedDefinitionIds = new Set(living.story.instances.filter((instance) => instance.status === "resolved" || instance.status === "expired").map((instance) => instance.definitionId));
  const candidates = SYSTEMIC_EVENT_DEFINITIONS.filter(
    (definition) => !definition.callbackOnly && (definition.repeatable || !resolvedDefinitionIds.has(definition.id)) && (living.story.cooldownUntil[definition.id] ?? 0) <= nextWorld.week && eligible(definition, facts) && (!definition.chainId || (living.story.chainStage[definition.chainId] ?? 0) < (definition.stage ?? 1)) && (!definition.mutexGroup || !living.story.instances.some((instance) => {
      const other = STORY_DEFINITION_BY_ID.get(instance.definitionId);
      return other?.mutexGroup === definition.mutexGroup && instance.week === nextWorld.week;
    }))
  ).sort((a, b) => {
    const priority = { major: 3, notable: 2, routine: 1 };
    return priority[b.priority] - priority[a.priority] || a.id.localeCompare(b.id);
  });
  if (candidates.length) {
    const index = hashText(`${nextWorld.runSeed}:${nextWorld.week}:${day}:${facts.key}`) % candidates.length;
    const definition = candidates[index];
    const participants = participantsFor(definition, nextWorld, living, index);
    if (participants) living = createStoryInstance(definition, nextWorld, living, day, participants, facts).living;
  }
  return { course: nextCourse, world: { ...nextWorld, livingClub: living } };
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
function clamp01$5(x) {
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
    skill: clamp01$5(base.skill + bell(rng) * s),
    consistency: clamp01$5(base.consistency + bell(rng) * s),
    patience: clamp01$5((base.patience + bell(rng) * s) * (mults.patience ?? 1)),
    spendPropensity: clamp01$5((base.spendPropensity + bell(rng) * s) * (mults.spend ?? 1)),
    prefs: {
      difficulty: clampSigned(base.prefs.difficulty + bell(rng) * s),
      scenery: clampSigned(base.prefs.scenery + bell(rng) * s),
      price: clampSigned(base.prefs.price + bell(rng) * s)
    },
    pacePreference: clamp01$5(base.skill * 0.55 + (1 - base.patience) * 0.25 + 0.2 + bell(rng) * s)
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
function clamp01$4(n) {
  return Math.max(0, Math.min(1, n));
}
function rollDiscretionaryWallet(personality2, rng) {
  return Math.round(12 + personality2.spendPropensity * 70 + rng() * 35);
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
  const priceAppeal2 = clamp01$4(1.25 - amount / Math.max(8, spec2.defaultPrice * 2.5));
  const proximity = 1 / (1 + distance2 / 28);
  const tierAppeal = 0.9 + ((pick.building.tier ?? 1) - 1) * 0.12;
  const chance = clamp01$4(
    args.personality.spendPropensity * (0.45 + args.satisfaction * 0.55) * (0.55 + proximity * 0.45) * priceAppeal2 * tierAppeal
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
const M47_MAX_PLANS = 36;
const M47_MAX_OUTCOMES = 240;
const M47_MAX_REACTIONS = 36;
const clamp$4 = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
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
  const satisfaction = clamp$4(67 + scoreDelta + riskMoment + conditionDelta + fairness + args.personality.prefs.scenery * 3);
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
    let lie = terrainAt$1(course, from);
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
  const { profile, rng, personality: personality2, startHole, exit, route: route2 } = args;
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
      personality: personality2,
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
        if (rng() < mishitChance(personality2)) {
          penalties++;
          segments.push(pauseSeg(step.to, i, LIVE.pace.recoverySearchPause * (1.15 - personality2.skill * 0.35)));
        }
      }
    } else {
      segments.push(pauseSeg(tee2, i, LIVE.pace.swingPause));
      segments.push(flightSeg(tee2, green2, i));
      pushWalk(tee2, green2, i);
      shots = par + 1;
    }
    const putts = puttOutcome(personality2, rng());
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
  g.mood = clamp01$3(g.mood + m + (condition - 0.6) * 0.02);
  const reaction = g.holeReactions?.[i];
  if (reaction) {
    g.mood = clamp01$3(g.mood * 0.55 + reaction.satisfaction / 100 * 0.45);
    g.thought = reaction.thought;
    g.thoughtUntil = Math.max(g.thoughtUntil, reaction.satisfaction >= 70 ? 18 : 24);
  }
  g.scoredHoles++;
}
function clamp01$3(x) {
  return Math.max(LIVE.mood.min, Math.min(LIVE.mood.max, x));
}
function clamp01$2(x) {
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
  const q = clamp01$2(holeSummary.courseQuality / 100 * (1 - BALANCE2.architecture.qualityBlend) + architecture.total / 100 * BALANCE2.architecture.qualityBlend);
  const cond = course.condition;
  const rep = world.reputation / 100;
  const price = priceAttractivenessWithContext(course, world);
  const marketing = Math.min(1, world.marketingLevel * 0.12);
  const staff = Math.min(1, world.staffLevel * 0.1);
  const complete = holeSummary.holes.filter((h) => h.isComplete && h.isValid);
  const avgDiff = complete.length === 0 ? 100 : complete.reduce((a, h) => a + h.difficultyScore, 0) / complete.length;
  const avgAest = complete.length === 0 ? 0 : complete.reduce((a, h) => a + h.aestheticsScore, 0) / complete.length;
  const variety = clamp01$2(holeSummary.variety / 100);
  const ease = clamp01$2((100 - avgDiff) / 100);
  const rating = computeCourseRatingAndSlope(course);
  const courseRating01 = clamp01$2((rating.courseRating - 66) / 8);
  const m49 = buildM49DemandPlan(course, world, {
    quality: q,
    difficulty: clamp01$2(avgDiff / 100),
    scenery: clamp01$2(avgAest / 100),
    condition: cond,
    price,
    marketing,
    staff,
    reputation: rep
  });
  const repMod = world.reputation < BALANCE2.reputation.demandPenaltyThreshold ? BALANCE2.reputation.demandPenaltyMult : world.reputation > BALANCE2.reputation.demandBonusThreshold ? BALANCE2.reputation.demandBonusMult : 1;
  const coreCap = clamp01$2((world.reputation - 45) / 35) * courseRating01;
  const coreShare = clamp01$2(coreCap * 0.45);
  const casualShare = 1 - coreShare;
  const casualIndexBase = clamp01$2(
    0.33 * q + 0.26 * cond + 0.14 * rep + 0.17 * price + 0.08 * ease + 0.01 * marketing + 0.01 * staff
  ) * 1.15;
  const coreIndexBase = clamp01$2(
    0.26 * q + 0.18 * cond + 0.18 * rep + 0.07 * clamp01$2(avgAest / 100) + 0.07 * variety + 0.07 * clamp01$2(avgDiff / 100) + 0.05 * marketing + 0.05 * staff + 0.03 * price
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
  const evidenceBlended = blended * 0.18 + m49.totalIndex * 0.82;
  const demand = Math.max(0, Math.min(1.2, (evidenceBlended * 1.05 + base * 0.05) * architectureDemandMultiplier(course)));
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
      totalBaseVisitors,
      m49
    },
    m49
  };
}
function demandIndex(course, world) {
  return demandBreakdown(course, world).demandIndex;
}
const COHORTS = ["skilled_impatient", "novice_social", "general"];
function finite$2(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function nonNegative(value, fallback = 0) {
  return Math.max(0, finite$2(value, fallback));
}
function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
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
    averageTimeParVarianceMinutes: Math.max(-1500, Math.min(1500, finite$2(raw.averageTimeParVarianceMinutes))),
    averageWaitMinutes: Math.min(1500, nonNegative(raw.averageWaitMinutes)),
    pickupRate: Math.max(0, Math.min(1, finite$2(raw.pickupRate))),
    abandonmentRate: Math.max(0, Math.min(1, finite$2(raw.abandonmentRate))),
    averageSatisfaction: Math.max(0, Math.min(100, finite$2(raw.averageSatisfaction)))
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
    averageSatisfaction: Math.max(0, Math.min(100, finite$2(raw.averageSatisfaction))),
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
function cohortHistory(metrics, cohort) {
  const current = metrics.cohorts[cohort];
  const samples = current.samples;
  if (!samples) return emptyCohortHistory();
  return {
    samples,
    averageDurationMinutes: current.durationMinutes / samples,
    averageTimeParVarianceMinutes: current.timeParVarianceMinutes / samples,
    averageWaitMinutes: current.waitMinutes / samples,
    pickupRate: current.pickups / samples,
    abandonmentRate: current.abandonments / samples,
    averageSatisfaction: current.satisfaction / samples
  };
}
function staffSignature(world, course, courseId) {
  const counts = /* @__PURE__ */ new Map();
  for (const staff of normalizedStaff(world, course)) {
    if (staff.courseId && staff.courseId !== courseId) continue;
    counts.set(staff.role, (counts.get(staff.role) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([role, count]) => `${role}:${count}`).join("|") || "none";
}
function sampleFromMetrics(world, course, day, metrics) {
  const operations = courseOperations(course, metrics.courseId);
  const durations = metrics.roundDurations.filter(Number.isFinite).slice(-BALANCE.paceOperations.maxDurationSamplesPerDay);
  const totalRounds = metrics.roundsCompleted + metrics.roundsIncomplete;
  return {
    id: `pace-${world.week}-${day}-${metrics.courseId}`,
    week: world.week,
    day,
    courseId: metrics.courseId,
    preset: operations.preset,
    staffing: staffSignature(world, course, metrics.courseId),
    groupsStarted: metrics.groupsStarted,
    groupsFinished: metrics.groupsFinished,
    roundsCompleted: metrics.roundsCompleted,
    roundsIncomplete: metrics.roundsIncomplete,
    averageDurationMinutes: average(durations),
    p50DurationMinutes: percentile(durations, 0.5),
    p90DurationMinutes: percentile(durations, 0.9),
    averageWaitMinutes: totalRounds ? metrics.totalWaitMinutes / totalRounds : 0,
    pickups: metrics.pickups,
    incidents: metrics.incidents,
    refunds: metrics.refunds,
    credits: metrics.credits,
    goodwillVouchers: metrics.goodwillVouchers,
    overtimeCost: metrics.overtimeCost,
    compensationCost: metrics.compensationCost,
    greenFeeRevenue: metrics.greenFeeRevenue,
    beverageRevenue: metrics.beverageRevenue,
    occupiedTeeHours: metrics.occupiedTeeMinutes / 60,
    averageSatisfaction: metrics.roundsCompleted ? metrics.satisfaction / metrics.roundsCompleted : 0,
    cohorts: Object.fromEntries(COHORTS.map((cohort) => [cohort, cohortHistory(metrics, cohort)])),
    holes: Object.values(metrics.holes).map((hole) => ({ ...hole })).sort((left, right) => left.holeId.localeCompare(right.holeId))
  };
}
function recordPaceDay(world, course, day, pace) {
  if (!pace) return world;
  const current = normalizePaceOperationsState(world.paceOperations);
  const courses = { ...current.courses };
  for (const metrics of Object.values(pace.perCourse)) {
    const sample = sampleFromMetrics(world, course, day, metrics);
    const history = courses[metrics.courseId] ?? { courseId: metrics.courseId, samples: [] };
    courses[metrics.courseId] = {
      courseId: metrics.courseId,
      samples: [...history.samples.filter((entry) => entry.id !== sample.id), sample].sort((left, right) => left.week - right.week || left.day - right.day).slice(-BALANCE.paceOperations.historyDays)
    };
  }
  return { ...world, paceOperations: { version: 1, courses } };
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
  const boundedIdentity = Math.max(0, Math.min(1, finite$2(identity, 0.5)));
  const boundedPreference = Math.max(0, Math.min(1, finite$2(preference, 0.5)));
  const match2 = 1 - Math.abs(boundedPreference - boundedIdentity);
  return (match2 - 0.5) * BALANCE.paceOperations.repeatIntentMatchWeight;
}
function clamp$3(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function clamp01$1(x) {
  return clamp$3(x, 0, 1);
}
function courseProfile(course, world) {
  const summary = scoreCourseHoles(course);
  const complete = summary.holes.filter((h) => h.isComplete && h.isValid);
  const avg = (pick, fallback) => complete.length === 0 ? fallback : complete.reduce((a, h) => a + pick(h), 0) / complete.length;
  const difficulty = clamp01$1(avg((h) => h.difficultyScore, 50) / 100);
  const scenery = clamp01$1(avg((h) => h.aestheticsScore, 0) / 100);
  const premium = clamp$3(
    (course.baseGreenFee - BALANCE.pricing.marketPrice) / BALANCE.pricing.marketPrice,
    -1,
    1
  );
  const layout = activeCourseLayout(course);
  const presetFallback = courseOperations(course, layout.id).preset === "relaxed" ? 0 : courseOperations(course, layout.id).preset === "brisk" ? 1 : 0.5;
  return {
    quality: clamp01$1(summary.courseQuality / 100),
    difficulty,
    scenery,
    premium,
    prestige: clamp01$1(world.reputation / 100),
    pace: paceIdentity(world, layout.id, presetFallback).score,
    m49: buildM49DemandPlan(course, world)
  };
}
function archetypeAppeal(profile) {
  const diffSigned = profile.difficulty * 2 - 1;
  const raw = {};
  let total = 0;
  for (const a of Object.values(ARCHETYPES)) {
    const p = a.personality;
    const difficultyMatch = 1 - Math.abs(p.prefs.difficulty - diffSigned) / 2;
    const sceneryAppeal = clamp01$1(0.5 + p.prefs.scenery * (profile.scenery - 0.5));
    const priceAppeal2 = clamp01$1(0.5 + profile.premium * p.prefs.price * 0.8);
    const prestigeGate = clamp01$1(1 - Math.max(0, p.skill - profile.prestige) * 1.5);
    const pacePreference = clamp01$1(p.skill * 0.6 + (1 - p.patience) * 0.3 + 0.1);
    const paceMatch = 1 - Math.abs(pacePreference - profile.pace);
    const evidenceAppeal = profile.m49?.segments[a.name]?.bookingAppeal;
    const fitMultiplier = evidenceAppeal == null ? 1 : 0.72 + evidenceAppeal * 0.56;
    const w = a.weight * difficultyMatch * sceneryAppeal * priceAppeal2 * prestigeGate * (0.65 + paceMatch * 0.35) * fitMultiplier;
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
  const norm = clamp01$1(di / LIVE.volume.demandFullHouse);
  const span = LIVE.volume.maxGolfers - LIVE.volume.minGolfers;
  const raw = (LIVE.volume.minGolfers + norm * span) * getDifficultyProfile(world.difficulty).demandMult;
  const planned = clamp$3(raw, LIVE.volume.minGolfers, LIVE.volume.maxGolfers);
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
    weather: { daily: dailyWeather, modifiers: dailyWeatherModifiers },
    observedRounds: []
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
  const personality2 = arrival2.tournament ? { ...rolledPersonality, skill: Math.max(0, Math.min(1, arrival2.tournament.skill)), consistency: Math.max(rolledPersonality.consistency, 0.62) } : rolledPersonality;
  const capabilities = createGolferCapabilities({
    personality: personality2,
    seed: stableGolferSeed(arrival2.personId ?? arrival2.tournament?.entrantId ?? `${state.seed}:${id}`, state.seed + id)
  });
  const courseId = arrival2.courseId ?? state.tournament?.courseId ?? activeCourseLayout(course).id;
  const roundCourse = courseForLayout(course, courseId);
  const layout = layoutById(course, courseId) ?? activeCourseLayout(course);
  const baseProfile = getGolferProfile(solverProfileForSkill(personality2.skill), roundCourse);
  const profile = state.weather ? {
    ...baseProfile,
    clubs: baseProfile.clubs.map((club) => ({
      ...club,
      carryYards: club.carryYards * state.weather.modifiers.carryMultiplier,
      dispersionTilesBase: club.dispersionTilesBase * state.weather.modifiers.dispersionMultiplier
    }))
  } : baseProfile;
  const entry = entryPoint(roundCourse);
  const wallet = rollDiscretionaryWallet(personality2, rng);
  const preferredTeeSet = preferredTeeForArchetype(arch.name);
  const operations = state.operationsByCourse?.[courseId] ?? courseOperations(course, courseId);
  const guidedTeeSet = operations.teeGuidance === "required" ? personality2.skill < 0.48 ? "forward" : personality2.skill > 0.86 ? "championship" : "member" : preferredTeeSet;
  const teeSet = arrival2.tournament?.teeSet ?? (roundCourse.holes.every((hole) => !getTeeBox(hole, "member") || !!getTeeBox(hole, guidedTeeSet)) ? guidedTeeSet : "member");
  const pinRotation = arrival2.tournament?.pinRotation ?? roundCourse.activePinRotation ?? "A";
  const round2 = buildGolferRound({
    course: roundCourse,
    profile,
    entry,
    rng,
    personality: personality2,
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
    personality: personality2,
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
    pacePreference: personality2.pacePreference ?? personality2.skill,
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
      const roundCourse = courseForLayout(course, courseId);
      const greenFee = layoutById(course, courseId)?.greenFee ?? course.baseGreenFee;
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
          const amount = Math.round(greenFee * compensationRate * 100) / 100;
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
      const observation2 = observeM49Round({
        course: roundCourse,
        golfer: g,
        courseId,
        greenFee,
        completed,
        returnIntent: reaction.willReturn,
        recommend: reaction.promoter,
        condition: roundCourse.condition
      });
      state.observedRounds ??= [];
      state.observedRounds.push(observation2);
      if (state.observedRounds.length > 240) state.observedRounds.splice(0, state.observedRounds.length - 240);
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
function avgSatisfactionSoFar(state) {
  if (state.roundsFinished === 0) return LIVE.mood.start * 100;
  return state.satisfactionSum / state.roundsFinished;
}
function roundReactions(state) {
  const rounds = state.roundsFinished;
  return {
    rounds,
    avgSatisfaction: avgSatisfactionSoFar(state),
    promoters: state.promoters,
    detractors: state.detractors,
    willReturnRate: rounds > 0 ? state.willReturnCount / rounds : 0,
    observations: state.observedRounds?.slice() ?? []
  };
}
function createWeekLedger(week) {
  return { version: 1, week, days: [] };
}
function appendDayToLedger(ledger, result) {
  const days = [...ledger.days.filter((day) => day.dayIndex !== result.dayIndex), result].sort((a, b) => a.dayIndex - b.dayIndex).slice(0, 7);
  return { ...ledger, days };
}
function weekResultFromLedger(ledger) {
  const visitors = ledger.days.reduce((sum, day) => sum + day.rounds, 0);
  const revenue = ledger.days.reduce((sum, day) => sum + day.revenue, 0);
  const costs = ledger.days.reduce((sum, day) => sum + day.costs, 0);
  const satisfactionWeight = ledger.days.reduce((sum, day) => sum + day.avgSatisfaction * day.rounds, 0);
  const byConcession = {};
  const perCourse = /* @__PURE__ */ new Map();
  const weatherDays = ledger.days.flatMap((day) => day.weather ? [day.weather] : []);
  for (const day of ledger.days) {
    for (const [type, amount] of Object.entries(day.revenueBreakdown.byConcession)) {
      byConcession[type] = (byConcession[type] ?? 0) + amount;
    }
    for (const row of day.perCourse ?? []) {
      const current = perCourse.get(row.courseId) ?? {
        courseId: row.courseId,
        courseName: row.courseName,
        attendance: 0,
        turnaways: 0,
        capacity: 0,
        revenue: 0,
        costs: 0,
        profit: 0,
        avgSatisfaction: 0,
        satisfactionWeight: 0
      };
      current.courseName = row.courseName;
      current.attendance += row.attendance;
      current.turnaways += row.turnaways;
      current.capacity += row.capacity;
      current.revenue += row.revenue;
      current.costs += row.costs;
      current.profit += row.profit;
      current.satisfactionWeight += row.avgSatisfaction * row.attendance;
      current.avgSatisfaction = current.attendance ? current.satisfactionWeight / current.attendance : 0;
      perCourse.set(row.courseId, current);
    }
  }
  return {
    visitors,
    revenue,
    revenueBreakdown: {
      greenFees: ledger.days.reduce((sum, day) => sum + day.revenueBreakdown.greenFees, 0),
      concessions: ledger.days.reduce((sum, day) => sum + day.revenueBreakdown.concessions, 0),
      tournaments: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.tournaments ?? 0), 0),
      property: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.property ?? 0), 0),
      propertyCosts: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.propertyCosts ?? 0), 0),
      propertyVisitors: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.propertyVisitors ?? 0), 0),
      paceOvertime: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.paceOvertime ?? 0), 0),
      paceCompensation: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.paceCompensation ?? 0), 0),
      byConcession,
      transactions: ledger.days.flatMap((day) => day.revenueBreakdown.transactions)
    },
    costs,
    profit: revenue - costs,
    avgSatisfaction: visitors ? satisfactionWeight / visitors : 0,
    reputationDelta: ledger.days.reduce((sum, day) => sum + day.reputationDelta, 0),
    perCourse: [...perCourse.values()].map(({ satisfactionWeight: _weight, ...row }) => row),
    visitorNoise: 0,
    ...weatherDays.length ? {
      weatherSummary: {
        playableDays: weatherDays.filter((weather) => weather.modifiers.demandMultiplier >= 0.5).length,
        rainDays: weatherDays.filter((weather) => ["rain", "heavy_rain", "storm"].includes(weather.kind)).length,
        severeDays: weatherDays.filter((weather) => weather.modifiers.eventCancellationRisk >= 0.3).length,
        averageDemandMultiplier: weatherDays.reduce((sum, weather) => sum + weather.modifiers.demandMultiplier, 0) / weatherDays.length,
        averageTurfWearMultiplier: weatherDays.reduce((sum, weather) => sum + weather.modifiers.turfWearMultiplier, 0) / weatherDays.length,
        kinds: weatherDays.map((weather) => weather.kind)
      }
    } : {}
  };
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
function finite$1(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function point(value, nullable = false) {
  if (nullable && value === null) return true;
  return isRecord(value) && finite$1(value.x) && finite$1(value.y);
}
function segment(value) {
  if (!isRecord(value)) return false;
  return (value.kind === "walk" || value.kind === "flight" || value.kind === "pause") && point(value.from) && point(value.to) && finite$1(value.dur) && value.dur >= 0 && Number.isInteger(value.holeIndex) && (value.shot == null || value.shot === "swing" || value.shot === "putt") && (value.concession == null || isRecord(value.concession) && typeof value.concession.buildingType === "string" && finite$1(value.concession.buildingX) && finite$1(value.concession.buildingY) && typeof value.concession.item === "string" && finite$1(value.concession.amount));
}
const intentKinds = /* @__PURE__ */ new Set(["safe", "hero", "positional", "recovery", "approach"]);
const techniques = /* @__PURE__ */ new Set(["normal", "draw", "fade", "punch", "flop", "backspin"]);
function fact(value) {
  return isRecord(value) && ["capability-fit", "risk", "terrain", "next-shot", "context", "outcome"].includes(String(value.code)) && typeof value.detail === "string";
}
function shotIntent(value) {
  return isRecord(value) && typeof value.id === "string" && intentKinds.has(value.kind) && point(value.from) && point(value.target) && typeof value.club === "string" && techniques.has(String(value.technique)) && ["power", "expectedStrokes", "variance", "hazardRisk", "nextShotQuality"].every((key2) => finite$1(value[key2])) && Array.isArray(value.facts) && value.facts.length <= 8 && value.facts.every(fact);
}
function holePlan(value) {
  return isRecord(value) && value.version === 1 && typeof value.holeId === "string" && finite$1(value.par) && finite$1(value.expectedScore) && shotIntent(value.chosen) && Array.isArray(value.rejected) && value.rejected.length <= 5 && value.rejected.every(
    (alternative) => isRecord(alternative) && intentKinds.has(alternative.kind) && finite$1(alternative.expectedStrokes) && typeof alternative.reason === "string" && Array.isArray(alternative.facts) && alternative.facts.length <= 8 && alternative.facts.every(fact)
  );
}
function shotOutcome(value) {
  return isRecord(value) && value.version === 1 && typeof value.id === "string" && typeof value.holeId === "string" && finite$1(value.shotNumber) && Number.isInteger(value.shotNumber) && value.shotNumber > 0 && intentKinds.has(value.intent) && typeof value.intentId === "string" && typeof value.club === "string" && techniques.has(String(value.technique)) && point(value.from) && point(value.aim) && point(value.landing) && point(value.rest) && typeof value.lieBefore === "string" && typeof value.lieAfter === "string" && ["carryYards", "rollYards", "penaltyStrokes", "seed"].every((key2) => finite$1(value[key2])) && typeof value.holed === "boolean" && Array.isArray(value.facts) && value.facts.length <= 12 && value.facts.every(fact);
}
function holeReaction(value) {
  return isRecord(value) && value.version === 1 && typeof value.holeId === "string" && ["expectedScore", "actualScore", "satisfaction"].every((key2) => finite$1(value[key2])) && ["delighted", "pleased", "neutral", "frustrated", "unfair"].includes(String(value.outcome)) && Array.isArray(value.facts) && value.facts.length <= 12 && value.facts.every(fact) && typeof value.thought === "string" && (value.memory == null || typeof value.memory === "string");
}
function golfer(value) {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.id) || typeof value.name !== "string" || typeof value.archetype !== "string") return false;
  if (!isRecord(value.personality) || typeof value.color !== "string") return false;
  if (!Array.isArray(value.segments) || value.segments.length > MAX_SEGMENTS_PER_GOLFER || value.segments.some((s) => !segment(s))) return false;
  if (!point(value.pos) || !point(value.ball, true)) return false;
  if (!Array.isArray(value.holePar) || value.holePar.some((n) => !finite$1(n))) return false;
  if (!Array.isArray(value.holeStrokes) || value.holeStrokes.some((n) => !finite$1(n))) return false;
  for (const key2 of ["segIndex", "segElapsed", "scoredHoles", "currentHole", "strokes", "scoreToPar", "mood", "thoughtUntil", "spent"]) {
    if (!finite$1(value[key2])) return false;
  }
  return typeof value.finished === "boolean" && (value.thought === null || typeof value.thought === "string") && (value.teeSet == null || value.teeSet === "forward" || value.teeSet === "member" || value.teeSet === "championship") && (value.pinRotation == null || value.pinRotation === "A" || value.pinRotation === "B" || value.pinRotation === "C") && (value.courseId == null || typeof value.courseId === "string") && (value.courseName == null || typeof value.courseName === "string") && (value.holeIds == null || Array.isArray(value.holeIds) && value.holeIds.every((id) => typeof id === "string")) && (value.currentHoleId == null || typeof value.currentHoleId === "string") && (value.paceIdentityAtVisit == null || finite$1(value.paceIdentityAtVisit) && value.paceIdentityAtVisit >= 0 && value.paceIdentityAtVisit <= 1) && (value.wallet == null || finite$1(value.wallet)) && (value.purchasedSegmentIndexes == null || Array.isArray(value.purchasedSegmentIndexes) && value.purchasedSegmentIndexes.every(Number.isInteger)) && (value.tournamentId == null || typeof value.tournamentId === "string") && (value.tournamentEntrantId == null || typeof value.tournamentEntrantId === "string") && (value.capabilities == null || isRecord(value.capabilities)) && (value.currentIntent == null || shotIntent(value.currentIntent)) && (value.holePlans == null || Array.isArray(value.holePlans) && value.holePlans.length <= M47_MAX_PLANS && value.holePlans.every(holePlan)) && (value.shotOutcomes == null || Array.isArray(value.shotOutcomes) && value.shotOutcomes.length <= M47_MAX_OUTCOMES && value.shotOutcomes.every(shotOutcome)) && (value.holeReactions == null || Array.isArray(value.holeReactions) && value.holeReactions.length <= M47_MAX_REACTIONS && value.holeReactions.every(holeReaction));
}
function arrival(value) {
  if (!isRecord(value) || !finite$1(value.atMinute) || typeof value.archetype !== "string") return false;
  if (value.courseId != null && typeof value.courseId !== "string") return false;
  if (value.paceIdentityAtVisit != null && (!finite$1(value.paceIdentityAtVisit) || value.paceIdentityAtVisit < 0 || value.paceIdentityAtVisit > 1)) return false;
  if (value.tournament == null) return true;
  return isRecord(value.tournament) && typeof value.tournament.eventId === "string" && typeof value.tournament.entrantId === "string" && typeof value.tournament.name === "string" && finite$1(value.tournament.skill) && (value.tournament.teeSet == null || value.tournament.teeSet === "forward" || value.tournament.teeSet === "member" || value.tournament.teeSet === "championship") && (value.tournament.pinRotation == null || value.tournament.pinRotation === "A" || value.tournament.pinRotation === "B" || value.tournament.pinRotation === "C");
}
function tournament(value) {
  if (value == null) return true;
  if (!isRecord(value) || typeof value.eventId !== "string" || typeof value.name !== "string") return false;
  if (value.courseId != null && typeof value.courseId !== "string") return false;
  if (value.tier !== "local" && value.tier !== "regional" && value.tier !== "championship") return false;
  if (!Array.isArray(value.standings) || value.standings.length > MAX_GOLFERS) return false;
  if (value.teeSet != null && value.teeSet !== "forward" && value.teeSet !== "member" && value.teeSet !== "championship") return false;
  if (value.pinRotation != null && value.pinRotation !== "A" && value.pinRotation !== "B" && value.pinRotation !== "C") return false;
  return value.standings.every((row) => isRecord(row) && typeof row.entrantId === "string" && (row.golferId === null || Number.isInteger(row.golferId)) && typeof row.name === "string" && typeof row.archetype === "string" && finite$1(row.holesCompleted) && finite$1(row.score) && finite$1(row.scoreToPar) && typeof row.finished === "boolean");
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
  if (state.nextTeeFreeAtByCourse != null && (!isRecord(state.nextTeeFreeAtByCourse) || Object.values(state.nextTeeFreeAtByCourse).some((value) => !finite$1(value)))) return null;
  if (state.perCourse != null && (!isRecord(state.perCourse) || Object.values(state.perCourse).some((value) => {
    if (!isRecord(value) || typeof value.courseName !== "string") return true;
    return ["arrivals", "roundsStarted", "roundsFinished", "greenFees", "satisfactionSum", "promoters", "detractors", "willReturnCount"].some((key2) => !finite$1(value[key2]));
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
    if (!finite$1(state[key2])) return null;
  }
  if (typeof state.dayOver !== "boolean") return null;
  const speed = normalizedSpeed(input.speed);
  if (!finite$1(input.pendingCash) || input.pendingCash < 0 || !speed) return null;
  if (input.clockRemainderMinutes != null && (!finite$1(input.clockRemainderMinutes) || input.clockRemainderMinutes < 0)) return null;
  if (input.selectedGolferId !== null && !Number.isInteger(input.selectedGolferId)) return null;
  const serializable = cloneSerializableState(state);
  const stateSeed = finite$1(state.seed) ? state.seed : 0;
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
    clockRemainderMinutes: finite$1(input.clockRemainderMinutes) ? input.clockRemainderMinutes : 0,
    weekLedger: normalizeWeekLedger(input.weekLedger, 1)
  };
}
({
  ...BALANCE.terrain.buildCost
});
({
  ...BALANCE.terrain.salvageValue
});
const TERRAIN_MAINT_WEIGHT = {
  ...BALANCE.terrain.maintWeight
};
BALANCE.terrain.earthworkCostPerStep;
function hitsLiquidityTrap(cash) {
  return cash < BALANCE.distress.liquidityTrapCash;
}
function conditionMet(c, value) {
  return c.comparator === ">=" ? value >= c.target : value <= c.target;
}
function makeMetricReader(args) {
  const { course, world, objectives, weeklyProfit } = args;
  let holeSummary = args.holeSummary;
  let holesBuilt = null;
  let courseRating = null;
  return (metric) => {
    switch (metric) {
      case "cash":
        return world.cash;
      case "reputation":
        return world.reputation;
      case "condition":
        return course.condition * 100;
      case "weeklyProfit":
        return weeklyProfit;
      case "profitStreak":
        return objectives.profitStreak;
      case "totalRounds":
        return objectives.totalRounds;
      case "holesBuilt": {
        if (holesBuilt == null) {
          holeSummary ??= scoreCourseHoles(course);
          holesBuilt = holeSummary.holes.filter((h) => h.isComplete && h.isValid).length;
        }
        return holesBuilt;
      }
      case "publishedHoles": {
        const complete = new Set(course.holes.filter((hole) => hole.id && hole.tee && hole.green).map((hole) => hole.id));
        return new Set(courseLayouts(course).flatMap((layout) => layout.publishedHoleIds).filter((id) => complete.has(id))).size;
      }
      case "publishedCourses":
        return courseLayouts(course).filter((layout) => layout.publishedHoleIds.length === layout.roundLength).length;
      case "courseRating": {
        courseRating ??= computeCourseRatingAndSlope(course).courseRating;
        return courseRating;
      }
      case "tournamentPlacement":
        return Number.MAX_SAFE_INTEGER;
    }
  };
}
function evaluateGoal(goal2, prev, read, week) {
  const conditions = goal2.conditions.map((c) => {
    const value = read(c.metric);
    return { ...c, value, met: conditionMet(c, value) };
  });
  const metNow = (goal2.match ?? "all") === "all" ? conditions.every((c) => c.met) : conditions.some((c) => c.met);
  const met = metNow || (prev?.met ?? false);
  return {
    goalId: goal2.id,
    conditions,
    met,
    completedWeek: prev?.completedWeek ?? (metNow ? week : void 0)
  };
}
function evaluateObjectives(objectives, course, world, commit) {
  if (objectives.outcome === "LOST") return objectives;
  const closesWeek = commit.weekCompleted != null;
  const totalRounds = objectives.totalRounds + commit.rounds;
  const weekProfitAccum = closesWeek ? 0 : objectives.weekProfitAccum + commit.profit;
  const closedWeekProfit = closesWeek ? objectives.weekProfitAccum + commit.profit : 0;
  const profitStreak = closesWeek ? closedWeekProfit > 0 ? objectives.profitStreak + 1 : 0 : objectives.profitStreak;
  const advanced = {
    ...objectives,
    totalRounds,
    profitStreak,
    weekProfitAccum
  };
  const week = commit.weekCompleted ?? world.week;
  const read = makeMetricReader({
    course,
    world,
    objectives: advanced,
    weeklyProfit: closesWeek ? closedWeekProfit : world.lastWeekProfit,
    holeSummary: commit.holeSummary
  });
  const progress = advanced.goals.map(
    (g) => evaluateGoal(g, objectives.progress.find((p) => p.goalId === g.id), read, week)
  );
  let next = { ...advanced, progress };
  if (world.isBankrupt) {
    return { ...next, outcome: "LOST", lostWeek: week, lostReason: "BANKRUPT" };
  }
  if (next.outcome === "WON") return next;
  const allMet = progress.length > 0 && progress.every((p) => p.met);
  if (allMet) {
    return { ...next, outcome: "WON", wonWeek: week };
  }
  if (closesWeek) {
    const missedDeadline = next.goals.some((g, i) => {
      const deadline = g.deadlineWeek;
      return deadline != null && !progress[i].met && week >= deadline;
    });
    if (missedDeadline) {
      next = { ...next, outcome: "LOST", lostWeek: week, lostReason: "DEADLINE" };
    }
  }
  return next;
}
function withEvaluatedObjectives(course, world, commit) {
  if (!world.objectives) return world;
  return { ...world, objectives: evaluateObjectives(world.objectives, course, world, commit) };
}
function createObjectiveState(goals) {
  return {
    goals,
    progress: goals.map((g) => ({
      goalId: g.id,
      conditions: g.conditions.map((c) => ({ ...c, value: 0, met: false })),
      met: false
    })),
    outcome: "OPEN",
    totalRounds: 0,
    profitStreak: 0,
    weekProfitAccum: 0
  };
}
const generatedEn = {
  "auto.app.25.000.18.apr.26.weeks.amortized.weekly.payments.missi": "$25,000 • 18% APR • 26 weeks • amortized weekly payments. Missing payments hurts reputation and worsens terms.",
  "auto.app.decline": "Decline",
  "auto.app.distress.take.a.bridge.loan": "Distress: take a Bridge Loan?",
  "auto.app.exit": "Exit",
  "auto.app.next": "Next →",
  "auto.app.prev": "← Prev",
  "auto.app.take.loan": "Take loan",
  "auto.ui.accessibility.keybindingspanel.choose.an.action.then.press.the.replacement.key.or.cho": "Choose an action, then press the replacement key or chord.",
  "auto.ui.accessibility.keybindingspanel.done": "Done",
  "auto.ui.accessibility.keybindingspanel.keyboard.controls": "Keyboard controls",
  "auto.ui.accessibility.keybindingspanel.reset.bindings": "Reset bindings",
  "auto.ui.apperrorboundary.coursecraft.hit.an.unexpected.problem": "CourseCraft hit an unexpected problem",
  "auto.ui.apperrorboundary.reload": "Reload",
  "auto.ui.apperrorboundary.reset.save.and.reload": "Reset save & reload",
  "auto.ui.apperrorboundary.technical.details": "Technical details",
  "auto.ui.apperrorboundary.your.course.is.still.stored.locally.try.reloading.firs": "Your course is still stored locally. Try reloading first. If the same crash returns, reset the legacy save and start clean.",
  "auto.ui.defeatmodal.load.a.save": "Load a save",
  "auto.ui.defeatmodal.needed.by": " — needed by ",
  "auto.ui.defeatmodal.new.game": "New game",
  "auto.ui.defeatmodal.retry.this.run": "Retry this run",
  "auto.ui.defeatmodal.seed": "Seed",
  "auto.ui.gameui.gamesidebar.course.status": "Course Status",
  "auto.ui.gameui.gamesidebar.game.mode": "Game Mode",
  "auto.ui.gameui.gamesidebar.load": "📁 Load",
  "auto.ui.gameui.gamesidebar.save": "💾 Save",
  "auto.ui.gameui.gamesidebar.simulate.week": "⏩ Simulate Week",
  "auto.ui.golferinspector.close": "Close",
  "auto.ui.golferinspector.mood": "Mood",
  "auto.ui.golferinspector.recent.thoughts": "Recent thoughts",
  "auto.ui.golferinspector.scorecard": "Scorecard",
  "auto.ui.help.golfopediamodal.close.golfopedia": "Close Golfopedia",
  "auto.ui.help.golfopediamodal.golfopedia": "Golfopedia",
  "auto.ui.help.golfopediamodal.no.entries.match.that.search": "No entries match that search.",
  "auto.ui.help.golfopediamodal.search.golfopedia": "Search Golfopedia",
  "auto.ui.help.golfopediamodal.search.terrain.stats.controls": "Search terrain, stats, controls…",
  "auto.ui.help.golfopediamodal.the.course.designer.s.pocket.reference": "The course designer's pocket reference",
  "auto.ui.help.tooltip.learn.more.in.golfopedia": "Learn more in Golfopedia →",
  "auto.ui.holeinspector.auto.par": "Auto Par",
  "auto.ui.holeinspector.bogey.shots": "Bogey Shots",
  "auto.ui.holeinspector.cinematic.hole.flyover": "Cinematic hole flyover",
  "auto.ui.holeinspector.corridor.area": "Corridor Area",
  "auto.ui.holeinspector.critical.issues": "Critical Issues",
  "auto.ui.holeinspector.current": "Current:",
  "auto.ui.holeinspector.defaults.to.array.position": "(defaults to array position)",
  "auto.ui.holeinspector.editor.tools": "Editor Tools",
  "auto.ui.holeinspector.effective.distance": "Effective Distance",
  "auto.ui.holeinspector.elevation.change": "Elevation Change",
  "auto.ui.holeinspector.est.cost": "Est. cost:",
  "auto.ui.holeinspector.fit": "Fit",
  "auto.ui.holeinspector.fit.hole.f": "Fit Hole (F)",
  "auto.ui.holeinspector.flyover": "▶ Flyover",
  "auto.ui.holeinspector.green": "Green",
  "auto.ui.holeinspector.hole": "Hole ",
  "auto.ui.holeinspector.hole.index.stroke.index": "Hole Index / Stroke Index",
  "auto.ui.holeinspector.landing": "Landing",
  "auto.ui.holeinspector.no.area": "No area",
  "auto.ui.holeinspector.no.issues.found.hole.looks.good": "No issues found. Hole looks good!",
  "auto.ui.holeinspector.notes": "Notes",
  "auto.ui.holeinspector.obstacle": "Obstacle",
  "auto.ui.holeinspector.other": "Other:",
  "auto.ui.holeinspector.paint": "Paint",
  "auto.ui.holeinspector.scratch.shots": "Scratch Shots",
  "auto.ui.holeinspector.show.fix.overlay": "Show fix overlay",
  "auto.ui.holeinspector.straight.distance": "Straight Distance",
  "auto.ui.holeinspector.suggested.fixes": "Suggested fixes:",
  "auto.ui.holeinspector.target": "% | Target: ",
  "auto.ui.holeinspector.tee": "Tee",
  "auto.ui.holeinspector.terrain.composition": "Terrain Composition",
  "auto.ui.holeinspector.total.hole.area": "Total Hole Area",
  "auto.ui.holeinspector.warnings": "Warnings",
  "auto.ui.holeinspector.yds": " yds",
  "auto.ui.holeminimap.click.to.center.view": "Click to center view",
  "auto.ui.hud.100.par": "/100 • par ",
  "auto.ui.hud.active": "active",
  "auto.ui.hud.active.loans": "Active loans",
  "auto.ui.hud.admin": "Admin",
  "auto.ui.hud.aesthetics": "Aesthetics:",
  "auto.ui.hud.apr": "% APR • ",
  "auto.ui.hud.at": " at ",
  "auto.ui.hud.auto": "Auto",
  "auto.ui.hud.auto.par.thresholds.14.3.15.30.4.31.5": "Auto par thresholds: ≤14 → 3, 15–30 → 4, 31+ → 5",
  "auto.ui.hud.avg": " avg •",
  "auto.ui.hud.avg.satisfaction": "Avg satisfaction: ",
  "auto.ui.hud.avg.terrain.weight": "Avg terrain weight:",
  "auto.ui.hud.bankrupt": "Bankrupt.",
  "auto.ui.hud.base": " • base",
  "auto.ui.hud.base.staff": "Base staff",
  "auto.ui.hud.base.visitors": " → base visitors:",
  "auto.ui.hud.bogey": " • Bogey:",
  "auto.ui.hud.bogey.2": " • Bogey: ",
  "auto.ui.hud.bridge.loan": "Bridge Loan —",
  "auto.ui.hud.budget": "Budget",
  "auto.ui.hud.build": "Build ",
  "auto.ui.hud.build.blocked": "Build blocked:",
  "auto.ui.hud.business": "Business",
  "auto.ui.hud.cap": "(cap",
  "auto.ui.hud.capacity": "Capacity:",
  "auto.ui.hud.capital.spending.terrain.builds": "Capital spending (terrain builds)",
  "auto.ui.hud.cash": "CASH",
  "auto.ui.hud.cash.2": "Cash",
  "auto.ui.hud.casual": "Casual",
  "auto.ui.hud.choose.a.shop.then.click.clear.near.flat.land.to.build": "Choose a shop, then click clear, near-flat land to build. Click an existing concession to remove it for 35% salvage.",
  "auto.ui.hud.click.on.the.canvas.to.place.remove.an.obstacle.does.n": "Click on the canvas to place/remove an obstacle (does not change terrain).",
  "auto.ui.hud.concession.buildings": "Concession buildings",
  "auto.ui.hud.concessions": "Concessions (",
  "auto.ui.hud.condition": "CONDITION",
  "auto.ui.hud.condition.2": "Condition",
  "auto.ui.hud.confirm": "Confirm",
  "auto.ui.hud.consumables": "Consumables",
  "auto.ui.hud.core": "Core",
  "auto.ui.hud.cost.3": "(cost 3)",
  "auto.ui.hud.cost.5": "(cost 5)",
  "auto.ui.hud.costs": "Costs: ",
  "auto.ui.hud.course.metrics": "Course metrics",
  "auto.ui.hud.course.quality": "Course quality: ",
  "auto.ui.hud.course.rating": "Course Rating: ",
  "auto.ui.hud.current.flag": "Current flag:",
  "auto.ui.hud.demand.breakdown": "Demand breakdown",
  "auto.ui.hud.demand.index": "Demand index: ",
  "auto.ui.hud.demandindex": "DemandIndex:",
  "auto.ui.hud.demandindex.vs.last.week": "Δ DemandIndex vs last week:",
  "auto.ui.hud.difficulty": "Difficulty:",
  "auto.ui.hud.dist.yds": "Dist (yds)",
  "auto.ui.hud.draft.tee": "Draft: tee",
  "auto.ui.hud.earn.points.on.bankruptcy.based.on.weeks.survived.peak": "Earn points on bankruptcy based on weeks survived + peak reputation. Purely cosmetic.",
  "auto.ui.hud.earthworks.cost": "Earthworks cost $",
  "auto.ui.hud.edit": "Edit",
  "auto.ui.hud.editor.mode": "Editor mode",
  "auto.ui.hud.effective": "• Effective:",
  "auto.ui.hud.estimated.maintenance.weight": "Estimated maintenance weight:",
  "auto.ui.hud.expansion.loan": "Expansion Loan —",
  "auto.ui.hud.financing": "Financing",
  "auto.ui.hud.flag.color.blue": "Flag color: Blue",
  "auto.ui.hud.flag.color.gold": "Flag color: Gold",
  "auto.ui.hud.flyover": "Flyover",
  "auto.ui.hud.golfer.sentiment": "Golfer sentiment",
  "auto.ui.hud.green": " • green",
  "auto.ui.hud.green.fee": "Green fee ($",
  "auto.ui.hud.green.fees": "Green fees",
  "auto.ui.hud.help": "? Help",
  "auto.ui.hud.hole": "Hole ",
  "auto.ui.hud.hole.list.overall.score": "Hole list (overall score)",
  "auto.ui.hud.hole.quality.avg": "Hole quality avg: ",
  "auto.ui.hud.hole.setup.wizard": "Hole Setup Wizard",
  "auto.ui.hud.hole.wizard": "Hole Wizard",
  "auto.ui.hud.holes.open": "HOLES OPEN",
  "auto.ui.hud.idx": "% • idx",
  "auto.ui.hud.insurance": "Insurance",
  "auto.ui.hud.labor.per.round": "Labor (per round)",
  "auto.ui.hud.last.week": "Last week",
  "auto.ui.hud.layout.issue.tee.green.missing.low.overall.holes.drag.": "* layout issue (tee/green missing). Low overall holes drag down course quality.",
  "auto.ui.hud.layout.issues": "Layout issues:",
  "auto.ui.hud.layup.preferred.optimal.route.is": "Layup preferred: optimal route is",
  "auto.ui.hud.legacy.points": "Legacy points",
  "auto.ui.hud.load": "📁 Load",
  "auto.ui.hud.maintenance.budget": "Maintenance budget ($",
  "auto.ui.hud.maintenance.pressure": "Maintenance pressure",
  "auto.ui.hud.manual": "Manual",
  "auto.ui.hud.marketing.level": "Marketing level:",
  "auto.ui.hud.merchant.fees": "Merchant fees",
  "auto.ui.hud.need.rep": "(need rep ≥",
  "auto.ui.hud.net": " • Net:",
  "auto.ui.hud.next.hole": "Next hole",
  "auto.ui.hud.no.concessions.built.yet": "No concessions built yet.",
  "auto.ui.hud.noise": "Noise:",
  "auto.ui.hud.obstacles": "Obstacles",
  "auto.ui.hud.of.9": " of 9",
  "auto.ui.hud.overall": "Overall:",
  "auto.ui.hud.overall.2": "Overall",
  "auto.ui.hud.overhead.fixed": "Overhead (fixed)",
  "auto.ui.hud.paint": "Paint",
  "auto.ui.hud.par": "• Par:",
  "auto.ui.hud.par.2": "Par",
  "auto.ui.hud.par.5.not.reachable.in.two.scratch.needs": "Par 5 not reachable in two: scratch needs ~",
  "auto.ui.hud.par.settings.active.hole": "Par settings (active hole)",
  "auto.ui.hud.per.step.per.tile.steep.edges.auto.terrace.and.are.inc": "per step per tile. Steep edges auto-terrace (and are included in the cost). Tees, greens and water can't be sculpted.",
  "auto.ui.hud.place.obstacle": "Place obstacle",
  "auto.ui.hud.place.tee.green": "place tee + green",
  "auto.ui.hud.playability": "Playability:",
  "auto.ui.hud.price.attractiveness": "Price attractiveness: ",
  "auto.ui.hud.pricing.tiers": "Pricing & tiers",
  "auto.ui.hud.profit": "Profit:",
  "auto.ui.hud.profit.tax": "Profit tax: -",
  "auto.ui.hud.reachable.in.two": "• Reachable in two:",
  "auto.ui.hud.redo": "Redo",
  "auto.ui.hud.refunded": " • Refunded:",
  "auto.ui.hud.reputation": "REPUTATION",
  "auto.ui.hud.reputation.2": "Reputation",
  "auto.ui.hud.reputation.3": "Reputation Δ:",
  "auto.ui.hud.required.maintenance": "Required maintenance",
  "auto.ui.hud.reset": "↺ Reset",
  "auto.ui.hud.revenue": "Revenue: ",
  "auto.ui.hud.sales": " sales)",
  "auto.ui.hud.satisfaction": "Satisfaction:",
  "auto.ui.hud.satisfaction.breakdown": "Satisfaction breakdown",
  "auto.ui.hud.satisfaction.vs.last.week": "Δ Satisfaction vs last week:",
  "auto.ui.hud.save": "💾 Save",
  "auto.ui.hud.score": "score",
  "auto.ui.hud.scratch": "Scratch:",
  "auto.ui.hud.scratch.to.green": "Scratch to green:",
  "auto.ui.hud.sculpt": "Sculpt",
  "auto.ui.hud.sculpt.brush": "Sculpt brush",
  "auto.ui.hud.set.by.the.scenario": "🔒 set by the scenario",
  "auto.ui.hud.shops": "Shops",
  "auto.ui.hud.shots.to.reach.green": "shots to reach green.",
  "auto.ui.hud.shots.to.reach.green.hazard.dispersion.risk.makes.aggr": "shots to reach green (hazard/dispersion risk makes aggression costly).",
  "auto.ui.hud.show.shot.plan.overlay": "Show shot plan overlay",
  "auto.ui.hud.simulate.a.week.to.see.results": "Simulate a week to see results.",
  "auto.ui.hud.size": "Size",
  "auto.ui.hud.slope": " • Slope: ",
  "auto.ui.hud.spent": "Spent:",
  "auto.ui.hud.staff.level": "Staff level:",
  "auto.ui.hud.starts.at": " · starts at ",
  "auto.ui.hud.straight": "Straight:",
  "auto.ui.hud.terrain.brush": "Terrain brush",
  "auto.ui.hud.terrain.mix.maintenance.burden": "Terrain mix + maintenance burden",
  "auto.ui.hud.this.run.has.ended.restart.to.continue": "This run has ended — restart to continue.",
  "auto.ui.hud.tier.1": "Tier 1",
  "auto.ui.hud.tier.2": "Tier 2",
  "auto.ui.hud.tier.3": "Tier 3",
  "auto.ui.hud.tile.salvage": " / tile · salvage ",
  "auto.ui.hud.tiles": "tiles)",
  "auto.ui.hud.top.issues.what.to.fix.next": "Top issues (what to fix next)",
  "auto.ui.hud.total": " total",
  "auto.ui.hud.turned.away": "• Turned away:",
  "auto.ui.hud.tutorial": "Tutorial",
  "auto.ui.hud.unlock": "Unlock",
  "auto.ui.hud.unlocks.cosmetic": "Unlocks (cosmetic)",
  "auto.ui.hud.upgrades": "Upgrades",
  "auto.ui.hud.use": "Use",
  "auto.ui.hud.utilities": "Utilities",
  "auto.ui.hud.valid.holes.and.last.week.profit.gt.0": "valid holes, and last week profit &gt; 0)",
  "auto.ui.hud.valid.holes.or.playable.and": " valid holes or playable, and ",
  "auto.ui.hud.variable.costs": "Variable costs",
  "auto.ui.hud.variety": "Variety: ",
  "auto.ui.hud.vibe": "Vibe",
  "auto.ui.hud.visitors": "Visitors: ",
  "auto.ui.hud.visitors.2": "visitors",
  "auto.ui.hud.w": "w",
  "auto.ui.hud.w.left": "w left",
  "auto.ui.hud.wear.this.week": "• Wear this week:",
  "auto.ui.hud.week.cooldown": "-week cooldown)",
  "auto.ui.hud.why.people.like.don.t.like.it": "Why people like / don’t like it",
  "auto.ui.hud.wk": "/wk)",
  "auto.ui.hud.wk.bal": "/wk • bal",
  "auto.ui.hud.yards.tile": "• yards/tile:",
  "auto.ui.livecontrols.open.pause.menu": "Open pause menu",
  "auto.ui.livecontrols.pause.menu": "Pause menu",
  "auto.ui.newgamewizard.career": "Career",
  "auto.ui.newgamewizard.challenge": "Challenge",
  "auto.ui.newgamewizard.course.name": "Course name",
  "auto.ui.newgamewizard.desert": "Desert",
  "auto.ui.newgamewizard.easy": "Easy",
  "auto.ui.newgamewizard.founder.name": "Founder name",
  "auto.ui.newgamewizard.hard": "Hard",
  "auto.ui.newgamewizard.links": "Links",
  "auto.ui.newgamewizard.normal": "Normal",
  "auto.ui.newgamewizard.optional": "(optional)",
  "auto.ui.newgamewizard.parkland": "Parkland",
  "auto.ui.newgamewizard.random.name": "Random name",
  "auto.ui.newgamewizard.reroll.land": "🎲 Reroll land",
  "auto.ui.newgamewizard.sandbox": "Sandbox",
  "auto.ui.newgamewizard.sandbox.override.challenge.runs.use.the.balanced.defau": "Sandbox override — challenge runs use the balanced default.",
  "auto.ui.newgamewizard.seed": "Seed ",
  "auto.ui.newgamewizard.seed.2": "Seed",
  "auto.ui.newgamewizard.seed.3": " • seed",
  "auto.ui.newgamewizard.starting.cash": "Starting cash —",
  "auto.ui.newgamewizard.your.name.on.the.clubhouse.plaque": "Your name on the clubhouse plaque",
  "auto.ui.objectivespanel.by": "by",
  "auto.ui.objectivespanel.close": "Close",
  "auto.ui.objectivespanel.free.play": "FREE PLAY",
  "auto.ui.objectivespanel.free.play.no.goals.enjoy.the.course": "Free play — no goals. Enjoy the course.",
  "auto.ui.objectivespanel.no.goals.build.at.your.own.pace": "— no goals, build at your own pace",
  "auto.ui.objectivespanel.no.goals.build.freely": "No goals — build freely",
  "auto.ui.objectivespanel.objectives": "Objectives",
  "auto.ui.objectivespanel.open.objectives": "Open objectives",
  "auto.ui.onboarding.advisorcard.got.it": "Got it",
  "auto.ui.onboarding.advisorcard.show.me": "Show me",
  "auto.ui.onboarding.tutorialoverlay.interactive.tutorial": "Interactive tutorial",
  "auto.ui.onboarding.tutorialoverlay.skip.tutorial": "Skip tutorial",
  "auto.ui.pixistage.click.or.esc.to.skip": "click or Esc to skip",
  "auto.ui.pixistage.hole": "Hole ",
  "auto.ui.pixistage.par": "Par",
  "auto.ui.pixistage.yds": "yds",
  "auto.ui.saveloadmodal.9.holes": "/9 holes",
  "auto.ui.saveloadmodal.close": "Close",
  "auto.ui.saveloadmodal.export": "Export",
  "auto.ui.saveloadmodal.import.coursecraft.file": "Import .coursecraft file…",
  "auto.ui.saveloadmodal.load": "Load",
  "auto.ui.saveloadmodal.new.save.name": "New save name…",
  "auto.ui.saveloadmodal.no.saves.yet": "No saves yet",
  "auto.ui.saveloadmodal.overwrite": "Overwrite",
  "auto.ui.saveloadmodal.rename": "Rename",
  "auto.ui.saveloadmodal.save.to.new.slot": "Save to new slot",
  "auto.ui.scenarioselect.completed": "Completed",
  "auto.ui.settingsmodal.advisor.frequency": "Advisor frequency",
  "auto.ui.settingsmodal.autosave.cadence": "Autosave cadence",
  "auto.ui.settingsmodal.chatty": "Chatty",
  "auto.ui.settingsmodal.default.game.speed": "Default game speed",
  "auto.ui.settingsmodal.every.15.real.minutes": "Every 15 real minutes",
  "auto.ui.settingsmodal.every.5.real.minutes": "Every 5 real minutes",
  "auto.ui.settingsmodal.every.game.week": "Every game week",
  "auto.ui.settingsmodal.important.only": "Important only",
  "auto.ui.settingsmodal.normal": "Normal",
  "auto.ui.settingsmodal.off": "Off",
  "auto.ui.startmenu.v": "v",
  "auto.ui.victorymodal.keep.playing": "Keep playing",
  "auto.ui.victorymodal.met.every.goal": "met every goal",
  "auto.ui.victorymodal.objectives.complete": "Objectives complete!"
};
const en = {
  ...generatedEn,
  "app.name": "CourseCraft",
  "bugReporter.source.reactCrash": "React crash",
  "bugReporter.source.windowError": "Window error",
  "bugReporter.source.unhandledRejection": "Unhandled promise",
  "bugReporter.source.manual": "Manual report",
  "bugReporter.error.generic": "The report could not be submitted.",
  "bugReporter.crashExpected": "CourseCraft should continue without crashing.",
  "bugReporter.title": "Report a CourseCraft problem",
  "bugReporter.closeAria": "Close bug reporter",
  "bugReporter.success.received": "Report received as {issue}.",
  "bugReporter.success.duplicate": "This was added as occurrence {count} on the canonical issue.",
  "bugReporter.success.created": "A canonical Linear issue was created for triage.",
  "bugReporter.success.openLinear": "Open {issue} in Linear",
  "bugReporter.done": "Done",
  "bugReporter.privacy": "Only the text below is required. Diagnostics and a screenshot stay off until you explicitly include them. Saves, identity, cookies, storage, headers, and URL queries are never collected.",
  "bugReporter.field.title": "Short title",
  "bugReporter.field.actual": "What happened?",
  "bugReporter.field.expected": "What should have happened?",
  "bugReporter.field.steps": "Reproduction steps — one per line",
  "bugReporter.field.stepsPlaceholder": "Open a saved course\nChoose the terrain tool\nPaint beside the green",
  "bugReporter.field.impact": "Impact",
  "bugReporter.severity.low": "Low — cosmetic or minor",
  "bugReporter.severity.medium": "Medium — feature is impaired",
  "bugReporter.severity.high": "High — blocks play or loses progress",
  "bugReporter.severity.critical": "Critical — severe impact; triage decides urgency",
  "bugReporter.evidence.legend": "Optional evidence",
  "bugReporter.evidence.diagnostics": "Include the diagnostic capsule previewed below",
  "bugReporter.evidence.screenshot": "Allow a screenshot of the CourseCraft renderer only",
  "bugReporter.evidence.screenshotAlt": "Screenshot that will be submitted",
  "bugReporter.evidence.removeScreenshot": "Remove screenshot",
  "bugReporter.evidence.capturing": "Capturing…",
  "bugReporter.evidence.capture": "Capture screenshot",
  "bugReporter.preview.diagnostics": "Preview all available diagnostics",
  "bugReporter.preview.payload": "Preview exact report payload",
  "bugReporter.validation.review": "Review the report fields.",
  "bugReporter.reportId": "Report ID {id} · safe retries reuse this ID",
  "bugReporter.cancelSubmission": "Cancel submission",
  "bugReporter.close": "Close",
  "bugReporter.submitting": "Submitting…",
  "bugReporter.submit": "Submit report",
  "bugReporter.launcherTitle": "Report a bug (Alt+Shift+B)",
  "bugReporter.launcher": "Report a bug",
  "bugReporter.crashButton": "Report this crash",
  "title.tagline": "Design and run your course",
  "title.noSave": "No saved game",
  "title.continue": "Continue",
  "title.continueHint": "Resume your most recent course",
  "title.newGame": "New Game",
  "title.quickStart": "Quick Start",
  "title.quickStartHint": "Skip setup — fresh sandbox land",
  "title.load": "Load Game",
  "title.options": "Options",
  "title.footer": "A cozy golf management experience",
  "title.achievements": "Trophy Gallery",
  "title.install": "Install CourseCraft",
  "title.vision": "The Vision",
  "title.visionHint": "See the world this game can become",
  "vision.nav.aria": "CourseCraft vision navigation",
  "vision.nav.vision": "The Vision",
  "vision.nav.story": "The Story",
  "vision.nav.systems": "The Systems",
  "vision.nav.play": "Play It",
  "vision.nav.world": "The World",
  "vision.back": "Back to game",
  "vision.share": "Share the vision",
  "vision.copied": "Link copied",
  "vision.share.title": "The vision for CourseCraft",
  "vision.share.text": "See the golf world CourseCraft could become.",
  "vision.hero.kicker": "The long-range vision for CourseCraft",
  "vision.hero.title": "Build the course. Shape the world.",
  "vision.hero.deck": "A cozy golf world where you shape every contour, run the club, play the course yourself, and build a legacy that belongs to you.",
  "vision.hero.cta": "Explore the vision",
  "vision.hero.imageAlt": "An expansive living golf destination with a clubhouse, practice grounds, lakes, homes, golfers, and staff",
  "vision.hero.captionLabel": "The destination",
  "vision.hero.caption": "One estate, shaped from first survey to enduring institution",
  "vision.story.eyebrow": "The north star",
  "vision.story.title": "More than a course builder.",
  "vision.story.body": "CourseCraft is the fantasy of growing a patch of promising land into a golf world with history. Design holes worth remembering, play them through your own Player Pro, operate the club behind the scorecard, and watch every choice ripple across the estate.",
  "vision.principle.create.title": "Create it",
  "vision.principle.create.body": "Sculpt the ground, route the holes, set the tees and pins, and make strategic golf from the landscape you inherit.",
  "vision.principle.operate.title": "Run it",
  "vision.principle.operate.body": "Price the experience, staff the campus, manage pace, expand facilities, and keep the promises your club makes.",
  "vision.principle.remember.title": "Live with it",
  "vision.principle.remember.body": "Golfers develop opinions, records become lore, communities react, and the course earns a reputation that cannot be faked.",
  "vision.course.imageAlt": "A windswept coastal golf hole with alternate routes, golfers, grounds crew, dunes, bunkers, and a seaside green",
  "vision.course.imageCaption": "Storyboard 01 · The land becomes strategy",
  "vision.course.kicker": "Every hole is authored",
  "vision.course.title": "Read the land. Draw the risk. Watch it play.",
  "vision.course.body": "The course is not a backdrop. Its slopes, carries, approaches, hazards, sightlines, and walking routes create the decisions that golfers make—and the stories they tell afterward.",
  "vision.course.beat1": "Freeform routing and terrain sculpting",
  "vision.course.beat2": "Multiple tees, pins, and daily setups",
  "vision.course.beat3": "Golfer skill, personality, and shot planning",
  "vision.course.beat4": "Architecture reports and safety tradeoffs",
  "vision.future.kicker": "The next leap",
  "vision.future.title": "Play the course you imagined.",
  "vision.future.body": "Step onto your own fairways as the Player Pro. Choose the club, line, power, and technique; live with the result; then bring real shot evidence back into the design. Around that loop, seasons turn, people remember, and the club becomes a story you can finish—or keep playing for years.",
  "vision.future.loopAria": "The CourseCraft creative loop",
  "vision.future.loop.build": "Build",
  "vision.future.loop.play": "Play",
  "vision.future.loop.learn": "Understand",
  "vision.future.loop.redesign": "Redesign",
  "vision.future.play.milestone": "Player Pro · M36–37",
  "vision.future.play.title": "Take every shot",
  "vision.future.play.body": "Create your Pro and play complete rounds with direct isometric decisions from drive to final putt. Grow Power, Driving, Irons, Short Game, Putting, and Recovery through what you actually do.",
  "vision.future.play.detail": "Club choice · free aim · shot shape · matches · tournaments",
  "vision.future.feedback.milestone": "Architecture · M38",
  "vision.future.feedback.title": "Design from evidence",
  "vision.future.feedback.body": "Read shot traces, dispersion, landing heatmaps, recovery routes, and scoring by tee. Jump from a revealing miss back to that exact hole and compare the redesign against the round that inspired it.",
  "vision.future.feedback.detail": "Play it · study it · make the hole better",
  "vision.future.people.milestone": "Living stories · M38",
  "vision.future.people.title": "Know who walks the course",
  "vision.future.people.body": "Regular golfers and named staff keep traits, relationships, memories, personal records, and history. Their choices and yours become grounded club stories with consequences and callbacks.",
  "vision.future.people.detail": "Favorites · friendships · rivalries · club folklore",
  "vision.future.seasons.milestone": "Annual legacy · M39",
  "vision.future.seasons.title": "Let the years change you",
  "vision.future.seasons.body": "A 32-week calendar brings forecasts, weather, turf pressure, strategic closures, and annual decisions. Choose a club identity and look back through awards, rankings, yearbooks, and a living timeline.",
  "vision.future.seasons.detail": "Four charters · four seasons · one evolving institution",
  "vision.future.campaign.milestone": "Career · M40",
  "vision.future.campaign.title": "Earn the championship ending",
  "vision.future.campaign.body": "A rebuilt career follows your Player Pro through phased goals, recurring characters, recoverable complications, consequential choices, playable matches, mastery medals, and a final championship.",
  "vision.future.campaign.detail": "A 12–18 hour authored journey with your own epilogue",
  "vision.future.premium.milestone": "Premium game · M41–44",
  "vision.future.premium.title": "Own a game made to last",
  "vision.future.premium.body": "A cohesive Design, Operate, and Legacy interface meets richer art and audio, accessibility, offline desktop play, native saves, Steam features, and shareable course and challenge packages.",
  "vision.future.premium.detail": "Windows · macOS · Steam Cloud · Workshop · save-compatible demo",
  "vision.caddie.kicker": "Your companion, not your commander",
  "vision.caddie.quote": "That is a brave carry. Give them a bailout and they will call you clever instead of cruel.",
  "vision.caddie.body": "The tutorial caddie grows into a true club advisor: teaching unfamiliar players, noticing the course you actually built, celebrating breakthroughs, and warning you before a small problem becomes club folklore.",
  "vision.caddie.tag1": "Contextual coaching",
  "vision.caddie.tag2": "Course-aware advice",
  "vision.caddie.tag3": "A little personality",
  "vision.systems.kicker": "Depth through connection",
  "vision.systems.title": "Systems that meet on the course.",
  "vision.systems.body": "The magic is not a long feature list. It is the way design, simulation, hospitality, money, reputation, and human stories push on one another.",
  "vision.feature.design.title": "Course architecture",
  "vision.feature.design.body": "Shape fairways, greens, hazards, elevation, sightlines, crossings, and the rhythm between holes.",
  "vision.feature.design.detail": "Beauty · strategy · safety · walkability",
  "vision.feature.golfers.title": "Living golfers",
  "vision.feature.golfers.body": "Distinct abilities and motivations turn the same hole into different plans, misses, reactions, and memories.",
  "vision.feature.golfers.detail": "Skill · archetypes · rounds · records",
  "vision.feature.campus.title": "A working campus",
  "vision.feature.campus.body": "Clubhouse rooms, practice facilities, roads, parking, staff, carts, and upkeep form one visible operation.",
  "vision.feature.campus.detail": "Capacity · condition · staffing · service",
  "vision.feature.business.title": "A club economy",
  "vision.feature.business.body": "Green fees are only the beginning: memberships, lessons, retail, dining, outings, lodging, and property all carry tradeoffs.",
  "vision.feature.business.detail": "Demand · margin · reputation · reinvestment",
  "vision.feature.events.title": "Big golf days",
  "vision.feature.events.body": "Host tournaments and outings that test the course setup, spectator flow, staff, pace, and hospitality promise.",
  "vision.feature.events.detail": "Fields · leaderboards · standards · spectacle",
  "vision.feature.legacy.title": "A lasting legacy",
  "vision.feature.legacy.body": "Records, rivalries, achievements, famous holes, community decisions, and long-term history make each estate personal.",
  "vision.feature.legacy.detail": "History · identity · consequences · pride",
  "vision.clubhouse.imageAlt": "A lively timber and stone golf clubhouse campus with a pro shop, restaurant terrace, putting green, carts, guests, and staff",
  "vision.clubhouse.kicker": "Storyboard 02 · The course becomes a club",
  "vision.clubhouse.title": "Buildings with a job to do.",
  "vision.clubhouse.body": "Every expansion should be visible on the estate and felt in the operation. A new restaurant wing changes capacity and staffing. A practice academy creates lessons and traffic. A lodge turns a morning tee time into a destination stay.",
  "vision.clubhouse.metric1.value": "One map",
  "vision.clubhouse.metric1.label": "Course and campus",
  "vision.clubhouse.metric2.value": "Every day",
  "vision.clubhouse.metric2.label": "Guests and operations",
  "vision.clubhouse.metric3.value": "Your call",
  "vision.clubhouse.metric3.label": "Growth and tradeoffs",
  "vision.arc.kicker": "The long game",
  "vision.arc.title": "A save worth caring about.",
  "vision.chapter.land.title": "Claim the land",
  "vision.chapter.land.body": "Survey the property, buy carefully, preserve its character, and choose the first nine holes that define the club.",
  "vision.chapter.course.title": "Earn a following",
  "vision.chapter.course.body": "Open the gates, learn who loves the course, improve its weak spots, and build a reputation one round at a time.",
  "vision.chapter.club.title": "Grow the institution",
  "vision.chapter.club.body": "Add facilities, professionals, memberships, events, and hospitality without losing control of service or identity.",
  "vision.chapter.legacy.title": "Leave a legacy",
  "vision.chapter.legacy.body": "Host defining championships, shape the surrounding community, and look back on decades of records and decisions.",
  "vision.finale.kicker": "The feeling we are chasing",
  "vision.finale.title": "Your favorite course should exist only in your save.",
  "vision.finale.body": "Not because it has the highest score, but because you remember why the sixth green tilts that way, who set the course record, and what it took to build the clubhouse beyond it.",
  "vision.finale.cta": "Return to CourseCraft",
  "vision.footer": "A cozy golf management world in the making",
  "common.close": "Close",
  "common.done": "Done",
  "common.off": "Off",
  "common.on": "On",
  "common.options": "Options",
  "common.reset": "Reset {section}",
  "terrainStroke.title": "{terrain} stroke · {count} tiles",
  "terrainStroke.costs": "Construction {gross} · Salvage {salvage}",
  "terrainStroke.earthwork": "Automatic basin · {steps} earthwork steps ({cost})",
  "terrainStroke.clears": "Clears {count} dry-land props",
  "terrainStroke.protected": "{count} protected-tree land islands",
  "terrainStroke.protectedIsland": "Protected trees remain on land islands.",
  "terrainStroke.net": "Net {net}",
  "terrainStroke.refund": "{amount} refund",
  "terrainStroke.cash": "Cash {cash} → {projected}",
  "terrainStroke.exclusions": "Excluded {excluded} invalid · {unchanged} unchanged · {duplicates} repeats",
  "terrainStroke.insufficient": "Insufficient funds · {shortfall} short",
  "terrainStroke.instructions": "Release to apply · Esc to cancel",
  "terrainEdit.undone": "Terrain edit undone.",
  "terrainEdit.redone": "Terrain edit restored.",
  "terrainEdit.curve": "Curve",
  "terrainEdit.spline": "Spline",
  "terrainEdit.area": "Area",
  "terrainEdit.edit": "Edit nodes",
  "terrainEdit.width": "Brush width",
  "terrainEdit.narrow": "Narrow",
  "terrainEdit.medium": "Medium",
  "terrainEdit.wide": "Wide",
  "terrainEdit.undo": "Undo terrain edit",
  "terrainEdit.redo": "Redo terrain edit",
  "renderer.error.title": "The course view could not start",
  "renderer.error.body": "Reload the page to try again. Your saved courses remain on this device.",
  "courses.open": "Courses",
  "courses.title": "Course Manager",
  "courses.close": "Close Course Manager",
  "courses.create": "Create course",
  "courses.addHole": "Add estate hole",
  "courses.name": "Course name",
  "courses.greenFee": "Green fee",
  "courses.operating": "Operating state",
  "courses.openState": "Open",
  "courses.closedState": "Closed",
  "courses.draft": "Draft routing",
  "courses.published": "Published routing",
  "courses.unassigned": "Unassigned hole",
  "courses.assign": "Assign hole",
  "courses.up": "Move up",
  "courses.down": "Move down",
  "courses.remove": "Remove from draft",
  "courses.publish": "Publish routing",
  "courses.publishedSuccess": "Routing published atomically.",
  "courses.none": "No unassigned holes remain. Add a new estate hole or move one from another course.",
  "courses.routeSummary": "{draft} draft · {published} published",
  "courses.metrics": "Operating metrics",
  "courses.metricLine": "Rating {rating} · Slope {slope} · Quality {quality} · Demand {demand} · {visitors}/{capacity} daily rounds",
  "architecture.title": "Architect Report",
  "architecture.subtitle": "Advisory design intelligence for the selected published course. It informs demand but never blocks publication.",
  "architecture.totalLabel": "Architecture score: {score} out of 100",
  "architecture.findings": "{count, plural, one {# finding} other {# findings}}",
  "architecture.noWarnings": "No material routing or safety concerns were found.",
  "architecture.jump": "Show on course",
  "architecture.learn": "Read architecture concepts",
  "architecture.component.routing": "Routing",
  "architecture.component.naturalFit": "Natural fit",
  "architecture.component.variety": "Variety",
  "architecture.component.safety": "Safety",
  "architecture.component.walkability": "Walkability",
  "architecture.explanation.routing": "Published order averages {transfer} tiles between holes; clubhouse access totals {clubhouse} tiles.",
  "architecture.explanation.naturalFit": "{retained}% of surveyed terrain remains; earthwork averages {earthwork} steps per 100 tiles.",
  "architecture.explanation.variety": "{pars} par types, {lengths} length bands, {directions} directions, and {shapes} routing shapes create the playing mix.",
  "architecture.explanation.safety": "{crossings} crossings, {parallels} close parallel relationships, and {repetitions} repetitive transitions were found.",
  "architecture.explanation.walkability": "{routed} of {transfers} transfers use playable paths; total off-hole walking is {total} tiles.",
  "architecture.warning.transfer": "A green-to-tee transfer is unusually long.",
  "architecture.warning.clubhouse": "A starting or finishing point sits far from the clubhouse.",
  "architecture.warning.repetition": "Consecutive holes repeat a similar direction and length.",
  "architecture.warning.crossing": "Shot corridors cross.",
  "architecture.warning.parallel": "Parallel shot corridors form a close danger zone.",
  "architecture.warning.earthwork": "Extensive earthwork changes the surveyed contours.",
  "architecture.warning.terrain": "A large share of the natural surface has been rebuilt.",
  "common.week": "Week {week}",
  "courseSetup.title": "Tee & Pin Setup",
  "courseSetup.region": "Tee and pin setup",
  "courseSetup.dailyPin": "Daily pin",
  "courseSetup.activePin": "Active daily pin rotation",
  "courseSetup.tee": "tee",
  "courseSetup.pin": "Pin {rotation}",
  "courseSetup.place": "Place",
  "courseSetup.move": "Move",
  "courseSetup.placed": "Placed on course",
  "courseSetup.notPlaced": "Not placed",
  "courseSetup.markerActionAria": "{action} {marker} on map",
  "courseSetup.remove": "Remove {marker}",
  "courseSetup.help": "Use Place or Move, then select a location on the course. Pins B/C must use existing green terrain. Forward ≤ Member ≤ Championship by playing distance.",
  "courseSetup.golfer": "{tee} tees · Pin {pin}",
  "courseSetup.difficultyDelta": "setup Δ {delta}",
  "courseSetup.ratingMatrix": "Tee rating matrix",
  "courseSetup.rating": "Rating",
  "courseSetup.slope": "Slope",
  "courseSetup.yards": "Yards",
  "courseSetup.rotations": "Rotations",
  "courseSetup.rotationDeltas": "A/B/C Δ",
  "courseSetup.complete": "complete",
  "courseSetup.offerAria": "Additional tee boxes",
  "courseSetup.offerTitle": "Build additional tee boxes?",
  "courseSetup.offerHelp": "Add them now, or click any tee later to manage the hole.",
  "courseSetup.offerBuild": "Build {tee} tee · from {cost}",
  "courseSetup.notNow": "Not now",
  "courseSetup.confirmAria": "Confirm tee construction",
  "courseSetup.confirmTitle": "{action} {tee} tee?",
  "courseSetup.actionErect": "Erect",
  "courseSetup.actionMove": "Move",
  "courseSetup.placementAria": "Map marker placement",
  "courseSetup.placementTitle": "{action} {marker} on the course",
  "courseSetup.placementHelp": "Click or tap a valid location on the map. Press Esc to cancel.",
  "courseSetup.placementCost": "Construction cost {cost}",
  "courseSetup.placementSalvage": "Net salvage {value}",
  "courseSetup.shortfall": "Insufficient funds. Short by {amount}.",
  "courseSetup.confirm": "Confirm",
  "courseSetup.chooseAnother": "Choose another location",
  "courseSetup.cancelPlacement": "Cancel placement",
  "courseSetup.cancel": "Cancel",
  "courseSetup.par": "Par",
  "courseSetup.teeParAria": "{tee} tee par",
  "courseSetup.autoPar": "Auto ({par})",
  "courseSetup.routeSummary": "{yards} yds · {status}",
  "courseSetup.playable": "Playable",
  "courseSetup.routeBlocked": "Route blocked",
  "courseSetup.notErected": "Not erected",
  "retention.title": "Course Legacy",
  "retention.subtitle": "History, records, memorable golfers, and trophies",
  "retention.tabs": "Course legacy sections",
  "retention.tab.history": "Course History",
  "retention.tab.records": "Records",
  "retention.tab.hall": "Hall of Fame",
  "retention.tab.achievements": "Achievements",
  "retention.cash": "Cash",
  "retention.rating": "Course rating",
  "retention.reputation": "Reputation",
  "retention.profit": "Weekly profit",
  "retention.bestRound": "Best round",
  "retention.aces": "Holes-in-one",
  "retention.revenueRecord": "Revenue record",
  "retention.attendanceRecord": "Attendance record",
  "retention.profitStreak": "Longest profit streak",
  "retention.hardestHole": "Hardest hole",
  "retention.courseFilter": "Records course",
  "retention.allCourses": "All courses",
  "retention.roundCount": "{count} rounds",
  "retention.aceCount": "{count} aces",
  "retention.emptyHall": "The Hall of Fame is waiting for its first memorable round.",
  "retention.hiddenHint": "A hidden achievement. Keep experimenting.",
  "retention.unlocked": "Achievement unlocked",
  "retention.toastQueued": "{count} more trophies queued",
  "retention.noNews": "The course is quiet — notable moments will appear here.",
  "retention.feed": "Event Feed",
  "retention.hideTicker": "Hide news ticker",
  "retention.filter.all": "All",
  "retention.filter.play": "Play",
  "retention.filter.economy": "Economy",
  "retention.filter.milestone": "Milestones",
  "retention.weekDay": "W{week} D{day}",
  "retention.open": "Records",
  "retention.ticker": "News",
  "retention.photo": "Photo",
  "retention.holeInOne": "{golfer} made an ace on hole {hole}!",
  "retention.courseRecord": "{golfer} set a new course record at {score}.",
  "retention.weekProfit": "Week {week} closed with {profit} profit.",
  "retention.attendance": "A record {rounds} rounds were hosted this week.",
  "photo.capture": "Capture PNG",
  "photo.courseCard": "Course Card",
  "photo.share": "Share",
  "photo.golfers": "Golfers",
  "photo.markers": "Markers",
  "photo.exit": "Exit Photo Mode",
  "photo.saved": "Course photo saved.",
  "photo.cardSaved": "Course card saved.",
  "photo.shared": "Course card shared.",
  "pwa.update": "A new CourseCraft version is ready.",
  "pwa.reload": "Save & Reload",
  "pwa.storageWarning": "Browser storage is not protected from cleanup; export important saves.",
  "common.weekLabel": "Week",
  "common.day": "Day {day} / {days}",
  "common.golfers": "{n, plural, one {# golfer} other {# golfers}}",
  "game.header.defaultTitle": "SimGolf-lite Tycoon",
  "game.header.defaultSubtitle": "Build • Route • Manage",
  "game.mode.editor": "Editor",
  "game.mode.metrics": "Metrics",
  "game.mode.results": "Results",
  "game.mode.upgrades": "Upgrades",
  "stat.cash": "Cash",
  "stat.reputation": "Reputation",
  "stat.reputationShort": "Rep",
  "stat.condition": "Condition",
  "stat.courseRating": "Course rating",
  "live.onCourse": "On course",
  "live.roundsToday": "Rounds today",
  "live.feesToday": "Fees today",
  "live.shopsToday": "Shops today",
  "live.yesterdayProfitLoss": "Yesterday P&L",
  "live.overview": "Live overview",
  "live.openOverview": "Open live overview",
  "live.closeOverview": "Close live overview",
  "live.overviewTabs": "Live overview sections",
  "live.tab.golfers": "Golfers",
  "live.tab.leaderboard": "Leaderboard",
  "live.tab.staff": "Staff",
  "live.tab.pace": "Pace",
  "live.arrivals": "{count, plural, one {# arrival remaining} other {# arrivals remaining}}",
  "live.nextArrival": "Next group {time}",
  "live.noGolfers": "No golfers are on the course yet.",
  "live.hole": "Hole {hole}",
  "live.clubhouse": "Clubhouse",
  "live.mood": "Golfer mood",
  "live.staffCoverage": "{active} of {available} unlocked roles staffed",
  "live.staffHint": "Staff coverage improves demand, course care, and pace.",
  "live.onDuty": "on duty",
  "live.available": "available",
  "live.weeklyWage": "${wage}/wk",
  "live.assignStaff": "Assign {name}",
  "live.pace.teeInterval": "Tee interval",
  "live.pace.teeIntervalAria": "Tee interval minutes",
  "live.pace.beverageService": "Beverage service",
  "live.pace.refreshments": "Refreshments",
  "live.pace.beerWine": "Beer & wine",
  "live.pace.minutes": "{minutes} min",
  "live.pace.maximumGroup": "Maximum group",
  "live.pace.groupsBlocked": "Groups / blocked",
  "live.pace.averageWait": "Average wait",
  "live.pace.marshalCoverage": "Marshal coverage",
  "live.pace.interventionsPickups": "Interventions / pickups",
  "live.pace.beverageCoverage": "Beverage coverage",
  "live.pace.beverageRevenue": "Beverage revenue",
  "live.pace.alcoholIncidents": "Alcohol / incidents",
  "live.pace.policyHint": "Policy changes apply to the next tee sheet. Blocked groups are never penalized by marshals.",
  "live.pace.lastTee": "Last tee minute",
  "live.pace.daylight": "Daylight policy",
  "live.pace.finishStarted": "Let started groups finish",
  "live.pace.strictSunset": "Stop at sunset",
  "live.pace.compensation": "Guest recovery",
  "live.pace.refund": "Cash refund",
  "live.pace.credit": "Club credit",
  "live.pace.goodwill": "Goodwill voucher",
  "live.pace.identity": "Rolling pace identity",
  "live.pace.identityDetail": "{days} operating days · skilled/impatient {skilled}% · novice/social {novice}%",
  "live.pace.bottlenecks": "Measured hole bottlenecks",
  "live.pace.noBottlenecks": "No sustained local bottleneck has enough evidence yet.",
  "live.pace.action": "Action",
  "live.pace.reportCourse": "Report course",
  "live.pace.period": "Period",
  "live.pace.sevenDays": "7 days",
  "live.pace.twentyEightDays": "28 days",
  "live.pace.noHistory": "No settled pace history yet.",
  "live.pace.sparse": "Early sample — use this directionally until more groups finish.",
  "live.pace.roundsComplete": "Completed / incomplete",
  "live.pace.durationP90": "Average / p90 duration",
  "live.pace.durationPair": "{average} / {p90} min",
  "live.pace.waitPickups": "Wait / pickups",
  "live.pace.waitPickupValue": "{wait} min / {pickups}",
  "live.pace.teeHourRevenue": "Gross / net per tee hour",
  "live.pace.overtimeComp": "Overtime / recovery",
  "live.pace.beverageNet": "Beverage / net revenue",
  "live.follow": "Follow",
  "live.following": "Following",
  "live.stopFollowing": "Stop following golfer",
  "live.followGolfer": "Follow golfer",
  "progression.eyebrow": "Course reputation tier",
  "progression.current": "{reputation}/100 reputation",
  "progression.next": "Next: {name} at {reputation}",
  "progression.max": "All tiers unlocked",
  "progression.close": "Close progression",
  "progression.open": "Progression",
  "progression.staff": "Staff: {role} · cap {level}/5 · concession tier {building}",
  "progression.locked": "Unlocks at {reputation} reputation.",
  "defeat.weeksSurvived": "Weeks survived",
  "defeat.peakReputation": "Peak reputation",
  "defeat.peakCash": "Peak cash",
  "defeat.ratingSlope": "Course rating / slope",
  "golfer.position": "Position",
  "golfer.score": "Score",
  "golfer.thru": "Thru",
  "golfer.spent": "Spent",
  "golfer.wallet": "Wallet",
  "golfer.holeScoreTitle": "Hole {hole} · par {par} · {score}",
  "golfer.identityApproach": "Identity & approach",
  "golfer.riskStyle": "{style} · power {power} · accuracy {accuracy}",
  "golfer.skillLine": "Irons {irons} · short game {shortGame} · recovery {recovery}",
  "golfer.strengths": "Strengths: {values}",
  "golfer.balanced": "balanced",
  "golfer.planLine": "{kind} · {club} · risk {risk}%",
  "golfer.rejected": "Rejected: {values}",
  "golfer.none": "none",
  "golfer.outcomeLine": "{club} · {before} → {after} · {penalty} penalty",
  "golfer.reaction": "{outcome} · {satisfaction}/100",
  "hud.difficultyTitle": "Difficulty: {difficulty} (fixed for this run)",
  "hud.buildingTierLabel": "{building} tier",
  "hud.buildingPriceLabel": "{building} price",
  "hud.cashHelp": "Cash help",
  "hud.reputationHelp": "Reputation help",
  "hud.conditionHelp": "Condition help",
  "hud.openHolesHelp": "Open holes help",
  "newGame.seedTitle": "Seed {seed}",
  "advisor.portraitLabel": "Caddie advisor, {expression}",
  "pause.title": "Game paused",
  "pause.unsaved": "Unsaved course changes",
  "pause.saved": "All progress saved",
  "pause.hint": "Esc resumes • Space toggles the game clock",
  "pause.resume": "▶ Resume",
  "pause.save": "💾 Save game",
  "pause.load": "📁 Load game",
  "pause.options": "⚙ Options",
  "pause.restart": "↻ Restart scenario",
  "pause.quit": "⌂ Quit to title",
  "weekClose.eyebrow": "Week {week} complete",
  "weekClose.title": "The books are closed",
  "weekClose.rounds": "Rounds played",
  "weekClose.revenue": "Revenue",
  "weekClose.costs": "Operating costs",
  "weekClose.satisfaction": "Guest satisfaction",
  "weekClose.profit": "Profit {profit}",
  "weekClose.continue": "Continue to Monday",
  "weekClose.resultsHint": "Run the live clock through Sunday to close the books.",
  "options.subtitle": "Changes apply immediately and save outside your course files.",
  "options.close": "Close options",
  "options.tabs.label": "Option categories",
  "options.tab.gameplay": "Gameplay",
  "options.tab.graphics": "Graphics",
  "options.tab.audio": "Audio",
  "options.tab.accessibility": "Accessibility",
  "options.resetConfirm": "Reset {section} options to defaults?",
  "options.locale": "Language preview",
  "options.localeHint": "Pseudo-localization is a developer layout check.",
  "options.locale.en": "English",
  "options.locale.pseudo": "Pseudo — expanded",
  "settings.newsTicker": "News ticker",
  "settings.momentCamera": "Moment camera",
  "settings.momentCameraHint": "Briefly pan to major live-simulation moments.",
  "a11y.colorVision": "Color-vision palette",
  "a11y.terrainPatterns": "Terrain patterns",
  "a11y.reducedMotion": "Reduced motion",
  "a11y.textScale": "Text scale",
  "a11y.keyboard": "Keyboard controls",
  "a11y.keyboardHint": "Review and remap every game action",
  "a11y.configure": "Configure keybindings…",
  "a11y.palette.standard": "Standard",
  "a11y.palette.deuteranopia": "Deuteranopia-safe",
  "a11y.palette.protanopia": "Protanopia-safe",
  "a11y.palette.tritanopia": "Tritanopia-safe",
  "save.quick": "Quick Save",
  "save.quickComplete": "Quick save complete.",
  "quit.confirm": "Quit to title and lose unsaved changes?",
  "flyover.disabled": "Flyover is disabled while reduced motion is on.",
  "tip.incomplete": "You have {n} incomplete holes (missing tee/green).",
  "tip.waterLine": "Hole {hole}: water on the direct line reduces playability — move it off the corridor.",
  "tip.roughLine": "Hole {hole}: the tee→green line is mostly rough — paint a fairway corridor.",
  "tip.unfair": "Hole {hole}: long + hazard-heavy — feels unfair; reduce hazards or shorten it.",
  "tip.aestheticsLine": "Hole {hole}: aesthetics suffers because hazards are on the line — keep water/sand near the corridor, not on it.",
  "tip.lowPlayability": "Hole {hole}: low playability — reduce hazards/rough on the main corridor.",
  "tip.severalHard": "Several holes are very difficult (long + hazards) → many golfers will find it unfair.",
  "tip.waterHeavy": "3+ holes have lots of water on the direct corridor; casual golfers tend to avoid this.",
  "tip.lowAesthetics": "Aesthetics is low: add water/sand near fairway edges (not directly on the tee→green line).",
  "tutorial.lesson1.eyebrow": "Lesson 1 of 12",
  "tutorial.lesson1.title": "Meet your patch of earth",
  "tutorial.lesson1.body": "This is real sandbox land. We will build on it together, and everything you do here remains playable when the lesson ends.",
  "tutorial.lesson1.action": "Show me the tools",
  "tutorial.lesson2.eyebrow": "Lesson 2 of 12",
  "tutorial.lesson2.title": "Give the ball somewhere to go",
  "tutorial.lesson2.body": "Choose Fairway and paint a generous corridor. A few tiles are enough to continue; wider corridors are kinder to wayward shots.",
  "tutorial.lesson3.eyebrow": "Lesson 3 of 12",
  "tutorial.lesson3.title": "Pin down a hole",
  "tutorial.lesson3.body": "Open the Hole Wizard, place a tee at one end of your corridor and a green at the other, then confirm it.",
  "tutorial.lesson4.eyebrow": "Lesson 4 of 12",
  "tutorial.lesson4.title": "Read the shot plan",
  "tutorial.lesson4.body": "The dotted route estimates how golfers attack the hole. Look for a fair route, a rewarding alternative, and a recovery when a miss is part of the design.",
  "tutorial.lesson4.action": "I see it",
  "tutorial.lesson5.eyebrow": "Lesson 5 of 12",
  "tutorial.lesson5.title": "Make it playable",
  "tutorial.lesson5.body": "If the hole is flagged, use its Fix overlay and widen the marked landing corridor. The lesson accepts any valid design — no exact score required.",
  "tutorial.lesson6.eyebrow": "Lesson 6 of 12",
  "tutorial.lesson6.title": "Open for play",
  "tutorial.lesson6.body": "A full course needs nine valid holes. Keep using the wizard; you can continue the lesson early if this run already has a playable course.",
  "tutorial.lesson7.eyebrow": "Lesson 7 of 12",
  "tutorial.lesson7.title": "Let the first group breathe",
  "tutorial.lesson7.body": "Set the clock to 1× and watch a group arrive. Their reaction bubbles are honest little course reviews.",
  "tutorial.lesson8.eyebrow": "Lesson 8 of 12",
  "tutorial.lesson8.title": "Close the books",
  "tutorial.lesson8.body": "Open the Results tab after a week closes. Revenue is nice; profit is what survives after staff, maintenance, and overhead.",
  "tutorial.lesson9.eyebrow": "Lesson 9 of 12",
  "tutorial.lesson9.title": "Price with a light touch",
  "tutorial.lesson9.body": "Adjust the green fee. Higher prices earn more per round but can cool demand, especially for casual golfers.",
  "tutorial.lesson10.eyebrow": "Lesson 10 of 12",
  "tutorial.lesson10.title": "Protect the grass",
  "tutorial.lesson10.body": "Change the maintenance budget. Underfunding saves cash today, then quietly taxes condition and reputation tomorrow.",
  "tutorial.lesson11.eyebrow": "Lesson 11 of 12",
  "tutorial.lesson11.title": "Reach a profitable week",
  "tutorial.lesson11.body": "Now tune the loop: fair price, healthy condition, attractive holes. Any positive weekly profit clears this lesson.",
  "tutorial.lesson12.eyebrow": "Lesson 12 of 12",
  "tutorial.lesson12.title": "Your course is open",
  "tutorial.lesson12.body": "You know the loop: design, observe, read the numbers, adjust. The sandbox is yours — and the career scenarios are waiting when you want a sharper test.",
  "tutorial.lesson12.action": "Graduate",
  "tutorial.skipConfirm": "Skip the tutorial? Your current course will stay exactly as it is.",
  "tutorial.offer.label": "First-launch tutorial",
  "tutorial.offer.eyebrow": "Welcome to CourseCraft",
  "tutorial.offer.title": "Build your first course together",
  "tutorial.offer.body": "I can guide you from untouched land to your first profitable week. This is a real sandbox run, and you can skip or leave the lesson at any time.",
  "tutorial.offer.skip": "Skip tutorial",
  "tutorial.offer.start": "Start guided course",
  "tutorial.continue": "Continue",
  "tutorial.completeTask": "Complete the highlighted task",
  "advisor.cash.title": "The clubhouse till is getting light",
  "advisor.cash.body": "We have less than two weeks of recent expenses in cash. Trim a budget or raise revenue before the bank starts practicing its swing.",
  "advisor.condition.title": "The turf is asking for help",
  "advisor.condition.body": "Condition has slipped below 55%. A stronger maintenance budget now is cheaper than rebuilding reputation later.",
  "advisor.profit.title": "That week finished under par",
  "advisor.profit.body": "A {profit} profit — proof that the course loop is working. Now make it repeatable.",
  "advisor.turnaways.title": "The tee sheet is bursting",
  "advisor.turnaways.body": "{count} golfers were turned away. More valid holes add capacity without asking marketing to work any harder.",
  "advisor.weakHole.title": "Hole {hole} needs a quiet word",
  "advisor.architecture.title": "The routing deserves another look",
  "advisor.architecture.body": "{course} scores {score}/100 for architecture. The Architect Report highlights the most useful improvement without prescribing one style.",
  "advisor.strategy.title": "The hole has a strategic story",
  "advisor.strategy.body": "{course}: {detail} The affected cohorts are {cohorts}. Check the marked location before changing the design.",
  "advisor.expansion.title": "The estate can grow",
  "advisor.expansion.body": "A healthy first course can now support a careful parcel purchase. Keep a cash reserve: land, construction, staffing, and maintenance all arrive separately.",
  "golfopedia.management.architecture.title": "Golf architecture",
  "golfopedia.management.architecture.summary": "A balanced reading of routing, natural fit, variety, safety, and walkability.",
  "golfopedia.management.architecture.detail1": "The report explains measurable relationships; it does not declare one visual style correct.",
  "golfopedia.management.architecture.detail2": "Architecture nudges demand within a small bound and never prevents a course from opening.",
  "golfopedia.management.strategicArchitecture.title": "Strategic hole design",
  "golfopedia.management.strategicArchitecture.summary": "A good hole offers a fair route, a meaningful alternative, and a reward for a strength without requiring one answer.",
  "golfopedia.management.strategicArchitecture.detail1": "The strategic read compares power, accuracy, short-game, recovery, and casual cohorts using bounded deterministic samples.",
  "golfopedia.management.strategicArchitecture.detail2": "Use the options and advantage overlays to see the responsible geometry. Recommendations preview edits but never apply them automatically.",
  "golfopedia.management.routing.title": "Routing and returning nines",
  "golfopedia.management.routing.summary": "Published hole order shapes flow from the clubhouse and around the property.",
  "golfopedia.management.routing.detail1": "Returning nines bring the ninth and eighteenth greens back toward shared facilities.",
  "golfopedia.management.routing.detail2": "Short transfers can feel coherent, while a spacious walk may suit a deliberate landscape.",
  "golfopedia.management.naturalFit.title": "Natural fit",
  "golfopedia.management.naturalFit.summary": "Retained ground and restrained earthwork describe how construction responds to the surveyed land.",
  "golfopedia.management.naturalFit.detail1": "Natural fit rewards awareness of existing terrain, not a mandatory untouched aesthetic.",
  "golfopedia.management.naturalFit.detail2": "Earthwork can still be the right choice when it serves play, drainage, or accessibility.",
  "golfopedia.management.walkability.title": "Walkability",
  "golfopedia.management.walkability.summary": "Routed green-to-tee and clubhouse paths reveal the real journey between shots.",
  "golfopedia.management.walkability.detail1": "The report prefers playable walking paths over straight-line measurements when possible.",
  "golfopedia.management.walkability.detail2": "Long transfers are guidance, not a publication restriction.",
  "golfopedia.management.safety.title": "Routing safety",
  "golfopedia.management.safety.summary": "Crossings and close parallel corridors can place golfers near another hole's line of play.",
  "golfopedia.management.safety.detail1": "Warnings identify both holes and their map geometry so the relationship is inspectable.",
  "golfopedia.management.safety.detail2": "A warning invites redesign or conscious acceptance; it does not block publication.",
  "golfopedia.management.estateAccess.title": "Estate access and parking",
  "golfopedia.management.estateAccess.summary": "Every golfer, worker, diner, student, and event guest shares modeled road and parking capacity.",
  "golfopedia.management.estateAccess.detail1": "Road material, functional capacity, condition, parking, overflow transport, and construction determine how many arrivals can be served.",
  "golfopedia.management.estateAccess.detail2": "Peak demand can create denied service even when each individual facility has spare capacity.",
  "golfopedia.management.practiceAcademy.title": "Practice academy",
  "golfopedia.management.practiceAcademy.summary": "Ranges, greens, short-game grounds, bays, and practice loops are operating services rather than decorative bonuses.",
  "golfopedia.management.practiceAcademy.detail1": "Price, hours, stations, condition, upkeep, professionals, and shared access constrain served visits and skill gains.",
  "golfopedia.management.practiceAcademy.detail2": "Practice customers remain separate from the published golf routing and tee sheet.",
  "golfopedia.management.clubCampus.title": "Club campus",
  "golfopedia.management.clubCampus.summary": "Clubhouse shell tiers provide room slots; modules and standalone facilities add specific revenue capabilities.",
  "golfopedia.management.clubCampus.detail1": "Expansion previews show construction cost, downtime, upkeep, parking demand, and an estimated break-even volume.",
  "golfopedia.management.clubCampus.detail2": "Higher tiers can lose money when demand, staffing, hours, access, or condition cannot support their capacity.",
  "advisor.weakHole.body": "Its overall design score is lagging. Open the inspector and look at corridor safety, aesthetics, and effective distance.",
  "advisor.finish.title": "One good hole at a time",
  "advisor.finish.body": "{count}/9 holes are valid. Finish the next cleanly before polishing the whole property.",
  "scenario.preparing": "Preparing {name}…",
  "scenario.replayable": " · replayable",
  "scenario.locked": "Complete the previous scenario to unlock.",
  "scenario.backNine.name": "The Back Nine",
  "scenario.backNine.blurb": "A friendly patch of parkland behind your uncle's farm. Get three holes open and show the books can balance.",
  "scenario.muniRescue.name": "Muni Rescue",
  "scenario.muniRescue.blurb": "The city's beloved municipal course has gone to seed. Nine tired holes, no budget, and a town watching. Bring it back.",
  "scenario.swampDeal.name": "Swamp Deal",
  "scenario.swampDeal.blurb": "The land was cheap for a reason: it's half water. No bank will touch the deal — design your way out of the wet.",
  "scenario.links.name": "Links by the Sea",
  "scenario.links.blurb": "Dunes, fescue, and a cold gray sea. The handful of trees are heritage-listed — the course must be found, not forced.",
  "scenario.members.name": "The Members Club",
  "scenario.members.blurb": "Fairhaven's committee sets the green fee, not you — and their members expect perfection. Keep the standards, keep the streak.",
  "scenario.championship.name": "Championship Dream",
  "scenario.championship.blurb": "Raw land, hard money, and one ambition: a course worthy of hosting a championship. Build the resume the tour can't ignore.",
  "scenario.goal.threeHoles.label": "Open three holes",
  "scenario.goal.threeHoles.description": "Build 3 playable holes.",
  "scenario.goal.firstProfit.label": "Turn a profit",
  "scenario.goal.firstProfit.description": "Finish a week in the black.",
  "scenario.goal.restoreTurf.label": "Restore the turf",
  "scenario.goal.restoreTurf.description": "Bring course condition back to 70%.",
  "scenario.goal.winBackTown.label": "Win back the town",
  "scenario.goal.winBackTown.description": "Reach 55 reputation.",
  "scenario.goal.drainBuild.label": "Drain and build",
  "scenario.goal.drainBuild.description": "Open all 9 holes on the wetland parcel.",
  "scenario.goal.respectable.label": "Make it respectable",
  "scenario.goal.respectable.description": "Reach a course rating of 67.",
  "scenario.goal.routLinks.label": "Rout the links",
  "scenario.goal.routLinks.description": "Open all 9 holes.",
  "scenario.goal.properTest.label": "A proper test",
  "scenario.goal.properTest.description": "Reach a course rating of 70.",
  "scenario.goal.prestige.label": "Uphold the name",
  "scenario.goal.prestige.description": "Reach 75 reputation with picky, premium golfers.",
  "scenario.goal.steadyBooks.label": "Steady the books",
  "scenario.goal.steadyBooks.description": "String together 3 profitable weeks at the committee's fee.",
  "scenario.goal.fullCourse.label": "The full course",
  "scenario.goal.fullCourse.description": "Open all 9 holes.",
  "scenario.goal.tourQuality.label": "Tour quality",
  "scenario.goal.tourQuality.description": "Reach a course rating of 72 and 80 reputation.",
  "scenario.goal.warChest.label": "A championship war chest",
  "scenario.goal.warChest.description": "Bank $150,000 to fund the bid.",
  "campaign.open": "Campaign",
  "campaign.cast.rowan.role": "Advisor and caddie",
  "campaign.cast.mara.role": "Rival architect",
  "campaign.cast.eli.role": "Superintendent",
  "campaign.cast.beatrice.role": "Club captain",
  "campaign.cast.nadia.role": "Town planner",
  "campaign.cast.jamie.role": "Young golfer",
  "campaign.medal.bronze": "Bronze",
  "campaign.medal.bronze.description": "Complete every chapter phase.",
  "campaign.medal.silver": "Silver",
  "campaign.medal.silver.description": "Complete the chapter while meeting its visible stretch target.",
  "campaign.medal.gold": "Gold",
  "campaign.medal.gold.description": "Complete the chapter and master its architecture, people, or operations target.",
  "campaign.choice.listen": "Listen first",
  "campaign.choice.commit": "Commit to the plan",
  "campaign.choice.invest": "Invest in recovery",
  "campaign.choice.adapt": "Adapt the operation",
  "campaign.choice.open": "Open the club wider",
  "campaign.choice.balance": "Balance both promises",
  "campaign.choice.accept": "Accept the challenge",
  "campaign.choice.study": "Study the evidence",
  "campaign.preview.listen": "No immediate cost. The conversation and current facts remain in the campaign record.",
  "campaign.preview.commit": "Gain 1 reputation and record the commitment for later callbacks.",
  "campaign.preview.invest": "Spend $750 and restore 4% condition.",
  "campaign.preview.adapt": "Gain 1 reputation by changing the plan.",
  "campaign.preview.open": "Spend $300 and gain 2 reputation through broader access.",
  "campaign.preview.balance": "Gain 1 reputation while keeping the current operating model.",
  "campaign.preview.accept": "Gain 1 reputation and schedule the rival's fact-based follow-up.",
  "campaign.preview.study": "Restore 2% condition by acting on observed evidence.",
  "campaign.scene.progress.title": "The chapter moves forward",
  "campaign.scene.progress.body": "The completed phase is now part of the club record. The next objective begins from the exact course, people, and choices you created.",
  "campaign.scene.complication.title": "Conditions have changed",
  "campaign.scene.complication.body": "Current course facts have created a recoverable complication. Choose how the club responds.",
  "campaign.scene.choice.title": "A promise with consequences",
  "campaign.scene.choice.body": "The cast has read the current reputation, finances, charter, and course state. This choice will return in the chapter record.",
  "campaign.scene.callback.title": "The rival returns",
  "campaign.scene.callback.body": "Mara returns to the course and responds to the choice and measured course facts, not a scripted result.",
  "campaign.scene.narrator": "Campaign narrator",
  "campaign.scene.phase": "Phase {current} of {total} · {phase}",
  "campaign.scene.currentFacts": "Current campaign facts",
  "campaign.phase.backNine.1.title": "Find the first hole",
  "campaign.phase.backNine.1.summary": "Rowan asks you to read the land and build one valid hole before the wider operation opens.",
  "campaign.phase.backNine.2.title": "Play the proof",
  "campaign.phase.backNine.2.summary": "Build three holes, play the design, and use actual shot evidence to understand it.",
  "campaign.phase.backNine.3.title": "Open the Back Nine",
  "campaign.phase.backNine.3.summary": "Turn the small course into a viable operation without prescribing one correct layout.",
  "campaign.phase.muni.1.title": "Stabilize the muni",
  "campaign.phase.muni.1.summary": "Restore the neglected turf and give the staff a credible recovery window.",
  "campaign.phase.muni.2.title": "Win back trust",
  "campaign.phase.muni.2.summary": "Use price, condition, access, staffing, and visible play to rebuild community confidence.",
  "campaign.phase.muni.3.title": "Play for the town",
  "campaign.phase.muni.3.summary": "Jamie returns for a local match that tests whether the club now belongs to its regulars.",
  "campaign.phase.swamp.1.title": "Survey the wet ground",
  "campaign.phase.swamp.1.summary": "Find three playable holes without loans and preserve room for environmental recovery.",
  "campaign.phase.swamp.2.title": "Weather the recovery",
  "campaign.phase.swamp.2.summary": "Build a stronger route while the forecast and protected ground constrain the obvious answer.",
  "campaign.phase.swamp.3.title": "Answer the rival",
  "campaign.phase.swamp.3.summary": "Complete the nine and prove the routing against Mara's alternative reading of the property.",
  "campaign.phase.links.1.title": "Find the links",
  "campaign.phase.links.1.summary": "Route with the dunes and protected features instead of forcing a parkland pattern onto the coast.",
  "campaign.phase.links.2.title": "Design for the wind",
  "campaign.phase.links.2.summary": "Create strategic options that remain playable when the forecast changes the preferred line.",
  "campaign.phase.links.3.title": "The seaside match",
  "campaign.phase.links.3.summary": "Play the completed links against Mara and let the course, not a script, decide the story.",
  "campaign.phase.members.1.title": "Listen to the club",
  "campaign.phase.members.1.summary": "Read member, staff, charter, and community facts before choosing which promises the club will emphasize.",
  "campaign.phase.members.2.title": "Balance the books",
  "campaign.phase.members.2.summary": "Preserve standards and financial stability under the committee's fixed green fee.",
  "campaign.phase.members.3.title": "The captain's match",
  "campaign.phase.members.3.summary": "Resolve the chapter through played golf and the relationships created by earlier choices.",
  "campaign.phase.championship.1.title": "Qualify the property",
  "campaign.phase.championship.1.summary": "Publish a complete course and demonstrate Player Pro readiness before the bid proceeds.",
  "campaign.phase.championship.2.title": "Stage the championship",
  "campaign.phase.championship.2.summary": "Reach tour-quality architecture and reputation while the recurring cast resolves its unfinished work.",
  "campaign.phase.championship.3.title": "Play the final",
  "campaign.phase.championship.3.summary": "Enter the decisive tournament with the Player Pro, the club, and the exact legacy built across the campaign.",
  "campaign.goal.firstHole": "Build the first hole",
  "campaign.goal.firstHole.description": "Complete one valid hole before week 8.",
  "campaign.goal.playProof": "Build, play, understand",
  "campaign.goal.playProof.description": "Complete three holes and record a played round.",
  "campaign.goal.openCourse": "Open sustainably",
  "campaign.goal.openCourse.description": "Finish a profitable week before week 28.",
  "campaign.goal.restoreBasics": "Restore the basics",
  "campaign.goal.restoreBasics.description": "Bring course condition to 55% before week 12.",
  "campaign.goal.restoreTrust": "Restore community trust",
  "campaign.goal.restoreTrust.description": "Reach 40 reputation before week 24.",
  "campaign.goal.localMatch": "Host the local match",
  "campaign.goal.localMatch.description": "Record five rounds and reach 55 reputation.",
  "campaign.goal.dryRoute": "Find the dry route",
  "campaign.goal.dryRoute.description": "Complete three valid holes without loans.",
  "campaign.goal.weatherProof": "Build for recovery",
  "campaign.goal.weatherProof.description": "Complete six holes and reach a 63 course rating.",
  "campaign.goal.rivalMatch": "Answer the rival",
  "campaign.goal.rivalMatch.description": "Complete nine holes and prove the chapter's target rating.",
  "campaign.goal.findRouting": "Find the coastal routing",
  "campaign.goal.findRouting.description": "Complete three valid links holes.",
  "campaign.goal.windTest": "Create a wind test",
  "campaign.goal.windTest.description": "Complete six holes and reach a 66 course rating.",
  "campaign.goal.listenMembers": "Earn the room",
  "campaign.goal.listenMembers.description": "Reach 65 reputation before week 14.",
  "campaign.goal.balanceBooks": "Balance the fixed fee",
  "campaign.goal.balanceBooks.description": "Complete one profitable week under the committee price.",
  "campaign.goal.clubMatch": "Play the club match",
  "campaign.goal.clubMatch.description": "Reach 75 reputation, three profitable weeks, and fifteen recorded rounds.",
  "campaign.goal.propertyReady": "Qualify the property",
  "campaign.goal.propertyReady.description": "Publish one complete 18-hole operating course.",
  "campaign.goal.tourReady": "Reach tour readiness",
  "campaign.goal.tourReady.description": "Reach a 72 rating and 80 reputation.",
  "campaign.goal.finale": "Fund and play the final",
  "campaign.goal.finale.description": "Bank $150,000 and record twenty-five rounds.",
  "campaign.muni.jamie.memory": "Jamie keeps returning while the town decides whether the muni still belongs to it.",
  "campaign.muni.jamie.thought": "I want to see whether this place can feel like our course again.",
  "campaign.fact.cash": "Cash",
  "campaign.fact.charter": "Charter",
  "campaign.fact.reputation": "Reputation",
  "campaign.fact.condition": "Condition",
  "campaign.fact.week": "Week",
  "campaign.fact.greenFee": "Green fee",
  "campaign.fact.accessCapacity": "Access capacity",
  "campaign.fact.staffLevel": "Staff level",
  "campaign.fact.totalRounds": "Rounds",
  "campaign.fact.regularCount": "Named regulars",
  "campaign.fact.architectureEvidence": "Design evidence",
  "campaign.fact.playerCareerPoints": "Pro points",
  "campaign.fact.playerCareerRounds": "Pro rounds",
  "campaign.fact.playerMatchWins": "Match wins",
  "campaign.fact.playerSkillAverage": "Pro skill",
  "campaign.fact.scheduledTournaments": "Scheduled events",
  "campaign.fact.completedTournaments": "Completed events",
  "campaign.fact.severeForecastDays": "Severe forecast days",
  "campaign.fact.drainageLevel": "Drainage tier",
  "campaign.fact.legacyYears": "Yearbooks",
  "campaign.panel.eyebrow": "M40 authored career",
  "campaign.panel.title": "Campaign chapter",
  "campaign.panel.close": "Close campaign",
  "campaign.panel.currentFacts": "Current facts",
  "campaign.panel.phaseGoals": "Phase goals",
  "campaign.panel.recovery": "Recovery guidance",
  "campaign.panel.blockers": "{count} readiness items remain.",
  "campaign.panel.relationships": "Relationships",
  "campaign.panel.mastery": "Visible mastery criteria",
  "campaign.match.opening.title": "Opening-day match",
  "campaign.match.opening.description": "Play Rowan on your published route. The result is simulated from every shot you take.",
  "campaign.match.local.title": "Local match",
  "campaign.match.local.description": "Play Jamie on the recovered muni and let the course and your shots decide the result.",
  "campaign.match.rival.title": "Rival architect match",
  "campaign.match.rival.description": "Play Mara on the route you built. Winning is optional; finishing the evidence-bearing match is not.",
  "campaign.match.club.title": "Captain's match",
  "campaign.match.club.description": "Play Beatrice after resolving the club's charter, staff, access, and finance choices.",
  "campaign.match.championship.title": "CourseCraft Championship final",
  "campaign.match.championship.description": "Stage and directly play the final tournament. Victory and an honorable loss both produce a complete epilogue.",
  "campaign.match.championship.eventName": "CourseCraft Championship Final",
  "campaign.match.readiness": "Requires {points} Player Pro career points plus the visible phase goals.",
  "campaign.match.start": "Start playable match",
  "campaign.match.active": "Match in progress",
  "campaign.match.complete": "Match complete",
  "campaign.match.unavailable": "This campaign match is not available.",
  "campaign.match.objectivesFirst": "Complete the visible phase goals and requirements before starting this match.",
  "campaign.match.pointsRequired": "Earn {points} Player Pro career points before starting this match.",
  "campaign.recovery.standard": "All requirements are visible. Improve the listed fact by playing, operating, or redesigning; no hidden build order is required.",
  "campaign.recovery.backNineBuild": "Any valid hole routing works. Use the hole inspector to resolve the exact missing tee, pin, corridor, or par requirement.",
  "campaign.recovery.backNinePlay": "Publish three holes, play a Player Pro round, then open Architecture Review to retain shot evidence before advancing.",
  "campaign.recovery.openingMatch": "If the match is blocked, publish at least three complete holes. The friendly result does not block base completion.",
  "campaign.recovery.muniCondition": "Reduce maintenance pressure, fund turf recovery, or adjust operations; loans are available in this chapter.",
  "campaign.recovery.muniTrust": "Condition, affordable access, staffed service, and completed rounds all provide viable trust recovery paths.",
  "campaign.recovery.localMatch": "Publish at least three recovered holes and earn Player Pro points through practice before calling Jamie.",
  "campaign.recovery.swampRoute": "No loan is required: route three compact holes first and preserve cash for drainage and maintenance.",
  "campaign.recovery.swampWeather": "Read the seven-day forecast, add drainage when useful, and schedule closures or recovery without committing to one routing.",
  "campaign.recovery.rivalMatch": "The rival match requires a published route and Player Pro experience, but winning is a mastery result rather than a base gate.",
  "campaign.recovery.linksRoute": "Use dunes, wind, and protected features as routing constraints; multiple safe and heroic lines qualify.",
  "campaign.recovery.linksWind": "Play the course in current weather and use punch, draw, fade, or a normal shot; no single technique is mandatory.",
  "campaign.recovery.membersListen": "Any charter can proceed. Reputation can come from service, course quality, events, regulars, or community choices.",
  "campaign.recovery.membersBooks": "The fixed fee remains viable through staffing, maintenance, capacity, hospitality, and cost control choices.",
  "campaign.recovery.clubMatch": "Publish three or more holes and build Pro experience; the relationship path changes the epilogue, not match eligibility.",
  "campaign.recovery.championshipQualify": "Publish the property and complete Player Pro rounds. Every unmet tournament requirement is listed before booking.",
  "campaign.recovery.championshipStage": "Architecture evidence comes from played shots; reputation and rating can be improved without one prescribed layout.",
  "campaign.recovery.championshipFinal": "The final requires an eligible 18-hole host, the booking deposit, and Pro readiness. Save/resume and acceleration remain available.",
  "campaign.epilogue.title": "Campaign epilogue",
  "campaign.epilogue.summary": "The ending is assembled from the final charter, course, relationships, choices, legacy, and Player Pro record.",
  "campaign.epilogue.victory": "The championship belongs to your Player Pro, and the club's choices define what that victory means.",
  "campaign.epilogue.honorableLoss": "The final result fell short, but the course hosted the championship and every relationship and club promise still reaches a coherent ending.",
  "campaign.epilogue.continue": "Continue this property in Sandbox",
  "campaign.victory.note": "{medal} mastery earned. Rewards are recorded once and the next chapter is unlocked.",
  "campaign.victory.legacyNote": "Chapter complete. The next scenario is unlocked.",
  "workspace.nav": "Primary game workspaces",
  "workspace.design": "Design",
  "workspace.operate": "Operate",
  "workspace.legacy": "Legacy",
  "workspace.design.actions": "Course design tools",
  "workspace.operate.actions": "Club operation tools",
  "workspace.legacy.actions": "Club history and progression tools",
  "workspace.action.architecture": "Review",
  "workspace.action.courses": "Courses",
  "workspace.action.land": "Land",
  "workspace.action.player": "Player Pro",
  "workspace.action.tournaments": "Tournaments",
  "workspace.action.property": "Property",
  "workspace.action.people": "People",
  "workspace.action.seasons": "Seasons",
  "workspace.action.campaign": "Campaign",
  "workspace.action.progression": "Progress",
  "workspace.action.records": "Records",
  "workspace.action.content": "Content",
  "workspace.action.photo": "Photo",
  "workspace.more": "More",
  "workspace.alert": "New activity",
  "content.eyebrow": "Local-first sharing",
  "content.title": "Content library",
  "content.close": "Close content library",
  "content.untitled": "Untitled course",
  "content.defaultAuthor": "Local architect",
  "content.ready": "Packages stay local unless you explicitly publish one.",
  "content.failed": "The content operation could not be completed.",
  "content.name": "Package name",
  "content.author": "Author",
  "content.description": "Description",
  "content.saveCurrent": "Package current course",
  "content.import": "Import package",
  "content.refresh": "Refresh Workshop",
  "content.empty": "No local packages yet.",
  "content.entrySummary": "{author} · {theme} · revision {revision} · {source}",
  "content.saved": "Saved “{title}” to the local library.",
  "content.imported": "Imported “{title}”.",
  "content.importCanceled": "No file was selected.",
  "content.refreshed": "Workshop cache refreshed.",
  "content.testPlay": "Test play copy",
  "content.testStarted": "Testing an isolated copy of “{title}”.",
  "content.testMode": "Content test mode started. Your original course is preserved.",
  "content.testEnded": "Content test ended. Your original course was restored.",
  "content.exitTest": "Exit content test",
  "content.export": "Export",
  "content.exported": "Package exported.",
  "content.publish": "Publish",
  "content.published": "Package published to Workshop.",
  "content.workshopUnavailable": "Workshop is unavailable on this platform.",
  "content.legalRequired": "Published. Steam requires acceptance of its Workshop legal agreement.",
  "content.delete": "Delete",
  "content.deleted": "Package removed from the local library.",
  "demo.badge": "FREE DEMO",
  "demo.chapterNotice": "The demo contains the complete opening campaign chapter. Its save can continue in the full game.",
  "demo.saveRejected": "This save uses content outside the demo. Open it in the full game.",
  "golfopedia.terrain.fairway.title": "Fairway",
  "golfopedia.terrain.fairway.summary": "The safe, short-grass route from tee to green.",
  "golfopedia.terrain.rough.title": "Rough",
  "golfopedia.terrain.rough.summary": "Forgiving natural ground; free to paint and useful as your default canvas.",
  "golfopedia.terrain.deepRough.title": "Deep Rough",
  "golfopedia.terrain.deepRough.summary": "Punishing grass that makes recovery shots less reliable.",
  "golfopedia.terrain.sand.title": "Sand",
  "golfopedia.terrain.sand.summary": "A strategic hazard that adds difficulty and visual character.",
  "golfopedia.terrain.wasteArea.title": "Waste area",
  "golfopedia.terrain.wasteArea.summary": "Firm, low-upkeep natural ground: walkable and playable, but a tougher lie than rough.",
  "golfopedia.terrain.water.title": "Water",
  "golfopedia.terrain.water.summary": "A severe hazard. Carries and shorelines strongly shape shot choice.",
  "golfopedia.terrain.wetland.title": "Wetland",
  "golfopedia.terrain.wetland.summary": "Shallow vegetated water hazard: impassable on foot and a stroke penalty for balls.",
  "golfopedia.terrain.green.title": "Green",
  "golfopedia.terrain.green.summary": "The putting surface and destination of every hole.",
  "golfopedia.terrain.tee.title": "Tee",
  "golfopedia.terrain.tee.summary": "The starting surface for a hole.",
  "golfopedia.terrain.path.title": "Path",
  "golfopedia.terrain.path.summary": "Fast walking terrain that helps golfers and staff move around the property.",
  "golfopedia.terrain.balance": "Build and salvage values come directly from the live balance tables.",
  "golfopedia.terrain.maintenance": "Maintenance pressure is {weight}× the base tile weight.",
  "golfopedia.fact.build": "Build",
  "golfopedia.fact.salvage": "Salvage",
  "golfopedia.fact.upkeep": "Upkeep weight",
  "golfopedia.value.perTile": "{value} / tile",
  "golfer.pro": "Pro",
  "golfer.lowHandicap": "Low-handicap",
  "golfer.casual": "Casual",
  "golfer.senior": "Senior",
  "golfer.junior": "Junior",
  "golfer.tourist": "Tourist",
  "golfopedia.golfer.summary": "{label} golfers are one crowd archetype; each arrival still rolls an individual personality.",
  "golfopedia.golfer.typical": "Typical skill {skill}, patience {patience}, and spending tendency {spending}.",
  "golfopedia.golfer.preference": "They care most about {preference}.",
  "golfopedia.fact.skill": "Skill",
  "golfopedia.fact.patience": "Patience",
  "golfopedia.fact.spending": "Spending",
  "golfopedia.management.rating.title": "Course rating & slope",
  "golfopedia.management.rating.summary": "Rating estimates expected scoring difficulty; slope describes how sharply difficulty rises for non-scratch golfers.",
  "golfopedia.management.rating.detail1": "Distance, hazards, elevation, landing corridors, and recoverability all contribute.",
  "golfopedia.management.rating.detail2": "A hard course can be excellent — difficulty should feel deliberate, not accidental.",
  "golfopedia.management.demand.title": "Demand",
  "golfopedia.management.demand.summary": "Demand combines course quality, condition, reputation, price, marketing, and staff into expected visitors.",
  "golfopedia.management.demand.detail1": "Each factor has a visible contribution in the Results tab.",
  "golfopedia.management.demand.detail2": "Capacity can still cap rounds even when demand is strong.",
  "golfopedia.management.cash.title": "Cash & profit",
  "golfopedia.management.cash.summary": "Cash is your runway. Profit is one period's revenue minus operating costs.",
  "golfopedia.management.cash.detail1": "A profitable week grows cash; capital construction can reduce cash without appearing as an operating expense.",
  "golfopedia.management.cash.detail2": "Keep several weeks of normal costs in reserve.",
  "golfopedia.management.reputation.title": "Reputation",
  "golfopedia.management.reputation.summary": "Reputation is the market's memory of satisfaction, reliability, and course quality.",
  "golfopedia.management.reputation.detail1": "It recovers more slowly than it falls.",
  "golfopedia.management.reputation.detail2": "Missed loan payments and poor maintenance can accelerate a decline.",
  "golfopedia.management.condition.title": "Course condition",
  "golfopedia.management.condition.summary": "Condition measures the health of the playing surfaces from 0–100%. Traffic causes wear; maintenance restores it.",
  "golfopedia.management.condition.detail1": "Premium turf has higher maintenance weight.",
  "golfopedia.management.condition.detail2": "Low condition reduces satisfaction even on a well-designed course.",
  "golfopedia.controls.camera.title": "Camera",
  "golfopedia.controls.camera.summary": "Pan, zoom, rotate, and fit the active hole.",
  "golfopedia.controls.camera.detail1": "Mouse wheel: zoom; middle drag or edge scroll: pan.",
  "golfopedia.controls.camera.detail2": "[ and ] select holes; F fits the active hole.",
  "golfopedia.controls.simulation.title": "Simulation clock",
  "golfopedia.controls.simulation.summary": "Pause or run the living course at 1×, 2×, or 4×.",
  "golfopedia.controls.simulation.detail1": "Use 1× when observing a design problem.",
  "golfopedia.controls.simulation.detail2": "Higher speeds are best for validating finances over several days.",
  "golfopedia.controls.tools.title": "Design tools",
  "golfopedia.controls.tools.summary": "Paint terrain, build holes, add obstacles, sculpt elevation, and place amenities.",
  "golfopedia.controls.tools.detail1": "Escape cancels the current placement flow.",
  "golfopedia.controls.tools.detail2": "Tooltips show live costs before you commit.",
  "confirm.restartScenario": "Restart this scenario from the beginning?",
  "confirm.bulldoze": "Bulldoze this obstacle?",
  "confirm.salvage": "Salvage this {building}?",
  "loading.restoreCourse": "Restoring your course…",
  "loading.growCourse": "Growing your new course…",
  "loading.restoreLatest": "Restoring your latest course…",
  "error.insufficientFunds": "Insufficient funds: need {amount}.",
  "error.insufficientFairway": "Insufficient funds: need {amount} to paint fairway.",
  "error.insufficientMove": "Insufficient funds to move {marker}: need {amount}.",
  "error.siteSteep": "{marker} site is too steep — level the ground with the Sculpt tool first.",
  "error.insufficientConfirm": "Insufficient funds to confirm: need {amount}.",
  "error.markersBounds": "Cannot place markers outside course bounds.",
  "error.earthworksFunds": "Not enough cash for earthworks ({amount} needed).",
  "error.clubhouseRemove": "The starter clubhouse cannot be removed.",
  "error.buildingPlacement": "Cannot place {building}: {reason}.",
  "error.teeBounds": "Cannot place tee outside course bounds.",
  "error.teeWater": "Cannot place tee on water.",
  "error.greenBounds": "Cannot place green outside course bounds.",
  "error.greenWater": "Cannot place green on water.",
  "error.obstacleWater": "Trees, bushes, and boulders need dry land. Raise or repaint an island first.",
  "terrain.tee": "Tee",
  "terrain.green": "Green",
  "terrain.group.playing": "Playing surfaces",
  "terrain.group.hazards": "Hazards",
  "terrain.group.paths": "Paths",
  "terrain.group.natural": "Natural ground",
  "save.loaded": "Game loaded.",
  "save.saved": "Saved.",
  "save.overwritten": "Overwrote “{name}”.",
  "save.deleted": "Deleted “{name}”.",
  "save.renamePrompt": "Rename save",
  "save.imported": "Imported “{name}”.",
  "save.importedUpgraded": "Imported “{name}” and upgraded it from save version {version}.",
  "binding.panUp": "Pan up",
  "binding.panDown": "Pan down",
  "binding.panLeft": "Pan left",
  "binding.panRight": "Pan right",
  "binding.rotateLeft": "Rotate left",
  "binding.rotateRight": "Rotate right",
  "binding.speed1": "Speed 1×",
  "binding.speed2": "Speed 2×",
  "binding.speed3": "Speed 4×",
  "binding.pause": "Pause / resume",
  "binding.terrainTool": "Terrain tool",
  "binding.obstacleTool": "Obstacle tool",
  "binding.buildingTool": "Building tool",
  "binding.quicksave": "Quick save",
  "binding.conflict": "{binding} is already assigned to {action}.",
  "binding.rebind": "Rebind {action}",
  "binding.pressKey": "Press a key…",
  "binding.resetConfirm": "Reset all keybindings to defaults?",
  "settings.autosave": "Autosave cadence",
  "settings.autosaveHint": "Rotating autosaves never overwrite manual slots",
  "settings.advisor": "Caddie advisor",
  "settings.advisorFrequency": "Advisor frequency",
  "settings.edgeScroll": "Edge scrolling",
  "settings.edgeScrollSpeed": "Edge-scroll speed",
  "settings.cameraSmoothing": "Camera smoothing",
  "settings.confirmBulldoze": "Confirm bulldoze",
  "settings.confirmSalvage": "Confirm salvage",
  "settings.defaultSpeed": "Default game speed",
  "settings.animations": "Animations master",
  "settings.ambientFx": "Ambient world FX",
  "settings.waterAnimation": "Water animation",
  "settings.treeSway": "Tree sway",
  "settings.resolutionScale": "Resolution scale",
  "settings.gridOverlays": "Grid overlays by default",
  "settings.graphicsQuality": "Graphics quality",
  "settings.graphicsQuality.auto": "Auto",
  "settings.graphicsQuality.high": "High",
  "settings.graphicsQuality.medium": "Medium",
  "settings.graphicsQuality.low": "Low",
  "minimap.open": "Open course minimap",
  "minimap.collapse": "Collapse course minimap",
  "minimap.bearing": "View bearing {degrees} degrees",
  "minimap.north": "N",
  "settings.masterVolume": "Master volume",
  "settings.musicVolume": "Music volume",
  "settings.soundEffects": "Sound effects",
  "settings.ambienceVolume": "Ambience volume",
  "settings.masterMute": "Mute all audio",
  "settings.masterMuteHint": "Silences music, effects, and ambience instantly.",
  "settings.muteWhenHidden": "Mute in background",
  "settings.muteWhenHiddenHint": "Gently fades audio when this tab is hidden.",
  "settings.testMusic": "Test music",
  "settings.testSfx": "Test sound effects",
  "settings.testAmbience": "Test ambience",
  "settings.musicOverride": "Music context override",
  "settings.musicOverrideHint": "Development-only playlist control for audio QA.",
  "settings.musicContext.auto": "Auto",
  "settings.musicContext.silent": "Silent",
  "settings.musicContext.title": "Title",
  "settings.musicContext.build": "Build",
  "settings.musicContext.live": "Live",
  "settings.musicContext.tension": "Tension",
  "tournament.open": "Tournaments",
  "tournament.eyebrow": "Event office",
  "tournament.title": "Tournaments",
  "tournament.close": "Close tournaments",
  "tournament.live": "LIVE LEADERBOARD",
  "tournament.schedule": "Schedule an event",
  "tournament.tier": "Prestige tier",
  "tournament.date": "Tournament date",
  "tournament.tomorrow": "Tomorrow",
  "tournament.threeDays": "In 3 days",
  "tournament.nextWeek": "In 1 week",
  "tournament.players": "players",
  "tournament.deposit": "deposit",
  "tournament.reputation": "rep award",
  "tournament.payout": "Completion award: {amount}. Requires {reputation} reputation and nine open holes.",
  "tournament.book": "Book tournament",
  "tournament.booked": "Tournament booked.",
  "tournament.upcoming": "Upcoming",
  "tournament.results": "Recent results",
  "tournament.week": "Week {week}",
  "tournament.inOneDay": "in 1 day",
  "tournament.inDays": "in {days} days",
  "tournament.wonBy": "Won by {winner}",
  "tournament.repShort": "rep",
  "tournament.standard": "Prescribed setup",
  "tournament.projected": "Projected difficulty",
  "tournament.readiness": "Hosting readiness",
  "tournament.completeRotations": "{count} complete pin rotations",
  "tournament.currentRequired": "Current: {current} · Required: {required}",
  "tournament.requirement.reputation": "Reputation",
  "tournament.requirement.deposit": "Hosting deposit",
  "tournament.requirement.date": "Event date",
  "tournament.requirement.calendar": "Calendar",
  "tournament.requirement.holes": "Open course",
  "tournament.requirement.rotations": "Pin rotations",
  "tournament.requirement.route": "Prescribed route",
  "tournament.requirement.rating": "Course rating",
  "tournament.requirement.slope": "Slope",
  "tournament.guidance.reputation": "Improve golfer satisfaction and complete successful rounds.",
  "tournament.guidance.deposit": "Build enough cash reserves to cover the non-refundable deposit.",
  "tournament.guidance.date": "Choose tomorrow or a later date.",
  "tournament.guidance.calendar": "Choose a date without another scheduled tournament.",
  "tournament.guidance.holes": "Finish at least nine playable holes.",
  "tournament.guidance.rotations": "Configure the required tee-to-pin routes on every hole.",
  "tournament.guidance.route": "Repair every hole in the prescribed tee and pin setup.",
  "tournament.guidance.rating": "Adjust length and strategic difficulty until the rating enters the required range.",
  "tournament.guidance.slope": "Balance hazards and forced carries until slope enters the required range.",
  "tournament.warning": "Eligibility warning",
  "tournament.cancelled": "Cancelled events",
  "tournament.depositForfeited": "Hosting deposit forfeited",
  "tournament.fix": "Next step: {guidance}",
  "tournament.setupSummary": "{tee} tees · Pin {pin} · {rating} / {slope}",
  "tournament.yardageRotations": "{yards} yd · {rotations}",
  "tournament.eventSetup": "{tee} · Pin {pin}",
  "advisor.tournament.title": "Tournament standard lost",
  "advisor.tournament.body": "{event} no longer qualifies: {warning} Repair the course before event day or the deposit will be forfeited.",
  "golfopedia.management.tournaments.title": "Tournament course standards",
  "golfopedia.management.tournaments.summary": "Each event tier prescribes tees, pins, course rating, slope, and complete playable routes.",
  "golfopedia.management.tournaments.detail1": "Local events use Member tees and the easiest complete rotation; Regional and Championship events use Championship tees with progressively stricter setup standards.",
  "golfopedia.management.tournaments.detail2": "Booked events are rechecked after course edits and again on event day. Repair every warning before the date or the event is cancelled and its deposit is forfeited.",
  "land.open": "Land Office",
  "land.eyebrow": "Estate survey",
  "land.title": "Land Office",
  "land.close": "Close Land Office",
  "land.parcels": "Surveyed parcels",
  "land.owned": "Owned",
  "land.locked": "Not adjacent",
  "land.nonAdjacent": "Purchase an adjoining parcel first.",
  "land.unaffordable": "Not enough cash for this purchase.",
  "land.unavailable": "This parcel is unavailable.",
  "land.acres": "{acres} acres",
  "land.center": "View parcel",
  "land.developable": "Developable land",
  "land.water": "Water coverage",
  "land.elevation": "Elevation range",
  "land.scenery": "Scenery score",
  "land.road": "Public-road access",
  "land.yes": "Yes",
  "land.no": "No",
  "land.appraisal": "Fixed appraisal",
  "land.value.land": "Acreage",
  "land.value.developable": "Developable area",
  "land.value.road": "Road access",
  "land.value.scenery": "Scenery",
  "land.value.water": "Water character",
  "land.value.elevation": "Topography",
  "land.value.pressure": "Local land pressure",
  "land.total": "Appraised price",
  "land.purchase": "Purchase parcel",
  "land.confirmPurchase": "Confirm purchase · {amount}",
  "land.purchased": "Parcel purchased: {name}.",
  "land.buildBlocked": "Purchase this parcel before building here.",
  "land.parcel.parcel-1": "Northwest Meadow",
  "land.parcel.parcel-2": "North Ridge",
  "land.parcel.parcel-3": "Northeast Woods",
  "land.parcel.parcel-4": "West Fields",
  "land.parcel.parcel-5": "Starter Property",
  "land.parcel.parcel-6": "East Bluffs",
  "land.parcel.parcel-7": "Southwest Heath",
  "land.parcel.parcel-8": "South Valley",
  "land.parcel.parcel-9": "Southeast Lakes",
  "land.trait.road": "Public road access",
  "land.trait.water": "Water character",
  "land.trait.contours": "Dramatic contours",
  "land.trait.gentle": "Gentle topography",
  "land.trait.scenic": "Scenic outlooks",
  "land.trait.developable": "Highly developable",
  "land.trait.mixed": "Mixed natural ground",
  "property.open": "Property",
  "property.aria": "Property management",
  "property.eyebrow": "Property enterprise",
  "property.title": "Practice, hospitality and development",
  "property.subtitle": "Build a club campus into a destination—without outrunning access, upkeep, or neighbor safety.",
  "property.close": "Close property management",
  "property.sections": "Property sections",
  "property.metric.cash": "Cash",
  "property.metric.arrival": "Arrival cap",
  "property.metric.assets": "Assets",
  "property.metric.customers": "Customers",
  "property.metric.homes": "Homes",
  "property.metric.complaints": "Complaints",
  "property.professionals": "Club professionals",
  "property.memberships": "Memberships and lockers",
  "property.outing": "Packaged golf outing",
  "property.resort.operations": "Resort operations",
  "property.resort.help": "Rooms only open with reception and housekeeping. Remote parking only counts when shuttle capacity connects it.",
  "property.resort.frontDesk": "Front desk",
  "property.resort.housekeeping": "Housekeeping",
  "property.resort.shuttle": "Shuttle team",
  "property.resort.food": "Food service",
  "property.resort.recovery": "Service recovery",
  "property.resort.packages": "Advance packages",
  "property.book": "Book {name}",
  "property.resort.maintenance": "Maintenance",
  "property.resort.maintenanceDetail": "{count} staffed · restores out-of-order rooms each day",
  "property.resort.concierge": "Concierge and bags",
  "property.resort.conciergeDetail": "{count} staffed · coordinates arrivals, luggage, and service recovery",
  "property.resort.performance": "Resort performance",
  "property.resort.occupancy": "Occupancy",
  "property.resort.adr": "ADR",
  "property.resort.revpar": "RevPAR",
  "property.resort.averageStay": "Average stay",
  "property.resort.nights": "{value} nights",
  "property.resort.packageMargin": "Package margin",
  "property.resort.ancillarySpend": "Ancillary spend",
  "property.resort.transportCost": "Transport cost",
  "property.resort.destinationAppeal": "Destination appeal",
  "property.resort.capacity": "Coupled capacity · rooms {rooms} · arrivals {arrivals} · golf {golf} · practice {practice} · dining {dining} · shuttle {shuttle}",
  "property.resort.packageDetail": "{nights} nights · {rooms} {roomClass} rooms · {guests} guests",
  "property.resort.packageProperty": "{property} · {rooms} rooms remain · {margin} est. margin",
  "property.resort.noProperty": "No property",
  "property.resort.reservations": "Reservations and itineraries",
  "property.resort.noReservations": "No reservations yet. Capacity conflicts and itinerary status will appear here.",
  "property.resort.reservationDates": "Week {checkInWeek}, day {checkInDay} → week {checkOutWeek}, day {checkOutDay} · {rooms} {roomClass} room(s) · {guests} guests",
  "property.resort.reservationMeta": "{segment} · {transport} · itinerary {fulfilled}/{total} fulfilled · folio {folio}",
  "property.resort.refunded": "Refunded {amount} · {status}",
  "property.safety.title": "Shot-corridor safety",
  "property.safety.risk": "Risk score",
  "property.safety.eligibility": "Eligibility",
  "property.safety.expected": "Expected",
  "property.safety.mitigation": "Mitigation",
  "property.safety.value": "Current residential value:",
  "property.safety.valueHelp": "· reflects golf access, scenery, reputation, traffic, and disclosed safety exposure.",
  "property.safety.hole": "{distance} tiles from corridor · expected {expected} · outlier {outlier}",
  "property.community.strategy.sell": "Sell units",
  "property.community.strategy.sellDetail": "Highest immediate closing proceeds; land and completed sale terms become private and irreversible.",
  "property.community.strategy.retain": "Retain rentals",
  "property.community.strategy.retainDetail": "Keep ownership and collect rent with vacancy, tax, common-area, upkeep, and insurance exposure.",
  "property.community.strategy.partner": "Developer partner",
  "property.community.strategy.partnerDetail": "Lower player capital in exchange for partner control and a permanent revenue share.",
  "property.community.confirm": "{property} · {units} units · {capital} player capital · {days} days to release · {outcome}. This permanently commits the site and protects its access, utility, and safety easements.",
  "property.community.confirm.houses": "Fairway homes",
  "property.community.confirm.condos": "Golf condominiums",
  "property.community.confirm.partner": "{share}% partner share",
  "property.community.confirm.retain": "{rent} projected weekly rent",
  "property.community.confirm.sell": "{low}–{high} projected closings",
  "property.community.pipeline": "Residential development pipeline",
  "property.community.pipelineHelp": "Approve a safe, serviced phase with an explicit tenure strategy. Approval creates stable units and protected easements before construction starts.",
  "property.community.previewTitle": "{property} · {strategy}",
  "property.community.preview.houses": "Homes",
  "property.community.preview.condos": "Condos",
  "property.community.previewMeta": "{units} units · {capital} capital · {days}d",
  "property.community.previewValue": "Value {low}–{high} · safety {risk}/100",
  "property.community.review": "Review & approve",
  "property.community.tenure.retain": "retained rental",
  "property.community.tenure.partner": "developer partner",
  "property.community.tenure.sell": "for sale",
  "property.community.phaseProgress": "{units} stable units · {occupied} occupied · construction {construction}d · release {release}d",
  "property.community.phaseCapital": "Capital {capital} · common {common}/day · protected access/utility/safety easements",
  "property.community.exposure": "Exposure heatmap & operating restrictions",
  "property.community.restrict": "Restrict {tee}",
  "property.community.closeHole": "Close {hole}",
  "property.community.setback": "Measured setback {setback} · normal, expected-miss, and extreme-outlier exposure remain separate in the evidence rows above.",
  "property.community.valuation": "{name} valuation · {total}",
  "property.community.valuationDetail": "{perUnit}/unit · scenery {scenery} · golf {golf} · access {access} · amenities {amenities} · prestige {prestige} · safety {safety} · traffic {traffic} · density {density}",
  "property.community.residents": "Residents & HOA",
  "property.community.households": "Households",
  "property.community.satisfaction": "Satisfaction",
  "property.community.localSpending": "Local spending",
  "property.community.residentRow": "{archetype} · home {home} · satisfaction {satisfaction} · golf interest {golf} · advocacy {advocacy} · opposition {opposition}",
  "property.community.residentFallback": "resident household",
  "property.community.residentEmpty": "Households appear when a completed phase releases occupied units.",
  "property.community.complaints": "Complaint evidence & commitments",
  "property.community.complaintMeta": "{source} · severity {severity} · recurrence {recurrence}",
  "property.community.complaintEmpty": "No open complaints. Incident, traffic, service, and common-area evidence will appear here.",
  "property.community.claims": "Claims & insurance",
  "property.community.insurance": "Deductible {deductible} · limit {limit} · premium {premium}/day · {settled} settled",
  "property.community.claimMeta": "{id} · {status} · {damage} damage",
  "property.community.claimWarnings": "Prior warnings {warnings} · deductible {deductible}",
  "property.community.fileClaim": "File claim",
  "property.community.settleClaim": "Settle once",
  "property.community.claimEmpty": "No open damage claims.",
  "property.community.heatEmpty": "Approve or build residential property to calculate occupied-use exposure.",
  "property.community.heatAria": "Residential shot exposure heatmap",
  "property.community.heatCell": "{class} risk {risk}/100 · holes {holes}",
  "property.community.easement": "{kind} easement",
  "property.community.easementProtected": "{kind} easement · protected",
  "property.community.mapTenure": "{tenure} tenure",
  "property.community.legendCommitted": "C committed",
  "property.community.legendSold": "S sold",
  "property.community.legendRental": "R rental",
  "property.community.legendPartner": "P partner",
  "property.community.legendReacquired": "↺ reacquired",
  "property.community.legendEasement": "blue dash easement",
  "property.asset.tier": "T{tier}",
  "property.asset.cap": "Cap {value}",
  "property.asset.condition": "Condition {value}%",
  "property.asset.price": "Price {value}",
  "property.asset.work": "Work order",
  "property.asset.close": "Close {name}",
  "property.asset.reopen": "Reopen {name}",
  "property.asset.move": "Move {name}",
  "property.asset.west": "Move west",
  "property.asset.north": "Move north",
  "property.asset.south": "Move south",
  "property.asset.east": "Move east",
  "property.asset.remove": "Remove {name}",
  "property.asset.removeShort": "Remove",
  "property.asset.buyback": "Buy back {name}",
  "property.asset.buybackShort": "Negotiate buyback",
  "property.asset.priceLabel": "{name} price",
  "property.asset.build": "Build · {amount}",
  "property.asset.construction": "Under construction · {days} day(s) of reduced or closed service",
  "property.asset.lastDay": "Last day: {served}/{demand} served · {denied} denied · {revenue} gross",
  "property.asset.upgradePreview": "Tier {tier}: +{capacity} capacity · +{upkeep}/day · +{parking} parking · {days}d downtime · break-even ≈ {breakEven}/day",
  "property.asset.blocked": " · Blocked: {reason}",
  "property.asset.rotatePractice": "Rotate corridor",
  "property.asset.nameLabel": "{name} facility name",
  "property.asset.hours": "Hours",
  "property.asset.hoursLabel": "{name} operating hours",
  "property.asset.upkeep": "Upkeep",
  "property.asset.upkeepLabel": "{name} upkeep policy",
  "property.asset.lean": "Lean",
  "property.asset.standard": "Standard",
  "property.asset.premium": "Premium",
  "property.modules.title": "Clubhouse shell and room modules",
  "property.modules.help": "Shell tier {tier} provides {slots} room slots. Modules add physical capability, capacity, upkeep, staffing, and parking demand.",
  "property.modules.meta": "· shell {tier}+ · cap {capacity}",
  "property.modules.close": "Close module",
  "property.modules.reopen": "Reopen module",
  "property.modules.install": "Install · {amount}",
  "property.outing.preview": "{guests} guests · {gross} gross · {cost} variable cost · {parking} parking",
  "property.outing.book": "Book · {deposit} deposit",
  "property.outing.scheduled": "Week {week}, day {day}: {package} · {guests} guests",
  "property.outing.cancel": "Cancel / refund",
  "property.map.empty": "The property plan is empty. Start with a road connection and guest parking.",
  "property.map.aria": "Property campus plan",
  "property.map.asset": "{name}, tier {tier}",
  "property.ledger.revenue": "12-week revenue",
  "property.ledger.costs": "12-week costs",
  "property.ledger.net": "Net",
  "property.ledger.skill": "Avg. skill",
  "property.ledger.title": "Commercial ledger",
  "property.ledger.empty": "Build an asset and operate a day to begin the ledger.",
  "property.ledger.when": "W{week} D{day}",
  "property.ledger.incidents": "Recent incidents",
  "property.ledger.incident": "⚠ W{week}: {description} ({cost})",
  "property.report.revenue": "Property revenue",
  "property.report.costs": "Property costs",
  "property.report.guests": "Property guests",
  "decor.tool": "Decor",
  "decor.title": "Course decor & crossings",
  "decor.place": "Place",
  "decor.rotate": "Rotate",
  "decor.remove": "Remove",
  "decor.direction": "Direction",
  "decor.rotation": "Rotate {rotation} degrees",
  "decor.span": "Hazard span: {span} tiles",
  "decor.spanLabel": "Bridge or boardwalk span",
  "decor.placeHint": "Choose a piece, direction, and span, then click the course. Crossing placement starts on its dry approach.",
  "decor.rotateHint": "Click placed decor to rotate it. Invalid crossing rotations are left unchanged.",
  "decor.removeHint": "Click any part of placed decor to salvage it.",
  "decor.invalid": "Cannot place decor: {reason}.",
  "decor.noneHere": "There is no decoration here.",
  "playerPro.defaultName": "Alex Green",
  "playerPro.open": "Player Pro",
  "playerPro.close": "Close Player Pro",
  "playerPro.title": "Pro Career",
  "playerPro.creation.title": "Create your Player Pro",
  "playerPro.creation.name": "Player Pro name",
  "playerPro.creation.appearance": "Appearance",
  "playerPro.creation.handedness": "Handedness",
  "playerPro.creation.background": "Background",
  "playerPro.appearance.classic": "Classic",
  "playerPro.appearance.sport": "Sport",
  "playerPro.appearance.heritage": "Heritage",
  "playerPro.handedness.right": "Right-handed",
  "playerPro.handedness.left": "Left-handed",
  "playerPro.background.architect": "Architect",
  "playerPro.background.operator": "Operator",
  "playerPro.background.host": "Host",
  "playerPro.background.architect.benefit": "Architect: +4 Irons and +2 Short Game. A small, visible starting benefit.",
  "playerPro.background.operator.benefit": "Operator: +4 Recovery and +2 Power. A small, visible starting benefit.",
  "playerPro.background.host.benefit": "Host: +4 Putting and +2 Driving. A small, visible starting benefit.",
  "playerPro.tab.career": "Career",
  "playerPro.tab.play": "Play",
  "playerPro.tab.training": "Training",
  "playerPro.tab.matches": "Matches",
  "playerPro.tab.tournaments": "Tournaments",
  "playerPro.identity": "{background} · {handedness} · {appearance}",
  "playerPro.skills": "Six-skill profile",
  "playerPro.skill.power": "Power",
  "playerPro.skill.driving": "Driving",
  "playerPro.skill.irons": "Irons",
  "playerPro.skill.shortGame": "Short Game",
  "playerPro.skill.putting": "Putting",
  "playerPro.skill.recovery": "Recovery",
  "playerPro.skillXp": "{xp}/12 XP",
  "playerPro.careerPoints": "{points} career points",
  "playerPro.earnings": "{amount} career earnings",
  "playerPro.techniques": "Shot techniques",
  "playerPro.technique.normal": "Normal",
  "playerPro.technique.draw": "Draw",
  "playerPro.technique.fade": "Fade",
  "playerPro.technique.punch": "Punch",
  "playerPro.technique.flop": "Flop",
  "playerPro.technique.backspin": "Backspin",
  "playerPro.technique.locked": "Requires {skill} {value}",
  "playerPro.recentRounds": "Recent rounds",
  "playerPro.noRounds": "Complete a Player Pro round to begin the career record.",
  "playerPro.roundLine": "{course} · {score} · {result}",
  "playerPro.play.title": "Play your course",
  "playerPro.play.help": "Choose a published route and setup. The routing and physical course are snapshotted when the round begins.",
  "playerPro.play.route": "Course routing",
  "playerPro.play.tee": "Tee set",
  "playerPro.play.pin": "Pin rotation",
  "playerPro.play.tee.forward": "Forward",
  "playerPro.play.tee.member": "Member",
  "playerPro.play.tee.championship": "Championship",
  "playerPro.play.pinOption": "Rotation {rotation}",
  "playerPro.play.start": "Start round",
  "playerPro.play.resume": "Resume active round",
  "playerPro.play.blocked": "Publish at least three complete holes to play.",
  "playerPro.training.title": "Focused training",
  "playerPro.training.help": "Sessions require an open, serviceable practice facility and a club professional. Two sessions per day maximum.",
  "playerPro.training.session": "{facility} · {skill}",
  "playerPro.training.meta": "{minutes} min · {cost}",
  "playerPro.training.start": "Train",
  "playerPro.training.none": "Build a practice facility and hire a club professional to unlock training.",
  "playerPro.training.blocked": "Unavailable: {reason}",
  "playerPro.match.title": "Challenge matches",
  "playerPro.match.help": "Play a stable setup against a named club golfer. Wagers are deliberately small.",
  "playerPro.match.friendly": "Friendly",
  "playerPro.match.wager": "Wager {amount}",
  "playerPro.match.none": "Repeat visitors and club professionals become eligible opponents.",
  "playerPro.match.opponentMeta": "Skill {skill} · relationship {relationship}",
  "playerPro.tournament.title": "Player entries",
  "playerPro.tournament.help": "Enter a scheduled club event when the Player Pro meets its skill requirement.",
  "playerPro.tournament.enter": "Enter and play",
  "playerPro.tournament.none": "Schedule a club tournament to create a Player Pro entry opportunity.",
  "playerPro.tournament.blocked": "Not eligible: {reason}",
  "playerPro.tournament.meta": "{tier} · week {week}, day {day}",
  "playerPro.shot.title": "Shot decision",
  "playerPro.shot.hole": "Hole {hole} of {count} · {name}",
  "playerPro.shot.lie": "{lie} · {yards} yd to pin",
  "playerPro.shot.club": "Club",
  "playerPro.shot.clubOption": "{club} · {yards} yd",
  "playerPro.shot.aim": "Aim {x}, {y}",
  "playerPro.shot.power": "Power {power}%",
  "playerPro.shot.technique": "Technique",
  "playerPro.shot.preview": "{carry} yd carry · ±{dispersion} tiles · {risk} risk",
  "playerPro.shot.target": "Target {yards} yd · expected penalty {penalty}",
  "playerPro.shot.blocked": "Unavailable: {reason}",
  "playerPro.shot.confirm": "Play shot",
  "playerPro.shot.caddie": "Use caddie line",
  "playerPro.shot.next": "Next hole",
  "playerPro.shot.auto": "Auto-finish",
  "playerPro.shot.concede": "Concede",
  "playerPro.shot.returnDesign": "Return to Design",
  "playerPro.shot.animation": "Ball in flight…",
  "playerPro.scorecard": "Scorecard",
  "playerPro.scorecard.total": "{strokes} strokes · {penalties} penalties",
  "playerPro.round.complete": "Round complete",
  "playerPro.round.settled": "Career gains, records, and competition rewards were settled once.",
  "playerPro.round.editLocked": "Course editing is deferred while this snapshotted routing is being played.",
  "playerPro.profile.save": "Save profile",
  "architecture.review.title": "Architecture Review",
  "architecture.review.subtitle": "Read the shots, misses, routes, and scoring that your design produced.",
  "architecture.review.open": "Review played evidence",
  "architecture.review.overlays": "Architecture evidence overlays",
  "architecture.review.course": "Course",
  "architecture.review.hole": "Hole",
  "architecture.review.all": "All",
  "architecture.review.tee": "Tee set",
  "architecture.review.segment": "Golfer segment",
  "architecture.review.evidenceAge": "Evidence age",
  "architecture.review.overlay.traces": "Shot traces",
  "architecture.review.overlay.dispersion": "Dispersion",
  "architecture.review.overlay.heatmap": "Landings",
  "architecture.review.overlay.recovery": "Recovery",
  "architecture.review.overlay.scoring": "Scoring",
  "architecture.review.overlay.hazards": "Hazards",
  "architecture.review.overlay.walking": "Walking",
  "architecture.review.overlay.congestion": "Congestion",
  "architecture.review.overlay.options": "Strategic options",
  "architecture.review.overlay.advantage": "Advantage matrix",
  "architecture.review.overlay.bailouts": "Bailouts",
  "architecture.review.overlay.carries": "Carry gates",
  "architecture.review.overlay.misses": "Recovery zones",
  "architecture.review.pin": "Pin rotation",
  "architecture.review.strategy": "Strategic design read",
  "architecture.review.strategyScore": "Strategic score {score}/100",
  "architecture.review.fairness": "Fairness floor {score}",
  "architecture.review.options": "{count} meaningful options",
  "architecture.review.rotation": "Opportunity rotation {score}",
  "architecture.review.matrix": "Cohort advantage matrix",
  "architecture.review.cohort": "Cohort",
  "architecture.review.viability": "Viability",
  "architecture.review.expected": "Expected strokes",
  "architecture.review.preferred": "Preferred line",
  "architecture.review.recommendations": "Suggested design checks",
  "architecture.review.noRecommendations": "No high-confidence strategic checks for this setup.",
  "architecture.review.recommendationLocation": "Show location",
  "architecture.recommendation.widenBailout.title": "Widen the safe bailout",
  "architecture.recommendation.widenBailout.body": "Open a playable landing area for the affected cohorts before asking them to attack the feature.",
  "architecture.recommendation.openRunup.title": "Open a run-up or layup",
  "architecture.recommendation.openRunup.body": "The challenge reads as unavoidable. Give ordinary golfers a visible route that preserves the dramatic line.",
  "architecture.recommendation.protectHero.title": "Protect the hero line",
  "architecture.recommendation.protectHero.body": "The feature looks dramatic, but the power reward is not distinct. Shape a stronger payoff without shrinking the safe route.",
  "architecture.recommendation.createAngle.title": "Create a second angle",
  "architecture.recommendation.createAngle.body": "Add a positional or approach choice so different strengths can solve the hole in different ways.",
  "architecture.recommendation.shiftCarry.title": "Shift the carry threshold",
  "architecture.recommendation.shiftCarry.body": "Move the gate or pin so a casual route remains playable while accuracy and power still matter.",
  "architecture.review.age.current": "Current revision",
  "architecture.review.age.recent": "Recent evidence",
  "architecture.review.age.historical": "Historical only",
  "architecture.review.age.all": "All revisions",
  "architecture.review.status.empty": "No evidence for these filters",
  "architecture.review.status.sparse": "Early evidence — patterns may move",
  "architecture.review.status.ready": "Evidence is ready to review",
  "architecture.review.status.stale-only": "Only historical evidence matches",
  "architecture.review.currentCount": "{count} current shots",
  "architecture.review.historicalCount": "{count} historical shots",
  "architecture.review.teeScoring": "Scoring by tee",
  "architecture.review.rounds": "{count} rounds",
  "architecture.review.compare": "Before and after",
  "architecture.review.compareEmpty": "A second played revision will unlock comparison.",
  "architecture.review.testComparison": "Design-test comparison",
  "architecture.review.testComparisonEmpty": "Run a design test, return to Design, and refresh the review to compare revisions.",
  "architecture.review.testEvidence": "{state} strategic evidence",
  "architecture.review.testGeometry": "Geometry {before} → {after}",
  "architecture.review.testFairnessDelta": "Fairness {delta}",
  "architecture.review.testOptionDelta": "Meaningful options {delta}",
  "architecture.review.testSafeDelta": "Safe-route viability {delta}",
  "architecture.review.testSeparationDelta": "Strategic separation {delta}",
  "architecture.review.testExcluded": "Cohorts needing review: {cohorts}",
  "architecture.review.before": "Earlier revision",
  "architecture.review.revision": "Week {week} · {shots} shots",
  "architecture.review.shots": "shots",
  "architecture.review.awaiting": "Awaiting play",
  "architecture.review.recentEvidence": "Evidence to inspect",
  "architecture.review.current": "Current",
  "architecture.review.provisional": "Provisional",
  "architecture.review.historical": "Historical",
  "architecture.review.practice": "Play a practice round",
  "architecture.review.practiceStarted": "Practice round started.",
  "architecture.review.testNeedsHole": "Choose a hole before starting the design test.",
  "architecture.review.testNeedsCompleteHole": "Complete the selected hole before starting the design test.",
  "livingClub.title": "The Living Club",
  "season.open": "Seasons & Legacy",
  "season.eyebrow": "M39 annual legacy",
  "season.title": "Seasons, Identity & Legacy",
  "season.tabs": "Seasonal management sections",
  "season.tab.season": "Season",
  "season.tab.identity": "Club identity",
  "season.tab.legacy": "Legacy",
  "season.weather.current": "Today's course forecast",
  "season.weather.summary": "{kind} · {temperature}°F · {wind} mph wind · {rain} in rain",
  "season.weather.effects": "Carry {carry} · dispersion {dispersion} · demand {demand} · pace {pace} · turf wear {wear}",
  "season.forecast.title": "Published seven-day forecast",
  "season.forecast.day": "D{day}",
  "season.response.title": "Forecast response",
  "season.response.turf": "Turf priority ",
  "season.response.water": "Water policy ",
  "season.response.drainage": "Drainage tier {level}",
  "season.response.preview": "{cost} · {days} construction days · {risk}% risk reduction",
  "season.response.improve": "Improve drainage",
  "season.response.open": "open",
  "season.response.closed": "closed",
  "season.response.reopen": "Reopen",
  "season.response.close": "Close for forecast",
  "season.charter.title": "Annual club charter",
  "season.charter.cost": "Annual change cost: {cost}",
  "season.charter.selected": "Current charter",
  "season.charter.adopt": "Adopt this charter",
  "season.automation.title": "Enterprise policy presets",
  "season.automation.preset": "Operating preset ",
  "season.automation.advanced": "Show Advanced Operations and preserve manual control",
  "season.automation.overrides": "Manual system overrides",
  "season.legacy.empty": "Complete the first 32-week club year to create an immutable yearbook.",
  "season.yearbook.title": "Year {year} Yearbook",
  "season.yearbook.reputation": "reputation",
  "season.yearbook.acknowledge": "Add to club history",
  "season.timeline.title": "Club timeline",
  "season.timeline.empty": "Defining charter decisions and annual closes will appear here.",
  "season.shot.weather": "{kind} · {wind} mph · carry {carry}% · dispersion +{dispersion}%",
  "season.report.weather": "Weather",
  "season.report.weatherValue": "{playable} playable · {rain} rain · {severe} severe days",
  "livingClub.subtitle": "People remember the course, the staff, and the choices you make together.",
  "livingClub.tabs": "Living Club sections",
  "livingClub.tab.people": "Regulars",
  "livingClub.tab.staff": "Staff",
  "livingClub.tab.stories": "Stories",
  "livingClub.rounds": "rounds",
  "livingClub.people.empty": "Visitors become named regulars after they return to play.",
  "livingClub.loyalty": "{value}% loyalty",
  "livingClub.person.summary": "Favorite route: {course} · favorite hole: {hole} · best: {score}",
  "livingClub.unfavorite": "Remove favorite",
  "livingClub.favorite": "Favorite",
  "livingClub.follow": "Follow on course",
  "livingClub.offCourse": "Not on today’s course",
  "livingClub.relationship": "Relationship",
  "livingClub.memories": "Memories",
  "livingClub.history": "Round history",
  "livingClub.memory.round": "Round",
  "livingClub.memory.record": "Personal record",
  "livingClub.memory.relationship": "Relationship",
  "livingClub.memory.story": "Club story",
  "livingClub.weekDay": "Week {week}, day {day}",
  "staff.hire": "Hire role",
  "staff.hireCost": "Hire · $900",
  "staff.command.done": "Staff plan updated.",
  "staff.command.error.cash": "The club cannot afford that staff action.",
  "staff.command.error.missing": "That staff member is no longer available.",
  "staff.command.error.minimum": "At least one groundskeeper must remain on staff.",
  "staff.trait.steady": "Steady",
  "staff.trait.meticulous": "Meticulous",
  "staff.trait.mentor": "Mentor",
  "staff.trait.inventive": "Inventive",
  "staff.trait.warm": "Warm",
  "staff.trait.frugal": "Frugal",
  "staff.trait.competitive": "Competitive",
  "staff.trait.safetyMinded": "Safety-minded",
  "staff.tenure": "Since week {week}",
  "staff.proficiency": "Proficiency",
  "staff.morale": "Morale",
  "staff.wage": "${amount} per week",
  "staff.train": "Train",
  "staff.raise": "Give raise",
  "staff.dismiss": "Dismiss",
  "story.priority.routine": "Routine",
  "story.priority.notable": "Notable",
  "story.priority.major": "Major decision",
  "story.category.golf": "Golf",
  "story.category.staff": "Staff",
  "story.category.community": "Community",
  "story.category.finance": "Finance",
  "story.category.hospitality": "Hospitality",
  "story.category.safety": "Safety",
  "story.category.property": "Property",
  "story.category.tournament": "Tournament",
  "story.uncertain": "Some consequences are uncertain.",
  "story.known": "These immediate consequences are known.",
  "story.defer": "Decide later",
  "story.nonePending": "No decisions are waiting. New stories emerge from the course and club.",
  "story.journal": "Club journal",
  "story.week": "Week {week}",
  "story.fact.cash": "Cash",
  "story.fact.reputation": "Reputation",
  "story.fact.condition": "Course condition",
  "story.fact.lastWeekProfit": "Last week’s profit",
  "story.fact.regularCount": "Regular golfers",
  "story.fact.staffCount": "Staff",
  "story.fact.averageStaffMorale": "Average staff morale",
  "story.fact.architectureEvidence": "Retained shots",
  "story.fact.playerCareerPoints": "Player Pro career points",
  "story.fact.scheduledTournaments": "Scheduled tournaments",
  "story.fact.openClaims": "Open claims",
  "story.fact.communityComplaints": "Community complaints",
  "story.choice.play": "Play alongside them",
  "story.choice.listen": "Listen first",
  "story.choice.accept": "Accept",
  "story.choice.defer": "Defer",
  "story.choice.invest": "Invest",
  "story.choice.acceptRisk": "Accept the risk",
  "story.choice.recognize": "Recognize the effort",
  "story.choice.thank": "Offer thanks",
  "story.choice.support": "Support it",
  "story.choice.compromise": "Find a compromise",
  "story.choice.celebrate": "Celebrate publicly",
  "story.choice.measure": "Measure the result",
  "story.choice.decline": "Decline",
  "story.choice.renew": "Renew",
  "story.choice.pilot": "Run a pilot",
  "story.choice.expand": "Expand it",
  "story.choice.keepSmall": "Keep it intimate",
  "story.choice.publish": "Publish the review",
  "story.choice.internal": "Keep it internal",
  "story.choice.competitive": "Favor competition",
  "story.choice.holdLine": "Hold the line",
  "story.choice.staffOnly": "Use staff only",
  "story.choice.shareCredit": "Share the credit",
  "story.choice.focusCourse": "Focus on the course",
  "story.choice.redesign": "Redesign the hole",
  "story.choice.defend": "Defend the design",
  "story.choice.formal": "Use the formal process",
  "story.preview.play": "Builds trust and creates a future rematch.",
  "story.preview.listen": "Builds trust with a modest reputation benefit.",
  "story.preview.accept": "Commits resources for a stronger future opportunity.",
  "story.preview.defer": "Preserves resources but may cool the relationship.",
  "story.preview.invest": "Costs cash now and improves the underlying system.",
  "story.preview.acceptRisk": "Avoids the immediate cost while accepting downside risk.",
  "story.preview.recognize": "Costs a little and strongly improves morale or trust.",
  "story.preview.thank": "Offers a smaller morale benefit at no cost.",
  "story.preview.support": "Costs cash and improves reputation, trust, or morale.",
  "story.preview.compromise": "Balances cost with a smaller shared benefit.",
  "story.preview.celebrate": "Turns the result into club reputation and memory.",
  "story.preview.measure": "Takes a cautious, evidence-led approach.",
  "story.preview.decline": "Keeps the club independent and forgoes the offer.",
  "story.preview.renew": "Adds cash with a possible morale tradeoff.",
  "story.preview.pilot": "Limits cost while testing the idea.",
  "story.preview.expand": "Turns a successful trial into income and morale.",
  "story.preview.keepSmall": "Keeps the idea small and reputation-focused.",
  "story.preview.publish": "Trades openness for reputation and a lasting memory.",
  "story.preview.internal": "Keeps the process private and steadies the team.",
  "story.preview.competitive": "Leans into challenge with a relationship tradeoff.",
  "story.preview.holdLine": "Protects the current plan but may strain trust.",
  "story.preview.staffOnly": "Avoids coordination costs but pressures the team.",
  "story.preview.shareCredit": "Strengthens community, staff, and golfer bonds.",
  "story.preview.focusCourse": "Keeps the message narrow for a modest benefit.",
  "story.preview.redesign": "Spends cash to turn evidence into a better relationship.",
  "story.preview.defend": "Keeps the routing but risks the relationship.",
  "story.preview.formal": "Supports staff process while keeping emotional distance.",
  "story.memory.firstRound": "You made time for their first round as a regular.",
  "story.memory.rematch": "A promised rematch became part of club lore.",
  "story.memory.groundsTeam": "The grounds team was recognized after a difficult recovery.",
  "story.memory.accessDay": "A community access day brought new faces onto the course.",
  "story.memory.safetyReview": "The club answered a safety concern in public.",
  "story.memory.training": "The club invested in their development.",
  "story.memory.architecture": "Their course feedback helped reshape a hole.",
  "story.event.regular-welcome.title": "A familiar face at the first tee",
  "story.event.regular-welcome.body": "A returning golfer has become a regular and wants to understand the club behind the routing.",
  "story.event.regular-rematch.title": "The promised rematch",
  "story.event.regular-rematch.body": "The regular has returned for the round you talked about.",
  "story.event.superintendent-concern.title": "A warning from the grounds team",
  "story.event.superintendent-concern.body": "Course condition is slipping, and the superintendent wants a clear response.",
  "story.event.superintendent-result.title": "The grounds report",
  "story.event.superintendent-result.body": "The recovery work is complete. The team is watching how you acknowledge it.",
  "story.event.community-access-request.title": "A request to open the gates",
  "story.event.community-access-request.body": "Local golfers propose an access day that would trade short-term cost for wider goodwill.",
  "story.event.community-access-followup.title": "After the access day",
  "story.event.community-access-followup.body": "The community returns with stories and a question about what comes next.",
  "story.event.sponsor-offer.title": "A sponsor approaches the club",
  "story.event.sponsor-offer.body": "The offer would ease the balance sheet but put a commercial name beside the course.",
  "story.event.sponsor-renewal.title": "The partnership comes due",
  "story.event.sponsor-renewal.body": "The sponsor is ready to renew; the staff has mixed feelings.",
  "story.event.chef-market-night.title": "A market night proposal",
  "story.event.chef-market-night.body": "The hospitality team has a small event idea built around local food and the evening course.",
  "story.event.chef-return.title": "Market night returns",
  "story.event.chef-return.body": "The first gathering worked. The team wants to know how large it should become.",
  "story.event.safety-warning.title": "A safety concern needs an answer",
  "story.event.safety-warning.body": "An open claim has exposed a pattern that the staff cannot ignore.",
  "story.event.safety-review.title": "The safety review is ready",
  "story.event.safety-review.body": "The findings can be shared openly or handled inside the club.",
  "story.event.course-record-celebration.title": "A new name on the board",
  "story.event.course-record-celebration.body": "A regular has posted a personal best worth remembering.",
  "story.event.junior-clinic.title": "A morning for junior golfers",
  "story.event.junior-clinic.body": "The club professional can host a clinic if the club makes room for it.",
  "story.event.turf-recovery-window.title": "A narrow turf recovery window",
  "story.event.turf-recovery-window.body": "The grounds team sees a chance to restore stressed surfaces before demand rises.",
  "story.event.green-speed-debate.title": "How fast should the greens be?",
  "story.event.green-speed-debate.body": "A regular and a staff member have very different ideas about the right test.",
  "story.event.staff-training-slot.title": "A place opens in training",
  "story.event.staff-training-slot.body": "One staff member can build proficiency if the club funds the time.",
  "story.event.member-price-feedback.title": "Regulars react to the price",
  "story.event.member-price-feedback.body": "Frequent golfers want the club to reconsider the value it offers.",
  "story.event.hospitality-overflow.title": "The terrace is overflowing",
  "story.event.hospitality-overflow.body": "A busy day has pushed the hospitality team beyond its comfortable capacity.",
  "story.event.tournament-volunteers.title": "Volunteers for tournament week",
  "story.event.tournament-volunteers.body": "Regulars offer to help the staff stage the club’s next event.",
  "story.event.local-paper-profile.title": "The local paper calls",
  "story.event.local-paper-profile.body": "A reporter wants to tell the club’s story and asks who made it possible.",
  "story.event.conservation-walk.title": "A walk beyond the fairways",
  "story.event.conservation-walk.body": "The community proposes a guided conservation walk across the estate.",
  "story.event.pace-complaint.title": "A slow-round conversation",
  "story.event.pace-complaint.body": "A regular brings a pace complaint directly to the staff.",
  "story.event.architect-critique.title": "The evidence challenges the architect",
  "story.event.architect-critique.body": "A regular points to a pattern in the shot map and asks whether the hole should change.",
  "story.event.pro-am-invite.title": "An invitation to the pro-am",
  "story.event.pro-am-invite.body": "A regular wants the Player Pro beside them in a club showcase.",
  "story.event.claimant-conversation.title": "A difficult clubhouse conversation",
  "story.event.claimant-conversation.body": "A golfer affected by a safety claim has come to speak with the club.",
  "story.event.neighborhood-meeting.title": "The neighborhood meeting",
  "story.event.neighborhood-meeting.body": "Several complaints have become a public decision about how the club fits its surroundings."
};
const PLURAL = /\{(\w+),\s*plural,\s*one\s*\{([^{}]*)\}\s*other\s*\{([^{}]*)\}\}/g;
const PARAM = /\{(\w+)\}/g;
function translate(locale, key2, params = {}) {
  let message = en[key2];
  message = message.replace(PLURAL, (_match, name, one, other) => {
    const count = Number(params[name] ?? 0);
    return (count === 1 ? one : other).replaceAll("#", String(count));
  });
  message = message.replace(PARAM, (_match, name) => String(params[name] ?? `{${name}}`));
  return message;
}
const text = (key2) => translate("en", key2);
const goal = (id, labelKey, descriptionKey, conditions, deadlineWeek) => ({
  id,
  labelKey,
  label: text(labelKey),
  descriptionKey,
  description: text(descriptionKey),
  conditions,
  ...deadlineWeek == null ? {} : { deadlineWeek }
});
const phase = (id, titleKey, summaryKey, goals) => ({
  id,
  titleKey,
  summaryKey,
  goals,
  ...phaseContract(id),
  introSceneId: `${id}-intro`,
  completionSceneId: `${id}-complete`
});
const option = (id, labelKey, previewKey, effects, callbackFact) => ({ id, labelKey, previewKey, effects, callbackFact });
const scene = (id, speaker, titleKey, bodyKey, choices, expression = "neutral", factKeys = ["cash", "reputation", "condition", "week"]) => ({
  id,
  speaker,
  titleKey,
  bodyKey,
  expression,
  choices: choices.map((choice2) => ({
    ...choice2,
    effects: [
      ...choice2.effects,
      { type: "relationship", characterId: speaker, amount: choice2.id === "listen" || choice2.id === "study" ? 2 : 1 },
      ...choice2.callbackFact ? [
        { type: "eventPool", eventId: choice2.callbackFact },
        { type: "epilogueFact", fact: choice2.callbackFact }
      ] : []
    ]
  })),
  defaultChoiceId: choices[0].id,
  factKeys
});
const pred = (fact2, op, value) => ({ fact: fact2, op, value });
const medals = (silver, gold) => [
  { medal: "bronze", labelKey: "campaign.medal.bronze", descriptionKey: "campaign.medal.bronze.description", predicates: [] },
  { medal: "silver", labelKey: "campaign.medal.silver", descriptionKey: "campaign.medal.silver.description", predicates: silver },
  { medal: "gold", labelKey: "campaign.medal.gold", descriptionKey: "campaign.medal.gold.description", predicates: gold }
];
const introChoices = [
  option("listen", "campaign.choice.listen", "campaign.preview.listen", []),
  option("commit", "campaign.choice.commit", "campaign.preview.commit", [{ type: "reputation", amount: 1 }], "committed")
];
const practicalChoices = [
  option("invest", "campaign.choice.invest", "campaign.preview.invest", [{ type: "cash", amount: -750 }, { type: "condition", amount: 0.04 }], "invested"),
  option("adapt", "campaign.choice.adapt", "campaign.preview.adapt", [{ type: "reputation", amount: 1 }], "adapted")
];
const communityChoices = [
  option("open", "campaign.choice.open", "campaign.preview.open", [{ type: "cash", amount: -300 }, { type: "reputation", amount: 2 }], "community-open"),
  option("balance", "campaign.choice.balance", "campaign.preview.balance", [{ type: "reputation", amount: 1 }], "community-balanced")
];
const rivalryChoices = [
  option("accept", "campaign.choice.accept", "campaign.preview.accept", [{ type: "reputation", amount: 1 }, { type: "scheduleScene", sceneId: "rival-callback", delayWeeks: 2 }], "rival-accepted"),
  option("study", "campaign.choice.study", "campaign.preview.study", [{ type: "condition", amount: 0.02 }], "rival-studied")
];
const match = (id, kind, opponent, minCareerPoints) => ({
  id,
  kind,
  titleKey: `campaign.match.${kind}.title`,
  descriptionKey: `campaign.match.${kind}.description`,
  ...opponent ? { opponent } : { tournamentTier: "championship" },
  minCareerPoints
});
function phaseContract(id) {
  const base = {
    requirements: [],
    recoveryKey: "campaign.recovery.standard",
    estimatedMinutes: 45
  };
  const contracts = {
    "back-nine-discover": { estimatedMinutes: 35, recoveryKey: "campaign.recovery.backNineBuild" },
    "back-nine-prove": {
      requirements: [pred("playerCareerRounds", "gte", 1), pred("architectureEvidence", "gte", 1)],
      recoveryKey: "campaign.recovery.backNinePlay",
      estimatedMinutes: 55
    },
    "back-nine-open": {
      match: match("back-nine-opening-match", "opening", { id: "rowan-opening", characterId: "rowan", name: "Rowan Vale", skill: 0.46 }, 3),
      recoveryKey: "campaign.recovery.openingMatch",
      estimatedMinutes: 50
    },
    "muni-stabilize": { recoveryKey: "campaign.recovery.muniCondition", estimatedMinutes: 40 },
    "muni-trust": { requirements: [pred("staffLevel", "gte", 1)], recoveryKey: "campaign.recovery.muniTrust", estimatedMinutes: 45 },
    "muni-match": {
      match: match("muni-local-match", "local", { id: "jamie-local", characterId: "jamie", name: "Jamie Chen", skill: 0.52 }, 3),
      recoveryKey: "campaign.recovery.localMatch",
      estimatedMinutes: 50
    },
    "swamp-survey": { recoveryKey: "campaign.recovery.swampRoute", estimatedMinutes: 45 },
    "swamp-recover": { requirements: [pred("drainageLevel", "gte", 0)], recoveryKey: "campaign.recovery.swampWeather", estimatedMinutes: 55 },
    "swamp-rival": {
      match: match("swamp-rival-match", "rival", { id: "mara-swamp", characterId: "mara", name: "Mara Voss", skill: 0.7 }, 8),
      recoveryKey: "campaign.recovery.rivalMatch",
      estimatedMinutes: 55
    },
    "links-read": { recoveryKey: "campaign.recovery.linksRoute", estimatedMinutes: 45 },
    "links-wind": {
      requirements: [pred("playerCareerRounds", "gte", 1)],
      recoveryKey: "campaign.recovery.linksWind",
      estimatedMinutes: 55
    },
    "links-rival": {
      match: match("links-rival-match", "rival", { id: "mara-links", characterId: "mara", name: "Mara Voss", skill: 0.78 }, 8),
      recoveryKey: "campaign.recovery.rivalMatch",
      estimatedMinutes: 55
    },
    "members-listen": { recoveryKey: "campaign.recovery.membersListen", estimatedMinutes: 40 },
    "members-balance": { requirements: [pred("staffLevel", "gte", 1)], recoveryKey: "campaign.recovery.membersBooks", estimatedMinutes: 50 },
    "members-match": {
      match: match("members-club-match", "club", { id: "beatrice-club", characterId: "beatrice", name: "Beatrice Shaw", skill: 0.68 }, 8),
      recoveryKey: "campaign.recovery.clubMatch",
      estimatedMinutes: 55
    },
    "championship-qualify": {
      requirements: [pred("playerCareerPoints", "gte", 9)],
      recoveryKey: "campaign.recovery.championshipQualify",
      estimatedMinutes: 55
    },
    "championship-stage": {
      requirements: [pred("playerSkillAverage", "gte", 40), pred("architectureEvidence", "gte", 1)],
      recoveryKey: "campaign.recovery.championshipStage",
      estimatedMinutes: 60
    },
    "championship-final": {
      match: match("championship-final", "championship", void 0, 12),
      recoveryKey: "campaign.recovery.championshipFinal",
      estimatedMinutes: 70
    }
  };
  return { ...base, ...contracts[id] };
}
const CAMPAIGN_CAST = [
  {
    id: "rowan",
    name: "Rowan Vale",
    roleKey: "campaign.cast.rowan.role",
    portrait: { assetId: "campaign-rowan", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "advisor-caddie" },
    chapters: ["back-nine", "muni-rescue", "championship-dream"],
    gameplayRole: "Advisor and caddie who teaches the build-play-redesign loop without prescribing one layout.",
    voiceNotes: "Warm, economical, observant; speaks in evidence and golf decisions.",
    motivations: ["Help the Player Pro become self-sufficient", "Protect honest recovery paths"],
    relationships: { mara: "Respects Mara's rigor but challenges her certainty.", jamie: "Patient mentor who never speaks for Jamie." },
    stateTriggers: ["playerCareerRounds", "architectureEvidence", "cash"],
    choiceReactions: ["Warms when the player studies evidence.", "Pushes back when investment outruns a credible recovery path."],
    artRequirements: ["Original advisor silhouette", "Four 96px expression crops", "Caddie world sprite", "No licensed-character costume cues"],
    localizationNotes: "Avoid idioms about reading greens; keep sentences compact for UI expansion.",
    epilogueOutcomes: ["Trusted caddie", "Independent mentor"]
  },
  {
    id: "mara",
    name: "Mara Voss",
    roleKey: "campaign.cast.mara.role",
    portrait: { assetId: "campaign-mara", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "golfer-rival" },
    chapters: ["swamp-deal", "links-by-the-sea", "championship-dream"],
    gameplayRole: "Rival architect whose playable matches expose different strategic readings of the same land.",
    voiceNotes: "Precise, competitive, never villainous; critiques geometry rather than taste.",
    motivations: ["Prove restraint beats spectacle", "Earn the championship commission"],
    relationships: { rowan: "Friendly methodological disagreement.", eli: "Trusts his agronomic constraints.", jamie: "Sees a future competitor rather than a mascot." },
    stateTriggers: ["architectureEvidence", "playerMatchWins", "severeForecastDays"],
    choiceReactions: ["Respects completed matches regardless of result.", "Challenges claims unsupported by played-shot evidence."],
    artRequirements: ["Original architect/rival silhouette", "Four 96px expression crops", "Golfer world sprite", "Readable drafting-roll prop"],
    localizationNotes: "Golf strategy terms must use the shared glossary; rivalry remains respectful in every locale.",
    epilogueOutcomes: ["Respected rival", "Design collaborator"]
  },
  {
    id: "eli",
    name: "Eli Mercer",
    roleKey: "campaign.cast.eli.role",
    portrait: { assetId: "campaign-eli", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "staff-superintendent" },
    chapters: ["muni-rescue", "swamp-deal", "members-club", "championship-dream"],
    gameplayRole: "Superintendent who grounds weather, condition, staffing, and protected-land tradeoffs.",
    voiceNotes: "Dry, practical, proud of invisible work.",
    motivations: ["Keep turf promises realistic", "Build a team that can survive pressure"],
    relationships: { nadia: "Operational counterpart on public promises.", beatrice: "Will challenge standards that ignore staffing.", mara: "Values her restraint on vulnerable land." },
    stateTriggers: ["condition", "staffLevel", "drainageLevel", "severeForecastDays"],
    choiceReactions: ["Supports funded recovery.", "Names the labor cost of presentation-first choices."],
    artRequirements: ["Original superintendent silhouette", "Four 96px expression crops", "Workwear world sprite", "Weather-safe outerwear variant"],
    localizationNotes: "Keep agronomy plain-language and preserve units through formatted values.",
    epilogueOutcomes: ["Master superintendent", "Sustainable-operations advocate"]
  },
  {
    id: "beatrice",
    name: "Beatrice Shaw",
    roleKey: "campaign.cast.beatrice.role",
    portrait: { assetId: "campaign-beatrice", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "staff-captain" },
    chapters: ["members-club", "championship-dream"],
    gameplayRole: "Club captain who represents members without reducing the charter conflict to prestige versus access.",
    voiceNotes: "Formal, candid, capable of changing her mind when facts change.",
    motivations: ["Protect standards", "Keep the club socially coherent"],
    relationships: { eli: "Mutual respect with recurring budget tension.", nadia: "Debates access without treating the community as an abstraction.", jamie: "Initially cautious, eventually protective." },
    stateTriggers: ["greenFee", "reputation", "regularCount", "staffLevel"],
    choiceReactions: ["Rewards coherent charter promises.", "Changes position when staff and community facts contradict assumptions."],
    artRequirements: ["Original captain silhouette", "Four 96px expression crops", "Formal world sprite", "Non-branded club insignia"],
    localizationNotes: "Formality should survive translation without aristocratic or gendered stereotypes.",
    epilogueOutcomes: ["Reforming captain", "Keeper of tradition"]
  },
  {
    id: "nadia",
    name: "Nadia Okafor",
    roleKey: "campaign.cast.nadia.role",
    portrait: { assetId: "campaign-nadia", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "staff-planner" },
    chapters: ["muni-rescue", "swamp-deal", "members-club", "championship-dream"],
    gameplayRole: "Town planner who connects prices, access, safety, protected land, and community promises to live facts.",
    voiceNotes: "Measured and specific; separates public obligations from personal preference.",
    motivations: ["Make growth legible", "Keep public promises auditable"],
    relationships: { eli: "Turns his operating facts into public commitments.", beatrice: "Constructive institutional counterweight.", jamie: "Listens directly and verifies outcomes." },
    stateTriggers: ["greenFee", "accessCapacity", "cash", "reputation"],
    choiceReactions: ["Records access commitments.", "Questions prestige claims that do not match measured capacity."],
    artRequirements: ["Original planner silhouette", "Four 96px expression crops", "Planner world sprite", "Readable map-table prop"],
    localizationNotes: "Civic terminology must remain jurisdiction-neutral and avoid culture-specific bureaucracy jokes.",
    epilogueOutcomes: ["Long-term planning partner", "Independent civic watchdog"]
  },
  {
    id: "jamie",
    name: "Jamie Chen",
    roleKey: "campaign.cast.jamie.role",
    portrait: { assetId: "campaign-jamie", expressions: { neutral: 0, warm: 1, concerned: 2, celebrating: 3 }, worldSprite: "golfer-junior" },
    chapters: ["muni-rescue", "links-by-the-sea", "members-club", "championship-dream"],
    gameplayRole: "Young regular whose stable identity makes access, trust, and long-term club legacy personal.",
    voiceNotes: "Curious, direct, golf-literate without sounding like an adult proxy.",
    motivations: ["Find a place to belong", "Become a fearless links player"],
    relationships: { rowan: "Learns from Rowan without copying him.", mara: "Aspires to challenge her one day.", beatrice: "Tests whether club promises include the next generation." },
    stateTriggers: ["regularCount", "greenFee", "playerCareerRounds", "reputation"],
    choiceReactions: ["Remembers whether access stayed affordable.", "Responds to played matches and repeat visits rather than speeches."],
    artRequirements: ["Original junior-golfer silhouette", "Four 96px expression crops", "Junior golfer world sprite", "Age-appropriate non-branded kit"],
    localizationNotes: "Keep voice direct and age-appropriate; avoid slang that dates quickly or localizes poorly.",
    epilogueOutcomes: ["Club champion", "Community coach"]
  }
];
const chapterData = [
  {
    id: "back-nine",
    phases: [
      phase("back-nine-discover", "campaign.phase.backNine.1.title", "campaign.phase.backNine.1.summary", [
        goal("first-hole", "campaign.goal.firstHole", "campaign.goal.firstHole.description", [{ metric: "holesBuilt", comparator: ">=", target: 1 }], 8)
      ]),
      phase("back-nine-prove", "campaign.phase.backNine.2.title", "campaign.phase.backNine.2.summary", [
        goal("play-the-proof", "campaign.goal.playProof", "campaign.goal.playProof.description", [{ metric: "holesBuilt", comparator: ">=", target: 3 }, { metric: "totalRounds", comparator: ">=", target: 1 }], 18)
      ]),
      phase("back-nine-open", "campaign.phase.backNine.3.title", "campaign.phase.backNine.3.summary", [
        goal("open-the-course", "campaign.goal.openCourse", "campaign.goal.openCourse.description", [{ metric: "profitStreak", comparator: ">=", target: 1 }], 28)
      ])
    ],
    speakers: ["rowan", "rowan", "rowan"],
    choices: [introChoices, practicalChoices, communityChoices],
    complicationSpeaker: "rowan",
    silver: [pred("week", "lte", 24)],
    gold: [pred("week", "lte", 18), pred("architectureEvidence", "gte", 3)]
  },
  {
    id: "muni-rescue",
    phases: [
      phase("muni-stabilize", "campaign.phase.muni.1.title", "campaign.phase.muni.1.summary", [
        goal("restore-basics", "campaign.goal.restoreBasics", "campaign.goal.restoreBasics.description", [{ metric: "condition", comparator: ">=", target: 55 }], 12)
      ]),
      phase("muni-trust", "campaign.phase.muni.2.title", "campaign.phase.muni.2.summary", [
        goal("restore-trust", "campaign.goal.restoreTrust", "campaign.goal.restoreTrust.description", [{ metric: "reputation", comparator: ">=", target: 40 }], 24)
      ]),
      phase("muni-match", "campaign.phase.muni.3.title", "campaign.phase.muni.3.summary", [
        goal("local-match", "campaign.goal.localMatch", "campaign.goal.localMatch.description", [{ metric: "totalRounds", comparator: ">=", target: 5 }, { metric: "reputation", comparator: ">=", target: 55 }], 36)
      ])
    ],
    speakers: ["nadia", "eli", "jamie"],
    choices: [communityChoices, practicalChoices, rivalryChoices],
    complicationSpeaker: "jamie",
    silver: [pred("reputation", "gte", 60)],
    gold: [pred("reputation", "gte", 68), pred("regularCount", "gte", 1)]
  },
  {
    id: "swamp-deal",
    phases: [
      phase("swamp-survey", "campaign.phase.swamp.1.title", "campaign.phase.swamp.1.summary", [
        goal("dry-route", "campaign.goal.dryRoute", "campaign.goal.dryRoute.description", [{ metric: "holesBuilt", comparator: ">=", target: 3 }], 14)
      ]),
      phase("swamp-recover", "campaign.phase.swamp.2.title", "campaign.phase.swamp.2.summary", [
        goal("weather-proof", "campaign.goal.weatherProof", "campaign.goal.weatherProof.description", [{ metric: "holesBuilt", comparator: ">=", target: 6 }, { metric: "courseRating", comparator: ">=", target: 63 }], 28)
      ]),
      phase("swamp-rival", "campaign.phase.swamp.3.title", "campaign.phase.swamp.3.summary", [
        goal("swamp-rival", "campaign.goal.rivalMatch", "campaign.goal.rivalMatch.description", [{ metric: "holesBuilt", comparator: ">=", target: 9 }, { metric: "courseRating", comparator: ">=", target: 67 }], 42)
      ])
    ],
    speakers: ["eli", "nadia", "mara"],
    choices: [practicalChoices, communityChoices, rivalryChoices],
    complicationSpeaker: "eli",
    silver: [pred("cash", "gte", 1e4)],
    gold: [pred("cash", "gte", 25e3), pred("architectureEvidence", "gte", 6)]
  },
  {
    id: "links-by-the-sea",
    phases: [
      phase("links-read", "campaign.phase.links.1.title", "campaign.phase.links.1.summary", [
        goal("find-routing", "campaign.goal.findRouting", "campaign.goal.findRouting.description", [{ metric: "holesBuilt", comparator: ">=", target: 3 }], 14)
      ]),
      phase("links-wind", "campaign.phase.links.2.title", "campaign.phase.links.2.summary", [
        goal("wind-test", "campaign.goal.windTest", "campaign.goal.windTest.description", [{ metric: "holesBuilt", comparator: ">=", target: 6 }, { metric: "courseRating", comparator: ">=", target: 66 }], 28)
      ]),
      phase("links-rival", "campaign.phase.links.3.title", "campaign.phase.links.3.summary", [
        goal("links-rival", "campaign.goal.rivalMatch", "campaign.goal.rivalMatch.description", [{ metric: "holesBuilt", comparator: ">=", target: 9 }, { metric: "courseRating", comparator: ">=", target: 70 }], 42)
      ])
    ],
    speakers: ["mara", "jamie", "mara"],
    choices: [introChoices, practicalChoices, rivalryChoices],
    complicationSpeaker: "mara",
    silver: [pred("architectureEvidence", "gte", 5)],
    gold: [pred("architectureEvidence", "gte", 10), pred("condition", "gte", 75)]
  },
  {
    id: "members-club",
    phases: [
      phase("members-listen", "campaign.phase.members.1.title", "campaign.phase.members.1.summary", [
        goal("listen-members", "campaign.goal.listenMembers", "campaign.goal.listenMembers.description", [{ metric: "reputation", comparator: ">=", target: 65 }], 14)
      ]),
      phase("members-balance", "campaign.phase.members.2.title", "campaign.phase.members.2.summary", [
        goal("balance-books", "campaign.goal.balanceBooks", "campaign.goal.balanceBooks.description", [{ metric: "profitStreak", comparator: ">=", target: 1 }], 28)
      ]),
      phase("members-match", "campaign.phase.members.3.title", "campaign.phase.members.3.summary", [
        goal("club-match", "campaign.goal.clubMatch", "campaign.goal.clubMatch.description", [{ metric: "reputation", comparator: ">=", target: 75 }, { metric: "profitStreak", comparator: ">=", target: 3 }, { metric: "totalRounds", comparator: ">=", target: 15 }], 44)
      ])
    ],
    speakers: ["beatrice", "eli", "jamie"],
    choices: [introChoices, practicalChoices, communityChoices],
    complicationSpeaker: "beatrice",
    silver: [pred("reputation", "gte", 80)],
    gold: [pred("reputation", "gte", 88), pred("regularCount", "gte", 2)]
  },
  {
    id: "championship-dream",
    phases: [
      phase("championship-qualify", "campaign.phase.championship.1.title", "campaign.phase.championship.1.summary", [
        goal("property-ready", "campaign.goal.propertyReady", "campaign.goal.propertyReady.description", [{ metric: "publishedCourses", comparator: ">=", target: 1 }, { metric: "holesBuilt", comparator: ">=", target: 18 }], 20)
      ]),
      phase("championship-stage", "campaign.phase.championship.2.title", "campaign.phase.championship.2.summary", [
        goal("tour-ready", "campaign.goal.tourReady", "campaign.goal.tourReady.description", [{ metric: "courseRating", comparator: ">=", target: 72 }, { metric: "reputation", comparator: ">=", target: 80 }], 40)
      ]),
      phase("championship-final", "campaign.phase.championship.3.title", "campaign.phase.championship.3.summary", [
        goal("finale", "campaign.goal.finale", "campaign.goal.finale.description", [{ metric: "cash", comparator: ">=", target: 15e4 }, { metric: "totalRounds", comparator: ">=", target: 25 }], 60)
      ])
    ],
    speakers: ["nadia", "mara", "rowan"],
    choices: [communityChoices, rivalryChoices, introChoices],
    complicationSpeaker: "rowan",
    silver: [pred("week", "lte", 52), pred("playerCareerPoints", "gte", 12)],
    gold: [pred("week", "lte", 44), pred("playerCareerPoints", "gte", 20), pred("scheduledTournaments", "gte", 1)]
  }
];
function buildChapter(raw) {
  const scenes = [];
  raw.phases.forEach((item, index) => {
    const facts = raw.id === "muni-rescue" ? ["cash", "condition", "greenFee", "accessCapacity", "staffLevel", "regularCount"] : raw.id === "swamp-deal" || raw.id === "links-by-the-sea" ? ["cash", "condition", "severeForecastDays", "drainageLevel", "architectureEvidence"] : raw.id === "members-club" ? ["cash", "reputation", "greenFee", "staffLevel", "regularCount"] : raw.id === "championship-dream" ? ["reputation", "playerCareerPoints", "playerSkillAverage", "scheduledTournaments", "legacyYears"] : ["cash", "condition", "playerCareerRounds", "architectureEvidence"];
    scenes.push(scene(item.introSceneId, raw.speakers[index], item.titleKey, item.summaryKey, raw.choices[index], index === 2 ? "concerned" : "neutral", facts));
    scenes.push(scene(item.completionSceneId, raw.speakers[index], "campaign.scene.progress.title", "campaign.scene.progress.body", introChoices, "warm"));
  });
  const complicationFacts = {
    "back-nine": [["condition", "playerCareerRounds"], ["cash", "architectureEvidence"]],
    "muni-rescue": [["condition", "staffLevel"], ["greenFee", "accessCapacity", "regularCount"]],
    "swamp-deal": [["severeForecastDays", "drainageLevel"], ["cash", "architectureEvidence"]],
    "links-by-the-sea": [["severeForecastDays", "playerCareerRounds"], ["condition", "architectureEvidence"]],
    "members-club": [["greenFee", "staffLevel"], ["reputation", "regularCount"]],
    "championship-dream": [["playerCareerPoints", "playerSkillAverage"], ["scheduledTournaments", "legacyYears"]]
  };
  scenes.push(scene(`${raw.id}-complication-a`, raw.complicationSpeaker, "campaign.scene.complication.title", "campaign.scene.complication.body", practicalChoices, "concerned", complicationFacts[raw.id][0]));
  scenes.push(scene(`${raw.id}-complication-b`, raw.complicationSpeaker, "campaign.scene.choice.title", "campaign.scene.choice.body", communityChoices, "concerned", complicationFacts[raw.id][1]));
  scenes.push(scene("rival-callback", "mara", "campaign.scene.callback.title", "campaign.scene.callback.body", introChoices, "warm"));
  const complicationsByChapter = {
    "back-nine": [[pred("condition", "lte", 85)], [pred("architectureEvidence", "gte", 1)]],
    "muni-rescue": [[pred("condition", "lte", 65)], [pred("regularCount", "gte", 1)]],
    "swamp-deal": [[pred("severeForecastDays", "gte", 1)], [pred("drainageLevel", "lte", 1)]],
    "links-by-the-sea": [[pred("severeForecastDays", "gte", 1)], [pred("architectureEvidence", "gte", 2)]],
    "members-club": [[pred("greenFee", "eq", 110)], [pred("staffLevel", "lte", 2)]],
    "championship-dream": [[pred("playerCareerPoints", "gte", 9)], [pred("playerSkillAverage", "lte", 55)]]
  };
  return {
    id: raw.id,
    phases: raw.phases,
    complications: [
      { id: `${raw.id}-pressure`, phaseId: raw.phases[1].id, predicates: complicationsByChapter[raw.id][0], sceneId: `${raw.id}-complication-a`, factKeys: complicationFacts[raw.id][0], recoveryKey: raw.phases[1].recoveryKey },
      { id: `${raw.id}-choice`, phaseId: raw.phases[2].id, predicates: complicationsByChapter[raw.id][1], sceneId: `${raw.id}-complication-b`, factKeys: complicationFacts[raw.id][1], recoveryKey: raw.phases[2].recoveryKey }
    ],
    scenes,
    medals: medals(raw.silver, raw.gold),
    rewards: [`campaign-unlock-${raw.id}`, `campaign-cosmetic-${raw.id}`],
    supportedCharters: ["public-gem", "championship-venue", "destination-retreat", "member-institution"],
    epilogueKey: "campaign.epilogue.summary"
  };
}
const CAMPAIGN_CHAPTERS = chapterData.map(buildChapter);
const CAMPAIGN_CHAPTER_BY_ID = new Map(CAMPAIGN_CHAPTERS.map((chapter) => [chapter.id, chapter]));
new Map(CAMPAIGN_CAST.map((character) => [character.id, character]));
function validateMedal(medal, errors, chapterId) {
  if (!medal.labelKey || !medal.descriptionKey) errors.push(`medal-copy:${chapterId}:${medal.medal}`);
  if (medal.predicates.some((item) => !Number.isFinite(item.value))) errors.push(`medal-predicate:${chapterId}:${medal.medal}`);
}
function validateCampaignContent(chapters = CAMPAIGN_CHAPTERS) {
  const errors = [];
  const chapterIds = /* @__PURE__ */ new Set();
  for (const chapter of chapters) {
    if (!chapter.id || chapterIds.has(chapter.id)) errors.push(`chapter:${chapter.id}`);
    chapterIds.add(chapter.id);
    if (chapter.phases.length !== 3) errors.push(`phases:${chapter.id}`);
    const phaseIds = /* @__PURE__ */ new Set();
    for (const item of chapter.phases) {
      if (!item.id || phaseIds.has(item.id) || item.goals.length === 0) errors.push(`phase:${chapter.id}:${item.id}`);
      phaseIds.add(item.id);
      if (!item.introSceneId || !item.goals.every((entry) => entry.conditions.length > 0)) errors.push(`phase-content:${chapter.id}:${item.id}`);
      if (!item.recoveryKey || item.estimatedMinutes < 20 || item.estimatedMinutes > 90) errors.push(`phase-recovery:${chapter.id}:${item.id}`);
      if (item.match && (!item.match.id || item.match.minCareerPoints < 0 || item.match.kind === "championship" !== Boolean(item.match.tournamentTier))) {
        errors.push(`phase-match:${chapter.id}:${item.id}`);
      }
    }
    const sceneIds = new Set(chapter.scenes.map((item) => item.id));
    for (const item of chapter.scenes) {
      if (!item.choices.length || !item.choices.some((candidate) => candidate.id === item.defaultChoiceId)) errors.push(`scene:${chapter.id}:${item.id}`);
      for (const choice2 of item.choices) for (const effect of choice2.effects) {
        if (effect.type === "scheduleScene" && !sceneIds.has(effect.sceneId)) errors.push(`callback:${chapter.id}:${item.id}:${effect.sceneId}`);
      }
    }
    for (const complication of chapter.complications) {
      if (!phaseIds.has(complication.phaseId) || !sceneIds.has(complication.sceneId) || !complication.factKeys.length || !complication.recoveryKey) errors.push(`complication:${chapter.id}:${complication.id}`);
    }
    chapter.medals.forEach((medal) => validateMedal(medal, errors, chapter.id));
    if (chapter.supportedCharters.length !== 4 || chapter.rewards.length < 2 || !chapter.epilogueKey) errors.push(`chapter-contract:${chapter.id}`);
  }
  if (CAMPAIGN_CAST.length !== 6 || new Set(CAMPAIGN_CAST.map((character) => character.id)).size !== 6) errors.push("cast");
  for (const character of CAMPAIGN_CAST) {
    if (character.chapters.length < 2 || character.motivations.length < 2 || character.epilogueOutcomes.length < 2) errors.push(`cast-arc:${character.id}`);
    if (character.stateTriggers.length < 2 || character.choiceReactions.length < 2 || character.artRequirements.length < 3 || !character.localizationNotes) errors.push(`cast-production:${character.id}`);
    if (Object.keys(character.relationships).length < 2) errors.push(`cast-relationships:${character.id}`);
  }
  return errors;
}
const VALIDATION_ERRORS = validateCampaignContent();
if (VALIDATION_ERRORS.length) throw new Error(`Invalid M40 campaign content: ${VALIDATION_ERRORS.join(", ")}`);
const MAX_SCENES = 96;
const MAX_FACTS = 64;
const clamp$2 = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? Number(value) : fallback;
const emptyRelationships = () => Object.fromEntries(
  CAMPAIGN_CAST.map((character) => [character.id, 0])
);
function validCharter(value) {
  return ["public-gem", "championship-venue", "destination-retreat", "member-institution"].includes(String(value));
}
function validChoice(raw, fallbackChapterId) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw;
  if (typeof source.sceneId !== "string" || typeof source.choiceId !== "string" || !Number.isFinite(source.week)) return null;
  const facts = source.facts && typeof source.facts === "object" ? Object.fromEntries(Object.entries(source.facts).filter(([, value]) => Number.isFinite(value)).slice(0, 32)) : {};
  return {
    chapterId: typeof source.chapterId === "string" ? source.chapterId : fallbackChapterId,
    sceneId: source.sceneId,
    choiceId: source.choiceId,
    week: Math.max(1, Math.floor(source.week)),
    facts,
    ...typeof source.callbackFact === "string" ? { callbackFact: source.callbackFact } : {}
  };
}
function createCampaignRun(chapterId, charter = "public-gem", priorChoices = [], startedWeek = 1) {
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(chapterId);
  if (!chapter) throw new Error(`Unknown campaign chapter: ${chapterId}`);
  return {
    version: 2,
    chapterId,
    phaseIndex: 0,
    completedPhaseIds: [],
    firedComplicationIds: [],
    pendingSceneIds: [chapter.phases[0].introSceneId],
    resolvedSceneIds: [],
    scheduledScenes: [],
    choices: [],
    priorChoices: priorChoices.map((choice2) => validChoice(choice2, chapterId)).filter((choice2) => choice2 != null).slice(-120),
    relationships: emptyRelationships(),
    eventPool: [],
    epilogueFacts: [],
    matches: [],
    settlementLedger: [],
    completed: false,
    charter,
    startedWeek: Math.max(1, Math.floor(startedWeek)),
    continuedInSandbox: false
  };
}
function normalizeCampaignRun(raw, chapterId, charter) {
  const candidate = raw && typeof raw === "object" ? raw : {};
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(
    typeof candidate.chapterId === "string" ? candidate.chapterId : chapterId ?? ""
  );
  if (!chapter) return void 0;
  const fallback = createCampaignRun(chapter.id, validCharter(charter) ? charter : "public-gem");
  const phaseIndex = clamp$2(Math.floor(finite(candidate.phaseIndex)), 0, 2);
  const sceneIds = new Set(chapter.scenes.map((scene2) => scene2.id));
  const phaseIds = new Set(chapter.phases.map((phase2) => phase2.id));
  const matchIds = new Set(chapter.phases.flatMap((phase2) => phase2.match ? [phase2.match.id] : []));
  const relationships = emptyRelationships();
  if (candidate.relationships && typeof candidate.relationships === "object") {
    for (const character of CAMPAIGN_CAST) {
      relationships[character.id] = clamp$2(Math.round(finite(candidate.relationships[character.id])), -100, 100);
    }
  }
  const normalizeIds = (value, allowed, limit = MAX_SCENES) => Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string" && (!allowed || allowed.has(id))))].slice(-limit) : [];
  const scheduledScenes = Array.isArray(candidate.scheduledScenes) ? candidate.scheduledScenes.filter(
    (entry) => entry && sceneIds.has(entry.sceneId) && Number.isFinite(entry.dueWeek) && typeof entry.sourceSceneId === "string"
  ).map((entry) => ({ ...entry, dueWeek: Math.max(1, Math.floor(entry.dueWeek)) })).slice(-24) : [];
  const matches = Array.isArray(candidate.matches) ? candidate.matches.filter(
    (entry) => entry && matchIds.has(entry.definitionId) && typeof entry.roundId === "string" && (entry.status === "active" || entry.status === "complete")
  ).map((entry) => ({
    definitionId: entry.definitionId,
    roundId: entry.roundId,
    ...typeof entry.tournamentId === "string" ? { tournamentId: entry.tournamentId } : {},
    status: entry.status,
    ...["won", "lost", "tied", "conceded", "complete"].includes(entry.result ?? "") ? { result: entry.result } : {}
  })).slice(-12) : [];
  const choices = Array.isArray(candidate.choices) ? candidate.choices.map((choice2) => validChoice(choice2, chapter.id)).filter((choice2) => choice2 != null).slice(-120) : [];
  const priorChoices = Array.isArray(candidate.priorChoices) ? candidate.priorChoices.map((choice2) => validChoice(choice2, chapter.id)).filter((choice2) => choice2 != null).slice(-120) : [];
  return {
    ...fallback,
    version: 2,
    phaseIndex,
    completedPhaseIds: normalizeIds(candidate.completedPhaseIds, phaseIds, 3),
    firedComplicationIds: normalizeIds(candidate.firedComplicationIds, void 0, 24),
    pendingSceneIds: normalizeIds(candidate.pendingSceneIds, sceneIds, 8),
    resolvedSceneIds: normalizeIds(candidate.resolvedSceneIds, sceneIds, MAX_SCENES),
    scheduledScenes,
    choices,
    priorChoices,
    relationships,
    eventPool: normalizeIds(candidate.eventPool, void 0, 40),
    epilogueFacts: normalizeIds(candidate.epilogueFacts, void 0, MAX_FACTS),
    matches,
    settlementLedger: normalizeIds(candidate.settlementLedger, void 0, 180),
    completed: candidate.completed === true,
    ...candidate.medal === "bronze" || candidate.medal === "silver" || candidate.medal === "gold" ? { medal: candidate.medal } : {},
    ...candidate.outcome === "victory" || candidate.outcome === "honorable-loss" ? { outcome: candidate.outcome } : {},
    charter: validCharter(candidate.charter) ? candidate.charter : validCharter(charter) ? charter : fallback.charter,
    startedWeek: Math.max(1, Math.floor(finite(candidate.startedWeek, 1))),
    continuedInSandbox: candidate.continuedInSandbox === true
  };
}
function campaignFacts(course, world) {
  const living = world.livingClub;
  const player = world.playerPro;
  const completedMatches = player?.rounds.filter(
    (round2) => round2.opponentId?.startsWith("rowan-") || round2.opponentId?.startsWith("jamie-") || round2.opponentId?.startsWith("mara-") || round2.opponentId?.startsWith("beatrice-") || round2.tournamentId != null
  ) ?? [];
  const skillValues = player ? Object.values(player.skills) : [];
  const seasonal = world.seasonal;
  return {
    cash: Math.round(world.cash),
    reputation: Math.round(world.reputation),
    condition: Math.round(course.condition * 100),
    week: world.week,
    greenFee: Math.round(course.baseGreenFee),
    accessCapacity: propertyAccessCapacity(course, world),
    staffLevel: world.staffLevel,
    totalRounds: world.objectives?.totalRounds ?? 0,
    regularCount: living?.regulars.length ?? 0,
    architectureEvidence: living?.architecture.evidence.length ?? 0,
    playerCareerPoints: player?.careerPoints ?? 0,
    playerCareerRounds: player?.rounds.length ?? 0,
    playerMatchWins: completedMatches.filter((round2) => round2.result === "won").length,
    playerSkillAverage: skillValues.length ? Math.round(skillValues.reduce((sum, value) => sum + value, 0) / skillValues.length) : 0,
    scheduledTournaments: world.tournaments?.events.filter((event2) => event2.status === "scheduled").length ?? 0,
    completedTournaments: world.tournaments?.events.filter((event2) => event2.status === "completed").length ?? 0,
    severeForecastDays: seasonal?.forecast.filter((day) => day.kind === "heavy_rain" || day.kind === "storm").length ?? 0,
    drainageLevel: seasonal?.operations.drainageLevel ?? 0,
    legacyYears: seasonal?.yearbooks.length ?? 0
  };
}
function predicateMet(predicate2, facts) {
  const value = facts[predicate2.fact];
  if (predicate2.op === "gte") return value >= predicate2.value;
  if (predicate2.op === "lte") return value <= predicate2.value;
  return value === predicate2.value;
}
function matchResult(world, record) {
  return world.playerPro?.rounds.find((round2) => round2.id === record.roundId)?.result;
}
function syncCampaignMatches(state, world) {
  let changed = false;
  const settlementLedger = [...state.settlementLedger];
  const relationships = { ...state.relationships };
  const epilogueFacts = [...state.epilogueFacts];
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId);
  const matches = state.matches.map((record) => {
    if (record.status === "complete") return record;
    const result = matchResult(world, record);
    if (!result) return record;
    changed = true;
    const definition = chapter?.phases.flatMap((phase2) => phase2.match ? [phase2.match] : []).find((match2) => match2.id === record.definitionId);
    const ledgerId = `match:${record.definitionId}`;
    if (!settlementLedger.includes(ledgerId)) {
      settlementLedger.push(ledgerId);
      if (definition?.opponent) relationships[definition.opponent.characterId] = clamp$2(
        relationships[definition.opponent.characterId] + (result === "won" ? 3 : 1),
        -100,
        100
      );
      epilogueFacts.push(`${record.definitionId}:${result}`);
    }
    return { ...record, status: "complete", result };
  });
  if (!changed) return state;
  return {
    ...state,
    matches,
    relationships,
    epilogueFacts: [...new Set(epilogueFacts)].slice(-MAX_FACTS),
    settlementLedger: [...new Set(settlementLedger)].slice(-180)
  };
}
function campaignMatchComplete(state, match2) {
  return state.matches.some((record) => record.definitionId === match2.id && record.status === "complete");
}
function calculateMedal(state, course, world) {
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(state.chapterId);
  if (!chapter) return "bronze";
  const facts = campaignFacts(course, world);
  if (chapter.medals.find((item) => item.medal === "gold").predicates.every((item) => predicateMet(item, facts))) return "gold";
  if (chapter.medals.find((item) => item.medal === "silver").predicates.every((item) => predicateMet(item, facts))) return "silver";
  return "bronze";
}
function completionOutcome(state) {
  const finalMatch = state.matches.find((match2) => match2.definitionId === "championship-final");
  return finalMatch && finalMatch.result !== "won" ? "honorable-loss" : "victory";
}
function buildCampaignEpilogue(course, world, state) {
  const facts = campaignFacts(course, world);
  const strongestRelationship = Object.entries(state.relationships).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const priorFacts = state.priorChoices.flatMap((choice2) => choice2.callbackFact ? [`prior:${choice2.callbackFact}`] : []);
  return [.../* @__PURE__ */ new Set([
    `charter:${world.seasonal?.charter ?? state.charter}`,
    `club:reputation-${facts.reputation}`,
    `club:condition-${facts.condition}`,
    `pro:points-${facts.playerCareerPoints}`,
    `pro:rounds-${facts.playerCareerRounds}`,
    `legacy:years-${facts.legacyYears}`,
    ...strongestRelationship ? [`relationship:${strongestRelationship[0]}:${strongestRelationship[1]}`] : [],
    ...state.epilogueFacts,
    ...state.choices.flatMap((choice2) => choice2.callbackFact ? [`choice:${choice2.callbackFact}`] : []),
    ...priorFacts
  ])].slice(-MAX_FACTS);
}
function advanceCampaign(course, world) {
  if (!world.scenarioId || !world.campaign) return world;
  const chapter = CAMPAIGN_CHAPTER_BY_ID.get(world.scenarioId);
  if (!chapter) return world;
  let current = normalizeCampaignRun(world.campaign, world.scenarioId, world.seasonal?.charter);
  current = syncCampaignMatches(current, world);
  if (current.completed) return current === world.campaign ? world : { ...world, campaign: current };
  const facts = campaignFacts(course, world);
  const dueScenes = current.scheduledScenes.filter((entry) => entry.dueWeek <= world.week);
  const scheduledScenes = current.scheduledScenes.filter((entry) => entry.dueWeek > world.week);
  const pendingSceneIds = [...current.pendingSceneIds];
  for (const entry of dueScenes) {
    if (!pendingSceneIds.includes(entry.sceneId) && !current.resolvedSceneIds.includes(entry.sceneId)) pendingSceneIds.push(entry.sceneId);
  }
  const phase2 = chapter.phases[current.phaseIndex];
  const firedComplicationIds = [...current.firedComplicationIds];
  for (const complication of chapter.complications) {
    if (complication.phaseId !== phase2.id || firedComplicationIds.includes(complication.id)) continue;
    if (!complication.predicates.every((item) => predicateMet(item, facts))) continue;
    firedComplicationIds.push(complication.id);
    if (!pendingSceneIds.includes(complication.sceneId) && !current.resolvedSceneIds.includes(complication.sceneId)) pendingSceneIds.push(complication.sceneId);
  }
  const campaign = { ...current, pendingSceneIds, scheduledScenes, firedComplicationIds };
  if (world.objectives?.outcome !== "WON" || !phase2.requirements.every((item) => predicateMet(item, facts)) || phase2.match != null && !campaignMatchComplete(campaign, phase2.match)) {
    return { ...world, campaign };
  }
  const completedPhaseIds = [.../* @__PURE__ */ new Set([...campaign.completedPhaseIds, phase2.id])];
  if (phase2.completionSceneId && !pendingSceneIds.includes(phase2.completionSceneId)) pendingSceneIds.push(phase2.completionSceneId);
  if (campaign.phaseIndex < 2) {
    const nextIndex = campaign.phaseIndex + 1;
    const nextPhase = chapter.phases[nextIndex];
    if (!pendingSceneIds.includes(nextPhase.introSceneId)) pendingSceneIds.push(nextPhase.introSceneId);
    return {
      ...world,
      objectives: createObjectiveState(nextPhase.goals),
      campaign: {
        ...campaign,
        phaseIndex: nextIndex,
        completedPhaseIds,
        pendingSceneIds
      }
    };
  }
  const completeState = {
    ...campaign,
    completed: true,
    medal: calculateMedal(campaign, course, world),
    outcome: completionOutcome(campaign),
    completedPhaseIds,
    pendingSceneIds
  };
  completeState.epilogueFacts = buildCampaignEpilogue(course, world, completeState);
  return { ...world, campaign: completeState };
}
function clamp$1(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function clamp01(x) {
  return clamp$1(x, 0, 1);
}
const DAYS_PER_WEEK = 7;
function commitDay(args) {
  const { course, world, reactions, dayIndex } = args;
  const seasonalCommit = advanceSeasonalDay(course, world, dayIndex ?? 0);
  const season = seasonalState(seasonalCommit.world, seasonalCommit.course, dayIndex ?? 0);
  const charter = charterDefinition(season.charter).benefits;
  const propertySettlement = settlePropertyDay(seasonalCommit.course, seasonalCommit.world, dayIndex ?? 0, reactions.rounds, args.shotTraces);
  const operatingCourse = propertySettlement.course;
  const operatingWorld = recordCoreCommerce(propertySettlement.world, dayIndex ?? 0, {
    greenFees: args.greenFees ?? args.revenue,
    concessions: args.concessionRevenue ?? 0,
    tournaments: args.tournamentRevenue ?? 0,
    byConcession: args.concessionByType ?? {}
  });
  const hospitalityWeatherAdjustment = propertySettlement.report.revenue * (seasonalCommit.modifiers.lodgingMultiplier - 1);
  const revenue = args.revenue + propertySettlement.report.revenue + hospitalityWeatherAdjustment;
  const BALANCE2 = getEffectiveBalance(operatingWorld.difficulty);
  const rounds = reactions.rounds;
  const avgSatisfaction = reactions.avgSatisfaction;
  const staffCost = BALANCE2.ops.staffCostPerLevel * operatingWorld.staffLevel / DAYS_PER_WEEK;
  const marketingCost = BALANCE2.ops.marketingCostPerLevel * operatingWorld.marketingLevel / DAYS_PER_WEEK;
  const maintenanceCost = operatingWorld.maintenanceBudget / DAYS_PER_WEEK;
  const overhead = BALANCE2.overhead;
  const overheadTotal = (overhead.insurance + overhead.utilities + overhead.admin + overhead.baseStaff) / DAYS_PER_WEEK;
  const laborPerRound = Math.max(
    BALANCE2.variableCosts.laborPerRoundMin,
    BALANCE2.variableCosts.laborPerRoundBase - operatingWorld.staffLevel * BALANCE2.variableCosts.laborPerRoundStaffBonusPerLevel
  );
  const laborVariable = rounds * laborPerRound;
  const consumablesVariable = rounds * BALANCE2.variableCosts.consumablesPerRound;
  const merchantFees = revenue * BALANCE2.variableCosts.merchantFeeRate;
  const waterPolicyCost = season.operations.waterPolicy === "irrigate" ? 95 : season.operations.waterPolicy === "conserve" ? 12 : 42;
  const presentationCost = season.operations.turfPriority === "presentation" ? 65 : season.operations.turfPriority === "recovery" ? 38 : 20;
  const paceOvertime = Object.values(args.pace?.perCourse ?? {}).reduce((sum, metrics) => sum + metrics.overtimeCost, 0);
  const paceCompensation = Object.values(args.pace?.perCourse ?? {}).reduce((sum, metrics) => sum + metrics.compensationCost, 0);
  const paceCosts = paceOvertime + paceCompensation;
  const costsPreTax = staffCost + marketingCost + maintenanceCost + overheadTotal + laborVariable + consumablesVariable + merchantFees + waterPolicyCost + presentationCost;
  const profitPreTax = revenue - costsPreTax;
  const tax = BALANCE2.tax.enabled && profitPreTax > 0 ? profitPreTax * BALANCE2.tax.profitTaxRate : 0;
  const sharedCosts = (costsPreTax + tax + propertySettlement.report.costs) * charter.operatingCostMultiplier;
  const costs = sharedCosts + paceCosts;
  const profit = revenue - costs;
  const totalWeight = operatingCourse.tiles.reduce((acc, t) => acc + (TERRAIN_MAINT_WEIGHT[t] ?? 1), 0);
  const avgWeight = totalWeight / (operatingCourse.tiles.length || 1);
  const priorityWearMultiplier = season.operations.turfPriority === "recovery" ? 0.82 : season.operations.turfPriority === "presentation" ? 0.94 : 1;
  const wear = Math.min(
    BALANCE2.condition.wearCap / DAYS_PER_WEEK,
    rounds / BALANCE2.condition.wearDivisor * avgWeight * seasonalCommit.modifiers.turfWearMultiplier * priorityWearMultiplier
  );
  const waterRecoveryMultiplier = season.operations.waterPolicy === "irrigate" ? seasonalCommit.weather.kind === "heat" || seasonalCommit.weather.kind === "drought" ? 1.35 : 1.08 : season.operations.waterPolicy === "conserve" ? 0.86 : 1;
  const priorityRecoveryMultiplier = season.operations.turfPriority === "recovery" ? 1.22 : season.operations.turfPriority === "presentation" ? 1.08 : 1;
  const maintEffect = Math.min(
    BALANCE2.condition.maintEffectCap / DAYS_PER_WEEK,
    maintenanceCost / BALANCE2.condition.maintEffectDivisor * seasonalCommit.modifiers.turfRecoveryMultiplier * waterRecoveryMultiplier * priorityRecoveryMultiplier
  );
  const nextCondition = clamp01(seasonalCommit.course.condition - wear + maintEffect);
  const nps = rounds > 0 ? (reactions.promoters - reactions.detractors) / rounds : 0;
  const returnBias = (reactions.willReturnRate - 0.5) * 0.5;
  const sentiment = clamp$1(nps + returnBias, -1, 1);
  const dailyRepCap = Math.max(1, BALANCE2.reputation.capPerWeek / DAYS_PER_WEEK);
  const profile = getDifficultyProfile(operatingWorld.difficulty);
  const repAsym = sentiment >= 0 ? profile.repGainMult : profile.repLossMult;
  const m49Evidence = reactions.observations;
  const audienceRepDelta = m49Evidence ? clamp$1(m49ReputationDelta(m49Evidence).delta * repAsym, -dailyRepCap, dailyRepCap) : rounds > 0 ? clamp$1(sentiment * BALANCE2.reputation.npsGain * repAsym, -dailyRepCap, dailyRepCap) : 0;
  const liabilityRep = propertySettlement.report.incidents.reduce((sum, incident) => sum + incident.severity * 0.08, 0);
  const repDelta = (audienceRepDelta + (args.tournamentReputation ?? 0)) * charter.reputationMultiplier - liabilityRep;
  const nextRep = clamp$1(operatingWorld.reputation + repDelta, 0, 100);
  const nextCashRaw = operatingWorld.cash + propertySettlement.report.revenue + hospitalityWeatherAdjustment - costs;
  const bankrupt = hitsLiquidityTrap(nextCashRaw);
  const conditionCourse = { ...operatingCourse, condition: nextCondition };
  const nextWorldBase = {
    ...operatingWorld,
    cash: nextCashRaw,
    reputation: nextRep,
    // The hook replaces this with the seven-day ledger total at Sunday close.
    // Midweek consumers must continue to see the last completed week.
    lastWeekProfit: operatingWorld.lastWeekProfit,
    isBankrupt: operatingWorld.isBankrupt || bankrupt
  };
  const closesWeek = dayIndex != null && dayIndex + 1 >= DAYS_PER_WEEK;
  const historyWorld = recordPaceDay(nextWorldBase, conditionCourse, dayIndex ?? 0, args.pace);
  const objectiveWorld = withEvaluatedObjectives(conditionCourse, historyWorld, {
    rounds,
    profit,
    ...closesWeek ? { weekCompleted: operatingWorld.week } : {}
  });
  const livingClubCommit = advanceLivingClubDay(conditionCourse, objectiveWorld, dayIndex ?? 0);
  const nextCourse = livingClubCommit.course;
  const campaignWorld = advanceCampaign(livingClubCommit.course, livingClubCommit.world);
  const nextWorld = recordM49Observations(campaignWorld, m49Evidence ?? args.observations ?? [], operatingWorld.week);
  const courseEntries = Object.entries(args.perCourse ?? {});
  let allocatedRevenue = 0;
  let allocatedSharedCosts = 0;
  const weightTotal = courseEntries.reduce((sum, [, stats]) => sum + (stats.greenFees || stats.roundsFinished || 1), 0);
  const perCourse = courseEntries.map(([courseId, stats], index) => {
    const last = index === courseEntries.length - 1;
    const weight = (stats.greenFees || stats.roundsFinished || 1) / Math.max(1, weightTotal);
    const courseRevenue = last ? revenue - allocatedRevenue : Math.round(revenue * weight * 100) / 100;
    const paceMetrics = args.pace?.perCourse[courseId];
    const exactPaceCosts = (paceMetrics?.overtimeCost ?? 0) + (paceMetrics?.compensationCost ?? 0);
    const allocated = last ? sharedCosts - allocatedSharedCosts : Math.round(sharedCosts * weight * 100) / 100;
    const courseCosts = allocated + exactPaceCosts;
    allocatedRevenue += courseRevenue;
    allocatedSharedCosts += allocated;
    const layout = layoutById(course, courseId);
    const capacity2 = (layout?.roundLength ?? 9) * 4;
    return {
      courseId,
      courseName: stats.courseName,
      attendance: stats.roundsFinished,
      turnaways: Math.max(0, stats.arrivals - capacity2),
      capacity: capacity2,
      revenue: courseRevenue,
      costs: courseCosts,
      profit: courseRevenue - courseCosts,
      avgSatisfaction: stats.roundsFinished ? stats.satisfactionSum / stats.roundsFinished : 0,
      paceOvertime: paceMetrics?.overtimeCost ?? 0,
      paceCompensation: paceMetrics?.compensationCost ?? 0
    };
  });
  return {
    course: nextCourse,
    world: nextWorld,
    result: {
      dayIndex: 0,
      rounds,
      revenue,
      revenueBreakdown: {
        greenFees: args.greenFees ?? args.revenue,
        concessions: args.concessionRevenue ?? 0,
        tournaments: args.tournamentRevenue ?? 0,
        property: propertySettlement.report.revenue,
        propertyCosts: propertySettlement.report.costs,
        propertyVisitors: propertySettlement.report.visitors,
        paceOvertime,
        paceCompensation,
        byConcession: args.concessionByType ?? {},
        transactions: args.transactions ?? []
      },
      costs,
      profit,
      avgSatisfaction,
      reputationDelta: repDelta,
      conditionDelta: nextCondition - seasonalCommit.course.condition,
      promoters: reactions.promoters,
      detractors: reactions.detractors,
      willReturnRate: reactions.willReturnRate,
      perCourse,
      pace: args.pace,
      weather: {
        kind: seasonalCommit.weather.kind,
        temperatureF: seasonalCommit.weather.temperatureF,
        windMph: seasonalCommit.weather.windMph,
        rainInches: seasonalCommit.weather.rainInches,
        modifiers: seasonalCommit.modifiers
      }
    }
  };
}
function runLiveDaysHeadless(args) {
  let course = args.course;
  let world = args.world;
  let rounds = 0;
  const results = [];
  let live = createLiveState(course, world, 0);
  let ledger = createWeekLedger(world.week);
  for (let day = 0; day < args.days; day++) {
    const dayIndex = day % 7;
    live = createLiveState(course, world, dayIndex);
    let guard = 0;
    while (!live.dayOver) {
      stepLive(live, course, args.stepMinutes ?? 2);
      if (++guard > 1e5) throw new Error(`Live day ${day + 1} did not terminate`);
    }
    rounds += live.roundsFinished;
    const revenue = live.greenFeeCollected + live.concessionCollected;
    const withRevenue = { ...world, cash: world.cash + revenue };
    const committed = commitDay({
      course,
      world: withRevenue,
      revenue,
      greenFees: live.greenFeeCollected,
      concessionRevenue: live.concessionCollected,
      concessionByType: live.concessionByType,
      transactions: live.concessionTransactions,
      perCourse: live.perCourse,
      reactions: roundReactions(live),
      dayIndex,
      pace: live.pace,
      shotTraces: live.golfers.flatMap((golfer2) => golfer2.segments.filter((segment2) => segment2.kind === "flight" && segment2.shot !== "putt").map((segment2) => ({
        golferId: golfer2.id,
        holeId: segment2.holeId,
        holeName: course.holes.find((hole) => hole.id === segment2.holeId)?.name,
        teeSet: golfer2.teeSet,
        shotType: segment2.holeIndex >= 0 && segment2.from.x === (course.holes[segment2.holeIndex]?.tee?.x ?? Number.NaN) && segment2.from.y === (course.holes[segment2.holeIndex]?.tee?.y ?? Number.NaN) ? "drive" : "approach",
        from: segment2.from,
        to: segment2.to
      })))
    });
    ledger = appendDayToLedger(ledger, { ...committed.result, dayIndex });
    const closesWeek = dayIndex === 6;
    const completedWeek = closesWeek ? weekResultFromLedger(ledger) : null;
    course = committed.course;
    world = {
      ...committed.world,
      week: closesWeek ? committed.world.week + 1 : committed.world.week,
      lastWeekProfit: completedWeek?.profit ?? committed.world.lastWeekProfit
    };
    if (closesWeek) ledger = createWeekLedger(world.week);
    results.push({ ...committed.result, dayIndex });
  }
  const nextDayIndex = args.days % 7;
  live = createLiveState(course, world, nextDayIndex);
  return { course, world, live, days: results, rounds };
}
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
[
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
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
function ledgerRevenue(result) {
  const breakdown = result.revenueBreakdown;
  if (!breakdown) return void 0;
  return breakdown.greenFees + breakdown.concessions + (breakdown.tournaments ?? 0) + (breakdown.property ?? 0) + (breakdown.paceOvertime ?? 0) + (breakdown.paceCompensation ?? 0);
}
function conditionReport(course, world, result) {
  const totalWeight = course.tiles.reduce((sum, terrain) => sum + (TERRAIN_MAINT_WEIGHT[terrain] ?? 1), 0);
  const avgWeight = totalWeight / Math.max(1, course.tiles.length);
  const requiredMaintenance = result?.maintenance?.required ?? Math.round(350 + totalWeight * 0.46);
  const maintenanceBudget = result?.maintenance?.budget ?? world.maintenanceBudget;
  const shortfall = result?.maintenance?.shortfall ?? requiredMaintenance - maintenanceBudget;
  const wearPressure = result?.maintenancePressure?.wear ?? clamp(avgWeight / 3.2 * 0.18);
  const recoveryHeadroom = (maintenanceBudget - requiredMaintenance) / Math.max(1, requiredMaintenance);
  const projectedRecovery = clamp(course.condition + recoveryHeadroom * 0.12 - wearPressure * 0.08);
  const zones = /* @__PURE__ */ new Map();
  const halfWidth = Math.max(1, course.width / 2);
  const halfHeight = Math.max(1, course.height / 2);
  course.tiles.forEach((terrain, index) => {
    const x = index % Math.max(1, course.width);
    const y = Math.floor(index / Math.max(1, course.width));
    const zoneId = `${y < halfHeight ? "N" : "S"}${x < halfWidth ? "W" : "E"}`;
    const burden = TERRAIN_MAINT_WEIGHT[terrain] ?? 1;
    const current = zones.get(zoneId) ?? { terrain, tiles: 0, burden: 0 };
    current.tiles += 1;
    current.burden += burden;
    if (burden > (TERRAIN_MAINT_WEIGHT[current.terrain] ?? 1)) current.terrain = terrain;
    zones.set(zoneId, current);
  });
  const hotSpots = [...zones.entries()].map(([zoneId, zone]) => ({
    zoneId,
    terrain: zone.terrain,
    tiles: zone.tiles,
    burden: round(zone.burden / Math.max(1, zone.tiles), 3),
    action: shortfall > 0 ? "Increase maintenance or reduce wear here" : "Keep this zone on the current care plan"
  })).sort((a, b) => b.burden - a.burden).slice(0, 4);
  return {
    overall: clamp(course.condition),
    maintenanceBudget,
    requiredMaintenance,
    shortfall,
    projectedRecovery,
    wearPressure: clamp(wearPressure),
    hotSpots
  };
}
function causeReport(world, courseId) {
  const history = m49CourseHistory(world, courseId);
  if (!history) return [];
  const causes = /* @__PURE__ */ new Map();
  for (const segment2 of Object.values(history.segments)) {
    if (!segment2) continue;
    const willingnessToPay = segment2.willingnessToPay;
    for (const hole of Object.values(segment2.holeEvidence)) {
      for (const [cause, observations] of Object.entries(hole.causes)) {
        const current = causes.get(cause) ?? { observations: 0, weightedSatisfaction: 0, revenueAtRisk: 0 };
        current.observations += observations;
        current.weightedSatisfaction += (hole.averageSatisfaction - 65) * observations;
        current.revenueAtRisk += Math.max(0, (65 - hole.averageSatisfaction) / 35) * willingnessToPay * observations;
        causes.set(cause, current);
      }
    }
  }
  return [...causes.entries()].map(([cause, value]) => ({
    cause,
    observations: value.observations,
    satisfactionDelta: round(value.weightedSatisfaction / Math.max(1, value.observations)),
    revenueAtRisk: round(value.revenueAtRisk)
  })).sort((a, b) => b.observations - a.observations || b.revenueAtRisk - a.revenueAtRisk).slice(0, 6);
}
function buildAlerts(args) {
  const alerts = [];
  const add = (alert) => {
    if (!alerts.some((candidate) => candidate.id === alert.id)) alerts.push(alert);
  };
  if (args.condition.overall < 0.45) {
    add({ id: "condition-critical", severity: "urgent", title: "Course condition is critical", detail: `${Math.round(args.condition.overall * 100)}% condition is suppressing observed value.`, action: "Fund recovery before expanding demand." });
  } else if (args.condition.overall < 0.6) {
    add({ id: "condition-watch", severity: "warning", title: "Course condition needs attention", detail: `${Math.round(args.condition.overall * 100)}% condition is beginning to tax satisfaction.`, action: "Review maintenance before the next busy week." });
  }
  if (args.condition.shortfall > 0) {
    add({ id: "maintenance-shortfall", severity: args.condition.shortfall > args.condition.requiredMaintenance * 0.25 ? "urgent" : "warning", title: "Maintenance is underfunded", detail: `$${Math.round(args.condition.shortfall)} is below this period's estimated requirement.`, action: "Raise the maintenance budget or reduce wear pressure." });
  }
  for (const segment2 of Object.values(args.demand.segments)) {
    if (segment2.evidenceRounds > 0 && segment2.churnRate > 0.58) {
      add({ id: `segment-churn-${segment2.segment}`, severity: "warning", title: `${segment2.segment} golfers are not returning`, detail: `${Math.round(segment2.churnRate * 100)}% estimated churn from observed rounds.`, action: "Inspect this segment's causes before buying more reach." });
    }
  }
  for (const promise of normalizeM49State(args.world.m49).marketingPromises ?? []) {
    if (promise.courseId !== args.demand.courseId || promise.disappointmentRisk < 0.55) continue;
    add({ id: `marketing-promise-${promise.id}`, severity: promise.disappointmentRisk > 0.75 ? "urgent" : "warning", title: "Marketing promise is missing its audience", detail: `${promise.segment} disappointment risk is ${Math.round(promise.disappointmentRisk * 100)}%.`, action: "Repair the facility or soften the claim before spending more." });
  }
  if (args.identity.tournamentFieldFit.championship < 0.45) {
    add({ id: "championship-readiness", severity: "info", title: "Championship field fit is limited", detail: "The current strategic identity is stronger in another market lane.", action: "Use local or regional events until the course earns a stronger championship fit." });
  }
  if (!args.observedRounds) {
    add({ id: "evidence-predicted", severity: "info", title: "Demand is still mostly predicted", detail: "No completed observed rounds have been retained for this course.", action: "Run real rounds before making a major price or marketing decision." });
  }
  return alerts;
}
function buildM49CourseReport(args) {
  const layout = activeCourseLayout(args.course);
  const demand = buildM49DemandPlan(args.course, args.world);
  const history = m49CourseHistory(args.world, layout.id);
  const identity = strategicIdentity(args.course, args.world);
  const condition = conditionReport(args.course, args.world, args.result);
  const observedRounds = history?.observedRounds ?? 0;
  const completedRounds = history?.completedRounds ?? 0;
  const revenue = ledgerRevenue(args.result ?? {});
  const ledgerBalanced = !args.result || revenue === void 0 || Math.abs(revenue - args.result.revenue) < 0.01;
  const alerts = buildAlerts({ course: args.course, world: args.world, demand, condition, identity, observedRounds });
  const warnings = alerts.filter((alert) => alert.severity !== "info").map((alert) => alert.detail);
  const segmentCount = demand.supportedSegments.length;
  return {
    courseId: layout.id,
    courseName: layout.name,
    generatedAtWeek: args.generatedAtWeek ?? args.world.week,
    demand,
    observedRounds,
    completedRounds,
    topCauses: causeReport(args.world, layout.id),
    condition,
    alerts,
    reconciliation: {
      ledgerBalanced,
      observedEvidenceRounds: completedRounds,
      authoritativeCondition: args.course.condition
    },
    headline: segmentCount ? `${segmentCount} segment${segmentCount === 1 ? "" : "s"} currently fit this course.` : "No segment currently has a strong course fit.",
    warnings
  };
}
function certificationCourse() {
  const base = createM47CertificationCourse(9);
  const holeIds = base.holes.map((hole) => hole.id);
  return {
    ...base,
    name: "M49 Ethos Loop Certification Course",
    baseGreenFee: 92,
    layouts: [{ id: "m49-cert-course", name: "M49 Ethos Loop", draftHoleIds: holeIds, publishedHoleIds: holeIds, roundLength: 9, state: "open", greenFee: 92 }],
    activeCourseId: "m49-cert-course"
  };
}
function openVariant(course) {
  return { ...course, tiles: course.tiles.map((terrain) => terrain === "water" ? "fairway" : terrain) };
}
function observation(overrides = {}) {
  return {
    version: 1,
    id: "m49-cert-observation",
    courseId: "m49-cert-course",
    segment: "casual",
    completed: true,
    holesPlayed: 9,
    holesTotal: 9,
    expectedScore: 36,
    actualScore: 35,
    satisfaction: 82,
    condition: 0.88,
    greenFee: 92,
    strategicFit: 0.76,
    valueReceived: 0.78,
    willingnessToPay: 72,
    priceElasticity: 1.2,
    returnIntent: true,
    recommend: true,
    churnRisk: 0.16,
    paceDelayMinutes: 3,
    hospitalityDelayMinutes: 0,
    holeEvidence: [],
    causes: [],
    ...overrides
  };
}
function sampleWeekResult(revenue) {
  return {
    visitors: 12,
    revenue,
    revenueBreakdown: { greenFees: revenue, concessions: 0, byConcession: {}, transactions: [] },
    costs: 700,
    profit: revenue - 700,
    maintenance: { required: 1100, budget: 900, shortfall: 200 },
    maintenancePressure: { totalWeight: 1e3, avgWeight: 1.2, wear: 0.12 },
    avgSatisfaction: 78,
    reputationDelta: 0.2,
    visitorNoise: 0
  };
}
function liveSaveFixture(course, world) {
  const live = createLiveState(course, world, 0);
  let guard = 0;
  while (!live.observedRounds?.length && guard++ < 2e4) stepLive(live, course, 5);
  if (!live.observedRounds?.length) throw new Error("M49 live fixture did not finish an observed round");
  const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 0, speed: "paused", selectedGolferId: null });
  const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot)));
  if (!restored) throw new Error("M49 live fixture did not restore");
  const restoredSnapshot = snapshotLiveSimulation({ state: restored.state, pendingCash: restored.pendingCash, speed: restored.speed, selectedGolferId: restored.selectedGolferId, clockRemainderMinutes: restored.clockRemainderMinutes, weekLedger: restored.weekLedger });
  return {
    deterministic: hashGameState({ course, world, live: snapshot }) === hashGameState({ course, world, live: restoredSnapshot }),
    saveBytes: new TextEncoder().encode(JSON.stringify(snapshot)).byteLength,
    observedRounds: live.observedRounds.length
  };
}
function runM49Certification() {
  const seed = 490497;
  const course = certificationCourse();
  const world = { ...DEFAULT_WORLD, runSeed: seed, cash: 1e6, maintenanceBudget: 900, reputation: 74 };
  const plan = buildM49DemandPlan(course, world);
  const secondPlan = buildM49DemandPlan(course, world);
  const openPlan = buildM49DemandPlan(openVariant(course), world);
  const marketing = launchM49Marketing({ course, world: { ...world, marketingLevel: 5 }, segment: "casual", strength: "championship" });
  if (!marketing.ok) throw new Error(`M49 marketing fixture failed: ${marketing.reason}`);
  const supportedMarketing = launchM49Marketing({ course, world: { ...world, marketingLevel: 5 }, segment: "casual", strength: "casual" });
  if (!supportedMarketing.ok) throw new Error(`M49 supported marketing fixture failed: ${supportedMarketing.reason}`);
  const liveDays = 7;
  const live = runLiveDaysHeadless({ course, world, days: liveDays, stepMinutes: 5 });
  const history = m49CourseHistory(live.world, activeCourseLayout(course).id);
  const isolatedWorld = recordM49Observations(recordM49Observations(world, [observation()], world.week), [observation({ courseId: "m49-cert-other", id: "m49-cert-other-observation" })], world.week);
  const isolatedA = m49CourseHistory(isolatedWorld, "m49-cert-course");
  const isolatedB = m49CourseHistory(isolatedWorld, "m49-cert-other");
  const save = liveSaveFixture(course, world);
  const report2 = buildM49CourseReport({ course: live.course, world: live.world, result: sampleWeekResult(1104), generatedAtWeek: live.world.week });
  const noPlayReputation = m49ReputationDelta([]);
  const lowConditionReport = buildM49CourseReport({ course: { ...course, condition: 0.4 }, world, result: sampleWeekResult(1104) });
  const checks = [
    { id: "demand-determinism", passed: hashCanonicalValue(plan) === hashCanonicalValue(secondPlan), detail: "The same course, world, and seed produce the same six-segment demand plan." },
    { id: "segment-price-response", passed: Object.keys(plan.segments).length === 6 && plan.segments.casual.priceElasticity > plan.segments.pro.priceElasticity, detail: "All six segments expose differentiated willingness to pay and price elasticity." },
    { id: "safe-route-vs-hazard", passed: plan.segments.casual.bookingAppeal < openPlan.segments.casual.bookingAppeal && plan.supportedSegments.length > 0, detail: "Shared hazard pressure lowers casual appeal while a coherent course still retains supported demand." },
    { id: "truthful-marketing", passed: marketing.promise.cost > supportedMarketing.promise.cost && marketing.promise.credibility < supportedMarketing.promise.credibility && marketing.promise.disappointmentRisk > supportedMarketing.promise.disappointmentRisk, detail: "Unsupported promises cost more and begin with lower credibility and higher disappointment risk." },
    { id: "observed-evidence", passed: live.rounds > 0 && (history?.observedRounds ?? 0) > 0 && (history?.completedRounds ?? 0) > 0, detail: `${live.rounds} live rounds became bounded per-course observed evidence over ${liveDays} days.` },
    { id: "no-play-reputation", passed: noPlayReputation.delta === 0 && noPlayReputation.observedRounds === 0, detail: "No-play and incomplete evidence cannot create a reputation move." },
    { id: "multi-course-isolation", passed: isolatedA?.observedRounds === 1 && isolatedB?.observedRounds === 1, detail: "Observed history keys by course and does not bleed between layouts." },
    { id: "save-migration", passed: save.deterministic && save.observedRounds > 0, detail: `Active live evidence survives save/reload deterministically (${save.saveBytes} bytes).` },
    { id: "report-reconciliation", passed: report2.reconciliation.ledgerBalanced && report2.reconciliation.authoritativeCondition === live.course.condition, detail: "Management reporting reconciles the supplied revenue ledger and reads current course condition as authoritative." },
    { id: "actionable-alerts", passed: lowConditionReport.alerts.some((alert) => alert.id === "condition-critical") && new Set(lowConditionReport.alerts.map((alert) => alert.id)).size === lowConditionReport.alerts.length, detail: "Low condition produces a prioritized actionable alert with deduplicated IDs." }
  ];
  return {
    version: 1,
    fixture: { courseId: activeCourseLayout(course).id, courseName: course.name, holes: course.holes.length, seed },
    checks,
    metrics: {
      liveDays,
      liveRounds: live.rounds,
      observedRounds: history?.observedRounds ?? 0,
      completedObservedRounds: history?.completedRounds ?? 0,
      segments: Object.keys(plan.segments).length,
      supportedSegments: plan.supportedSegments.length,
      demandHash: hashCanonicalValue(plan),
      saveBytes: save.saveBytes
    },
    passed: checks.every((check) => check.passed)
  };
}
const report = runM49Certification();
const output = new URL("../artifacts/m49/certification.json", import.meta.url);
mkdirSync(new URL("../artifacts/m49", import.meta.url), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}
`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
