import type { BiomeOperatingCostBreakdown, ConcessionTransaction, ConcessionType, CourseOperations, Difficulty, PaceCohort, PinRotation, Point, TeeSet } from "../models/types";
import type { Personality } from "./personality";
import type { LiveTournamentState } from "../tournaments/types";
import type { DailyWeather, WeatherKind, WeatherModifiers } from "../seasons/types";
import type { GolferCapabilities, HoleReaction, LiveShotOutcome, ShotIntent, StrategicHolePlan } from "./m47Types";
import type { M49ObservedRound } from "../m49/types";
import type { M51LiveMobilityState, M51MobilityAggregateSummary } from "../m51/types";
import type { SurfaceCareDayReport } from "../conditions/surfaceCare";
import type { GreenKeepingReport } from "../greens/greenMaintenance";

export type SegmentKind = "walk" | "flight" | "pause";

// A single timed leg of a golfer's itinerary. During a "walk" the golfer moves
// from -> to; during a "flight" the ball moves from -> to while the golfer waits
// at `from`; a "pause" holds the golfer at `from` (addressing/putting).
export interface Segment {
  kind: SegmentKind;
  from: Point;
  to: Point;
  dur: number; // game-minutes
  holeIndex: number; // hole this segment belongs to (-1 for arrival/exit)
  holeId?: string;
  // Render-facing only (ZKU-153): which stroke a "flight" represents, so the
  // renderer can pick the swing vs putt animation. Never read by sim logic.
  shot?: "swing" | "putt";
  concession?: {
    buildingType: ConcessionType;
    buildingX: number;
    buildingY: number;
    item: string;
    amount: number;
  };
  /** M51 travel evidence attached to the same itinerary segment authority. */
  mobility?: {
    requestedMode: "walk" | "pushcart" | "riding_cart";
    resolvedMode: "walk" | "pushcart" | "riding_cart";
    minutesSaved: number;
    offPathTiles: number;
  };
}

export type GolferArchetypeName =
  | "casual"
  | "lowHandicap"
  | "senior"
  | "junior"
  | "tourist"
  | "pro";

export interface Golfer {
  id: number;
  name: string;
  personId?: string;
  archetype: GolferArchetypeName;
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
  courseId?: string;
  courseName?: string;
  /** Immutable published routing booked at arrival. */
  holeIds?: string[];
  personality: Personality;
  color: string;
  // Itinerary
  segments: Segment[];
  segIndex: number;
  segElapsed: number; // game-minutes elapsed within current segment
  // Live position (tile space, float)
  pos: Point;
  ball: Point | null; // non-null only while a shot is in flight
  // Per-hole outcome, precomputed at spawn and revealed as the golfer plays.
  holePar: number[];
  holeStrokes: number[];
  scoredHoles: number; // how many holes have been folded into scoreToPar
  // Progress / outcome
  currentHole: number; // -1 before first hole / after finishing
  currentHoleId?: string;
  strokes: number; // total strokes so far this round
  scoreToPar: number;
  mood: number; // 0..1
  thought: string | null;
  thoughtUntil: number; // dayMinute when the thought expires
  finished: boolean;
  spent: number; // money spent (green fee + concessions later)
  wallet: number; // remaining discretionary concession budget
  purchasedSegmentIndexes: number[];
  tournamentId?: string;
  tournamentEntrantId?: string;
  groupId?: string;
  groupStartedAt?: number;
  waitMinutes?: number;
  pacePreference?: number;
  paceIdentityAtVisit?: number;
  marshalInterventions?: number;
  forcedPickups?: number;
  drinksServed?: number;
  alcoholUnits?: number;
  hospitalityDelay?: number;
  disorderIncidents?: number;
  completionStatus?: "completed" | "daylight" | "congestion_abandonment";
  mobilityMode?: "walk" | "pushcart" | "riding_cart";
  mobilityAssignmentId?: string;
  mobilityPredictedWalkingMinutes?: number;
  mobilityActualTravelMinutes?: number;
  mobilityWalkingFallbackMinutes?: number;
  mobilityOffPathTiles?: number;
  mobilityReactionApplied?: boolean;
  /** M47 identity contract; legacy saves omit this and are migrated on load. */
  capabilities?: GolferCapabilities;
  /** Bounded strategic decisions and physical evidence for this round. */
  holePlans?: StrategicHolePlan[];
  shotOutcomes?: LiveShotOutcome[];
  holeReactions?: HoleReaction[];
  currentIntent?: ShotIntent;
}

