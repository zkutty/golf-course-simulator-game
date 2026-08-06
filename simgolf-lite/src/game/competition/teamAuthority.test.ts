import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CompetitionHole, CompetitionTeam } from "./types";
import { advanceAlternateShotBall, captureTeamHandicapSnapshots, chooseDeterministicScrambleBall } from "./teamAuthority";

const holes: CompetitionHole[] = Array.from({ length: 18 }, (_, index) => ({ id: `h-${index + 1}`, par: 4, strokeIndex: index + 1 }));
const course = { courseRating: 72, slopeRating: 113, par: 72 };
const teams: CompetitionTeam[] = [
  { id: "a", playerIds: ["plus", "high"] },
  { id: "b", playerIds: ["low", "mid"] },
];
const players = [
  { id: "plus", handicapIndex: -4 },
  { id: "high", handicapIndex: 20 },
  { id: "low", handicapIndex: 2 },
  { id: "mid", handicapIndex: 10 },
];

describe("ZK-728 frozen team handicap authority", () => {
  it.each([
    ["four-ball", "match", "90%-per-player", [0, 22, 6, 13], [-4, 18, 2, 9]],
    ["four-ball", "stroke", "85%-per-player", [-3, 17, 2, 9], [-3, 17, 2, 9]],
    ["alternate-shot", "match", "50%-combined", [2, 0], [8, 6]],
    ["alternate-shot", "stroke", "50%-combined", [8, 6], [8, 6]],
    ["scramble", "match", "35%-low+15%-high", [0, 0], [2, 2]],
    ["scramble", "stroke", "35%-low+15%-high", [2, 2], [2, 2]],
  ] as const)("applies %s %s including plus/mixed-sign and strokes-off-low", (format, scoring, formula, expectedOffLow, expectedPlaying) => {
    const snapshots = captureTeamHandicapSnapshots(teams, players, format, scoring, course, holes);
    expect(snapshots.map((entry) => entry.formula)).toEqual([formula, formula]);
    if (format === "four-ball") {
      expect(snapshots.flatMap((entry) => entry.members).map((member) => member.strokesOffLow)).toEqual(expectedOffLow);
      expect(snapshots.flatMap((entry) => entry.members).map((member) => member.playingHandicap)).toEqual(expectedPlaying);
    } else {
      expect(snapshots.map((entry) => entry.strokesOffLow)).toEqual(expectedOffLow);
      expect(snapshots.map((entry) => entry.playingHandicap)).toEqual(expectedPlaying);
    }
    expect(Object.isFrozen(snapshots)).toBe(true);
    expect(Object.isFrozen(snapshots[0].members)).toBe(true);
  });

  it("uses low then high handicap contributions for a two-person scramble regardless of roster order", () => {
    const forward = captureTeamHandicapSnapshots(teams, players, "scramble", "stroke", course, holes);
    const reversed = captureTeamHandicapSnapshots(teams.map((team) => ({ ...team, playerIds: [...team.playerIds].reverse() })), players, "scramble", "stroke", course, holes);
    expect(forward.map((entry) => entry.unrounded)).toEqual(reversed.map((entry) => entry.unrounded));
    expect(forward.map((entry) => entry.unrounded)).toEqual([1.6, 2.2]);
  });

  it("selects AI scramble balls by completion, penalty, leave, and stable roster order", () => {
    const candidates = [
      { playerId: "a", shotId: "shot-a", rest: { x: 2, y: 2 }, lie: "fairway", penaltyStrokes: 0, strokeCost: 1, completesHole: false, distanceToPin: 3 },
      { playerId: "b", shotId: "shot-b", rest: { x: 4, y: 4 }, lie: "green", penaltyStrokes: 0, strokeCost: 1, completesHole: true, distanceToPin: 0 },
    ];
    expect(chooseDeterministicScrambleBall(candidates, ["a", "b"]).playerId).toBe("b");
    expect(chooseDeterministicScrambleBall(candidates.map((candidate) => ({ ...candidate, completesHole: false })), ["a", "b"]).playerId).toBe("b");
    expect(chooseDeterministicScrambleBall(candidates.map((candidate) => ({ ...candidate, completesHole: false, distanceToPin: 3 })), ["a", "b"]).playerId).toBe("a");
  });

  it("adds alternate-shot penalties to the shared card without skipping the partner", () => {
    const ball = {
      teamId: "a",
      ball: { x: 1, y: 1 },
      lie: "tee",
      nextPlayerId: "plus",
      candidates: [],
      scorecard: holes.map((hole) => ({ holeId: hole.id, par: hole.par, handicapStrokes: 0, strokes: 0, penalties: 0, gross: null, net: null, status: "active" as const, countedPlayerIds: [] })),
    };
    const next = advanceAlternateShotBall(ball, 0, {
      playerId: "plus", shotId: "penalty-shot", rest: { x: 2, y: 2 }, lie: "penalty-relief", penaltyStrokes: 1, strokeCost: 1, completesHole: false, distanceToPin: 20,
    }, ["plus", "high"]);
    expect(next.nextPlayerId).toBe("high");
    expect(next.scorecard[0]).toMatchObject({ strokes: 1, penalties: 1, gross: null, countedPlayerIds: ["plus"] });
  });

  it("is deterministic and bounded across hostile plus/mixed-sign handicap tables", () => {
    fc.assert(fc.property(fc.tuple(fc.double({ min: -8, max: 36, noNaN: true, noDefaultInfinity: true }), fc.double({ min: -8, max: 36, noNaN: true, noDefaultInfinity: true }), fc.double({ min: -8, max: 36, noNaN: true, noDefaultInfinity: true }), fc.double({ min: -8, max: 36, noNaN: true, noDefaultInfinity: true })), fc.constantFrom("four-ball", "alternate-shot", "scramble" as const), fc.constantFrom("match", "stroke" as const), (indexes, format, scoring) => {
      const generated = players.map((player, index) => ({ id: player.id, handicapIndex: indexes[index] }));
      const first = captureTeamHandicapSnapshots(teams, generated, format, scoring, course, holes);
      const second = captureTeamHandicapSnapshots(teams, generated, format, scoring, course, holes);
      expect(first).toEqual(second);
      expect(first.flatMap((snapshot) => [snapshot.unrounded, snapshot.playingHandicap, snapshot.strokesOffLow, ...snapshot.strokesByHole]).every(Number.isFinite)).toBe(true);
    }), { numRuns: 250 });
  });
});
