import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../game/models/defaults";
import { createTournamentStandardsCourse } from "../game/testing/referenceCourse";
import { createTournamentEvent } from "../game/tournaments/tournamentScheduling";
import { activateTournament, completeTournamentRoundEvidence, scoreTournamentRoundCard } from "../game/tournaments/tournamentLifecycle";
import { normalizeTournamentCalendar } from "../game/tournaments/tournamentCalendarValidation";
import { reconstructIndividualTournamentStandings } from "../game/tournaments/tournamentStandings";
import { reconstructTournamentTeamEvidence } from "../game/tournaments/tournamentTeamRound";
import { reconstructProAmTournamentEvidence, scoreProAmRoundEvidence } from "../game/tournaments/proAmField";
import type { TournamentEvent, TournamentRoundScorecard, TournamentScoringMode, TournamentTemplateId } from "../game/tournaments/types";
import { presentPlayerTournamentEvent } from "./playerTournamentPresentation";

const course = createTournamentStandardsCourse();
const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 100, runSeed: 736_001 };
const templates: readonly TournamentTemplateId[] = ["individual", "two-v-two-four-ball", "two-v-two-alternate-shot", "two-person-scramble", "four-person-pro-am"];

function scheduled(templateId: TournamentTemplateId = "individual", roundCount = 2): TournamentEvent {
  const result = createTournamentEvent({ course, world, tier: "regional", currentDay: 0, daysAhead: 1, templateId });
  if (!result.ok) throw new Error(result.reason);
  return { ...result.event, roundCount };
}

function active(templateId: TournamentTemplateId = "individual", roundCount = 2, scoringMode?: TournamentScoringMode): TournamentEvent {
  const event = scheduled(templateId, roundCount);
  const result = activateTournament({ ...event, ...(scoringMode ? { scoringMode } : {}) }, course);
  if (!result.ok) throw new Error(result.reason);
  return result.event;
}

function cards(event: TournamentEvent, adjustment = 0, tie = false): TournamentRoundScorecard[] {
  const snapshot = event.activationSnapshot!;
  return snapshot.entrants.map((entrant, index) => {
    const teamIndex = snapshot.teams.findIndex((team) => team.id === entrant.teamId);
    const shared = ["alternate-shot", "scramble"].includes(snapshot.teamFormat);
    const handicap = snapshot.teamHandicaps?.find((team) => team.teamId === entrant.teamId);
    const gross = snapshot.holes.map((hole, holeIndex) => Math.max(1, hole.par + adjustment
      + (tie ? shared ? handicap!.strokesByHole[holeIndex] : entrant.strokesByHole[holeIndex]
        : shared ? teamIndex : (index + holeIndex) % 3)));
    const card = scoreTournamentRoundCard(event, entrant.entrantId, gross);
    if (!card) throw new Error(`Could not score ${entrant.entrantId}`);
    return card;
  });
}

function complete(event: TournamentEvent, evidence = cards(event)): TournamentEvent {
  const result = completeTournamentRoundEvidence(event, evidence);
  if (!result.ok) throw new Error(result.reason);
  return result.event;
}

function withdrawal(entrantId: string): TournamentRoundScorecard {
  return { entrantId, status: "withdrawn", grossByHole: [], penalties: 0, grossTotal: 0 };
}

function assertParity(event: TournamentEvent): void {
  const model = presentPlayerTournamentEvent(event);
  expect(model.setup.phase).toBe("frozen");
  expect(model.competition.state).toBe("canonical");
  if (model.competition.state !== "canonical") throw new Error(JSON.stringify(model));
  const format = event.activationSnapshot!.teamFormat;
  if (format === "individual") {
    const canonical = reconstructIndividualTournamentStandings(event);
    if (!canonical.ok) throw new Error(canonical.reason);
    expect(model.competition.standings).toEqual(canonical.standings);
    expect(model.competition.winnerNames).toEqual(canonical.winnerNames);
    expect(model.competition.winnerIds).toEqual(canonical.standings.filter((row) => row.status === "completed" && row.place === 1).map((row) => row.competitorId));
  } else {
    const canonical = format === "pro-am" ? reconstructProAmTournamentEvidence(event) : reconstructTournamentTeamEvidence(event);
    if (!canonical.ok) throw new Error(canonical.reason);
    expect(model.competition.standings).toEqual(canonical.evidence.standings);
    expect(model.competition.winnerIds).toEqual(canonical.evidence.winnerTeamIds);
  }
  expect(model.competition.participantRounds).toEqual(event.rounds);
  expect(model.schedule.completedRoundCount).toBe(event.rounds!.filter((round) => round.status === "completed").length);
  expect(model.schedule.roundCount).toBe(event.roundCount);
  expect(model.schedule.currentRound).toBe(event.currentRound);
  expect(model.schedule.rounds).toEqual(event.rounds!.map(({ roundNumber, scheduledWeek, scheduledDay, status }) => ({ roundNumber, scheduledWeek, scheduledDay, status })));
}

