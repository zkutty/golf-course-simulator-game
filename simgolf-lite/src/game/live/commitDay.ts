import type { Course, World } from "../models/types";
import { TERRAIN_MAINT_WEIGHT } from "../models/terrainEconomics";
import { staffWeeklyWage } from "../models/staff";
import { getDifficultyProfile, getEffectiveBalance } from "../balance/difficulty";
import { hitsLiquidityTrap } from "../sim/runState";
import { withEvaluatedObjectives } from "../objectives/evaluate";
import type { DayResult, RoundReactions } from "./types";

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}
function clamp01(x: number) {
  return clamp(x, 0, 1);
}

const DAYS_PER_WEEK = 7;

// Commit a finished live day into the economy + reputation model.
//
// Green fees are collected live during the day (already added to world.cash by
// the sim loop), so this only applies the day's COSTS, tax, condition wear vs.
// maintenance recovery, and a reputation move driven by the real golfers'
// observed reactions. Costs mirror tickWeek's formulas at a per-day scale.
export function commitDay(args: {
  course: Course;
  world: World;
  revenue: number; // green fees already banked today
  reactions: RoundReactions; // real observed reactions from finished rounds
  dayIndex?: number; // 0..6; day 6 closes the week for objective streaks/deadlines
  // Groundskeeper maintenance tasks completed on the live course today
  // (ZKU-122) — credited as extra condition recovery below.
  staffUpkeepTasks?: number;
}): { world: World; course: Course; result: DayResult } {
  const { course, world, revenue, reactions, dayIndex, staffUpkeepTasks = 0 } = args;
  // Difficulty-resolved balance (ZKU-165): identity for normal.
  const BALANCE = getEffectiveBalance(world.difficulty);
  const rounds = reactions.rounds;
  const avgSatisfaction = reactions.avgSatisfaction;

  // ---- Costs (per-day slice of weekly overhead + per-round variable) ----
  // Payroll comes from the individual roster (ZKU-121); worlds without one
  // fall back to the legacy staffLevel formula inside the helper.
  const staffCost = staffWeeklyWage(world) / DAYS_PER_WEEK;
  const marketingCost =
    (BALANCE.ops.marketingCostPerLevel * world.marketingLevel) / DAYS_PER_WEEK;
  const maintenanceCost = world.maintenanceBudget / DAYS_PER_WEEK;
  const overhead = BALANCE.overhead;
  const overheadTotal =
    (overhead.insurance + overhead.utilities + overhead.admin + overhead.baseStaff) /
    DAYS_PER_WEEK;

  const laborPerRound = Math.max(
    BALANCE.variableCosts.laborPerRoundMin,
    BALANCE.variableCosts.laborPerRoundBase -
      world.staffLevel * BALANCE.variableCosts.laborPerRoundStaffBonusPerLevel
  );
  const laborVariable = rounds * laborPerRound;
  const consumablesVariable = rounds * BALANCE.variableCosts.consumablesPerRound;
  const merchantFees = revenue * BALANCE.variableCosts.merchantFeeRate;

  const costsPreTax =
    staffCost + marketingCost + maintenanceCost + overheadTotal +
    laborVariable + consumablesVariable + merchantFees;

  const profitPreTax = revenue - costsPreTax;
  const tax =
    BALANCE.tax.enabled && profitPreTax > 0 ? profitPreTax * BALANCE.tax.profitTaxRate : 0;
  const costs = costsPreTax + tax;
  const profit = revenue - costs;

  // ---- Condition: wear from traffic vs. maintenance recovery (per day) ----
  const totalWeight = course.tiles.reduce((acc, t) => acc + (TERRAIN_MAINT_WEIGHT[t] ?? 1), 0);
  const avgWeight = totalWeight / (course.tiles.length || 1);
  const wear = Math.min(
    BALANCE.condition.wearCap / DAYS_PER_WEEK,
    (rounds / BALANCE.condition.wearDivisor) * avgWeight
  );
  const maintEffect = Math.min(
    BALANCE.condition.maintEffectCap / DAYS_PER_WEEK,
    maintenanceCost / BALANCE.condition.maintEffectDivisor
  );
  // Real groundskeeper work done on the course today (ZKU-122): each
  // completed maintenance task recovers a sliver of condition, capped so a
  // packed roster can't trivially pin condition at 1.
  const staffUpkeepEffect = Math.min(
    BALANCE.staff.upkeepConditionCapPerDay,
    staffUpkeepTasks * BALANCE.staff.upkeepConditionPerTask
  );
  const nextCondition = clamp01(course.condition - wear + maintEffect + staffUpkeepEffect);

  // ---- Reputation: driven by the day's real net-promoter balance ----
  // Net promoter score of the golfers who actually finished, nudged by how many
  // intend to return. Replaces the old abstract satisfaction-pivot formula.
  const nps = rounds > 0 ? (reactions.promoters - reactions.detractors) / rounds : 0; // -1..1
  const returnBias = (reactions.willReturnRate - 0.5) * 0.5; // -0.25..0.25
  const sentiment = clamp(nps + returnBias, -1, 1);
  const dailyRepCap = Math.max(1, BALANCE.reputation.capPerWeek / DAYS_PER_WEEK);
  const profile = getDifficultyProfile(world.difficulty);
  const repAsym = sentiment >= 0 ? profile.repGainMult : profile.repLossMult;
  const repDelta =
    rounds > 0 ? clamp(sentiment * BALANCE.reputation.npsGain * repAsym, -dailyRepCap, dailyRepCap) : 0;
  const nextRep = clamp(world.reputation + repDelta, 0, 100);

  const nextCashRaw = world.cash - costs; // revenue already banked live
  const bankrupt = hitsLiquidityTrap(nextCashRaw);

  const nextCourse = { ...course, condition: nextCondition };
  const nextWorldBase: World = {
    ...world,
    cash: nextCashRaw,
    reputation: nextRep,
    lastWeekProfit: profit,
    isBankrupt: world.isBankrupt || bankrupt,
  };
  // Objective evaluation at the sim commit point (ZKU-163). The last day of
  // the week closes it, which is when streaks advance and deadlines can fire.
  const closesWeek = dayIndex != null && dayIndex + 1 >= DAYS_PER_WEEK;
  const nextWorld = withEvaluatedObjectives(nextCourse, nextWorldBase, {
    rounds,
    profit,
    ...(closesWeek ? { weekCompleted: world.week } : {}),
  });

  return {
    course: nextCourse,
    world: nextWorld,
    result: {
      dayIndex: 0,
      rounds,
      revenue,
      costs,
      profit,
      avgSatisfaction,
      reputationDelta: repDelta,
      conditionDelta: nextCondition - course.condition,
      promoters: reactions.promoters,
      detractors: reactions.detractors,
      willReturnRate: reactions.willReturnRate,
    },
  };
}
