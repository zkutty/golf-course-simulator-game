import type { GolferArchetypeName } from "../live/types";

export type RetentionEventCategory = "play" | "economy" | "milestone";
export type RetentionEventSeverity = "routine" | "notable" | "major";

export interface RetentionEvent {
  id: string;
  type: string;
  category: RetentionEventCategory;
  severity: RetentionEventSeverity;
  message: string;
  week: number;
  day: number;
  createdAt: number;
  golferId?: number;
  golferName?: string;
  holeIndex?: number;
  holeId?: string;
  courseId?: string;
  point?: { x: number; y: number };
  count?: number;
}

export interface CompletedRound {
  golferId: number;
  golferName: string;
  archetype: GolferArchetypeName;
  score: number;
  scoreToPar: number;
  holePar: number[];
  holeStrokes: number[];
  mood: number;
  courseId?: string;
  courseName?: string;
  holeIds?: string[];
  tournamentId?: string;
  tournamentEntrantId?: string;
}

/** Compact numeric rows keep long-running saves bounded: [week,cash,rating,reputation,profit,attendance]. */
export type HistoryPoint = [number, number, number, number, number, number];

export interface AceRecord {
  golferName: string;
  golferId: number;
  holeIndex: number;
  holeId?: string;
  courseId?: string;
  week: number;
  archetype: GolferArchetypeName;
}

export interface GolferHallEntry {
  golferName: string;
  golferId: number;
  archetype: GolferArchetypeName;
  rounds: number;
  bestToPar: number;
  aces: number;
}

export interface CourseRecords {
  version: 1;
  history: HistoryPoint[];
  bestRound: { scoreToPar: number; score: number; golferName: string; golferId: number; week: number } | null;
  aces: AceRecord[];
  recordRevenue: { amount: number; week: number } | null;
  attendanceRecord: { rounds: number; week: number } | null;
  longestProfitStreak: number;
  currentProfitStreak: number;
  totalRounds: number;
  holes: Array<{ rounds: number; strokes: number; par: number }>;
  hall: GolferHallEntry[];
  byCourse?: Record<string, {
    courseName: string;
    totalRounds: number;
    bestRound: { scoreToPar: number; score: number; golferName: string; golferId: number; week: number } | null;
    holes: Record<string, { rounds: number; strokes: number; par: number }>;
  }>;
}
