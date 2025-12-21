import type { Point } from "../models/types";

export function computeHoleDistanceTiles(tee: Point, green: Point) {
  const dx = tee.x - green.x;
  const dy = tee.y - green.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function computePathDistanceTiles(path: Point[]): number {
  if (path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

// Thresholds:
// <=14 => par 3
// 15–30 => par 4
// 31+ => par 5
export function computeAutoPar(distanceTiles: number): 3 | 4 | 5 {
  if (distanceTiles <= 14) return 3;
  if (distanceTiles <= 30) return 4;
  return 5;
}


