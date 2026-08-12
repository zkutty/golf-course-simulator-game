import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { courseHandicapUnrounded, playingHandicapFromUnrounded, strokesByHole } from "../competition/handicap";
import { scoreTeamNetHole } from "../competition/scoring";
import { PRO_AM_MEMBER_ALLOWANCE, TOURNAMENT_TEMPLATES } from "./tournamentTemplates";
import type {
  TournamentActivationSnapshot,
  TournamentEvent,
  TournamentRoundScorecard,
  TournamentTeamStanding,
} from "./types";
import { resolveTournamentStandings, type TournamentRankedStanding } from "./tournamentStandings";

const PRO_AM_TEMPLATE = "four-person-pro-am";
const PRO_AM_ROLES = ["pro", "amateur", "amateur", "amateur"] as const;

type ProAmFailure = { ok: false; reason: string };

export interface ProAmMemberHoleEvidence {
  entrantId: string;
  role: "pro" | "amateur";
  status: "played" | "withdrawn";
  handicapStrokes: number;
  gross?: number;
  net?: number;
}

export interface ProAmTeamHoleEvidence {
  holeId: string;
  par: number;
  status: "scored" | "dnf";
  members: readonly ProAmMemberHoleEvidence[];
  countedEntrantIds: readonly string[];
  net?: number;
  reason?: string;
}

export interface ProAmTeamRoundEvidence {
  teamId: string;
  status: "completed" | "dnf";
  holes: readonly ProAmTeamHoleEvidence[];
  netTotal?: number;
}

export interface ProAmRoundEvidence {
  version: 1;
  activationId: string;
  roundNumber: number;
  scorecards: readonly TournamentRoundScorecard[];
  teams: readonly ProAmTeamRoundEvidence[];
}

export interface ProAmCumulativeTeamEvidence {
  teamId: string;
  status: "active" | "dnf";
  completedRounds: number;
  dnfRounds: number;
  netTotal: number;
}

export interface ProAmCumulativeEvidence {
  version: 1;
  activationId: string;
  completedRounds: number;
  teams: readonly ProAmCumulativeTeamEvidence[];
  /** Reconstructed from the team totals above; DNF teams remain explicitly unplaced. */
  standings: readonly TournamentRankedStanding[];
  winnerTeamIds: readonly string[];
}

export type ProAmRoundResult = { ok: true; evidence: ProAmRoundEvidence } | ProAmFailure;
export type ProAmCumulativeResult = { ok: true; evidence: ProAmCumulativeEvidence } | ProAmFailure;
export type ProAmSetupValidationResult = { ok: true } | ProAmFailure;

const json = JSON.stringify;
const finite = Number.isFinite;
const integer = Number.isInteger;
const safeInteger = Number.isSafeInteger;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const pointEqual = (left: { x: number; y: number }, right: { x: number; y: number }) => left.x === right.x && left.y === right.y;
const point = (value: unknown): value is { x: number; y: number } => Boolean(value && typeof value === "object"
  && finite((value as { x?: number }).x) && finite((value as { y?: number }).y));
