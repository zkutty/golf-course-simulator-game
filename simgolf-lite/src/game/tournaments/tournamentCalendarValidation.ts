import type { Course } from "../models/types";
import { activeCourseLayout, courseForLayout } from "../models/courseLayouts";
import { captureTeamHandicapSnapshots } from "../competition/teamAuthority";
import { courseHandicapUnrounded, playingHandicapFromUnrounded, strokesByHole } from "../competition/handicap";
import { PRO_AM_MEMBER_ALLOWANCE, tournamentTemplate } from "./tournamentTemplates";
import type { TournamentCalendar, TournamentEvent, TournamentRoundScorecard } from "./types";
import { projectProAmTeamStandings, reconstructProAmTournamentEvidence } from "./proAmField";

const INDIVIDUAL = "individual";
const ACTIVE = "active";
const COMPLETED = "completed";
const INTERRUPTED = "interrupted";
const ROUND_STATES = ["scheduled", ACTIVE, INTERRUPTED, COMPLETED] as const;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const finiteNumber = (value: unknown): value is number => Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isInteger(value);
const array = Array.isArray;
const keys = Object.keys;
const sized = (value: object, size: number) => keys(value).length === size;
const wrongSize = (values: readonly object[], size: number) => values.some((value) => !sized(value, size));

function validLegacyWinnerNames(event: TournamentEvent): boolean {
  const names = event.winnerNames;
  return names === undefined || array(names) && names.length > 0 && names.every((name) => typeof name === "string" && name.length > 0)
    && event.winnerName === names[0];
}

