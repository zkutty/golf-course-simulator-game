import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Action } from "../../core/actions";
import { applyAction } from "../../core/reducer";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult } from "../../utils/save";
import type { GameState } from "../gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import { planHoleTemplatePlacement } from "./placement";
import type {
  HoleTemplatePlacement,
  HoleTemplatePlacementPlanV1,
  HoleTemplateV1,
} from "./types";

function sourceTemplate(): HoleTemplateV1 {
  return {
    format: "coursecraft-hole-template",
    version: 1,
    id: "portable-par-three",
    title: "Portable Par Three",
    description: "Reducer transaction fixture.",
    width: 3,
    height: 3,
    yardsPerTile: DEFAULT_COURSE.yardsPerTile,
    cells: [
      { x: 0, y: 1, terrain: "tee", elevationOffset: 0 },
      { x: 1, y: 1, terrain: "fairway", elevationOffset: 1 },
      { x: 2, y: 1, terrain: "green", elevationOffset: 0 },
    ],
    hole: {
      tee: { x: 0, y: 1 },
      green: { x: 2, y: 1 },
      teeBoxes: { member: { x: 0, y: 1 } },
      pinPositions: { A: { x: 2, y: 1 } },
      parMode: "MANUAL",
      parManual: 3,
    },
    obstacles: [{ x: 1, y: 2, type: "bush" }],
    decorations: [{ kind: "flower_bed", x: 0, y: 2, rotation: 0 }],
    provenance: {
      sourceKind: "licensed_provider",
      sourceLabel: "Example Design Archive",
      importedAt: "2026-08-05T12:00:00.000Z",
      rightsAttested: true,
      licenseName: "Example License",
      attribution: "Designed by Example Architect",
      redistribution: "attribution",
      sourceAssetRetained: false,
    },
    confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] },
  };
}

function transactionState(origin = { x: 10, y: 10 }): GameState {
  const course: Course = structuredClone(DEFAULT_COURSE);
  course.holes = [];
  course.layouts = undefined;
  course.activeCourseId = undefined;
  course.tiles = new Array(course.width * course.height).fill("rough");
  course.elevations = new Array(course.width * course.height).fill(4);
  course.obstacles = [{ x: origin.x + 1, y: origin.y + 2, type: "tree", origin: "natural" }];
  course.decorations = [];
  course.buildings = [];
  course.estate = undefined;
  const world: World = { ...structuredClone(DEFAULT_WORLD), cash: 1_000_000, reputation: 100, isBankrupt: false };
  return {
    course,
    world,
    selectedTerrain: "fairway",
    terrainVersion: 3,
    obstaclesVersion: 4,
    markersVersion: 5,
    economyVersion: 6,
  };
}

function placement(origin = { x: 10, y: 10 }): HoleTemplatePlacement {
  return {
    origin,
    rotation: 0,
    elevationPolicy: "template-relief",
    baseElevation: 4,
    holeId: `installed-${origin.x}-${origin.y}`,
  };
}

function preview(state: GameState, origin = { x: 10, y: 10 }): HoleTemplatePlacementPlanV1 {
  const result = planHoleTemplatePlacement({
    course: state.course,
    world: state.world,
    template: sourceTemplate(),
    placement: placement(origin),
    targetVersions: {
      terrainVersion: state.terrainVersion,
      obstaclesVersion: state.obstaclesVersion,
      markersVersion: state.markersVersion,
      economyVersion: state.economyVersion,
    },
  });
  if (result.status !== "planned" || !result.plan.canApply) throw new Error("Expected an applicable placement preview.");
  return result.plan;
}

function action(plan: HoleTemplatePlacementPlanV1): Action {
  return { type: "PLACE_HOLE_TEMPLATE", plan };
}

