import type { Course, World } from "../models/types";
import { PLAYER_PRO_SKILLS, type PlayerProCareer } from "../models/playerProTypes";
import { activeCourseLayout, courseForLayout, layoutById } from "../models/courseLayouts";
import { getParSetting, resolveCourseSetup } from "../models/courseSetup";
import { computeAutoPar } from "../sim/holeMetrics";
import { courseHandicapUnrounded, playingHandicapFromUnrounded, strokesByHole } from "../competition/handicap";
import { scoreStrokePlay } from "../competition/scoring";
import { evaluateTournamentCourseQualification, revalidatePrescribedTournamentSetup } from "./eligibility";
import { absoluteGameDay, tournamentCalendar } from "./tournaments";
import type {
  TournamentActivationSnapshot,
  TournamentEvent,
  TournamentRoundScorecard,
  TournamentScoringMode,
  TournamentStanding,
  TournamentTeamFormat,
  TournamentTier,
} from "./types";

export const TOURNAMENT_LIFECYCLE_DEFAULTS: Record<TournamentTier, { scoringMode: TournamentScoringMode; roundCount: 1 | 2 | 4; teamFormat: TournamentTeamFormat }> = {
  local: { scoringMode: "stableford", roundCount: 1, teamFormat: "individual" },
  regional: { scoringMode: "net-stroke", roundCount: 2, teamFormat: "individual" },
  championship: { scoringMode: "gross-stroke", roundCount: 4, teamFormat: "individual" },
};

export function playerTournamentEligibility(career: PlayerProCareer, event: TournamentEvent): { eligible: boolean; reason: string | null } {
  const minimum: Record<TournamentTier, number> = { local: 35, regional: 52, championship: 68 };
  const average = PLAYER_PRO_SKILLS.reduce((sum, skill) => sum + career.skills[skill], 0) / PLAYER_PRO_SKILLS.length;
  if (event.status !== "scheduled") return { eligible: false, reason: "event_status" };
  if (average < minimum[event.tier]) return { eligible: false, reason: `skill:${minimum[event.tier]}` };
  if (career.tournaments.some((record) => record.eventId === event.id && record.status !== "withdrawn")) return { eligible: false, reason: "already_entered" };
  return { eligible: true, reason: null };
}

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

function roundSchedule(event: TournamentEvent) {
  const count = Math.max(1, Math.min(4, Math.floor(event.roundCount ?? 1)));
  return Array.from({ length: count }, (_, index) => {
    const absolute = absoluteGameDay(event.scheduledWeek, event.scheduledDay) + index;
    return { roundNumber: index + 1, scheduledWeek: Math.floor(absolute / 7) + 1, scheduledDay: absolute % 7, status: "scheduled" as const, scorecards: [] };
  });
}

export type TournamentActivationResult = { ok: true; event: TournamentEvent } | { ok: false; reason: string };

