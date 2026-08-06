import type {
  EquipmentLoadout,
  EquipmentModifier,
  InventoryItem,
  Settlement,
  SideBetKind,
} from "./types";
import { courseHandicap, strokesByHole } from "./handicap";
import type {
  PlayerPlayableRound,
  PlayerProHandedness,
  PlayerProPoint,
  PlayerProSkills,
  PlayerRoundCourseSnapshot,
  PlayerShotTrace,
} from "../models/playerProTypes";
import type { ControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { decodeControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { isValidSharedShotOutcome } from "../rules/contracts";
import type { HoleReaction } from "../live/m47Types";
import type { PlayerConfidenceState } from "../playerPro/confidence";
import {
  caddieRecommendation,
  previewPlayableShot,
  resolvePlayableShot,
  type PlayerShotPreview,
  type PlayerShotSelection,
} from "../playerPro/playerPro";

export const CHALLENGE_GROUP_ROUND_VERSION = 1 as const;
export const CHALLENGE_GROUP_MIN_GOLFERS = 2;
export const CHALLENGE_GROUP_MAX_GOLFERS = 4;
const MAX_GROUP_SHOTS = 960;
const MAX_AI_TURNS = 960;

export type ChallengeGroupController = "player" | "ai";
export type ChallengeGroupPhase = "awaiting_player" | "complete";
export type ChallengeGroupScoringMode = "gross-stroke" | "net-stroke" | "gross-match" | "net-match";

export interface ChallengeGroupEquipmentSnapshot {
  loadout: EquipmentLoadout;
  items: readonly InventoryItem[];
  modifiers: readonly EquipmentModifier[];
}

export interface ChallengeGroupHandicapSnapshot {
  handicapIndex: number;
  courseHandicap: number;
  playingHandicap: number;
  strokesByHole: readonly number[];
}

export interface ChallengeGroupHoleScore {
  holeId: string;
  par: number;
  strokeIndex: number;
  handicapStrokes: number;
  strokes: number;
  penalties: number;
  gross: number | null;
  net: number | null;
  status: "active" | "played" | "conceded" | "withdrawn";
}

export interface ChallengeGroupGolfer {
  id: string;
  name: string;
  controller: ChallengeGroupController;
  teamId: string;
  handedness: PlayerProHandedness;
  skills: PlayerProSkills;
  confidenceSnapshot?: PlayerConfidenceState;
  handicap: ChallengeGroupHandicapSnapshot;
  equipment: ChallengeGroupEquipmentSnapshot;
  ball: PlayerProPoint;
  lie: string;
  scorecard: readonly ChallengeGroupHoleScore[];
  shots: readonly PlayerShotTrace[];
  withdrawn: boolean;
}

export interface ChallengeMatchHoleResult {
  holeId: string;
  winnerIds: readonly string[];
  teamWinnerIds: readonly string[];
  status: "won" | "halved" | "conceded" | "withdrawn";
  scores: Readonly<Record<string, number | null>>;
}

export interface ChallengeMatchStanding {
  id: string;
  gross: number;
  net: number;
  holesWon: number;
  withdrawn: boolean;
}

export interface ChallengeMatchState {
  scoringMode: ChallengeGroupScoringMode;
  status: "active" | "complete";
  teams: readonly { id: string; playerIds: readonly string[] }[];
  completedHoleIds: readonly string[];
  holeResults: readonly ChallengeMatchHoleResult[];
  standings: readonly ChallengeMatchStanding[];
  teamStandings: readonly ChallengeMatchStanding[];
  concessions: readonly { golferId: string; holeId: string; awardedGross: number; reason: string }[];
  withdrawals: readonly { golferId: string; holeId: string; reason: string }[];
}

/** ZK-726 retains side-bet authority without settling ZK-727..729 formats. */
export interface ChallengeSideBetState {
  id: string;
  kind: SideBetKind;
  stake: number;
  carry: number;
  status: "pending" | "active" | "complete" | "refunded";
  settlements: readonly Settlement[];
  evidence: readonly { holeId: string; playerId: string; measurement: number; eligible: boolean }[];
}

export interface ChallengeTurnEvidence {
  turn: number;
  golferId: string;
  controller: ChallengeGroupController;
  holeId: string;
  shotId: string;
  seed: number;
  selection: PlayerShotSelection;
  from: PlayerProPoint;
  lieBefore: string;
  lieAfter: string;
  rest: PlayerProPoint;
  penaltyStrokes: number;
  ruling: PlayerShotTrace["ruling"] | null;
}

export interface ChallengeGroupRound {
  version: typeof CHALLENGE_GROUP_ROUND_VERSION;
  id: string;
  phase: ChallengeGroupPhase;
  course: PlayerRoundCourseSnapshot;
  rulesSnapshot?: ControlledRoundSnapshotV2;
  teeSet: "forward" | "member" | "championship";
  pinRotation: "A" | "B" | "C";
  currentHoleIndex: number;
  activeGolferId: string | null;
  playerGolferId: string;
  honorsOrder: readonly string[];
  golfers: readonly ChallengeGroupGolfer[];
  match: ChallengeMatchState;
  sideBets: readonly ChallengeSideBetState[];
  reactions: readonly { golferId: string; reaction: HoleReaction }[];
  turnEvidence: readonly ChallengeTurnEvidence[];
  rngSeed: number;
  rngCursor: number;
  startedWeek: number;
  startedDay: number;
  completedWeek?: number;
  completedDay?: number;
}

export interface ChallengeGroupParticipantInput {
  id: string;
  name: string;
  controller: ChallengeGroupController;
  teamId?: string;
  handedness?: PlayerProHandedness;
  skills: PlayerProSkills;
  confidenceSnapshot?: PlayerConfidenceState;
  handicapIndex: number;
  playingHandicap?: number;
  equipment?: {
    loadout: EquipmentLoadout;
    items: readonly InventoryItem[];
  };
}

export interface StartChallengeGroupRoundArgs {
  id: string;
  course: PlayerRoundCourseSnapshot;
  rulesSnapshot?: ControlledRoundSnapshotV2;
  teeSet: "forward" | "member" | "championship";
  pinRotation: "A" | "B" | "C";
  participants: readonly ChallengeGroupParticipantInput[];
  scoringMode?: ChallengeGroupScoringMode;
  sideBets?: readonly ChallengeSideBetState[];
  rngSeed: number;
  startedWeek: number;
  startedDay: number;
}

export type ChallengeGroupDecodeResult =
  | { ok: true; round: ChallengeGroupRound }
  | { ok: false; error: string };

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

function freeze<T>(value: T): T {
  return deepFreeze(clone(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function point(value: unknown): value is PlayerProPoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PlayerProPoint;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function selectedEquipment(input: ChallengeGroupParticipantInput["equipment"]): ChallengeGroupEquipmentSnapshot {
  const loadout = input?.loadout ?? { clubItemIds: [] };
  const selectedIds = new Set([
    ...loadout.clubItemIds,
    loadout.bagItemId,
    loadout.outfitItemId,
    loadout.watchItemId,
  ].filter((id): id is string => typeof id === "string"));
  const items = (input?.items ?? []).filter((item) => selectedIds.has(item.id));
  return freeze({
    loadout,
    items,
    modifiers: items.flatMap((item) => item.modifiers ?? []),
  });
}

function effectiveSkills(golfer: ChallengeGroupGolfer): PlayerProSkills {
  const multiplier = (channel: EquipmentModifier["channel"]) => golfer.equipment.modifiers
    .filter((modifier) => modifier.channel === channel)
    .reduce((value, modifier) => value * modifier.multiplier, 1);
  const dispersion = multiplier("dispersion");
  const adjustedAccuracy = (skill: number) => clamp((1.42 - (1.42 - skill / 180) * dispersion) * 180, 0, 100);
  const carryScale = multiplier("carry");
  const power = clamp(((.82 + golfer.skills.power / 500) * carryScale - .82) * 500, 0, 100);
  return {
    ...golfer.skills,
    power,
    driving: adjustedAccuracy(golfer.skills.driving),
    irons: adjustedAccuracy(golfer.skills.irons),
    shortGame: adjustedAccuracy(golfer.skills.shortGame),
    recovery: clamp(golfer.skills.recovery * multiplier("recovery"), 0, 100),
    putting: clamp(golfer.skills.putting * multiplier("putting"), 0, 100),
  };
}

function competitionHoles(course: PlayerRoundCourseSnapshot) {
  return course.holes.map((hole, index) => ({
    id: hole.id,
    par: hole.par,
    strokeIndex: hole.strokeIndex ?? index + 1,
  }));
}

function handicapFor(input: ChallengeGroupParticipantInput, course: PlayerRoundCourseSnapshot): ChallengeGroupHandicapSnapshot {
  const holes = competitionHoles(course);
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  const calculated = course.rating
    ? courseHandicap(input.handicapIndex, { courseRating: course.rating.courseRating, slopeRating: course.rating.slope, par }).rounded
    : Math.round(input.handicapIndex);
  const playing = input.playingHandicap ?? calculated;
  return freeze({
    handicapIndex: input.handicapIndex,
    courseHandicap: calculated,
    playingHandicap: playing,
    strokesByHole: strokesByHole(playing, holes),
  });
}

function scorecardFor(handicap: ChallengeGroupHandicapSnapshot, course: PlayerRoundCourseSnapshot): ChallengeGroupHoleScore[] {
  return course.holes.map((hole, index) => ({
    holeId: hole.id,
    par: hole.par,
    strokeIndex: hole.strokeIndex ?? index + 1,
    handicapStrokes: handicap.strokesByHole[index],
    strokes: 0,
    penalties: 0,
    gross: null,
    net: null,
    status: "active",
  }));
}

function buildMatch(golfers: readonly ChallengeGroupGolfer[], scoringMode: ChallengeGroupScoringMode): ChallengeMatchState {
  const teamIds = [...new Set(golfers.map((golfer) => golfer.teamId))];
  return {
    scoringMode,
    status: "active",
    teams: teamIds.map((id) => ({ id, playerIds: golfers.filter((golfer) => golfer.teamId === id).map((golfer) => golfer.id) })),
    completedHoleIds: [],
    holeResults: [],
    standings: golfers.map((golfer) => ({ id: golfer.id, gross: 0, net: 0, holesWon: 0, withdrawn: false })),
    teamStandings: teamIds.map((id) => ({ id, gross: 0, net: 0, holesWon: 0, withdrawn: false })),
    concessions: [],
    withdrawals: [],
  };
}

function playableRound(round: ChallengeGroupRound, golfer: ChallengeGroupGolfer): PlayerPlayableRound {
  const scorecard = golfer.scorecard.map((score) => ({
    holeId: score.holeId,
    name: round.course.holes.find((hole) => hole.id === score.holeId)?.name ?? score.holeId,
    par: score.par,
    strokes: score.strokes,
    penalties: score.penalties,
    complete: score.status !== "active",
  }));
  return {
    version: 1,
    id: round.id,
    kind: "friendly",
    handedness: golfer.handedness,
    confidenceSnapshot: golfer.confidenceSnapshot,
    phase: "awaiting_shot",
    course: round.course,
    rulesSnapshot: round.rulesSnapshot,
    teeSet: round.teeSet,
    pinRotation: round.pinRotation,
    currentHoleIndex: round.currentHoleIndex,
    ball: golfer.ball,
    lie: golfer.lie,
    strokes: scorecard.reduce((sum, hole) => sum + hole.strokes, 0),
    penalties: scorecard.reduce((sum, hole) => sum + hole.penalties, 0),
    scorecard,
    shots: [...golfer.shots],
    pendingShot: null,
    rngSeed: round.rngSeed,
    rngCursor: round.rngCursor,
    autoPlay: golfer.controller === "ai",
    rewardsApplied: false,
    startedWeek: round.startedWeek,
    startedDay: round.startedDay,
  };
}

function activeOnHole(round: ChallengeGroupRound, golfer: ChallengeGroupGolfer): boolean {
  return !golfer.withdrawn && golfer.scorecard[round.currentHoleIndex]?.status === "active";
}

function nextGolferId(round: ChallengeGroupRound, golfers: readonly ChallengeGroupGolfer[]): string | null {
  const pin = round.course.holes[round.currentHoleIndex].pin;
  const rank = new Map(round.honorsOrder.map((id, index) => [id, index]));
  return golfers
    .filter((golfer) => activeOnHole(round, golfer))
    .map((golfer) => ({ golfer, distance: Math.hypot(golfer.ball.x - pin.x, golfer.ball.y - pin.y) }))
    .sort((a, b) => b.distance - a.distance || (rank.get(a.golfer.id) ?? 99) - (rank.get(b.golfer.id) ?? 99))[0]?.golfer.id ?? null;
}

function holeReaction(golfer: ChallengeGroupGolfer, holeIndex: number): HoleReaction {
  const score = golfer.scorecard[holeIndex];
  const actualScore = score.gross ?? score.par + 2 + score.handicapStrokes;
  const expectedScore = score.par + score.handicapStrokes;
  const delta = actualScore - expectedScore;
  const satisfaction = clamp(70 - delta * 12 - score.penalties * 8, 0, 100);
  const outcome = satisfaction >= 82 ? "delighted" : satisfaction >= 68 ? "pleased" : satisfaction >= 52 ? "neutral" : "frustrated";
  return {
    version: 1,
    holeId: score.holeId,
    expectedScore,
    actualScore,
    satisfaction,
    outcome,
    facts: [
      { code: "outcome", detail: `gross:${actualScore} net:${score.net ?? "withdrawn"}` },
      { code: "context", detail: `status:${score.status} penalties:${score.penalties}` },
    ],
    thought: score.status === "withdrawn" ? "The round ended before this hole was completed."
      : score.status === "conceded" ? "The conceded score was recorded exactly."
        : delta < 0 ? "That hole was better than expected." : delta > 1 ? "That hole got away from me." : "The hole played about as expected.",
  };
}

function scoreValue(score: ChallengeGroupHoleScore, mode: ChallengeGroupScoringMode): number | null {
  return mode.startsWith("net") ? score.net : score.gross;
}

function settleCompletedHole(round: ChallengeGroupRound, golfers: readonly ChallengeGroupGolfer[]): { golfers: ChallengeGroupGolfer[]; match: ChallengeMatchState; reactions: ChallengeGroupRound["reactions"] } {
  const hole = round.course.holes[round.currentHoleIndex];
  const scores = Object.fromEntries(golfers.map((golfer) => [golfer.id, scoreValue(golfer.scorecard[round.currentHoleIndex], round.match.scoringMode)]));
  const eligible = golfers.filter((golfer) => scores[golfer.id] != null && !golfer.withdrawn);
  const best = eligible.length ? Math.min(...eligible.map((golfer) => scores[golfer.id]!)) : null;
  const winnerIds = best == null ? [] : eligible.filter((golfer) => scores[golfer.id] === best).map((golfer) => golfer.id);
  const teamScores = round.match.teams.map((team) => {
    const cards = team.playerIds.map((id) => golfers.find((golfer) => golfer.id === id)?.scorecard[round.currentHoleIndex]).filter((card): card is ChallengeGroupHoleScore => card != null);
    return {
      id: team.id,
      gross: Math.min(...cards.map((card) => card.gross).filter((value): value is number => value != null)),
      net: Math.min(...cards.map((card) => card.net).filter((value): value is number => value != null)),
    };
  }).filter((entry) => Number.isFinite(entry.gross) && Number.isFinite(entry.net));
  const teamScore = (entry: (typeof teamScores)[number]) => round.match.scoringMode.startsWith("net") ? entry.net : entry.gross;
  const teamBest = teamScores.length ? Math.min(...teamScores.map(teamScore)) : null;
  const teamWinnerIds = teamBest == null ? [] : teamScores.filter((entry) => teamScore(entry) === teamBest).map((entry) => entry.id);
  const statuses = golfers.map((golfer) => golfer.scorecard[round.currentHoleIndex].status);
  const result: ChallengeMatchHoleResult = {
    holeId: hole.id,
    winnerIds,
    teamWinnerIds,
    status: statuses.includes("withdrawn") ? "withdrawn" : statuses.includes("conceded") ? "conceded" : winnerIds.length === 1 ? "won" : "halved",
    scores,
  };
  const standings = round.match.standings.map((standing) => {
    const golfer = golfers.find((candidate) => candidate.id === standing.id)!;
    const card = golfer.scorecard[round.currentHoleIndex];
    return {
      ...standing,
      gross: standing.gross + (card.gross ?? 0),
      net: standing.net + (card.net ?? 0),
      holesWon: standing.holesWon + (winnerIds.length === 1 && winnerIds[0] === standing.id ? 1 : 0),
      withdrawn: golfer.withdrawn,
    };
  });
  const teamStandings = round.match.teamStandings.map((standing) => {
    const score = teamScores.find((candidate) => candidate.id === standing.id);
    const playerIds = round.match.teams.find((team) => team.id === standing.id)?.playerIds ?? [];
    return {
      ...standing,
      gross: standing.gross + (score?.gross ?? 0),
      net: standing.net + (score?.net ?? 0),
      holesWon: standing.holesWon + (teamWinnerIds.length === 1 && teamWinnerIds[0] === standing.id ? 1 : 0),
      withdrawn: playerIds.every((id) => golfers.find((golfer) => golfer.id === id)?.withdrawn),
    };
  });
  return {
    golfers: golfers.map((golfer) => ({ ...golfer })),
    match: {
      ...round.match,
      completedHoleIds: [...round.match.completedHoleIds, hole.id],
      holeResults: [...round.match.holeResults, result],
      standings,
      teamStandings,
    },
    reactions: [
      ...round.reactions,
      ...golfers.map((golfer) => ({ golferId: golfer.id, reaction: holeReaction(golfer, round.currentHoleIndex) })),
    ],
  };
}

function completeOrAdvanceHole(round: ChallengeGroupRound, golfers: readonly ChallengeGroupGolfer[]): ChallengeGroupRound {
  if (golfers.some((golfer) => activeOnHole(round, golfer))) {
    return { ...round, golfers, activeGolferId: nextGolferId(round, golfers) };
  }
  const settled = settleCompletedHole(round, golfers);
  if (round.currentHoleIndex >= round.course.holes.length - 1) {
    return freeze({
      ...round,
      phase: "complete",
      activeGolferId: null,
      golfers: settled.golfers,
      reactions: settled.reactions,
      match: { ...settled.match, status: "complete" },
      completedWeek: round.startedWeek,
      completedDay: round.startedDay,
    });
  }
  const honorsOrder = [...round.honorsOrder].sort((a, b) => {
    const aScore = settled.golfers.find((golfer) => golfer.id === a)!.scorecard[round.currentHoleIndex].gross;
    const bScore = settled.golfers.find((golfer) => golfer.id === b)!.scorecard[round.currentHoleIndex].gross;
    return (aScore ?? Number.MAX_SAFE_INTEGER) - (bScore ?? Number.MAX_SAFE_INTEGER)
      || round.honorsOrder.indexOf(a) - round.honorsOrder.indexOf(b);
  });
  const nextIndex = round.currentHoleIndex + 1;
  const golfersForNext = settled.golfers.map((golfer) => golfer.withdrawn ? golfer : {
    ...golfer,
    ball: { ...round.course.holes[nextIndex].tee },
    lie: "tee",
  });
  const advanced: ChallengeGroupRound = {
    ...round,
    currentHoleIndex: nextIndex,
    honorsOrder,
    golfers: golfersForNext,
    match: settled.match,
    reactions: settled.reactions,
    activeGolferId: null,
  };
  return { ...advanced, activeGolferId: nextGolferId(advanced, golfersForNext) };
}

function commitTurn(round: ChallengeGroupRound, golferId: string, selection: PlayerShotSelection): ChallengeGroupRound {
  if (round.phase === "complete" || round.activeGolferId !== golferId) return round;
  const golfer = round.golfers.find((candidate) => candidate.id === golferId);
  if (!golfer || !activeOnHole(round, golfer)) return round;
  const skills = effectiveSkills(golfer);
  const preview = previewPlayableShot(playableRound(round, golfer), skills, selection);
  if (!preview.available) return round;
  const score = golfer.scorecard[round.currentHoleIndex];
  const seed = (round.rngSeed + round.rngCursor * 104729) >>> 0;
  const rawTrace = resolvePlayableShot({
    snapshot: round.course,
    rulesSnapshot: round.rulesSnapshot,
    holeId: score.holeId,
    shotNumber: score.strokes + 1,
    from: golfer.ball,
    lie: golfer.lie,
    skills,
    selection,
    handedness: golfer.handedness,
    confidenceSnapshot: golfer.confidenceSnapshot,
    seed,
  });
  const shotId = `shot-${round.id}-${golfer.id}-${score.holeId}-${score.strokes + 1}`;
  const trace: PlayerShotTrace = {
    ...rawTrace,
    id: shotId,
    evidence: rawTrace.evidence.map((entry) => ({ ...entry, id: `${entry.id}-${golfer.id}` })),
  };
  const puttingStrokes = trace.greenPutting?.putts ?? 0;
  const strokes = score.strokes + 1 + puttingStrokes;
  const penalties = score.penalties + trace.penaltyStrokes;
  const complete = trace.holed || puttingStrokes > 0;
  const nextScore: ChallengeGroupHoleScore = {
    ...score,
    strokes,
    penalties,
    gross: complete ? strokes + penalties : null,
    net: complete ? strokes + penalties - score.handicapStrokes : null,
    status: complete ? "played" : "active",
  };
  const golfers = round.golfers.map((candidate) => candidate.id !== golfer.id ? candidate : {
    ...candidate,
    ball: { ...trace.rest },
    lie: trace.lieAfter,
    shots: [...candidate.shots, trace].slice(-MAX_GROUP_SHOTS),
    scorecard: candidate.scorecard.map((card, index) => index === round.currentHoleIndex ? nextScore : card),
  });
  const evidence: ChallengeTurnEvidence = {
    turn: round.turnEvidence.length + 1,
    golferId,
    controller: golfer.controller,
    holeId: score.holeId,
    shotId,
    seed,
    selection: clone(selection),
    from: { ...golfer.ball },
    lieBefore: golfer.lie,
    lieAfter: trace.lieAfter,
    rest: { ...trace.rest },
    penaltyStrokes: trace.penaltyStrokes,
    ruling: trace.ruling ? clone(trace.ruling) : null,
  };
  return completeOrAdvanceHole({
    ...round,
    golfers,
    turnEvidence: [...round.turnEvidence, evidence].slice(-MAX_GROUP_SHOTS),
    rngCursor: round.rngCursor + 1,
  }, golfers);
}

function runAiUntilPlayer(round: ChallengeGroupRound): ChallengeGroupRound {
  let next = round;
  let guard = 0;
  while (next.phase !== "complete" && guard++ < MAX_AI_TURNS) {
    const golfer = next.golfers.find((candidate) => candidate.id === next.activeGolferId);
    if (!golfer || golfer.controller === "player") break;
    const selection = caddieRecommendation(playableRound(next, golfer), effectiveSkills(golfer));
    const advanced = commitTurn(next, golfer.id, selection);
    if (advanced !== next) {
      next = advanced;
      continue;
    }
    // A hostile/legacy ruling can leave a ball on a lie with no legal club.
    // Preserve forward progress with an explicit deterministic concession,
    // rather than inventing a second physics or relief path for AI golfers.
    const score = golfer.scorecard[next.currentHoleIndex];
    const awardedGross = Math.max(score.par + 2 + Math.max(0, score.handicapStrokes), score.strokes + score.penalties + 1);
    const golfers = next.golfers.map((candidate) => candidate.id !== golfer.id ? candidate : {
      ...candidate,
      scorecard: candidate.scorecard.map((card, index) => index === next.currentHoleIndex ? {
        ...card,
        strokes: Math.max(card.strokes, awardedGross - card.penalties),
        gross: awardedGross,
        net: awardedGross - card.handicapStrokes,
        status: "conceded" as const,
      } : card),
    });
    next = completeOrAdvanceHole({
      ...next,
      match: {
        ...next.match,
        concessions: [...next.match.concessions, {
          golferId: golfer.id,
          holeId: score.holeId,
          awardedGross,
          reason: "No legal AI shot remained after the preserved ruling.",
        }],
      },
    }, golfers);
  }
  if (guard >= MAX_AI_TURNS) throw new Error("Challenge group exceeded the deterministic AI turn bound.");
  return freeze(next);
}

export function startChallengeGroupRound(args: StartChallengeGroupRoundArgs): ChallengeGroupRound {
  if (!args.id.trim()) throw new Error("Challenge group requires a stable round ID.");
  if (args.participants.length < CHALLENGE_GROUP_MIN_GOLFERS || args.participants.length > CHALLENGE_GROUP_MAX_GOLFERS) throw new Error("Challenge groups require 2–4 golfers.");
  if (args.participants.some((participant) => !participant.id.trim() || !participant.name.trim())) throw new Error("Challenge group golfers require stable IDs and names.");
  if (new Set(args.participants.map((participant) => participant.id)).size !== args.participants.length) throw new Error("Challenge group golfer IDs must be unique.");
  if (args.participants.filter((participant) => participant.controller === "player").length !== 1) throw new Error("Challenge groups require exactly one player-controlled golfer.");
  if (args.course.holes.length !== 9 && args.course.holes.length !== 18) throw new Error("Challenge groups require an authoritative 9- or 18-hole route.");
  if (args.course.tiles.length !== args.course.width * args.course.height || args.course.elevations.length !== args.course.tiles.length) throw new Error("Challenge group course geometry is incomplete.");
  if (args.rulesSnapshot && !decodeControlledRoundSnapshotV2(args.rulesSnapshot).ok) throw new Error("Challenge group rules snapshot is invalid.");
  const course = freeze(args.course);
  const golfers: ChallengeGroupGolfer[] = args.participants.map((participant) => {
    const handicap = handicapFor(participant, course);
    return {
      id: participant.id,
      name: participant.name,
      controller: participant.controller,
      teamId: participant.teamId ?? `individual:${participant.id}`,
      handedness: participant.handedness ?? "right",
      skills: freeze(participant.skills),
      ...(participant.confidenceSnapshot ? { confidenceSnapshot: freeze(participant.confidenceSnapshot) } : {}),
      handicap,
      equipment: selectedEquipment(participant.equipment),
      ball: { ...course.holes[0].tee },
      lie: "tee",
      scorecard: scorecardFor(handicap, course),
      shots: [],
      withdrawn: false,
    };
  });
  const honorsOrder = golfers.map((golfer) => golfer.id);
  const initial: ChallengeGroupRound = {
    version: 1,
    id: args.id,
    phase: "awaiting_player",
    course,
    ...(args.rulesSnapshot ? { rulesSnapshot: freeze(args.rulesSnapshot) } : {}),
    teeSet: args.teeSet,
    pinRotation: args.pinRotation,
    currentHoleIndex: 0,
    activeGolferId: honorsOrder[0],
    playerGolferId: golfers.find((golfer) => golfer.controller === "player")!.id,
    honorsOrder,
    golfers,
    match: buildMatch(golfers, args.scoringMode ?? "net-match"),
    sideBets: freeze(args.sideBets ?? []),
    reactions: [],
    turnEvidence: [],
    rngSeed: args.rngSeed >>> 0,
    rngCursor: 0,
    startedWeek: Math.max(0, Math.floor(args.startedWeek)),
    startedDay: Math.max(0, Math.floor(args.startedDay)),
  };
  const started = runAiUntilPlayer(initial);
  const error = validateRound(started);
  if (error) throw new Error(error);
  return started;
}

export function previewChallengeGroupPlayerShot(round: ChallengeGroupRound, golferId: string, selection: PlayerShotSelection): PlayerShotPreview | null {
  if (round.phase === "complete" || round.activeGolferId !== golferId) return null;
  const golfer = round.golfers.find((candidate) => candidate.id === golferId);
  if (!golfer || golfer.controller !== "player") return null;
  return previewPlayableShot(playableRound(round, golfer), effectiveSkills(golfer), selection);
}

export function commitChallengeGroupPlayerShot(round: ChallengeGroupRound, golferId: string, selection: PlayerShotSelection): ChallengeGroupRound {
  if (golferId !== round.playerGolferId) throw new Error("Only the player-controlled golfer accepts player shot input.");
  if (round.activeGolferId !== golferId) throw new Error("The player-controlled golfer does not own the current turn.");
  return runAiUntilPlayer(commitTurn(round, golferId, selection));
}

export function concedeChallengeGroupHole(round: ChallengeGroupRound, golferId: string, awardedGross: number, reason = "Hole conceded."): ChallengeGroupRound {
  if (!Number.isInteger(awardedGross) || awardedGross < 1) throw new Error("A concession requires a positive awarded gross score.");
  const golfer = round.golfers.find((candidate) => candidate.id === golferId);
  if (!golfer || !activeOnHole(round, golfer)) return round;
  const score = golfer.scorecard[round.currentHoleIndex];
  const nextScore: ChallengeGroupHoleScore = {
    ...score,
    strokes: Math.max(score.strokes, awardedGross - score.penalties),
    gross: awardedGross,
    net: awardedGross - score.handicapStrokes,
    status: "conceded",
  };
  const golfers = round.golfers.map((candidate) => candidate.id !== golferId ? candidate : {
    ...candidate,
    scorecard: candidate.scorecard.map((card, index) => index === round.currentHoleIndex ? nextScore : card),
  });
  const next = completeOrAdvanceHole({
    ...round,
    match: { ...round.match, concessions: [...round.match.concessions, { golferId, holeId: score.holeId, awardedGross, reason }] },
  }, golfers);
  return runAiUntilPlayer(next);
}

export function withdrawChallengeGroupGolfer(round: ChallengeGroupRound, golferId: string, reason = "Golfer withdrew."): ChallengeGroupRound {
  const golfer = round.golfers.find((candidate) => candidate.id === golferId);
  if (!golfer || golfer.withdrawn || round.phase === "complete") return round;
  const holeId = round.course.holes[round.currentHoleIndex].id;
  const golfers = round.golfers.map((candidate) => candidate.id !== golferId ? candidate : {
    ...candidate,
    withdrawn: true,
    scorecard: candidate.scorecard.map((score, index) => index < round.currentHoleIndex || score.status !== "active" ? score : { ...score, status: "withdrawn" as const }),
  });
  const next = completeOrAdvanceHole({
    ...round,
    match: { ...round.match, withdrawals: [...round.match.withdrawals, { golferId, holeId, reason }] },
  }, golfers);
  return runAiUntilPlayer(next);
}

function validateShot(shot: PlayerShotTrace): boolean {
  return typeof shot.id === "string" && typeof shot.holeId === "string" && Number.isInteger(shot.shotNumber)
    && point(shot.from) && point(shot.aim) && point(shot.rest) && Number.isFinite(shot.seed)
    && Number.isInteger(shot.penaltyStrokes) && shot.penaltyStrokes >= 0
    && (!shot.sharedOutcome || isValidSharedShotOutcome(shot.sharedOutcome));
}

function validSideBet(sideBet: ChallengeSideBetState): boolean {
  return typeof sideBet.id === "string" && sideBet.id.length > 0
    && ["skins", "nassau", "closest-to-pin", "longest-drive"].includes(sideBet.kind)
    && Number.isFinite(sideBet.stake) && sideBet.stake >= 0
    && Number.isFinite(sideBet.carry) && sideBet.carry >= 0
    && ["pending", "active", "complete", "refunded"].includes(sideBet.status)
    && Array.isArray(sideBet.settlements) && Array.isArray(sideBet.evidence)
    && sideBet.evidence.every((entry) => typeof entry.holeId === "string" && typeof entry.playerId === "string" && Number.isFinite(entry.measurement) && typeof entry.eligible === "boolean");
}

function validateRound(round: ChallengeGroupRound): string | null {
  if (round.version !== 1) return "Unsupported ChallengeGroupRound version.";
  if (typeof round.id !== "string" || !round.id) return "ChallengeGroupRound ID is invalid.";
  if (round.phase !== "awaiting_player" && round.phase !== "complete") return "ChallengeGroupRound phase is invalid.";
  if (round.golfers.length < 2 || round.golfers.length > 4) return "ChallengeGroupRound must retain 2–4 golfers.";
  if (new Set(round.golfers.map((golfer) => golfer.id)).size !== round.golfers.length) return "ChallengeGroupRound golfer IDs are not unique.";
  if (round.golfers.some((golfer) => !golfer.id || !golfer.name || (golfer.controller !== "player" && golfer.controller !== "ai") || !golfer.teamId)) return "ChallengeGroupRound golfer identity is invalid.";
  if (round.golfers.filter((golfer) => golfer.controller === "player").length !== 1) return "ChallengeGroupRound must retain exactly one player golfer.";
  if (round.playerGolferId !== round.golfers.find((golfer) => golfer.controller === "player")?.id) return "ChallengeGroupRound player identity drifted.";
  if (round.course.holes.length !== 9 && round.course.holes.length !== 18) return "ChallengeGroupRound route is not 9 or 18 holes.";
  if (round.course.tiles.length !== round.course.width * round.course.height || round.course.elevations.length !== round.course.tiles.length) return "ChallengeGroupRound course geometry is invalid.";
  if (round.rulesSnapshot && !decodeControlledRoundSnapshotV2(round.rulesSnapshot).ok) return "ChallengeGroupRound rules snapshot is invalid.";
  if (!Number.isInteger(round.currentHoleIndex) || round.currentHoleIndex < 0 || round.currentHoleIndex >= round.course.holes.length) return "ChallengeGroupRound current hole is invalid.";
  if (new Set(round.honorsOrder).size !== round.golfers.length || round.honorsOrder.some((id) => !round.golfers.some((golfer) => golfer.id === id))) return "ChallengeGroupRound honors are invalid.";
  if (round.phase === "complete" ? round.activeGolferId !== null : !round.golfers.some((golfer) => golfer.id === round.activeGolferId)) return "ChallengeGroupRound active turn is invalid.";
  if (round.phase === "awaiting_player" && round.golfers.find((golfer) => golfer.id === round.activeGolferId)?.controller !== "player") return "ChallengeGroupRound persisted before its automatic AI turns completed.";
  if (round.golfers.some((golfer) => !point(golfer.ball)
    || !Object.values(golfer.skills).every((skill) => Number.isFinite(skill) && skill >= 0 && skill <= 100)
    || !Number.isFinite(golfer.handicap.handicapIndex)
    || !Number.isInteger(golfer.handicap.playingHandicap)
    || golfer.handicap.strokesByHole.length !== round.course.holes.length
    || golfer.scorecard.length !== round.course.holes.length
    || golfer.scorecard.some((score, index) => score.holeId !== round.course.holes[index].id
      || score.par !== round.course.holes[index].par
      || !Number.isInteger(score.strokes) || score.strokes < 0
      || !Number.isInteger(score.penalties) || score.penalties < 0
      || (score.gross != null && score.gross !== score.strokes + score.penalties)
      || (score.net != null && score.net !== score.gross! - score.handicapStrokes))
    || golfer.equipment.modifiers.some((modifier) => !Number.isFinite(modifier.multiplier) || modifier.multiplier <= 0)
    || golfer.shots.some((shot) => !validateShot(shot)))) return "ChallengeGroupRound golfer evidence is invalid.";
  if (round.turnEvidence.length > MAX_GROUP_SHOTS || round.turnEvidence.some((turn, index) => turn.turn !== index + 1 || !round.golfers.some((golfer) => golfer.id === turn.golferId) || !point(turn.from) || !point(turn.rest))) return "ChallengeGroupRound turn evidence is invalid.";
  if (!Number.isInteger(round.rngCursor) || round.rngCursor !== round.turnEvidence.length) return "ChallengeGroupRound RNG cursor does not match retained turns.";
  const shotIds = round.golfers.flatMap((golfer) => golfer.shots.map((shot) => shot.id));
  if (new Set(shotIds).size !== shotIds.length) return "ChallengeGroupRound shot IDs are not unique.";
  if (round.turnEvidence.some((turn) => !shotIds.includes(turn.shotId))) return "ChallengeGroupRound turn evidence references a missing shot.";
  if (!Array.isArray(round.sideBets) || round.sideBets.some((sideBet) => !validSideBet(sideBet)) || new Set(round.sideBets.map((sideBet) => sideBet.id)).size !== round.sideBets.length) return "ChallengeGroupRound side-bet state is invalid.";
  if (!round.match || !Array.isArray(round.match.teams) || !Array.isArray(round.match.holeResults) || !Array.isArray(round.match.standings)) return "ChallengeGroupRound match state is invalid.";
  if (round.match.teams.some((team) => !team.id || !team.playerIds.length || team.playerIds.some((id: string) => !round.golfers.some((golfer) => golfer.id === id)))) return "ChallengeGroupRound team membership is invalid.";
  if (round.phase === "complete" && round.match.status !== "complete") return "ChallengeGroupRound completed without final match state.";
  return null;
}

export function encodeChallengeGroupRound(round: ChallengeGroupRound): string {
  const error = validateRound(round);
  if (error) throw new Error(error);
  return JSON.stringify(round);
}

export function decodeChallengeGroupRound(raw: string | unknown): ChallengeGroupDecodeResult {
  let value: unknown;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
  } catch {
    return { ok: false, error: "ChallengeGroupRound save is not valid JSON." };
  }
  if (!value || typeof value !== "object") return { ok: false, error: "ChallengeGroupRound save is not an object." };
  const round = value as ChallengeGroupRound;
  let error: string | null;
  try {
    error = validateRound(round);
  } catch {
    error = "ChallengeGroupRound save is structurally incomplete.";
  }
  return error ? { ok: false, error } : { ok: true, round: deepFreeze(round) };
}

/** Compact evidence intended for the existing `render_game_to_text` envelope. */
export function challengeGroupRoundTextState(round: ChallengeGroupRound) {
  const recentTurn = round.turnEvidence.at(-1) ?? null;
  return {
    id: round.id,
    phase: round.phase,
    courseId: round.course.courseId,
    currentHole: round.currentHoleIndex + 1,
    holes: round.course.holes.length,
    activeGolferId: round.activeGolferId,
    playerGolferId: round.playerGolferId,
    controls: round.phase === "complete" ? "none" : round.activeGolferId === round.playerGolferId ? "player-shot" : "ai-automatic",
    honorsOrder: round.honorsOrder,
    golfers: round.golfers.map((golfer) => ({
      id: golfer.id,
      name: golfer.name,
      controller: golfer.controller,
      teamId: golfer.teamId,
      ball: golfer.ball,
      lie: golfer.lie,
      withdrawn: golfer.withdrawn,
      handicap: golfer.handicap,
      equipment: golfer.equipment,
      currentScore: golfer.scorecard[round.currentHoleIndex],
      scorecard: golfer.scorecard,
      latestShot: golfer.shots.at(-1) ?? null,
    })),
    match: round.match,
    sideBets: round.sideBets,
    recentTurn,
    recentRulings: round.turnEvidence.slice(-4).map((turn) => ({ golferId: turn.golferId, shotId: turn.shotId, ruling: turn.ruling })),
    reactions: round.reactions.filter((entry) => entry.reaction.holeId === round.course.holes[round.currentHoleIndex]?.id),
  };
}

export function renderChallengeGroupRoundToText(round: ChallengeGroupRound): string {
  return JSON.stringify(challengeGroupRoundTextState(round));
}
