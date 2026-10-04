import { describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import { feeEmote } from "../../../game/render/emotes";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createLiveEntitiesSceneSystem } from "./liveEntitiesScene";

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

class FakeDisplay {
  parent: FakeContainer | null = null;
  label = "";
  position = point();
  scale = point(1, 1);
  anchor = point();
  visible = true;
  zIndex = 0;
  alpha = 1;
  tint: number | string = 0xffffff;
  texture: unknown = null;
  rotation = 0;
  destroyed = false;
  removeChildren(): FakeDisplay[] { return []; }
  destroy = vi.fn((_options?: { children?: boolean }) => { this.destroyed = true; });
}

class FakeGraphics extends FakeDisplay {
  clear = vi.fn();
  circle = vi.fn();
  ellipse = vi.fn();
  stroke = vi.fn();
  fill = vi.fn();
  moveTo = vi.fn();
  lineTo = vi.fn();
  roundRect = vi.fn();
  star = vi.fn();
  arc = vi.fn();
  poly = vi.fn();
}

class FakeSprite extends FakeDisplay {}

class FakeText extends FakeSprite {
  text = "";
}

class FakeContainer extends FakeDisplay {
  children: FakeDisplay[] = [];
  addLog: string[] | null = null;
  override destroy = vi.fn((options?: { children?: boolean }) => {
    this.destroyed = true;
    if (!options?.children) return;
    for (const child of this.children) child.destroy(options);
    this.children = [];
  });

  addChild<T extends FakeDisplay>(...children: T[]): T {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
      this.addLog?.push(this.label);
    }
    return children[0];
  }

  override removeChildren(): FakeDisplay[] {
    const children = [...this.children];
    for (const child of children) this.removeChild(child);
    return children;
  }

  removeChild<T extends FakeDisplay>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }
}

function golfer(id = 7, patch: Partial<GolferRenderData> = {}): GolferRenderData {
  return {
    id,
    x: 4,
    y: 6,
    ballX: null,
    ballY: null,
    ballToX: null,
    ballToY: null,
    color: "#f00",
    mood: 0.7,
    thought: null,
    archetype: "casual",
    segKind: "walk",
    segT: 0,
    shot: null,
    dirX: 1,
    dirY: 0,
    scoredHoles: 0,
    lastHoleDelta: 0,
    ...patch,
  };
}

function snapshot(revision = 1, patch: Partial<RenderSnapshot> = {}): RenderSnapshot {
  return {
    course: DEFAULT_COURSE,
    obstacles: DEFAULT_COURSE.obstacles,
    effectiveTiles: DEFAULT_COURSE.tiles,
    holes: DEFAULT_COURSE.holes,
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
      structuresProps: 0,
      playerProCollection: 0,
      mobilityEntities: 0,
      liveEntities: revision,
      naturalProps: 0,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...patch,
  };
}

const unbounded = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };

function fixture(options: { atlasReady?: boolean; addLog?: string[] } = {}) {
  const world = new FakeContainer();
  world.scale.set(1);
  const objects = new FakeContainer();
  objects.label = "objects";
  const terrainDecals = new FakeContainer();
  terrainDecals.label = "terrainDecals";
  const fx = new FakeContainer();
  fx.label = "fx";
  const screenOverlay = new FakeContainer();
  screenOverlay.label = "screenOverlay";
  screenOverlay.addLog = options.addLog ?? null;
  world.addChild(objects, terrainDecals, fx);
  const containers: FakeContainer[] = [];
  const graphics: FakeGraphics[] = [];
  const sprites: FakeSprite[] = [];
  const texture = { destroy: vi.fn() };
  const system = createLiveEntitiesSceneSystem(
    {
      objects: objects as unknown as PIXI.Container,
      terrainDecals: terrainDecals as unknown as PIXI.Container,
      fx: fx as unknown as PIXI.Container,
      screenOverlay: screenOverlay as unknown as PIXI.Container,
    },
    {
      atlasReady: () => options.atlasReady ?? false,
      golferFrame: () => texture as unknown as PIXI.Texture,
      createContainer: () => {
        const container = new FakeContainer();
        containers.push(container);
        return container as unknown as PIXI.Container;
      },
      createGraphics: () => {
        const graphic = new FakeGraphics();
        graphics.push(graphic);
        return graphic as unknown as PIXI.Graphics;
      },
      createSprite: () => {
        const sprite = new FakeSprite();
        sprites.push(sprite);
        return sprite as unknown as PIXI.Sprite;
      },
      createText: () => new FakeText() as unknown as PIXI.Text,
    },
  );
  return { objects, terrainDecals, fx, screenOverlay, containers, graphics, sprites, texture, system };
}

