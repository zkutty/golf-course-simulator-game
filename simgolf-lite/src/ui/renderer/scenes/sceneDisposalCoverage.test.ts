import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { Course, SurfaceCareRecordV1 } from "../../../game/models/types";
import { surfaceCareTopology } from "../../../game/conditions/surfaceCare";
import type { RenderSnapshot } from "../RenderSnapshot";
import { createMobilityEntitiesSceneSystem } from "./mobilityEntitiesScene";
import { createLiveEntitiesSceneSystem } from "./liveEntitiesScene";
import { createSurfaceCareSceneSystem, type SurfaceCareWorkerSprite } from "./surfaceCareScene";
import { createOverlaysDiagnosticsSceneSystem } from "./overlaysDiagnosticsScene";

const bounds = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };

function snapshot(course: Course = DEFAULT_COURSE): RenderSnapshot {
  return {
    course, obstacles: course.obstacles, effectiveTiles: course.tiles, holes: course.holes,
    draftTee: null, draftGreen: null, rotation: 0, graphicsQuality: "high",
    colorVision: "standard", reducedMotion: false, animationsEnabled: true,
    showObstacles: true, atlasRevision: 1, surveyMode: false, worldSeed: 42,
    surfaceHeightAt: () => 0,
    revisions: { atmosphere: 0, surfaceCare: 0, structuresProps: 0, playerProCollection: 0,
      mobilityEntities: 0, liveEntities: 0, naturalProps: 0, overlaysDiagnostics: 0, estateSurvey: 0 },
  };
}

function golfer(patch: Partial<GolferRenderData> = {}): GolferRenderData {
  return { id: 1, x: 2, y: 2, ballX: null, ballY: null, ballToX: null, ballToY: null,
    color: "#f00", mood: 0.7, thought: null, archetype: "casual", segKind: "walk", segT: 0,
    shot: null, dirX: 1, dirY: 0, scoredHoles: 0, lastHoleDelta: 0, ...patch };
}

function contextSystem() {
  return new PIXI.GraphicsContextSystem({ uid: 811,
    gc: { now: 0, addResourceHash: vi.fn() },
  } as unknown as ConstructorParameters<typeof PIXI.GraphicsContextSystem>[0]);
}

function observeOwned(graphic: PIXI.Graphics, system: ReturnType<typeof contextSystem>) {
  const context = graphic.context;
  const gpu = system.updateGpuContext(context);
  const data = gpu.geometryData;
  const arrays = [data.vertices, data.uvs, data.indices];
  const aliases = [...gpu.batches];
  expect(context.instructions.length).toBeGreaterThan(0);
  expect(aliases.length).toBeGreaterThan(0);
  for (const array of arrays) expect(array.length).toBeGreaterThan(0);
  expect(aliases.every((batch) => batch.geometryData === data)).toBe(true);
  const destroy = vi.spyOn(context, "destroy");
  const unload = vi.fn();
  context.on("unload", unload);
  return () => {
    expect(graphic.destroyed).toBe(true);
    expect(destroy).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(unload).toHaveBeenCalledTimes(1);
    for (const array of arrays) expect(array).toHaveLength(0);
    expect(aliases.every((batch) => batch.geometryData === data)).toBe(true);
    expect(context.listenerCount("update")).toBe(0);
  };
}

function observeBorrowed(context: PIXI.GraphicsContext, system: ReturnType<typeof contextSystem>) {
  const sibling = new PIXI.Graphics({ context });
  const gpu = system.updateGpuContext(context);
  const data = gpu.geometryData;
  const size = data.vertices.length;
  expect(size).toBeGreaterThan(0);
  const destroy = vi.spyOn(context, "destroy");
  return (retired: PIXI.Graphics) => {
    expect(retired.destroyed).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    expect(sibling.destroyed).toBe(false);
    expect(sibling.context).toBe(context);
    expect(context.listenerCount("update")).toBe(1);
    expect(gpu.geometryData.vertices.length).toBe(size);
    context.rect(20, 0, 4, 4).fill(0x123456);
    expect(system.updateGpuContext(context).geometryData.vertices.length).toBeGreaterThan(size);
    sibling.destroy();
    expect(destroy).not.toHaveBeenCalled();
    context.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(data.vertices).toHaveLength(0);
    expect(data.uvs).toHaveLength(0);
    expect(data.indices).toHaveLength(0);
    expect(gpu.geometryData).toBeNull();
  };
}

