import type { TournamentActivationEntrantSnapshot, TournamentEvent, TournamentRoundScorecard, TournamentStanding } from "./types";

export type TournamentEvidenceStatus = "active" | "completed" | "withdrawn" | "incomplete" | "dnf" | "invalid";

export interface TournamentStandingEvidence {
  competitorId: string;
  status: TournamentEvidenceStatus;
  completedRounds: number;
  holesCompleted: number;
  /** Persisted display total for this competitor (individual gross or team scoring total). */
  scoreTotal: number | null;
  rankingTotal: number | null;
  scoreToPar: number | null;
  rankEligible: boolean;
  prizeEligible: boolean;
  /** Deterministic display order within an exact scoring tie; never breaks the tied place. */
  tieBreakKey: string;
}

export interface TournamentRankedStanding extends Omit<TournamentStandingEvidence, "tieBreakKey"> {
  place: number | null;
  tied: boolean;
  occupiedPlaces: readonly number[];
}

export interface TournamentPurseConfiguration {
  /** Integer minor units. The authority never decides which wallet or ledger receives them. */
  total: number;
  /** Caller-owned relative shares for first, second, and subsequent occupied places. */
  occupiedPlaceShares: readonly number[];
}

export interface TournamentPurseAward {
  competitorId: string;
  place: number;
  occupiedPlaces: readonly number[];
  amount: number;
}

export interface TournamentPursePlan {
  version: 1;
  configuredTotal: number;
  occupiedPlaceAmounts: readonly number[];
  awards: readonly TournamentPurseAward[];
  distributedTotal: number;
}

export type TournamentStandingsResult =
  | {
      ok: true;
      standings: readonly TournamentRankedStanding[];
      winnerIds: readonly string[];
      pursePlan?: TournamentPursePlan;
    }
  | { ok: false; reason: string };

const EVIDENCE_KEYS = [
  "competitorId",
  "status",
  "completedRounds",
  "holesCompleted",
  "scoreTotal",
  "rankingTotal",
  "scoreToPar",
  "rankEligible",
  "prizeEligible",
  "tieBreakKey",
] as const;

const STATUSES: readonly TournamentEvidenceStatus[] = ["active", "completed", "withdrawn", "incomplete", "dnf", "invalid"];
const UNRANKED_ORDER: Record<TournamentEvidenceStatus, number> = {
  active: 0,
  completed: 0,
  withdrawn: 1,
  dnf: 2,
  incomplete: 3,
  invalid: 4,
};

const exactKeys = (value: object, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};
const finite = (value: unknown): value is number => Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isInteger(value);

function evidenceProblem(rows: readonly TournamentStandingEvidence[]): string | null {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 64 || rows.some((row) => !row || typeof row !== "object" || !exactKeys(row, EVIDENCE_KEYS))) {
    return "Standings require one exact evidence row per competitor.";
  }
  if (new Set(rows.map((row) => row.competitorId)).size !== rows.length) return "Standings competitor identities must be unique.";
  for (const row of rows) {
    if (!row.competitorId || !row.tieBreakKey || !STATUSES.includes(row.status)
      || !integer(row.completedRounds) || row.completedRounds < 0 || row.completedRounds > 4
      || !integer(row.holesCompleted) || row.holesCompleted < 0
      || typeof row.rankEligible !== "boolean" || typeof row.prizeEligible !== "boolean") {
      return "Invalid standings evidence.";
    }
    if (row.rankEligible) {
      if (!finite(row.scoreTotal) || !finite(row.rankingTotal) || !finite(row.scoreToPar)
        || row.completedRounds < 1 || row.holesCompleted < 1 || !["active", "completed"].includes(row.status)) {
        return "Ranked evidence must be complete and finite.";
      }
    } else if (row.scoreTotal !== null || row.rankingTotal !== null || row.scoreToPar !== null || row.prizeEligible) {
      return "Unranked evidence has scores or prizes.";
    }
    if (row.prizeEligible && (row.status !== "completed" || !row.rankEligible)) {
      return "Prize eligibility requires a completed ranked competitor.";
    }
  }
  return null;
}

