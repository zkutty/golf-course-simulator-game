import type { Point } from "../models/types";
import type { Personality } from "./personality";

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
  // Render-facing only (ZKU-153): which stroke a "flight" represents, so the
  // renderer can pick the swing vs putt animation. Never read by sim logic.
  shot?: "swing" | "putt";
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
  strokes: number; // total strokes so far this round
  scoreToPar: number;
  mood: number; // 0..1
  thought: string | null;
  thoughtUntil: number; // dayMinute when the thought expires
  finished: boolean;
  spent: number; // money spent (green fee + concessions later)
}

export interface Arrival {
  atMinute: number;
  archetype: GolferArchetypeName;
}

export interface LiveState {
  dayIndex: number; // 0-based day counter within the current week
  dayMinute: number; // current time of day (game-minutes past open)
  golfers: Golfer[]; // active + recently-finished (kept briefly for display)
  arrivals: Arrival[]; // scheduled, not yet spawned (sorted by atMinute)
  nextArrivalIdx: number;
  nextGolferId: number;
  greenFeeCollected: number; // cash collected today (green fees)
  roundsStarted: number;
  roundsFinished: number;
  satisfactionSum: number; // sum of finished golfers' mood*100
  // Real reactions aggregated from finished rounds (ZKU-116).
  promoters: number; // delighted golfers who'd recommend the course
  detractors: number; // disappointed golfers who'd warn others off
  willReturnCount: number; // golfers intending to come back
  reconcileEpoch: number; // bumped when a mid-round re-plan runs (ZKU-136)
  nextTeeFreeAt: number; // earliest game-minute the next group may tee off (ZKU-110)
  // Memoized walking routes (from->to), shared by all golfers spawned this day (ZKU-107).
  walkCache: Map<string, Point[] | null>;
  dayOver: boolean;
  seed: number;
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
  color: string;
  mood: number;
  thought: string | null;
  // --- Animation facts (ZKU-153): raw, renderer-agnostic segment state. ---
  archetype: GolferArchetypeName;
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
  costs: number;
  profit: number;
  avgSatisfaction: number; // 0..100
  reputationDelta: number;
  conditionDelta: number;
  // Real-reaction detail behind the reputation move (ZKU-116).
  promoters: number;
  detractors: number;
  willReturnRate: number; // 0..1
}