function caredCourse(): Course {
  const course: Course = { ...DEFAULT_COURSE, width: 8, height: 8,
    tiles: Array(64).fill("fairway"), elevations: Array(64).fill(0), holes: [],
    surfaceIntent: { version: 1, nextId: 2, features: [{ id: "care", terrain: "fairway", order: 1,
      coverage: Array.from({ length: 64 }, (_, i) => i),
      geometry: { kind: "region", ring: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }] } }] } };
  const records = Object.fromEntries(surfaceCareTopology(course).zones.map((zone) => {
    const record: SurfaceCareRecordV1 = {
      key: zone.key, surfaceId: zone.surfaceId, cellX: zone.cellX, cellY: zone.cellY,
      intendedTerrain: "fairway", area: zone.cells.length, mowingQuality: 0.95,
      moisture: 0.58, turfHealth: 0.48, wear: 0.04, dormancy: 0, drainageStress: 0.03,
      failureDurationDays: 0, missedMowingDays: 0, insufficientWaterDays: 0, saturatedDays: 0,
      repairRequired: true, repairProgress: 0.4, lastDemand: 20, lastAllocated: 16,
      lastTraffic: 0, lastIrrigationDemand: 0, lastIrrigationApplied: 0,
      lastElevatedWaterDemand: 0, lastElevatedWaterApplied: 0,
      lastRepairProgressed: true, lastRepairServiceRatio: 0.8, lastObservedAbsoluteDay: 10,
      repair: { kind: "reseed", cost: 600, requiredDays: 20, progressDays: 8,
        startedAbsoluteDay: 2, elevatedWaterDaysRemaining: 0 },
    };
    return [zone.key, record];
  }));
  expect(Object.keys(records).length).toBeGreaterThan(0);
  return { ...course, surfaceCare: { version: 1, cellSize: 8, lastAdvancedAbsoluteDay: 10, records } };
}

beforeEach(() => {
  // Same owned precision-probe adapter as the existing actual Pixi lifecycle test;
  // this does not create a WebGL renderer or modify Pixi caches/private registries.
  vi.spyOn(PIXI.DOMAdapter.get(), "createCanvas").mockReturnValue({
    getContext: () => null,
  } as unknown as ReturnType<ReturnType<typeof PIXI.DOMAdapter.get>["createCanvas"]>);
});
afterEach(() => vi.restoreAllMocks());