function integerPlaceAmounts(total: number, shares: readonly number[]): number[] | null {
  if (!integer(total) || total < 0 || !Array.isArray(shares) || shares.length < 1 || shares.length > 64
    || shares.some((share) => !finite(share) || share < 0)) return null;
  const shareTotal = shares.reduce((sum, share) => sum + share, 0);
  if (!finite(shareTotal) || shareTotal <= 0) return null;
  const exact = shares.map((share) => total * share / shareTotal);
  const amounts = exact.map(Math.floor);
  let remaining = total - amounts.reduce((sum, amount) => sum + amount, 0);
  const remainderOrder = exact.map((amount, index) => ({ index, remainder: amount - Math.floor(amount) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) amounts[remainderOrder[cursor % remainderOrder.length].index] += 1;
  return amounts;
}

function pursePlan(standings: readonly TournamentRankedStanding[], config: TournamentPurseConfiguration): TournamentPursePlan | null {
  const placeAmounts = integerPlaceAmounts(config.total, config.occupiedPlaceShares);
  const eligible = standings.filter((row) => row.place !== null);
  if (!placeAmounts) return null;
  const awards: TournamentPurseAward[] = [];
  for (let cursor = 0; cursor < eligible.length;) {
    const place = eligible[cursor].place!;
    const group = eligible.filter((row) => row.place === place).sort((a, b) => a.competitorId.localeCompare(b.competitorId));
    const occupiedPlaces = group[0].occupiedPlaces;
    const pool = occupiedPlaces.reduce((sum, occupied) => sum + (placeAmounts[occupied - 1] ?? 0), 0);
    if (pool && group.some((row) => !row.prizeEligible)) return null;
    if (pool === 0) { cursor += group.length; continue; }
    const base = Math.floor(pool / group.length);
    let remainder = pool - base * group.length;
    group.forEach((row) => {
      const amount = base + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      awards.push({ competitorId: row.competitorId, place, occupiedPlaces, amount });
    });
    cursor += group.length;
  }
  awards.sort((a, b) => a.place - b.place || a.competitorId.localeCompare(b.competitorId));
  const distributedTotal = awards.reduce((sum, award) => sum + award.amount, 0);
  return distributedTotal === config.total
    ? { version: 1, configuredTotal: config.total, occupiedPlaceAmounts: placeAmounts, awards, distributedTotal }
    : null;
}

/** Pure lower-is-better ranking and optional purse planning from caller-classified evidence. */
export function resolveTournamentStandings(
  rows: readonly TournamentStandingEvidence[],
  purse?: TournamentPurseConfiguration,
): TournamentStandingsResult {
  try {
    const problem = evidenceProblem(rows);
    if (problem) return { ok: false, reason: problem };
    const ordered = [...rows].sort((a, b) => {
      if (a.rankEligible !== b.rankEligible) return a.rankEligible ? -1 : 1;
      if (a.rankEligible && b.rankEligible && a.rankingTotal !== b.rankingTotal) return a.rankingTotal! - b.rankingTotal!;
      if (!a.rankEligible && !b.rankEligible && UNRANKED_ORDER[a.status] !== UNRANKED_ORDER[b.status]) return UNRANKED_ORDER[a.status] - UNRANKED_ORDER[b.status];
      return a.tieBreakKey.localeCompare(b.tieBreakKey) || a.competitorId.localeCompare(b.competitorId);
    });
    const standings: TournamentRankedStanding[] = ordered.map((row) => {
      const { tieBreakKey: _tieBreakKey, ...publicRow } = row;
      if (!row.rankEligible) return { ...publicRow, place: null, tied: false, occupiedPlaces: [] };
      const firstAtScore = ordered.findIndex((candidate) => candidate.rankEligible && candidate.rankingTotal === row.rankingTotal);
      const tiedCount = ordered.filter((candidate) => candidate.rankEligible && candidate.rankingTotal === row.rankingTotal).length;
      const place = firstAtScore + 1;
      return { ...publicRow, place, tied: tiedCount > 1, occupiedPlaces: Array.from({ length: tiedCount }, (_, offset) => place + offset) };
    });
    const winners = standings.filter((row) => row.place === 1 && row.status === "completed");
    const plan = purse ? pursePlan(standings, purse) : undefined;
    if (purse && !plan) return { ok: false, reason: "purse cannot be fully assigned." };
    return { ok: true, standings, winnerIds: winners.map((row) => row.competitorId), ...(plan ? { pursePlan: plan } : {}) };
  } catch {
    return { ok: false, reason: "Standings evidence is malformed." };
  }
}

function validCompletedCard(
  card: TournamentRoundScorecard,
  entrant: TournamentActivationEntrantSnapshot,
  snapshot: NonNullable<TournamentEvent["activationSnapshot"]>,
): boolean {
  if (card.status === "withdrawn") return card.grossByHole.length === 0 && card.penalties === 0 && card.grossTotal === 0;
  if (card.status !== "completed" || card.grossByHole.length !== snapshot.holes.length || card.grossByHole.some((gross) => !integer(gross) || gross <= 0)
    || !integer(card.penalties) || card.penalties < 0) return false;
  const gross = card.grossByHole.reduce((sum, score) => sum + score, 0);
  const net = card.grossByHole.reduce((sum, score, index) => sum + score - entrant.strokesByHole[index], 0);
  const points = card.grossByHole.reduce((sum, score, index) => sum + Math.max(0, Math.min(5, 2 - score + entrant.strokesByHole[index] + snapshot.holes[index].par)), 0);
  return card.grossTotal === gross && card.netTotal === net && card.stablefordPoints === points;
}

/** Reconstructs individual cumulative results exclusively from frozen activation and round evidence. */
export function reconstructIndividualTournamentStandings(event: TournamentEvent):
  | { ok: true; results: TournamentStanding[]; winnerNames: string[]; standings: readonly TournamentRankedStanding[] }
  | { ok: false; reason: string } {
  try {
    const snapshot = event.activationSnapshot;
    const completed = event.rounds?.filter((round) => round.status === "completed") ?? [];
    if (!snapshot || snapshot.teamFormat !== "individual" || !completed.length || completed.some((round, index) => round.roundNumber !== index + 1)) {
      return { ok: false, reason: "Individual standings require contiguous completed frozen rounds." };
    }
    const resultById = new Map<string, TournamentStanding>();
    const evidence: TournamentStandingEvidence[] = snapshot.entrants.map((entrant) => {
      const cards = completed.map((round) => round.scorecards.find((card) => card.entrantId === entrant.entrantId));
      if (cards.some((card) => !card || !validCompletedCard(card, entrant, snapshot))) throw new Error("invalid-card");
      const supplied = cards as TournamentRoundScorecard[];
      const withdrawn = supplied.some((card) => card.status === "withdrawn");
      const played = supplied.filter((card) => card.status === "completed");
      const gross = played.reduce((sum, card) => sum + card.grossTotal, 0);
      const net = played.reduce((sum, card) => sum + (card.netTotal ?? card.grossTotal), 0);
      const points = played.reduce((sum, card) => sum + (card.stablefordPoints ?? 0), 0);
      const holesCompleted = played.reduce((sum, card) => sum + card.grossByHole.length, 0);
      const competition = snapshot.scoringMode === "stableford" ? -points : snapshot.scoringMode === "net-stroke" ? net : gross;
      const scoreToPar = snapshot.scoringMode === "stableford" ? competition : competition - snapshot.par * played.length;
      const finished = !withdrawn && played.length === completed.length;
      const final = finished && completed.length === (event.roundCount ?? snapshot.roundCount ?? 1);
      resultById.set(entrant.entrantId, { entrantId: entrant.entrantId, golferId: null, name: entrant.name, archetype: entrant.archetype, holesCompleted, score: gross, scoreToPar, finished });
      return {
        competitorId: entrant.entrantId,
        status: withdrawn ? "withdrawn" : final ? "completed" : "active",
        completedRounds: played.length,
        holesCompleted: finished ? holesCompleted : 0,
        scoreTotal: finished ? gross : null,
        rankingTotal: finished ? competition : null,
        scoreToPar: finished ? scoreToPar : null,
        rankEligible: finished,
        prizeEligible: final,
        tieBreakKey: `${entrant.name}\0${entrant.entrantId}`,
      };
    });
    const ranked = resolveTournamentStandings(evidence);
    if (!ranked.ok) return ranked;
    return {
      ok: true,
      results: ranked.standings.map((row) => resultById.get(row.competitorId)!),
      winnerNames: ranked.winnerIds.map((id) => resultById.get(id)!.name),
      standings: ranked.standings,
    };
  } catch {
    return { ok: false, reason: "Individual standings evidence is missing, invalid, or malformed." };
  }
}
