import { describe, expect, it } from "vitest";
import { BALANCE } from "../balance/balanceConfig";
import { generateWildLand } from "../gen/generateWildLand";
import { findWalkPath } from "../live/walkPath";
import { landingBehavior } from "../render/ballFlight";
import { computeExpectedLandingPenalty } from "../sim/shots/landingPenalty";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./defaults";
import { computeTerrainChangeCost } from "./terrainEconomics";
import type { Course, LandTheme, Terrain } from "./types";
import { normalizeLoadedSaveResult } from "../../utils/save";

function strip(terrain: Terrain): Course {
  return { ...DEFAULT_COURSE, width: 5, height: 3, tiles: Array.from({ length: 15 }, () => terrain), elevations: Array(15).fill(0), holes: [], obstacles: [], buildings: [] };
}

describe("M20 terrain rules", () => {
  it("migrates schema-v4 saves without rewriting their terrain", () => {
    const legacyTiles = [...DEFAULT_COURSE.tiles];
    legacyTiles.splice(0, 5, "rough", "fairway", "sand", "water", "path");
    const result = normalizeLoadedSaveResult({
      schemaVersion: 4, savedAt: 1,
      course: { ...DEFAULT_COURSE, tiles: legacyTiles },
      world: DEFAULT_WORLD, history: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(4);
    expect(result.payload.course.tiles).toEqual(legacyTiles);
  });

  it("keeps waste walkable and wetlands impassable", () => {
    const waste = strip("waste_area");
    expect(findWalkPath(waste, { x: 0, y: 1 }, { x: 4, y: 1 })).not.toBeNull();
    const wet = { ...waste, tiles: [...waste.tiles] };
    for (let y = 0; y < wet.height; y++) wet.tiles[y * wet.width + 2] = "wetland";
    expect(findWalkPath(wet, { x: 0, y: 1 }, { x: 4, y: 1 })).toBeNull();
  });

  it("gives both surfaces distinct economics, lies, and rollout", () => {
    expect(computeTerrainChangeCost("rough", "waste_area").charged).not.toBe(computeTerrainChangeCost("rough", "sand").charged);
    expect(computeTerrainChangeCost("rough", "wetland").charged).not.toBe(computeTerrainChangeCost("rough", "water").charged);
    const wastePenalty = computeExpectedLandingPenalty({ course: strip("waste_area"), target: { x: 2, y: 1 }, dispersionTiles: .5 }).expectedPenalty;
    expect(wastePenalty).toBeGreaterThan(BALANCE.shots.landing.penaltyStrokes.rough);
    expect(wastePenalty).toBeLessThan(BALANCE.shots.landing.penaltyStrokes.sand);
    expect(landingBehavior("waste_area").rollTiles).toBeGreaterThan(landingBehavior("sand").rollTiles);
    expect(landingBehavior("wetland")).toMatchObject({ sinks: true, fx: "splash" });
  });

  it("generates environmental surfaces deterministically in every theme", () => {
    for (const theme of ["parkland", "links", "desert"] as LandTheme[]) {
      const a = generateWildLand(80, 60, 2020, theme);
      const b = generateWildLand(80, 60, 2020, theme);
      expect(a).toEqual(b);
      expect(a).toContain("waste_area");
      expect(a).toContain("wetland");
    }
  });
});