function validLifecycleEvent(event: TournamentEvent): boolean {
  const s = event.activationSnapshot;
  if ((event.teamStandings !== undefined || event.winnerTeamIds !== undefined) && (!s || s.teamFormat !== "pro-am")) return false;
  if (!s) {
    if (!validLegacyWinnerNames(event)) return false;
    if (event.status === ACTIVE) return false;
    if (!event.templateId) return (event.teamFormat ?? INDIVIDUAL) === INDIVIDUAL;
    let template;
    try { template = tournamentTemplate(event.templateId); } catch { return false; }
    if (event.teamFormat !== template.teamFormat || !event.scoringMode || !template.scoringModes.includes(event.scoringMode)) return false;
    const grouped = new Map<string, TournamentEvent["field"]>();
    for (const entrant of event.field) {
      if (!entrant.teamId || !entrant.teamRole || typeof entrant.teamCaptain !== "boolean" || !sized(entrant, 7 + Number("handicapIndex" in entrant))) return false;
      grouped.set(entrant.teamId, [...(grouped.get(entrant.teamId) ?? []), entrant]);
    }
    const groups = [...grouped.values()];
    return (template.rules.teamCount === "field" || groups.length === template.rules.teamCount)
      && groups.every((members) => members.length === template.rules.teamSize
        && members.every((member, index) => member.teamRole === template.rules.roles[index])
        && members.filter((member) => member.teamCaptain).length === 1 && members[0].teamCaptain === true);
  }
  const text = (value: unknown) => typeof value === "string" && Boolean(value);
  const point = (value: unknown) => Boolean(value && typeof value === "object" && finiteNumber((value as { x?: number }).x) && finiteNumber((value as { y?: number }).y));
  const holes = s.holes; const entrants = s.entrants; const teams = s.teams; const rounds = event.rounds;
  if (!/^(active|completed)$/.test(event.status) || ![1, 2].includes(s.version) || !/^(individual|four-ball|alternate-shot|scramble|pro-am)$/.test(s.teamFormat) || !/^(stableford|net-stroke|gross-stroke)$/.test(s.scoringMode)
    || ![s.activationId, s.courseId, s.courseName, s.teeSet, s.pinRotation].every(text) || ![s.rating, s.slope, s.par].every(finiteNumber)
    || !array(holes) || holes.length !== 18 || !array(entrants) || !array(teams)
    || !integer(s.activatedWeek) || !integer(s.activatedDay) || !array(rounds) || !integer(event.roundCount) || event.roundCount! < 1 || event.roundCount! > 4 || rounds.length !== event.roundCount || !integer(event.currentRound) || event.currentRound! < 1 || event.currentRound! > event.roundCount!) return false;
  if (event.teamFormat !== s.teamFormat || event.scoringMode !== s.scoringMode || event.courseId !== s.courseId || event.courseName !== s.courseName
    || event.teeSet !== s.teeSet || event.pinRotation !== s.pinRotation || !array(event.holeIds) || !same(event.holeIds, holes.map((hole) => hole.id))) return false;
  if (new Set(holes.map((hole) => hole?.id)).size !== 18 || new Set(holes.map((hole) => hole?.strokeIndex)).size !== 18
    || holes.some((hole) => !hole || !text(hole.id) || !integer(hole.par) || !integer(hole.strokeIndex) || !point(hole.tee) || !point(hole.pin))
    || s.par !== holes.reduce((total, hole) => total + hole.par, 0)) return false;
  const entrantIds = new Set(entrants.map((entrant) => entrant?.entrantId));
  if (entrantIds.size !== entrants.length || entrants.some((entrant) => !entrant || ![entrant.entrantId, entrant.name, entrant.archetype, entrant.teamId].every(text)
    || ![entrant.skill, entrant.handicapIndex, entrant.allowance, entrant.courseHandicapUnrounded].every(finiteNumber) || !integer(entrant.playingHandicap)
    || !array(entrant.strokesByHole) || entrant.strokesByHole.length !== 18 || entrant.strokesByHole.some((stroke: number) => !integer(stroke)))) return false;
  if (new Set(teams.map((team) => team?.id)).size !== teams.length
    || teams.some((team) => !team || !array(team.entrantIds) || !team.entrantIds.length || new Set(team.entrantIds).size !== team.entrantIds.length)
    || entrants.some((entrant) => !teams.some((team) => team.id === entrant.teamId && team.entrantIds.includes(entrant.entrantId)))
    || teams.some((team) => team.entrantIds.some((id: string) => !entrantIds.has(id)))
    || new Set(teams.flatMap((team) => team.entrantIds)).size !== entrants.length) return false;
  const v2 = s.version === 2;
  if (!v2) {
    if ("templateId" in event || !sized(s, 16) || wrongSize(entrants, 10)
      || event.field.some((entrant) => keys(entrant).some((key) => /^team(Role|Order|Captain)$/.test(key)))
      || s.teamFormat !== INDIVIDUAL || teams.length !== entrants.length || teams.some((team) => team.entrantIds.length !== 1 || !sized(team, 2))) return false;
  } else {
    if (!s.templateId || event.templateId !== s.templateId || !integer(s.roundCount) || s.roundCount !== event.roundCount || !s.appliedOverrides) return false;
    if (!sized(s, 21 + Number(Boolean(s.teamHandicaps))) || wrongSize(holes, 5) || wrongSize(holes.flatMap((hole) => [hole.tee, hole.pin]), 2)
      || wrongSize(entrants, 13) || wrongSize(teams, 4) || wrongSize(event.field, 8)) return false;
    let template;
    try { template = tournamentTemplate(s.templateId); } catch { return false; }
    const { rules, supportedOverrides } = template;
    if (template.teamFormat !== s.teamFormat || !template.scoringModes.includes(s.scoringMode)
      || !same(rules, s.formatRules)
      || !same(supportedOverrides, s.supportedOverrides)
      || teams.some((team) => team.entrantIds.length !== rules.teamSize || !same(team.roles, rules.roles) || team.captainId !== team.entrantIds[0])) return false;
    if (!sized(s.appliedOverrides, supportedOverrides.length) || supportedOverrides.some((override) => s.appliedOverrides![override] !== (override === "scoringMode" ? s.scoringMode : override === "roundCount" ? s.roundCount : override === "teeSet" ? s.teeSet : s.pinRotation))) return false;
    const expectedTeamCount = rules.teamCount;
    if (expectedTeamCount !== "field" && teams.length !== expectedTeamCount) return false;
    if (entrants.some((entrant) => {
      if (!integer(entrant.teamOrder)) return true;
      const team = teams.find((candidate) => candidate.id === entrant.teamId);
      return !team || team.entrantIds[entrant.teamOrder!] !== entrant.entrantId || team.roles?.[entrant.teamOrder!] !== entrant.teamRole
        || entrant.teamCaptain !== (team.captainId === entrant.entrantId);
    })) return false;
    if (event.field.length !== entrants.length || new Set(event.field.map((entrant) => entrant.id)).size !== event.field.length
      || !same(event.field.map((entrant) => [entrant.id, entrant.name, entrant.archetype, entrant.skill, entrant.teamId, entrant.teamRole, entrant.teamCaptain]),
        entrants.map((entrant) => [entrant.entrantId, entrant.name, entrant.archetype, entrant.skill, entrant.teamId, entrant.teamRole, entrant.teamCaptain]))
      || event.field.some((entrant, index) => entrant.handicapIndex !== entrants[index].handicapIndex)) return false;
    const competitionHoles = holes.map((hole) => ({ id: hole.id, par: hole.par, strokeIndex: hole.strokeIndex }));
    const handicapCourse = { courseRating: s.rating, slopeRating: s.slope, par: s.par };
    const validHandicap = (entrant: typeof entrants[number], allowance: number) => {
      const unrounded = courseHandicapUnrounded(entrant.handicapIndex, handicapCourse);
      const playing = playingHandicapFromUnrounded(unrounded, allowance).rounded;
      return entrant.allowance === allowance && entrant.courseHandicapUnrounded === unrounded && entrant.playingHandicap === playing && same(entrant.strokesByHole, strokesByHole(playing, competitionHoles));
    };
    if (s.teamFormat === INDIVIDUAL) {
      const allowance = s.scoringMode === "gross-stroke" ? 0 : 1;
      if (s.teamHandicaps || teams.length !== entrants.length || entrants.some((entrant) => entrant.teamRole !== INDIVIDUAL || !entrant.teamCaptain || !validHandicap(entrant, allowance))) return false;
    } else if (s.teamFormat === "pro-am") {
      if (s.teamHandicaps || entrants.some((entrant) => !validHandicap(entrant, PRO_AM_MEMBER_ALLOWANCE))) return false;
    } else {
      if (!array(s.teamHandicaps)) return false;
      try {
        const expected = captureTeamHandicapSnapshots(teams.map((team) => ({ id: team.id, playerIds: team.entrantIds })), entrants.map((entrant) => ({ id: entrant.entrantId, handicapIndex: entrant.handicapIndex })), s.teamFormat, "stroke", handicapCourse, competitionHoles);
        if (!same(expected, s.teamHandicaps)) return false;
        const members = expected.flatMap((snapshot) => snapshot.members);
        if (entrants.some((entrant, index) => {
          const member = members[index];
          return !member || entrant.allowance !== member.allowance || entrant.courseHandicapUnrounded !== member.courseHandicapUnrounded || entrant.playingHandicap !== member.playingHandicap || !same(entrant.strokesByHole, member.strokesByHole);
        })) return false;
      } catch { return false; }
    }
  }
  const entrantById = new Map(entrants.map((entrant) => [entrant.entrantId, entrant]));
  const totals = event.status === COMPLETED && s.teamFormat === INDIVIDUAL ? new Map(entrants.map((entrant) => [entrant.entrantId, [0, 0, 0, 0, 0]])) : undefined;
  if (!rounds.every((round, index) => round && round.roundNumber === index + 1 && integer(round.scheduledWeek) && integer(round.scheduledDay) && array(round.scorecards)
    && (!v2 || sized(round, 5 + Number("completionId" in round))) && (!("completionId" in round) || text(round.completionId))
    && ROUND_STATES.includes(round.status) && new Set(round.scorecards.map((card: TournamentRoundScorecard) => card?.entrantId)).size === round.scorecards.length
    && round.scorecards.every((card: TournamentRoundScorecard) => {
      const entrant = card && entrantById.get(card.entrantId);
      if (!entrant || !array(card.grossByHole) || !Number.isSafeInteger(card.penalties)) return false;
      const total = totals?.get(card.entrantId);
      if (total) total[3] += 1;
      if (card.status === "withdrawn") {
        if (total) total[4] = 1;
        return (!v2 || sized(card, 5)) && card.grossByHole.length === 0 && card.grossTotal === 0;
      }
      if (card.status !== COMPLETED || card.grossByHole.length !== 18 || (v2 && !sized(card, 7))) return false;
      let gross = 0; let net = 0; let points = 0;
      for (let hole = 0; hole < 18; hole += 1) {
        const score = card.grossByHole[hole];
        if (!Number.isSafeInteger(score) || score <= 0) return false;
        gross += score;
        net += score - entrant.strokesByHole[hole];
        points += Math.max(0, Math.min(5, 2 - score + entrant.strokesByHole[hole] + holes[hole].par));
      }
      if (![gross, net, points].every(Number.isSafeInteger)) return false;
      if (total) { total[0] += gross; total[1] += net; total[2] += points; }
      return card.grossTotal === gross && card.netTotal === net && card.stablefordPoints === points;
    }))) return false;
  const currentRound = rounds.find((round) => round.roundNumber === event.currentRound);
  if (event.status === ACTIVE ? currentRound?.status !== ACTIVE && currentRound?.status !== INTERRUPTED : rounds.some((round) => round.status !== COMPLETED)) return false;
  if (s.teamFormat === INDIVIDUAL) {
    let expected: string[] | undefined;
    if (totals) {
      let winning = Infinity; let winners: typeof entrants = [];
      for (const entrant of entrants) {
        const total = totals.get(entrant.entrantId)!;
        if (total[3] !== rounds.length) return false;
        if (total[4]) continue;
        const value = s.scoringMode === "stableford" ? -total[2] : s.scoringMode === "net-stroke" ? total[1] : total[0];
        if (value < winning) { winning = value; winners = [entrant]; }
        else if (value === winning) winners.push(entrant);
      }
      expected = winners.length ? winners.sort((a, b) => a.name.localeCompare(b.name) || a.entrantId.localeCompare(b.entrantId)).map((entrant) => entrant.name) : undefined;
    }
    if (!same(event.winnerNames, expected) || event.winnerName !== expected?.[0]) return false;
  } else if (s.teamFormat === "pro-am") {
    const completed = rounds.filter((round) => round.status === COMPLETED);
    if (!completed.length) {
      if (event.teamStandings !== undefined || event.winnerTeamIds !== undefined) return false;
    } else {
      const reconstructed = reconstructProAmTournamentEvidence(event);
      if (!reconstructed.ok) return false;
      const expectedStandings = projectProAmTeamStandings(reconstructed.evidence, event.status === COMPLETED);
      const expectedWinners = event.status === COMPLETED && reconstructed.evidence.winnerTeamIds.length
        ? reconstructed.evidence.winnerTeamIds
        : undefined;
      if (!same(event.teamStandings, expectedStandings) || !same(event.winnerTeamIds, expectedWinners)) return false;
    }
    if (event.results !== undefined || event.winnerNames !== undefined || event.winnerName !== undefined) return false;
  }
  return (!event.results || event.results.every((row) => entrantById.get(row.entrantId)?.name === row.name && (!v2 || sized(row, 8)))) && (!event.winnerName || event.results?.[0]?.name === event.winnerName);
}

