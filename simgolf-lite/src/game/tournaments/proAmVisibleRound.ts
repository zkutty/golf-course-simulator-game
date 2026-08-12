import {
  challengeGroupPlayerRound,
  challengeGroupPlayerSkills,
  commitChallengeGroupPlayerShot,
  decodeChallengeGroupRound,
  encodeChallengeGroupRound,
  startChallengeGroupRound,
  withdrawChallengeGroupGolfer,
  type ChallengeGroupParticipantInput,
  type ChallengeGroupRound,
} from "../competition/challengeGroupRound";
import type {
  PlayerPlayableRound,
  PlayerProSkills,
  PlayerRoundCourseSnapshot,
} from "../models/playerProTypes";
import type { PlayerShotSelection } from "../playerPro/playerPro";
import { PRO_AM_MEMBER_ALLOWANCE } from "./tournamentTemplates";
import {
  simulateProAmFieldRound,
  validateProAmRoundSetup,
  type ProAmRoundEvidence,
} from "./proAmField";
import type {
  TournamentActivationEntrantSnapshot,
  TournamentActivationSnapshot,
  TournamentRoundScorecard,
} from "./types";

const VERSION = 1 as const;
const MAX_ACTIONS = 512;
const KEYS = ["version", "activationId", "roundNumber", "teamId", "playerEntrantId", "seed", "actions", "challengeRound"] as const;
const SHOT_KEYS = ["club", "aim", "power", "technique"] as const;
const SHOT_KEYS_WITH_FLIGHT = [...SHOT_KEYS, "flightProfile"] as const;
const TECHNIQUES = ["normal", "draw", "fade", "punch", "flop", "backspin"] as const;
const FLIGHT_PROFILES = ["low", "standard", "high"] as const;
const json = JSON.stringify;
const integer = Number.isInteger;

export type ProAmVisibleAction =
  | { type: "player-shot"; selection: PlayerShotSelection }
  | { type: "withdrawal"; entrantId: string; reason: string };

export interface ProAmVisibleRound {
  version: typeof VERSION;
  activationId: string;
  roundNumber: number;
  teamId: string;
  playerEntrantId: string;
  /** Caller-owned field seed; ChallengeGroupRound stores the derived team seed. */
  seed: number;
  /** Exact trusted inputs replayed through ChallengeGroup authority on load/settlement. */
  actions: readonly ProAmVisibleAction[];
  challengeRound: ChallengeGroupRound;
}

type ProAmVisibleFailure = { ok: false; reason: string };

export type ProAmVisibleStartResult =
  | { ok: true; round: ProAmVisibleRound }
  | ProAmVisibleFailure;

export type ProAmVisibleDecodeResult =
  | { ok: true; round: ProAmVisibleRound }
  | ProAmVisibleFailure;

export type ProAmVisibleSettlementResult =
  | {
    ok: true;
    visibleScorecards: readonly TournamentRoundScorecard[];
    evidence: ProAmRoundEvidence;
  }
  | ProAmVisibleFailure;

export interface StartProAmVisibleRoundArgs {
  snapshot: TournamentActivationSnapshot;
  /** Existing persisted Player/Challenge snapshot; never rebuilt from mutable Course. */
  course: PlayerRoundCourseSnapshot;
  roundNumber: number;
  teamId: string;
  playerEntrantId: string;
  seed: number;
}

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

function sameKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validSelection(value: unknown): value is PlayerShotSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as PlayerShotSelection;
  const keys = selection.flightProfile === undefined ? SHOT_KEYS : SHOT_KEYS_WITH_FLIGHT;
  return sameKeys(value, keys)
    && typeof selection.club === "string" && selection.club.length > 0
    && !!selection.aim && typeof selection.aim === "object" && sameKeys(selection.aim, ["x", "y"])
    && Number.isFinite(selection.aim.x) && Number.isFinite(selection.aim.y)
    && Number.isFinite(selection.power)
    && TECHNIQUES.includes(selection.technique)
    && (selection.flightProfile === undefined || FLIGHT_PROFILES.includes(selection.flightProfile));
}

