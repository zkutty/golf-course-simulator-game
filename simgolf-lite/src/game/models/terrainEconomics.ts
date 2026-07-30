import type { LandTheme, Terrain } from "./types";
import { BALANCE } from "../balance/balanceConfig";
import { getBiomeDefinition } from "./biomes";

/**
 * Registry-driven biome construction multiplier. Difficulty remains a
 * separate outer multiplier at every charge/refund callsite.
 */
export function themeBuildMult(theme: LandTheme | undefined, terrain: Terrain): number {
  return getBiomeDefinition(theme).economy.terrain[terrain].construction;
}

export function themeUpkeepMult(theme: LandTheme | undefined, terrain: Terrain): number {
  return getBiomeDefinition(theme).economy.terrain[terrain].upkeep;
}

export function themeEarthworkMult(theme: LandTheme | undefined): number {
  return getBiomeDefinition(theme).economy.earthwork.constructionMultiplier;
}

// Capital expense: build costs per tile
export const TERRAIN_BUILD_COST: Record<Terrain, number> = {
  ...BALANCE.terrain.buildCost,
};

// Partial refunds when reverting/tearing down (fun + experimentation)
export const TERRAIN_SALVAGE_VALUE: Record<Terrain, number> = {
  ...BALANCE.terrain.salvageValue,
};

// Opex pressure / maintenance burden (greens wear fastest)
export const TERRAIN_MAINT_WEIGHT: Record<Terrain, number> = {
  ...BALANCE.terrain.maintWeight,
};

// Earthworks: sculpting charges per tile per elevation step, both directions,
// with no salvage (you can't un-move dirt for money).
export const ELEVATION_COST_PER_STEP: number = BALANCE.terrain.earthworkCostPerStep;

export function terrainConstructionUnitCost(
  terrain: Terrain,
  theme?: LandTheme,
  costMult = 1,
): number {
  // Painting back to rough is the long-standing teardown/reversion path and
  // carries no construction charge. Keep the shared unit quote identical to
  // preview/reducer commitment so HUD and Golfopedia never advertise the raw
  // balance-table value as a payable price.
  if (terrain === "rough") return 0;
  return TERRAIN_BUILD_COST[terrain] * themeBuildMult(theme, terrain) * costMult;
}

export function terrainSalvageUnitValue(
  terrain: Terrain,
  theme?: LandTheme,
  costMult = 1,
): number {
  return TERRAIN_SALVAGE_VALUE[terrain] * themeBuildMult(theme, terrain) * costMult;
}

export function terrainMaintenanceWeight(
  terrain: Terrain,
  theme?: LandTheme,
): number {
  return TERRAIN_MAINT_WEIGHT[terrain] * themeUpkeepMult(theme, terrain);
}

export function computeElevationChangeCost(
  deltaSteps: number,
  costMult = 1,
  theme?: LandTheme,
): TerrainChangeCost {
  const charged = Math.abs(deltaSteps)
    * ELEVATION_COST_PER_STEP
    * themeEarthworkMult(theme)
    * costMult;
  return { net: charged, charged, refunded: 0 };
}

export function quoteDrainageImprovement(
  theme: LandTheme | undefined,
  currentLevel: number,
  costMult = 1,
): number {
  return Math.round(
    18_000
    * (Math.max(0, Math.floor(currentLevel)) + 1)
    * getBiomeDefinition(theme).economy.drainage.constructionMultiplier
    * costMult,
  );
}

export interface TerrainChangeCost {
  // Positive => cost, negative => refund
  net: number;
  // Positive-only breakdowns (for reporting)
  charged: number;
  refunded: number;
}

export interface TerrainChangeBreakdown extends TerrainChangeCost {
  /** Full construction spend before salvage is applied. */
  gross: number;
  /** Full salvage value credited by the replaced terrain. */
  salvage: number;
}

export function computeTerrainChangeBreakdown(
  prev: Terrain,
  next: Terrain,
  costMult = 1,
  theme?: LandTheme
): TerrainChangeBreakdown {
  if (prev === next) return { net: 0, charged: 0, refunded: 0, gross: 0, salvage: 0 };

  const salvage = terrainSalvageUnitValue(prev, theme, costMult);
  const gross = next === "rough"
    ? 0
    : terrainConstructionUnitCost(next, theme, costMult);
  const net = gross - salvage;
  return {
    net,
    charged: Math.max(0, net),
    refunded: Math.max(0, -net),
    gross,
    salvage,
  };
}

// Delta-based economics:
// - switching to rough refunds salvage (rough is effectively "free" to paint)
// - switching premium->premium refunds salvage then charges build difference
// `costMult` is the run difficulty's terrain scaler (ZKU-165); build and
// salvage scale together so refund ratios stay difficulty-neutral. `theme`
// adds the land theme's per-terrain flavor (ZKU-166) symmetrically: what
// cost more to build also salvages proportionally more.
export function computeTerrainChangeCost(
  prev: Terrain,
  next: Terrain,
  costMult = 1,
  theme?: LandTheme
): TerrainChangeCost {
  const { net, charged, refunded } = computeTerrainChangeBreakdown(prev, next, costMult, theme);
  return { net, charged, refunded };
}
