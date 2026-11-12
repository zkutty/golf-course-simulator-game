import { createRetainedShotMotion, sampleRetainedShotMotion } from "../../../game/rules/shotMotion";
import { resolveObstacleCollision } from "../../../game/rules/obstacleCollision";
import { tileCenterIso, type IsoRotation } from "../../../game/render/iso";
import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createLiveEntitiesSceneSystem } from "./liveEntitiesScene";
import * as emoteFeed from "../../../game/render/emoteFeed";

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
  destroy = vi.fn((_options?: { children?: boolean }) => {});
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

function fixture(options: { atlasReady?: boolean; addLog?: string[]; readPopulation?: () => { readonly generation: symbol; readonly golfers: readonly GolferRenderData[] } } = {}) {
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
      ...{ readPopulation: options.readPopulation },
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


function retainedGolfer(progress: number, terrain = "fairway", active = true): GolferRenderData {
  const at = (x: number, y: number) => ({ point: { x, y }, heightYards: 5 });
  const flight = resolveObstacleCollision({ from: { x: 1, y: 5 }, to: { x: 11, y: 5 },
    flight: { profile: "standard", apexHeightYards: 4, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 2 } },
    width: 16, height: 16, yardsPerTile: 10, elevations: Array(256).fill(2), obstacles: [], retainGeometry: true }).retained!;
  const motion = createRetainedShotMotion({ identity: { shotId: "retained", holeId: "one", shotNumber: 1, seed: 42, club: "7 Iron", style: "straight_run", modelVersion: "club_styles_v1" },
    yardsPerTile: 10, from: at(1, 5), landing: at(11, 5), physicalRest: at(12, 6), flight,
    rollPath: [at(11, 5), at(12, 6)], reliefPosition: { x: 2, y: 3 }, holed: false })!;
  const pose = sampleRetainedShotMotion(motion, progress)!;
  return golfer(7, { x: 1, y: 5, ballX: active ? pose.point.x : null, ballY: active ? pose.point.y : null,
    ballToX: 12, ballToY: 6, segKind: active ? "flight" : "walk", shot: "swing", segT: progress,
    ballMotion: { identity: motion.identity, pose, events: motion.events, contactTerrain: terrain, collisionTerrain: null, active } });
}

describe("retained live ball rendering", () => {
  it("draws the ordinary AI ball with its authored fill and an outside stroke", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    try {
      host.sync(snapshot());
      tick(scene, [retainedGolfer(.36)]);
      const ball = scene.objects.children[1];
      if (!(ball instanceof FakeGraphics)) throw new Error("The ordinary AI ball must be owned graphics");
      expect(ball.visible).toBe(true);
      expect(ball.alpha).toBe(1);
      expect(ball.circle.mock.calls).toEqual([[0, -2, 2.2]]);
      expect(ball.fill.mock.calls).toEqual([[0xffffff]]);
      expect(ball.stroke.mock.calls).toEqual([[{ width: 0.8, color: 0x555555, alignment: 0 }]]);
      expect(ball.circle.mock.invocationCallOrder[0]).toBeLessThan(ball.fill.mock.invocationCallOrder[0]);
      expect(ball.fill.mock.invocationCallOrder[0]).toBeLessThan(ball.stroke.mock.invocationCallOrder[0]);

      tick(scene, [retainedGolfer(.54)]);
      expect(scene.objects.children[1]).toBe(ball);
      expect(ball.circle).toHaveBeenCalledOnce();
      expect(ball.fill).toHaveBeenCalledOnce();
      expect(ball.stroke).toHaveBeenCalledOnce();
    } finally {
      host.dispose();
    }
  });

  it.each([0, 90, 180, 270] as IsoRotation[])("projects absolute committed heights and curved points at rotation %s without generated bounces", (rotation) => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    host.sync(snapshot(1, { rotation }));
    for (const progress of [.36, .8, .92]) {
      const value = retainedGolfer(progress);
      tick(scene, [value]);
      const pose = value.ballMotion!.pose;
      const ball = scene.objects.children[1];
      expect(ball.position).toMatchObject(tileCenterIso(pose.point.x, pose.point.y, pose.heightYards / 2.5, rotation));
      expect(scene.terrainDecals.children[0].position).toMatchObject(tileCenterIso(pose.point.x, pose.point.y, 2, rotation));
    }
    const value = retainedGolfer(.36);
    host.sync(snapshot(2, { rotation, surfaceHeightAt: () => 17 }));
    tick(scene, [value]);
    expect(scene.objects.children[1].position).toMatchObject(tileCenterIso(value.ballX!, value.ballY!, value.ballMotion!.pose.heightYards / 2.5, rotation));
    host.dispose();
  });

  it("emits one contact splash across skipped frames and keeps relief a bounded static marker", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    host.sync(snapshot());
    const startle = vi.fn();
    const value = retainedGolfer(.9, "water");
    const input = { nowMs: 1000, animationsEnabled: true, golfers: [value], cullBounds: unbounded,
      worldPointToScreen: (x: number, y: number) => ({ x, y }), followCamera: vi.fn(), startleAtmosphere: startle, tickMobilityEntities: vi.fn() };
    scene.system.tickEntities(input);
    expect(scene.system.diagnostics().ripples).toBe(1);
    expect(startle).toHaveBeenCalledTimes(1);
    expect(scene.objects.children[1].visible).toBe(false);
    const marker = scene.terrainDecals.children.find((child) => child.label === "live-shot-relief-marker")!;
    expect(marker.position).toMatchObject(tileCenterIso(2, 3, 2, 0));
    const graphicsCount = scene.graphics.length;
    for (let i = 0; i < 20; i++) scene.system.tickEntities({ ...input, golfers: [retainedGolfer(1, "water", false)] });
    expect(startle).toHaveBeenCalledTimes(1);
    expect(scene.graphics).toHaveLength(graphicsCount);
    expect(scene.system.diagnostics().ripples).toBe(1);
    expect(marker.position).toMatchObject(tileCenterIso(2, 3, 2, 0));
    host.dispose();
    expect(marker.destroy).toHaveBeenCalledTimes(1);
  });
});