/** Freezes the individual event contract exactly once; ZK-735 owns team formulas. */
export function activateTournament(event: TournamentEvent, course: Course, week = event.scheduledWeek, day = event.scheduledDay): TournamentActivationResult {
  if (event.status === "active" && event.activationSnapshot) return { ok: true, event };
  if (event.status !== "scheduled") return { ok: false, reason: "Only a scheduled tournament can be activated." };
  if (week !== event.scheduledWeek || day !== event.scheduledDay) return { ok: false, reason: "Tournament activation must occur on its first scheduled day." };
  const defaults = TOURNAMENT_LIFECYCLE_DEFAULTS[event.tier];
  const roundCount = Math.floor(event.roundCount ?? defaults.roundCount);
  if (roundCount < 1 || roundCount > 4) return { ok: false, reason: "A tournament requires between one and four rounds." };
  const scoringMode = event.scoringMode ?? defaults.scoringMode;
  const teamFormat = event.teamFormat ?? defaults.teamFormat;
  if (teamFormat !== "individual") return { ok: false, reason: "Team tournament formulas are reserved for ZK-735." };
  if (!event.field.length || new Set(event.field.map((entrant) => entrant.id)).size !== event.field.length) return { ok: false, reason: "Tournament entrants require unique stable identities." };
  const layout = event.courseId ? layoutById(course, event.courseId) : activeCourseLayout(course);
  if (!layout || layout.state !== "open" || layout.publishedHoleIds.length !== 18) return { ok: false, reason: "Tournament activation requires an open, published 18-hole routing." };
  const host = courseForLayout(course, layout.id);
  const booked = event.qualificationSnapshot ?? evaluateTournamentCourseQualification(host, event.tier);
  const teeSet = event.teeSet ?? booked.teeSet;
  const pinRotation = event.pinRotation ?? booked.pinRotation;
  const qualification = revalidatePrescribedTournamentSetup(host, event.tier, teeSet, pinRotation);
  if (!qualification.eligible) return { ok: false, reason: qualification.blockingReasons[0] ?? "The host course is no longer eligible." };
  const expectedIds = event.holeIds?.length ? event.holeIds : layout.publishedHoleIds;
  const holes = host.holes.map((hole, index) => {
    const id = hole.id ?? `hole-${index + 1}`;
    const setup = resolveCourseSetup(hole, teeSet, pinRotation);
    if (!setup.tee || !setup.pin) return null;
    const setting = getParSetting(hole, setup.teeSet);
    const par = setting.mode === "MANUAL" ? setting.par : computeAutoPar(Math.hypot(setup.pin.x - setup.tee.x, setup.pin.y - setup.tee.y));
    const strokeIndex = Number.isInteger(hole.holeIndex) && hole.holeIndex! >= 1 && hole.holeIndex! <= host.holes.length ? hole.holeIndex! : index + 1;
    return { id, par, strokeIndex, tee: { ...setup.tee }, pin: { ...setup.pin } };
  });
  if (holes.some((hole) => !hole) || holes.length !== 18) return { ok: false, reason: "Every routed hole requires a valid tee, pin, par, and stroke index." };
  const frozenHoles = holes as NonNullable<(typeof holes)[number]>[];
  if (expectedIds.length !== frozenHoles.length || expectedIds.some((id, index) => id !== frozenHoles[index].id)) return { ok: false, reason: "The scheduled routing no longer matches the event card." };
  if (new Set(frozenHoles.map((hole) => hole.strokeIndex)).size !== frozenHoles.length) return { ok: false, reason: "Tournament stroke indexes must be unique across the routed card." };
  const par = frozenHoles.reduce((sum, hole) => sum + hole.par, 0);
  const handicapCourse = { courseRating: qualification.rating, slopeRating: qualification.slope, par };
  const competitionHoles = frozenHoles.map((hole) => ({ id: hole.id, par: hole.par, strokeIndex: hole.strokeIndex }));
  const allowance = scoringMode === "gross-stroke" ? 0 : 1;
  const entrants = event.field.map((entrant) => {
    const handicapIndex = Number.isFinite(entrant.handicapIndex) ? Math.max(-10, Math.min(54, entrant.handicapIndex!)) : Math.max(-10, Math.min(54, (1 - entrant.skill) * 36));
    const unrounded = courseHandicapUnrounded(handicapIndex, handicapCourse);
    const playingHandicap = playingHandicapFromUnrounded(unrounded, allowance).rounded;
    return { entrantId: entrant.id, name: entrant.name, archetype: entrant.archetype, skill: entrant.skill, teamId: entrant.teamId ?? `individual:${entrant.id}`, handicapIndex, allowance, courseHandicapUnrounded: unrounded, playingHandicap, strokesByHole: strokesByHole(playingHandicap, competitionHoles) };
  });
  const teams = entrants.map((entrant) => ({ id: entrant.teamId, entrantIds: [entrant.entrantId] }));
  if (new Set(teams.map((team) => team.id)).size !== teams.length) return { ok: false, reason: "Individual entrants require distinct team identities." };
  const activationSnapshot: TournamentActivationSnapshot = freeze({ version: 1, activationId: `${event.id}:activation:${week}:${day}`, activatedWeek: week, activatedDay: day, scoringMode, teamFormat, courseId: layout.id, courseName: event.courseName ?? host.name, rating: qualification.rating, slope: qualification.slope, par, teeSet, pinRotation, holes: frozenHoles, entrants, teams });
  const rounds = roundSchedule({ ...event, roundCount }).map((round, index) => index === 0 ? { ...round, status: "active" as const } : round);
  return { ok: true, event: { ...event, status: "active", scoringMode, teamFormat, roundCount, currentRound: 1, rounds, activationSnapshot, courseId: layout.id, courseName: event.courseName ?? host.name, holeIds: frozenHoles.map((hole) => hole.id), teeSet, pinRotation, qualificationSnapshot: event.qualificationSnapshot ?? qualification, currentQualification: qualification, warning: undefined } };
}

