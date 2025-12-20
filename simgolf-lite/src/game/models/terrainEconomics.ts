import type { Terrain } from "./types";

// Capital expense: build costs per tile
export const TERRAIN_BUILD_COST: Record<Terrain, number> = {
  rough: 10,
  deep_rough: 25,
  fairway: 120,
  green: 300,
  sand: 80,
  water: 200,
  tee: 150,
  path: 40,
};

// Partial refunds when reverting/tearing down (fun + experimentation)
export const TERRAIN_SALVAGE_VALUE: Record<Terrain, number> = {
  rough: 0,
  deep_rough: 5,
  fairway: 40,
  green: 120,
  sand: 30,
  water: 50,
  tee: 60,
  path: 15,
};

// Opex pressure / maintenance burden (greens wear fastest)
export const TERRAIN_MAINT_WEIGHT: Record<Terrain, number> = {
  rough: 0.3,
  deep_rough: 0.6,
  fairway: 1.0,
  green: 2.5,
  sand: 1.2,
  water: 0.6,
  tee: 1.0,
  path: 0.4,
};

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