function validAction(value: unknown): value is ProAmVisibleAction {
  if (!value || typeof value !== "object") return false;
  const action = value as ProAmVisibleAction;
  if (action.type === "player-shot") return sameKeys(value, ["type", "selection"]) && validSelection(action.selection);
  return action.type === "withdrawal" && sameKeys(value, ["type", "entrantId", "reason"])
    && typeof action.entrantId === "string" && action.entrantId.length > 0
    && typeof action.reason === "string" && action.reason.length > 0 && action.reason.length <= 200;
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
  return {
    power: value,
    driving: value,
    irons: value,
    shortGame: value,
    putting: value,
    recovery: value,
  };
}

function roundId(snapshot: TournamentActivationSnapshot, roundNumber: number, teamId: string): string {
  return `${snapshot.activationId}:pro-am:${roundNumber}:${teamId}`;
}

function derivedSeed(snapshot: TournamentActivationSnapshot, roundNumber: number, teamId: string, seed: number): number {
  return (seed ^ stableSeed(`${snapshot.activationId}:${roundNumber}:${teamId}`)) >>> 0;
}

function participant(
  entrant: TournamentActivationEntrantSnapshot,
  course: PlayerRoundCourseSnapshot,
  snapshot: TournamentActivationSnapshot,
  controller: "player" | "ai",
): ChallengeGroupParticipantInput {
  return {
    id: entrant.entrantId,
    name: entrant.name,
    controller,
    teamId: `individual:${entrant.entrantId}`,
    handedness: stableSeed(entrant.entrantId) % 2 ? "right" : "left",
    skills: skillsFor(entrant.skill),
    handicapIndex: entrant.handicapIndex,
    handicapAllowance: PRO_AM_MEMBER_ALLOWANCE,
    setup: { course, teeSet: snapshot.teeSet, pinRotation: snapshot.pinRotation },
  };
}

function playerBindingProblem(
  snapshot: TournamentActivationSnapshot,
  teamId: string,
  playerEntrantId: string,
): string | null {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) return "The requested visible Pro-Am team is not in the frozen field.";
  const members = team.entrantIds.map((id) => snapshot.entrants.find((entrant) => entrant.entrantId === id));
  const pros = members.filter((entrant) => entrant?.teamRole === "pro");
  if (typeof playerEntrantId !== "string" || !playerEntrantId || pros.length !== 1
    || pros[0]?.entrantId !== playerEntrantId || team.captainId !== playerEntrantId
    || team.entrantIds.filter((id) => id === playerEntrantId).length !== 1) {
    return "The visible Pro-Am player must be the unique frozen pro and team captain.";
  }
  return null;
}

function createChallengeRound(
  snapshot: TournamentActivationSnapshot,
  course: PlayerRoundCourseSnapshot,
  roundNumber: number,
  teamId: string,
  playerEntrantId: string,
  seed: number,
): ChallengeGroupRound {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId)!;
  const entrants = team.entrantIds.map((id) => snapshot.entrants.find((entrant) => entrant.entrantId === id)!);
  return startChallengeGroupRound({
    id: roundId(snapshot, roundNumber, team.id),
    course,
    rulesSnapshot: course.rulesSnapshot,
    teeSet: snapshot.teeSet,
    pinRotation: snapshot.pinRotation,
    participants: entrants.map((entrant) => participant(
      entrant,
      course,
      snapshot,
      entrant.entrantId === playerEntrantId ? "player" : "ai",
    )),
    individualFormat: "net-stroke",
    rngSeed: derivedSeed(snapshot, roundNumber, team.id, seed),
    startedWeek: snapshot.activatedWeek,
    startedDay: snapshot.activatedDay + roundNumber - 1,
  });
}

function replayActions(
  state: ProAmVisibleRound,
  snapshot: TournamentActivationSnapshot,
  course: PlayerRoundCourseSnapshot,
): ChallengeGroupRound | null {
  let round: ChallengeGroupRound;
  try {
    round = createChallengeRound(
      snapshot,
      course,
      state.roundNumber,
      state.teamId,
      state.playerEntrantId,
      state.seed,
    );
    for (const action of state.actions) {
      const prior = round;
      round = action.type === "player-shot"
        ? commitChallengeGroupPlayerShot(round, state.playerEntrantId, action.selection)
        : withdrawChallengeGroupGolfer(round, action.entrantId, action.reason);
      if (round === prior) return null;
    }
  } catch {
    return null;
  }
  return round;
}

