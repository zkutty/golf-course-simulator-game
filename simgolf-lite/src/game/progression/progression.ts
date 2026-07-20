import type { BuildingTier, ConcessionType, ObstacleType, Terrain } from "../models/types";
import type { TournamentTier } from "../tournaments/types";

export type ReputationTierId = "municipal" | "local" | "regional" | "destination" | "legendary";

export interface ReputationTier {
  id: ReputationTierId;
  name: string;
  minReputation: number;
  staffCap: number;
  buildingTierCap: BuildingTier;
  staffRole: string;
  headlineUnlocks: string[];
}

export const REPUTATION_TIERS: readonly ReputationTier[] = [
  { id: "municipal", name: "Municipal", minReputation: 0, staffCap: 1, buildingTierCap: 1, staffRole: "Groundskeeper", headlineUnlocks: ["Snack Bar", "Local events", "Core course tools"] },
  { id: "local", name: "Local Favorite", minReputation: 25, staffCap: 2, buildingTierCap: 1, staffRole: "Cart attendant", headlineUnlocks: ["Sand & water", "Cart Rental", "Local tournaments"] },
  { id: "regional", name: "Regional Draw", minReputation: 45, staffCap: 3, buildingTierCap: 1, staffRole: "Pro shop staff", headlineUnlocks: ["Pro Shop", "Deep rough", "Regional tournaments"] },
  { id: "destination", name: "Destination Course", minReputation: 65, staffCap: 4, buildingTierCap: 2, staffRole: "Course marshal", headlineUnlocks: ["Rocks", "Tier 2 concessions", "Championship events"] },
  { id: "legendary", name: "Legendary Club", minReputation: 85, staffCap: 5, buildingTierCap: 3, staffRole: "Tournament director", headlineUnlocks: ["Tier 3 concessions", "Full staff roster", "Legend status"] },
] as const;

const TERRAIN_MIN_REP: Record<Terrain, number> = {
  fairway: 0, rough: 0, green: 0, tee: 0, path: 0,
  sand: 25, water: 25, deep_rough: 45,
};
const OBSTACLE_MIN_REP: Record<ObstacleType, number> = { tree: 0, bush: 25, rock: 65 };
const CONCESSION_MIN_REP: Record<ConcessionType, number> = { snack_bar: 0, cart_rental: 25, pro_shop: 45 };
const TOURNAMENT_MIN_REP: Record<TournamentTier, number> = { local: 25, regional: 45, championship: 65 };

export function reputationTier(reputation: number): ReputationTier {
  const rep = Number.isFinite(reputation) ? reputation : 0;
  for (let i = REPUTATION_TIERS.length - 1; i >= 0; i--) {
    if (rep >= REPUTATION_TIERS[i].minReputation) return REPUTATION_TIERS[i];
  }
  return REPUTATION_TIERS[0];
}

export function nextReputationTier(reputation: number): ReputationTier | null {
  const index = REPUTATION_TIERS.indexOf(reputationTier(reputation));
  return REPUTATION_TIERS[index + 1] ?? null;
}

export function reputationProgress(reputation: number): number {
  const current = reputationTier(reputation);
  const next = nextReputationTier(reputation);
  if (!next) return 1;
  return Math.max(0, Math.min(1, (reputation - current.minReputation) / (next.minReputation - current.minReputation)));
}

export const terrainMinReputation = (terrain: Terrain) => TERRAIN_MIN_REP[terrain];
export const obstacleMinReputation = (obstacle: ObstacleType) => OBSTACLE_MIN_REP[obstacle];
export const concessionMinReputation = (type: ConcessionType) => CONCESSION_MIN_REP[type];
export const tournamentMinReputation = (tier: TournamentTier) => TOURNAMENT_MIN_REP[tier];

export const isTerrainUnlocked = (terrain: Terrain, reputation: number) => reputation >= terrainMinReputation(terrain);
export const isObstacleUnlocked = (obstacle: ObstacleType, reputation: number) => reputation >= obstacleMinReputation(obstacle);
export const isConcessionUnlocked = (type: ConcessionType, reputation: number) => reputation >= concessionMinReputation(type);
export const isTournamentUnlocked = (tier: TournamentTier, reputation: number) => reputation >= tournamentMinReputation(tier);

export function unlockedStaffRoles(reputation: number): string[] {
  const cap = reputationTier(reputation).staffCap;
  return REPUTATION_TIERS.slice(0, cap).map((tier) => tier.staffRole);
}
