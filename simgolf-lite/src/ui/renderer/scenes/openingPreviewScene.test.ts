import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../../../game/gameState";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createOpeningPreviewSceneSystem } from "./openingPreviewScene";

function snapshot(revision: number, overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = DEFAULT_STATE.course;
  return {
    course, obstacles: course.obstacles, effectiveTiles: course.tiles, holes: course.holes,
    draftTee: null, draftGreen: null, rotation: 0, graphicsQuality: "high", colorVision: "standard",
    reducedMotion: true, animationsEnabled: false, showObstacles: true, atlasRevision: 0,
    surveyMode: false, worldSeed: 42, surfaceHeightAt: () => 0,
    revisions: { atmosphere: 0, surfaceCare: 0, structuresProps: 0, playerProCollection: 0, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0, openingPreview: revision },
    ...overrides,
  };
}

describe("Opening preview endpoint markers", () => {
  it("allocates only when visible, reuses one graphic, clears on skip and preserves siblings", () => {
    const layer = new PIXI.Container();
    const sibling = new PIXI.Container();
    layer.addChild(sibling);
    const host = new SceneSystemHost([createOpeningPreviewSceneSystem(layer)]);
    host.sync(snapshot(0));
    expect(layer.children).toEqual([sibling]);
    const visible = snapshot(1, { openingMarker: { golferName: "Preview", shot: { shotNumber: 1, intent: "safe", club: "7i", from: { x: 1, y: 2 }, landing: { x: 8, y: 2 }, rest: { x: 4, y: 3 }, lieAfter: "rough", penaltyStrokes: 1 } } });
    const unchanged = JSON.stringify(visible);
    expect(host.sync(visible)).toEqual(["openingPreview"]);
    const graphic = layer.children[1];
    expect(graphic.label).toBe("opening-preview-markers");
    expect(host.sync(visible)).toEqual([]);
    host.sync({ ...visible, revisions: { ...visible.revisions, openingPreview: 2 }, rotation: 90 });
    expect(layer.children[1]).toBe(graphic);
    expect(JSON.stringify(visible)).toBe(unchanged);
    host.sync(snapshot(3));
    expect(graphic.destroyed).toBe(true);
    expect(layer.children).toEqual([sibling]);
    host.dispose();
    host.dispose();
    expect(sibling.destroyed).toBe(false);
  });
});
