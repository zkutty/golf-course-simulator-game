import { createRetainedShotMotion } from "../rules/shotMotion";
import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { LIVE } from "../live/liveConfig";
import type { Personality } from "../live/personality";
import { TimedItineraryBuilder, ORIGINAL_WALK_PLAN, getOriginalWalkPlan } from "./timedItinerary";

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


describe("retained motion itinerary ownership", () => {
  it("keeps physical rest and shot association while relief remains outside the moving path", () => {
    const at = (x: number, y: number) => ({ point: { x, y }, heightYards: 0 });
    const motion = createRetainedShotMotion({ identity: { shotId: "putt-one", holeId: "one", shotNumber: 1, seed: 7, club: "Putter", style: "putt", modelVersion: "club_styles_v1" },
      yardsPerTile: 10, from: at(1, 1), landing: at(1, 1), physicalRest: at(3, 4), flight: null,
      rollPath: [at(1, 1), at(2, 3), at(3, 4)], reliefPosition: { x: 8, y: 8 }, holed: false })!;
    const builder = new TimedItineraryBuilder({ course: course(), cursor: { x: 1, y: 1 }, personality, rng: () => .5 });
    builder.appendFlight(motion.from.point, motion.reliefPosition!, 0, "putt", undefined, { motion, contactTerrain: "green" });
    expect(builder.segments[0]).toMatchObject({ shotId: "putt-one", holeId: "one", motion, to: { x: 3, y: 4 }, motionContactTerrain: "green" });
    expect(builder.segments[0].to).not.toEqual(motion.reliefPosition);
    builder.appendFlight({ x: 1, y: 1 }, { x: 2, y: 2 }, 0, "putt");
    expect(builder.segments[1]).not.toHaveProperty("motion");
  });
});


describe("presentation-only route timing", () => {
  it("distributes the original walking duration over adapted arclength without a new cap", () => {
    const from = { x: 1, y: 1 }, via = { x: 3, y: 2 }, to = { x: 7, y: 1 };
    const builder = new TimedItineraryBuilder({ course: course(), cursor: from, personality, rng: () => .5,
      route: () => ({ waypoints: [via, to], distance: 8 }) });
    builder.appendWalk(from, to, 0, .1);
    expect(builder.segments.reduce((sum, segment) => sum + segment.dur, 0)).toBeCloseTo(8 * LIVE.pace.walkPerTile, 12);
    expect(builder.segments[0].dur / builder.segments[1].dur).toBeCloseTo(Math.sqrt(5) / Math.sqrt(17), 12);
    expect(builder.segments.at(-1)?.to).toEqual(to);
  });
});


describe("transient original walking authority", () => {
  it("keeps original corners through hole identity spreads without persisting metadata", () => {
    const from = { x: 1, y: 1 }, to = { x: 7, y: 3 };
    const builder = new TimedItineraryBuilder({ course: course(), cursor: from, personality, rng: () => .5,
      route: () => ({ waypoints: [{ x: 2, y: 1.2 }, { x: 4, y: 1 }, { x: 7, y: 3 }], distance: 3 + Math.sqrt(13),
        originalWaypoints: [{ x: 4, y: 1 }, to] }) });
    builder.appendWalk(from, to, 0);
    const mapped = builder.segments.map(segment => ({ ...segment, holeId: "hole-1" }));
    const plan = getOriginalWalkPlan(mapped[0])!;
    expect(plan).toBeDefined(); expect(mapped.every(segment => getOriginalWalkPlan(segment) === plan)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(mapped[0], ORIGINAL_WALK_PLAN)?.enumerable).toBe(true);
    expect(plan.segments.map(segment => [segment.from, segment.to])).toEqual([[from, { x: 4, y: 1 }], [{ x: 4, y: 1 }, to]]);
    expect(plan.segments.reduce((sum, segment) => sum + segment.dur, 0)).toBeCloseTo((3 + Math.sqrt(13)) * LIVE.pace.walkPerTile, 12);
    const loaded = JSON.parse(JSON.stringify(mapped)) as typeof mapped;
    expect(loaded.every(segment => getOriginalWalkPlan(segment) === undefined)).toBe(true);
    expect(loaded.map(segment => Object.getOwnPropertySymbols(segment))).toEqual([[], [], []]);
  });
});
