import { describe, expect, it } from "vitest";
import { createNewGame } from "../gen/newGame";
import type { GameSetup } from "../models/setup";
import { isOwnedTile } from "../estate/estate";
import { applyPropertyCommand, normalizePropertyCourse, propertyAccessCapacity } from "./property";
import { installStarterArrival, validateStarterArrival } from "./starterArrival";

function setup(seed: number, theme: GameSetup["theme"]): GameSetup {
  return { mode: "sandbox", courseName: "Arrival Fixture", seed, theme, difficulty: "normal" };
}

describe("ZK-775 starter arrival plan", () => {
  it.each(["parkland", "links", "desert"] as const)("builds deterministic connected %s arrivals across difficult seeds", (theme) => {
    for (const seed of [1, 7, 24, 42, 66, 1234, 424242, 99001]) {
      const first = createNewGame(setup(seed, theme));
      const second = createNewGame(setup(seed, theme));
      const validation = validateStarterArrival(first.course);
      expect(validation.ok, `${theme}/${seed}: ${validation.reason}`).toBe(true);
      expect(validation.plan).toBeDefined();
      expect(first.course.property?.assets.slice(0, 2)).toEqual(second.course.property?.assets.slice(0, 2));
      expect(first.world.cash).toBe(second.world.cash);

      const plan = validation.plan!;
      const traversed = [...plan.driveway, ...plan.pedestrianRoute];
      for (const point of traversed) {
        const terrain = first.course.tiles[point.y * first.course.width + point.x];
        expect(isOwnedTile(first.course, point.x, point.y)).toBe(true);
        expect(["water", "wetland"]).not.toContain(terrain);
        expect(first.course.obstacles.some((obstacle) => obstacle.x === point.x && obstacle.y === point.y)).toBe(false);
      }
      expect(plan.driveway.length).toBeGreaterThan(1);
      expect(plan.pedestrianRoute.at(-1)).toEqual(plan.clubhouseEntrance);
      expect(propertyAccessCapacity(first.course)).toBeGreaterThanOrEqual(40);
    }
  });

  it("round-trips route metadata and rejects a broken authoritative graph", () => {
    const { course } = createNewGame(setup(424242, "parkland"));
    const normalized = { ...course, property: normalizePropertyCourse(JSON.parse(JSON.stringify(course.property))) };
    expect(validateStarterArrival(normalized).ok).toBe(true);

    const assets = normalized.property!.assets.map((asset) => asset.id === "property-road-starter"
      ? { ...asset, route: { ...asset.route!, points: asset.route!.points.slice(0, -1) } }
      : asset);
    const disconnected = { ...normalized, property: { ...normalized.property!, assets } };
    expect(validateStarterArrival(disconnected)).toMatchObject({ ok: false, reason: "driveway does not join clubhouse parking" });
    expect(propertyAccessCapacity(disconnected)).toBe(0);
  });

  it("replaces only canonical starter access and preserves customized property assets", () => {
    const { course } = createNewGame(setup(7, "links"));
    const custom = { ...course.property!.assets[1], id: "custom-overflow", kind: "overflow_parking" as const, name: "Custom overflow" };
    const replanned = installStarterArrival({ ...course, property: { ...course.property!, assets: [...course.property!.assets, custom] } });
    expect(replanned.property?.assets.filter((asset) => asset.id === "property-road-starter")).toHaveLength(1);
    expect(replanned.property?.assets.filter((asset) => asset.id === "property-parking-starter")).toHaveLength(1);
    expect(replanned.property?.assets).toContainEqual(custom);
  });

  it("explains and enforces the access impact of later player edits", () => {
    const run = createNewGame(setup(42, "parkland"));
    const closed = applyPropertyCommand(run.course, run.world, { type: "TOGGLE", assetId: "property-road-starter" });
    expect(closed.ok).toBe(true);
    expect(closed.message).toMatch(/access is disconnected.*arrivals pause/i);
    expect(propertyAccessCapacity(closed.course, closed.world)).toBe(0);

    const removed = applyPropertyCommand(run.course, run.world, { type: "REMOVE", assetId: "property-parking-starter" });
    expect(removed.ok).toBe(true);
    expect(removed.message).toMatch(/access is disconnected.*arrivals pause/i);
    expect(propertyAccessCapacity(removed.course, removed.world)).toBe(0);
  });
});
