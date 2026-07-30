import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { LIVE } from "../live/liveConfig";
import type { Personality } from "../live/personality";
import { TimedItineraryBuilder } from "./timedItinerary";

const personality: Personality = {
  skill: .6,
  consistency: .6,
  patience: .5,
  spendPropensity: 1,
  prefs: { difficulty: 0, scenery: 0, price: 0 },
};

function course(): Course {
  const width = 40;
  const height = 20;
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "fairway" as Terrain),
    elevations: Array.from({ length: width * height }, () => 0),
    holes: [],
    obstacles: [],
    buildings: [{ type: "cart_rental", x: 10, y: 5, tier: 1, price: 18 }],
    yardsPerTile: 10,
    name: "Timed itinerary",
    baseGreenFee: 65,
    condition: .8,
  };
}

describe("M51 shared timed itinerary", () => {
  it("keeps legacy walking timing when a future mobility mode is selected", () => {
    const noRoute = new TimedItineraryBuilder({
      course: course(), cursor: { x: 1, y: 1 }, personality, rng: () => .5,
      route: () => null, mode: "riding_cart",
    });
    noRoute.appendWalk({ x: 1, y: 1 }, { x: 31, y: 1 }, 0, 4);
    expect(noRoute.mode).toBe("riding_cart");
    expect(noRoute.segments).toEqual([{
      kind: "walk", from: { x: 1, y: 1 }, to: { x: 31, y: 1 }, holeIndex: 0, dur: 4,
    }]);

    const routed = new TimedItineraryBuilder({
      course: course(), cursor: { x: 1, y: 1 }, personality, rng: () => .5,
      route: () => [{ x: 4, y: 1 }, { x: 7, y: 1 }],
    });
    routed.appendWalk({ x: 1, y: 1 }, { x: 7, y: 1 }, 0, 1);
    expect(routed.segments.map((segment) => segment.dur)).toEqual([3 * LIVE.pace.walkPerTile, 3 * LIVE.pace.walkPerTile]);
  });

  it("reserves the wallet once while leaving live transaction ownership unchanged", () => {
    const builder = new TimedItineraryBuilder({ course: course(), cursor: { x: 1, y: 1 }, personality, rng: () => 0, wallet: 40 });
    expect(builder.visitConcession("cart_rental", -1)).toBe(true);
    expect(builder.wallet).toBe(22);
    expect(builder.cursor).toEqual({ x: 11, y: 7 });
    expect(builder.segments.filter((segment) => segment.concession)).toHaveLength(1);
    expect(builder.segments.find((segment) => segment.concession)?.concession).toMatchObject({ amount: 18, buildingType: "cart_rental" });
  });
});
