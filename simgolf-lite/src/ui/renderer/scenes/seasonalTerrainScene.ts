import * as PIXI from "pixi.js";
import { getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS } from "../../../game/models/courseSetup";
import { seasonalTerrainDecals } from "../../../game/render/seasonalTerrainPresentation";
import { worldToIso } from "../../../game/render/iso";
import type { RenderSceneSystem } from "../SceneSystemHost";

export function createSeasonalTerrainSceneSystem(
  layer: PIXI.Container,
): RenderSceneSystem {
  return {
    // Compatibility helper now composed by the atmosphere owner.
    id: "atmosphere",
    render(snapshot) {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
      const state = snapshot.seasonalVisualState;
      if (!state) return;

      const protectedCells = new Set<number>();
      const protect = (point: { x: number; y: number } | null | undefined) => {
        if (!point) return;
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        if (x >= 0 && y >= 0 && x < snapshot.course.width && y < snapshot.course.height) {
          protectedCells.add(y * snapshot.course.width + x);
        }
      };
      for (const hole of snapshot.holes) {
        for (const teeSet of TEE_SETS) protect(getTeeBox(hole, teeSet));
        for (const pinRotation of PIN_ROTATIONS) protect(getPinPosition(hole, pinRotation));
      }
      protect(snapshot.draftTee);
      protect(snapshot.draftGreen);

      const decals = seasonalTerrainDecals({
        state,
        tiles: snapshot.effectiveTiles,
        width: snapshot.course.width,
        height: snapshot.course.height,
        quality: snapshot.graphicsQuality,
        colorVision: snapshot.colorVision,
        seed: snapshot.worldSeed,
        reducedMotion: snapshot.reducedMotion,
        protectedCells,
      });
      if (decals.length === 0) return;

      const graphics = new PIXI.Graphics();
      graphics.eventMode = "none";
      for (const decal of decals) {
        const point = worldToIso(
          decal.x,
          decal.y,
          snapshot.surfaceHeightAt(decal.x, decal.y),
          snapshot.rotation,
        );
        const scale = decal.scale;
        const dx = Math.cos(decal.rotation);
        const dy = Math.sin(decal.rotation);
        if (decal.cue === "puddle") {
          graphics.ellipse(point.x, point.y, 6.5 * scale, 2.2 * scale);
          graphics.fill({ color: decal.color, alpha: decal.alpha * .55 });
          graphics.stroke({ width: 1, color: 0xe5f3f4, alpha: decal.alpha * .75 });
        } else if (decal.cue === "drought-crack") {
          graphics.moveTo(point.x - dx * 5 * scale, point.y - dy * 2.2 * scale);
          graphics.lineTo(point.x, point.y);
          graphics.lineTo(point.x + dx * 4 * scale, point.y + dy * 2 * scale);
          graphics.moveTo(point.x, point.y);
          graphics.lineTo(point.x - dy * 3 * scale, point.y + dx * 1.5 * scale);
          graphics.stroke({ width: 1.15, color: decal.color, alpha: decal.alpha });
        } else if (decal.cue === "frost-crystal") {
          graphics.moveTo(point.x - 4 * scale, point.y);
          graphics.lineTo(point.x + 4 * scale, point.y);
          graphics.moveTo(point.x, point.y - 2.2 * scale);
          graphics.lineTo(point.x, point.y + 2.2 * scale);
          graphics.stroke({ width: 1, color: decal.color, alpha: decal.alpha });
        } else if (decal.cue === "partial-snow") {
          graphics.ellipse(point.x, point.y, 7.5 * scale, 2.8 * scale);
          graphics.fill({ color: decal.color, alpha: Math.min(.34, decal.alpha) });
          graphics.moveTo(point.x - 4 * scale, point.y);
          graphics.lineTo(point.x + 3 * scale, point.y - .7 * scale);
          graphics.stroke({ width: .8, color: 0xb9c8cc, alpha: decal.alpha * .62 });
        } else if (decal.cue === "leaf-litter") {
          graphics.ellipse(point.x - 2.4 * scale, point.y, 2.1 * scale, .85 * scale);
          graphics.ellipse(point.x + 2.1 * scale, point.y + 1.1 * scale, 1.8 * scale, .75 * scale);
          graphics.fill({ color: decal.color, alpha: decal.alpha });
        } else if (decal.cue === "recovery-sprout") {
          graphics.moveTo(point.x, point.y + 2 * scale);
          graphics.lineTo(point.x, point.y - 2.8 * scale);
          graphics.moveTo(point.x, point.y - .5 * scale);
          graphics.lineTo(point.x - 2.2 * scale, point.y - 1.7 * scale);
          graphics.moveTo(point.x, point.y - 1.4 * scale);
          graphics.lineTo(point.x + 2.1 * scale, point.y - 2.4 * scale);
          graphics.stroke({ width: 1.2, color: decal.color, alpha: decal.alpha });
        } else {
          graphics.moveTo(point.x - 6 * scale, point.y);
          graphics.bezierCurveTo(
            point.x - 2 * scale,
            point.y - 1.7 * scale,
            point.x + 2 * scale,
            point.y + 1.7 * scale,
            point.x + 6 * scale,
            point.y,
          );
          graphics.stroke({ width: 1, color: decal.color, alpha: decal.alpha });
        }
      }
      layer.addChild(graphics);
    },
  };
}
