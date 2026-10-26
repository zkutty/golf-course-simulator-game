import { destroySceneSubtree } from "../../../game/render/destroySceneSubtree";
import * as PIXI from "pixi.js";
import { TERRAIN_PALETTES, terrainPattern } from "../../../accessibility/terrainPalettes";
import type { ColorVisionMode } from "../../../game/onboarding/profile";
import { effectiveTerrainForPaintPreview } from "../../../game/conditions/surfaceCare";
import { getBiomeDefinition } from "../../../game/models/biomes";
import { decorationTiles, normalizedDecoration } from "../../../game/models/decorations";
import type { TerrainStrokePreview } from "../../../game/models/terrainStroke";
import type {
  Course,
  DecorationKind,
  DecorationRotation,
  Hole,
  Point,
  Terrain,
} from "../../../game/models/types";
import type { SeasonalVisualState } from "../../../game/presentation/seasonalVisualState";
import { buildBunkerVisualRings, classifyBunkerVisualType } from "../../../game/render/bunkerShapes";
import { TILE_H, TILE_W, worldToIso, type IsoRotation } from "../../../game/render/iso";
import { ELEVATION_STEP_YARDS, sampleAuthoritativeFlightGeometry } from "../../../game/rules/obstacleCollision";
import { isValidRetainedShotMotionV1, sampleRetainedShotMotion } from "../../../game/rules/shotMotion";
import { PLAYER_SHOT_CONTACT_FRACTION, type PlayerShotPlaybackFrame } from "../../../game/playerPro/shotPlayback";
import type { PlayerShotPreview } from "../../../game/playerPro/playerPro";
import type { PlayerRoundCourseSnapshot } from "../../../game/models/playerProTypes";
import { createGreenRolloutSurfaceSampler } from "../../../game/greens/greenRollout";
import { GOLFER_DISPLAY_W, GOLFER_FEET_Y, GOLFER_FRAME_H, GOLFER_FRAME_W, PUTT_CONTACT_FRAME, SWING_CONTACT_FRAME, facingOctant, golferFrameName, golferPose } from "../../../game/render/golferSprites";
import { getGolferFrame, golfersAtlasReady } from "../../../render/atlas";
import { golferActivityOwnerKey } from "../../../game/render/golferActivity";
import type { ControlledGolferRuntimeFrame, createNaturalGolferRuntime } from "../../../game/render/naturalGolferRuntime";
import { buildLandscapeComponents } from "../../../game/render/landscapeGeometry";
import { PerfWindow } from "../../../game/render/perfStats";
import { seasonalTerrainTreatment } from "../../../game/render/seasonalTerrainPresentation";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

const TERRAIN_COLORS: Record<Terrain, number> = {
  fairway: 0x4fa64f,
  rough: 0x2f7a36,
  deep_rough: 0x1f5f2c,
  sand: 0xd7c48a,
  waste_area: 0x9f8153,
  water: 0x2b7bbb,
  wetland: 0x477b68,
  green: 0x5dbb6a,
  tee: 0x8b6b4f,
  path: 0x8f8f8f,
};

export interface TerrainPreviewRenderDiagnostics {
  revision: number;
  previewKind: TerrainStrokePreview["previewKind"];
  selectedTerrain: Terrain | null;
  materials: Terrain[];
  colors: Partial<Record<Terrain, number>>;
}

export interface OverlayTickInput {
  readonly wizardStep: "TEE" | "GREEN" | "CONFIRM" | "MOVE_TEE" | "MOVE_GREEN";
  readonly holes: readonly Hole[];
  readonly activeHoleIndex: number;
  readonly draftTee: Point | null;
  readonly worldPointToScreen: (x: number, y: number, elevation?: number) => { x: number; y: number };
  readonly course: Course;
  readonly effectiveTiles: readonly Terrain[];
  readonly rotation: IsoRotation;
  readonly surfaceHeightAt: RenderSnapshot["surfaceHeightAt"];
  readonly editorMode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR";
  readonly selectedTerrain?: Terrain;
  readonly terrainStrokePreview: TerrainStrokePreview | null;
  readonly colorVision: ColorVisionMode;
  readonly graphicsQuality: "high" | "medium" | "low";
  readonly seasonalVisualState?: SeasonalVisualState;
  readonly reducedMotion?: boolean;
  readonly sculptRadius?: number;
  readonly selectedDecorationKind?: DecorationKind;
  readonly decorationRotation?: DecorationRotation;
  readonly decorationSpan?: number;
  readonly playerShotPlayback?: PlayerShotPlaybackFrame | null;
  readonly playerShotPreview?: PlayerShotPreview | null;
  readonly controlledBodyEnabled?: boolean;
  /** Current stage draw/cull/hidden policy, independent of optional body/source publication. */
  readonly controlledBodyDrawEligible?: boolean;
  readonly controlledActorId?: string | null;
  readonly controlledBody?: ControlledGolferRuntimeFrame | null;
}

export interface PlayerShotRenderDiagnostics {
  shotId: string;
  progress: number;
  motionProgress: number;
  phase: string;
  point: Point;
  heightYards: number;
  ball: Point;
  shadow: Point;
  golferFrame: string | null;
}

