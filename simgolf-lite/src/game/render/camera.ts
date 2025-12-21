import type { Point, Course, Hole } from "../models/types";
import { sampleLine } from "../sim/holes";
import { scoreHole } from "../sim/holes";

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

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Compute bounding box for a hole including:
 * - Tee and green positions
 * - Shot plan path
 * - Corridor buffer around path
 * - Obstacles
 * - Green fringe (1 tile around green)
 */
export function computeHoleBoundingBox(
  course: Course,
  hole: Hole,
  holeIndex: number,
  paddingTiles: number = 0
): BoundingBox | null {
  if (!hole.tee || !hole.green) return null;

  const tee = hole.tee;
  const green = hole.green;

  // Get path from scoring (shot plan polyline)
  const score = scoreHole(course, hole, holeIndex);
  const path = score.path.length > 0 ? score.path : [tee, green];

  // Compute corridor buffer (similar to evaluateHole)
  const straightDistYards = Math.sqrt(
    (tee.x - green.x) ** 2 + (tee.y - green.y) ** 2
  ) * course.yardsPerTile;
  let bufferTiles = 2; // default
  if (straightDistYards >= 350) bufferTiles = 4;
  else if (straightDistYards >= 200) bufferTiles = 3;

  // Collect all points to include
  const points: Point[] = [tee, green];

  // Add path points
  for (const p of path) {
    points.push(p);
  }

  // Add corridor buffer points (around path)
  const corridorPoints = sampleLine(tee, green, 50);
  for (const p of corridorPoints) {
    for (let dy = -bufferTiles; dy <= bufferTiles; dy++) {
      for (let dx = -bufferTiles; dx <= bufferTiles; dx++) {
        if (dx * dx + dy * dy <= bufferTiles * bufferTiles) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (q.x >= 0 && q.y >= 0 && q.x < course.width && q.y < course.height) {
            points.push(q);
          }
        }
      }
    }
  }

  // Add green fringe (1 tile around green)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx !== 0 || dy !== 0) {
        const q = { x: green.x + dx, y: green.y + dy };
        if (q.x >= 0 && q.y >= 0 && q.x < course.width && q.y < course.height) {
          points.push(q);
        }
      }
    }
  }

  // Add obstacles for this hole (approximate: obstacles near tee/green/path)
  // For simplicity, include all obstacles within reasonable distance
  const holeObstacles = (course.obstacles ?? []).filter((obs: { x: number; y: number }) => {
    const distToTee = Math.sqrt((obs.x - tee.x) ** 2 + (obs.y - tee.y) ** 2);
    const distToGreen = Math.sqrt((obs.x - green.x) ** 2 + (obs.y - green.y) ** 2);
    const maxDist = Math.max(
      Math.sqrt((tee.x - green.x) ** 2 + (tee.y - green.y) ** 2) * 0.5,
      10
    );
    return distToTee <= maxDist || distToGreen <= maxDist;
  });
  for (const obs of holeObstacles) {
    points.push({ x: obs.x, y: obs.y });
  }

  // Compute bounding box
  if (points.length === 0) return null;

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  // Add padding
  minX -= paddingTiles;
  minY -= paddingTiles;
  maxX += paddingTiles;
  maxY += paddingTiles;

  return { minX, minY, maxX, maxY };
}

/**
 * Compute zoom preset for specific hole regions
 */
