import { describe, expect, it } from "vitest";
import type { InventoryItem } from "./types";
import type { PlayerProSkills, PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { createDefaultPlayerPro, normalizePlayerPro } from "../playerPro/playerPro";
import { strokesByHole } from "./handicap";
import {
  challengeGroupRoundTextState,
  challengeGroupIndividualGrossEvidence,
  chooseChallengeGroupScrambleBall,
  commitChallengeGroupPlayerShot,
  concedeChallengeGroupHole,
  decodeChallengeGroupRound,
  encodeChallengeGroupRound,
  previewChallengeGroupPlayerShot,
  recordChallengeGroupMeasurement,
  replayChallengeGroupPlayerShots,
  renderChallengeGroupRoundToText,
  scoreChallengeNassauSegment,
  startChallengeGroupRound,
  withdrawChallengeGroupGolfer,
  type ChallengeGroupParticipantInput,
  type ChallengeGroupRound,
  type ChallengeSideBetState,
} from "./challengeGroupRound";

const skills: PlayerProSkills = {
  power: 72,
  driving: 70,
  irons: 68,
  shortGame: 75,
  putting: 74,
  recovery: 67,
};

function course(terrain: "green" | "water" = "green"): PlayerRoundCourseSnapshot {
  const width = 18;
  const height = 8;
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `hole-${index + 1}`,
    name: `Hole ${index + 1}`,
    par: 3,
    tee: { x: 2, y: 3 },
    pin: { x: 9, y: 3 },
    waypoints: [],
    strokeIndex: index + 1,
    teeSet: "member" as const,
    pinRotation: "A" as const,
  }));
  return {
    courseId: "challenge-course",
    courseName: "Challenge Course",
    geometryVersion: "zk726-fixture-v1",
    theme: "parkland",
    width,
    height,
    yardsPerTile: 10,
    tiles: Array<string>(width * height).fill(terrain),
    elevations: Array<number>(width * height).fill(0),
    obstacles: [],
    holes,
    rating: { courseRating: 27, slope: 113 },
    weather: {
      kind: "clear",
      temperatureF: 72,
      windMph: 0,
      rainInches: 0,
      carryMultiplier: 1,
      dispersionMultiplier: 1,
      paceMultiplier: 1,
    },
  };
}

function equipmentItem(id: string, ownerId: string): InventoryItem {
  return {
    id,
    definitionId: `definition:${id}`,
    name: "Tour Wedge",
    category: "club",
    ownerId,
    custodianId: ownerId,
    authoredValue: 500,
    remainingValue: 500,
    prestige: 2,
    unique: false,
    confirmationRequired: false,
    transferable: true,
    transferHistory: [],
    modifiers: [{ channel: "dispersion", multiplier: .94, context: "wedge" }],
  };
}

function participants(playerIndex = 1): ChallengeGroupParticipantInput[] {
  return ["alex", "blair", "casey", "devon"].map((id, index) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    controller: index === playerIndex ? "player" as const : "ai" as const,
    teamId: index % 2 === 0 ? "team-a" : "team-b",
    handedness: index === 2 ? "left" as const : "right" as const,
    skills: { ...skills, power: skills.power - index * 2 },
    handicapIndex: 5.2 + index * 2,
    equipment: {
      loadout: { clubItemIds: [`club-${id}`] },
      items: [equipmentItem(`club-${id}`, id)],
    },
  }));
}

const sideBets: ChallengeSideBetState[] = [{
  id: "skins-1",
  kind: "skins",
  stake: 5,
  carry: 10,
  status: "active",
  settlements: [{ status: "carried", amount: 0, carry: 10 }],
  evidence: [{ holeId: "hole-1", playerId: "alex", measurement: 4.5, eligible: true }],
}];

function start(over: Partial<Parameters<typeof startChallengeGroupRound>[0]> = {}): ChallengeGroupRound {
  return startChallengeGroupRound({
    id: "group-round-726",
    course: course(),
    teeSet: "member",
    pinRotation: "A",
    participants: participants(),
    scoringMode: "net-match",
    sideBets,
    rngSeed: 726_001,
    startedWeek: 8,
    startedDay: 2,
    ...over,
  });
}

function selection(round: ChallengeGroupRound) {
  return {
    club: "Pitching Wedge",
    aim: { ...round.course.holes[round.currentHoleIndex].pin },
    power: .63,
    technique: "normal" as const,
  };
}

