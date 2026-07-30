import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { GameState } from "../gameState";
import { createLiveState } from "../live/simulation";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { MOBILITY_BUSINESS, mobilityRentalPreview } from "./rentalBusiness";

function state(cash = 30_000): GameState {
  return {
    course: { ...DEFAULT_COURSE, buildings: [{ id: "rental", type: "cart_rental", x: 3, y: 3, tier: 1, price: 22 }] },
    world: { ...DEFAULT_WORLD, cash }, selectedTerrain: "fairway", terrainVersion: 0, obstaclesVersion: 0, markersVersion: 0, economyVersion: 0,
  };
}

describe("M51 Cart Rental operating business", () => {
  it("enables/disables bounded products and produces deterministic previews", () => {
    const first = applyAction(state(), { type: "CONFIGURE_MOBILITY_PRODUCT", buildingId: "rental", mode: "pushcart", enabled: false, price: 999 });
    const preview = mobilityRentalPreview(first.course, "rental", "pushcart");
    expect(preview).toMatchObject({ enabled: false, price: MOBILITY_BUSINESS.maxPrice, capitalCost: 180, perUseCost: 1.25, serviceMinutes: 1.5, estimatedDemand: 0 });
    expect(mobilityRentalPreview(first.course, "rental", "pushcart")).toEqual(preview);
  });

  it("keeps unaffordable and rapid repeated purchases atomic", () => {
    const poor = state(100); expect(applyAction(poor, { type: "PURCHASE_MOBILITY_FLEET", buildingId: "rental", mode: "pushcart", quantity: 1 })).toMatchObject({ world: { cash: 100 }, economyVersion: 0 });
    let current = state(30_000);
    for (let index = 0; index < 8; index++) current = applyAction(current, { type: "PURCHASE_MOBILITY_FLEET", buildingId: "rental", mode: "pushcart", quantity: 1 });
    const full = current; current = applyAction(current, { type: "PURCHASE_MOBILITY_FLEET", buildingId: "rental", mode: "pushcart", quantity: 1 });
    expect(current).toMatchObject({ world: { cash: full.world.cash }, economyVersion: 8 }); expect(Object.keys(full.course.m51!.fleet)).toHaveLength(8); expect(full.economyVersion).toBe(8);
  });

  it("requires paid tier expansion, honors capacity, and never salvages in-use fleet", () => {
    let current = state(30_000);
    const blockedFreeTier = applyAction(current, { type: "CONFIGURE_BUILDING", x: 3, y: 3, tier: 2 }); expect(blockedFreeTier).toMatchObject({ world: { cash: 30_000 }, economyVersion: 0 });
    current = applyAction(current, { type: "UPGRADE_MOBILITY_RENTAL_TIER", buildingId: "rental" });
    expect(current.course.buildings[0].tier).toBe(2); expect(current.world.cash).toBe(26_000);
    current = applyAction(current, { type: "PURCHASE_MOBILITY_FLEET", buildingId: "rental", mode: "riding_cart", quantity: 2 });
    const activeId = Object.keys(current.course.m51!.fleet)[0]; current = { ...current, course: { ...current.course, m51: { ...current.course.m51!, fleet: { ...current.course.m51!.fleet, [activeId]: { ...current.course.m51!.fleet[activeId], state: "in_use" } } } } };
    const blocked = applyAction(current, { type: "SALVAGE_MOBILITY_FLEET", buildingId: "rental", mode: "riding_cart", quantity: 2 });
    expect(blocked).toMatchObject({ world: { cash: current.world.cash }, economyVersion: current.economyVersion });
    const salvaged = applyAction(current, { type: "SALVAGE_MOBILITY_FLEET", buildingId: "rental", mode: "riding_cart", quantity: 1 });
    expect(Object.keys(salvaged.course.m51!.fleet)).toHaveLength(1);
  });

  it("is replay-safe, leaves an active mid-day snapshot untouched, and migrates legacy rental defaults without a charge", () => {
    const action = { type: "PURCHASE_MOBILITY_FLEET" as const, buildingId: "rental", mode: "pushcart" as const, quantity: 2 };
    const replayA = applyAction(state(), action); const replayB = applyAction(state(), action);
    expect(replayA).toEqual(replayB);
    const live = createLiveState(state().course, state().world, 0); const before = structuredClone(live);
    applyAction(state(), { type: "CONFIGURE_MOBILITY_PRODUCT", buildingId: "rental", mode: "riding_cart", price: 30 });
    expect(live).toEqual(before);
    const legacy = normalizeLoadedSaveResult({ schemaVersion: 21, savedAt: 1, course: state().course, world: state().world, history: [] });
    expect(legacy.ok).toBe(true); if (!legacy.ok) return;
    expect(legacy.payload.world.cash).toBe(state().world.cash);
    expect(legacy.payload.course.m51?.cartRentals.rental.products.riding_cart.price).toBe(22);
  });

  it("rejects hostile action values without version or cash churn", () => {
    const initial = state();
    for (const quantity of [0, -1, 1.5, 99]) expect(applyAction(initial, { type: "PURCHASE_MOBILITY_FLEET", buildingId: "rental", mode: "pushcart", quantity })).toMatchObject({ world: { cash: initial.world.cash }, economyVersion: 0 });
    expect(applyAction(initial, { type: "PURCHASE_MOBILITY_FLEET", buildingId: "missing", mode: "pushcart", quantity: 1 })).toMatchObject({ world: { cash: initial.world.cash }, economyVersion: 0 });
  });
});
