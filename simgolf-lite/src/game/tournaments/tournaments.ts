import type { Course, World } from "../models/types";
import type { Arrival, Golfer, LiveState } from "../live/types";
import type {
  LiveTournamentState,
  TournamentCalendar,
  TournamentEvent,
  TournamentRoundScorecard,
  TournamentStanding,
} from "./types";
import { evaluateTournamentCourseQualification, revalidatePrescribedTournamentSetup } from "./eligibility";
import { activeCourseLayout, courseForLayout, layoutById } from "../models/courseLayouts";
import { captureTeamHandicapSnapshots } from "../competition/teamAuthority";
import { courseHandicapUnrounded, playingHandicapFromUnrounded, strokesByHole } from "../competition/handicap";
import { PRO_AM_MEMBER_ALLOWANCE, tournamentTemplate } from "./tournamentTemplates";
export { TOURNAMENT_TIERS } from "./tournamentCatalog";
export { TOURNAMENT_TEMPLATES, tournamentTemplate } from "./tournamentTemplates";
export { createTournamentEvent, scheduleTournament } from "./tournamentScheduling";

const EMPTY_CALENDAR: TournamentCalendar = { version: 2, events: [] };
const INDIVIDUAL = "individual";
const ACTIVE = "active";
const COMPLETED = "completed";
const SCHEDULED = "scheduled";
const INTERRUPTED = "interrupted";
const ROUND_STATES = [SCHEDULED, ACTIVE, INTERRUPTED, COMPLETED] as const;

export function tournamentCalendar(world: World): TournamentCalendar {
  return world.tournaments ?? EMPTY_CALENDAR;
}

export function absoluteGameDay(week: number, dayIndex: number): number {
  return (Math.max(1, Math.floor(week)) - 1) * 7 + Math.max(0, Math.min(6, Math.floor(dayIndex)));
}

export function gameDateAfter(week: number, dayIndex: number, daysAhead: number): { week: number; day: number } {
  const absolute = absoluteGameDay(week, dayIndex) + Math.max(1, Math.floor(daysAhead));
  return { week: Math.floor(absolute / 7) + 1, day: absolute % 7 };
}

const resolvedTeamFormat = (event: TournamentEvent) => event.activationSnapshot?.teamFormat ?? event.teamFormat ?? INDIVIDUAL;


export function tournamentForDate(world: World, dayIndex: number, course?: Course): TournamentEvent | undefined {
  const event = tournamentCalendar(world).events.find((event) =>
    event.status === SCHEDULED && event.scheduledWeek === world.week && event.scheduledDay === dayIndex
  );
  if (!event || !course) return event;
  if (resolvedTeamFormat(event) !== INDIVIDUAL) return undefined;
  if (event.courseId && layoutById(course, event.courseId)?.state !== "open") return undefined;
  const host = event.courseId ? courseForLayout(course, event.courseId) : course;
  return evaluateTournamentCourseQualification(host, event.tier).eligible ? event : undefined;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function revalidateScheduledTournaments(course: Course, world: World): World {
  const calendar = tournamentCalendar(world);
  let changed = calendar.version !== 2;
  const events = calendar.events.map((event) => {
    if (event.status !== SCHEDULED) return event;
    const host = event.courseId ? courseForLayout(course, event.courseId) : course;
    const initial = event.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event.tier);
    const evaluated = revalidatePrescribedTournamentSetup(host, event.tier, event.teeSet ?? initial.teeSet, event.pinRotation ?? initial.pinRotation);
    const hostOpen = !event.courseId || layoutById(course, event.courseId)?.state === "open";
    const current = hostOpen ? evaluated : { ...evaluated, eligible: false, blockingReasons: ["The booked host course is closed or unavailable.", ...evaluated.blockingReasons] };
    const warning = current.eligible ? undefined : current.blockingReasons[0];
    if (same(event.currentQualification, current) && event.warning === warning && event.teeSet && event.pinRotation) return event;
    changed = true;
    return {
      ...event,
      teeSet: event.teeSet ?? current.teeSet,
      pinRotation: event.pinRotation ?? current.pinRotation,
      qualificationSnapshot: event.qualificationSnapshot ?? current,
      currentQualification: current,
      warning,
    };
  });
  return changed ? { ...world, tournaments: { version: 2, events } } : world;
}