function tick(scene: ReturnType<typeof fixture>, golfers: readonly GolferRenderData[], tickMobilityEntities = vi.fn()) {
  scene.system.tickEffects(1_000, true);
  scene.system.tickEntities({
    nowMs: 1_000,
    animationsEnabled: true,
    golfers,
    cullBounds: unbounded,
    worldPointToScreen: (x, y) => ({ x, y }),
    followCamera: vi.fn(),
    startleAtmosphere: vi.fn(),
    tickMobilityEntities,
  });
  return tickMobilityEntities;
}

describe("live golfer, ball, emote, and transient scene ownership", () => {
  it("keeps pooled display identity across revision updates and tears down only owned resources", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    const first = snapshot(1);
    expect(host.sync(first)).toEqual(["liveEntities"]);
    tick(scene, [golfer()]);

    expect(scene.system.diagnostics().golfers).toBe(1);
    expect(scene.objects.children).toHaveLength(2);
    expect(scene.terrainDecals.children).toHaveLength(1);
    expect(scene.fx.children).toHaveLength(1);
    const ownedObjects = [...scene.objects.children];

    expect(host.sync(first)).toEqual([]);
    expect(host.sync(snapshot(2, { rotation: 90 }))).toEqual(["liveEntities"]);
    tick(scene, [golfer()]);
    expect(scene.objects.children).toEqual(ownedObjects);

    host.dispose();
    expect(scene.objects.children).toEqual([]);
    expect(scene.terrainDecals.children).toEqual([]);
    expect(scene.fx.children).toEqual([]);
    expect(scene.screenOverlay.children).toEqual([]);
    expect(scene.system.diagnostics()).toEqual({ golfers: 0, bubbles: 0, ripples: 0, impacts: 0 });
  });

  it("retires departed golfers before the M51 mobility callback and then places emotes", () => {
    const order: string[] = [];
    const scene = fixture({ addLog: order });
    scene.system.create!(snapshot());
    const mobility = vi.fn(() => order.push("mobility"));
    tick(scene, [golfer()], mobility);

    expect(mobility).toHaveBeenCalledOnce();
    expect(scene.system.diagnostics().golfers).toBe(1);
    expect(order[0]).toBe("mobility");
    expect(order.slice(1)).toContain("screenOverlay");

    const retiredBeforeMobility = vi.fn(() => {
      expect(scene.system.diagnostics().golfers).toBe(0);
    });
    tick(scene, [], retiredBeforeMobility);
    expect(retiredBeforeMobility).toHaveBeenCalledOnce();
  });

  it("borrows atlas textures while destroying its sprites and containers idempotently", () => {
    const scene = fixture({ atlasReady: true });
    scene.system.create!(snapshot());
    tick(scene, [golfer()]);
    expect(scene.sprites).toHaveLength(2);
    expect(scene.sprites.every((sprite) => sprite.texture === scene.texture)).toBe(true);

    scene.system.destroy!();
    scene.system.destroy!();
    expect(scene.texture.destroy).not.toHaveBeenCalled();
    expect(scene.sprites.every((sprite) => sprite.destroy.mock.calls.length === 1)).toBe(true);
    expect(scene.graphics.some((graphic) => graphic.destroy.mock.calls.length > 0)).toBe(true);
  });

  it("keeps camera follow and M51 ordering as callbacks without taking gameplay authority", () => {
    const scene = fixture();
    scene.system.create!(snapshot());
    const followCamera = vi.fn();
    const mobility = vi.fn();
    scene.system.tickEntities({
      nowMs: 1_000,
      animationsEnabled: false,
      golfers: [golfer(3, { x: 11, y: 12 })],
      selectedGolferId: 3,
      followSelected: true,
      cullBounds: unbounded,
      worldPointToScreen: (x, y) => ({ x, y }),
      followCamera,
      startleAtmosphere: vi.fn(),
      tickMobilityEntities: mobility,
    });

    expect(followCamera).toHaveBeenCalledWith(11, 12);
    expect(mobility).toHaveBeenCalledOnce();
  });
});


