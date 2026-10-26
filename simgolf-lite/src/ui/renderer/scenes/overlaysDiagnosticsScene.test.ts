import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_COURSE } from "../../../game/models/defaults";
import type { TerrainStrokePreview } from "../../../game/models/terrainStroke";
import type { RenderSnapshot } from "../RenderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createOverlaysDiagnosticsSceneSystem, playerShotGolferPose, type OverlayTickInput } from "./overlaysDiagnosticsScene";
import { createRetainedShotMotion } from "../../../game/rules/shotMotion";
import { resolveObstacleCollision } from "../../../game/rules/obstacleCollision";
import { playerShotPlaybackFrame } from "../../../game/playerPro/shotPlayback";
import type { PlayerPlayableRound, PlayerShotTrace } from "../../../game/models/playerProTypes";
import { worldToIso } from "../../../game/render/iso";
import type { PlayerShotPreview } from "../../../game/playerPro/playerPro";
import { createPlayerShotPlaybackDriver } from "../../playerPro/usePlayerShotPlayback";
import { createNaturalGolferRuntime } from "../../../game/render/naturalGolferRuntime";
import { createLiveGolferGroundAuthority } from "../../../game/render/golferGroundAuthority";
import { ISO_ROTATIONS } from "../../../game/render/iso";

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
  visible = true;
  destroy = vi.fn((_options?: { children?: boolean }) => {});
}

function playerShot() {
  const flight = resolveObstacleCollision({ from: { x: 1, y: 5 }, to: { x: 11, y: 5 }, flight: { profile: "standard", apexHeightYards: 10,
    curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 2 } }, width: 16, height: 16, yardsPerTile: 10,
    endpointHeightsYards: { from: 5, to: 5 }, obstacles: [], retainGeometry: true }).retained!;
  const at = (x: number, y: number) => ({ point: { x, y }, heightYards: 5 });
  const motion = createRetainedShotMotion({ identity: { shotId: "s1", holeId: "h1", shotNumber: 1, seed: 1, club: "7 Iron", style: "fade", modelVersion: "club_styles_v1" },
    yardsPerTile: 10, from: at(1, 5), landing: at(11, 5), physicalRest: at(12, 6), flight,
    rollPath: [at(11, 5), at(12, 5), at(12, 6)], holed: false, reliefPosition: { x: 2, y: 2 } })!;
  const shot = { id: "s1", from: { x: 1, y: 5 }, aim: { x: 11, y: 5 }, rest: { x: 2, y: 2 }, club: "7 Iron", penaltyStrokes: 1,
    sharedOutcome: { motion }, greenRollout: { landing: { x: 11, y: 5 }, path: [{ x: 11, y: 5 }, { x: 12, y: 6 }] } } as unknown as PlayerShotTrace;
  const round = { id: "r1", phase: "flight", pendingShot: shot, shots: [], ball: shot.from } as unknown as PlayerPlayableRound;
  return { shot, round, motion };
}

class FakeGraphics extends FakeDisplay {
  clear = vi.fn();
  circle = vi.fn();
  ellipse = vi.fn();
  stroke = vi.fn();
  fill = vi.fn();
  moveTo = vi.fn();
  lineTo = vi.fn();
  poly = vi.fn();
}

class FakeText extends FakeDisplay {
  text = "";
}

class FakeSprite extends FakeDisplay {
  anchor = point();
  scale = point(1, 1);
  texture: unknown;
  tint = 0xffffff;
}

class FakeContainer extends FakeDisplay {
  children: FakeDisplay[] = [];
  override destroy = vi.fn((options?: { children?: boolean }) => {
    if (!options?.children) return;
    for (const child of this.children) child.destroy(options);
    this.children = [];
  });

  addChild<T extends FakeDisplay>(...children: T[]): T {
    for (const child of children) {
      if (child.parent === this) this.children = this.children.filter((entry) => entry !== child);
      child.parent = this;
      this.children.push(child);
    }
    return children[0];
  }

