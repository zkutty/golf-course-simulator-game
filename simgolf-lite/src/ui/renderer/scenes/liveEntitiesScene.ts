import * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import type { Terrain } from "../../../game/models/types";
import { ballFlightPose, landingBehavior } from "../../../game/render/ballFlight";
import { forgetGolfer, recordEmote } from "../../../game/render/emoteFeed";
import {
  EMOTE_STALL_MS,
  createEmoteScheduler,
  emotePresentation,
  feeEmote,
  hazardEmote,
  holeOutEmote,
  moodEmote,
  pruneEmotes,
  resolveOverlaps,
  tryShowEmote,
  type EmoteKind,
} from "../../../game/render/emotes";
import {
  GOLFER_CONTACT_SHADOW,
  advanceGroundedWalkPhase,
  groundedGolferFrame,
} from "../../../game/render/golferGrounding";
import {
  GOLFER_DISPLAY_W,
  GOLFER_FEET_Y,
  GOLFER_FRAME_H,
  GOLFER_FRAME_W,
  REACTION_SEC,
  WALK_STRIDES_PER_TILE,
  facingOctant,
  golferFrameName,
  golferPose,
  golferTint,
  golferVariant,
  reactionFor,
  type GolferReaction,
} from "../../../game/render/golferSprites";
import { entityDepth } from "../../../game/render/objectPlacement";
import { tileCenterIso, type IsoRotation } from "../../../game/render/iso";
import {
  MAX_ACTIVE_IMPACTS,
  MAX_ACTIVE_RIPPLES,
  appendBoundedEffect,
} from "../../../game/render/worldEffects";
import {
  getGolferFrame,
  golfersAtlasReady,
} from "../../../render/atlas";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

interface GolferEntry {
  holder: PIXI.Container;
  ball: PIXI.Graphics;
  ballShadow: PIXI.Graphics;
  lastBall: { x: number; y: number } | null;
  prevBallIso: { x: number; y: number } | null;
  ballLanded: boolean;
  emote: {
    lastScored: number;
    prevMood: number;
    feeChecked: boolean;
    lastPos: { x: number; y: number };
    stillSinceMs: number;
  };
  sprite: {
    shadow: PIXI.Graphics;
    ring: PIXI.Graphics;
    base: PIXI.Sprite;
    tintLayer: PIXI.Sprite;
    variant: number;
    tint: number;
    lastFrame: string;
    walkPhase: number;
    lastPos: { x: number; y: number } | null;
    dirX: number;
    dirY: number;
    reaction: GolferReaction | null;
    reactionUntil: number;
    lastScored: number;
  } | null;
  dot: {
    body: PIXI.Graphics;
    lastColor: string;
    lastMoodBucket: number;
  } | null;
}

interface LiveEntityAuthority {
  readonly course: RenderSnapshot["course"];
  readonly effectiveTiles: readonly Terrain[];
  readonly rotation: IsoRotation;
  readonly surfaceHeightAt: RenderSnapshot["surfaceHeightAt"];
}

export interface LiveEntityLayers {
  readonly objects: PIXI.Container;
  readonly terrainDecals: PIXI.Container;
  readonly fx: PIXI.Container;
  readonly screenOverlay: PIXI.Container;
}

export interface LiveEntityCullBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface LiveEntityTickInput {
  readonly nowMs: number;
  readonly animationsEnabled: boolean;
  readonly golfers: readonly GolferRenderData[];
  readonly selectedGolferId?: number | null;
  readonly followSelected?: boolean;
  readonly cullBounds: LiveEntityCullBounds;
  readonly worldPointToScreen: (x: number, y: number, elevation?: number) => { x: number; y: number };
  readonly followCamera: (x: number, y: number) => void;
  readonly startleAtmosphere: (point: { x: number; y: number }, nowMs: number) => void;
  /** Preserves the legacy ordering: golfer retirement -> M51 mobility -> emotes. */
  readonly tickMobilityEntities: () => void;
}