describe("actual Pixi emote context ownership", () => {
  function actualScene(sharedIcon?: PIXI.GraphicsContext) {
    const world = new PIXI.Container();
    const objects = world.addChild(new PIXI.Container());
    const screenOverlay = new PIXI.Container();
    const texture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 1, height: 1 }) });
    const graphics: PIXI.Graphics[] = [];
    const system = createLiveEntitiesSceneSystem({
      objects, screenOverlay,
      terrainDecals: new PIXI.Container(), fx: new PIXI.Container(),
    }, {
      atlasReady: () => false,
      createGraphics: () => {
        // Effect, ball shadow and ball precede the bubble background and empty icon.
        const graphic = sharedIcon && graphics.length === 4
          ? new PIXI.Graphics({ context: sharedIcon }) : new PIXI.Graphics();
        graphics.push(graphic);
        return graphic;
      },
      createText: () => new PIXI.Sprite(texture) as unknown as PIXI.Text,
    });
    system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 100 } }));
    const step = (nowMs: number, golfers = [golfer()]) => system.tickEntities({
      nowMs, golfers, animationsEnabled: false, cullBounds: unbounded,
      worldPointToScreen: (x, y) => ({ x, y }), followCamera: vi.fn(),
      startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn(),
    });
    return { system, screenOverlay, graphics, texture, step };
  }

  it.each(["expiry", "clear"])("releases drawn and empty owned contexts on %s exactly once", (mode) => {
    const scene = actualScene();
    scene.step(1_000);
    expect(scene.system.diagnostics().bubbles).toBe(1);
    const bubble = scene.screenOverlay.children[0];
    bubble.enableRenderGroup();
    const groupDestroy = vi.spyOn(bubble.renderGroup, "destroy");
    const background = bubble.children[0] as PIXI.Graphics;
    const icon = bubble.children.at(-1) as PIXI.Graphics;
    expect(background.context.instructions.map((instruction) => instruction.action)).toEqual(["fill", "stroke", "fill", "stroke", "fill", "stroke"]);
    expect(icon.context.instructions).toHaveLength(0);
    const managed: Record<string, unknown>[] = [];
    const renderer = new PIXI.GraphicsContextSystem({ uid: 702, gc: {
      now: 0, addResourceHash: (owner: object, key: string) => managed.push(Reflect.get(owner, key)),
    } } as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
    const contexts = [background.context, icon.context];
    const destroyed = contexts.map((context) => vi.spyOn(context, "destroy"));
    contexts.forEach((context) => renderer.getGpuContext(context));
    expect(Object.values(managed[0]).filter(Boolean)).toHaveLength(2);
    for (const graphic of [background, icon]) graphic.on("destroyed", () => {
      expect(groupDestroy).not.toHaveBeenCalled();
      expect(bubble.destroyed).toBe(false);
    });
    const textureDestroy = vi.spyOn(scene.texture, "destroy");
    if (mode === "expiry") scene.step(4_101);
    else scene.system.destroy!();
    expect(scene.system.diagnostics().bubbles).toBe(0);
    expect(Object.values(managed[0]).filter(Boolean)).toHaveLength(0);
    for (const [index, context] of contexts.entries()) {
      expect(destroyed[index]).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(context.listenerCount("update")).toBe(0);
      expect(context.listenerCount("destroy")).toBe(0);
      expect(context.listenerCount("unload")).toBe(0);
    }
    expect(groupDestroy).toHaveBeenCalledTimes(1);
    expect(textureDestroy).not.toHaveBeenCalled();
    scene.system.destroy!(); renderer.destroy();
    destroyed.forEach((destroy) => expect(destroy).toHaveBeenCalledTimes(1));
    scene.texture.destroy(true);
  });

  it("preserves a borrowed icon context and its sibling while detaching the retired icon", () => {
    const context = new PIXI.GraphicsContext();
    const sibling = new PIXI.Graphics({ context });
    const scene = actualScene(context);
    scene.step(1_000);
    const icon = scene.screenOverlay.children[0].children.at(-1) as PIXI.Graphics;
    expect(icon.context).toBe(context);
    expect(context.listenerCount("update")).toBe(2);
    const destroy = vi.spyOn(context, "destroy");
    scene.step(4_101);
    expect(icon.destroyed).toBe(true);
    expect(context.listenerCount("update")).toBe(1);
    expect(destroy).not.toHaveBeenCalled();
    sibling.didViewUpdate = false; context.dirty = false;
    context.rect(0, 0, 3, 3).fill(0xffffff);
    expect(sibling.didViewUpdate).toBe(true);
    scene.system.destroy!(); sibling.destroy(); context.destroy(); scene.texture.destroy(true);
  });

  it("keeps GPU registrations flat through repeated bubble creation and expiry", () => {
    const scene = actualScene();
    let registry: Record<string, unknown> = {};
    const renderer = new PIXI.GraphicsContextSystem({ uid: 702, gc: {
      now: 0, addResourceHash: (owner: object, key: string) => {
        if (key === "items") registry = Reflect.get(owner, key);
      },
    } } as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
    const ids = Array.from({ length: 100 }, (_, index) => index + 1).filter((id) => feeEmote(100, id));
    for (let cycle = 0; cycle < 12; cycle++) {
      const now = 1_000 + cycle * 10_000;
      scene.step(now, [golfer(ids[cycle])]);
      expect(scene.system.diagnostics().bubbles).toBe(1);
      const pair = scene.graphics.slice(-2);
      pair.forEach((graphic) => renderer.getGpuContext(graphic.context));
      expect(Object.values(registry).filter(Boolean)).toHaveLength(2);
      scene.step(now + 3_101, [golfer(ids[cycle])]);
      expect(scene.system.diagnostics().bubbles).toBe(0);
      expect(Object.values(registry).filter(Boolean)).toHaveLength(0);
    }
    scene.system.destroy!(); renderer.destroy(); scene.texture.destroy(true);
  });
});