const sameKeys = (value: object, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
};
const SNAPSHOT_KEYS = ["version", "activationId", "activatedWeek", "activatedDay", "scoringMode", "teamFormat", "courseId", "courseName", "rating", "slope", "par", "teeSet", "pinRotation", "holes", "entrants", "teams", "templateId", "roundCount", "supportedOverrides", "appliedOverrides", "formatRules"] as const;
const HOLE_KEYS = ["id", "par", "strokeIndex", "tee", "pin"] as const;
const ENTRANT_KEYS = ["entrantId", "name", "archetype", "skill", "teamId", "teamRole", "teamOrder", "teamCaptain", "handicapIndex", "allowance", "courseHandicapUnrounded", "playingHandicap", "strokesByHole"] as const;
const TEAM_KEYS = ["id", "entrantIds", "roles", "captainId"] as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function snapshotProblem(snapshot: TournamentActivationSnapshot): string | null {
  const template = TOURNAMENT_TEMPLATES[PRO_AM_TEMPLATE];
  if (!snapshot || typeof snapshot !== "object" || !sameKeys(snapshot, SNAPSHOT_KEYS)
    || snapshot.version !== 2 || snapshot.templateId !== PRO_AM_TEMPLATE || snapshot.teamFormat !== "pro-am" || snapshot.scoringMode !== "net-stroke") {
    return "Pro-Am scoring requires the immutable four-person Pro-Am activation contract.";
  }
  if (!integer(snapshot.roundCount) || snapshot.roundCount! < 1 || snapshot.roundCount! > 4 || !Array.isArray(snapshot.holes) || snapshot.holes.length !== 18
    || !Array.isArray(snapshot.entrants) || !Array.isArray(snapshot.teams) || !snapshot.formatRules
    || !snapshot.activationId || !finite(snapshot.rating) || !finite(snapshot.slope) || snapshot.slope <= 0 || !integer(snapshot.par)
    || !integer(snapshot.activatedWeek) || !integer(snapshot.activatedDay) || !text(snapshot.activationId) || !text(snapshot.courseId) || !text(snapshot.courseName)
    || !["forward", "member", "championship"].includes(snapshot.teeSet) || !["A", "B", "C"].includes(snapshot.pinRotation)
    || json(snapshot.formatRules) !== json(template.rules) || json(snapshot.supportedOverrides) !== json(template.supportedOverrides)
    || json(snapshot.appliedOverrides) !== json({ roundCount: snapshot.roundCount, teeSet: snapshot.teeSet, pinRotation: snapshot.pinRotation })
    || snapshot.teamHandicaps !== undefined) {
    return "The Pro-Am activation format is incomplete or unsupported.";
  }
  const holeIds = new Set(snapshot.holes.map((hole) => hole.id));
  const strokeIndexes = new Set(snapshot.holes.map((hole) => hole.strokeIndex));
  if (holeIds.size !== 18 || strokeIndexes.size !== 18 || snapshot.holes.some((hole) => !hole || typeof hole !== "object" || !sameKeys(hole, HOLE_KEYS)
    || !text(hole.id) || !integer(hole.par) || hole.par < 1 || !integer(hole.strokeIndex) || hole.strokeIndex < 1 || hole.strokeIndex > 18
    || !point(hole.tee) || !sameKeys(hole.tee, ["x", "y"]) || !point(hole.pin) || !sameKeys(hole.pin, ["x", "y"]))
    || snapshot.holes.reduce((sum, hole) => sum + hole.par, 0) !== snapshot.par) {
    return "The Pro-Am activation route is invalid.";
  }
  const entrantIds = new Set(snapshot.entrants.map((entrant) => entrant.entrantId));
  if (!snapshot.entrants.length || entrantIds.size !== snapshot.entrants.length || snapshot.teams.length * 4 !== snapshot.entrants.length
    || new Set(snapshot.teams.map((team) => team.id)).size !== snapshot.teams.length) {
    return "The Pro-Am activation field identities are invalid.";
  }
  const handicapCourse = { courseRating: snapshot.rating, slopeRating: snapshot.slope, par: snapshot.par };
  const holes = snapshot.holes.map(({ id, par, strokeIndex }) => ({ id, par, strokeIndex }));
  for (const team of snapshot.teams) {
    if (!team || typeof team !== "object" || !sameKeys(team, TEAM_KEYS) || !text(team.id) || !Array.isArray(team.entrantIds)
      || team.entrantIds.length !== 4 || team.entrantIds.some((id: string) => !text(id)) || new Set(team.entrantIds).size !== 4
      || !Array.isArray(team.roles) || json(team.roles) !== json(PRO_AM_ROLES) || !text(team.captainId) || team.captainId !== team.entrantIds[0]) {
      return "Every Pro-Am team requires one pro, three amateurs, and the frozen roster captain.";
    }
    for (let order = 0; order < team.entrantIds.length; order += 1) {
      const entrant = snapshot.entrants.find((candidate) => candidate.entrantId === team.entrantIds[order]);
      const role = PRO_AM_ROLES[order];
      if (!entrant || typeof entrant !== "object" || !sameKeys(entrant, ENTRANT_KEYS) || !text(entrant.entrantId) || !text(entrant.name)
        || !text(entrant.archetype) || !text(entrant.teamId) || entrant.teamId !== team.id || entrant.teamOrder !== order || entrant.teamRole !== role || entrant.teamCaptain !== (order === 0)
        || entrant.allowance !== PRO_AM_MEMBER_ALLOWANCE || !finite(entrant.handicapIndex) || !finite(entrant.skill) || entrant.skill < 0 || entrant.skill > 1
        || !finite(entrant.courseHandicapUnrounded) || !integer(entrant.playingHandicap) || !Array.isArray(entrant.strokesByHole)) {
        return "Pro-Am entrant membership, role, or allowance evidence is invalid.";
      }
      const unrounded = courseHandicapUnrounded(entrant.handicapIndex, handicapCourse);
      const playing = playingHandicapFromUnrounded(unrounded, PRO_AM_MEMBER_ALLOWANCE).rounded;
      if (entrant.courseHandicapUnrounded !== unrounded || entrant.playingHandicap !== playing || json(entrant.strokesByHole) !== json(strokesByHole(playing, holes))) {
        return "Pro-Am handicap evidence does not match the frozen 85% authority.";
      }
    }
  }
  if (new Set(snapshot.teams.flatMap((team) => team.entrantIds)).size !== snapshot.entrants.length
    || snapshot.entrants.some((entrant) => !snapshot.teams.some((team) => team.entrantIds.includes(entrant.entrantId)))) {
    return "The Pro-Am activation field does not partition every entrant exactly once.";
  }
  return null;
}

