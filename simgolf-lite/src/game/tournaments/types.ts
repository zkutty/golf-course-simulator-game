import type { GolferArchetypeName } from "../live/types";
import type { PinRotation, TeeSet } from "../models/types";

export type TournamentTier = "local" | "regional" | "championship";
export type TournamentStatus = "scheduled" | "completed" | "cancelled";

export type TournamentRequirementId =
  | "reputation" | "deposit" | "date" | "calendar" | "holes"
  | "rotations" | "route" | "rating" | "slope";

export interface TournamentRequirement {
  id: TournamentRequirementId;
  label: string;
  passed: boolean;
  current: string;
  required: string;
  guidance: string;
}

export interface TournamentQualificationSnapshot {
  eligible: boolean;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  rating: number;
  slope: number;
  effectiveYardage: number;
  completeRotations: PinRotation[];
  requirements: TournamentRequirement[];
  blockingReasons: string[];
}

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
  courseId?: string;
  courseName?: string;
  holeIds?: string[];
  scheduledWeek: number;
  scheduledDay: number;
  status: TournamentStatus;
  bookingCost: number;
  revenueAward: number;
  reputationAward: number;
  field: TournamentEntrant[];
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
  qualificationSnapshot?: TournamentQualificationSnapshot;
  currentQualification?: TournamentQualificationSnapshot;
  warning?: string;
  cancelledWeek?: number;
  cancelledDay?: number;
  cancellationReason?: string;
  depositForfeited?: boolean;
  results?: TournamentStanding[];
  winnerName?: string;
}

export interface TournamentCalendar {
  version: 2;
  events: TournamentEvent[];
}

export interface LiveTournamentState {
  eventId: string;
  name: string;
  tier: TournamentTier;
  courseId?: string;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  ordinaryPinRotation: PinRotation;
  qualificationSnapshot: TournamentQualificationSnapshot;
  standings: TournamentStanding[];
}
