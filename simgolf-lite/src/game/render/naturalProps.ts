import type { LandTheme, Obstacle, ObstacleType, Terrain } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";

export type NaturalPropFrame = `${LandTheme}_${ObstacleType}_${string}`;
export type PropSway = { amplitude: number; speed: number } | null;

export interface NaturalPropVariant {
  frame: NaturalPropFrame;
  obstacleType: ObstacleType;
  weight: number;
  scaleRange: readonly [number, number];
  anchor: readonly [number, number];
  shadow: { radiusX: number; radiusY: number; offsetX: number; offsetY: number; alpha: number };
  sway: PropSway;
  density: number;
  clusterAffinity: number;
  allowedTerrain: readonly Terrain[];
  minElevation?: number;
  maxElevation?: number;
  nearWater?: "prefer" | "require" | "avoid";
  composition: { wild: number; cultivated: number };
  occlusion: { tall: boolean; fadeAlpha: number };
}

const LAND: readonly Terrain[] = ["rough", "deep_rough", "waste_area"];
const ROUGH: readonly Terrain[] = ["rough", "deep_rough"];

function tree(
  theme: LandTheme,
  name: string,
  weight: number,
  options: Partial<NaturalPropVariant> = {}
): NaturalPropVariant {
  return {
    frame: `${theme}_tree_${name}`,
    obstacleType: "tree",
    weight,
    scaleRange: [0.86, 1.12],
    anchor: [0.5, 1],
    shadow: { radiusX: 14, radiusY: 6, offsetX: 3, offsetY: 1.5, alpha: 0.2 },
    sway: { amplitude: 0.032, speed: 1.05 },
    density: 1,
    clusterAffinity: 0.75,
    allowedTerrain: ROUGH,
    composition: { wild: 1, cultivated: 0.75 },
    occlusion: { tall: true, fadeAlpha: 0.3 },
    ...options,
  };
}

function bush(
  theme: LandTheme,
  name: string,
  weight: number,
  options: Partial<NaturalPropVariant> = {}
): NaturalPropVariant {
  return {
    frame: `${theme}_bush_${name}`,
    obstacleType: "bush",
    weight,
    scaleRange: [0.58, 0.82],
    anchor: [0.5, 1],
    shadow: { radiusX: 10, radiusY: 4, offsetX: 2, offsetY: 1, alpha: 0.16 },
    sway: { amplitude: 0.018, speed: 1.25 },
    density: 1,
    clusterAffinity: 0.82,
    allowedTerrain: LAND,
    composition: { wild: 1, cultivated: 0.8 },
    occlusion: { tall: false, fadeAlpha: 0.55 },
    ...options,
  };
}

function rock(
  theme: LandTheme,
  name: string,
  weight: number,
  options: Partial<NaturalPropVariant> = {}
): NaturalPropVariant {
  return {
    frame: `${theme}_rock_${name}`,
    obstacleType: "rock",
    weight,
    scaleRange: [0.62, 0.9],
    anchor: [0.5, 1],
    shadow: { radiusX: 9, radiusY: 4, offsetX: 2, offsetY: 1, alpha: 0.18 },
    sway: null,
    density: 0.75,
    clusterAffinity: 0.35,
    allowedTerrain: LAND,
    composition: { wild: 1, cultivated: 0.35 },
    occlusion: { tall: false, fadeAlpha: 0.55 },
    ...options,
  };
}