function courseProblem(snapshot: TournamentActivationSnapshot, course: PlayerRoundCourseSnapshot): string | null {
  if (course.courseId !== snapshot.courseId || course.courseName !== snapshot.courseName || course.holes.length !== snapshot.holes.length
    || !course.rating || course.rating.courseRating !== snapshot.rating || course.rating.slope !== snapshot.slope) {
    return "The immutable round course does not match Pro-Am activation identity or rating authority.";
  }
  if (!integer(course.width) || !integer(course.height) || course.width < 1 || course.height < 1 || !finite(course.yardsPerTile) || course.yardsPerTile <= 0
    || course.tiles.length !== course.width * course.height || course.elevations.length !== course.tiles.length
    || course.elevations.some((height) => !finite(height))) {
    return "The immutable round course geometry is incomplete.";
  }
  for (let index = 0; index < snapshot.holes.length; index += 1) {
    const expected = snapshot.holes[index];
    const actual = course.holes[index];
    if (!actual || !point(actual.tee) || !point(actual.pin) || actual.id !== expected.id || actual.par !== expected.par || actual.strokeIndex !== expected.strokeIndex
      || actual.teeSet !== snapshot.teeSet || actual.pinRotation !== snapshot.pinRotation
      || !pointEqual(actual.tee, expected.tee) || !pointEqual(actual.pin, expected.pin)) {
      return "The immutable round course route or setup differs from Pro-Am activation.";
    }
  }
  return null;
}

/** Shared fail-closed boundary for adapters that consume the frozen Pro-Am setup. */
export function validateProAmRoundSetup(
  snapshot: TournamentActivationSnapshot,
  course: PlayerRoundCourseSnapshot,
): ProAmSetupValidationResult {
  try {
    const problem = snapshotProblem(snapshot) ?? courseProblem(snapshot, course);
    return problem ? { ok: false, reason: problem } : { ok: true };
  } catch {
    return { ok: false, reason: "The Pro-Am activation or immutable round course is malformed." };
  }
}

export function canonicalProAmCard(snapshot: TournamentActivationSnapshot, card: TournamentRoundScorecard | undefined): TournamentRoundScorecard | null {
  if (!card) return null;
  const entrant = snapshot.entrants.find((candidate) => candidate.entrantId === card.entrantId);
  if (!entrant || !safeInteger(card.penalties) || card.penalties < 0) return null;
  if (card.status === "withdrawn") {
    return Object.keys(card).length === 5 && Array.isArray(card.grossByHole) && card.grossByHole.length === 0 && card.penalties === 0 && card.grossTotal === 0
      && !("netTotal" in card) && !("stablefordPoints" in card)
      ? { entrantId: card.entrantId, status: "withdrawn", grossByHole: [], penalties: 0, grossTotal: 0 }
      : null;
  }
  if (card.status !== "completed" || Object.keys(card).length !== 7 || !Array.isArray(card.grossByHole) || card.grossByHole.length !== 18 || card.grossByHole.some((gross) => !safeInteger(gross) || gross <= 0)) return null;
  const grossTotal = card.grossByHole.reduce((sum, gross) => sum + gross, 0);
  const netTotal = card.grossByHole.reduce((sum, gross, index) => sum + gross - entrant.strokesByHole[index], 0);
  const stablefordPoints = card.grossByHole.reduce((sum, gross, index) => sum + Math.max(0, Math.min(5, 2 - gross + entrant.strokesByHole[index] + snapshot.holes[index].par)), 0);
  if (![grossTotal, netTotal, stablefordPoints].every(safeInteger)
    || card.grossTotal !== grossTotal || card.netTotal !== netTotal || card.stablefordPoints !== stablefordPoints) return null;
  return { entrantId: card.entrantId, status: "completed", grossByHole: [...card.grossByHole], penalties: card.penalties, grossTotal, netTotal, stablefordPoints };
}

