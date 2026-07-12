import { describe, expect, it } from "vitest";
import { evalShotBase } from "./shots/shotEval";
import { solveShotsToGreen } from "./shots/solveShotsToGreen";
import { findBestPlayablePath } from "./pathfind";
import { BALANCE } from "../balance/balanceConfig";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Course, Terrain } from "../models/types";
import type { GolferProfile } from "./golferProfiles";

function fairwayCourse(width = 40, height = 20): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "fairway" as Terrain),
    elevations: Array.from({ length: width * height }, () => 0),
    holes: [],
    obstacles: [],
  };
}

const GOLFER: GolferProfile = {
  name: "Test",
  yardsPerTile: 10,
  clubs: [
    { name: "driver", carryYards: 230, dispersionTilesBase: 1.4 },
    { name: "iron", carryYards: 160, dispersionTilesBase: 1.0 },
    { name: "wedge", carryYards: 90, dispersionTilesBase: 0.7 },
  ],
} as unknown as GolferProfile;

const club = { name: "iron", carryYards: 160, dispersionTilesBase: 1.0 };

describe("elevation-aware shots", () => {
  it("uphill targets play longer, downhill shorter, flat unchanged", () => {
    const c = fairwayCourse();
    // 12 tiles = 120y shot along +x; raise the target column by 4 steps.
    const from = { x: 5, y: 10 };
    const to = { x: 17, y: 10 };
    const flat = evalShotBase({ from, to, golfer: GOLFER, club, course: c });

    const up = fairwayCourse();
    up.elevations[to.y * up.width + to.x] = 4;
    const uphill = evalShotBase({ from, to, golfer: GOLFER, club, course: up });

    const down = fairwayCourse();
    down.elevations[from.y * down.width + from.x] = 4;
    const downhill = evalShotBase({ from, to, golfer: GOLFER, club, course: down });

    expect(flat.distanceYards).toBeCloseTo(120, 5);
    expect(uphill.distanceYards).toBeCloseTo(120 + 4 * BALANCE.elevation.shotYardsPerStep, 5);
    expect(downhill.distanceYards).toBeCloseTo(120 - 4 * BALANCE.elevation.shotYardsPerStep, 5);
    expect(uphill.utilization).toBeGreaterThan(flat.utilization);
    expect(downhill.utilization).toBeLessThan(flat.utilization);
  });

  it("omitting the course keeps geometry-only behavior (back-compat)", () => {
    const noCourse = evalShotBase({ from: { x: 0, y: 0 }, to: { x: 12, y: 0 }, golfer: GOLFER, club });
    expect(noCourse.distanceYards).toBeCloseTo(120, 5);
  });

  it("an uphill approach costs at least as much as the flat equivalent through the solver", () => {
    const flat = fairwayCourse();
    const up = fairwayCourse();
    const tee = { x: 4, y: 10 };
    const green = { x: 26, y: 10 }; // 220y
    // Raise a plateau under and around the green (max slope kept legal).
    for (let y = 0; y < up.height; y++) {
      for (let x = 0; x < up.width; x++) {
        const d = Math.max(Math.abs(x - green.x), Math.abs(y - green.y));
        up.elevations[y * up.width + x] = Math.max(0, 4 - Math.max(0, d - 1));
      }
    }
    const flatSolve = solveShotsToGreen({ course: flat, tee, green, golfer: GOLFER });
    const upSolve = solveShotsToGreen({ course: up, tee, green, golfer: GOLFER });
    expect(flatSolve.reachable).toBe(true);
    expect(upSolve.reachable).toBe(true);
    expect(upSolve.expectedShotsToGreen).toBeGreaterThanOrEqual(flatSolve.expectedShotsToGreen);
  });
});

describe("elevation-aware walking", () => {
  it("2+ step cliffs are impassable and force a detour", () => {
    const c = fairwayCourse(20, 9);
    // A vertical cliff wall (elevation 2) at x=10, with a gap at y=8.
    for (let y = 0; y < 8; y++) c.elevations[y * c.width + 10] = 2;
    const res = findBestPlayablePath(c, { x: 5, y: 2 }, { x: 15, y: 2 });
    expect(res).not.toBeNull();
    // The straight route is 10 steps; the detour through the gap is longer.
    expect(res!.steps).toBeGreaterThan(12);
    // No path step crosses a 2-step slope.
    for (let i = 1; i < res!.path.length; i++) {
      const a = res!.path[i - 1];
      const b = res!.path[i];
      const ea = c.elevations[a.y * c.width + a.x];
      const eb = c.elevations[b.y * c.width + b.x];
      expect(Math.abs(ea - eb)).toBeLessThanOrEqual(1);
    }
  });

  it("gentle slopes cost more than flat ground but stay passable", () => {
    const flat = fairwayCourse(20, 9);
    const sloped = fairwayCourse(20, 9);
    // A legal 1-step-per-tile ridge across the direct route.
    for (let y = 0; y < sloped.height; y++) {
      sloped.elevations[y * sloped.width + 9] = 1;
      sloped.elevations[y * sloped.width + 10] = 2;
      sloped.elevations[y * sloped.width + 11] = 1;
    }
    const a = findBestPlayablePath(flat, { x: 5, y: 4 }, { x: 15, y: 4 })!;
    const b = findBestPlayablePath(sloped, { x: 5, y: 4 }, { x: 15, y: 4 })!;
    expect(b.cost).toBeGreaterThan(a.cost);
  });
});
