import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import type { PlayerProWorldDisplayPresentation } from "../../../game/playerPro/socialPresentation";
import type { RenderSnapshot } from "../RenderSnapshot";
import { createPlayerProCollectionSceneSystem } from "./playerProCollectionScene";

class FakeContainer {
  children: Array<{ parent?: FakeContainer | null }> = [];

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
  return { x: 0, y: 0, set(x: number, y = x) { this.x = x; this.y = y; } };
}

function fakeTexture() {
  return { width: 64, height: 40, destroy: vi.fn() } as unknown as PIXI.Texture;
}

function fakeSprite(texture: PIXI.Texture) {
  return {
    texture,
    parent: null as FakeContainer | null,
    label: "",
    anchor: point(),
    position: point(),
    scale: { x: 1, y: 1 },
    width: 0,
    height: 0,
    zIndex: 0,
    eventMode: "auto",
    destroy: vi.fn(),
  } as unknown as PIXI.Sprite;
}

function fakeGraphics() {
  const graphics = {
    parent: null as FakeContainer | null,
    label: "",
    position: point(),
    zIndex: 0,
    eventMode: "auto",
    roundRect() { return this; },
    circle() { return this; },
    ellipse() { return this; },
    poly() { return this; },
    moveTo() { return this; },
    lineTo() { return this; },
    fill() { return this; },
    stroke() { return this; },
    destroy: vi.fn(),
  };
  return graphics as unknown as PIXI.Graphics;
}

const worldDisplay: PlayerProWorldDisplayPresentation = {
  revision: "vehicle:roadster|bag:bag|outfit:outfit|watch:watch|trophy:trophy|keepsake:keepsake|plant-stock:stock",
  vehicle: { id: "roadster", name: "Roadster", category: "vehicle" },
  equipped: [
    { id: "bag", name: "Bag", category: "bag" },
    { id: "outfit", name: "Outfit", category: "outfit" },
    { id: "watch", name: "Watch", category: "watch" },
  ],
  collection: [
    { id: "trophy", name: "Trophy", category: "trophy" },
    { id: "keepsake", name: "Keepsake", category: "keepsake" },
    { id: "stock", name: "Plant stock", category: "plant-stock" },
  ],
};

function snapshot(overrides: Partial<RenderSnapshot> = {}): RenderSnapshot {
  const course = {
    ...DEFAULT_STATE.course,
    buildings: [{ id: "clubhouse", type: "clubhouse" as const, x: 5, y: 5 }],
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
    playerProWorldDisplay: worldDisplay,
    surveyMode: false,
    worldSeed: 42,
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 1,
      naturalProps: 0,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

describe("Player Pro world collection scene", () => {
  it("creates, updates, and destroys only the visible selected display deterministically", () => {
    const objects = new FakeContainer();
    const texture = fakeTexture();
    const sprites: PIXI.Sprite[] = [];
    const graphics: PIXI.Graphics[] = [];
    const scene = createPlayerProCollectionSceneSystem(objects as unknown as PIXI.Container, {
      getAtlasTexture: () => texture,
      createSprite: (candidate) => {
        const sprite = fakeSprite(candidate);
        sprites.push(sprite);
        return sprite;
      },
      createGraphics: () => {
        const item = fakeGraphics();
        graphics.push(item);
        return item;
      },
    });

    scene.create!(snapshot());
    expect(scene.labels()).toEqual([
      "player-pro-display:vehicle:roadster",
      "player-pro-display:bag:bag",
      "player-pro-display:outfit:outfit",
      "player-pro-display:watch:watch",
      "player-pro-display:trophy:trophy",
      "player-pro-display:keepsake:keepsake",
      "player-pro-display:plant-stock:stock",
    ]);
    expect(scene.contentCount()).toBe(7);
    expect(objects.children).toHaveLength(7);
    expect(new Set(objects.children.map((entry) => (entry as unknown as { position: { x: number } }).position.x)).size).toBeGreaterThan(1);

    scene.update!(snapshot({ playerProWorldDisplay: { ...worldDisplay, revision: "vehicle:none", vehicle: null } }));
    expect(scene.contentCount()).toBe(6);
    expect(sprites[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(graphics.slice(0, 6).every((entry) => vi.mocked(entry.destroy).mock.calls.length === 1)).toBe(true);
    expect(texture.destroy).not.toHaveBeenCalled();

    scene.destroy!();
    expect(objects.children).toHaveLength(0);
    expect(texture.destroy).not.toHaveBeenCalled();
    expect(scene.rebuildCount()).toBe(2);
  });

  it("uses a scene-owned vector fallback when the optional vehicle frame is missing", () => {
    const objects = new FakeContainer();
    const graphics: PIXI.Graphics[] = [];
    const scene = createPlayerProCollectionSceneSystem(objects as unknown as PIXI.Container, {
      getAtlasTexture: () => null,
      createSprite: fakeSprite,
      createGraphics: () => {
        const item = fakeGraphics();
        graphics.push(item);
        return item;
      },
    });
    scene.create!(snapshot({
      playerProWorldDisplay: { revision: "vehicle:roadster", vehicle: worldDisplay.vehicle, equipped: [], collection: [] },
    }));
    expect(scene.labels()).toEqual(["player-pro-display:vehicle:roadster"]);
    expect(graphics).toHaveLength(1);
    scene.destroy!();
    expect(graphics[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["bottom edge", (_width: number, height: number) => ({ x: 5, y: height - 3 })],
    ["right edge", (width: number, _height: number) => ({ x: width - 6, y: 5 })],
    ["bottom-right edge", (width: number, height: number) => ({ x: width - 6, y: height - 3 })],
  ])("keeps every display position distinct at the %s", (_name, clubhousePosition) => {
    const objects = new FakeContainer();
    const base = DEFAULT_STATE.course;
    const position = clubhousePosition(base.width, base.height);
    const course = {
      ...base,
      buildings: [{ id: "clubhouse", type: "clubhouse" as const, ...position }],
    };
    const scene = createPlayerProCollectionSceneSystem(objects as unknown as PIXI.Container, {
      getAtlasTexture: () => fakeTexture(),
      createSprite: fakeSprite,
      createGraphics: fakeGraphics,
    });

    scene.create!(snapshot({ course }));
    const positions = objects.children.map((entry) => {
      const display = entry as unknown as { position: { x: number; y: number } };
      return `${display.position.x}:${display.position.y}`;
    });
    expect(scene.contentCount()).toBe(7);
    expect(new Set(positions).size).toBe(7);
  });

  it("renders nothing without a clubhouse or a visible player display", () => {
    const objects = new FakeContainer();
    const scene = createPlayerProCollectionSceneSystem(objects as unknown as PIXI.Container, {
      getAtlasTexture: () => fakeTexture(),
      createSprite: fakeSprite,
      createGraphics: fakeGraphics,
    });
    scene.create!(snapshot({ playerProWorldDisplay: null }));
    expect(scene.contentCount()).toBe(0);
    scene.update!(snapshot({ course: { ...DEFAULT_STATE.course, buildings: [] } }));
    expect(scene.contentCount()).toBe(0);
  });
});
