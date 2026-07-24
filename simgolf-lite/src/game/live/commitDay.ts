import type { ConcessionTransaction, ConcessionType, Course, World } from "../models/types";
import { TERRAIN_MAINT_WEIGHT } from "../models/terrainEconomics";
import { getDifficultyProfile, getEffectiveBalance } from "../balance/difficulty";
import { hitsLiquidityTrap } from "../sim/runState";
import { withEvaluatedObjectives } from "../objectives/evaluate";
import type { DayResult, RoundReactions } from "./types";
import type { LiveState } from "./types";
import type { PaceDayMetrics } from "./types";
import { layoutById } from "../models/courseLayouts";
import { recordCoreCommerce, settlePropertyDay } from "../property/property";
import type { PropertyShotTrace } from "../property/types";
import { advanceLivingClubDay } from "../livingClub/livingClub";

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
  greenFees?: number;
  concessionRevenue?: number;
  tournamentRevenue?: number;
  tournamentReputation?: number;
  concessionByType?: Partial<Record<ConcessionType, number>>;
  transactions?: ConcessionTransaction[];
  perCourse?: LiveState["perCourse"];
  reactions: RoundReactions; // real observed reactions from finished rounds
  dayIndex?: number; // 0..6; day 6 closes the week for objective streaks/deadlines
  pace?: PaceDayMetrics;
  shotTraces?: PropertyShotTrace[];
}): { world: World; course: Course; result: DayResult } {
  const { course, world, reactions, dayIndex } = args;
  const propertySettlement = settlePropertyDay(course, world, dayIndex ?? 0, reactions.rounds, args.shotTraces);
  const operatingCourse = propertySettlement.course;
  const operatingWorld = recordCoreCommerce(propertySettlement.world, dayIndex ?? 0, {
    greenFees: args.greenFees ?? args.revenue,
    concessions: args.concessionRevenue ?? 0,
    tournaments: args.tournamentRevenue ?? 0,
    byConcession: args.concessionByType ?? {},
  });
  const revenue = args.revenue + propertySettlement.report.revenue;
  // Difficulty-resolved balance (ZKU-165): identity for normal.
  const BALANCE = getEffectiveBalance(operatingWorld.difficulty);
  const rounds = reactions.rounds;
  const avgSatisfaction = reactions.avgSatisfaction;

  // ---- Costs (per-day slice of weekly overhead + per-round variable) ----
  const staffCost = (BALANCE.ops.staffCostPerLevel * operatingWorld.staffLevel) / DAYS_PER_WEEK;
  const marketingCost =
    (BALANCE.ops.marketingCostPerLevel * operatingWorld.marketingLevel) / DAYS_PER_WEEK;
  const maintenanceCost = operatingWorld.maintenanceBudget / DAYS_PER_WEEK;
  const overhead = BALANCE.overhead;
  const overheadTotal =
    (overhead.insurance + overhead.utilities + overhead.admin + overhead.baseStaff) /
    DAYS_PER_WEEK;

  const laborPerRound = Math.max(
    BALANCE.variableCosts.laborPerRoundMin,
    BALANCE.variableCosts.laborPerRoundBase -
      operatingWorld.staffLevel * BALANCE.variableCosts.laborPerRoundStaffBonusPerLevel
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
  const costs = costsPreTax + tax + propertySettlement.report.costs;
  const profit = revenue - costs;

  // ---- Condition: wear from traffic vs. maintenance recovery (per day) ----
  const totalWeight = operatingCourse.tiles.reduce((acc, t) => acc + (TERRAIN_MAINT_WEIGHT[t] ?? 1), 0);
  const avgWeight = totalWeight / (operatingCourse.tiles.length || 1);
  const wear = Math.min(
    BALANCE.condition.wearCap / DAYS_PER_WEEK,
    (rounds / BALANCE.condition.wearDivisor) * avgWeight
  );
  const maintEffect = Math.min(
    BALANCE.condition.maintEffectCap / DAYS_PER_WEEK,
    maintenanceCost / BALANCE.condition.maintEffectDivisor
  );
  const nextCondition = clamp01(course.condition - wear + maintEffect);

  // ---- Reputation: driven by the day's real net-promoter balance ----
  // Net promoter score of the golfers who actually finished, nudged by how many
  // intend to return. Replaces the old abstract satisfaction-pivot formula.
  const nps = rounds > 0 ? (reactions.promoters - reactions.detractors) / rounds : 0; // -1..1
  const returnBias = (reactions.willReturnRate - 0.5) * 0.5; // -0.25..0.25
  const sentiment = clamp(nps + returnBias, -1, 1);
  const dailyRepCap = Math.max(1, BALANCE.reputation.capPerWeek / DAYS_PER_WEEK);
  const profile = getDifficultyProfile(operatingWorld.difficulty);
  const repAsym = sentiment >= 0 ? profile.repGainMult : profile.repLossMult;
  const audienceRepDelta =
    rounds > 0 ? clamp(sentiment * BALANCE.reputation.npsGain * repAsym, -dailyRepCap, dailyRepCap) : 0;
  const liabilityRep = propertySettlement.report.incidents.reduce((sum, incident) => sum + incident.severity * 0.08, 0);
  const repDelta = audienceRepDelta + (args.tournamentReputation ?? 0) - liabilityRep;
  const nextRep = clamp(operatingWorld.reputation + repDelta, 0, 100);

  // Core revenue is already banked live. Property revenue settles here beside
  // its upkeep, staffing, access failures, and liability costs.
  const nextCashRaw = operatingWorld.cash + propertySettlement.report.revenue - costs;
  const bankrupt = hitsLiquidityTrap(nextCashRaw);

  const conditionCourse = { ...operatingCourse, condition: nextCondition };
  const nextWorldBase: World = {
    ...operatingWorld,
    cash: nextCashRaw,
    reputation: nextRep,
    // The hook replaces this with the seven-day ledger total at Sunday close.
    // Midweek consumers must continue to see the last completed week.
    lastWeekProfit: operatingWorld.lastWeekProfit,
    isBankrupt: operatingWorld.isBankrupt || bankrupt,
  };
  // Objective evaluation at the sim commit point (ZKU-163). The last day of
  // the week closes it, which is when streaks advance and deadlines can fire.
  const closesWeek = dayIndex != null && dayIndex + 1 >= DAYS_PER_WEEK;
  const objectiveWorld = withEvaluatedObjectives(conditionCourse, nextWorldBase, {
    rounds,
    profit,
    ...(closesWeek ? { weekCompleted: operatingWorld.week } : {}),
  });
  const livingClubCommit = advanceLivingClubDay(conditionCourse, objectiveWorld, dayIndex ?? 0);
  const nextCourse = livingClubCommit.course;
  const nextWorld = livingClubCommit.world;
  const courseEntries = Object.entries(args.perCourse ?? {});
  let allocatedRevenue = 0;
  let allocatedCosts = 0;
  const weightTotal = courseEntries.reduce((sum, [, stats]) => sum + (stats.greenFees || stats.roundsFinished || 1), 0);
  const perCourse = courseEntries.map(([courseId, stats], index) => {
    const last = index === courseEntries.length - 1;
    const weight = (stats.greenFees || stats.roundsFinished || 1) / Math.max(1, weightTotal);
    const courseRevenue = last ? revenue - allocatedRevenue : Math.round(revenue * weight * 100) / 100;
    const courseCosts = last ? costs - allocatedCosts : Math.round(costs * weight * 100) / 100;
    allocatedRevenue += courseRevenue;
    allocatedCosts += courseCosts;
    const layout = layoutById(course, courseId);
    const capacity = (layout?.roundLength ?? 9) * 4;
    return {
      courseId,
      courseName: stats.courseName,
      attendance: stats.roundsFinished,
      turnaways: Math.max(0, stats.arrivals - capacity),
      capacity,
      revenue: courseRevenue,
      costs: courseCosts,
      profit: courseRevenue - courseCosts,
      avgSatisfaction: stats.roundsFinished ? stats.satisfactionSum / stats.roundsFinished : 0,
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
        byConcession: args.concessionByType ?? {},
        transactions: args.transactions ?? [],
      },
      costs,
      profit,
      avgSatisfaction,
      reputationDelta: repDelta,
      conditionDelta: nextCondition - course.condition,
      promoters: reactions.promoters,
      detractors: reactions.detractors,
      willReturnRate: reactions.willReturnRate,
      perCourse,
      pace: args.pace,
    },
  };
}