  removeChild<T extends FakeDisplay>(child: T): T {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parent = null;
    return child;
  }
}

function snapshot(revision = 1): RenderSnapshot {
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
    surfaceHeightAt: () => 0,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      mobilityEntities: 0,
      liveEntities: 0,
      naturalProps: 0,
      overlaysDiagnostics: revision,
      estateSurvey: 0,
    },
  };
}

function fixture(options: { perfEnabled?: boolean; atlasReady?: () => boolean; golferFrame?: (name: string) => PIXI.Texture | null;
  activityRuntime?: Pick<ReturnType<typeof createNaturalGolferRuntime<PIXI.Texture>>, "observeControlledPresented"> } = {}) {
  const terrainDecals = new FakeContainer();
  const fx = new FakeContainer();
  const screenOverlay = new FakeContainer();
  const graphics: FakeGraphics[] = [];
  const texts: FakeText[] = [];
  const sprites: FakeSprite[] = [];
  const published = vi.fn();
  let clock = 10;
  const system = createOverlaysDiagnosticsSceneSystem(
    {
      terrainDecals: terrainDecals as unknown as PIXI.Container,
      fx: fx as unknown as PIXI.Container,
      screenOverlay: screenOverlay as unknown as PIXI.Container,
    },
    {
      createContainer: () => new FakeContainer() as unknown as PIXI.Container,
      createGraphics: () => {
        const graphic = new FakeGraphics();
        graphics.push(graphic);
        return graphic as unknown as PIXI.Graphics;
      },
      createText: () => {
        const text = new FakeText();
        texts.push(text);
        return text as unknown as PIXI.Text;
      },
      readPerfEnabled: () => options.perfEnabled ?? false,
      atlasReady: options.atlasReady ?? (() => false),
      golferFrame: options.golferFrame ?? (() => null),
      activityRuntime: options.activityRuntime,
      createSprite: () => {
        const sprite = new FakeSprite(); sprites.push(sprite);
        return sprite as unknown as PIXI.Sprite;
      },
      now: () => ++clock,
      publishPerf: published,
    },
  );
  return { terrainDecals, fx, screenOverlay, graphics, texts, sprites, published, system };
}

function tickInput(patch: Partial<OverlayTickInput> = {}): OverlayTickInput {
  return {
    wizardStep: "TEE",
    holes: DEFAULT_COURSE.holes,
    activeHoleIndex: 0,
    draftTee: null,
    worldPointToScreen: (x, y) => ({ x, y }),
    course: DEFAULT_COURSE,
    effectiveTiles: DEFAULT_COURSE.tiles,
    rotation: 0,
    surfaceHeightAt: () => 0,
    editorMode: "PAINT",
    terrainStrokePreview: null,
    colorVision: "standard",
    graphicsQuality: "low",
    controlledBodyDrawEligible: true,
    ...patch,
  };
}

