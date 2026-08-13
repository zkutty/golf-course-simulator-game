import { scoreStrokePlay, scoreTeamHole, scoreTeamNetHole } from "../competition/scoring";
import { captureTeamHandicapSnapshots, type ChallengeTeamFormat, type TeamHandicapSnapshot } from "../competition/teamAuthority";
import type {
  TournamentActivationSnapshot,
  TournamentEvent,
  TournamentRoundScorecard,
  TournamentTeamStanding,
} from "./types";
import { resolveTournamentStandings, type TournamentRankedStanding } from "./tournamentStandings";

type PairTeamFormat = Extract<ChallengeTeamFormat, "four-ball" | "alternate-shot" | "scramble">;
type Failure = { ok: false; reason: string };

export interface TournamentTeamRoundResult {
  teamId: string;
  status: "completed" | "dnf";
  netTotal?: number;
}

export interface TournamentTeamCumulativeResult {
  teamId: string;
  status: "active" | "dnf";
  completedRounds: number;
  dnfRounds: number;
  netTotal: number;
}

export interface TournamentTeamCumulativeEvidence {
  version: 1;
  activationId: string;
  completedRounds: number;
  teams: readonly TournamentTeamCumulativeResult[];
  standings: readonly TournamentRankedStanding[];
  winnerTeamIds: readonly string[];
}

export type TournamentTeamCumulativeEvidenceResult =
  | { ok: true; evidence: TournamentTeamCumulativeEvidence }
  | Failure;

const safeInteger = Number.isSafeInteger;
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function pairFormat(snapshot: TournamentActivationSnapshot): snapshot is TournamentActivationSnapshot & { teamFormat: PairTeamFormat; teamHandicaps: readonly TeamHandicapSnapshot[] } {
  return ["four-ball", "alternate-shot", "scramble"].includes(snapshot.teamFormat) && Array.isArray(snapshot.teamHandicaps);
}

function teamSnapshot(
  snapshot: TournamentActivationSnapshot & { teamFormat: PairTeamFormat; teamHandicaps: readonly TeamHandicapSnapshot[] },
  teamId: string,
): TeamHandicapSnapshot | null {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  const handicap = snapshot.teamHandicaps.find((candidate) => candidate.teamId === teamId);
  if (!team || team.entrantIds.length !== 2 || !handicap || handicap.format !== snapshot.teamFormat || handicap.scoring !== "stroke"
    || handicap.members.length !== 2 || !same(handicap.members.map((member) => member.playerId), team.entrantIds)) return null;
  if (snapshot.teamFormat === "four-ball") {
    if (handicap.members.some((member) => !Array.isArray(member.strokesByHole) || member.strokesByHole.length !== snapshot.holes.length
      || member.strokesByHole.some((stroke) => !safeInteger(stroke)))) return null;
  } else if (!safeInteger(handicap.playingHandicap) || !Array.isArray(handicap.strokesByHole)
    || handicap.strokesByHole.length !== snapshot.holes.length || handicap.strokesByHole.some((stroke) => !safeInteger(stroke))) return null;
  return handicap;
}

function validFrozenAuthority(
  snapshot: TournamentActivationSnapshot & { teamFormat: PairTeamFormat; teamHandicaps: readonly TeamHandicapSnapshot[] },
): boolean {
  if (!Number.isFinite(snapshot.rating) || snapshot.rating < 0 || snapshot.rating > 100
    || !Number.isFinite(snapshot.slope) || snapshot.slope < 55 || snapshot.slope > 155
    || !safeInteger(snapshot.par) || snapshot.par < 54 || snapshot.par > 90
    || snapshot.holes.some((hole) => !safeInteger(hole.par) || hole.par < 3 || hole.par > 5)
    || snapshot.entrants.some((entrant) => !Number.isFinite(entrant.handicapIndex) || entrant.handicapIndex < -10 || entrant.handicapIndex > 54)) return false;
  const holes = snapshot.holes.map(({ id, par, strokeIndex }) => ({ id, par, strokeIndex }));
  const expected = captureTeamHandicapSnapshots(
    snapshot.teams.map((team) => ({ id: team.id, playerIds: team.entrantIds })),
    snapshot.entrants.map((entrant) => ({ id: entrant.entrantId, handicapIndex: entrant.handicapIndex })),
    snapshot.teamFormat,
    "stroke",
    { courseRating: snapshot.rating, slopeRating: snapshot.slope, par: snapshot.par },
    holes,
  );
  if (!same(expected, snapshot.teamHandicaps)) return false;
  const memberById = new Map(expected.flatMap((team) => team.members).map((member) => [member.playerId, member]));
  return snapshot.entrants.every((entrant) => {
    const member = memberById.get(entrant.entrantId);
    return Boolean(member && entrant.allowance === member.allowance && entrant.courseHandicapUnrounded === member.courseHandicapUnrounded
      && entrant.playingHandicap === member.playingHandicap && same(entrant.strokesByHole, member.strokesByHole));
  });
}

