import type { ConcessionTransaction, ConcessionType, Course, World } from "../models/types";
import { terrainMaintenanceWeight } from "../models/terrainEconomics";
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
import {
  advanceSeasonalDay,
  biomeClimatePhenologyForDay,
  charterDefinition,
  seasonalState,
} from "../seasons/seasons";
import { advanceCampaign } from "../campaign/campaign";
import { recordPaceDay } from "./paceHistory";
import { m49ReputationDelta, recordM49Observations } from "../m49/history";
import { m51MobilityAggregateSummary, settleM51MobilityDay } from "../m51/mobility";
import type { M51LiveMobilityState } from "../m51/types";
import { settleMobilityFleet } from "../m51/operations";
import { quoteDailyBiomeOperatingCosts } from "../models/biomeOperatingCosts";
import {
  advanceSurfaceCareDay,
  surfaceCareWaterCostMultiplier,
} from "../conditions/surfaceCare";
import { advanceGreenKeepingDay } from "../greens/greenMaintenance";

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
  observations?: RoundReactions["observations"];
  /** M51 live state settles only here; it does not create a second cash path. */
  mobility?: M51LiveMobilityState;
}): { world: World; course: Course; result: DayResult } {
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
    byConcession: args.concessionByType ?? {},
  });
  const hospitalityWeatherAdjustment = propertySettlement.report.revenue * (seasonalCommit.modifiers.lodgingMultiplier - 1);
  const revenue = args.revenue + propertySettlement.report.revenue + hospitalityWeatherAdjustment;
  // Difficulty-resolved balance (ZKU-165): identity for normal.
  const BALANCE = getEffectiveBalance(operatingWorld.difficulty);
  const profile = getDifficultyProfile(operatingWorld.difficulty);
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

  // Local care runs before the operating quote so active resod establishment
  // raises real water consumption and cost instead of only changing turf.
  const surfaceCareCommit = advanceSurfaceCareDay({
    course: operatingCourse,
    world: operatingWorld,
    absoluteDay: seasonalCommit.weather.absoluteDay,
    weather: seasonalCommit.weather,
    climate: biomeClimatePhenologyForDay(
      operatingCourse.theme ?? "parkland",
      seasonalCommit.weather.absoluteDay,
    ),
    turfPriority: season.operations.turfPriority,
    waterPolicy: season.operations.waterPolicy,
    drainageLevel: season.operations.drainageLevel,
    rounds,
    shotTraces: args.shotTraces,
    mobilityOffPathTiles: args.mobility?.assignments.reduce(
      (sum, assignment) => sum + assignment.offPathTiles,
      0,
    ) ?? 0,
  });
  const greenKeepingCommit = advanceGreenKeepingDay({
    course: surfaceCareCommit.course,
    world: operatingWorld,
    absoluteDay: seasonalCommit.weather.absoluteDay,
    weather: seasonalCommit.weather,
    drainageLevel: season.operations.drainageLevel,
    waterPolicy: season.operations.waterPolicy,
    rounds,
    shotTraces: args.shotTraces,
    closedHoleIds: season.operations.closedHoleIds,
  });
  const quotedBiomeEconomy = quoteDailyBiomeOperatingCosts({
    course: operatingCourse,
    season: season.calendar.season,
    currentWeather: seasonalCommit.weather,
    publishedForecast: season.forecast,
    policy: season.operations.waterPolicy,
    drainageLevel: season.operations.drainageLevel,
    costMult: profile.terrainCostMult,
  });
  const waterCostMultiplier = surfaceCareWaterCostMultiplier(
    surfaceCareCommit.report,
  );
  const elevatedWaterCost =
    quotedBiomeEconomy.waterCost * (waterCostMultiplier - 1);
  const biomeEconomy = elevatedWaterCost > 0
    ? {
      ...quotedBiomeEconomy,
      waterCost: quotedBiomeEconomy.waterCost + elevatedWaterCost,
      total: quotedBiomeEconomy.total + elevatedWaterCost,
    }
    : quotedBiomeEconomy;
  const presentationCost = season.operations.turfPriority === "presentation" ? 65 : season.operations.turfPriority === "recovery" ? 38 : 20;
  const paceOvertime = Object.values(args.pace?.perCourse ?? {}).reduce((sum, metrics) => sum + metrics.overtimeCost, 0);
  const paceCompensation = Object.values(args.pace?.perCourse ?? {}).reduce((sum, metrics) => sum + metrics.compensationCost, 0);
  const paceCosts = paceOvertime + paceCompensation;
  const mobilitySummary = args.mobility ? m51MobilityAggregateSummary(args.mobility) : undefined;
  const mobilityOperatingCosts = mobilitySummary?.operatingCosts ?? 0;
  const costsPreTax =
    staffCost + marketingCost + maintenanceCost + overheadTotal +
    laborVariable + consumablesVariable + merchantFees + biomeEconomy.total + presentationCost;

  const profitPreTax = revenue - costsPreTax;
  const tax =
    BALANCE.tax.enabled && profitPreTax > 0 ? profitPreTax * BALANCE.tax.profitTaxRate : 0;
  const sharedCosts = (costsPreTax + tax + propertySettlement.report.costs) * charter.operatingCostMultiplier;
  const costs = sharedCosts + paceCosts + mobilityOperatingCosts;
  const profit = revenue - costs;

  // ---- Condition: one local surface-care authority (per day) ----
  const totalWeight = operatingCourse.tiles.reduce(
    (acc, terrain) => acc + terrainMaintenanceWeight(terrain, operatingCourse.theme),
    0,
  );
  const avgWeight = totalWeight / (operatingCourse.tiles.length || 1);
  const priorityWearMultiplier = season.operations.turfPriority === "recovery" ? 0.82 : season.operations.turfPriority === "presentation" ? 0.94 : 1;
  const wear = Math.min(
    BALANCE.condition.wearCap / DAYS_PER_WEEK,
    (rounds / BALANCE.condition.wearDivisor) * avgWeight * seasonalCommit.modifiers.turfWearMultiplier * priorityWearMultiplier
  );
  const waterRecoveryMultiplier = season.operations.waterPolicy === "irrigate"
    ? seasonalCommit.weather.kind === "heat" || seasonalCommit.weather.kind === "drought" ? 1.35 : 1.08
    : season.operations.waterPolicy === "conserve" ? 0.86 : 1;
  const priorityRecoveryMultiplier = season.operations.turfPriority === "recovery" ? 1.22 : season.operations.turfPriority === "presentation" ? 1.08 : 1;
  const maintEffect = Math.min(
    BALANCE.condition.maintEffectCap / DAYS_PER_WEEK,
    (maintenanceCost / BALANCE.condition.maintEffectDivisor)
      * seasonalCommit.modifiers.turfRecoveryMultiplier
      * waterRecoveryMultiplier
      * priorityRecoveryMultiplier
  );
  const mobilityOffPathWear = Math.min(.01, (args.mobility?.assignments.reduce((sum, assignment) => sum + assignment.offPathTiles, 0) ?? 0) * 0.000002);
  const legacyCondition = clamp01(
    seasonalCommit.course.condition - wear - mobilityOffPathWear + maintEffect,
  );
  const nextCondition = surfaceCareCommit.report.zones > 0
    ? surfaceCareCommit.report.overallCondition
    : legacyCondition;

  // ---- Reputation: driven by the day's real net-promoter balance ----
  // Net promoter score of the golfers who actually finished, nudged by how many
  // intend to return. Replaces the old abstract satisfaction-pivot formula.
  const nps = rounds > 0 ? (reactions.promoters - reactions.detractors) / rounds : 0; // -1..1
  const returnBias = (reactions.willReturnRate - 0.5) * 0.5; // -0.25..0.25
  const sentiment = clamp(nps + returnBias, -1, 1);
  const dailyRepCap = Math.max(1, BALANCE.reputation.capPerWeek / DAYS_PER_WEEK);
  const repAsym = sentiment >= 0 ? profile.repGainMult : profile.repLossMult;
  const m49Evidence = reactions.observations;
  const audienceRepDelta = m49Evidence
    ? clamp(m49ReputationDelta(m49Evidence).delta * repAsym, -dailyRepCap, dailyRepCap)
    : rounds > 0 ? clamp(sentiment * BALANCE.reputation.npsGain * repAsym, -dailyRepCap, dailyRepCap) : 0;
  const liabilityRep = propertySettlement.report.incidents.reduce((sum, incident) => sum + incident.severity * 0.08, 0);
  const repDelta = (audienceRepDelta + (args.tournamentReputation ?? 0)) * charter.reputationMultiplier - liabilityRep;
  const nextRep = clamp(operatingWorld.reputation + repDelta, 0, 100);

  // Core revenue is already banked live. Property revenue settles here beside
  // its upkeep, staffing, access failures, and liability costs.
  const nextCashRaw = operatingWorld.cash + propertySettlement.report.revenue + hospitalityWeatherAdjustment - costs;
  const bankrupt = hitsLiquidityTrap(nextCashRaw);

  const conditionCourse = { ...greenKeepingCommit.course, condition: nextCondition };
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
  const historyWorld = recordPaceDay(nextWorldBase, conditionCourse, dayIndex ?? 0, args.pace);
  const objectiveWorld = withEvaluatedObjectives(conditionCourse, historyWorld, {
    rounds,
    profit,
    ...(closesWeek ? { weekCompleted: operatingWorld.week } : {}),
  });
  const livingClubCommit = advanceLivingClubDay(conditionCourse, objectiveWorld, dayIndex ?? 0);
  const nextCourse = settleMobilityFleet(livingClubCommit.course, args.mobility);
  const campaignWorld = advanceCampaign(nextCourse, livingClubCommit.world);
  const m49World = recordM49Observations(campaignWorld, m49Evidence ?? args.observations ?? [], operatingWorld.week);
  const nextWorld = args.mobility
    ? settleM51MobilityDay(m49World, { live: args.mobility, week: operatingWorld.week, dayIndex: dayIndex ?? 0 })
    : m49World;
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
    const exactMobilityCosts = mobilitySummary?.products
      .filter((product) => product.courseId === courseId)
      .reduce((sum, product) => sum + product.operatingCosts, 0) ?? 0;
    const allocated = last
      ? sharedCosts - allocatedSharedCosts
      : Math.round(sharedCosts * weight * 100) / 100;
    const courseCosts = allocated + exactPaceCosts + exactMobilityCosts;
    allocatedRevenue += courseRevenue;
    allocatedSharedCosts += allocated;
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
      paceOvertime: paceMetrics?.overtimeCost ?? 0,
      paceCompensation: paceMetrics?.compensationCost ?? 0,
    };
  });

  return {
    course: nextCourse,
    world: nextWorld,
    result: {
      dayIndex: dayIndex ?? 0,
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
        transactions: args.transactions ?? [],
      },
      costs,
      profit,
      biomeEconomy: charter.operatingCostMultiplier === 1
        ? biomeEconomy
        : {
          ...biomeEconomy,
          waterCost: biomeEconomy.waterCost * charter.operatingCostMultiplier,
          plantCareCost: biomeEconomy.plantCareCost * charter.operatingCostMultiplier,
          drainageCareCost: biomeEconomy.drainageCareCost * charter.operatingCostMultiplier,
          total: biomeEconomy.total * charter.operatingCostMultiplier,
        },
      avgSatisfaction,
      reputationDelta: repDelta,
      conditionDelta: nextCondition - seasonalCommit.course.condition,
      surfaceCare: surfaceCareCommit.report,
      greenKeeping: greenKeepingCommit.report,
      ...(mobilitySummary ? { m51: mobilitySummary } : {}),
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
        modifiers: seasonalCommit.modifiers,
      },
    },
  };
}
