import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { concedeChallengeGroupHole } from "../competition/challengeGroupRound";
import { caddieRecommendation } from "../playerPro/playerPro";
import { startPlayableRound } from "../playerPro/playerProRoundStart";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";
import { simulateProAmFieldRound } from "./proAmField";
import {
  commitProAmVisiblePlayerShot,
  decodeProAmVisibleRound,
  encodeProAmVisibleRound,
  proAmVisiblePlayerRound,
  proAmVisiblePlayerSkills,
  settleProAmVisibleRound,
  startProAmVisibleRound,
  withdrawProAmVisibleGolfer,
  type ProAmVisibleRound,
} from "./proAmVisibleRound";
import { activateTournament } from "./tournamentLifecycle";
import { createTournamentEvent } from "./tournamentScheduling";

const liveCourse = createTournamentStandardsCourse();
const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 100, runSeed: 734_401 };

function fixture() {
  const created = createTournamentEvent({ course: liveCourse, world, tier: "regional", currentDay: 0, daysAhead: 1, templateId: "four-person-pro-am" });
  if (!created.ok) throw new Error(created.reason);
  const activated = activateTournament(created.event, liveCourse);
  if (!activated.ok) throw new Error(activated.reason);
  const snapshot = activated.event.activationSnapshot!;
  const started = startPlayableRound({
    course: liveCourse,
    world: { ...world, week: activated.event.scheduledWeek },
    kind: "tournament",
    tournament: { id: activated.event.id, name: activated.event.name, roundNumber: 1 },
    tournamentSnapshot: snapshot,
    day: activated.event.scheduledDay,
  });
  if (!started.ok) throw new Error(started.reason);
  return { snapshot, roundCourse: started.round.course, team: snapshot.teams[0] };
}

function started(seed = 734_411) {
  const { snapshot, roundCourse, team } = fixture();
  const result = startProAmVisibleRound({ snapshot, course: roundCourse, roundNumber: 1, teamId: team.id, playerEntrantId: team.entrantIds[0], seed });
  if (!result.ok) throw new Error(result.reason);
  return { snapshot, roundCourse, team, round: result.round, seed };
}

function play(round: ProAmVisibleRound): ProAmVisibleRound {
  let current = round;
  let guard = 0;
  while (current.challengeRound.phase !== "complete" && guard++ < 480) {
    const playerRound = proAmVisiblePlayerRound(current);
    if (!playerRound) throw new Error("Visible Pro-Am did not yield the player turn.");
    current = commitProAmVisiblePlayerShot(current, caddieRecommendation(playerRound, proAmVisiblePlayerSkills(current)));
  }
  if (current.challengeRound.phase !== "complete") throw new Error("Visible Pro-Am exceeded its player-turn bound.");
  return current;
}