export function playerShotGolferPose(frame: PlayerShotPlaybackFrame, club: string, direction: Point, rotation: IsoRotation) {
  const contactFrame = club === "Putter" ? PUTT_CONTACT_FRAME : SWING_CONTACT_FRAME;
  const atContact = frame.phase === "contact" || !frame.addressing && frame.motionProgress < .03;
  const segment = frame.addressing || atContact ? "pause" : "flight";
  const progress = atContact ? 1 : frame.addressing ? (frame.addressProgress ?? frame.progress / PLAYER_SHOT_CONTACT_FRACTION) * contactFrame / (contactFrame + 1) * .999999
    : frame.motionProgress;
  return golferPose({ segKind: segment, segT: progress, shot: club === "Putter" ? "putt" : "swing",
    facingOct: facingOctant(direction.x, direction.y, rotation), walkPhase: 0, timeSec: 0, reaction: null });
}

export interface PerfHudFrameDiagnostics {
  readonly golfers: number;
  readonly bubbles: number;
  readonly ripples: number;
  readonly impacts: number;
  readonly ambientObjects: number;
  readonly chunksVisible: number;
  readonly chunksTotal: number;
  readonly objects: number;
}

export interface OverlaysDiagnosticsSceneSystem extends RenderSceneSystem {
  readonly id: "overlaysDiagnostics";
  invalidate(): void;
  setHover(tile: Point | null): boolean;
  tick(input: OverlayTickInput): void;
  beginFrame(nowMs: number): void;
  markPerf(name: string): void;
  finishFrame(nowMs: number, dtMs: number, diagnostics: () => PerfHudFrameDiagnostics): void;
  terrainPreview(): TerrainPreviewRenderDiagnostics | null;
  playerShotPlayback(): PlayerShotRenderDiagnostics | null;
}

export interface OverlaysDiagnosticsLayers {
  readonly terrainDecals: PIXI.Container;
  readonly fx: PIXI.Container;
  readonly screenOverlay: PIXI.Container;
}

export interface OverlaysDiagnosticsDependencies {
  readonly activityRuntime?: Pick<ReturnType<typeof createNaturalGolferRuntime<PIXI.Texture>>, "observeControlledPresented">;
  readonly createContainer?: () => PIXI.Container;
  readonly createGraphics?: () => PIXI.Graphics;
  readonly createText?: (options: PIXI.TextOptions) => PIXI.Text;
  readonly readPerfEnabled?: () => boolean;
  readonly now?: () => number;
  readonly publishPerf?: (diagnostics: object) => void;
  readonly createSprite?: () => PIXI.Sprite;
  readonly atlasReady?: () => boolean;
  readonly golferFrame?: typeof getGolferFrame;
}

