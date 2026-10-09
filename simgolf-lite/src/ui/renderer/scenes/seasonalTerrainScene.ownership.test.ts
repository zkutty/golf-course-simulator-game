import { createHash } from "node:crypto";
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_STATE } from "../../../game/gameState";
import type { Course, Terrain } from "../../../game/models/types";
import { seasonalVisualState } from "../../../game/presentation/seasonalVisualState";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { destroySceneSubtree } from "../destroySceneSubtree";
import { createAtmosphereSceneSystem } from "./atmosphereScene";
import { createSeasonalTerrainSceneSystem } from "./seasonalTerrainScene";

function snapshot(revision = 1): RenderSnapshot {
  const tiles: Terrain[] = new Array(100).fill("rough");
  tiles[55] = "water";
  const course: Course = { ...DEFAULT_STATE.course, width: 10, height: 10,
    tiles, elevations: new Array(100).fill(0), holes: [], obstacles: [] };
  const seasonal = seasonalVisualState({ course, world: DEFAULT_STATE.world, day: 0 });
  return {
    course, obstacles: [], effectiveTiles: tiles, holes: [], draftTee: null, draftGreen: null,
    rotation: 0, graphicsQuality: "high", colorVision: "standard", reducedMotion: false,
    animationsEnabled: true, showObstacles: true, atlasRevision: 1, surveyMode: false,
    worldSeed: 17, surfaceHeightAt: () => 0,
    seasonalVisualState: { ...seasonal,
      weather: { ...seasonal.weather, kind: "heavy_rain", severity: .92, rainInches: .8 },
      renderer: { ...seasonal.renderer, wetness: .96, dryness: .24, frost: 0 } },
    revisions: { atmosphere: revision, surfaceCare: 0, structuresProps: 0,
      playerProCollection: 0, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0 },
  };
}

function atmosphere() {
  const stage = new PIXI.Container();
  const world = new PIXI.Container();
  const seasonalTerrain = new PIXI.Container();
  const objects = new PIXI.Container();
  const fx = new PIXI.Container();
  const screenOverlay = new PIXI.Container();
  world.addChild(seasonalTerrain, objects, fx);
  stage.addChild(world, screenOverlay);
  const system = createAtmosphereSceneSystem({ stage, world, seasonalTerrain, objects, fx,
    screenOverlay, screen: () => ({ width: 800, height: 600 }) });
  return { stage, world, seasonalTerrain, objects, fx, screenOverlay, system };
}

function drawingHash(graphics: PIXI.Graphics): string {
  const text = JSON.stringify(graphics.context.instructions, (_key, value) =>
    value instanceof PIXI.Texture ? { texture: value === PIXI.Texture.WHITE ? "WHITE" : "other",
      width: value.width, height: value.height } : value);
  return createHash("sha256").update(text).digest("hex");
}

function watchContext(graphics: PIXI.Graphics) {
  const context = graphics.context;
  let destroys = 0;
  context.on("destroy", () => { destroys++; });
  return { context, destroys: () => destroys };
}

describe("seasonal and atmosphere owned context lifetime", () => {
  it("preserves the original seasonal drawing across replacement", () => {
    const layer = new PIXI.Container();
    const system = createSeasonalTerrainSceneSystem(layer);
    const input = snapshot();
    system.render!(input);
    const original = layer.children[0] as PIXI.Graphics;
    expect(original).toBeInstanceOf(PIXI.Graphics);
    expect(drawingHash(original)).toBe("3ac023b0ab747ad4d492caf015f24fd3522f0273377f8d1f0efd2b378528e3e7");
    system.render!(input);
    expect(drawingHash(layer.children[0] as PIXI.Graphics)).toBe("3ddc62698ab4c88b48545711fec783e441a9cb1c3663c334a97500111a03b4b6");
    destroySceneSubtree(layer);
  });

  it("destroys replaced seasonal contexts once, including nested owned graphics", () => {
    const layer = new PIXI.Container();
    const system = createSeasonalTerrainSceneSystem(layer);
    system.render!(snapshot());
    const old = layer.children[0] as PIXI.Graphics;
    const owned = watchContext(old);
    const nested = new PIXI.Graphics().rect(0, 0, 2, 2).fill(0xffffff);
    old.addChild(nested);
    const nestedOwned = watchContext(nested);
    system.render!(snapshot(2));
    expect(old.destroyed).toBe(true);
    expect(nested.destroyed).toBe(true);
    expect(owned.destroys()).toBe(1);
    expect(nestedOwned.destroys()).toBe(1);
    expect(owned.context.instructions).toBeNull();
    destroySceneSubtree(old);
    expect(owned.destroys()).toBe(1);
    destroySceneSubtree(layer);
  });

  it("disposes final seasonal, bird and heron contexts once through the actual host", () => {
    const scene = atmosphere();
    const host = new SceneSystemHost([scene.system]);
    host.sync(snapshot());
    scene.system.tick({ dtMs: 16, nowMs: 1000, dayMinute: 31, ambienceFx: true });
    const seasonal = scene.seasonalTerrain.children[0] as PIXI.Graphics;
    const bird = scene.stage.children.find(child => child instanceof PIXI.Graphics) as PIXI.Graphics;
    const heron = scene.objects.children[0] as PIXI.Graphics;
    const observed = [seasonal, bird, heron].map(watchContext);
    host.dispose();
    host.dispose();
    for (const owned of observed) {
      expect(owned.destroys()).toBe(1);
      expect(owned.context.instructions).toBeNull();
    }
    expect(scene.stage.children).toEqual([scene.world, scene.screenOverlay]);
    expect(scene.seasonalTerrain.children).toHaveLength(0);
    destroySceneSubtree(scene.stage);
  });

  it("keeps borrowed shared contexts, sibling updates and white textures alive", () => {
    const shared = new PIXI.GraphicsContext().rect(0, 0, 3, 3).fill(0xffffff);
    const sibling = new PIXI.Graphics(shared);
    const removed = new PIXI.Graphics(shared);
    const layer = new PIXI.Container();
    layer.addChild(removed, new PIXI.Sprite(PIXI.Texture.WHITE));
    let destroyed = 0;
    shared.on("destroy", () => { destroyed++; });
    const system = createSeasonalTerrainSceneSystem(layer);
    system.render!(snapshot());
    expect(removed.destroyed).toBe(true);
    expect(sibling.destroyed).toBe(false);
    expect(destroyed).toBe(0);
    expect(shared.instructions).not.toBeNull();
    const before = shared.instructions.length;
    shared.circle(2, 2, 1).fill(0x00ff00);
    expect(sibling.context.instructions.length).toBeGreaterThan(before);
    expect(PIXI.Texture.WHITE.destroyed).toBe(false);
    expect(PIXI.Texture.WHITE.source.destroyed).toBe(false);
    destroySceneSubtree(layer);
    destroySceneSubtree(sibling);
    shared.destroy();
  });
});