describe("ZK-726 ChallengeGroupRound", () => {
  it("keeps an unavailable well-shaped player shot inert", () => {
    const round = start();
    const unavailable = {
      club: "Putter",
      aim: { ...round.course.holes[round.currentHoleIndex].pin },
      power: .5,
      technique: "normal" as const,
    };
    expect(previewChallengeGroupPlayerShot(round, round.playerGolferId, unavailable)).toMatchObject({
      available: false,
      blocker: "lie:tee",
    });
    expect(commitChallengeGroupPlayerShot(round, round.playerGolferId, unavailable)).toBe(round);
    expect(replayChallengeGroupPlayerShots(round, round.playerGolferId, [unavailable])).toBeNull();
  });

  it("batch-replays player shots byte-identically across lengths and withdrawal boundaries", () => {
    for (const count of [1, 3, 8]) {
      const initial = start();
      const selections = [];
      let expected = initial;
      for (let index = 0; index < count; index += 1) {
        const nextSelection = selection(expected);
        selections.push(nextSelection);
        expected = commitChallengeGroupPlayerShot(expected, expected.playerGolferId, nextSelection);
      }
      const replayed = replayChallengeGroupPlayerShots(initial, initial.playerGolferId, selections);
      expect(replayed).not.toBeNull();
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(expected));
      expect(Object.isFrozen(replayed)).toBe(true);
    }

    const initial = start();
    const beforeWithdrawal = [];
    let expected = initial;
    for (let index = 0; index < 2; index += 1) {
      const nextSelection = selection(expected);
      beforeWithdrawal.push(nextSelection);
      expected = commitChallengeGroupPlayerShot(expected, expected.playerGolferId, nextSelection);
    }
    expected = withdrawChallengeGroupGolfer(expected, "devon", "Injury.");
    const afterWithdrawal = [];
    for (let index = 0; index < 2; index += 1) {
      const nextSelection = selection(expected);
      afterWithdrawal.push(nextSelection);
      expected = commitChallengeGroupPlayerShot(expected, expected.playerGolferId, nextSelection);
    }
    const firstBatch = replayChallengeGroupPlayerShots(initial, initial.playerGolferId, beforeWithdrawal)!;
    const withdrawn = withdrawChallengeGroupGolfer(firstBatch, "devon", "Injury.");
    const replayed = replayChallengeGroupPlayerShots(withdrawn, withdrawn.playerGolferId, afterWithdrawal);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(expected));
  });

  it.each([2, 3, 4])("starts and exposes a supported %i-golfer group", (count) => {
    const round = start({ participants: participants().slice(0, count) });
    expect(round.golfers).toHaveLength(count);
    expect(round.golfers.map((golfer) => golfer.id)).toEqual(participants().slice(0, count).map((participant) => participant.id));
    expect(round.activeGolferId).toBe("blair");
  });

  it("requires a deterministic 2–4 golfer group with exactly one player controller", () => {
    expect(() => start({ participants: participants().slice(0, 1) })).toThrow("2–4");
    expect(() => start({ participants: participants().map((participant) => ({ ...participant, controller: "ai" })) })).toThrow("exactly one");
    expect(() => start({ participants: participants().slice(0, 2).map((participant) => ({ ...participant, controller: "player" })) })).toThrow("exactly one");
    expect(() => start({ participants: [...participants().slice(0, 3), { ...participants()[2] }] })).toThrow("unique");
    expect(() => start({ course: { ...course(), holes: course().holes.slice(0, 8) } })).toThrow("9- or 18-hole");
  });

  it("freezes the shared course, individual handicap/equipment/loadout, and auto-runs AI to the player turn", () => {
    const mutableCourse = course();
    const mutableParticipants = participants();
    const round = start({ course: mutableCourse, participants: mutableParticipants });

    expect(round.activeGolferId).toBe("blair");
    expect(round.playerGolferId).toBe("blair");
    expect(round.turnEvidence.map((turn) => turn.golferId)).toEqual(["alex"]);
    expect(round.golfers).toHaveLength(4);
    expect(round.golfers.every((golfer) => golfer.scorecard.length === 9)).toBe(true);
    expect(round.golfers.map((golfer) => golfer.handicap.playingHandicap)).toEqual([5, 7, 9, 11]);
    expect(round.golfers[0].equipment).toMatchObject({
      loadout: { clubItemIds: ["club-alex"] },
      items: [expect.objectContaining({ id: "club-alex" })],
      modifiers: [{ channel: "dispersion", multiplier: .94, context: "wedge" }],
    });
    expect(Object.isFrozen(round.course)).toBe(true);
    expect(Object.isFrozen(round.golfers[0].equipment.items[0])).toBe(true);

    mutableCourse.tiles.fill("water");
    mutableParticipants[0].equipment!.loadout = { clubItemIds: [] };
    mutableParticipants[0].equipment!.items[0].remainingValue = 0;
    expect(round.course.tiles[0]).toBe("green");
    expect(round.golfers[0].equipment.loadout.clubItemIds).toEqual(["club-alex"]);
    expect(round.golfers[0].equipment.items[0].remainingValue).toBe(500);
  });

  it("accepts input only for the active player golfer and deterministically runs every following AI turn", () => {
    const initial = start();
    expect(previewChallengeGroupPlayerShot(initial, "alex", selection(initial))).toBeNull();
    expect(previewChallengeGroupPlayerShot(initial, "blair", selection(initial))).toMatchObject({ available: true, sharedOutcome: expect.any(Object) });
    expect(() => commitChallengeGroupPlayerShot(initial, "alex", selection(initial))).toThrow("Only the player-controlled");

    const next = commitChallengeGroupPlayerShot(initial, "blair", selection(initial));
    const replay = commitChallengeGroupPlayerShot(start(), "blair", selection(initial));
    expect(next).toEqual(replay);
    expect(next.activeGolferId).toBe("blair");
    expect(next.currentHoleIndex).toBe(1);
    expect(next.turnEvidence.slice(0, 4).map((turn) => turn.golferId)).toEqual(["alex", "blair", "casey", "devon"]);
    expect(next.golfers.flatMap((golfer) => golfer.shots).every((shot) => shot.sharedOutcome && shot.ruling)).toBe(true);
    expect(new Set(next.golfers.flatMap((golfer) => golfer.shots.map((shot) => shot.id))).size)
      .toBe(next.golfers.flatMap((golfer) => golfer.shots).length);
  });

  it("retains shared penalty/ruling/relief evidence on the individual player's ball", () => {
    const penaltyCourse = course();
    penaltyCourse.tiles = penaltyCourse.tiles.map((tile, index) => index % penaltyCourse.width >= 5 ? "water" : tile);
    const round = start({ course: penaltyCourse, participants: participants(0), rngSeed: 726_099 });
    const next = commitChallengeGroupPlayerShot(round, "alex", selection(round));
    const shot = next.golfers.find((golfer) => golfer.id === "alex")!.shots[0];
    expect(shot).toMatchObject({
      penaltyStrokes: 1,
      ruling: { status: "penalty", penaltyStrokes: 1 },
      relief: expect.any(Object),
      sharedOutcome: { ruling: { status: "penalty", penaltyStrokes: 1 } },
    });
    expect(next.golfers.find((golfer) => golfer.id === "alex")!.scorecard[0].penalties).toBe(1);
    expect(next.turnEvidence[0]).toMatchObject({ golferId: "alex", penaltyStrokes: 1, ruling: { status: "penalty" } });
  });

  it("preserves teams and side bets while recording concessions, withdrawals, honors, match state, and reactions", () => {
    let round = start({ participants: participants(0) });
    const preservedSideBet = JSON.stringify(round.sideBets);
    round = concedeChallengeGroupHole(round, "blair", 4, "Match putt conceded.");
    round = concedeChallengeGroupHole(round, "casey", 5);
    round = withdrawChallengeGroupGolfer(round, "devon", "Injury.");
    round = concedeChallengeGroupHole(round, "alex", 6);

    expect(round.currentHoleIndex).toBe(1);
    expect(round.honorsOrder[0]).toBe("blair");
    expect(round.activeGolferId).toBe("alex");
    expect(round.match.teams).toEqual([
      { id: "team-a", playerIds: ["alex", "casey"] },
      { id: "team-b", playerIds: ["blair", "devon"] },
    ]);
    expect(round.match.concessions).toHaveLength(3);
    expect(round.match.withdrawals).toEqual([{ golferId: "devon", holeId: "hole-1", reason: "Injury." }]);
    expect(round.match.holeResults[0]).toMatchObject({ holeId: "hole-1", status: "withdrawn" });
    expect(round.golfers.find((golfer) => golfer.id === "devon")!.scorecard.slice(0, 3).map((score) => score.status)).toEqual(["withdrawn", "withdrawn", "withdrawn"]);
    expect(round.reactions).toHaveLength(4);
    expect(round.reactions.find((entry) => entry.golferId === "blair")?.reaction.thought).toContain("conceded");
    expect(JSON.stringify(round.sideBets)).toBe(preservedSideBet);
  });

  it("round-trips the exact active turn, shots, rulings, loadouts, and caller-owned side-bet evidence", () => {
    const played = commitChallengeGroupPlayerShot(start(), "blair", selection(start()));
    const encoded = encodeChallengeGroupRound(played);
    const decoded = decodeChallengeGroupRound(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(JSON.stringify(decoded.round)).toBe(encoded);
    expect(Object.isFrozen(decoded.round)).toBe(true);
    expect(decoded.round.turnEvidence).toEqual(played.turnEvidence);
    expect(decoded.round.golfers.map((golfer) => golfer.shots)).toEqual(played.golfers.map((golfer) => golfer.shots));
    expect(decoded.round.sideBets).toEqual(sideBets);

    const continued = commitChallengeGroupPlayerShot(decoded.round, "blair", selection(decoded.round));
    const direct = commitChallengeGroupPlayerShot(played, "blair", selection(played));
    expect(continued).toEqual(direct);

    const corrupt = JSON.parse(encoded) as ChallengeGroupRound;
    (corrupt.turnEvidence[0] as { shotId: string }).shotId = "missing";
    expect(decodeChallengeGroupRound(corrupt)).toEqual({ ok: false, error: "ChallengeGroupRound turn evidence references a missing shot." });
    expect(decodeChallengeGroupRound("not json")).toEqual({ ok: false, error: "ChallengeGroupRound save is not valid JSON." });
  });

  it("normalizes a valid persisted career carrier exactly and drops malformed group authority fail-closed", () => {
    const group = commitChallengeGroupPlayerShot(start(), "blair", selection(start()));
    const career = createDefaultPlayerPro({ seed: 726_001, name: "Blair" });
    const normalized = normalizePlayerPro({ ...career, activeChallengeGroupRound: group }, { seed: 726_001 });
    expect(normalized.activeChallengeGroupRound).toEqual(group);
    expect(normalized.activeRound).toBeNull();

    const corrupt = JSON.parse(JSON.stringify(group)) as ChallengeGroupRound;
    (corrupt as { activeGolferId: string }).activeGolferId = "missing-golfer";
    const rejected = normalizePlayerPro({ ...career, activeChallengeGroupRound: corrupt }, { seed: 726_001 });
    expect(rejected.activeChallengeGroupRound).toBeNull();
    expect(rejected.identity).toEqual(career.identity);
  });

  it("exposes every visible ball/card/handicap/loadout plus turn, ruling, match, and side-bet evidence to render_game_to_text", () => {
    const round = start();
    const state = challengeGroupRoundTextState(round);
    expect(state).toMatchObject({
      id: "group-round-726",
      phase: "awaiting_player",
      activeGolferId: "blair",
      playerGolferId: "blair",
      controls: "player-shot",
      golfers: expect.arrayContaining([
        expect.objectContaining({ id: "alex", controller: "ai", ball: expect.any(Object), currentScore: expect.any(Object), handicap: expect.any(Object), equipment: expect.any(Object), latestShot: expect.any(Object) }),
        expect.objectContaining({ id: "blair", controller: "player", ball: expect.any(Object), currentScore: expect.any(Object) }),
      ]),
      recentTurn: expect.objectContaining({ golferId: "alex", ruling: expect.any(Object) }),
      match: { status: "active" },
      sideBets,
    });
    expect(JSON.parse(renderChallengeGroupRoundToText(round))).toEqual(state);
  });

  it("completes all nine holes with deterministic player decisions and individual histories", () => {
    let round = start();
    let guard = 0;
    while (round.phase !== "complete" && guard++ < 30) {
      expect(round.activeGolferId).toBe(round.playerGolferId);
      round = commitChallengeGroupPlayerShot(round, round.playerGolferId, selection(round));
    }
    expect(round.phase).toBe("complete");
    expect(round.match.status).toBe("complete");
    expect(round.match.completedHoleIds).toHaveLength(9);
    expect(round.match.holeResults).toHaveLength(9);
    expect(round.reactions).toHaveLength(36);
    expect(round.golfers.every((golfer) => golfer.scorecard.every((score) => score.status === "played"))).toBe(true);
    expect(round.golfers.every((golfer) => golfer.shots.length === 9)).toBe(true);
    expect(round.activeGolferId).toBeNull();
    expect(() => encodeChallengeGroupRound(round)).not.toThrow();
  });
});