/** Validates the exact bounded pair-team activation authority before any score derivation. */
export function validateTournamentTeamActivation(snapshot: TournamentActivationSnapshot): { ok: true } | Failure {
  try {
    return pairFormat(snapshot) && validFrozenAuthority(snapshot)
      ? { ok: true }
      : { ok: false, reason: "Frozen team handicap authority is invalid or unsupported." };
  } catch {
    return { ok: false, reason: "Frozen team handicap authority is malformed." };
  }
}

function scoreRound(
  snapshot: TournamentActivationSnapshot & { teamFormat: PairTeamFormat; teamHandicaps: readonly TeamHandicapSnapshot[] },
  scorecards: readonly TournamentRoundScorecard[],
): readonly TournamentTeamRoundResult[] | null {
  if (!Array.isArray(scorecards) || scorecards.length !== snapshot.entrants.length
    || new Set(scorecards.map((card) => card?.entrantId)).size !== scorecards.length) return null;
  const cards = new Map<string, TournamentRoundScorecard>(scorecards.map((card) => [card.entrantId, card]));
  if (snapshot.entrants.some((entrant) => !cards.has(entrant.entrantId))) return null;
  for (const entrant of snapshot.entrants) {
    const card = cards.get(entrant.entrantId)!;
    if (card.status === "withdrawn") {
      if (Object.keys(card).length !== 5 || card.grossByHole.length !== 0 || card.penalties !== 0 || card.grossTotal !== 0) return null;
      continue;
    }
    if (card.status !== "completed" || Object.keys(card).length !== 7 || card.grossByHole.length !== snapshot.holes.length
      || card.grossByHole.some((gross) => !safeInteger(gross) || gross <= 0) || !safeInteger(card.penalties) || card.penalties < 0) return null;
    const scored = scoreStrokePlay({
      id: entrant.entrantId,
      playingHandicap: entrant.playingHandicap,
      holeScores: card.grossByHole.map((gross) => ({ playerId: entrant.entrantId, gross, status: "played" as const })),
    }, snapshot.holes);
    if (![scored.gross, scored.net, scored.stableford].every(safeInteger)
      || card.grossTotal !== scored.gross || card.netTotal !== scored.net || card.stablefordPoints !== scored.stableford) return null;
  }
  return snapshot.teams.map((team): TournamentTeamRoundResult => {
    const handicap = teamSnapshot(snapshot, team.id);
    const members = team.entrantIds.map((entrantId) => cards.get(entrantId)!);
    if (!handicap || members.some((card) => !card)) throw new Error("invalid-team-evidence");
    const played = members.filter((card) => card.status === "completed");
    if (!played.length || snapshot.teamFormat !== "four-ball" && played.length !== members.length) {
      return { teamId: team.id, status: "dnf" };
    }
    if (snapshot.teamFormat !== "four-ball" && (!same(played[0].grossByHole, played[1].grossByHole) || played[0].penalties !== played[1].penalties)) {
      throw new Error("forged-team-ball");
    }
    const netTotal = snapshot.holes.reduce((total, hole, holeIndex) => {
      if (snapshot.teamFormat === "four-ball") {
        const eligible = played.map((card) => {
          const member = handicap.members.find((candidate) => candidate.playerId === card.entrantId)!;
          return { playerId: card.entrantId, gross: card.grossByHole[holeIndex], net: card.grossByHole[holeIndex] - member.strokesByHole[holeIndex] };
        });
        return total + scoreTeamNetHole("four-ball", eligible).net;
      }
      const gross = played[0].grossByHole[holeIndex];
      const scored = scoreTeamHole(snapshot.teamFormat, [gross], hole.par, handicap.playingHandicap, hole.strokeIndex, snapshot.holes);
      return total + scoreTeamNetHole(snapshot.teamFormat, [{ playerId: team.id, gross: scored.gross, net: scored.net }]).net;
    }, 0);
    if (!safeInteger(netTotal)) throw new Error("unsafe-team-total");
    return { teamId: team.id, status: "completed", netTotal };
  });
}

