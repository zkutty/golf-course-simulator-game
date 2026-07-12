import type { Course, World } from "../models/types";
import { TERRAIN_MAINT_WEIGHT } from "../models/terrainEconomics";
import { BALANCE } from "../balance/balanceConfig";
import type { DayResult } from "./types";

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
// maintenance recovery, and a reputation nudge from the real golfers' average
// satisfaction. It mirrors tickWeek's formulas at a per-day scale.
export function commitDay(args: {
  course: Course;
  world: World;
  rounds: number;
  revenue: number; // green fees already banked today
  avgSatisfaction: number; // 0..100 from actual finished golfers
}): { world: World; course: Course; result: DayResult } {
  const { course, world, rounds, revenue, avgSatisfaction } = args;

  // ---- Costs (per-day slice of weekly overhead + per-round variable) ----
  const staffCost = (BALANCE.ops.staffCostPerLevel * world.staffLevel) / DAYS_PER_WEEK;
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
  const nextCondition = clamp01(course.condition - wear + maintEffect);

  // ---- Reputation: nudged by the real average satisfaction (per day) ----
  const raw = (avgSatisfaction - BALANCE.reputation.satPivot) / BALANCE.reputation.satDivisor;
  const shaped =
    raw >= 0 ? raw * BALANCE.reputation.recoveryMult : raw * BALANCE.reputation.declineMult;
  const dailyRepCap = Math.max(1, BALANCE.reputation.capPerWeek / DAYS_PER_WEEK);
  const repDelta = rounds > 0 ? clamp(shaped, -dailyRepCap, dailyRepCap) : 0;
  const nextRep = clamp(world.reputation + repDelta, 0, 100);

  const nextCashRaw = world.cash - costs; // revenue already banked live
  const bankrupt = nextCashRaw < BALANCE.distress.liquidityTrapCash;

  return {
    course: { ...course, condition: nextCondition },
    world: {
      ...world,
      cash: nextCashRaw,
      reputation: nextRep,
      lastWeekProfit: profit,
      isBankrupt: world.isBankrupt || bankrupt,
    },
    result: {
      dayIndex: 0,
      rounds,
      revenue,
      costs,
      profit,
      avgSatisfaction,
      reputationDelta: repDelta,
      conditionDelta: nextCondition - course.condition,
    },
  };
}
