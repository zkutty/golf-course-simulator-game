import { destroySceneSubtree } from "../../../game/render/destroySceneSubtree";
import * as PIXI from "pixi.js";
import {
  HERON_STARTLE_TILES,
  heronSpot,
  timeOfDayTint,
} from "../../../game/render/ambient";
import { entityDepth } from "../../../game/render/objectPlacement";
import { tileCenterIso, worldToIso } from "../../../game/render/iso";
import type { Point } from "../../../game/models/types";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";
import type { OwnedShimmer } from "../resourceSnapshot";
import { createSeasonalTerrainSceneSystem } from "./seasonalTerrainScene";

export interface AtmosphereFrameInput {
  readonly dtMs: number;
  readonly nowMs: number;
  readonly dayMinute?: number;
  readonly ambienceFx: boolean;
}

export interface AtmosphereSceneSystem extends RenderSceneSystem {
  readonly id: "atmosphere";
  tick(input: AtmosphereFrameInput): void;
  startleAt(point: Point, nowMs: number): void;
  objectCount(): number;
  readOwnedShimmerForTest(): OwnedShimmer | null;
}

export interface AtmosphereSceneLayers {
  readonly stage: PIXI.Container;
  readonly world: PIXI.Container;
  readonly seasonalTerrain: PIXI.Container;
  readonly objects: PIXI.Container;
  readonly fx: PIXI.Container;
  readonly screenOverlay: PIXI.Container;
  readonly screen: () => Readonly<{ width: number; height: number }>;
}

interface HeronState {
  graphics: PIXI.Graphics | null;
  spot: Point | null;
  forCourse: RenderSnapshot["course"] | null;
  state: "standing" | "flying" | "gone";
  flyT0: number;
  respawnAt: number;
}

function drawHeron(graphics: PIXI.Graphics, flying: boolean): void {
  graphics.clear();
  const body = 0x8a99a8;
  const dark = 0x5a6672;
  if (!flying) {
    graphics.moveTo(-1.5, 0);
    graphics.lineTo(-1.5, -7);
    graphics.moveTo(1.5, 0);
    graphics.lineTo(1.8, -7);
    graphics.stroke({ width: 1, color: dark });
  }
  graphics.ellipse(0, -10, 4.4, 2.8);
  graphics.fill(body);
  graphics.stroke({ width: 1, color: dark });
  if (flying) {
    graphics.moveTo(-2, -11);
    graphics.quadraticCurveTo(-9, -16, -12, -13);
    graphics.moveTo(2, -11);
    graphics.quadraticCurveTo(9, -17, 12, -14);
    graphics.stroke({ width: 1.6, color: dark });
  }
  graphics.moveTo(2.5, -11.5);
  graphics.quadraticCurveTo(4.5, -14, 4, -17);
  graphics.stroke({ width: 1.4, color: body });
  graphics.circle(4, -17.5, 1.7);
  graphics.fill(body);
  graphics.stroke({ width: .8, color: dark });
  graphics.moveTo(5.5, -17.5);
  graphics.lineTo(8.5, -16.8);
  graphics.stroke({ width: 1, color: 0xe8c15a });
}

function removeAndDestroy(displayObject: PIXI.Container | PIXI.Sprite | PIXI.Graphics | null): void {
  if (!displayObject || displayObject.destroyed) return;
  displayObject.parent?.removeChild(displayObject);
  destroySceneSubtree(displayObject);
}

/**
 * Owns the complete season/weather/ambient presentation seam while retaining
 * the existing Pixi application, projection, layer order, and pure ambient
 * math. Static seasonal decals update only through the declared scene
 * revision; cosmetic motion advances through `tick` without React rebuilds.
 */
