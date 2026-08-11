import * as PIXI from "pixi.js";
import { getBiomeDefinition } from "../../../game/models/biomes";
import { buildingSpec, buildingVisualFrame } from "../../../game/models/buildings";
import {
  decorationTiles,
  decorationVisual,
} from "../../../game/models/decorations";
import type { LandTheme } from "../../../game/models/types";
import {
  plantDefinition,
  resolvedDecorationPlantId,
} from "../../../game/models/plantRegistry";
import { isWaterHazard } from "../../../game/models/terrainRules";
import { TILE_H, TILE_W } from "../../../game/render/iso";
import { frontCorner, placeObject } from "../../../game/render/objectPlacement";
import {
  seasonalDecorationPlantForm,
  seasonalPlantClimate,
  seasonalPlantPresentation,
} from "../../../game/render/seasonalPlants";
import { getPropFrame, type AtlasFrame } from "../../../render/atlas";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

interface StructuresPropsEntry {
  readonly sprite: PIXI.Sprite;
  shadow: PIXI.Graphics | null;
}

export interface StructuresPropsSceneDependencies {
  readonly getAtlasTexture?: (
    theme: LandTheme | undefined,
    quality: "high" | "medium" | "low",
    frame: AtlasFrame,
  ) => PIXI.Texture | null;
  readonly createSprite?: (texture: PIXI.Texture) => PIXI.Sprite;
  readonly createGraphics?: () => PIXI.Graphics;
}

export interface StructuresPropsSceneSystem extends RenderSceneSystem {
  readonly id: "structuresProps";
  contentCount(): number;
  rebuildCount(): number;
}

export interface StableSceneDecalLayers {
  readonly estateSurvey: PIXI.Container;
  readonly naturalProps: PIXI.Container;
  readonly structuresProps: PIXI.Container;
}

/** Fixed hosted-scene decal order, independent of individual scene rebuilds. */
export function createStableSceneDecalLayers(
  parent: PIXI.Container,
  createContainer: () => PIXI.Container = () => new PIXI.Container(),
): StableSceneDecalLayers {
  const estateSurvey = createContainer();
  const naturalProps = createContainer();
  const structuresProps = createContainer();
  estateSurvey.label = "scene-decals:estate-survey";
  naturalProps.label = "scene-decals:natural-props";
  structuresProps.label = "scene-decals:structures-props";
  parent.addChild(estateSurvey, naturalProps, structuresProps);
  return { estateSurvey, naturalProps, structuresProps };
}

