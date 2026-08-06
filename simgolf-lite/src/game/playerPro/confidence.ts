import type { PlayerProCareer, PlayerPlayableRound } from "../models/playerProTypes";

export const CONFIDENCE_NEUTRAL = 50;

export type PlayerConfidenceReason = "neutral" | "daily_decay" | "practice" | "round_feedback" | "concession" | "invitation";
export type PlayerConfidenceTrend = "rising" | "falling" | "steady";

/** Persisted, deterministic Player Pro confidence. It never changes random seeds or carry. */
export interface PlayerConfidenceState {
  version: 1;
  current: number;
  reason: PlayerConfidenceReason;
  trend: PlayerConfidenceTrend;
  lastUpdatedAbsoluteDay: number;
}

declare module "../models/playerProTypes" {
  interface PlayerProCareer {
    confidence: PlayerConfidenceState;
  }
  interface PlayerPlayableRound {
    /** Frozen at round start so reloads cannot alter shot dispersion. */
    confidenceSnapshot?: PlayerConfidenceState;
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round2 = (value: number) => Math.round(value * 100) / 100;

function trend(before: number, after: number): PlayerConfidenceTrend {
  return after > before ? "rising" : after < before ? "falling" : "steady";
}

export function createPlayerConfidence(absoluteDay = 0): PlayerConfidenceState {
  return { version: 1, current: CONFIDENCE_NEUTRAL, reason: "neutral", trend: "steady", lastUpdatedAbsoluteDay: Math.max(0, Math.floor(absoluteDay)) };
}

export function normalizePlayerConfidence(raw: unknown): PlayerConfidenceState {
  if (!raw || typeof raw !== "object") return createPlayerConfidence();
  const value = raw as Partial<PlayerConfidenceState>;
  const reason: PlayerConfidenceReason = ["neutral", "daily_decay", "practice", "round_feedback", "concession"].includes(value.reason as string)
    ? value.reason as PlayerConfidenceReason : "neutral";
  const current = finite(value.current) ? clamp(round2(value.current), 0, 100) : CONFIDENCE_NEUTRAL;
  return {
    version: 1,
    current,
    reason,
    trend: value.trend === "rising" || value.trend === "falling" ? value.trend : "steady",
    lastUpdatedAbsoluteDay: finite(value.lastUpdatedAbsoluteDay) ? Math.max(0, Math.floor(value.lastUpdatedAbsoluteDay)) : 0,
  };
}

/** Applies 20% daily regression toward 50 in one deterministic calculation. */
export function confidenceAtDay(state: PlayerConfidenceState, absoluteDay: number): PlayerConfidenceState {
  const normalized = normalizePlayerConfidence(state);
  const targetDay = Math.max(0, Math.floor(absoluteDay));
  const days = targetDay - normalized.lastUpdatedAbsoluteDay;
  if (days <= 0) return normalized;
  const current = clamp(round2(CONFIDENCE_NEUTRAL + (normalized.current - CONFIDENCE_NEUTRAL) * Math.pow(.8, days)), 0, 100);
  return { ...normalized, current, reason: "daily_decay", trend: trend(normalized.current, current), lastUpdatedAbsoluteDay: targetDay };
}

function withDelta(state: PlayerConfidenceState, delta: number, reason: PlayerConfidenceReason): PlayerConfidenceState {
  const current = clamp(round2(state.current + delta), 0, 100);
  return { ...state, current, reason, trend: trend(state.current, current) };
}

export function confidencePracticeGain(facilityTier: number): number {
  const tier = clamp(Math.floor(facilityTier), 1, 3);
  return tier === 1 ? 6 : tier === 2 ? 8 : 10;
}

export function applyPracticeConfidence(state: PlayerConfidenceState, facilityTier: number): PlayerConfidenceState {
  return withDelta(state, confidencePracticeGain(facilityTier), "practice");
}

export function completedRoundConfidenceDelta(indexBefore: number, differential: number): number {
  return clamp(Math.round((indexBefore - differential) / 2), -6, 6);
}

export function applyRoundConfidence(state: PlayerConfidenceState, args: { indexBefore: number; differential: number | null; conceded: boolean }): PlayerConfidenceState {
  if (args.conceded) return withDelta(state, -4, "concession");
  if (args.differential == null || !finite(args.indexBefore)) return state;
  return withDelta(state, completedRoundConfidenceDelta(args.indexBefore, args.differential), "round_feedback");
}

/** Evidence-backed social/mentor outcomes can affect confidence, never shot seeds or carry. */
export function applyInvitationConfidence(state: PlayerConfidenceState, delta: number): PlayerConfidenceState {
  return withDelta(state, clamp(Math.round(delta), -8, 8), "invitation");
}

/** Confidence affects dispersion only: 0 -> 1.04, 50 -> 1.00, 100 -> .96. */
export function confidenceDispersionMultiplier(state: PlayerConfidenceState | undefined): number {
  return round2(1.04 - clamp(state?.current ?? CONFIDENCE_NEUTRAL, 0, 100) * .0008);
}

export function confidenceForRound(round: PlayerPlayableRound): PlayerConfidenceState {
  return normalizePlayerConfidence(round.confidenceSnapshot);
}

export function advancePlayerProConfidence(career: PlayerProCareer, absoluteDay: number): PlayerProCareer {
  const confidence = confidenceAtDay(career.confidence, absoluteDay);
  return confidence.current === career.confidence.current && confidence.lastUpdatedAbsoluteDay === career.confidence.lastUpdatedAbsoluteDay
    ? career : { ...career, confidence };
}
