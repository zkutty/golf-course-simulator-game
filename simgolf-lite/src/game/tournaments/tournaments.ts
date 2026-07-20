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

const EMPTY_CALENDAR: TournamentCalendar = { version: 1, events: [] };

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
}): { ok: true; event: TournamentEvent } | { ok: false; reason: string } {
  const spec = TOURNAMENT_TIERS[args.tier];
  const completeHoles = args.course.holes.filter((hole) => hole.tee && hole.green).length;
  if (completeHoles < 9) return { ok: false, reason: "Open nine complete holes before scheduling a tournament." };
  if (args.world.reputation < spec.minReputation) return { ok: false, reason: `${spec.label} requires ${spec.minReputation} reputation.` };
  if (args.world.cash < spec.bookingCost) return { ok: false, reason: `You need $${spec.bookingCost.toLocaleString()} for the hosting deposit.` };
  const date = gameDateAfter(args.world.week, args.currentDay, args.daysAhead);
  const calendar = tournamentCalendar(args.world);
  if (calendar.events.some((event) => event.status === "scheduled" && event.scheduledWeek === date.week && event.scheduledDay === date.day)) {
    return { ok: false, reason: "Another tournament is already booked for that day." };
  }

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
    ? `${args.course.name} Open`
    : args.tier === "regional"
      ? `${args.course.name} Regional Invitational`
      : `${args.course.name} Championship`;
  return {
    ok: true,
    event: {
      id,
      name: eventName,
      tier: args.tier,
      scheduledWeek: date.week,
      scheduledDay: date.day,
      status: "scheduled",
      bookingCost: spec.bookingCost,
      revenueAward: spec.revenueAward,
      reputationAward: spec.reputationAward,
      field,
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
    tournaments: { version: 1, events: [...calendar.events, event] },
  };
}

export function tournamentForDate(world: World, dayIndex: number): TournamentEvent | undefined {
  return tournamentCalendar(world).events.find((event) =>
    event.status === "scheduled" && event.scheduledWeek === world.week && event.scheduledDay === dayIndex
  );
}

export function planTournamentDay(event: TournamentEvent, openMinute: number, teeGapMinutes: number): Arrival[] {
  return event.field.map((entrant, index) => ({
    atMinute: openMinute + index * teeGapMinutes,
    archetype: entrant.archetype,
    tournament: {
      eventId: event.id,
      entrantId: entrant.id,
      name: entrant.name,
      skill: entrant.skill,
    },
  }));
}

export function createLiveTournament(event: TournamentEvent): LiveTournamentState {
  return {
    eventId: event.id,
    name: event.name,
    tier: event.tier,
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
  return {
    world: {
      ...world,
      tournaments: { version: 1, events: calendar.events.map((candidate) => candidate.id === event.id ? completed : candidate) },
    },
    revenue: event.revenueAward,
    reputation: event.reputationAward,
    event: completed,
  };
}

export function normalizeTournamentCalendar(raw: unknown): TournamentCalendar {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as TournamentCalendar).events)) return { version: 1, events: [] };
  const events = (raw as TournamentCalendar).events.filter((event) => {
    if (!event || typeof event !== "object") return false;
    return typeof event.id === "string" && typeof event.name === "string" &&
      (event.tier === "local" || event.tier === "regional" || event.tier === "championship") &&
      (event.status === "scheduled" || event.status === "completed") &&
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
  return { version: 1, events };
}
