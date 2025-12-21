import type { Course, Hole, Obstacle, Point, Terrain } from "../models/types";
import { findBestPlayablePath } from "../sim/pathfind";
import { sampleLine, scoreHole } from "../sim/holes";
import { TERRAIN_BUILD_COST, TERRAIN_SALVAGE_VALUE } from "../models/terrainEconomics";

export interface HoleIssue {
  severity: "info" | "warn" | "bad";
  code: string;
  title: string;
  detail: string;
  suggestedFixes: string[];
  // Metadata for enhanced warnings
  metadata?: {
    currentValue?: number;
    targetValue?: number;
    costEstimate?: number;
    failingSegments?: Point[]; // Corridor points where terrain != fairway
  };
}

export interface HoleEvaluation {
  scratchShotsToGreen: number;
  bogeyShotsToGreen: number;
  autoPar: 3 | 4 | 5;
  reachableInTwo: boolean;
  effectiveDistanceYards: number;
  issues: HoleIssue[];
}

// Configurable thresholds (from prompt defaults)
const CONFIG = {
  paddingTiles: 16,
  zoom: 3.0,
  minHoleYardsWarn: 60,
  minHoleYardsBad: 40,
  forcedCarryBadYards: 170,
  earlyWaterWarnStartYards: 80,
  layupBandStart: 0.55,
  layupBandEnd: 0.70,
  layupRadiusTiles: 3,
  safeLayupWarnPct: 0.60,
  safeLayupBadPct: 0.35,
  hazardDensityWarnPct: 0.30,
  fairwayCoverageWarnPct: 0.35,
  greenApproachRadiusTiles: 3,
  doglegTurnInfoDeg: 35,
};

function tileAt(course: Course, p: Point): Terrain | null {
  if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return null;
  return course.tiles[p.y * course.width + p.x];
}

function inBounds(course: Course, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
}

function distYards(course: Course, a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const tiles = Math.sqrt(dx * dx + dy * dy);
  return tiles * course.yardsPerTile;
}

function getCorridorBufferTiles(distanceYards: number): number {
  // Simple: short holes get 2 tiles, long holes get 3-4
  if (distanceYards < 200) return 2;
  if (distanceYards < 350) return 3;
  return 4;
}

function pointsInCircle(center: Point, radiusTiles: number, course: Course): Point[] {
  const pts: Point[] = [];
  const r2 = radiusTiles * radiusTiles;
  for (let dy = -Math.ceil(radiusTiles); dy <= Math.ceil(radiusTiles); dy++) {
    for (let dx = -Math.ceil(radiusTiles); dx <= Math.ceil(radiusTiles); dx++) {
      if (dx * dx + dy * dy <= r2) {
        const pt = { x: center.x + dx, y: center.y + dy };
        if (inBounds(course, pt)) pts.push(pt);
      }
    }
  }
  return pts;
}

function isHazard(terrain: Terrain | null): boolean {
  return terrain === "water" || terrain === "sand" || terrain === "deep_rough";
}

function isSafe(terrain: Terrain | null): boolean {
  return terrain === "fairway" || terrain === "rough";
}

function obstacleAt(obstacles: Obstacle[], x: number, y: number): Obstacle | null {
  return obstacles.find((o) => o.x === x && o.y === y) ?? null;
}

function findWalkableRoute(course: Course, tee: Point, green: Point): Point[] | null {
  const result = findBestPlayablePath(course, tee, green);
  return result?.path ?? null;
}

function findContiguousWaterAlongLine(
  course: Course,
  line: Point[],
  bufferTiles: number
): { maxWaterLengthYards: number; waterStartYards: number | null } {
  let maxWaterLengthYards = 0;
  let waterStartYards: number | null = null;
  let currentWaterStartIdx: number | null = null;
  let currentWaterLengthTiles = 0;

  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const terrain = tileAt(course, p);
    const isWater = terrain === "water";

    // Check buffer around point too
    let hasWater = isWater;
    if (!hasWater && bufferTiles > 0) {
      for (let dy = -bufferTiles; dy <= bufferTiles; dy++) {
        for (let dx = -bufferTiles; dx <= bufferTiles; dx++) {
          if (dx * dx + dy * dy <= bufferTiles * bufferTiles) {
            const q = { x: p.x + dx, y: p.y + dy };
            if (tileAt(course, q) === "water") {
              hasWater = true;
              break;
            }
          }
          if (hasWater) break;
        }
      }
    }

    if (hasWater) {
      if (currentWaterStartIdx === null) {
        currentWaterStartIdx = i;
      }
      currentWaterLengthTiles += 1;
    } else {
      if (currentWaterStartIdx !== null) {
        const waterLengthYards = currentWaterLengthTiles * course.yardsPerTile;
        if (waterLengthYards > maxWaterLengthYards) {
          maxWaterLengthYards = waterLengthYards;
          const startP = line[currentWaterStartIdx];
          waterStartYards = distYards(course, line[0], startP);
        }
        currentWaterStartIdx = null;
        currentWaterLengthTiles = 0;
      }
    }
  }

  // Handle water that extends to the end
  if (currentWaterStartIdx !== null) {
    const waterLengthYards = currentWaterLengthTiles * course.yardsPerTile;
    if (waterLengthYards > maxWaterLengthYards) {
      maxWaterLengthYards = waterLengthYards;
      const startP = line[currentWaterStartIdx];
      waterStartYards = distYards(course, line[0], startP);
    }
  }

  return { maxWaterLengthYards, waterStartYards };
}