export function prepareTournamentDay(course: Course, world: World, dayIndex: number): {
  world: World;
  event?: TournamentEvent;
  cancelled?: TournamentEvent;
} {
  const calendar = tournamentCalendar(world);
  const event = calendar.events.find((candidate) => candidate.status === SCHEDULED && candidate.scheduledWeek === world.week && candidate.scheduledDay === dayIndex);
  if (!event) return { world };
  const host = event.courseId ? courseForLayout(course, event.courseId) : course;
  const initial = event.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event.tier);
  const evaluated = revalidatePrescribedTournamentSetup(host, event.tier, event.teeSet ?? initial.teeSet, event.pinRotation ?? initial.pinRotation);
  const hostOpen = !event.courseId || layoutById(course, event.courseId)?.state === "open";
  const current = hostOpen ? evaluated : { ...evaluated, eligible: false, blockingReasons: ["The booked host course is closed or unavailable.", ...evaluated.blockingReasons] };
  if (current.eligible) {
    const ready = { ...event, teeSet: event.teeSet ?? current.teeSet, pinRotation: event.pinRotation ?? current.pinRotation, qualificationSnapshot: event.qualificationSnapshot ?? current, currentQualification: current, warning: undefined };
    const nextWorld = ready === event ? world : { ...world, tournaments: { version: 2 as const, events: calendar.events.map((candidate) => candidate.id === event.id ? ready : candidate) } };
    return { world: nextWorld, event: ready };
  }
  const cancelled: TournamentEvent = {
    ...event,
    status: "cancelled",
    currentQualification: current,
    warning: current.blockingReasons[0],
    cancelledWeek: world.week,
    cancelledDay: dayIndex,
    cancellationReason: current.blockingReasons.join(" "),
    depositForfeited: true,
  };
  return {
    world: { ...world, tournaments: { version: 2, events: calendar.events.map((candidate) => candidate.id === event.id ? cancelled : candidate) } },
    cancelled,
  };
}

export function planTournamentDay(event: TournamentEvent, openMinute: number, teeGapMinutes: number, groupSize = 3): Arrival[] {
  if (resolvedTeamFormat(event) !== INDIVIDUAL) return [];
  const size = Math.max(2, Math.min(4, Math.floor(groupSize)));
  return event.field.map((entrant, index) => ({
    atMinute: openMinute + Math.floor(index / size) * teeGapMinutes,
    archetype: entrant.archetype,
    courseId: event.courseId,
    groupId: `${event.id}-group-${Math.floor(index / size) + 1}`,
    tournament: {
      eventId: event.id,
      entrantId: entrant.id,
      name: entrant.name,
      skill: entrant.skill,
      teeSet: event.teeSet ?? "member",
      pinRotation: event.pinRotation ?? "A",
    },
  }));
}

export function createLiveTournament(event: TournamentEvent, course: Course): LiveTournamentState {
  if (resolvedTeamFormat(event) !== INDIVIDUAL) throw new Error("Team tournament field simulation is deferred.");
  const host = event.courseId ? courseForLayout(course, event.courseId) : course;
  const qualification = event.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event.tier);
  const liveField = event.activationSnapshot?.entrants.map(({ entrantId: id, ...entrant }) => ({ id, ...entrant })) ?? event.field;
  return {
    eventId: event.id,
    name: event.name,
    tier: event.tier,
    courseId: event.courseId,
    teeSet: event.teeSet ?? qualification.teeSet,
    pinRotation: event.pinRotation ?? qualification.pinRotation,
    ordinaryPinRotation: course.activePinRotation ?? "A",
    qualificationSnapshot: qualification,
    standings: liveField.map((entrant) => ({
      entrantId: entrant.id,
      golferId: null,
      name: entrant.name,
      archetype: entrant.archetype,
      holesCompleted: 0,
      score: 0,
      scoreToPar: 0,
      finished: false,
    })),
  };
}

