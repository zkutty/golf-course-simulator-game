import * as PIXI from "pixi.js";
import { getBiomeDefinition } from "../../../game/models/biomes";
import { worldToIso } from "../../../game/render/iso";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

export interface PropertyAssetsSceneSystem extends RenderSceneSystem {
  readonly id: "propertyAssets";
  contentCount(): number;
}

export interface PropertyAssetsSceneDependencies {
  readonly createGraphics?: () => PIXI.Graphics;
}

/** Owns the deterministic M31-M33 vector footprints added directly to objects. */
export function createPropertyAssetsSceneSystem(
  objects: PIXI.Container,
  dependencies: PropertyAssetsSceneDependencies = {},
): PropertyAssetsSceneSystem {
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  let graphics: PIXI.Graphics[] = [];

  const clear = () => {
    for (const graphic of graphics) {
      graphic.parent?.removeChild(graphic);
      graphic.destroy();
    }
    graphics = [];
  };

  const render = (snapshot: RenderSnapshot) => {
    clear();
    const { course, rotation, surfaceHeightAt } = snapshot;
    const themeColors = {
      parkland: { access: 0x6f7775, practice: 0x78a95f, clubhouse: 0xb88c53, resort: 0x668da8, community: 0xc18c72, safety: 0x477a4d },
      links: { access: 0x777b79, practice: 0x91a65e, clubhouse: 0xa88d64, resort: 0x648ca1, community: 0xb79072, safety: 0x5d7848 },
      desert: { access: 0x81756a, practice: 0x6f9c66, clubhouse: 0xb47a4f, resort: 0x66899a, community: 0xc38162, safety: 0x61784f },
    } as const;
    const surfaceColors = { grass: 0x779567, dirt: 0x8c7156, gravel: 0x8b8b83, asphalt: 0x555b5d, paver: 0x9a8068 } as const;
    const structureOwner = getBiomeDefinition(course.theme).content.structures.buildings;
    const colors = themeColors[structureOwner];
    const resortPalette = {
      parkland: { wall: 0xe5d7b5, roof: 0x5f2f28, accent: 0xf5cb63 },
      links: { wall: 0xdad8cd, roof: 0x475d67, accent: 0xe0b653 },
      desert: { wall: 0xd7a46f, roof: 0x8b4e36, accent: 0x52a19a },
    }[structureOwner];
    const lodgingAssets = (course.property?.assets ?? []).filter((asset) => asset.enabled && ["lodge", "hotel", "cottages"].includes(asset.kind));
    for (const asset of course.property?.assets ?? []) {
      const elevation = surfaceHeightAt(
        asset.x + asset.width / 2,
        asset.y + asset.height / 2,
      );
      const corners = [
        worldToIso(asset.x, asset.y, elevation, rotation),
        worldToIso(asset.x + asset.width, asset.y, elevation, rotation),
        worldToIso(asset.x + asset.width, asset.y + asset.height, elevation, rotation),
        worldToIso(asset.x, asset.y + asset.height, elevation, rotation),
      ];
      const graphic = createGraphics();
      graphic.poly(corners.flatMap((point) => [point.x, point.y]));
      graphic.fill({ color: asset.surface ? surfaceColors[asset.surface] : colors[asset.category], alpha: asset.enabled ? 0.88 : 0.38 });
      graphic.stroke({ width: asset.enabled ? 2 : 1, color: asset.enabled ? 0xfff6d7 : 0x5d625e, alpha: 0.9 });
      if (asset.category === "community" && (asset.kind === "houses" || asset.kind === "condos")) {
        const unitState = (course.property?.units ?? []).filter((unit) => unit.assetId === asset.id);
        const occupiedRatio = unitState.length ? unitState.filter((unit) => !!unit.householdId).length / unitState.length : asset.tenure === "sold" ? 0.72 : 0;
        const structures = asset.kind === "houses" ? Math.min(8, 3 + asset.tier) : Math.min(4, 1 + asset.tier);
        const communityPalette = {
          parkland: { wall: 0xe5cfad, roof: 0x77483c, trim: 0xf2e7cf },
          links: { wall: 0xd8d4c5, roof: 0x55666d, trim: 0xf1eee1 },
          desert: { wall: 0xd59c69, roof: 0x8b553c, trim: 0xf1d3a5 },
        }[structureOwner];
        for (let index = 0; index < structures; index++) {
          const columns = asset.kind === "houses" ? Math.min(4, structures) : 2;
          const rows = Math.ceil(structures / columns);
          const wx = asset.x + asset.width * ((index % columns) + 0.5) / columns;
          const wy = asset.y + asset.height * (Math.floor(index / columns) + 0.55) / rows;
          const center = worldToIso(wx, wy, elevation, rotation);
          const width = asset.kind === "houses" ? 12 + asset.tier : 19 + asset.tier * 2;
          const height = asset.kind === "houses" ? 10 + asset.tier * 1.5 : 18 + asset.tier * 4;
          graphic.roundRect(center.x - width / 2, center.y - height, width, height, asset.kind === "houses" ? 1.5 : 1);
          graphic.fill({ color: communityPalette.wall, alpha: asset.enabled ? 0.98 : 0.42 });
          graphic.stroke({ width: 1, color: 0x503f35, alpha: 0.82 });
          graphic.poly([center.x - width / 2 - 1, center.y - height, center.x, center.y - height - width * 0.28, center.x + width / 2 + 1, center.y - height]);
          graphic.fill({ color: communityPalette.roof, alpha: asset.enabled ? 0.98 : 0.42 });
          if (index / structures < occupiedRatio) {
            graphic.rect(center.x - 2, center.y - height * 0.48, 4, 4);
            graphic.fill({ color: 0xf4d77b, alpha: 0.95 });
          } else {
            graphic.rect(center.x - 2, center.y - height * 0.48, 4, 4);
            graphic.fill({ color: 0x6f817d, alpha: 0.72 });
            graphic.moveTo(center.x - 2, center.y - height * 0.48);
            graphic.lineTo(center.x + 2, center.y - height * 0.48 + 4);
            graphic.stroke({ width: 0.8, color: communityPalette.trim, alpha: 0.85 });
          }
        }
        if (asset.tenure === "sold" || asset.tenure === "partnered" || asset.tenure === "retained") {
          for (let stripe = 0; stripe < 6; stripe++) {
            const a = corners[stripe % 4];
            const b = corners[(stripe + 1) % 4];
            const t = (stripe + 1) / 7;
            graphic.circle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 1.5);
          }
          graphic.fill({ color: asset.tenure === "sold" ? 0xefe2c7 : asset.tenure === "partnered" ? 0xd5c5ea : 0xb9d8e0, alpha: 0.95 });
        }
        if (asset.tenure === "reacquired") {
          const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
          graphic.circle(center.x, center.y - 9, 8);
          graphic.stroke({ width: 2.5, color: 0x3f7750, alpha: 0.95 });
          graphic.moveTo(center.x - 8, center.y - 9);
          graphic.lineTo(center.x - 3, center.y - 14);
          graphic.lineTo(center.x - 2, center.y - 7);
          graphic.stroke({ width: 2.5, color: 0x3f7750, alpha: 0.95 });
        }
      }
      if (asset.category === "resort" && ["lodge", "hotel", "cottages", "spa"].includes(asset.kind)) {
        const structures = asset.kind === "cottages" ? Math.min(6, 2 + asset.tier) : 1;
        for (let index = 0; index < structures; index++) {
          const columns = structures > 3 ? 3 : structures;
          const wx = asset.x + asset.width * ((index % columns) + 0.5) / columns;
          const wy = asset.y + asset.height * (Math.floor(index / columns) + 0.55) / Math.ceil(structures / columns);
          const center = worldToIso(wx, wy, elevation, rotation);
          const structureWidth = asset.kind === "hotel" ? 34 + asset.tier * 5 : asset.kind === "lodge" ? 30 + asset.tier * 4 : asset.kind === "spa" ? 26 : 15;
          const structureHeight = asset.kind === "hotel" ? 24 + asset.tier * 7 : asset.kind === "lodge" ? 20 + asset.tier * 4 : 13 + asset.tier * 2;
          graphic.poly([
            center.x - structureWidth / 2, center.y - structureHeight,
            center.x, center.y - structureHeight - structureWidth * 0.22,
            center.x + structureWidth / 2, center.y - structureHeight,
            center.x + structureWidth / 2, center.y,
            center.x, center.y + structureWidth * 0.22,
            center.x - structureWidth / 2, center.y,
          ]);
          graphic.fill({ color: resortPalette.wall, alpha: asset.enabled ? 0.97 : 0.42 });
          graphic.stroke({ width: 1.4, color: 0x493c32, alpha: 0.8 });
          graphic.poly([
            center.x - structureWidth / 2 - 2, center.y - structureHeight,
            center.x, center.y - structureHeight - structureWidth * 0.25 - 3,
            center.x + structureWidth / 2 + 2, center.y - structureHeight,
            center.x, center.y - structureHeight + structureWidth * 0.22,
          ]);
          graphic.fill({ color: resortPalette.roof, alpha: asset.enabled ? 0.98 : 0.42 });
          graphic.stroke({ width: 1.2, color: resortPalette.accent, alpha: 0.85 });
          const windows = asset.kind === "hotel" ? Math.min(5, 2 + asset.tier) : 2;
          for (let windowIndex = 0; windowIndex < windows; windowIndex++) {
            const windowX = center.x - structureWidth * 0.32 + windowIndex * structureWidth * 0.64 / Math.max(1, windows - 1);
            graphic.roundRect(windowX - 1.8, center.y - structureHeight * 0.48, 3.6, 4.5, 0.7);
            graphic.fill({ color: 0x8fc5d6, alpha: asset.enabled ? 0.92 : 0.3 });
          }
        }
        if (snapshot.hasResortServicePressure) {
          for (let stripe = 0; stripe < 3; stripe++) {
            graphic.moveTo(corners[0].x + stripe * 8, corners[0].y - 5);
            graphic.lineTo(corners[0].x + stripe * 8 + 10, corners[0].y + 5);
          }
          graphic.stroke({ width: 2, color: 0xfff2c4, alpha: 0.95 });
        }
      }
      if (asset.kind === "shuttle") {
        const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
        const destination = lodgingAssets[0];
        if (destination) {
          const target = worldToIso(
            destination.x + destination.width / 2,
            destination.y + destination.height / 2,
            surfaceHeightAt(
              destination.x + destination.width / 2,
              destination.y + destination.height / 2,
            ),
            rotation,
          );
          graphic.moveTo(center.x, center.y - 5);
          graphic.lineTo(target.x, target.y - 5);
          graphic.stroke({ width: 2, color: resortPalette.accent, alpha: 0.78 });
        }
        graphic.roundRect(center.x - 15, center.y - 15, 30, 13, 3);
        graphic.fill({ color: 0xf3e5bd, alpha: asset.enabled ? 0.98 : 0.38 });
        graphic.stroke({ width: 2, color: 0x314d58, alpha: 0.9 });
        for (let windowIndex = 0; windowIndex < 3; windowIndex++) {
          graphic.roundRect(center.x - 10 + windowIndex * 8, center.y - 12, 6, 5, 1);
          graphic.fill({ color: 0x79a9bb, alpha: 0.9 });
        }
        graphic.circle(center.x - 9, center.y - 1, 3);
        graphic.circle(center.x + 9, center.y - 1, 3);
        graphic.fill({ color: 0x2b2d2e, alpha: 0.95 });
      }
      if (!asset.enabled) {
        const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
        graphic.moveTo(center.x - 10, center.y - 10);
        graphic.lineTo(center.x + 10, center.y + 10);
        graphic.moveTo(center.x + 10, center.y - 10);
        graphic.lineTo(center.x - 10, center.y + 10);
        graphic.stroke({ width: 3, color: 0xf3eee2, alpha: 0.95 });
      }
      if (asset.category === "practice" && asset.route?.points.length) {
        asset.route.points.forEach((point, index) => {
          const iso = worldToIso(point.x + 0.5, point.y + 0.5, elevation, rotation);
          if (index === 0) graphic.moveTo(iso.x, iso.y);
          else graphic.lineTo(iso.x, iso.y);
        });
        graphic.stroke({ width: 2 + asset.tier * 0.4, color: 0xf7e9a8, alpha: asset.enabled ? 0.9 : 0.35 });
        for (const station of asset.stations ?? []) {
          const iso = worldToIso(station.x + 0.5, station.y + 0.5, elevation, rotation);
          graphic.circle(iso.x, iso.y, station.kind === "target" ? 4 : 3);
          graphic.fill({ color: station.kind === "target" ? 0xe9b84b : 0xfff6d7, alpha: asset.enabled ? 0.95 : 0.35 });
        }
      }
      if (asset.kind === "parking" || asset.kind === "overflow_parking") {
        const cars = Math.min(7, asset.tier + 2);
        for (let index = 0; index < cars; index++) {
          const wx = asset.x + 0.8 + (index % 4) * Math.max(0.8, (asset.width - 1.6) / 4);
          const wy = asset.y + 0.8 + Math.floor(index / 4) * 1.2;
          const car = worldToIso(wx, wy, elevation, rotation);
          graphic.roundRect(car.x - 4, car.y - 2, 8, 4, 1);
          graphic.fill({ color: [0xe8d7a8, 0x7e9faf, 0xa46357][index % 3], alpha: asset.enabled ? 0.95 : 0.35 });
        }
      }
      if (asset.kind === "netting") {
        const from = worldToIso(asset.x, asset.y, elevation, rotation);
        const to = worldToIso(asset.x + asset.width, asset.y + asset.height, elevation, rotation);
        graphic.moveTo(from.x, from.y - 18 - asset.tier * 2);
        graphic.lineTo(to.x, to.y - 18 - asset.tier * 2);
        graphic.stroke({ width: 2, color: 0x355c3d, alpha: asset.condition });
      }
      if (asset.kind === "screening" || asset.kind === "safety_buffer") {
        const count = Math.min(12, 4 + asset.tier * 2);
        for (let index = 0; index < count; index++) {
          const wx = asset.x + asset.width * (index + 0.5) / count;
          const wy = asset.y + asset.height * (0.35 + (index % 2) * 0.3);
          const center = worldToIso(wx, wy, elevation, rotation);
          graphic.circle(center.x, center.y - 5 - (asset.coverageHeight ?? 4), 3.5 + asset.tier * 0.35);
          graphic.fill({ color: asset.kind === "screening" ? 0x2f663d : 0x4d7d48, alpha: asset.condition });
        }
      }
      if (asset.kind === "safety_fence" || asset.kind === "berm") {
        const from = worldToIso(asset.x, asset.y + asset.height / 2, elevation, rotation);
        const to = worldToIso(asset.x + asset.width, asset.y + asset.height / 2, elevation, rotation);
        graphic.moveTo(from.x, from.y - (asset.kind === "berm" ? 7 : 4));
        graphic.lineTo(to.x, to.y - (asset.kind === "berm" ? 7 : 4));
        graphic.stroke({ width: asset.kind === "berm" ? 7 : 2, color: asset.kind === "berm" ? 0x806a42 : 0x5c5d57, alpha: asset.condition });
      }
      if (asset.kind === "warning_signage") {
        const center = worldToIso(asset.x + asset.width / 2, asset.y + asset.height / 2, elevation, rotation);
        graphic.poly([center.x, center.y - 13, center.x - 6, center.y - 2, center.x + 6, center.y - 2]);
        graphic.fill({ color: 0xe6b942, alpha: asset.condition });
        graphic.stroke({ width: 1.5, color: 0x55472f, alpha: 0.9 });
      }
      if ((asset.constructionDaysRemaining ?? 0) > 0) {
        const first = worldToIso(asset.x, asset.y + asset.height, elevation, rotation);
        const second = worldToIso(asset.x + asset.width, asset.y, elevation, rotation);
        graphic.moveTo(first.x, first.y - 4);
        graphic.lineTo(second.x, second.y - 4);
        graphic.stroke({ width: 4, color: 0xe0a32f, alpha: 0.9 });
      }
      graphic.zIndex = (asset.x + asset.width + asset.y + asset.height) * 10 + 5;
      objects.addChild(graphic);
      graphics.push(graphic);
    }
  };

  return {
    id: "propertyAssets",
    create: render,
    update: render,
    destroy: clear,
    contentCount: () => graphics.length,
  };
}
