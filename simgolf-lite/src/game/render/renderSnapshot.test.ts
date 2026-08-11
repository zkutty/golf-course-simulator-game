import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type GameState } from "../gameState";
import {
  changedRenderSystems,
  createRenderSnapshot,
  RENDER_SYSTEMS,
  RenderRevisionTracker,
  structuresPropsRevisionDependencies,
} from "./renderSnapshot";

function snapshot(state: GameState, revisions: Partial<{
  mobileEntitiesRevision: number;
  overlayRevision: number;
  viewportInputRevision: number;
}> = {}) {
  return createRenderSnapshot({ state, ...revisions });
}

describe("RenderSnapshot invalidation contract", () => {
  it("starts every scene system once and keeps unrelated cash changes static", () => {
    const first = snapshot(DEFAULT_STATE);
    const cashOnly = snapshot({
      ...DEFAULT_STATE,
      world: { ...DEFAULT_STATE.world, cash: DEFAULT_STATE.world.cash + 1 },
    });

    expect(changedRenderSystems(null, first)).toEqual(RENDER_SYSTEMS);
    expect(changedRenderSystems(first, cashOnly)).toEqual([]);
  });

  it("keeps real authored-props dependencies stable across unrelated course state", () => {
    const tracker = new RenderRevisionTracker();
    const baseCourse = DEFAULT_STATE.course;
    expect(baseCourse.property).toBeDefined();
    const effectiveTiles = baseCourse.tiles;
    const dependencies = (course: GameState["course"]) => ({
      atmosphere: [],
      surfaceCare: [],
      structuresProps: structuresPropsRevisionDependencies({
        atlasRevision: 1,
        course,
        effectiveTiles,
        graphicsQuality: "high",
        rotation: 0,
        seasonalPlantsSignature: "spring:full",
      }),
      naturalProps: [],
      overlaysDiagnostics: [],
      estateSurvey: [],
    });
    const initial = tracker.update(dependencies(baseCourse));
    const unrelated = {
      ...baseCourse,
      property: baseCourse.property
        ? { ...baseCourse.property }
        : undefined,
    };

    expect(tracker.update(dependencies(unrelated)).structuresProps).toBe(
      initial.structuresProps,
    );
    expect(tracker.update(dependencies({
      ...unrelated,
      decorations: [...(unrelated.decorations ?? [])],
    })).structuresProps).toBe(initial.structuresProps + 1);
  });

  it("isolates editor, terrain, marker, live, atmosphere, and viewport revisions", () => {
    const first = snapshot(DEFAULT_STATE);
    const editor = snapshot({ ...DEFAULT_STATE, selectedTerrain: "rough" });
    expect(changedRenderSystems(first, editor)).toEqual(["overlays-diagnostics"]);

    const terrain = snapshot({ ...DEFAULT_STATE, terrainVersion: 1 });
    expect(changedRenderSystems(first, terrain)).toEqual(["terrain-materials"]);

    const structures = snapshot({ ...DEFAULT_STATE, markersVersion: 1 });
    expect(changedRenderSystems(first, structures)).toEqual(["structures-props"]);

    const mobile = snapshot(DEFAULT_STATE, { mobileEntitiesRevision: 1 });
    expect(changedRenderSystems(first, mobile)).toEqual(["mobile-entities"]);

    const atmosphere = snapshot({
      ...DEFAULT_STATE,
      world: {
        ...DEFAULT_STATE.world,
        seasonal: {
          ...DEFAULT_STATE.world.seasonal!,
          calendar: {
            ...DEFAULT_STATE.world.seasonal!.calendar,
            absoluteDay: DEFAULT_STATE.world.seasonal!.calendar.absoluteDay + 1,
          },
        },
      },
    });
    expect(changedRenderSystems(first, atmosphere)).toEqual(["atmosphere"]);

    const viewport = snapshot(DEFAULT_STATE, { viewportInputRevision: 1 });
    expect(changedRenderSystems(first, viewport)).toEqual(["viewport-input"]);
  });
});
