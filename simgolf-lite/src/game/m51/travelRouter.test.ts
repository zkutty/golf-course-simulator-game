import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { DEFAULT_COURSE } from "../models/defaults";
import { findWalkPath } from "../live/walkPath";
import {
  TimedMobilityLegCache,
  mobilityGeometryVersion,
  planTimedMobilityLeg,
  predictMobilityTravel,
} from "./travelRouter";

function course(width = 12, height = 8): Course {
  return {
    ...DEFAULT_COURSE,
    width, height,
    tiles: new Array(width * height).fill("fairway" as Terrain),
    elevations: new Array(width * height).fill(0),
    holes: [], obstacles: [], buildings: [], decorations: [],
  };
}

function request(courseValue: Course, mode: "walk" | "pushcart" | "riding_cart", from = { x: 1, y: 3 }, to = { x: 10, y: 3 }) {
  return { course: courseValue, courseId: "course-primary", layoutId: "course-primary", mode, from, to } as const;
}

describe("M51 deterministic weighted travel router", () => {
  it("preserves walking route parity while retaining unsimplified timed evidence", () => {
    const fixture = course();
    fixture.tiles[3 * fixture.width + 5] = "water";
    const input = request(fixture, "walk");
    const leg = planTimedMobilityLeg(input);
    expect(leg?.waypoints).toEqual(findWalkPath(fixture, input.from, input.to));
    expect(leg?.cells.length).toBeGreaterThan(leg?.waypoints.length ?? 0);
    expect(leg?.resolvedMode).toBe("walk");
  });

  it("weights pushcarts and riding carts differently, preferring authored path for riding carts", () => {
    const fixture = course();
    for (let x = 1; x <= 10; x++) fixture.tiles[1 * fixture.width + x] = "path";
    const from = { x: 1, y: 3 }; const to = { x: 10, y: 3 };
    const pushcart = planTimedMobilityLeg(request(fixture, "pushcart", from, to))!;
    const riding = planTimedMobilityLeg(request(fixture, "riding_cart", from, to))!;
    expect(riding.cells.some((point) => point.y === 1)).toBe(true);
    expect(riding.minutes).toBeLessThan(pushcart.minutes);
  });

  it("enforces wet/cart-path-only restrictions with a safe walking fallback", () => {
    const fixture = course();
    const riding = planTimedMobilityLeg({ ...request(fixture, "riding_cart"), conditions: { weather: "wet", restrictionId: "rain-a" } });
    expect(riding).toMatchObject({ requestedMode: "riding_cart", resolvedMode: "walk", fallback: "walk" });
    expect(planTimedMobilityLeg({ ...request(fixture, "riding_cart"), conditions: { weather: "wet" }, allowWalkFallback: false })).toBeNull();
  });

  it("keeps carts and pushcarts off protected surfaces and authored blockers", () => {
    const fixture = course(12, 8);
    fixture.tiles[3 * fixture.width + 10] = "green";
    fixture.tiles[2 * fixture.width + 7] = "sand";
    fixture.buildings = [{ id: "shop", type: "pro_shop", x: 5, y: 4, tier: 1, price: 10 }];
    fixture.decorations = [{ kind: "fence", x: 4, y: 2, rotation: 0, span: 3 }];
    expect(planTimedMobilityLeg(request(fixture, "riding_cart", { x: 1, y: 3 }, { x: 10, y: 3 })))
      .toMatchObject({ resolvedMode: "walk", fallback: "walk" });
    expect(planTimedMobilityLeg({ ...request(fixture, "pushcart", { x: 1, y: 2 }, { x: 7, y: 2 }), allowWalkFallback: false })).toBeNull();
  });

  it("uses bridge/boardwalk authority, diagonal corner safety, and cart slope limits", () => {
    const fixture = course(9, 5);
    for (let y = 0; y < fixture.height; y++) fixture.tiles[y * fixture.width + 4] = "water";
    fixture.decorations = [{ kind: "bridge", x: 3, y: 2, rotation: 0, span: 1 }];
    fixture.elevations[2 * fixture.width + 5] = 3;
    const walking = planTimedMobilityLeg(request(fixture, "walk", { x: 1, y: 2 }, { x: 7, y: 2 }))!;
    const cart = planTimedMobilityLeg({ ...request(fixture, "riding_cart", { x: 1, y: 2 }, { x: 7, y: 2 }), allowWalkFallback: false });
    expect(walking.cells).toContainEqual({ x: 4, y: 2 });
    expect(cart).toBeNull();
  });

  it("returns null when neither cart nor walking authority has a route", () => {
    const fixture = course(7, 5);
    for (let y = 0; y < fixture.height; y++) fixture.tiles[y * fixture.width + 3] = "water";
    expect(planTimedMobilityLeg(request(fixture, "pushcart", { x: 1, y: 2 }, { x: 5, y: 2 }))).toBeNull();
  });

  it("keys cache by mode, geometry, weather/restriction identity and supports read-only prediction", () => {
    const fixture = course(); const cache = new TimedMobilityLegCache();
    const input = request(fixture, "riding_cart");
    const first = planTimedMobilityLeg(input, cache)!;
    const second = planTimedMobilityLeg(input, cache)!;
    expect(second).toEqual(first);
    expect(cache.size).toBe(1);
    expect(predictMobilityTravel(input)).toEqual(first);
    const before = mobilityGeometryVersion(fixture);
    fixture.tiles[fixture.width + 4] = "path";
    expect(mobilityGeometryVersion(fixture)).not.toBe(before);
    planTimedMobilityLeg(input, cache);
    planTimedMobilityLeg({ ...input, conditions: { weather: "wet", restrictionId: "rain-b" } }, cache);
    expect(cache.size).toBe(3);
  });

  it("bounds 36-hole/100-golfer planning through deterministic timed-leg reuse", () => {
    const fixture = course(72, 36); const cache = new TimedMobilityLegCache();
    const legs = Array.from({ length: 36 }, (_, index) => ({ from: { x: 1, y: index }, to: { x: 70, y: index } }));
    for (let golfer = 0; golfer < 100; golfer++) for (const leg of legs) {
      expect(planTimedMobilityLeg({ ...request(fixture, "riding_cart", leg.from, leg.to), geometryVersion: "fixture-v1" }, cache)).not.toBeNull();
    }
    expect(cache.size).toBe(36);
  });
});
