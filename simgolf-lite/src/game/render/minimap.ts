import type { Point } from "../models/types";
import type { BoundingBox } from "./camera";
import { ELEVATION_STEP_PX, TILE_H, TILE_W, worldToIso } from "./iso";

export const MINIMAP_SIZE = 214;
const PAD = 15;

export interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  minIsoX: number;
  minIsoY: number;
}

function isoExtent(bounds: BoundingBox) {
  const corners = [
    worldToIso(bounds.minX, bounds.minY),
    worldToIso(bounds.maxX + 1, bounds.minY),
    worldToIso(bounds.maxX + 1, bounds.maxY + 1),
    worldToIso(bounds.minX, bounds.maxY + 1),
  ];
  return {
    minX: Math.min(...corners.map((p) => p.x)) - TILE_W / 2,
    maxX: Math.max(...corners.map((p) => p.x)) + TILE_W / 2,
    minY: Math.min(...corners.map((p) => p.y)) - 15 * ELEVATION_STEP_PX - TILE_H / 2,
    maxY: Math.max(...corners.map((p) => p.y)) + TILE_H / 2,
  };
}

export function makeMinimapTransform(bounds: BoundingBox): MinimapTransform {
  const e = isoExtent(bounds);
  const scale = Math.min((MINIMAP_SIZE - PAD * 2) / Math.max(1, e.maxX - e.minX), (MINIMAP_SIZE - PAD * 2) / Math.max(1, e.maxY - e.minY));
  return {
    scale,
    minIsoX: e.minX,
    minIsoY: e.minY,
    offsetX: (MINIMAP_SIZE - (e.maxX - e.minX) * scale) / 2,
    offsetY: (MINIMAP_SIZE - (e.maxY - e.minY) * scale) / 2,
  };
}

export function minimapCanvasPoint(point: Point, transform: MinimapTransform): Point {
  return {
    x: transform.offsetX + (point.x - transform.minIsoX) * transform.scale,
    y: transform.offsetY + (point.y - transform.minIsoY) * transform.scale,
  };
}

export function minimapPointToWorld(point: Point, transform: MinimapTransform): Point {
  const isoX = (point.x - transform.offsetX) / transform.scale + transform.minIsoX;
  const isoY = (point.y - transform.offsetY) / transform.scale + transform.minIsoY;
  return {
    x: isoX / TILE_W + isoY / TILE_H,
    y: isoY / TILE_H - isoX / TILE_W,
  };
}