export function normalizeTournamentCalendar(raw: unknown, course?: Course): TournamentCalendar {
  if (!raw || typeof raw !== "object" || !array((raw as TournamentCalendar).events)) return { version: 2, events: [] };
  const events = (raw as TournamentCalendar).events.filter((event) => {
    if (!event || typeof event !== "object") return false;
    return typeof event.id === "string" && typeof event.name === "string" &&
      /^(local|regional|championship)$/.test(event.tier) && /^(scheduled|active|completed|cancelled)$/.test(event.status) &&
      [event.scheduledWeek, event.scheduledDay, event.bookingCost, event.revenueAward, event.reputationAward].every(finiteNumber) &&
      event.scheduledWeek >= 1 && event.scheduledDay >= 0 && event.scheduledDay <= 6 &&
      array(event.field) && event.field.length > 0 && event.field.length <= 64 &&
      event.field.every((entrant) => entrant && typeof entrant.id === "string" && typeof entrant.name === "string" &&
        typeof entrant.archetype === "string" && finiteNumber(entrant.skill) && (!("handicapIndex" in entrant) || finiteNumber(entrant.handicapIndex))) &&
      (event.results == null || (array(event.results) && event.results.length <= 64 && event.results.every((row) =>
        row && typeof row.entrantId === "string" && typeof row.name === "string" && typeof row.archetype === "string" &&
        (row.golferId === null || integer(row.golferId)) && [row.holesCompleted, row.score, row.scoreToPar].every(finiteNumber) && typeof row.finished === "boolean"
      )));
  }).filter(validLifecycleEvent).map((event) => {
    if (event.activationSnapshot) {
      return {
        ...event,
        activationSnapshot: JSON.parse(JSON.stringify(event.activationSnapshot), (_key, value) => value && typeof value === "object" ? Object.freeze(value) : value),
      };
    }
    return event;
  }).slice(-24);
  if (!course) return { version: 2, events };
  const starter = activeCourseLayout(course);
  return { version: 2, events: events.map((event) => ({
    ...event,
    courseId: event.courseId ?? starter.id,
    courseName: event.courseName ?? starter.name,
    holeIds: event.holeIds?.length ? event.holeIds : courseForLayout(course, event.courseId ?? starter.id).holes.map((hole) => hole.id!).filter(Boolean),
  })) };
}
