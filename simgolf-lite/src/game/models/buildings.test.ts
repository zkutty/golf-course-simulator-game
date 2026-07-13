import { describe, expect, it } from "vitest";
import {
  BUILDING_SPECS,
  buildingFootprintSet,
  canPlaceBuilding,
  findClubhouseSpot,
} from "./buildings";
import { DEFAULT_COURSE } from "./defaults";
import { findBestPlayablePath } from "../sim/pathfind";
import type { Course, Terrain } from "./types";

function flatCourse(width = 20, height = 20): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "fairway" as Terrain),
    elevations: Array.from({ length: width * height }, () => 0),
    holes: [],
    obstacles: [],
    buildings: [],
  };
}

describe("buildings", () => {
  it("placement validates bounds, water, slope, markers, obstacles, overlap", () => {
    const c = flatCourse();
    expect(canPlaceBuilding(c, "clubhouse", 5, 5).ok).toBe(true);
    expect(canPlaceBuilding(c, "clubhouse", 18, 5).ok).toBe(false); // 3 wide, out of bounds

    const wet = flatCourse();
    wet.tiles[6 * 20 + 6] = "water";
    expect(canPlaceBuilding(wet, "clubhouse", 5, 5).ok).toBe(false);

    const steep = flatCourse();
    steep.elevations[6 * 20 + 6] = 2;
    expect(canPlaceBuilding(steep, "clubhouse", 5, 5).ok).toBe(false);

    const marked = flatCourse();
    marked.holes = [{ tee: { x: 6, y: 6 }, green: null, parMode: "AUTO" }];
    expect(canPlaceBuilding(marked, "clubhouse", 5, 5).ok).toBe(false);

    const treed = flatCourse();
    treed.obstacles = [{ x: 6, y: 6, type: "tree" }];
    expect(canPlaceBuilding(treed, "clubhouse", 5, 5).ok).toBe(false);

    const built = flatCourse();
    built.buildings = [{ type: "clubhouse", x: 6, y: 6 }];
    expect(canPlaceBuilding(built, "clubhouse", 5, 5).ok).toBe(false); // overlap
    expect(canPlaceBuilding(built, "clubhouse", 10, 10).ok).toBe(true);
  });

  it("footprint set covers the full spec rect", () => {
    const c = flatCourse();
    c.buildings = [{ type: "clubhouse", x: 4, y: 4 }];
    const set = buildingFootprintSet(c);
    const spec = BUILDING_SPECS.clubhouse;
    expect(set.size).toBe(spec.w * spec.d);
    expect(set.has(4 * 20 + 4)).toBe(true);
    expect(set.has(6 * 20 + 6)).toBe(true);
    expect(set.has(7 * 20 + 7)).toBe(false);
  });

  it("findClubhouseSpot lands near the center of clear land, deterministically", () => {
    const c = flatCourse();
    const a = findClubhouseSpot(c);
    const b = findClubhouseSpot(c);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    expect(Math.abs(a!.x - 8.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(a!.y - 8.5)).toBeLessThanOrEqual(2);
  });

  it("golfers path around building footprints", () => {
    const c = flatCourse();
    c.buildings = [{ type: "clubhouse", x: 9, y: 0 }]; // wall segment across the top rows
    const res = findBestPlayablePath(c, { x: 5, y: 1 }, { x: 15, y: 1 })!;
    expect(res).not.toBeNull();
    const blocked = buildingFootprintSet(c);
    for (const p of res.path) {
      expect(blocked.has(p.y * c.width + p.x)).toBe(false);
    }
    expect(res.steps).toBeGreaterThan(10); // forced detour around the footprint
  });
});
