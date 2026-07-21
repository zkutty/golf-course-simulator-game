import { describe, expect, it } from "vitest";
import { createNewGame } from "../gen/newGame";
import { applyAction } from "../../core/reducer";
import type { GameState } from "../gameState";
import { canPurchaseParcel, decodeElevationBaseline, decodeParcelMap, decodeTerrainBaseline, isOwnedTile } from "./estate";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Terrain } from "../models/types";
import { createLiveState, stepLive } from "../live/simulation";
import { snapshotLiveSimulation } from "../live/persistence";
import type { Action } from "../../core/actions";

function game(seed = 250025): GameState {
  const { course, world } = createNewGame({ mode: "sandbox", courseName: "Estate Test", seed, theme: "parkland", difficulty: "normal", sandboxOverrides: { startingCash: 2_000_000 } });
  return { course, world, selectedTerrain: "fairway", terrainVersion: 0, obstaclesVersion: 0, markersVersion: 0, economyVersion: 0 };
}

describe("M25 deterministic estates", () => {
  it("reproduces a complete contiguous nine-parcel topology and compact baseline", () => {
    const a = game(12345).course;
    const b = game(12345).course;
    expect(a.width).toBe(220);
    expect(a.height).toBe(140);
    expect(a.estate).toEqual(b.estate);
    const estate = a.estate!;
    const map = decodeParcelMap(estate, a.width * a.height)!;
    expect(new Set(map)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    expect(map).toHaveLength(a.width * a.height);
    expect(estate.ownedParcelIds).toEqual([estate.starterParcelId]);
    expect(JSON.stringify({ schemaVersion: 8, course: a, world: game(12345).world }).length).toBeLessThan(5_000_000);
    expect(decodeTerrainBaseline(estate.naturalBaseline.terrainRle, map.length)).toEqual(a.tiles);
    expect(decodeElevationBaseline(estate.naturalBaseline.elevationRle, map.length)).toEqual(a.elevations);

    for (let parcelIndex = 0; parcelIndex < 9; parcelIndex++) {
      const first = map.indexOf(parcelIndex);
      const seen = new Set([first]);
      const queue = [first];
      while (queue.length) {
        const index = queue.shift()!;
        const x = index % a.width;
        const y = Math.floor(index / a.width);
        for (const next of [x > 0 ? index - 1 : -1, x + 1 < a.width ? index + 1 : -1, y > 0 ? index - a.width : -1, y + 1 < a.height ? index + a.width : -1]) {
          if (next >= 0 && map[next] === parcelIndex && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      expect(seen.size).toBe(estate.parcels[parcelIndex].tileCount);
    }
  });

  it("purchases adjacent land atomically while rejecting invalid transactions", () => {
    const state = game();
    const estate = state.course.estate!;
    const adjacent = estate.parcels.find((parcel) => parcel.id !== estate.starterParcelId && parcel.adjacentParcelIds.includes(estate.starterParcelId))!;
    const remote = estate.parcels.find((parcel) => parcel.id !== estate.starterParcelId && !parcel.adjacentParcelIds.includes(estate.starterParcelId))!;
    expect(canPurchaseParcel(state.course, state.world.cash, adjacent.id).ok).toBe(true);
    expect(canPurchaseParcel(state.course, state.world.cash, remote.id)).toMatchObject({ ok: false, reason: "non-adjacent" });
    expect(applyAction(state, { type: "PURCHASE_PARCEL", parcelId: remote.id })).toEqual(state);

    const bought = applyAction(state, { type: "PURCHASE_PARCEL", parcelId: adjacent.id });
    expect(bought.course.estate?.ownedParcelIds).toContain(adjacent.id);
    expect(bought.world.cash).toBe(state.world.cash - adjacent.appraisal.total);
    expect(bought.course.estate?.naturalBaseline).toEqual(estate.naturalBaseline);
    expect(applyAction(bought, { type: "PURCHASE_PARCEL", parcelId: adjacent.id })).toEqual(bought);

    const poor = { ...state, world: { ...state.world, cash: adjacent.appraisal.total - 1 } };
    expect(applyAction(poor, { type: "PURCHASE_PARCEL", parcelId: adjacent.id })).toEqual(poor);
  });

  it("makes ownership authoritative for every construction family", () => {
    const state = game();
    const target = state.course.estate!.parcels.find((parcel) => !state.course.estate!.ownedParcelIds.includes(parcel.id))!.center;
    expect(isOwnedTile(state.course, target.x, target.y)).toBe(false);
    const actions: Action[] = [
      { type: "PAINT_TILES", tiles: [{ ...target, terrain: "fairway" }] },
      { type: "SCULPT_TILES", deltas: [{ ...target, delta: 1 }] },
      { type: "PLACE_OBSTACLE", ...target, obstacleType: "tree" },
      { type: "PLACE_BUILDING", ...target, buildingType: "snack_bar" },
      { type: "PLACE_DECORATION", decoration: { kind: "bench", ...target, rotation: 0 } },
      { type: "PLACE_TEE", holeIndex: 0, position: target },
      { type: "PLACE_GREEN", holeIndex: 0, position: target },
      { type: "ADD_WAYPOINT", holeIndex: 0, position: target, segmentIndex: 0 },
    ];
    for (const action of actions) expect(applyAction(state, action)).toEqual(state);
  });

  it("centers v7 courses and translates active live state into the starter parcel", () => {
    const width = 110; const height = 70;
    const tiles = new Array<Terrain>(width * height).fill("fairway");
    const tee = { x: 4, y: 12 }; const green = { x: 50, y: 12 };
    tiles[tee.y * width + tee.x] = "tee"; tiles[green.y * width + green.x] = "green";
    const legacy: Course = {
      width, height, tiles, elevations: new Array(width * height).fill(0),
      holes: [{ tee, green, waypoints: [{ x: 25, y: 12 }], parMode: "AUTO" }],
      obstacles: [{ x: 8, y: 8, type: "tree" }], buildings: [{ type: "clubhouse", x: 1, y: 1 }],
      decorations: [{ kind: "bench", x: 10, y: 10, rotation: 0 }], yardsPerTile: 10, name: "Legacy", baseGreenFee: 65, condition: .8, theme: "parkland",
    };
    const liveState = createLiveState(legacy, DEFAULT_WORLD, 0);
    let guard = 0;
    while (!liveState.golfers.length && guard++ < 2_000) stepLive(liveState, legacy, 1);
    stepLive(liveState, legacy, .75);
    const originalPosition = { ...liveState.golfers[0].pos };
    const result = normalizeLoadedSaveResult({ schemaVersion: 7, savedAt: 1, course: legacy, world: DEFAULT_WORLD, live: snapshotLiveSimulation({ state: liveState, pendingCash: 0, speed: "paused", selectedGolferId: null }) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.course.holes[0].tee).toEqual({ x: tee.x + 55, y: tee.y + 35 });
    expect(result.payload.course.holes[0].waypoints?.[0]).toEqual({ x: 80, y: 47 });
    expect(result.payload.course.buildings[0]).toMatchObject({ x: 56, y: 36 });
    expect(result.payload.course.decorations?.[0]).toMatchObject({ x: 65, y: 45 });
    expect(result.payload.live?.state.golfers[0].pos).toEqual({ x: originalPosition.x + 55, y: originalPosition.y + 35 });
    const estate = result.payload.course.estate!;
    const natural = decodeTerrainBaseline(estate.naturalBaseline.terrainRle, 220 * 140)!;
    expect(natural[(tee.y + 35) * 220 + tee.x + 55]).toBe("tee");
  });
});
