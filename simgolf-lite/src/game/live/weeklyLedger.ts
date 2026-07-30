import type { ConcessionType, WeekResult } from "../models/types";
import type { MobilityCourseAggregate } from "../m51/types";
import { mergeMobilityProductSettlements } from "../m51/mobility";
import type { DayResult } from "./types";

export interface LiveWeekLedger {
  version: 1;
  week: number;
  days: DayResult[];
}

export function createWeekLedger(week: number): LiveWeekLedger {
  return { version: 1, week, days: [] };
}

export function appendDayToLedger(ledger: LiveWeekLedger, result: DayResult): LiveWeekLedger {
  const days = [...ledger.days.filter((day) => day.dayIndex !== result.dayIndex), result]
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .slice(0, 7);
  return { ...ledger, days };
}

export function weekResultFromLedger(ledger: LiveWeekLedger): WeekResult {
  const visitors = ledger.days.reduce((sum, day) => sum + day.rounds, 0);
  const revenue = ledger.days.reduce((sum, day) => sum + day.revenue, 0);
  const costs = ledger.days.reduce((sum, day) => sum + day.costs, 0);
  const satisfactionWeight = ledger.days.reduce((sum, day) => sum + day.avgSatisfaction * day.rounds, 0);
  const byConcession: Partial<Record<ConcessionType, number>> = {};
  const perCourse = new Map<string, NonNullable<WeekResult["perCourse"]>[number] & { satisfactionWeight: number }>();
  const weatherDays = ledger.days.flatMap((day) => day.weather ? [day.weather] : []);
  const mobilityCourses = new Map<string, MobilityCourseAggregate>();

  for (const day of ledger.days) {
    for (const [type, amount] of Object.entries(day.revenueBreakdown.byConcession) as Array<[ConcessionType, number]>) {
      byConcession[type] = (byConcession[type] ?? 0) + amount;
    }
    for (const row of day.perCourse ?? []) {
      const current = perCourse.get(row.courseId) ?? {
        courseId: row.courseId, courseName: row.courseName, attendance: 0, turnaways: 0,
        capacity: 0, revenue: 0, costs: 0, profit: 0, avgSatisfaction: 0, satisfactionWeight: 0,
      };
      current.courseName = row.courseName;
      current.attendance += row.attendance;
      current.turnaways += row.turnaways;
      current.capacity += row.capacity;
      current.revenue += row.revenue;
      current.costs += row.costs;
      current.profit += row.profit;
      current.satisfactionWeight += row.avgSatisfaction * row.attendance;
      current.avgSatisfaction = current.attendance ? current.satisfactionWeight / current.attendance : 0;
      perCourse.set(row.courseId, current);
    }
    for (const [courseId, aggregate] of Object.entries(day.m51?.courses ?? {})) {
      const current = mobilityCourses.get(courseId) ?? { ...aggregate, walkingRounds: 0, pushcartRounds: 0, ridingCartRounds: 0, observedRounds: 0, observedPaceMinutes: 0, settledRevenue: 0, operatingCosts: 0, stockouts: 0, utilizedUnits: 0, activeRentals: 0, lastSettledWeek: 0 };
      current.walkingRounds += aggregate.walkingRounds;
      current.pushcartRounds += aggregate.pushcartRounds;
      current.ridingCartRounds += aggregate.ridingCartRounds;
      current.observedRounds += aggregate.observedRounds;
      current.observedPaceMinutes += aggregate.observedPaceMinutes;
      current.settledRevenue += aggregate.settledRevenue;
      current.operatingCosts += aggregate.operatingCosts;
      current.stockouts += aggregate.stockouts;
      current.utilizedUnits += aggregate.utilizedUnits;
      current.activeRentals = Math.max(current.activeRentals, aggregate.activeRentals);
      current.lastSettledWeek = Math.max(current.lastSettledWeek, aggregate.lastSettledWeek);
      mobilityCourses.set(courseId, current);
    }
  }

  return {
    visitors,
    revenue,
    revenueBreakdown: {
      greenFees: ledger.days.reduce((sum, day) => sum + day.revenueBreakdown.greenFees, 0),
      concessions: ledger.days.reduce((sum, day) => sum + day.revenueBreakdown.concessions, 0),
      tournaments: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.tournaments ?? 0), 0),
      property: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.property ?? 0), 0),
      propertyCosts: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.propertyCosts ?? 0), 0),
      propertyVisitors: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.propertyVisitors ?? 0), 0),
      paceOvertime: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.paceOvertime ?? 0), 0),
      paceCompensation: ledger.days.reduce((sum, day) => sum + (day.revenueBreakdown.paceCompensation ?? 0), 0),
      byConcession,
      transactions: ledger.days.flatMap((day) => day.revenueBreakdown.transactions),
    },
    costs,
    profit: revenue - costs,
    avgSatisfaction: visitors ? satisfactionWeight / visitors : 0,
    reputationDelta: ledger.days.reduce((sum, day) => sum + day.reputationDelta, 0),
    ...(mobilityCourses.size ? (() => {
      const products = mergeMobilityProductSettlements(ledger.days.flatMap((day) => day.m51?.products ?? []));
      const grossRevenue = Math.round(products.reduce((sum, row) => sum + row.grossRevenue, 0) * 100) / 100;
      const operatingCosts = Math.round(products.reduce((sum, row) => sum + row.operatingCosts, 0) * 100) / 100;
      return { m51: { version: 1 as const, courses: Object.fromEntries([...mobilityCourses.entries()].sort(([a], [b]) => a.localeCompare(b))), products, grossRevenue, operatingCosts, netRevenue: Math.round((grossRevenue - operatingCosts) * 100) / 100 } };
    })() : {}),
    perCourse: [...perCourse.values()].map(({ satisfactionWeight: _weight, ...row }) => row),
    visitorNoise: 0,
    ...(weatherDays.length ? {
      weatherSummary: {
        playableDays: weatherDays.filter((weather) => weather.modifiers.demandMultiplier >= 0.5).length,
        rainDays: weatherDays.filter((weather) => ["rain", "heavy_rain", "storm"].includes(weather.kind)).length,
        severeDays: weatherDays.filter((weather) => weather.modifiers.eventCancellationRisk >= 0.3).length,
        averageDemandMultiplier: weatherDays.reduce((sum, weather) => sum + weather.modifiers.demandMultiplier, 0) / weatherDays.length,
        averageTurfWearMultiplier: weatherDays.reduce((sum, weather) => sum + weather.modifiers.turfWearMultiplier, 0) / weatherDays.length,
        kinds: weatherDays.map((weather) => weather.kind),
      },
    } : {}),
  };
}

export function normalizeWeekLedger(value: unknown, fallbackWeek: number): LiveWeekLedger {
  if (!value || typeof value !== "object") return createWeekLedger(fallbackWeek);
  const candidate = value as Partial<LiveWeekLedger>;
  if (candidate.version !== 1 || !Number.isInteger(candidate.week) || !Array.isArray(candidate.days)) return createWeekLedger(fallbackWeek);
  const days = candidate.days.filter((day): day is DayResult => !!day && Number.isInteger(day.dayIndex) && day.dayIndex >= 0 && day.dayIndex < 7).slice(0, 7);
  return { version: 1, week: candidate.week!, days };
}