export function computeZoomPreset(
  preset: "fit" | "tee" | "landing" | "green",
  course: Course,
  hole: Hole,
  holeIndex: number,
  canvasWidth: number,
  canvasHeight: number,
  tileSize?: number // optional tileSize for accurate zoom calculation
): CameraState | null {
  if (!hole.tee || !hole.green) return null;

  const tee = hole.tee;
  const green = hole.green;
  
  const straightDistYards = Math.sqrt((tee.x - green.x) ** 2 + (tee.y - green.y) ** 2) * course.yardsPerTile;

  let bbox: BoundingBox;
  
  if (preset === "fit") {
    const result = computeHoleBoundingBox(course, hole, holeIndex, 0);
    if (!result) return null;
    bbox = result;
  } else if (preset === "tee") {
    // Bbox around tee + first 60-90 yards
    const first90YardsTiles = Math.min(90 / course.yardsPerTile, straightDistYards / course.yardsPerTile * 0.4);
    const dirX = (green.x - tee.x) / straightDistYards * course.yardsPerTile;
    const dirY = (green.y - tee.y) / straightDistYards * course.yardsPerTile;
    const endpoint = { x: tee.x + dirX * first90YardsTiles, y: tee.y + dirY * first90YardsTiles };
    bbox = {
      minX: Math.min(tee.x, endpoint.x) - 3,
      minY: Math.min(tee.y, endpoint.y) - 3,
      maxX: Math.max(tee.x, endpoint.x) + 3,
      maxY: Math.max(tee.y, endpoint.y) + 3,
    };
  } else if (preset === "landing") {
    // First-shot landing band (35-50% distance)
    const startT = 0.35;
    const endT = 0.50;
    const startP = { x: tee.x + (green.x - tee.x) * startT, y: tee.y + (green.y - tee.y) * startT };
    const endP = { x: tee.x + (green.x - tee.x) * endT, y: tee.y + (green.y - tee.y) * endT };
    bbox = {
      minX: Math.min(startP.x, endP.x) - 8, // 8 tiles = ~80 yards buffer
      minY: Math.min(startP.y, endP.y) - 8,
      maxX: Math.max(startP.x, endP.x) + 8,
      maxY: Math.max(startP.y, endP.y) + 8,
    };
  } else { // green
    // Green + 30 yards
    const thirtyYardsTiles = 30 / course.yardsPerTile;
    bbox = {
      minX: green.x - thirtyYardsTiles,
      minY: green.y - thirtyYardsTiles,
      maxX: green.x + thirtyYardsTiles,
      maxY: green.y + thirtyYardsTiles,
    };
  }

  // No rotation - keep it straight
  const rotationDeg = 0;

  // Center
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;

  // Auto-fit zoom (no rotation calculation needed)
  const bboxWidth = bbox.maxX - bbox.minX;
  const bboxHeight = bbox.maxY - bbox.minY;
  
  // Zoom calculation: fit bboxWidth tiles into canvasWidth pixels
  // In the transform, 1 tile = zoom * tileSize pixels, so:
  // bboxWidth * zoom * tileSize = canvasWidth (with padding)
  // zoom = (canvasWidth * padding) / (bboxWidth * tileSize)
  const effectiveTileSize = tileSize ?? 16; // fallback if not provided
  const scaleX = (canvasWidth * 0.95) / ((bboxWidth || 1) * effectiveTileSize); // 95% for better fill
  const scaleY = (canvasHeight * 0.95) / ((bboxHeight || 1) * effectiveTileSize);
  let zoom = Math.min(scaleX, scaleY);
  zoom = Math.max(0.5, Math.min(10.0, zoom)); // Increased max zoom

  return {
    mode: "hole",
    center: { x: centerX, y: centerY },
    zoom,
    rotationDeg,
    bounds: bbox,
  };
}

/**
 * Compute camera state for hole edit mode with auto-fit to bounding box
 */
export function computeHoleCamera(
  tee: Point,
  green: Point,
  paddingTiles: number,
  zoom: number | null, // null = auto-fit
  canvasWidth: number,
  canvasHeight: number,
  course?: Course,
  hole?: Hole,
  holeIndex?: number,
  tileSize?: number // optional tileSize for accurate zoom calculation
): CameraState {
  // No rotation - keep it straight
  const rotationDeg = 0;

  // Try to compute bounding box if we have course/hole data
  let bbox: BoundingBox | null = null;
  if (course && hole != null && holeIndex != null) {
    bbox = computeHoleBoundingBox(course, hole, holeIndex, paddingTiles);
  }

  // Fallback to tee/green only if no bbox
  if (!bbox) {
    bbox = {
      minX: Math.min(tee.x, green.x) - paddingTiles,
      minY: Math.min(tee.y, green.y) - paddingTiles,
      maxX: Math.max(tee.x, green.x) + paddingTiles,
      maxY: Math.max(tee.y, green.y) + paddingTiles,
    };
  }

  // Center point of bounding box
  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;

  // Compute zoom to fit if not specified
  let finalZoom = zoom ?? 1;
  if (zoom == null && canvasWidth > 0 && canvasHeight > 0) {
    const bboxWidth = bbox.maxX - bbox.minX;
    const bboxHeight = bbox.maxY - bbox.minY;
    
    // No rotation - simple fit calculation
    // Zoom calculation: fit bboxWidth tiles into canvasWidth pixels
    // In the transform, 1 tile = zoom * tileSize pixels, so:
    // bboxWidth * zoom * tileSize = canvasWidth (with padding)
    // zoom = (canvasWidth * padding) / (bboxWidth * tileSize)
    const effectiveTileSize = tileSize ?? 16; // fallback if not provided
    const scaleX = (canvasWidth * 0.95) / ((bboxWidth || 1) * effectiveTileSize); // 95% padding for better fill
    const scaleY = (canvasHeight * 0.95) / ((bboxHeight || 1) * effectiveTileSize);
    finalZoom = Math.min(scaleX, scaleY);
    
    // Clamp zoom to reasonable range
    finalZoom = Math.max(0.5, Math.min(10.0, finalZoom)); // Increased max zoom
  }

  return {
    mode: "hole",
    center: { x: centerX, y: centerY },
    zoom: finalZoom,
    rotationDeg,
    bounds: bbox,
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
  
  // No rotation in hole edit mode
  // Rotate (counter-clockwise, so negate the angle) - only if rotationDeg != 0
  if (camera.rotationDeg !== 0) {
    ctx.rotate((-camera.rotationDeg * Math.PI) / 180);
  }
  
  // Translate to camera center (in tile space, scale by tileSize)
  ctx.translate(-camera.center.x * tileSize, -camera.center.y * tileSize);
}

