import * as PIXI from "pixi.js";
import { decodeParcelMap } from "../../../game/estate/estate";
import { TILE_H, TILE_W, worldToIso } from "../../../game/render/iso";
import type { RenderSceneSystem } from "../SceneSystemHost";

const ESTATE_LABEL = "estate-overlay";

/** Batches estate ownership and survey marks without touching the terrain system. */
export function createEstateSurveySceneSystem(layer: PIXI.Container): RenderSceneSystem {
  const clear = () => {
    layer.children
      .filter((child) => child.label === ESTATE_LABEL)
      .forEach((child) => { layer.removeChild(child); child.destroy(); });
  };
  return {
    id: "estateSurvey",
    render(snapshot) {
      clear();
      const estate = snapshot.course.estate;
      if (!estate) return;
      const map = decodeParcelMap(estate, snapshot.course.width * snapshot.course.height);
      if (!map) return;
      const selectedIndex = estate.parcels.findIndex((parcel) => parcel.id === snapshot.selectedParcelId);
      const owned = new Set(estate.ownedParcelIds);
      const fill = new PIXI.Graphics();
      const boundary = new PIXI.Graphics();
      const boundaryColor = snapshot.colorVision === "tritanopia"
        ? 0xff4f8b
        : snapshot.colorVision === "protanopia" ? 0x3f9cff : 0xffd45a;
      const diamond = (graphics: PIXI.Graphics, x: number, y: number) => {
        const top = worldToIso(
          x + 0.5,
          y,
          snapshot.course.elevations[y * snapshot.course.width + x] ?? 0,
          snapshot.rotation,
        );
        graphics.poly([top.x, top.y, top.x + TILE_W / 2, top.y + TILE_H / 2, top.x, top.y + TILE_H, top.x - TILE_W / 2, top.y + TILE_H / 2]);
      };
      for (let y = 0; y < snapshot.course.height; y++) for (let x = 0; x < snapshot.course.width; x++) {
        const index = y * snapshot.course.width + x;
        const parcelIndex = map[index];
        const parcel = estate.parcels[parcelIndex];
        const selected = parcelIndex === selectedIndex && snapshot.surveyMode;
        if (!owned.has(parcel.id) || selected) {
          diamond(fill, x, y);
          fill.fill({ color: selected ? boundaryColor : 0x111820, alpha: selected ? .2 : snapshot.surveyMode ? .08 : .22 });
        }
        if (snapshot.surveyMode) {
          const differs = x === 0 || y === 0 || x === snapshot.course.width - 1 || y === snapshot.course.height - 1 || map[index - 1] !== parcelIndex || map[index + 1] !== parcelIndex || map[index - snapshot.course.width] !== parcelIndex || map[index + snapshot.course.width] !== parcelIndex;
          if (differs) {
            diamond(boundary, x, y);
            boundary.stroke({ width: selected ? 2.4 : 1.2, color: selected ? boundaryColor : owned.has(parcel.id) ? 0x75dc87 : 0xf4eee0, alpha: selected ? .95 : .58 });
          }
        }
      }
      fill.label = ESTATE_LABEL;
      boundary.label = ESTATE_LABEL;
      fill.eventMode = "none";
      boundary.eventMode = "none";
      layer.addChild(fill, boundary);
    },
    dispose: clear,
  };
}
