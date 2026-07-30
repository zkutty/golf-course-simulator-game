import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult } from "../../utils/save";
import { __resetSaveStoreForTests, loadSlot, saveToSlot } from "../../utils/saveStore";
import { createLiveState, stepLive } from "./simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "./persistence";

function playableCourse(): Course {
  const width = 60;
  const height = 24;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const tee = { x: 4, y: 12 };
  const green = { x: 50, y: 12 };
  tiles[tee.y * width + tee.x] = "tee";
  tiles[green.y * width + green.x] = "green";
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{ tee, green, parMode: "AUTO" }],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "Resume Links",
    baseGreenFee: 65,
    condition: 0.8,
  };
}

function midRound() {
  const course = playableCourse();
  const state = createLiveState(course, DEFAULT_WORLD, 2);
  let pendingCash = 0;
  let guard = 0;
  while (state.golfers.length === 0 && guard++ < 2_000) {
    pendingCash += stepLive(state, course, 1).cashDelta;
  }
  stepLive(state, course, 0.75);
  expect(state.golfers.length).toBeGreaterThan(0);
  return { course, state, pendingCash };
}

describe("live simulation persistence", () => {
  it("round-trips a mid-round golfer, clock, pending cash, speed, and selection", () => {
    const { state, pendingCash } = midRound();
    const selectedGolferId = state.golfers[0].id;
    const snapshot = snapshotLiveSimulation({
      state,
      pendingCash,
      speed: "4x",
      selectedGolferId,
    });
    const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot)));

    expect(restored).not.toBeNull();
    expect(restored!.state.dayIndex).toBe(2);
    expect(restored!.state.dayMinute).toBe(state.dayMinute);
    expect(restored!.state.golfers).toEqual(state.golfers);
    expect(restored!.state.walkCache).toBeInstanceOf(Map);
    expect(restored!.state.walkCache.size).toBe(0);
    expect(restored!.pendingCash).toBe(pendingCash);
    expect(restored!.speed).toBe("4x");
    expect(restored!.selectedGolferId).toBe(selectedGolferId);
  });

  it("round-trips an active M51 rental once and drops duplicate authorization IDs", () => {
    const { state, pendingCash } = midRound();
    state.m51!.assignments = [{ id: "assignment-1", groupId: "group-1", courseId: "course-primary", selectionId: "selection-1", mode: "riding_cart", buildingId: "rental-1", productId: "rental-1:riding_cart", fleetUnitIds: ["fleet-1"], riders: [], status: "active", routeCacheKey: "m51:course-primary:course-primary:riding_cart:1,1>2,2", serviceDelayMinutes: 0, availableUnitsAtSelection: 1, actualTravelMinutes: 0, walkingFallbackMinutes: 0, offPathTiles: 0, seed: 4, decisionOrder: 1 }];
    state.m51!.transactions = [
      { id: "charge-1", groupId: "group-1", courseId: "course-primary", assignmentId: "assignment-1", buildingId: "rental-1", productId: "rental-1:riding_cart", mode: "riding_cart", amount: 24, status: "authorized", seed: 4, decisionOrder: 2, authorizedAtMinute: 20 },
      { id: "charge-1", groupId: "group-1", courseId: "course-primary", assignmentId: "assignment-1", buildingId: "rental-1", productId: "rental-1:riding_cart", mode: "riding_cart", amount: 24, status: "authorized", seed: 4, decisionOrder: 3, authorizedAtMinute: 20 },
    ];
    const restored = restoreLiveSimulation(snapshotLiveSimulation({ state, pendingCash, speed: "paused", selectedGolferId: null }));
    expect(restored?.state.m51?.assignments[0]).toMatchObject({ id: "assignment-1", status: "active", fleetUnitIds: ["fleet-1"] });
    expect(restored?.state.m51?.transactions).toHaveLength(1);
  });

  it("resumes deterministically from the same snapshot", () => {
    const { course, state, pendingCash } = midRound();
    const snapshot = snapshotLiveSimulation({ state, pendingCash, speed: "2x", selectedGolferId: null });
    const a = restoreLiveSimulation(snapshot)!;
    const b = restoreLiveSimulation(snapshot)!;

    for (let i = 0; i < 20; i++) {
      stepLive(a.state, course, 0.5);
      stepLive(b.state, course, 0.5);
    }

    expect(snapshotLiveSimulation({ ...a, selectedGolferId: null })).toEqual(
      snapshotLiveSimulation({ ...b, selectedGolferId: null })
    );
  });

  it("migrates the retired 3x snapshot tier to the third 4x tier", () => {
    const { state } = midRound();
    const legacy = { ...snapshotLiveSimulation({ state, pendingCash: 0, speed: "1x", selectedGolferId: null }), version: 2, speed: "3x" };
    expect(restoreLiveSimulation(legacy)?.speed).toBe("4x");
  });

  it("persists live state through the main save normalization pipeline", () => {
    const { course, state, pendingCash } = midRound();
    const live = snapshotLiveSimulation({ state, pendingCash, speed: "1x", selectedGolferId: null });
    const result = normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 1,
      course,
      world: DEFAULT_WORLD,
      live,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.live).toEqual(live);
  });

  it("round-trips live state through an actual save slot", async () => {
    __resetSaveStoreForTests();
    const { course, state, pendingCash } = midRound();
    const live = snapshotLiveSimulation({
      state,
      pendingCash,
      speed: "paused",
      selectedGolferId: state.golfers[0].id,
    });
    const meta = await saveToSlot(null, "manual", "Mid-round", {
      course,
      world: DEFAULT_WORLD,
      live,
    });
    const loaded = await loadSlot(meta.id);
    expect(loaded?.live).toEqual(live);
  });

  it("rejects malformed live snapshots instead of partially restoring them", () => {
    const { course } = midRound();
    const result = normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 1,
      course,
      world: DEFAULT_WORLD,
      live: { version: 1, state: { golfers: "not-an-array" } },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_LIVE_STATE" } });
  });

  it("rejects malformed M47 evidence instead of exposing unsafe inspector data", () => {
    const { state } = midRound();
    const snapshot = JSON.parse(JSON.stringify(snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null })));
    snapshot.state.golfers[0].holePlans = [{ version: 1, holeId: "broken" }];
    expect(restoreLiveSimulation(snapshot)).toBeNull();
  });

  it("drops only malformed nested flight, collision, and relief payloads while retaining legacy live evidence", () => {
    const { state } = midRound();
    const source = snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null });
    const mutations: Array<(shared: Record<string, unknown>) => void> = [
      (shared) => {
        (shared.flight as Record<string, unknown>).apexHeightYards = Number.NaN;
      },
      (shared) => {
        const flight = shared.flight as { clearance?: unknown[] };
        shared.collision = {
          kind: "obstacle",
          point: { x: Number.POSITIVE_INFINITY, y: 1 },
          obstacleType: "tree",
          distanceFromStartYards: 10,
          clearance: flight.clearance?.[0] ?? {
            point: { x: 1, y: 1 },
            pathHeightYards: 1,
            requiredHeightYards: 2,
            clearanceYards: -1,
          },
        };
      },
      (shared) => {
        shared.relief = {
          status: "resolved",
          type: "lateral",
          candidates: [],
          selectedCandidateId: "missing",
          finalPosition: { x: 1, y: 1 },
        };
      },
    ];
    for (const mutate of mutations) {
      const snapshot = structuredClone(source);
      const outcome = snapshot.state.golfers[0].shotOutcomes?.[0];
      expect(outcome?.sharedOutcome).toBeDefined();
      mutate(outcome!.sharedOutcome as unknown as Record<string, unknown>);
      const restored = restoreLiveSimulation(snapshot);
      expect(restored).not.toBeNull();
      expect(restored!.state.golfers[0].shotOutcomes?.[0]).not.toHaveProperty("sharedOutcome");
      expect(restored!.state.golfers[0].shotOutcomes?.[0].id).toBe(outcome!.id);
    }
  });
});
