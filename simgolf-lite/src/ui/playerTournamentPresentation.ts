import { normalizeTournamentCalendar } from "../game/tournaments/tournamentCalendarValidation";
import { reconstructIndividualTournamentStandings, type TournamentRankedStanding } from "../game/tournaments/tournamentStandings";
import { projectTournamentTeamStandings, reconstructTournamentTeamEvidence } from "../game/tournaments/tournamentTeamRound";
import { projectProAmTeamStandings, reconstructProAmTournamentEvidence, scoreProAmRoundEvidence, type ProAmRoundEvidence } from "../game/tournaments/proAmField";
import type { TournamentActivationSnapshot, TournamentEvent, TournamentRoundState, TournamentStanding } from "../game/tournaments/types";

export type TournamentPresentationReadonly<T> = T extends readonly (infer Item)[]
  ? readonly TournamentPresentationReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: TournamentPresentationReadonly<T[Key]> } : T;

type TournamentSetupPresentation =
  | { phase: "frozen"; snapshot: TournamentActivationSnapshot }
  | {
      phase: "planned";
      courseId: string | null;
      courseName: string | null;
      holeIds: readonly string[] | null;
      teeSet: TournamentEvent["teeSet"] | null;
      pinRotation: TournamentEvent["pinRotation"] | null;
      scoringMode: TournamentEvent["scoringMode"] | null;
      teamFormat: TournamentEvent["teamFormat"] | null;
      templateId: TournamentEvent["templateId"] | null;
      qualification: TournamentEvent["qualificationSnapshot"] | null;
      roster: TournamentEvent["field"];
    }
  | { phase: "legacy" }
  | { phase: "unavailable"; reason: string };

type TournamentCompetitionPresentation =
  | { state: "pending"; reason: "no-completed-rounds" }
  | {
      state: "canonical";
      standings: readonly TournamentRankedStanding[];
      winnerIds: readonly string[];
      winnerNames: readonly string[];
      /** Persisted participant gross evidence, grouped by its actual round. */
      participantRounds: readonly TournamentRoundState[];
      /** Counting selections and member roles come directly from the Pro-Am authority. */
      proAmRounds: readonly ProAmRoundEvidence[];
    }
  | { state: "recorded"; results: readonly TournamentStanding[] }
  | { state: "unavailable"; reason: string };

/** A detached display contract; hosting awards are never player prizes. */
export type PlayerTournamentPresentation = TournamentPresentationReadonly<{
  id: string;
  name: string;
  tier: TournamentEvent["tier"];
  status: TournamentEvent["status"];
  setup: TournamentSetupPresentation;
  schedule: {
    scheduledWeek: number;
    scheduledDay: number;
    roundCount: number | null;
    currentRound: number | null;
    completedRoundCount: number;
    rounds: readonly Pick<TournamentRoundState, "roundNumber" | "scheduledWeek" | "scheduledDay" | "status">[];
  };
  hosting: { bookingCost: number; revenueAward: number; reputationAward: number };
  competition: TournamentCompetitionPresentation;
}>;

function detach<T>(value: T): TournamentPresentationReadonly<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy as TournamentPresentationReadonly<T>;
}

/**
 * Validate frozen evidence using the existing domain boundary. Mutable display
 * aliases and cached projections are replaced on this validation-only carrier;
 * round metadata and the input passed to each scoring helper remain unchanged.
 */
function frozenValidationCarrier(event: TournamentEvent): TournamentEvent {
  const snapshot = event.activationSnapshot!;
  const carrier: TournamentEvent = {
    ...event,
    courseId: snapshot.courseId,
    courseName: snapshot.courseName,
    holeIds: snapshot.holes.map((hole) => hole.id),
    teeSet: snapshot.teeSet,
    pinRotation: snapshot.pinRotation,
    scoringMode: snapshot.scoringMode,
    teamFormat: snapshot.teamFormat,
    field: snapshot.entrants.map((entrant) => ({
      id: entrant.entrantId, name: entrant.name, archetype: entrant.archetype,
      skill: entrant.skill, handicapIndex: entrant.handicapIndex,
      teamId: entrant.teamId,
      ...(snapshot.version === 2 ? { teamRole: entrant.teamRole, teamCaptain: entrant.teamCaptain } : {}),
    })),
  };
  if (snapshot.version === 2) carrier.templateId = snapshot.templateId;
  else delete carrier.templateId;
  delete carrier.results;
  delete carrier.teamStandings;
  delete carrier.winnerTeamIds;
  delete carrier.winnerName;
  delete carrier.winnerNames;
  return carrier;
}