export const NATURAL_PROP_REGISTRY = {
  parkland: {
    tree: [
      tree("parkland", "oak", 5, { scaleRange: [0.95, 1.18] }),
      tree("parkland", "birch", 3, { scaleRange: [0.82, 1.02], clusterAffinity: 0.88 }),
      tree("parkland", "pine", 3),
      tree("parkland", "fir", 3, { scaleRange: [0.9, 1.14] }),
      tree("parkland", "dogwood", 2, { scaleRange: [0.74, 0.9], composition: { wild: 0.35, cultivated: 2.2 } }),
    ],
    bush: [
      bush("parkland", "hedge", 2, { composition: { wild: 0.15, cultivated: 3 }, clusterAffinity: 0.95 }),
      bush("parkland", "wild_shrub", 5),
      bush("parkland", "reeds", 2, { nearWater: "require", scaleRange: [0.68, 0.92] }),
      bush("parkland", "wildflowers", 2, { composition: { wild: 0.8, cultivated: 1.8 }, scaleRange: [0.5, 0.68] }),
    ],
    rock: [
      rock("parkland", "stump", 1, { allowedTerrain: ROUGH, composition: { wild: 1.2, cultivated: 0.1 } }),
      rock("parkland", "granite", 4),
      rock("parkland", "angular", 3),
    ],
  },
  links: {
    tree: [
      tree("links", "wind_pine", 4, { scaleRange: [0.82, 1.02], sway: { amplitude: 0.05, speed: 1.4 } }),
      tree("links", "hawthorn", 5, { scaleRange: [0.66, 0.84], sway: { amplitude: 0.04, speed: 1.5 } }),
    ],
    bush: [
      bush("links", "golden_fescue", 5, { scaleRange: [0.46, 0.65], sway: { amplitude: 0.045, speed: 1.65 } }),
      bush("links", "dune_grass", 5, { scaleRange: [0.48, 0.68], sway: { amplitude: 0.05, speed: 1.7 } }),
      bush("links", "gorse", 4),
      bush("links", "heather", 3, { scaleRange: [0.48, 0.65] }),
      bush("links", "marram", 4, { nearWater: "prefer", sway: { amplitude: 0.055, speed: 1.7 } }),
      bush("links", "salt_shrub", 2, { nearWater: "prefer", scaleRange: [0.45, 0.62] }),
    ],
    rock: [
      rock("links", "driftwood", 1, { nearWater: "prefer", scaleRange: [0.72, 0.96] }),
      rock("links", "coastal_stone", 4),
      rock("links", "slate", 3),
      rock("links", "dune_boulder", 3),
    ],
  },
  desert: {
    tree: [
      tree("desert", "saguaro", 5, { scaleRange: [0.78, 1.05], sway: null }),
      tree("desert", "palo_verde", 3, { scaleRange: [0.82, 1.04], sway: { amplitude: 0.018, speed: 0.9 } }),
      tree("desert", "mesquite", 4, { scaleRange: [0.72, 0.94], sway: { amplitude: 0.016, speed: 0.95 } }),
      tree("desert", "palm", 2, { nearWater: "require", scaleRange: [0.88, 1.12], sway: { amplitude: 0.05, speed: 1.2 } }),
    ],
    bush: [
      bush("desert", "prickly_pear", 5, { sway: null }),
      bush("desert", "barrel_cactus", 4, { scaleRange: [0.48, 0.68], sway: null }),
      bush("desert", "creosote", 4, { sway: { amplitude: 0.012, speed: 1 } }),
      bush("desert", "agave", 3, { sway: null }),
      bush("desert", "dry_grass", 3, { scaleRange: [0.45, 0.64], sway: { amplitude: 0.04, speed: 1.5 } }),
    ],
    rock: [
      rock("desert", "sandstone", 4),
      rock("desert", "red_outcrop", 4, { scaleRange: [0.75, 1] }),
      rock("desert", "volcanic", 3),
    ],
  },
} satisfies Record<LandTheme, Record<ObstacleType, readonly NaturalPropVariant[]>>;

export const NATURAL_PROP_FRAMES = Object.values(NATURAL_PROP_REGISTRY)
  .flatMap((theme) => Object.values(theme).flat())
  .map((variant) => variant.frame);

function hash(seed: number, obstacle: Obstacle, salt = 0): number {
  let value = Math.imul((seed | 0) ^ Math.imul(obstacle.x + 17, 73856093), 19349663);
  value ^= Math.imul(obstacle.y + 31, 83492791) ^ Math.imul(obstacle.type.charCodeAt(0), 2654435761) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  return (value ^ (value >>> 13)) >>> 0;
}

export interface NaturalPropContext {
  theme?: LandTheme;
  runSeed: number;
  obstacle: Obstacle;
  terrain: Terrain;
  elevation: number;
  nearWater: boolean;
  cultivated: boolean;
}

export function pickNaturalProp(context: NaturalPropContext): { variant: NaturalPropVariant; scale: number } {
  const theme = getBiomeDefinition(context.theme).content.props.natural;
  const all = NATURAL_PROP_REGISTRY[theme][context.obstacle.type];
  const valid = all.filter((variant) =>
    variant.allowedTerrain.includes(context.terrain) &&
    context.elevation >= (variant.minElevation ?? -Infinity) &&
    context.elevation <= (variant.maxElevation ?? Infinity) &&
    (variant.nearWater !== "require" || context.nearWater)
  );
  // Relax context filters within the selected biome instead of silently
  // borrowing another biome's species.
  const candidates = valid.length > 0 ? valid : all;
  const weighted = candidates.map((variant) => {
    const waterFactor = variant.nearWater === "prefer" ? (context.nearWater ? 2.5 : 0.45) : variant.nearWater === "avoid" ? (context.nearWater ? 0.2 : 1) : 1;
    const composition = context.cultivated ? variant.composition.cultivated : variant.composition.wild;
    return { variant, weight: Math.max(0.01, variant.weight * variant.density * waterFactor * composition) };
  });
  const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  let target = (hash(context.runSeed ^ theme.charCodeAt(0), context.obstacle) / 0x100000000) * total;
  let picked = weighted[0].variant;
  for (const candidate of weighted) {
    if (target < candidate.weight) { picked = candidate.variant; break; }
    target -= candidate.weight;
  }
  const scaleT = hash(context.runSeed, context.obstacle, 0x51a1e) / 0x100000000;
  const scale = picked.scaleRange[0] + (picked.scaleRange[1] - picked.scaleRange[0]) * scaleT;
  return { variant: picked, scale };
}

export function missingNaturalPropFrames(hasFrame: (frame: NaturalPropFrame) => boolean): NaturalPropFrame[] {
  return NATURAL_PROP_FRAMES.filter((frame) => !hasFrame(frame));
}

export function shouldFadeTallProp(input: {
  tall: boolean;
  propX: number;
  propY: number;
  propWidth: number;
  propHeight: number;
  focusX: number;
  focusY: number;
}): boolean {
  return input.tall &&
    input.propY >= input.focusY &&
    input.propY - input.focusY < input.propHeight * 0.8 &&
    Math.abs(input.propX - input.focusX) < input.propWidth * 0.72;
}