export interface Arrival {
  atMinute: number;
  archetype: GolferArchetypeName;
  courseId?: string;
  tournament?: { eventId: string; entrantId: string; name: string; skill: number; teeSet?: TeeSet; pinRotation?: PinRotation };
  groupId?: string;
  paceIdentityAtVisit?: number;
  personId?: string;
  name?: string;
}

export interface TeeGroupState {
  id: string;
  courseId: string;
  bookedAt: number;
  startedAt: number | null;
  golferIds: number[];
  waitMinutes: number;
  blocked: boolean;
  interventions: number;
  pickups: number;
  finishedAt: number | null;
  lastMarshalMinute?: number;
  lastPickupHole?: number;
  lastRecordedHoleId?: string;
}

export interface PaceDayMetrics {
  groupsStarted: number;
  groupsFinished: number;
  totalWaitMinutes: number;
  marshalInterventions: number;
  forcedPickups: number;
  beverageRevenue: number;
  alcoholicDrinks: number;
  serviceRefusals: number;
  disorderIncidents: number;
  perCourse: Record<string, CoursePaceDayMetrics>;
}

export interface PaceCohortDayMetrics {
  samples: number;
  durationMinutes: number;
  timeParVarianceMinutes: number;
  waitMinutes: number;
  pickups: number;
  abandonments: number;
  satisfaction: number;
}

export interface PaceHoleDayMetrics {
  holeId: string;
  queueMinutes: number;
  occupancyMinutes: number;
  recoveryDelayMinutes: number;
  visits: number;
}

export interface CoursePaceDayMetrics {
  courseId: string;
  groupsStarted: number;
  groupsFinished: number;
  roundsCompleted: number;
  roundsIncomplete: number;
  roundDurations: number[];
  totalWaitMinutes: number;
  pickups: number;
  incidents: number;
  refunds: number;
  credits: number;
  goodwillVouchers: number;
  overtimeCost: number;
  compensationCost: number;
  greenFeeRevenue: number;
  beverageRevenue: number;
  occupiedTeeMinutes: number;
  satisfaction: number;
  lastStartedAt?: number;
  cohorts: Record<PaceCohort, PaceCohortDayMetrics>;
  holes: Record<string, PaceHoleDayMetrics>;
}

export interface LiveState {
  dayIndex: number; // 0-based day counter within the current week
  dayMinute: number; // current time of day (game-minutes past open)
  golfers: Golfer[]; // active + recently-finished (kept briefly for display)
  arrivals: Arrival[]; // scheduled, not yet spawned (sorted by atMinute)
  nextArrivalIdx: number;
  nextGolferId: number;
  greenFeeCollected: number; // cash collected today (green fees)
  concessionCollected: number;
  concessionTransactions: ConcessionTransaction[];
  concessionByType: Partial<Record<ConcessionType, number>>;
  roundsStarted: number;
  roundsFinished: number;
  satisfactionSum: number; // sum of finished golfers' mood*100
  // Real reactions aggregated from finished rounds (ZKU-116).
  promoters: number; // delighted golfers who'd recommend the course
  detractors: number; // disappointed golfers who'd warn others off
  willReturnCount: number; // golfers intending to come back
  reconcileEpoch: number; // bumped when a mid-round re-plan runs (ZKU-136)
  nextTeeFreeAt: number; // earliest game-minute the next group may tee off (ZKU-110)
  nextTeeFreeAtByCourse?: Record<string, number>;
  perCourse?: Record<string, {
    courseName: string;
    arrivals: number;
    roundsStarted: number;
    roundsFinished: number;
    greenFees: number;
    satisfactionSum: number;
    promoters: number;
    detractors: number;
    willReturnCount: number;
  }>;
  // Memoized walking routes (from->to), shared by all golfers spawned this day (ZKU-107).
  walkCache: Map<string, Point[] | null>;
  dayOver: boolean;
  seed: number;
  // Run difficulty at day start (ZKU-165) — scales rolled patience/spend.
  difficulty?: Difficulty;
  tournament?: LiveTournamentState;
  groups?: TeeGroupState[];
  pace?: PaceDayMetrics;
  marshalCoverageByCourse?: Record<string, number>;
  beverageCoverageByCourse?: Record<string, number>;
  overtimeRateByCourse?: Record<string, number>;
  operationsByCourse?: Record<string, CourseOperations>;
  weather?: { daily: DailyWeather; modifiers: WeatherModifiers };
  /** Bounded finished-round evidence retained until day commit. */
  observedRounds?: M49ObservedRound[];
  /** M51 transient group mobility contracts; walkCache remains the route-cache owner. */
  m51?: M51LiveMobilityState;
}