export function scoreTournamentRoundCard(event: TournamentEvent, entrantId: string, grossByHole: readonly number[], penalties = 0): TournamentRoundScorecard | null {
  const snapshot = event.activationSnapshot;
  const entrant = snapshot?.entrants.find((candidate) => candidate.entrantId === entrantId);
  if (!snapshot || !entrant || grossByHole.length !== snapshot.holes.length || grossByHole.some((score) => !Number.isInteger(score) || score <= 0) || !Number.isInteger(penalties) || penalties < 0) return null;
  const scored = scoreStrokePlay({ id: entrantId, playingHandicap: entrant.playingHandicap, holeScores: grossByHole.map((gross) => ({ playerId: entrantId, gross, status: "played" as const })) }, snapshot.holes);
  return { entrantId, status: "completed", grossByHole: [...grossByHole], penalties, grossTotal: scored.gross, netTotal: scored.net, stablefordPoints: scored.stableford };
}

function standings(event: TournamentEvent): TournamentStanding[] {
  const snapshot = event.activationSnapshot!;
  const completed = event.rounds?.filter((round) => round.status === "completed") ?? [];
  return snapshot.entrants.map((entrant) => {
    const cards = completed.flatMap((round) => round.scorecards.filter((card) => card.entrantId === entrant.entrantId));
    const gross = cards.reduce((sum, card) => sum + card.grossTotal, 0);
    const net = cards.reduce((sum, card) => sum + (card.netTotal ?? card.grossTotal), 0);
    const points = cards.reduce((sum, card) => sum + (card.stablefordPoints ?? 0), 0);
    return { entrantId: entrant.entrantId, golferId: null, name: entrant.name, archetype: entrant.archetype, holesCompleted: cards.reduce((sum, card) => sum + card.grossByHole.length, 0), score: gross, scoreToPar: snapshot.scoringMode === "stableford" ? -points : (snapshot.scoringMode === "net-stroke" ? net : gross) - snapshot.par * completed.length, finished: !cards.some((card) => card.status === "withdrawn") && cards.length === completed.length };
  }).sort((a, b) => Number(b.finished) - Number(a.finished) || a.scoreToPar - b.scoreToPar || b.holesCompleted - a.holesCompleted || a.name.localeCompare(b.name));
}

