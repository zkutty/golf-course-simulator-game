import type { Course, WeekResult, World } from "../models/types";
import { mulberry32, randInt } from "../../utils/rng";
import { demandBreakdown, demandIndex, satisfactionBreakdown, satisfactionScore } from "./score";
import { scoreCourseHoles } from "./holes";

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
  const wear = Math.min(0.06, visitors / 20_000); // more visitors = more wear
  const maintEffect = Math.min(0.08, maintenanceCost / 20_000); // diminishing returns
  const nextCondition = clamp01(course.condition - wear + maintEffect);

  // Reputation update: satisfaction moves it
  const repDelta = Math.round((avgSat - 60) / 10); // -? .. +?
  const nextRep = clamp(world.reputation + repDelta, 0, 100);

  const holes = scoreCourseHoles(course);
  const dBreak = demandBreakdown(course, world);
  const sBreak = satisfactionBreakdown(course, world);
  const tips = buildAdvisorTips(holes, dBreak, sBreak, course, world);

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
    },
  };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function buildAdvisorTips(
  holes: ReturnType<typeof scoreCourseHoles>,
  demand: ReturnType<typeof demandBreakdown>,
  sat: ReturnType<typeof satisfactionBreakdown>,
  course: Course,
  world: World
) {
  const tips: string[] = [];

  const incomplete = holes.holes.filter((h) => !h.isComplete).length;
  if (incomplete > 0) tips.push(`You have ${incomplete} incomplete holes (missing tee/green).`);

  const invalidHoles = holes.holes.filter((h) => h.isComplete && !h.isValid);
  if (invalidHoles.length > 0) {
    tips.push(
      `${invalidHoles.length} holes have layout issues (e.g., hazards on the main line).`
    );
  }

  const waterHeavy = holes.holes.filter((h) => h.isComplete && h.corridor.water / (h.corridor.samples || 1) > 0.25);
  if (waterHeavy.length >= 3) tips.push("3+ holes have lots of water on the main corridor; casual golfers hate this.");

  if (sat.condition >= 80 && sat.playability < 55)
    tips.push("Condition is high but playability is low → layout is the issue (fairways/corridors).");

  if (demand.priceAttractiveness < 45 && course.baseGreenFee > 80)
    tips.push("Your green fee is high relative to attractiveness → consider lowering price or improving quality.");

  if (world.maintenanceBudget < 600 && course.condition < 0.55)
    tips.push("Maintenance budget looks low; condition will keep sliding as visitors rise.");

  return tips.slice(0, 3);
}


