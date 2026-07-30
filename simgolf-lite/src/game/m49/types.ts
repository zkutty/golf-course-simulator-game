import type { GolferArchetypeName } from "../live/types";
import type { M48CohortId } from "../architecture/m48Types";

/**
 * M49 keeps the economic evidence contract separate from the presentation
 * layer.  A save can therefore retain what golfers actually experienced
 * without retaining an unbounded replay log.
 */
export const M49_ECONOMY_VERSION = 1 as const;
export const M49_MAX_COURSES = 36 as const;
export const M49_MAX_SEGMENT_ROUNDS = 500 as const;
export const M49_MAX_HOLE_EVIDENCE = 72 as const;

export const M49_SEGMENTS: readonly GolferArchetypeName[] = [
  "pro",
  "lowHandicap",
  "casual",
  "senior",
  "junior",
  "tourist",
] as const;

export interface M49HoleObservation {
  holeId: string;
  expectedScore: number;
  actualScore: number;
  satisfaction: number;
  outcome: "delighted" | "pleased" | "neutral" | "frustrated" | "unfair";
  causes: string[];
}

export interface M49ObservedRound {
  version: typeof M49_ECONOMY_VERSION;
  id: string;
  courseId: string;
  segment: GolferArchetypeName;
  tournamentId?: string;
  completed: boolean;
  holesPlayed: number;
  holesTotal: number;
  expectedScore: number;
  actualScore: number;
  satisfaction: number;
  condition: number;
  greenFee: number;
  strategicFit: number;
  valueReceived: number;
  willingnessToPay: number;
  priceElasticity: number;
  returnIntent: boolean;
  recommend: boolean;
  churnRisk: number;
  paceDelayMinutes: number;
  hospitalityDelayMinutes: number;
  /** Present only when this finished round had an authoritative M51 assignment. */
  mobility?: M49ObservedMobilityEvidence;
  holeEvidence: M49HoleObservation[];
  causes: string[];
}

/**
 * A compact M49 projection of a completed M51 assignment.  It deliberately
 * contains no route payload, fleet capacity, or forecast: those remain M51's
 * authority.  Old M49 saves omit this field rather than receiving invented
 * mobility history during migration.
 */
export interface M49ObservedMobilityEvidence {
  source: "observed";
  mode: "walk" | "pushcart" | "riding_cart";
  rentalProvided: boolean;
  walkingBurdenMinutes: number;
  actualTravelMinutes: number;
  paceMinutes: number;
  price: number;
  serviceDelayMinutes: number;
  walkingFallbackMinutes: number;
  stockoutFallback: boolean;
  restricted: boolean;
  tournamentPolicy: boolean;
  /** Segment-weighted value of what actually happened, normalized 0..1. */
  value: number;
}

export interface M49SegmentMobilityHistory {
  observedRounds: number;
  walkingRounds: number;
  pushcartRounds: number;
  ridingCartRounds: number;
  rentalRounds: number;
  stockoutFallbacks: number;
  restrictions: number;
  tournamentPolicyRounds: number;
  averageWalkingBurdenMinutes: number;
  averageActualTravelMinutes: number;
  averagePaceMinutes: number;
  averageValue: number;
  causes: Record<string, number>;
}

export interface M49SegmentHistory {
  observedRounds: number;
  completedRounds: number;
  evidenceWeight: number;
  averageValue: number;
  averageSatisfaction: number;
  returnRate: number;
  recommendationRate: number;
  churnRate: number;
  willingnessToPay: number;
  priceElasticity: number;
  lastObservedWeek: number;
  /** Undefined for M49 histories created before mobility evidence existed. */
  mobility?: M49SegmentMobilityHistory;
  holeEvidence: Record<string, {
    observations: number;
    averageSatisfaction: number;
    frustrationRate: number;
    causes: Record<string, number>;
  }>;
}

export interface M49CourseHistory {
  version: typeof M49_ECONOMY_VERSION;
  observedRounds: number;
  completedRounds: number;
  lastObservedWeek: number;
  segments: Partial<Record<GolferArchetypeName, M49SegmentHistory>>;
}

export interface M49EconomyState {
  version: typeof M49_ECONOMY_VERSION;
  courses: Record<string, M49CourseHistory>;
  marketingPromises?: M49MarketingPromise[];
}

export interface M49SegmentDemand {
  segment: GolferArchetypeName;
  strategicCohort: M48CohortId;
  share: number;
  bookingAppeal: number;
  willingnessToPay: number;
  priceElasticity: number;
  strategicFit: number;
  observedValue: number;
  confidence: number;
  returnRate: number;
  churnRate: number;
  evidenceRounds: number;
  evidenceLabel: "predicted" | "observed" | "mixed";
  mobility: {
    evidenceLabel: "predicted" | "observed" | "mixed";
    currentSupport: number;
    observedValue?: number;
    observedRounds: number;
    disappointmentRisk: number;
    causes: string[];
  };
  causes: string[];
}

export interface M49DemandPlan {
  version: typeof M49_ECONOMY_VERSION;
  courseId: string;
  totalIndex: number;
  broadAppeal: number;
  nicheIdentity: number;
  supportedSegments: GolferArchetypeName[];
  segments: Record<GolferArchetypeName, M49SegmentDemand>;
  evidenceRounds: number;
}

export interface M49MarketingPromise {
  id: string;
  courseId: string;
  segment: GolferArchetypeName;
  strength: string;
  reach: number;
  cost: number;
  credibility: number;
  disappointmentRisk: number;
  createdWeek: number;
  playedRounds: number;
  disappointedRounds: number;
}

export interface M49AmenitySupport {
  segment: GolferArchetypeName;
  score: number;
  supportedBy: string[];
  missing: string[];
  mobility?: {
    evidenceLabel: "predicted" | "observed" | "mixed";
    score: number;
    observedRounds: number;
    disappointmentRisk: number;
    supportedBy: string[];
    missing: string[];
  };
}

export interface M49StrategicIdentity {
  courseId: string;
  strategicScore: number;
  broadAppeal: number;
  nicheIdentity: number;
  supportedSegments: GolferArchetypeName[];
  strengths: string[];
  tags: string[];
  amenities: Record<GolferArchetypeName, M49AmenitySupport>;
  tournamentFieldFit: Record<"local" | "regional" | "championship", number>;
  mobility: {
    evidenceLabel: "predicted" | "observed" | "mixed";
    observedRounds: number;
    disappointmentRisk: number;
    tournamentPolicy: "walking_only";
    note: string;
  };
  charterFit: number;
}

export interface M49ExperienceCause {
  cause: string;
  observations: number;
  satisfactionDelta: number;
  revenueAtRisk: number;
}

export interface M49CourseReport {
  courseId: string;
  courseName: string;
  generatedAtWeek: number;
  demand: M49DemandPlan;
  observedRounds: number;
  completedRounds: number;
  topCauses: M49ExperienceCause[];
  condition: M49ConditionReport;
  alerts: M49ReportAlert[];
  reconciliation: {
    ledgerBalanced: boolean;
    observedEvidenceRounds: number;
    authoritativeCondition: number;
  };
  headline: string;
  warnings: string[];
}

export interface M49ConditionReport {
  overall: number;
  maintenanceBudget: number;
  requiredMaintenance: number;
  shortfall: number;
  projectedRecovery: number;
  wearPressure: number;
  hotSpots: Array<{
    zoneId: string;
    terrain: string;
    tiles: number;
    burden: number;
    action: string;
  }>;
}

export interface M49ReportAlert {
  id: string;
  severity: "info" | "warning" | "urgent";
  title: string;
  detail: string;
  action: string;
}
