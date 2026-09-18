import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../utils/canonical";
import { createZk1202HabitatReferenceCourse, ZK1202_HABITAT_SEED } from "../testing/zk1202HabitatFixture";
import {
  deriveHabitatComposition,
  HABITAT_COMPOSITION_CAPS,
} from "./habitatComposition";

describe("habitat composition", () => {
  it("is deterministic, bounded, and uses strict ranked quality subsets", () => {
    const course = createZk1202HabitatReferenceCourse();
    const high = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "high" });
    const medium = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "medium" });
    const low = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "low" });

    expect(high).toEqual(deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "high" }));
    expect(high).toHaveLength(HABITAT_COMPOSITION_CAPS.high);
    expect(medium).toHaveLength(HABITAT_COMPOSITION_CAPS.medium);
    expect(low).toEqual([]);
    expect(high.slice(0, medium.length).map((placement) => placement.id))
      .toEqual(medium.map((placement) => placement.id));
    expect(medium.every((placement) => placement.frame.endsWith("_0"))).toBe(true);
  });

  it("keeps interiors clear of transitions and never creates collision props", () => {
    const course = createZk1202HabitatReferenceCourse();
    const originalObstacles = course.obstacles.map((obstacle) => ({ ...obstacle }));
    const originalHash = hashCanonicalValue(course);
    const placements = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "high" });
    const forbiddenKinds = new Set(["reeds", "shore_stones", "bunker_tuft", "pebbles"]);
    const hardClearance = new Set(["water", "wetland", "sand", "path"]);

    expect(placements.every((placement) => !forbiddenKinds.has(placement.kind))).toBe(true);
    for (const placement of placements) {
      expect(["rough", "deep_rough"]).toContain(course.tiles[placement.tileY * course.width + placement.tileX]);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        expect(hardClearance.has(course.tiles[(placement.tileY + dy) * course.width + placement.tileX + dx])).toBe(false);
      }
    }
    expect(course.obstacles).toEqual(originalObstacles);
    expect(hashCanonicalValue(course)).toBe(originalHash);
  });

  it("returns no composition for isolated trees", () => {
    const course = createZk1202HabitatReferenceCourse();
    expect(deriveHabitatComposition({
      course: { ...course, obstacles: [{ x: 15, y: 5, type: "tree" }] },
      worldSeed: ZK1202_HABITAT_SEED,
      quality: "high",
    })).toEqual([]);
  });
});
