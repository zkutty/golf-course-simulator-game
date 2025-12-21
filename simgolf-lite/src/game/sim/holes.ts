import type { Course, Hole, Obstacle, Point, Terrain } from "../models/types";
import { computeHoleDistanceTiles, computePathDistanceTiles } from "./holeMetrics";
import { BALANCE } from "../balance/balanceConfig";
import { getGolferProfile } from "./golferProfiles";
import type { ShotPlanStep } from "./shots/solveShotsToGreen";
import { solveShotsToGreen } from "./shots/solveShotsToGreen";

export interface HoleScore {
  holeIndex: number;
  isComplete: boolean;
  isValid: boolean;
  par: number;
  autoPar: number;
  scratchShotsToGreen: number; // expected strokes to reach green (ex-putting)
  bogeyShotsToGreen: number;
  reachableInTwo: boolean;
  straightDistance: number; // tiles (euclidean)
  effectiveDistance: number; // tiles (path length)
  path: Point[]; // visualization polyline (shot plan sampled points)
  shotPlan: ShotPlanStep[];
  playabilityScore: number; // 0..100
  difficultyScore: number; // 0..100
  aestheticsScore: number; // 0..100
  overallHoleScore: number; // 0..100
  corridor: {
    samples: number;
    fairway: number;
    rough: number;
    deep_rough: number;
    sand: number;
    water: number;
    green: number;
    tee: number;
    path: number;
  };
  score: number; // alias for overallHoleScore (0..100)
  layoutIssues: string[];
  issues: string[]; // includes layout + quality warnings
}

