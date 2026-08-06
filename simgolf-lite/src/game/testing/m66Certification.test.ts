import { describe, expect, it } from "vitest";
import {
  courseHandicap,
  playingHandicap,
  roundHalfAwayFromZero,
  strokesByHole,
  strokesOffLow,
} from "../competition/handicap";
import {
  adjustedGrossScore,
  scoreDifferential,
  scoreStrokePlay,
  stablefordPoints,
} from "../competition/scoring";
import { captureTeamHandicapSnapshots } from "../competition/teamAuthority";
import type { CompetitionHole, CompetitionTeam } from "../competition/types";
import {
  bestDifferentialCount,
  captureRoundHandicapSnapshot,
  createHandicapProfile,
  createHandicapScoreRecord,
  formatHandicapIndex,
  migrateLegacyPlayerProHandicap,
  normalizeHandicapProfile,
  postCompletedHandicapRound,
  recordCompletedHandicapRound,
} from "../competition/persistence";
import {
  applyPracticeConfidence,
  applyRoundConfidence,
  confidenceAtDay,
  confidenceDispersionMultiplier,
  createPlayerConfidence,
} from "../playerPro/confidence";
import { normalizeCourseLayouts, publishLayout } from "../models/courseLayouts";
import { strokeIndexesForModeledGaps, validateStrokeIndexes } from "../models/strokeIndexes";
import type { Course } from "../models/types";
import { createTournamentStandardsCourse } from "./referenceCourse";

const skills = { power: 40, driving: 40, irons: 44, shortGame: 42, putting: 40, recovery: 40 };

function competitionHoles(length: 9 | 18): CompetitionHole[] {
  return Array.from({ length }, (_, index) => ({
    id: `hole-${index + 1}`,
    par: 4,
    strokeIndex: index + 1,
    strokeIndexSource: index === 0 ? "manual" : "auto",
  }));
}

function roundCourse(length: 9 | 18 = 9) {
  return {
    id: `m66-${length}`,
    name: `M66 ${length}-hole fixture`,
    geometryVersion: "m66:v1",
    teeSet: "member" as const,
    pinRotation: "A" as const,
    rating: { courseRating: length === 9 ? 36 : 72, slope: 113 },
    holes: competitionHoles(length),
  };
}

function snapshot(roundId: string, length: 9 | 18 = 9, handicapIndex = 8.4, established = false) {
  const base = createHandicapProfile(skills);
  return captureRoundHandicapSnapshot({
    roundId,
    handicapIndex,
    confidence: established
      ? { ...base.confidence, status: "established" as const, eligibleRoundCount: 3 }
      : base.confidence,
    course: roundCourse(length),
    startedWeek: 66,
    startedDay: 2,
  });
}

function completion(roundId: string, length: 9 | 18 = 9, gross = 5) {
  return {
    roundId,
    completedWeek: 66,
    completedDay: 2,
    scorecard: competitionHoles(length).map((hole) => ({
      holeId: hole.id,
      par: hole.par,
      strokes: gross,
      penalties: 0,
      complete: true,
    })),
  };
}

function indexedCourse(values: Array<number | undefined>): Course {
  const height = Math.max(10, values.length + 1);
  return {
    width: 10,
    height,
    tiles: Array.from({ length: 10 * height }, () => "rough" as const),
    elevations: Array(10 * height).fill(0),
    holes: values.map((holeIndex, index) => ({
      id: `hole-${index + 1}`,
      name: `Hole ${index + 1}`,
      tee: { x: 1, y: index },
      green: { x: 8, y: index },
      parMode: "MANUAL" as const,
      parManual: 4 as const,
      ...(holeIndex == null ? {} : { holeIndex }),
    })),
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "M66 stroke-index fixture",
    baseGreenFee: 0,
    condition: 1,
  };
}

function recordWithDifferential(roundId: string, differential: number, profile = createHandicapProfile(skills)) {
  const value = createHandicapScoreRecord(
    snapshot(roundId, 9, profile.handicapIndex, profile.confidence.status === "established"),
    { ...completion(roundId), source: "casual" as const },
  );
  return { ...value, evidence: { ...value.evidence, differential } };
}

