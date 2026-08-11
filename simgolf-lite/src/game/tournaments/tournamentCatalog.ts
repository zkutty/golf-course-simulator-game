import type { TournamentTier } from "./types";

export const TOURNAMENT_TIERS: Record<TournamentTier, { label: string; fieldSize: number; minReputation: number; bookingCost: number; revenueAward: number; reputationAward: number; skillMin: number; skillMax: number }> = {
  local: { label: "Club Open", fieldSize: 8, minReputation: 25, bookingCost: 1_500, revenueAward: 6_000, reputationAward: 2, skillMin: .42, skillMax: .72 },
  regional: { label: "Regional Invitational", fieldSize: 12, minReputation: 45, bookingCost: 3_500, revenueAward: 14_000, reputationAward: 4, skillMin: .62, skillMax: .88 },
  championship: { label: "CourseCraft Championship", fieldSize: 16, minReputation: 65, bookingCost: 7_000, revenueAward: 30_000, reputationAward: 7, skillMin: .78, skillMax: .99 },
};