/** Reconstructs pair-team results exclusively from frozen participant cards and team-handicap snapshots. */
export function reconstructTournamentTeamEvidence(event: TournamentEvent): TournamentTeamCumulativeEvidenceResult {
  try {
    const snapshot = event.activationSnapshot;
    const completed = event.rounds?.filter((round) => round.status === "completed") ?? [];
    if (!snapshot || !pairFormat(snapshot) || !validFrozenAuthority(snapshot) || !completed.length || completed.length > (snapshot.roundCount ?? event.roundCount ?? 0)
      || completed.some((round, index) => round.roundNumber !== index + 1)
      || snapshot.teamHandicaps.length !== snapshot.teams.length) {
      return { ok: false, reason: "Team standings require contiguous completed frozen team rounds." };
    }
    const rounds = completed.map((round) => scoreRound(snapshot, round.scorecards));
    if (rounds.some((round) => !round)) return { ok: false, reason: "Every frozen team entrant requires one canonical participant gross card." };
    const scored = rounds as readonly (readonly TournamentTeamRoundResult[])[];
    const teams = snapshot.teams.map((team): TournamentTeamCumulativeResult => {
      const results = scored.map((round) => round.find((candidate) => candidate.teamId === team.id)!);
      const dnfRounds = results.filter((result) => result.status === "dnf").length;
      const netTotal = results.reduce((sum, result) => sum + (result.netTotal ?? 0), 0);
      if (!safeInteger(netTotal)) throw new Error("unsafe-cumulative-team-total");
      return { teamId: team.id, status: dnfRounds ? "dnf" : "active", completedRounds: scored.length, dnfRounds, netTotal };
    });
    const final = scored.length === (snapshot.roundCount ?? event.roundCount);
    const ranked = resolveTournamentStandings(teams.map((team) => ({
      competitorId: team.teamId,
      status: team.status === "dnf" ? "dnf" as const : final ? "completed" as const : "active" as const,
      completedRounds: team.completedRounds,
      holesCompleted: team.status === "dnf" ? 0 : team.completedRounds * snapshot.holes.length,
      scoreTotal: team.status === "dnf" ? null : team.netTotal,
      rankingTotal: team.status === "dnf" ? null : team.netTotal,
      scoreToPar: team.status === "dnf" ? null : team.netTotal - snapshot.par * team.completedRounds,
      rankEligible: team.status !== "dnf",
      prizeEligible: team.status !== "dnf" && final,
      tieBreakKey: team.teamId,
    })));
    if (!ranked.ok) return ranked;
    return { ok: true, evidence: { version: 1, activationId: snapshot.activationId, completedRounds: scored.length, teams, standings: ranked.standings, winnerTeamIds: ranked.winnerIds } };
  } catch {
    return { ok: false, reason: "Frozen team-round evidence is missing, forged, or cannot be scored safely." };
  }
}

/** Stable persisted read model; frozen scorecards remain the only authority. */
export function projectTournamentTeamStandings(evidence: TournamentTeamCumulativeEvidence, finalRound: boolean): TournamentTeamStanding[] {
  return evidence.standings.map((standing) => {
    const team = evidence.teams.find((candidate) => candidate.teamId === standing.competitorId)!;
    return {
      teamId: team.teamId,
      status: standing.status === "dnf" ? "dnf" : finalRound ? "completed" : "active",
      completedRounds: team.completedRounds,
      dnfRounds: team.dnfRounds,
      netTotal: team.netTotal,
      place: standing.place,
      tied: standing.tied,
      occupiedPlaces: [...standing.occupiedPlaces],
    };
  });
}