describe("ZK-728 2v2 team round authority", () => {
  it.each([
    ["four-ball", "net-match", "90%-per-player"],
    ["four-ball", "net-stroke", "85%-per-player"],
    ["alternate-shot", "net-match", "50%-combined"],
    ["scramble", "net-stroke", "35%-low+15%-high"],
  ] as const)("freezes %s %s teams, handicaps, equipment and loadouts", (teamFormat, scoringMode, formula) => {
    const round = start({ teamFormat, scoringMode, participants: participants(0) });
    expect(round.teamAuthority).toMatchObject({
      version: 1,
      format: teamFormat,
      scoring: scoringMode === "net-match" ? "match" : "stroke",
      teams: [
        { id: "team-a", playerIds: ["alex", "casey"] },
        { id: "team-b", playerIds: ["blair", "devon"] },
      ],
      handicaps: [expect.objectContaining({ formula }), expect.objectContaining({ formula })],
    });
    expect(Object.isFrozen(round.teamAuthority)).toBe(true);
    expect(Object.isFrozen(round.teamAuthority!.handicaps[0].members)).toBe(true);
    expect(Object.isFrozen(round.golfers[0].equipment)).toBe(true);
  });

  it("keeps all four individual gross cards while four-ball selects the best team net ball", () => {
    let round = start({ teamFormat: "four-ball", scoringMode: "net-stroke", participants: participants(0) });
    round = concedeChallengeGroupHole(round, "blair", 4);
    round = concedeChallengeGroupHole(round, "casey", 5);
    round = concedeChallengeGroupHole(round, "devon", 6);
    round = concedeChallengeGroupHole(round, "alex", 7);
    expect(round.match.holeResults[0].teamWinnerIds).toEqual(["team-b"]);
    expect(round.golfers.map((golfer) => golfer.scorecard[0].gross)).toEqual([7, 4, 5, 6]);
    expect(round.golfers.every((golfer) => golfer.scorecard[0].gross != null)).toBe(true);
    const grossEvidence = challengeGroupIndividualGrossEvidence(round);
    expect(grossEvidence.map((entry) => ({ playerId: entry.playerId, first: entry.holeScores[0] }))).toEqual([
      { playerId: "alex", first: { holeId: "hole-1", gross: 7, par: 3 } },
      { playerId: "blair", first: { holeId: "hole-1", gross: 4, par: 3 } },
      { playerId: "casey", first: { holeId: "hole-1", gross: 5, par: 3 } },
      { playerId: "devon", first: { holeId: "hole-1", gross: 6, par: 3 } },
    ]);
    expect(grossEvidence.flatMap((entry) => entry.holeScores).every((score) => Number.isInteger(score.gross))).toBe(true);
  });

  it("alternates shared-ball partners after every shot and alternates the tee player by hole", () => {
    const longCourse = course();
    longCourse.tiles.fill("fairway");
    longCourse.holes = longCourse.holes.map((hole) => ({ ...hole, pin: { x: 16, y: 3 } }));
    let round = start({ course: longCourse, teamFormat: "alternate-shot", scoringMode: "net-stroke", participants: participants(0), rngSeed: 728_101 });
    const soft = { ...selection(round), power: .1 };
    round = commitChallengeGroupPlayerShot(round, "alex", soft);
    const teamAShots = round.turnEvidence.filter((turn) => ["alex", "casey"].includes(turn.golferId));
    expect(teamAShots.slice(0, 2).map((turn) => turn.golferId)).toEqual(["alex", "casey"]);
    expect(teamAShots[1].holeId).toBe(teamAShots[0].holeId);
    expect(round.teamAuthority!.balls.find((ball) => ball.teamId === "team-a")!.scorecard[0].countedPlayerIds.slice(0, 2)).toEqual(["alex", "casey"]);

    let guard = 0;
    while (round.currentHoleIndex === 0 && round.phase !== "complete" && guard++ < 20) {
      expect(round.activeGolferId).toBe("alex");
      round = commitChallengeGroupPlayerShot(round, "alex", selection(round));
    }
    expect(round.currentHoleIndex).toBe(1);
    expect(round.turnEvidence.find((turn) => turn.holeId === "hole-2" && ["alex", "casey"].includes(turn.golferId))?.golferId).toBe("casey");
  });

  it("pauses for an explicit human scramble choice and records deterministic AI choices", () => {
    let round = start({ teamFormat: "scramble", scoringMode: "net-stroke", participants: participants(0), rngSeed: 728_202 });
    round = commitChallengeGroupPlayerShot(round, "alex", { ...selection(round), power: .2 });
    expect(round.phase).toBe("awaiting_ball_choice");
    expect(round.activeGolferId).toBe("alex");
    const playerBall = round.teamAuthority!.balls.find((ball) => ball.teamId === "team-a")!;
    expect(playerBall.candidates.map((candidate) => candidate.playerId).sort()).toEqual(["alex", "casey"]);
    expect(() => chooseChallengeGroupScrambleBall(round, "blair")).toThrow("not one of");

    const chosen = playerBall.candidates[0].playerId;
    const continued = chooseChallengeGroupScrambleBall(round, chosen);
    expect(continued.teamAuthority!.choices.find((choice) => choice.teamId === "team-a")).toMatchObject({
      selectedPlayerId: chosen,
      controller: "player",
      reason: "explicit player selection",
    });
    expect(continued.teamAuthority!.choices.some((choice) => choice.teamId === "team-b" && choice.controller === "ai")).toBe(true);
    expect(continued.teamAuthority!.balls.find((ball) => ball.teamId === "team-a")!.candidates).toEqual([]);
  });

  it("round-trips active ball candidates, partner order, handicap snapshots, choices, and text evidence exactly", () => {
    let round = start({ teamFormat: "scramble", scoringMode: "net-match", participants: participants(0), rngSeed: 728_303 });
    round = commitChallengeGroupPlayerShot(round, "alex", { ...selection(round), power: .2 });
    expect(round.phase).toBe("awaiting_ball_choice");
    const encoded = encodeChallengeGroupRound(round);
    const decoded = decodeChallengeGroupRound(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(JSON.stringify(decoded.round)).toBe(encoded);
    expect(challengeGroupRoundTextState(decoded.round)).toMatchObject({
      controls: "choose-scramble-ball",
      teamAuthority: {
        format: "scramble",
        handicaps: expect.any(Array),
        balls: expect.arrayContaining([expect.objectContaining({ candidates: expect.any(Array) })]),
        choices: expect.any(Array),
      },
    });
    const choice = decoded.round.teamAuthority!.balls.find((ball) => ball.teamId === "team-a")!.candidates[1].playerId;
    expect(chooseChallengeGroupScrambleBall(decoded.round, choice)).toEqual(chooseChallengeGroupScrambleBall(round, choice));

    const corrupt = JSON.parse(encoded) as ChallengeGroupRound;
    (corrupt.teamAuthority!.handicaps[0] as { playingHandicap: number }).playingHandicap += 1;
    expect(decodeChallengeGroupRound(corrupt)).toEqual({ ok: false, error: "ChallengeGroupRound frozen team handicaps drifted." });
  });

  it("rejects malformed 2v2 membership without weakening ordinary 2–4 golfer groups", () => {
    expect(() => start({ teamFormat: "scramble", participants: participants(0).slice(0, 3) })).toThrow("two stable teams of two");
    expect(() => start({ teamFormat: "alternate-shot", participants: participants(0).map((participant) => ({ ...participant, teamId: "one-team" })) })).toThrow("two stable teams of two");
    expect(start({ participants: participants(0).slice(0, 3) }).teamAuthority).toBeUndefined();
  });
});

describe("ZK-727 policy-neutral individual authority", () => {
  it("freezes individual gross/net/match/stroke/Stableford inputs without accepting team or settlement policy", () => {
    const field = participants(0).slice(0, 2).map((participant, index) => index === 0 ? { ...participant, handicapIndex: -1.2 } : participant);
    const round = start({
      participants: field,
      individualFormat: "net-stableford",
      individualContests: [{ id: "skins", kind: "skins" }, { id: "ctp", kind: "closest-to-pin", holeIds: ["hole-1"] }],
    });
    expect(round.individualAuthority).toMatchObject({
      version: 1,
      format: "net-stableford",
      handicapSnapshots: [expect.objectContaining({ playerId: "alex", playingHandicap: -1, strokesByHole: expect.arrayContaining([-1]) }), expect.objectContaining({ playerId: "blair" })],
      contests: [{ id: "skins", kind: "skins" }, { id: "ctp", kind: "closest-to-pin" }],
      results: [],
      measurements: [],
    });
    expect(Object.isFrozen(round.individualAuthority)).toBe(true);
    expect(JSON.stringify(round.individualAuthority)).not.toContain("stake");
    expect(() => start({ participants: participants(0), teamFormat: "four-ball", individualFormat: "net-match" })).toThrow("cannot be combined");
  });

  it("settles ties and skins carries as result-only records and retains full rejected measurement evidence", () => {
    let round = start({
      participants: participants(1).slice(0, 2),
      individualFormat: "gross-match",
      individualContests: [{ id: "skins", kind: "skins" }, { id: "long", kind: "longest-drive", holeIds: ["hole-1"] }],
    });
    const alexShot = round.golfers.find((golfer) => golfer.id === "alex")!.shots[0];
    round = recordChallengeGroupMeasurement(round, {
      contestId: "long", participantId: "alex", holeId: "hole-1", shotId: alexShot.id, club: "Pitching Wedge",
      start: alexShot.from, end: alexShot.rest, lie: alexShot.lieBefore, measurement: 70,
    });
    expect(round.individualAuthority!.measurements[0]).toMatchObject({ eligible: true, shotId: alexShot.id, club: "Pitching Wedge", start: alexShot.from, end: alexShot.rest, lie: alexShot.lieBefore });
    round = recordChallengeGroupMeasurement(round, {
      contestId: "long", participantId: "blair", holeId: "hole-1", shotId: "not-a-shot", club: "Driver",
      start: { x: 2, y: 3 }, end: { x: 9, y: 3 }, lie: "tee", measurement: 71,
    });
    expect(round.individualAuthority!.measurements[1]).toMatchObject({ eligible: false, rejectionReason: expect.stringContaining("Shot does not belong") });
    const alexGross = round.golfers.find((golfer) => golfer.id === "alex")!.scorecard[0].gross!;
    round = concedeChallengeGroupHole(round, "blair", alexGross);
    expect(round.individualAuthority!.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ contestId: "skins", status: "carried", carryHoles: 1, winnerIds: [] }),
      expect.objectContaining({ contestId: "long", status: "won", winnerIds: ["alex"] }),
    ]));
    expect(challengeGroupRoundTextState(round).individualAuthority).toEqual(round.individualAuthority);
    expect(decodeChallengeGroupRound(encodeChallengeGroupRound(round))).toMatchObject({ ok: true });
  });

  it("requires the deterministic two-player 18-hole fixture for a Nassau with no presses", () => {
    const eighteen = course();
    eighteen.holes = [...eighteen.holes, ...eighteen.holes].map((hole, index) => ({ ...hole, id: `nassau-${index + 1}`, name: `Hole ${index + 1}`, strokeIndex: index + 1 }));
    expect(() => start({ participants: participants(1).slice(0, 2), individualFormat: "net-match", individualContests: [{ id: "nassau", kind: "nassau" }] })).toThrow("18-hole");
    const round = start({ course: eighteen, participants: participants(1).slice(0, 2), individualFormat: "net-match", individualContests: [{ id: "nassau", kind: "nassau" }] });
    expect(round.individualAuthority!.contests[0]).toEqual({ id: "nassau", kind: "nassau" });
    expect(round.individualAuthority!.results).toEqual([]);
  });

  it("scores Nassau front/back/overall by holes won, not aggregate stroke totals", () => {
    const eighteen = course();
    eighteen.holes = [...eighteen.holes, ...eighteen.holes].map((hole, index) => ({ ...hole, id: `match-${index + 1}`, name: `Hole ${index + 1}`, strokeIndex: index + 1 }));
    const round = start({ course: eighteen, participants: participants(0).slice(0, 2), individualFormat: "gross-match", individualContests: [{ id: "nassau", kind: "nassau" }] });
    const matchFirst = round.golfers.map((golfer, golferIndex) => ({
      ...golfer,
      scorecard: golfer.scorecard.map((card, holeIndex) => {
        // Alex wins five front-nine holes but loses four by enough strokes to have the worse total.
        const gross = holeIndex < 5 ? (golferIndex === 0 ? 3 : 4) : (golferIndex === 0 ? 9 : 4);
        return { ...card, strokes: gross, penalties: 0, gross, net: gross, status: "played" as const };
      }),
    }));
    expect(scoreChallengeNassauSegment(matchFirst, "gross-match", 0, 8)).toEqual({ status: "won", winnerIds: ["alex"] });
    const halved = matchFirst.map((golfer, golferIndex) => ({
      ...golfer,
      scorecard: golfer.scorecard.map((card, holeIndex) => {
        const gross = holeIndex === 8 ? 4 : holeIndex < 4 ? (golferIndex === 0 ? 3 : 4) : (golferIndex === 1 ? 3 : 4);
        return { ...card, strokes: gross, penalties: 0, gross, net: gross, status: "played" as const };
      }),
    }));
    expect(scoreChallengeNassauSegment(halved, "gross-match", 0, 8)).toMatchObject({ status: "tied", winnerIds: ["alex", "blair"] });
    expect(scoreChallengeNassauSegment([{ ...matchFirst[0], withdrawn: true }, matchFirst[1]], "gross-match", 0, 8)).toMatchObject({ status: "withdrawn", winnerIds: [] });
  });
});

