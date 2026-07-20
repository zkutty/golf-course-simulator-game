import type { WeekResult } from "../models/types";
import type { CompletedRound, CourseRecords, GolferHallEntry } from "./types";

export const HISTORY_POINT_BYTES = 6 * 8;

export function emptyCourseRecords(holeCount = 18): CourseRecords {
  return {
    version: 1,
    history: [],
    bestRound: null,
    aces: [],
    recordRevenue: null,
    attendanceRecord: null,
    longestProfitStreak: 0,
    currentProfitStreak: 0,
    totalRounds: 0,
    holes: Array.from({ length: holeCount }, () => ({ rounds: 0, strokes: 0, par: 0 })),
    hall: [],
  };
}

function hallEntry(records: CourseRecords, round: CompletedRound): GolferHallEntry {
  const existing = records.hall.find((entry) => entry.golferName === round.golferName && entry.archetype === round.archetype);
  return existing ?? { golferName: round.golferName, golferId: round.golferId, archetype: round.archetype, rounds: 0, bestToPar: Number.POSITIVE_INFINITY, aces: 0 };
}

export function recordCompletedRound(records: CourseRecords, round: CompletedRound, week: number): { records: CourseRecords; aceHoles: number[]; courseRecord: boolean } {
  const next: CourseRecords = JSON.parse(JSON.stringify(records)) as CourseRecords;
  const aceHoles: number[] = [];
  next.totalRounds++;
  const entry = hallEntry(next, round);
  if (!next.hall.includes(entry)) next.hall.push(entry);
  entry.rounds++;
  entry.bestToPar = Math.min(entry.bestToPar, round.scoreToPar);
  round.holeStrokes.forEach((strokes, index) => {
    const par = round.holePar[index] ?? 0;
    next.holes[index] ??= { rounds: 0, strokes: 0, par: 0 };
    next.holes[index].rounds++;
    next.holes[index].strokes += strokes;
    next.holes[index].par += par;
    if (strokes === 1) {
      aceHoles.push(index);
      entry.aces++;
      next.aces.push({ golferName: round.golferName, golferId: round.golferId, holeIndex: index, week, archetype: round.archetype });
    }
  });
  const courseRecord = next.bestRound == null || round.scoreToPar < next.bestRound.scoreToPar;
  if (courseRecord) next.bestRound = { scoreToPar: round.scoreToPar, score: round.score, golferName: round.golferName, golferId: round.golferId, week };
  next.hall.sort((a, b) => b.aces - a.aces || a.bestToPar - b.bestToPar || b.rounds - a.rounds);
  next.hall = next.hall.slice(0, 100);
  return { records: next, aceHoles, courseRecord };
}

export function recordWeek(records: CourseRecords, input: { week: number; cash: number; rating: number; reputation: number; result: WeekResult }): CourseRecords {
  const next: CourseRecords = JSON.parse(JSON.stringify(records)) as CourseRecords;
  const row: CourseRecords["history"][number] = [input.week, Math.round(input.cash), Math.round(input.rating * 10) / 10, Math.round(input.reputation * 10) / 10, Math.round(input.result.profit), input.result.visitors];
  const last = next.history[next.history.length - 1];
  if (last?.[0] === input.week) next.history[next.history.length - 1] = row;
  else next.history.push(row);
  if (!next.recordRevenue || input.result.revenue > next.recordRevenue.amount) next.recordRevenue = { amount: input.result.revenue, week: input.week };
  if (!next.attendanceRecord || input.result.visitors > next.attendanceRecord.rounds) next.attendanceRecord = { rounds: input.result.visitors, week: input.week };
  next.currentProfitStreak = input.result.profit > 0 ? next.currentProfitStreak + 1 : 0;
  next.longestProfitStreak = Math.max(next.longestProfitStreak, next.currentProfitStreak);
  return next;
}

export function seedRecordsFromHistory(history: WeekResult[] = [], startWeek = 1): CourseRecords {
  return history.reduce((records, result, index) => recordWeek(records, { week: startWeek + index, cash: 0, rating: 0, reputation: 0, result }), emptyCourseRecords());
}

export function downsampleHistory<T>(values: T[], maxPoints = 180): T[] {
  if (values.length <= maxPoints) return values;
  const stride = (values.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => values[Math.round(index * stride)]);
}
