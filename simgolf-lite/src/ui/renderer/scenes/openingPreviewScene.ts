import * as PIXI from "pixi.js";
import { tileDiamondCorners, tileCenterIso } from "../../../game/render/iso";
import type { RenderSceneSystem } from "../SceneSystemHost";

type OpeningPreviewGraphics = PIXI.Graphics & {
  __coursecraftOpeningPreview?: {
    targetIds: number[];
    outlineCount: number;
  };
};

/** Endpoint-only schematic. No RNG, interpolation, physics, ticker or assets.
 * It draws the upstream retained playback frame; landing and next lie remain
 * distinct, and relief is never invented as rollout.
 */
export function createOpeningPreviewSceneSystem(layer: PIXI.Container): RenderSceneSystem {
  let graphics: OpeningPreviewGraphics | null = null;
  const clear = () => {
    graphics?.parent?.removeChild(graphics);
    graphics?.destroy();
    graphics = null;
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
      graphics.__coursecraftOpeningPreview = {
        targetIds: targets.map((target) => target.id),
        outlineCount: targets.length,
      };
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
      if (!marker) return;
      const golfer = project(marker.golfer ?? marker.shot.from);
      const ball = project(marker.ball ?? marker.shot.rest);
      const landing = project(marker.shot.landing);
      const rest = project(marker.shot.rest);
      // High-contrast golfer and ball occupy the current derived frame.
      graphics.circle(golfer.x, golfer.y - 18, 4).fill(0xffe6a3).stroke({ color: 0x172e30, width: 2 });
      graphics.rect(golfer.x - 4, golfer.y - 13, 8, 10).fill(0x172e30).stroke({ color: 0xffe6a3, width: 2 });
      graphics.circle(ball.x, ball.y - 4, 4).fill(0xffffff).stroke({ color: 0x172e30, width: 2 });
      graphics.circle(landing.x, landing.y, 7).stroke({ color: 0x172e30, width: 5 }).stroke({ color: 0xffffff, width: 2 });
      graphics.rect(rest.x - 4, rest.y - 4, 8, 8).fill(0xffffff).stroke({ color: 0x172e30, width: 2 });
    },
    dispose: clear,
  };
}
