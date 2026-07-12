import { describe, expect, it } from "vitest";
import {
  ELEVATION_MAX,
  clampElevation,
  getElevation,
  makeFlatElevations,
  maxSlopeInRect,
  slopeBetween,
  withNormalizedElevations,
} from "./elevation";
import { DEFAULT_COURSE } from "./defaults";
import { generateElevations, generateWildLandWithObstacles } from "../gen/generateWildLand";
import { computeElevationChangeCost, ELEVATION_COST_PER_STEP } from "./terrainEconomics";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE } from "../gameState";
import type { Course } from "./types";

function courseWith(elevations: number[] | undefined, width = 4, height = 3): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "rough" as const),
    elevations: elevations as number[],
  };
}

describe("elevation model", () => {
  it("makeFlatElevations builds a zeroed grid", () => {
    const e = makeFlatElevations(5, 4);
    expect(e).toHaveLength(20);
    expect(e.every((v) => v === 0)).toBe(true);
  });

  it("clampElevation clamps and rounds to integer steps", () => {
    expect(clampElevation(-3)).toBe(0);
    expect(clampElevation(2.6)).toBe(3);
    expect(clampElevation(ELEVATION_MAX + 5)).toBe(ELEVATION_MAX);
  });

  it("getElevation reads base level out of bounds and on legacy courses", () => {
    const c = courseWith([0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(getElevation(c, 1, 0)).toBe(1);
    expect(getElevation(c, -1, 0)).toBe(0);
    expect(getElevation(c, 99, 99)).toBe(0);
    const legacy = courseWith(undefined);
    expect(getElevation(legacy, 2, 2)).toBe(0);
  });

  it("slopeBetween and maxSlopeInRect measure deltas", () => {
    const c = courseWith([0, 1, 2, 3, 0, 0, 5, 0, 0, 0, 0, 0]);
    expect(slopeBetween(c, 0, 0, 3, 0)).toBe(3);
    expect(slopeBetween(c, 3, 0, 0, 0)).toBe(-3);
    expect(maxSlopeInRect(c, 0, 0, 3, 2)).toBe(5);
    expect(maxSlopeInRect(c, 0, 1, 1, 2)).toBe(0);
  });

  it("withNormalizedElevations fills missing/short arrays (save migration)", () => {
    const missing = withNormalizedElevations(courseWith(undefined));
    expect(missing.elevations).toHaveLength(12);
    expect(missing.elevations.every((v) => v === 0)).toBe(true);

    const short = withNormalizedElevations(courseWith([7, 99]));
    expect(short.elevations).toHaveLength(12);
    expect(short.elevations[0]).toBe(7);
    expect(short.elevations[1]).toBe(ELEVATION_MAX); // clamped
    expect(short.elevations[2]).toBe(0);

    const exact = courseWith(makeFlatElevations(4, 3));
    expect(withNormalizedElevations(exact)).toBe(exact); // no copy when well-formed
  });
});

describe("elevation generation", () => {
  it("is deterministic from the seed and stays within gentle bounds", () => {
    const { tiles } = generateWildLandWithObstacles(40, 30, 1234);
    const a = generateElevations(40, 30, 1234, tiles);
    const b = generateElevations(40, 30, 1234, tiles);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1200);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(4);
    // Rolling, not flat: some variation must exist.
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it("keeps water at base level", () => {
    const { tiles, elevations } = generateWildLandWithObstacles(50, 40, 42);
    tiles.forEach((t, i) => {
      if (t === "water") expect(elevations[i]).toBe(0);
    });
  });

  it("different seeds produce different landscapes", () => {
    const { tiles } = generateWildLandWithObstacles(40, 30, 1);
    const a = generateElevations(40, 30, 1, tiles);
    const b = generateElevations(40, 30, 2, tiles);
    expect(a).not.toEqual(b);
  });
});

describe("SCULPT_TILES reducer action", () => {
  it("applies clamped deltas and charges earthworks per applied step", () => {
    const state = DEFAULT_STATE;
    const next = applyAction(state, {
      type: "SCULPT_TILES",
      deltas: [
        { x: 2, y: 2, delta: 2 },
        { x: 3, y: 2, delta: -1 }, // already at 0 → clamped, no charge
      ],
    });
    const idx = 2 * state.course.width + 2;
    expect(next.course.elevations[idx]).toBe(2);
    expect(next.world.cash).toBe(state.world.cash - computeElevationChangeCost(2).net);
  });

  it("charges the same for lowering as raising, with no salvage", () => {
    expect(computeElevationChangeCost(3).net).toBe(3 * ELEVATION_COST_PER_STEP);
    expect(computeElevationChangeCost(-3).net).toBe(3 * ELEVATION_COST_PER_STEP);
    expect(computeElevationChangeCost(-3).refunded).toBe(0);
  });

  it("is a no-op (same state object) when nothing applies", () => {
    const state = DEFAULT_STATE;
    const next = applyAction(state, {
      type: "SCULPT_TILES",
      deltas: [{ x: 1, y: 1, delta: -1 }], // clamped at base level
    });
    expect(next.course.elevations ?? state.course.elevations).toEqual(state.course.elevations);
    expect(next.world.cash).toBe(state.world.cash);
  });

  it("ignores out-of-bounds deltas", () => {
    const state = DEFAULT_STATE;
    const next = applyAction(state, {
      type: "SCULPT_TILES",
      deltas: [{ x: -5, y: 0, delta: 3 }, { x: 9999, y: 0, delta: 3 }],
    });
    expect(next.world.cash).toBe(state.world.cash);
  });
});
