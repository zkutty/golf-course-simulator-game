import { describe, expect, it } from "vitest";
import { courseHandicap, courseHandicapUnrounded, playingHandicap, playingHandicapFromUnrounded, roundHalfAwayFromZero, strokesByHole, strokesOffLow } from "./handicap";
import { adjustedGrossScore, scoreDifferential, scoreDifferentialUnrounded, scoreMatchPlay, scoreStrokePlay, scoreTeamHole, scoreTeamNetHole, settleMeasuredContest, settleNassau, settleSkins, stablefordPoints, teamAllowance, teamPlayingHandicap } from "./scoring";
import type { CompetitionHole, ScorecardPlayer } from "./types";

const nine: CompetitionHole[] = Array.from({ length: 9 }, (_, index) => ({ id: `n${index + 1}`, par: 4, strokeIndex: index + 1, strokeIndexSource: "manual" }));
const eighteen: CompetitionHole[] = Array.from({ length: 18 }, (_, index) => ({ id: `h${index + 1}`, par: 4, strokeIndex: index + 1, strokeIndexSource: "auto" }));
const player = (id: string, playingHandicap: number, gross: readonly number[], status?: "played" | "conceded" | "withdrawn"): ScorecardPlayer => ({ id, playingHandicap, holeScores: gross.map((score) => ({ playerId: id, gross: score, status })) });