function bindingProblem(
  state: ProAmVisibleRound,
  snapshot: TournamentActivationSnapshot,
  course: PlayerRoundCourseSnapshot,
): string | null {
  const setup = validateProAmRoundSetup(snapshot, course);
  if (!setup.ok) return setup.reason;
  if (!state || typeof state !== "object" || !sameKeys(state, KEYS) || state.version !== VERSION
    || state.activationId !== snapshot.activationId || !integer(state.roundNumber)
    || state.roundNumber < 1 || state.roundNumber > snapshot.roundCount! || !integer(state.seed)
    || typeof state.teamId !== "string" || !state.teamId
    || typeof state.playerEntrantId !== "string" || !state.playerEntrantId
    || !Array.isArray(state.actions) || state.actions.length > MAX_ACTIONS
    || state.actions.some((action) => !validAction(action))) {
    return "The visible Pro-Am linkage is invalid.";
  }
  const team = snapshot.teams.find((candidate) => candidate.id === state.teamId);
  const playerProblem = playerBindingProblem(snapshot, state.teamId, state.playerEntrantId);
  if (playerProblem) return playerProblem;
  if (state.actions.some((action) => action.type === "withdrawal" && !team?.entrantIds.includes(action.entrantId))) {
    return "A visible Pro-Am withdrawal references a golfer outside the frozen team.";
  }
  const round = state.challengeRound;
  if (!team || !round || round.id !== roundId(snapshot, state.roundNumber, team.id)
    || round.rngSeed !== derivedSeed(snapshot, state.roundNumber, team.id, state.seed)
    || round.startedWeek !== snapshot.activatedWeek
    || round.startedDay !== snapshot.activatedDay + state.roundNumber - 1
    || round.teeSet !== snapshot.teeSet || round.pinRotation !== snapshot.pinRotation
    || json(round.course) !== json(course) || json(round.rulesSnapshot) !== json(course.rulesSnapshot)
    || round.teamAuthority !== undefined || round.sideBets.length !== 0
    || round.individualAuthority?.format !== "net-stroke"
    || round.individualAuthority.contests.length !== 0
    || round.individualAuthority.results.length !== 0
    || round.individualAuthority.measurements.length !== 0) {
    return "The visible Pro-Am round drifted from its frozen activation or course authority.";
  }
  if (round.golfers.length !== 4 || json(round.golfers.map((golfer) => golfer.id)) !== json(team.entrantIds)
    || round.playerGolferId !== state.playerEntrantId) {
    return "The visible Pro-Am roster is not the exact frozen one-pro/three-amateur group.";
  }
  for (let index = 0; index < team.entrantIds.length; index += 1) {
    const entrant = snapshot.entrants.find((candidate) => candidate.entrantId === team.entrantIds[index]);
    const golfer = round.golfers[index];
    if (!entrant || !golfer || entrant.teamId !== team.id || entrant.teamOrder !== index
      || entrant.teamRole !== (entrant.entrantId === state.playerEntrantId ? "pro" : "amateur")
      || golfer.name !== entrant.name || golfer.controller !== (entrant.entrantId === state.playerEntrantId ? "player" : "ai")
      || golfer.teamId !== `individual:${entrant.entrantId}`
      || golfer.handedness !== (stableSeed(entrant.entrantId) % 2 ? "right" : "left")
      || json(golfer.skills) !== json(skillsFor(entrant.skill))
      || golfer.handicap.handicapIndex !== entrant.handicapIndex
      || golfer.handicap.allowance !== PRO_AM_MEMBER_ALLOWANCE
      || golfer.handicap.playingHandicap !== entrant.playingHandicap
      || json(golfer.handicap.strokesByHole) !== json(entrant.strokesByHole)
      || golfer.setup.teeSet !== snapshot.teeSet || golfer.setup.pinRotation !== snapshot.pinRotation
      || json(golfer.setup.holes) !== json(course.holes) || json(golfer.setup.rating) !== json(course.rating)) {
      return "The visible Pro-Am participant authority is invalid.";
    }
  }
  return null;
}

