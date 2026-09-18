import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import type { GameState } from "../gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./defaults";
import type { Course, Terrain } from "./types";
import { quoteBuildingPlacement } from "./buildings";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult, payloadForPersistence } from "../../utils/save";
import { hashGameState } from "../../utils/stateHash";

function state(): GameState {
  const width = 10;
  const height = 10;
  const course: Course = {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: new Array<Terrain>(width * height).fill("fairway"),
    elevations: new Array(width * height).fill(2),
    holes: structuredClone(DEFAULT_COURSE.holes), obstacles: [], buildings: [], decorations: [], estate: undefined, property: undefined,
  };
  course.elevations[4 * width + 4] = 0;
  course.elevations[4 * width + 5] = 1;
  return {
    course,
    world: { ...DEFAULT_WORLD, cash: 80_000, economicPressure: "balanced" },
    selectedTerrain: "fairway",
    terrainVersion: 0,
    obstaclesVersion: 0,
    markersVersion: 0,
    economyVersion: 0,
  };
}

function roundTrip(input: GameState) {
  return normalizeLoadedSaveResult({
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    savedAt: 123,
    course: input.course,
    world: input.world,
    history: [],
  });
}

describe("engineered building persistence", () => {
  it("round-trips compact site provenance, exact grade, cash, and canonical hash", () => {
    const before = state();
    const quote = quoteBuildingPlacement(before.course, "pro_shop", 4, 4);
    const placed = applyAction(before, { type: "PLACE_BUILDING", buildingType: "pro_shop", x: 4, y: 4, quotedTotal: quote.totalCost });
    const persisted = payloadForPersistence({ course: placed.course, world: placed.world, history: [] });
    const loaded = normalizeLoadedSaveResult({ ...persisted, schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 123 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.course.buildings[0].siteGrade).toEqual(placed.course.buildings[0].siteGrade);
    expect(loaded.payload.course.elevations).toEqual(placed.course.elevations);
    expect(loaded.payload.world.cash).toBe(placed.world.cash);
    const reloaded = normalizeLoadedSaveResult({ ...loaded.payload, schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 124 });
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(hashGameState(reloaded.payload)).toBe(hashGameState(loaded.payload));
  });

  it("loads a legacy invalid site without silent terrain or cash normalization", () => {
    const legacy = state();
    legacy.course.buildings = [{ type: "pro_shop", x: 4, y: 4, tier: 1, price: 22 }];
    const elevations = [...legacy.course.elevations];
    const cash = legacy.world.cash;
    const loaded = roundTrip(legacy);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.course.elevations).toEqual(elevations);
    expect(loaded.payload.world.cash).toBe(cash);
    expect(loaded.payload.course.buildings[0].siteGrade).toBeUndefined();
  });

  it("drops malformed optional grade provenance without dropping the legacy building", () => {
    const malformed = state();
    malformed.course.buildings = [{
      type: "snack_bar", x: 4, y: 4, tier: 1, price: 10,
      siteGrade: { version: 1, supportElevation: Number.NaN, cutSteps: -1, fillSteps: 0, earthworkCost: -5, foundationCost: 0, totalSiteCost: -5 },
    }];
    const loaded = roundTrip(malformed);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.course.buildings).toHaveLength(1);
    expect(loaded.payload.course.buildings[0].siteGrade).toBeUndefined();
  });
});
