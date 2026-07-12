import type { Course, Point, Terrain } from "../models/types";

// A* walk routing for golfer entities (ZKU-107): golfers walk around water and
// prefer short grass / cart paths instead of beelining between shot positions.
//
// Costs shape the ROUTE only — walk speed stays uniform (see pace.walkPerTile);
// a golfer detouring around a pond simply walks a longer distance.
const WALK_COST: Record<Terrain, number> = {
  path: 0.85,
  fairway: 1.0,
  tee: 1.0,
  green: 1.0,
  rough: 1.4,
  deep_rough: 2.0,
  sand: 2.2,
  water: Infinity, // impassable
};

// Give up after exploring this many tiles and fall back to a straight line
// (also bounds worst-case spawn cost on large courses).
const MAX_EXPLORED = 20_000;

const SQRT2 = Math.SQRT2;

function tileCost(course: Course, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height) return 1.4; // off-course rough
  return WALK_COST[course.tiles[y * course.width + x]] ?? 1.0;
}

// Minimal binary min-heap over (score, index) pairs.
class Heap {
  private scores: number[] = [];
  private items: number[] = [];
  get size() {
    return this.items.length;
  }
  push(score: number, item: number) {
    const s = this.scores;
    const it = this.items;
    s.push(score);
    it.push(item);
    let i = s.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (s[p] <= s[i]) break;
      [s[p], s[i]] = [s[i], s[p]];
      [it[p], it[i]] = [it[i], it[p]];
      i = p;
    }
  }
  pop(): number {
    const s = this.scores;
    const it = this.items;
    const top = it[0];
    const lastS = s.pop()!;
    const lastI = it.pop()!;
    if (s.length > 0) {
      s[0] = lastS;
      it[0] = lastI;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < s.length && s[l] < s[m]) m = l;
        if (r < s.length && s[r] < s[m]) m = r;
        if (m === i) break;
        [s[m], s[i]] = [s[i], s[m]];
        [it[m], it[i]] = [it[i], it[m]];
        i = m;
      }
    }
    return top;
  }
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay);
}

// Route from `from` to `to` along walkable tiles. Returns a simplified list of
// waypoints starting at exactly `from` and ending at exactly `to`. Falls back
// to [from, to] when no route exists (e.g. fully water-locked) or endpoints
// are unwalkable — golfers must never get permanently stuck.
export function findWalkPath(course: Course, from: Point, to: Point): Point[] {
  const straight: Point[] = [{ ...from }, { ...to }];
  const w = course.width;
  const h = course.height;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.round(v)));
  const sx = clamp(from.x, w);
  const sy = clamp(from.y, h);
  const gx = clamp(to.x, w);
  const gy = clamp(to.y, h);
  if (sx === gx && sy === gy) return straight;
  if (!isFinite(tileCost(course, sx, sy)) || !isFinite(tileCost(course, gx, gy))) {
    return straight; // standing in / aiming at water: don't try to route
  }

  const start = sy * w + sx;
  const goal = gy * w + gx;
  const gScore = new Float64Array(w * h).fill(Infinity);
  const cameFrom = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  gScore[start] = 0;
  const open = new Heap();
  open.push(octile(gx - sx, gy - sy) * 0.85, start);

  let explored = 0;
  let found = false;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++explored > MAX_EXPLORED) break;

    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const cost = tileCost(course, nx, ny);
        if (!isFinite(cost)) continue;
        // No cutting corners diagonally past water.
        if (dx !== 0 && dy !== 0) {
          if (!isFinite(tileCost(course, cx + dx, cy)) || !isFinite(tileCost(course, cx, cy + dy)))
            continue;
        }
        const next = ny * w + nx;
        if (closed[next]) continue;
        const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) * cost;
        const g = gScore[cur] + step;
        if (g < gScore[next]) {
          gScore[next] = g;
          cameFrom[next] = cur;
          open.push(g + octile(gx - nx, gy - ny) * 0.85, next);
        }
      }
    }
  }
  if (!found) return straight;

  // Reconstruct, then keep only direction changes.
  const rev: number[] = [];
  for (let n = goal; n !== -1; n = cameFrom[n]) rev.push(n);
  rev.reverse();

  const pts: Point[] = [{ ...from }];
  let lastDx = NaN;
  let lastDy = NaN;
  for (let i = 1; i < rev.length; i++) {
    const px = rev[i - 1] % w;
    const py = (rev[i - 1] / w) | 0;
    const x = rev[i] % w;
    const y = (rev[i] / w) | 0;
    const dx = x - px;
    const dy = y - py;
    if (dx !== lastDx || dy !== lastDy) {
      // direction changed: the PREVIOUS node is a corner waypoint
      if (i > 1) pts.push({ x: px, y: py });
      lastDx = dx;
      lastDy = dy;
    }
  }
  pts.push({ ...to });
  return pts;
}

// Total polyline length in tiles.
export function pathLength(pts: Point[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return d;
}
