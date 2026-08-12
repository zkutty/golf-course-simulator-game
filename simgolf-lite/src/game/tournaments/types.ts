import type { GolferArchetypeName } from "../live/types";
import type { PinRotation, Point, TeeSet } from "../models/types";
import type { M49StrategicIdentity } from "../m49/types";
import type { TeamHandicapSnapshot } from "../competition/teamAuthority";

export type TournamentTier = "local" | "regional" | "championship";
export type TournamentStatus = "scheduled" | "active" | "completed" | "cancelled";
export type TournamentScoringMode = "stableford" | "net-stroke" | "gross-stroke";
export type TournamentTeamFormat = "individual" | "four-ball" | "alternate-shot" | "scramble" | "pro-am";
export type TournamentTemplateId = "individual" | "two-v-two-four-ball" | "two-v-two-alternate-shot" | "two-person-scramble" | "four-person-pro-am";
export type TournamentTeamRole = "individual" | "partner" | "pro" | "amateur";
export type TournamentTemplateOverride = "scoringMode" | "roundCount" | "teeSet" | "pinRotation";

export interface TournamentFormatRules {
  version: 1;
  teamSize: number;
  teamCount: number | "field";
  roles: readonly TournamentTeamRole[];
  handicapFormula: "100%-individual" | "85%-per-player" | "50%-combined" | "35%-low+15%-high" | "85%-per-player-pro-am";
  orderRule: "independent" | "roster-order" | "strict-alternation" | "parallel-then-select";
  ballSelectionRule: "own-ball" | "best-net-member" | "shared-ball" | "deterministic-best-candidate" | "deferred-pro-am";
  teamHoleRule: "individual" | "lowest-net-ball" | "single-shared-ball" | "selected-team-ball" | "deferred-best-two-net";
  teamHoleScoringSupported: boolean;
  captainRule: "first-in-roster";
}

export interface TournamentTemplate {
  id: TournamentTemplateId;
  label: string;
  teamFormat: TournamentTeamFormat;
  scoringModes: readonly TournamentScoringMode[];
  supportedOverrides: readonly TournamentTemplateOverride[];
  rules: TournamentFormatRules;
}

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
  teamRole?: TournamentTeamRole;
  teamCaptain?: boolean;
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
  teamRole?: TournamentTeamRole;
  teamOrder?: number;
  teamCaptain?: boolean;
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
  roles?: readonly TournamentTeamRole[];
  captainId?: string;
}

export interface TournamentActivationSnapshot {
  version: 1 | 2;
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
  /** Present for reusable ZK-735 contracts; absent from byte-compatible legacy individual snapshots. */
  templateId?: TournamentTemplateId;
  roundCount?: number;
  supportedOverrides?: readonly TournamentTemplateOverride[];
  appliedOverrides?: Readonly<Partial<Record<TournamentTemplateOverride, string | number>>>;
  formatRules?: TournamentFormatRules;
  /** Exact M66 snapshots for the three released two-versus-two formats. */
  teamHandicaps?: readonly TeamHandicapSnapshot[];
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

/** Recomputable team projection derived only from frozen participant gross cards. */
export interface TournamentTeamStanding {
  teamId: string;
  status: "active" | "completed" | "dnf";
  completedRounds: number;
  dnfRounds: number;
  netTotal: number;
  place: number | null;
  tied: boolean;
  occupiedPlaces: readonly number[];
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
  templateId?: TournamentTemplateId;
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
  /** Current cumulative team projection; never accepted as scoring authority. */
  teamStandings?: TournamentTeamStanding[];
  /** All first-place team identities after final-round evidence is complete. */
  winnerTeamIds?: string[];
  /** All first-place names in deterministic display order; absent on legacy saves. */
  winnerNames?: string[];
  /** Legacy single-winner projection retained for existing UI/save consumers. */
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