// Aggregated reactions from the golfers who actually finished a round today.
// Drives reputation instead of an abstract satisfaction formula (ZKU-116).
export interface RoundReactions {
  rounds: number;
  avgSatisfaction: number; // 0..100
  promoters: number;
  detractors: number;
  willReturnRate: number; // 0..1 share intending to return
  /** Present for M49 live rounds; absent in legacy callers/fixtures. */
  observations?: M49ObservedRound[];
}

// Minimal per-golfer data the renderer needs each frame. Read from a ref so
// the canvas never triggers React re-renders.
export interface GolferRenderData {
  id: number;
  personId?: string;
  x: number;
  y: number;
  ballX: number | null;
  ballY: number | null;
  /** Flight destination (rest point), non-null while a shot is in the air.
   *  The render layer draws its own arc/bounce profile toward it (ZKU-154). */
  ballToX: number | null;
  ballToY: number | null;
  color: string;
  mood: number;
  thought: string | null;
  // --- Animation facts (ZKU-153): raw, renderer-agnostic segment state. ---
  archetype: GolferArchetypeName;
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
  courseId?: string;
  currentHoleId?: string;
  /** Current itinerary segment kind, or null when idle/retired. */
  segKind: SegmentKind | null;
  /** Progress through the current segment, 0..1. */
  segT: number;
  /**
   * The stroke being addressed (pause before a flight) or in the air
   * (flight); null while walking or plain waiting.
   */
  shot: "swing" | "putt" | null;
  /**
   * World-space facing: walk direction while walking, shot direction while
   * addressing/swinging. Zero when the segment has no direction (renderer
   * keeps the last facing).
   */
  dirX: number;
  dirY: number;
  /** Holes folded into the score so far — a tick means "just holed out". */
  scoredHoles: number;
  /** Strokes over/under par on the most recently scored hole (0 if none). */
  lastHoleDelta: number;
  intent?: string | null;
  /** Shared-unit identity for renderer-only mobility visuals. */
  mobilityAssignmentId?: string;
  mobilityUnitId?: string;
  mobilityUnitMode?: "walk" | "pushcart" | "riding_cart";
}

// Result of committing a finished day into the economy/reputation model.
export interface DayResult {
  dayIndex: number;
  rounds: number;
  revenue: number; // green fees actually collected
  revenueBreakdown: {
    greenFees: number;
    concessions: number;
    tournaments?: number;
    property?: number;
    propertyCosts?: number;
    propertyVisitors?: number;
    paceOvertime?: number;
    paceCompensation?: number;
    byConcession: Partial<Record<ConcessionType, number>>;
    transactions: ConcessionTransaction[];
  };
  costs: number;
  profit: number;
  biomeEconomy?: BiomeOperatingCostBreakdown;
  avgSatisfaction: number; // 0..100
  reputationDelta: number;
  conditionDelta: number;
  /** Sparse, observed local maintenance evidence from the authoritative care simulation. */
  surfaceCare?: SurfaceCareDayReport;
  /** Per-green program delivery, realized conditions, and local traffic evidence. */
  greenKeeping?: GreenKeepingReport;
  /** Bounded M51 pace/economic evidence; never a cash-settlement path. */
  m51?: M51MobilityAggregateSummary;
  // Real-reaction detail behind the reputation move (ZKU-116).
  promoters: number;
  detractors: number;
  willReturnRate: number; // 0..1
  perCourse?: Array<{
    courseId: string;
    courseName: string;
    attendance: number;
    turnaways: number;
    capacity: number;
    revenue: number;
    costs: number;
    profit: number;
    avgSatisfaction: number;
    paceOvertime?: number;
    paceCompensation?: number;
  }>;
  pace?: PaceDayMetrics;
  weather?: {
    kind: WeatherKind;
    temperatureF: number;
    windMph: number;
    rainInches: number;
    modifiers: WeatherModifiers;
  };
}
