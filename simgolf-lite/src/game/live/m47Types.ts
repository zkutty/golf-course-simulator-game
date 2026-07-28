import type { Point } from "../models/types";

export const M47_CAPABILITY_VERSION = 1 as const;

export type RiskStyle = "aggressive" | "conservative" | "balanced";
export type StrategicIntentKind = "safe" | "hero" | "positional" | "recovery" | "approach";

export interface GolferCapabilities {
  version: typeof M47_CAPABILITY_VERSION;
  seed: number;
  power: number;
  accuracy: number;
  irons: number;
  shortGame: number;
  recovery: number;
  consistency: number;
  riskTolerance: number;
  challengeSeeking: number;
  sceneryAffinity: number;
  valueSensitivity: number;
  riskStyle: RiskStyle;
  strengths: string[];
  weaknesses: string[];
}

export interface StrategyFact {
  code: "capability-fit" | "risk" | "terrain" | "next-shot" | "context" | "outcome";
  detail: string;
}

export interface ShotIntent {
  id: string;
  kind: StrategicIntentKind;
  from: Point;
  target: Point;
  club: string;
  power: number;
  technique: "normal" | "draw" | "fade" | "punch" | "flop" | "backspin";
  expectedStrokes: number;
  variance: number;
  hazardRisk: number;
  nextShotQuality: number;
  facts: StrategyFact[];
}

export interface RejectedAlternative {
  kind: StrategicIntentKind;
  expectedStrokes: number;
  reason: string;
  facts: StrategyFact[];
}

export interface StrategicHolePlan {
  version: typeof M47_CAPABILITY_VERSION;
  holeId: string;
  par: number;
  expectedScore: number;
  chosen: ShotIntent;
  rejected: RejectedAlternative[];
}

export interface LiveShotOutcome {
  version: typeof M47_CAPABILITY_VERSION;
  id: string;
  holeId: string;
  shotNumber: number;
  intentId: string;
  intent: StrategicIntentKind;
  club: string;
  technique: ShotIntent["technique"];
  from: Point;
  aim: Point;
  landing: Point;
  rest: Point;
  lieBefore: string;
  lieAfter: string;
  carryYards: number;
  rollYards: number;
  penaltyStrokes: number;
  holed: boolean;
  seed: number;
  facts: StrategyFact[];
}

export interface HoleReaction {
  version: typeof M47_CAPABILITY_VERSION;
  holeId: string;
  expectedScore: number;
  actualScore: number;
  satisfaction: number;
  outcome: "delighted" | "pleased" | "neutral" | "frustrated" | "unfair";
  facts: StrategyFact[];
  thought: string;
  memory?: string;
}
