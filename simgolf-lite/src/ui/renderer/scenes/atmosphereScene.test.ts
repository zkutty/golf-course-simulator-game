import * as PIXI from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course, Terrain } from "../../../game/models/types";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";
import { heronSpot, timeOfDayTint } from "../../../game/render/ambient";
import { tileCenterIso } from "../../../game/render/iso";
import { SceneSystemHost } from "../SceneSystemHost";
import { createAtmosphereSceneSystem } from "./atmosphereScene";

function course(): Course {
  const width = 5;
  const height = 5;
  const tiles: Terrain[] = new Array(width * height).fill("rough");
  tiles[2 * width + 2] = "water";
  return { width, height, tiles, holes: [] } as unknown as Course;
}

function snapshot(atmosphere: number, overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const activeCourse = overrides.course ?? course();
  return {
    course: activeCourse,
    obstacles: [],
    effectiveTiles: activeCourse.tiles,
    holes: [],
    draftTee: null,
    draftGreen: null,
    rotation: 0,
    graphicsQuality: "high",
    colorVision: "standard",
    reducedMotion: false,
    animationsEnabled: true,
    showObstacles: true,
    atlasRevision: 1,
    surveyMode: false,
    worldSeed: 17,
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 0,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

function fixture() {
  const stage = new PIXI.Container();
  const world = new PIXI.Container();
  const seasonalTerrain = new PIXI.Container();
  const objects = new PIXI.Container();
  const fx = new PIXI.Container();
  const screenOverlay = new PIXI.Container();
  world.addChild(seasonalTerrain, objects, fx);
  stage.addChild(world, screenOverlay);
  const system = createAtmosphereSceneSystem({
    stage,
    world,
    seasonalTerrain,
    objects,
    fx,
    screenOverlay,
    screen: () => ({ width: 800, height: 600 }),
  });
  return { stage, world, seasonalTerrain, objects, fx, screenOverlay, system };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("atmosphere scene lifecycle", () => {
  it("creates one owned stack in the established draw order and tears it down leak-free", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);

    expect(host.sync(snapshot(1))).toEqual(["atmosphere"]);
    expect(scene.system.objectCount()).toBe(2);
    expect(scene.stage.children[0]).toBe(scene.world);
    expect(scene.stage.children.at(-1)).toBe(scene.screenOverlay);
    expect(scene.stage.children).toHaveLength(3);
    expect(scene.fx.children).toHaveLength(1);
    expect(scene.system.readOwnedShimmerForTest()).toBeNull();
    expect(scene.objects.children).toHaveLength(1);

    host.dispose();
    host.dispose();
    expect(scene.system.objectCount()).toBe(0);
    expect(scene.stage.children).toEqual([scene.world, scene.screenOverlay]);
    expect(scene.fx.children).toHaveLength(0);
    expect(scene.objects.children).toHaveLength(0);
    expect(scene.seasonalTerrain.children).toHaveLength(0);
  });

  it("ignores unrelated revisions and updates declared atmosphere inputs", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    const first = snapshot(1);
    expect(host.sync(first)).toEqual(["atmosphere"]);

    const unrelated = {
      ...first,
      revisions: { ...first.revisions, surfaceCare: 9 },
    };
    expect(host.sync(unrelated)).toEqual([]);

    const changed = snapshot(2, { reducedMotion: true });
    expect(host.sync(changed)).toEqual(["atmosphere"]);
    expect(scene.system.objectCount()).toBe(2);
    host.dispose();
  });

  it("never creates cloud shadows or sky birds across days, rotations, and effect toggles", () => {
    const scene = fixture();
    const first = snapshot(1);
    scene.system.create!(first);
    scene.system.tick({ dtMs: 16, nowMs: 0, dayMinute: 0, ambienceFx: true });
    const tint = scene.stage.children[1];
    const shimmer = scene.fx.children[0];
    const heron = scene.objects.children[0];
    const clear = vi.spyOn(PIXI.Graphics.prototype, "clear");
    const setTimeout = vi.spyOn(globalThis, "setTimeout");
    const setInterval = vi.spyOn(globalThis, "setInterval");

    // Cross every former departure/flight boundary, three day rollovers,
    // and all view rotations while retaining the same course and objects.
    for (const rotation of [0, 90, 180, 270] as const) {
      scene.system.update!({ ...first, rotation });
      for (let minute = 0; minute <= 2_520; minute++) {
        scene.system.tick({
          dtMs: 16,
          nowMs: minute * 60_000,
          dayMinute: minute % 840,
          ambienceFx: minute % 3 !== 0,
        });
        expect(scene.stage.children).toEqual([scene.world, tint, scene.screenOverlay]);
        expect(scene.fx.children).toEqual([shimmer]);
        expect(scene.objects.children).toEqual([heron]);
        expect(scene.system.objectCount()).toBe(2);
      }
      // Editor frames without a game clock cannot trigger either overlay.
      scene.system.tick({ dtMs: 3_600_000, nowMs: 9_999_999, ambienceFx: true });
    }
    expect(clear).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
    scene.system.destroy!();
  });

  it("retains shimmer motion, rotation, and the borrowed fallback texture", () => {
    const scene = fixture();
    const first = snapshot(1);
    scene.system.create!(first);
    const shimmer = scene.fx.children[0] as PIXI.Sprite;
    const destroyWhite = vi.spyOn(PIXI.Texture.WHITE, "destroy");
    expect(shimmer.texture).toBe(PIXI.Texture.WHITE);
    expect(shimmer.blendMode).toBe("add");
    scene.system.tick({ dtMs: 16, nowMs: 10_000, dayMinute: 420, ambienceFx: true });
    expect(shimmer.visible).toBe(true);
    const firstPosition = { x: shimmer.x, y: shimmer.y };
    scene.system.tick({ dtMs: 16, nowMs: 11_000, dayMinute: 420, ambienceFx: true });
    expect(shimmer.position.x).not.toBe(firstPosition.x);
    const nextPosition = { x: shimmer.x, y: shimmer.y };
    scene.system.update!({ ...first, rotation: 90 });
    scene.system.tick({ dtMs: 16, nowMs: 11_000, dayMinute: 420, ambienceFx: true });
    expect({ x: shimmer.x, y: shimmer.y }).not.toEqual(nextPosition);
    scene.system.destroy!();
    scene.system.destroy!();
    expect(shimmer.destroyed).toBe(true);
    expect(destroyWhite).not.toHaveBeenCalled();
    expect(PIXI.Texture.WHITE.destroyed).toBe(false);
  });

  it("retains time-of-day tint and honors both ambience and animation settings", () => {
    const scene = fixture();
    const first = snapshot(1);
    scene.system.create!(first);
    const tint = scene.stage.children[1] as PIXI.Sprite;
    const shimmer = scene.fx.children[0];
    const heron = scene.objects.children[0];
    scene.system.tick({ dtMs: 6_000, nowMs: 10_000, dayMinute: 0, ambienceFx: true });
    expect(tint.tint).toBe(timeOfDayTint(0));
    expect(tint.visible).toBe(true);
    expect([tint.width, tint.height]).toEqual([800, 600]);
    expect(tint.blendMode).toBe("multiply");
    expect(shimmer.visible).toBe(true);
    expect(heron.visible).toBe(true);

    scene.system.tick({ dtMs: 6_000, nowMs: 10_000, dayMinute: 840, ambienceFx: true });
    expect(tint.tint).toBe(timeOfDayTint(840));
    scene.system.tick({ dtMs: 6_000, nowMs: 10_000, dayMinute: 840, ambienceFx: false });
    expect(tint.visible).toBe(false);
    expect(shimmer.visible).toBe(false);
    expect(heron.visible).toBe(false);
    scene.system.update!({ ...first, animationsEnabled: false });
    scene.system.tick({ dtMs: 6_000, nowMs: 10_000, dayMinute: 0, ambienceFx: true });
    expect(tint.visible).toBe(false);
    expect(shimmer.visible).toBe(false);
    expect(heron.visible).toBe(false);
    scene.system.update!(first);
    scene.system.tick({ dtMs: 6_000, nowMs: 10_000, dayMinute: 0, ambienceFx: true });
    expect(tint.visible).toBe(true);
    expect(shimmer.visible).toBe(true);
    expect(heron.visible).toBe(true);
    scene.system.destroy!();
  });

  it("preserves heron projection, startle, departure, and return", () => {
    const scene = fixture();
    const activeCourse = course();
    const first = snapshot(1, { course: activeCourse, rotation: 180, surfaceHeightAt: () => 3 });
    scene.system.create!(first);
    scene.system.tick({ dtMs: 16, nowMs: 1_000, dayMinute: 31, ambienceFx: true });
    const spot = heronSpot(activeCourse)!;
    const heron = scene.objects.children[0];
    const projected = tileCenterIso(spot.x, spot.y, 3, 180);
    expect(heron.visible).toBe(true);
    expect(heron.x).toBe(projected.x);
    expect(heron.y).toBeCloseTo(projected.y + Math.sin(1_000 / 1_100) * .4);

    scene.system.startleAt({ x: spot.x + 20, y: spot.y }, 1_000);
    scene.system.tick({ dtMs: 16, nowMs: 1_400, dayMinute: 32, ambienceFx: true });
    expect(heron.x).toBe(projected.x);
    scene.system.startleAt(spot, 1_400);
    scene.system.tick({ dtMs: 16, nowMs: 1_800, dayMinute: 33, ambienceFx: true });
    expect(heron.x).toBeGreaterThan(projected.x);
    expect(heron.alpha).toBeLessThan(1);
    scene.system.tick({ dtMs: 16, nowMs: 2_800, dayMinute: 34, ambienceFx: true });
    expect(heron.visible).toBe(false);
    scene.system.tick({ dtMs: 16, nowMs: 47_801, dayMinute: 35, ambienceFx: true });
    scene.system.tick({ dtMs: 16, nowMs: 47_817, dayMinute: 35, ambienceFx: true });
    expect(heron.visible).toBe(true);
    expect(heron.alpha).toBe(1);
    expect(heron.x).toBe(projected.x);
    scene.system.destroy!();
  });

  it("can destroy and recreate without retaining objects or reviving removed overlays", () => {
    const scene = fixture();
    for (let cycle = 0; cycle < 3; cycle++) {
      scene.system.create!(snapshot(cycle));
      scene.system.tick({ dtMs: 16, nowMs: 10_000, dayMinute: 31, ambienceFx: true });
      const owned = [scene.stage.children[1], ...scene.fx.children, ...scene.objects.children];
      scene.system.destroy!();
      scene.system.tick({ dtMs: 60_000, nowMs: 100_000, dayMinute: 196, ambienceFx: true });
      scene.system.startleAt({ x: 2, y: 1 }, 100_000);
      expect(owned.every((object) => object.destroyed)).toBe(true);
      expect(scene.system.objectCount()).toBe(0);
      expect(scene.stage.children).toEqual([scene.world, scene.screenOverlay]);
      expect(scene.fx.children).toHaveLength(0);
      expect(scene.objects.children).toHaveLength(0);
    }
  });

  it.each([false, true])("disposes the owned shimmer texture exactly once (creation fails: %s)", (failCreation) => {
    const texture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 256, height: 256 }) });
    const destroyTexture = vi.spyOn(texture, "destroy");
    const addColorStop = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop }),
        fillStyle: "",
        fillRect: vi.fn(),
      }),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.spyOn(PIXI.Texture, "from").mockReturnValue(texture);
    const scene = fixture();
    if (failCreation) {
      vi.spyOn(scene.fx, "addChild").mockImplementationOnce(() => { throw new Error("attach failed"); });
      expect(() => scene.system.create!(snapshot(1))).toThrow("attach failed");
    } else {
      scene.system.create!(snapshot(1));
      const sprite = scene.fx.children[0] as PIXI.Sprite;
      const source = texture.source;
      expect(sprite.texture).toBe(texture);
      expect(scene.system.readOwnedShimmerForTest()).toEqual({
        stage: scene.stage, world: scene.world, layer: scene.fx, sprite, texture, source,
      });
      const replacement = new PIXI.TextureSource({ width: 256, height: 256 });
      texture.source = replacement;
      expect(scene.system.readOwnedShimmerForTest()).toBeNull();
      texture.source = source;
      replacement.destroy();
      scene.system.tick({ dtMs: 16, nowMs: 10_000, dayMinute: 31, ambienceFx: true });
      expect(scene.fx.children[0].visible).toBe(true);
      scene.system.destroy!();
    }
    scene.system.destroy!();
    expect(destroyTexture).toHaveBeenCalledExactlyOnceWith(true);
    expect(texture.destroyed).toBe(true);
    expect(scene.system.readOwnedShimmerForTest()).toBeNull();
    expect(scene.system.objectCount()).toBe(0);
    expect(scene.stage.children).toEqual([scene.world, scene.screenOverlay]);
    expect(scene.fx.children).toHaveLength(0);
    expect(scene.objects.children).toHaveLength(0);
  });
});