export interface LiveEntityDiagnostics {
  readonly golfers: number;
  readonly bubbles: number;
  readonly ripples: number;
  readonly impacts: number;
}

export interface GolferGroundingDiagnostics {
  readonly golfer: Pick<GolferRenderData, "x" | "y" | "segKind" | "segT">;
  readonly sample: { x: number; y: number; elevation: number };
  readonly expected: { x: number; y: number; depth: number };
  readonly holder: { x: number; y: number; depth: number; visible: boolean };
  readonly feet: { x: number; y: number; anchorY: number } | null;
  readonly shadow: { label: string; x: number; y: number; alpha: number } | null;
  readonly sprite: { walkPhase: number; frame: string } | null;
  readonly poolCount: number;
  readonly activeEffects: number;
}

export interface LiveEntitiesSceneSystem extends RenderSceneSystem {
  readonly id: "liveEntities";
  tickEffects(nowMs: number, animationsEnabled: boolean): void;
  tickEntities(input: LiveEntityTickInput): void;
  diagnostics(): LiveEntityDiagnostics;
  golferGrounding(id: number, golfers: readonly GolferRenderData[]): GolferGroundingDiagnostics | null;
}

export interface LiveEntitiesSceneDependencies {
  readonly atlasReady?: () => boolean;
  readonly golferFrame?: (frame: string) => PIXI.Texture | undefined;
  readonly createContainer?: () => PIXI.Container;
  readonly createGraphics?: () => PIXI.Graphics;
  readonly createSprite?: () => PIXI.Sprite;
  readonly createText?: (options: PIXI.TextOptions) => PIXI.Text;
}

function buildEmoteBubble(
  kind: EmoteKind,
  dependencies: Required<Pick<LiveEntitiesSceneDependencies, "createContainer" | "createGraphics" | "createText">>,
): PIXI.Container {
  const container = dependencies.createContainer();
  const graphic = dependencies.createGraphics();
  graphic.circle(-5, -2, 1.6);
  graphic.fill({ color: 0xffffff, alpha: 0.95 });
  graphic.stroke({ width: 1, color: 0x4a4a40, alpha: 0.9 });
  graphic.circle(-8, -7, 2.4);
  graphic.fill({ color: 0xffffff, alpha: 0.95 });
  graphic.stroke({ width: 1, color: 0x4a4a40, alpha: 0.9 });
  graphic.roundRect(-16, -38, 32, 26, 9);
  graphic.fill({ color: 0xffffff, alpha: 0.96 });
  graphic.stroke({ width: 1.5, color: 0x4a4a40, alpha: 0.95 });
  container.addChild(graphic);

  const icon = dependencies.createGraphics();
  const centerY = -25;
  switch (kind) {
    case "star":
      icon.star(0, centerY, 5, 9, 4.2);
      icon.fill(0xe8c15a);
      icon.stroke({ width: 1, color: 0x8a6d2a });
      break;
    case "happy":
    case "angry": {
      icon.circle(0, centerY, 8);
      icon.fill(kind === "happy" ? 0xffd75e : 0xef8354);
      icon.stroke({ width: 1, color: 0x8a6d2a });
      icon.circle(-2.8, centerY - 2, 1.2);
      icon.circle(2.8, centerY - 2, 1.2);
      icon.fill(0x4a3b1e);
      if (kind === "happy") {
        const start = Math.PI * 0.15;
        icon.moveTo(4.2 * Math.cos(start), centerY + 0.5 + 4.2 * Math.sin(start));
        icon.arc(0, centerY + 0.5, 4.2, start, Math.PI * 0.85);
      } else {
        const start = Math.PI * 1.2;
        icon.moveTo(4.2 * Math.cos(start), centerY + 6 + 4.2 * Math.sin(start));
        icon.arc(0, centerY + 6, 4.2, start, Math.PI * 1.8);
      }
      icon.stroke({ width: 1.4, color: 0x4a3b1e });
      break;
    }
    case "storm":
      icon.circle(-4, centerY - 1, 4.4);
      icon.circle(1.5, centerY - 3, 5);
      icon.circle(5.5, centerY, 3.6);
      icon.fill(0x6b7280);
      icon.stroke({ width: 1, color: 0x3f4650 });
      icon.poly([1.5, centerY + 2, -1.5, centerY + 7, 0.5, centerY + 7, -1.5, centerY + 12, 3.5, centerY + 6, 1.5, centerY + 6, 3.5, centerY + 2]);
      icon.fill(0xffd75e);
      break;
    default: {
      const text = dependencies.createText({
        text: kind === "zzz" ? "Zz" : kind === "alert" ? "!" : "$",
        style: {
          fontFamily: "Arial, sans-serif",
          fontWeight: "900",
          fontSize: kind === "zzz" ? 13 : 16,
          fill: kind === "cashGood" ? 0x2f8a4a : kind === "cashBad" || kind === "alert" ? 0xc0392b : 0x4a5568,
        },
      });
      text.anchor.set(0.5);
      text.position.set(0, centerY);
      container.addChild(text);
      break;
    }
  }
  container.addChild(icon);
  return container;
}

