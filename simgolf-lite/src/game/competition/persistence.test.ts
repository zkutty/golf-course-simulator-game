import { describe, expect, it } from "vitest";
import {
  bestDifferentialCount,
  calculateHandicapIndex,
  captureRoundHandicapSnapshot,
  createHandicapProfile,
  createHandicapScoreRecord,
  formatHandicapIndex,
  markHandicapScoreRecordPosted,
  migrateLegacyPlayerProHandicap,
  normalizeHandicapProfile,
  postCompletedHandicapRound,
  provisionalHandicapIndex,
  recordCompletedHandicapRound,
} from "./persistence";

const skills = {
  power: 40,
  driving: 40,
  irons: 44,
  shortGame: 42,
  putting: 40,
  recovery: 40,
};

function course(length: 9 | 18 = 9) {
  return {
    id: "member-course",
    name: "Member Course",
    geometryVersion: "geometry:v1",
    teeSet: "member" as const,
    pinRotation: "A" as const,
    rating: { courseRating: length === 9 ? 36 : 72, slope: 113 },
    holes: Array.from({ length }, (_, index) => ({ id: `hole-${index + 1}`, par: 4, strokeIndex: index + 1 })),
  };
}

function snapshot() {
  const profile = createHandicapProfile(skills);
  return captureRoundHandicapSnapshot({
    roundId: "round-1",
    handicapIndex: profile.handicapIndex,
    confidence: profile.confidence,
    course: course(),
    startedWeek: 3,
    startedDay: 2,
  });
}

function completed() {
  return {
    roundId: "round-1",
    completedWeek: 3,
    completedDay: 2,
    scorecard: course().holes.map((hole) => ({
      holeId: hole.id,
      par: hole.par,
      strokes: 5,
      penalties: 0,
      complete: true,
    })),
  };
}

describe("ZK-716 handicap persistence", () => {
  it("seeds the documented weighted estimate once and enforces index bounds", () => {
    expect(provisionalHandicapIndex(skills)).toBe(17.3);
    expect(provisionalHandicapIndex({ power: 0, driving: 0, irons: 0, shortGame: 0, putting: 0, recovery: 0 })).toBe(36);
    expect(provisionalHandicapIndex({ power: 100, driving: 100, irons: 100, shortGame: 100, putting: 100, recovery: 100 })).toBe(-8);
    const profile = createHandicapProfile(skills);
    expect(profile).toMatchObject({ handicapIndex: 17.3, source: "skill-seed", confidence: { status: "provisional", eligibleRoundCount: 0 } });
    const changedSkills = { ...skills, putting: 100 };
    const restored = normalizeHandicapProfile(JSON.parse(JSON.stringify(profile)), changedSkills);
    expect(restored.ok && restored.profile.handicapIndex).toBe(17.3);
    expect(restored.ok && restored.seeded).toBe(false);
  });

  it("freezes an immutable round-start index, confidence, setup, and eligibility snapshot", () => {
    const mutableCourse = course();
    const frozen = captureRoundHandicapSnapshot({
      roundId: "round-1",
      handicapIndex: 8.4,
      confidence: createHandicapProfile(skills).confidence,
      course: mutableCourse,
      startedWeek: 3,
      startedDay: 2,
    });
    mutableCourse.rating.courseRating = 99;
    mutableCourse.holes[0].strokeIndex = 9;
    expect(frozen).toMatchObject({
      handicapIndex: 8.4,
      postingKey: "handicap-post:round-1",
      postingState: "unposted",
      eligibility: { eligible: true, reasons: [] },
      course: { courseRating: 36, slopeRating: 113 },
    });
    expect(frozen.course.holes[0].strokeIndex).toBe(1);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.course.holes)).toBe(true);
  });

  it("retains differential evidence and makes completion and posting idempotent across reloads", () => {
    const base = createHandicapProfile(skills);
    const record = createHandicapScoreRecord(snapshot(), completed());
    expect(record).toMatchObject({
      postingState: "unposted",
      eligibility: { eligible: true },
      evidence: { grossScore: 45, adjustedGrossScore: expect.any(Number), differential: expect.any(Number) },
    });
    const once = recordCompletedHandicapRound(base, record);
    const reloaded = normalizeHandicapProfile(JSON.parse(JSON.stringify(once)), skills);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    const duplicateCompletion = recordCompletedHandicapRound(reloaded.profile, record);
    expect(duplicateCompletion).toBe(reloaded.profile);
    expect(duplicateCompletion.scoreRecords).toHaveLength(1);
    const posted = markHandicapScoreRecordPosted(duplicateCompletion, {
      postingKey: record.postingKey,
      handicapIndex: 12.3,
      postedWeek: 3,
      postedDay: 2,
    });
    const duplicatePosting = markHandicapScoreRecordPosted(posted, {
      postingKey: record.postingKey,
      handicapIndex: 1,
      postedWeek: 99,
      postedDay: 6,
    });
    expect(duplicatePosting).toBe(posted);
    expect(posted).toMatchObject({
      handicapIndex: 12.3,
      source: "scores",
      confidence: { status: "provisional", lastPostedRoundId: "round-1" },
      postingLedger: ["handicap-post:round-1"],
    });
  });

  it("preserves an established score-only index during migration", () => {
    const record = createHandicapScoreRecord(snapshot(), completed());
    const withRecord = recordCompletedHandicapRound(createHandicapProfile(skills), record);
    const established = markHandicapScoreRecordPosted(withRecord, {
      postingKey: record.postingKey,
      handicapIndex: 4.7,
      postedWeek: 4,
      postedDay: 0,
    });
    const migrated = migrateLegacyPlayerProHandicap({
      skills: { ...skills, putting: 100 },
      handicapProfile: established,
      activeRound: null,
    }) as { handicapProfile: typeof established };
    expect(migrated.handicapProfile.handicapIndex).toBe(4.7);
    expect(migrated.handicapProfile.scoreRecords).toHaveLength(1);
  });

  it("reports corrupt evidence at an actionable field without silently reseeding", () => {
    const corrupt = {
      ...createHandicapProfile(skills),
      handicapIndex: Number.NaN,
    };
    const result = normalizeHandicapProfile(corrupt, skills);
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "INVALID_HANDICAP_PROFILE",
        path: "world.playerPro.handicapProfile.handicapIndex",
        message: expect.stringContaining("-8.0 through 36.0"),
      }),
    });
  });

  it("keeps incomplete and conceded completions explicitly ineligible", () => {
    const incomplete = createHandicapScoreRecord(snapshot(), {
      ...completed(),
      scorecard: completed().scorecard.slice(0, 8),
    });
    expect(incomplete).toMatchObject({ postingState: "ineligible", evidence: { differential: null } });
    expect(incomplete.eligibility.reasons[0]).toContain("missing");
    const conceded = createHandicapScoreRecord(snapshot(), { ...completed(), conceded: true });
    expect(conceded.eligibility.reasons[0]).toContain("conceded");
  });
});

