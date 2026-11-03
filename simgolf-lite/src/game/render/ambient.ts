import type { Course, Point } from "../models/types";

/**
 * Ambient world life (ZKU-156) — pure math, no PIXI.
 *
 * Time-of-day tint follows the GAME clock (dayMinute) so 2x/4x speeds
 * scale it; cosmetic shimmer and heron motion stay real-time in the renderer.
 */

/** The live day runs 840 game-minutes (6:00 AM → 8:00 PM). */
export const DAY_MINUTES = 840;

// ---------------------------------------------------------------------------
// Time-of-day tint: subtle multiply color over the whole scene.
// Cool bright morning → neutral midday plateau → warm late afternoon.
// Channels stay within ~8% of neutral — ambience, not a day/night cycle.
// ---------------------------------------------------------------------------

const TINT_KEYS: Array<{ min: number; rgb: [number, number, number] }> = [
  { min: 0, rgb: [235, 242, 255] }, // 6:00 AM — cool morning light
  { min: 240, rgb: [255, 255, 255] }, // 10:00 AM — neutral
  { min: 540, rgb: [255, 255, 255] }, // 3:00 PM — still neutral
  { min: 840, rgb: [255, 233, 208] }, // 8:00 PM — warm evening
];

/** Continuous multiply-tint color for a game-clock minute (0xRRGGBB). */
export function timeOfDayTint(dayMinute: number): number {
  const m = Math.max(0, Math.min(DAY_MINUTES, dayMinute));
  let a = TINT_KEYS[0];
  let b = TINT_KEYS[TINT_KEYS.length - 1];
  for (let i = 0; i < TINT_KEYS.length - 1; i++) {
    if (m >= TINT_KEYS[i].min && m <= TINT_KEYS[i + 1].min) {
      a = TINT_KEYS[i];
      b = TINT_KEYS[i + 1];
      break;
    }
  }
  const t = b.min === a.min ? 0 : (m - a.min) / (b.min - a.min);
  const c = (i: number) => Math.round(a.rgb[i] + (b.rgb[i] - a.rgb[i]) * t);
  return (c(0) << 16) | (c(1) << 8) | c(2);
}

// ---------------------------------------------------------------------------
// Heron: stands at the water's edge; startled by nearby ball landings.
// ---------------------------------------------------------------------------

/** Tiles within which a landing ball startles the heron. */
export const HERON_STARTLE_TILES = 5;

/**
 * Deterministic heron perch: the land tile adjacent to water closest to the
 * course center (herons like a good view). Null when the course has no
 * water shoreline.
 */
export function heronSpot(course: Course): Point | null {
  const w = course.width;
  const h = course.height;
  const cx = w / 2;
  const cy = h / 2;
  let best: Point | null = null;
  let bestD = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (course.tiles[y * w + x] === "water") continue;
      let shore = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (course.tiles[ny * w + nx] === "water") {
          shore = true;
          break;
        }
      }
      if (!shore) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}
