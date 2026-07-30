import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course } from "../models/types";
import { emptyM51LiveMobilityState, settleM51MobilityDay } from "./mobility";
import { buildMobilityOperationsReports } from "./operationsReport";

function fixture(): Course {
  return {
    ...DEFAULT_COURSE,
    activeCourseId: "course-primary",
    layouts: [
      { id: "course-primary", name: "Primary", draftHoleIds: [], publishedHoleIds: [], roundLength: 9 as const, state: "open" as const, greenFee: 60 },
      { id: "course-secondary", name: "Secondary", draftHoleIds: [], publishedHoleIds: [], roundLength: 9 as const, state: "open" as const, greenFee: 60 },
    ],
    buildings: [{ id: "rental", type: "cart_rental" as const, x: 2, y: 2, tier: 2, price: 20 }],
    m51: { version: 3 as const, cartRentals: { rental: { buildingId: "rental", tier: 2 as const, products: {
      pushcart: { id: "rental:pushcart", courseId: "course-primary", buildingId: "rental", mode: "pushcart" as const, name: "Pushcart", price: 9, enabled: true },
      riding_cart: { id: "rental:riding_cart", courseId: "course-primary", buildingId: "rental", mode: "riding_cart" as const, name: "Riding Cart", price: 20, enabled: true },
    } } }, fleet: {
      cart: { id: "cart", courseId: "course-primary", buildingId: "rental", productId: "rental:riding_cart", mode: "riding_cart" as const, seats: 2, state: "available" as const, condition: 1, uses: 0, wear: 0 },
    }, settledAssignmentIds: [] },
  };
}

function live() {
  const value = emptyM51LiveMobilityState(44);
  value.assignments.push({ id: "a", groupId: "g", courseId: "course-primary", selectionId: "s", productId: "rental:riding_cart", buildingId: "rental", mode: "riding_cart", fleetUnitIds: ["cart"], riders: [{ golferId: 1, fleetUnitId: "cart", seat: 0 }], status: "released", routeCacheKey: "x", serviceDelayMinutes: 0, availableUnitsAtSelection: 1, actualTravelMinutes: 14, walkingFallbackMinutes: 0, offPathTiles: 0, returnedCondition: 1, seed: 44, decisionOrder: 1 });
  value.transactions.push({ id: "t", courseId: "course-primary", groupId: "g", assignmentId: "a", productId: "rental:riding_cart", buildingId: "rental", golferId: 1, fleetUnitId: "cart", mode: "riding_cart", amount: 20, status: "settled", seed: 44, decisionOrder: 1, authorizedAtMinute: 20, settledAtWeek: 2, settledAtDay: 0 });
  value.observedEvidence.push({ source: "observed", id: "o", courseId: "course-primary", groupId: "g", mode: "riding_cart", completed: true, paceMinutes: 240, cost: 20, satisfaction: 70, predictedWalkingMinutes: 25, actualTravelMinutes: 14, minutesSaved: 11, seed: 44, decisionOrder: 1, settledAtWeek: 2, settledAtDay: 0 });
  value.stockouts.push({ id: "stock", courseId: "course-primary", groupId: "other", buildingId: "rental", productId: "rental:riding_cart", mode: "riding_cart", requiredUnits: 1, availableUnits: 0, decisionOrder: 2 });
  value.selections.push({ id: "s", groupId: "g", courseId: "course-primary", mode: "riding_cart", productId: "rental:riding_cart", status: "confirmed", groupSize: 1, perGolferFee: 20, predictedWalkingMinutes: 25, predictedTravelMinutes: 14, reason: "preference", seed: 44, decisionOrder: 1 });
  return value;
}

describe("M51 operations surface", () => {
  it("reconciles current evidence to the authoritative product settlement without a second charge", () => {
    const course = fixture(); const mobility = live();
    const report = buildMobilityOperationsReports({ course, world: DEFAULT_WORLD, live: mobility, week: 2, dayIndex: 0 }).current;
    expect(report).toMatchObject({ productRevenue: 20, operatingCost: 8, netContribution: 12, completedRentals: 1, stockouts: 1, observedMinutesSaved: 11 });
    expect(report.netContribution).toBe(report.productRevenue - report.operatingCost);
    expect(report.recommendation).toMatchObject({ id: "add-fleet", state: "stockout" });
  });

  it("labels sparse settled history and counts a shared facility once for the active course", () => {
    const course = fixture(); const mobility = live();
    const world = settleM51MobilityDay({ ...DEFAULT_WORLD, week: 2 }, { live: mobility, week: 2, dayIndex: 0 });
    const reports = buildMobilityOperationsReports({ course, world, week: 2, dayIndex: 0 });
    expect(reports.reports7).toMatchObject({ sparse: true, label: "Observed 1-day history (sparse)", fleet: { owned: 1 } });
    expect(reports.reports28.fleet.owned).toBe(1);
    expect(reports.reports7.productRevenue).toBe(20);
  });

  it("keeps stock-out, low-demand, and affordability states factually distinct", () => {
    const course = fixture(); const mobility = live();
    mobility.selections.push({ id: "cheap", groupId: "cheap", courseId: "course-primary", mode: "walk", status: "confirmed", groupSize: 1, perGolferFee: 0, predictedWalkingMinutes: 25, predictedTravelMinutes: 25, reason: "unaffordable_fallback", seed: 44, decisionOrder: 2 });
    mobility.selections.push({ id: "walk", groupId: "walk", courseId: "course-primary", mode: "walk", status: "confirmed", groupSize: 1, perGolferFee: 0, predictedWalkingMinutes: 25, predictedTravelMinutes: 25, reason: "preference", seed: 44, decisionOrder: 3 });
    const demand = buildMobilityOperationsReports({ course, world: DEFAULT_WORLD, live: mobility, week: 2, dayIndex: 0 }).current.demand;
    expect(demand).toEqual({ stockout: 1, lowDemand: 1, unaffordable: 1, evidence: "predicted" });
  });
});