export function evaluateHole(course: Course, hole: Hole, holeIndex: number): HoleEvaluation {
  const issues: HoleIssue[] = [];

  // Use existing scoring function for shot calculations
  const score = scoreHole(course, hole, holeIndex);

  // Rule 1: MISSING_MARKERS
  if (!hole.tee || !hole.green) {
    issues.push({
      severity: "bad",
      code: "MISSING_MARKERS",
      title: "Missing Hole Markers",
      detail: hole.tee ? "Green marker is missing" : hole.green ? "Tee marker is missing" : "Both tee and green markers are missing",
      suggestedFixes: hole.tee ? ["Place green/pin marker"] : hole.green ? ["Place tee marker"] : ["Place tee marker", "Place green/pin marker"],
    });
      return {
        scratchShotsToGreen: score.scratchShotsToGreen,
        bogeyShotsToGreen: score.bogeyShotsToGreen,
        autoPar: score.autoPar as 3 | 4 | 5,
        reachableInTwo: score.reachableInTwo,
        effectiveDistanceYards: score.effectiveDistance * course.yardsPerTile,
        issues,
      };
    }

    const tee = hole.tee;
  const green = hole.green;
  const straightDistYards = distYards(course, tee, green);

  // Rule 2: TOO_SHORT
  if (straightDistYards < CONFIG.minHoleYardsBad) {
    issues.push({
      severity: "bad",
      code: "TOO_SHORT",
      title: "Hole Too Short",
      detail: `Distance is ${straightDistYards.toFixed(0)} yards, minimum is ${CONFIG.minHoleYardsBad} yards`,
      suggestedFixes: ["Move tee farther from green"],
    });
  } else if (straightDistYards < CONFIG.minHoleYardsWarn) {
    issues.push({
      severity: "warn",
      code: "TOO_SHORT",
      title: "Hole Very Short",
      detail: `Distance is ${straightDistYards.toFixed(0)} yards, recommended minimum is ${CONFIG.minHoleYardsWarn} yards`,
      suggestedFixes: ["Move tee farther from green"],
    });
  }

  // Get corridor line and buffer
  const corridorLine = sampleLine(tee, green, 50); // Sample more points for better analysis
  const bufferTiles = getCorridorBufferTiles(straightDistYards);

  // Rule 3: BLOCKED_ROUTE
  const walkableRoute = findWalkableRoute(course, tee, green);
  if (!walkableRoute) {
    issues.push({
      severity: "bad",
      code: "BLOCKED_ROUTE",
      title: "No Walkable Route",
      detail: "No path exists from tee to green without crossing water",
      suggestedFixes: ["Add land bridge", "Move hazards", "Add alternate fairway"],
    });
  }

  // Check if corridor is dominated by water
  const waterCount = corridorLine.filter((p) => tileAt(course, p) === "water").length;
  const waterFrac = waterCount / corridorLine.length;
  if (walkableRoute && waterFrac > 0.6) {
    issues.push({
      severity: "bad",
      code: "BLOCKED_ROUTE",
      title: "Corridor Dominated by Water",
      detail: "The direct line from tee to green is mostly water",
      suggestedFixes: ["Add land bridge", "Move hazards", "Add alternate fairway"],
    });
  }

  // Rule 4: FORCED_CARRY_OVER_WATER
  const waterAnalysis = findContiguousWaterAlongLine(course, corridorLine, bufferTiles);
  if (waterAnalysis.maxWaterLengthYards > CONFIG.forcedCarryBadYards) {
    issues.push({
      severity: "bad",
      code: "FORCED_CARRY_OVER_WATER",
      title: "Forced Water Carry Too Long",
      detail: `Water crossing requires ${waterAnalysis.maxWaterLengthYards.toFixed(0)} yard carry`,
      suggestedFixes: ["Add layup fairway before water", "Narrow water crossing", "Move water later"],
    });
  } else if (waterAnalysis.maxWaterLengthYards > CONFIG.forcedCarryBadYards * 0.7) {
    issues.push({
      severity: "warn",
      code: "FORCED_CARRY_OVER_WATER",
      title: "Long Water Carry",
      detail: `Water crossing requires ${waterAnalysis.maxWaterLengthYards.toFixed(0)} yard carry`,
      suggestedFixes: ["Add layup fairway before water", "Narrow water crossing"],
    });
  }

  if (waterAnalysis.waterStartYards !== null && waterAnalysis.waterStartYards < CONFIG.earlyWaterWarnStartYards) {
    issues.push({
      severity: "warn",
      code: "FORCED_CARRY_OVER_WATER",
      title: "Water Too Early",
      detail: `Water begins ${waterAnalysis.waterStartYards.toFixed(0)} yards from tee`,
      suggestedFixes: ["Add layup fairway before water", "Move water later"],
    });
  }

  // Rule 5: NO_SAFE_LAYUP_ZONE
  const layupDistRatio = (CONFIG.layupBandStart + CONFIG.layupBandEnd) / 2;
  const layupPoint: Point = {
    x: Math.round(tee.x + (green.x - tee.x) * layupDistRatio),
    y: Math.round(tee.y + (green.y - tee.y) * layupDistRatio),
  };
  const layupZoneTiles = pointsInCircle(layupPoint, CONFIG.layupRadiusTiles, course);
  const safeTiles = layupZoneTiles.filter((p) => isSafe(tileAt(course, p))).length;
  const safePct = layupZoneTiles.length > 0 ? safeTiles / layupZoneTiles.length : 0;

  if (safePct < CONFIG.safeLayupBadPct) {
    issues.push({
      severity: "bad",
      code: "NO_SAFE_LAYUP_ZONE",
      title: "No Safe Layup Zone",
      detail: `Only ${(safePct * 100).toFixed(0)}% of layup zone is safe to land`,
      suggestedFixes: ["Widen fairway at layup distance", "Reduce hazards near layup zone"],
    });
  } else if (safePct < CONFIG.safeLayupWarnPct) {
    issues.push({
      severity: "warn",
      code: "NO_SAFE_LAYUP_ZONE",
      title: "Limited Layup Zone",
      detail: `Only ${(safePct * 100).toFixed(0)}% of layup zone is safe to land`,
      suggestedFixes: ["Widen fairway at layup distance", "Reduce hazards near layup zone"],
    });
  }

  // Rule 6: LANDING_ZONE_TOO_PUNISHING
  const band1Start = 0.35;
  const band1End = 0.50;
  const band2Start = 0.55;
  const band2End = 0.75;

    for (const [bandStart, bandEnd, bandName] of [
    [band1Start, band1End, "first"],
    [band2Start, band2End, "second"],
  ] as const) {
    const bandPts = corridorLine.filter((_p, i) => {
      const t = i / (corridorLine.length - 1);
      return t >= bandStart && t <= bandEnd;
    });

    let hazardCount = 0;
    for (const p of bandPts) {
      const terrain = tileAt(course, p);
      if (isHazard(terrain)) hazardCount++;
      // Also check obstacles
      const obstacle = obstacleAt(course.obstacles ?? [], p.x, p.y);
      if (obstacle && obstacle.type === "tree") hazardCount += 0.5; // Trees count as partial hazard
    }

    const hazardDensity = bandPts.length > 0 ? hazardCount / bandPts.length : 0;

    if (hazardDensity > CONFIG.hazardDensityWarnPct) {
      issues.push({
        severity: "warn",
        code: "LANDING_ZONE_TOO_PUNISHING",
        title: `High Hazard Density in ${bandName} Landing Zone`,
        detail: `${(hazardDensity * 100).toFixed(0)}% hazard density in typical landing area`,
        suggestedFixes: ["Move bunkers off main landing", "Add bailout rough/fairway"],
      });
    }
  }

  // Rule 7: FAIRWAY_CONTINUITY
  const sampleEvery = Math.max(1, Math.floor(corridorLine.length / 20));
  const sampledPts = corridorLine.filter((_, i) => i % sampleEvery === 0);
  const fairwayCount = sampledPts.filter((p) => tileAt(course, p) === "fairway").length;
  const fairwayPct = sampledPts.length > 0 ? fairwayCount / sampledPts.length : 0;

  if (fairwayPct < CONFIG.fairwayCoverageWarnPct) {
    // Find failing corridor segments (non-fairway tiles in corridor)
    const failingSegments: Point[] = [];
    for (const p of corridorLine) {
      const terrain = tileAt(course, p);
      if (terrain !== "fairway" && terrain !== null) {
        failingSegments.push(p);
      }
    }

    // Estimate cost: assume converting non-fairway corridor tiles to fairway
    // Use a simplified estimate: count failing tiles and use average cost
    let costEstimate = 0;
    for (const p of failingSegments) {
      const terrain = tileAt(course, p);
      if (terrain && terrain !== "fairway") {
        // Estimate: build cost of fairway minus salvage of current terrain
        const buildCost = TERRAIN_BUILD_COST.fairway;
        const salvage = TERRAIN_SALVAGE_VALUE[terrain] ?? 0;
        costEstimate += Math.max(0, buildCost - salvage);
      }
    }

    issues.push({
      severity: "warn",
      code: "FAIRWAY_CONTINUITY",
      title: "Insufficient Fairway Coverage",
      detail: `Only ${(fairwayPct * 100).toFixed(0)}% of corridor is fairway (target: ${(CONFIG.fairwayCoverageWarnPct * 100).toFixed(0)}%)`,
      suggestedFixes: [
        "Paint fairway along centerline",
        "Increase fairway width +5y",
        "Increase fairway width +10y",
      ],
      metadata: {
        currentValue: fairwayPct,
        targetValue: CONFIG.fairwayCoverageWarnPct,
        costEstimate: Math.ceil(costEstimate),
        failingSegments,
      },
    });
  }

  // Rule 8: GREEN_APPROACH_TOO_TIGHT
  const greenApproachTiles = pointsInCircle(green, CONFIG.greenApproachRadiusTiles, course);
  const safeApproachTiles = greenApproachTiles.filter((p) => {
    const terrain = tileAt(course, p);
    return terrain !== "water" && terrain !== "deep_rough";
  }).length;
  const safeApproachPct = greenApproachTiles.length > 0 ? safeApproachTiles / greenApproachTiles.length : 0;

  if (safeApproachPct < 0.5) {
    issues.push({
      severity: "bad",
      code: "GREEN_APPROACH_TOO_TIGHT",
      title: "Green Approach Too Tight",
      detail: `Only ${(safeApproachPct * 100).toFixed(0)}% safe approach area around green`,
      suggestedFixes: ["Add apron/rough around green", "Move water away from green edge"],
    });
  } else if (safeApproachPct < 0.65) {
    issues.push({
      severity: "warn",
      code: "GREEN_APPROACH_TOO_TIGHT",
      title: "Tight Green Approach",
      detail: `Only ${(safeApproachPct * 100).toFixed(0)}% safe approach area around green`,
      suggestedFixes: ["Add apron/rough around green", "Move water away from green edge"],
    });
  }

  // Rule 9: DOGLEG_INDICATOR
  if (walkableRoute && walkableRoute.length > 2) {
    // Compute total turning angle
    let totalTurn = 0;
    for (let i = 1; i < walkableRoute.length - 1; i++) {
      const p1 = walkableRoute[i - 1];
      const p2 = walkableRoute[i];
      const p3 = walkableRoute[i + 1];
      const a1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const a2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
      let turn = Math.abs(a2 - a1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      totalTurn += turn * (180 / Math.PI);
    }

    if (totalTurn > CONFIG.doglegTurnInfoDeg) {
      issues.push({
        severity: "info",
        code: "DOGLEG_INDICATOR",
        title: "Dogleg Hole",
        detail: `Hole has significant turns (${totalTurn.toFixed(0)}° total)`,
        suggestedFixes: ["Ensure landing zone at corner", "Widen fairway at turn"],
      });

      // If dogleg increases par significantly, upgrade to warn
      if (score.scratchShotsToGreen > 4.5 && totalTurn > CONFIG.doglegTurnInfoDeg * 1.5) {
        issues[issues.length - 1].severity = "warn";
      }
    }
  }

  return {
    scratchShotsToGreen: score.scratchShotsToGreen,
    bogeyShotsToGreen: score.bogeyShotsToGreen,
    autoPar: score.autoPar as 3 | 4 | 5,
    reachableInTwo: score.reachableInTwo,
    effectiveDistanceYards: score.effectiveDistance * course.yardsPerTile,
    issues,
  };
}