/** Owns static authored buildings, decorations, and decoration shadows. */
export function createStructuresPropsSceneSystem(
  objects: PIXI.Container,
  terrainDecals: PIXI.Container,
  onContentCount: (count: number) => void = () => {},
  dependencies: StructuresPropsSceneDependencies = {},
): StructuresPropsSceneSystem {
  const getAtlasTexture = dependencies.getAtlasTexture ?? getPropFrame;
  const createSprite = dependencies.createSprite ?? ((texture) => new PIXI.Sprite(texture));
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  let entries: StructuresPropsEntry[] = [];
  let rebuilds = 0;

  const clear = () => {
    for (const entry of entries) {
      entry.sprite.parent?.removeChild(entry.sprite);
      entry.sprite.destroy();
      entry.shadow?.parent?.removeChild(entry.shadow);
      entry.shadow?.destroy();
    }
    entries = [];
    onContentCount(0);
  };

  const render = (snapshot: RenderSnapshot) => {
    rebuilds++;
    clear();
    try {
      const course = snapshot.course;
      const theme = getBiomeDefinition(course.theme).key;
      for (const building of course.buildings ?? []) {
        const spec = buildingSpec(building);
        const texture = getAtlasTexture(theme, snapshot.graphicsQuality, buildingVisualFrame(building, theme))
          ?? getAtlasTexture(theme, snapshot.graphicsQuality, buildingVisualFrame({ ...building, tier: 1 }, theme))
          ?? getAtlasTexture(theme, snapshot.graphicsQuality, spec.frame as AtlasFrame)
          ?? getAtlasTexture(theme, snapshot.graphicsQuality, "clubhouse");
        if (!texture) continue;
        const footprint = { x: building.x, y: building.y, w: spec.w, d: spec.d };
        const anchor = frontCorner(footprint, snapshot.rotation);
        const placement = placeObject(
          footprint,
          snapshot.surfaceHeightAt(anchor.x, anchor.y),
          snapshot.rotation,
        );
        const sprite = createSprite(texture);
        entries.push({ sprite, shadow: null });
        sprite.label = `structure-prop:building:${building.id}`;
        sprite.anchor.set(0.5, 1);
        sprite.position.set(placement.position.x, placement.position.y);
        sprite.width = spec.w * TILE_W;
        sprite.height = (sprite.width * texture.height) / texture.width;
        sprite.zIndex = placement.zIndex;
        objects.addChild(sprite);
      }

      const seasonalClimate = seasonalPlantClimate(snapshot.seasonalVisualState);
      const terrainNearWater = (x: number, y: number) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) continue;
          if (isWaterHazard(snapshot.effectiveTiles[ty * course.width + tx])) return true;
        }
        return false;
      };
      for (const decoration of course.decorations ?? []) {
        const visual = decorationVisual(decoration, theme);
        const plantId = resolvedDecorationPlantId(course.theme, decoration);
        const plant = plantId ? plantDefinition(plantId) : undefined;
        const seasonal = plant
          ? seasonalPlantPresentation({
            identity: plant.id,
            profile: plant.seasonalProfile,
            form: seasonalDecorationPlantForm(decoration.kind, plant.seasonalProfile),
            x: decoration.x,
            y: decoration.y,
            cultivated: decoration.origin === "player",
            elevation: course.elevations[decoration.y * course.width + decoration.x] ?? 0,
            nearWater: terrainNearWater(decoration.x, decoration.y),
            ecologicalFit: plant.ecologicalFit[theme],
            climate: seasonalClimate,
          })
          : null;
        const texture = getAtlasTexture(course.theme, snapshot.graphicsQuality, visual.frame as AtlasFrame);
        if (!texture) continue;
        const tiles = decorationTiles(decoration);
        const xs = tiles.map((tile) => tile.x);
        const ys = tiles.map((tile) => tile.y);
        const minX = Math.min(...xs); const maxX = Math.max(...xs);
        const minY = Math.min(...ys); const maxY = Math.max(...ys);
        const footprint = { x: minX, y: minY, w: maxX - minX + 1, d: maxY - minY + 1 };
        const anchor = frontCorner(footprint, snapshot.rotation);
        const placement = placeObject(
          footprint,
          snapshot.surfaceHeightAt(anchor.x, anchor.y),
          snapshot.rotation,
        );
        const sprite = createSprite(texture);
        const entry: StructuresPropsEntry = { sprite, shadow: null };
        entries.push(entry);
        const shadow = createGraphics();
        entry.shadow = shadow;
        sprite.anchor.set(visual.anchor[0], visual.anchor[1]);
        sprite.position.set(placement.position.x, placement.position.y);
        const structure = decoration.kind === "bridge" || decoration.kind === "boardwalk";
        const logicalWidth = structure ? Math.max(2, tiles.length * 0.72) * TILE_W : TILE_W * visual.scale;
        sprite.width = logicalWidth * (seasonal?.scaleX ?? 1);
        sprite.height = logicalWidth * texture.height / texture.width * (seasonal?.scaleY ?? 1);
        sprite.tint = seasonal?.tint ?? 0xffffff;
        sprite.alpha = seasonal?.alpha ?? 1;
        if ((decoration.rotation + snapshot.rotation) % 2 === 1) sprite.scale.x *= -1;
        sprite.zIndex = placement.zIndex + 0.05;
        sprite.eventMode = "none";
        objects.addChild(sprite);

        shadow.ellipse(
          0,
          0,
          (structure ? logicalWidth * 0.38 : visual.shadow.radiusX)
            * (seasonal?.shadowScale ?? 1),
          visual.shadow.radiusY * (seasonal?.shadowScale ?? 1),
        );
        shadow.fill({ color: 0x000000, alpha: visual.shadow.alpha });
        shadow.position.set(placement.position.x + 3, placement.position.y - TILE_H / 2 + 2);
        shadow.eventMode = "none";
        terrainDecals.addChild(shadow);
      }
      onContentCount(entries.length);
    } catch (error) {
      clear();
      throw error;
    }
  };

  return {
    id: "structuresProps",
    create: render,
    update: render,
    destroy: clear,
    contentCount: () => entries.length,
    rebuildCount: () => rebuilds,
  };
}
