import { describe, expect, it } from "vitest";
import { createZk470PlacementFixture, createZk470SavePayload, persistenceProbe, ZK470_TARGETS } from "./zk470PlacementFixture";

describe("ZK-470A deterministic placement fixture", () => {
  it("boots paused with named, flat and non-flat placement targets", () => {
    const fixture = createZk470PlacementFixture();
    expect(fixture.paused).toBe(true);
    expect(fixture.targets).toEqual(ZK470_TARGETS);
    expect(new Set(fixture.targets.map((target) => target.kind))).toEqual(new Set([
      "flat", "slope", "shoulder", "bunker-rim", "water-bank", "tee", "pin", "prop", "occlusion", "engineering-ring-valid",
    ]));
    expect(fixture.course.buildings).toHaveLength(2);
    expect(fixture.course.tiles).toContain("sand");
    expect(fixture.course.tiles).toContain("water");
  });

  it("round-trips the dedicated persistence slot without canonical drift", () => {
    const first = persistenceProbe(createZk470SavePayload());
    const second = persistenceProbe(createZk470SavePayload());
    expect(first.slot).toBe("zk470a-deterministic-fixture");
    expect(first.beforeHash).toBe(first.afterHash);
    expect(first.firstDifference).toBeNull();
    expect(first).toEqual(second);
  });
});