export interface CourseHoleSummary {
  holes: HoleScore[];
  holeQualityAvg: number; // 0..100
  variety: number; // 0..100
  globalBonus: number; // -10..+10-ish
  courseQuality: number; // 0..100
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function dist(a: Point, b: Point) {
  return computeHoleDistanceTiles(a, b);
}

function deriveAutoParFromShots(shotsToGreen: number): 3 | 4 | 5 {
  const p = Math.round(shotsToGreen + 2);
  return clamp(p, 3, 5) as 3 | 4 | 5;
}

function inBounds(course: Course, p: Point) {
  return p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
}

export function tileAt(course: Course, p: Point): Terrain {
  return course.tiles[p.y * course.width + p.x];
}

export function sampleLine(a: Point, b: Point, samples = 13): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    pts.push({
      x: Math.round(a.x + (b.x - a.x) * t),
      y: Math.round(a.y + (b.y - a.y) * t),
    });
  }
  // Deduplicate
  const seen = new Set<string>();
  return pts.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function scoreHole(course: Course, hole: Hole, holeIndex: number): HoleScore {
  const issues: string[] = [];
  if (!hole.tee || !hole.green) {
    const par = hole.parMode === "MANUAL" ? (hole.parManual ?? 4) : 4;
    return {
      holeIndex,
      isComplete: false,
      isValid: false,
      par,
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
        water: 0,
        green: 0,
        tee: 0,
        path: 0,
      },
      score: 0,
      layoutIssues: ["Missing tee/green placement"],
      issues: ["Missing tee/green placement"],
    };
  }

  const tee = hole.tee;
  const green = hole.green;

  const layoutIssues: string[] = [];
  if (!inBounds(course, tee)) issues.push("Tee is out of bounds");
  if (!inBounds(course, green)) issues.push("Green is out of bounds");
  if (tee.x === green.x && tee.y === green.y) issues.push("Tee and green overlap");
  for (const msg of issues) layoutIssues.push(msg);

  const straightDistance = dist(tee, green);
  const scratch = getGolferProfile("SCRATCH", course);
  const bogey = getGolferProfile("BOGEY", course);
  const scratchSolve = solveShotsToGreen({ course, tee, green, golfer: scratch });
  const bogeySolve = solveShotsToGreen({ course, tee, green, golfer: bogey });

  const scratchShotsToGreen = scratchSolve.expectedShotsToGreen;
  const bogeyShotsToGreen = bogeySolve.expectedShotsToGreen;
  const reachable = scratchSolve.reachable;

  const minDistOk = straightDistance * scratch.yardsPerTile >= BALANCE.shots.hole.minHoleDistanceYards;
  const maxOk = reachable && scratchShotsToGreen <= BALANCE.shots.water.maxExpectedShotsToGreen;

  const autoPar = reachable ? deriveAutoParFromShots(scratchShotsToGreen) : 4;
  const par = hole.parMode === "MANUAL" ? (hole.parManual ?? autoPar) : autoPar;
  const reachableInTwo =
    reachable && scratchShotsToGreen <= BALANCE.shots.hole.reachableInTwoThreshold;

  if (!minDistOk) issues.push("Hole too short (tee too close to green)");
  if (!reachable) issues.push("Green unreachable with club-based shot planning");
  if (reachable && !maxOk) issues.push("Routing is too costly (forced penalties / no safe layup)");

  const shotPlan = scratchSolve.plan;
  const poly: Point[] = [];
  for (const s of shotPlan) {
    const pts = sampleLine(s.from, s.to, 9);
    for (const p of pts) {
      if (poly.length === 0) poly.push(p);
      else {
        const last = poly[poly.length - 1];
        if (last.x !== p.x || last.y !== p.y) poly.push(p);
      }
    }
  }
  if (poly.length === 0) poly.push(tee, green);
  const effectiveDistance = computePathDistanceTiles(poly);

  const teeTile = inBounds(course, tee) ? tileAt(course, tee) : "rough";
  const greenTile = inBounds(course, green) ? tileAt(course, green) : "rough";
  if (teeTile === "water" || teeTile === "sand") issues.push("Tee on hazard");
  if (greenTile === "water" || greenTile === "sand") issues.push("Green on hazard");

  // Evaluate "corridor" along the chosen shot plan polyline.
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
      water: 0,
      green: 0,
      tee: 0,
      path: 0,
    }
  );

  const s = corridorCounts.samples || 1;
  const waterFrac = corridorCounts.water / s;
  const sandFrac = corridorCounts.sand / s;
  const fairwayFrac = corridorCounts.fairway / s;
  const roughFrac = corridorCounts.rough / s;
  const deepRoughFrac = corridorCounts.deep_rough / s;
  const pathFrac = corridorCounts.path / s;
  const onHazardFrac = waterFrac + sandFrac;
  const onBadLieFrac = roughFrac + deepRoughFrac + onHazardFrac;

  if (waterFrac > 0.25) issues.push("Lots of water on main line");
  if (roughFrac > 0.7) issues.push("Mostly rough on main line");
  if (deepRoughFrac > 0.25) issues.push("Deep rough dominates the main line");

  // "Near corridor" sampling (3x3 around each on-line point) for aesthetics.
  const nearCounts = pts.reduce(
    (acc, p) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (!inBounds(course, q)) continue;
          // exclude on-line points; we already track hazards directly on the line separately
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
      water: 0,
      green: 0,
      tee: 0,
      path: 0,
    }
  );
  const ns = nearCounts.samples || 1;
  const nearWaterFrac = nearCounts.water / ns;
  const nearSandFrac = nearCounts.sand / ns;
  const nearDeepRoughFrac = nearCounts.deep_rough / ns;

  // Obstacle influence relative to corridor points
  const obstacleStats = scoreObstaclesAgainstCorridor(course.obstacles ?? [], pts);

  // Per-hole ratings (0..100)
  // Playability: reward fairway/path; penalize rough/hazards on the main line; harsh penalties for hazards at endpoints.
  let playabilityScore =
    90 +
    35 * fairwayFrac +
    10 * pathFrac -
    70 * roughFrac -
    120 * deepRoughFrac -
    130 * waterFrac -
    55 * sandFrac;
  if (teeTile === "water" || teeTile === "sand") playabilityScore -= 25;
  if (greenTile === "water" || greenTile === "sand") playabilityScore -= 25;
  // Obstacles on/near the line reduce playability (trees more than bushes)
  playabilityScore -= 20 * obstacleStats.treeOnLine;
  playabilityScore -= 10 * obstacleStats.bushOnLine;
  playabilityScore -= 10 * obstacleStats.treeNear;
  playabilityScore -= 5 * obstacleStats.bushNear;
  playabilityScore = clamp(playabilityScore, 0, 100);

  // Difficulty: hazards, distance, and expected shots increase it (higher = harder).
  const distNorm = clamp(effectiveDistance / 40, 0, 1); // 40 tiles ~= "long"
  const shotsNorm = reachable ? clamp((scratchShotsToGreen - 2) / 3, 0, 1) : 1;
  let difficultyScore =
    20 +
    65 * (0.85 * waterFrac + 0.55 * sandFrac + 0.25 * roughFrac + 0.45 * deepRoughFrac) +
    28 * distNorm +
    38 * shotsNorm;
  if (teeTile === "water" || teeTile === "sand") difficultyScore += 10;
  if (greenTile === "water" || greenTile === "sand") difficultyScore += 10;
  // Obstacles near/on the corridor raise difficulty (trees more than bushes)
  difficultyScore += 12 * obstacleStats.treeOnLine;
  difficultyScore += 6 * obstacleStats.bushOnLine;
  difficultyScore += 6 * obstacleStats.treeNear;
  difficultyScore += 3 * obstacleStats.bushNear;
  difficultyScore = clamp(difficultyScore, 0, 100);

  // Aesthetics: reward "scenic" hazards near the corridor, but penalize hazards directly on it.
  let aestheticsScore =
    55 +
    75 * (nearWaterFrac + 0.6 * nearSandFrac) -
    120 * (waterFrac + 0.6 * sandFrac);
  // A small bonus for some contrast, but don't reward excessive hazards.
  aestheticsScore += 10 * clamp(nearWaterFrac, 0, 0.12) / 0.12;
  // Deep rough is visually noisy if overused; allow small amounts without penalty.
  aestheticsScore -= 35 * clamp(nearDeepRoughFrac - 0.12, 0, 1);
  // Obstacles: off/near corridor can look nice, but too many becomes clutter.
  aestheticsScore += 4 * obstacleStats.treeScenic + 3 * obstacleStats.bushScenic;
  aestheticsScore += 1 * obstacleStats.treeOff + 0.5 * obstacleStats.bushOff;
  aestheticsScore -= 12 * obstacleStats.treeOnLine + 6 * obstacleStats.bushOnLine;
  const obstacleTotal = obstacleStats.total;
  if (obstacleTotal > 22) aestheticsScore -= 2 * (obstacleTotal - 22);
  aestheticsScore = clamp(aestheticsScore, 0, 100);

  // Overall: weighted towards playability, then aesthetics, and lightly penalize excessive difficulty.
  let overallHoleScore = 0.6 * playabilityScore + 0.25 * aestheticsScore + 0.15 * (100 - difficultyScore);
  // Extra penalty if corridor is mostly hazards.
  overallHoleScore -= 30 * clamp(onHazardFrac - 0.25, 0, 1);
  // Extra penalty if corridor is mostly "bad lies" (rough/deep rough/hazards).
  overallHoleScore -= 18 * clamp(onBadLieFrac - 0.55, 0, 1);
  overallHoleScore = clamp(overallHoleScore, 0, 100);
  const score = overallHoleScore; // legacy alias used by existing aggregation

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
    issues,
  };
}

