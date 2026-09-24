import * as PIXI from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "../../../game/gameState";
import type { Point } from "../../../game/models/types";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createArchitectureOverlaySceneSystem, routeDestinationHierarchy } from "./architectureOverlayScene";

function snapshot(revision: number, overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = DEFAULT_STATE.course;
  return {
    course,
    obstacles: course.obstacles,
    effectiveTiles: course.tiles,
    holes: course.holes,
    draftTee: null,
    draftGreen: null,
    rotation: 0,
    graphicsQuality: "high",
    colorVision: "standard",
    reducedMotion: false,
    animationsEnabled: true,
    showObstacles: true,
    showMarkers: true,
    atlasRevision: 1,
    surveyMode: false,
    worldSeed: 42,
    surfaceHeightAt: () => 0,
    activePath: [{ x: 1, y: 1 }, { x: 3, y: 3 }],
    activeShotDestinations: [{ x: 3, y: 3 }],
    showShotPlan: true,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 0,
      holeMarkers: 0,
      architectureOverlay: revision,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

describe("Architecture overlay scene ownership", () => {
  it("prefers authored waypoints in stable deduped order and keeps the active pin terminal", () => {
    const hole = {
      ...DEFAULT_STATE.course.holes[0],
      waypoints: [{ x: 4, y: 3 }, { x: 4, y: 3 }, { x: 7, y: 2 }],
      pinPositions: { A: { x: 8, y: 2 }, B: { x: 9, y: 2 }, C: { x: 8, y: 3 } },
    };

    expect(routeDestinationHierarchy(hole, "B", [{ x: 99, y: 99 }])).toEqual([
      { x: 4, y: 3 },
      { x: 7, y: 2 },
      { x: 9, y: 2 },
    ]);
  });

  it("falls back to solver destinations only without authored waypoints and dedupes the active pin", () => {
    const hole = {
      ...DEFAULT_STATE.course.holes[0],
      waypoints: [],
      pinPositions: { A: { x: 8, y: 2 }, B: { x: 9, y: 2 }, C: { x: 8, y: 3 } },
    };

    expect(routeDestinationHierarchy(hole, "A", [
      { x: 4, y: 3 },
      { x: 4, y: 3 },
      { x: 8, y: 2 },
    ])).toEqual([{ x: 4, y: 3 }, { x: 8, y: 2 }]);
  });

  it("draws distinct source-backed landing, approach, and pin markers regardless of route sampling", () => {
    const layer = new PIXI.Container();
    const scene = createArchitectureOverlaySceneSystem(layer);
    const targets = [{ x: 4, y: 3 }, { x: 7, y: 2 }, { x: 8, y: 2 }];
    const markerCenters = () => {
      return layer.children.flatMap((child) => {
        const marker = child as PIXI.Graphics & { __coursecraftShotDestination?: { point: Point; role: string } };
        return marker.__coursecraftShotDestination ? [marker.__coursecraftShotDestination] : [];
      });
    };

    scene.render?.(snapshot(1, {
      activePath: [{ x: 0, y: 5 }, { x: 4, y: 3 }, { x: 7, y: 2 }, { x: 8, y: 2 }],
      activeShotDestinations: targets,
    }));
    const sparse = markerCenters();
    scene.render?.(snapshot(2, {
      activePath: [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 2 }, { x: 8, y: 2 }],
      activeShotDestinations: targets,
    }));

    expect(sparse).toEqual([
      { index: 0, point: targets[0], role: "landing" },
      { index: 1, point: targets[1], role: "approach" },
      { index: 2, point: targets[2], role: "pin" },
    ]);
    expect(markerCenters()).toEqual(sparse);
    const markerBounds = layer.children.flatMap((child) => {
      const marker = child as PIXI.Graphics & { __coursecraftShotDestination?: unknown };
      return marker.__coursecraftShotDestination ? [marker.getLocalBounds()] : [];
    });
    expect(markerBounds[0].width).toBeGreaterThan(markerBounds[2].width);
    expect(markerBounds[1].height).toBeGreaterThan(markerBounds[2].height);
  });

  it("rebuilds only its labeled decals and preserves sibling order", () => {
    const layer = new PIXI.Container();
    const marker = new PIXI.Graphics();
    marker.label = "hole-marker";
    layer.addChild(marker);
    const scene = createArchitectureOverlaySceneSystem(layer);
    const host = new SceneSystemHost([scene]);

    expect(host.sync(snapshot(1))).toEqual(["architectureOverlay"]);
    expect(layer.children[0]).toBe(marker);
    const firstRoute = layer.children.find((child) => child.label === "route-overlay");
    expect(firstRoute).toBeDefined();

    expect(host.sync({ ...snapshot(1), course: { ...DEFAULT_STATE.course } })).toEqual([]);
    expect(layer.children.find((child) => child.label === "route-overlay")).toBe(firstRoute);

    expect(host.sync(snapshot(2, { activeShotDestinations: [{ x: 4, y: 3 }] }))).toEqual(["architectureOverlay"]);
    expect(layer.children[0]).toBe(marker);
    expect(firstRoute?.destroyed).toBe(true);

    host.dispose();
    host.dispose();
    expect(layer.children).toEqual([marker]);
  });

  it("clears owned graphics when marker overlays are disabled", () => {
    const layer = new PIXI.Container();
    const scene = createArchitectureOverlaySceneSystem(layer);
    scene.render?.(snapshot(1, {
      architectureWarnings: [{
        id: "warning-1",
        kind: "crossing",
        severity: "warning",
        message: "Crossing",
        holeIds: [],
        location: { x: 2, y: 2 },
        measurement: "2 tiles",
      }],
    }));
    expect(layer.children.filter((child) => child.label === "route-overlay")).toHaveLength(3);

    scene.render?.(snapshot(2, { showMarkers: false }));
    expect(layer.children).toHaveLength(0);
  });

  it("keeps the reference-layer control and requests an immediate render", () => {
    const layer = new PIXI.Container();
    const requestRender = vi.fn();
    const testWindow: Record<string, unknown> = {};
    vi.stubGlobal("window", testWindow);
    const scene = createArchitectureOverlaySceneSystem(layer, requestRender);
    scene.render?.(snapshot(1, {
      architectureOverlay: {
        kind: "reference",
        cells: [{ id: "cell", x: 1, y: 1, value: 1, current: true }],
        traces: [{ id: "trace", from: { x: 1, y: 1 }, to: { x: 2, y: 2 }, current: true }],
        points: [{ id: "point", x: 2, y: 2, value: 1, current: true }],
      },
    }));
    const setLayer = testWindow.__ccSetArchitectureOverlayTestLayer as ((layer: "points") => unknown) | undefined;
    expect(setLayer).toBeTypeOf("function");
    setLayer?.("points");
    expect(requestRender).toHaveBeenCalled();
    expect(testWindow.__ccArchitectureOverlayTestState).toMatchObject({ layer: "points", pointsVisible: true, tracesVisible: false });

    scene.dispose?.();
    expect(testWindow.__ccSetArchitectureOverlayTestLayer).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
