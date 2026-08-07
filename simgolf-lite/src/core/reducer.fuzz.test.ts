/// <reference types="node" />
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyAction } from "./reducer";
import type { Action } from "./actions";
import type { GameState } from "../game/gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import type { Terrain } from "../game/models/types";
import { clampElevation } from "../game/models/elevation";
import { computeElevationChangeCost } from "../game/models/terrainEconomics";
import { computeTerrainBatch } from "../game/models/terrainStroke";
import { economicPressureForWorld, terrainCostMult } from "../game/balance/experience";
import { createNewGame } from "../game/gen/newGame";
import { hashGameState } from "../utils/stateHash";
import { createReferenceCourse } from "../game/testing/referenceCourse";
import { runLiveDaysHeadless } from "../game/live/headless";

const terrains: Terrain[] = ["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"];

function initialState(): GameState {
  return {
    course: {
      ...DEFAULT_COURSE,
      tiles: [...DEFAULT_COURSE.tiles],
      elevations: [...DEFAULT_COURSE.elevations],
      holes: DEFAULT_COURSE.holes.map((hole) => ({ ...hole })),
      obstacles: [],
      buildings: [],
    },
    world: { ...DEFAULT_WORLD, loans: [] },
    selectedTerrain: "fairway",
    terrainVersion: 0,
    obstaclesVersion: 0,
    markersVersion: 0,
    economyVersion: 0,
  };
}

type Operation =
  | { kind: "paint"; x: number; y: number; terrain: Terrain }
  | { kind: "sculpt"; x: number; y: number; delta: number }
  | { kind: "tee"; x: number; y: number; hole: number }
  | { kind: "green"; x: number; y: number; hole: number }
  | { kind: "obstacle"; x: number; y: number; obstacle: "tree" | "bush" | "rock" };

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant("paint"), x: fc.integer({ min: 0, max: 109 }), y: fc.integer({ min: 0, max: 69 }), terrain: fc.constantFrom(...terrains) }),
  fc.record({ kind: fc.constant("sculpt"), x: fc.integer({ min: 0, max: 109 }), y: fc.integer({ min: 0, max: 69 }), delta: fc.integer({ min: -3, max: 3 }) }),
  fc.record({ kind: fc.constant("tee"), x: fc.integer({ min: 0, max: 109 }), y: fc.integer({ min: 0, max: 69 }), hole: fc.integer({ min: 0, max: 8 }) }),
  fc.record({ kind: fc.constant("green"), x: fc.integer({ min: 0, max: 109 }), y: fc.integer({ min: 0, max: 69 }), hole: fc.integer({ min: 0, max: 8 }) }),
  fc.record({ kind: fc.constant("obstacle"), x: fc.integer({ min: 0, max: 109 }), y: fc.integer({ min: 0, max: 69 }), obstacle: fc.constantFrom("tree" as const, "bush" as const, "rock" as const) })
);

function actionFor(op: Operation): Action {
  switch (op.kind) {
    case "paint": return { type: "PAINT_TILES", tiles: [{ x: op.x, y: op.y, terrain: op.terrain }] };
    case "sculpt": return { type: "SCULPT_TILES", deltas: [{ x: op.x, y: op.y, delta: op.delta }] };
    case "tee": return { type: "PLACE_TEE", holeIndex: op.hole, position: { x: op.x, y: op.y } };
    case "green": return { type: "PLACE_GREEN", holeIndex: op.hole, position: { x: op.x, y: op.y } };
    case "obstacle": return { type: "PLACE_OBSTACLE", x: op.x, y: op.y, obstacleType: op.obstacle };
  }
}

describe("reducer property tests", () => {
  it("preserves structural and accounting invariants across 10k random sequences", () => {
    fc.assert(fc.property(fc.array(operationArb, { minLength: 1, maxLength: 30 }), (operations) => {
      let state = initialState();
      for (const op of operations) {
        const before = state;
        const idx = op.y * before.course.width + op.x;
        const next = applyAction(before, actionFor(op));

        expect(next.course.tiles).toHaveLength(next.course.width * next.course.height);
        expect(next.course.elevations).toHaveLength(next.course.width * next.course.height);
        expect(Number.isFinite(next.world.cash)).toBe(true);

        if (op.kind === "paint") {
          const preview = computeTerrainBatch({
            course: before.course,
            tiles: [{ x: op.x, y: op.y, terrain: op.terrain }],
            cash: before.world.cash,
            costMult: terrainCostMult(economicPressureForWorld(before.world)),
            reputation: before.world.reputation,
            protectedTrees: before.world.constraints?.protectedTrees,
          });
          const expected = !before.world.isBankrupt && preview.affordable
            ? preview.net
            : 0;
          expect(next.world.cash).toBeCloseTo(before.world.cash - expected, 8);
        }
        if (op.kind === "sculpt") {
          const previous = before.course.elevations[idx];
          const applied = clampElevation(previous + op.delta) - previous;
          const expected = computeElevationChangeCost(applied, terrainCostMult(economicPressureForWorld(before.world))).net;
          expect(next.world.cash).toBeCloseTo(before.world.cash - expected, 8);
        }
        state = next;
      }
    }), { numRuns: 10_000, endOnFailure: true });
  }, 120_000);
});

describe("determinism hard invariant", () => {
  it("produces identical generated and live-sim state for the same seed and inputs", () => {
    const setup = { mode: "sandbox" as const, courseName: "Determinism", seed: 90210, theme: "links" as const, experienceProfile: "classic" as const, economicPressure: "balanced" as const };
    expect(hashGameState(createNewGame(setup))).toBe(hashGameState(createNewGame(setup)));

    const course = createReferenceCourse();
    const world = { ...DEFAULT_WORLD, runSeed: 90210, cash: 100_000 };
    const a = runLiveDaysHeadless({ course, world, days: 7 });
    const b = runLiveDaysHeadless({ course, world, days: 7 });
    expect(hashGameState({ course: a.course, world: a.world })).toBe(
      hashGameState({ course: b.course, world: b.world })
    );
  }, 60_000);

  it("keeps Math.random out of the deterministic game core", () => {
    const offenders = globSync("src/game/**/*.{ts,tsx}").filter((file) => readFileSync(file, "utf8").includes("Math.random("));
    expect(offenders).toEqual([]);
  });
});
