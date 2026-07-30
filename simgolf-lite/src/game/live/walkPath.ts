import type { Course, Point } from "../models/types";
import { isWalkableTerrain } from "../models/terrainRules";
import { bridgeTileSet, blockingDecorationSet } from "../models/decorations";
import { buildingFootprintSet } from "../models/buildings";

// Tile-aware walking routes for golfers so they path AROUND water instead of
// straight-lining over it. A lightweight 8-directional BFS on the tile grid;
// water (and out-of-bounds) is impassable. Returns the list of waypoints from
// just-after `from` through `to` (inclusive), simplified to direction-change
// corners, or null if no walkable route exists.

function inBounds(course: Course, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < course.width && y < course.height;
}

export interface WalkPathAuthority {
  bridges: Set<number>;
  blocked: Set<number>;
  isWalkable(x: number, y: number): boolean;
}

/** Shared terrain/building/decoration authority for every mobility router. */
export function walkPathAuthority(course: Course): WalkPathAuthority {
  const bridges = bridgeTileSet(course);
  const blocked = buildingFootprintSet(course);
  for (const index of blockingDecorationSet(course)) blocked.add(index);
  return { bridges, blocked, isWalkable: (x, y) => walkable(course, x, y, bridges, blocked) };
}

function walkable(course: Course, x: number, y: number, bridges: Set<number>, blocked: Set<number>): boolean {
  if (!inBounds(course, x, y)) return false;
  const index = y * course.width + x;
  if (blocked.has(index)) return false;
  return bridges.has(index) || isWalkableTerrain(course.tiles[index]);
}

const DIRS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function findWalkPath(
  course: Course,
  from: Point,
  to: Point,
  maxExpansions = 12_000
): Point[] | null {
  const cells = findWalkPathCells(course, from, to, maxExpansions);
  if (!cells) return null;
  return simplifyWalkCells(cells);
}

/** Full unsimplified route evidence. Renderers should use `findWalkPath`. */
export function findWalkPathCells(
  course: Course,
  from: Point,
  to: Point,
  maxExpansions = 12_000,
): Point[] | null {
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  const tx = Math.round(to.x);
  const ty = Math.round(to.y);
  const authority = walkPathAuthority(course);

  // If endpoints sit on water/out-of-bounds we can't route; caller falls back.
  if (!authority.isWalkable(sx, sy) || !authority.isWalkable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [{ x: to.x, y: to.y }];

  const W = course.width;
  const startK = sy * W + sx;
  const goalK = ty * W + tx;
  const prev = new Map<number, number>();
  const seen = new Set<number>([startK]);
  let queue = [startK];
  let expansions = 0;
  let found = false;

  while (queue.length && expansions < maxExpansions) {
    const next: number[] = [];
    for (const cur of queue) {
      if (++expansions > maxExpansions) break;
      if (cur === goalK) { found = true; break; }
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!authority.isWalkable(nx, ny)) continue;
        // Prevent squeezing diagonally through a water pinch.
        if (dx !== 0 && dy !== 0 && (!authority.isWalkable(cx + dx, cy) || !authority.isWalkable(cx, cy + dy))) continue;
        const nk = ny * W + nx;
        if (seen.has(nk)) continue;
        seen.add(nk);
        prev.set(nk, cur);
        next.push(nk);
      }
    }
    if (found) break;
    queue = next;
  }

  if (!found && !seen.has(goalK)) return null;

  // Reconstruct tile path start -> goal.
  const cells: number[] = [];
  let k = goalK;
  cells.push(k);
  while (k !== startK) {
    const p = prev.get(k);
    if (p === undefined) return null;
    cells.push(p);
    k = p;
  }
  cells.reverse();

  // Simplify to direction-change corners (waypoints exclude the start point).
  // Walking straight between consecutive corners follows the routed cells.
  return cells.map((c) => ({ x: c % W, y: (c - (c % W)) / W }));
}

function simplifyWalkCells(pts: Point[]): Point[] {
  const simplified: Point[] = [];
  let lastDir: { dx: number; dy: number } | null = null;
  for (let i = 1; i < pts.length; i++) {
    const d = dirOf(pts[i - 1], pts[i]);
    if (lastDir && (d.dx !== lastDir.dx || d.dy !== lastDir.dy)) {
      simplified.push(pts[i - 1]); // corner where direction changed
    }
    lastDir = d;
  }
  simplified.push(pts[pts.length - 1]); // final target cell
  return simplified;
}

function dirOf(a: Point, b: Point): { dx: number; dy: number } {
  return { dx: Math.sign(b.x - a.x), dy: Math.sign(b.y - a.y) };
}
