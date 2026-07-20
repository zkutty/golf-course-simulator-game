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

/** Throttled camera telemetry consumed by lightweight overlays such as the minimap. */
export interface IsoCameraSnapshot {
  center: Point;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  bounds: BoundingBox;
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

  let bbox: BoundingBox;
  
  let centerX: number;
  let centerY: number;

  if (preset === "fit") {
    const result = computeHoleBoundingBox(course, hole, holeIndex, 0);
    if (!result) return null;
    bbox = result;
    centerX = (bbox.minX + bbox.maxX) / 2;
    centerY = (bbox.minY + bbox.maxY) / 2;
  } else if (preset === "tee") {
    // Center on tee with tight zoom
    const paddingTiles = 8; // ~80 yards buffer
    bbox = {
      minX: tee.x - paddingTiles,
      minY: tee.y - paddingTiles,
      maxX: tee.x + paddingTiles,
      maxY: tee.y + paddingTiles,
    };
    centerX = tee.x;
    centerY = tee.y;
  } else if (preset === "landing") {
    // Use shot plan to find actual first landing zone
    const score = scoreHole(course, hole, holeIndex);
    let landingPoint: Point;
    if (score.shotPlan && score.shotPlan.length > 0) {
      // First shot's landing point
      landingPoint = score.shotPlan[0].to;
    } else {
      // Fallback: 35-50% along straight line
      const midT = 0.425;
      landingPoint = {
        x: tee.x + (green.x - tee.x) * midT,
        y: tee.y + (green.y - tee.y) * midT,
      };
    }
    const paddingTiles = 10; // ~100 yards buffer
    bbox = {
      minX: landingPoint.x - paddingTiles,
      minY: landingPoint.y - paddingTiles,
      maxX: landingPoint.x + paddingTiles,
      maxY: landingPoint.y + paddingTiles,
    };
    centerX = landingPoint.x;
    centerY = landingPoint.y;
  } else { // green
    // Center on green with tight zoom
    const paddingTiles = 8; // ~80 yards buffer
    bbox = {
      minX: green.x - paddingTiles,
      minY: green.y - paddingTiles,
      maxX: green.x + paddingTiles,
      maxY: green.y + paddingTiles,
    };
    centerX = green.x;
    centerY = green.y;
  }

  // No rotation - keep it straight
  const rotationDeg = 0;

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