function modernCompetition(event: TournamentEvent): TournamentCompetitionPresentation {
  const snapshot = event.activationSnapshot!;
  const rounds = event.rounds;
  if (!Array.isArray(rounds) || !rounds.length
    || (snapshot.roundCount !== undefined && snapshot.roundCount !== event.roundCount)
    || rounds.some((round, index) => !round || round.roundNumber !== index + 1 || !Array.isArray(round.scorecards))) {
    return { state: "unavailable", reason: "Frozen round metadata is missing or conflicting." };
  }
  const completed = rounds.filter((round) => round.status === "completed");
  if (completed.some((round, index) => round.roundNumber !== index + 1)
    || rounds.some((round, index) => index < completed.length ? round.status !== "completed" : round.status === "completed")) {
    return { state: "unavailable", reason: "Completed rounds are not contiguous." };
  }
  const carrier = frozenValidationCarrier(event);
  let standings: readonly TournamentRankedStanding[] = [];
  let winnerIds: readonly string[] = [];
  let winnerNames: readonly string[] = [];
  const proAmRounds: ProAmRoundEvidence[] = [];
  if (completed.length) {
    if (snapshot.teamFormat === "individual") {
      const result = reconstructIndividualTournamentStandings(event);
      if (!result.ok) return { state: "unavailable", reason: result.reason };
      standings = result.standings;
      winnerNames = result.winnerNames;
      winnerIds = result.standings.filter((row) => row.place === 1 && row.status === "completed").map((row) => row.competitorId);
      if (event.status === "completed") {
        carrier.results = result.results;
        if (result.winnerNames.length) {
          carrier.winnerNames = result.winnerNames;
          carrier.winnerName = result.winnerNames[0];
        }
      }
    } else if (snapshot.teamFormat === "pro-am") {
      const result = reconstructProAmTournamentEvidence(event);
      if (!result.ok) return { state: "unavailable", reason: result.reason };
      standings = result.evidence.standings;
      winnerIds = result.evidence.winnerTeamIds;
      carrier.teamStandings = projectProAmTeamStandings(result.evidence, event.status === "completed");
      if (event.status === "completed" && winnerIds.length) carrier.winnerTeamIds = [...winnerIds];
      for (const round of completed) {
        const scored = scoreProAmRoundEvidence(snapshot, round.roundNumber, round.scorecards);
        if (!scored.ok) return { state: "unavailable", reason: scored.reason };
        proAmRounds.push(scored.evidence);
      }
    } else {
      const result = reconstructTournamentTeamEvidence(event);
      if (!result.ok) return { state: "unavailable", reason: result.reason };
      standings = result.evidence.standings;
      winnerIds = result.evidence.winnerTeamIds;
      carrier.teamStandings = projectTournamentTeamStandings(result.evidence, event.status === "completed");
      if (event.status === "completed" && winnerIds.length) carrier.winnerTeamIds = [...winnerIds];
    }
  }
  if (!normalizeTournamentCalendar({ version: 2, events: [carrier] }).events.length) {
    return { state: "unavailable", reason: "Frozen activation or participant round evidence is invalid." };
  }
  return completed.length
    ? { state: "canonical", standings, winnerIds, winnerNames, participantRounds: rounds, proAmRounds }
    : { state: "pending", reason: "no-completed-rounds" };
}

/**
 * Pure, fail-closed presentation from a supplied event; no current course is consulted.
 * A calendar consumer may already have discarded corrupt records during domain
 * normalization. This model does not recover those records or change that boundary.
 */
export function presentPlayerTournamentEvent(event: TournamentEvent): PlayerTournamentPresentation {
  const rounds = Array.isArray(event.rounds) ? event.rounds : [];
  const base = {
    id: event.id, name: event.name, tier: event.tier, status: event.status,
    schedule: {
      scheduledWeek: event.scheduledWeek, scheduledDay: event.scheduledDay,
      roundCount: event.activationSnapshot?.roundCount ?? event.roundCount ?? null,
      currentRound: event.currentRound ?? null,
      completedRoundCount: rounds.filter((round) => round?.status === "completed").length,
      rounds: rounds.filter(Boolean).map(({ roundNumber, scheduledWeek, scheduledDay, status }) => ({ roundNumber, scheduledWeek, scheduledDay, status })),
    },
    hosting: { bookingCost: event.bookingCost, revenueAward: event.revenueAward, reputationAward: event.reputationAward },
  };
  try {
    if (event.activationSnapshot) {
      const competition = modernCompetition(event);
      return detach({ ...base, setup: competition.state === "unavailable"
        ? { phase: "unavailable" as const, reason: competition.reason }
        : { phase: "frozen" as const, snapshot: event.activationSnapshot }, competition });
    }
    if (event.status === "scheduled") {
      if (event.currentRound !== undefined || (event.rounds !== undefined && (!Array.isArray(event.rounds)
        || event.rounds.some((round) => !round || round.status !== "scheduled" || !Array.isArray(round.scorecards) || round.scorecards.length > 0)))) {
        const reason = "Scheduled event contains round evidence without frozen activation.";
        return detach({ ...base, setup: { phase: "unavailable" as const, reason }, competition: { state: "unavailable" as const, reason } });
      }
      return detach({ ...base, setup: {
        phase: "planned" as const, courseId: event.courseId ?? null, courseName: event.courseName ?? null,
        holeIds: event.holeIds ?? null, teeSet: event.teeSet ?? event.qualificationSnapshot?.teeSet ?? null,
        pinRotation: event.pinRotation ?? event.qualificationSnapshot?.pinRotation ?? null,
        scoringMode: event.scoringMode ?? null, teamFormat: event.teamFormat ?? null,
        templateId: event.templateId ?? null, qualification: event.qualificationSnapshot ?? null, roster: event.field,
      }, competition: { state: "pending" as const, reason: "no-completed-rounds" as const } });
    }
    if (event.rounds !== undefined || event.roundCount !== undefined || event.currentRound !== undefined || event.templateId !== undefined || event.status === "active") {
      const reason = "Modern event is missing its frozen activation evidence.";
      return detach({ ...base, setup: { phase: "unavailable" as const, reason }, competition: { state: "unavailable" as const, reason } });
    }
    const validLegacy = normalizeTournamentCalendar({ version: 2, events: [event] }).events.length > 0;
    return detach({ ...base, setup: { phase: "legacy" as const }, competition: validLegacy && event.results?.length
      ? { state: "recorded" as const, results: event.results }
      : { state: "unavailable" as const, reason: "No valid recorded legacy results." } });
  } catch {
    const reason = "Tournament evidence is malformed.";
    return detach({ ...base, setup: { phase: "unavailable" as const, reason }, competition: { state: "unavailable" as const, reason } });
  }
}
