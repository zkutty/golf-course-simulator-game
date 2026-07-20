import type { GolferArchetypeName } from "../live/types";

export type TournamentTier = "local" | "regional" | "championship";
export type TournamentStatus = "scheduled" | "completed";

export interface TournamentEntrant {
  id: string;
  name: string;
  archetype: GolferArchetypeName;
  skill: number;
}

export interface TournamentStanding {
  entrantId: string;
  golferId: number | null;
  name: string;
  archetype: GolferArchetypeName;
  holesCompleted: number;
  score: number;
  scoreToPar: number;
  finished: boolean;
}

export interface TournamentEvent {
  id: string;
  name: string;
  tier: TournamentTier;
  scheduledWeek: number;
  scheduledDay: number;
  status: TournamentStatus;
  bookingCost: number;
  revenueAward: number;
  reputationAward: number;
  field: TournamentEntrant[];
  results?: TournamentStanding[];
  winnerName?: string;
}

export interface TournamentCalendar {
  version: 1;
  events: TournamentEvent[];
}

export interface LiveTournamentState {
  eventId: string;
  name: string;
  tier: TournamentTier;
  standings: TournamentStanding[];
}
