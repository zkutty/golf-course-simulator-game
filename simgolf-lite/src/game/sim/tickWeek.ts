import type { Course, WeekResult, World } from "../models/types";
import { mulberry32, randInt } from "../../utils/rng";
import { demandIndex, satisfactionScore } from "./score";

export function tickWeek(
  course: Course,
  world: World,
  seed = 1234
): { world: World; course: Course; result: WeekResult } {
  const rng = mulberry32(seed + world.week);

  // Visitors driven by demand; add randomness
  const d = demandIndex(course, world); // ~0..1.2
  const baseVisitors = 120 + Math.round(520 * d); // 120..~744
  const visitors = Math.max(0, baseVisitors + randInt(rng, -40, 40));

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
    },
  };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}


