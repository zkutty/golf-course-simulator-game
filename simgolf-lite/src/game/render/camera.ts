import type { Point } from "../models/types";

export interface CameraState {
  mode: "global" | "hole";
  holeId?: number;
  center: Point; // world coordinates (tile space)
  zoom: number;
  rotationDeg: number; // rotation in degrees (0 = no rotation, positive = clockwise)
  bounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export function computeHoleCamera(
  tee: Point,
  green: Point,
  paddingTiles: number,
  zoom: number,
  _canvasWidth: number,
  _canvasHeight: number
): CameraState {
  // Compute angle from tee to green (in degrees, 0 = pointing up)
  const dx = green.x - tee.x;
  const dy = green.y - tee.y;
  const angleRad = Math.atan2(dx, -dy); // -dy because canvas y increases downward
  const rotationDeg = (angleRad * 180) / Math.PI;

  // Center point between tee and green
  const centerX = (tee.x + green.x) / 2;
  const centerY = (tee.y + green.y) / 2;

  // Compute bounding box with padding
  const minX = Math.min(tee.x, green.x) - paddingTiles;
  const minY = Math.min(tee.y, green.y) - paddingTiles;
  const maxX = Math.max(tee.x, green.x) + paddingTiles;
  const maxY = Math.max(tee.y, green.y) + paddingTiles;

  return {
    mode: "hole",
    center: { x: centerX, y: centerY },
    zoom,
    rotationDeg,
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * Apply camera transform to a world point to get screen coordinates
 */
export function worldToScreen(
  worldPoint: Point,
  camera: CameraState,
  tileSize: number,
  canvasWidth: number,
  canvasHeight: number
): Point {
  // Translate to center
  let x = worldPoint.x - camera.center.x;
  let y = worldPoint.y - camera.center.y;

  // Rotate (counter-clockwise, so negate the angle)
  const angleRad = (-camera.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotatedX = x * cos - y * sin;
  const rotatedY = x * sin + y * cos;
  x = rotatedX;
  y = rotatedY;

  // Scale
  x *= camera.zoom;
  y *= camera.zoom;

  // Convert to pixels and center on canvas
  x = x * tileSize + canvasWidth / 2;
  y = y * tileSize + canvasHeight / 2;

  return { x, y };
}

/**
 * Convert screen coordinates to world (tile) coordinates
 */
export function screenToWorld(
  screenPoint: Point,
  camera: CameraState,
  tileSize: number,
  canvasWidth: number,
  canvasHeight: number
): Point {
  // Convert to centered pixel coordinates
  let x = (screenPoint.x - canvasWidth / 2) / tileSize;
  let y = (screenPoint.y - canvasHeight / 2) / tileSize;

  // Un-scale
  x /= camera.zoom;
  y /= camera.zoom;

  // Un-rotate (clockwise rotation)
  const angleRad = (camera.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const unrotatedX = x * cos + y * sin;
  const unrotatedY = -x * sin + y * cos;
  x = unrotatedX;
  y = unrotatedY;

  // Translate back
  x += camera.center.x;
  y += camera.center.y;

  return { x, y };
}

/**
 * Apply camera transform to canvas context
 * Note: Does not save/restore context; caller should manage that
 */
export function applyCameraTransform(
  ctx: CanvasRenderingContext2D,
  camera: CameraState,
  tileSize: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  // Reset to identity first
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  
  // Center
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  
  // Scale
  ctx.scale(camera.zoom, camera.zoom);
  
  // Rotate (counter-clockwise, so negate the angle)
  ctx.rotate((-camera.rotationDeg * Math.PI) / 180);
  
  // Translate to camera center (in tile space, scale by tileSize)
  ctx.translate(-camera.center.x * tileSize, -camera.center.y * tileSize);
}

