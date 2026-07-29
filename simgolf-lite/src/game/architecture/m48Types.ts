import type { PinRotation, Point, TeeSet } from "../models/types";
import type { GolferCapabilities } from "../live/m47Types";

export const M48_STRATEGY_VERSION = 1 as const;
export const M48_DEFAULT_SAMPLES = 8 as const;
export const M48_MAX_HOLES = 36 as const;
export const M48_MAX_OPTIONS = 6 as const;

export type M48CohortId = "power" | "accuracy" | "shortGame" | "recovery" | "casual";
export type M48OptionKind = "safe" | "hero" | "positional" | "runup" | "recovery";
export type M48EvaluationStatus = "complete" | "incomplete";

export interface M48CohortDefinition {
  id: M48CohortId;
  label: string;
  explanation: string;
  capabilities: GolferCapabilities;
}

export interface M48OptionEvidence {
  id: string;
  kind: M48OptionKind;
  label: string;
  geometry: Point[];
  location: Point;
  viable: boolean;
  safeSurface: number;
  hazardRisk: number;
  forcedCarryBurden: number;
  bailoutQuality: number;
  heroLineReward: number;
  expectedStrokes: number;
  variance: number;
  recoveryBurden: number;
  sampleCount: number;
  sampleStatus: "simulated" | "insufficient";
  facts: string[];
}

export interface M48CohortEvidence {
  cohortId: M48CohortId;
  viability: number;
  preferredOption: M48OptionKind | null;
  expectedStrokes: number;
  variance: number;
  recoveryBurden: number;
  skillAdvantageDelta: number;
  options: Array<{
    optionId: string;
    viable: boolean;
    expectedStrokes: number;
    variance: number;
    advantageDelta: number;
  }>;
  facts: string[];
}

export interface M48SetupKey {
  teeSet: TeeSet;
  pinRotation: PinRotation;
  usedTeeFallback: boolean;
  usedPinFallback: boolean;
}

export interface M48StrategicHoleEvaluation {
  version: typeof M48_STRATEGY_VERSION;
  id: string;
  holeId: string;
  holeIndex: number;
  setup: M48SetupKey;
  geometryVersion: string;
  status: M48EvaluationStatus;
  sampleCount: number;
  safeRouteViability: number;
  optionCount: number;
  forcedCarryBurden: number;
  bailoutQuality: number;
  heroLineReward: number;
  expectedStrokes: number;
  variance: number;
  recoveryBurden: number;
  visualChallenge: number;
  fairnessFloor: number;
  strategicSeparation: number;
  unavoidablePunishment: number;
  cohorts: M48CohortEvidence[];
  options: M48OptionEvidence[];
  warnings: string[];
}

export interface M48StrategicEvaluation {
  version: typeof M48_STRATEGY_VERSION;
  geometryVersion: string;
  courseId: string;
  conditionKey: number;
  samplesPerOption: number;
  holes: M48StrategicHoleEvaluation[];
  cohorts: M48CohortDefinition[];
}

export interface M48PortfolioHole {
  holeId: string;
  setup: M48SetupKey;
  strategicScore: number;
  fairnessFloor: number;
  genuineChoice: number;
  spectacleWithMercy: number;
  strategyWarnings: string[];
  favoredCohorts: M48CohortId[];
  opportunityCount: number;
}

export interface M48PortfolioSummary {
  total: number;
  fairnessFloor: number;
  strategicSeparation: number;
  genuineChoice: number;
  spectacleWithMercy: number;
  opportunityRotation: number;
  penalties: {
    funnelGreens: number;
    fakeChoices: number;
    mandatoryCarries: number;
    hazardSpam: number;
    repetitiveStrategy: number;
    oneCohortDominance: number;
  };
  favoredCohorts: Record<M48CohortId, number>;
  holeCount: number;
}

export interface M48StrategicPortfolio {
  evaluation: M48StrategicEvaluation;
  holes: M48PortfolioHole[];
  summary: M48PortfolioSummary;
}

export interface M48Recommendation {
  id: string;
  kind: "widen-bailout" | "open-runup" | "shift-carry" | "protect-hero-line" | "create-angle" | "rotate-opportunity" | "remove-fake-choice";
  holeId: string;
  titleKey: string;
  detailKey: string;
  location: Point;
  affectedCohorts: M48CohortId[];
  failingMetric: keyof Pick<M48StrategicHoleEvaluation, "safeRouteViability" | "optionCount" | "forcedCarryBurden" | "bailoutQuality" | "heroLineReward" | "strategicSeparation" | "fairnessFloor">;
  currentValue: number;
  expectedDirection: "up" | "down" | "more-even";
  constructionCost: number;
  upkeepDelta: number;
  confidence: number;
  sampleStatus: "simulated" | "insufficient";
}

export interface M48DesignTestSession {
  version: typeof M48_STRATEGY_VERSION;
  id: string;
  courseId: string;
  holeId: string;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  geometryVersion: string;
  conditionKey: number;
  startedWeek: number;
  seed: number;
  noEconomy: true;
  stage: "designed" | "watched" | "played" | "returned" | "compared";
  selectedCohortId: M48CohortId | null;
  selectedShotId: string | null;
  before?: M48StrategicHoleEvaluation;
  after?: M48StrategicHoleEvaluation;
}

export interface M48DesignComparison {
  beforeGeometryVersion: string;
  afterGeometryVersion: string;
  changed: boolean;
  targetCohort: M48CohortId | null;
  targetExpectedStrokesDelta: number | null;
  fairnessFloorDelta: number;
  optionCountDelta: number;
  safeRouteViabilityDelta: number;
  strategicSeparationDelta: number;
  excludedCohorts: M48CohortId[];
  evidenceLabel: "current" | "historical" | "provisional";
  explanation: string;
}