/** Owns the live golfer, ball, emote, and bounded transient Pixi resources. */
export function createLiveEntitiesSceneSystem(
  layers: LiveEntityLayers,
  dependencies: LiveEntitiesSceneDependencies = {},
): LiveEntitiesSceneSystem {
  const atlasReady = dependencies.atlasReady ?? golfersAtlasReady;
  const golferFrame = dependencies.golferFrame ?? getGolferFrame;
  const createContainer = dependencies.createContainer ?? (() => new PIXI.Container());
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  const createSprite = dependencies.createSprite ?? (() => new PIXI.Sprite());
  const createText = dependencies.createText ?? ((options) => new PIXI.Text(options));
  const bubbleDependencies = { createContainer, createGraphics, createText };

  let authority: LiveEntityAuthority | null = null;
  const pool = new Map<number, GolferEntry>();
  const bubbles = new Map<number, PIXI.Container>();
  let scheduler = createEmoteScheduler();
  let simMovingAt = 0;
  let ripples: Array<{ x: number; y: number; t0: number }> = [];
  let impacts: Array<{ kind: "sand" | "grass" | "check"; x: number; y: number; e: number; t0: number }> = [];
  let effectGraphics: PIXI.Graphics | null = null;

  const cacheAuthority = (snapshot: RenderSnapshot) => {
    authority = {
      course: snapshot.course,
      effectiveTiles: snapshot.effectiveTiles,
      rotation: snapshot.rotation,
      surfaceHeightAt: snapshot.surfaceHeightAt,
    };
  };

  const destroyEntry = (id: number, entry: GolferEntry, recordDeparture: boolean) => {
    entry.holder.parent?.removeChild(entry.holder);
    entry.ball.parent?.removeChild(entry.ball);
    entry.ballShadow.parent?.removeChild(entry.ballShadow);
    entry.holder.destroy({ children: true });
    entry.ball.destroy();
    entry.ballShadow.destroy();
    pool.delete(id);
    if (recordDeparture) forgetGolfer(id);
  };

  const clear = () => {
    for (const [id, entry] of pool) destroyEntry(id, entry, false);
    for (const container of bubbles.values()) {
      container.parent?.removeChild(container);
      container.destroy({ children: true });
    }
    bubbles.clear();
    effectGraphics?.parent?.removeChild(effectGraphics);
    effectGraphics?.destroy();
    effectGraphics = null;
    scheduler = createEmoteScheduler();
    simMovingAt = 0;
    ripples = [];
    impacts = [];
    authority = null;
  };

  const ensureEffects = () => {
    if (effectGraphics) return effectGraphics;
    effectGraphics = createGraphics();
    layers.fx.addChild(effectGraphics);
    return effectGraphics;
  };

  const tickEffects = (nowMs: number, animationsEnabled: boolean) => {
    if (!authority) return;
    const { rotation } = authority;
    const graphic = ensureEffects();
    graphic.clear();
    if (ripples.length > 0) {
      ripples = ripples.filter((ripple) => nowMs - ripple.t0 < 750);
      for (const ripple of ripples) {
        const progress = animationsEnabled ? (nowMs - ripple.t0) / 750 : 0.45;
        const center = tileCenterIso(ripple.x, ripple.y, 0, rotation);
        const radius = 4 + progress * 12;
        graphic.ellipse(center.x, center.y, radius, radius / 2);
        graphic.stroke({ width: 1.5 * (1 - progress) + 0.5, color: 0xe9f4ff, alpha: 0.8 * (1 - progress) });
        if (progress < 0.3) {
          graphic.circle(center.x, center.y - 2, 2.5 * (1 - progress / 0.3));
          graphic.fill({ color: 0xffffff, alpha: 0.7 });
        }
      }
    }
    if (impacts.length > 0) {
      impacts = impacts.filter((impact) => nowMs - impact.t0 < 600);
      for (const impact of impacts) {
        const progress = (nowMs - impact.t0) / 600;
        const center = tileCenterIso(impact.x, impact.y, impact.e, rotation);
        const fade = 1 - progress;
        if (impact.kind === "sand") {
          for (let index = 0; index < 6; index++) {
            const angle = (index / 6) * Math.PI * 2 + 0.5;
            const radius = 2 + progress * 9;
            graphic.circle(center.x + Math.cos(angle) * radius, center.y - 2 - progress * 7 + Math.sin(angle) * radius * 0.4, 1.6 * fade + 0.4);
            graphic.fill({ color: 0xd7c48a, alpha: 0.85 * fade });
          }
        } else if (impact.kind === "grass") {
          for (let index = 0; index < 4; index++) {
            const angle = (index / 4) * Math.PI * 2 + 1.1;
            const radius = 1.5 + progress * 6;
            graphic.circle(center.x + Math.cos(angle) * radius, center.y - 1 - progress * 5 + Math.sin(angle) * radius * 0.4, 1.1 * fade + 0.3);
            graphic.fill({ color: 0x3e8a44, alpha: 0.8 * fade });
          }
        } else {
          graphic.ellipse(center.x, center.y - 1, 3.5 * fade + 1, 1.4 * fade + 0.4);
          graphic.stroke({ width: 1, color: 0xffffff, alpha: 0.8 * fade });
        }
      }
    }
  };

  const tickEntities = (input: LiveEntityTickInput) => {
    if (!authority) return;
    const { course, effectiveTiles, rotation, surfaceHeightAt } = authority;
    const {
      nowMs,
      animationsEnabled,
      golfers,
      selectedGolferId,
      followSelected,
      cullBounds,
      worldPointToScreen,
      followCamera,
      startleAtmosphere,
      tickMobilityEntities,
    } = input;
    const seen = new Set<number>();
    const golferById = new Map<number, GolferRenderData>();
    for (const golfer of golfers) {
      seen.add(golfer.id);
      let entry = pool.get(golfer.id);
      if (!entry) {
        const holder = createContainer();
        const ball = createGraphics();
        ball.circle(0, -2, 2.2);
        ball.fill(0xffffff);
        ball.stroke({ width: 0.8, color: 0x555555 });
        ball.visible = false;
        const ballShadow = createGraphics();
        ballShadow.ellipse(0, 0, 3.2, 1.5);
        ballShadow.fill({ color: 0x000000, alpha: 0.4 });
        ballShadow.visible = false;
        layers.terrainDecals.addChild(ballShadow);
        layers.objects.addChild(holder, ball);
        entry = {
          holder,
          ball,
          ballShadow,
          lastBall: null,
          prevBallIso: null,
          ballLanded: false,
          emote: {
            lastScored: golfer.scoredHoles,
            prevMood: golfer.mood,
            feeChecked: false,
            lastPos: { x: golfer.x, y: golfer.y },
            stillSinceMs: nowMs,
          },
          sprite: null,
          dot: null,
        };
        if (atlasReady()) {
          const shadow = createGraphics();
          shadow.label = "golfer-contact-shadow";
          shadow.position.set(GOLFER_CONTACT_SHADOW.x, GOLFER_CONTACT_SHADOW.y);
          shadow.ellipse(0, 0, GOLFER_CONTACT_SHADOW.radiusX, GOLFER_CONTACT_SHADOW.radiusY);
          shadow.fill({ color: 0x000000, alpha: GOLFER_CONTACT_SHADOW.alpha });
          const ring = createGraphics();
          ring.visible = false;
          const scale = GOLFER_DISPLAY_W / GOLFER_FRAME_W;
          const base = createSprite();
          base.anchor.set(0.5, GOLFER_FEET_Y / GOLFER_FRAME_H);
          base.scale.set(scale);
          const tintLayer = createSprite();
          tintLayer.anchor.set(0.5, GOLFER_FEET_Y / GOLFER_FRAME_H);
          tintLayer.scale.set(scale);
          tintLayer.tint = golferTint(golfer.color, golfer.id);
          holder.addChild(shadow, ring, base, tintLayer);
          entry.sprite = {
            shadow,
            ring,
            base,
            tintLayer,
            variant: golferVariant(golfer.archetype, golfer.id),
            tint: tintLayer.tint,
            lastFrame: "",
            walkPhase: 0,
            lastPos: null,
            dirX: golfer.dirX,
            dirY: golfer.dirY,
            reaction: null,
            reactionUntil: 0,
            lastScored: golfer.scoredHoles,
          };
        } else {
          const body = createGraphics();
          holder.addChild(body);
          entry.dot = { body, lastColor: "", lastMoodBucket: -1 };
        }
        pool.set(golfer.id, entry);
      }
      golferById.set(golfer.id, golfer);

      const emote = entry.emote;
      const selected = selectedGolferId === golfer.id;
      const showEmote = (kind: EmoteKind | null) => {
        if (kind && tryShowEmote(scheduler, golfer.id, kind, nowMs, selected)) {
          recordEmote(golfer.id, kind, nowMs);
        }
      };
      if (Math.hypot(golfer.x - emote.lastPos.x, golfer.y - emote.lastPos.y) > 1e-4) {
        emote.lastPos = { x: golfer.x, y: golfer.y };
        emote.stillSinceMs = nowMs;
        simMovingAt = nowMs;
      }
      if (golfer.scoredHoles > emote.lastScored) {
        emote.lastScored = golfer.scoredHoles;
        showEmote(holeOutEmote(golfer.lastHoleDelta));
      }
      showEmote(moodEmote(emote.prevMood, golfer.mood));
      emote.prevMood = golfer.mood;
      if (!emote.feeChecked) {
        emote.feeChecked = true;
        if (golfer.scoredHoles === 0) showEmote(feeEmote(course.baseGreenFee, golfer.id));
      }
      if (
        golfer.segKind !== "flight"
        && !golfer.shot
        && nowMs - emote.stillSinceMs > EMOTE_STALL_MS
        && nowMs - simMovingAt < 400
      ) {
        emote.stillSinceMs = nowMs;
        showEmote("zzz");
      }

      const grounded = groundedGolferFrame(golfer.x, golfer.y, rotation, surfaceHeightAt);
      const center = grounded.screen;
      entry.holder.position.set(center.x, center.y);
      const offscreen = center.x < cullBounds.left || center.x > cullBounds.right || center.y < cullBounds.top || center.y > cullBounds.bottom;
      entry.holder.visible = !offscreen;
      if (!offscreen && entry.holder.zIndex !== grounded.depth) entry.holder.zIndex = grounded.depth;

      if (!offscreen && entry.sprite) {
        const sprite = entry.sprite;
        if (golfer.scoredHoles > sprite.lastScored) {
          sprite.lastScored = golfer.scoredHoles;
          const reaction = reactionFor(golfer.lastHoleDelta);
          if (reaction) {
            sprite.reaction = reaction;
            sprite.reactionUntil = nowMs + REACTION_SEC * 1000;
          }
        }
        if (sprite.reaction && nowMs >= sprite.reactionUntil) sprite.reaction = null;
        sprite.walkPhase = advanceGroundedWalkPhase(
          sprite.walkPhase,
          sprite.lastPos,
          golfer,
          golfer.segKind,
          WALK_STRIDES_PER_TILE,
        );
        sprite.lastPos = { x: golfer.x, y: golfer.y };
        if (golfer.dirX !== 0 || golfer.dirY !== 0) {
          sprite.dirX = golfer.dirX;
          sprite.dirY = golfer.dirY;
        }
        const pose = golferPose({
          segKind: golfer.segKind,
          segT: golfer.segT,
          shot: golfer.shot,
          facingOct: facingOctant(sprite.dirX, sprite.dirY, rotation),
          walkPhase: animationsEnabled ? sprite.walkPhase : 0,
          timeSec: animationsEnabled ? nowMs / 1000 : 0,
          reaction: sprite.reaction,
        });
        const frame = golferFrameName(sprite.variant, pose, false);
        if (frame !== sprite.lastFrame) {
          sprite.lastFrame = frame;
          const baseTexture = golferFrame(frame);
          const tintTexture = golferFrame(golferFrameName(sprite.variant, pose, true));
          if (baseTexture) sprite.base.texture = baseTexture;
          if (tintTexture) sprite.tintLayer.texture = tintTexture;
        }
        const flip = pose.mirror ? -1 : 1;
        if (Math.sign(sprite.base.scale.x) !== flip) {
          sprite.base.scale.x = Math.abs(sprite.base.scale.x) * flip;
          sprite.tintLayer.scale.x = Math.abs(sprite.tintLayer.scale.x) * flip;
        }
        if (selected) {
          const pulse = animationsEnabled ? 1 + Math.sin(nowMs * 0.006) * 0.12 : 1;
          sprite.ring.clear();
          sprite.ring.ellipse(0, 0, 11 * pulse, 5.5 * pulse);
          sprite.ring.stroke({ width: 1.8, color: 0xffffff, alpha: 0.95 });
          sprite.ring.visible = true;
        } else if (sprite.ring.visible) sprite.ring.visible = false;
      } else if (!offscreen && entry.dot) {
        const dot = entry.dot;
        const moodBucket = Math.round(Math.max(0, Math.min(1, golfer.mood)) * 10);
        if (dot.lastColor !== golfer.color || dot.lastMoodBucket !== moodBucket) {
          dot.lastColor = golfer.color;
          dot.lastMoodBucket = moodBucket;
          dot.body.clear();
          dot.body.ellipse(0, 0, 7, 3.2);
          dot.body.fill({ color: 0x000000, alpha: 0.2 });
          dot.body.circle(0, -7, 5.5);
          dot.body.fill(golfer.color);
          dot.body.stroke({ width: 1.5, color: `hsl(${moodBucket * 12}, 80%, 45%)` });
        }
      }

      if (golfer.ballX != null && golfer.ballY != null) {
        const from = { x: golfer.x, y: golfer.y };
        const to = golfer.ballToX != null && golfer.ballToY != null
          ? { x: golfer.ballToX, y: golfer.ballToY }
          : { x: golfer.ballX, y: golfer.ballY };
        const distanceTiles = Math.hypot(to.x - from.x, to.y - from.y);
        const impact = golfer.ballLandingX != null && golfer.ballLandingY != null
          ? { x: golfer.ballLandingX, y: golfer.ballLandingY }
          : to;
        const restX = Math.floor(impact.x + 0.5);
        const restY = Math.floor(impact.y + 0.5);
        const restTerrain = restX >= 0 && restY >= 0 && restX < course.width && restY < course.height
          ? effectiveTiles[restY * course.width + restX]
          : null;
        const behavior = landingBehavior(restTerrain);
        const shot = golfer.shot ?? "swing";
        let x = golfer.ballX;
        let y = golfer.ballY;
        let heightPx = 0;
        let shadowScale = 1;
        let hidden = false;
        if (animationsEnabled && golfer.segKind === "flight") {
          const pose = ballFlightPose(golfer.segT, distanceTiles, shot, behavior);
          if (!golfer.ballUsesResolvedRollout) {
            x = from.x + (to.x - from.x) * pose.groundFrac;
            y = from.y + (to.y - from.y) * pose.groundFrac;
          }
          heightPx = pose.heightPx;
          shadowScale = pose.shadow;
          hidden = pose.hidden;
          const landed = golfer.ballUsesResolvedRollout
            ? golfer.segT >= (golfer.ballRolloutStartT ?? (shot === "putt" ? 0 : 0.72))
            : pose.landed;
          if (landed && !entry.ballLanded) {
            entry.ballLanded = true;
            if (behavior.fx === "splash") {
              appendBoundedEffect(ripples, { x: impact.x, y: impact.y, t0: nowMs }, MAX_ACTIVE_RIPPLES);
            } else if (behavior.fx) {
              appendBoundedEffect(impacts, { kind: behavior.fx, x, y, e: surfaceHeightAt(x + 0.5, y + 0.5), t0: nowMs }, MAX_ACTIVE_IMPACTS);
            }
            showEmote(hazardEmote(behavior.fx));
            startleAtmosphere(impact, nowMs);
          }
        }
        const elevation = surfaceHeightAt(x + 0.5, y + 0.5);
        const ground = tileCenterIso(x, y, elevation, rotation);
        entry.ball.position.set(ground.x, ground.y - heightPx);
        const depth = Math.round(entityDepth(x, y, elevation, rotation) * 10) / 10;
        if (entry.ball.zIndex !== depth) entry.ball.zIndex = depth;
        entry.ball.visible = !hidden;
        entry.ballShadow.position.set(ground.x, ground.y);
        entry.ballShadow.scale.set(0.55 + 0.45 * shadowScale);
        entry.ballShadow.alpha = 0.45 + 0.55 * shadowScale;
        entry.ballShadow.visible = !hidden && heightPx >= 0 && shadowScale > 0;
        if (animationsEnabled && heightPx > 2 && entry.prevBallIso && effectGraphics) {
          effectGraphics.moveTo(entry.prevBallIso.x, entry.prevBallIso.y);
          effectGraphics.lineTo(ground.x, ground.y - heightPx);
          effectGraphics.stroke({ width: 1.2, color: 0xffffff, alpha: 0.3 });
        }
        entry.prevBallIso = heightPx > 2 ? { x: ground.x, y: ground.y - heightPx } : null;
        entry.lastBall = { x: golfer.ballX, y: golfer.ballY };
      } else {
        if (entry.lastBall) {
          if (!animationsEnabled) {
            const x = Math.floor(entry.lastBall.x + 0.5);
            const y = Math.floor(entry.lastBall.y + 0.5);
            if (
              x >= 0 && y >= 0 && x < course.width && y < course.height
              && (effectiveTiles[y * course.width + x] === "water" || effectiveTiles[y * course.width + x] === "wetland")
            ) appendBoundedEffect(ripples, { x: entry.lastBall.x, y: entry.lastBall.y, t0: performance.now() }, MAX_ACTIVE_RIPPLES);
          }
          entry.lastBall = null;
        }
        entry.ballLanded = false;
        entry.prevBallIso = null;
        entry.ball.visible = false;
        entry.ballShadow.visible = false;
      }
      if (followSelected && selectedGolferId === golfer.id) {
        followCamera(
          golfer.segKind === "flight" && golfer.ballX != null ? golfer.ballX : golfer.x,
          golfer.segKind === "flight" && golfer.ballY != null ? golfer.ballY : golfer.y,
        );
      }
    }

    for (const [id, entry] of pool) if (!seen.has(id)) destroyEntry(id, entry, true);
    tickMobilityEntities();

    pruneEmotes(scheduler, nowMs, seen);
    for (const [id, container] of bubbles) {
      if (!scheduler.active.some((emote) => emote.golferId === id)) {
        container.parent?.removeChild(container);
        container.destroy({ children: true });
        bubbles.delete(id);
      }
    }
    if (scheduler.active.length > 0) {
      const anchors = scheduler.active.map((emote) => {
        const golfer = golferById.get(emote.golferId);
        if (!golfer) return { x: -9999, y: -9999 };
        const elevation = surfaceHeightAt(golfer.x + 0.5, golfer.y + 0.5);
        const point = worldPointToScreen(golfer.x + 0.5, golfer.y + 0.5, elevation);
        return { x: point.x, y: point.y - Math.max(16, Math.min(64, 42 * layers.objects.parent!.scale.x)) };
      });
      const offsets = resolveOverlaps(anchors);
      for (let index = 0; index < scheduler.active.length; index++) {
        const emote = scheduler.active[index];
        let container = bubbles.get(emote.golferId);
        if (!container) {
          container = buildEmoteBubble(emote.kind, bubbleDependencies);
          layers.screenOverlay.addChild(container);
          bubbles.set(emote.golferId, container);
        }
        const presentation = animationsEnabled ? emotePresentation(nowMs - emote.t0) : { scale: 1, alpha: 1, rise: 0 };
        container.position.set(anchors[index].x + offsets[index], anchors[index].y - presentation.rise);
        container.scale.set(presentation.scale);
        container.alpha = presentation.alpha;
        container.visible = anchors[index].x > -9000;
      }
    }
  };

  return {
    id: "liveEntities",
    create: cacheAuthority,
    update: cacheAuthority,
    destroy: clear,
    tickEffects,
    tickEntities,
    diagnostics: () => ({
      golfers: pool.size,
      bubbles: bubbles.size,
      ripples: ripples.length,
      impacts: impacts.length,
    }),
    golferGrounding: (id, golfers) => {
      if (!authority) return null;
      const golfer = golfers.find((candidate) => candidate.id === id);
      const entry = pool.get(id);
      if (!golfer || !entry) return null;
      const frame = groundedGolferFrame(golfer.x, golfer.y, authority.rotation, authority.surfaceHeightAt);
      return {
        golfer: { x: golfer.x, y: golfer.y, segKind: golfer.segKind, segT: golfer.segT },
        sample: { x: golfer.x + 0.5, y: golfer.y + 0.5, elevation: frame.elevation },
        expected: { x: frame.screen.x, y: frame.screen.y, depth: frame.depth },
        holder: { x: entry.holder.position.x, y: entry.holder.position.y, depth: entry.holder.zIndex, visible: entry.holder.visible },
        feet: entry.sprite ? { x: entry.sprite.base.position.x, y: entry.sprite.base.position.y, anchorY: entry.sprite.base.anchor.y } : null,
        shadow: entry.sprite ? { label: entry.sprite.shadow.label, x: entry.sprite.shadow.position.x, y: entry.sprite.shadow.position.y, alpha: entry.sprite.shadow.alpha } : null,
        sprite: entry.sprite ? { walkPhase: entry.sprite.walkPhase, frame: entry.sprite.lastFrame } : null,
        poolCount: pool.size,
        activeEffects: impacts.length + ripples.length,
      };
    },
  };
}
