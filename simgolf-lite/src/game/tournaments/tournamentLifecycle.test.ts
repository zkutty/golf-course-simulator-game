import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { activeCourseLayout } from "../models/courseLayouts";
import { createDefaultPlayerPro, autoFinishPlayerRound, normalizePlayerPro } from "../playerPro/playerPro";
import { settlePlayerRound } from "../playerPro/playerProSettlement";
import { startPlayerProTournamentRound } from "../competition/equipmentMentor";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";
import {
  createTournamentEvent,
} from "./tournaments";
import { normalizeTournamentCalendar } from "./tournamentCalendarValidation";
import {
  TOURNAMENT_LIFECYCLE_DEFAULTS,
  activateTournament,
  completeTournamentRoundEvidence,
  interruptTournamentRound,
  resumeTournamentRound,
  scoreTournamentRoundCard,
  withdrawTournamentEntrant,
} from "./tournamentLifecycle";
import type { TournamentEvent } from "./types";
import { reconstructIndividualTournamentStandings } from "./tournamentStandings";

const course = createTournamentStandardsCourse();

function host(tier: "local" | "regional" | "championship" = "regional") {
  const career = createDefaultPlayerPro({ seed: 733_001, name: "Casey Fairway" });
  const playerPro = {
    ...career,
    skills: Object.fromEntries(Object.keys(career.skills).map((skill) => [skill, 90])) as typeof career.skills,
  };
  const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 100, runSeed: 733_001, playerPro };
  const created = createTournamentEvent({ course, world, tier, currentDay: 0, daysAhead: 1 });
  if (!created.ok) throw new Error(created.reason);
  const entrant = { id: playerPro.identity.id, name: playerPro.identity.name, archetype: "pro" as const, skill: .9, handicapIndex: playerPro.handicapProfile.handicapIndex };
  return { world, event: { ...created.event, field: [...created.event.field.slice(0, -1), entrant] } };
}

function active(tier: "local" | "regional" | "championship" = "regional") {
  const fixture = host(tier);
  const activation = activateTournament(fixture.event, course);
  if (!activation.ok) throw new Error(activation.reason);
  return { ...fixture, event: activation.event };
}

function cards(event: TournamentEvent, adjustment = 0) {
  return event.field.map((entrant, index) => {
    const gross = event.activationSnapshot!.holes.map((hole, holeIndex) => Math.max(1, hole.par + adjustment + ((index + holeIndex) % 3 === 0 ? 1 : 0)));
    const card = scoreTournamentRoundCard(event, entrant.id, gross);
    if (!card) throw new Error(`Could not score ${entrant.id}`);
    return card;
  });
}

