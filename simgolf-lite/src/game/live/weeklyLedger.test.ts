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
});