function coherenceProblem(
  state: ProAmVisibleRound,
  snapshot: TournamentActivationSnapshot,
  course: PlayerRoundCourseSnapshot,
): string | null {
  const replayed = replayActions(state, snapshot, course);
  return replayed && json(replayed) === json(state.challengeRound)
    ? null
    : "The visible Pro-Am transcript does not match its trusted action log.";
}

function visibleScorecards(state: ProAmVisibleRound): TournamentRoundScorecard[] | null {
  if (state.challengeRound.phase !== "complete") return null;
  const cards: TournamentRoundScorecard[] = [];
  for (const golfer of state.challengeRound.golfers) {
    if (golfer.withdrawn) {
      cards.push({
        entrantId: golfer.id,
        status: "withdrawn" as const,
        grossByHole: [],
        penalties: 0,
        grossTotal: 0,
      });
      continue;
    }
    if (golfer.scorecard.some((hole) => hole.status !== "played"
      || !integer(hole.gross) || hole.gross! <= 0 || !integer(hole.penalties) || hole.penalties < 0)) return null;
    const grossByHole = golfer.scorecard.map((hole) => hole.gross!);
    const grossTotal = grossByHole.reduce((sum, gross) => sum + gross, 0);
    const netTotal = golfer.scorecard.reduce((sum, hole) => sum + hole.net!, 0);
    const stablefordPoints = golfer.scorecard.reduce((sum, hole) => sum + Math.max(0, Math.min(5, 2 - hole.gross! + hole.handicapStrokes + hole.par)), 0);
    cards.push({
      entrantId: golfer.id,
      status: "completed" as const,
      grossByHole,
      penalties: golfer.scorecard.reduce((sum, hole) => sum + hole.penalties, 0),
      grossTotal,
      netTotal,
      stablefordPoints,
    });
  }
  return cards;
}

/** Starts exactly one visible frozen Pro-Am group through shared ChallengeGroup authority. */
export function startProAmVisibleRound(args: StartProAmVisibleRoundArgs): ProAmVisibleStartResult {
  const setup = validateProAmRoundSetup(args.snapshot, args.course);
  if (!setup.ok) return setup;
  if (!integer(args.roundNumber) || args.roundNumber < 1 || args.roundNumber > args.snapshot.roundCount! || !integer(args.seed)) {
    return { ok: false, reason: "A visible Pro-Am round requires a frozen round number and integer seed." };
  }
  const team = args.snapshot.teams.find((candidate) => candidate.id === args.teamId);
  if (!team) return { ok: false, reason: "The requested visible Pro-Am team is not in the frozen field." };
  const playerProblem = playerBindingProblem(args.snapshot, args.teamId, args.playerEntrantId);
  if (playerProblem) return { ok: false, reason: playerProblem };
  try {
    const challengeRound = createChallengeRound(
      args.snapshot,
      args.course,
      args.roundNumber,
      team.id,
      args.playerEntrantId,
      args.seed,
    );
    return {
      ok: true,
      round: deepFreeze({
        version: VERSION,
        activationId: args.snapshot.activationId,
        roundNumber: args.roundNumber,
        teamId: team.id,
        playerEntrantId: args.playerEntrantId,
        seed: args.seed,
        actions: [],
        challengeRound,
      }),
    };
  } catch {
    return { ok: false, reason: "The shared shot authority could not start the visible Pro-Am group." };
  }
}

/** Encodes the full ChallengeGroup transcript; no honors, reaction, or turn evidence is compacted. */
export function encodeProAmVisibleRound(round: ProAmVisibleRound): string {
  encodeChallengeGroupRound(round.challengeRound);
  return json(round);
}