describe("100-golfer retained scene budget", () => {
  it("keeps display pools stable across all rotations and offscreen culling", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    const golfers = Array.from({ length: 100 }, (_, index) => {
      const value = retainedGolfer(.36);
      value.id = index + 1;
      value.ballMotion!.identity = { ...value.ballMotion!.identity, shotId: `retained-${index}` };
      return value;
    });
    host.sync(snapshot());
    tick(scene, golfers);
    const owned = [...scene.objects.children];
    const graphics = scene.graphics.length;
    for (const rotation of [0, 90, 180, 270] as const) {
      host.sync(snapshot(rotation + 2, { rotation }));
      scene.system.tickEntities({ nowMs: 1200, animationsEnabled: true, golfers,
        cullBounds: { left: 10000, right: 11000, top: 10000, bottom: 11000 },
        worldPointToScreen: (x, y) => ({ x, y }), followCamera: vi.fn(), startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn() });
      expect(scene.system.diagnostics().golfers).toBe(100);
      expect(scene.objects.children).toEqual(owned);
      expect(scene.graphics).toHaveLength(graphics);
    }
    host.dispose();
    expect(scene.objects.children).toHaveLength(0);
    expect(scene.terrainDecals.children).toHaveLength(0);
  });
});


type Population = Readonly<{ generation: symbol; golfers: readonly GolferRenderData[] }>;
function populationTick(scene: ReturnType<typeof fixture>, drawn: readonly GolferRenderData[], nowMs = 1_000, renderGolfers = true) {
  scene.system.tickEffects(nowMs, true);
  const input = { nowMs, animationsEnabled: true, golfers: drawn, renderGolfers, cullBounds: unbounded,
    worldPointToScreen: (x: number, y: number) => ({ x, y }), followCamera: vi.fn(), startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn() };
  scene.system.tickEntities(input);
}

describe("ZK-1498 coherent population fee feedback", () => {
  it("seeds existing population without replaying walk-in feedback", () => {
    const population: Population = Object.freeze({ generation: Symbol(), golfers: Object.freeze([6, 7, 14, 15, 21].map((id) => Object.freeze(golfer(id)))) });
    const before = JSON.stringify(population.golfers);
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      populationTick(scene, population.golfers);
      expect(scene.system.diagnostics().bubbles).toBe(0);
      expect(scene.screenOverlay.children).toEqual([]);
      expect(JSON.stringify(population.golfers)).toBe(before);
    } finally { scene.system.destroy!(); }
  });

  it("seeds only existing IDs while a new arrival on the same first visible tick gets one fee bubble", () => {
    const generation = Symbol();
    let population: Population = { generation, golfers: [golfer(6)] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      population = { generation, golfers: [golfer(6), golfer(7)] };
      populationTick(scene, population.golfers);
      expect(scene.system.diagnostics().bubbles).toBe(1);
      const bubble = scene.screenOverlay.children[0];
      populationTick(scene, population.golfers, 1_100);
      expect(scene.screenOverlay.children).toEqual([bubble]);
    } finally { scene.system.destroy!(); }
  });

  it("uses coherent matching data and drops hidden unobserved seeds on daily ID reuse without an empty observation", () => {
    let population: Population = { generation: Symbol(), golfers: [golfer(6)] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      populationTick(scene, [], 1_000, false);
      expect(scene.system.diagnostics().golfers).toBe(0);
      population = { generation: Symbol(), golfers: [golfer(6)] };
      // The compatibility draw list is stale/empty: only the coherent pair is authoritative.
      populationTick(scene, [], 2_000, true);
      expect(scene.system.diagnostics().golfers).toBe(1);
      expect(scene.system.diagnostics().bubbles).toBe(1);
    } finally { scene.system.destroy!(); }
  });
});


