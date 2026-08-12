import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";
import { createLiveTournament, planTournamentDay, tournamentForDate } from "./tournaments";
import { normalizeTournamentCalendar } from "./tournamentCalendarValidation";
import { activateTournament, completeTournamentRoundEvidence, previewTournamentActivation, scoreTournamentRoundCard, withdrawTournamentEntrant } from "./tournamentLifecycle";
import { createTournamentEvent } from "./tournamentScheduling";
import { PRO_AM_MEMBER_ALLOWANCE, TOURNAMENT_TEMPLATES } from "./tournamentTemplates";
import type { TournamentEvent, TournamentTemplateId } from "./types";

const course = createTournamentStandardsCourse();
const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 100, runSeed: 735_001 };

function scheduled(templateId: TournamentTemplateId, mutate: Partial<TournamentEvent> = {}): TournamentEvent {
  const created = createTournamentEvent({ course, world, tier: "regional", currentDay: 0, daysAhead: 1, templateId });
  if (!created.ok) throw new Error(created.reason);
  return { ...created.event, ...mutate };
}

describe("ZK-735 reusable tournament team-event authority", () => {
  it("catalogs the five supported contracts and makes undefined combinations explicit", () => {
    expect(Object.keys(TOURNAMENT_TEMPLATES)).toEqual([
      "individual", "two-v-two-four-ball", "two-v-two-alternate-shot", "two-person-scramble", "four-person-pro-am",
    ]);
    expect(TOURNAMENT_TEMPLATES["two-v-two-four-ball"].rules).toMatchObject({ teamSize: 2, teamCount: 2, handicapFormula: "85%-per-player", teamHoleRule: "lowest-net-ball" });
    expect(TOURNAMENT_TEMPLATES["two-v-two-alternate-shot"].rules).toMatchObject({ orderRule: "strict-alternation", teamHoleRule: "single-shared-ball" });
    expect(TOURNAMENT_TEMPLATES["two-person-scramble"].rules).toMatchObject({ ballSelectionRule: "deterministic-best-candidate", teamHoleRule: "selected-team-ball" });
    expect(TOURNAMENT_TEMPLATES["four-person-pro-am"].rules).toMatchObject({ roles: ["pro", "amateur", "amateur", "amateur"], handicapFormula: "85%-per-player-pro-am", teamHoleScoringSupported: false });
  });

  it.each([
    ["individual", "individual", 12, undefined],
    ["two-v-two-four-ball", "four-ball", 4, "85%-per-player"],
    ["two-v-two-alternate-shot", "alternate-shot", 4, "50%-combined"],
    ["two-person-scramble", "scramble", 4, "35%-low+15%-high"],
    ["four-person-pro-am", "pro-am", 12, undefined],
  ] as const)("previews and activates the exact frozen %s contract", (templateId, format, fieldSize, formula) => {
    const event = scheduled(templateId, { roundCount: 2 });
    expect(event.field.every((entrant) => JSON.stringify(Object.keys(entrant)) === JSON.stringify(["id", "name", "archetype", "skill", "teamId", "teamRole", "teamCaptain"]))).toBe(true);
    expect(normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [event] }))).events).toEqual([event]);
    const preview = previewTournamentActivation(event, course);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const activated = activateTournament(event, course);
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(event.field).toHaveLength(fieldSize);
    expect(activated.event.activationSnapshot).toEqual(preview.snapshot);
    expect(preview.snapshot).toMatchObject({ version: 2, templateId, teamFormat: format, scoringMode: templateId === "individual" ? "stableford" : "net-stroke", roundCount: 2, teeSet: event.teeSet, pinRotation: event.pinRotation });
    expect(preview.snapshot.teams.flatMap((team) => team.entrantIds)).toEqual(event.field.map((entrant) => entrant.id));
    expect(preview.snapshot.teams.every((team) => team.captainId === team.entrantIds[0])).toBe(true);
    expect(preview.snapshot.entrants.map((entrant) => entrant.courseHandicapUnrounded).every(Number.isFinite)).toBe(true);
    expect(Object.isFrozen(preview.snapshot)).toBe(true);
    expect(Object.isFrozen(preview.snapshot.teams[0].entrantIds)).toBe(true);
    expect(Object.keys(preview.snapshot)).toHaveLength(preview.snapshot.teamHandicaps ? 22 : 21);
    expect(preview.snapshot.holes.every((hole) => Object.keys(hole).length === 5 && Object.keys(hole.tee).length === 2 && Object.keys(hole.pin).length === 2)).toBe(true);
    expect(preview.snapshot.entrants.every((entrant) => Object.keys(entrant).length === 13)).toBe(true);
    expect(preview.snapshot.teams.every((team) => Object.keys(team).length === 4)).toBe(true);
    expect(activated.event.field.every((entrant) => Object.keys(entrant).length === 8 && Number.isFinite(entrant.handicapIndex))).toBe(true);
    expect(activated.event.rounds?.every((round) => Object.keys(round).length === 5)).toBe(true);
    if (formula) expect(preview.snapshot.teamHandicaps?.every((snapshot) => snapshot.formula === formula)).toBe(true);
    else expect(preview.snapshot.teamHandicaps).toBeUndefined();
    const restored = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [activated.event] }))).events[0];
    expect(restored.activationSnapshot).toEqual(preview.snapshot);
    const withdrawnWorld = withdrawTournamentEntrant({ ...world, tournaments: { version: 2, events: [activated.event] } }, activated.event.id, preview.snapshot.entrants[0].entrantId);
    const withdrawn = withdrawnWorld.tournaments!.events[0];
    expect(Object.keys(withdrawn.rounds![0].scorecards[0])).toEqual(["entrantId", "status", "grossByHole", "penalties", "grossTotal"]);
    expect(normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [withdrawn] }))).events).toHaveLength(1);
  }, 60_000);

  it("normalizes a production-completed v2 event across save/reload and rejects unknown result keys", () => {
    const activated = activateTournament(scheduled("individual", { roundCount: 1 }), course);
    if (!activated.ok) throw new Error(activated.reason);
    const firstId = activated.event.activationSnapshot!.entrants[0].entrantId;
    const withdrawnWorld = withdrawTournamentEntrant({ ...world, tournaments: { version: 2, events: [activated.event] } }, activated.event.id, firstId);
    const withdrawn = withdrawnWorld.tournaments!.events[0];
    const evidence = withdrawn.activationSnapshot!.entrants.slice(1).map((entrant) => scoreTournamentRoundCard(withdrawn, entrant.entrantId, withdrawn.activationSnapshot!.holes.map((hole) => hole.par))!);
    const completed = completeTournamentRoundEvidence(withdrawn, evidence);
    if (!completed.ok) throw new Error(completed.reason);
    expect(completed.event.status).toBe("completed");
    expect(completed.event.results?.every((row) => Object.keys(row).length === 8)).toBe(true);
    expect(Object.keys(completed.event.results![0])).toEqual(["entrantId", "golferId", "name", "archetype", "holesCompleted", "score", "scoreToPar", "finished"]);
    expect(completed.event.rounds?.every((round) => Object.keys(round).length === 6)).toBe(true);
    expect(completed.event.rounds![0].scorecards.filter((card) => card.status === "completed").every((card) => Object.keys(card).length === 7)).toBe(true);
    const saved = JSON.stringify({ version: 2, events: [completed.event] });
    const restored = normalizeTournamentCalendar(JSON.parse(saved));
    expect(restored.events).toHaveLength(1);
    expect(JSON.stringify(restored.events[0])).toBe(JSON.stringify(completed.event));
    const hostile = JSON.parse(saved);
    hostile.events[0].results[0].hostile = true;
    expect(normalizeTournamentCalendar(hostile).events).toEqual([]);
  }, 60_000);

  it("rejects null or missing activated v2 handicap mirrors and null scheduled inputs", () => {
    const activated = activateTournament(scheduled("individual", { roundCount: 1 }), course);
    if (!activated.ok) throw new Error(activated.reason);
    const nullActive = structuredClone(activated.event) as unknown as { field: Array<Record<string, unknown>> };
    nullActive.field[0].handicapIndex = null;
    expect(normalizeTournamentCalendar({ version: 2, events: [nullActive] }).events).toEqual([]);
    const missingActive = structuredClone(activated.event) as unknown as { field: Array<Record<string, unknown>> };
    delete missingActive.field[0].handicapIndex;
    expect(normalizeTournamentCalendar({ version: 2, events: [missingActive] }).events).toEqual([]);
    const nullScheduled = structuredClone(scheduled("two-v-two-four-ball")) as unknown as { field: Array<Record<string, unknown>> };
    nullScheduled.field[0].handicapIndex = null;
    expect(normalizeTournamentCalendar({ version: 2, events: [nullScheduled] }).events).toEqual([]);
    const authored = scheduled("individual");
    authored.field[0].handicapIndex = 4.5;
    const accepted = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [authored] }))).events[0];
    expect(Object.keys(accepted.field[0])).toEqual(["id", "name", "archetype", "skill", "teamId", "teamRole", "teamCaptain", "handicapIndex"]);
    const authoredActivation = activateTournament(accepted, course);
    if (!authoredActivation.ok) throw new Error(authoredActivation.reason);
    expect(normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [authoredActivation.event] }))).events).toHaveLength(1);
  }, 60_000);

  it("freezes team order, roles, handicap inputs, allowances, routing, and accepted overrides", () => {
    const event = scheduled("two-person-scramble", { roundCount: 4 });
    event.field = event.field.map((entrant, index) => ({ ...entrant, handicapIndex: [-4.5, 21.2, 3.4, 12.8][index] }));
    const preview = previewTournamentActivation(event, course);
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.snapshot.teams).toEqual([
      { id: "team-1", entrantIds: event.field.slice(0, 2).map((entrant) => entrant.id), roles: ["partner", "partner"], captainId: event.field[0].id },
      { id: "team-2", entrantIds: event.field.slice(2).map((entrant) => entrant.id), roles: ["partner", "partner"], captainId: event.field[2].id },
    ]);
    expect(preview.snapshot.entrants.map((entrant) => [entrant.handicapIndex, entrant.allowance, entrant.teamOrder])).toEqual([
      [-4.5, .35, 0], [21.2, .15, 1], [3.4, .35, 0], [12.8, .15, 1],
    ]);
    expect(preview.snapshot.appliedOverrides).toEqual({ roundCount: 4, teeSet: event.teeSet, pinRotation: event.pinRotation });
    expect(preview.snapshot.holes.map((hole) => hole.id)).toHaveLength(18);
    const before = JSON.stringify(preview.snapshot);
    event.field[0].handicapIndex = 54;
    event.field.reverse();
    expect(JSON.stringify(preview.snapshot)).toBe(before);
  }, 60_000);

  it("freezes Pro-Am 85% roles and allowances but refuses deferred team scoring", () => {
    const event = scheduled("four-person-pro-am", { roundCount: 1 });
    const activated = activateTournament(event, course);
    if (!activated.ok) throw new Error(activated.reason);
    expect(activated.event.activationSnapshot!.teams.every((team) => JSON.stringify(team.roles) === JSON.stringify(["pro", "amateur", "amateur", "amateur"]))).toBe(true);
    expect(PRO_AM_MEMBER_ALLOWANCE).toBe(.85);
    expect(activated.event.activationSnapshot!.entrants.every((entrant) => entrant.allowance === PRO_AM_MEMBER_ALLOWANCE)).toBe(true);
    const cards = activated.event.activationSnapshot!.entrants.map((entrant) => scoreTournamentRoundCard(activated.event, entrant.entrantId, activated.event.activationSnapshot!.holes.map((hole) => hole.par))!);
    expect(cards.every((card) => card.grossByHole.length === 18)).toBe(true);
    expect(completeTournamentRoundEvidence(activated.event, cards)).toEqual({ ok: false, reason: "Pro-Am field simulation and best-two-net scoring are deferred." });
    const scheduledWorld = { ...world, week: event.scheduledWeek, tournaments: { version: 2 as const, events: [event] } };
    expect(tournamentForDate(scheduledWorld, event.scheduledDay, course)).toBeUndefined();
    expect(planTournamentDay(event, 480, 10)).toEqual([]);
    expect(() => createLiveTournament(event, course)).toThrow("Team tournament field simulation is deferred.");
  }, 60_000);

  it.each(["two-v-two-four-ball", "two-v-two-alternate-shot", "two-person-scramble"] as const)("retains participant gross carriers without inventing %s standings", (templateId) => {
    const activated = activateTournament(scheduled(templateId, { roundCount: 1 }), course);
    if (!activated.ok) throw new Error(activated.reason);
    const cards = activated.event.activationSnapshot!.entrants.map((entrant, entrantIndex) => {
      const gross = activated.event.activationSnapshot!.holes.map((hole, holeIndex) => hole.par + ((entrantIndex + holeIndex) % 2));
      return scoreTournamentRoundCard(activated.event, entrant.entrantId, gross)!;
    });
    expect(cards.map((card) => card.entrantId)).toEqual(activated.event.activationSnapshot!.entrants.map((entrant) => entrant.entrantId));
    expect(cards.every((card) => card.grossByHole.length === 18 && card.grossTotal > 0)).toBe(true);
    expect(completeTournamentRoundEvidence(activated.event, cards)).toEqual({ ok: false, reason: "Team standings require the deferred tournament team-round scorer." });
  }, 60_000);

  it("fails closed for unsupported scoring, malformed teams/roles, and untemplated team events", () => {
    expect(previewTournamentActivation(scheduled("two-v-two-four-ball", { scoringMode: "stableford" }), course)).toEqual({ ok: false, reason: "The requested scoring mode is not defined by this tournament template." });
    expect(previewTournamentActivation(scheduled("two-v-two-four-ball", { field: scheduled("two-v-two-four-ball").field.slice(0, 3) }), course)).toMatchObject({ ok: false, reason: expect.stringContaining("teams of 2") });
    const badRole = scheduled("four-person-pro-am");
    badRole.field = badRole.field.map((entrant, index) => index === 0 ? { ...entrant, teamRole: "amateur" } : entrant);
    expect(previewTournamentActivation(badRole, course)).toMatchObject({ ok: false, reason: expect.stringContaining("roles") });
    const noCaptain = scheduled("two-person-scramble");
    noCaptain.field = noCaptain.field.map((entrant) => ({ ...entrant, teamCaptain: false }));
    expect(previewTournamentActivation(noCaptain, course)).toMatchObject({ ok: false, reason: expect.stringContaining("captain") });
    const duplicateCaptain = scheduled("two-person-scramble");
    duplicateCaptain.field = duplicateCaptain.field.map((entrant, index) => index === 1 ? { ...entrant, teamCaptain: true } : entrant);
    expect(previewTournamentActivation(duplicateCaptain, course)).toMatchObject({ ok: false, reason: expect.stringContaining("captain") });
    expect(previewTournamentActivation({ ...scheduled("individual"), templateId: undefined, teamFormat: "four-ball" }, course)).toEqual({ ok: false, reason: "Team tournaments require a reusable tournament template." });
  }, 60_000);

  it("rejects hostile persisted formula, allowance, role, route, and override mutations", () => {
    const activated = activateTournament(scheduled("two-v-two-four-ball", { roundCount: 1 }), course);
    if (!activated.ok) throw new Error(activated.reason);
    const raw = JSON.parse(JSON.stringify({ version: 2, events: [activated.event] }));
    const mutations = [
      (copy: typeof raw) => { copy.events[0].activationSnapshot.teamHandicaps[0].members[0].allowance = .9; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.teamHandicaps[0].hostile = true; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.teamHandicaps[0].members[0].hostile = true; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.formatRules.hostile = true; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.entrants[0].courseHandicapUnrounded += 1; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.teams[0].roles[0] = "amateur"; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.holes[0].strokeIndex = 2; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.appliedOverrides.roundCount = 2; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.teams[0].captainId = copy.events[0].activationSnapshot.teams[1].entrantIds[0]; },
      (copy: typeof raw) => { copy.events[0].activationSnapshot.entrants[0].teamCaptain = false; },
      (copy: typeof raw) => { copy.events[0].teamFormat = "individual"; },
      (copy: typeof raw) => { copy.events[0].scoringMode = "stableford"; },
      (copy: typeof raw) => { copy.events[0].courseId = "forged-course"; },
      (copy: typeof raw) => { copy.events[0].holeIds.reverse(); },
      (copy: typeof raw) => { copy.events[0].teeSet = "forward"; },
      (copy: typeof raw) => { copy.events[0].pinRotation = "C"; },
      (copy: typeof raw) => { copy.events[0].roundCount = 2; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(raw);
      mutate(copy);
      expect(normalizeTournamentCalendar(copy).events).toEqual([]);
    }
  }, 60_000);

  it("cannot open legacy field simulation from a tampered active team mirror", () => {
    const activated = activateTournament(scheduled("two-v-two-four-ball", { roundCount: 1 }), course);
    if (!activated.ok) throw new Error(activated.reason);
    const tampered = { ...activated.event, teamFormat: "individual" as const, scoringMode: "stableford" as const };
    expect(normalizeTournamentCalendar({ version: 2, events: [tampered] }).events).toEqual([]);
    expect(() => createLiveTournament(tampered, course)).toThrow("Team tournament field simulation is deferred.");
  }, 60_000);

  it("rejects duplicate or forged active field mirrors and projects pre-normalization live identity from the snapshot", () => {
    const team = activateTournament(scheduled("two-v-two-four-ball", { roundCount: 1 }), course);
    if (!team.ok) throw new Error(team.reason);
    const forgedTeamEntrant = { ...team.event.field[0], name: "Forged Captain" };
    const hostileTeam = { ...team.event, field: Array.from({ length: team.event.field.length }, () => ({ ...forgedTeamEntrant })) };
    expect(normalizeTournamentCalendar({ version: 2, events: [hostileTeam] }).events).toEqual([]);
    expect(() => createLiveTournament(hostileTeam, course)).toThrow("Team tournament field simulation is deferred.");

    const individual = activateTournament(scheduled("individual", { roundCount: 1 }), course);
    if (!individual.ok) throw new Error(individual.reason);
    const forgedIndividual = { ...individual.event, field: Array.from({ length: individual.event.field.length }, () => ({ ...individual.event.field[0], name: "Forged Golfer" })) };
    expect(normalizeTournamentCalendar({ version: 2, events: [forgedIndividual] }).events).toEqual([]);
    const live = createLiveTournament(forgedIndividual, course);
    expect(new Set(live.standings.map((standing) => standing.entrantId)).size).toBe(individual.event.activationSnapshot!.entrants.length);
    expect(live.standings.map((standing) => standing.name)).toEqual(individual.event.activationSnapshot!.entrants.map((entrant) => entrant.name));
    expect(live.standings.some((standing) => standing.name === "Forged Golfer")).toBe(false);
  }, 60_000);

  it("rejects a coherently moved captain that violates the frozen first-roster rule", () => {
    const activated = activateTournament(scheduled("two-v-two-four-ball", { roundCount: 1 }), course);
    if (!activated.ok) throw new Error(activated.reason);
    const hostile = structuredClone(activated.event);
    const team = hostile.activationSnapshot!.teams[0];
    team.captainId = team.entrantIds[1];
    hostile.activationSnapshot!.entrants[0].teamCaptain = false;
    hostile.activationSnapshot!.entrants[1].teamCaptain = true;
    hostile.field[0].teamCaptain = false;
    hostile.field[1].teamCaptain = true;
    expect(normalizeTournamentCalendar({ version: 2, events: [hostile] }).events).toEqual([]);
  }, 60_000);

  it("recomputes individual and Pro-Am handicap chains from frozen inputs", () => {
    const individual = activateTournament(scheduled("individual", { roundCount: 1 }), course);
    if (!individual.ok) throw new Error(individual.reason);
    const forgedIndividual = structuredClone(individual.event);
    forgedIndividual.activationSnapshot!.entrants[0].playingHandicap += 1;
    expect(normalizeTournamentCalendar({ version: 2, events: [forgedIndividual] }).events).toEqual([]);

    const proAm = activateTournament(scheduled("four-person-pro-am", { roundCount: 1 }), course);
    if (!proAm.ok) throw new Error(proAm.reason);
    const forgedProAm = structuredClone(proAm.event);
    const entrant = forgedProAm.activationSnapshot!.entrants[0];
    entrant.courseHandicapUnrounded += 113;
    entrant.playingHandicap = 96;
    entrant.strokesByHole = Array(18).fill(5);
    expect(normalizeTournamentCalendar({ version: 2, events: [forgedProAm] }).events).toEqual([]);
  }, 60_000);

  it("rejects forged aggregate par and non-canonical applied override keys", () => {
    const individual = activateTournament(scheduled("individual", { roundCount: 1 }), course);
    if (!individual.ok) throw new Error(individual.reason);
    const forgedPar = structuredClone(individual.event);
    forgedPar.activationSnapshot!.holes[0].par += 1;
    expect(normalizeTournamentCalendar({ version: 2, events: [forgedPar] }).events).toEqual([]);

    const team = activateTournament(scheduled("two-v-two-four-ball", { roundCount: 1 }), course);
    if (!team.ok) throw new Error(team.reason);
    const extra = structuredClone(team.event);
    Object.assign(extra.activationSnapshot!.appliedOverrides!, { scoringMode: "net-stroke" });
    expect(normalizeTournamentCalendar({ version: 2, events: [extra] }).events).toEqual([]);
    const missing = JSON.parse(JSON.stringify(team.event));
    delete missing.activationSnapshot.appliedOverrides.roundCount;
    expect(normalizeTournamentCalendar({ version: 2, events: [missing] }).events).toEqual([]);
  }, 60_000);

  it.each(Object.keys(TOURNAMENT_TEMPLATES) as TournamentTemplateId[])("rejects unknown scheduled and active v2 authority keys for %s", (templateId) => {
    const scheduledEvent = scheduled(templateId, { roundCount: 1 });
    const hostileScheduled = structuredClone(scheduledEvent) as unknown as { field: Array<Record<string, unknown>> };
    hostileScheduled.field[0].hostile = true;
    expect(normalizeTournamentCalendar({ version: 2, events: [hostileScheduled] }).events).toEqual([]);
    const accepted = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [scheduledEvent] }))).events[0];
    const activated = activateTournament(accepted, course);
    if (!activated.ok) throw new Error(activated.reason);
    expect(normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [activated.event] }))).events).toHaveLength(1);
    const raw = JSON.parse(JSON.stringify(activated.event));
    for (const mutate of [
      (copy: typeof raw) => { copy.activationSnapshot.hostile = true; },
      (copy: typeof raw) => { copy.activationSnapshot.holes[0].hostile = true; },
      (copy: typeof raw) => { copy.activationSnapshot.holes[0].tee.hostile = true; },
      (copy: typeof raw) => { copy.activationSnapshot.entrants[0].hostile = true; },
      (copy: typeof raw) => { copy.activationSnapshot.teams[0].hostile = true; },
      (copy: typeof raw) => { copy.rounds[0].hostile = true; },
    ]) {
      const copy = structuredClone(raw);
      mutate(copy);
      expect(normalizeTournamentCalendar({ version: 2, events: [copy] }).events).toEqual([]);
    }
  }, 60_000);

  it("returns a closed result for an unknown runtime template ID", () => {
    const created = createTournamentEvent({ course, world, tier: "regional", currentDay: 0, daysAhead: 1, templateId: "hostile-template" as TournamentTemplateId });
    expect(created).toEqual({ ok: false, reason: "Tournament template 'hostile-template' is not supported." });
  }, 60_000);

  it("drops unsupported or malformed scheduled template carriers while retaining valid configured events", () => {
    const event = scheduled("two-v-two-alternate-shot");
    expect(normalizeTournamentCalendar({ version: 2, events: [event] }).events).toEqual([event]);
    expect(normalizeTournamentCalendar({ version: 2, events: [{ ...event, scoringMode: "stableford" }] }).events).toEqual([]);
    expect(normalizeTournamentCalendar({ version: 2, events: [{ ...event, templateId: "unknown-template" }] }).events).toEqual([]);
    expect(normalizeTournamentCalendar({ version: 2, events: [{ ...event, field: event.field.map((entrant, index) => index === 1 ? { ...entrant, teamRole: "amateur" } : entrant) }] }).events).toEqual([]);
  }, 60_000);

  it("preserves the exact valid legacy individual event bytes", () => {
    const legacy = scheduled("individual");
    delete legacy.templateId; delete legacy.teamFormat; delete legacy.scoringMode;
    legacy.field = legacy.field.map(({ teamId: _teamId, teamRole: _teamRole, teamCaptain: _teamCaptain, ...entrant }) => entrant);
    const activated = activateTournament(legacy, course);
    if (!activated.ok) throw new Error(activated.reason);
    expect(activated.event.activationSnapshot?.version).toBe(1);
    const snapshot = activated.event.activationSnapshot!;
    expect(JSON.stringify({
      snapshot: Object.keys(snapshot),
      entrant: Object.keys(snapshot.entrants[0]),
      team: Object.keys(snapshot.teams[0]),
    })).toBe('{"snapshot":["version","activationId","activatedWeek","activatedDay","scoringMode","teamFormat","courseId","courseName","rating","slope","par","teeSet","pinRotation","holes","entrants","teams"],"entrant":["entrantId","name","archetype","skill","teamId","handicapIndex","allowance","courseHandicapUnrounded","playingHandicap","strokesByHole"],"team":["id","entrantIds"]}');
    const bytes = JSON.stringify(activated.event);
    const restored = normalizeTournamentCalendar(JSON.parse(JSON.stringify({ version: 2, events: [activated.event] }))).events[0];
    expect(JSON.stringify(restored)).toBe(bytes);
  }, 60_000);

  it("rejects every v2-only metadata carrier smuggled into a legacy lifecycle event", () => {
    const legacy = scheduled("individual");
    delete legacy.templateId; delete legacy.teamFormat; delete legacy.scoringMode;
    legacy.field = legacy.field.map(({ teamId: _teamId, teamRole: _teamRole, teamCaptain: _teamCaptain, ...entrant }) => entrant);
    const activated = activateTournament(legacy, course);
    if (!activated.ok) throw new Error(activated.reason);
    const raw = JSON.parse(JSON.stringify(activated.event));
    const mutations: Array<(copy: typeof raw) => void> = [
      (copy) => { copy.templateId = "individual"; },
      (copy) => { copy.activationSnapshot.templateId = "individual"; },
      (copy) => { copy.activationSnapshot.roundCount = copy.roundCount; },
      (copy) => { copy.activationSnapshot.supportedOverrides = []; },
      (copy) => { copy.activationSnapshot.appliedOverrides = {}; },
      (copy) => { copy.activationSnapshot.formatRules = TOURNAMENT_TEMPLATES.individual.rules; },
      (copy) => { copy.activationSnapshot.teamHandicaps = []; },
      (copy) => { Object.assign(copy.activationSnapshot.entrants[0], { teamRole: "individual", teamOrder: 0, teamCaptain: true }); },
      (copy) => { Object.assign(copy.activationSnapshot.teams[0], { roles: ["individual"], captainId: copy.activationSnapshot.teams[0].entrantIds[0] }); },
      (copy) => { Object.assign(copy.field[0], { teamRole: "individual", teamOrder: 0, teamCaptain: true }); },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(raw);
      mutate(copy);
      expect(normalizeTournamentCalendar({ version: 2, events: [copy] }).events).toEqual([]);
    }
  }, 60_000);
});
