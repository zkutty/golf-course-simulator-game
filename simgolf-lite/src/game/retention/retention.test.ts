import { describe, expect, it } from "vitest";
import { DEFAULT_APP_PROFILE } from "../onboarding/profile";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { ACHIEVEMENTS, evaluateAchievements } from "./achievements";
import { downsampleHistory, emptyCourseRecords, recordCompletedRound, recordWeek } from "./records";

describe("M17 retention", () => {
  it("attributes aces, course records, hall entries and per-hole aggregates", () => {
    const result = recordCompletedRound(emptyCourseRecords(2), { golferId: 7, golferName: "Marge", archetype: "senior", score: 4, scoreToPar: -3, holePar: [3, 4], holeStrokes: [1, 3], mood: 1 }, 12);
    expect(result.aceHoles).toEqual([0]);
    expect(result.records.bestRound?.golferName).toBe("Marge");
    expect(result.records.hall[0]).toMatchObject({ golferName: "Marge", aces: 1, rounds: 1 });
    expect(result.records.holes[0]).toMatchObject({ rounds: 1, strokes: 1, par: 3 });
  });

  it("stores compact history and downsamples long runs", () => {
    let records = emptyCourseRecords();
    for (let week = 1; week <= 220; week++) records = recordWeek(records, { week, cash: week, rating: 70, reputation: 50, result: { visitors: week, revenue: week * 2, costs: week, profit: week, avgSatisfaction: 80, reputationDelta: 0, visitorNoise: 0 } });
    expect(records.history).toHaveLength(220);
    expect(downsampleHistory(records.history)).toHaveLength(180);
    expect(records.longestProfitStreak).toBe(220);
  });

  it("defines 27 one-shot achievements, including expansion goals, and never re-fires earned ones", () => {
    expect(ACHIEVEMENTS).toHaveLength(27);
    const course = { ...DEFAULT_COURSE, holes: DEFAULT_COURSE.holes.map((hole, index) => index === 0 ? { ...hole, tee: { x: 1, y: 1 }, green: { x: 4, y: 4 } } : hole) };
    const context = { course, world: DEFAULT_WORLD, records: emptyCourseRecords(), rating: 0, tutorialCompleted: false, profitStreak: 0, sculpted: false, recoveredDistress: false, perfectMood: false };
    const first = evaluateAchievements(DEFAULT_APP_PROFILE, context, "Test", 1);
    expect(first.earned.map((item) => item.id)).toContain("first-hole");
    expect(evaluateAchievements(first.profile, context, "Test", 2).earned).toEqual([]);
  });
});
