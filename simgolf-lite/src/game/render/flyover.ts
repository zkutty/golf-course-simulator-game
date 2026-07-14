import type { Point } from "../models/types";

/**
 * Cinematic hole flyover (ZKU-157) — pure keyframe math, no PIXI.
 *
 * The camera path starts wide behind the tee, glides along the shot
 * corridor, holds briefly over the first landing zone, and settles in
 * tight behind the green. Keyframes carry a normalized time `at` (0..1);
 * the renderer samples them each frame with smoothstep easing per segment
 * and feeds the results to its normal camera-smoothing, which adds the
 * final ease-in/out organically.
 */

export interface FlyoverKey {
  at: number;
  x: number;
  y: number;
  zoom: number;
}

export const FLYOVER_DURATION_MS = 7000;

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/**
 * Build the flyover keyframes for a hole.
 *
 * @param tee hole tee (tile coords)
 * @param green hole green (tile coords)
 * @param corridor shot landing points tee→green (may be empty; green is
 *   appended automatically if the last point isn't the green)
 * @param wideZoom camera zoom that frames the whole hole
 * @param tightZoom camera zoom for the green arrival
 */
export function buildFlyoverKeys(
  tee: Point,
  green: Point,
  corridor: ReadonlyArray<Point>,
  wideZoom: number,
  tightZoom: number
): FlyoverKey[] {
  // Waypoints: tee → landings → green (dedupe near-identical points).
  const pts: Point[] = [tee];
  for (const p of corridor) {
    const last = pts[pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.5) pts.push(p);
  }
  const lastPt = pts[pts.length - 1];
  if (Math.hypot(green.x - lastPt.x, green.y - lastPt.y) > 0.5) pts.push(green);

  const startDir = unit(tee, pts.length > 1 ? pts[1] : green);
  const endPrev = pts.length > 1 ? pts[pts.length - 2] : tee;
  const endDir = unit(endPrev, green);
  const midZoom = wideZoom + (tightZoom - wideZoom) * 0.45;

  // Path lengths → proportional timing for the glide portion.
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLens.push(l);
    total += l;
  }

  const keys: FlyoverKey[] = [];
  // Opening: wide, pulled back behind the tee.
  keys.push({ at: 0, x: tee.x - startDir.x * 6, y: tee.y - startDir.y * 6, zoom: wideZoom });
  // Over the tee, tightening in.
  keys.push({ at: 0.14, x: tee.x, y: tee.y, zoom: midZoom });

  // Glide along the corridor; the FIRST landing point gets a hold.
  const glideStart = 0.18;
  const glideEnd = 0.86;
  let run = 0;
  let holdInserted = false;
  for (let i = 1; i < pts.length; i++) {
    run += segLens[i - 1];
    const frac = total > 1e-6 ? run / total : 1;
    let at = glideStart + (glideEnd - glideStart) * frac;
    const isLast = i === pts.length - 1;
    if (!isLast && !holdInserted) {
      // Hold over the first landing zone (~0.9s of a 7s flyover).
      holdInserted = true;
      keys.push({ at, x: pts[i].x, y: pts[i].y, zoom: midZoom });
      at = Math.min(glideEnd - 0.01, at + 0.13);
      keys.push({ at, x: pts[i].x, y: pts[i].y, zoom: midZoom });
    } else if (!isLast) {
      keys.push({ at, x: pts[i].x, y: pts[i].y, zoom: midZoom });
    } else {
      keys.push({ at: glideEnd, x: green.x, y: green.y, zoom: (midZoom + tightZoom) / 2 });
    }
  }

  // Settle behind the green, looking back down the hole.
  keys.push({ at: 1, x: green.x + endDir.x * 4, y: green.y + endDir.y * 4, zoom: tightZoom });

  // Timing sanity: strictly increasing `at`.
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].at <= keys[i - 1].at) keys[i].at = keys[i - 1].at + 0.01;
  }
  if (keys[keys.length - 1].at > 1) {
    const scale = 1 / keys[keys.length - 1].at;
    for (const k of keys) k.at *= scale;
  }
  return keys;
}

function smoothstep(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
}

/** Sample the camera state at normalized flyover time t (0..1). */
export function sampleFlyover(keys: ReadonlyArray<FlyoverKey>, t: number): FlyoverKey {
  if (keys.length === 0) return { at: 0, x: 0, y: 0, zoom: 1 };
  const tt = Math.max(0, Math.min(1, t));
  if (tt <= keys[0].at) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (tt >= a.at && tt <= b.at) {
      const u = smoothstep(b.at === a.at ? 1 : (tt - a.at) / (b.at - a.at));
      return {
        at: tt,
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        zoom: a.zoom + (b.zoom - a.zoom) * u,
      };
    }
  }
  return keys[keys.length - 1];
}