describe("Player tournament presentation from frozen evidence", () => {
  it.each(templates.flatMap((template) => [1, 2, 3, 4].map((count) => [template, count] as const)))(
    "preserves exact cumulative %s authority for %i rounds and JSON reload",
    (template, count) => {
      let event = active(template, count);
      expect(presentPlayerTournamentEvent(event).competition).toEqual({ state: "pending", reason: "no-completed-rounds" });
      for (let round = 1; round <= count; round += 1) {
        event = complete(event, cards(event, round));
        assertParity(event);
        const model = presentPlayerTournamentEvent(event);
        if (model.competition.state !== "canonical") throw new Error("Expected canonical evidence");
        if (round < count) {
          expect(model.competition.winnerIds).toEqual([]);
          expect(model.competition.winnerNames).toEqual([]);
          expect(model.competition.standings.every((standing) => standing.status === "active")).toBe(true);
        }
        const reload = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [event] }))).events[0];
        expect(reload).toBeDefined();
        assertParity(reload);
        // JSON intentionally represents signed zero as zero; compare persisted bytes.
        expect(JSON.stringify(presentPlayerTournamentEvent(reload))).toBe(JSON.stringify(model));
      }
    }, 60_000,
  );

  it.each(["stableford", "net-stroke", "gross-stroke"] as const)("retains individual %s ranking totals and ties", (scoring) => {
    const event = active("individual", 1, scoring);
    const completed = complete(event, cards(event, 0, true));
    assertParity(completed);
    const competition = presentPlayerTournamentEvent(completed).competition;
    if (competition.state !== "canonical") throw new Error("Expected standings");
    expect(competition.standings.every((row) => row.place === 1 && row.tied)).toBe(true);
    expect(competition.standings[0].occupiedPlaces).toHaveLength(completed.field.length);
    expect(competition.winnerIds).toHaveLength(completed.field.length);
  }, 60_000);

  it.each(["two-v-two-four-ball", "two-v-two-alternate-shot", "two-person-scramble"] as const)("retains tied occupied places for %s", (template) => {
    const event = active(template, 1);
    const completed = complete(event, cards(event, 1, true));
    assertParity(completed);
    const competition = presentPlayerTournamentEvent(completed).competition;
    if (competition.state !== "canonical") throw new Error("Expected standings");
    expect(competition.standings.map((row) => [row.place, row.tied, row.occupiedPlaces])).toEqual([[1, true, [1, 2]], [1, true, [1, 2]]]);
    expect(competition.winnerIds).toHaveLength(2);
  }, 60_000);

  it("exposes Pro-Am counting entrants, amateur roles, every hole and round exactly", () => {
    let event = active("four-person-pro-am", 2);
    event = complete(event);
    event = complete(event, cards(event, 1));
    const competition = presentPlayerTournamentEvent(event).competition;
    if (competition.state !== "canonical") throw new Error("Expected counting evidence");
    expect(competition.proAmRounds).toHaveLength(2);
    for (const round of event.rounds!) {
      const canonical = scoreProAmRoundEvidence(event.activationSnapshot!, round.roundNumber, round.scorecards);
      if (!canonical.ok) throw new Error(canonical.reason);
      expect(competition.proAmRounds[round.roundNumber - 1]).toEqual(canonical.evidence);
    }
    for (const round of competition.proAmRounds) for (const team of round.teams) for (const hole of team.holes) {
      expect(hole.countedEntrantIds).toHaveLength(2);
      expect(hole.members.some((member) => hole.countedEntrantIds.includes(member.entrantId) && member.role === "amateur")).toBe(true);
    }
  }, 60_000);

  it("preserves every tied Pro-Am team as an exact winner without choosing a single name", () => {
    const event = active("four-person-pro-am", 1);
    const completed = complete(event, cards(event, 0, true));
    assertParity(completed);
    const competition = presentPlayerTournamentEvent(completed).competition;
    if (competition.state !== "canonical") throw new Error("Expected team ties");
    const places = event.activationSnapshot!.teams.map((_, index) => index + 1);
    expect(competition.standings.every((row) => row.place === 1 && row.tied)).toBe(true);
    expect(competition.standings.every((row) => JSON.stringify(row.occupiedPlaces) === JSON.stringify(places))).toBe(true);
    expect(competition.winnerIds).toHaveLength(places.length);
    expect(competition.winnerNames).toEqual([]);
  }, 60_000);

  it("keeps a Pro-Am pro-only round DNF with no invented counting selections", () => {
    const event = active("four-person-pro-am", 1);
    const amateurIds = event.activationSnapshot!.teams[0].entrantIds.slice(1);
    const completed = complete(event, cards(event).map((card) => amateurIds.includes(card.entrantId) ? withdrawal(card.entrantId) : card));
    assertParity(completed);
    const competition = presentPlayerTournamentEvent(completed).competition;
    if (competition.state !== "canonical") throw new Error("Expected DNF evidence");
    expect(competition.proAmRounds[0].teams[0].holes.every((hole) => hole.status === "dnf" && hole.countedEntrantIds.length === 0)).toBe(true);
    expect(competition.standings.find((row) => row.competitorId === event.activationSnapshot!.teams[0].id)).toMatchObject({ status: "dnf", place: null, scoreTotal: null });
  }, 60_000);

  it("keeps a four-ball team ranked when its partner withdraws and a valid ball remains", () => {
    const event = active("two-v-two-four-ball", 1);
    const completed = complete(event, cards(event).map((card, index) => index ? card : withdrawal(card.entrantId)));
    assertParity(completed);
    const competition = presentPlayerTournamentEvent(completed).competition;
    if (competition.state !== "canonical") throw new Error("Expected surviving team evidence");
    expect(competition.standings.find((row) => row.competitorId === event.activationSnapshot!.teams[0].id)).toMatchObject({ status: "completed", rankEligible: true });
    expect(competition.participantRounds[0].scorecards[0].status).toBe("withdrawn");
  }, 60_000);

  it.each(templates)("preserves withdrawn participants and unranked/DNF %s evidence", (template) => {
    const event = active(template, 1);
    const evidence = cards(event).map((card, index) => index < event.activationSnapshot!.teams[0].entrantIds.length
      ? withdrawal(card.entrantId) : card);
    const completed = complete(event, evidence);
    assertParity(completed);
    const competition = presentPlayerTournamentEvent(completed).competition;
    if (competition.state !== "canonical") throw new Error("Expected evidence");
    expect(competition.standings.some((row) => row.place === null && row.scoreTotal === null
      && ["withdrawn", "dnf"].includes(row.status) && !row.rankEligible && !row.prizeEligible)).toBe(true);
    expect(competition.participantRounds[0].scorecards[0]).toEqual(evidence[0]);
  }, 60_000);

  it("keeps all-withdrawn standings unplaced without a winner", () => {
    const event = active("individual", 1);
    const completed = complete(event, event.activationSnapshot!.entrants.map((entrant) => withdrawal(entrant.entrantId)));
    assertParity(completed);
    const competition = presentPlayerTournamentEvent(completed).competition;
    if (competition.state !== "canonical") throw new Error("Expected evidence");
    expect(competition.winnerIds).toEqual([]);
    expect(competition.winnerNames).toEqual([]);
  });

  it("uses only actual planned data and contracted hosting economics", () => {
    const event = scheduled();
    const model = presentPlayerTournamentEvent(event);
    expect(model.setup).toMatchObject({ phase: "planned", courseId: event.courseId ?? null, courseName: event.courseName,
      qualification: event.qualificationSnapshot, roster: event.field });
    expect(model.hosting).toEqual({ bookingCost: event.bookingCost, revenueAward: event.revenueAward, reputationAward: event.reputationAward });
    expect(model.schedule.rounds).toEqual([]);
    expect(model.schedule.currentRound).toBeNull();
    const minimal = { ...event, teeSet: undefined, pinRotation: undefined, scoringMode: undefined, teamFormat: undefined,
      qualificationSnapshot: undefined, currentQualification: event.qualificationSnapshot, roundCount: undefined };
    const minimalModel = presentPlayerTournamentEvent(minimal);
    expect(minimalModel.setup).toMatchObject({ phase: "planned", teeSet: null, pinRotation: null, scoringMode: null, teamFormat: null, qualification: null });
    expect(minimalModel.schedule.roundCount).toBeNull();
    expect(JSON.stringify(model)).not.toMatch(/pursePlan|playerPrize|trophy|postingState/);
  });

  it.each(templates)("freezes %s setup and ignores later mutable aliases and cached projections", (template) => {
    const completed = complete(active(template, 1));
    const baseline = presentPlayerTournamentEvent(completed);
    const drift = structuredClone(completed);
    Object.assign(drift, { courseId: "later-course", courseName: "Later course", teeSet: "forward", pinRotation: "C",
      scoringMode: "gross-stroke", teamFormat: "individual", templateId: "individual", holeIds: ["later-hole"],
      field: [{ id: "forged", name: "Forged", archetype: "casual", skill: 0 }], results: [],
      teamStandings: [{ teamId: "forged", netTotal: -9999, place: 1 }], winnerTeamIds: ["forged"], winnerNames: ["Forged"], winnerName: "Forged" });
    expect(presentPlayerTournamentEvent(drift)).toEqual(baseline);
    expect(baseline.setup).toEqual({ phase: "frozen", snapshot: completed.activationSnapshot });
    // The real calendar boundary may discard forged projections before a UI receives an event.
    expect(normalizeTournamentCalendar({ version: 2, events: [drift] }).events).toEqual([]);
  }, 60_000);

  it.each(templates)("fails closed for missing, duplicate, extra and forged %s participant gross", (template) => {
    const event = complete(active(template, 1));
    const honest = event.rounds![0];
    const variations = [honest.scorecards.slice(1), [honest.scorecards[0], ...honest.scorecards],
      [...honest.scorecards, { ...honest.scorecards[0], entrantId: "unknown" }],
      honest.scorecards.map((card, index) => index ? card : { ...card, grossTotal: card.grossTotal + 1 }),
      honest.scorecards.map((card, index) => index ? card : { ...card, netTotal: -9999 }),
      honest.scorecards.map((card, index) => index ? card : { ...card, stablefordPoints: 9999 }),
      honest.scorecards.map((card, index) => index ? card : { ...card, grossByHole: [] })];
    for (const scorecards of variations) {
      const malformed = { ...event, rounds: [{ ...honest, scorecards }] };
      expect(() => presentPlayerTournamentEvent(malformed)).not.toThrow();
      expect(presentPlayerTournamentEvent(malformed).competition.state).toBe("unavailable");
    }
  }, 60_000);

  it("distinguishes legitimate pending/interrupted evidence from malformed metadata and missing activation", () => {
    const event = active();
    const pending = presentPlayerTournamentEvent(event);
    expect(pending.setup.phase).toBe("frozen");
    expect(pending.competition.state).toBe("pending");
    const interrupted = { ...event, rounds: event.rounds!.map((round, index) => index ? round : { ...round, status: "interrupted" as const }) };
    expect(presentPlayerTournamentEvent(interrupted).schedule.rounds[0].status).toBe("interrupted");
    expect(presentPlayerTournamentEvent(interrupted).competition.state).toBe("pending");
    const completed = complete(event);
    const hostile = [
      { ...event, activationSnapshot: undefined },
      { ...completed, status: "scheduled", activationSnapshot: undefined },
      { ...event, activationSnapshot: { ...event.activationSnapshot!, holes: "bad" } },
      { ...event, activationSnapshot: { ...event.activationSnapshot!, entrants: [null] } },
      { ...event, activationSnapshot: { ...event.activationSnapshot!, teams: "bad" } },
      { ...event, rounds: undefined },
      { ...event, rounds: "bad" },
      { ...event, currentRound: 3 },
      { ...completed, roundCount: 1 },
      { ...completed, rounds: completed.rounds!.map((round, index) => index ? round : { ...round, roundNumber: 2 }) },
      { ...completed, status: "completed" },
      { ...completed, activationSnapshot: { ...completed.activationSnapshot!, roundCount: 1 } },
    ];
    for (const malformed of hostile) {
      expect(() => presentPlayerTournamentEvent(malformed as never)).not.toThrow();
      expect(presentPlayerTournamentEvent(malformed as never).competition.state).toBe("unavailable");
    }
    const forgedHandicap = structuredClone(completed);
    forgedHandicap.activationSnapshot!.entrants[0].playingHandicap += 1;
    expect(presentPlayerTournamentEvent(forgedHandicap).competition.state).toBe("unavailable");
  }, 60_000);

  it("keeps historical results recorded with no modern count, rules or fabricated place", () => {
    const event: TournamentEvent = { id: "historical", name: "Old Open", tier: "local", scheduledWeek: 1, scheduledDay: 2,
      status: "completed", bookingCost: 100, revenueAward: 200, reputationAward: 1,
      field: [{ id: "a", name: "A", archetype: "casual", skill: .5 }],
      results: [{ entrantId: "a", golferId: 1, name: "A", archetype: "casual", holesCompleted: 9, score: 40, scoreToPar: 4, finished: true }], winnerName: "A" };
    const model = presentPlayerTournamentEvent(event);
    expect(model.setup).toEqual({ phase: "legacy" });
    expect(model.competition).toEqual({ state: "recorded", results: event.results });
    expect(model.schedule).toMatchObject({ roundCount: null, currentRound: null, rounds: [] });
    expect(model.competition).not.toHaveProperty("standings");
    expect(model.competition).not.toHaveProperty("winnerIds");
    expect(presentPlayerTournamentEvent({ ...event, results: undefined }).competition.state).toBe("unavailable");
  });

  it("supports genuine version-one frozen individual evidence without inventing format rules", () => {
    const created = createTournamentEvent({ course, world, tier: "local", currentDay: 0, daysAhead: 1 });
    if (!created.ok) throw new Error(created.reason);
    const activated = activateTournament(created.event, course);
    if (!activated.ok) throw new Error(activated.reason);
    expect(activated.event.activationSnapshot!.version).toBe(1);
    const event = complete(activated.event);
    assertParity(event);
    const model = presentPlayerTournamentEvent(event);
    if (model.setup.phase !== "frozen") throw new Error("Expected frozen setup");
    expect(model.setup.snapshot.formatRules).toBeUndefined();
    expect(model.setup.snapshot.roundCount).toBeUndefined();
  });

  it.each(["individual", "two-person-scramble", "four-person-pro-am"] as const)("detaches and freezes every %s display alias without mutating input", (template) => {
    const event = structuredClone(complete(active(template, 1)));
    const before = structuredClone(event);
    const model = presentPlayerTournamentEvent(event);
    expect(event).toEqual(before);
    expect(Object.isFrozen(event)).toBe(false);
    if (model.setup.phase !== "frozen" || model.competition.state !== "canonical") throw new Error("Expected frozen output");
    expect(model.setup.snapshot).not.toBe(event.activationSnapshot);
    expect(model.competition.participantRounds).not.toBe(event.rounds);
    expect(() => { (model.setup as { snapshot: { courseName: string } }).snapshot.courseName = "alias-write"; }).toThrow();
    expect(() => { (model.competition as unknown as { participantRounds: { scorecards: { grossByHole: number[] }[] }[] }).participantRounds[0].scorecards[0].grossByHole[0] = 9999; }).toThrow();
    expect(() => { (model.competition as unknown as { standings: { occupiedPlaces: number[] }[] }).standings[0].occupiedPlaces.push(9999); }).toThrow();
    expect(event).toEqual(before);
    event.activationSnapshot!.entrants[0].name = "later input edit";
    expect(model.setup.snapshot.entrants[0].name).toBe(before.activationSnapshot!.entrants[0].name);
  }, 60_000);

  it("does not introduce scoring formulas, mutable course dependencies or action/economy authorities", () => {
    const source = readFileSync(new URL("./playerTournamentPresentation.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:playerProSettlement|competition\/(?:scoring|handicap)|models\/defaults|courseLayouts)["']/);
    expect(source).not.toMatch(/(?:scoreStrokePlay|scoreTeamHole|scoreTeamNetHole|resolveTournamentStandings|onTournament|pursePlan|Math\.(?:min|max|round|floor))\s*\(/);
    expect(source).toContain("reconstructIndividualTournamentStandings(event)");
    expect(source).toContain("reconstructTournamentTeamEvidence(event)");
    expect(source).toContain("reconstructProAmTournamentEvidence(event)");
  });
});
