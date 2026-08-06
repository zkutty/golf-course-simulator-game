import type { HoleIndexSource } from "../models/types";

/** A minimal, immutable scorecard contract shared by every competition mode. */
export interface CompetitionHole {
  id: string;
  par: number;
  strokeIndex: number;
  /** Preserves the authoritative course-index provenance in round snapshots. */
  strokeIndexSource?: HoleIndexSource;
}

export interface HandicapCourse {
  courseRating: number;
  slopeRating: number;
  par: number;
}

export interface HandicapResult {
  /** Never round this value before applying an allowance. */
  unrounded: number;
  rounded: number;
}

export interface CompetitionPlayer {
  id: string;
  playingHandicap: number;
}

export type TeamFormat = "four-ball" | "alternate-shot" | "scramble" | "pro-am";
export interface CompetitionTeam {
  id: string;
  playerIds: readonly string[];
}

export type HoleStatus = "played" | "conceded" | "withdrawn";
export interface HoleScore {
  playerId: string;
  /** Required for a played hole; a concession is scored at this value. */
  gross?: number;
  status?: HoleStatus;
}

export interface ScorecardPlayer {
  id: string;
  playingHandicap: number;
  holeScores: readonly HoleScore[];
}

/** Net evidence already calculated from an individual or selected team ball. */
export interface TeamHoleMemberScore {
  playerId: string;
  gross: number;
  net: number;
  role?: "pro" | "amateur";
}

export type SettlementStatus = "settled" | "tie" | "carried" | "refunded" | "withdrawn";
export interface Settlement {
  status: SettlementStatus;
  winnerId?: string;
  amount: number;
  carry: number;
  reason?: string;
}

/** Raw, auditable contest evidence; UI and persistence own where it came from. */
export interface MeasurementEvidence {
  playerId: string;
  measurement: number;
  eligible: boolean;
  withdrawn?: boolean;
}

export type CompetitionScoringMode = "gross-stroke" | "net-stroke" | "gross-match" | "net-match" | "stableford";
export type CompetitionTeamFormat = "individual" | TeamFormat;
export type SideBetKind = "skins" | "nassau" | "closest-to-pin" | "longest-drive";

export type InventoryCategory = "club" | "bag" | "outfit" | "watch" | "vehicle" | "trophy" | "keepsake" | "plant-stock" | "service-credit";
export type NonTransferableRewardKind = "species-knowledge" | "learned-technique" | "relationship" | "memory" | "profile-unlock";

export type EquipmentPerformanceChannel = "carry" | "dispersion" | "recovery" | "putting" | "spin";

export interface EquipmentModifier {
  channel: EquipmentPerformanceChannel;
  multiplier: number;
  context?: string;
}

export interface InventoryTransfer {
  id: string;
  week: number;
  day: number;
  fromOwnerId: string;
  toOwnerId: string;
  custodianId: string;
  reason: "reward" | "stake" | "recovery" | "import";
}

export interface InventoryItem {
  id: string;
  definitionId: string;
  name: string;
  category: InventoryCategory;
  ownerId: string;
  custodianId: string;
  authoredValue: number;
  remainingValue: number;
  prestige: number;
  unique: boolean;
  confirmationRequired: boolean;
  transferable: true;
  transferHistory: readonly InventoryTransfer[];
  modifiers?: readonly EquipmentModifier[];
  remainingPlacements?: number;
  frozenInstallValueEach?: number;
  speciesId?: string;
  description?: string;
}

export interface PlayerInventory {
  version: 1;
  ownerId: string;
  items: readonly InventoryItem[];
  escrowItemIds: readonly string[];
  selectedVehicleId?: string;
  displayItemIds: readonly string[];
}

export interface EquipmentLoadout {
  clubItemIds: readonly string[];
  bagItemId?: string;
  outfitItemId?: string;
  watchItemId?: string;
  /** A learned, non-transferable technique selected between rounds. */
  techniqueId?: LearnedTechnique;
}

export interface RewardDefinition {
  id: string;
  name: string;
  itemDefinitionId?: string;
  nonTransferableKind?: NonTransferableRewardKind;
  profileStyleId?: string;
  techniqueId?: LearnedTechnique;
  speciesId?: string;
}

export interface AppraisalBasis {
  authoredValue: number;
  remainingValue: number;
  remainingPlacements?: number;
  frozenInstallValueEach?: number;
}

export interface AppraisedValue {
  itemId?: string;
  cash?: number;
  value: number;
  frozenWeek: number;
  frozenDay: number;
  basis: AppraisalBasis | { cashFaceValue: number };
}

export interface StakeBundle {
  cash: number;
  itemIds: readonly string[];
  appraisal: readonly AppraisedValue[];
  totalValue: number;
  confirmationItemIds: readonly string[];
  acceptedAt?: { week: number; day: number };
}

export interface RivalHolding {
  rivalId: string;
  item: InventoryItem;
  visible: boolean;
}

export interface RivalCustodyRecord {
  id: string;
  rivalId: string;
  rivalName: string;
  challengeId: string;
  itemId: string;
  itemSnapshot: InventoryItem;
  acquiredWeek: number;
  acquiredDay: number;
  recoveredWeek?: number;
  recoveredDay?: number;
  status: "held" | "recovered";
}

export type LearnedTechnique = "fairway-finder" | "knockdown-approach" | "soft-hands" | "splash-specialist" | "lag-putt";

export interface FrozenPerformanceModifier extends EquipmentModifier {
  sourceKind: "equipment" | "technique";
  sourceId: string;
}

/** Immutable round-start authority; it is intentionally independent of later custody changes. */
export interface FrozenPerformanceLoadout {
  version: 1;
  frozenWeek: number;
  frozenDay: number;
  itemIds: readonly string[];
  techniqueId?: LearnedTechnique;
  modifiers: readonly FrozenPerformanceModifier[];
}

export interface MentorTechniqueChallenge {
  version: 1;
  id: string;
  mentorId: string;
  mentorName: string;
  techniqueId: LearnedTechnique;
  objectiveId: string;
  objective: string;
  status: "active" | "complete";
  startedWeek: number;
  startedDay: number;
  attemptRoundIds: readonly string[];
  completedRoundId?: string;
}

export interface ChallengeRivalProfile {
  version: 1;
  riskTolerance: number;
  preferredFormats: readonly (CompetitionScoringMode | CompetitionTeamFormat | SideBetKind)[];
  preferredTees: readonly ("forward" | "member" | "championship")[];
  preferredStakeCategories: readonly InventoryCategory[];
  preferredPartnerIds: readonly string[];
  signatureTechnique?: LearnedTechnique;
  knownHoldingIds: readonly string[];
  mentorMatchesRequired: number;
}