describe("ZK-733 tournament lifecycle core", () => {
  it("authors tier defaults without importing team formulas", () => {
    expect(TOURNAMENT_LIFECYCLE_DEFAULTS.local).toMatchObject({ scoringMode: "stableford", roundCount: 1, teamFormat: "individual" });
    expect(TOURNAMENT_LIFECYCLE_DEFAULTS.regional).toMatchObject({ scoringMode: "net-stroke", roundCount: 2, teamFormat: "individual" });
    expect(TOURNAMENT_LIFECYCLE_DEFAULTS.championship).toMatchObject({ scoringMode: "gross-stroke", roundCount: 4, teamFormat: "individual" });
  });

  it.each(["local", "regional"] as const)("freezes a deterministic immutable %s activation contract", (tier) => {
    const fixture = host(tier);
    const first = activateTournament(fixture.event, course);
    const second = activateTournament(fixture.event, course);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.event).toMatchObject({ status: "active", currentRound: 1, roundCount: TOURNAMENT_LIFECYCLE_DEFAULTS[tier].roundCount });
    expect(first.event.rounds).toHaveLength(TOURNAMENT_LIFECYCLE_DEFAULTS[tier].roundCount);
    expect(first.event.activationSnapshot?.holes).toHaveLength(18);
    expect(first.event.activationSnapshot?.entrants).toHaveLength(first.event.field.length);
    expect(first.event.activationSnapshot?.teams.every((team) => team.entrantIds.length === 1)).toBe(true);
    expect(Object.isFrozen(first.event.activationSnapshot)).toBe(true);
    expect(Object.isFrozen(first.event.activationSnapshot!.holes[0].tee)).toBe(true);
    const replay = activateTournament(first.event, { ...course, name: "Edited Later" });
    expect(replay).toEqual({ ok: true, event: first.event });
  });

  it("rejects invalid rounds, duplicate identities, changed routing, and untemplated team formats", () => {
    const fixture = host();
    expect(activateTournament({ ...fixture.event, roundCount: 5 }, course)).toMatchObject({ ok: false });
    expect(activateTournament({ ...fixture.event, field: [fixture.event.field[0], fixture.event.field[0]] }, course)).toMatchObject({ ok: false, reason: expect.stringContaining("unique") });
    expect(activateTournament({ ...fixture.event, holeIds: ["wrong-route"] }, course)).toMatchObject({ ok: false, reason: expect.stringContaining("routing") });
    expect(activateTournament({ ...fixture.event, teamFormat: "four-ball" }, course)).toEqual({ ok: false, reason: "Team tournaments require a reusable tournament template." });
  });

  it.each([1, 2, 4] as const)("advances exactly %i rounds and makes duplicate completion inert", (roundCount) => {
    const tier = roundCount === 1 ? "local" : "regional";
    const fixture = host(tier);
    const activated = activateTournament({ ...fixture.event, roundCount }, course);
    if (!activated.ok) throw new Error(activated.reason);
    let event = activated.event;
    for (let round = 1; round <= roundCount; round += 1) {
      const completed = completeTournamentRoundEvidence(event, cards(event, round - 1));
      expect(completed.ok).toBe(true);
      if (!completed.ok) return;
      const duplicate = completeTournamentRoundEvidence(event, cards(event, round - 1));
      expect(duplicate).toEqual(completed);
      const reloaded = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [completed.event] }))).events[0];
      expect(completeTournamentRoundEvidence(reloaded, cards(completed.event, round - 1), `${event.id}:round:${round}`)).toEqual({ ok: true, event: reloaded, finalRound: reloaded.status === "completed" });
      event = completed.event;
      expect(event.rounds?.filter((entry) => entry.status === "completed")).toHaveLength(round);
      expect(event.status).toBe(round === roundCount ? "completed" : "active");
    }
    expect(event.results).toHaveLength(event.field.length);
    expect(event.winnerName).toBe(event.results?.[0].name);
    expect(event.winnerNames?.[0]).toBe(event.winnerName);
    expect(event.rounds?.flatMap((round) => round.scorecards).every((card) => card.status === "withdrawn" || card.grossByHole.length === 18)).toBe(true);
    expect(completeTournamentRoundEvidence(event, cards(event))).toEqual({ ok: true, event, finalRound: true });
  });

  it.each([1, 2, 3, 4] as const)("persists and reconstructs a %i-round Pro-Am team event", (roundCount) => {
    const fixture = host("regional");
    const created = createTournamentEvent({
      course,
      world: fixture.world,
      tier: "regional",
      currentDay: 0,
      daysAhead: 1,
      templateId: "four-person-pro-am",
    });
    if (!created.ok) throw new Error(created.reason);
    const activated = activateTournament({ ...created.event, roundCount }, course);
    if (!activated.ok) throw new Error(activated.reason);
    let event = activated.event;
    for (let round = 1; round <= roundCount; round += 1) {
      const completed = completeTournamentRoundEvidence(event, cards(event, round - 1));
      expect(completed.ok).toBe(true);
      if (!completed.ok) return;
      event = completed.event;
      expect(event.teamStandings).toHaveLength(event.activationSnapshot!.teams.length);
      expect(event.rounds?.[round - 1].scorecards).toHaveLength(event.activationSnapshot!.entrants.length);
      const reloaded = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [event] }))).events[0];
      expect(reloaded).toBeDefined();
      expect(reloaded.teamStandings).toEqual(event.teamStandings);
      event = reloaded;
    }
    expect(event.status).toBe("completed");
    expect(event.winnerTeamIds).toEqual(event.teamStandings?.filter((row) => row.place === 1).map((row) => row.teamId));
    expect(event.results).toBeUndefined();
    expect(event.winnerNames).toBeUndefined();
  });

  it("fails closed on forged or incomplete Pro-Am gross evidence and keeps non-Pro-Am team formats deferred", () => {
    const fixture = host("regional");
    const created = createTournamentEvent({ course, world: fixture.world, tier: "regional", currentDay: 0, daysAhead: 1, templateId: "four-person-pro-am" });
    if (!created.ok) throw new Error(created.reason);
    const activated = activateTournament(created.event, course);
    if (!activated.ok) throw new Error(activated.reason);
    const evidence = cards(activated.event);
    expect(completeTournamentRoundEvidence(activated.event, evidence.slice(1))).toMatchObject({ ok: false });
    expect(completeTournamentRoundEvidence(activated.event, evidence.map((card, index) => index ? card : { ...card, grossByHole: [0, ...card.grossByHole.slice(1)] }))).toMatchObject({ ok: false });
    const overflow = evidence.map((card, index) => index ? card : { ...card, grossByHole: card.grossByHole.map(() => Number.MAX_VALUE) });
    expect(() => completeTournamentRoundEvidence(activated.event, overflow)).not.toThrow();
    expect(completeTournamentRoundEvidence(activated.event, overflow)).toMatchObject({ ok: false });
    const hugeGross = Math.floor(Number.MAX_SAFE_INTEGER / 40);
    const hugeEvidence = activated.event.activationSnapshot!.entrants.map((entrant) => scoreTournamentRoundCard(
      activated.event,
      entrant.entrantId,
      activated.event.activationSnapshot!.holes.map(() => hugeGross),
    )!);
    const hugeFirst = completeTournamentRoundEvidence(activated.event, hugeEvidence);
    expect(hugeFirst.ok).toBe(true);
    if (hugeFirst.ok) {
      expect(() => completeTournamentRoundEvidence(hugeFirst.event, hugeEvidence)).not.toThrow();
      expect(completeTournamentRoundEvidence(hugeFirst.event, hugeEvidence)).toMatchObject({ ok: false });
    }

    const completed = completeTournamentRoundEvidence(activated.event, evidence);
    if (!completed.ok) throw new Error(completed.reason);
    const hostileReload = structuredClone(completed.event);
    const hostileCard = (hostileReload as unknown as { rounds: Array<{ scorecards: Array<{ grossByHole: number[] }> }> }).rounds[0].scorecards[0];
    hostileCard.grossByHole[0] = Number.MAX_VALUE;
    expect(() => normalizeTournamentCalendar({ version: 2, events: [hostileReload] })).not.toThrow();
    expect(normalizeTournamentCalendar({ version: 2, events: [hostileReload] }).events).toEqual([]);

    const forgedProjection = [{ teamId: "forged", status: "active" as const, completedRounds: 0, dnfRounds: 0, netTotal: -999, place: 1, tied: false, occupiedPlaces: [1] }];
    expect(normalizeTournamentCalendar({ version: 2, events: [{ ...created.event, teamStandings: forgedProjection, winnerTeamIds: ["forged"] }] }).events).toEqual([]);
    expect(normalizeTournamentCalendar({ version: 2, events: [{ ...activated.event, teamStandings: forgedProjection }] }).events).toEqual([]);

    const pair = createTournamentEvent({ course, world: fixture.world, tier: "regional", currentDay: 0, daysAhead: 1, templateId: "two-v-two-four-ball" });
    if (!pair.ok) throw new Error(pair.reason);
    const pairActive = activateTournament(pair.event, course);
    if (!pairActive.ok) throw new Error(pairActive.reason);
    expect(completeTournamentRoundEvidence(pairActive.event, cards(pairActive.event))).toEqual({ ok: false, reason: "Team standings require the deferred tournament team-round scorer." });
    expect(normalizeTournamentCalendar({ version: 2, events: [{ ...pairActive.event, teamStandings: forgedProjection }] }).events).toEqual([]);
  });

  it("persists every tied winner and reconstructs cumulative places byte-exactly after reload", () => {
    const fixture = host("regional");
    const activated = activateTournament({ ...fixture.event, roundCount: 1 }, course);
    if (!activated.ok) throw new Error(activated.reason);
    const equalCards = activated.event.activationSnapshot!.entrants.map((entrant) => scoreTournamentRoundCard(
      activated.event,
      entrant.entrantId,
      activated.event.activationSnapshot!.holes.map((hole, index) => Math.max(1, hole.par + entrant.strokesByHole[index])),
    )!);
    const completed = completeTournamentRoundEvidence(activated.event, equalCards);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.event.winnerNames).toEqual(completed.event.results?.map((row) => row.name));
    expect(completed.event.winnerName).toBe(completed.event.winnerNames?.[0]);

    const before = reconstructIndividualTournamentStandings(completed.event);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.standings.every((standing) => standing.place === 1 && standing.tied)).toBe(true);
    const reloaded = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [completed.event] }))).events[0];
    const after = reconstructIndividualTournamentStandings(reloaded);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(reloaded.winnerNames).toEqual(completed.event.winnerNames);

    const forgedTotal = structuredClone(completed.event);
    forgedTotal.results![0].scoreToPar -= 99;
    const reconstructed = reconstructIndividualTournamentStandings(forgedTotal);
    expect(reconstructed.ok && reconstructed.results).toEqual(before.results);
    const malformedWinners = structuredClone(completed.event);
    malformedWinners.winnerNames = [];
    expect(normalizeTournamentCalendar({ version: 2, events: [malformedWinners] }).events).toEqual([]);
    const extraWinner = structuredClone(completed.event);
    extraWinner.winnerNames = [...extraWinner.winnerNames!, extraWinner.winnerNames![0]];
    expect(normalizeTournamentCalendar({ version: 2, events: [extraWinner] }).events).toEqual([]);
    const reordered = structuredClone(completed.event);
    reordered.winnerNames = [...reordered.winnerNames!].reverse();
    reordered.winnerName = reordered.winnerNames[0];
    expect(normalizeTournamentCalendar({ version: 2, events: [reordered] }).events).toEqual([]);

    const forgedPoints = structuredClone(completed.event);
    forgedPoints.rounds![0].scorecards[0].stablefordPoints! += 100;
    expect(reconstructIndividualTournamentStandings(forgedPoints)).toMatchObject({ ok: false });
    expect(normalizeTournamentCalendar({ version: 2, events: [forgedPoints] }).events).toEqual([]);
    const forgedNet = structuredClone(completed.event);
    forgedNet.rounds![0].scorecards[0].netTotal! -= 100;
    expect(reconstructIndividualTournamentStandings(forgedNet)).toMatchObject({ ok: false });
    expect(normalizeTournamentCalendar({ version: 2, events: [forgedNet] }).events).toEqual([]);
    const missingCard = structuredClone(completed.event);
    missingCard.rounds = missingCard.rounds!.map((round, index) => index ? round : { ...round, scorecards: round.scorecards.slice(0, -1) });
    expect(() => normalizeTournamentCalendar({ version: 2, events: [missingCard] })).not.toThrow();
    expect(normalizeTournamentCalendar({ version: 2, events: [missingCard] }).events).toEqual([]);
    missingCard.winnerNames = [];
    delete missingCard.winnerName;
    delete missingCard.results;
    expect(normalizeTournamentCalendar({ version: 2, events: [missingCard] }).events).toEqual([]);
  });

  it("completes and reloads an all-withdrawn field without inventing a winner", () => {
    const fixture = active("local");
    const withdrawals = fixture.event.activationSnapshot!.entrants.map((entrant) => ({
      entrantId: entrant.entrantId,
      status: "withdrawn" as const,
      grossByHole: [],
      penalties: 0,
      grossTotal: 0,
    }));
    const completed = completeTournamentRoundEvidence(fixture.event, withdrawals);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.event).not.toHaveProperty("winnerNames");
    expect(completed.event).not.toHaveProperty("winnerName");
    const restored = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [completed.event] })));
    expect(restored.events).toHaveLength(1);
    expect(restored.events[0]).not.toHaveProperty("winnerNames");
    expect(restored.events[0]).not.toHaveProperty("winnerName");
  });

  it("persists interruption and withdrawal idempotently without advancing the round", () => {
    const fixture = active();
    const world = { ...fixture.world, tournaments: { version: 2 as const, events: [fixture.event] } };
    const interrupted = interruptTournamentRound(world, fixture.event.id);
    expect(interrupted.tournaments?.events[0].rounds?.[0].status).toBe("interrupted");
    expect(completeTournamentRoundEvidence(interrupted.tournaments!.events[0], cards(fixture.event))).toMatchObject({ ok: false });
    const resumed = resumeTournamentRound(interrupted, fixture.event.id);
    expect(resumed.tournaments?.events[0].rounds?.[0].status).toBe("active");
    const entrantId = fixture.event.field[0].id;
    const withdrawn = withdrawTournamentEntrant(resumed, fixture.event.id, entrantId);
    expect(withdrawn.tournaments?.events[0].rounds?.[0].scorecards).toEqual([expect.objectContaining({ entrantId, status: "withdrawn" })]);
    expect(withdrawTournamentEntrant(withdrawn, fixture.event.id, entrantId)).toBe(withdrawn);
    expect(withdrawn.tournaments?.events[0].currentRound).toBe(1);
  });

  it("normalizes active state while preserving historical one-round outcomes and economics", () => {
    const fixture = active();
    const restored = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [fixture.event] })), course);
    expect(restored.events[0]).toMatchObject({
      id: fixture.event.id,
      status: "active",
      currentRound: 1,
      activationSnapshot: fixture.event.activationSnapshot,
      rounds: fixture.event.rounds,
    });
    expect(Object.isFrozen(restored.events[0].activationSnapshot)).toBe(true);
    expect(normalizeTournamentCalendar({ version: 2, events: [{ ...fixture.event, activationSnapshot: { ...fixture.event.activationSnapshot!, version: 99 } }] }).events).toEqual([]);

    const historical = {
      id: "legacy", name: "Legacy Open", tier: "local", scheduledWeek: 2, scheduledDay: 3, status: "completed",
      bookingCost: 100, revenueAward: 200, reputationAward: 1,
      field: [{ id: "e", name: "A", archetype: "casual", skill: .5 }],
      results: [{ entrantId: "e", golferId: 1, name: "A", archetype: "casual", holesCompleted: 9, score: 40, scoreToPar: 4, finished: true }],
      winnerName: "A",
    };
    const migrated = normalizeTournamentCalendar({ version: 1, events: [historical] });
    expect(migrated.events[0]).toMatchObject({ status: "completed", winnerName: "A", revenueAward: 200, results: [{ score: 40 }] });
    expect(migrated.events[0].roundCount).toBeUndefined();
  });

  it("sequences Player Pro rounds and rejects duplicate or future rounds", () => {
    const fixture = active("regional");
    const datedWorld = { ...fixture.world, week: fixture.event.rounds![0].scheduledWeek, playerPro: fixture.world.playerPro };
    const started = startPlayerProTournamentRound({ course, world: datedWorld, event: fixture.event, layoutId: activeCourseLayout(course).id, day: fixture.event.rounds![0].scheduledDay });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const completedRound = autoFinishPlayerRound(started.career.activeRound!, started.career.skills);
    const settled = settlePlayerRound(started.career, completedRound, fixture.event);
    expect(settled.tournamentEvent).toMatchObject({ status: "active", currentRound: 2 });
    expect(settled.career.tournaments[0]).toMatchObject({ status: "active", completedRounds: [1], currentRound: 2, totalRounds: 2 });
    const duplicate = startPlayerProTournamentRound({ course, world: { ...datedWorld, playerPro: settled.career }, event: fixture.event, layoutId: activeCourseLayout(course).id, day: fixture.event.rounds![0].scheduledDay });
    expect(duplicate).toEqual({ ok: false, reason: "duplicate_round" });
    const future = { ...settled.tournamentEvent!, currentRound: 3 };
    expect(startPlayerProTournamentRound({ course, world: { ...datedWorld, playerPro: settled.career }, event: future, layoutId: activeCourseLayout(course).id, day: 0 })).toEqual({ ok: false, reason: "round_status" });
  }, 60_000);

  it("records Player Pro withdrawal without inventing gross evidence or a payout", () => {
    const fixture = active("local");
    const datedWorld = { ...fixture.world, week: fixture.event.scheduledWeek };
    const started = startPlayerProTournamentRound({ course, world: datedWorld, event: fixture.event, layoutId: activeCourseLayout(course).id, day: fixture.event.scheduledDay });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const settlement = settlePlayerRound(started.career, { ...started.career.activeRound!, phase: "conceded" }, fixture.event);
    expect(settlement.tournamentEvent).toMatchObject({ status: "completed", winnerName: expect.any(String) });
    expect(settlement.tournamentEvent?.rounds?.[0].scorecards.find((card) => card.entrantId === started.career.identity.id)).toEqual({
      entrantId: started.career.identity.id,
      status: "withdrawn",
      grossByHole: [],
      penalties: 0,
      grossTotal: 0,
    });
    expect(settlement.cashDelta).toBe(0);
    expect(settlement.career.tournaments[0]).toMatchObject({ status: "withdrawn", prize: 0, settled: true });
  });

  it("makes a regional Player Pro withdrawal terminal and propagates it through later rounds", () => {
    const fixture = active("regional");
    const firstRound = fixture.event.rounds![0];
    const started = startPlayerProTournamentRound({ course, world: { ...fixture.world, week: firstRound.scheduledWeek }, event: fixture.event, layoutId: activeCourseLayout(course).id, day: firstRound.scheduledDay });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const settlement = settlePlayerRound(started.career, { ...started.career.activeRound!, phase: "conceded" }, fixture.event);
    expect(settlement.career.tournaments[0]).toMatchObject({ status: "withdrawn", settled: true, prize: 0 });
    expect(settlement.tournamentEvent).toMatchObject({ status: "completed", currentRound: 2 });
    expect(settlement.tournamentEvent?.rounds?.every((round) => round.status === "completed")).toBe(true);
    expect(settlement.tournamentEvent?.rounds?.[1].scorecards).toContainEqual({ entrantId: started.career.identity.id, status: "withdrawn", grossByHole: [], penalties: 0, grossTotal: 0 });
    expect(settlement.cashDelta).toBe(0);
    const secondRound = settlement.tournamentEvent!.rounds![1];
    expect(startPlayerProTournamentRound({ course, world: { ...started.world, week: secondRound.scheduledWeek, playerPro: settlement.career }, event: settlement.tournamentEvent!, layoutId: activeCourseLayout(course).id, day: secondRound.scheduledDay })).toEqual({ ok: false, reason: "withdrawn" });
  });

  it("recomputes every total from frozen gross evidence and ignores mutable field winner forgery", () => {
    const fixture = active("local");
    const evidence = cards(fixture.event);
    const honest = completeTournamentRoundEvidence(fixture.event, evidence);
    const forgedEvent = { ...fixture.event, field: fixture.event.field.map((entrant, index) => ({ ...entrant, id: `forged-${index}`, name: `Forged ${index}`, skill: index ? 1 : 0 })) };
    const forged = completeTournamentRoundEvidence(forgedEvent, evidence.map((card, index) => ({ ...card, grossTotal: index ? 1 : 999, netTotal: index ? -999 : 999, stablefordPoints: index ? 999 : -999 })));
    expect(forged.ok).toBe(true);
    expect(honest.ok).toBe(true);
    if (!forged.ok || !honest.ok) return;
    expect(forged.event.results).toEqual(honest.event.results);
    expect(forged.event.rounds?.[0].scorecards).toEqual(honest.event.rounds?.[0].scorecards);
    expect(forged.event.results?.map((row) => row.name).sort()).toEqual(fixture.event.activationSnapshot?.entrants.map((entrant) => entrant.name).sort());
  });

  it("keeps a withdrawal marker immutable and will not replace it with a forged completion", () => {
    const fixture = active("local");
    const entrantId = fixture.event.activationSnapshot!.entrants[0].entrantId;
    const world = withdrawTournamentEntrant({ ...fixture.world, tournaments: { version: 2, events: [fixture.event] } }, fixture.event.id, entrantId);
    const withdrawn = world.tournaments!.events[0];
    expect(completeTournamentRoundEvidence(withdrawn, cards(fixture.event))).toMatchObject({ ok: false });
    const completed = completeTournamentRoundEvidence(withdrawn, cards(fixture.event).filter((card) => card.entrantId !== entrantId));
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.event.rounds?.[0].scorecards.find((card) => card.entrantId === entrantId)).toEqual({ entrantId, status: "withdrawn", grossByHole: [], penalties: 0, grossTotal: 0 });
  });

  it("rejects hostile lifecycle carriers without throwing and normalizes valid reloads idempotently", () => {
    const fixture = active();
    const hostile = [
      { ...fixture.event, activationSnapshot: { ...fixture.event.activationSnapshot!, holes: "not-an-array" } },
      { ...fixture.event, activationSnapshot: { ...fixture.event.activationSnapshot!, entrants: [{ entrantId: "x", strokesByHole: "bad" }] } },
      { ...fixture.event, activationSnapshot: { ...fixture.event.activationSnapshot!, teams: [{ id: "x", entrantIds: "bad" }] } },
      { ...fixture.event, rounds: [{ roundNumber: 1, scorecards: "bad" }] },
    ];
    for (const event of hostile) {
      expect(() => normalizeTournamentCalendar({ version: 2, events: [event as never] })).not.toThrow();
      expect(normalizeTournamentCalendar({ version: 2, events: [event as never] }).events).toEqual([]);
    }
    const first = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [fixture.event] })));
    const second = normalizeTournamentCalendar(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
    expect(Object.isFrozen(second.events[0].activationSnapshot?.holes[0].tee)).toBe(true);
  });

  it("normalizes hostile Player Pro tournament arrays before duplicate and sequencing checks", () => {
    const fixture = active();
    const rawCareer = {
      ...fixture.world.playerPro!,
      tournaments: [null, { id: `pro-event-${fixture.event.id}`, eventId: fixture.event.id, name: fixture.event.name, tier: fixture.event.tier, status: "active", roundIds: "bad", completedRounds: { bad: true }, currentRound: "bad", totalRounds: 2 }],
    };
    const normalized = normalizePlayerPro(rawCareer, { seed: fixture.world.runSeed });
    expect(normalized.tournaments).toEqual([expect.objectContaining({ roundIds: [], completedRounds: [], currentRound: undefined, totalRounds: 2 })]);
    expect(normalizePlayerPro(JSON.parse(JSON.stringify(normalized)), { seed: fixture.world.runSeed })).toEqual(normalized);
    const started = startPlayerProTournamentRound({ course, world: { ...fixture.world, week: fixture.event.scheduledWeek, playerPro: rawCareer as never }, event: fixture.event, layoutId: activeCourseLayout(course).id, day: fixture.event.scheduledDay });
    expect(started.ok).toBe(true);
  });

  it("settles lifecycle rounds transactionally when the event cannot advance", () => {
    const fixture = active("local");
    const started = startPlayerProTournamentRound({ course, world: { ...fixture.world, week: fixture.event.scheduledWeek }, event: fixture.event, layoutId: activeCourseLayout(course).id, day: fixture.event.scheduledDay });
    if (!started.ok) throw new Error(started.reason);
    const completed = autoFinishPlayerRound(started.career.activeRound!, started.career.skills);
    const interrupted = interruptTournamentRound(started.world, fixture.event.id).tournaments!.events[0];
    const rejected = settlePlayerRound(started.career, completed, interrupted);
    expect(rejected).toEqual({ career: started.career, cashDelta: 0, reputationDelta: 0, round: null });
    expect(rejected.career.activeRound).toBe(started.career.activeRound);
    expect(rejected.career.settlementLedger).not.toContain(`round:${completed.id}`);
    expect(settlePlayerRound(started.career, { ...completed, tournamentRound: 2 }, started.event)).toEqual({ career: started.career, cashDelta: 0, reputationDelta: 0, round: null });
  });

  it("persists scheduled activation atomically and reaches round two after reload", () => {
    const fixture = host("regional");
    const original = { ...fixture.world, week: fixture.event.scheduledWeek, tournaments: { version: 2 as const, events: [fixture.event] } };
    const before = structuredClone(original);
    const rejected = startPlayerProTournamentRound({ course, world: original, event: fixture.event, layoutId: activeCourseLayout(course).id, day: (fixture.event.scheduledDay + 1) % 7 });
    expect(rejected.ok).toBe(false);
    expect(original).toEqual(before);
    const started = startPlayerProTournamentRound({ course, world: original, event: fixture.event, layoutId: activeCourseLayout(course).id, day: fixture.event.scheduledDay });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.world).toMatchObject({ playerPro: { activeRound: { tournamentRound: 1 } }, tournaments: { events: [{ status: "active", currentRound: 1 }] } });
    const settled = settlePlayerRound(started.career, autoFinishPlayerRound(started.career.activeRound!, started.career.skills), started.event);
    if (!settled.tournamentEvent) throw new Error("Round did not advance");
    const reloadedEvent = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [settled.tournamentEvent] }))).events[0];
    const reloadedCareer = normalizePlayerPro(JSON.parse(JSON.stringify(settled.career)), { seed: original.runSeed });
    const nextRound = reloadedEvent.rounds![1];
    const editedCourse = { ...course, name: "Edited after activation", holes: [] };
    const continued = startPlayerProTournamentRound({ course: editedCourse, world: { ...started.world, week: nextRound.scheduledWeek, playerPro: reloadedCareer, tournaments: { version: 2, events: [reloadedEvent] } }, event: reloadedEvent, layoutId: activeCourseLayout(course).id, day: nextRound.scheduledDay });
    if (!continued.ok) throw new Error(continued.reason);
    expect(continued.ok).toBe(true);
    if (continued.ok) {
      expect(continued.world).toMatchObject({ playerPro: { activeRound: { tournamentRound: 2 } }, tournaments: { events: [{ status: "active", currentRound: 2 }] } });
      expect(continued.career.activeRound?.course).toMatchObject({ courseId: reloadedEvent.activationSnapshot?.courseId, courseName: reloadedEvent.activationSnapshot?.courseName, rating: { courseRating: reloadedEvent.activationSnapshot?.rating, slope: reloadedEvent.activationSnapshot?.slope } });
      expect(continued.career.activeRound?.course.holes.map(({ id, par, strokeIndex, tee, pin }) => ({ id, par, strokeIndex, tee, pin }))).toEqual(reloadedEvent.activationSnapshot?.holes);
    }
  }, 60_000);
});
