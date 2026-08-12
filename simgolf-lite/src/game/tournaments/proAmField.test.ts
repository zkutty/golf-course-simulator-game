import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import {
  challengeGroupPlayerRound,
  challengeGroupPlayerSkills,
  commitChallengeGroupPlayerShot,
  startChallengeGroupRound,
} from "../competition/challengeGroupRound";
import { scoreTeamNetHole } from "../competition/scoring";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { caddieRecommendation } from "../playerPro/playerPro";
import { startPlayableRound } from "../playerPro/playerProRoundStart";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";
import { activateTournament, scoreTournamentRoundCard } from "./tournamentLifecycle";
import { createTournamentEvent } from "./tournamentScheduling";
import {
  scoreProAmCumulativeEvidence,
  scoreProAmRoundEvidence,
} from "./proAmField";
import { simulateProAmFieldRound } from "./proAmFieldSimulation";
import type { TournamentEvent, TournamentRoundScorecard } from "./types";

const course = createTournamentStandardsCourse();
const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 100, runSeed: 734_001 };

function fixture(roundCount: 1 | 2 | 3 | 4 = 1) {
  const created = createTournamentEvent({ course, world, tier: "regional", currentDay: 0, daysAhead: 1, templateId: "four-person-pro-am" });
  if (!created.ok) throw new Error(created.reason);
  const activated = activateTournament({ ...created.event, roundCount }, course);
  if (!activated.ok) throw new Error(activated.reason);
  const started = startPlayableRound({
    course,
    world: { ...world, week: activated.event.scheduledWeek },
    kind: "tournament",
    tournament: { id: activated.event.id, name: activated.event.name, roundNumber: 1 },
    tournamentSnapshot: activated.event.activationSnapshot,
    day: activated.event.scheduledDay,
  });
  if (!started.ok) throw new Error(started.reason);
  return { event: activated.event, snapshot: activated.event.activationSnapshot!, roundCourse: started.round.course };
}

function cards(event: TournamentEvent, adjustment = 0): TournamentRoundScorecard[] {
  return event.activationSnapshot!.entrants.map((entrant, entrantIndex) => {
    const gross = event.activationSnapshot!.holes.map((hole, holeIndex) => Math.max(1, hole.par + adjustment + ((entrantIndex + holeIndex) % 3 === 0 ? 1 : 0)));
    const card = scoreTournamentRoundCard(event, entrant.entrantId, gross);
    if (!card) throw new Error(`Could not score ${entrant.entrantId}`);
    return card;
  });
}