/** Scores exact participant gross evidence; it never accepts claimed team selections or totals. */
export function scoreProAmRoundEvidence(snapshot: TournamentActivationSnapshot, roundNumber: number, scorecards: readonly TournamentRoundScorecard[]): ProAmRoundResult {
  let problem: string | null;
  try { problem = snapshotProblem(snapshot); }
  catch { return { ok: false, reason: "The Pro-Am activation contract is malformed." }; }
  if (problem) return { ok: false, reason: problem };
  if (!Array.isArray(scorecards)) return { ok: false, reason: "Every frozen Pro-Am entrant requires exactly one gross scorecard or withdrawal marker." };
  if (!integer(roundNumber) || roundNumber < 1 || roundNumber > snapshot.roundCount!) return { ok: false, reason: "The Pro-Am round number is outside the frozen activation schedule." };
  if (scorecards.length !== snapshot.entrants.length || scorecards.some((card) => !card)
    || new Set(scorecards.map((card) => card.entrantId)).size !== scorecards.length) {
    return { ok: false, reason: "Every frozen Pro-Am entrant requires exactly one gross scorecard or withdrawal marker." };
  }
  const supplied = new Map(scorecards.map((card) => [card.entrantId, card]));
  const canonical = snapshot.entrants.map((entrant) => canonicalProAmCard(snapshot, supplied.get(entrant.entrantId)!));
  if (canonical.some((card) => !card)) return { ok: false, reason: "Pro-Am participant gross evidence is missing, forged, or malformed." };
  const cards = canonical as TournamentRoundScorecard[];
  const cardById = new Map(cards.map((card) => [card.entrantId, card]));
  const entrantById = new Map(snapshot.entrants.map((entrant) => [entrant.entrantId, entrant]));
  let teams: ProAmTeamRoundEvidence[];
  try { teams = snapshot.teams.map((team): ProAmTeamRoundEvidence => {
    const holes = snapshot.holes.map((hole, holeIndex): ProAmTeamHoleEvidence => {
      const members = team.entrantIds.map((entrantId): ProAmMemberHoleEvidence => {
        const entrant = entrantById.get(entrantId)!;
        const card = cardById.get(entrantId)!;
        const role = entrant.teamRole as "pro" | "amateur";
        return card.status === "withdrawn"
          ? { entrantId, role, status: "withdrawn", handicapStrokes: entrant.strokesByHole[holeIndex] }
          : { entrantId, role, status: "played", handicapStrokes: entrant.strokesByHole[holeIndex], gross: card.grossByHole[holeIndex], net: card.grossByHole[holeIndex] - entrant.strokesByHole[holeIndex] };
      });
      const played = members.filter((member): member is ProAmMemberHoleEvidence & { gross: number; net: number } => member.status === "played");
      const counted = played.length >= 2 && played.some((member) => member.role === "amateur")
        ? scoreTeamNetHole("pro-am", played.map((member) => ({ playerId: member.entrantId, role: member.role, gross: member.gross, net: member.net })))
        : null;
      return counted
        ? { holeId: hole.id, par: hole.par, status: "scored", members, countedEntrantIds: counted.countedPlayerIds, net: counted.net }
        : { holeId: hole.id, par: hole.par, status: "dnf", members, countedEntrantIds: [], reason: played.some((member) => member.role === "amateur") ? "Fewer than two eligible team scores." : "No amateur score is available." };
    });
    const dnf = holes.some((hole) => hole.status === "dnf");
    return { teamId: team.id, status: dnf ? "dnf" : "completed", holes, ...(!dnf ? { netTotal: holes.reduce((sum, hole) => sum + hole.net!, 0) } : {}) };
  }); } catch {
    return { ok: false, reason: "Pro-Am participant gross evidence cannot be scored safely." };
  }
  if (teams.some((team) => team.netTotal !== undefined && !safeInteger(team.netTotal))) {
    return { ok: false, reason: "Pro-Am participant gross evidence cannot be scored safely." };
  }
  return { ok: true, evidence: deepFreeze({ version: 1, activationId: snapshot.activationId, roundNumber, scorecards: cards, teams }) };
}

