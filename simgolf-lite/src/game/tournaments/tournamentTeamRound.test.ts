import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";
import { normalizeTournamentCalendar } from "./tournamentCalendarValidation";
import { activateTournament, completeTournamentRoundEvidence, scoreTournamentRoundCard } from "./tournamentLifecycle";
import { createTournamentEvent } from "./tournamentScheduling";
import type { TournamentEvent, TournamentRoundScorecard, TournamentTemplateId } from "./types";

const course = createTournamentStandardsCourse();
const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 100, runSeed: 733_001 };
const templates = ["two-v-two-four-ball", "two-v-two-alternate-shot", "two-person-scramble"] as const;

function active(templateId: TournamentTemplateId, roundCount: number): TournamentEvent {
  const created = createTournamentEvent({ course, world, tier: "regional", currentDay: 0, daysAhead: 1, templateId });
  if (!created.ok) throw new Error(created.reason);
  const activated = activateTournament({ ...created.event, roundCount }, course);
  if (!activated.ok) throw new Error(activated.reason);
  return activated.event;
}

function cards(event: TournamentEvent, round: number): TournamentRoundScorecard[] {
  const snapshot = event.activationSnapshot!;
  return snapshot.entrants.map((entrant, entrantIndex) => {
    const teamIndex = snapshot.teams.findIndex((team) => team.id === entrant.teamId);
    const shared = snapshot.teamFormat === "alternate-shot" || snapshot.teamFormat === "scramble";
    const gross = snapshot.holes.map((hole, holeIndex) => hole.par + round + (shared ? teamIndex : (entrantIndex + holeIndex) % 2));
    return scoreTournamentRoundCard(event, entrant.entrantId, gross)!;
  });
}