describe("ZK-721 M66 handicap and scorecard certification", () => {
  it("certifies individual formulas, plus/mixed allocation, rounding boundaries, Stableford, and adjusted limits", () => {
    expect([
      roundHalfAwayFromZero(-1.5),
      roundHalfAwayFromZero(-.5),
      roundHalfAwayFromZero(.5),
      roundHalfAwayFromZero(1.5),
    ]).toEqual([-2, -1, 1, 2]);
    expect(courseHandicap(-8, { courseRating: 73, slopeRating: 113, par: 72 })).toMatchObject({ rounded: -7 });
    expect(playingHandicap(36, { courseRating: 71, slopeRating: 113, par: 72 }, .85).rounded).toBe(30);
    const holes = competitionHoles(9);
    expect(strokesByHole(-11, holes)).toEqual([-2, -2, -1, -1, -1, -1, -1, -1, -1]);
    expect([ -3, 2, 8 ].map((playingHandicap) => strokesOffLow(playingHandicap, [{ playingHandicap: -3 }, { playingHandicap: 2 }, { playingHandicap: 8 }]))).toEqual([0, 5, 11]);

    const player = {
      id: "cert-player",
      playingHandicap: 2,
      holeScores: [9, 5, 4, 3, 2, 6, 7, 8, 10].map((gross) => ({ playerId: "cert-player", gross, status: "played" as const })),
    };
    expect(scoreStrokePlay(player, holes)).toMatchObject({ gross: 54, net: 52, stableford: 11 });
    expect(adjustedGrossScore(player, holes)).toBe(45);
    expect(scoreDifferential(45, 36, 113)).toBe(9);
    expect([-3, -2, -1, 0, 1, 2, 3].map((netToPar) => stablefordPoints(4 + netToPar, 4, 0))).toEqual([5, 4, 3, 2, 1, 0, 0]);
  });

  it("certifies all frozen team formulas with plus and mixed-sign players", () => {
    const teams: CompetitionTeam[] = [
      { id: "team-a", playerIds: ["plus", "high"] },
      { id: "team-b", playerIds: ["low", "mid"] },
    ];
    const players = [
      { id: "plus", handicapIndex: -4 },
      { id: "high", handicapIndex: 20 },
      { id: "low", handicapIndex: 2 },
      { id: "mid", handicapIndex: 10 },
    ];
    const fixtures = [
      ["four-ball", "match", "90%-per-player", [0, 22, 6, 13]],
      ["four-ball", "stroke", "85%-per-player", [-3, 17, 2, 9]],
      ["alternate-shot", "match", "50%-combined", [2, 0]],
      ["alternate-shot", "stroke", "50%-combined", [8, 6]],
      ["scramble", "match", "35%-low+15%-high", [0, 0]],
      ["scramble", "stroke", "35%-low+15%-high", [2, 2]],
    ] as const;
    for (const [format, scoring, formula, expectedOffLow] of fixtures) {
      const result = captureTeamHandicapSnapshots(teams, players, format, scoring, { courseRating: 72, slopeRating: 113, par: 72 }, competitionHoles(18));
      expect(result.every((team) => team.formula === formula)).toBe(true);
      expect(format === "four-ball"
        ? result.flatMap((team) => team.members.map((member) => member.strokesOffLow))
        : result.map((team) => team.strokesOffLow)).toEqual(expectedOffLow);
      expect(Object.isFrozen(result[0].members)).toBe(true);
    }
  });

  it("certifies every latest-20 best-count band and bounded index movement", () => {
    expect(Array.from({ length: 21 }, (_, count) => bestDifferentialCount(count))).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8,
    ]);
    const base = createHandicapProfile(skills);
    const down = postCompletedHandicapRound(base, recordWithDifferential("movement-down", -8, base));
    expect(down.scoreRecords[0].calculation).toMatchObject({ indexBefore: 17.3, candidateIndex: 4.7, indexAfter: 14.3, movementCapped: true });
    const plusBase = { ...base, handicapIndex: -2 };
    const up = postCompletedHandicapRound(plusBase, recordWithDifferential("movement-up", 10, plusBase));
    expect(up.scoreRecords[0].calculation).toMatchObject({ indexBefore: -2, indexAfter: -1, movementCapped: true });
    expect([formatHandicapIndex(-8), formatHandicapIndex(0), formatHandicapIndex(36)]).toEqual(["+8.0", "0.0", "36.0"]);
  });

  it("certifies automatic/manual index authoring, range diagnosis, republish stability, and frozen snapshots", () => {
    expect(strokeIndexesForModeledGaps(Array.from({ length: 9 }, (_, index) => ({ id: `h${index}`, gap: index })))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(strokeIndexesForModeledGaps(Array.from({ length: 18 }, (_, index) => ({ id: `h${index}`, gap: 18 - index })))).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    const invalid = validateStrokeIndexes(indexedCourse([0, 2, 2, 4, 5, 6, 7, 8, 10]));
    expect(invalid.valid).toBe(false);
    expect(invalid.reasons.join(" ")).toContain("Hole 1");
    expect(invalid.reasons.join(" ")).toContain("duplicated");
    expect(invalid.reasons.join(" ")).toContain("1, 3, 9");

    const initial = normalizeCourseLayouts(createTournamentStandardsCourse());
    const layout = initial.layouts![0];
    const manualId = layout.draftHoleIds[0];
    const authored = {
      ...initial,
      holes: initial.holes.map((hole) => hole.id === manualId
        ? { ...hole, holeIndex: 18, holeIndexSource: "manual" as const }
        : hole),
    };
    const published = publishLayout(authored, layout.id);
    expect(published.reasons).toEqual([]);
    const once = published.course.holes.find((hole) => hole.id === manualId);
    const republished = publishLayout({ ...published.course, name: "Non-routing M66 edit" }, layout.id);
    expect(republished.course.holes.find((hole) => hole.id === manualId)).toMatchObject({ holeIndex: 18, holeIndexSource: "manual" });
    expect(republished.course.holes.map((hole) => hole.holeIndex)).toEqual(published.course.holes.map((hole) => hole.holeIndex));

    const frozen = snapshot("frozen-indexes", 18);
    expect(frozen.course.holes[0]).toMatchObject({ id: "hole-1", strokeIndex: 1 });
    expect(Object.isFrozen(frozen.course.holes)).toBe(true);
    expect(once).toBeDefined();
  }, 60_000);

  it.each([9, 18] as const)("certifies casual/challenge/team/tournament eligibility on %i holes and all exclusions", (length) => {
    for (const source of ["casual", "challenge", "team", "tournament"] as const) {
      const roundId = `${source}-${length}`;
      const score = createHandicapScoreRecord(snapshot(roundId, length), { ...completion(roundId, length), source });
      expect(score).toMatchObject({ source, postingState: "unposted", eligibility: { eligible: true }, evidence: { differential: expect.any(Number) } });
    }
    const excluded = [
      { source: "practice" as const, expected: "Practice" },
      { source: "casual" as const, conceded: true, expected: "conceded" },
      { source: "challenge" as const, withdrawn: true, expected: "withdrawn" },
      { source: "legacy" as const, legacyPartialRouting: true, expected: "legacy" },
    ];
    for (const fixture of excluded) {
      const score = createHandicapScoreRecord(snapshot(`excluded-${fixture.expected}-${length}`, length), {
        ...completion(`excluded-${fixture.expected}-${length}`, length),
        ...fixture,
      });
      expect(score.postingState).toBe("ineligible");
      expect(score.eligibility.reasons.join(" ")).toContain(fixture.expected);
      expect(score.evidence.differential).toBeNull();
    }
    const incompleteId = `incomplete-${length}`;
    const incomplete = createHandicapScoreRecord(snapshot(incompleteId, length), {
      ...completion(incompleteId, length),
      scorecard: completion(incompleteId, length).scorecard.slice(0, -1),
    });
    expect(incomplete.eligibility.reasons.join(" ")).toContain("missing");
  });

  it("certifies established and provisional per-hole adjustment limits", () => {
    const provisional = createHandicapScoreRecord(snapshot("provisional-limit"), completion("provisional-limit", 9, 20));
    expect(provisional.evidence.holeScores.every((hole) => hole.adjustedGross === hole.par + 5)).toBe(true);
    const established = createHandicapScoreRecord(snapshot("established-limit", 9, 8, true), completion("established-limit", 9, 20));
    expect(established.evidence.holeScores.map((hole) => hole.adjustedGross)).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 6]);
  });

  it("certifies fresh, migration, reload, duplicate, and corruption behavior", () => {
    const fresh = normalizeHandicapProfile(undefined, skills);
    expect(fresh).toMatchObject({ ok: true, seeded: true, profile: { handicapIndex: 17.3, scoreRecords: [] } });
    const migrated = migrateLegacyPlayerProHandicap({ skills, activeRound: null }) as { handicapProfile: unknown };
    const migratedProfile = normalizeHandicapProfile(migrated.handicapProfile, skills);
    expect(migratedProfile).toMatchObject({ ok: true, seeded: false });
    if (!migratedProfile.ok) return;

    const score = createHandicapScoreRecord(snapshot("reload-safe"), completion("reload-safe"));
    const once = recordCompletedHandicapRound(migratedProfile.profile, score);
    const reloaded = normalizeHandicapProfile(JSON.parse(JSON.stringify(once)), skills);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(recordCompletedHandicapRound(reloaded.profile, score)).toBe(reloaded.profile);
    expect(reloaded.profile.scoreRecords).toHaveLength(1);

    const duplicate = { ...reloaded.profile, scoreRecords: [...reloaded.profile.scoreRecords, reloaded.profile.scoreRecords[0]] };
    expect(normalizeHandicapProfile(duplicate, skills)).toMatchObject({ ok: false, error: { path: "world.playerPro.handicapProfile.scoreRecords" } });
    const corrupt = { ...reloaded.profile, handicapIndex: Number.NaN };
    expect(normalizeHandicapProfile(corrupt, skills)).toMatchObject({ ok: false, error: { path: "world.playerPro.handicapProfile.handicapIndex" } });
  });

  it("certifies deterministic confidence decay, practice, score feedback, concession, and dispersion-only influence", () => {
    const neutral = createPlayerConfidence();
    const practiced = applyPracticeConfidence(neutral, 3);
    expect(practiced).toMatchObject({ current: 60, reason: "practice", trend: "rising" });
    expect(confidenceAtDay(practiced, 1)).toMatchObject({ current: 58, reason: "daily_decay", trend: "falling" });
    expect(applyRoundConfidence(neutral, { indexBefore: 12, differential: 4, conceded: false })).toMatchObject({ current: 54, reason: "round_feedback" });
    expect(applyRoundConfidence(neutral, { indexBefore: 12, differential: 4, conceded: true })).toMatchObject({ current: 46, reason: "concession" });
    expect([0, 50, 100].map((current) => confidenceDispersionMultiplier({ ...neutral, current }))).toEqual([1.04, 1, .96]);
    expect(confidenceAtDay(practiced, 8)).toEqual(confidenceAtDay(practiced, 8));
  });
});
