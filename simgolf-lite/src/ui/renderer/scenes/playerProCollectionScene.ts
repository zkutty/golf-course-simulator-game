import * as PIXI from "pixi.js";
import { getBiomeDefinition } from "../../../game/models/biomes";
import { buildingSpec } from "../../../game/models/buildings";
import type { PlayerProWorldDisplayItem } from "../../../game/playerPro/socialPresentation";
import { TILE_H, TILE_W } from "../../../game/render/iso";
import { placeObject } from "../../../game/render/objectPlacement";
import { getPropFrame, type AtlasFrame } from "../../../render/atlas";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

export interface PlayerProCollectionSceneDependencies {
  readonly getAtlasTexture?: typeof getPropFrame;
  readonly createSprite?: (texture: PIXI.Texture) => PIXI.Sprite;
  readonly createGraphics?: () => PIXI.Graphics;
}

export interface PlayerProCollectionSceneSystem extends RenderSceneSystem {
  readonly id: "playerProCollection";
  contentCount(): number;
  rebuildCount(): number;
  labels(): readonly string[];
}

interface DisplayEntry {
  readonly display: PIXI.Sprite | PIXI.Graphics;
}

function drawFallback(graphics: PIXI.Graphics, category: PlayerProWorldDisplayItem["category"]): void {
  graphics.ellipse(0, 7, 12, 4).fill({ color: 0x17241b, alpha: 0.24 });
  if (category === "vehicle") {
    graphics.roundRect(-20, -11, 40, 15, 5).fill({ color: 0x365f73 }).stroke({ color: 0xd4bd86, width: 1 });
    graphics.roundRect(-11, -20, 22, 10, 4).fill({ color: 0x8fc0cf }).stroke({ color: 0x365f73, width: 1 });
    graphics.circle(-12, 5, 5).fill({ color: 0x273238 });
    graphics.circle(12, 5, 5).fill({ color: 0x273238 });
  } else if (category === "bag") {
    graphics.roundRect(-5, -18, 10, 24, 4).fill({ color: 0x8d5d3d }).stroke({ color: 0xe0c99e, width: 1 });
    graphics.moveTo(-3, -16).lineTo(6, -26).stroke({ color: 0xd7d0b5, width: 2 });
  } else if (category === "outfit") {
    graphics.poly([-10, -13, -4, -20, 0, -16, 4, -20, 10, -13, 6, -8, 6, 6, -6, 6, -6, -8]).fill({ color: 0x4e755e }).stroke({ color: 0xd6c68f, width: 1 });
  } else if (category === "watch") {
    graphics.roundRect(-3, -19, 6, 27, 3).fill({ color: 0x5b5048 });
    graphics.circle(0, -6, 7).fill({ color: 0xd9c37a }).stroke({ color: 0x554a38, width: 2 });
    graphics.moveTo(0, -6).lineTo(0, -10).stroke({ color: 0x554a38, width: 1 });
  } else if (category === "trophy") {
    graphics.poly([-8, -18, 8, -18, 6, -7, 2, -3, 2, 4, 7, 4, 7, 8, -7, 8, -7, 4, -2, 4, -2, -3, -6, -7]).fill({ color: 0xd7ae45 }).stroke({ color: 0xf2dd8a, width: 1 });
  } else if (category === "plant-stock") {
    graphics.roundRect(-9, -2, 18, 10, 3).fill({ color: 0x9a6540 }).stroke({ color: 0xd4a16b, width: 1 });
    graphics.ellipse(-4, -9, 5, 9).fill({ color: 0x4f8a55 });
    graphics.ellipse(4, -11, 5, 10).fill({ color: 0x6aa55f });
  } else {
    graphics.roundRect(-10, -15, 20, 22, 3).fill({ color: 0x765b43 }).stroke({ color: 0xc49c68, width: 1 });
    graphics.poly([-6, -10, 0, -14, 6, -10, 6, 1, -6, 1]).fill({ color: 0xe4d5aa });
  }
}

