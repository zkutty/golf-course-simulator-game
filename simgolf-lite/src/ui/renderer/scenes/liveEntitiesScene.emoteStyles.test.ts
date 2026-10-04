import { describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import { feeEmote } from "../../../game/render/emotes";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { RenderSnapshot } from "../RenderSnapshot";
import { destroySceneSubtree } from "../destroySceneSubtree";
import { createLiveEntitiesSceneSystem } from "./liveEntitiesScene";

const feeIds = Array.from({ length: 100 }, (_, index) => index + 1).filter((id) => feeEmote(100, id)).slice(0, 5);
const golfer = (id: number, patch: Partial<GolferRenderData> = {}): GolferRenderData => ({
  id, x: 4, y: 6, ballX: null, ballY: null, ballToX: null, ballToY: null,
  color: "#f00", mood: 0.7, thought: null, archetype: "casual", segKind: "walk",
  segT: 0, shot: null, dirX: 1, dirY: 0, scoredHoles: 0, lastHoleDelta: 0, ...patch,
});

function scene(baseGreenFee = 100, terrain?: "sand") {
  const world = new PIXI.Container();
  const objects = world.addChild(new PIXI.Container());
  const terrainDecals = world.addChild(new PIXI.Container());
  const fx = world.addChild(new PIXI.Container());
  const screenOverlay = new PIXI.Container();
  const texts: PIXI.Text[] = [];
  const course = { ...DEFAULT_COURSE, baseGreenFee };
  const snapshot: RenderSnapshot = {
    course, obstacles: course.obstacles, effectiveTiles: terrain ? course.tiles.map(() => terrain) : course.tiles,
    holes: course.holes, draftTee: null, draftGreen: null, rotation: 0, graphicsQuality: "high",
    colorVision: "standard", reducedMotion: false, animationsEnabled: true, showObstacles: true,
    atlasRevision: 1, surveyMode: false, worldSeed: 42, surfaceHeightAt: () => 2,
    revisions: { atmosphere: 0, surfaceCare: 0, structuresProps: 0, playerProCollection: 0,
      mobilityEntities: 0, liveEntities: 1, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0 },
  };
  const system = createLiveEntitiesSceneSystem({ objects, terrainDecals, fx, screenOverlay }, {
    atlasReady: () => false,
    createText: (options) => { const text = new PIXI.Text(options); texts.push(text); return text; },
  });
  system.create!(snapshot);
  const step = (nowMs: number, golfers: readonly GolferRenderData[], animationsEnabled = false) => system.tickEntities({
    nowMs, golfers, animationsEnabled, cullBounds: { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity },
    worldPointToScreen: (x, y) => ({ x, y }), followCamera: vi.fn(), startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn(),
  });
  const dispose = () => { system.destroy!(); destroySceneSubtree(world); destroySceneSubtree(screenOverlay); };
  return { system, texts, step, dispose, screenOverlay };
}

function appearance(text: PIXI.Text) {
  return { text: text.text, fontFamily: text.style.fontFamily, fontWeight: text.style.fontWeight,
    fontSize: text.style.fontSize, fill: text.style.fill,
    anchor: { x: text.anchor.x, y: text.anchor.y }, position: { x: text.position.x, y: text.position.y } };
}

describe("shared emote typography across scene lifetimes", () => {
  it("reuses one actual text/style cache key through twelve recreated five-bubble scenes", () => {
    const styleKeys = new Set<string>();
    const textKeys = new Set<string>();
    let sharedStyle: PIXI.TextStyle | undefined;
    for (let cycle = 0; cycle < 12; cycle++) {
      const current = scene();
      try {
        current.step(1_000, feeIds.map((id) => golfer(id)));
        expect(current.system.diagnostics().bubbles).toBe(5);
        expect(current.texts).toHaveLength(5);
        for (const text of current.texts) {
          styleKeys.add(text.style.styleKey); textKeys.add(text.styleKey);
          sharedStyle ??= text.style;
          expect(text.style).toBe(sharedStyle);
          expect(appearance(text)).toEqual({ text: "$", fontFamily: "Arial, sans-serif", fontWeight: "900",
            fontSize: 16, fill: 0xc0392b, anchor: { x: 0.5, y: 0.5 }, position: { x: 0, y: -25 } });
        }
        expect(sharedStyle!.listenerCount("update")).toBe(5);
        if (cycle % 2 === 0) {
          current.step(4_101, feeIds.map((id) => golfer(id)));
          expect(current.system.diagnostics().bubbles).toBe(0);
        }
      } finally { current.dispose(); }
      expect(current.texts.every((text) => text.destroyed)).toBe(true);
      expect(sharedStyle!.listenerCount("update")).toBe(0);
    }
    expect(styleKeys.size).toBe(1);
    expect(textKeys.size).toBe(1);
  });

  it("preserves distinct value/sleep typography and shares warning typography with alert", () => {
    const good = scene(20), bad = scene(), alert = scene(40, "sand"), sleep = scene(40);
    try {
      good.step(1_000, [golfer(feeIds[0])]); bad.step(1_000, [golfer(feeIds[0])]);
      alert.step(1_000, [golfer(feeIds[0], { ballX: 4, ballY: 6, ballToX: 4, ballToY: 6, segKind: "flight", segT: 1 })], true);
      sleep.step(1_000, [golfer(8), golfer(7)]);
      sleep.step(6_001, [golfer(8, { x: 5 }), golfer(7)]);
      const texts = [good, bad, alert, sleep].map((current) => {
        expect(current.texts).toHaveLength(1); return current.texts[0];
      });
      expect(texts.map(appearance)).toEqual([
        { text: "$", fontFamily: "Arial, sans-serif", fontWeight: "900", fontSize: 16, fill: 0x2f8a4a, anchor: { x: 0.5, y: 0.5 }, position: { x: 0, y: -25 } },
        { text: "$", fontFamily: "Arial, sans-serif", fontWeight: "900", fontSize: 16, fill: 0xc0392b, anchor: { x: 0.5, y: 0.5 }, position: { x: 0, y: -25 } },
        { text: "!", fontFamily: "Arial, sans-serif", fontWeight: "900", fontSize: 16, fill: 0xc0392b, anchor: { x: 0.5, y: 0.5 }, position: { x: 0, y: -25 } },
        { text: "Zz", fontFamily: "Arial, sans-serif", fontWeight: "900", fontSize: 13, fill: 0x4a5568, anchor: { x: 0.5, y: 0.5 }, position: { x: 0, y: -25 } },
      ]);
      expect(texts[1].style).toBe(texts[2].style);
      expect(new Set(texts.map((text) => text.style)).size).toBe(3);
      expect(new Set(texts.map((text) => text.styleKey)).size).toBe(4);
    } finally { [good, bad, alert, sleep].forEach((current) => current.dispose()); }
  });

  it("detaches only retired Text listeners and never destroys the shared style or live sibling", () => {
    const current = scene();
    current.step(1_000, [golfer(feeIds[0])]);
    const style = current.texts[0].style;
    const sibling = new PIXI.Text({ text: "$", style });
    const destroy = vi.spyOn(style, "destroy");
    try {
      expect(style.listenerCount("update")).toBe(2);
      current.dispose();
      expect(style.listenerCount("update")).toBe(1);
      expect(sibling.destroyed).toBe(false);
      sibling.didViewUpdate = false;
      style.emit("update", style);
      expect(sibling.didViewUpdate).toBe(true);
      expect(style.fill).toBe(0xc0392b);
      expect(destroy).not.toHaveBeenCalled();
    } finally { destroySceneSubtree(sibling); destroy.mockRestore(); }
    expect(style.listenerCount("update")).toBe(0);
  });
});