describe("ZK-734B visible Pro-Am ChallengeGroup adapter", () => {
  it("starts the exact frozen one-pro/three-amateur roster and owns an immutable course clone", () => {
    const { snapshot, roundCourse, team } = fixture();
    const mutableCourse = structuredClone(roundCourse);
    const originalBytes = JSON.stringify(mutableCourse);
    const result = startProAmVisibleRound({ snapshot, course: mutableCourse, roundNumber: 1, teamId: team.id, playerEntrantId: team.entrantIds[0], seed: 734_412 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.challengeRound.golfers.map((golfer) => ({ id: golfer.id, controller: golfer.controller, allowance: golfer.handicap.allowance }))).toEqual(
      team.entrantIds.map((id, index) => ({ id, controller: index === 0 ? "player" : "ai", allowance: 0.85 })),
    );
    expect(result.round.challengeRound.playerGolferId).toBe(team.entrantIds[0]);
    expect(result.round.playerEntrantId).toBe(team.entrantIds[0]);
    expect(result.round.actions).toEqual([]);
    expect(result.round.challengeRound.honorsOrder).toEqual(team.entrantIds);
    expect(Object.isFrozen(result.round.challengeRound.course)).toBe(true);
    mutableCourse.tiles[0] = mutableCourse.tiles[0] === "water" ? "rough" : "water";
    mutableCourse.holes[0].tee.x += 100;
    expect(JSON.stringify(result.round.challengeRound.course)).toBe(originalBytes);
    expect(startProAmVisibleRound({ snapshot, course: roundCourse, roundNumber: 0, teamId: team.id, playerEntrantId: team.entrantIds[0], seed: 1 })).toMatchObject({ ok: false });
    expect(startProAmVisibleRound({ snapshot, course: roundCourse, roundNumber: 1, teamId: "unknown", playerEntrantId: team.entrantIds[0], seed: 1 })).toMatchObject({ ok: false });
    expect(startProAmVisibleRound({ snapshot, course: roundCourse, roundNumber: 1, teamId: team.id, playerEntrantId: "unknown", seed: 1 })).toMatchObject({ ok: false });
    expect(startProAmVisibleRound({ snapshot, course: roundCourse, roundNumber: 1, teamId: team.id, playerEntrantId: team.entrantIds[1], seed: 1 })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("unique frozen pro"),
    });
    expect(startProAmVisibleRound({ snapshot, course: roundCourse, roundNumber: 1, teamId: team.id, playerEntrantId: snapshot.teams[1].entrantIds[0], seed: 1 })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("unique frozen pro"),
    });
    for (const mutate of [
      (copy: typeof snapshot) => { copy.teams[0].entrantIds = [copy.teams[0].entrantIds[0], copy.teams[0].entrantIds[0], ...copy.teams[0].entrantIds.slice(2)]; },
      (copy: typeof snapshot) => { copy.entrants.find((entrant) => entrant.entrantId === copy.teams[0].entrantIds[1])!.teamRole = "pro"; },
      (copy: typeof snapshot) => { copy.teams[0].captainId = copy.teams[0].entrantIds[1]; },
    ]) {
      const hostile = structuredClone(snapshot);
      mutate(hostile);
      expect(startProAmVisibleRound({ snapshot: hostile, course: roundCourse, roundNumber: 1, teamId: hostile.teams[0].id, playerEntrantId: team.entrantIds[0], seed: 1 })).toMatchObject({ ok: false });
    }
  }, 60_000);

  it("preserves the exact current turn, honors, reactions, and shot evidence through hostile JSON normalization", () => {
    const { snapshot, roundCourse, round } = started();
    const playerRound = proAmVisiblePlayerRound(round)!;
    const recommendation = caddieRecommendation(playerRound, proAmVisiblePlayerSkills(round));
    expect(() => commitProAmVisiblePlayerShot(round, {
      ...recommendation,
      aim: { ...recommendation.aim, hostile: true },
    } as never)).toThrow("Visible Pro-Am shot input is malformed.");
    expect(round.actions).toEqual([]);
    const advanced = commitProAmVisiblePlayerShot(round, recommendation);
    expect(advanced.challengeRound.turnEvidence.length).toBeGreaterThan(0);
    expect(advanced.actions).toHaveLength(1);
    expect(advanced.actions[0].type).toBe("player-shot");
    const encoded = encodeProAmVisibleRound(advanced);
    const decoded = decodeProAmVisibleRound(encoded, snapshot, roundCourse);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(JSON.stringify(decoded.round)).toBe(encoded);
    expect(decoded.round.challengeRound.activeGolferId).toBe(advanced.challengeRound.activeGolferId);
    expect(decoded.round.challengeRound.currentHoleIndex).toBe(advanced.challengeRound.currentHoleIndex);
    expect(decoded.round.challengeRound.honorsOrder).toEqual(advanced.challengeRound.honorsOrder);
    expect(decoded.round.challengeRound.reactions).toEqual(advanced.challengeRound.reactions);
    expect(decoded.round.challengeRound.turnEvidence).toEqual(advanced.challengeRound.turnEvidence);

    const cases = [
      (copy: ProAmVisibleRound) => { Object.assign(copy, { hostile: true }); },
      (copy: ProAmVisibleRound) => { copy.activationId = "forged"; },
      (copy: ProAmVisibleRound) => { copy.playerEntrantId = copy.challengeRound.golfers[1].id; },
      (copy: ProAmVisibleRound) => { copy.challengeRound.golfers[0].controller = "ai"; },
      (copy: ProAmVisibleRound) => { copy.challengeRound.golfers[1].handicap.allowance = 1; },
      (copy: ProAmVisibleRound) => { copy.challengeRound.golfers[0].equipment.modifiers = [{ channel: "carry", multiplier: 1.2 }]; },
      (copy: ProAmVisibleRound) => { copy.challengeRound.golfers[0].confidenceSnapshot = { version: 1, current: 100, reason: "practice", trend: "rising", lastUpdatedAbsoluteDay: 0 }; },
      (copy: ProAmVisibleRound) => { (copy.actions[0] as { selection: { power: number } }).selection.power += 0.01; },
      (copy: ProAmVisibleRound) => { Object.assign(copy.actions[0], { hostile: true }); },
      (copy: ProAmVisibleRound) => {
        if (copy.actions[0].type !== "player-shot") throw new Error("Expected a player shot action.");
        Object.assign(copy.actions[0].selection.aim, { hostile: true });
        Object.assign(copy.challengeRound.turnEvidence[0].selection.aim, { hostile: true });
      },
      (copy: ProAmVisibleRound) => { copy.actions = Array.from({ length: 513 }, () => copy.actions[0]); },
      (copy: ProAmVisibleRound) => { copy.challengeRound.course.tiles[0] = copy.challengeRound.course.tiles[0] === "water" ? "rough" : "water"; },
    ];
    for (const mutate of cases) {
      const copy = JSON.parse(encoded) as ProAmVisibleRound;
      mutate(copy);
      expect(decodeProAmVisibleRound(copy, snapshot, roundCourse)).toMatchObject({ ok: false });
    }
    expect(() => decodeProAmVisibleRound("{", snapshot, roundCourse)).not.toThrow();
    expect(decodeProAmVisibleRound("{", snapshot, roundCourse)).toMatchObject({ ok: false });
  }, 60_000);

  it("completes through shared shots and is byte-identical to equivalent fixed-seed field evidence", () => {
    const { snapshot, roundCourse, round, seed } = started(734_413);
    const completed = play(round);
    expect(completed.challengeRound.phase).toBe("complete");
    expect(completed.challengeRound.turnEvidence.length).toBeGreaterThan(0);
    expect(completed.challengeRound.reactions).toHaveLength(4 * 18);
    expect(completed.challengeRound.honorsOrder).toHaveLength(4);
    const settlementStarted = performance.now();
    const settled = settleProAmVisibleRound(completed, snapshot, roundCourse);
    const settlementMs = performance.now() - settlementStarted;
    const simulated = simulateProAmFieldRound({ snapshot, course: roundCourse, roundNumber: 1, seed });
    expect(settled.ok).toBe(true);
    expect(simulated.ok).toBe(true);
    expect(JSON.stringify(settled.ok ? settled.evidence : settled)).toBe(JSON.stringify(simulated.ok ? simulated.evidence : simulated));
    if (!settled.ok) return;
    expect(settled.visibleScorecards).toHaveLength(4);
    expect(settled.visibleScorecards.every((card) => card.status === "completed" && card.grossByHole.length === 18 && card.penalties >= 0)).toBe(true);
    expect(commitProAmVisiblePlayerShot(completed, { club: "putter", aim: { x: 0, y: 0 }, power: 1, technique: "normal" })).toBe(completed);
    expect(JSON.stringify(settleProAmVisibleRound(completed, snapshot, roundCourse))).toBe(JSON.stringify(settled));

    const encoded = encodeProAmVisibleRound(completed);
    const decodeStarted = performance.now();
    const decoded = decodeProAmVisibleRound(encoded, snapshot, roundCourse);
    const decodeMs = performance.now() - decodeStarted;
    expect(decoded.ok).toBe(true);
    expect(completed.actions.length).toBeLessThan(512);
    expect(decodeMs).toBeLessThan(10_000);
    expect(settlementMs).toBeLessThan(30_000);
    console.info("ZK-734B 18-hole replay timing", { actions: completed.actions.length, decodeMs: Math.round(decodeMs), settlementMs: Math.round(settlementMs) });
    const probes = [
      (copy: ProAmVisibleRound) => { copy.challengeRound.golfers[0].equipment.modifiers = [{ channel: "carry", multiplier: 1.2 }]; },
      (copy: ProAmVisibleRound) => { copy.challengeRound.golfers[1].withdrawn = true; },
      (copy: ProAmVisibleRound) => {
        const hole = copy.challengeRound.golfers[1].scorecard.find((entry) => entry.penalties === 0)!;
        hole.strokes = 1;
        hole.gross = 1;
        hole.net = 1 - hole.handicapStrokes;
      },
    ];
    for (const mutate of probes) {
      const hostile = JSON.parse(encoded) as ProAmVisibleRound;
      mutate(hostile);
      expect(decodeProAmVisibleRound(hostile, snapshot, roundCourse)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("action log"),
      });
      expect(settleProAmVisibleRound(hostile, snapshot, roundCourse)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("action log"),
      });
    }
  }, 180_000);

  it("retains explicit withdrawals and emits DNF rather than a pro-only team score", () => {
    const { snapshot, roundCourse, round: initial, team } = started(734_414);
    let round = initial;
    for (const amateurId of team.entrantIds.slice(1)) round = withdrawProAmVisibleGolfer(round, amateurId, "Explicit test withdrawal.");
    const completed = play(round);
    const settled = settleProAmVisibleRound(completed, snapshot, roundCourse);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.visibleScorecards[0].status).toBe("completed");
    expect(settled.visibleScorecards.slice(1)).toEqual(team.entrantIds.slice(1).map((entrantId) => ({
      entrantId,
      status: "withdrawn",
      grossByHole: [],
      penalties: 0,
      grossTotal: 0,
    })));
    const teamEvidence = settled.evidence.teams.find((candidate) => candidate.teamId === team.id)!;
    expect(teamEvidence.status).toBe("dnf");
    expect("netTotal" in teamEvidence).toBe(false);
    expect(teamEvidence.holes.every((hole) => hole.status === "dnf" && hole.countedEntrantIds.length === 0 && hole.reason === "No amateur score is available.")).toBe(true);
    expect(withdrawProAmVisibleGolfer(completed, team.entrantIds[0])).toBe(completed);
  }, 180_000);

  it("fails closed instead of converting a ChallengeGroup concession into invented Pro-Am gross evidence", () => {
    const { snapshot, roundCourse, round } = started(734_415);
    const player = round.challengeRound.golfers[0];
    const concededChallenge = concedeChallengeGroupHole(
      round.challengeRound,
      player.id,
      player.scorecard[0].par + 2,
      "No legal shot remained.",
    );
    const completed = play({ ...round, challengeRound: concededChallenge });
    expect(completed.challengeRound.match.concessions).toHaveLength(1);
    expect(completed.challengeRound.golfers[0].scorecard[0].status).toBe("conceded");
    expect(settleProAmVisibleRound(completed, snapshot, roundCourse)).toEqual({
      ok: false,
      reason: "The visible Pro-Am transcript does not match its trusted action log.",
    });
  }, 120_000);

  it("rejects normalization against a different persisted course authority", () => {
    const { snapshot, roundCourse, round } = started();
    const changedAuthority: PlayerRoundCourseSnapshot = { ...roundCourse, tiles: [...roundCourse.tiles] };
    changedAuthority.tiles[0] = changedAuthority.tiles[0] === "water" ? "rough" : "water";
    expect(decodeProAmVisibleRound(encodeProAmVisibleRound(round), snapshot, changedAuthority)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("drifted"),
    });
    expect(settleProAmVisibleRound(round, snapshot, changedAuthority)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("drifted"),
    });
  }, 60_000);
});
