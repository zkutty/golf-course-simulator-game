import type { Course, Obstacle, Point, Terrain } from "../models/types";

export interface PathResult {
  path: Point[]; // includes start and end
  cost: number; // total traversal cost
  steps: number; // path.length - 1
}

function inBounds(course: Course, x: number, y: number) {
  return x >= 0 && y >= 0 && x < course.width && y < course.height;
}

function idx(course: Course, x: number, y: number) {
  return y * course.width + x;
}

function tileAt(course: Course, x: number, y: number): Terrain {
  return course.tiles[idx(course, x, y)];
}

function obstacleAt(obstacles: Obstacle[], x: number, y: number) {
  return obstacles.find((o) => o.x === x && o.y === y) ?? null;
}

function baseTraversalCost(t: Terrain): number {
  // Lower is better. Values are tuned for "golfability", not realism.
  switch (t) {
    case "fairway":
      return 1.0;
    case "path":
      return 1.2;
    case "tee":
      return 1.2;
    case "green":
      return 1.4;
    case "rough":
      return 2.2;
    case "deep_rough":
      return 3.4;
    case "sand":
      return 2.8;
    case "water":
      return Infinity; // blocked
    default:
      return 2.2;
  }
}

function hazardAdjacencyPenalty(course: Course, x: number, y: number): number {
  // Add cost if adjacent to hazards (risk).
  // Chebyshev adjacency: includes diagonals.
  let p = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(course, nx, ny)) continue;
      const t = tileAt(course, nx, ny);
      if (t === "water") p += 0.9;
      if (t === "sand") p += 0.25;
    }
  }
  return p;
}

function obstaclePenalty(o: Obstacle | null): number {
  if (!o) return 0;
  // Obstacles don't block, but strongly discourage routing through them.
  return o.type === "tree" ? 5.0 : 2.5;
}

function stepCost(course: Course, obstacles: Obstacle[], x: number, y: number): number {
  const t = tileAt(course, x, y);
  const base = baseTraversalCost(t);
  if (!Number.isFinite(base)) return Infinity;
  return base + hazardAdjacencyPenalty(course, x, y) + obstaclePenalty(obstacleAt(obstacles, x, y));
}

// Dijkstra on 4-neighbor grid (pathfinding-lite).
export function findBestPlayablePath(
  course: Course,
  start: Point,
  goal: Point
): PathResult | null {
  if (!inBounds(course, start.x, start.y) || !inBounds(course, goal.x, goal.y)) return null;

  const obstacles = course.obstacles ?? [];
  const startCost = stepCost(course, obstacles, start.x, start.y);
  const goalCost = stepCost(course, obstacles, goal.x, goal.y);
  if (!Number.isFinite(startCost) || !Number.isFinite(goalCost)) return null;

  const n = course.width * course.height;
  const dist = new Float64Array(n);
  const prev = new Int32Array(n);
  const visited = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    dist[i] = Number.POSITIVE_INFINITY;
    prev[i] = -1;
  }

  const sIdx = idx(course, start.x, start.y);
  const gIdx = idx(course, goal.x, goal.y);
  dist[sIdx] = 0;

  // Simple O(n^2) priority queue is too slow for big grids; use a binary heap.
  const heap: Array<{ i: number; d: number }> = [];
  const push = (i: number, d: number) => {
    heap.push({ i, d });
    siftUp(heap.length - 1);
  };
  const siftUp = (pos: number) => {
    while (pos > 0) {
      const parent = Math.floor((pos - 1) / 2);
      if (heap[parent].d <= heap[pos].d) break;
      [heap[parent], heap[pos]] = [heap[pos], heap[parent]];
      pos = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      siftDown(0);
    }
    return top;
  };
  const siftDown = (pos: number) => {
    for (;;) {
      const l = pos * 2 + 1;
      const r = pos * 2 + 2;
      let m = pos;
      if (l < heap.length && heap[l].d < heap[m].d) m = l;
      if (r < heap.length && heap[r].d < heap[m].d) m = r;
      if (m === pos) break;
      [heap[m], heap[pos]] = [heap[pos], heap[m]];
      pos = m;
    }
  };

  push(sIdx, 0);

  while (heap.length > 0) {
    const cur = pop();
    if (!cur) break;
    const curIdx = cur.i;
    if (visited[curIdx]) continue;
    visited[curIdx] = 1;
    if (curIdx === gIdx) break;

    const cx = curIdx % course.width;
    const cy = Math.floor(curIdx / course.width);
    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (!inBounds(course, nx, ny)) continue;
      const ni = idx(course, nx, ny);
      if (visited[ni]) continue;
      const sc = stepCost(course, obstacles, nx, ny);
      if (!Number.isFinite(sc)) continue;
      const nd = dist[curIdx] + sc;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = curIdx;
        push(ni, nd);
      }
    }
  }

  if (!Number.isFinite(dist[gIdx])) return null;

  const pathIdxs: number[] = [];
  let cur = gIdx;
  while (cur !== -1) {
    pathIdxs.push(cur);
    if (cur === sIdx) break;
    cur = prev[cur];
  }
  if (pathIdxs[pathIdxs.length - 1] !== sIdx) return null;
  pathIdxs.reverse();

  const path: Point[] = pathIdxs.map((i) => ({ x: i % course.width, y: Math.floor(i / course.width) }));
  return { path, cost: dist[gIdx], steps: Math.max(0, path.length - 1) };
}





