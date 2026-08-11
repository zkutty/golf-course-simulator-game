import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import type { Course, Decoration, LandTheme, Terrain } from "../../../game/models/types";
import { plantDefinition } from "../../../game/models/plantRegistry";
import { TILE_H, TILE_W } from "../../../game/render/iso";
import {
  seasonalDecorationPlantForm,
  seasonalPlantClimate,
  seasonalPlantPresentation,
} from "../../../game/render/seasonalPlants";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import {
  createStableSceneDecalLayers,
  createStructuresPropsSceneSystem,
} from "./structuresPropsScene";

class FakeContainer {
  children: unknown[] = [];

  addChild<T extends { parent?: FakeContainer | null }>(...children: T[]): T {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return children[0];
  }

  removeChild<T extends { parent?: FakeContainer | null }>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }
}

function point(x = 0, y = 0) {
  return {
    x,
    y,
    set(nextX: number, nextY = nextX) {
      this.x = nextX;
      this.y = nextY;
    },
  };
}

function fakeTexture() {
  return {
    width: 64,
    height: 48,
    destroy: vi.fn(),
  } as unknown as PIXI.Texture;
}

function fakeSprite(texture: PIXI.Texture) {
  return {
    texture,
    parent: null as FakeContainer | null,
    label: "",
    anchor: point(),
    position: point(),
    scale: point(1, 1),
    width: 0,
    height: 0,
    tint: 0xffffff,
    alpha: 1,
    zIndex: 0,
    eventMode: "auto",
    destroy: vi.fn(),
  } as unknown as PIXI.Sprite;
}

function fakeGraphics() {
  return {
    parent: null as FakeContainer | null,
    position: point(),
    eventMode: "auto",
    ellipse: vi.fn(),
    fill: vi.fn(),
    destroy: vi.fn(),
  } as unknown as PIXI.Graphics;
}

const decorations: Decoration[] = [
  { kind: "bench", x: 4, y: 5, rotation: 0, origin: "player" },
  { kind: "bridge", x: 7, y: 8, rotation: 1, span: 3, origin: "player" },
  {
    kind: "flower_bed",
    x: 10,
    y: 11,
    rotation: 0,
    plantId: "parkland-perennial-bed",
    origin: "player",
  },
];

function course(theme: LandTheme = "parkland", authored = decorations): Course {
  const width = DEFAULT_STATE.course.width;
  const tiles = [...DEFAULT_STATE.course.tiles] as Terrain[];
  tiles[11 * width + 11] = "water";
  return {
    ...DEFAULT_STATE.course,
    theme,
    tiles,
    elevations: [...DEFAULT_STATE.course.elevations],
    buildings: [],
    decorations: authored,
  };
}

