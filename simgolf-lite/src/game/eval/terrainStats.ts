import type { Course, Hole } from "../models/types";
import { sampleLine } from "../sim/holes";
import { scoreHole } from "../sim/holes";

export interface TerrainComposition {
  fairway: number;
  rough: number;
  deep_rough: number;
  sand: number;
  water: number;
  green: number;
  tee: number;
  path: number;
  other: number;
  total: number;
}

export interface HoleTerrainStats {
  total: TerrainComposition;
  corridor: TerrainComposition;
}

/**
 * Compute terrain composition for a hole area
 * For now, we use a bounding box around tee/green/path as the "hole area"
 * Approximation: counts tiles within bounding box + buffer
 */
function computeHoleAreaComposition(
  course: Course,
  hole: Hole,
  holeIndex: number
): TerrainComposition {
  if (!hole.tee || !hole.green) {
    return {
      fairway: 0,
      rough: 0,
      deep_rough: 0,
      sand: 0,
      water: 0,
      green: 0,
      tee: 0,
      path: 0,
      other: 0,
      total: 0,
    };
  }

  const score = scoreHole(course, hole, holeIndex);
  const path = score.path.length > 0 ? score.path : [hole.tee, hole.green];
  
  // Compute bounding box with buffer
  let minX = path[0].x;
  let minY = path[0].y;
  let maxX = path[0].x;
  let maxY = path[0].y;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const straightDistYards =
    Math.sqrt((hole.tee.x - hole.green.x) ** 2 + (hole.tee.y - hole.green.y) ** 2) *
    course.yardsPerTile;
  let bufferTiles = 8; // default buffer
  if (straightDistYards >= 350) bufferTiles = 12;
  else if (straightDistYards >= 200) bufferTiles = 10;

  const bboxMinX = Math.max(0, Math.floor(minX - bufferTiles));
  const bboxMinY = Math.max(0, Math.floor(minY - bufferTiles));
  const bboxMaxX = Math.min(course.width - 1, Math.ceil(maxX + bufferTiles));
  const bboxMaxY = Math.min(course.height - 1, Math.ceil(maxY + bufferTiles));

  const counts: TerrainComposition = {
    fairway: 0,
    rough: 0,
    deep_rough: 0,
    sand: 0,
    water: 0,
    green: 0,
    tee: 0,
    path: 0,
    other: 0,
    total: 0,
  };

  for (let y = bboxMinY; y <= bboxMaxY; y++) {
    for (let x = bboxMinX; x <= bboxMaxX; x++) {
      const idx = y * course.width + x;
      const terrain = course.tiles[idx];
      if (terrain in counts) {
        counts[terrain as keyof TerrainComposition]++;
      } else {
        counts.other++;
      }
      counts.total++;
    }
  }

  return counts;
}

/**
 * Compute terrain composition for corridor area
 * Corridor = buffer around centerline/path (similar to evaluateHole logic)
 */
function computeCorridorComposition(
  course: Course,
  hole: Hole,
  _holeIndex: number
): TerrainComposition {
  if (!hole.tee || !hole.green) {
    return {
      fairway: 0,
      rough: 0,
      deep_rough: 0,
      sand: 0,
      water: 0,
      green: 0,
      tee: 0,
      path: 0,
      other: 0,
      total: 0,
    };
  }

  const straightDistYards =
    Math.sqrt((hole.tee.x - hole.green.x) ** 2 + (hole.tee.y - hole.green.y) ** 2) *
    course.yardsPerTile;

  // Get corridor buffer (matching evaluateHole logic)
  let bufferTiles = 2;
  if (straightDistYards >= 350) bufferTiles = 4;
  else if (straightDistYards >= 200) bufferTiles = 3;

  // Sample corridor points with buffer
  const corridorPoints = new Set<string>();
  const corridorLine = sampleLine(hole.tee, hole.green, 50);

  for (const p of corridorLine) {
    for (let dy = -bufferTiles; dy <= bufferTiles; dy++) {
      for (let dx = -bufferTiles; dx <= bufferTiles; dx++) {
        if (dx * dx + dy * dy <= bufferTiles * bufferTiles) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (q.x >= 0 && q.y >= 0 && q.x < course.width && q.y < course.height) {
            corridorPoints.add(`${q.x},${q.y}`);
          }
        }
      }
    }
  }

  const counts: TerrainComposition = {
    fairway: 0,
    rough: 0,
    deep_rough: 0,
    sand: 0,
    water: 0,
    green: 0,
    tee: 0,
    path: 0,
    other: 0,
    total: 0,
  };

  for (const key of corridorPoints) {
    const [x, y] = key.split(",").map(Number);
    const idx = y * course.width + x;
    const terrain = course.tiles[idx];
    if (terrain in counts) {
      counts[terrain as keyof TerrainComposition]++;
    } else {
      counts.other++;
    }
    counts.total++;
  }

  return counts;
}

/**
 * Compute terrain stats for a hole (total area + corridor)
 */
export function computeHoleTerrainStats(
  course: Course,
  hole: Hole,
  holeIndex: number
): HoleTerrainStats {
  return {
    total: computeHoleAreaComposition(course, hole, holeIndex),
    corridor: computeCorridorComposition(course, hole, holeIndex),
  };
}
