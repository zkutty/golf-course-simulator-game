import * as PIXI from "pixi.js";
import { worldToIso, TILE_H, TILE_W } from "../../../game/render/iso";
import type { RenderSceneSystem } from "../SceneSystemHost";

/** Endpoint-only schematic. No RNG, interpolation, physics, ticker or assets.
 * Landing and next lie are distinct markers: relief is never drawn as rollout.
 */
export function createOpeningPreviewSceneSystem(layer: PIXI.Container): RenderSceneSystem {
  let graphics: PIXI.Graphics | null = null;
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
        graphics = new PIXI.Graphics();
        graphics.label = "opening-preview-markers";
      }
      if (!graphics.parent) layer.addChild(graphics);
      graphics.clear();
      const project = (point: { x: number; y: number }) => worldToIso(point.x + 0.5, point.y + 0.5, snapshot.surfaceHeightAt(point.x + 0.5, point.y + 0.5), snapshot.rotation);
      for (const target of snapshot.openingTargets ?? []) {
        const p = project(target);
        graphics.poly([p.x, p.y - TILE_H / 2, p.x + TILE_W / 2, p.y, p.x, p.y + TILE_H / 2, p.x - TILE_W / 2, p.y]);
        graphics.fill({ color: 0xffe6a3, alpha: 0.22 }).stroke({ color: 0x172e30, width: 4 });
        graphics.stroke({ color: 0xffe6a3, width: 2 });
      }
      const marker = snapshot.openingMarker;
      if (!marker) return;
      const from = project(marker.shot.from);
      const landing = project(marker.shot.landing);
      const rest = project(marker.shot.rest);
      // Small high-contrast person silhouette at the actual shot origin.
      graphics.circle(from.x, from.y - 18, 4).fill(0xffe6a3).stroke({ color: 0x172e30, width: 2 });
      graphics.rect(from.x - 4, from.y - 13, 8, 10).fill(0x172e30).stroke({ color: 0xffe6a3, width: 2 });
      graphics.circle(landing.x, landing.y, 7).stroke({ color: 0x172e30, width: 5 }).stroke({ color: 0xffffff, width: 2 });
      graphics.rect(rest.x - 4, rest.y - 4, 8, 8).fill(0xffffff).stroke({ color: 0x172e30, width: 2 });
    },
    dispose: clear,
  };
}
