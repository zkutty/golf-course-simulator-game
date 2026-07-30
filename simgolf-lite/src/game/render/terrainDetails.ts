import type { Course, LandTheme, Terrain } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";

export const TERRAIN_DETAIL_KINDS = [
  "short_grass",
  "tall_grass",
  "fescue",
  "flowers",
  "leaf_litter",
  "reeds",
  "shore_stones",
  "pebbles",
  "bunker_tuft",
  "scrub",
] as const;

export type TerrainDetailKind = (typeof TERRAIN_DETAIL_KINDS)[number];
export type TerrainDetailFrame = `${LandTheme}_${TerrainDetailKind}_${0 | 1}`;

export interface TerrainDetailDefinition {
  theme: LandTheme;
  kind: TerrainDetailKind;
  frames: readonly [TerrainDetailFrame, TerrainDetailFrame];
  allowedTerrain: readonly Terrain[];
  density: number;
  detailTier: 1 | 2;
  scaleRange: readonly [number, number];
  edgeTerrain?: readonly Terrain[];
}

export interface TerrainDetailPlacement {
  frame: TerrainDetailFrame;
  offsetX: number;
  offsetY: number;
  detailTier: 1 | 2;
  scale: number;
}

export const TERRAIN_DETAILS: readonly TerrainDetailDefinition[] = [
  detail("parkland", "short_grass", ["rough"], 0.24, 1, [0.82, 1.05]),
  detail("parkland", "tall_grass", ["deep_rough"], 0.42, 1, [0.88, 1.12]),
  detail("parkland", "flowers", ["rough"], 0.08, 2, [0.78, 1]),
  detail("parkland", "leaf_litter", ["rough", "deep_rough"], 0.11, 2, [0.82, 1.08]),
  detail("parkland", "reeds", ["rough", "wetland"], 0.48, 1, [0.9, 1.16], ["water", "wetland"]),
  detail("parkland", "shore_stones", ["rough", "sand", "waste_area"], 0.34, 1, [0.86, 1.08], ["water", "wetland"]),
  detail("parkland", "pebbles", ["sand", "waste_area"], 0.28, 2, [0.82, 1.08]),
  detail("parkland", "bunker_tuft", ["rough", "deep_rough"], 0.44, 1, [0.84, 1.08], ["sand"]),
  detail("parkland", "scrub", ["waste_area"], 0.16, 1, [0.78, 1]),

  detail("links", "short_grass", ["rough"], 0.28, 1, [0.82, 1.06]),
  detail("links", "fescue", ["deep_rough"], 0.58, 1, [0.92, 1.18]),
  detail("links", "reeds", ["rough", "wetland"], 0.46, 1, [0.92, 1.14], ["water", "wetland"]),
  detail("links", "shore_stones", ["rough", "sand", "waste_area"], 0.38, 1, [0.9, 1.12], ["water", "wetland"]),
  detail("links", "pebbles", ["sand", "waste_area"], 0.32, 2, [0.84, 1.1]),
  detail("links", "bunker_tuft", ["rough", "deep_rough"], 0.52, 1, [0.9, 1.12], ["sand"]),
  detail("links", "scrub", ["waste_area"], 0.22, 1, [0.82, 1.04]),

  detail("desert", "short_grass", ["rough"], 0.18, 1, [0.78, 1]),
  detail("desert", "tall_grass", ["deep_rough"], 0.24, 1, [0.82, 1.08]),
  detail("desert", "shore_stones", ["rough", "sand", "waste_area"], 0.34, 1, [0.86, 1.1], ["water", "wetland"]),
  detail("desert", "pebbles", ["sand", "waste_area"], 0.4, 1, [0.86, 1.12]),
  detail("desert", "bunker_tuft", ["rough", "deep_rough"], 0.28, 1, [0.82, 1.02], ["sand"]),
  detail("desert", "scrub", ["rough", "deep_rough", "waste_area"], 0.34, 1, [0.86, 1.12]),
];

export const TERRAIN_DETAIL_FRAMES = TERRAIN_DETAILS.flatMap((entry) => entry.frames);

function detail(
  theme: LandTheme,
  kind: TerrainDetailKind,
  allowedTerrain: readonly Terrain[],
  density: number,
  detailTier: 1 | 2,
  scaleRange: readonly [number, number],
  edgeTerrain?: readonly Terrain[],
): TerrainDetailDefinition {
  return {
    theme,
    kind,
    frames: [`${theme}_${kind}_0`, `${theme}_${kind}_1`],
    allowedTerrain,
    density,
    detailTier,
    scaleRange,
    ...(edgeTerrain ? { edgeTerrain } : {}),
  };
}

function hash(seed: number, x: number, y: number, salt = 0): number {
  let value = (seed ^ Math.imul(x + 17, 0x45d9f3b) ^ Math.imul(y + 31, 0x119de1f3) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function hasNeighborTerrain(
  course: Course,
  x: number,
  y: number,
  terrains: readonly Terrain[],
): boolean {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= course.width || ny >= course.height) continue;
    if (terrains.includes(course.tiles[ny * course.width + nx])) return true;
  }
  return false;
}

/**
 * Presentation-only biome dressing. The selection depends solely on
 * immutable course context, seed, and tile coordinates, so it never enters a
 * save or changes when chunks rebuild or the camera rotates.
 */
export function deriveTerrainDetail(
  course: Course,
  seed: number,
  x: number,
  y: number,
): TerrainDetailPlacement | null {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height) return null;
  const theme = getBiomeDefinition(course.theme).content.materials.details;
  const terrain = course.tiles[y * course.width + x];
  const candidates = TERRAIN_DETAILS.filter((entry) =>
    entry.theme === theme &&
    entry.allowedTerrain.includes(terrain) &&
    (!entry.edgeTerrain || hasNeighborTerrain(course, x, y, entry.edgeTerrain))
  );
  if (candidates.length === 0) return null;

  const h = hash(seed, x, y, terrain.length * 131);
  let target = ((h >>> 8) & 0xffff) / 0xffff;
  let picked: TerrainDetailDefinition | null = null;
  for (const candidate of candidates) {
    if (target < candidate.density) {
      picked = candidate;
      break;
    }
    target -= candidate.density;
  }
  if (!picked) return null;

  const variant = (h >>> 27) & 1;
  const scaleT = ((h >>> 16) & 0xff) / 0xff;
  return {
    frame: picked.frames[variant],
    offsetX: (((h >>> 3) & 31) / 31 - 0.5) * 25,
    offsetY: (((h >>> 13) & 15) / 15 - 0.5) * 7 + 8,
    detailTier: picked.detailTier,
    scale: picked.scaleRange[0] + (picked.scaleRange[1] - picked.scaleRange[0]) * scaleT,
  };
}