describe("ZK-718 handicap posting", () => {
  function score(roundId: string, differential: number, profile = createHandicapProfile(skills)) {
    const frozen = captureRoundHandicapSnapshot({
      roundId,
      handicapIndex: profile.handicapIndex,
      confidence: profile.confidence,
      course: course(),
      startedWeek: 4,
      startedDay: 1,
    });
    const value = createHandicapScoreRecord(frozen, {
      roundId,
      source: "casual",
      completedWeek: 4,
      completedDay: 1,
      scorecard: course().holes.map((hole) => ({ holeId: hole.id, par: hole.par, strokes: 5, penalties: 0, complete: true })),
    });
    return { ...value, evidence: { ...value.evidence, differential } };
  }

  it("matches every latest-20 best-count band fixture", () => {
    const expected = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8];
    expect(Array.from({ length: 21 }, (_, count) => bestDifferentialCount(count))).toEqual(expected);
  });

  it("blends the first two scores with the one-time seed, then becomes score-only", () => {
    const base = createHandicapProfile(skills);
    const first = postCompletedHandicapRound(base, score("one", 17.3, base));
    const second = postCompletedHandicapRound(first, score("two", 16.3, first));
    const thirdRecord = score("three", 15.3, second);
    const calculation = calculateHandicapIndex(recordCompletedHandicapRound(second, thirdRecord), thirdRecord);
    const third = postCompletedHandicapRound(second, thirdRecord);
    expect(first).toMatchObject({ handicapIndex: 17.3, confidence: { status: "provisional" } });
    expect(second).toMatchObject({ handicapIndex: 17, confidence: { status: "provisional" } });
    expect(calculation).toMatchObject({ candidateIndex: 15.3, differentialRecordCount: 3, bestDifferentialCount: 1 });
    expect(third).toMatchObject({ handicapIndex: 15.3, confidence: { status: "established" } });
  });

  it("shows downward/upward movement caps and uses unambiguous plus display", () => {
    const base = createHandicapProfile(skills);
    const down = postCompletedHandicapRound(base, score("down", -8, base));
    expect(down.scoreRecords[0].calculation).toMatchObject({
      indexBefore: 17.3,
      candidateIndex: 4.7,
      indexAfter: 14.3,
      movementCapped: true,
    });
    const highBase = { ...base, handicapIndex: -2 };
    const highScore = score("up", 10, highBase);
    const up = postCompletedHandicapRound(highBase, highScore);
    expect(up.scoreRecords[0].calculation).toMatchObject({ indexBefore: -2, indexAfter: -1, movementCapped: true });
    expect(formatHandicapIndex(-1.2)).toBe("+1.2");
    expect(formatHandicapIndex(1.2)).toBe("1.2");
  });

  it("excludes practice, concessions, withdrawals, and partial legacy routes with explicit reasons", () => {
    const frozen = snapshot();
    const cases = [
      { source: "practice" as const, expected: "Practice" },
      { source: "casual" as const, conceded: true, expected: "conceded" },
      { source: "challenge" as const, withdrawn: true, expected: "withdrawn" },
      { source: "legacy" as const, legacyPartialRouting: true, expected: "legacy" },
    ];
    for (const fixture of cases) {
      const result = createHandicapScoreRecord(frozen, { ...completed(), ...fixture });
      expect(result.postingState).toBe("ineligible");
      expect(result.eligibility.reasons.join(" ")).toContain(fixture.expected);
    }
  });

  it("posts atomically, remains idempotent, and retains team members' individual gross cards", () => {
    const base = createHandicapProfile(skills);
    const value = createHandicapScoreRecord(snapshot(), {
      ...completed(),
      source: "team",
      individualGrossEvidence: ["player-pro", "partner"].map((playerId, offset) => ({
        playerId,
        holeScores: course().holes.map((hole) => ({ holeId: hole.id, par: hole.par, gross: 5 + offset })),
      })),
    });
    const posted = postCompletedHandicapRound(base, value);
    expect(posted.scoreRecords).toHaveLength(1);
    expect(posted.scoreRecords[0]).toMatchObject({ postingState: "posted", source: "team" });
    expect(posted.scoreRecords[0].evidence.individualGrossEvidence.map((entry) => entry.playerId)).toEqual(["player-pro", "partner"]);
    expect(postCompletedHandicapRound(posted, value)).toBe(posted);
  });
});
