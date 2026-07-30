import type { LandTheme, Terrain } from "../models/types";
import { BIOME_KEYS, getBiomeDefinition } from "../models/biomes";
import type { AutotileFeature, CardinalDirection, CornerDirection } from "./autotile";

export const TERRAIN_KINDS = ["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"] as const satisfies readonly Terrain[];
export const LAND_THEME_KINDS: readonly LandTheme[] = BIOME_KEYS;

export type PaletteRole = "playing" | "natural" | "hazard" | "path";
export type TerrainBoundaryRole =
  | "fringe"
  | "bunker-lip"
  | "shore"
  | "path-shoulder"
  | "natural-feather";
export type TerrainBaseFrame = `${LandTheme}_${Terrain}_base_${0 | 1 | 2 | 3 | 4 | 5}`;
export type TerrainTransitionFrame = `${LandTheme}_${Terrain}_${"edge" | "outer" | "inner"}_${"n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"}`;
export type TerrainAtlasFrame = TerrainBaseFrame | TerrainTransitionFrame;

export interface WeightedTerrainFrame {
  frame: TerrainBaseFrame;
  weight: number;
}

export interface MowingAxis {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  len2: number;
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

/**
 * Seam ownership, highest priority first. Exported because silhouette rounding
 * (ZK-468) and contour bands (ZK-469) must resolve the same owner this does.
 */
export const TERRAIN_BOUNDARY_PRIORITY: readonly Terrain[] = [
  "water",
  "wetland",
  "sand",
  "path",
  "green",
  "tee",
  "fairway",
  "waste_area",
  "deep_rough",
  "rough",
];

const BOUNDARY_ROLE: Record<Terrain, TerrainBoundaryRole> = {
  water: "shore",
  wetland: "shore",
  sand: "bunker-lip",
  path: "path-shoulder",
  green: "fringe",
  tee: "fringe",
  fairway: "fringe",
  waste_area: "natural-feather",
  deep_rough: "natural-feather",
  rough: "natural-feather",
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
export const TERRAIN_MATERIALS = Object.fromEntries(
  BIOME_KEYS.map((theme) => [theme, themeManifest(theme)]),
) as Record<LandTheme, Record<Terrain, TerrainMaterialDefinition>>;

export function getTerrainMaterial(theme: LandTheme | undefined, terrain: Terrain): TerrainMaterialDefinition {
  const owner = getBiomeDefinition(theme).content.materials.terrain;
  return TERRAIN_MATERIALS[owner][terrain];
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

/**
 * World-anchored mowing bands. Because phase is derived only from course
 * coordinates and routed hole axes, it never resets at tile/chunk boundaries
 * or changes when the camera rotates.
 */
export function mowingShadeAt(
  x: number,
  y: number,
  axes: readonly MowingAxis[],
): number {
  let along: number | null = null;
  let bestDistance2 = 100; // nearest routed surface within ten tiles
  for (const axis of axes) {
    const px = x + 0.5 - axis.ax;
    const py = y + 0.5 - axis.ay;
    const t = Math.max(0, Math.min(1, (px * axis.dx + py * axis.dy) / axis.len2));
    const acrossX = px - t * axis.dx;
    const acrossY = py - t * axis.dy;
    const distance2 = acrossX * acrossX + acrossY * acrossY;
    if (distance2 >= bestDistance2) continue;
    bestDistance2 = distance2;
    along = t * Math.sqrt(axis.len2);
  }
  const band = along === null
    ? ((Math.floor((x - y) / 3.75) % 2) + 2) % 2
    : Math.floor(along / 3.75) % 2;
  // Broad, low-contrast bands read as one mown surface instead of alternating
  // light/dark diamonds. The texture atlas supplies the finer blade detail.
  return band === 0 ? 1.035 : 0.98;
}

/** Spatially coherent water phase; neighboring tiles form one moving field. */
export function waterShimmerPhase(x: number, y: number): number {
  const tau = Math.PI * 2;
  return ((x * 0.37 + y * 0.23) % tau + tau) % tau;
}

/**
 * Selects exactly one visual owner for a same-elevation terrain seam.
 * Ownership is semantic rather than numeric: water always supplies its bank,
 * sand its bunker lip, paths their shoulder, and maintained turf its fringe.
 */
export function terrainBoundaryFor(
  a: Terrain,
  b: Terrain,
): { owner: Terrain; role: TerrainBoundaryRole } | null {
  if (a === b) return null;
  const owner = TERRAIN_BOUNDARY_PRIORITY.find((terrain) => terrain === a || terrain === b);
  if (!owner) return null;
  return { owner, role: BOUNDARY_ROLE[owner] };
}

export function terrainTransitionFrame(material: TerrainMaterialDefinition, feature: AutotileFeature): TerrainTransitionFrame {
  if (feature.kind === "edge") return material.transitionFrames.edge[feature.direction];
  if (feature.kind === "outer") return material.transitionFrames.outer[feature.direction];
  return material.transitionFrames.inner[feature.direction];
}