describe("PLACE_HOLE_TEMPLATE authoritative transaction", () => {
  it("applies the verified plan atomically at the exact preview price", () => {
    const before = transactionState();
    const plan = preview(before);
    const untouched = structuredClone(before);
    const after = applyAction(before, action(plan));

    expect(before).toEqual(untouched);
    expect(after).not.toBe(before);
    expect(after.world.cash).toBe(before.world.cash - plan.quote.total);
    expect(after.course.tiles[11 * after.course.width + 10]).toBe("tee");
    expect(after.course.tiles[11 * after.course.width + 11]).toBe("fairway");
    expect(after.course.elevations[11 * after.course.width + 11]).toBe(5);
    expect(after.course.obstacles).toContainEqual(expect.objectContaining({ x: 11, y: 12, type: "bush", origin: "player" }));
    expect(after.course.obstacles).not.toContainEqual(expect.objectContaining({ x: 11, y: 12, type: "tree" }));
    expect(after.course.decorations).toContainEqual(expect.objectContaining({ x: 10, y: 12, kind: "flower_bed", origin: "player" }));
    expect(after.course.holes).toHaveLength(1);
    expect(after.course.holes[0]).toMatchObject({
      id: "installed-10-10",
      templateAttribution: {
        templateId: "portable-par-three",
        sourceLabel: "Example Design Archive",
        licenseName: "Example License",
        attribution: "Designed by Example Architect",
      },
    });
    expect(after.course.layouts?.[0].draftHoleIds).toEqual(["installed-10-10"]);
    expect(after.course.layouts?.[0].publishedHoleIds).toEqual([]);
    expect({
      terrainVersion: after.terrainVersion,
      obstaclesVersion: after.obstaclesVersion,
      markersVersion: after.markersVersion,
      economyVersion: after.economyVersion,
    }).toEqual(plan.mutations.versions.after);
    expect(JSON.stringify(after.course.holes[0])).not.toContain("confidence");
    expect(JSON.stringify(after.course.holes[0])).not.toContain("Reducer transaction fixture");
  });

  it("uses one reducer boundary and is repeat-safe", () => {
    const before = transactionState();
    const command = action(preview(before));
    const after = applyAction(before, command);
    const repeated = applyAction(after, command);

    expect(repeated).toBe(after);
    expect(after.course.holes).toHaveLength(before.course.holes.length + 1);
    // Existing undo/redo owners need retain only these two complete snapshots;
    // no intermediate terrain, obstacle, cash, or layout state is observable.
    expect(structuredClone(before)).toEqual(before);
    expect(structuredClone(after)).toEqual(after);
  });

  it("survives current-schema save/reload with stable identity and compact attribution", () => {
    const before = transactionState();
    const after = applyAction(before, action(preview(before)));
    const loaded = normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 1,
      course: after.course,
      world: after.world,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.course.holes[0]).toMatchObject({
      id: "installed-10-10",
      templateAttribution: { templateId: "portable-par-three", attribution: "Designed by Example Architect" },
    });
    expect(loaded.payload.course.layouts?.[0].draftHoleIds).toContain("installed-10-10");
  });

  it("blocks a live Player Pro round without changing any state", () => {
    const before = transactionState();
    const plan = preview(before);
    const active = {
      ...before,
      world: {
        ...before.world,
        playerPro: { activeRound: { phase: "shot" } },
      } as unknown as World,
    };
    expect(applyAction(active, action(plan))).toBe(active);
  });
});

describe("PLACE_HOLE_TEMPLATE reducer fuzz", () => {
  it("changes nothing for stale current versions or same-version course drift", () => {
    fc.assert(fc.property(
      fc.constantFrom("terrainVersion", "obstaclesVersion", "markersVersion", "economyVersion"),
      fc.integer({ min: 1, max: 100 }),
      (key, delta) => {
        const before = transactionState();
        const plan = preview(before);
        const stale = { ...before, [key]: before[key] + delta };
        expect(applyAction(stale, action(plan))).toBe(stale);

        const drifted = structuredClone(before);
        drifted.course.tiles[11 * drifted.course.width + 10] = "fairway";
        expect(applyAction(drifted, action(plan))).toBe(drifted);
      },
    ), { numRuns: 100 });
  });

  it("changes nothing for malicious hashes, prices, mutations, or malformed carriers", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.constantFrom("cash", "terrain", "hole"), (delta, field) => {
      const before = transactionState();
      const malicious = structuredClone(preview(before));
      if (field === "cash") malicious.mutations.cashDelta -= delta;
      if (field === "terrain") malicious.mutations.terrain[0].after = "water";
      if (field === "hole") malicious.mutations.addHole.id = `attacker-${delta}`;
      expect(applyAction(before, action(malicious))).toBe(before);

      malicious.identity.value = "0".repeat(64);
      expect(applyAction(before, action(malicious))).toBe(before);
    }), { numRuns: 100 });
    const before = transactionState();
    expect(() => applyAction(before, { type: "PLACE_HOLE_TEMPLATE", plan: null } as unknown as Action)).not.toThrow();
    expect(applyAction(before, { type: "PLACE_HOLE_TEMPLATE", plan: null } as unknown as Action)).toBe(before);
  });

  it("rolls back every category when the authoritative replan becomes blocked", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), (cash) => {
      const before = transactionState();
      const plan = preview(before);
      const blocked = { ...before, world: { ...before.world, cash } };
      const snapshot = structuredClone(blocked);
      const after = applyAction(blocked, action(plan));
      expect(after).toBe(blocked);
      expect(after).toEqual(snapshot);
    }), { numRuns: 50 });
  });
});