function controlledSource(hand: "right" | "left" | null, putt = false) {
  const base = playerShot();
  const motion = putt ? createRetainedShotMotion({ identity: { ...base.motion.identity, club: "Putter" }, yardsPerTile: 10,
    from: base.motion.from, landing: base.motion.from, physicalRest: base.motion.physicalRest, flight: null,
    rollPath: [base.motion.from, base.motion.physicalRest], holed: false })! : base.motion;
  const shot = { ...base.shot, holeId: motion.identity.holeId, shotNumber: motion.identity.shotNumber, seed: motion.identity.seed, club: motion.identity.club,
    shotStyle: motion.identity.style, carryYards: 100, rollYards: 20, sharedOutcome: { motion } } as unknown as PlayerShotTrace;
  const course = { ...DEFAULT_COURSE, width: 16, height: 16, tiles: Array(256).fill("fairway"), elevations: Array(256).fill(2), holes: [], obstacles: [], buildings: [] };
  const round = { ...base.round, handedness: hand ?? undefined, pendingShot: shot, course: { ...course, courseId: "one" } } as unknown as PlayerPlayableRound;
  const driver = createPlayerShotPlaybackDriver(shot, undefined, round.id, "participant:7", hand, round.course);
  const ground = createLiveGolferGroundAuthority({ course, effectiveTiles: course.tiles, field: { width: 16, height: 16, vertices: new Float32Array(289).fill(999) },
    componentsByCell: Array(256).fill(null), quality: "high", surfaceRevision: "editable-visual-ground" });
  const runtime = createNaturalGolferRuntime<PIXI.Texture>(() => null);
  return { round, driver, motion, runtime, at(elapsed: number, rotation: 0 | 90 | 180 | 270 = 0, policy: { visible?: boolean; hidden?: boolean; sampleAbsent?: boolean } = {}) {
    while (driver.frame().progress * driver.plan.durationMs < elapsed - 1e-9) driver.advance(Math.min(100, elapsed - driver.frame().progress * driver.plan.durationMs));
    const frame = driver.frame(), sample = policy.sampleAbsent ? null : driver.sample();
    const batch = runtime.tickFrame({ golfers: [], ground, visibleIds: new Set(), rotation, presentationTimeMs: elapsed,
      paused: false, hidden: policy.hidden ?? false, visibilityEpoch: 0, motionEnabled: true, quality: "high", operatingTier: 1, followedId: null },
    { round, expectedActorId: "participant:7", sample, playback: frame, visible: policy.visible ?? true, paused: false });
    return { frame, sample, body: batch.controlled };
  } };
}

