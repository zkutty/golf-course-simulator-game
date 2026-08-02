import * as PIXI from "pixi.js";
import {
  surfaceCareVisualCommands,
  type SurfaceCareVisualCommand,
} from "../../../game/render/surfaceCarePresentation";
import { worldToIso } from "../../../game/render/iso";
import type { RenderSceneSystem } from "../SceneSystemHost";

export interface SurfaceCareWorkerSprite {
  readonly graphics: PIXI.Graphics;
  readonly baseX: number;
  readonly baseY: number;
  readonly phase: number;
  readonly animated: boolean;
}
export function createSurfaceCareSceneSystem(
  layer: PIXI.Container,
  setWorkers: (workers: SurfaceCareWorkerSprite[]) => void,
): RenderSceneSystem {
  return {
    id: "surfaceCare",
    render(snapshot) {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
      const workers: SurfaceCareWorkerSprite[] = [];
      setWorkers(workers);

      const commands = surfaceCareVisualCommands({
        course: snapshot.course,
        quality: snapshot.graphicsQuality,
        seed: snapshot.worldSeed,
        reducedMotion: snapshot.reducedMotion || !snapshot.animationsEnabled,
      });
      if (commands.length === 0) return;

      const pooled = new PIXI.Graphics();
      pooled.eventMode = "none";
      const pointFor = (command: SurfaceCareVisualCommand) => worldToIso(
        command.x,
        command.y,
        snapshot.surfaceHeightAt(command.x, command.y),
        snapshot.rotation,
      );
      const cueColor = (command: SurfaceCareVisualCommand) => (
        snapshot.colorVision === "standard"
          ? command.color
          : command.cue === "dry-stress"
            || command.cue === "bare-failure"
            || command.cue.startsWith("repair-")
            ? 0x272a2c
            : 0xf2f3f3
      );

      for (const command of commands) {
        const point = pointFor(command);
        const scale = command.scale;
        const headingPoint = worldToIso(
          command.x + Math.cos(command.rotation) * 0.25,
          command.y + Math.sin(command.rotation) * 0.25,
          snapshot.surfaceHeightAt(
            command.x + Math.cos(command.rotation) * 0.25,
            command.y + Math.sin(command.rotation) * 0.25,
          ),
          snapshot.rotation,
        );
        const headingLength = Math.max(
          0.0001,
          Math.hypot(headingPoint.x - point.x, headingPoint.y - point.y),
        );
        const dx = (headingPoint.x - point.x) / headingLength;
        const dy = (headingPoint.y - point.y) / headingLength;
        const color = cueColor(command);
        const alpha = Math.min(0.68, command.alpha);
        if (command.cue === "groundskeeper-work") {
          const worker = new PIXI.Graphics();
          worker.eventMode = "none";
          worker.circle(0, -8 * scale, 2.25 * scale);
          worker.fill({ color: 0xd7b38b, alpha: Math.min(0.9, alpha + 0.18) });
          worker.moveTo(0, -5.7 * scale);
          worker.lineTo(0, 1.2 * scale);
          worker.moveTo(-3 * scale, -3 * scale);
          worker.lineTo(3 * scale, -1 * scale);
          worker.moveTo(0, 1.2 * scale);
          worker.lineTo(-2.5 * scale, 5 * scale);
          worker.moveTo(0, 1.2 * scale);
          worker.lineTo(2.5 * scale, 5 * scale);
          worker.stroke({ width: 1.5, color, alpha: Math.min(0.94, alpha + 0.2), cap: "round" });
          worker.moveTo(3 * scale, -4 * scale);
          worker.lineTo(5.5 * scale, 5 * scale);
          worker.lineTo(8 * scale, 5.5 * scale);
          worker.stroke({ width: 1.1, color: 0x62513a, alpha: 0.9, cap: "round" });
          worker.position.set(point.x, point.y);
          layer.addChild(worker);
          workers.push({
            graphics: worker,
            baseX: point.x,
            baseY: point.y,
            phase: command.rotation,
            animated: command.animated,
          });
          continue;
        }

        if (command.cue === "worn-line") {
          pooled.moveTo(point.x - dx * 7 * scale, point.y - dy * 2.8 * scale);
          pooled.bezierCurveTo(
            point.x - dy * 2.2 * scale,
            point.y + dx * 1.1 * scale,
            point.x + dy * 1.8 * scale,
            point.y - dx * 0.9 * scale,
            point.x + dx * 7 * scale,
            point.y + dy * 2.8 * scale,
          );
          pooled.stroke({ width: 2.2, color, alpha, cap: "round" });
        } else if (command.cue === "divot") {
          pooled.ellipse(point.x, point.y, 2.8 * scale, 1.15 * scale);
          pooled.fill({ color, alpha });
          pooled.moveTo(point.x - 2.8 * scale, point.y - 0.2 * scale);
          pooled.lineTo(point.x + 2.2 * scale, point.y - 0.7 * scale);
          pooled.stroke({ width: 0.8, color: 0xd4c58b, alpha: alpha * 0.8 });
        } else if (command.cue === "compaction") {
          for (let offset = -1; offset <= 1; offset++) {
            pooled.moveTo(
              point.x - dx * 5.5 * scale - dy * offset * 1.4,
              point.y - dy * 2.4 * scale + dx * offset * 0.7,
            );
            pooled.lineTo(
              point.x + dx * 5.5 * scale - dy * offset * 1.4,
              point.y + dy * 2.4 * scale + dx * offset * 0.7,
            );
          }
          pooled.stroke({ width: 0.8, color, alpha: alpha * 0.86, cap: "round" });
        } else if (command.cue === "mud-softness") {
          pooled.ellipse(point.x, point.y, 6.2 * scale, 2.1 * scale);
          pooled.fill({ color, alpha: alpha * 0.62 });
          pooled.ellipse(point.x - 1.8 * scale, point.y - 0.4 * scale, 1.3 * scale, 0.5 * scale);
          pooled.stroke({ width: 0.8, color: 0xd9e1d1, alpha: alpha * 0.72 });
        } else if (command.cue === "dry-stress") {
          pooled.moveTo(point.x - 5 * scale, point.y);
          pooled.lineTo(point.x - 1 * scale, point.y - 1.2 * scale);
          pooled.lineTo(point.x + 2 * scale, point.y + 1.4 * scale);
          pooled.lineTo(point.x + 5 * scale, point.y - 0.4 * scale);
          pooled.moveTo(point.x - 1 * scale, point.y - 1.2 * scale);
          pooled.lineTo(point.x, point.y - 3.2 * scale);
          pooled.stroke({ width: 1.2, color, alpha, cap: "round" });
        } else if (command.cue === "wet-disease-risk") {
          pooled.circle(point.x - 2.2 * scale, point.y, 2.4 * scale);
          pooled.circle(point.x + 1.8 * scale, point.y + 0.5 * scale, 2.1 * scale);
          pooled.stroke({ width: 1.1, color, alpha });
        } else if (command.cue === "weed-pressure" || command.cue === "overgrowth") {
          const bladeCount = command.cue === "overgrowth" ? 5 : 3;
          for (let blade = 0; blade < bladeCount; blade++) {
            const offset = (blade - (bladeCount - 1) / 2) * 2 * scale;
            pooled.moveTo(point.x + offset, point.y + 2 * scale);
            pooled.lineTo(
              point.x + offset + Math.sin(command.rotation + blade) * 2.2 * scale,
              point.y - (3.5 + blade % 2 * 2) * scale,
            );
          }
          pooled.stroke({ width: 1.1, color, alpha, cap: "round" });
        } else if (command.cue === "thinning") {
          for (let dash = -2; dash <= 2; dash++) {
            pooled.moveTo(point.x + dash * 2.4 * scale, point.y + (dash % 2) * 0.6);
            pooled.lineTo(point.x + dash * 2.4 * scale + dx * 1.5, point.y - 1.5 * scale);
          }
          pooled.stroke({ width: 0.9, color, alpha });
        } else if (command.cue === "bare-failure") {
          pooled.ellipse(point.x, point.y, 7.2 * scale, 2.7 * scale);
          pooled.fill({ color, alpha: alpha * 0.72 });
          pooled.ellipse(point.x - 2.1 * scale, point.y - 0.4 * scale, 2.2 * scale, 0.7 * scale);
          pooled.stroke({ width: 1, color: 0xd0b17d, alpha: alpha * 0.68 });
        } else if (command.cue === "repair-reseed") {
          for (let row = -1; row <= 1; row++) {
            for (let seed = -2; seed <= 2; seed++) {
              pooled.circle(
                point.x + seed * 2.3 * scale + row * 0.7,
                point.y + row * 1.35 * scale,
                0.65 * scale,
              );
            }
          }
          pooled.fill({ color, alpha });
        } else if (command.cue === "repair-resod") {
          for (let row = -1; row <= 1; row++) {
            pooled.rect(
              point.x - 6.2 * scale + (row % 2) * 1.7 * scale,
              point.y + row * 1.7 * scale,
              4.1 * scale,
              1.35 * scale,
            );
            pooled.rect(
              point.x - 1.4 * scale + (row % 2) * 1.7 * scale,
              point.y + row * 1.7 * scale,
              4.1 * scale,
              1.35 * scale,
            );
          }
          pooled.stroke({ width: 0.8, color, alpha });
        } else {
          // Recovery dressing exists only while the authoritative task exists
          // and has positive progress. Completion removes the command exactly.
          pooled.ellipse(point.x, point.y, 6.4 * scale, 2.1 * scale);
          pooled.stroke({ width: 1, color, alpha: alpha * 0.86 });
          for (let sprout = -1; sprout <= 1; sprout++) {
            pooled.moveTo(point.x + sprout * 3.2 * scale, point.y + 1.2 * scale);
            pooled.lineTo(point.x + sprout * 3.2 * scale, point.y - 2.2 * scale);
          }
          pooled.stroke({ width: 1, color: 0x75a65c, alpha });
        }
      }
      layer.addChildAt(pooled, 0);
      setWorkers(workers);
    },
  };
}
