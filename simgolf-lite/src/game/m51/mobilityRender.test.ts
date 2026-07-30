import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../models/defaults";
import type { GolferRenderData } from "../live/types";
import type { Course } from "../models/types";
import { MOBILITY_VISUAL_FALLBACK, mobilityRenderUnits } from "./mobilityRender";

function golfer(id: number, patch: Partial<GolferRenderData> = {}): GolferRenderData {
  return { id, x: id, y: 4, ballX: null, ballY: null, ballToX: null, ballToY: null, color: "#f00", mood: .7, thought: null, archetype: "casual", segKind: "walk", segT: 0, shot: null, dirX: 1, dirY: 0, scoredHoles: 0, lastHoleDelta: 0, ...patch };
}

function course(): Course {
  return { ...DEFAULT_COURSE, buildings: [{ id: "rental", type: "cart_rental" as const, x: 2, y: 2, tier: 1, price: 20 }], m51: { version: 3 as const, cartRentals: { rental: { buildingId: "rental", tier: 1 as const, products: {
    pushcart: { id: "rental:pushcart", courseId: "course-primary", buildingId: "rental", mode: "pushcart" as const, name: "Pushcart", price: 9, enabled: true },
    riding_cart: { id: "rental:riding_cart", courseId: "course-primary", buildingId: "rental", mode: "riding_cart" as const, name: "Riding Cart", price: 20, enabled: true },
  } } }, fleet: {
    cart: { id: "cart", courseId: "course-primary", buildingId: "rental", productId: "rental:riding_cart", mode: "riding_cart" as const, seats: 2, state: "available" as const, condition: 1, uses: 0, wear: 0 },
    push: { id: "push", courseId: "course-primary", buildingId: "rental", productId: "rental:pushcart", mode: "pushcart" as const, seats: 1, state: "available" as const, condition: 1, uses: 0, wear: 0 },
  }, settledAssignmentIds: [] } };
}

describe("M51 shared mobility render data", () => {
  it("emits one riding cart for shared riders, plus parked fleet and a walking connection", () => {
    const units = mobilityRenderUnits(course(), [
      golfer(1, { mobilityUnitId: "cart", mobilityUnitMode: "riding_cart", mobilityAssignmentId: "a" }),
      golfer(2, { mobilityUnitId: "cart", mobilityUnitMode: "riding_cart", mobilityAssignmentId: "a" }),
      golfer(3, { mobilityUnitMode: "walk", mobilityAssignmentId: "walk-a" }),
    ]);
    expect(units.filter((unit) => unit.id === "cart")).toEqual([expect.objectContaining({ state: "riding_cart", riderIds: [1, 2] })]);
    expect(units).toContainEqual(expect.objectContaining({ id: "push", state: "parked" }));
    expect(units).toContainEqual(expect.objectContaining({ id: "walk:walk-a", state: "walking_connection" }));
  });

  it("stays bounded for a 100-golfer fixture and declares static shape fallbacks", () => {
    const golfers = Array.from({ length: 100 }, (_, id) => golfer(id, { mobilityUnitId: "cart", mobilityUnitMode: "riding_cart", mobilityAssignmentId: "a" }));
    const units = mobilityRenderUnits(course(), golfers);
    expect(units.filter((unit) => unit.id === "cart")).toHaveLength(1);
    expect(units.find((unit) => unit.id === "cart")?.riderIds).toHaveLength(100);
    expect(MOBILITY_VISUAL_FALLBACK).toMatchObject({ optionalAssets: false, reducedMotion: "static" });
    expect(MOBILITY_VISUAL_FALLBACK.colorIndependentShapes).toHaveLength(3);
  });
});
