import type { LandTheme, Terrain } from "./types";
import { BALANCE } from "../balance/balanceConfig";
import { getBiomeDefinition } from "./biomes";

/**
 * Theme flavor on build economics (ZKU-166): data-driven per-terrain build
 * multiplier (today: desert water is precious). Neutral for parkland.
 */
export function themeBuildMult(theme: LandTheme | undefined, terrain: Terrain): number {
  if (terrain !== "water") return 1;
  return BALANCE.themes[getBiomeDefinition(theme).key].waterBuildCostMult;
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

export function computeElevationChangeCost(deltaSteps: number, costMult = 1): TerrainChangeCost {
  const charged = Math.abs(deltaSteps) * ELEVATION_COST_PER_STEP * costMult;
  return { net: charged, charged, refunded: 0 };
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

  const salvage = (TERRAIN_SALVAGE_VALUE[prev] ?? 0) * costMult * themeBuildMult(theme, prev);
  const gross = next === "rough"
    ? 0
    : (TERRAIN_BUILD_COST[next] ?? 0) * costMult * themeBuildMult(theme, next);
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