function snapshot(
  revision = 1,
  overrides: Partial<RenderSnapshot> = {},
): RenderSnapshot {
  const activeCourse = overrides.course ?? course();
  return {
    course: activeCourse,
    obstacles: activeCourse.obstacles,
    effectiveTiles: activeCourse.tiles,
    holes: activeCourse.holes,
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
    worldSeed: 42,
    surfaceHeightAt: () => 2,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: revision,
      playerProCollection: 0,
      naturalProps: 0,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

function fixture(overrides: {
  getAtlasTexture?: () => PIXI.Texture | null;
  createSprite?: (texture: PIXI.Texture) => PIXI.Sprite;
  createGraphics?: () => PIXI.Graphics;
} = {}) {
  const objects = new FakeContainer();
  const decals = new FakeContainer();
  const texture = fakeTexture();
  const sprites: ReturnType<typeof fakeSprite>[] = [];
  const graphics: ReturnType<typeof fakeGraphics>[] = [];
  const atlasCalls: unknown[][] = [];
  const counts: number[] = [];
  const system = createStructuresPropsSceneSystem(
    objects as unknown as PIXI.Container,
    decals as unknown as PIXI.Container,
    (count) => counts.push(count),
    {
      getAtlasTexture: (...args) => {
        atlasCalls.push(args);
        return overrides.getAtlasTexture ? overrides.getAtlasTexture() : texture;
      },
      createSprite: overrides.createSprite ?? ((input) => {
        const sprite = fakeSprite(input);
        sprites.push(sprite);
        return sprite;
      }),
      createGraphics: overrides.createGraphics ?? (() => {
        const graphic = fakeGraphics();
        graphics.push(graphic);
        return graphic;
      }),
    },
  );
  return { objects, decals, texture, sprites, graphics, atlasCalls, counts, system };
}

describe("structures and authored props scene ownership", () => {
  it("preserves decoration atlas, anchor, footprint, rotation, depth, scale, and shadow presentation", () => {
    const scene = fixture();
    scene.system.create!(snapshot());

    expect(scene.system.contentCount()).toBe(3);
    expect(scene.objects.children).toHaveLength(3);
    expect(scene.decals.children).toHaveLength(3);
    expect(scene.atlasCalls).toEqual([
      ["parkland", "high", "parkland_bench"],
      ["parkland", "high", "parkland_bridge"],
      ["parkland", "high", "parkland_flower_bed"],
    ]);

    const [bench, bridge, flower] = scene.sprites;
    expect([bench.anchor.x, bench.anchor.y]).toEqual([0.5, 1]);
    expect(bench.width).toBeCloseTo(TILE_W * 0.95);
    expect(bench.height).toBeCloseTo(bench.width * 0.75);
    expect(bench.zIndex % 1).toBeCloseTo(0.05);
    expect(bench.eventMode).toBe("none");
    expect(bridge.width).toBeCloseTo(5 * 0.72 * TILE_W);
    expect(bridge.scale.x).toBe(-1);
    const flowerPlant = plantDefinition("parkland-perennial-bed");
    const flowerSeasonal = seasonalPlantPresentation({
      identity: flowerPlant.id,
      profile: flowerPlant.seasonalProfile,
      form: seasonalDecorationPlantForm("flower_bed", flowerPlant.seasonalProfile),
      x: 10,
      y: 11,
      cultivated: true,
      elevation: 0,
      nearWater: true,
      ecologicalFit: flowerPlant.ecologicalFit.parkland,
      climate: seasonalPlantClimate(undefined),
    });
    expect(flower.width).toBeCloseTo(TILE_W * 0.95 * flowerSeasonal.scaleX);
    expect(flower.tint).toBe(flowerSeasonal.tint);
    expect(flower.alpha).toBe(flowerSeasonal.alpha);

    const bridgeShadow = scene.graphics[1];
    expect(bridgeShadow.ellipse).toHaveBeenCalledWith(
      0,
      0,
      bridge.width * 0.38,
      8,
    );
    expect(bridgeShadow.position.y).toBe(bridge.position.y - TILE_H / 2 + 2);
    expect(bridgeShadow.eventMode).toBe("none");
    expect(scene.graphics[2].ellipse).toHaveBeenCalledWith(
      0,
      0,
      15 * flowerSeasonal.shadowScale,
      5 * flowerSeasonal.shadowScale,
    );
  });

  it("is a host-level no-op for an unchanged revision and replaces ownership once on update", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    expect(host.sync(snapshot(1))).toEqual(["structuresProps"]);
    expect(host.sync(snapshot(1, { course: { ...course() } }))).toEqual([]);
    expect(scene.system.rebuildCount()).toBe(1);

    expect(host.sync(snapshot(2, { rotation: 180 }))).toEqual(["structuresProps"]);
    expect(scene.system.rebuildCount()).toBe(2);
    expect(scene.sprites.slice(0, 3).every((sprite) => vi.mocked(sprite.destroy).mock.calls.length === 1)).toBe(true);
    expect(scene.graphics.slice(0, 3).every((graphic) => vi.mocked(graphic.destroy).mock.calls.length === 1)).toBe(true);
    expect(scene.texture.destroy).not.toHaveBeenCalled();
    expect(scene.objects.children).toHaveLength(3);
    expect(scene.decals.children).toHaveLength(3);

    host.dispose();
    host.dispose();
    expect(scene.objects.children).toHaveLength(0);
    expect(scene.decals.children).toHaveLength(0);
    expect(scene.texture.destroy).not.toHaveBeenCalled();
    expect(scene.counts).toEqual([0, 3, 0, 3, 0]);
  });

  it("keeps estate, natural, and decoration-shadow order stable across atlas and authored-only rebuilds", () => {
    const terrainDecals = new FakeContainer();
    const decalLayers = createStableSceneDecalLayers(
      terrainDecals as unknown as PIXI.Container,
      () => new FakeContainer() as unknown as PIXI.Container,
    );
    const estateMarker = fakeGraphics();
    const naturalMarker = fakeGraphics();
    decalLayers.estateSurvey.addChild(estateMarker);
    decalLayers.naturalProps.addChild(naturalMarker);

    const objects = new FakeContainer();
    const shadows: ReturnType<typeof fakeGraphics>[] = [];
    const scene = createStructuresPropsSceneSystem(
      objects as unknown as PIXI.Container,
      decalLayers.structuresProps,
      () => {},
      {
        getAtlasTexture: () => fakeTexture(),
        createSprite: (texture) => fakeSprite(texture),
        createGraphics: () => {
          const shadow = fakeGraphics();
          shadows.push(shadow);
          return shadow;
        },
      },
    );
    const host = new SceneSystemHost([scene]);
    const stableLayerOrder = [...terrainDecals.children];

    expect(stableLayerOrder).toEqual([
      decalLayers.estateSurvey,
      decalLayers.naturalProps,
      decalLayers.structuresProps,
    ]);
    expect(host.sync(snapshot(1))).toEqual(["structuresProps"]);
    expect(terrainDecals.children).toEqual(stableLayerOrder);
    expect(decalLayers.estateSurvey.children).toEqual([estateMarker]);
    expect(decalLayers.naturalProps.children).toEqual([naturalMarker]);
    expect(decalLayers.structuresProps.children).toHaveLength(3);

    expect(host.sync(snapshot(2, { atlasRevision: 2 }))).toEqual(["structuresProps"]);
    expect(terrainDecals.children).toEqual(stableLayerOrder);
    expect(decalLayers.estateSurvey.children).toEqual([estateMarker]);
    expect(decalLayers.naturalProps.children).toEqual([naturalMarker]);
    expect(decalLayers.structuresProps.children).toHaveLength(3);

    const authoredCourse = course("parkland", decorations.slice(0, 2));
    expect(host.sync(snapshot(3, {
      atlasRevision: 2,
      course: authoredCourse,
      effectiveTiles: authoredCourse.tiles,
    }))).toEqual(["structuresProps"]);
    expect(terrainDecals.children).toEqual(stableLayerOrder);
    expect(decalLayers.estateSurvey.children).toEqual([estateMarker]);
    expect(decalLayers.naturalProps.children).toEqual([naturalMarker]);
    expect(decalLayers.structuresProps.children).toHaveLength(2);
    expect(shadows.slice(0, 6).every((shadow) => (
      vi.mocked(shadow.destroy).mock.calls.length === 1
    ))).toBe(true);

    host.dispose();
    expect(terrainDecals.children).toEqual(stableLayerOrder);
    expect(decalLayers.estateSurvey.children).toEqual([estateMarker]);
    expect(decalLayers.naturalProps.children).toEqual([naturalMarker]);
    expect(decalLayers.structuresProps.children).toHaveLength(0);
  });

  it("skips missing shared atlas frames without creating orphan shadows", () => {
    const scene = fixture({ getAtlasTexture: () => null });
    scene.system.create!(snapshot());
    expect(scene.system.contentCount()).toBe(0);
    expect(scene.objects.children).toHaveLength(0);
    expect(scene.decals.children).toHaveLength(0);
  });

  it("cleans partial ownership after failure and allows the host to retry the same revision", () => {
    let calls = 0;
    const scene = fixture({
      createGraphics: () => {
        calls++;
        if (calls === 1) throw new Error("graphics unavailable");
        return fakeGraphics();
      },
    });
    const host = new SceneSystemHost([scene.system]);

    expect(() => host.sync(snapshot(1))).toThrow("graphics unavailable");
    expect(scene.objects.children).toHaveLength(0);
    expect(scene.decals.children).toHaveLength(0);
    expect(scene.sprites[0].destroy).toHaveBeenCalledTimes(1);
    expect(scene.texture.destroy).not.toHaveBeenCalled();

    expect(host.sync(snapshot(1))).toEqual(["structuresProps"]);
    expect(scene.system.rebuildCount()).toBe(2);
    expect(scene.objects.children).toHaveLength(3);
    expect(scene.decals.children).toHaveLength(3);
    host.dispose();
  });

  it.each([
    ["parkland", "high", 0],
    ["links", "medium", 90],
    ["desert", "low", 180],
    ["parkland", "high", 270],
  ] as const)("uses the %s biome, %s quality, and rotation %i without cross-atlas fallback", (theme, quality, rotation) => {
    const authored: Decoration[] = [{ kind: "bench", x: 4, y: 5, rotation: 1, origin: "player" }];
    const scene = fixture();
    scene.system.create!(snapshot(1, {
      course: course(theme, authored),
      effectiveTiles: course(theme, authored).tiles,
      graphicsQuality: quality,
      rotation,
    }));
    expect(scene.atlasCalls).toEqual([[theme, quality, `${theme}_bench`]]);
    expect(scene.sprites[0].scale.x).toBe(-1);
  });
});