export function createAtmosphereSceneSystem(
  layers: AtmosphereSceneLayers,
): AtmosphereSceneSystem {
  const seasonalTerrain = createSeasonalTerrainSceneSystem(layers.seasonalTerrain);
  let snapshot: RenderSnapshot | null = null;
  let created = false;
  let blobTexture: PIXI.Texture | null = null;
  let ownsBlobTexture = false;
  let originalShimmerSource: WeakRef<PIXI.TextureSource> | null = null;
  let tintQuad: PIXI.Sprite | null = null;
  let shimmer: PIXI.Sprite | null = null;
  const heron: HeronState = {
    graphics: null,
    spot: null,
    forCourse: null,
    state: "standing",
    flyT0: 0,
    respawnAt: 0,
  };
  const tintCurrent = { r: 255, g: 255, b: 255 };

  const destroy = () => {
    if (!layers.seasonalTerrain.destroyed) {
      layers.seasonalTerrain.removeChildren().forEach(destroySceneSubtree);
    }
    removeAndDestroy(shimmer);
    removeAndDestroy(tintQuad);
    removeAndDestroy(heron.graphics);
    shimmer = null;
    tintQuad = null;
    heron.graphics = null;
    heron.spot = null;
    heron.forCourse = null;
    heron.state = "standing";
    if (ownsBlobTexture && blobTexture && !blobTexture.destroyed) blobTexture.destroy(true);
    blobTexture = null;
    ownsBlobTexture = false;
    originalShimmerSource = null;
    tintCurrent.r = 255;
    tintCurrent.g = 255;
    tintCurrent.b = 255;
    snapshot = null;
    created = false;
  };

  const createOwnedObjects = () => {
    tintQuad = new PIXI.Sprite(PIXI.Texture.WHITE);
    tintQuad.blendMode = "multiply";
    tintQuad.visible = false;

    const overlayIndex = layers.stage.getChildIndex(layers.screenOverlay);
    layers.stage.addChildAt(tintQuad, overlayIndex);

    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (context) {
        const gradient = context.createRadialGradient(128, 128, 20, 128, 128, 126);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(.65, "rgba(255,255,255,.55)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 256, 256);
        blobTexture = PIXI.Texture.from(canvas);
        ownsBlobTexture = true;
        if ((import.meta.env.MODE === "e2e" || import.meta.env.MODE === "test") && typeof WeakRef === "function") {
          originalShimmerSource = new WeakRef(blobTexture.source);
        }
      }
    }
    blobTexture ??= PIXI.Texture.WHITE;

    shimmer = new PIXI.Sprite(blobTexture);
    shimmer.anchor.set(.5);
    shimmer.blendMode = "add";
    shimmer.tint = 0xfffbe8;
    shimmer.alpha = .05;
    shimmer.scale.set(7, 2.2);
    shimmer.visible = false;
    layers.fx.addChild(shimmer);

    heron.graphics = new PIXI.Graphics();
    heron.graphics.visible = false;
    layers.objects.addChild(heron.graphics);
  };

  const renderSeason = (next: RenderSnapshot) => {
    seasonalTerrain.render?.(next);
    snapshot = next;
  };

  return {
    id: "atmosphere",
    create(next) {
      if (created) throw new Error("Atmosphere scene was created twice without teardown");
      try {
        createOwnedObjects();
        renderSeason(next);
        created = true;
      } catch (error) {
        destroy();
        throw error;
      }
    },
    update(next) {
      if (!created) throw new Error("Atmosphere scene update requires create");
      renderSeason(next);
    },
    destroy,
    tick(input) {
      if (!created || !snapshot) return;
      const ambientOn = input.ambienceFx && snapshot.animationsEnabled;
      const dayMinute = input.dayMinute;

      if (tintQuad) {
        const target = ambientOn ? timeOfDayTint(dayMinute ?? 420) : 0xffffff;
        const blend = 1 - Math.exp(-input.dtMs / 600);
        tintCurrent.r += (((target >> 16) & 0xff) - tintCurrent.r) * blend;
        tintCurrent.g += (((target >> 8) & 0xff) - tintCurrent.g) * blend;
        tintCurrent.b += ((target & 0xff) - tintCurrent.b) * blend;
        const tint = (Math.round(tintCurrent.r) << 16)
          | (Math.round(tintCurrent.g) << 8)
          | Math.round(tintCurrent.b);
        tintQuad.tint = tint;
        tintQuad.visible = tint !== 0xffffff;
        if (tintQuad.visible) {
          const screen = layers.screen();
          tintQuad.width = screen.width;
          tintQuad.height = screen.height;
        }
      }

      if (shimmer) {
        const span = (snapshot.course.width + snapshot.course.height) * 1.6;
        const sweep = ((input.nowMs / 1000) * 1.1 * 2.2) % span;
        const x = sweep - 20;
        shimmer.visible = ambientOn && x > -12 && x < snapshot.course.width + 12;
        if (shimmer.visible) {
          const iso = worldToIso(x, snapshot.course.height / 2, 0, snapshot.rotation);
          shimmer.position.set(iso.x, iso.y);
        }
      }

      if (heron.graphics) {
        if (heron.forCourse !== snapshot.course) {
          heron.forCourse = snapshot.course;
          heron.spot = heronSpot(snapshot.course);
          heron.state = "standing";
          drawHeron(heron.graphics, false);
        }
        if (!ambientOn || !heron.spot) {
          heron.graphics.visible = false;
        } else if (heron.state === "standing") {
          const elevation = snapshot.surfaceHeightAt(heron.spot.x + .5, heron.spot.y + .5);
          const iso = tileCenterIso(heron.spot.x, heron.spot.y, elevation, snapshot.rotation);
          heron.graphics.position.set(iso.x, iso.y + Math.sin(input.nowMs / 1100) * .4);
          heron.graphics.zIndex = entityDepth(heron.spot.x, heron.spot.y, elevation, snapshot.rotation);
          heron.graphics.alpha = 1;
          heron.graphics.visible = true;
        } else if (heron.state === "flying") {
          const progress = (input.nowMs - heron.flyT0) / 1400;
          if (progress >= 1) {
            heron.state = "gone";
            heron.respawnAt = input.nowMs + 45_000;
            heron.graphics.visible = false;
          } else {
            const elevation = snapshot.surfaceHeightAt(heron.spot.x + .5, heron.spot.y + .5);
            const iso = tileCenterIso(heron.spot.x, heron.spot.y, elevation, snapshot.rotation);
            heron.graphics.position.set(iso.x + progress * 90, iso.y - progress * 70);
            heron.graphics.alpha = 1 - progress * progress;
            heron.graphics.visible = true;
          }
        } else if (input.nowMs > heron.respawnAt) {
          heron.state = "standing";
          drawHeron(heron.graphics, false);
        }
      }
    },
    startleAt(point, nowMs) {
      if (
        heron.state === "standing"
        && heron.spot
        && heron.graphics
        && Math.hypot(point.x - heron.spot.x, point.y - heron.spot.y) < HERON_STARTLE_TILES
      ) {
        heron.state = "flying";
        heron.flyT0 = nowMs;
        drawHeron(heron.graphics, true);
      }
    },
    objectCount() {
      return (shimmer ? 1 : 0) + (heron.graphics ? 1 : 0);
    },
    readOwnedShimmerForTest() {
      const source = originalShimmerSource?.deref();
      if (!created || !ownsBlobTexture || !shimmer || !blobTexture || !source
        || shimmer.destroyed || blobTexture.destroyed || source.destroyed
        || source === PIXI.Texture.WHITE.source || source === PIXI.Texture.EMPTY.source
        || shimmer.parent !== layers.fx || shimmer.texture !== blobTexture || blobTexture.source !== source) return null;
      return { stage: layers.stage, world: layers.world, layer: layers.fx, sprite: shimmer, texture: blobTexture, source };
    },
  };
}
