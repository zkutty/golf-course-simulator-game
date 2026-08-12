import {
  challengeGroupPlayerRound,
  challengeGroupPlayerSkills,
  commitChallengeGroupPlayerShot,
  startChallengeGroupRound,
  type ChallengeGroupParticipantInput,
} from "../competition/challengeGroupRound";
import type { PlayerProSkills, PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { caddieRecommendation } from "../playerPro/playerPro";
import {
  canonicalProAmCard,
  scoreProAmRoundEvidence,
  validateProAmRoundSetup,
  type ProAmRoundResult,
} from "./proAmField";
import { PRO_AM_MEMBER_ALLOWANCE } from "./tournamentTemplates";
import type {
  TournamentActivationEntrantSnapshot,
  TournamentActivationSnapshot,
  TournamentRoundScorecard,
} from "./types";

const MAX_PLAYER_TURNS = 480;
const json = JSON.stringify;
const integer = Number.isInteger;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function stableSeed(source: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function skillsFor(skill: number): PlayerProSkills {
  const value = Math.max(0, Math.min(100, Math.round(skill * 100)));
  return { power: value, driving: value, irons: value, shortGame: value, putting: value, recovery: value };
}

function participant(
  entrant: TournamentActivationEntrantSnapshot,
  course: PlayerRoundCourseSnapshot,
  teeSet: TournamentActivationSnapshot["teeSet"],
  pinRotation: TournamentActivationSnapshot["pinRotation"],
  controller: "player" | "ai",
): ChallengeGroupParticipantInput {
  return {
    id: entrant.entrantId,
    name: entrant.name,
    controller,
    // ChallengeGroupRound is used only as independent own-ball shot authority;
    // Pro-Am team selection remains in the evidence scorer.
    teamId: `individual:${entrant.entrantId}`,
    handedness: stableSeed(entrant.entrantId) % 2 ? "right" : "left",
    skills: skillsFor(entrant.skill),
    handicapIndex: entrant.handicapIndex,
    handicapAllowance: PRO_AM_MEMBER_ALLOWANCE,
    setup: { course, teeSet, pinRotation },
  };
}

/** Private score-only state; never returned, validated as a group round, or persisted. */
function compactProAmSimulationBurst(round: ReturnType<typeof startChallengeGroupRound>): ReturnType<typeof startChallengeGroupRound> {
  if ((round.phase !== "awaiting_player" && round.phase !== "complete")
    || round.teamAuthority || round.individualAuthority?.contests.length) {
    throw new Error("Only a settled own-ball Pro-Am simulation burst can be compacted.");
  }
  return {
    ...round,
    golfers: round.golfers.map((golfer) => ({ ...golfer, shots: [] })),
    turnEvidence: [],
  };
}

function simulateTeam(snapshot: TournamentActivationSnapshot, course: PlayerRoundCourseSnapshot, teamId: string, roundNumber: number, seed: number): TournamentRoundScorecard[] | null {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId)!;
  const entrants = team.entrantIds.map((id) => snapshot.entrants.find((entrant) => entrant.entrantId === id)!);
  let round;
  try {
    round = startChallengeGroupRound({
      id: `${snapshot.activationId}:pro-am:${roundNumber}:${teamId}`,
      course,
      rulesSnapshot: course.rulesSnapshot,
      teeSet: snapshot.teeSet,
      pinRotation: snapshot.pinRotation,
      participants: entrants.map((entrant, index) => participant(entrant, course, snapshot.teeSet, snapshot.pinRotation, index === 0 ? "player" : "ai")),
      individualFormat: "net-stroke",
      rngSeed: (seed ^ stableSeed(`${snapshot.activationId}:${roundNumber}:${teamId}`)) >>> 0,
      startedWeek: snapshot.activatedWeek,
      startedDay: snapshot.activatedDay + roundNumber - 1,
    });
    let guard = 0;
    while (round.phase !== "complete" && guard++ < MAX_PLAYER_TURNS) {
      const view = challengeGroupPlayerRound(round);
      if (!view || round.phase !== "awaiting_player") return null;
      round = commitChallengeGroupPlayerShot(round, round.playerGolferId, caddieRecommendation(view, challengeGroupPlayerSkills(round)));
      round = compactProAmSimulationBurst(round);
    }
    if (round.phase !== "complete") return null;
  } catch {
    return null;
  }
  const scorecards: TournamentRoundScorecard[] = [];
  for (const entrant of entrants) {
    const golfer = round.golfers.find((candidate) => candidate.id === entrant.entrantId)!;
    if (golfer.handicap.playingHandicap !== entrant.playingHandicap || json(golfer.handicap.strokesByHole) !== json(entrant.strokesByHole)
      || golfer.scorecard.some((hole) => hole.status !== "played" || !integer(hole.gross) || hole.gross! <= 0)) return null;
    const grossByHole = golfer.scorecard.map((hole) => hole.gross!);
    const grossTotal = grossByHole.reduce((sum, gross) => sum + gross, 0);
    const netTotal = grossByHole.reduce((sum, gross, index) => sum + gross - entrant.strokesByHole[index], 0);
    const stablefordPoints = grossByHole.reduce((sum, gross, index) => sum + Math.max(0, Math.min(5, 2 - gross + entrant.strokesByHole[index] + snapshot.holes[index].par)), 0);
    scorecards.push({ entrantId: entrant.entrantId, status: "completed", grossByHole, penalties: golfer.scorecard.reduce((sum, hole) => sum + hole.penalties, 0), grossTotal, netTotal, stablefordPoints });
  }
  return scorecards;
}

export interface SimulateProAmFieldArgs {
  snapshot: TournamentActivationSnapshot;
  /** Existing persisted Player/Challenge round snapshot; never rebuilt from live Course. */
  course: PlayerRoundCourseSnapshot;
  roundNumber: number;
  seed: number;
  /** Trusted visible participant evidence replaces that participant's simulated gross only after full validation. */
  visibleScorecards?: readonly TournamentRoundScorecard[];
}

/** Deterministically simulates non-visible evidence through the shared Player Pro shot authority. */
export function simulateProAmFieldRound(args: SimulateProAmFieldArgs): ProAmRoundResult {
  const setup = validateProAmRoundSetup(args.snapshot, args.course);
  if (!setup.ok) return setup;
  if (!integer(args.roundNumber) || args.roundNumber < 1 || args.roundNumber > args.snapshot.roundCount! || !integer(args.seed)) {
    return { ok: false, reason: "Pro-Am simulation requires a valid frozen round number and integer seed." };
  }
  const visible = args.visibleScorecards ?? [];
  if (!Array.isArray(visible)) return { ok: false, reason: "Visible Pro-Am gross evidence is duplicated, forged, or malformed." };
  if (visible.some((card) => !card) || new Set(visible.map((card) => card.entrantId)).size !== visible.length || visible.some((card) => !canonicalProAmCard(args.snapshot, card))) {
    return { ok: false, reason: "Visible Pro-Am gross evidence is duplicated, forged, or malformed." };
  }
  let course: PlayerRoundCourseSnapshot;
  try { course = deepFreeze(clone(args.course)); }
  catch { return { ok: false, reason: "The immutable round course cannot be cloned for deterministic simulation." }; }
  const simulated = args.snapshot.teams.flatMap((team) => simulateTeam(args.snapshot, course, team.id, args.roundNumber, args.seed) ?? []);
  if (simulated.length !== args.snapshot.entrants.length) return { ok: false, reason: "The shared shot authority could not complete the Pro-Am field." };
  const visibleById = new Map(visible.map((card) => [card.entrantId, canonicalProAmCard(args.snapshot, card)!]));
  const simulatedById = new Map(simulated.map((card) => [card.entrantId, card]));
  const scorecards = args.snapshot.entrants.map((entrant) => visibleById.get(entrant.entrantId) ?? simulatedById.get(entrant.entrantId)!);
  return scoreProAmRoundEvidence(args.snapshot, args.roundNumber, scorecards);
}
