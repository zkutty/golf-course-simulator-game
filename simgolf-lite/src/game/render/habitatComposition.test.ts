import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../utils/canonical";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { createZk1202HabitatReferenceCourse, ZK1202_HABITAT_SEED } from "../testing/zk1202HabitatFixture";
import {
  deriveHabitatComposition,
  HABITAT_COMPOSITION_CAPS,
  HABITAT_COMPOSITION_ROLES,
} from "./habitatComposition";

function massMembers<T extends { readonly massId: string }>(placements: readonly T[]) {
  const output = new Map<string, T[]>();
  for (const placement of placements) {
    const members = output.get(placement.massId) ?? [];
    members.push(placement);
    output.set(placement.massId, members);
  }
  return output;
}

function isEightConnected(members: readonly { readonly tileX: number; readonly tileY: number }[]) {
  if (members.length < 2) return true;
  const remaining = new Map(members.map((member) => [`${member.tileX},${member.tileY}`, member]));
  const first = members[0];
  remaining.delete(`${first.tileX},${first.tileY}`);
  const queue = [first];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const member = queue[cursor];
    for (const [key, neighbor] of remaining) {
      if (Math.max(Math.abs(member.tileX - neighbor.tileX), Math.abs(member.tileY - neighbor.tileY)) > 1) continue;
      remaining.delete(key);
      queue.push(neighbor);
    }
  }
  return remaining.size === 0;
}

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
    for (const members of massMembers(placements).values()) {
      if (members.length >= 3) expect(isEightConnected(members)).toBe(true);
    }
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

  it("keeps fixed M19 normal/detail habitat masses compact and rotation invariant", () => {
    const course = createParklandVisualReferenceCourse();
    const courseHash = hashCanonicalValue(course);
    const obstacleHash = hashCanonicalValue(course.obstacles);
    const high = deriveHabitatComposition({ course, worldSeed: 12_160, quality: "high" });
    const medium = deriveHabitatComposition({ course, worldSeed: 12_160, quality: "medium" });
    const summary = (placements: readonly typeof high[number][]) => ({
      rendered: placements.length,
      compactMasses: [...massMembers(placements).values()].filter((members) => members.length >= 3).length,
      roles: Object.fromEntries(HABITAT_COMPOSITION_ROLES.map((role) => [
        role,
        placements.filter((placement) => placement.role === role).length,
      ])),
    });

    // These values are a world-space contract for the real M19 fixture, not
    // the dedicated secondary ecology fixture used by the earlier packet.
    expect(summary(medium)).toEqual({ rendered: 84, compactMasses: 21, roles: {
      woodland_floor: 28, understory: 27, rough_mass: 21, rock_plant_cluster: 8,
    } });
    expect(summary(high)).toEqual({ rendered: 160, compactMasses: 41, roles: {
      woodland_floor: 58, understory: 43, rough_mass: 42, rock_plant_cluster: 17,
    } });
    expect(medium.map(({ frame: _frame, ...placement }) => placement))
      .toEqual(high.slice(0, medium.length).map(({ frame: _frame, ...placement }) => placement));
    expect(deriveHabitatComposition({
      course: { ...course, activePinRotation: "C" }, worldSeed: 12_160, quality: "high",
    })).toEqual(high);
    for (const members of massMembers(high).values()) {
      if (members.length >= 3) expect(isEightConnected(members)).toBe(true);
    }
    expect(hashCanonicalValue(course)).toBe(courseHash);
    expect(hashCanonicalValue(course.obstacles)).toBe(obstacleHash);
  });
});