describe("scene disposal coverage", () => {
  it("mobility retire releases owned contexts and preserves borrowed siblings", () => {
    const system = contextSystem();
    const objects = new PIXI.Container();
    const course = { ...DEFAULT_COURSE, buildings: [], m51: undefined };
    const scene = createMobilityEntitiesSceneSystem(objects);
    scene.create!(snapshot(course));
    const active = golfer({ mobilityUnitMode: "walk", mobilityAssignmentId: "a" });
    scene.tick({ golfers: [active], cullBounds: bounds });
    const holder = objects.children[0];
    const check = observeOwned(holder.children[0] as PIXI.Graphics, system);
    const unrelated = objects.addChild(new PIXI.Container());
    scene.tick({ golfers: [], cullBounds: bounds });
    check();
    expect(objects.children).toEqual([unrelated]);
    scene.tick({ golfers: [active], cullBounds: bounds });
    const second = objects.children[1];
    const checkClear = observeOwned(second.children[0] as PIXI.Graphics, system);
    scene.destroy!(); scene.destroy!();
    checkClear(); expect(unrelated.destroyed).toBe(false);

    const shared = new PIXI.GraphicsContext();
    const borrowedScene = createMobilityEntitiesSceneSystem(objects, {
      createGraphics: () => new PIXI.Graphics({ context: shared }),
    });
    borrowedScene.create!(snapshot(course));
    borrowedScene.tick({ golfers: [active], cullBounds: bounds });
    const borrowed = objects.children[1].children[0] as PIXI.Graphics;
    const checkBorrowed = observeBorrowed(shared, system);
    borrowedScene.tick({ golfers: [], cullBounds: bounds });
    checkBorrowed(borrowed);
    borrowedScene.destroy!(); system.destroy(); unrelated.destroy(); objects.destroy();
  });

  it("live holder releases owned contexts and preserves atlas and borrowed siblings", () => {
    const system = contextSystem();
    const texture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 1, height: 1 }) });
    const textureDestroy = vi.spyOn(texture, "destroy");
    for (const atlasReady of [false, true]) {
      const layers = { objects: new PIXI.Container(), terrainDecals: new PIXI.Container(),
        fx: new PIXI.Container(), screenOverlay: new PIXI.Container() };
      const scene = createLiveEntitiesSceneSystem(layers, { atlasReady: () => atlasReady,
        golferFrame: () => texture, createSprite: () => new PIXI.Sprite(texture),
        createText: () => new PIXI.Sprite(texture) as unknown as PIXI.Text });
      scene.create!(snapshot());
      const tick = (golfers: GolferRenderData[]) => scene.tickEntities({ nowMs: 1_000,
        animationsEnabled: false, golfers, selectedGolferId: 1, cullBounds: bounds,
        worldPointToScreen: (x, y) => ({ x, y }), followCamera: vi.fn(),
        startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn() });
      tick([golfer()]);
      const holder = layers.objects.children[0];
      const checks = holder.children.filter((child): child is PIXI.Graphics => child instanceof PIXI.Graphics)
        .map((graphic) => observeOwned(graphic, system));
      expect(checks).toHaveLength(atlasReady ? 2 : 1);
      tick([]); checks.forEach((check) => check());
      tick([golfer()]);
      const current = layers.objects.children[0];
      const checkClear = current.children.filter((child): child is PIXI.Graphics => child instanceof PIXI.Graphics)
        .map((graphic) => observeOwned(graphic, system));
      scene.destroy!(); scene.destroy!(); checkClear.forEach((check) => check());
      expect(textureDestroy).not.toHaveBeenCalled();
      Object.values(layers).forEach((layer) => layer.destroy());
    }

    const shared = new PIXI.GraphicsContext();
    let created = 0;
    const layers = { objects: new PIXI.Container(), terrainDecals: new PIXI.Container(),
      fx: new PIXI.Container(), screenOverlay: new PIXI.Container() };
    const scene = createLiveEntitiesSceneSystem(layers, { atlasReady: () => false,
      createGraphics: () => created++ === 2 ? new PIXI.Graphics({ context: shared }) : new PIXI.Graphics(),
      createText: () => new PIXI.Sprite(texture) as unknown as PIXI.Text });
    scene.create!(snapshot());
    scene.tickEntities({ nowMs: 1_000, animationsEnabled: false, golfers: [golfer()], cullBounds: bounds,
      worldPointToScreen: (x, y) => ({ x, y }), followCamera: vi.fn(),
      startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn() });
    const borrowed = layers.objects.children[0].children[0] as PIXI.Graphics;
    expect(borrowed.context).toBe(shared);
    const checkBorrowed = observeBorrowed(shared, system);
    scene.destroy!(); checkBorrowed(borrowed);
    expect(textureDestroy).not.toHaveBeenCalled();
    Object.values(layers).forEach((layer) => layer.destroy());
    system.destroy(); texture.destroy(true);
  });

  it("surface care rerender releases owned contexts and preserves current and borrowed siblings", () => {
    const system = contextSystem();
    const layer = new PIXI.Container();
    let workers: SurfaceCareWorkerSprite[] = [];
    const scene = createSurfaceCareSceneSystem(layer, (next) => { workers = next; });
    const course = caredCourse();
    scene.render!(snapshot(course));
    expect(workers.length).toBeGreaterThan(0);
    for (let cycle = 0; cycle < 12; cycle++) {
      const previous = [...layer.children] as PIXI.Graphics[];
      const checks = previous.map((graphic) => observeOwned(graphic, system));
      scene.render!(snapshot(course));
      checks.forEach((check) => check());
      expect(previous.every((graphic) => graphic.destroyed)).toBe(true);
      expect(layer.children.every((graphic) => !graphic.destroyed)).toBe(true);
      expect(workers.every((worker) => layer.children.includes(worker.graphics))).toBe(true);
    }
    const shared = new PIXI.GraphicsContext().rect(0, 0, 4, 4).fill(0xffffff);
    const borrowed = layer.addChild(new PIXI.Graphics({ context: shared }));
    const checkBorrowed = observeBorrowed(shared, system);
    const finalOwned = layer.children.filter((graphic) => graphic !== borrowed)
      .map((graphic) => observeOwned(graphic as PIXI.Graphics, system));
    scene.render!(snapshot({ ...course, surfaceCare: undefined }));
    finalOwned.forEach((check) => check());
    checkBorrowed(borrowed);
    expect(layer.children).toHaveLength(0); expect(workers).toHaveLength(0);
    system.destroy(); layer.destroy();
  });

  it("player shot overlay releases owned contexts and preserves borrowed siblings", () => {
    const system = contextSystem();
    const layers = { terrainDecals: new PIXI.Container(), fx: new PIXI.Container(), screenOverlay: new PIXI.Container() };
    const round = { course: DEFAULT_COURSE, ball: { x: 2, y: 2 }, phase: "awaiting_shot", shots: [], pendingShot: null };
    // Only the read-only player-shot presentation fields are needed by this scene.
    const input = { ...snapshot(), playerRound: round as unknown as RenderSnapshot["playerRound"] };
    const scene = createOverlaysDiagnosticsSceneSystem(layers, { readPerfEnabled: () => false });
    scene.create!(input);
    const first = layers.fx.children[0].children[0] as PIXI.Graphics;
    const check = observeOwned(first, system);
    scene.update!(input); check();
    const second = layers.fx.children[0].children[0] as PIXI.Graphics;
    const checkClear = observeOwned(second, system);
    scene.destroy!(); scene.destroy!(); checkClear();

    const shared = new PIXI.GraphicsContext();
    let created = 0;
    const borrowedScene = createOverlaysDiagnosticsSceneSystem(layers, {
      createGraphics: () => created++ === 2 ? new PIXI.Graphics({ context: shared }) : new PIXI.Graphics(),
      readPerfEnabled: () => false,
    });
    borrowedScene.create!(input);
    const borrowed = layers.fx.children[0].children[0] as PIXI.Graphics;
    expect(borrowed.context).toBe(shared);
    const checkBorrowed = observeBorrowed(shared, system);
    borrowedScene.update!({ ...input, playerRound: null }); checkBorrowed(borrowed);
    borrowedScene.destroy!();
    Object.values(layers).forEach((layer) => layer.destroy()); system.destroy();
  });
});
