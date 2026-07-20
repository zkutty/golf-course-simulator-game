import type { Course, Point, Terrain } from "../game/models/types";
import type { AmbientMix, MusicContext } from "./AudioManager";

export function musicContextFor(input: {
  screen: "menu" | "setup" | "game" | "loading";
  viewMode: "COZY" | "ARCHITECT";
  cash: number;
  liveRunning: boolean;
  won: boolean;
}): MusicContext {
  if (input.screen === "loading") return "silent";
  if (input.screen === "menu" || input.screen === "setup") return "title";
  if (input.won) return "live";
  if (input.cash < 0) return "tension";
  return input.viewMode === "ARCHITECT" || !input.liveRunning ? "build" : "live";
}

export function ambientMixFor(input: {
  course: Course;
  center: Point;
  dayMinute: number;
  visibleGolfers: number;
  paused: boolean;
  radius?: number;
}): AmbientMix {
  const radius = input.radius ?? 9;
  const minX = Math.max(0, Math.floor(input.center.x - radius));
  const maxX = Math.min(input.course.width - 1, Math.ceil(input.center.x + radius));
  const minY = Math.max(0, Math.floor(input.center.y - radius));
  const maxY = Math.min(input.course.height - 1, Math.ceil(input.center.y + radius));
  const counts: Partial<Record<Terrain, number>> = {};
  let total = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const terrain = input.course.tiles[y * input.course.width + x];
      counts[terrain] = (counts[terrain] ?? 0) + 1;
      total++;
    }
  }
  const obstacleCount = input.course.obstacles.filter((item) =>
    item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY
  ).length;
  const share = (terrain: Terrain) => (counts[terrain] ?? 0) / Math.max(1, total);
  const dawn = 1 - Math.min(1, Math.abs(input.dayMinute - 100) / 230);
  const dusk = Math.max(0, (input.dayMinute - 620) / 220);
  return {
    birds: clamp01(obstacleCount / 18 + dawn * .42),
    water: clamp01(share("water") * 3.2),
    wind: clamp01((share("rough") + share("deep_rough") + share("sand")) * 1.35 + .12),
    murmur: clamp01(input.visibleGolfers / 16),
    crickets: clamp01(dusk),
    paused: input.paused,
  };
}

export function distanceVolume(point: Point, center: Point, audibleRadius = 28): number {
  return clamp01(1 - Math.hypot(point.x - center.x, point.y - center.y) / audibleRadius);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
