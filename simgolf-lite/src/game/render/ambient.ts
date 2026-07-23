import type { Course, Point } from "../models/types";

/**
 * Ambient world life (ZKU-156) — pure math, no PIXI.
 *
 * Everything time-of-day-shaped runs off the GAME clock (dayMinute) so 2x/4x
 * speeds scale it; purely cosmetic micro-motion (bird flaps, shimmer sweep)
 * stays real-time in the renderer.
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
// Cloud shadows: 2-3 soft blobs drifting on a constant per-day wind.
// ---------------------------------------------------------------------------

export const CLOUD_COUNT = 3;
/** Wind direction in world tile space — constant across a day. */
export const CLOUD_DIR = { x: 0.94, y: 0.34 };
/** Drift speed, tiles per game-minute (crosses a 110-tile course in ~6h). */
export const CLOUD_SPEED = 0.3;

/**
 * World-tile position of cloud `i` at a game-clock minute. Clouds wrap
 * around the course bounds (with margin) so there is always coverage.
 */
export function cloudPos(
  dayMinute: number,
  i: number,
  courseW: number,
  courseH: number
): Point {
  const margin = 24;
  const spanX = courseW + margin * 2;
  const spanY = courseH + margin * 2;
  const drift = dayMinute * CLOUD_SPEED;
  // Deterministic per-cloud stagger so they never bunch up.
  const seedX = ((i * 137 + 41) % 100) / 100;
  const seedY = ((i * 71 + 23) % 100) / 100;
  const x = ((seedX * spanX + drift * CLOUD_DIR.x) % spanX + spanX) % spanX - margin;
  const y = ((seedY * spanY + drift * CLOUD_SPEED_Y_FACTOR * CLOUD_DIR.y) % spanY + spanY) % spanY - margin;
  return { x, y };
}
const CLOUD_SPEED_Y_FACTOR = 1;

// ---------------------------------------------------------------------------
// Birds: a small flock crosses the sky every few in-game hours.
// ---------------------------------------------------------------------------

/** Game-minutes between flock departures. */
export const BIRD_PERIOD_MIN = 165;
/** Game-minutes a crossing takes. */
export const BIRD_FLIGHT_MIN = 14;

export interface BirdCrossing {
  active: boolean;
  /** 0..1 progress across the sky while active. */
  t: number;
  /** Which crossing of the day (varies the path). */
  index: number;
}

export function birdCrossing(dayMinute: number): BirdCrossing {
  if (dayMinute < 30) return { active: false, t: 0, index: -1 };
  const m = dayMinute - 30;
  const index = Math.floor(m / BIRD_PERIOD_MIN);
  const phase = m - index * BIRD_PERIOD_MIN;
  return { active: phase < BIRD_FLIGHT_MIN, t: phase / BIRD_FLIGHT_MIN, index };
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
