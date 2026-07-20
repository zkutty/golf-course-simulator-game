import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../models/defaults";
import { deriveGroundCover, visibleGroundCoverTier } from "./groundCover";

describe("deterministic ground cover", () => {
  it("is stable across loads and excluded around markers/buildings", () => {
    const course = { ...DEFAULT_COURSE, tiles: DEFAULT_COURSE.tiles.map(() => "wetland" as const), holes: DEFAULT_COURSE.holes.map((hole, index) => index === 0 ? { ...hole, tee: { x: 5, y: 5 } } : hole) };
    expect(deriveGroundCover(course, 2020, 12, 12)).toEqual(deriveGroundCover(structuredClone(course), 2020, 12, 12));
    const marker = course.holes[0].tee!;
    expect(deriveGroundCover(course, 2020, marker.x, marker.y)).toBeNull();
  });

  it("reduces detail with zoom and render scale", () => {
    expect(visibleGroundCoverTier(.2, 1)).toBe(0);
    expect(visibleGroundCoverTier(.5, 1)).toBe(1);
    expect(visibleGroundCoverTier(1, 1)).toBe(2);
    expect(visibleGroundCoverTier(2, .5)).toBe(0);
  });
});
