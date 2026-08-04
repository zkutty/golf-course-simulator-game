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