describe("ZK-758 participant-specific frozen course setups", () => {
  function setupCourse(
    base: PlayerRoundCourseSnapshot,
    teeSet: "forward" | "member" | "championship",
    pinRotation: "A" | "B" | "C",
    options: { teeX: number; pinX: number; slope: number; ratingOffset?: number; parDelta?: number },
  ): PlayerRoundCourseSnapshot {
    const holes = base.holes.map((hole, index) => ({
      ...hole,
      par: hole.par + (index === 0 ? options.parDelta ?? 0 : 0),
      tee: { x: options.teeX, y: hole.tee.y },
      pin: { x: options.pinX, y: hole.pin.y },
      teeSet,
      pinRotation,
    }));
    const par = holes.reduce((sum, hole) => sum + hole.par, 0);
    return {
      ...base,
      courseName: `${teeSet} frozen route`,
      holes,
      rating: { courseRating: par + (options.ratingOffset ?? 0), slope: options.slope },
    };
  }

  function mixedParticipants(base: PlayerRoundCourseSnapshot, playerIndex = 0) {
    const championship = setupCourse(base, "championship", "C", { teeX: 1, pinX: 10, slope: 113 });
    const forward = setupCourse(base, "forward", "B", { teeX: 4, pinX: 8, slope: 113, parDelta: 1 });
    const field = participants(playerIndex).slice(0, 2).map((participant, index) => ({
      ...participant,
      handicapIndex: index === 0 ? -2 : 10,
      setup: index === 0
        ? { course: championship, teeSet: "championship" as const, pinRotation: "C" as const }
        : { course: forward, teeSet: "forward" as const, pinRotation: "B" as const },
    }));
    return { championship, forward, field };
  }

  it("freezes each participant's tee, pins, routing, par, indexes, rating, slope, and allowance", () => {
    const shared = course();
    const { championship, forward, field } = mixedParticipants(shared);
    const round = start({ course: shared, participants: field, individualFormat: "net-stroke" });
    const [alex, blair] = round.golfers;

    expect(alex.setup).toMatchObject({ teeSet: "championship", pinRotation: "C", rating: { courseRating: 27, slope: 113 } });
    expect(blair.setup).toMatchObject({ teeSet: "forward", pinRotation: "B", rating: { courseRating: 28, slope: 113 } });
    expect(alex.scorecard[0]).toMatchObject({ par: 3, strokeIndex: 1, handicapStrokes: -1 });
    expect(blair.scorecard[0]).toMatchObject({ par: 4, strokeIndex: 1, handicapStrokes: 2 });
    expect(alex.handicap).toMatchObject({ courseHandicap: -2, allowance: 1, playingHandicap: -2 });
    expect(blair.handicap).toMatchObject({ courseHandicap: 10, allowance: 1, playingHandicap: 10 });
    expect(alex.handicap.strokesByHole.reduce((sum, value) => sum + value, 0)).toBe(-2);
    expect(blair.handicap.strokesByHole.reduce((sum, value) => sum + value, 0)).toBe(10);
    expect(Object.isFrozen(alex.setup.holes[0].tee)).toBe(true);

    championship.holes[0].tee.x = 17;
    championship.holes[0].pin.x = 17;
    championship.holes[0].par = 5;
    championship.rating!.courseRating = 80;
    forward.holes.reverse();
    shared.holes[0].strokeIndex = 9;
    expect(alex.setup.holes[0]).toMatchObject({ id: "hole-1", par: 3, tee: { x: 1 }, pin: { x: 10 }, strokeIndex: 1 });
    expect(alex.setup.rating).toEqual({ courseRating: 27, slope: 113 });
    expect(blair.setup.holes.map((hole) => hole.id)).toEqual(Array.from({ length: 9 }, (_, index) => `hole-${index + 1}`));

    const text = challengeGroupRoundTextState(round);
    expect(text.golfers.map((golfer) => golfer.setup)).toEqual([
      expect.objectContaining({ teeSet: "championship", pinRotation: "C", rating: { courseRating: 27, slope: 113 } }),
      expect.objectContaining({ teeSet: "forward", pinRotation: "B", rating: { courseRating: 28, slope: 113 } }),
    ]);
    expect(text.golfers.map((golfer) => golfer.handicap.allowance)).toEqual([1, 1]);
  });

  it.each([9, 18])("allocates mixed-sign net-match strokes off low on a %i-hole routed card", (holeCount) => {
    const nine = course();
    const shared = holeCount === 9 ? nine : {
      ...nine,
      holes: [...nine.holes, ...nine.holes].map((hole, index) => ({ ...hole, id: `mixed-${index + 1}`, name: `Hole ${index + 1}`, strokeIndex: index + 1 })),
    };
    const { field } = mixedParticipants(shared);
    const round = start({ course: shared, participants: field, individualFormat: "net-match" });
    expect(round.golfers.map((golfer) => golfer.handicap.playingHandicap)).toEqual([0, 12]);
    expect(round.golfers.map((golfer) => golfer.handicap.strokesByHole.length)).toEqual([holeCount, holeCount]);
    expect(round.golfers.map((golfer) => golfer.handicap.strokesByHole.reduce((sum, value) => sum + value, 0))).toEqual([0, 12]);
    expect(round.individualAuthority!.handicapSnapshots).toEqual(round.golfers.map((golfer) => ({
      playerId: golfer.id,
      playingHandicap: golfer.handicap.playingHandicap,
      strokesByHole: golfer.handicap.strokesByHole,
    })));
  });

  it("applies each frozen allowance to the unrounded tee-specific Course Handicap exactly once", () => {
    const shared = course();
    const { field } = mixedParticipants(shared);
    const withAllowances = field.map((participant, index) => ({ ...participant, handicapAllowance: index === 0 ? .5 : .85 }));
    const round = start({ course: shared, participants: withAllowances, individualFormat: "net-stroke" });
    expect(round.golfers.map((golfer) => ({
      course: golfer.handicap.courseHandicap,
      allowance: golfer.handicap.allowance,
      playing: golfer.handicap.playingHandicap,
    }))).toEqual([
      { course: -2, allowance: .5, playing: -1 },
      { course: 10, allowance: .85, playing: 9 },
    ]);
    expect(challengeGroupRoundTextState(round).golfers.map((golfer) => golfer.handicap.allowance)).toEqual([.5, .85]);
  });

  it.each(["gross-stroke", "net-stroke", "gross-match", "net-match", "net-stableford"] as const)("drives %s and skins from participant-local cards", (format) => {
    const shared = course();
    const { field } = mixedParticipants(shared);
    let round = start({ course: shared, participants: field, individualFormat: format, individualContests: [{ id: `skins-${format}`, kind: "skins" }] });
    round = concedeChallengeGroupHole(round, "alex", 4);
    expect(round.currentHoleIndex).toBe(1);
    const cards = round.golfers.map((golfer) => golfer.scorecard[0]);
    const values = cards.map((card) => format.startsWith("gross") ? card.gross!
      : format === "net-stableford" ? 2 - (card.gross! - card.handicapStrokes - card.par)
        : card.net!);
    const target = format === "net-stableford" ? Math.max(...values) : Math.min(...values);
    const expected = round.golfers.filter((_golfer, index) => values[index] === target).map((golfer) => golfer.id);
    expect(round.individualAuthority!.results[0]).toMatchObject({
      contestId: `skins-${format}`,
      status: expected.length === 1 ? "won" : "carried",
      winnerIds: expected.length === 1 ? expected : [],
    });
  });

  it("uses each frozen tee and pin for shots and migrates a v1 shared-setup save deterministically", () => {
    const shared = course();
    const { field } = mixedParticipants(shared, 1);
    const mixed = start({ course: shared, participants: field, individualFormat: "net-stroke" });
    const alex = mixed.golfers[0];
    expect(alex.shots[0].from).toEqual(alex.setup.holes[0].tee);
    expect(previewChallengeGroupPlayerShot(mixed, "blair", {
      ...selection(mixed),
      aim: mixed.golfers[1].setup.holes[0].pin,
    })).toMatchObject({ available: true });

    const current = start({ participants: participants(0).slice(0, 2), individualFormat: "net-stroke" });
    const legacy = JSON.parse(encodeChallengeGroupRound(current)) as unknown as Record<string, unknown> & { golfers: Array<Record<string, unknown>> };
    legacy.version = 1;
    for (const golfer of legacy.golfers) {
      delete golfer.setup;
      const handicap = golfer.handicap as Record<string, unknown>;
      delete handicap.allowance;
    }
    const migrated = decodeChallengeGroupRound(legacy);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.round).toEqual(current);
    expect(migrated.round.golfers.map((golfer) => golfer.handicap.allowance)).toEqual([1, 1]);
    const migratedEncoded = encodeChallengeGroupRound(migrated.round);
    const reloaded = decodeChallengeGroupRound(migratedEncoded);
    expect(reloaded.ok && encodeChallengeGroupRound(reloaded.round)).toBe(migratedEncoded);

    const explicitLegacy = JSON.parse(JSON.stringify(legacy)) as typeof legacy;
    const explicitHandicap = explicitLegacy.golfers[0].handicap as Record<string, unknown>;
    const explicitStrokes = strokesByHole(4, current.golfers[0].scorecard.map((score) => ({ id: score.holeId, par: score.par, strokeIndex: score.strokeIndex })));
    explicitHandicap.playingHandicap = 4;
    explicitHandicap.strokesByHole = explicitStrokes;
    const explicitCards = explicitLegacy.golfers[0].scorecard as Array<Record<string, unknown>>;
    explicitCards.forEach((score, index) => { score.handicapStrokes = explicitStrokes[index]; });
    const explicitAuthority = explicitLegacy.individualAuthority as { handicapSnapshots: Array<Record<string, unknown>> };
    explicitAuthority.handicapSnapshots[0].playingHandicap = 4;
    explicitAuthority.handicapSnapshots[0].strokesByHole = explicitStrokes;
    const migratedExplicit = decodeChallengeGroupRound(explicitLegacy);
    expect(migratedExplicit.ok).toBe(true);
    if (migratedExplicit.ok) expect(migratedExplicit.round.golfers[0].handicap.allowance).toBeCloseTo(4 / 5.2);

    const unratedLegacy = JSON.parse(encodeChallengeGroupRound(current)) as unknown as Record<string, unknown> & { course: Record<string, unknown>; golfers: Array<Record<string, unknown>> };
    unratedLegacy.version = 1;
    delete unratedLegacy.course.rating;
    for (const golfer of unratedLegacy.golfers) {
      delete golfer.setup;
      delete (golfer.handicap as Record<string, unknown>).allowance;
    }
    const migratedUnrated = decodeChallengeGroupRound(unratedLegacy);
    expect(migratedUnrated.ok).toBe(true);
    if (migratedUnrated.ok) expect(migratedUnrated.round.golfers.every((golfer) => golfer.setup.rating?.courseRating === 27 && golfer.setup.rating.slope === 113)).toBe(true);

    const corrupted = JSON.parse(encodeChallengeGroupRound(mixed)) as ChallengeGroupRound;
    (corrupted.golfers[0].setup.rating as { slope: number }).slope = 0;
    expect(decodeChallengeGroupRound(corrupted)).toEqual({ ok: false, error: "ChallengeGroupRound golfer evidence is invalid." });

    const missingRating = JSON.parse(encodeChallengeGroupRound(mixed)) as ChallengeGroupRound;
    delete (missingRating.golfers[0].setup as unknown as Record<string, unknown>).rating;
    expect(decodeChallengeGroupRound(missingRating)).toEqual({ ok: false, error: "ChallengeGroupRound golfer evidence is invalid." });

    const driftedAllowance = JSON.parse(encodeChallengeGroupRound(mixed)) as ChallengeGroupRound;
    driftedAllowance.golfers[0].handicap.allowance = .5;
    expect(decodeChallengeGroupRound(driftedAllowance)).toEqual({ ok: false, error: "ChallengeGroupRound golfer evidence is invalid." });
  });

  it("preserves mixed setups across interruption, concessions, withdrawals, duplicate calls, and a skins carry", () => {
    const shared = course();
    const { field } = mixedParticipants(shared, 1);
    const initial = start({ course: shared, participants: field, individualFormat: "gross-match", individualContests: [{ id: "skins", kind: "skins" }] });
    const interrupted = decodeChallengeGroupRound(encodeChallengeGroupRound(initial));
    expect(interrupted.ok).toBe(true);
    if (!interrupted.ok) return;
    expect(interrupted.round.golfers.map((golfer) => golfer.setup)).toEqual(initial.golfers.map((golfer) => golfer.setup));

    const alexGross = interrupted.round.golfers[0].scorecard[0].gross!;
    const alexComplete = concedeChallengeGroupHole(interrupted.round, "alex", alexGross);
    expect(concedeChallengeGroupHole(alexComplete, "alex", alexGross)).toBe(alexComplete);
    const holeComplete = concedeChallengeGroupHole(alexComplete, "blair", alexGross);
    expect(holeComplete.individualAuthority!.results).toContainEqual(expect.objectContaining({ contestId: "skins", status: "carried", carryHoles: 1 }));

    const withdrawn = withdrawChallengeGroupGolfer(initial, "alex", "Mixed-setup withdrawal.");
    expect(withdrawChallengeGroupGolfer(withdrawn, "alex")).toBe(withdrawn);
    expect(withdrawn.golfers[0]).toMatchObject({ withdrawn: true, setup: initial.golfers[0].setup });
  });

  it("retains mixed-setup evidence for both measured contests and Nassau segments", () => {
    const shared = course();
    const { field } = mixedParticipants(shared, 1);
    let measured = start({
      course: shared,
      participants: field,
      individualFormat: "gross-match",
      individualContests: [{ id: "ctp", kind: "closest-to-pin", holeIds: ["hole-1"] }, { id: "long", kind: "longest-drive", holeIds: ["hole-1"] }],
    });
    const alex = measured.golfers[0];
    const shot = alex.shots[0];
    expect(shot.from).toEqual(alex.setup.holes[0].tee);
    for (const [contestId, measurement] of [["ctp", 4], ["long", 240]] as const) {
      measured = recordChallengeGroupMeasurement(measured, {
        contestId, participantId: alex.id, holeId: shot.holeId, shotId: shot.id, club: shot.club,
        start: shot.from, end: shot.rest, lie: shot.lieBefore, measurement,
      });
    }
    expect(measured.individualAuthority!.measurements).toEqual([
      expect.objectContaining({ contestId: "ctp", participantId: "alex", eligible: true, start: alex.setup.holes[0].tee }),
      expect.objectContaining({ contestId: "long", participantId: "alex", eligible: true, start: alex.setup.holes[0].tee }),
    ]);

    const eighteen = course();
    eighteen.holes = [...eighteen.holes, ...eighteen.holes].map((hole, index) => ({ ...hole, id: `mixed-nassau-${index + 1}`, name: `Hole ${index + 1}`, strokeIndex: index + 1 }));
    const { field: nassauField } = mixedParticipants(eighteen);
    const nassau = start({ course: eighteen, participants: nassauField, individualFormat: "gross-match", individualContests: [{ id: "nassau", kind: "nassau" }] });
    const scored = nassau.golfers.map((golfer, golferIndex) => ({
      ...golfer,
      scorecard: golfer.scorecard.map((card, index) => {
        const gross = golferIndex === 0 ? (index < 9 ? 3 : 4) : (index < 9 ? 4 : 3);
        return { ...card, strokes: gross, gross, net: gross - card.handicapStrokes, status: "played" as const };
      }),
    }));
    expect(scoreChallengeNassauSegment(scored, "gross-match", 0, 8)).toMatchObject({ status: "won", winnerIds: ["alex"] });
    expect(scoreChallengeNassauSegment(scored, "gross-match", 9, 17)).toMatchObject({ status: "won", winnerIds: ["blair"] });
    expect(scoreChallengeNassauSegment(scored, "gross-match", 0, 17)).toMatchObject({ status: "tied", winnerIds: ["alex", "blair"] });
  });
});
