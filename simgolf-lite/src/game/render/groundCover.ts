import type { Course, LandTheme, Terrain } from "../models/types";
import { BUILDING_SPECS } from "../models/buildings";

export type GroundCoverKind = "native_grass" | "flowers" | "reeds" | "leaf_litter" | "pebbles" | "bare_soil";

export interface GroundCover {
  kind: GroundCoverKind;
  offsetX: number;
  offsetY: number;
  /** 1 survives medium detail; 2 is reserved for close/high-quality views. */
  detailTier: 1 | 2;
}

const COVER_BY_TERRAIN: Partial<Record<Terrain, readonly GroundCoverKind[]>> = {
  rough: ["native_grass", "flowers", "leaf_litter"],
  deep_rough: ["native_grass", "native_grass", "leaf_litter"],
  sand: ["pebbles", "bare_soil"],
  waste_area: ["pebbles", "bare_soil", "native_grass"],
  wetland: ["reeds", "reeds", "native_grass"],
};

const BASE_DENSITY: Partial<Record<Terrain, number>> = {
  rough: .14, deep_rough: .28, sand: .06, waste_area: .24, wetland: .38,
};

const THEME_MULT: Record<LandTheme, Partial<Record<GroundCoverKind, number>>> = {
  parkland: { flowers: 1.25, leaf_litter: 1.25, reeds: 1.1 },
  links: { native_grass: 1.45, flowers: .65, leaf_litter: .35 },
  desert: { pebbles: 1.55, bare_soil: 1.5, flowers: .2, leaf_litter: .15, reeds: .7 },
};

function hash(seed: number, x: number, y: number, salt = 0): number {
  let value = (seed ^ Math.imul(x + 17, 0x45d9f3b) ^ Math.imul(y + 31, 0x119de1f3) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function excluded(course: Course, x: number, y: number): boolean {
  const terrain = course.tiles[y * course.width + x];
  if (terrain === "tee" || terrain === "green" || terrain === "path" || terrain === "fairway") return true;
  for (const hole of course.holes) {
    for (const marker of [hole.tee, hole.green]) {
      if (marker && Math.max(Math.abs(marker.x - x), Math.abs(marker.y - y)) <= 1) return true;
    }
  }
  for (const building of course.buildings ?? []) {
    const spec = BUILDING_SPECS[building.type];
    if (x >= building.x - 1 && y >= building.y - 1 && x <= building.x + spec.w && y <= building.y + spec.d) return true;
  }
  return false;
}

/** Pure presentation derivation: never persisted and never part of state hashes. */
export function deriveGroundCover(course: Course, seed: number, x: number, y: number): GroundCover | null {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height || excluded(course, x, y)) return null;
  const terrain = course.tiles[y * course.width + x];
  const choices = COVER_BY_TERRAIN[terrain];
  if (!choices?.length) return null;
  const h = hash(seed, x, y, terrain.length * 97);
  const kind = choices[h % choices.length];
  const theme = course.theme ?? "parkland";
  const density = (BASE_DENSITY[terrain] ?? 0) * (THEME_MULT[theme][kind] ?? 1);
  if (((h >>> 8) & 0xffff) / 0xffff >= Math.min(.85, density)) return null;
  return {
    kind,
    offsetX: (((h >>> 3) & 31) / 31 - .5) * 28,
    offsetY: (((h >>> 13) & 15) / 15 - .5) * 9 + 8,
    detailTier: ((h >>> 27) & 1) === 0 ? 1 : 2,
  };
}

export function visibleGroundCoverTier(zoom: number, resolutionScale: number): 0 | 1 | 2 {
  if (zoom < .34 || resolutionScale <= .5) return 0;
  if (zoom < .72 || resolutionScale < 1) return 1;
  return 2;
}