describe("ZK-733 canonical tournament team-round lifecycle", () => {
  it.each(templates.flatMap((template) => [1, 2, 3, 4].map((rounds) => [template, rounds] as const)))(
    "completes and reconstructs %s across %i frozen rounds",
    (templateId, roundCount) => {
      let event = active(templateId, roundCount);
      for (let round = 1; round <= roundCount; round += 1) {
        const evidence = cards(event, round);
        const completed = completeTournamentRoundEvidence(event, evidence);
        expect(completed.ok).toBe(true);
        if (!completed.ok) return;
        expect(completed.event.rounds![round - 1].scorecards).toHaveLength(4);
        expect(completed.event.rounds![round - 1].scorecards.every((card) => card.grossByHole.length === 18)).toBe(true);
        expect(completed.event.teamStandings).toHaveLength(2);
        const restored = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [completed.event] })));
        expect(restored.events).toHaveLength(1);
        expect(JSON.stringify(restored.events[0])).toBe(JSON.stringify(completed.event));
        const duplicate = completeTournamentRoundEvidence(restored.events[0], evidence, `${event.id}:round:${round}`);
        expect(duplicate).toEqual({ ok: true, event: restored.events[0], finalRound: round === roundCount });
        event = restored.events[0];
      }
      expect(event.status).toBe("completed");
      expect(event.winnerTeamIds).toEqual(event.teamStandings?.filter((row) => row.place === 1).map((row) => row.teamId));
      expect(event.results).toBeUndefined();
      expect(event.winnerName).toBeUndefined();
    },
    60_000,
  );

  it.each(["two-v-two-alternate-shot", "two-person-scramble"] as const)("rejects a forged %s shared-ball carrier", (templateId) => {
    const event = active(templateId, 1);
    const evidence = cards(event, 1);
    evidence[1] = scoreTournamentRoundCard(event, evidence[1].entrantId, evidence[1].grossByHole.map((gross, index) => gross + Number(index === 0)))!;
    expect(completeTournamentRoundEvidence(event, evidence)).toMatchObject({ ok: false, reason: expect.stringContaining("forged") });
  });

  it("fails closed for missing, duplicate, unsafe, out-of-order, and DNF evidence", () => {
    const event = active("two-v-two-four-ball", 2);
    const evidence = cards(event, 1);
    expect(completeTournamentRoundEvidence(event, evidence.slice(1))).toMatchObject({ ok: false });
    expect(completeTournamentRoundEvidence(event, [evidence[0], ...evidence])).toMatchObject({ ok: false });
    const unsafe = evidence.map((card, index) => index ? card : { ...card, grossByHole: Array(18).fill(Number.MAX_SAFE_INTEGER) });
    expect(() => completeTournamentRoundEvidence(event, unsafe)).not.toThrow();
    expect(completeTournamentRoundEvidence(event, unsafe)).toMatchObject({ ok: false });
    const outOfOrder = structuredClone(event);
    outOfOrder.currentRound = 2;
    expect(completeTournamentRoundEvidence(outOfOrder, evidence)).toMatchObject({ ok: false });

    const alternate = active("two-v-two-alternate-shot", 1);
    const withdrawn = cards(alternate, 1);
    withdrawn[0] = { entrantId: withdrawn[0].entrantId, status: "withdrawn", grossByHole: [], penalties: 0, grossTotal: 0 };
    const completed = completeTournamentRoundEvidence(alternate, withdrawn);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.event.teamStandings?.find((team) => team.teamId === alternate.activationSnapshot!.entrants[0].teamId)).toMatchObject({ status: "dnf", place: null });
    expect(normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [completed.event] }))).events).toHaveLength(1);
  });

  it("rejects forged persisted projections and reconstructs ties without accepting them as authority", () => {
    const event = active("two-person-scramble", 1);
    const tieCards = event.activationSnapshot!.entrants.map((entrant) => {
      const handicap = event.activationSnapshot!.teamHandicaps!.find((candidate) => candidate.teamId === entrant.teamId)!;
      return scoreTournamentRoundCard(
        event,
        entrant.entrantId,
        event.activationSnapshot!.holes.map((hole, index) => hole.par + 1 + handicap.strokesByHole[index]),
      )!;
    });
    const completed = completeTournamentRoundEvidence(event, tieCards);
    if (!completed.ok) throw new Error(completed.reason);
    expect(completed.event.teamStandings?.every((standing) => standing.place === 1 && standing.tied)).toBe(true);
    const forged = structuredClone(completed.event);
    forged.teamStandings![0].netTotal += 1;
    expect(normalizeTournamentCalendar({ version: 2, events: [forged] }).events).toEqual([]);
    const precompletion = structuredClone(active("two-person-scramble", 1));
    precompletion.teamStandings = completed.event.teamStandings;
    expect(normalizeTournamentCalendar({ version: 2, events: [precompletion] }).events).toEqual([]);
  });

  it.each(templates)("rejects tampered %s handicap authority before publishing standings", (templateId) => {
    const event = active(templateId, 1);
    const evidence = cards(event, 1);
    const hostile = structuredClone(event);
    if (templateId === "two-v-two-four-ball") (hostile.activationSnapshot!.teamHandicaps![0].members[0].strokesByHole as number[])[0] += 1;
    else hostile.activationSnapshot!.teamHandicaps![0].playingHandicap += 18;
    expect(completeTournamentRoundEvidence(hostile, evidence)).toMatchObject({ ok: false });
  });

  it("rejects an unbounded legacy handicap without deriving a hostile stroke array", () => {
    const legacy = active("individual", 1);
    const hostile = structuredClone(legacy);
    hostile.activationSnapshot!.version = 1;
    hostile.activationSnapshot!.entrants[0].handicapIndex = Number.MAX_SAFE_INTEGER;
    hostile.activationSnapshot!.entrants[0].playingHandicap = Number.MAX_SAFE_INTEGER;
    expect(normalizeTournamentCalendar({ version: 2, events: [hostile] }).events).toEqual([]);
  });

  it("rejects hostile finite rating and slope inputs before handicap derivation", () => {
    const event = active("two-person-scramble", 1);
    const hostile = structuredClone(event);
    hostile.activationSnapshot!.slope = 1e9;
    expect(completeTournamentRoundEvidence(hostile, cards(event, 1))).toMatchObject({ ok: false });
    expect(normalizeTournamentCalendar({ version: 2, events: [hostile] }).events).toEqual([]);
  });

  it("rejects a hostile entrant playing handicap before participant-card scoring", () => {
    const event = active("two-v-two-four-ball", 1);
    const evidence = cards(event, 1);
    const hostile = structuredClone(event);
    hostile.activationSnapshot!.entrants[0].playingHandicap = 1e9;
    expect(completeTournamentRoundEvidence(hostile, evidence)).toMatchObject({ ok: false, reason: expect.stringContaining("authority") });
  });
});
