import type { Course, WeekResult, World } from "../models/types";
import { mulberry32, randInt } from "../../utils/rng";
import { demandBreakdown, demandIndex, satisfactionBreakdown, satisfactionScore } from "./score";
import { scoreCourseHoles } from "./holes";
import { TERRAIN_MAINT_WEIGHT } from "../models/terrainEconomics";

export function tickWeek(
  course: Course,
  world: World,
  seed = 1234
): { world: World; course: Course; result: WeekResult } {
  const rng = mulberry32(seed + world.week);

  // Visitors driven by demand; add randomness
  const d = demandIndex(course, world); // ~0..1.2
  const baseVisitors = 120 + Math.round(520 * d); // 120..~744
  const visitorNoise = randInt(rng, -40, 40);
  const visitors = Math.max(0, baseVisitors + visitorNoise);

  const avgSat = satisfactionScore(course, world); // 0..100

  // Revenue: visitors * price, but satisfaction affects repeat visits (baked into rep later)
  const revenue = visitors * course.baseGreenFee;

  // Costs
  const staffCost = 450 * world.staffLevel;
  const marketingCost = 300 * world.marketingLevel;
  const maintenanceCost = world.maintenanceBudget;

  const costs = staffCost + marketingCost + maintenanceCost;
  const profit = revenue - costs;

  // Condition update: maintenance pushes up, wear pushes down
  const totalWeight = course.tiles.reduce((acc, t) => acc + (TERRAIN_MAINT_WEIGHT[t] ?? 1), 0);
  const avgWeight = totalWeight / (course.tiles.length || 1);
  // more visitors + higher-maintenance terrain => more wear
  const wear = Math.min(0.06, (visitors / 20_000) * avgWeight);
  const maintEffect = Math.min(0.08, maintenanceCost / 20_000); // diminishing returns
  const nextCondition = clamp01(course.condition - wear + maintEffect);

  // Reputation update: satisfaction moves it
  const repDelta = Math.round((avgSat - 60) / 10); // -? .. +?
  const nextRep = clamp(world.reputation + repDelta, 0, 100);

  const holes = scoreCourseHoles(course);
  const dBreak = demandBreakdown(course, world);
  const sBreak = satisfactionBreakdown(course, world);
  const tips = buildExplainabilityTips(holes);

  return {
    course: { ...course, condition: nextCondition },
    world: {
      ...world,
      week: world.week + 1,
      cash: world.cash + profit,
      reputation: nextRep,
    },
    result: {
      visitors,
      revenue,
      costs,
      profit,
      avgSatisfaction: avgSat,
      reputationDelta: repDelta,
      visitorNoise,
      demand: dBreak,
      satisfaction: sBreak,
      tips,
      maintenancePressure: { totalWeight, avgWeight, wear },
    },
  };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function buildExplainabilityTips(holes: ReturnType<typeof scoreCourseHoles>) {
  const tips: string[] = [];

  const incomplete = holes.holes.filter((h) => !h.isComplete).length;
  if (incomplete > 0) tips.push(`You have ${incomplete} incomplete holes (missing tee/green).`);

  const complete = holes.holes.filter((h) => h.isComplete);
  const worst = complete
    .slice()
    .sort((a, b) => a.overallHoleScore - b.overallHoleScore)
    .slice(0, 2);

  for (const h of worst) {
    const s = h.corridor.samples || 1;
    const waterFrac = h.corridor.water / s;
    const sandFrac = h.corridor.sand / s;
    const roughFrac = h.corridor.rough / s;
    const holeNo = h.holeIndex + 1;

    if (waterFrac >= 0.12) {
      tips.push(`Hole ${holeNo}: water on the direct line reduces playability — move it off the corridor.`);
      continue;
    }
    if (roughFrac >= 0.6) {
      tips.push(`Hole ${holeNo}: the tee→green line is mostly rough — paint a fairway corridor.`);
      continue;
    }
    if (h.difficultyScore >= 78 && h.distance >= 28 && waterFrac + sandFrac >= 0.08) {
      tips.push(`Hole ${holeNo}: long + hazard-heavy — feels unfair; reduce hazards or shorten it.`);
      continue;
    }
    if (h.aestheticsScore < 45 && waterFrac + sandFrac >= 0.08) {
      tips.push(`Hole ${holeNo}: aesthetics suffers because hazards are on the line — keep water/sand near the corridor, not on it.`);
      continue;
    }
    if (h.playabilityScore < 55) {
      tips.push(`Hole ${holeNo}: low playability — reduce hazards/rough on the main corridor.`);
      continue;
    }
  }

  // Global patterns (deterministic)
  const hard = complete.filter((h) => h.difficultyScore >= 75).length;
  if (hard >= 3) tips.push("Several holes are very difficult (long + hazards) → many golfers will find it unfair.");

  const waterHeavyCount = complete.filter((h) => (h.corridor.water / (h.corridor.samples || 1)) > 0.18).length;
  if (waterHeavyCount >= 3) tips.push("3+ holes have lots of water on the direct corridor; casual golfers tend to avoid this.");

  const avgAest =
    complete.length === 0 ? 0 : complete.reduce((acc, h) => acc + h.aestheticsScore, 0) / complete.length;
  if (avgAest < 45) tips.push("Aesthetics is low: add water/sand near fairway edges (not directly on the tee→green line).");

  return tips.slice(0, 3);
}