describe("ZK-1498 population lifecycle controls", () => {
  it("ZK-1498 correction3 keeps seeded fee processing across visible-hidden-visible ticks", () => {
    const population: Population = { generation: Symbol(), golfers: [golfer(6)] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      populationTick(scene, [], 1_000);
      populationTick(scene, [], 2_000, false);
      populationTick(scene, [], 10_000);
      expect(scene.system.diagnostics()).toMatchObject({ golfers: 1, bubbles: 0 });
    } finally { scene.system.destroy!(); }
  });

  it("ZK-1498 correction3 processes an observed genuine arrival once across hide/show beyond cooldown", () => {
    const record = vi.spyOn(emoteFeed, "recordEmote");
    const generation = Symbol();
    let population: Population = { generation, golfers: [] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      population = { generation, golfers: [golfer(6)] };
      populationTick(scene, [], 1_000);
      populationTick(scene, [], 2_000, false);
      populationTick(scene, [], 10_000);
      expect(record.mock.calls.filter(([id, kind]) => id === 6 && kind === "cashBad")).toHaveLength(1);
      population = { generation, golfers: [] };
      populationTick(scene, [], 11_000, false);
      population = { generation, golfers: [golfer(6)] };
      populationTick(scene, [], 20_000);
      expect(record.mock.calls.filter(([id, kind]) => id === 6 && kind === "cashBad")).toHaveLength(2);
    } finally { scene.system.destroy!(); record.mockRestore(); }
  });

  it("ZK-1498 correction3 retires recent thoughts on generation replacement but leaves renderer-only disposal unchanged", () => {
    emoteFeed.__resetEmoteFeedForTests();
    const generation = Symbol();
    let population: Population = { generation, golfers: [] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      population = { generation, golfers: [golfer(6)] };
      populationTick(scene, [], 1_000);
      expect(emoteFeed.recentEmotes(6).map((event) => event.atMs)).toEqual([1_000]);
      population = { generation: Symbol(), golfers: [golfer(6)] };
      populationTick(scene, [], 2_000);
      expect(emoteFeed.recentEmotes(6).map((event) => event.atMs)).toEqual([2_000]);
      scene.system.destroy!();
      expect(emoteFeed.recentEmotes(6).map((event) => event.atMs)).toEqual([2_000]);
    } finally { scene.system.destroy!(); emoteFeed.__resetEmoteFeedForTests(); }
  });

  it("keeps hidden initial seeds but retires absent unobserved IDs without suppressing future arrivals", () => {
    const generation = Symbol();
    let population: Population = { generation, golfers: [golfer(6)] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      populationTick(scene, [], 1_000, false);
      populationTick(scene, [], 1_100, true);
      expect(scene.system.diagnostics()).toMatchObject({ golfers: 1, bubbles: 0 });
      populationTick(scene, [], 1_200, false);
      population = { generation, golfers: [] };
      populationTick(scene, [], 1_300, false);
      population = { generation, golfers: [golfer(7)] };
      populationTick(scene, [], 2_000, true);
      expect(scene.system.diagnostics().bubbles).toBe(1);
    } finally { scene.system.destroy!(); }

    let hidden: Population = { generation, golfers: [golfer(6)] };
    const retired = fixture({ readPopulation: () => hidden });
    retired.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      hidden = { generation, golfers: [] };
      populationTick(retired, [], 1_000, false);
      hidden = { generation, golfers: [golfer(6)] };
      populationTick(retired, [], 2_000, true);
      expect(retired.system.diagnostics().bubbles).toBe(1);
    } finally { retired.system.destroy!(); }
  });

  it("gives a genuinely new eligible arrival exactly one fee event after an empty initial population", () => {
    const record = vi.spyOn(emoteFeed, "recordEmote");
    const generation = Symbol();
    let population: Population = { generation, golfers: [] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      populationTick(scene, [], 1_000);
      population = { generation, golfers: [golfer(6)] };
      populationTick(scene, [], 2_000);
      populationTick(scene, [], 2_100);
      expect(record.mock.calls.filter(([id, kind]) => id === 6 && kind === "cashBad")).toHaveLength(1);
      expect(scene.system.diagnostics().bubbles).toBe(1);
    } finally { scene.system.destroy!(); record.mockRestore(); }
  });

  it("releases overlapping old-generation entities and bubbles before reused ID arrival without destroying borrowed textures", () => {
    const generation = Symbol();
    let population: Population = { generation, golfers: [] };
    const scene = fixture({ atlasReady: true, readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      population = { generation, golfers: [golfer(6)] };
      populationTick(scene, [], 1_000);
      const oldHolder = scene.objects.children[0];
      const oldBubble = scene.screenOverlay.children[0];
      const oldBubbleChildren = [...(oldBubble as FakeContainer).children];
      const effect = scene.fx.children[0];
      population = { generation: Symbol(), golfers: [golfer(6, { x: 20, mood: .3 })] };
      populationTick(scene, [golfer(6)], 2_000);
      expect(oldHolder.destroy).toHaveBeenCalledOnce();
      expect(oldBubble.destroy).toHaveBeenCalledOnce();
      expect(oldBubbleChildren.every((node) => node.destroy.mock.calls.length === 1)).toBe(true);
      expect(scene.objects.children[0]).not.toBe(oldHolder);
      expect(scene.screenOverlay.children[0]).not.toBe(oldBubble);
      expect(scene.system.diagnostics()).toMatchObject({ golfers: 1, bubbles: 1 });
      expect(scene.fx.children).toEqual([effect]);
      expect(scene.texture.destroy).not.toHaveBeenCalled();
    } finally { scene.system.destroy!(); }
  });

  it("preserves mood and hole reactions for seeded golfers with exact expiry and cooldown", () => {
    const record = vi.spyOn(emoteFeed, "recordEmote");
    const generation = Symbol();
    let population: Population = { generation, golfers: [golfer(6)] };
    const scene = fixture({ readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      populationTick(scene, [], 1_000);
      population = { generation, golfers: [golfer(6, { mood: .9 })] };
      populationTick(scene, [], 2_000);
      const bubble = scene.screenOverlay.children[0];
      populationTick(scene, [], 5_099);
      expect(scene.system.diagnostics().bubbles).toBe(1);
      populationTick(scene, [], 5_100);
      expect(scene.system.diagnostics().bubbles).toBe(0);
      expect(bubble.destroy).toHaveBeenCalledOnce();
      population = { generation, golfers: [golfer(6, { mood: .9, scoredHoles: 1, lastHoleDelta: -1 })] };
      populationTick(scene, [], 8_100);
      expect(record.mock.calls.map(([, kind]) => kind)).toEqual(["happy", "star"]);
    } finally { scene.system.destroy!(); record.mockRestore(); }
  });

  it("preserves retained hazard feedback once for a seeded golfer and destroys it on departure/disposal", () => {
    const record = vi.spyOn(emoteFeed, "recordEmote");
    const generation = Symbol();
    let population: Population = { generation, golfers: [retainedGolfer(.36, "water")] };
    const scene = fixture({ atlasReady: true, readPopulation: () => population });
    scene.system.create!(snapshot(1, { course: { ...DEFAULT_COURSE, baseGreenFee: 120 } }));
    try {
      populationTick(scene, [], 1_000);
      population = { generation, golfers: [retainedGolfer(.9, "water")] };
      populationTick(scene, [], 2_000);
      populationTick(scene, [], 2_100);
      expect(record.mock.calls.map(([, kind]) => kind)).toEqual(["alert"]);
      const bubble = scene.screenOverlay.children[0];
      const children = [...(bubble as FakeContainer).children];
      population = { generation, golfers: [] };
      populationTick(scene, [], 2_200);
      expect(bubble.destroy).toHaveBeenCalledOnce();
      expect(children.every((node) => node.destroy.mock.calls.length === 1)).toBe(true);
      scene.system.destroy!(); scene.system.destroy!();
      expect(scene.screenOverlay.children).toEqual([]);
      expect(scene.texture.destroy).not.toHaveBeenCalled();
    } finally { scene.system.destroy!(); record.mockRestore(); }
  });
});