describe("controlled legacy body consumption of the shared batch", () => {
  it.each(ISO_ROTATIONS.flatMap(rotation => (["right", "left", null] as const).map(hand => [rotation, hand] as const)))("keeps camera%d hand%s ball/shadow/FX exact and preserves legacy appearance/placement", (rotation, hand) => {
    for (const putt of [false, true]) {
      const source = controlledSource(hand, putt), texture = {} as PIXI.Texture, ack = vi.spyOn(source.runtime, "observeControlledPresented");
      const scene = fixture({ atlasReady: () => true, golferFrame: () => texture, activityRuntime: source.runtime }), baseline = fixture({ atlasReady: () => true });
      const saved = { ...snapshot(), playerRound: source.round, surfaceHeightAt: () => 999, rotation };
      scene.system.create!(saved); baseline.system.create!(saved);
      const before = structuredClone(source.round), launch = putt ? 650 : 1200;
      for (const offset of [-.001, 0, .001]) {
        const { frame, body } = source.at(launch + offset, rotation), input = tickInput({ rotation, surfaceHeightAt: () => 999, playerShotPlayback: frame });
        const cursor = source.driver.cursor();
        scene.system.tick({ ...input, controlledBodyEnabled: true, controlledActorId: "participant:7", controlledBody: body }); baseline.system.tick(input);
        const a = scene.system.playerShotPlayback()!, b = baseline.system.playerShotPlayback()!;
        for (const key of ["shotId", "progress", "motionProgress", "phase", "point", "heightYards", "ball", "shadow"] as const) expect(a[key]).toEqual(b[key]);
        expect(a.ball).toEqual(worldToIso(a.point.x + .5, a.point.y + .5, a.heightYards / 2.5, rotation));
        expect(a.shadow).toEqual(worldToIso(a.point.x + .5, a.point.y + .5, 2, rotation));
        const origin = worldToIso(1.5, 5.5, 2, rotation);
        for (const sprite of scene.sprites) {
          expect(sprite.position).toMatchObject({ x: origin.x - 5, y: origin.y });
          expect(sprite.anchor.y).toBe(69 / 72); expect(Math.abs(sprite.scale.x)).toBe(26 / 48); expect(sprite.visible).toBe(true);
        }
        expect(scene.sprites[1].tint).toBe(0x467449); expect(scene.sprites[0].texture).toBe(texture);
        expect(a.golferFrame).toMatch(hand === null ? putt ? /_putt_\d_\d$/u : /_swing_\d_\d$/u : /_idle_\d_0$/u);
        const effect = scene.graphics.find(g => g.label === "player-pro-contact-effect")!, original = baseline.graphics.find(g => g.label === "player-pro-contact-effect")!;
        expect(effect.ellipse.mock.calls).toEqual(original.ellipse.mock.calls); expect(effect.stroke.mock.calls).toEqual(original.stroke.mock.calls);
        expect(source.driver.cursor()).toEqual(cursor); expect(source.round).toEqual(before);
        expect(ack).toHaveBeenLastCalledWith(body);
      }
      expect(scene.sprites).toHaveLength(2); expect(source.runtime.diagnostics()).toMatchObject({ records: 1, localRecords: 1, foreground: 1, pending: 0 });
      scene.system.destroy!(); baseline.system.destroy!();
    }
  });
  it("requires both current legacy textures before applying/acknowledging, retries readiness, and rejects stale actor/owner frames", () => {
    const source = controlledSource(null), texture = {} as PIXI.Texture, ack = vi.spyOn(source.runtime, "observeControlledPresented");
    let complete = false;
    const scene = fixture({ atlasReady: () => true, activityRuntime: source.runtime, golferFrame: name => complete || !name.includes("_t_") ? texture : null });
    scene.system.create!({ ...snapshot(), playerRound: source.round });
    const { frame, body } = source.at(1200), input = tickInput({ playerShotPlayback: frame, controlledBodyEnabled: true, controlledActorId: "participant:7", controlledBody: body });
    scene.system.tick(input); expect(ack).not.toHaveBeenCalled(); expect(scene.sprites.every(s => !s.visible)).toBe(true);
    complete = true; scene.system.tick(input); expect(ack).toHaveBeenCalledOnce(); expect(scene.sprites.every(s => s.visible)).toBe(true);
    scene.system.tick({ ...input, controlledActorId: "other" }); expect(ack).toHaveBeenCalledOnce(); expect(scene.sprites.every(s => s.visible)).toBe(true);
    expect(scene.system.playerShotPlayback()!.golferFrame).toBe("golfer0_idle_0_0"); expect(scene.sprites.every(s => s.scale.x > 0)).toBe(true);
    scene.system.tick({ ...input, controlledBody: { ...body!, ownerKey: "old-owner" } }); expect(ack).toHaveBeenCalledOnce();
    scene.system.tick({ ...input, controlledBody: null }); expect(scene.sprites.every(s => s.visible)).toBe(true);
    const next = source.at(1200.001);
    scene.system.tick({ ...input, playerShotPlayback: next.frame }); // Same owner, older body cursor.
    expect(ack).toHaveBeenCalledOnce(); expect(scene.sprites.every(s => s.visible)).toBe(true); expect(scene.system.playerShotPlayback()!.golferFrame).toBe("golfer0_idle_0_0");
    scene.system.tick({ ...input, playerShotPlayback: next.frame, controlledBody: next.body }); expect(ack).toHaveBeenCalledTimes(2);
    scene.system.destroy!(); expect(source.driver.frame().progress).toBe(next.frame.progress);
  });
  it.each(["visible", "culled", "hidden", "show-golfers-off"] as const)("preserves current%s draw policy through the actual1200→7200 null-source completion barrier without ball/FX change", policy => {
    const source = controlledSource(null), texture = {} as PIXI.Texture, ack = vi.spyOn(source.runtime, "observeControlledPresented");
    const scene = fixture({ atlasReady: () => true, activityRuntime: source.runtime, golferFrame: () => texture }), baseline = fixture({ atlasReady: () => true });
    const saved = { ...snapshot(), playerRound: source.round, surfaceHeightAt: () => 999 };
    scene.system.create!(saved); baseline.system.create!(saved);
    expect(source.driver.plan.durationMs).toBe(7200);
    const drawEligible = policy === "visible";
    const before = structuredClone(source.round);
    for (const time of [1200, 7200]) {
      const { frame, sample, body } = source.at(time, 0, { visible: policy === "visible" || policy === "hidden", hidden: policy === "hidden", sampleAbsent: time === 7200 });
      const input = tickInput({ playerShotPlayback: frame, surfaceHeightAt: () => 999, controlledBodyDrawEligible: drawEligible });
      const cursor = source.driver.cursor();
      scene.system.tick({ ...input, controlledBodyEnabled: true, controlledActorId: "participant:7", controlledBody: body }); baseline.system.tick(input);
      const a = scene.system.playerShotPlayback()!, b = baseline.system.playerShotPlayback()!;
      for (const key of ["shotId", "progress", "motionProgress", "phase", "point", "heightYards", "ball", "shadow"] as const) expect(a[key]).toEqual(b[key]);
      expect(scene.sprites.every(s => s.visible)).toBe(drawEligible);
      for (const sprite of scene.sprites) expect(sprite.position).toMatchObject({ x: worldToIso(1.5, 5.5, 2).x - 5, y: worldToIso(1.5, 5.5, 2).y });
      const effect = scene.graphics.find(g => g.label === "player-pro-contact-effect")!, original = baseline.graphics.find(g => g.label === "player-pro-contact-effect")!;
      expect(effect.ellipse.mock.calls).toEqual(original.ellipse.mock.calls); expect(effect.stroke.mock.calls).toEqual(original.stroke.mock.calls);
      if (time === 7200) { expect(sample).toBeNull(); expect(body).toBeNull(); expect(a.golferFrame).toBe("golfer0_idle_0_0"); expect(source.runtime.diagnostics().records).toBe(0); }
      else if (!drawEligible) expect(body?.admitted ?? false).toBe(false);
      expect(source.round).toEqual(before); expect(source.driver.cursor()).toEqual(cursor);
    }
    expect(ack).toHaveBeenCalledTimes(drawEligible ? 1 : 0); expect(scene.sprites).toHaveLength(2); scene.system.destroy!(); baseline.system.destroy!();
  });
  it.each((["absent", "mismatched", "stale", "unavailable", "culled", "hidden"] as const).flatMap(variant => [true, false].map(drawEligible => [variant, drawEligible] as const)))("uses current neutral body fallback for%s output only under current draw eligibility%s without acknowledging it", (variant, drawEligible) => {
    const source = controlledSource(null), texture = {} as PIXI.Texture, ack = vi.spyOn(source.runtime, "observeControlledPresented");
    const scene = fixture({ atlasReady: () => true, activityRuntime: source.runtime, golferFrame: () => texture });
    scene.system.create!({ ...snapshot(), playerRound: source.round });
    const current = source.at(1200), next = source.at(1200.001);
    const body = variant === "absent" ? null : variant === "mismatched" ? { ...next.body!, ownerKey: "old" } : variant === "stale" ? current.body
      : { ...next.body!, admitted: false, reason: variant === "unavailable" ? "activity-cap" : variant };
    scene.system.tick(tickInput({ playerShotPlayback: next.frame, controlledBodyEnabled: true, controlledBodyDrawEligible: drawEligible, controlledActorId: "participant:7", controlledBody: body }));
    expect(ack).not.toHaveBeenCalled(); expect(scene.sprites.every(s => s.visible)).toBe(drawEligible && variant !== "culled" && variant !== "hidden");
    expect(scene.system.playerShotPlayback()!.golferFrame).toBe("golfer0_idle_0_0");
    expect(scene.sprites.every(s => s.scale.x > 0)).toBe(true); expect(source.driver.frame()).toEqual(next.frame); scene.system.destroy!();
  });
  it("requires explicit DEV draw eligibility and leaves the flag-off legacy body policy unchanged", () => {
    const source = controlledSource(null), texture = {} as PIXI.Texture, ack = vi.spyOn(source.runtime, "observeControlledPresented");
    const scene = fixture({ atlasReady: () => true, activityRuntime: source.runtime, golferFrame: () => texture });
    scene.system.create!({ ...snapshot(), playerRound: source.round });
    const { frame, body } = source.at(1200);
    const input = tickInput({ playerShotPlayback: frame, controlledBodyEnabled: true, controlledBodyDrawEligible: undefined, controlledActorId: "participant:7", controlledBody: body });
    scene.system.tick(input); expect(scene.sprites.every(s => !s.visible)).toBe(true); expect(ack).not.toHaveBeenCalled();
    scene.system.tick({ ...input, controlledBodyEnabled: false, controlledBodyDrawEligible: false });
    expect(scene.sprites.every(s => s.visible)).toBe(true); expect(ack).not.toHaveBeenCalled();
    expect(scene.system.playerShotPlayback()!.golferFrame).toBe("golfer0_swing_1_5"); scene.system.destroy!();
  });
});

