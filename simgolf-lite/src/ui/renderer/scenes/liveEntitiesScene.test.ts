import { createRetainedShotMotion, sampleRetainedShotMotion } from "../../../game/rules/shotMotion";
import { resolveObstacleCollision } from "../../../game/rules/obstacleCollision";
import { tileCenterIso, type IsoRotation } from "../../../game/render/iso";
import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { captureGolferReactionSource, observeGolferReactionSource } from "../../../game/render/golferReactionSource";
import { golferTint, golferVariant } from "../../../game/render/golferSprites";
import type { SharedShotOutcome } from "../../../game/rules/contracts";
import { createLiveEntitiesSceneSystem, type LiveEntityTickInput } from "./liveEntitiesScene";
import { readFileSync } from "node:fs";
import { createLiveActivitySource, focusedLiveActivitySource, liveActivityScope } from "../../../game/live/activitySource";
import { createGolferCapabilities, stableGolferHandedness } from "../../../game/live/capabilities";
import { createShotPacingCursor, createShotPacingPlan, shotPacingFrame } from "../../../game/live/shotPacing";
import { createLiveGolferGroundAuthority } from "../../../game/render/golferGroundAuthority";
import { parseNaturalGolferArt, resolveNaturalGolferArt } from "../../../game/render/naturalGolferArt";
import type { NaturalGolferAtlas } from "../../../render/naturalGolferAtlas";

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
  addChildAt<T extends FakeDisplay>(child: T, index: number): T { child.parent = this; this.children.splice(index, 0, child); return child; }

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

