import type { GolferArchetypeName } from "../live/types";
import type { PinRotation, Point, TeeSet } from "../models/types";
import type { M49StrategicIdentity } from "../m49/types";

export type TournamentTier = "local" | "regional" | "championship";
export type TournamentStatus = "scheduled" | "active" | "completed" | "cancelled";
export type TournamentScoringMode = "stableford" | "net-stroke" | "gross-stroke";
export type TournamentTeamFormat = "individual" | "four-ball" | "alternate-shot" | "scramble" | "pro-am";

export type TournamentRequirementId =
  | "reputation" | "deposit" | "date" | "calendar" | "holes"
  | "rotations" | "route" | "rating" | "slope" | "surface-care" | "pin-fairness";

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
  strategicIdentity?: Pick<M49StrategicIdentity, "strategicScore" | "broadAppeal" | "nicheIdentity" | "supportedSegments" | "tournamentFieldFit">;
}

export interface TournamentEntrant {
  id: string;
  name: string;
  archetype: GolferArchetypeName;
  skill: number;
  /** Optional authored index. Activation freezes the current value, never a later edit. */
  handicapIndex?: number;
  teamId?: string;
}

export interface TournamentActivationHoleSnapshot {
  id: string;
  par: number;
  strokeIndex: number;
  tee: Point;
  pin: Point;
}

export interface TournamentActivationEntrantSnapshot {
  entrantId: string;
  name: string;
  archetype: GolferArchetypeName;
  skill: number;
  teamId: string;
  handicapIndex: number;
  allowance: number;
  courseHandicapUnrounded: number;
  playingHandicap: number;
  strokesByHole: readonly number[];
}

/**
 * Team membership is lifecycle authority only. ZK-735 owns format-specific
 * team handicap and score-selection formulas, so no aggregate is calculated
 * here.
 */
export interface TournamentActivationTeamSnapshot {
  id: string;
  entrantIds: readonly string[];
}

export interface TournamentActivationSnapshot {
  version: 1;
  activationId: string;
  activatedWeek: number;
  activatedDay: number;
  scoringMode: TournamentScoringMode;
  teamFormat: TournamentTeamFormat;
  courseId: string;
  courseName: string;
  rating: number;
  slope: number;
  par: number;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  holes: readonly TournamentActivationHoleSnapshot[];
  entrants: readonly TournamentActivationEntrantSnapshot[];
  teams: readonly TournamentActivationTeamSnapshot[];
}

export interface TournamentRoundScorecard {
  entrantId: string;
  status: "completed" | "withdrawn";
  /** Auditable individual gross evidence in frozen routing order. */
  grossByHole: readonly number[];
  penalties: number;
  grossTotal: number;
  netTotal?: number;
  stablefordPoints?: number;
}

export interface TournamentRoundState {
  roundNumber: number;
  scheduledWeek: number;
  scheduledDay: number;
  status: "scheduled" | "active" | "interrupted" | "completed";
  scorecards: readonly TournamentRoundScorecard[];
  completionId?: string;
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
  scoringMode?: TournamentScoringMode;
  teamFormat?: TournamentTeamFormat;
  roundCount?: number;
  currentRound?: number;
  rounds?: readonly TournamentRoundState[];
  activationSnapshot?: TournamentActivationSnapshot;
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
  /** Observed event quality, retained separately from the contracted award. */
  observedQuality?: number;
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
  currentRound?: number;
  standings: TournamentStanding[];
}
