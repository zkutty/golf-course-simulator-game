import * as PIXI from "pixi.js";
import { getPinPosition, getTeeBox } from "../../../game/models/courseSetup";
import { PIN_ROTATIONS, TEE_SETS, type Point } from "../../../game/models/types";
import { TILE_H, TILE_W, tileCenterIso, worldToIso } from "../../../game/render/iso";
import { entityDepth } from "../../../game/render/objectPlacement";
import type { RenderSnapshot } from "../RenderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

const MARKER_LABEL = "hole-marker";
const FLAG_LABEL = "hole-pin-flag";

export interface HoleMarkersSceneDependencies {
  readonly createGraphics?: () => PIXI.Graphics;
}

export interface HoleMarkersSceneSystem extends RenderSceneSystem {
  readonly id: "holeMarkers";
  tick(nowMs: number): void;
  markerCount(): number;
  flagCount(): number;
  rebuildCount(): number;
}

/** Owns every authored/draft tee and cup decal plus the live pin-flag pool. */
export function createHoleMarkersSceneSystem(
  terrainDecals: PIXI.Container,
  objects: PIXI.Container,
  dependencies: HoleMarkersSceneDependencies = {},
): HoleMarkersSceneSystem {
  const createGraphics = dependencies.createGraphics ?? (() => new PIXI.Graphics());
  let markerPool: PIXI.Graphics[] = [];
  let activeMarkerCount = 0;
  const flags = new Map<number, PIXI.Graphics>();
  let current: RenderSnapshot | null = null;
  let rebuilds = 0;

  const acquireMarker = () => {
    const index = activeMarkerCount++;
    const graphic = markerPool[index] ?? createGraphics();
    if (!markerPool[index]) markerPool.push(graphic);
    graphic.clear();
    graphic.visible = true;
    graphic.label = MARKER_LABEL;
    // The legacy effect recreated marker graphics as direct terrain-decal
    // children. Re-appending on every marker revision preserves its stacking
    // above already-mounted route/architecture overlays for marker-only edits.
    graphic.parent?.removeChild(graphic);
    terrainDecals.addChild(graphic);
    return graphic;
  };

  const hideUnusedMarkers = () => {
    for (let index = activeMarkerCount; index < markerPool.length; index++) {
      markerPool[index].clear();
      markerPool[index].visible = false;
    }
  };

  const drawMarker = (snapshot: RenderSnapshot, point: Point, fill: number, alpha = 1) => {
    const graphic = acquireMarker();
    const center = tileCenterIso(
      point.x,
      point.y,
      snapshot.surfaceHeightAt(point.x + 0.5, point.y + 0.5),
      snapshot.rotation,
    );
    graphic.ellipse(center.x, center.y, TILE_W * 0.18, TILE_H * 0.36);
    graphic.fill({ color: fill, alpha });
    graphic.stroke({ width: 2, color: 0xffffff, alpha });
  };

  const drawTee = (snapshot: RenderSnapshot, tee: Point, green: Point | null, alpha = 1) => {
    const graphic = acquireMarker();
    const elevation = snapshot.surfaceHeightAt(tee.x + 0.5, tee.y + 0.5);
    const center = tileCenterIso(tee.x, tee.y, elevation, snapshot.rotation);
    graphic.ellipse(center.x, center.y, TILE_W * 0.3, TILE_H * 0.3);
    graphic.fill({ color: 0x9a7a58, alpha: 0.9 * alpha });
    let perpendicularX = 0.7;
    let perpendicularY = -0.7;
    if (green) {
      const deltaX = green.x - tee.x;
      const deltaY = green.y - tee.y;
      const length = Math.max(1e-6, Math.hypot(deltaX, deltaY));
      perpendicularX = -deltaY / length;
      perpendicularY = deltaX / length;
    }
    for (const side of [-0.28, 0.28]) {
      const marker = worldToIso(
        tee.x + 0.5 + perpendicularX * side,
        tee.y + 0.5 + perpendicularY * side,
        elevation,
        snapshot.rotation,
      );
      graphic.circle(marker.x, marker.y - 2, 2.2);
      graphic.fill({ color: 0xe8c15a, alpha });
      graphic.stroke({ width: 1, color: 0x6b5426, alpha });
    }
  };

  const drawCup = (snapshot: RenderSnapshot, green: Point, alpha = 1) => {
    const graphic = acquireMarker();
    const center = tileCenterIso(
      green.x,
      green.y,
      snapshot.surfaceHeightAt(green.x + 0.5, green.y + 0.5),
      snapshot.rotation,
    );
    graphic.ellipse(center.x, center.y, 4.5, 2.2);
    graphic.fill({ color: 0x1c2b1c, alpha });
    graphic.stroke({ width: 1, color: 0xe9efe4, alpha: 0.85 * alpha });
  };

  const drawFlag = (graphic: PIXI.Graphics, snapshot: RenderSnapshot, holeIndex: number, nowMs: number) => {
    const phase = snapshot.animationsEnabled ? nowMs / 160 + holeIndex * 1.3 : 0;
    const waveOne = Math.sin(phase) * 2.2;
    const waveTwo = Math.sin(phase + 0.9) * 3.2;
    const flagColor = snapshot.flagColor ?? "#d9534f";
    graphic.clear();
    graphic.moveTo(0, 0);
    graphic.lineTo(0, -34);
    graphic.stroke({ width: 1.5, color: 0xe9efe4 });
    graphic.poly([0, -34, 13, -30.5 + waveOne, 0, -26]);
    graphic.fill(flagColor);
    graphic.poly([9, -31.5 + waveOne * 0.8, 13, -30.5 + waveOne, 15.5, -29.5 + waveTwo, 9, -29]);
    graphic.fill({ color: flagColor, alpha: 0.85 });
  };

  const render = (snapshot: RenderSnapshot) => {
    current = snapshot;
    rebuilds++;
    activeMarkerCount = 0;
    if (snapshot.showMarkers !== false) {
      for (const hole of snapshot.holes) {
        const activeRotation = snapshot.course.activePinRotation ?? "A";
        const activePin = getPinPosition(hole, activeRotation) ?? getPinPosition(hole, "A");
        for (const teeSet of TEE_SETS) {
          const tee = getTeeBox(hole, teeSet);
          if (tee) drawTee(snapshot, tee, activePin, teeSet === (snapshot.selectedTeeSet ?? "member") ? 1 : 0.34);
        }
        for (const pinRotation of PIN_ROTATIONS) {
          const pin = getPinPosition(hole, pinRotation);
          if (pin) {
            const active = pinRotation === activeRotation
              || (!getPinPosition(hole, activeRotation) && pinRotation === "A");
            drawCup(snapshot, pin, active ? 1 : 0.28);
          }
        }
      }
      if (snapshot.draftTee) drawTee(snapshot, snapshot.draftTee, snapshot.draftGreen, 0.55);
      if (snapshot.draftGreen) drawMarker(snapshot, snapshot.draftGreen, 0x1b5e20, 0.55);
    }
    hideUnusedMarkers();

    const liveHoles = new Set<number>();
    snapshot.holes.forEach((hole, holeIndex) => {
      if (!hole.green) return;
      liveHoles.add(holeIndex);
      let graphic = flags.get(holeIndex);
      if (!graphic) {
        graphic = createGraphics();
        graphic.label = FLAG_LABEL;
        flags.set(holeIndex, graphic);
        objects.addChild(graphic);
      }
      const elevation = snapshot.surfaceHeightAt(hole.green.x + 0.5, hole.green.y + 0.5);
      const center = tileCenterIso(hole.green.x, hole.green.y, elevation, snapshot.rotation);
      graphic.position.set(center.x, center.y);
      graphic.zIndex = entityDepth(hole.green.x + 0.5, hole.green.y + 0.5, elevation, snapshot.rotation) + 0.05;
      drawFlag(graphic, snapshot, holeIndex, performance.now());
    });
    for (const [holeIndex, graphic] of flags) {
      if (liveHoles.has(holeIndex)) continue;
      graphic.parent?.removeChild(graphic);
      graphic.destroy();
      flags.delete(holeIndex);
    }
  };

  const destroy = () => {
    current = null;
    for (const graphic of markerPool) {
      graphic.parent?.removeChild(graphic);
      graphic.destroy();
    }
    markerPool = [];
    activeMarkerCount = 0;
    for (const graphic of flags.values()) {
      graphic.parent?.removeChild(graphic);
      graphic.destroy();
    }
    flags.clear();
  };

  return {
    id: "holeMarkers",
    create(snapshot) {
      render(snapshot);
    },
    update: render,
    destroy,
    tick(nowMs) {
      if (!current) return;
      for (const [holeIndex, graphic] of flags) drawFlag(graphic, current, holeIndex, nowMs);
    },
    markerCount: () => activeMarkerCount,
    flagCount: () => flags.size,
    rebuildCount: () => rebuilds,
  };
}
