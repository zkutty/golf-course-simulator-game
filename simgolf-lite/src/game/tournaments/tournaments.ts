import type { Course, World } from "../models/types";
import type { Arrival, Golfer, LiveState } from "../live/types";
import type {
  LiveTournamentState,
  TournamentCalendar,
  TournamentEvent,
  TournamentStanding,
} from "./types";
import { evaluateTournamentCourseQualification, revalidatePrescribedTournamentSetup } from "./eligibility";
import { courseForLayout, layoutById } from "../models/courseLayouts";
export { TOURNAMENT_TIERS } from "./tournamentCatalog";
export { TOURNAMENT_TEMPLATES, tournamentTemplate } from "./tournamentTemplates";
export { createTournamentEvent, scheduleTournament } from "./tournamentScheduling";
export { normalizeTournamentCalendar } from "./tournamentCalendarValidation";

const EMPTY_CALENDAR: TournamentCalendar = { version: 2, events: [] };
const INDIVIDUAL = "individual";
const COMPLETED = "completed";
const SCHEDULED = "scheduled";

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

// Tournament save validation lives in tournamentCalendarValidation.ts.
