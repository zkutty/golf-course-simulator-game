import type { Point } from "../models/types";

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
  holeNumbers: number[]; // course hole index for each played hole (skips invalid holes)
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

// Immutable record of a completed (or abandoned) round, kept for the rest of
// the day so the inspector can still show a golfer who walked off, and so the
// day's results are real observed rounds rather than aggregates.
export interface FinishedRound {
  id: number;
  name: string;
  archetype: GolferArchetypeName;
  strokes: number;
  scoreToPar: number;
  mood: number; // final mood at walk-off
  spent: number;
  holeNumbers: number[];
  holePar: number[];
  holeStrokes: number[];
  holesPlayed: number;
}

export interface LiveState {
  dayIndex: number; // 0-based day counter within the current week
  dayMinute: number; // current time of day (game-minutes past open)
  golfers: Golfer[]; // active golfers currently on the course
  finishedRounds: FinishedRound[]; // today's completed rounds (reset each day)
  arrivals: Arrival[]; // scheduled, not yet spawned (sorted by atMinute)
  nextArrivalIdx: number;
  nextGolferId: number;
  greenFeeCollected: number; // cash collected today (green fees)
  roundsStarted: number;
  roundsFinished: number;
  satisfactionSum: number; // sum of finished golfers' mood*100
  dayOver: boolean;
  seed: number;
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
}

// A UI-facing snapshot of one golfer, published on the throttled status tick
// (never per-frame). `holes` reveals strokes only for holes already played.
export interface GolferSnapshot {
  id: number;
  name: string;
  archetype: GolferArchetypeName;
  currentHole: number; // course hole index, -1 while walking in/out
  strokes: number;
  scoreToPar: number;
  mood: number;
  finished: boolean;
  spent: number;
  holes: { holeNumber: number; par: number; strokes: number | null }[];
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
}
