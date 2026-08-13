import * as PIXI from "pixi.js";
import { getPinPosition } from "../../../game/models/courseSetup";
import type { Point } from "../../../game/models/types";
import { TILE_H, TILE_W, tileCenterIso, worldToIso } from "../../../game/render/iso";
import type { RenderSceneSystem } from "../SceneSystemHost";

const ROUTE_LABEL = "route-overlay";

export type ArchitectureOverlayTestLayer = "all" | "traces" | "points" | "none";
export interface ArchitectureOverlayTestState {
  layer: ArchitectureOverlayTestLayer;
  visibleRouteLayers: number;
  cellsVisible: boolean;
  tracesVisible: boolean;
  pointsVisible: boolean;
}

type TestWindow = Window & {
  __ccArchitectureOverlayProjection?: object;
  __ccArchitectureOverlayTestLayer?: ArchitectureOverlayTestLayer;
  __ccArchitectureOverlayTestState?: ArchitectureOverlayTestState;
  __ccSetArchitectureOverlayTestLayer?: (layer: ArchitectureOverlayTestLayer) => ArchitectureOverlayTestState;
};

/** Owns all route, Architecture-review, pace, and corridor decals. */
export function createArchitectureOverlaySceneSystem(
  layer: PIXI.Container,
  requestRender: () => void = () => undefined,
): RenderSceneSystem {
  let testLayer: ArchitectureOverlayTestLayer = "all";

  const clear = () => {
    layer.children.filter((child) => child.label === ROUTE_LABEL).forEach((child) => {
      layer.removeChild(child);
      child.destroy();
    });
  };

  const clearTestControls = () => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    const testWindow = window as TestWindow;
    delete testWindow.__ccArchitectureOverlayProjection;
    delete testWindow.__ccArchitectureOverlayTestState;
    delete testWindow.__ccSetArchitectureOverlayTestLayer;
  };

  return {
    id: "architectureOverlay",
    render(snapshot) {
      clear();
      clearTestControls();
      if (snapshot.showMarkers === false) return;

      const project = (point: Point) => tileCenterIso(
        point.x,
        point.y,
        snapshot.surfaceHeightAt(point.x + 0.5, point.y + 0.5),
        snapshot.rotation,
      );
      let referenceLayerGraphics: { cells: PIXI.Graphics; traces: PIXI.Graphics; points: PIXI.Graphics } | null = null;

      if (snapshot.architectureWarnings?.length) {
        const graphics = new PIXI.Graphics();
        for (const warning of snapshot.architectureWarnings) {
          const points = warning.geometry?.length ? warning.geometry : warning.location ? [warning.location] : [];
          if (points.length > 1) {
            const first = project(points[0]);
            graphics.moveTo(first.x, first.y);
            for (let index = 1; index < points.length; index += 1) {
              const point = project(points[index]);
              graphics.lineTo(point.x, point.y);
            }
            graphics.stroke({ width: warning.severity === "warning" ? 4 : 2, color: 0xf3a712, alpha: 0.86 });
          }
          if (warning.location) {
            const point = project(warning.location);
            graphics.circle(point.x, point.y, warning.severity === "warning" ? 8 : 5);
            graphics.stroke({ width: 3, color: 0x3f2200, alpha: 0.95 });
            graphics.circle(point.x, point.y, warning.severity === "warning" ? 5 : 3);
            graphics.fill({ color: 0xffc857, alpha: 0.95 });
          }
        }
        graphics.label = ROUTE_LABEL;
        layer.addChild(graphics);
      }

      if (snapshot.architectureOverlay) {
        const isolateReferenceLayers = import.meta.env.DEV && snapshot.architectureOverlay.kind === "reference";
        const cells = new PIXI.Graphics();
        const traces = isolateReferenceLayers ? new PIXI.Graphics() : cells;
        const points = isolateReferenceLayers ? new PIXI.Graphics() : cells;
        const patternMark = (graphics: PIXI.Graphics, x: number, y: number, pattern: "solid" | "dots" | "cross" | "diagonal" | undefined, radius: number, color = 0xffffff) => {
          if (pattern === "dots") {
            graphics.circle(x - radius * 0.32, y, Math.max(1.2, radius * 0.11));
            graphics.circle(x + radius * 0.32, y, Math.max(1.2, radius * 0.11));
            graphics.fill({ color, alpha: 0.95 });
          } else if (pattern === "cross") {
            graphics.moveTo(x - radius * 0.45, y); graphics.lineTo(x + radius * 0.45, y);
            graphics.moveTo(x, y - radius * 0.45); graphics.lineTo(x, y + radius * 0.45);
            graphics.stroke({ width: 2, color, alpha: 0.95 });
          } else if (pattern === "diagonal") {
            graphics.moveTo(x - radius * 0.5, y + radius * 0.3); graphics.lineTo(x + radius * 0.1, y - radius * 0.3);
            graphics.moveTo(x - radius * 0.1, y + radius * 0.3); graphics.lineTo(x + radius * 0.5, y - radius * 0.3);
            graphics.stroke({ width: 1.8, color, alpha: 0.95 });
          }
        };

        for (const cell of snapshot.architectureOverlay.cells) {
          const top = worldToIso(cell.x + 0.5, cell.y, snapshot.surfaceHeightAt(cell.x + 0.5, cell.y), snapshot.rotation);
          const intensity = Math.min(1, 0.22 + Math.log2(cell.value + 1) * 0.16);
          cells.poly([top.x, top.y, top.x + TILE_W / 2, top.y + TILE_H / 2, top.x, top.y + TILE_H, top.x - TILE_W / 2, top.y + TILE_H / 2]);
          const color = cell.source === "predicted" ? 0xf0a51a : cell.current ? 0x28a69a : 0x7b6aa8;
          cells.fill({ color, alpha: cell.current ? intensity : Math.min(0.48, intensity) });
          if (!cell.current) cells.stroke({ width: 1, color: 0xf6e8ff, alpha: 0.75 });
          patternMark(cells, top.x, top.y + TILE_H / 2, cell.pattern, Math.max(7, TILE_H * 0.35));
        }
        for (const trace of snapshot.architectureOverlay.traces) {
          const from = project(trace.from);
          const to = project(trace.to);
          traces.moveTo(from.x, from.y);
          traces.lineTo(to.x, to.y);
          const color = trace.source === "reference" ? 0x4b78c2 : trace.source === "predicted" ? 0xf0a51a : trace.emphasized ? 0xfff08a : trace.current ? 0x29d7c0 : 0x9a7bc1;
          traces.stroke({ width: trace.emphasized ? 5 : 2.5, color, alpha: trace.current ? 0.9 : 0.6 });
          traces.circle(to.x, to.y, trace.emphasized ? 6 : 3);
          traces.fill({ color, alpha: 0.9 });
          patternMark(traces, (from.x + to.x) / 2, (from.y + to.y) / 2, trace.pattern, trace.emphasized ? 8 : 6);
        }
        for (const point of snapshot.architectureOverlay.points) {
          const projected = project(point);
          const radius = Math.min(13, Math.max(4, 4 + Math.abs(point.value) * 0.35));
          const color = point.source === "reference" ? 0x6e96da : point.source === "predicted" ? 0xf0a51a : point.current ? 0x36cfc9 : 0x8d77b7;
          points.circle(projected.x, projected.y, radius);
          points.fill({ color, alpha: 0.35 });
          points.stroke({ width: 2, color: point.current ? 0xeafffb : 0xf1e9ff, alpha: 0.9 });
          patternMark(points, projected.x, projected.y, point.pattern, radius);
        }
        const graphics = isolateReferenceLayers ? [cells, traces, points] : [cells];
        graphics.forEach((item) => { item.label = ROUTE_LABEL; });
        layer.addChild(...graphics);
        if (isolateReferenceLayers) referenceLayerGraphics = { cells, traces, points };
        if (isolateReferenceLayers && typeof window !== "undefined") {
          const screenPoint = (point: Point) => {
            const local = project(point);
            const global = traces.toGlobal(local);
            return { x: global.x, y: global.y };
          };
          (window as TestWindow).__ccArchitectureOverlayProjection = {
            traces: snapshot.architectureOverlay.traces.map((trace) => ({ id: trace.id, from: screenPoint(trace.from), to: screenPoint(trace.to) })),
            points: snapshot.architectureOverlay.points.map((point) => ({ id: point.id, center: screenPoint(point), radius: Math.min(13, Math.max(4, 4 + Math.abs(point.value) * 0.35)) })),
          };
        }
      }

      if (snapshot.paceBottlenecks?.length) {
        const graphics = new PIXI.Graphics();
        for (const finding of snapshot.paceBottlenecks) {
          const hole = snapshot.holes.find((candidate) => candidate.id === finding.holeId);
          const point = hole ? getPinPosition(hole, snapshot.course.activePinRotation ?? "A") ?? hole.green ?? hole.tee : null;
          if (!point) continue;
          const center = project(point);
          const radius = Math.min(18, 8 + finding.intensity * 0.6);
          const color = finding.severity === "severe" ? 0xd8563a : finding.severity === "high" ? 0xe7a83e : 0xf2d36f;
          graphics.circle(center.x, center.y, radius);
          graphics.fill({ color, alpha: 0.18 });
          graphics.stroke({ width: finding.severity === "severe" ? 4 : 2.5, color, alpha: 0.95 });
          const ticks = finding.severity === "severe" ? 6 : finding.severity === "high" ? 4 : 2;
          for (let index = 0; index < ticks; index += 1) {
            const angle = Math.PI * 2 * index / ticks;
            graphics.moveTo(center.x + Math.cos(angle) * (radius + 2), center.y + Math.sin(angle) * (radius + 2));
            graphics.lineTo(center.x + Math.cos(angle) * (radius + 7), center.y + Math.sin(angle) * (radius + 7));
          }
          graphics.stroke({ width: 2, color: 0xffffff, alpha: 0.92 });
        }
        graphics.label = ROUTE_LABEL;
        layer.addChild(graphics);
      }

      if (snapshot.showFixOverlay && snapshot.failingCorridorSegments?.length) {
        const graphics = new PIXI.Graphics();
        for (const segment of snapshot.failingCorridorSegments) {
          const top = worldToIso(segment.x + 0.5, segment.y, snapshot.surfaceHeightAt(segment.x + 0.5, segment.y), snapshot.rotation);
          graphics.poly([top.x, top.y, top.x + TILE_W / 2, top.y + TILE_H / 2, top.x, top.y + TILE_H, top.x - TILE_W / 2, top.y + TILE_H / 2]);
          graphics.fill({ color: 0xd23b2f, alpha: 0.35 });
        }
        graphics.label = ROUTE_LABEL;
        layer.addChild(graphics);
      }

      if (snapshot.showShotPlan && snapshot.activePath && snapshot.activePath.length > 1) {
        const graphics = new PIXI.Graphics();
        const first = project(snapshot.activePath[0]);
        graphics.moveTo(first.x, first.y);
        for (const point of snapshot.activePath.slice(1)) {
          const projected = project(point);
          graphics.lineTo(projected.x, projected.y);
        }
        graphics.stroke({ width: 6, color: 0x173f31, alpha: 0.9 });
        graphics.moveTo(first.x, first.y);
        for (const point of snapshot.activePath.slice(1)) {
          const projected = project(point);
          graphics.lineTo(projected.x, projected.y);
        }
        graphics.stroke({ width: 3, color: 0xf7cf62, alpha: 1 });
        for (const point of snapshot.activePath) {
          const projected = project(point);
          graphics.circle(projected.x, projected.y, 4);
          graphics.fill({ color: 0xfff4ba, alpha: 1 });
          graphics.stroke({ width: 2, color: 0x173f31, alpha: 1 });
        }
        graphics.label = ROUTE_LABEL;
        layer.addChild(graphics);
      }

      if (import.meta.env.DEV && referenceLayerGraphics && typeof window !== "undefined") {
        const testWindow = window as TestWindow;
        const applyTestLayer = (next: ArchitectureOverlayTestLayer): ArchitectureOverlayTestState => {
          testLayer = next;
          testWindow.__ccArchitectureOverlayTestLayer = next;
          for (const child of layer.children) if (child.label === ROUTE_LABEL) child.visible = next === "all";
          referenceLayerGraphics!.cells.visible = next === "all";
          referenceLayerGraphics!.traces.visible = next === "all" || next === "traces";
          referenceLayerGraphics!.points.visible = next === "all" || next === "points";
          const state = {
            layer: next,
            visibleRouteLayers: layer.children.filter((child) => child.label === ROUTE_LABEL && child.visible).length,
            cellsVisible: referenceLayerGraphics!.cells.visible,
            tracesVisible: referenceLayerGraphics!.traces.visible,
            pointsVisible: referenceLayerGraphics!.points.visible,
          };
          testWindow.__ccArchitectureOverlayTestState = state;
          requestRender();
          return state;
        };
        testWindow.__ccSetArchitectureOverlayTestLayer = applyTestLayer;
        applyTestLayer(testLayer);
      }
    },
    dispose() {
      clear();
      clearTestControls();
    },
  };
}
