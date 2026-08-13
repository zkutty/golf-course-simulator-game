import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type GameState } from "../gameState";
import type { PlayerProWorldDisplayPresentation } from "../playerPro/socialPresentation";
import {
  changedRenderSystems,
  createRenderSnapshot,
  holeMarkersRevisionDependencies,
  playerProCollectionRevisionDependencies,
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
      playerProCollection: [],
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

  it("invalidates Player Pro dressing only for visible display or physical scene inputs", () => {
    const tracker = new RenderRevisionTracker();
    const course = DEFAULT_STATE.course;
    const display: PlayerProWorldDisplayPresentation = {
      revision: "vehicle:owned-cart|watch:owned-watch",
      vehicle: { id: "owned-cart", name: "Owned cart", category: "vehicle" as const },
      equipped: [{ id: "owned-watch", name: "Owned watch", category: "watch" as const }],
      collection: [],
    };
    const stableSurfaceHeightAt = () => 0;
    const dependencies = (
      worldDisplay = display,
      surfaceHeightAt = stableSurfaceHeightAt,
    ) => ({
      atmosphere: [],
      surfaceCare: [],
      structuresProps: [],
      playerProCollection: playerProCollectionRevisionDependencies({
        atlasRevision: 1,
        course,
        graphicsQuality: "high" as const,
        rotation: 0 as const,
        surfaceHeightAt,
        worldDisplay,
      }),
      naturalProps: [],
      overlaysDiagnostics: [],
      estateSurvey: [],
    });
    const initial = tracker.update(dependencies());
    const equivalentPresentation = { ...display, equipped: [...display.equipped] };
    expect(tracker.update(dependencies(equivalentPresentation)).playerProCollection)
      .toBe(initial.playerProCollection);
    expect(tracker.update(dependencies(equivalentPresentation, stableSurfaceHeightAt)).playerProCollection)
      .toBe(initial.playerProCollection);
    expect(tracker.update(dependencies(equivalentPresentation, () => 0)).playerProCollection)
      .toBe(initial.playerProCollection + 1);
    expect(tracker.update(dependencies({
      ...display,
      revision: "vehicle:none|watch:owned-watch",
      vehicle: null,
    }, () => 0)).playerProCollection).toBe(initial.playerProCollection + 2);
  });

  it("invalidates hole markers only for normalized visual and physical inputs", () => {
    const tracker = new RenderRevisionTracker();
    const course = DEFAULT_STATE.course;
    const stableHeight = () => 0;
    const dependencies = (overrides: Partial<Parameters<typeof holeMarkersRevisionDependencies>[0]> = {}) => ({
      atmosphere: [],
      surfaceCare: [],
      structuresProps: [],
      playerProCollection: [],
      naturalProps: [],
      holeMarkers: holeMarkersRevisionDependencies({
        holes: course.holes,
        activePinRotation: course.activePinRotation,
        draftTee: null,
        draftGreen: null,
        selectedTeeSet: undefined,
        showMarkers: undefined,
        rotation: 0,
        surfaceHeightAt: stableHeight,
        flagColor: undefined,
        animationsEnabled: true,
        reducedMotion: false,
        ...overrides,
      }),
      overlaysDiagnostics: [],
      estateSurvey: [],
    });
    const initial = tracker.update(dependencies());

    expect(tracker.update(dependencies({
      selectedTeeSet: "member",
      showMarkers: true,
      flagColor: "#d9534f",
      activePinRotation: "A",
    })).holeMarkers).toBe(initial.holeMarkers);
    expect(tracker.update(dependencies({ selectedTeeSet: "forward" })).holeMarkers)
      .toBe((initial.holeMarkers ?? 0) + 1);
    expect(tracker.update(dependencies({ rotation: 90 })).holeMarkers)
      .toBe((initial.holeMarkers ?? 0) + 2);
    expect(tracker.update(dependencies({ surfaceHeightAt: () => 0 })).holeMarkers)
      .toBe((initial.holeMarkers ?? 0) + 3);
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
