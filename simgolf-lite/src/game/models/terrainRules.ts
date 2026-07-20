import { BALANCE } from "../balance/balanceConfig";
import type { Terrain } from "./types";

export const WATER_HAZARD_TERRAINS = ["water", "wetland"] as const satisfies readonly Terrain[];

export function isWaterHazard(terrain: Terrain | null | undefined): boolean {
  return terrain === "water" || terrain === "wetland";
}

export function isWalkableTerrain(terrain: Terrain): boolean {
  return Number.isFinite(BALANCE.terrain.walkingCost[terrain]);
}

export function terrainWalkingCost(terrain: Terrain): number {
  return BALANCE.terrain.walkingCost[terrain];
}
