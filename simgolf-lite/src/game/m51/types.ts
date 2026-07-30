import type { Point } from "../models/types";

/**
 * M51 is deliberately a contract boundary, not a second route or commerce
 * implementation.  The existing live walk cache owns path data and the
 * existing concession/commitDay pipeline owns money.  This module owns the
 * identifiers and bounded records that later mobility work will exchange
 * with those authorities.
 */
export const M51_MOBILITY_VERSION = 3 as const;

/** Shared rental economics used by configuration, live service, and settlement. */
export const MOBILITY_BUSINESS = {
  maxPrice: 250,
  fleetUnitCost: { pushcart: 180, riding_cart: 6_500 },
  fleetSalvageRate: .45,
  perUseCost: { pushcart: 1.25, riding_cart: 8 },
  serviceMinutes: { pushcart: 1.5, riding_cart: 4 },
  capacityByTier: { 1: 8, 2: 18, 3: 36 },
  tierExpansionCost: { 1: 0, 2: 4_000, 3: 9_000 },
  wearPerUse: { pushcart: .0015, riding_cart: .004 },
  offPathWearPerTile: .00002,
  damagedReturnCondition: .7,
} as const;

export type MobilityMode = "walk" | "pushcart" | "riding_cart";
export type MobilitySelectionStatus = "predicted" | "confirmed" | "unavailable" | "cancelled";
export type MobilityAssignmentStatus = "reserved" | "active" | "released" | "cancelled";
export type MobilityTransactionStatus = "authorized" | "voided" | "settled";
export type MobilityEvidenceLabel = "predicted" | "observed" | "mixed";

/** A sellable offering. `walk` has no product or fleet requirement. */
export interface MobilityProduct {
  id: string;
  courseId: string;
  /** Stable Cart Rental building identity. Products travel with a course package. */
  buildingId: string;
  mode: Exclude<MobilityMode, "walk">;
  name: string;
  price: number;
  enabled: boolean;
}

/** An individually addressable asset. Aggregate stock is intentionally not a source of truth. */
export interface MobilityFleetUnit {
  id: string;
  courseId: string;
  buildingId: string;
  productId: string;
  mode: Exclude<MobilityMode, "walk">;
  seats: number;
  state: "available" | "in_use" | "maintenance" | "retired";
  /** Normalized physical condition. Older course packages migrate to 1. */
  condition: number;
  uses: number;
  wear: number;
}

/**
 * A group chooses exactly one mode. Individual rider/seat allocation belongs
 * to the assignment, not to a live golfer or a course layout.
 */
export interface MobilityGroupSelection {
  id: string;
  groupId: string;
  courseId: string;
  mode: MobilityMode;
  productId?: string;
  status: MobilitySelectionStatus;
  groupSize: number;
  perGolferFee: number;
  predictedWalkingMinutes: number;
  predictedTravelMinutes: number;
  reason: "preference" | "stockout_fallback" | "unaffordable_fallback" | "weather_fallback" | "policy_fallback" | "no_facility";
  seed: number;
  decisionOrder: number;
}

/**
 * Cache identity only.  `LiveState.walkCache` remains the sole owner of
 * route waypoints and cached path results; this contract must never persist
 * a route or introduce a parallel router.
 */
export interface MobilityRouteCacheIdentity {
  courseId: string;
  layoutId: string;
  mode: MobilityMode;
  from: Point;
  to: Point;
}

export interface MobilityAssignment {
  id: string;
  groupId: string;
  courseId: string;
  selectionId: string;
  mode: MobilityMode;
  buildingId?: string;
  productId?: string;
  fleetUnitIds: string[];
  riders: Array<{ golferId: number; fleetUnitId: string; seat: number }>;
  status: MobilityAssignmentStatus;
  routeCacheKey: string;
  serviceDelayMinutes: number;
  availableUnitsAtSelection: number;
  actualTravelMinutes: number;
  walkingFallbackMinutes: number;
  offPathTiles: number;
  returnedCondition?: number;
  seed: number;
  decisionOrder: number;
}

/** Authorization is live-day state; only settled transactions enter history. */
export interface MobilityTransaction {
  id: string;
  courseId: string;
  groupId: string;
  assignmentId?: string;
  productId?: string;
  buildingId?: string;
  golferId?: number;
  fleetUnitId?: string;
  mode: MobilityMode;
  amount: number;
  status: MobilityTransactionStatus;
  seed: number;
  decisionOrder: number;
  authorizedAtMinute: number;
  settledAtWeek?: number;
  settledAtDay?: number;
}

