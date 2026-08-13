import * as PIXI from "pixi.js";
import { buildGreenSurfaceOverlayCommands } from "../../../game/greens/greenSurfaceRender";
import type { Course, Point, SurfaceFeature } from "../../../game/models/types";
import {
  defaultSurfaceTangents,
  sampleCorridor,
  sampleRegion,
} from "../../../game/models/surfaceIntent";
import { worldToIso } from "../../../game/render/iso";
import type {
  RenderSnapshot,
  SurfaceEditorRenderSnapshot,
} from "../../../game/render/renderSnapshot";
import type { RenderSceneSystem } from "../SceneSystemHost";

function surfaceFeaturePoints(feature: SurfaceFeature): Point[] {
  return feature.geometry.kind === "corridor"
    ? feature.geometry.knots
    : feature.geometry.ring;
}

function sampledSurfacePath(feature: SurfaceFeature): Point[] {
  return feature.geometry.kind === "corridor"
    ? sampleCorridor(feature.geometry.knots, 0.2, feature.geometry.tangents)
    : sampleRegion(feature.geometry.ring, feature.geometry.tangents);
}

function drawSurfaceEditor(
  graphics: PIXI.Graphics,
  state: SurfaceEditorRenderSnapshot | undefined,
): void {
  graphics.clear();
  if (!state) return;

  const project = (point: Point) => worldToIso(
    point.x,
    point.y,
    state.surfaceHeightAt(point.x, point.y),
    state.rotation,
  );

  if (state.editorMode === "SCULPT" || state.showGridOverlays) {
    // greenSurfaceRender consumes exactly this compact Course projection.
    const course = {
      width: state.width,
      height: state.height,
      tiles: state.tiles,
      elevations: state.elevations,
      greenSurface: state.greenSurface,
    } as Course;
    const overlay = buildGreenSurfaceOverlayCommands({
      course,
      surface: state.previewSurface,
      colorVision: state.colorVision,
      quality: state.graphicsQuality,
    });
    for (const shade of overlay.shades) {
      const corners = [
        project({ x: shade.x + 0.5, y: shade.y }),
        project({ x: shade.x + 1, y: shade.y + 0.5 }),
        project({ x: shade.x + 0.5, y: shade.y + 1 }),
        project({ x: shade.x, y: shade.y + 0.5 }),
      ];
      graphics.poly(corners.flatMap((point) => [point.x, point.y]));
      graphics.fill({
        color: shade.uphill ? overlay.palette.uphill : overlay.palette.downhill,
        alpha: shade.intensity,
      });
    }
    for (const contour of overlay.contours) {
      const from = project(contour.from);
      const to = project(contour.to);
      graphics.moveTo(from.x, from.y);
      graphics.lineTo(to.x, to.y);
      graphics.stroke({ width: contour.major ? 2.5 : 1.7, color: overlay.palette.outline, alpha: 0.58, cap: "round" });
      graphics.moveTo(from.x, from.y);
      graphics.lineTo(to.x, to.y);
      graphics.stroke({ width: contour.major ? 1.2 : 0.75, color: overlay.palette.contour, alpha: 0.92, cap: "round" });
    }
    for (const line of overlay.fallLines) {
      const from = project(line.from);
      const to = project(line.to);
      graphics.moveTo(from.x, from.y);
      graphics.lineTo(to.x, to.y);
      graphics.stroke({ width: 2.6, color: overlay.palette.outline, alpha: 0.72, cap: "round" });
      // Alternating light dots make fall direction legible without hue.
      for (const fraction of [0.2, 0.5, 0.8]) {
        graphics.circle(from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction, 1.5);
        graphics.fill({ color: overlay.palette.contour, alpha: 0.95 });
      }
    }
    for (const arrow of overlay.arrows) {
      const at = project(arrow.at);
      const tip = project({
        x: arrow.at.x + arrow.downhill.x * 0.22,
        y: arrow.at.y + arrow.downhill.y * 0.22,
      });
      const tail = project({
        x: arrow.at.x - arrow.downhill.x * 0.12,
        y: arrow.at.y - arrow.downhill.y * 0.12,
      });
      graphics.moveTo(tail.x, tail.y);
      graphics.lineTo(tip.x, tip.y);
      graphics.stroke({ width: 2.2, color: overlay.palette.downhill, alpha: 0.96, cap: "round" });
      const angle = Math.atan2(tip.y - at.y, tip.x - at.x);
      for (const side of [-1, 1]) {
        graphics.moveTo(tip.x, tip.y);
        graphics.lineTo(tip.x - Math.cos(angle + side * 0.55) * 6, tip.y - Math.sin(angle + side * 0.55) * 6);
        graphics.stroke({ width: 2, color: overlay.palette.downhill, alpha: 0.96, cap: "round" });
      }
    }
  }

  if (state.editorMode !== "PAINT") return;
  const drawPath = (points: readonly Point[], closed: boolean, color: number, alpha: number) => {
    if (points.length < 2) return;
    const first = project(points[0]);
    graphics.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index++) {
      const current = project(points[index]);
      graphics.lineTo(current.x, current.y);
    }
    if (closed) graphics.lineTo(first.x, first.y);
    graphics.stroke({ width: 2.2, color, alpha, cap: "round", join: "round" });
  };

  if (state.terrainTool === "spline" && state.splineDraft.length > 0) {
    const previewPoints = state.splineHover
      ? [...state.splineDraft, state.splineHover]
      : state.splineDraft;
    drawPath(sampleCorridor(previewPoints), false, 0xffe28a, 0.95);
    for (const point of state.splineDraft) {
      const projected = project(point);
      graphics.circle(projected.x, projected.y, 4.5);
      graphics.fill({ color: 0xfff4bf, alpha: 0.98 });
      graphics.stroke({ width: 1.5, color: 0x493712, alpha: 0.95 });
    }
  }

  if (state.terrainTool === "edit" && state.selectedFeature) {
    drawPath(
      sampledSurfacePath(state.selectedFeature),
      state.selectedFeature.geometry.kind === "region",
      0xffe28a,
      0.95,
    );
    const points = surfaceFeaturePoints(state.selectedFeature);
    points.forEach((point, index) => {
      const projected = project(point);
      graphics.circle(projected.x, projected.y, index === state.selectedNode ? 6 : 4.5);
      graphics.fill({
        color: index === state.selectedNode ? 0xffc64c : 0xfff4bf,
        alpha: 0.98,
      });
      graphics.stroke({ width: 1.5, color: 0x493712, alpha: 0.95 });
    });
    if (state.selectedNode != null && points[state.selectedNode]) {
      const tangents = state.selectedFeature.geometry.tangents
        ?? defaultSurfaceTangents(
          points,
          state.selectedFeature.geometry.kind === "region",
        );
      const handles = tangents[state.selectedNode];
      const node = project(points[state.selectedNode]);
      for (const handle of [handles.in, handles.out]) {
        const projected = project(handle);
        graphics.moveTo(node.x, node.y);
        graphics.lineTo(projected.x, projected.y);
        graphics.stroke({ width: 1.2, color: 0xfff0b0, alpha: 0.85 });
        graphics.circle(projected.x, projected.y, 3.8);
        graphics.fill({ color: 0x5ea8ff, alpha: 0.98 });
        graphics.stroke({ width: 1.2, color: 0x17385d, alpha: 0.95 });
      }
    }
  }
}

/** Owns the single persistent Graphics child attached to layers.surfaceEditor. */
export function createSurfaceEditorSceneSystem(
  layer: PIXI.Container,
  createGraphics: () => PIXI.Graphics = () => new PIXI.Graphics(),
): RenderSceneSystem {
  let graphics: PIXI.Graphics | null = null;

  return {
    id: "surfaceEditor",
    create(snapshot: RenderSnapshot) {
      const next = createGraphics();
      layer.addChild(next);
      graphics = next;
      drawSurfaceEditor(next, snapshot.surfaceEditor);
    },
    update(snapshot: RenderSnapshot) {
      if (!graphics) throw new Error("Surface editor scene updated before creation");
      drawSurfaceEditor(graphics, snapshot.surfaceEditor);
    },
    destroy() {
      const owned = graphics;
      graphics = null;
      if (!owned) return;
      if (owned.parent) owned.parent.removeChild(owned);
      owned.destroy();
    },
  };
}
