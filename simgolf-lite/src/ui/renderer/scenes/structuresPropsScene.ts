import * as PIXI from "pixi.js";
import { getBiomeDefinition } from "../../../game/models/biomes";
import { buildingSpec, buildingVisualFrame } from "../../../game/models/buildings";
import { TILE_W } from "../../../game/render/iso";
import { frontCorner, placeObject } from "../../../game/render/objectPlacement";
import { getPropFrame, type AtlasFrame } from "../../../render/atlas";
import type { RenderSceneSystem } from "../SceneSystemHost";

/** Static authored buildings are isolated from animated props and live entities. */
export function createStructuresPropsSceneSystem(layer: PIXI.Container): RenderSceneSystem {
  let sprites: PIXI.Sprite[] = [];
  const clear = () => {
    for (const sprite of sprites) {
      sprite.parent?.removeChild(sprite);
      sprite.destroy();
    }
    sprites = [];
  };

  return {
    id: "structuresProps",
    render(snapshot) {
      clear();
      const theme = getBiomeDefinition(snapshot.course.theme).key;
      for (const building of snapshot.course.buildings ?? []) {
        const spec = buildingSpec(building);
        const texture = getPropFrame(theme, snapshot.graphicsQuality, buildingVisualFrame(building, theme))
          ?? getPropFrame(theme, snapshot.graphicsQuality, buildingVisualFrame({ ...building, tier: 1 }, theme))
          ?? getPropFrame(theme, snapshot.graphicsQuality, spec.frame as AtlasFrame)
          ?? getPropFrame(theme, snapshot.graphicsQuality, "clubhouse");
        if (!texture) continue;
        const footprint = { x: building.x, y: building.y, w: spec.w, d: spec.d };
        const anchor = frontCorner(footprint, snapshot.rotation);
        const placement = placeObject(
          footprint,
          snapshot.surfaceHeightAt(anchor.x, anchor.y),
          snapshot.rotation,
        );
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 1);
        sprite.position.set(placement.position.x, placement.position.y);
        sprite.width = spec.w * TILE_W;
        sprite.height = (sprite.width * texture.height) / texture.width;
        sprite.zIndex = placement.zIndex;
        layer.addChild(sprite);
        sprites.push(sprite);
      }
    },
    dispose: clear,
  };
}
