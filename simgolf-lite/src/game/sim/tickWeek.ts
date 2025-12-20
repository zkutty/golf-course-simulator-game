import type { Course, WeekResult, World } from "../models/types";
import { mulberry32, randInt } from "../../utils/rng";
import { demandBreakdown, satisfactionBreakdown, satisfactionScore } from "./score";
import { scoreCourseHoles } from "./holes";
import { TERRAIN_MAINT_WEIGHT } from "../models/terrainEconomics";
import { isCoursePlayable } from "./isCoursePlayable";

export function tickWeek(
  course: Course,
  world: World,
  seed = 1234
): { world: World; course: Course; result: WeekResult } {
  const rng = mulberry32(seed + world.week);

  const playable = isCoursePlayable(course);

  // Demand breakdown drives visitors (now potentially segmented)
  const dBreak = demandBreakdown(course, world);

  // Visitors driven by demand; add randomness
  const d = dBreak.demandIndex; // ~0..1.2
  const baseVisitors =
    dBreak.segments?.totalBaseVisitors ?? (120 + Math.round(520 * d)); // 120..~744
  const visitorNoise = randInt(rng, -40, 40);
  const visitors = playable ? Math.max(0, baseVisitors + visitorNoise) : randInt(rng, 0, 10);

  const avgSat = satisfactionScore(course, world); // 0..100

  // Revenue: visitors * price, but satisfaction affects repeat visits (baked into rep later)
  const revenue = playable ? visitors * course.baseGreenFee : visitors * 5; // testing rounds / snacks

  // Costs
  const staffCost = 450 * world.staffLevel;
  const marketingCost = 300 * world.marketingLevel;
  const maintenanceCost = world.maintenanceBudget;

  // Fixed weekly overhead (applies even with 0 visitors)
  const overhead = {
    insurance: 140,
    utilities: 110,
    admin: 170,
    baseStaff: 280,
  };
  const overheadTotal = overhead.insurance + overhead.utilities + overhead.admin + overhead.baseStaff;

  const costs = staffCost + marketingCost + maintenanceCost + overheadTotal;
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
  const sBreak = satisfactionBreakdown(course, world);
  const tips = buildExplainabilityTips(holes);
  if (!playable) {
    tips.unshift("Course not playable yet → visitors are limited to testing rounds. Finish 9 valid holes, keep condition/playability up.");
  }
  const topIssues = buildTopIssues(holes);

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
      overhead: { ...overhead, total: overheadTotal },
      avgSatisfaction: avgSat,
      reputationDelta: repDelta,
      visitorNoise,
      demand: dBreak,
      satisfaction: sBreak,
      tips,
      topIssues,
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
    if (h.difficultyScore >= 78 && h.effectiveDistance >= 28 && waterFrac + sandFrac >= 0.08) {
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

function buildTopIssues(holes: ReturnType<typeof scoreCourseHoles>) {
  const issues: string[] = [];

  const incomplete = holes.holes.filter((h) => !h.isComplete).length;
  if (incomplete > 0) issues.push(`You have ${incomplete} incomplete holes — place tee + green for each hole.`);

  const blocked = holes.holes.filter(
    (h) => h.isComplete && !h.isValid && h.issues.some((m) => m.includes("No playable route"))
  );
  for (const h of blocked.slice(0, 2)) {
    issues.push(
      `Hole ${h.holeIndex + 1}: route is blocked (no playable path) — reduce water blocking or add a fairway corridor.`
    );
  }

  const completeValid = holes.holes.filter((h) => h.isComplete && h.isValid);
  const worst = completeValid.slice().sort((a, b) => a.overallHoleScore - b.overallHoleScore).slice(0, 3);

  for (const h of worst) {
    const s = h.corridor.samples || 1;
    const waterFrac = h.corridor.water / s;
    const sandFrac = h.corridor.sand / s;
    const roughFrac = h.corridor.rough / s;
    const deepRoughFrac = h.corridor.deep_rough / s;
    const holeNo = h.holeIndex + 1;

    if (waterFrac >= 0.12) {
      issues.push(`Hole ${holeNo}: water sits on the playable path — move it off the corridor or add a safe dogleg.`);
      continue;
    }
    if (deepRoughFrac >= 0.18) {
      issues.push(`Hole ${holeNo}: deep rough is on the playable path — carve a fairway line (keep deep rough off-path).`);
      continue;
    }
    if (roughFrac + deepRoughFrac >= 0.65) {
      issues.push(`Hole ${holeNo}: too much rough on the playable path — paint fairway along the route.`);
      continue;
    }
    if (sandFrac >= 0.14) {
      issues.push(`Hole ${holeNo}: lots of sand on the playable path — shift bunkers to the sides for aesthetics without punishment.`);
      continue;
    }
  }

  // Par distribution sanity (encourage variety)
  const pars = completeValid.map((h) => h.par);
  if (pars.length >= 6) {
    const counts = new Map<number, number>();
    for (const p of pars) counts.set(p, (counts.get(p) ?? 0) + 1);
    const distinct = counts.size;
    const maxCount = Math.max(...counts.values());
    if (distinct === 1 || maxCount >= 7) {
      const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      issues.push(`Par variety is low (mostly par ${common}) — mix in shorter and longer holes to improve variety.`);
    }
  }

  // De-duplicate and cap
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const s of issues) {
    if (seen.has(s)) continue;
    seen.add(s);
    deduped.push(s);
  }
  return deduped.slice(0, 3);
}