export function scoreCourseHoles(course: Course): CourseHoleSummary {
  const holes = course.holes.map((h, i) => scoreHole(course, h, i));
  const scored = holes.filter((h) => h.isComplete);
  const holeQualityAvg =
    scored.length === 0 ? 0 : scored.reduce((acc, h) => acc + h.overallHoleScore, 0) / scored.length;

  // Variety: reward mix of par 3/4/5 (or derived lengths if par missing)
  const parCounts = new Map<number, number>();
  for (const h of holes) parCounts.set(h.par, (parCounts.get(h.par) ?? 0) + 1);
  const distinctPars = parCounts.size; // 1..3 in MVP
  const variety = clamp(20 + 40 * distinctPars, 0, 100); // 60 for 1 par, 100 for 2+, simple MVP

  // Small global bonuses for some pathing + tasteful water usage
  const total = course.tiles.length || 1;
  const pathFrac = course.tiles.filter((t) => t === "path").length / total;
  const waterFrac = course.tiles.filter((t) => t === "water").length / total;
  const deepRoughFrac = course.tiles.filter((t) => t === "deep_rough").length / total;
  const obstacleFrac = (course.obstacles?.length ?? 0) / total;
  const deepRoughPenalty = 12 * clamp(deepRoughFrac - 0.28, 0, 1); // allow some; penalize heavy overuse
  const obstaclePenalty = 10 * clamp(obstacleFrac - 0.06, 0, 1); // clutter penalty
  const globalBonus = clamp(
    8 * pathFrac - 6 * Math.max(0, waterFrac - 0.08) - deepRoughPenalty - obstaclePenalty,
    -10,
    10
  );

  const courseQuality = clamp(holeQualityAvg + globalBonus + 0.15 * (variety - 70), 0, 100);

  return { holes, holeQualityAvg, variety, globalBonus, courseQuality };
}

function scoreObstaclesAgainstCorridor(obstacles: Obstacle[], corridorPts: Point[]) {
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
      total: 0,
    };
  }

  function cheb(a: Point, b: Point) {
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


