import { describe, expect, it } from "vitest";
import type { DayResult } from "./types";
import { appendDayToLedger, createWeekLedger, weekResultFromLedger } from "./weeklyLedger";

function day(dayIndex: number, patch: Partial<DayResult> = {}): DayResult {
  return {
    dayIndex, rounds: 10, revenue: 1_000,
    revenueBreakdown: { greenFees: 800, concessions: 200, byConcession: { snack_bar: 200 }, transactions: [] },
    costs: 600, profit: 400, avgSatisfaction: 80, reputationDelta: 1, conditionDelta: -.01,
    promoters: 6, detractors: 1, willReturnRate: .8,
    ...patch,
  };
}

describe("live weekly ledger", () => {
  it("aggregates seven daily settlements into one weekly result", () => {
    let ledger = createWeekLedger(4);
    for (let index = 0; index < 7; index++) ledger = appendDayToLedger(ledger, day(index));
    const result = weekResultFromLedger(ledger);
    expect(result).toMatchObject({ visitors: 70, revenue: 7_000, costs: 4_200, profit: 2_800, avgSatisfaction: 80, reputationDelta: 7 });
    expect(result.revenueBreakdown).toMatchObject({ greenFees: 5_600, concessions: 1_400, byConcession: { snack_bar: 1_400 } });
  });

  it("replaces rather than duplicates a repeated day commit", () => {
    const ledger = appendDayToLedger(appendDayToLedger(createWeekLedger(1), day(0)), day(0, { revenue: 500, profit: -100 }));
    expect(ledger.days).toHaveLength(1);
    expect(weekResultFromLedger(ledger).revenue).toBe(500);
  });

  it("aggregates auditable biome operating costs without changing day counts", () => {
    let ledger = createWeekLedger(3);
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      ledger = appendDayToLedger(ledger, day(dayIndex, {
        biomeEconomy: {
          biome: "links",
          maintainedAreaUnits: 1_000 + dayIndex,
          plantingWaterUnits: 20,
          seasonalDemandMultiplier: .82,
          weatherDemandMultiplier: 1 + dayIndex * .01,
          policyMultiplier: 1,
          waterCost: 12,
          plantCareCost: 3,
          drainageCareCost: 2,
          total: 17,
          days: 1,
        },
      }));
    }
    const economy = weekResultFromLedger(ledger).biomeEconomy!;
    expect(economy).toMatchObject({
      biome: "links",
      maintainedAreaUnits: 1_003,
      plantingWaterUnits: 20,
      policyMultiplier: 1,
      waterCost: 84,
      plantCareCost: 21,
      drainageCareCost: 14,
      total: 119,
      days: 7,
    });
    expect(economy.seasonalDemandMultiplier).toBeCloseTo(.82);
    expect(economy.weatherDemandMultiplier).toBeCloseTo(1.03);
  });

  it("reconciles daily mobility rows into one exact weekly product report", () => {
    let ledger = createWeekLedger(2);
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      ledger = appendDayToLedger(ledger, day(dayIndex, {
        m51: {
          version: 1,
          courses: {
            north: { courseId: "north", walkingRounds: 0, pushcartRounds: 0, ridingCartRounds: 2, observedRounds: 2, observedPaceMinutes: 400, settledRevenue: 40, operatingCosts: 8, stockouts: 0, utilizedUnits: 1, activeRentals: 0, lastSettledWeek: 2 },
          },
          products: [{ productId: "rental:riding_cart", courseId: "north", buildingId: "rental", mode: "riding_cart", rentals: 1, golfers: 2, utilizedUnits: 1, availableUnits: 4, stockouts: 0, returns: 1, damagedReturns: 0, grossRevenue: 40, operatingCosts: 8, netRevenue: 32, wear: .004, endingCondition: 1 - (dayIndex + 1) * .004 }],
          grossRevenue: 40, operatingCosts: 8, netRevenue: 32,
        },
      }));
    }
    const result = weekResultFromLedger(ledger);
    expect(result.m51).toMatchObject({ grossRevenue: 280, operatingCosts: 56, netRevenue: 224 });
    expect(result.m51?.products).toHaveLength(1);
    expect(result.m51?.products[0]).toMatchObject({ rentals: 7, golfers: 14, utilizedUnits: 7, returns: 7, grossRevenue: 280, operatingCosts: 56, netRevenue: 224 });
  });
});