describe("ZK-734A deterministic four-person Pro-Am field core", () => {
  it("applies frozen 85% handicaps and chooses best two net with at least one amateur", () => {
    const { event, snapshot } = fixture();
    const evidence = cards(event);
    const scored = scoreProAmRoundEvidence(snapshot, 1, evidence);
    expect(scored.ok).toBe(true);
    if (!scored.ok) return;
    const team = scored.evidence.teams[0];
    const firstHole = team.holes[0];
    expect(firstHole.status).toBe("scored");
    expect(firstHole.countedEntrantIds).toHaveLength(2);
    expect(firstHole.countedEntrantIds.some((id) => snapshot.entrants.find((entrant) => entrant.entrantId === id)?.teamRole === "amateur")).toBe(true);
    const selected = firstHole.members.filter((member) => firstHole.countedEntrantIds.includes(member.entrantId));
    expect(firstHole.net).toBe(selected.reduce((sum, member) => sum + member.net!, 0));
    expect(firstHole.countedEntrantIds).toEqual(scoreTeamNetHole("pro-am", firstHole.members.map((member) => ({ playerId: member.entrantId, role: member.role, gross: member.gross!, net: member.net! }))).countedPlayerIds);
    expect(firstHole.members.map((member) => member.handicapStrokes)).toEqual(snapshot.entrants.slice(0, 4).map((entrant) => entrant.strokesByHole[0]));
    expect(Object.isFrozen(scored.evidence)).toBe(true);
    expect(Object.isFrozen(firstHole.members)).toBe(true);
  }, 60_000);

  it("fails closed for missing, duplicate, unknown, and forged participant evidence", () => {
    const { event, snapshot } = fixture();
    const evidence = cards(event);
    expect(scoreProAmRoundEvidence(snapshot, 1, evidence.slice(1))).toMatchObject({ ok: false, reason: expect.stringContaining("exactly one") });
    expect(scoreProAmRoundEvidence(snapshot, 1, [evidence[0], ...evidence.slice(0, -1)])).toMatchObject({ ok: false });
    expect(scoreProAmRoundEvidence(snapshot, 1, evidence.map((card, index) => index === 0 ? { ...card, entrantId: "forged" } : card))).toMatchObject({ ok: false });
    expect(scoreProAmRoundEvidence(snapshot, 1, evidence.map((card, index) => index === 0 ? { ...card, grossTotal: card.grossTotal + 1 } : card))).toEqual({ ok: false, reason: "Pro-Am participant gross evidence is missing, forged, or malformed." });
    expect(scoreProAmRoundEvidence(snapshot, 1, evidence.map((card, index) => index === 0 ? { ...card, hostile: true } as never : card))).toEqual({ ok: false, reason: "Pro-Am participant gross evidence is missing, forged, or malformed." });
    expect(() => scoreProAmRoundEvidence({ ...snapshot, holes: "bad" } as never, 1, evidence)).not.toThrow();
    expect(scoreProAmRoundEvidence({ ...snapshot, holes: "bad" } as never, 1, evidence)).toMatchObject({ ok: false });
    expect(() => scoreProAmRoundEvidence(snapshot, Number.NaN, [null, ...evidence.slice(1)] as never)).not.toThrow();
    const forgedSnapshot = structuredClone(snapshot);
    forgedSnapshot.entrants[0].playingHandicap += 1;
    expect(scoreProAmRoundEvidence(forgedSnapshot, 1, evidence)).toMatchObject({ ok: false, reason: expect.stringContaining("85%") });
    for (const mutate of [
      (copy: typeof snapshot) => { copy.formatRules!.orderRule = "independent"; },
      (copy: typeof snapshot) => { copy.formatRules!.teamHoleScoringSupported = true; },
      (copy: typeof snapshot) => { copy.supportedOverrides = ["roundCount"]; },
      (copy: typeof snapshot) => { (copy.appliedOverrides as Record<string, string | number>).roundCount = 4; },
      (copy: typeof snapshot) => { copy.teamHandicaps = []; },
      (copy: typeof snapshot) => { Object.assign(copy, { hostile: true }); },
      (copy: typeof snapshot) => { Object.assign(copy.holes[0], { hostile: true }); },
      (copy: typeof snapshot) => { Object.assign(copy.teams[0], { hostile: true }); },
      (copy: typeof snapshot) => { Object.assign(copy.entrants[0], { hostile: true }); },
      (copy: typeof snapshot) => { copy.entrants[0].name = ""; },
    ]) {
      const hostile = structuredClone(snapshot);
      mutate(hostile);
      expect(scoreProAmRoundEvidence(hostile, 1, evidence)).toMatchObject({ ok: false });
    }
  }, 60_000);

  it("retains withdrawals and emits DNF instead of inventing a pro-only team score", () => {
    const { event, snapshot } = fixture();
    const evidence = cards(event);
    const withdrawn = new Set(snapshot.teams[0].entrantIds.slice(1));
    const withMissingAmateurs = evidence.map((card) => withdrawn.has(card.entrantId)
      ? { entrantId: card.entrantId, status: "withdrawn" as const, grossByHole: [], penalties: 0, grossTotal: 0 }
      : card);
    const scored = scoreProAmRoundEvidence(snapshot, 1, withMissingAmateurs);
    expect(scored.ok).toBe(true);
    if (!scored.ok) return;
    expect(scored.evidence.teams[0].status).toBe("dnf");
    expect("netTotal" in scored.evidence.teams[0]).toBe(false);
    expect(scored.evidence.teams[0].holes.every((hole) => hole.status === "dnf" && hole.countedEntrantIds.length === 0 && hole.reason === "No amateur score is available.")).toBe(true);

    const proWithdrawn = new Set([snapshot.teams[1].entrantIds[0]]);
    const threeAmateurs = evidence.map((card) => proWithdrawn.has(card.entrantId)
      ? { entrantId: card.entrantId, status: "withdrawn" as const, grossByHole: [], penalties: 0, grossTotal: 0 }
      : card);
    const amateurScored = scoreProAmRoundEvidence(snapshot, 1, threeAmateurs);
    expect(amateurScored.ok && amateurScored.evidence.teams[1].status).toBe("completed");
    if (amateurScored.ok) expect(amateurScored.evidence.teams[1].holes.every((hole) => hole.countedEntrantIds.every((id) => snapshot.entrants.find((entrant) => entrant.entrantId === id)?.teamRole === "amateur"))).toBe(true);
  }, 60_000);

  it.each([1, 2, 3, 4] as const)("recomputes contiguous cumulative evidence through %i rounds without rankings", (roundCount) => {
    const { event, snapshot } = fixture(roundCount);
    const rounds = Array.from({ length: roundCount }, (_, index) => {
      const scored = scoreProAmRoundEvidence(snapshot, index + 1, cards(event, index));
      if (!scored.ok) throw new Error(scored.reason);
      return scored.evidence;
    });
    const cumulative = scoreProAmCumulativeEvidence(snapshot, rounds);
    expect(cumulative.ok).toBe(true);
    if (!cumulative.ok) return;
    expect(cumulative.evidence.completedRounds).toBe(roundCount);
    expect(cumulative.evidence.teams.map((team) => team.teamId)).toEqual(snapshot.teams.map((team) => team.id));
    expect(cumulative.evidence.teams.every((team) => team.completedRounds === roundCount && team.dnfRounds === 0 && team.status === "active")).toBe(true);
    expect(Object.keys(cumulative.evidence.teams[0])).toEqual(["teamId", "status", "completedRounds", "dnfRounds", "netTotal"]);
    expect(cumulative.evidence.standings).toHaveLength(snapshot.teams.length);
    expect(cumulative.evidence.standings.every((standing) => standing.completedRounds === roundCount && standing.place !== null)).toBe(true);
    expect(cumulative.evidence.winnerTeamIds).toEqual(cumulative.evidence.standings.filter((standing) => standing.place === 1).map((standing) => standing.competitorId));
    expect(scoreProAmCumulativeEvidence(snapshot, rounds.slice(1))).toMatchObject({ ok: false, reason: expect.stringContaining("contiguous") });
  }, 60_000);

  it("preserves tied Pro-Am occupied places and reconstructs them from participant gross after reload", () => {
    const { event, snapshot } = fixture(2);
    const equalTeamCards = () => snapshot.entrants.map((entrant) => {
      const gross = snapshot.holes.map((hole, holeIndex) => Math.max(1, hole.par + entrant.strokesByHole[holeIndex] + ((entrant.teamOrder ?? 0) < 2 ? 0 : 2)));
      return scoreTournamentRoundCard(event, entrant.entrantId, gross)!;
    });
    const rounds = [1, 2].map((roundNumber) => {
      const scored = scoreProAmRoundEvidence(snapshot, roundNumber, equalTeamCards());
      if (!scored.ok) throw new Error(scored.reason);
      return scored.evidence;
    });
    const cumulative = scoreProAmCumulativeEvidence(snapshot, rounds);
    expect(cumulative.ok).toBe(true);
    if (!cumulative.ok) return;
    expect(cumulative.evidence.standings.every((standing) => standing.place === 1 && standing.tied && standing.status === "completed")).toBe(true);
    expect(cumulative.evidence.winnerTeamIds).toEqual([...snapshot.teams.map((team) => team.id)].sort());
    const reloaded = scoreProAmCumulativeEvidence(JSON.parse(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(rounds)));
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(cumulative));
  }, 60_000);

  it("keeps partial Pro-Am leaders ranked without exposing them as winners", () => {
    const { event, snapshot } = fixture(4);
    const lowGross = snapshot.entrants.map((entrant) => scoreTournamentRoundCard(event, entrant.entrantId, snapshot.holes.map(() => 1))!);
    const first = scoreProAmRoundEvidence(snapshot, 1, lowGross);
    if (!first.ok) throw new Error(first.reason);
    const partial = scoreProAmCumulativeEvidence(snapshot, [first.evidence]);
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.evidence.winnerTeamIds).toEqual([]);
    expect(partial.evidence.standings.some((standing) => standing.place === 1)).toBe(true);
  }, 60_000);

  it("simulates fixed-seed field bytes through shared shot authority and accepts equivalent visible gross", () => {
    const { snapshot, roundCourse } = fixture();
    const started = performance.now();
    const first = simulateProAmFieldRound({ snapshot, course: roundCourse, roundNumber: 1, seed: 734_101 });
    const elapsed = performance.now() - started;
    const second = simulateProAmFieldRound({ snapshot: JSON.parse(JSON.stringify(snapshot)), course: JSON.parse(JSON.stringify(roundCourse)), roundNumber: 1, seed: 734_101 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(elapsed).toBeLessThan(30_000);
    if (!first.ok) return;
    expect(first.evidence.scorecards).toHaveLength(12);
    expect(first.evidence.scorecards.every((card) => card.status === "completed" && card.grossByHole.length === 18)).toBe(true);
    const visible = first.evidence.scorecards[5];
    const replay = simulateProAmFieldRound({ snapshot, course: roundCourse, roundNumber: 1, seed: 734_101, visibleScorecards: [visible] });
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
    const firstCumulative = scoreProAmCumulativeEvidence(snapshot, [first.evidence]);
    const replayCumulative = replay.ok ? scoreProAmCumulativeEvidence(snapshot, [replay.evidence]) : replay;
    expect(JSON.stringify(replayCumulative)).toBe(JSON.stringify(firstCumulative));
    const forged = { ...visible, grossTotal: visible.grossTotal + 1 };
    expect(simulateProAmFieldRound({ snapshot, course: roundCourse, roundNumber: 1, seed: 734_101, visibleScorecards: [forged] })).toEqual({ ok: false, reason: "Visible Pro-Am gross evidence is duplicated, forged, or malformed." });
  }, 120_000);

  it("compacts only settled transcripts without changing shared authority results", () => {
    const { snapshot, roundCourse } = fixture();
    const team = snapshot.teams[0];
    const stableSeed = (source: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193);
      return hash >>> 0;
    };
    const participants = team.entrantIds.map((entrantId, index) => {
      const entrant = snapshot.entrants.find((candidate) => candidate.entrantId === entrantId)!;
      const skill = Math.max(0, Math.min(100, Math.round(entrant.skill * 100)));
      return {
        id: entrant.entrantId,
        name: entrant.name,
        controller: index === 0 ? "player" as const : "ai" as const,
        teamId: `individual:${entrant.entrantId}`,
        handedness: stableSeed(entrant.entrantId) % 2 ? "right" as const : "left" as const,
        skills: { power: skill, driving: skill, irons: skill, recovery: skill, putting: skill, shortGame: skill },
        handicapIndex: entrant.handicapIndex,
        handicapAllowance: 0.85,
        setup: { course: roundCourse, teeSet: snapshot.teeSet, pinRotation: snapshot.pinRotation },
      };
    });
    const play = (compact: boolean) => {
      let round = startChallengeGroupRound({
        id: "zk734-compaction-proof",
        course: roundCourse,
        rulesSnapshot: roundCourse.rulesSnapshot,
        teeSet: snapshot.teeSet,
        pinRotation: snapshot.pinRotation,
        participants,
        individualFormat: "net-stroke",
        rngSeed: (734_303 ^ stableSeed(`${snapshot.activationId}:1:${team.id}`)) >>> 0,
        startedWeek: snapshot.activatedWeek,
        startedDay: snapshot.activatedDay,
      });
      let guard = 0;
      while (round.phase !== "complete" && guard++ < 480) {
        const view = challengeGroupPlayerRound(round);
        if (!view || round.phase !== "awaiting_player") throw new Error("Shared authority did not yield a player turn.");
        round = commitChallengeGroupPlayerShot(round, round.playerGolferId, caddieRecommendation(view, challengeGroupPlayerSkills(round)));
        if (compact) round = {
          ...round,
          golfers: round.golfers.map((golfer) => ({ ...golfer, shots: [] })),
          turnEvidence: [],
        };
      }
      if (round.phase !== "complete") throw new Error("Shared authority did not complete the compaction proof.");
      return round;
    };
    const reference = play(false);
    const compacted = play(true);
    const authoritativeProjection = (round: typeof reference) => ({
      phase: round.phase,
      courseId: round.course.courseId,
      currentHoleIndex: round.currentHoleIndex,
      activeGolferId: round.activeGolferId,
      playerGolferId: round.playerGolferId,
      honorsOrder: round.honorsOrder,
      rngSeed: round.rngSeed,
      rngCursor: round.rngCursor,
      match: round.match,
      golfers: round.golfers.map((golfer) => ({
        id: golfer.id,
        ball: golfer.ball,
        lie: golfer.lie,
        handicap: golfer.handicap,
        scorecard: golfer.scorecard,
        withdrawn: golfer.withdrawn,
      })),
    });
    expect(authoritativeProjection(compacted)).toEqual(authoritativeProjection(reference));
    expect(reference.turnEvidence.length).toBeGreaterThan(0);
    expect(reference.golfers.some((golfer) => golfer.shots.length > 0)).toBe(true);
    expect(compacted.turnEvidence).toEqual([]);
    expect(compacted.golfers.every((golfer) => golfer.shots.length === 0)).toBe(true);
    const production = simulateProAmFieldRound({ snapshot, course: roundCourse, roundNumber: 1, seed: 734_303 });
    expect(production.ok).toBe(true);
    if (!production.ok) return;
    for (const golfer of reference.golfers) {
      const card = production.evidence.scorecards.find((candidate) => candidate.entrantId === golfer.id)!;
      expect(card.grossByHole).toEqual(golfer.scorecard.map((hole) => hole.gross));
      expect(card.penalties).toBe(golfer.scorecard.reduce((sum, hole) => sum + hole.penalties, 0));
    }
  }, 120_000);

  it("rejects course authority drift and is immune to later live Course edits", () => {
    const { snapshot, roundCourse } = fixture();
    const baseline = simulateProAmFieldRound({ snapshot, course: roundCourse, roundNumber: 1, seed: 734_202 });
    const editedLiveCourse = structuredClone(course);
    editedLiveCourse.name = "Edited after activation";
    editedLiveCourse.holes = [];
    editedLiveCourse.tiles.fill("water");
    expect(editedLiveCourse.name).not.toBe(roundCourse.courseName);
    const replay = simulateProAmFieldRound({ snapshot: JSON.parse(JSON.stringify(snapshot)), course: JSON.parse(JSON.stringify(roundCourse)), roundNumber: 1, seed: 734_202 });
    expect(JSON.stringify(replay)).toBe(JSON.stringify(baseline));

    const cases: PlayerRoundCourseSnapshot[] = [
      { ...roundCourse, courseId: "forged-course" },
      { ...roundCourse, rating: { ...roundCourse.rating!, slope: roundCourse.rating!.slope + 1 } },
      { ...roundCourse, holes: roundCourse.holes.map((hole, index) => index === 0 ? { ...hole, par: hole.par + 1 } : hole) },
      { ...roundCourse, holes: roundCourse.holes.map((hole, index) => index === 0 ? { ...hole, strokeIndex: 18 } : hole) },
      { ...roundCourse, holes: roundCourse.holes.map((hole, index) => index === 0 ? { ...hole, tee: { x: hole.tee.x + 1, y: hole.tee.y } } : hole) },
      { ...roundCourse, tiles: roundCourse.tiles.slice(1) },
    ];
    for (const drifted of cases) expect(simulateProAmFieldRound({ snapshot, course: drifted, roundNumber: 1, seed: 1 })).toMatchObject({ ok: false });
  }, 120_000);
});