describe("ZK-715 handicap authority", () => {
  it.each([
    [0.5, 1], [-0.5, -1], [1.49, 1], [-1.49, -1], [1.5, 2], [-1.5, -2],
  ])("rounds %s half away from zero to %s", (input, expected) => expect(roundHalfAwayFromZero(input)).toBe(expected));

  it.each([
    ["scratch", 0, { courseRating: 72, slopeRating: 113, par: 72 }, 1, 0],
    ["positive", 10, { courseRating: 71.2, slopeRating: 126, par: 72 }, 1, 10],
    ["plus", -2.5, { courseRating: 73, slopeRating: 113, par: 72 }, 1, -2],
    ["mixed tee allowance", 8.2, { courseRating: 69.7, slopeRating: 120, par: 70 }, 0.85, 7],
  ])("calculates %s course/playing handicap", (_name, index, course, allowance, expected) => {
    expect(playingHandicap(index, course, allowance).rounded).toBe(expected);
  });

  it("retains the unrounded Course Handicap through team allowances", () => {
    const raw = courseHandicapUnrounded(8.2, { courseRating: 69.7, slopeRating: 120, par: 70 });
    expect(raw).toBeCloseTo(8.4080, 4);
    expect(courseHandicap(8.2, { courseRating: 69.7, slopeRating: 120, par: 70 }).rounded).toBe(8);
    expect(playingHandicapFromUnrounded(raw, 0.85)).toMatchObject({ rounded: 7 });
  });

  it.each([
    ["nine-hole positive", 10, nine, [2, 1, 1, 1, 1, 1, 1, 1, 1]],
    ["eighteen-hole positive", 20, eighteen, [2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    ["nine-hole plus", -2, nine, [-1, -1, 0, 0, 0, 0, 0, 0, 0]],
    ["eighteen-hole plus", -19, eighteen, [-2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]],
  ])("allocates %s strokes by index", (_name, handicap, holes, expected) => expect(strokesByHole(handicap, holes)).toEqual(expected));

  it("handles strokes-off-low when mixed positive and plus players play together", () => {
    const players = [{ playingHandicap: -3 }, { playingHandicap: 2 }, { playingHandicap: 8 }];
    expect(players.map((entry) => strokesOffLow(entry.playingHandicap, players))).toEqual([0, 5, 11]);
  });
});

describe("ZK-715 scoring authority", () => {
  it("calculates adjusted gross, differential, net stroke and the Stableford table", () => {
    const card = player("a", 2, [9, 5, 4, 3, 2, 6, 7, 8, 10]);
    const result = scoreStrokePlay(card, nine);
    expect(result).toMatchObject({ gross: 54, net: 52, stableford: 11 });
    expect(adjustedGrossScore(card, nine)).toBe(45); // hole 1 cap is 7 after its received stroke
    expect(scoreDifferential(45, 36, 113)).toBe(9);
    expect(scoreDifferentialUnrounded(87, 70, 127)).toBeCloseTo(15.1260, 4);
    expect(scoreDifferential(87, 70, 127)).toBe(15.1);
    expect([-1, 0, 1, 2, 3, 4].map((netToPar) => stablefordPoints(4 + netToPar, 4, 0))).toEqual([3, 2, 1, 0, 0, 0]);
    expect(stablefordPoints(1, 4, 0)).toBe(5);
  });

  it("settles net match-play from strokes-off-low with an explicit concession and a tie", () => {
    const result = scoreMatchPlay(
      [{ id: "plus", playingHandicap: -1 }, { id: "ten", playingHandicap: 1 }],
      nine,
      { plus: Array.from({ length: 9 }, (_, index) => ({ playerId: "plus", gross: index === 0 ? 5 : 4 })), ten: Array.from({ length: 9 }, (_, index) => ({ playerId: "ten", gross: 4, status: index === 1 ? "conceded" as const : "played" as const })) },
    );
    expect(result.holes[0]).toMatchObject({ winnerId: "ten", status: "won" });
    expect(result.holes[1]).toMatchObject({ status: "conceded" });
    expect(result.status).toBe("won");
  });

  it("ends a match as withdrawn when a player explicitly withdraws", () => {
    const scores = { a: [...Array.from({ length: 3 }, () => ({ playerId: "a", gross: 4, status: "played" as const })), { playerId: "a", status: "withdrawn" as const }], b: Array.from({ length: 4 }, () => ({ playerId: "b", gross: 4 })) };
    expect(scoreMatchPlay([{ id: "a", playingHandicap: 0 }, { id: "b", playingHandicap: 0 }], nine, scores)).toMatchObject({ status: "withdrawn", winnerId: "b" });
  });

  it("uses reusable team allowances and team-hole choices", () => {
    expect(teamAllowance([10, 4], [0.9, 0.9])).toBeCloseTo(12.6); // four-ball match
    expect(teamAllowance([10, 4], [0.85, 0.85])).toBeCloseTo(11.9); // four-ball stroke
    expect(teamAllowance([10, 4], [0.5, 0.5])).toBe(7); // alternate shot
    expect(teamAllowance([4, 12], [0.35, 0.15])).toBeCloseTo(3.2); // two-person scramble
    expect(teamPlayingHandicap([10, 4], [0.85, 0.85])).toMatchObject({ unrounded: 11.9, rounded: 12 });
    expect(scoreTeamHole("four-ball", [5, 4], 4, 1, 1, nine)).toMatchObject({ gross: 4, net: 3, stableford: 3 });
    expect(scoreTeamHole("alternate-shot", [5], 4, 0, 2, nine)).toMatchObject({ gross: 5, net: 5 });
    expect(scoreTeamNetHole("four-ball", [{ playerId: "a", gross: 5, net: 4 }, { playerId: "b", gross: 4, net: 4 }])).toEqual({ gross: 4, net: 4, countedPlayerIds: ["b"] });
    expect(scoreTeamNetHole("pro-am", [{ playerId: "pro", gross: 3, net: 3, role: "pro" }, { playerId: "am-1", gross: 5, net: 4, role: "amateur" }, { playerId: "am-2", gross: 4, net: 4, role: "amateur" }, { playerId: "am-3", gross: 6, net: 5, role: "amateur" }])).toEqual({ gross: 7, net: 7, countedPlayerIds: ["pro", "am-2"] });
    expect(() => scoreTeamNetHole("pro-am", [{ playerId: "pro-a", gross: 3, net: 3, role: "pro" }, { playerId: "pro-b", gross: 4, net: 4, role: "pro" }])).toThrow("including at least one amateur");
  });

  it("settles skins carries, Nassau ties, and measurement evidence/refunds", () => {
    expect(settleSkins([undefined, undefined, "a", "b"], 2, 1)).toEqual([
      { status: "carried", amount: 0, carry: 3 }, { status: "carried", amount: 0, carry: 5 }, { status: "settled", winnerId: "a", amount: 7, carry: 0 }, { status: "settled", winnerId: "b", amount: 2, carry: 0 },
    ]);
    expect(settleNassau(["a", undefined, "b"], 5)).toEqual([{ status: "settled", winnerId: "a", amount: 5, carry: 0 }, { status: "tie", amount: 0, carry: 0 }, { status: "settled", winnerId: "b", amount: 5, carry: 0 }]);
    expect(settleMeasuredContest("closest-to-pin", [{ playerId: "a", measurement: 4, eligible: true }, { playerId: "b", measurement: 5, eligible: true }], 3)).toMatchObject({ winnerId: "a", amount: 3 });
    expect(settleMeasuredContest("longest-drive", [{ playerId: "a", measurement: 300, eligible: true }, { playerId: "b", measurement: 300, eligible: true }], 3)).toMatchObject({ status: "tie" });
    expect(settleMeasuredContest("longest-drive", [{ playerId: "a", measurement: 0, eligible: false, withdrawn: true }], 3)).toMatchObject({ status: "withdrawn" });
  });
});