/** A forecast is useful to the chooser but is never presented as play evidence. */
export interface MobilityPredictedEvidence {
  source: "predicted";
  groupId: string;
  courseId: string;
  mode: MobilityMode;
  paceMinutes: number;
  cost: number;
  confidence: number;
  seed: number;
  decisionOrder: number;
}

/** Only completed/settled live facts may be retained in durable history. */
export interface MobilityObservedEvidence {
  source: "observed";
  id: string;
  courseId: string;
  groupId: string;
  mode: MobilityMode;
  completed: boolean;
  paceMinutes: number;
  cost: number;
  satisfaction: number;
  predictedWalkingMinutes?: number;
  actualTravelMinutes?: number;
  minutesSaved?: number;
  walkingFallbackMinutes?: number;
  offPathTiles?: number;
  seed: number;
  decisionOrder: number;
  settledAtWeek: number;
  settledAtDay: number;
}

export interface MobilityHistory {
  settledTransactions: MobilityTransaction[];
  observedEvidence: MobilityObservedEvidence[];
  dailyLedgers: MobilityDailyLedger[];
  weeklyReports: MobilityWeeklyReport[];
}

/**
 * Portable course-owned inventory. The Cart Rental building remains the
 * configuration authority; World never owns a second fleet or product list.
 */
export interface MobilityCartRentalConfiguration {
  buildingId: string;
  tier: 1 | 2 | 3;
  products: Record<Exclude<MobilityMode, "walk">, MobilityProduct>;
}

export interface M51CourseMobilityState {
  version: typeof M51_MOBILITY_VERSION;
  cartRentals: Record<string, MobilityCartRentalConfiguration>;
  fleet: Record<string, MobilityFleetUnit>;
  /** Bounded idempotence evidence for condition/use settlement. */
  settledAssignmentIds: string[];
}

/** Compact, bounded economic/pace evidence; it is not a second ledger. */
export interface MobilityCourseAggregate {
  courseId: string;
  walkingRounds: number;
  pushcartRounds: number;
  ridingCartRounds: number;
  observedRounds: number;
  observedPaceMinutes: number;
  settledRevenue: number;
  operatingCosts: number;
  stockouts: number;
  utilizedUnits: number;
  activeRentals: number;
  lastSettledWeek: number;
}

export interface MobilityProductSettlement {
  productId: string;
  courseId: string;
  buildingId: string;
  mode: Exclude<MobilityMode, "walk">;
  rentals: number;
  golfers: number;
  utilizedUnits: number;
  availableUnits: number;
  stockouts: number;
  returns: number;
  damagedReturns: number;
  grossRevenue: number;
  operatingCosts: number;
  netRevenue: number;
  wear: number;
  endingCondition: number;
}

export interface MobilityDailyLedger {
  id: string;
  week: number;
  dayIndex: number;
  products: MobilityProductSettlement[];
  grossRevenue: number;
  operatingCosts: number;
  netRevenue: number;
}

export interface MobilityWeeklyReport {
  id: string;
  week: number;
  days: number;
  products: MobilityProductSettlement[];
  grossRevenue: number;
  operatingCosts: number;
  netRevenue: number;
}

/** Persistable daily/weekly view of the same bounded aggregates. */
export interface M51MobilityAggregateSummary {
  version: 1;
  courses: Record<string, MobilityCourseAggregate>;
  products: MobilityProductSettlement[];
  grossRevenue: number;
  operatingCosts: number;
  netRevenue: number;
}

/** Durable M51 evidence and aggregates, owned by World. */
export interface M51MobilityState {
  version: typeof M51_MOBILITY_VERSION;
  history: MobilityHistory;
  aggregates: Record<string, MobilityCourseAggregate>;
}

/** Ephemeral live-day state, owned by LiveState and saved only in live snapshots. */
export interface M51LiveMobilityState {
  version: typeof M51_MOBILITY_VERSION;
  seed: number;
  nextDecisionOrder: number;
  selections: MobilityGroupSelection[];
  assignments: MobilityAssignment[];
  transactions: MobilityTransaction[];
  predictedEvidence: MobilityPredictedEvidence[];
  observedEvidence: MobilityObservedEvidence[];
  stockouts: Array<{
    id: string;
    courseId: string;
    groupId: string;
    buildingId: string;
    productId: string;
    mode: Exclude<MobilityMode, "walk">;
    requiredUnits: number;
    availableUnits: number;
    decisionOrder: number;
  }>;
}

export interface MobilitySettlementInput {
  dayIndex: number;
  week: number;
  live: M51LiveMobilityState;
}