export function updateTournamentStanding(tournament: LiveTournamentState, golfer: Golfer): void {
  if (!golfer.tournamentEntrantId) return;
  const standing = tournament.standings.find((row) => row.entrantId === golfer.tournamentEntrantId);
  if (!standing) return;
  standing.golferId = golfer.id;
  standing.holesCompleted = golfer.scoredHoles;
  standing.score = golfer.strokes;
  standing.scoreToPar = golfer.scoreToPar;
  standing.finished = golfer.finished;
}

export function sortedStandings(rows: readonly TournamentStanding[]): TournamentStanding[] {
  return [...rows].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.scoreToPar !== b.scoreToPar) return a.scoreToPar - b.scoreToPar;
    if (a.holesCompleted !== b.holesCompleted) return b.holesCompleted - a.holesCompleted;
    return a.name.localeCompare(b.name);
  });
}

export function completeTournament(world: World, live: LiveState): { world: World; revenue: number; reputation: number; event?: TournamentEvent } {
  const active = live.tournament;
  if (!active) return { world, revenue: 0, reputation: 0 };
  const calendar = tournamentCalendar(world);
  const event = calendar.events.find((candidate) => candidate.id === active.eventId);
  if (!event || event.status === COMPLETED) return { world, revenue: 0, reputation: 0, event };
  if (event.activationSnapshot) return { world, revenue: 0, reputation: 0, event };
  const results = sortedStandings(active.standings);
  const completed: TournamentEvent = { ...event, status: COMPLETED, results, winnerName: results[0]?.name };
  const evidence = (live.observedRounds ?? []).filter((observation) => observation.tournamentId === event.id && observation.completed && observation.holesPlayed > 0);
  const evidenceSatisfaction = evidence.length
    ? evidence.reduce((sum, observation) => sum + observation.satisfaction, 0) / evidence.length / 100
    : 0;
  const observedQuality = evidence.length ? Number(evidenceSatisfaction.toFixed(3)) : 0;
  const observedReputation = event.reputationAward;
  completed.observedQuality = observedQuality;
  return {
    world: {
      ...world,
      tournaments: { version: 2, events: calendar.events.map((candidate) => candidate.id === event.id ? completed : candidate) },
    },
    revenue: event.revenueAward,
    reputation: observedReputation,
    event: completed,
  };
}

const finiteNumber = (value: unknown): value is number => Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isInteger(value);
const array = Array.isArray;
const keys = Object.keys;
const sized = (value: object, size: number) => keys(value).length === size;
const wrongSize = (values: readonly object[], size: number) => values.some((value) => !sized(value, size));

function validLifecycleEvent(event: TournamentEvent): boolean {
  const s = event.activationSnapshot;
  if (!s) {
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
  if (!rounds.every((round, index) => round && round.roundNumber === index + 1 && integer(round.scheduledWeek) && integer(round.scheduledDay) && array(round.scorecards)
    && (!v2 || sized(round, 5 + Number("completionId" in round))) && (!("completionId" in round) || text(round.completionId))
    && ROUND_STATES.includes(round.status) && new Set(round.scorecards.map((card: TournamentRoundScorecard) => card?.entrantId)).size === round.scorecards.length
    && round.scorecards.every((card: TournamentRoundScorecard) => {
      const entrant = card && entrantById.get(card.entrantId);
      if (!entrant || !array(card.grossByHole) || !integer(card.penalties)) return false;
      if (card.status === "withdrawn") return (!v2 || sized(card, 5)) && card.grossByHole.length === 0 && card.grossTotal === 0;
      if (card.status !== COMPLETED || card.grossByHole.length !== 18 || (v2 && !sized(card, 7))) return false;
      let gross = 0; let net = 0; let points = 0;
      for (let hole = 0; hole < 18; hole += 1) {
        const score = card.grossByHole[hole];
        if (!integer(score) || score <= 0) return false;
        gross += score;
        net += score - entrant.strokesByHole[hole];
        points += Math.max(0, Math.min(5, 2 - score + entrant.strokesByHole[hole] + holes[hole].par));
      }
      return card.grossTotal === gross && card.netTotal === net && card.stablefordPoints === points;
    }))) return false;
  const currentRound = rounds.find((round) => round.roundNumber === event.currentRound);
  if (event.status === ACTIVE ? currentRound?.status !== ACTIVE && currentRound?.status !== INTERRUPTED : rounds.some((round) => round.status !== COMPLETED)) return false;
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