export function completeTournamentRoundEvidence(event: TournamentEvent, scorecards: readonly TournamentRoundScorecard[], completionId = `${event.id}:round:${event.currentRound ?? 1}`): { ok: true; event: TournamentEvent; finalRound: boolean } | { ok: false; reason: string } {
  if (event.rounds?.some((round) => round.completionId === completionId)) return { ok: true, event, finalRound: event.status === "completed" };
  if (event.status === "completed" && event.activationSnapshot && event.rounds?.every((round) => round.status === "completed")) return { ok: true, event, finalRound: true };
  if (event.status !== "active" || !event.activationSnapshot || !event.rounds) return { ok: false, reason: "Tournament is not active." };
  const roundNumber = event.currentRound ?? 1;
  const current = event.rounds.find((round) => round.roundNumber === roundNumber);
  if (current?.status !== "active") return { ok: false, reason: "Current tournament round is not playable." };
  const expected = new Set(event.activationSnapshot.entrants.map((entrant) => entrant.entrantId));
  const locked = new Map(current.scorecards.filter((card) => card.status === "withdrawn").map((card) => [card.entrantId, card]));
  if (new Set(scorecards.map((card) => card.entrantId)).size !== scorecards.length || scorecards.some((card) => !expected.has(card.entrantId) || locked.has(card.entrantId))) return { ok: false, reason: "Every frozen entrant requires exactly one immutable round scorecard." };
  const supplied = new Map(scorecards.map((card) => [card.entrantId, card]));
  const authoritative = event.activationSnapshot.entrants.map((entrant) => {
    const withdrawn = locked.get(entrant.entrantId);
    if (withdrawn) return withdrawn;
    const card = supplied.get(entrant.entrantId);
    if (!card) return null;
    if (card.status === "withdrawn") return card.grossByHole.length === 0 && card.grossTotal === 0 ? { entrantId: card.entrantId, status: "withdrawn" as const, grossByHole: [], penalties: 0, grossTotal: 0 } : null;
    return scoreTournamentRoundCard(event, card.entrantId, card.grossByHole, card.penalties);
  });
  if (authoritative.some((card) => !card)) return { ok: false, reason: "Completed scorecards require authoritative individual gross evidence for every frozen entrant." };
  const withdrawals = (authoritative as TournamentRoundScorecard[]).filter((card) => card.status === "withdrawn");
  const rounds = event.rounds.map((round) => {
    if (round.roundNumber === roundNumber) return { ...round, status: "completed" as const, scorecards: authoritative as TournamentRoundScorecard[], completionId };
    if (round.roundNumber < roundNumber) return round;
    const scorecards = [...round.scorecards, ...withdrawals.filter((withdrawn) => !round.scorecards.some((card) => card.entrantId === withdrawn.entrantId))];
    return { ...round, status: round.roundNumber === roundNumber + 1 ? "active" as const : round.status, scorecards };
  });
  const finalRound = roundNumber >= (event.roundCount ?? 1);
  const advanced: TournamentEvent = { ...event, rounds, currentRound: finalRound ? roundNumber : roundNumber + 1, status: finalRound ? "completed" : "active" };
  const results = standings(advanced);
  advanced.results = results;
  advanced.winnerName = finalRound ? results[0]?.name : undefined;
  return { ok: true, event: advanced, finalRound };
}

function changeRound(world: World, eventId: string, from: "active" | "interrupted", to: "active" | "interrupted"): World {
  const calendar = tournamentCalendar(world);
  const event = calendar.events.find((candidate) => candidate.id === eventId);
  if (!event || event.status !== "active") return world;
  let changed = false;
  const rounds = event.rounds?.map((round) => {
    if (round.roundNumber !== (event.currentRound ?? 1) || round.status !== from) return round;
    changed = true;
    return { ...round, status: to };
  });
  return !rounds || !changed ? world : { ...world, tournaments: { version: 2, events: calendar.events.map((candidate) => candidate.id === eventId ? { ...event, rounds } : candidate) } };
}

export const interruptTournamentRound = (world: World, eventId: string) => changeRound(world, eventId, "active", "interrupted");
export const resumeTournamentRound = (world: World, eventId: string) => changeRound(world, eventId, "interrupted", "active");

export function withdrawTournamentEntrant(world: World, eventId: string, entrantId: string): World {
  const calendar = tournamentCalendar(world);
  const event = calendar.events.find((candidate) => candidate.id === eventId);
  if (!event?.activationSnapshot || event.status !== "active" || !event.activationSnapshot.entrants.some((entrant) => entrant.entrantId === entrantId)) return world;
  let changed = false;
  const rounds = event.rounds?.map((round) => {
    if (round.roundNumber !== (event.currentRound ?? 1) || round.scorecards.some((card) => card.entrantId === entrantId)) return round;
    changed = true;
    return { ...round, scorecards: [...round.scorecards, { entrantId, status: "withdrawn" as const, grossByHole: [], penalties: 0, grossTotal: 0 }] };
  });
  return !rounds || !changed ? world : { ...world, tournaments: { version: 2, events: calendar.events.map((candidate) => candidate.id === eventId ? { ...event, rounds } : candidate) } };
}
