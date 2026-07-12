import type { Course } from "./types";
import { ELEVATION_MAX, getElevation } from "./elevation";

/**
 * Sculpt brush logic (ZKU-145) — pure functions shared by the editor UI
 * (preview + cost) and the dispatch path, so the previewed cost always
 * matches the charged amount.
 *
 * Brushes:
 * - raise / lower: ±1 step across the footprint
 * - smooth: move each tile toward the rounded average of its 3×3 neighborhood
 * - level: set the footprint to a target height (the clicked tile's height)
 *
 * After the primary edit, a terracing cascade enforces a max slope of one
 * step between adjacent tiles (SimCity-style), pulling neighbors along and
 * including them in the cost.
 *
 * Protected tiles (tee, green, water surfaces) are never modified — the
 * cascade stops at them, which can leave a legitimate cliff beside them.
 */

export type SculptBrush = "raise" | "lower" | "smooth" | "level";

export interface SculptDelta {
  x: number;
  y: number;
  delta: number;
}

export const SCULPT_RADII = [1, 2, 3] as const;
export type SculptRadius = (typeof SCULPT_RADII)[number];

function isProtected(course: Course, x: number, y: number): boolean {
  const t = course.tiles[y * course.width + x];
  return t === "tee" || t === "green" || t === "water";
}

/** Tiles inside the brush footprint (euclidean, matches the preview). */
export function brushFootprint(
  course: Course,
  cx: number,
  cy: number,
  radius: SculptRadius
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const r = radius - 0.5;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= course.width || y >= course.height) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 1e-9) out.push({ x, y });
    }
  }
  return out;
}

export function computeSculptDeltas(
  course: Course,
  cx: number,
  cy: number,
  brush: SculptBrush,
  radius: SculptRadius
): SculptDelta[] {
  if (cx < 0 || cy < 0 || cx >= course.width || cy >= course.height) return [];

  const w = course.width;
  const h = course.height;
  const clamp = (v: number) => Math.max(0, Math.min(ELEVATION_MAX, Math.round(v)));
  const next = new Map<number, number>(); // idx → new elevation
  const get = (x: number, y: number) => next.get(y * w + x) ?? getElevation(course, x, y);
  const set = (x: number, y: number, v: number) => next.set(y * w + x, clamp(v));

  const levelTarget = getElevation(course, cx, cy);
  const queue: Array<{ x: number; y: number }> = [];

  for (const { x, y } of brushFootprint(course, cx, cy, radius)) {
    if (isProtected(course, x, y)) continue;
    const cur = get(x, y);
    let target = cur;
    if (brush === "raise") target = cur + 1;
    else if (brush === "lower") target = cur - 1;
    else if (brush === "level") target = levelTarget;
    else {
      // smooth: one step toward the rounded 3×3 neighborhood average
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          sum += getElevation(course, nx, ny);
          n++;
        }
      }
      const avg = Math.round(sum / n);
      target = cur + Math.sign(avg - cur);
    }
    if (clamp(target) !== cur) {
      set(x, y, target);
      queue.push({ x, y });
    }
  }

  // Terracing cascade: no adjacent pair may differ by more than one step.
  const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  let guard = 0;
  while (queue.length > 0 && guard++ < 100_000) {
    const t = queue.pop()!;
    const et = get(t.x, t.y);
    for (const d of DIRS) {
      const nx = t.x + d.x;
      const ny = t.y + d.y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isProtected(course, nx, ny)) continue;
      const en = get(nx, ny);
      if (en < et - 1) {
        set(nx, ny, et - 1);
        queue.push({ x: nx, y: ny });
      } else if (en > et + 1) {
        set(nx, ny, et + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  const deltas: SculptDelta[] = [];
  next.forEach((v, idx) => {
    const x = idx % w;
    const y = Math.floor(idx / w);
    const delta = v - getElevation(course, x, y);
    if (delta !== 0) deltas.push({ x, y, delta });
  });
  return deltas;
}

/** Total steps changed (cost basis for earthworks). */
export function sculptSteps(deltas: SculptDelta[]): number {
  return deltas.reduce((sum, d) => sum + Math.abs(d.delta), 0);
}
