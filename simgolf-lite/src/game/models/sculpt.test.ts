import { describe, expect, it } from "vitest";
import { brushFootprint, computeSculptDeltas, sculptSteps } from "./sculpt";
import { DEFAULT_COURSE } from "./defaults";
import type { Course, Terrain } from "./types";

function flatCourse(width = 12, height = 12): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "rough" as Terrain),
    elevations: Array.from({ length: width * height }, () => 0),
  };
}

function applyDeltas(course: Course, deltas: ReturnType<typeof computeSculptDeltas>): Course {
  const elevations = course.elevations.slice();
  for (const d of deltas) elevations[d.y * course.width + d.x] += d.delta;
  return { ...course, elevations };
}

function maxAdjacentDelta(course: Course): number {
  let max = 0;
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const e = course.elevations[y * course.width + x];
      if (x + 1 < course.width) max = Math.max(max, Math.abs(e - course.elevations[y * course.width + x + 1]));
      if (y + 1 < course.height) max = Math.max(max, Math.abs(e - course.elevations[(y + 1) * course.width + x]));
    }
  }
  return max;
}

describe("sculpt brushes", () => {
  it("brushFootprint sizes: 1 tile, plus ring at 2, wider at 3", () => {
    const c = flatCourse();
    expect(brushFootprint(c, 6, 6, 1)).toHaveLength(1);
    expect(brushFootprint(c, 6, 6, 2)).toHaveLength(9);
    expect(brushFootprint(c, 6, 6, 3).length).toBeGreaterThan(9);
  });

  it("raise lifts the footprint by one step", () => {
    const c = flatCourse();
    const deltas = computeSculptDeltas(c, 6, 6, "raise", 1);
    expect(deltas).toEqual([{ x: 6, y: 6, delta: 1 }]);
  });

  it("repeated raising cascades terraces — never more than 1 step between neighbors", () => {
    let c = flatCourse();
    for (let i = 0; i < 5; i++) {
      c = applyDeltas(c, computeSculptDeltas(c, 6, 6, "raise", 1));
    }
    expect(c.elevations[6 * 12 + 6]).toBe(5);
    expect(maxAdjacentDelta(c)).toBeLessThanOrEqual(1);
    // Cascade cost grows with height: the 5th raise costs more than 1 step.
    const sixth = computeSculptDeltas(c, 6, 6, "raise", 1);
    expect(sculptSteps(sixth)).toBeGreaterThan(1);
  });

  it("lower at base level is a no-op", () => {
    const c = flatCourse();
    expect(computeSculptDeltas(c, 3, 3, "lower", 2)).toEqual([]);
  });

  it("level flattens the footprint to the clicked tile's height", () => {
    let c = flatCourse();
    for (let i = 0; i < 3; i++) c = applyDeltas(c, computeSculptDeltas(c, 6, 6, "raise", 2));
    // Click a base-level tile far away, then level the hill area to it… no:
    // click the hill edge and level neighbors to ITS height.
    const target = c.elevations[6 * 12 + 6];
    const deltas = computeSculptDeltas(c, 6, 6, "level", 3);
    const after = applyDeltas(c, deltas);
    // Footprint tiles all at the clicked height (cascade may adjust the rim).
    for (const { x, y } of brushFootprint(c, 6, 6, 3)) {
      expect(after.elevations[y * 12 + x]).toBe(target);
    }
    expect(maxAdjacentDelta(after)).toBeLessThanOrEqual(1);
  });

  it("smooth erodes a spike toward its neighborhood", () => {
    let c = flatCourse();
    for (let i = 0; i < 4; i++) c = applyDeltas(c, computeSculptDeltas(c, 6, 6, "raise", 1));
    const peak = c.elevations[6 * 12 + 6];
    const after = applyDeltas(c, computeSculptDeltas(c, 6, 6, "smooth", 2));
    expect(after.elevations[6 * 12 + 6]).toBeLessThan(peak);
    expect(maxAdjacentDelta(after)).toBeLessThanOrEqual(1);
  });

  it("never modifies protected tiles (tee/green/water), cascade stops at them", () => {
    const c = flatCourse();
    c.tiles[6 * 12 + 7] = "green";
    c.tiles[6 * 12 + 5] = "water";
    let cur = c;
    for (let i = 0; i < 4; i++) {
      cur = applyDeltas(cur, computeSculptDeltas(cur, 6, 6, "raise", 1));
    }
    expect(cur.elevations[6 * 12 + 7]).toBe(0); // green untouched
    expect(cur.elevations[6 * 12 + 5]).toBe(0); // water untouched
    expect(cur.elevations[6 * 12 + 6]).toBe(4); // hill built beside them
  });

  it("out-of-bounds center is a no-op", () => {
    expect(computeSculptDeltas(flatCourse(), -1, 4, "raise", 1)).toEqual([]);
    expect(computeSculptDeltas(flatCourse(), 4, 99, "raise", 1)).toEqual([]);
  });
});
