import type { ConcessionTransaction, ConcessionType, CourseOperations, Difficulty, PinRotation, Point, TeeSet } from "../models/types";
import type { Personality } from "./personality";
import type { LiveTournamentState } from "../tournaments/types";

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
  marshalInterventions?: number;
  forcedPickups?: number;
  drinksServed?: number;
  alcoholUnits?: number;
  hospitalityDelay?: number;
  disorderIncidents?: number;
}

export interface Arrival {
  atMinute: number;
  archetype: GolferArchetypeName;
  courseId?: string;
  tournament?: { eventId: string; entrantId: string; name: string; skill: number; teeSet?: TeeSet; pinRotation?: PinRotation };
  groupId?: string;
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
  operationsByCourse?: Record<string, CourseOperations>;
}

// Aggregated reactions from the golfers who actually finished a round today.
// Drives reputation instead of an abstract satisfaction formula (ZKU-116).
export interface RoundReactions {
  rounds: number;
  avgSatisfaction: number; // 0..100
  promoters: number;
  detractors: number;
  willReturnRate: number; // 0..1 share intending to return
}

// Minimal per-golfer data the renderer needs each frame. Read from a ref so
// the canvas never triggers React re-renders.
export interface GolferRenderData {
  id: number;
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
    byConcession: Partial<Record<ConcessionType, number>>;
    transactions: ConcessionTransaction[];
  };
  costs: number;
  profit: number;
  avgSatisfaction: number; // 0..100
  reputationDelta: number;
  conditionDelta: number;
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
  }>;
  pace?: PaceDayMetrics;
}
