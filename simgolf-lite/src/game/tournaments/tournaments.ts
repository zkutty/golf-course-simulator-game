import { mulberry32 } from "../../utils/rng";
import type { Course, World } from "../models/types";
import { golferName } from "../live/archetypes";
import type { Arrival, Golfer, GolferArchetypeName, LiveState } from "../live/types";
import type {
  LiveTournamentState,
  TournamentCalendar,
  TournamentEntrant,
  TournamentEvent,
  TournamentStanding,
  TournamentTier,
} from "./types";
import { evaluateTournamentCourseQualification, evaluateTournamentEligibility, revalidatePrescribedTournamentSetup } from "./eligibility";
import { activeCourseLayout, courseForLayout, layoutById } from "../models/courseLayouts";

export const TOURNAMENT_TIERS: Record<TournamentTier, {
  label: string;
  fieldSize: number;
  minReputation: number;
  bookingCost: number;
  revenueAward: number;
  reputationAward: number;
  skillMin: number;
  skillMax: number;
}> = {
  local: { label: "Club Open", fieldSize: 8, minReputation: 25, bookingCost: 1_500, revenueAward: 6_000, reputationAward: 2, skillMin: .42, skillMax: .72 },
  regional: { label: "Regional Invitational", fieldSize: 12, minReputation: 45, bookingCost: 3_500, revenueAward: 14_000, reputationAward: 4, skillMin: .62, skillMax: .88 },
  championship: { label: "CourseCraft Championship", fieldSize: 16, minReputation: 65, bookingCost: 7_000, revenueAward: 30_000, reputationAward: 7, skillMin: .78, skillMax: .99 },
};

const EMPTY_CALENDAR: TournamentCalendar = { version: 2, events: [] };

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

function archetypeForTier(tier: TournamentTier, roll: number): GolferArchetypeName {
  if (tier === "championship") return roll < .68 ? "pro" : "lowHandicap";
  if (tier === "regional") return roll < .18 ? "pro" : roll < .8 ? "lowHandicap" : "casual";
  return roll < .1 ? "pro" : roll < .42 ? "lowHandicap" : roll < .78 ? "casual" : "senior";
}

function eventSeed(world: World, tier: TournamentTier, week: number, day: number): number {
  const tierOffset = tier === "local" ? 101 : tier === "regional" ? 503 : 997;
  return (world.runSeed | 0) + week * 7919 + day * 431 + tierOffset;
}

export function createTournamentEvent(args: {
  course: Course;
  world: World;
  tier: TournamentTier;
  currentDay: number;
  daysAhead: number;
  courseId?: string;
}): { ok: true; event: TournamentEvent } | { ok: false; reason: string } {
  const spec = TOURNAMENT_TIERS[args.tier];
  const layout = args.courseId ? layoutById(args.course, args.courseId) : undefined;
  if (args.courseId && (!layout || layout.state !== "open" || layout.publishedHoleIds.length !== 18)) {
    return { ok: false, reason: "Tournament hosts must be an open, published 18-hole course." };
  }
  const hostCourse = layout ? courseForLayout(args.course, layout.id) : args.course;
  const qualification = evaluateTournamentEligibility({
    course: hostCourse,
    world: args.world,
    tier: args.tier,
    currentDay: args.currentDay,
    daysAhead: args.daysAhead,
    minReputation: spec.minReputation,
    bookingCost: spec.bookingCost,
  });
  if (!qualification.eligible) return { ok: false, reason: qualification.blockingReasons[0] ?? "This course does not meet the event standard." };
  const date = gameDateAfter(args.world.week, args.currentDay, args.daysAhead);

  const seed = eventSeed(args.world, args.tier, date.week, date.day);
  const rng = mulberry32(seed);
  const field: TournamentEntrant[] = Array.from({ length: spec.fieldSize }, (_, index) => ({
    id: `entrant-${seed}-${index + 1}`,
    name: golferName(rng(), rng()),
    archetype: archetypeForTier(args.tier, rng()),
    skill: spec.skillMin + rng() * (spec.skillMax - spec.skillMin),
  }));
  const id = `tournament-${seed}`;
  const eventName = args.tier === "local"
    ? `${hostCourse.name} Open`
    : args.tier === "regional"
      ? `${hostCourse.name} Regional Invitational`
      : `${hostCourse.name} Championship`;
  return {
    ok: true,
    event: {
      id,
      name: eventName,
      tier: args.tier,
      courseId: layout?.id,
      courseName: hostCourse.name,
      holeIds: hostCourse.holes.map((hole) => hole.id!).filter(Boolean),
      scheduledWeek: date.week,
      scheduledDay: date.day,
      status: "scheduled",
      bookingCost: spec.bookingCost,
      revenueAward: spec.revenueAward,
      reputationAward: spec.reputationAward,
      field,
      teeSet: qualification.teeSet,
      pinRotation: qualification.pinRotation,
      qualificationSnapshot: qualification,
      currentQualification: qualification,
    },
  };
}

