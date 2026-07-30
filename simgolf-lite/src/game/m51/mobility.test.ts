import { describe, expect, it } from "vitest";
import { BALANCE } from "../balance/balanceConfig";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import {
  emptyM51LiveMobilityState,
  mobilityEvidenceLabel,
  mobilityRouteCacheKey,
  normalizeM51CourseMobilityState,
  normalizeM51MobilityState,
  settleM51MobilityDay,
} from "./mobility";

const rentalCourse = {
  ...DEFAULT_COURSE,
  buildings: [{ id: "rental-a", type: "cart_rental" as const, x: 2, y: 2, tier: 2 as const, price: 32 }],
};

describe("M51 mobility foundation contracts", () => {
  it("creates deterministic group-level cache identities without owning a second route cache", () => {
    const identity = { courseId: "course-primary", layoutId: "course-primary", mode: "riding_cart" as const, from: { x: 2.2, y: 4.8 }, to: { x: 12.1, y: 18.9 } };
    expect(mobilityRouteCacheKey(identity)).toBe("m51:course-primary:course-primary:riding_cart:2,5>12,19");
    expect(mobilityRouteCacheKey(identity)).toBe(mobilityRouteCacheKey({ ...identity }));
    expect(mobilityRouteCacheKey({ ...identity, mode: "walk" })).not.toBe(mobilityRouteCacheKey(identity));
    expect(mobilityEvidenceLabel(1, 0)).toBe("predicted");
    expect(mobilityEvidenceLabel(1, 1)).toBe("mixed");
    expect(mobilityEvidenceLabel(0, 1)).toBe("observed");
  });

  it("migrates Cart Rental offers/fleet to portable course ownership and bounds durable history", () => {
    const transactions = Array.from({ length: BALANCE.mobility.maxHistoryTransactions + 4 }, (_, index) => ({
      id: `tx-${String(index).padStart(3, "0")}`, courseId: "course-primary", groupId: `group-${index}`, mode: "riding_cart", status: "settled", amount: 32,
      seed: index, decisionOrder: index, authorizedAtMinute: 100, settledAtWeek: 1, settledAtDay: index % 7,
    }));
    const observedEvidence = Array.from({ length: BALANCE.mobility.maxObservedEvidence + 4 }, (_, index) => ({
      source: "observed" as const, id: `evidence-${String(index).padStart(3, "0")}`, courseId: "course-primary", groupId: `group-${index}`, mode: "riding_cart" as const,
      completed: true, paceMinutes: 220, cost: 32, satisfaction: 82, seed: index, decisionOrder: index, settledAtWeek: 1, settledAtDay: index % 7,
    }));
    const legacy = { version: 1, products: { "cart-standard": { id: "cart-standard", courseId: "course-primary", mode: "riding_cart", name: "Standard cart", price: 32, enabled: true } }, fleet: { "cart-01": { id: "cart-01", courseId: "course-primary", productId: "cart-standard", mode: "riding_cart", seats: 2, state: "available" } }, history: { settledTransactions: [...transactions, { ...transactions[0], id: "not-settled", status: "authorized" }], observedEvidence } };
    const first = normalizeM51MobilityState(legacy);
    const second = normalizeM51MobilityState({ ...legacy, history: { settledTransactions: transactions, observedEvidence } });
    const courseMobility = normalizeM51CourseMobilityState(undefined, rentalCourse, legacy);
    expect(first).toEqual(second);
    expect(courseMobility.cartRentals["rental-a"]?.products.riding_cart.price).toBe(32);
    expect(courseMobility.cartRentals["rental-a"]?.products.pushcart.price).toBe(BALANCE.mobility.pushcartDefaultPrice);
    expect(courseMobility.fleet["cart-01"]?.productId).toBe("rental-a:riding_cart");
    expect(first.history.settledTransactions).toHaveLength(BALANCE.mobility.maxHistoryTransactions);
    expect(first.history.observedEvidence).toHaveLength(BALANCE.mobility.maxObservedEvidence);
    // Bound is deliberately small enough for browser-save and live-resume use.
    expect(JSON.stringify({ first, courseMobility }).length).toBeLessThan(180_000);
  });

  it("settles only settled/observed live facts at the existing day boundary without mutating cash", () => {
    const live = emptyM51LiveMobilityState(51_538);
    live.transactions.push(
      { id: "hold", courseId: "course-primary", groupId: "group-1", mode: "riding_cart", amount: 32, status: "authorized", seed: 1, decisionOrder: 1, authorizedAtMinute: 10 },
      { id: "settled", courseId: "course-primary", groupId: "group-1", assignmentId: "assignment-1", productId: "rental-a:riding_cart", buildingId: "rental-a", mode: "riding_cart", amount: 32, status: "settled", seed: 2, decisionOrder: 2, authorizedAtMinute: 10 },
    );
    live.observedEvidence.push({ source: "observed", id: "observation-1", courseId: "course-primary", groupId: "group-1", mode: "riding_cart", completed: true, paceMinutes: 218, cost: 32, satisfaction: 84, predictedWalkingMinutes: 250, actualTravelMinutes: 180, minutesSaved: 70, walkingFallbackMinutes: 12, offPathTiles: 8, seed: 2, decisionOrder: 2, settledAtWeek: 0, settledAtDay: 0 });
    const settled = settleM51MobilityDay({ ...DEFAULT_WORLD, cash: 1234 }, { live, week: 3, dayIndex: 2 });
    expect(settled.cash).toBe(1234);
    expect(settled.m51?.history.settledTransactions).toMatchObject([{ id: "settled", settledAtWeek: 3, settledAtDay: 2 }]);
    expect(settled.m51?.history.observedEvidence).toMatchObject([{ id: "observation-1", settledAtWeek: 3, settledAtDay: 2 }]);
    expect(settleM51MobilityDay(settled, { live, week: 3, dayIndex: 2 }).m51?.history.settledTransactions).toHaveLength(1);
  });
});
