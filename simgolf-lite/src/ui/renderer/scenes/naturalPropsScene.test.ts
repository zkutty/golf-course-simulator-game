import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import { BIOME_KEYS } from "../../../game/models/biomes";
import type { RenderSnapshot } from "../RenderSnapshot";
import {
  createNaturalPropsSceneSystem,
  naturalPropFallbackBiome,
} from "./naturalPropsScene";

class FakeContainer {
  children: unknown[] = [];

  addChild<T extends { parent?: FakeContainer | null }>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends { parent?: FakeContainer | null }>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }
}

function point() {
  return {
    x: 0,
    y: 0,
    set(x: number, y = x) {
      this.x = x;
      this.y = y;
    },
  };
}

function fakeTexture() {
  return {
    width: 64,
    height: 64,
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
    skew: point(),
    width: 0,
    height: 0,
    tint: 0,
    alpha: 1,
    zIndex: 0,
    destroy: vi.fn(),
  } as unknown as PIXI.Sprite;
}

function fakeGraphics() {
  const graphics = {
    parent: null as FakeContainer | null,
    position: point(),
    ellipse: vi.fn(),
    circle: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    destroy: vi.fn(),
  };
  return graphics as unknown as PIXI.Graphics;
}

function snapshot(overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = {
    ...DEFAULT_STATE.course,
    obstacles: [{ x: 8, y: 9, type: "tree" as const }],
  };
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
    atlasRevision: 1,
    surveyMode: false,
    worldSeed: 42,
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 1,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

describe("natural props scene ownership", () => {
  it("derives procedural fallback ownership from every registered biome", () => {
    for (const biome of BIOME_KEYS) {
      expect(naturalPropFallbackBiome(`${biome}_tree_registry_probe`)).toBe(biome);
    }
    expect(naturalPropFallbackBiome("unregistered_tree_probe")).toBeNull();
  });

  it("rebuilds and tears down sprites, shadows, and habitats without destroying shared atlas textures", () => {
    const objects = new FakeContainer();
    const decals = new FakeContainer();
    const atlasTexture = fakeTexture();
    const sprites: ReturnType<typeof fakeSprite>[] = [];
    const graphics: ReturnType<typeof fakeGraphics>[] = [];
    const counts: number[] = [];
    const scene = createNaturalPropsSceneSystem(
      objects as unknown as PIXI.Container,
      decals as unknown as PIXI.Container,
      (count) => counts.push(count),
      {
        getAtlasTexture: () => atlasTexture,
        createSprite: (texture) => {
          const sprite = fakeSprite(texture);
          sprites.push(sprite);
          return sprite;
        },
        createGraphics: () => {
          const item = fakeGraphics();
          graphics.push(item);
          return item;
        },
      },
    );

    scene.create!(snapshot());
    expect(scene.rebuildCount()).toBe(1);
    expect(scene.contentCount()).toBe(1);
    expect(objects.children).toHaveLength(1);
    expect(decals.children).toHaveLength(2);

    scene.update!(snapshot({ atlasRevision: 2 }));
    expect(scene.rebuildCount()).toBe(2);
    expect(sprites[0].destroy).toHaveBeenCalledTimes(1);
    expect(graphics[0].destroy).toHaveBeenCalledTimes(1);
    expect(graphics[1].destroy).toHaveBeenCalledTimes(1);
    expect(atlasTexture.destroy).not.toHaveBeenCalled();
    expect(scene.contentCount()).toBe(1);

    scene.destroy!();
    expect(sprites[1].destroy).toHaveBeenCalledTimes(1);
    expect(atlasTexture.destroy).not.toHaveBeenCalled();
    expect(objects.children).toHaveLength(0);
    expect(decals.children).toHaveLength(0);
    expect(counts).toEqual([0, 1, 0, 1, 0]);
  });

  it("destroys each scene-owned fallback texture on update and final dispose", () => {
    const ownedFallbacks: PIXI.Texture[] = [];
    const scene = createNaturalPropsSceneSystem(
      new FakeContainer() as unknown as PIXI.Container,
      new FakeContainer() as unknown as PIXI.Container,
      undefined,
      {
        getAtlasTexture: () => null,
        createFallbackTexture: () => {
          const texture = fakeTexture();
          ownedFallbacks.push(texture);
          return { texture, owned: true };
        },
        createSprite: fakeSprite,
        createGraphics: fakeGraphics,
      },
    );

    scene.create!(snapshot());
    expect(scene.fallbackTextureCount()).toBe(1);
    scene.update!(snapshot({ atlasRevision: 2 }));
    expect(ownedFallbacks[0].destroy).toHaveBeenCalledWith(true);
    expect(ownedFallbacks[1].destroy).not.toHaveBeenCalled();
    scene.destroy!();
    expect(ownedFallbacks[1].destroy).toHaveBeenCalledWith(true);
  });

  it("keeps sway and tall-prop occlusion metadata inside the scene runtime", () => {
    const sprites: ReturnType<typeof fakeSprite>[] = [];
    const scene = createNaturalPropsSceneSystem(
      new FakeContainer() as unknown as PIXI.Container,
      new FakeContainer() as unknown as PIXI.Container,
      undefined,
      {
        getAtlasTexture: () => fakeTexture(),
        createSprite: (texture) => {
          const sprite = fakeSprite(texture);
          sprites.push(sprite);
          return sprite;
        },
        createGraphics: fakeGraphics,
      },
    );
    scene.create!(snapshot());
    const sprite = sprites[0];

    scene.tick({
      nowMs: 1_000,
      animationsEnabled: true,
      treeSway: true,
      focus: { x: sprite.position.x, y: sprite.position.y },
    });
    expect(sprite.skew.x).not.toBe(0);
    expect(sprite.alpha).toBeLessThan(1);

    scene.tick({
      nowMs: 2_000,
      animationsEnabled: false,
      treeSway: false,
      focus: null,
    });
    expect(sprite.skew.x).toBe(0);
    expect(sprite.alpha).toBe(1);
  });

  it("creates no display objects when natural obstacles are hidden", () => {
    const objects = new FakeContainer();
    const decals = new FakeContainer();
    const scene = createNaturalPropsSceneSystem(
      objects as unknown as PIXI.Container,
      decals as unknown as PIXI.Container,
      undefined,
      {
        getAtlasTexture: () => fakeTexture(),
        createSprite: fakeSprite,
        createGraphics: fakeGraphics,
      },
    );

    scene.create!(snapshot({ showObstacles: false }));
    expect(scene.contentCount()).toBe(0);
    expect(objects.children).toHaveLength(0);
    expect(decals.children).toHaveLength(0);
  });
});