describe("overlay and diagnostics scene ownership", () => {
  it("uses the sole overlaysDiagnostics host ID and preserves dynamic display identity across updates", () => {
    const scene = fixture();
    const host = new SceneSystemHost([scene.system]);
    expect(host.sync(snapshot(1))).toEqual(["overlaysDiagnostics"]);
    expect(scene.terrainDecals.children).toHaveLength(1);
    expect(scene.screenOverlay.children).toHaveLength(1);
    const highlight = scene.terrainDecals.children[0];
    const line = scene.screenOverlay.children[0];

    expect(host.sync(snapshot(1))).toEqual([]);
    expect(host.sync(snapshot(2))).toEqual(["overlaysDiagnostics"]);
    expect(scene.terrainDecals.children[0]).toBe(highlight);
    expect(scene.screenOverlay.children[0]).toBe(line);

    host.dispose();
    expect(scene.terrainDecals.children).toEqual([]);
    expect(scene.fx.children).toEqual([]);
    expect(scene.screenOverlay.children).toEqual([]);
    expect(highlight.destroy).toHaveBeenCalledOnce();
    expect(line.destroy).toHaveBeenCalledOnce();
  });

  it("redraws only through explicit hover and invalidation seams", () => {
    const scene = fixture();
    scene.system.create!(snapshot());
    const highlight = scene.graphics[0];
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledOnce();

    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledOnce();
    expect(scene.system.setHover({ x: 3, y: 4 })).toBe(true);
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledTimes(2);
    expect(highlight.poly).toHaveBeenCalled();

    expect(scene.system.setHover({ x: 3, y: 4 })).toBe(false);
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledTimes(2);
    scene.system.invalidate();
    scene.system.tick(tickInput());
    expect(highlight.clear).toHaveBeenCalledTimes(3);
  });

  it("retains cloned E2E terrain-preview diagnostics across dirty redraws", () => {
    const scene = fixture();
    scene.system.create!(snapshot());
    scene.system.setHover({ x: 2, y: 2 });
    const preview = {
      previewKind: "stroke",
      tiles: [{ x: 2, y: 2, terrain: "green" }],
      acceptedTiles: [{ x: 2, y: 2, terrain: "green" }],
      excludedTiles: [],
      affordable: true,
    } as unknown as TerrainStrokePreview;
    const input = tickInput({ selectedTerrain: "green", terrainStrokePreview: preview });
    scene.system.tick(input);
    const first = scene.system.terrainPreview();
    expect(first).toMatchObject({ revision: 1, previewKind: "stroke", selectedTerrain: "green", materials: ["green"] });
    first!.materials.push("sand");
    expect(scene.system.terrainPreview()?.materials).toEqual(["green"]);

    scene.system.invalidate();
    scene.system.tick(input);
    expect(scene.system.terrainPreview()?.revision).toBe(2);
  });

  it("creates, publishes, and tears down the perf HUD through its scene lifecycle", () => {
    const scene = fixture({ perfEnabled: true });
    scene.system.create!(snapshot());
    scene.system.beginFrame(1_500);
    scene.system.markPerf("hover+flags");
    scene.system.finishFrame(1_500, 16, () => ({
      golfers: 24,
      bubbles: 2,
      ripples: 1,
      impacts: 3,
      ambientObjects: 4,
      chunksVisible: 5,
      chunksTotal: 6,
      objects: 30,
    }));

    expect(scene.texts).toHaveLength(1);
    expect(scene.texts[0].text).toContain("golfers 24");
    expect(scene.published).toHaveBeenCalledOnce();
    expect(scene.published.mock.calls[0][0]).toMatchObject({ golfers: 24, chunksVisible: 5, objects: 30 });

    scene.system.destroy!();
    expect(scene.texts[0].destroy).toHaveBeenCalledOnce();
    expect(scene.screenOverlay.children).toEqual([]);
  });

  it("moves the light ball through frozen XYZ geometry while preserving pooled displays and hiding the future trace", () => {
    const scene = fixture();
    const { round } = playerShot();
    scene.system.create!({ ...snapshot(), playerRound: round });
    const staticTrace = scene.graphics.at(-1)!;
    expect(staticTrace.lineTo).not.toHaveBeenCalled();
    scene.system.tick(tickInput({ surfaceHeightAt: () => 2, playerShotPlayback: playerShotPlaybackFrame("s1", .1) }));
    expect(scene.system.playerShotPlayback()).toMatchObject({ phase: "address", point: { x: 1, y: 5 }, heightYards: 5 });
    const count = scene.graphics.length;
    scene.system.tick(tickInput({ surfaceHeightAt: () => 2, playerShotPlayback: playerShotPlaybackFrame("s1", .18 + .82 * .36) }));
    const frame = scene.system.playerShotPlayback()!;
    expect(frame.point).toEqual({ x: 6, y: 7 });
    expect(frame.heightYards).toBe(15);
    expect(frame.ball).toEqual(worldToIso(6.5, 7.5, 6, 0));
    expect(frame.shadow).toEqual(worldToIso(6.5, 7.5, 2, 0));
    expect(frame.ball.y).toBeLessThan(frame.shadow.y);
    for (let index = 0; index < 100; index += 1) scene.system.tick(tickInput({ playerShotPlayback: playerShotPlaybackFrame("s1", .2 + index * .005) }));
    expect(scene.graphics).toHaveLength(count);
    expect(staticTrace.lineTo).not.toHaveBeenCalled();
    scene.system.tick(tickInput({ playerShotPlayback: playerShotPlaybackFrame("other-shot", .5) }));
    expect(scene.system.playerShotPlayback()).toBeNull();
    scene.system.destroy!();
    expect(scene.fx.children).toHaveLength(0);
  });

  it("keeps settled physical rest and the legal relief marker separate", () => {
    const scene = fixture();
    const { round, shot } = playerShot();
    scene.system.create!({ ...snapshot(), surfaceHeightAt: () => 2, playerRound: { ...round, phase: "awaiting_shot", pendingShot: null, shots: [shot], ball: { x: 2, y: 2 } } });
    const graphics = scene.graphics.at(-1)!;
    const rest = worldToIso(12.5, 6.5, 2, 0);
    const relief = worldToIso(2.5, 2.5, 2, 0);
    expect(graphics.circle).toHaveBeenCalledWith(rest.x, rest.y - 2, 3);
    expect(graphics.circle).toHaveBeenCalledWith(relief.x, relief.y - 2, 9);
    expect(graphics.lineTo).not.toHaveBeenCalledWith(relief.x, relief.y - 2);
  });

  it("reaches the existing swing/putt contact frames exactly when retained motion starts", () => {
    for (const [club, contact] of [["Driver", 5], ["Putter", 2]] as const) {
      expect(playerShotGolferPose(playerShotPlaybackFrame("s1", .17999), club, { x: 1, y: 0 }, 0).col).toBeLessThan(contact);
      expect(playerShotGolferPose(playerShotPlaybackFrame("s1", .18), club, { x: 1, y: 0 }, 0).col).toBe(contact);
      expect(playerShotGolferPose({ ...playerShotPlaybackFrame("s1", .14), phase: "contact", addressing: true, addressProgress: 1 }, club, { x: 1, y: 0 }, 0).col).toBe(contact);
      expect(playerShotGolferPose(playerShotPlaybackFrame("s1", .5), club, { x: 1, y: 0 }, 90).col).toBeGreaterThan(contact);
    }
  });

  it("keeps the shadow on the frozen round surface when the editable course changes", () => {
    const scene = fixture();
    const { round } = playerShot();
    round.course = { width: 16, height: 16, elevations: Array(256).fill(2), tiles: Array(256).fill("fairway"), holes: [] } as unknown as PlayerPlayableRound["course"];
    scene.system.create!({ ...snapshot(), playerRound: round, surfaceHeightAt: () => 999 });
    const input = tickInput({ surfaceHeightAt: () => 999, playerShotPlayback: playerShotPlaybackFrame("s1", .18 + .82 * .36) });
    scene.system.tick(input);
    const frame = scene.system.playerShotPlayback()!;
    expect(frame.shadow).toEqual(worldToIso(frame.point.x + .5, frame.point.y + .5, 2));
    scene.system.tick({ ...input, surfaceHeightAt: () => -999 });
    expect(scene.system.playerShotPlayback()).toEqual(frame);
  });

  it("updates the unseeded expected arc and envelope only when its selection payload changes", () => {
    const scene = fixture();
    const { round } = playerShot();
    scene.system.create!({ ...snapshot(), playerRound: { ...round, phase: "awaiting_shot", pendingShot: null } });
    const preview = { available: true, expectedFlight: { from: { x: 1, y: 5 }, landing: { x: 11, y: 5 }, apexHeightYards: 10, curveOffsetTiles: 2,
      envelope: [{ x: 10, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 6 }, { x: 10, y: 6 }] } } as PlayerShotPreview;
    scene.system.tick(tickInput({ playerShotPreview: preview }));
    const arc = scene.graphics.at(-1)!;
    expect(arc.poly).toHaveBeenCalledOnce();
    expect(arc.lineTo).toHaveBeenCalledTimes(32);
    scene.system.tick(tickInput({ playerShotPreview: preview }));
    expect(arc.clear).toHaveBeenCalledOnce();
    scene.system.tick(tickInput({ playerShotPreview: { ...preview, expectedFlight: { ...preview.expectedFlight!, curveOffsetTiles: -2 } } }));
    expect(arc.clear).toHaveBeenCalledTimes(2);
    expect(arc.lineTo).toHaveBeenCalledTimes(64);
    expect(scene.system.playerShotPlayback()).toBeNull();
  });

  it("adds the existing golfer sprites when their atlas becomes ready after the first playback tick", () => {
    let ready = false;
    const scene = fixture({ atlasReady: () => ready });
    scene.system.create!({ ...snapshot(), playerRound: playerShot().round });
    const input = tickInput({ playerShotPlayback: playerShotPlaybackFrame("s1", .18) });
    scene.system.tick(input);
    expect(scene.sprites).toHaveLength(0);
    ready = true;
    scene.system.tick(input);
    expect(scene.sprites).toHaveLength(2);
    expect(scene.system.playerShotPlayback()!.golferFrame).toMatch(/_swing_\d_5$/);
    scene.system.tick(input);
    expect(scene.sprites).toHaveLength(2);
    scene.system.destroy!();
    scene.sprites.forEach((sprite) => expect(sprite.destroy).toHaveBeenCalledOnce());
  });
});
