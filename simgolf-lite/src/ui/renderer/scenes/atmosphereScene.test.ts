import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../../../game/models/types";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";
import { heronSpot } from "../../../game/render/ambient";
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
    effectiveTiles: activeCourse.tiles,
    holes: [],
    draftTee: null,
    draftGreen: null,
    rotation: 0,
    graphicsQuality: "high",
    colorVision: "standard",
    reducedMotion: false,
    animationsEnabled: true,
    atlasRevision: 1,
    surveyMode: false,
    worldSeed: 17,
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere,
      surfaceCare: 0,
      structuresProps: 0,
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

describe("atmosphere scene lifecycle", () => {
  it("creates one owned stack in the established draw order and tears it down leak-free", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);

    expect(host.sync(snapshot(1))).toEqual(["atmosphere"]);
    expect(scene.system.objectCount()).toBe(6);
    expect(scene.stage.children[0]).toBe(scene.world);
    expect(scene.stage.children.at(-1)).toBe(scene.screenOverlay);
    expect(scene.stage.children).toHaveLength(4);
    expect(scene.fx.children).toHaveLength(4);
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
    expect(scene.system.objectCount()).toBe(6);
    host.dispose();
  });

  it("advances ambient motion through the game clock and preserves heron startle behavior", () => {
    const scene = fixture();
    const activeCourse = course();
    const host = new SceneSystemHost([scene.system]);
    host.sync(snapshot(1, { course: activeCourse }));

    scene.system.tick({ dtMs: 16, nowMs: 1_000, dayMinute: 31, ambienceFx: true });
    const cloud = scene.fx.children[0];
    expect(cloud.visible).toBe(true);
    const spot = heronSpot(activeCourse);
    expect(spot).not.toBeNull();
    const heron = scene.objects.children[0];
    expect(heron.visible).toBe(true);
    const standingX = heron.position.x;

    scene.system.startleAt(spot!, 1_000);
    scene.system.tick({ dtMs: 16, nowMs: 1_400, dayMinute: 32, ambienceFx: true });
    expect(heron.position.x).toBeGreaterThan(standingX);

    scene.system.tick({ dtMs: 16, nowMs: 3_000, dayMinute: 33, ambienceFx: false });
    expect(cloud.visible).toBe(false);
    expect(heron.visible).toBe(false);
    host.dispose();
  });
});
