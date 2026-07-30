import type { LandTheme, Terrain } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";

export interface TerrainReliefStyle {
  /** Presentation-only drop below the tile's simulation elevation. */
  surfaceInsetPx: number;
  /** Vertical face below the surrounding surface. */
  bankLight: number;
  bankDark: number;
}

const SURFACE_INSET_PX: Record<Terrain, number> = {
  fairway: 0,
  rough: 0,
  deep_rough: 0,
  sand: 2.5,
  waste_area: 0,
  water: 5,
  wetland: 3,
  green: 0,
  tee: 0,
  path: 0,
};

const BANK_COLORS: Record<LandTheme, Record<"sand" | "wetland" | "water", [number, number]>> = {
  parkland: {
    sand: [0xb89b60, 0x80633a],
    wetland: [0x4e7053, 0x2d493a],
    water: [0x54756c, 0x2b493f],
  },
  links: {
    sand: [0xc6b67c, 0x8a7449],
    wetland: [0x66785a, 0x3b5041],
    water: [0x71877a, 0x3c5148],
  },
  desert: {
    sand: [0xc99d5c, 0x8f6235],
    wetland: [0x617652, 0x384b37],
    water: [0x6d8978, 0x3c5548],
  },
};

const HILL_RELIEF_STRENGTH: Record<LandTheme, number> = {
  parkland: 0.62,
  links: 1,
  desert: 0.5,
};

export function terrainSurfaceInsetPx(terrain: Terrain): number {
  return SURFACE_INSET_PX[terrain];
}

export function terrainReliefStyle(
  theme: LandTheme | undefined,
  terrain: Terrain,
): TerrainReliefStyle | null {
  const inset = terrainSurfaceInsetPx(terrain);
  if (inset <= 0) return null;
  const owner = getBiomeDefinition(theme).content.materials.terrain;
  const bank = BANK_COLORS[owner][terrain as "sand" | "wetland" | "water"];
  return {
    surfaceInsetPx: inset,
    bankLight: bank[0],
    bankDark: bank[1],
  };
}

/** Links uses pronounced dune caps; other themes keep the same cue quieter. */
export function hillReliefStrength(theme: LandTheme | undefined): number {
  const owner = getBiomeDefinition(theme).content.materials.terrain;
  return HILL_RELIEF_STRENGTH[owner];
}
