import type { Terrain } from "./types";
import { BALANCE } from "../balance/balanceConfig";

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

export function computeElevationChangeCost(deltaSteps: number): TerrainChangeCost {
  const charged = Math.abs(deltaSteps) * ELEVATION_COST_PER_STEP;
  return { net: charged, charged, refunded: 0 };
}

export interface TerrainChangeCost {
  // Positive => cost, negative => refund
  net: number;
  // Positive-only breakdowns (for reporting)
  charged: number;
  refunded: number;
}

// Delta-based economics:
// - switching to rough refunds salvage (rough is effectively "free" to paint)
// - switching premium->premium refunds salvage then charges build difference
export function computeTerrainChangeCost(prev: Terrain, next: Terrain): TerrainChangeCost {
  if (prev === next) return { net: 0, charged: 0, refunded: 0 };

  const salvage = TERRAIN_SALVAGE_VALUE[prev] ?? 0;

  // Reverting to rough: refund salvage only (no rough build cost)
  if (next === "rough") return { net: -salvage, charged: 0, refunded: salvage };

  const build = TERRAIN_BUILD_COST[next] ?? 0;
  const net = build - salvage;
  return {
    net,
    charged: Math.max(0, net),
    refunded: Math.max(0, -net),
  };
}