/** Recomputes each supplied round and returns snapshot-order cumulative totals, never rankings or ties. */
export function scoreProAmCumulativeEvidence(snapshot: TournamentActivationSnapshot, rounds: readonly Pick<ProAmRoundEvidence, "roundNumber" | "scorecards">[]): ProAmCumulativeResult {
  let problem: string | null;
  try { problem = snapshotProblem(snapshot); }
  catch { return { ok: false, reason: "The Pro-Am activation contract is malformed." }; }
  if (problem) return { ok: false, reason: problem };
  if (!Array.isArray(rounds) || !rounds.length || rounds.length > snapshot.roundCount! || rounds.some((round, index) => !round || round.roundNumber !== index + 1)) {
    return { ok: false, reason: "Pro-Am cumulative evidence requires contiguous frozen rounds starting at round one." };
  }
  const rescored = rounds.map((round) => scoreProAmRoundEvidence(snapshot, round.roundNumber, round.scorecards));
  if (rescored.some((result) => !result.ok)) return rescored.find((result): result is ProAmFailure => !result.ok)!;
  const evidence = rescored.map((result) => (result as { ok: true; evidence: ProAmRoundEvidence }).evidence);
  const teams = snapshot.teams.map((team): ProAmCumulativeTeamEvidence => {
    const results = evidence.map((round) => round.teams.find((candidate) => candidate.teamId === team.id)!);
    const dnfRounds = results.filter((result) => result.status === "dnf").length;
    return { teamId: team.id, status: dnfRounds ? "dnf" : "active", completedRounds: evidence.length, dnfRounds, netTotal: results.reduce((sum, result) => sum + (result.netTotal ?? 0), 0) };
  });
  if (teams.some((team) => !safeInteger(team.netTotal))) {
    return { ok: false, reason: "Pro-Am cumulative gross evidence cannot be scored safely." };
  }
  const final = evidence.length === snapshot.roundCount;
  const ranked = resolveTournamentStandings(teams.map((team) => ({
    competitorId: team.teamId,
    status: team.status === "dnf" ? "dnf" as const : final ? "completed" as const : "active" as const,
    completedRounds: team.completedRounds,
    holesCompleted: team.status === "dnf" ? 0 : team.completedRounds * snapshot.holes.length,
    scoreTotal: team.status === "dnf" ? null : team.netTotal,
    rankingTotal: team.status === "dnf" ? null : team.netTotal,
    scoreToPar: team.status === "dnf" ? null : team.netTotal - snapshot.par * 2 * team.completedRounds,
    rankEligible: team.status !== "dnf",
    prizeEligible: team.status !== "dnf" && final,
    tieBreakKey: team.teamId,
  })));
  if (!ranked.ok) return ranked;
  return { ok: true, evidence: deepFreeze({ version: 1, activationId: snapshot.activationId, completedRounds: evidence.length, teams, standings: ranked.standings, winnerTeamIds: ranked.winnerIds }) };
}

/** Reconstructs event-level Pro-Am results exclusively from frozen round cards. */
export function reconstructProAmTournamentEvidence(event: TournamentEvent): ProAmCumulativeResult {
  const snapshot = event.activationSnapshot;
  const completed = event.rounds?.filter((round) => round.status === "completed") ?? [];
  if (!snapshot || snapshot.teamFormat !== "pro-am" || !completed.length) {
    return { ok: false, reason: "Pro-Am tournament evidence requires completed frozen rounds." };
  }
  try {
    return scoreProAmCumulativeEvidence(snapshot, completed.map((round) => ({
      roundNumber: round.roundNumber,
      scorecards: round.scorecards,
    })));
  } catch {
    return { ok: false, reason: "Pro-Am tournament evidence is malformed." };
  }
}

/** Stable persisted read model; the scorecards remain the only authority. */
export function projectProAmTeamStandings(
  evidence: ProAmCumulativeEvidence,
  finalRound: boolean,
): TournamentTeamStanding[] {
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