export function scheduleTournament(world: World, event: TournamentEvent): World {
  const calendar = tournamentCalendar(world);
  if (world.cash < event.bookingCost || calendar.events.some((candidate) =>
    candidate.id === event.id || (candidate.status === "scheduled" && candidate.scheduledWeek === event.scheduledWeek && candidate.scheduledDay === event.scheduledDay)
  )) return world;
  return {
    ...world,
    cash: world.cash - event.bookingCost,
    tournaments: { version: 2, events: [...calendar.events, event] },
  };
}

export function tournamentForDate(world: World, dayIndex: number, course?: Course): TournamentEvent | undefined {
  const event = tournamentCalendar(world).events.find((event) =>
    event.status === "scheduled" && event.scheduledWeek === world.week && event.scheduledDay === dayIndex
  );
  if (!event || !course) return event;
  if (event.courseId && layoutById(course, event.courseId)?.state !== "open") return undefined;
  const host = event.courseId ? courseForLayout(course, event.courseId) : course;
  return evaluateTournamentCourseQualification(host, event.tier).eligible ? event : undefined;
}

function sameQualification(a: TournamentEvent["currentQualification"], b: TournamentEvent["currentQualification"]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function revalidateScheduledTournaments(course: Course, world: World): World {
  const calendar = tournamentCalendar(world);
  let changed = calendar.version !== 2;
  const events = calendar.events.map((event) => {
    if (event.status !== "scheduled") return event;
    const host = event.courseId ? courseForLayout(course, event.courseId) : course;
    const initial = event.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event.tier);
    const evaluated = revalidatePrescribedTournamentSetup(host, event.tier, event.teeSet ?? initial.teeSet, event.pinRotation ?? initial.pinRotation);
    const hostOpen = !event.courseId || layoutById(course, event.courseId)?.state === "open";
    const current = hostOpen ? evaluated : { ...evaluated, eligible: false, blockingReasons: ["The booked host course is closed or unavailable.", ...evaluated.blockingReasons] };
    const warning = current.eligible ? undefined : current.blockingReasons[0];
    if (sameQualification(event.currentQualification, current) && event.warning === warning && event.teeSet && event.pinRotation) return event;
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
  const event = calendar.events.find((candidate) => candidate.status === "scheduled" && candidate.scheduledWeek === world.week && candidate.scheduledDay === dayIndex);
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
  const host = event.courseId ? courseForLayout(course, event.courseId) : course;
  const qualification = event.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event.tier);
  return {
    eventId: event.id,
    name: event.name,
    tier: event.tier,
    courseId: event.courseId,
    teeSet: event.teeSet ?? qualification.teeSet,
    pinRotation: event.pinRotation ?? qualification.pinRotation,
    ordinaryPinRotation: course.activePinRotation ?? "A",
    qualificationSnapshot: qualification,
    standings: event.field.map((entrant) => ({
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
  if (!event || event.status === "completed") return { world, revenue: 0, reputation: 0, event };
  const results = sortedStandings(active.standings);
  const completed: TournamentEvent = { ...event, status: "completed", results, winnerName: results[0]?.name };
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

export function normalizeTournamentCalendar(raw: unknown, course?: Course): TournamentCalendar {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as TournamentCalendar).events)) return { version: 2, events: [] };
  const events = (raw as TournamentCalendar).events.filter((event) => {
    if (!event || typeof event !== "object") return false;
    return typeof event.id === "string" && typeof event.name === "string" &&
      (event.tier === "local" || event.tier === "regional" || event.tier === "championship") &&
      (event.status === "scheduled" || event.status === "completed" || event.status === "cancelled") &&
      Number.isFinite(event.scheduledWeek) && Number.isFinite(event.scheduledDay) &&
      Number.isFinite(event.bookingCost) && Number.isFinite(event.revenueAward) && Number.isFinite(event.reputationAward) &&
      event.scheduledWeek >= 1 && event.scheduledDay >= 0 && event.scheduledDay <= 6 &&
      Array.isArray(event.field) && event.field.length > 0 && event.field.length <= 64 &&
      event.field.every((entrant) => entrant && typeof entrant.id === "string" && typeof entrant.name === "string" &&
        typeof entrant.archetype === "string" && Number.isFinite(entrant.skill)) &&
      (event.results == null || (Array.isArray(event.results) && event.results.length <= 64 && event.results.every((row) =>
        row && typeof row.entrantId === "string" && typeof row.name === "string" && typeof row.archetype === "string" &&
        (row.golferId === null || Number.isInteger(row.golferId)) && Number.isFinite(row.holesCompleted) &&
        Number.isFinite(row.score) && Number.isFinite(row.scoreToPar) && typeof row.finished === "boolean"
      )));
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