/** Owns the player-shot, editor-hover, wizard-line, preview, and perf diagnostic displays. */
export function createOverlaysDiagnosticsSceneSystem(
  layers: OverlaysDiagnosticsLayers,
  dependencies: OverlaysDiagnosticsDependencies = {},
): OverlaysDiagnosticsSceneSystem {
  const createContainer = dependencies.createContainer ?? (() => new PIXI.Container());
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  const createText = dependencies.createText ?? ((options) => new PIXI.Text(options));
  const readPerfEnabled = dependencies.readPerfEnabled
    ?? (() => localStorage.getItem("coursecraft_perfhud") === "on");
  const now = dependencies.now ?? (() => performance.now());
  const publishPerf = dependencies.publishPerf
    ?? ((diagnostics) => { (window as unknown as { __ccPerf?: object }).__ccPerf = diagnostics; });

  let playerShotOverlay: PIXI.Container | null = null;
  let authority: RenderSnapshot | null = null;
  let frozenCourse: PlayerRoundCourseSnapshot | null = null;
  let frozenHeightAt: ((point: Point) => number) | null = null;
  let movingOverlay: PIXI.Container | null = null;
  let movingBall: PIXI.Graphics | null = null;
  let movingShadow: PIXI.Graphics | null = null;
  let contactEffect: PIXI.Graphics | null = null;
  let expectedOverlay: PIXI.Graphics | null = null;
  let golferBase: PIXI.Sprite | null = null;
  let golferTint: PIXI.Sprite | null = null;
  let lastGolferFrame = "";
  let lastExpected: PlayerShotPreview | null | undefined;
  let lastExpectedRotation: IsoRotation | null = null;
  let playerDiagnostics: PlayerShotRenderDiagnostics | null = null;
  let hoverHighlight: PIXI.Graphics | null = null;
  let hoverLine: PIXI.Graphics | null = null;
  let hover: Point | null = null;
  let dirty = true;
  let previewDiagnostics: TerrainPreviewRenderDiagnostics | null = null;
  const perf = {
    win: new PerfWindow(180),
    enabled: false,
    lastPollMs: 0,
    lastHudMs: 0,
    text: null as PIXI.Text | null,
    sections: {} as Record<string, number>,
    lastMarkMs: 0,
  };

  const clearPlayerShot = () => {
    playerShotOverlay?.parent?.removeChild(playerShotOverlay);
    destroySceneSubtree(playerShotOverlay);
    playerShotOverlay = null;
  };

  const renderPlayerShot = (snapshot: RenderSnapshot) => {
    authority = snapshot;
    clearPlayerShot();
    const round = snapshot.playerRound;
    if (!round) return;
    if (round.course && frozenCourse !== round.course) {
      frozenCourse = round.course;
      const course = { width: round.course.width, height: round.course.height, tiles: round.course.tiles as Terrain[],
        elevations: round.course.elevations, greenSurface: round.course.greenSnapshot?.surface,
        holes: round.course.holes.map((hole) => ({ id: hole.id, green: hole.pin })) };
      const sample = createGreenRolloutSurfaceSampler(course, course.greenSurface);
      frozenHeightAt = (point) => sample(point).height;
    }

    const next = createContainer();
    next.label = "player-pro-shot-overlay";
    const graphics = createGraphics();
    const trace = round.pendingShot ?? round.shots[round.shots.length - 1];
    const retained = isValidRetainedShotMotionV1(trace?.sharedOutcome?.motion) ? trace.sharedOutcome.motion : null;
    const moving = round.phase === "flight" && retained;
    const settled = retained && round.phase !== "flight" ? retained.physicalRest : null;
    const ballPoint = settled?.point ?? round.ball;
    const ballElevation = settled ? settled.heightYards / ELEVATION_STEP_YARDS : snapshot.surfaceHeightAt(ballPoint.x + 0.5, ballPoint.y + 0.5);
    const ball = worldToIso(ballPoint.x + 0.5, ballPoint.y + 0.5, ballElevation, snapshot.rotation);
    if (!moving) {
    graphics.circle(ball.x, ball.y - 2, retained ? 3 : 7);
    graphics.fill({ color: retained ? 0xffffff : 0xffd25b, alpha: 0.95 });
    graphics.stroke({ width: 2.5, color: 0x253c2b, alpha: 1 });
    graphics.circle(ball.x, ball.y - 2, retained ? 7 : 11);
    graphics.stroke({ width: 2, color: 0xfff0a0, alpha: 0.75 });
    }

    if (retained?.reliefPosition && round.phase !== "flight") {
      const p = retained.reliefPosition;
      const relief = worldToIso(p.x + .5, p.y + .5, frozenHeightAt?.(p) ?? snapshot.surfaceHeightAt(p.x + .5, p.y + .5), snapshot.rotation);
      graphics.circle(relief.x, relief.y - 2, 9);
      graphics.stroke({ color: 0xffcf67, width: 2, alpha: .9 });
      graphics.moveTo(relief.x - 4, relief.y - 2); graphics.lineTo(relief.x + 4, relief.y - 2);
      graphics.stroke({ color: 0xffcf67, width: 1.5, alpha: .9 });
    }

    if (snapshot.playerShotAim && round.phase === "awaiting_shot") {
      const aimElevation = snapshot.surfaceHeightAt(snapshot.playerShotAim.x + 0.5, snapshot.playerShotAim.y + 0.5);
      const aim = worldToIso(snapshot.playerShotAim.x + 0.5, snapshot.playerShotAim.y + 0.5, aimElevation, snapshot.rotation);
      graphics.moveTo(ball.x, ball.y - 7);
      graphics.lineTo(aim.x, aim.y - 5);
      graphics.stroke({ width: 2.2, color: 0xffe27a, alpha: 0.9 });
      graphics.ellipse(aim.x, aim.y - 5, TILE_W * 1.4, TILE_H * 1.1);
      graphics.fill({ color: 0xffd25b, alpha: 0.13 });
      graphics.stroke({ width: 2, color: 0x6f4e16, alpha: 0.9 });
      graphics.circle(aim.x, aim.y - 5, 3.5);
      graphics.fill({ color: 0xffffff, alpha: 0.95 });
    }

    if (trace && !moving) {
      const from = worldToIso(trace.from.x + 0.5, trace.from.y + 0.5, snapshot.surfaceHeightAt(trace.from.x + 0.5, trace.from.y + 0.5), snapshot.rotation);
      const restPoint = retained?.physicalRest.point ?? trace.rest;
      const rest = worldToIso(restPoint.x + 0.5, restPoint.y + 0.5, retained ? retained.physicalRest.heightYards / ELEVATION_STEP_YARDS
        : snapshot.surfaceHeightAt(restPoint.x + 0.5, restPoint.y + 0.5), snapshot.rotation);
      graphics.moveTo(from.x, from.y - 5);
      if (retained) {
        const append = (point: Point, heightYards: number) => {
          const projected = worldToIso(point.x + .5, point.y + .5, heightYards / ELEVATION_STEP_YARDS, snapshot.rotation);
          graphics.lineTo(projected.x, projected.y - 5);
        };
        if (retained.flight) for (let index = 1; index <= 24; index += 1) {
          const sample = sampleAuthoritativeFlightGeometry(retained.flight.geometry, index / 24 * retained.flight.endSampleIndex / retained.flight.sampleDivisions);
          append(sample.point, sample.pathHeightYards);
        }
        for (const vertex of [...retained.postCollisionPath, ...retained.groundPath]) append(vertex.point, vertex.heightYards);
      } else if (trace.greenRollout?.path.length) {
        const landing = worldToIso(
          trace.greenRollout.landing.x + 0.5,
          trace.greenRollout.landing.y + 0.5,
          snapshot.surfaceHeightAt(
            trace.greenRollout.landing.x + 0.5,
            trace.greenRollout.landing.y + 0.5,
          ),
          snapshot.rotation,
        );
        graphics.lineTo(landing.x, landing.y - 5);
        for (const point of trace.greenRollout.path.slice(1)) {
          const projected = worldToIso(
            point.x + 0.5,
            point.y + 0.5,
            snapshot.surfaceHeightAt(point.x + 0.5, point.y + 0.5),
            snapshot.rotation,
          );
          graphics.lineTo(projected.x, projected.y - 5);
        }
      } else {
        graphics.lineTo(rest.x, rest.y - 5);
      }
      graphics.stroke({ width: 2.5, color: trace.penaltyStrokes > 0 ? 0xc84a37 : 0xf7f0c2, alpha: 0.78 });
      graphics.circle(rest.x, rest.y - 5, 5);
      graphics.fill({ color: trace.penaltyStrokes > 0 ? 0xd34b39 : 0xffffff, alpha: 0.95 });
    }
    next.addChild(graphics);
    layers.fx.addChild(next);
    playerShotOverlay = next;
  };

  const ensurePlayerGolferDisplays = () => {
    if (!movingOverlay || golferBase || !(dependencies.atlasReady ?? golfersAtlasReady)()) return;
    const makeSprite = dependencies.createSprite ?? (() => new PIXI.Sprite());
    golferBase = makeSprite(); golferTint = makeSprite(); golferTint.tint = 0x467449;
    for (const sprite of [golferBase, golferTint]) {
      sprite.anchor.set(.5, GOLFER_FEET_Y / GOLFER_FRAME_H);
      sprite.scale.set(GOLFER_DISPLAY_W / GOLFER_FRAME_W);
      movingOverlay.addChild(sprite);
    }
    if (movingBall) movingOverlay.addChild(movingBall);
  };

  const ensurePlayerMotionDisplays = () => {
    if (movingOverlay) { ensurePlayerGolferDisplays(); return; }
    movingOverlay = createContainer(); movingOverlay.label = "player-pro-retained-motion";
    movingShadow = createGraphics(); movingShadow.label = "player-pro-ball-shadow";
    movingShadow.ellipse(0, 0, 3.4, 1.5); movingShadow.fill({ color: 0x101b13, alpha: .45 });
    contactEffect = createGraphics(); contactEffect.label = "player-pro-contact-effect";
    movingBall = createGraphics(); movingBall.label = "player-pro-moving-ball";
    movingBall.circle(0, -2, 2.8); movingBall.fill({ color: 0xffffff, alpha: 1 });
    movingBall.stroke({ color: 0x283d2e, width: 1.1, alpha: 1 });
    movingOverlay.addChild(movingShadow, contactEffect);
    movingOverlay.addChild(movingBall);
    ensurePlayerGolferDisplays();
    layers.fx.addChild(movingOverlay);
    expectedOverlay = createGraphics(); expectedOverlay.label = "player-pro-expected-envelope";
    layers.fx.addChild(expectedOverlay);
  };

  const tickPlayerMotion = (input: OverlayTickInput) => {
    const round = authority?.playerRound;
    const pending = round?.phase === "flight" ? round.pendingShot : null;
    const motion = pending?.sharedOutcome?.motion;
    const frame = input.playerShotPlayback;
    const active = pending && frame?.shotId === pending.id && isValidRetainedShotMotionV1(motion);
    const expected = round?.phase === "awaiting_shot" ? input.playerShotPreview : null;
    const physicalHeightAt = (point: Point) => frozenHeightAt?.(point) ?? input.surfaceHeightAt(point.x + .5, point.y + .5);
    if (!active && !expected?.expectedFlight && !movingOverlay) return;
    ensurePlayerMotionDisplays();
    if (expectedOverlay && (expected !== lastExpected || input.rotation !== lastExpectedRotation)) {
      lastExpected = expected; lastExpectedRotation = input.rotation;
      expectedOverlay.clear();
      const path = expected?.expectedFlight;
      if (path) {
        const envelope = path.envelope.map((point) => worldToIso(point.x + .5, point.y + .5, physicalHeightAt(point), input.rotation));
        if (envelope.length >= 3) {
          expectedOverlay.poly(envelope.flatMap((point) => [point.x, point.y]));
          expectedOverlay.fill({ color: 0xffdc74, alpha: .1 }); expectedOverlay.stroke({ color: 0xffdc74, width: 1.3, alpha: .7 });
        }
        const startHeight = physicalHeightAt(path.from);
        const endHeight = physicalHeightAt(path.landing);
        const geometry = { version: 1 as const, from: path.from, to: path.landing,
          startHeightYards: startHeight * ELEVATION_STEP_YARDS, endHeightYards: endHeight * ELEVATION_STEP_YARDS,
          apexHeightYards: path.apexHeightYards, curve: { kind: "lateral_quadratic_v1" as const, lateralOffsetTiles: path.curveOffsetTiles } };
        for (let index = 0; index <= 32; index += 1) {
          const source = sampleAuthoritativeFlightGeometry(geometry, index / 32);
          const iso = worldToIso(source.point.x + .5, source.point.y + .5, source.pathHeightYards / ELEVATION_STEP_YARDS, input.rotation);
          if (index === 0) expectedOverlay.moveTo(iso.x, iso.y - 2); else expectedOverlay.lineTo(iso.x, iso.y - 2);
        }
        expectedOverlay.stroke({ color: 0xffedaa, width: 1.6, alpha: .78 });
      }
    }
    if (!movingOverlay || !movingBall || !movingShadow || !contactEffect) return;
    movingOverlay.visible = Boolean(active);
    if (!active || !motion || !frame || !pending) { playerDiagnostics = null; return; }
    const pose = sampleRetainedShotMotion(motion, frame.motionProgress);
    if (!pose) return;
    const groundHeight = physicalHeightAt(pose.point);
    const shadow = worldToIso(pose.point.x + .5, pose.point.y + .5, groundHeight, input.rotation);
    const ball = worldToIso(pose.point.x + .5, pose.point.y + .5, pose.heightYards / ELEVATION_STEP_YARDS, input.rotation);
    movingBall.position.set(ball.x, ball.y); movingShadow.position.set(shadow.x, shadow.y);
    let golferFrame: string | null = null;
    if (golferBase && golferTint) {
      const origin = worldToIso(motion.from.point.x + .5, motion.from.point.y + .5, motion.from.heightYards / ELEVATION_STEP_YARDS, input.rotation);
      const body = input.controlledBody;
      const bodySourceCurrent = !!body && !!input.controlledActorId && body.actorId === input.controlledActorId
        && body.ownerKey === golferActivityOwnerKey({ scopeId: round!.id, actorId: input.controlledActorId, shot: motion.identity })
        && body.sourceFrame.shotId === frame.shotId && body.sourceFrame.progress === frame.progress && body.sourceFrame.motionProgress === frame.motionProgress
        && body.sourceFrame.phase === frame.phase && body.sourceFrame.addressing === frame.addressing && body.sourceFrame.complete === frame.complete;
      const bodyCurrent = bodySourceCurrent && body.admitted;
      const spritePose = input.controlledBodyEnabled ? bodyCurrent ? body.legacyPose : { anim: "idle" as const, row: 0, mirror: false, col: 0 }
        : playerShotGolferPose(frame, pending.club, { x: pending.aim.x - pending.from.x, y: pending.aim.y - pending.from.y }, input.rotation);
      const frameName = golferFrameName(0, spritePose, false);
      golferFrame = frameName;
      let complete = !input.controlledBodyEnabled || input.controlledBodyDrawEligible === true
        && !(bodySourceCurrent && (body.reason === "culled" || body.reason === "hidden"));
      if (golferFrame !== lastGolferFrame || input.controlledBodyEnabled) {
        const getFrame = dependencies.golferFrame ?? getGolferFrame;
        const texture = getFrame(frameName), tint = getFrame(golferFrameName(0, spritePose, true));
        if (input.controlledBodyEnabled) {
          complete = complete && !!texture && !!tint;
          if (complete) { golferBase.texture = texture!; golferTint.texture = tint!; lastGolferFrame = golferFrame; }
        } else {
          lastGolferFrame = golferFrame;
          if (texture) golferBase.texture = texture;
          if (tint) golferTint.texture = tint;
        }
      }
      for (const sprite of [golferBase, golferTint]) {
        sprite.visible = !input.controlledBodyEnabled || complete;
        sprite.position.set(origin.x - 5, origin.y);
        sprite.scale.x = Math.abs(sprite.scale.x) * (spritePose.mirror ? -1 : 1);
      }
      if (input.controlledBodyEnabled && complete && bodyCurrent) dependencies.activityRuntime?.observeControlledPresented(body);
    }
    contactEffect.clear();
    let contact: typeof motion.events[number] | undefined;
    for (let index = motion.events.length - 1; index >= 0; index -= 1) {
      const event = motion.events[index]!;
      if ((event.kind === "first_contact" || event.kind === "collision") && event.time <= frame.motionProgress) { contact = event; break; }
    }
    if (contact && frame.motionProgress - contact.time < .08 && !input.reducedMotion) {
      const at = worldToIso(contact.point.x + .5, contact.point.y + .5, contact.heightYards / ELEVATION_STEP_YARDS, input.rotation);
      const fade = 1 - (frame.motionProgress - contact.time) / .08;
      contactEffect.ellipse(at.x, at.y, 5 + (1 - fade) * 8, 2 + (1 - fade) * 3);
      contactEffect.stroke({ color: 0xfff2bf, width: 1.5, alpha: fade * .7 });
    }
    playerDiagnostics = { shotId: pending.id, progress: frame.progress, motionProgress: frame.motionProgress, phase: frame.addressing ? "address" : pose.phase,
      point: { ...pose.point }, heightYards: pose.heightYards, ball, shadow, golferFrame };
  };

  const ensureDynamicDisplays = () => {
    if (!hoverHighlight) {
      hoverHighlight = createGraphics();
      hoverHighlight.label = "hover-terrain-diagnostics";
      layers.terrainDecals.addChild(hoverHighlight);
    }
    if (!hoverLine) {
      hoverLine = createGraphics();
      hoverLine.label = "hover-wizard-line";
      layers.screenOverlay.addChild(hoverLine);
    }
  };

  const tick = (input: OverlayTickInput) => {
    tickPlayerMotion(input);
    ensureDynamicDisplays();
    if (!dirty || !hoverHighlight || !hoverLine) return;
    dirty = false;
    const previewRevision = (previewDiagnostics?.revision ?? 0) + 1;
    previewDiagnostics = null;

    const {
      course,
      effectiveTiles,
      rotation,
      surfaceHeightAt,
      terrainStrokePreview,
      selectedTerrain,
    } = input;
    const highlight = hoverHighlight;
    highlight.clear();
    if (hover) {
      const tileDiamond = (tx: number, ty: number) => {
        const top = worldToIso(tx + 0.5, ty, surfaceHeightAt(tx + 0.5, ty), rotation);
        return [
          top.x, top.y,
          top.x + TILE_W / 2, top.y + TILE_H / 2,
          top.x, top.y + TILE_H,
          top.x - TILE_W / 2, top.y + TILE_H / 2,
        ];
      };
      const outlineTile = (tx: number, ty: number, alpha: number) => {
        highlight.poly(tileDiamond(tx, ty));
        highlight.stroke({ width: 2, color: 0xffffff, alpha });
      };
      const markTileState = (
        tx: number,
        ty: number,
        state: "accepted" | "unaffordable" | "protected" | "excluded",
        color: number,
        pattern: ReturnType<typeof terrainPattern>,
      ) => {
        const diamond = tileDiamond(tx, ty);
        highlight.poly(diamond);
        highlight.fill({ color, alpha: state === "accepted" ? 0.26 : 0.2 });
        highlight.stroke({
          width: state === "accepted" ? 2 : 2.8,
          color: state === "accepted" ? 0xffffff : 0xffe2b0,
          alpha: 0.96,
        });
        const centerX = diamond[0];
        const centerY = diamond[1] + TILE_H / 2;
        if (pattern === "stripe" || pattern === "crosshatch") {
          highlight.moveTo(centerX - 13, centerY + 2);
          highlight.lineTo(centerX + 5, centerY - 7);
          highlight.moveTo(centerX - 5, centerY + 7);
          highlight.lineTo(centerX + 13, centerY - 2);
          highlight.stroke({ width: 1.3, color: 0xffffff, alpha: 0.72 });
        }
        if (pattern === "crosshatch") {
          highlight.moveTo(centerX - 12, centerY - 3);
          highlight.lineTo(centerX + 6, centerY + 6);
          highlight.stroke({ width: 1.2, color: 0x223024, alpha: 0.7 });
        } else if (pattern === "dots") {
          for (const offset of [-8, 0, 8]) {
            highlight.circle(centerX + offset, centerY, 1.5);
            highlight.fill({ color: 0xffffff, alpha: 0.85 });
          }
        }
        if (state !== "accepted") {
          highlight.moveTo(centerX - 8, centerY - 5);
          highlight.lineTo(centerX + 8, centerY + 5);
          highlight.moveTo(centerX + 8, centerY - 5);
          highlight.lineTo(centerX - 8, centerY + 5);
          highlight.stroke({ width: 2.4, color: 0xffffff, alpha: 0.98 });
          if (state === "protected") {
            highlight.circle(centerX, centerY, 8.5);
            highlight.stroke({ width: 1.8, color: 0xffffff, alpha: 0.98 });
          }
        }
      };
      const strokeMaterial = terrainStrokePreview?.acceptedTiles[0]?.terrain
        ?? terrainStrokePreview?.excludedTiles[0]?.terrain;
      const currentStrokePreview = terrainStrokePreview?.previewKind === "surface-edit"
        || strokeMaterial == null
        || strokeMaterial === selectedTerrain;
      if (input.editorMode === "PAINT" && terrainStrokePreview && currentStrokePreview) {
        const themedColors: Record<Terrain, number> = input.colorVision === "standard"
          ? { ...TERRAIN_COLORS, ...getBiomeDefinition(course.theme).presentation.tileTints }
          : TERRAIN_PALETTES[input.colorVision];
        const previewColor = (terrain: Terrain) => input.seasonalVisualState
          ? seasonalTerrainTreatment({
            state: input.seasonalVisualState,
            terrain,
            quality: input.graphicsQuality,
            colorVision: input.colorVision,
            baseColor: themedColors[terrain],
            reducedMotion: input.reducedMotion,
          }).color
          : themedColors[terrain];
        const previewTiles = terrainStrokePreview.previewKind === "surface-edit"
          ? terrainStrokePreview.tiles
          : terrainStrokePreview.acceptedTiles;
        const previewMaterials = [...new Set(previewTiles.map((tile) => tile.terrain))];
        previewDiagnostics = {
          revision: previewRevision,
          previewKind: terrainStrokePreview.previewKind,
          selectedTerrain: selectedTerrain ?? null,
          materials: previewMaterials,
          colors: Object.fromEntries(previewMaterials.map((terrain) => [terrain, previewColor(terrain)])),
        };
        for (const tile of previewTiles) {
          markTileState(
            tile.x,
            tile.y,
            terrainStrokePreview.affordable ? "accepted" : "unaffordable",
            terrainStrokePreview.affordable ? previewColor(tile.terrain) : 0x8f3528,
            terrainPattern(tile.terrain),
          );
        }
        for (const tile of terrainStrokePreview.excludedTiles) {
          if (tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height) continue;
          markTileState(
            tile.x,
            tile.y,
            tile.reason === "protected" ? "protected" : "excluded",
            tile.reason === "protected" ? 0x6d5a2e : 0x555b60,
            "crosshatch",
          );
        }
        if (
          terrainStrokePreview.previewKind === "stroke"
          && input.graphicsQuality !== "low"
          && selectedTerrain
          && terrainStrokePreview.acceptedTiles.length > 0
        ) {
          const accepted = new Set(terrainStrokePreview.acceptedTiles.map((tile) => `${tile.x},${tile.y}`));
          const minX = Math.max(0, Math.min(...terrainStrokePreview.acceptedTiles.map((tile) => tile.x)) - 2);
          const minY = Math.max(0, Math.min(...terrainStrokePreview.acceptedTiles.map((tile) => tile.y)) - 2);
          const maxX = Math.min(course.width, Math.max(...terrainStrokePreview.acceptedTiles.map((tile) => tile.x)) + 3);
          const maxY = Math.min(course.height, Math.max(...terrainStrokePreview.acceptedTiles.map((tile) => tile.y)) + 3);
          const localWidth = maxX - minX;
          const localHeight = maxY - minY;
          const localTiles: Terrain[] = [];
          for (let ty = minY; ty < maxY; ty++) {
            for (let tx = minX; tx < maxX; tx++) localTiles.push(effectiveTiles[ty * course.width + tx]);
          }
          for (const tile of terrainStrokePreview.acceptedTiles) {
            const index = tile.y * course.width + tile.x;
            localTiles[(tile.y - minY) * localWidth + tile.x - minX] = effectiveTerrainForPaintPreview(course, index, tile.terrain);
          }
          const high = input.graphicsQuality === "high";
          const previewComponents = buildLandscapeComponents(
            localTiles,
            localWidth,
            localHeight,
            { cornerRadius: high ? 0.4 : 0.32, cornerSegments: high ? 4 : 2 },
          ).filter((component) => component.terrain === selectedTerrain && component.cells.some((index) => {
            const x = index % localWidth + minX;
            const y = Math.floor(index / localWidth) + minY;
            return accepted.has(`${x},${y}`);
          }));
          for (const component of previewComponents) {
            const bunkerType = selectedTerrain === "sand"
              ? classifyBunkerVisualType(component.cells, localTiles, localWidth, localHeight)
              : null;
            const rings = bunkerType
              ? buildBunkerVisualRings(component.rings, component.topologyKey, component.cells.length, bunkerType)
              : component.rings;
            for (const ring of rings) {
              const points = ring.map((point) => {
                const worldX = point.x + minX;
                const worldY = point.y + minY;
                return worldToIso(worldX, worldY, surfaceHeightAt(worldX, worldY), rotation);
              });
              if (points.length < 3) continue;
              highlight.poly(points.flatMap((point) => [point.x, point.y]));
              highlight.fill({
                color: terrainStrokePreview.affordable ? previewColor(selectedTerrain) : 0x8f3528,
                alpha: 0.16,
              });
              highlight.stroke({
                width: 2.4,
                color: terrainStrokePreview.affordable ? 0xffffff : 0xffd7c7,
                alpha: 0.88,
                join: "round",
                cap: "round",
              });
            }
          }
        }
      } else if (input.editorMode === "SCULPT" && input.sculptRadius && input.sculptRadius > 1) {
        const radius = input.sculptRadius - 0.5;
        for (let ty = hover.y - input.sculptRadius; ty <= hover.y + input.sculptRadius; ty++) {
          for (let tx = hover.x - input.sculptRadius; tx <= hover.x + input.sculptRadius; tx++) {
            if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) continue;
            const distanceSquared = (tx - hover.x) ** 2 + (ty - hover.y) ** 2;
            if (distanceSquared <= radius * radius + 1e-9) outlineTile(tx, ty, tx === hover.x && ty === hover.y ? 0.9 : 0.45);
          }
        }
      } else if (input.editorMode === "DECOR" && input.selectedDecorationKind) {
        const preview = decorationTiles(normalizedDecoration({
          kind: input.selectedDecorationKind,
          x: hover.x,
          y: hover.y,
          rotation: input.decorationRotation ?? 0,
          ...((input.selectedDecorationKind === "bridge" || input.selectedDecorationKind === "boardwalk")
            ? { span: input.decorationSpan ?? 3 }
            : {}),
        }));
        for (const tile of preview) {
          if (tile.x >= 0 && tile.y >= 0 && tile.x < course.width && tile.y < course.height) outlineTile(tile.x, tile.y, 0.75);
        }
      } else {
        outlineTile(hover.x, hover.y, 0.9);
      }
    }

    hoverLine.clear();
    const isGreenPlacement = input.wizardStep === "GREEN" || input.wizardStep === "MOVE_GREEN";
    if (isGreenPlacement && hover) {
      const hole = input.holes[input.activeHoleIndex];
      const fromPoint = hole?.tee || input.draftTee;
      if (fromPoint) {
        const from = input.worldPointToScreen(
          fromPoint.x + 0.5,
          fromPoint.y + 0.5,
          surfaceHeightAt(fromPoint.x + 0.5, fromPoint.y + 0.5),
        );
        const to = input.worldPointToScreen(
          hover.x + 0.5,
          hover.y + 0.5,
          surfaceHeightAt(hover.x + 0.5, hover.y + 0.5),
        );
        hoverLine.moveTo(from.x, from.y);
        hoverLine.lineTo(to.x, to.y);
        hoverLine.stroke({ width: 2, color: 0x6496ff, alpha: 0.6 });
      }
    }
  };

  const beginFrame = (nowMs: number) => {
    if (nowMs - perf.lastPollMs > 1000) {
      perf.lastPollMs = nowMs;
      perf.enabled = readPerfEnabled();
      if (perf.enabled && !perf.text) {
        const text = createText({
          text: "",
          style: {
            fontFamily: "monospace",
            fontSize: 11,
            fill: 0xffffff,
            stroke: { color: 0x000000, width: 3 },
            lineHeight: 15,
          },
        });
        text.position.set(8, 8);
        layers.screenOverlay.addChild(text);
        perf.text = text;
      } else if (!perf.enabled && perf.text) {
        perf.text.parent?.removeChild(perf.text);
        perf.text.destroy();
        perf.text = null;
        perf.win.reset();
      }
    }
    if (perf.enabled) perf.sections = {};
    perf.lastMarkMs = perf.enabled ? now() : 0;
  };

  const markPerf = (name: string) => {
    if (!perf.enabled) return;
    const mark = now();
    perf.sections[name] = (perf.sections[name] ?? 0) + (mark - perf.lastMarkMs);
    perf.lastMarkMs = mark;
  };

  const finishFrame = (nowMs: number, dtMs: number, diagnosticsSource: () => PerfHudFrameDiagnostics) => {
    if (!perf.enabled) return;
    markPerf("golfers+emotes");
    perf.win.push({ totalMs: dtMs, sections: perf.sections });
    if (nowMs - perf.lastHudMs <= 250) return;
    perf.lastHudMs = nowMs;
    const diagnostics = diagnosticsSource();
    const summary = perf.win.summary();
    let workMs = 0;
    for (const value of Object.values(summary.sections)) workMs += value;
    const info = {
      fps: summary.fps,
      meanMs: summary.meanMs,
      p95Ms: summary.p95Ms,
      maxMs: summary.maxMs,
      workMs,
      sections: summary.sections,
      ...diagnostics,
    };
    publishPerf(info);
    if (perf.text) {
      const sections = Object.entries(summary.sections)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => `${name} ${value.toFixed(2)}`)
        .join("  ");
      perf.text.text =
        `${summary.fps.toFixed(0)} fps  mean ${summary.meanMs.toFixed(2)}ms  p95 ${summary.p95Ms.toFixed(2)}ms  max ${summary.maxMs.toFixed(1)}ms\n`
        + `tick work ${workMs.toFixed(2)}ms  chunks ${diagnostics.chunksVisible}/${diagnostics.chunksTotal}  golfers ${diagnostics.golfers}  bubbles ${diagnostics.bubbles}  objects ${diagnostics.objects}\n`
        + sections;
    }
  };

  const destroy = () => {
    clearPlayerShot();
    movingOverlay?.parent?.removeChild(movingOverlay); destroySceneSubtree(movingOverlay);
    expectedOverlay?.parent?.removeChild(expectedOverlay); expectedOverlay?.destroy();
    movingOverlay = null; movingBall = null; movingShadow = null; contactEffect = null;
    golferBase = null; golferTint = null; expectedOverlay = null; authority = null;
    frozenCourse = null; frozenHeightAt = null;
    lastGolferFrame = ""; lastExpected = undefined; lastExpectedRotation = null; playerDiagnostics = null;
    hoverHighlight?.parent?.removeChild(hoverHighlight);
    hoverHighlight?.destroy();
    hoverHighlight = null;
    hoverLine?.parent?.removeChild(hoverLine);
    hoverLine?.destroy();
    hoverLine = null;
    perf.text?.parent?.removeChild(perf.text);
    perf.text?.destroy();
    perf.text = null;
    perf.win.reset();
    perf.enabled = false;
    perf.sections = {};
    hover = null;
    dirty = true;
    previewDiagnostics = null;
  };

  return {
    id: "overlaysDiagnostics",
    create(snapshot) {
      ensureDynamicDisplays();
      renderPlayerShot(snapshot);
      dirty = true;
    },
    update: renderPlayerShot,
    destroy,
    invalidate() {
      dirty = true;
    },
    setHover(tile) {
      const changed = hover?.x !== tile?.x || hover?.y !== tile?.y;
      hover = tile ? { x: tile.x, y: tile.y } : null;
      if (changed) dirty = true;
      return changed;
    },
    tick,
    beginFrame,
    markPerf,
    finishFrame,
    playerShotPlayback: () => playerDiagnostics ? { ...playerDiagnostics, point: { ...playerDiagnostics.point }, ball: { ...playerDiagnostics.ball }, shadow: { ...playerDiagnostics.shadow } } : null,
    terrainPreview: () => previewDiagnostics
      ? {
        ...previewDiagnostics,
        materials: [...previewDiagnostics.materials],
        colors: { ...previewDiagnostics.colors },
      }
      : null,
  };
}
