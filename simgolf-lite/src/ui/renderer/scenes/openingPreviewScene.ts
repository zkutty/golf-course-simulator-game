import * as PIXI from "pixi.js";
import { tileDiamondCorners, tileCenterIso } from "../../../game/render/iso";
import { retainedPreviewShotPose } from "../../../game/render/ballFlight";
import type { RenderSceneSystem } from "../SceneSystemHost";
import type { RenderSnapshot } from "../../../game/render/renderSnapshot";

type OpeningPreviewGraphics = PIXI.Graphics & {
  __coursecraftOpeningPreview?: {
    targetIds: number[];
    outlineCount: number;
    impact: { shotId: string; type: "sand" | "water" | "green" | "obstacle"; x: number; y: number } | null;
    impactCount: number;
  };
};

type PreviewImpact = NonNullable<OpeningPreviewGraphics["__coursecraftOpeningPreview"]>["impact"];

function impactAt(snapshot: RenderSnapshot, point: { x: number; y: number }): Exclude<PreviewImpact, null>["type"] | null {
  const x = Math.floor(point.x + .5);
  const y = Math.floor(point.y + .5);
  const terrain = x >= 0 && y >= 0 && x < snapshot.course.width && y < snapshot.course.height
    ? snapshot.effectiveTiles[y * snapshot.course.width + x]
    : null;
  if (snapshot.obstacles.some((obstacle) => Math.hypot(obstacle.x - point.x, obstacle.y - point.y) <= .75)) return "obstacle";
  if (terrain === "water" || terrain === "wetland") return "water";
  if (terrain === "sand" || terrain === "waste_area") return "sand";
  return terrain === "green" ? "green" : null;
}

/** Pixel-art selected-preview adapter. No RNG, solver, ticker, audio, or assets.
 * It draws only the upstream retained frame. A relief next lie remains a
 * separate static marker and is never connected to the touchdown point.
 */
export function createOpeningPreviewSceneSystem(layer: PIXI.Container): RenderSceneSystem {
  let graphics: OpeningPreviewGraphics | null = null;
  let lastShotId: string | null = null;
  let lastProgress = 0;
  let impact: Exclude<PreviewImpact, null> | null = null;
  let impactCount = 0;
  const clear = () => {
    graphics?.parent?.removeChild(graphics);
    graphics?.destroy();
    graphics = null;
    lastShotId = null;
    lastProgress = 0;
    impact = null;
    impactCount = 0;
  };
  return {
    id: "openingPreview",
    render(snapshot) {
      if (!snapshot.openingMarker && !snapshot.openingTargets?.length) { clear(); return; }
      if (!graphics) {
        graphics = new PIXI.Graphics() as OpeningPreviewGraphics;
        graphics.label = "opening-preview-markers";
      }
      if (!graphics.parent) layer.addChild(graphics);
      graphics.clear();
      const project = (point: { x: number; y: number }) => tileCenterIso(
        point.x,
        point.y,
        snapshot.surfaceHeightAt(point.x + 0.5, point.y + 0.5),
        snapshot.rotation,
      );
      const targets = snapshot.openingTargets ?? [];
      for (const target of targets) {
        const corners = tileDiamondCorners(
          target.x,
          target.y,
          snapshot.surfaceHeightAt(target.x + 0.5, target.y + 0.5),
          snapshot.rotation,
        );
        graphics.poly(corners.flatMap((corner) => [corner.x, corner.y]));
        graphics.fill({ color: 0xffe6a3, alpha: 0.22 }).stroke({ color: 0x172e30, width: 4 });
        graphics.stroke({ color: 0xffe6a3, width: 2 });
      }
      const marker = snapshot.openingMarker;
      const pose = marker ? retainedPreviewShotPose(marker.shot, marker.progress) : null;
      if (marker?.shotId !== lastShotId || marker.progress < lastProgress) {
        impact = null;
        impactCount = 0;
      }
      if (marker) {
        const landed = pose?.landed ?? false;
        const type = landed ? impactAt(snapshot, marker.landing) : null;
        if (type && !impact) {
          impact = { shotId: marker.shotId, type, x: marker.landing.x, y: marker.landing.y };
          impactCount = 1;
        }
        lastShotId = marker.shotId;
        lastProgress = marker.progress;
      }
      graphics.__coursecraftOpeningPreview = {
        targetIds: targets.map((target) => target.id),
        outlineCount: targets.length,
        impact,
        impactCount,
      };
      if (!marker) return;
      const golfer = project(marker.golfer ?? marker.shot.from);
      const ball = project(pose?.ball ?? marker.shot.landing);
      const landing = project(marker.shot.landing);
      const rest = project(marker.shot.rest);
      const lift = snapshot.reducedMotion ? 0 : pose?.heightPx ?? 0;
      // High-contrast golfer and ball occupy the current derived frame.
      graphics.circle(golfer.x, golfer.y - 18, 4).fill(0xffe6a3).stroke({ color: 0x172e30, width: 2 });
      graphics.rect(golfer.x - 4, golfer.y - 13, 8, 10).fill(0x172e30).stroke({ color: 0xffe6a3, width: 2 });
      // Deliberately square, small pixels rather than a generic live-ball rewrite.
      graphics.rect(ball.x - 4, ball.y - 2, 8, 3).fill({ color: 0x172e30, alpha: .28 });
      graphics.rect(ball.x - 3, ball.y - 7 - lift, 6, 6).fill(0xffffff).stroke({ color: 0x172e30, width: 2 });
      if (!snapshot.reducedMotion && snapshot.graphicsQuality === "high" && lift > 1) {
        const start = project(marker.shot.from);
        for (const t of [.25, .5, .75]) {
          const x = start.x + (ball.x - start.x) * t;
          const y = start.y + (ball.y - lift - start.y) * t;
          graphics.rect(x - 1, y - 1, 2, 2).fill({ color: 0xffffff, alpha: .36 });
        }
      }
      graphics.circle(landing.x, landing.y, 7).stroke({ color: 0x172e30, width: 5 }).stroke({ color: 0xffffff, width: 2 });
      if (pose?.hasReliefMarker) {
        graphics.rect(rest.x - 5, rest.y - 5, 10, 10).stroke({ color: 0x172e30, width: 3 }).stroke({ color: 0xffe6a3, width: 1 });
      } else graphics.rect(rest.x - 4, rest.y - 4, 8, 8).fill(0xffffff).stroke({ color: 0x172e30, width: 2 });
      if (impact) {
        const cue = project(impact);
        const color = impact.type === "water" ? 0x75def5 : impact.type === "sand" ? 0xffd26c : impact.type === "green" ? 0xaef082 : 0xff8d62;
        const radius = snapshot.reducedMotion || snapshot.graphicsQuality === "low" ? 5 : 8;
        graphics.rect(cue.x - 2, cue.y - 2, 4, 4).fill(color);
        graphics.circle(cue.x, cue.y, radius).stroke({ color, width: 2, alpha: .9 });
      }
    },
    dispose: clear,
  };
}
