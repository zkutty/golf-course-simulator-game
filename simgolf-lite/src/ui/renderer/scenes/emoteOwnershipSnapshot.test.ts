import { describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import { feeEmote, type EmoteKind } from "../../../game/render/emotes";
import type { GolferRenderData } from "../../../game/live/types";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { destroySceneSubtree } from "../destroySceneSubtree";
import { createLiveEntitiesSceneSystem } from "./liveEntitiesScene";
import { captureEmoteOwnership } from "./emoteOwnershipSnapshot";

function fixture(kind: EmoteKind = "cashBad") {
  const stage = new PIXI.Container(), overlay = stage.addChild(new PIXI.Container());
  const group = overlay.addChild(new PIXI.Container());
  const graphic = group.addChild(new PIXI.Graphics());
  const glyph = kind === "zzz" ? "Zz" : kind === "alert" ? "!" : ["cashGood", "cashBad"].includes(kind) ? "$" : null;
  const text = glyph === null ? null : group.addChild(new PIXI.Text({ text: glyph }));
  group.addChild(new PIXI.Graphics());
  const input = { generation: 1, stage, overlay, currentOwner: true, apiIdentityCurrent: true,
    bubbles: new Map([[7, group]]), active: [{ golferId: 7, kind }], builtKinds: new WeakMap([[group, kind]]) };
  return { input, group, graphic, text, snapshot: () => captureEmoteOwnership(input), dispose: () => destroySceneSubtree(stage) };
}

describe("bounded current emote ownership", () => {
  it.each<EmoteKind>(["star", "happy", "angry", "storm", "zzz", "cashGood", "cashBad", "alert"])("admits the complete primitive-only %s shape", (kind) => {
    const f = fixture(kind);
    try {
      const result = f.snapshot();
      expect(result.complete).toBe(true);
      expect(result.groups[0].builtKind).toBe(kind);
      expect(result.groups[0].children.every((child) => child.childCount === 0)).toBe(true);
      expect(result.contribution?.displayObjects).toBe(f.group.children.length + 1);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    } finally { f.dispose(); }
  });

  it("refuses truthy nonboolean owner/API flags", () => {
    for (const key of ["currentOwner", "apiIdentityCurrent"]) {
      const f = fixture();
      try {
        Object.assign(f.input, { [key]: "true" });
        expect(f.snapshot()).toMatchObject({ complete: false, contribution: null });
      } finally { f.dispose(); }
    }
  });

  const controls: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ["obsolete API", (f) => { f.input.apiIdentityCurrent = false; }],
    ["obsolete owner", (f) => { f.input.currentOwner = false; }],
    ["wrong stage", (f) => { f.input.stage = new PIXI.Container(); }],
    ["detached group", (f) => { f.input.overlay.removeChild(f.group); }],
    ["destroyed group", (f) => { destroySceneSubtree(f.group); }],
    ["duplicate scheduler key", (f) => { f.input.active.push({ ...f.input.active[0] }); }],
    ["owner/scheduler mismatch", (f) => { f.input.active[0].golferId = 8; }],
    ["missing built kind", (f) => { f.input.builtKinds.delete(f.group); }],
    ["built/scheduled kind mismatch", (f) => { f.input.active[0].kind = "alert"; }],
    ["wrong glyph", (f) => { f.text!.text = "!"; }],
    ["extra group child", (f) => { f.group.addChild(new PIXI.Container()); }],
    ["extra leaf child", (f) => { f.graphic.addChild(new PIXI.Container()); }],
    ["wrong child class", (f) => { const old = f.group.removeChildAt(0); old.destroy(); f.group.addChildAt(new PIXI.Container(), 0); }],
    ["duplicate display identity", (f) => { Object.defineProperty(f.graphic, "uid", { value: f.group.uid }); }],
    ["over cap before projection", (f) => { for (let i = 0; i < 6; i++) f.input.bubbles.set(100 + i, f.group); }],
  ];
  it.each(controls)("fails closed on %s", (_name, mutate) => {
    const f = fixture();
    try {
      mutate(f);
      expect(f.snapshot()).toMatchObject({ complete: false, contribution: null, groups: [] });
    } finally {
      if (!f.group.destroyed && f.group.parent === null) destroySceneSubtree(f.group);
      if (!f.input.overlay.destroyed) destroySceneSubtree(f.input.overlay);
      if (!f.input.stage.destroyed) destroySceneSubtree(f.input.stage);
    }
  });

  it("captures actual source-created five bubbles, expiry and disposal without historical display refs", () => {
    const stage = new PIXI.Container(), world = stage.addChild(new PIXI.Container());
    const overlay = stage.addChild(new PIXI.Container());
    const layers = { objects: world.addChild(new PIXI.Container()), terrainDecals: world.addChild(new PIXI.Container()), fx: world.addChild(new PIXI.Container()), screenOverlay: overlay };
    const course = { ...DEFAULT_COURSE, baseGreenFee: 100 };
    const snapshot: RenderSnapshot = { course, obstacles: course.obstacles, effectiveTiles: course.tiles, holes: course.holes,
      draftTee: null, draftGreen: null, rotation: 0, graphicsQuality: "high", colorVision: "standard", reducedMotion: false,
      animationsEnabled: false, showObstacles: true, atlasRevision: 1, surveyMode: false, worldSeed: 42, surfaceHeightAt: () => 2,
      revisions: { atmosphere: 0, surfaceCare: 0, structuresProps: 0, playerProCollection: 0, mobilityEntities: 0, liveEntities: 1, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0 } };
    const system = createLiveEntitiesSceneSystem(layers, { atlasReady: () => false });
    const ids = Array.from({ length: 100 }, (_, i) => i + 1).filter((id) => feeEmote(100, id)).slice(0, 5);
    const golfers: GolferRenderData[] = ids.map((id) => ({ id, x: 4, y: 6, ballX: null, ballY: null, ballToX: null, ballToY: null,
      color: "#f00", mood: 0.7, thought: null, archetype: "casual", segKind: "walk", segT: 0, shot: null, dirX: 1, dirY: 0, scoredHoles: 0, lastHoleDelta: 0 }));
    const step = (nowMs: number) => system.tickEntities({ nowMs, golfers, animationsEnabled: false,
      cullBounds: { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity }, worldPointToScreen: (x, y) => ({ x, y }),
      followCamera: vi.fn(), startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn() });
    try {
      let failCreate = true;
      let failedGeneration = 0;
      const host = new SceneSystemHost([{ ...system, create: (next) => {
        system.create!(next);
        step(1000);
        failedGeneration ||= system.emoteOwnership(stage, overlay, true, true).generation;
        if (failCreate) { failCreate = false; throw new Error("deliberate host create failure"); }
      } }]);
      expect(() => host.sync(snapshot)).toThrow("deliberate host create failure");
      expect(system.emoteOwnership(stage, overlay, true, true).complete).toBe(false);
      expect(overlay.children).toHaveLength(0);
      host.sync(snapshot);

      const current = system.emoteOwnership(stage, overlay, true, true);
      expect(current.complete).toBe(true);
      expect(current.generation).toBeGreaterThan(failedGeneration);
      expect(current.ownerCount).toBe(5);
      expect(current.contribution).toEqual({ displayObjects: 20, graphics: 10, text: 5 });
      expect(current.groups.every((g) => g.builtKind === "cashBad" && g.schedulerKind === "cashBad")).toBe(true);
      expect(system.emoteOwnership(stage, new PIXI.Container(), true, true).complete).toBe(false);
      step(4101);
      expect(system.emoteOwnership(stage, overlay, true, true)).toMatchObject({ complete: true, ownerCount: 0, contribution: { displayObjects: 0 } });
      system.destroy!();
      expect(system.emoteOwnership(stage, overlay, true, true)).toMatchObject({ complete: false, contribution: null });
      system.update!(snapshot);
      expect(system.emoteOwnership(stage, overlay, true, true).complete).toBe(false);
    } finally { destroySceneSubtree(stage); }
  });
});
