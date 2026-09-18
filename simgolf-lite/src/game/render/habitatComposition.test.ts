import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../utils/canonical";
import { createZk1202HabitatReferenceCourse, ZK1202_HABITAT_SEED } from "../testing/zk1202HabitatFixture";
import {
  deriveHabitatComposition,
  HABITAT_COMPOSITION_CAPS,
} from "./habitatComposition";

describe("habitat composition", () => {
  it("is deterministic across reloads/rotations and uses strict semantic quality subsets", () => {
    const course = createZk1202HabitatReferenceCourse();
    const high = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "high" });
    const medium = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "medium" });
    const low = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "low" });
    const reloaded = structuredClone(course);
    const rotatedCourse = { ...course, activePinRotation: "C" as const };

    expect(high).toEqual(deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "high" }));
    expect(high).toEqual(deriveHabitatComposition({
      course: reloaded,
      worldSeed: ZK1202_HABITAT_SEED,
      quality: "high",
    }));
    expect(high).toEqual(deriveHabitatComposition({
      course: rotatedCourse,
      worldSeed: ZK1202_HABITAT_SEED,
      quality: "high",
    }));
    expect(high).toHaveLength(HABITAT_COMPOSITION_CAPS.high);
    expect(medium).toHaveLength(HABITAT_COMPOSITION_CAPS.medium);
    expect(low).toEqual([]);
    expect(high.slice(0, medium.length).map(({ frame: _frame, ...placement }) => placement))
      .toEqual(medium.map(({ frame: _frame, ...placement }) => placement));
    expect(medium.every((placement) => placement.frame.endsWith("_0"))).toBe(true);
  });

  it("plans named multi-placement masses across every ecological role and tier", () => {
    const course = createZk1202HabitatReferenceCourse();
    const placements = deriveHabitatComposition({
      course,
      worldSeed: ZK1202_HABITAT_SEED,
      quality: "high",
    });
    const membersByMass = new Map<string, number>();
    for (const placement of placements) {
      membersByMass.set(placement.massId, (membersByMass.get(placement.massId) ?? 0) + 1);
      expect(placement.id.startsWith(placement.massId + ":")).toBe(true);
      expect(placement.clusterId.startsWith("grove:")).toBe(true);
    }

    expect(new Set(placements.map((placement) => placement.role)))
      .toEqual(new Set(["woodland_floor", "understory", "rough_mass", "rock_plant_cluster"]));
    expect(new Set(placements.map((placement) => placement.tier)))
      .toEqual(new Set(["near", "middle", "far"]));
    expect([...membersByMass.values()].filter((count) => count >= 2).length).toBeGreaterThanOrEqual(6);
    expect(new Set(placements.map((placement) => placement.clusterId)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(placements.map((placement) => placement.tileX + "," + placement.tileY)).size)
      .toBe(placements.length);
  });

  it("keeps interiors clear of terrain, structures, and obstacle occupancy", () => {
    const course = createZk1202HabitatReferenceCourse();
    const originalObstacles = course.obstacles.map((obstacle) => ({ ...obstacle }));
    const originalHash = hashCanonicalValue(course);
    const originalObstacleHash = hashCanonicalValue(course.obstacles);
    const placements = deriveHabitatComposition({ course, worldSeed: ZK1202_HABITAT_SEED, quality: "high" });
    const forbiddenKinds = new Set(["reeds", "shore_stones", "bunker_tuft", "pebbles"]);
    const hardClearance = new Set(["water", "wetland", "sand", "waste_area", "path"]);
    const occupied = new Set(course.obstacles.map((obstacle) => obstacle.x + "," + obstacle.y));

    expect(placements.every((placement) => !forbiddenKinds.has(placement.kind))).toBe(true);
    for (const placement of placements) {
      expect(["rough", "deep_rough"]).toContain(course.tiles[placement.tileY * course.width + placement.tileX]);
      expect(occupied.has(placement.tileX + "," + placement.tileY)).toBe(false);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        expect(hardClearance.has(course.tiles[(placement.tileY + dy) * course.width + placement.tileX + dx])).toBe(false);
      }
    }
    expect(course.obstacles).toEqual(originalObstacles);
    expect(hashCanonicalValue(course.obstacles)).toBe(originalObstacleHash);
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
