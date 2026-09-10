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
    const shot = { id: "shot-1", shotNumber: 1, intent: "safe" as const, club: "7i", from: { x: 1, y: 2 }, landing: { x: 8, y: 2 }, rest: { x: 4, y: 3 }, lieAfter: "rough", penaltyStrokes: 1 };
    const visible = snapshot(1, { openingMarker: {
      previewId: "preview-1", golferId: "golfer-1", golferName: "Preview", shotId: shot.id,
      shot, index: 0, total: 1, progress: 0.5, golfer: shot.from, ball: { x: 5, y: 2 }, landing: shot.landing, rest: shot.rest,
      complete: false,
    },
      openingTargets: [{ id: 129, x: 1, y: 2 }, { id: 130, x: 2, y: 2 }],
    });
    const unchanged = JSON.stringify(visible);
    expect(host.sync(visible)).toEqual(["openingPreview"]);
    const graphic = layer.children[1];
    expect(graphic.label).toBe("opening-preview-markers");
    expect((graphic as PIXI.Graphics & { __coursecraftOpeningPreview?: unknown }).__coursecraftOpeningPreview).toEqual({
      targetIds: [129, 130],
      outlineCount: 2,
      impact: null,
      impactCount: 0,
    });
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

  it("fires one bounded impact at the retained touchdown and clears it on replay", () => {
    const layer = new PIXI.Container();
    const host = new SceneSystemHost([createOpeningPreviewSceneSystem(layer)]);
    const shot = { id: "shot-impact", shotNumber: 1, intent: "safe" as const, club: "7i", from: { x: 1, y: 2 }, landing: { x: 8, y: 2 }, rest: { x: 9, y: 2 }, lieAfter: "green", penaltyStrokes: 0 };
    const tiles = [...DEFAULT_STATE.course.tiles];
    tiles[Math.floor(shot.landing.y + .5) * DEFAULT_STATE.course.width + Math.floor(shot.landing.x + .5)] = "green";
    const landed = snapshot(1, { effectiveTiles: tiles, openingMarker: {
      previewId: "preview-1", golferId: "golfer-1", golferName: "Preview", shotId: shot.id, shot,
      index: 0, total: 1, progress: .8, golfer: shot.from, ball: shot.landing, landing: shot.landing, rest: shot.rest,
      complete: false,
    } });
    host.sync(landed);
    const graphic = layer.children[0] as PIXI.Graphics & { __coursecraftOpeningPreview?: { impactCount: number; impact: unknown } };
    expect(graphic.__coursecraftOpeningPreview).toMatchObject({ impactCount: 1, impact: { shotId: shot.id, type: "green", x: 8, y: 2 } });
    host.sync({ ...landed, revisions: { ...landed.revisions, openingPreview: 2 } });
    expect(graphic.__coursecraftOpeningPreview?.impactCount).toBe(1);
    host.sync({ ...landed, revisions: { ...landed.revisions, openingPreview: 3 }, openingMarker: { ...landed.openingMarker!, progress: 0 } });
    expect(graphic.__coursecraftOpeningPreview).toMatchObject({ impact: null, impactCount: 0 });
    host.dispose();
    expect(layer.children).toEqual([]);
  });

  it("keeps the penalty ball at touchdown across rotations, elevations, and quality tiers", () => {
    const shot = { id: "shot-relief", shotNumber: 2, intent: "recovery" as const, club: "6i", from: { x: 1, y: 1 }, landing: { x: 5, y: 4 }, rest: { x: 12, y: 12 }, lieAfter: "penalty-relief", penaltyStrokes: 1 };
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const graphicsQuality of ["low", "medium", "high"] as const) {
        const layer = new PIXI.Container();
        const host = new SceneSystemHost([createOpeningPreviewSceneSystem(layer)]);
        expect(() => host.sync(snapshot(1, {
          rotation, graphicsQuality, reducedMotion: graphicsQuality === "low", surfaceHeightAt: () => 3,
          openingMarker: {
            previewId: "preview-1", golferId: "golfer-1", golferName: "Preview", shotId: shot.id, shot,
            index: 0, total: 1, progress: 1, golfer: shot.rest, ball: shot.rest, landing: shot.landing, rest: shot.rest, complete: false,
          },
        }))).not.toThrow();
        const graphic = layer.children[0] as PIXI.Graphics & { __coursecraftOpeningPreview?: { impactCount: number } };
        expect(graphic.__coursecraftOpeningPreview?.impactCount).toBeLessThanOrEqual(1);
        host.dispose();
        expect(layer.children).toEqual([]);
      }
    }
  });
});
