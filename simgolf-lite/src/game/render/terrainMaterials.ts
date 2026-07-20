import type { LandTheme, Terrain } from "../models/types";
import type { AutotileFeature, CardinalDirection, CornerDirection } from "./autotile";

export const TERRAIN_KINDS = ["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"] as const satisfies readonly Terrain[];
export const LAND_THEME_KINDS = ["parkland", "links", "desert"] as const satisfies readonly LandTheme[];

export type PaletteRole = "playing" | "natural" | "hazard" | "path";
export type TerrainBaseFrame = `${LandTheme}_${Terrain}_base_${0 | 1 | 2 | 3 | 4 | 5}`;
export type TerrainTransitionFrame = `${LandTheme}_${Terrain}_${"edge" | "outer" | "inner"}_${"n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"}`;
export type TerrainAtlasFrame = TerrainBaseFrame | TerrainTransitionFrame;

export interface WeightedTerrainFrame {
  frame: TerrainBaseFrame;
  weight: number;
}

export interface TerrainMaterialDefinition {
  id: `${LandTheme}.${Terrain}`;
  theme: LandTheme;
  terrain: Terrain;
  /** Every M21 biome ships authored @2x materials. */
  source: "atlas-2x" | "legacy-tint";
  baseFrames: readonly WeightedTerrainFrame[];
  transitionFrames: {
    edge: Record<CardinalDirection, TerrainTransitionFrame>;
    outer: Record<CornerDirection, TerrainTransitionFrame>;
    inner: Record<CornerDirection, TerrainTransitionFrame>;
  };
  paletteRole: PaletteRole;
  decals: readonly ("mowing" | "fringe" | "bunker-lip" | "shore" | "path-shoulder")[];
  animation?: { kind: "water-ripple"; reducedMotionFrame: TerrainBaseFrame };
  fallbackFrame: "diamond0";
}

const PALETTE_ROLE: Record<Terrain, PaletteRole> = {
  fairway: "playing", green: "playing", tee: "playing",
  rough: "natural", deep_rough: "natural",
  sand: "hazard", waste_area: "natural", water: "hazard", wetland: "hazard", path: "path",
};

const DECALS: Record<Terrain, TerrainMaterialDefinition["decals"]> = {
  fairway: ["mowing"],
  rough: [],
  deep_rough: [],
  sand: ["bunker-lip"],
  waste_area: [],
  water: ["shore"],
  wetland: ["shore"],
  green: ["mowing", "fringe"],
  tee: ["mowing"],
  path: ["path-shoulder"],
};

function material(theme: LandTheme, terrain: Terrain): TerrainMaterialDefinition {
  const baseFrames = Array.from({ length: 6 }, (_, index) => ({
    frame: `${theme}_${terrain}_base_${index}` as TerrainBaseFrame,
    weight: index === 0 ? 3 : index < 3 ? 2 : 1,
  }));
  return {
    id: `${theme}.${terrain}`,
    theme,
    terrain,
    source: "atlas-2x",
    baseFrames,
    transitionFrames: {
      edge: Object.fromEntries(["n", "e", "s", "w"].map((direction) => [direction, `${theme}_${terrain}_edge_${direction}`])) as Record<CardinalDirection, TerrainTransitionFrame>,
      outer: Object.fromEntries(["ne", "se", "sw", "nw"].map((direction) => [direction, `${theme}_${terrain}_outer_${direction}`])) as Record<CornerDirection, TerrainTransitionFrame>,
      inner: Object.fromEntries(["ne", "se", "sw", "nw"].map((direction) => [direction, `${theme}_${terrain}_inner_${direction}`])) as Record<CornerDirection, TerrainTransitionFrame>,
    },
    paletteRole: PALETTE_ROLE[terrain],
    decals: DECALS[terrain],
    animation: terrain === "water"
      ? { kind: "water-ripple", reducedMotionFrame: `${theme}_water_base_0` }
      : undefined,
    fallbackFrame: "diamond0",
  };
}

function themeManifest(theme: LandTheme): Record<Terrain, TerrainMaterialDefinition> {
  return Object.fromEntries(TERRAIN_KINDS.map((terrain) => [terrain, material(theme, terrain)])) as Record<Terrain, TerrainMaterialDefinition>;
}

/** Exhaustive theme × terrain manifest; `satisfies` makes additions fail loudly. */
export const TERRAIN_MATERIALS = {
  parkland: themeManifest("parkland"),
  links: themeManifest("links"),
  desert: themeManifest("desert"),
} satisfies Record<LandTheme, Record<Terrain, TerrainMaterialDefinition>>;

export function getTerrainMaterial(theme: LandTheme | undefined, terrain: Terrain): TerrainMaterialDefinition {
  return TERRAIN_MATERIALS[theme ?? "parkland"][terrain];
}

export function pickTerrainBaseFrame(material: TerrainMaterialDefinition, x: number, y: number): TerrainBaseFrame {
  const total = material.baseFrames.reduce((sum, candidate) => sum + candidate.weight, 0);
  let target = ((x * 73856093) ^ (y * 19349663) ^ ((x + y) * 83492791)) >>> 0;
  target %= total;
  for (const candidate of material.baseFrames) {
    if (target < candidate.weight) return candidate.frame;
    target -= candidate.weight;
  }
  return material.baseFrames[0].frame;
}

export function terrainTransitionFrame(material: TerrainMaterialDefinition, feature: AutotileFeature): TerrainTransitionFrame {
  if (feature.kind === "edge") return material.transitionFrames.edge[feature.direction];
  if (feature.kind === "outer") return material.transitionFrames.outer[feature.direction];
  return material.transitionFrames.inner[feature.direction];
}