/** Normalizes hostile JSON against the immutable activation and persisted round-course authorities. */
export function decodeProAmVisibleRound(
  raw: string | unknown,
  snapshot: TournamentActivationSnapshot,
  course: PlayerRoundCourseSnapshot,
): ProAmVisibleDecodeResult {
  let value: unknown;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
  } catch {
    return { ok: false, reason: "The visible Pro-Am save is not valid JSON." };
  }
  if (!value || typeof value !== "object") return { ok: false, reason: "The visible Pro-Am save is invalid." };
  const candidate = value as ProAmVisibleRound;
  const decoded = decodeChallengeGroupRound(candidate.challengeRound);
  if (!decoded.ok) return { ok: false, reason: decoded.error };
  const normalized = { ...candidate, challengeRound: decoded.round };
  let problem: string | null;
  try {
    problem = bindingProblem(normalized, snapshot, course);
    if (!problem) problem = coherenceProblem(normalized, snapshot, course);
  } catch {
    problem = "The visible Pro-Am save is malformed.";
  }
  return problem ? { ok: false, reason: problem } : { ok: true, round: deepFreeze(normalized) };
}

export function proAmVisiblePlayerRound(round: ProAmVisibleRound): PlayerPlayableRound | null {
  return challengeGroupPlayerRound(round.challengeRound);
}

export function proAmVisiblePlayerSkills(round: ProAmVisibleRound): PlayerProSkills {
  return challengeGroupPlayerSkills(round.challengeRound);
}

/** A duplicate action after completion is explicitly inert. */
export function commitProAmVisiblePlayerShot(round: ProAmVisibleRound, selection: PlayerShotSelection): ProAmVisibleRound {
  if (round.challengeRound.phase === "complete") return round;
  if (!validSelection(selection)) throw new Error("Visible Pro-Am shot input is malformed.");
  if (round.actions.length >= MAX_ACTIONS) throw new Error("Visible Pro-Am action log exceeded its deterministic bound.");
  const challengeRound = commitChallengeGroupPlayerShot(round.challengeRound, round.playerEntrantId, selection);
  if (challengeRound === round.challengeRound) return round;
  return deepFreeze({
    ...round,
    actions: [...round.actions, { type: "player-shot" as const, selection: clone(selection) }],
    challengeRound,
  });
}

export function withdrawProAmVisibleGolfer(
  round: ProAmVisibleRound,
  entrantId: string,
  reason = "Participant withdrew from the Pro-Am.",
): ProAmVisibleRound {
  if (round.challengeRound.phase === "complete") return round;
  if (!round.challengeRound.golfers.some((golfer) => golfer.id === entrantId)) return round;
  if (typeof reason !== "string" || !reason.length || reason.length > 200) throw new Error("Visible Pro-Am withdrawal reason is invalid.");
  if (round.actions.length >= MAX_ACTIONS) throw new Error("Visible Pro-Am action log exceeded its deterministic bound.");
  const challengeRound = withdrawChallengeGroupGolfer(round.challengeRound, entrantId, reason);
  if (challengeRound === round.challengeRound) return round;
  return deepFreeze({
    ...round,
    actions: [...round.actions, { type: "withdrawal" as const, entrantId, reason }],
    challengeRound,
  });
}

/**
 * Converts the visible group to canonical participant cards, then delegates
 * all field completion and best-two net evidence to the existing Pro-Am core.
 */
export function settleProAmVisibleRound(
  round: ProAmVisibleRound,
  snapshot: TournamentActivationSnapshot,
  course: PlayerRoundCourseSnapshot,
): ProAmVisibleSettlementResult {
  let problem: string | null;
  try {
    problem = bindingProblem(round, snapshot, course);
    if (!problem) problem = coherenceProblem(round, snapshot, course);
  } catch {
    problem = "The visible Pro-Am round is malformed.";
  }
  if (problem) return { ok: false, reason: problem };
  if (round.challengeRound.phase === "complete" && round.challengeRound.golfers.some((golfer) => !golfer.withdrawn
    && golfer.scorecard.some((hole) => hole.status === "conceded"))) {
    return { ok: false, reason: "A conceded hole is not canonical completed Pro-Am gross evidence." };
  }
  const cards = visibleScorecards(round);
  if (!cards) return { ok: false, reason: "The visible Pro-Am group is not complete." };
  const field = simulateProAmFieldRound({
    snapshot,
    course,
    roundNumber: round.roundNumber,
    seed: round.seed,
    visibleScorecards: cards,
  });
  return field.ok
    ? { ok: true, visibleScorecards: deepFreeze(cards), evidence: field.evidence }
    : field;
}
