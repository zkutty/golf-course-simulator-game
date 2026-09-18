import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../utils/canonical";
import {
  createZk470PlacementFixture,
  createZk470SavePayload,
  firstCanonicalDifference,
  persistenceProbe,
  ZK470_TARGETS,
} from "./zk470PlacementFixture";

const terrainAt = (fixture: ReturnType<typeof createZk470PlacementFixture>, x: number, y: number) =>
  fixture.course.tiles[y * fixture.course.width + x];

const elevationAt = (fixture: ReturnType<typeof createZk470PlacementFixture>, x: number, y: number) =>
  fixture.course.elevations[y * fixture.course.width + x];

describe("ZK-470A deterministic placement fixture", () => {
  it("boots paused with named, spatially-valid placement targets", () => {
    const fixture = createZk470PlacementFixture();
    expect(fixture.paused).toBe(true);
    expect(fixture.targets).toEqual(ZK470_TARGETS);
    expect(new Set(fixture.targets.map((target) => target.kind))).toEqual(new Set([
      "flat", "slope", "shoulder", "bunker-rim", "water-bank", "tee", "pin", "prop", "occlusion", "engineering-ring-valid",
    ]));
    expect(fixture.course.buildings).toHaveLength(2);
    expect(fixture.course.tiles).toContain("sand");
    expect(fixture.course.tiles).toContain("water");

    expect([terrainAt(fixture, 20, 20), elevationAt(fixture, 20, 20)]).toEqual(["fairway", 0]);
    expect([terrainAt(fixture, 30, 20), elevationAt(fixture, 30, 20)]).toEqual(["fairway", 2]);
    expect([terrainAt(fixture, 30, 14), elevationAt(fixture, 30, 14)]).toEqual(["rough", 1]);
    expect([terrainAt(fixture, 14, 24), terrainAt(fixture, 11, 24)]).toEqual(["sand", "fairway"]);
    expect([terrainAt(fixture, 20, 31), terrainAt(fixture, 20, 29)]).toEqual(["water", "fairway"]);
    expect(terrainAt(fixture, 9, 10)).toBe("tee");
    expect(terrainAt(fixture, 39, 20)).toBe("green");
    expect(fixture.course.obstacles).toContainEqual({ x: 45, y: 12, type: "tree" });
    expect(fixture.course.buildings).toContainEqual({ id: "zk470-occlusion", type: "clubhouse", x: 50, y: 24 });
    expect(fixture.course.buildings).toContainEqual({
      id: "zk470-engineering-ring",
      type: "pro_shop",
      x: 60,
      y: 20,
      tier: 2,
      price: 28,
    });
  });

  it("round-trips the dedicated persistence slot without canonical drift", () => {
    const payload = createZk470SavePayload();
    const before = canonicalJson(payload);
    const first = persistenceProbe(payload);
    const second = persistenceProbe(createZk470SavePayload());
    expect(first.slot).toBe("zk470a-deterministic-fixture");
    expect(first.beforeHash).toBe(first.afterHash);
    expect(first.firstDifference).toBeNull();
    expect(first.cleanedUp).toBe(true);
    expect(canonicalJson(payload)).toBe(before);
    expect(first).toEqual(second);
  });

  it("reports the first canonical path when a persisted payload drifts", () => {
    const payload = createZk470SavePayload();
    const changed = { ...payload, world: { ...payload.world, cash: payload.world.cash + 1 } };
    expect(firstCanonicalDifference(payload, changed)).toEqual({
      path: "$.world.cash",
      before: 250_000,
      after: 250_001,
    });
  });
});
