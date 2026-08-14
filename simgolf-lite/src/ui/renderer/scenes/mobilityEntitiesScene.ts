import * as PIXI from "pixi.js";
import type { GolferRenderData } from "../../../game/live/types";
import { mobilityRenderUnits, type MobilityRenderUnit } from "../../../game/m51/mobilityRender";
import { tileCenterIso } from "../../../game/render/iso";
import { entityDepth } from "../../../game/render/objectPlacement";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

interface MobilityUnitEntry {
  readonly holder: PIXI.Container;
  readonly graphic: PIXI.Graphics;
  signature: string;
}

interface MobilityStaticAuthority {
  readonly course: RenderSnapshot["course"];
  readonly rotation: RenderSnapshot["rotation"];
  readonly surfaceHeightAt: RenderSnapshot["surfaceHeightAt"];
}

export interface MobilityCullBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface MobilityEntitiesTickInput {
  readonly golfers: readonly GolferRenderData[];
  readonly cullBounds: MobilityCullBounds;
}

export interface MobilityEntitiesSceneDependencies {
  readonly createContainer?: () => PIXI.Container;
  readonly createGraphics?: () => PIXI.Graphics;
}

export interface MobilityEntitiesSceneSystem extends RenderSceneSystem {
  readonly id: "mobilityEntities";
  tick(input: MobilityEntitiesTickInput): void;
  unitCount(): number;
}

function drawMobilityUnit(graphic: PIXI.Graphics, unit: MobilityRenderUnit): void {
  graphic.clear();
  if (unit.state === "walking_connection") {
    graphic.circle(0, -4, 7);
    graphic.stroke({ width: 1.5, color: 0xf4f1db, alpha: 0.85 });
    graphic.moveTo(-5, -4);
    graphic.lineTo(5, -4);
    graphic.stroke({ width: 1.5, color: 0x385d45, alpha: 0.9 });
  } else if (unit.mode === "riding_cart") {
    graphic.roundRect(-10, -9, 20, 10, 3);
    graphic.fill({ color: 0xe7dfba, alpha: unit.state === "parked" ? 0.62 : 0.95 });
    graphic.stroke({ width: 1.5, color: 0x374438, alpha: 0.95 });
    graphic.circle(-6, 2, 2.5);
    graphic.circle(6, 2, 2.5);
    graphic.fill({ color: 0x263126, alpha: 0.95 });
  } else {
    graphic.circle(-3, 0, 3.5);
    graphic.circle(4, 0, 3.5);
    graphic.stroke({ width: 1.5, color: 0x263126, alpha: 0.95 });
    graphic.moveTo(0, -1);
    graphic.lineTo(0, -11);
    graphic.lineTo(5, -14);
    graphic.stroke({
      width: 2,
      color: 0xead99b,
      alpha: unit.state === "parked" ? 0.62 : 0.95,
    });
  }
}

/** Owns live and parked M51 mobility visuals while PixiStage retains the sole ticker. */
export function createMobilityEntitiesSceneSystem(
  objects: PIXI.Container,
  dependencies: MobilityEntitiesSceneDependencies = {},
): MobilityEntitiesSceneSystem {
  const createContainer = dependencies.createContainer ?? (() => new PIXI.Container());
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  const entries = new Map<string, MobilityUnitEntry>();
  let authority: MobilityStaticAuthority | null = null;

  const cacheAuthority = (snapshot: RenderSnapshot) => {
    authority = {
      course: snapshot.course,
      rotation: snapshot.rotation,
      surfaceHeightAt: snapshot.surfaceHeightAt,
    };
  };

  const retire = (id: string, entry: MobilityUnitEntry) => {
    entry.holder.parent?.removeChild(entry.holder);
    entry.holder.destroy({ children: true });
    entries.delete(id);
  };

  const clear = () => {
    for (const [id, entry] of entries) retire(id, entry);
    authority = null;
  };

  const tick = ({ golfers, cullBounds }: MobilityEntitiesTickInput) => {
    if (!authority) return;
    const { course, rotation, surfaceHeightAt } = authority;
    const seen = new Set<string>();
    for (const unit of mobilityRenderUnits(course, golfers)) {
      seen.add(unit.id);
      let entry = entries.get(unit.id);
      if (!entry) {
        const holder = createContainer();
        const graphic = createGraphics();
        holder.label = `mobility-entity:${unit.id}`;
        holder.addChild(graphic);
        objects.addChild(holder);
        entry = { holder, graphic, signature: "" };
        entries.set(unit.id, entry);
      }

      const elevation = surfaceHeightAt(unit.x + 0.5, unit.y + 0.5);
      const projected = tileCenterIso(unit.x, unit.y, elevation, rotation);
      entry.holder.position.set(projected.x, projected.y + 2);
      entry.holder.visible = !(
        projected.x < cullBounds.left
        || projected.x > cullBounds.right
        || projected.y < cullBounds.top
        || projected.y > cullBounds.bottom
      );
      const depth = Math.round(
        (entityDepth(unit.x, unit.y, elevation, rotation) - 0.05) * 10,
      ) / 10;
      if (entry.holder.zIndex !== depth) entry.holder.zIndex = depth;

      const signature = `${unit.state}:${unit.mode}`;
      if (entry.signature !== signature) {
        entry.signature = signature;
        drawMobilityUnit(entry.graphic, unit);
      }
    }

    for (const [id, entry] of entries) {
      if (!seen.has(id)) retire(id, entry);
    }
  };

  return {
    id: "mobilityEntities",
    create: cacheAuthority,
    update: cacheAuthority,
    destroy: clear,
    tick,
    unitCount: () => entries.size,
  };
}
