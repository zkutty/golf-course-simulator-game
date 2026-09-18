import { describe, expect, it } from "vitest";
import { createZk1202HabitatReferenceCourse } from "./zk1202HabitatFixture";

describe("ZK-1202 habitat fixture", () => {
  it("is deterministic and authors real, legal Parkland tree groves", () => {
    const first = createZk1202HabitatReferenceCourse();
    const second = createZk1202HabitatReferenceCourse();
    expect(first).toEqual(second);
    expect(first.name).toBe("ZK-1202 Parkland Habitat Club");
    expect(first.theme).toBe("parkland");
    expect(first.obstacles.filter((obstacle) => obstacle.type === "tree").length).toBeGreaterThan(50);
    expect(new Set(first.obstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`)).size)
      .toBe(first.obstacles.length);
    for (const obstacle of first.obstacles) {
      expect(["rough", "deep_rough"]).toContain(first.tiles[obstacle.y * first.width + obstacle.x]);
    }
  });
});
