import type { Course, World } from "../models/types";

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// Cheap but effective “course quality” proxy for MVP:
// more fairway/green/path/tee and less water improves playability.
export function courseQuality(course: Course): number {
  const counts = course.tiles.reduce(
    (acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const total = course.tiles.length;

  const fairway = (counts["fairway"] ?? 0) / total;
  const green = (counts["green"] ?? 0) / total;
  const tee = (counts["tee"] ?? 0) / total;
  const path = (counts["path"] ?? 0) / total;
  const water = (counts["water"] ?? 0) / total;
  const sand = (counts["sand"] ?? 0) / total;

  const playable = 0.55 * fairway + 0.2 * green + 0.1 * tee + 0.1 * path;
  const hazards = 0.5 * water + 0.15 * sand;

  return clamp01(playable - hazards);
}

export function priceAttractiveness(course: Course): number {
  // Sweet spot roughly 50–90 for MVP; penalize extremes.
  const p = course.baseGreenFee;
  const penalty = Math.min(1, Math.abs(p - 70) / 60); // 0 at 70, 1 at +/-60
  return 1 - penalty; // 0..1
}

export function demandIndex(course: Course, world: World): number {
  const q = courseQuality(course); // 0..1
  const cond = course.condition; // 0..1
  const rep = world.reputation / 100; // 0..1
  const price = priceAttractiveness(course); // 0..1

  const marketing = Math.min(1, world.marketingLevel * 0.12); // 0..0.6
  const staff = Math.min(1, world.staffLevel * 0.1); // 0..0.5

  // Weighted blend → 0..1-ish
  const base =
    0.28 * q +
    0.22 * cond +
    0.22 * rep +
    0.16 * price +
    0.06 * marketing +
    0.06 * staff;

  return Math.max(0, Math.min(1.2, base)); // cap slightly above 1
}

export function satisfactionScore(course: Course, world: World): number {
  const q = courseQuality(course);
  const cond = course.condition;
  const staff = Math.min(1, world.staffLevel * 0.12);

  // 0..100
  const s = 100 * (0.45 * q + 0.45 * cond + 0.1 * staff);
  return Math.max(0, Math.min(100, s));
}


