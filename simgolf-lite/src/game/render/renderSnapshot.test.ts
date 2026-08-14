import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type GameState } from "../gameState";
import type { PlayerProWorldDisplayPresentation } from "../playerPro/socialPresentation";
import {
  architectureOverlayRevisionDependencies,
  changedRenderSystems,
  createRenderSnapshot,
  holeMarkersRevisionDependencies,
  mobilityEntitiesRevisionDependencies,
  playerProCollectionRevisionDependencies,
  propertyAssetsRevisionDependencies,
  RENDER_SYSTEMS,
  RenderRevisionTracker,
  structuresPropsRevisionDependencies,
  surfaceEditorRevisionDependencies,
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
    const replacedPropertyAssets = tracker.update(dependencies({
      ...unrelated,
      property: unrelated.property
        ? { ...unrelated.property, assets: [...unrelated.property.assets] }
        : undefined,
    }));
    expect(replacedPropertyAssets.structuresProps).toBe(initial.structuresProps + 1);
    expect(tracker.update(dependencies({
      ...unrelated,
      decorations: [...(unrelated.decorations ?? [])],
    })).structuresProps).toBe(initial.structuresProps + 2);
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

  it("invalidates Architecture overlays only for normalized visible inputs", () => {
    const tracker = new RenderRevisionTracker();
    const course = DEFAULT_STATE.course;
    const stableHeight = () => 0;
    const dependencies = (overrides: Partial<Parameters<typeof architectureOverlayRevisionDependencies>[0]> = {}) => ({
      atmosphere: [],
      surfaceCare: [],
      structuresProps: [],
      playerProCollection: [],
      naturalProps: [],
      architectureOverlay: architectureOverlayRevisionDependencies({
        activePath: undefined,
        activePinRotation: undefined,
        failingCorridorSegments: undefined,
        holes: course.holes,
        architectureOverlay: null,
        architectureWarnings: undefined,
        paceBottlenecks: undefined,
        showMarkers: undefined,
        showFixOverlay: undefined,
        showShotPlan: undefined,
        rotation: 0,
        surfaceHeightAt: stableHeight,
        ...overrides,
      }),
      overlaysDiagnostics: [],
      estateSurvey: [],
    });
    const initial = tracker.update(dependencies());

    expect(tracker.update(dependencies({
      activePinRotation: "A",
      showMarkers: true,
      showFixOverlay: false,
      showShotPlan: false,
    })).architectureOverlay).toBe(initial.architectureOverlay);
    expect(tracker.update(dependencies({ activePath: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })).architectureOverlay)
      .toBe((initial.architectureOverlay ?? 0) + 1);
    expect(tracker.update(dependencies({ rotation: 90 })).architectureOverlay)
      .toBe((initial.architectureOverlay ?? 0) + 2);
  });

  it("invalidates property assets only for exact normalized scene inputs", () => {
    const tracker = new RenderRevisionTracker();
    const course = DEFAULT_STATE.course;
    const stableHeight = () => 0;
    const dependencies = (
      nextCourse: GameState["course"] = course,
      hasResortServicePressure: boolean = false,
      rotation: Parameters<typeof propertyAssetsRevisionDependencies>[0]["rotation"] = 0,
      surfaceHeightAt = stableHeight,
    ) => ({
      atmosphere: [],
      surfaceCare: [],
      structuresProps: [],
      playerProCollection: [],
      naturalProps: [],
      propertyAssets: propertyAssetsRevisionDependencies({
        course: nextCourse,
        hasResortServicePressure,
        rotation,
        surfaceHeightAt,
      }),
      overlaysDiagnostics: [],
      estateSurvey: [],
    });
    const initial = tracker.update(dependencies());

    expect(tracker.update(dependencies({ ...course, name: `${course.name} renamed` })).propertyAssets)
      .toBe(initial.propertyAssets);
    expect(tracker.update(dependencies({
      ...course,
      property: course.property ? { ...course.property, developments: [...course.property.developments] } : undefined,
    })).propertyAssets).toBe(initial.propertyAssets);
    expect(tracker.update(dependencies({
      ...course,
      property: course.property ? { ...course.property, assets: [...course.property.assets] } : undefined,
    })).propertyAssets).toBe((initial.propertyAssets ?? 0) + 1);
    expect(tracker.update(dependencies({
      ...course,
      property: course.property ? { ...course.property, units: [...course.property.units] } : undefined,
    })).propertyAssets).toBe((initial.propertyAssets ?? 0) + 2);
    expect(tracker.update(dependencies({ ...course, theme: "links" })).propertyAssets)
      .toBe((initial.propertyAssets ?? 0) + 3);
    expect(tracker.update(dependencies(course, true)).propertyAssets)
      .toBe((initial.propertyAssets ?? 0) + 4);
    expect(tracker.update(dependencies(course, Boolean(7))).propertyAssets)
      .toBe((initial.propertyAssets ?? 0) + 4);
    expect(tracker.update(dependencies(course, false, 90)).propertyAssets)
      .toBe((initial.propertyAssets ?? 0) + 5);
    expect(tracker.update(dependencies(course, false, 0, () => 0)).propertyAssets)
      .toBe((initial.propertyAssets ?? 0) + 6);
  });

  it("invalidates mobility entities only for exact static authority inputs", () => {
    const tracker = new RenderRevisionTracker();
    const course = DEFAULT_STATE.course;
    const stableHeight = () => 0;
    const dependencies = (
      nextCourse: GameState["course"] = course,
      rotation: Parameters<typeof mobilityEntitiesRevisionDependencies>[0]["rotation"] = 0,
      surfaceHeightAt = stableHeight,
    ) => ({
      atmosphere: [],
      surfaceCare: [],
      structuresProps: [],
      playerProCollection: [],
      mobilityEntities: mobilityEntitiesRevisionDependencies({
        course: nextCourse,
        rotation,
        surfaceHeightAt,
      }),
      naturalProps: [],
      overlaysDiagnostics: [],
      estateSurvey: [],
    });
    const initial = tracker.update(dependencies());

    expect(tracker.update(dependencies({ ...course, name: `${course.name} renamed` })).mobilityEntities)
      .toBe(initial.mobilityEntities);
    const m51Changed = { ...course, m51: course.m51 ? { ...course.m51 } : undefined };
    expect(tracker.update(dependencies(m51Changed)).mobilityEntities)
      .toBe((initial.mobilityEntities ?? 0) + 1);
    const buildingsChanged = { ...m51Changed, buildings: [...m51Changed.buildings] };
    expect(tracker.update(dependencies(buildingsChanged)).mobilityEntities)
      .toBe((initial.mobilityEntities ?? 0) + 2);
    const identityChanged = { ...buildingsChanged, activeCourseId: "mobility-secondary" };
    expect(tracker.update(dependencies(identityChanged)).mobilityEntities)
      .toBe((initial.mobilityEntities ?? 0) + 3);
    expect(tracker.update(dependencies(identityChanged, 90)).mobilityEntities)
      .toBe((initial.mobilityEntities ?? 0) + 4);
    expect(tracker.update(dependencies(identityChanged, 90, () => 0)).mobilityEntities)
      .toBe((initial.mobilityEntities ?? 0) + 5);

    expect(mobilityEntitiesRevisionDependencies({
      course: { ...course, activeCourseId: undefined },
      rotation: 0,
      surfaceHeightAt: stableHeight,
    })[2]).toBe(course.layouts?.[0]?.id ?? "course-primary");
  });

  it("invalidates the surface editor only for its consumed persisted, preview, editor, and projection inputs", () => {
    const tracker = new RenderRevisionTracker();
    const course = DEFAULT_STATE.course;
    const stableHeight = () => 0;
    const stableDraft = [{ x: 1, y: 1 }];
    const dependencies = (
      overrides: Partial<Parameters<typeof surfaceEditorRevisionDependencies>[0]> = {},
    ) => ({
      atmosphere: [],
      surfaceCare: [],
      structuresProps: [],
      playerProCollection: [],
      naturalProps: [],
      surfaceEditor: surfaceEditorRevisionDependencies({
        width: course.width,
        height: course.height,
        tiles: course.tiles,
        elevations: course.elevations,
        greenSurface: course.greenSurface,
        previewSurface: undefined,
        editorMode: "PAINT",
        showGridOverlays: false,
        graphicsQuality: "high",
        colorVision: "standard",
        terrainTool: "curve",
        splineDraft: stableDraft,
        splineHover: null,
        selectedFeature: null,
        selectedNode: null,
        rotation: 0,
        surfaceHeightAt: stableHeight,
        ...overrides,
      }),
      overlaysDiagnostics: [],
      estateSurvey: [],
    });
    const initial = tracker.update(dependencies());

    expect(tracker.update(dependencies()).surfaceEditor).toBe(initial.surfaceEditor);
    expect(tracker.update({
      ...dependencies(),
      architectureOverlay: ["unrelated"],
    }).surfaceEditor).toBe(initial.surfaceEditor);
    expect(tracker.update(dependencies({ showGridOverlays: true })).surfaceEditor)
      .toBe((initial.surfaceEditor ?? 0) + 1);
    expect(tracker.update(dependencies({ splineHover: { x: 2, y: 3 } })).surfaceEditor)
      .toBe((initial.surfaceEditor ?? 0) + 2);
    expect(tracker.update(dependencies({ surfaceHeightAt: () => 0 })).surfaceEditor)
      .toBe((initial.surfaceEditor ?? 0) + 3);
    expect(tracker.update(dependencies({ elevations: [...course.elevations] })).surfaceEditor)
      .toBe((initial.surfaceEditor ?? 0) + 4);
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