/** Owns the player's selected, already-visible collection dressing. */
export function createPlayerProCollectionSceneSystem(
  objects: PIXI.Container,
  dependencies: PlayerProCollectionSceneDependencies = {},
): PlayerProCollectionSceneSystem {
  const getAtlasTexture = dependencies.getAtlasTexture ?? getPropFrame;
  const createSprite = dependencies.createSprite ?? ((texture) => new PIXI.Sprite(texture));
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  let entries: DisplayEntry[] = [];
  let rebuilds = 0;

  const clear = () => {
    for (const entry of entries) {
      entry.display.parent?.removeChild(entry.display);
      entry.display.destroy();
    }
    entries = [];
  };

  const render = (snapshot: RenderSnapshot) => {
    rebuilds++;
    clear();
    try {
      const worldDisplay = snapshot.playerProWorldDisplay;
      if (!worldDisplay) return;
      const clubhouse = snapshot.course.buildings.find((building) => building.type === "clubhouse");
      if (!clubhouse) return;
      const items = [
        ...(worldDisplay.vehicle ? [worldDisplay.vehicle] : []),
        ...worldDisplay.equipped,
        ...worldDisplay.collection,
      ];
      const spec = buildingSpec(clubhouse);
      const minCoordinate = 0.5;
      const maxX = snapshot.course.width - minCoordinate;
      const maxY = snapshot.course.height - minCoordinate;
      const preferredStep = 0.95;
      const rightOrigin = clubhouse.x + spec.w + 0.7;
      const leftOrigin = clubhouse.x - 0.7;
      const rightRoom = maxX - rightOrigin;
      const leftRoom = leftOrigin - minCoordinate;
      const requiredColumnRoom = preferredStep * 3;
      const placeRight = rightRoom >= requiredColumnRoom
        || (leftRoom < requiredColumnRoom && rightRoom >= leftRoom);
      const originX = placeRight ? rightOrigin : leftOrigin;
      const columnStep = Math.min(preferredStep, Math.max(0, placeRight ? rightRoom : leftRoom) / 3);
      const downOrigin = clubhouse.y + spec.d - 0.4;
      const upOrigin = clubhouse.y + 0.4;
      const downRoom = maxY - downOrigin;
      const upRoom = upOrigin - minCoordinate;
      const placeDown = downRoom >= preferredStep
        || (upRoom < preferredStep && downRoom >= upRoom);
      const originY = placeDown ? downOrigin : upOrigin;
      const rowStep = Math.min(preferredStep, Math.max(0, placeDown ? downRoom : upRoom));
      const theme = getBiomeDefinition(snapshot.course.theme).key;

      items.forEach((item, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = Math.max(minCoordinate, Math.min(maxX, originX + (placeRight ? column : -column) * columnStep));
        const y = Math.max(minCoordinate, Math.min(maxY, originY + (placeDown ? row : -row) * rowStep));
        const placement = placeObject({ x, y, w: 0.5, d: 0.5 }, snapshot.surfaceHeightAt(x, y), snapshot.rotation);
        let display: PIXI.Sprite | PIXI.Graphics;
        if (item.category === "vehicle") {
          const texture = getAtlasTexture(theme, snapshot.graphicsQuality, `${theme}_parked_cart` as AtlasFrame);
          if (texture) {
            const sprite = createSprite(texture);
            sprite.anchor.set(0.5, 1);
            sprite.width = TILE_W * 0.9;
            sprite.height = sprite.width * texture.height / texture.width;
            if (snapshot.rotation % 2 === 1) sprite.scale.x *= -1;
            display = sprite;
          } else {
            const graphics = createGraphics();
            drawFallback(graphics, item.category);
            display = graphics;
          }
        } else {
          const graphics = createGraphics();
          drawFallback(graphics, item.category);
          display = graphics;
        }
        display.label = `player-pro-display:${item.category}:${item.id}`;
        display.position.set(placement.position.x, placement.position.y - TILE_H * 0.1);
        display.zIndex = placement.zIndex + 0.08 + index * 0.0001;
        display.eventMode = "none";
        entries.push({ display });
        objects.addChild(display);
      });
    } catch (error) {
      clear();
      throw error;
    }
  };

  return {
    id: "playerProCollection",
    create: render,
    update: render,
    destroy: clear,
    contentCount: () => entries.length,
    rebuildCount: () => rebuilds,
    labels: () => entries.map((entry) => entry.display.label),
  };
}