function fixture(options: { atlasReady?: boolean; addLog?: string[]; naturalAtlas?: NaturalGolferAtlas<PIXI.Texture> } = {}) {
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
  const legacyFrames: string[] = [];
  const system = createLiveEntitiesSceneSystem(
    {
      objects: objects as unknown as PIXI.Container,
      terrainDecals: terrainDecals as unknown as PIXI.Container,
      fx: fx as unknown as PIXI.Container,
      screenOverlay: screenOverlay as unknown as PIXI.Container,
    },
    {
      naturalAtlas: () => options.naturalAtlas ?? null,
      atlasReady: () => options.atlasReady ?? false,
      golferFrame: name => { legacyFrames.push(name); return texture as unknown as PIXI.Texture; },
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
  return { objects, terrainDecals, fx, screenOverlay, containers, graphics, sprites, texture, legacyFrames, system };
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

const naturalParsed = parseNaturalGolferArt(JSON.parse(readFileSync(new URL("../../../../art/natural-golfer-v1/manifest.json", import.meta.url), "utf8")), JSON.parse(readFileSync(new URL("../../../../art/natural-golfer-v1/cost.json", import.meta.url), "utf8")));
if (!naturalParsed.ok) throw new Error(naturalParsed.reason);
const naturalArtIndex = naturalParsed.index;
function candidateFixture(legacyReady = true) {
  const state = { ready: false, missing: false }, textures = new Map<string, { id: string; destroy: ReturnType<typeof vi.fn> }>();
  const texture = (id: string) => { if (!textures.has(id)) textures.set(id, { id, destroy: vi.fn() }); return textures.get(id)! as unknown as PIXI.Texture; };
  const atlas: NaturalGolferAtlas<PIXI.Texture> = { load: vi.fn(async () => ({ status: "ready" as const, generation: 0, reason: null })), dispose: vi.fn(), reset: vi.fn(() => 1),
    artIndex: () => state.ready ? naturalArtIndex : null,
    snapshot: () => ({ status: state.ready ? "ready" : "loading", generation: 0, reason: null, atlasTextureCount: state.ready ? 448 : 0, pairCount: state.ready ? 224 : 0, ownedSourceCount: state.ready ? 2 : 0, cleanupErrors: 0, totalRuntimeBytesIncludingCostReceipt: state.ready ? 443726 : null }),
    lookup: request => {
      if (!state.ready || state.missing) return { kind: "unavailable", generation: 0, neutral: "non-gripping", reason: "atlas-not-ready" };
      const result = resolveNaturalGolferArt(naturalArtIndex, request); if (result.kind !== "frame") return result;
      return { kind: "pair", generation: 0, frame: result.frame, base: texture(`${result.frame.id}.base`), tint: texture(`${result.frame.id}.tint`), shadow: texture("shadow"),
        shadowPlacement: { unitScale: 1, worldOffset: [1.5, .8], alphaBaked: true }, bodyUnitScale: 26 / 48, coverage: result.coverage };
    } };
  const scene = fixture({ atlasReady: legacyReady, naturalAtlas: atlas });
  const course = { ...DEFAULT_COURSE, width: 16, height: 16, tiles: new Array(256).fill("fairway"), elevations: new Array(256).fill(2), buildings: [], obstacles: [], decorations: [] };
  const ground = createLiveGolferGroundAuthority({ course, effectiveTiles: course.tiles, field: { width: 16, height: 16, vertices: new Float32Array(289).fill(2) }, componentsByCell: new Array(256).fill(null), quality: "high", surfaceRevision: "scene-ground:1" });
  scene.system.create!(snapshot(1, { course, effectiveTiles: course.tiles, naturalGolfersCandidate: true, naturalGolferGround: ground }));
  return { ...scene, state, atlas, textures, course, ground };
}
function candidateShot(kind: "swing" | "putt" = "swing", reaction?: "good" | "bad" | "hole-out", actorId = 7) {
  const at = (x: number, y = 5) => ({ point: { x, y }, heightYards: 5 });
  const flight = kind === "putt" ? null : resolveObstacleCollision({ from: { x: 1, y: 5 }, to: { x: 11, y: 5 }, flight: { profile: "standard", apexHeightYards: 4, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 2 } }, width: 16, height: 16, yardsPerTile: 10, elevations: Array(256).fill(2), obstacles: [], retainGeometry: true }).retained!;
  const motion = createRetainedShotMotion({ identity: { shotId: "candidate", holeId: "one", shotNumber: 1, seed: 42, club: kind === "putt" ? "Putter" : "7 Iron", style: "straight_run", modelVersion: "club_styles_v1" }, yardsPerTile: 10,
    from: at(1), landing: at(kind === "putt" ? 1 : 11), physicalRest: at(12, 6), flight, rollPath: [at(kind === "putt" ? 1 : 11), at(12, 6)], holed: reaction === "hole-out" })!;
  const scope = liveActivityScope({ dayIndex: 2, seed: 42, reconcileEpoch: 0, dayOver: false }, { runSeed: 17, week: 1 })!;
  const plan = createShotPacingPlan({ scopeId: scope.id!, actorId: String(actorId), motion, distanceYards: 110 })!;
  const seed = Array.from({ length: 20 }, (_, i) => i).find(n => stableGolferHandedness(n) === "right")!;
  const capabilities = createGolferCapabilities({ seed, personality: { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } } });
  const base = createLiveActivitySource(scope, { id: actorId, pos: { x: 1, y: 5 }, segIndex: 1, segElapsed: .1, finished: false, capabilities }, { kind: "flight", from: { x: 1, y: 5 }, to: { x: 12, y: 6 }, dur: 2, holeIndex: 0 })!;
  const token = {}, owner = { scopeId: plan.scopeId, actorId: plan.actorId, shot: plan.identity }, sourceToken = {};
  const greenCourse = { width: 16, height: 16, tiles: Array.from({ length: 256 }, (_, i) => Math.abs(i % 16 - 12) <= 1 && Math.abs(Math.floor(i / 16) - 6) <= 1 ? "green" : "fairway") };
  const shared: SharedShotOutcome = { rulesVersion: 1, lieEffect: { sourceLie: "fairway", effectiveLie: "fairway", carryMultiplier: 1, dispersionMultiplier: 1, rollMultiplier: 1 },
    requestedCarryYards: 100, effectiveCarryYards: 100, requestedDispersionTiles: 1, effectiveDispersionTiles: 1,
    flight: { profile: "standard", launchAngleDegrees: 1, apexHeightYards: 4, apexPosition: { x: 6, y: 5 }, carryEnd: motion.landing.point, clearance: [] }, collision: { kind: "none" }, physicalRest: motion.physicalRest.point,
    ruling: { status: reaction === "hole-out" ? "holed" : reaction === "bad" ? "penalty" : "in_play", penaltyKind: reaction === "bad" ? "out_of_bounds" : "none", penaltyStrokes: reaction === "bad" ? 1 : 0,
      penaltyComponentId: null, penaltyAreaClassification: null, referencePoint: null, crossingPoint: null },
    relief: { status: "not_required", type: "none", candidates: [], selectedCandidateId: null, finalPosition: motion.physicalRest.point }, finalPosition: motion.physicalRest.point, motion };
  if (reaction) captureGolferReactionSource(token, { owner, authorityRevision: plan.scopeId, plan, initialCursor: createShotPacingCursor(plan), motion, distanceYards: 110,
    source: sourceToken, courseSource: greenCourse, handedness: "right", sharedOutcome: shared,
    originalAim: { course: greenCourse, holeId: "one", from: motion.from.point, target: motion.physicalRest.point, pin: { x: 13, y: 6 } } });
  return { plan, at(elapsedMs: number) {
    const cursor = createShotPacingCursor(plan, { version: 1, key: plan.key, elapsedMs }), frame = shotPacingFrame(plan, cursor)!, pose = sampleRetainedShotMotion(motion, frame.motionProgress)!;
    const activity = focusedLiveActivitySource(base, { actorId, segmentIndex: 1, segmentElapsed: .1, plan, cursor, frame, identity: motion.identity, origin: motion.from, target: kind === "putt" ? motion.groundPath[1]!.point : motion.flight!.geometry.to }, true)!;
    const classification = reaction ? observeGolferReactionSource(token, { owner, currentOwner: owner, authorityRevision: plan.scopeId, currentAuthorityRevision: plan.scopeId,
      plan, cursor, frame, motion, position: pose, source: sourceToken, courseSource: greenCourse, handedness: "right", ownerCurrent: true }) : null;
    return golfer(actorId, { x: 1, y: 5, segKind: "flight", shot: kind, segT: frame.motionProgress, ballX: pose.point.x, ballY: pose.point.y, ballToX: 12, ballToY: 6,
      activitySource: classification ? Object.freeze({ ...activity, reactionClassification: classification }) : activity,
      ballMotion: { identity: motion.identity, pose, events: motion.events, contactTerrain: "fairway", collisionTerrain: null, active: true } });
  } };
}
function candidateTick(scene: ReturnType<typeof candidateFixture>, value: GolferRenderData, time: number, patch: Partial<LiveEntityTickInput> = {}) {
  scene.system.tickEntities({ nowMs: time, presentationTimeMs: time, animationsEnabled: true, golfers: [value], selectedGolferId: 7, followSelected: true,
    cullBounds: unbounded, worldPointToScreen: (x, y) => ({ x, y }), followCamera: vi.fn(), startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn(), ...patch });
}

describe("opt-in LIVE natural body binding", () => {
  it.each(["swing", "putt"] as const)("keeps a height-mismatched %s pilot native neutral at visual B without changing retained balls or gaining contact", kind => {
    const scene = candidateFixture(), legacy = fixture({ atlasReady: true }), source = candidateShot(kind), launch = source.plan.addressMs + source.plan.contactMs;
    const raised = createLiveGolferGroundAuthority({ course: scene.course, effectiveTiles: scene.course.tiles, field: { width: 16, height: 16, vertices: new Float32Array(289).fill(3) },
      componentsByCell: new Array(256).fill(null), quality: "high", surfaceRevision: "raised:1" });
    scene.state.ready = true;
    scene.system.update!(snapshot(2, { course: scene.course, effectiveTiles: scene.course.tiles, naturalGolfersCandidate: true, naturalGolferGround: raised, surfaceHeightAt: () => 3 }));
    legacy.system.create!(snapshot(2, { course: scene.course, effectiveTiles: scene.course.tiles, surfaceHeightAt: () => 3 }));
    let presentationTime = 2000;
    for (const offset of [-.001, 0, .001]) for (let ack = 0; ack < 3; ack++) {
      const g = source.at(launch + offset), before = structuredClone(g); candidateTick(scene, g, presentationTime++); tick(legacy, [g]);
      const [base, tint, shadow] = scene.sprites;
      expect((base.texture as { id: string }).id).toContain(".idle."); expect(base.position).toMatchObject({ x: 0, y: 0 }); expect(tint.position).toMatchObject({ x: 0, y: 0 });
      expect(base.anchor.y).toBe(83 / 96); expect(tint.tint).toBe(0x397e82); expect(shadow.position).toMatchObject({ x: 1.5, y: .8 });
      expect(scene.objects.children[0].position).toMatchObject(tileCenterIso(1, 5, 3));
      expect(scene.objects.children[1].position).toMatchObject({ x: legacy.objects.children[1].position.x, y: legacy.objects.children[1].position.y });
      expect(scene.terrainDecals.children[0].position).toMatchObject({ x: legacy.terrainDecals.children[0].position.x, y: legacy.terrainDecals.children[0].position.y });
      expect(g).toEqual(before);
      expect(JSON.parse(scene.system.naturalDiagnosticsText())).toMatchObject({ family: "natural-golfer-v1", footDomain: "visual-neutral", reason: "native-neutral-height", heights: { physicalRootYards: 5, visualRootYards: 7.5 },
        feet: { x: 1, y: 5, heightYards: 7.5 }, offset: { x: 0, y: 0 }, contact: { active: false, actualTip: null, datum: null } });
    }
    scene.system.update!(snapshot(3, { course: scene.course, effectiveTiles: scene.course.tiles, naturalGolfersCandidate: true, naturalGolferGround: scene.ground, surfaceHeightAt: () => 2 }));
    candidateTick(scene, source.at(launch + .001), 2100);
    expect(JSON.parse(scene.system.naturalDiagnosticsText())).toMatchObject({ footDomain: "arrival-eligible", contact: { active: false } });
    expect((scene.sprites[0].texture as { id: string }).id).toContain(".idle.");
    candidateTick(scene, source.at(launch + .001), 2101); expect((scene.sprites[0].texture as { id: string }).id).toContain(`.${kind}.`);
    expect(JSON.parse(scene.system.naturalDiagnosticsText()).contact.active).toBe(false);
    scene.system.destroy!(); legacy.system.destroy!();
  });
  it("keeps native family/anchor/tint across 10000/10001/10002ms retention renewal and exposes scalar-only diagnostics", () => {
    const scene = candidateFixture(), source = candidateShot(), g = source.at(2000); scene.state.ready = true;
    candidateTick(scene, g, 0); candidateTick(scene, g, 1);
    const [base, tint, shadow] = scene.sprites;
    for (const time of [10000, 10001, 10002]) {
      candidateTick(scene, g, time);
      expect((base.texture as { id: string }).id).toMatch(/^primary\./); expect((tint.texture as { id: string }).id).toMatch(/^primary\./);
      expect(base.anchor.y).toBe(83 / 96); expect(tint.tint).toBe(0x397e82); expect(shadow.visible).toBe(true); expect(scene.sprites).toHaveLength(3);
      expect(scene.system.naturalDiagnostics()).toMatchObject({ records: 1, localRecords: 1, body: { family: "natural-golfer-v1", contact: false } });
      const verification = JSON.parse(scene.system.naturalDiagnosticsText());
      expect(verification).toMatchObject({ pilotId: 7, family: "natural-golfer-v1", atlas: { status: "ready", pairs: 224, sources: 2 }, groundRevision: "scene-ground:1" });
      expect(verification.feet).toMatchObject({ heightYards: 5 }); expect(verification.holder).not.toBeNull(); expect(verification.offset).not.toBeNull();
      expect(verification).not.toHaveProperty("ownerKey"); expect(verification).not.toHaveProperty("scopeId");
      if (time === 10001) expect(verification.frame).toContain(".idle.");
    }
    scene.system.destroy!(); expect(JSON.parse(scene.system.naturalDiagnosticsText()).family).toBeNull();
  });
  it("preserves non-pilot legacy textures, anchor, variant and tint while suppressing old reaction overrides", () => {
    const scene = candidateFixture(), source = candidateShot(), pilot = source.at(2000); scene.state.ready = true;
    const background = golfer(9, { x: 1, y: 5, color: "#f00", scoredHoles: 1, lastHoleDelta: -2,
      activitySource: createLiveActivitySource(pilot.activitySource!.scope, { id: 9, pos: { x: 1, y: 5 }, segIndex: 0, segElapsed: 0, finished: false, capabilities: undefined },
        { kind: "walk", from: { x: 1, y: 5 }, to: { x: 8, y: 5 }, dur: 8, holeIndex: 0, mobility: { requestedMode: "walk", resolvedMode: "walk", minutesSaved: 0, offPathTiles: 0 } }) });
    scene.system.tickEntities({ nowMs: 2000, presentationTimeMs: 2000, animationsEnabled: true, golfers: [pilot, background], selectedGolferId: 7, followSelected: true,
      cullBounds: unbounded, worldPointToScreen: (x, y) => ({ x, y }), followCamera: vi.fn(), startleAtmosphere: vi.fn(), tickMobilityEntities: vi.fn() });
    const legacy = fixture({ atlasReady: true }); legacy.system.create!(snapshot()); tick(legacy, [background]);
    const base = scene.sprites[3], tint = scene.sprites[4];
    expect(base.texture).toBe(scene.texture); expect(tint.texture).toBe(scene.texture); expect(base.anchor.y).toBe(69 / 72);
    expect(tint.tint).toBe(legacy.sprites[1].tint); expect(scene.system.golferGrounding(9, [background])!.sprite!.frame).toBe("golfer0_idle_1_0");
    scene.system.destroy!(); legacy.system.destroy!();
  });
  it.each([true, false])("atomically upgrades late complete pairs from legacyReady=%s, with native anchors and one alpha-baked shadow", legacyReady => {
    const scene = candidateFixture(legacyReady), source = candidateShot(); candidateTick(scene, source.at(2000), 2000);
    const holder = scene.objects.children[0] as FakeContainer, initialDot = holder.children.find(c => c instanceof FakeGraphics && c.label === "");
    scene.state.ready = true; candidateTick(scene, source.at(2000), 2001); candidateTick(scene, source.at(2000), 2002);
    const [base, tint, shadow] = scene.sprites;
    expect(base.anchor.y).toBe(83 / 96); expect(tint.anchor.y).toBe(83 / 96); expect(base.scale.x).toBe(26 / 48);
    expect((base.texture as { id: string }).id).toBe("primary.swing.se.7.base"); expect((tint.texture as { id: string }).id).toBe("primary.swing.se.7.tint"); expect(tint.tint).toBe(0x397e82);
    expect(shadow.label).toBe("natural-golfer-contact-shadow"); expect(shadow.scale.x).toBe(1); expect(shadow.alpha).toBe(1);
    expect(shadow.position.x - base.position.x).toBe(1.5); expect(shadow.position.y - base.position.y).toBeCloseTo(.8);
    expect(tint.position).toMatchObject({ x: base.position.x, y: base.position.y });
    if (!legacyReady) expect(initialDot?.destroy).toHaveBeenCalledOnce();
    scene.state.missing = true; candidateTick(scene, source.at(2000), 2003);
    expect(base.texture).toBe(scene.texture); expect(tint.texture).toBe(scene.texture); expect(base.anchor.y).toBe(69 / 72); expect(shadow.visible).toBe(false);
    scene.system.destroy!(); for (const texture of scene.textures.values()) expect(texture.destroy).not.toHaveBeenCalled(); expect(scene.atlas.dispose).not.toHaveBeenCalled();
  });
  it.each(["swing", "putt"] as const)("publishes exact %s terminal contact while preserving every retained ball projection", kind => {
    const natural = candidateFixture(), legacy = fixture({ atlasReady: true }), source = candidateShot(kind); natural.state.ready = true;
    legacy.system.create!(snapshot()); const launch = source.plan.addressMs + source.plan.contactMs;
    for (let t = 0; t < launch - .001; t += 20) candidateTick(natural, source.at(t), t);
    for (const offset of [-.001, 0, .001]) {
      const time = launch + offset, value = source.at(time), before = structuredClone(value);
      candidateTick(natural, value, time); tick(legacy, [value]);
      expect(natural.objects.children[1].position).toMatchObject({ x: legacy.objects.children[1].position.x, y: legacy.objects.children[1].position.y });
      expect(natural.terrainDecals.children[0].position).toMatchObject({ x: legacy.terrainDecals.children[0].position.x, y: legacy.terrainDecals.children[0].position.y });
      expect(natural.objects.children[1].visible).toBe(legacy.objects.children[1].visible); expect(value).toEqual(before);
      const diagnostic = natural.system.naturalDiagnostics() as { body: { contact: boolean; frame: string; geometry: { residualPx: number } } };
      expect(diagnostic.body.contact).toBe(offset === 0); if (offset === 0) expect(diagnostic.body.geometry.residualPx).toBeLessThan(.5); else expect(diagnostic.body.geometry).toBeNull();
      expect(diagnostic.body.frame).toContain(`.${kind}.`);
    }
    natural.system.releaseNaturalBorrowers(); expect(natural.system.diagnostics().golfers).toBe(1);
    for (const texture of natural.textures.values()) expect(texture.destroy).not.toHaveBeenCalled();
    natural.system.destroy!(); legacy.system.destroy!();
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

describe("LIVE static evidenced reaction rendering", () => {
  it.each([0, 90, 180, 270] as IsoRotation[])("keeps unplanted G facing through reaction start/end at rotation%s", rotation => {
    const scene = candidateFixture(), s = candidateShot("swing", "good"); scene.state.ready = true;
    const raised = createLiveGolferGroundAuthority({ course: scene.course, effectiveTiles: scene.course.tiles,
      field: { width: 16, height: 16, vertices: new Float32Array(289).fill(3) }, componentsByCell: new Array(256).fill(null), quality: "high", surfaceRevision: "reaction-neutral-facing" });
    scene.system.update!(snapshot(2, { course: scene.course, effectiveTiles: scene.course.tiles, naturalGolfersCandidate: true, naturalGolferGround: raised, surfaceHeightAt: () => 3, rotation }));
    const start = s.plan.durationMs - 600;
    candidateTick(scene, s.at(0), 0); candidateTick(scene, s.at(start - 1), start - 1);
    const before = JSON.parse(scene.system.naturalDiagnosticsText()), direction = before.frame.split(".")[2];
    expect(before.frame).toContain(".idle."); expect(before.footDomain).toBe("visual-neutral");
    for (const t of [start, start + 1, s.plan.durationMs]) {
      candidateTick(scene, s.at(t), t);
      const view = JSON.parse(scene.system.naturalDiagnosticsText());
      expect(view.frame.split(".")[2]).toBe(direction); expect(view.frame).toContain(t < s.plan.durationMs ? ".positive." : ".idle.");
      expect(view.feet).toEqual(before.feet); expect(view.offset).toEqual(before.offset); expect(view.contact.active).toBe(false);
    }
  });

  it.each(["good", "bad", "hole-out"] as const)("applies one native%s frame at current feet without changing ball/source", result => {
    const scene = candidateFixture(), baseline = fixture({ atlasReady: true }), s = candidateShot("swing", result); scene.state.ready = true; baseline.system.create!(snapshot());
    const start = s.plan.durationMs - 600;
    for (const t of [0, s.plan.durationMs - s.plan.restMs - .001, s.plan.durationMs - s.plan.restMs, start - 1]) candidateTick(scene, s.at(t), t);
    const g = s.at(start), before = structuredClone(g); candidateTick(scene, g, start); tick(baseline, [g]);
    const first = JSON.parse(scene.system.naturalDiagnosticsText());
    expect(first).toMatchObject({ family: "natural-golfer-v1", phase: "reaction", contact: { active: false } });
    expect(first.frame).toContain(result === "bad" ? ".negative." : ".positive."); expect(first.frame).toMatch(/\.1$/u);
    expect(scene.objects.children[1].position).toMatchObject({ x: baseline.objects.children[1].position.x, y: baseline.objects.children[1].position.y });
    expect(scene.terrainDecals.children[0].position).toMatchObject({ x: baseline.terrainDecals.children[0].position.x, y: baseline.terrainDecals.children[0].position.y }); expect(g).toEqual(before);
    const baseId = (scene.sprites[0].texture as { id: string }).id, feet = first.feet;
    candidateTick(scene, s.at(start + 300), start + 300, { nowMs: 999999 });
    expect((scene.sprites[0].texture as { id: string }).id).toBe(baseId); expect(JSON.parse(scene.system.naturalDiagnosticsText()).feet).toEqual(feet);
    candidateTick(scene, s.at(s.plan.durationMs), s.plan.durationMs); expect(JSON.parse(scene.system.naturalDiagnosticsText()).phase).not.toBe("reaction");
    for (const texture of scene.textures.values()) expect(texture.destroy).not.toHaveBeenCalled();
  });
  it.each(["good", "bad"] as const)("keeps nonpilot legacy%s identity/tint and uses a planted static front frame", result => {
    const scene = candidateFixture(), pilot = candidateShot(), s = candidateShot("swing", result, 9); scene.state.ready = true;
    candidateTick(scene, pilot.at(0), 0); const start = s.plan.durationMs - 600;
    const front = (t: number) => ({ ...s.at(t), dirX: 1, dirY: 1, color: "#915cb0", archetype: "senior" as const, scoredHoles: 3, lastHoleDelta: result === "bad" ? -3 : 3 });
    candidateTick(scene, front(start - 1), 1000, { selectedGolferId: 9 });
    const tint = scene.sprites.at(-1)!.tint;
    candidateTick(scene, front(start), 1001, { selectedGolferId: 9 });
    const variant = golferVariant("senior", 9), name = `golfer${variant}_${result === "bad" ? "mad_0_3" : "cheer_0_0"}`;
    expect(scene.legacyFrames).toContain(name); expect(scene.legacyFrames).toContain(name.replace("_0_", "_t_0_"));
    expect(tint).toBe(golferTint("#915cb0", 9)); expect(scene.sprites.at(-1)!.tint).toBe(tint);
    const last = scene.legacyFrames.slice(-2); candidateTick(scene, front(start + 100), 1101, { nowMs: 1000000, selectedGolferId: 9 });
    expect(scene.legacyFrames.slice(-2)).toEqual(last);
  });
  it("keeps unauthored legacy reaction views neutral and ignores old wall-time hole cues", () => {
    const scene = candidateFixture(), pilot = candidateShot(), s = candidateShot("swing", "good", 9); scene.state.ready = true;
    candidateTick(scene, pilot.at(0), 0); const start = s.plan.durationMs - 600;
    candidateTick(scene, s.at(start - 1), 1000, { selectedGolferId: 9 });
    candidateTick(scene, { ...s.at(start), lastHoleDelta: -3, scoredHoles: 5 }, 1001, { nowMs: 999999, selectedGolferId: 9 });
    expect(scene.legacyFrames.slice(-2).every(name => name.includes("_idle"))).toBe(true);
  });
});
