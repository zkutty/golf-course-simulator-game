import type {
  EquipmentLoadout,
  EquipmentModifier,
  InventoryItem,
  Settlement,
  SideBetKind,
} from "./types";
import { courseHandicapUnrounded, roundHalfAwayFromZero, strokesByHole, strokesOffLow } from "./handicap";
import { stablefordPoints } from "./scoring";
import { validateChallengeGroupRound } from "./challengeGroupRoundCodec";
import {
  captureTeamHandicapSnapshots,
  chooseDeterministicScrambleBall,
  advanceAlternateShotBall,
  type ChallengeTeamAuthority,
  type ChallengeTeamFormat,
  type TeamBallCandidate,
  type TeamBallState,
} from "./teamAuthority";
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
import type { HoleReaction } from "../live/m47Types";
import type { PlayerConfidenceState } from "../playerPro/confidence";
import {
  caddieRecommendation,
  previewPlayableShot,
  resolvePlayableShot,
  type PlayerShotPreview,
  type PlayerShotSelection,
} from "../playerPro/playerPro";

export const CHALLENGE_GROUP_ROUND_VERSION = 2 as const;
export const CHALLENGE_GROUP_MIN_GOLFERS = 2;
export const CHALLENGE_GROUP_MAX_GOLFERS = 4;
const MAX_GROUP_SHOTS = 960;
const MAX_AI_TURNS = 960;
const SIDE_BET_KINDS = ["skins", "nassau", "closest-to-pin", "longest-drive"] as const;
const isNassauFormat = (format: ChallengeGroupScoringMode) => format === "gross-match" || format === "net-match";
const INVALID_SETUP = "Bad setup";

export type ChallengeGroupController = "player" | "ai";
export type ChallengeGroupPhase = "awaiting_player" | "awaiting_ball_choice" | "complete";
export type ChallengeGroupScoringMode = "gross-stroke" | "net-stroke" | "gross-match" | "net-match" | "net-stableford";
export type ChallengeIndividualContestKind = "skins" | "nassau" | "closest-to-pin" | "longest-drive";
export type ChallengeIndividualResultStatus = "won" | "tied" | "carried" | "not-awarded" | "withdrawn";

/**
 * This is deliberately an authority for results and evidence only.  It has no
 * stake, currency, escrow, inventory, or reward fields: ZK-748 owns policy
 * and any future settlement integration.
 */
export interface ChallengeIndividualContest {
  id: string;
  kind: ChallengeIndividualContestKind;
  /** Empty means every hole; Nassau is always the fixed 18-hole fixture. */
  holeIds?: readonly string[];
}

export interface ChallengeIndividualResult {
  contestId: string;
  segment: string;
  holeId?: string;
  status: ChallengeIndividualResultStatus;
  winnerIds: readonly string[];
  /** Number of tied prior skins represented by this result, never a value. */
  carryHoles: number;
  reason?: string;
}

export interface ChallengeMeasurementRecord {
  id: string;
  contestId: string;
  holeId: string;
  participantId: string;
  shotId: string;
  club: string;
  start: PlayerProPoint;
  end: PlayerProPoint;
  lie: string;
  measurement: number;
  eligible: boolean;
  rejectionReason?: string;
}

export interface ChallengeIndividualAuthority {
  version: 1;
  format: ChallengeGroupScoringMode;
  handicapSnapshots: readonly { playerId: string; playingHandicap: number; strokesByHole: readonly number[] }[];
  contests: readonly ChallengeIndividualContest[];
  results: readonly ChallengeIndividualResult[];
  measurements: readonly ChallengeMeasurementRecord[];
}

export interface ChallengeGroupEquipmentSnapshot {
  loadout: EquipmentLoadout;
  items: readonly InventoryItem[];
  modifiers: readonly EquipmentModifier[];
}

export interface ChallengeGroupHandicapSnapshot {
  handicapIndex: number;
  courseHandicap: number;
  allowance: number;
  playingHandicap: number;
  strokesByHole: readonly number[];
}

/** Self-contained course/setup evidence captured for one participant at activation. */
export interface ChallengeParticipantSetupSnapshot {
  teeSet: "forward" | "member" | "championship";
  pinRotation: "A" | "B" | "C";
  holes: PlayerRoundCourseSnapshot["holes"];
  rating: NonNullable<PlayerRoundCourseSnapshot["rating"]>;
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
  setup: ChallengeParticipantSetupSnapshot;
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
  /** Present only for ZK-728's explicit, frozen 2v2 formats. */
  teamAuthority?: ChallengeTeamAuthority;
  /** Present only for the policy-neutral individual formats in ZK-727. */
  individualAuthority?: ChallengeIndividualAuthority;
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
  /** Existing format policy supplies this; ZK-758 only freezes and applies it once. */
  handicapAllowance?: number;
  /** Omitted preserves the legacy shared round setup. */
  setup?: {
    course: PlayerRoundCourseSnapshot;
    teeSet: "forward" | "member" | "championship";
    pinRotation: "A" | "B" | "C";
  };
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
  teamFormat?: ChallengeTeamFormat;
  scoringMode?: ChallengeGroupScoringMode;
  sideBets?: readonly ChallengeSideBetState[];
  /** Explicit policy-neutral formats; omitted preserves the existing friendly fixture behaviour. */
  individualFormat?: ChallengeGroupScoringMode;
  individualContests?: readonly ChallengeIndividualContest[];
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
  const multiplier = (channel: EquipmentModifier["channel"]) => clamp(golfer.equipment.modifiers
    .filter((modifier) => modifier.channel === channel)
    .reduce((value, modifier) => value * clamp(modifier.multiplier, .88, 1.12), 1), .8, 1.2);
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

function competitionHoles(course: Pick<PlayerRoundCourseSnapshot, "holes">) {
  return course.holes.map((hole, index) => ({
    id: hole.id,
    par: hole.par,
    strokeIndex: hole.strokeIndex ?? index + 1,
  }));
}

function validRating(rating: PlayerRoundCourseSnapshot["rating"]): boolean {
  return !!rating && Number.isFinite(rating.courseRating) && Number.isFinite(rating.slope) && rating.slope > 0;
}

function participantSetup(source: Pick<StartChallengeGroupRoundArgs, "course" | "teeSet" | "pinRotation">): ChallengeParticipantSetupSnapshot {
  const holes = source.course.holes;
  return {
    teeSet: source.teeSet,
    pinRotation: source.pinRotation,
    holes,
    rating: source.course.rating ?? { courseRating: holes.reduce((sum, hole) => sum + hole.par, 0), slope: 113 },
  };
}

function unroundedHandicap(handicapIndex: number, course: Pick<PlayerRoundCourseSnapshot, "holes" | "rating">): number {
  const rating = course.rating!;
  return courseHandicapUnrounded(handicapIndex, {
    courseRating: rating.courseRating,
    slopeRating: rating.slope,
    par: course.holes.reduce((sum, hole) => sum + hole.par, 0),
  });
}

function handicapFor(input: ChallengeGroupParticipantInput, course: Pick<PlayerRoundCourseSnapshot, "holes" | "rating">): ChallengeGroupHandicapSnapshot {
  const holes = competitionHoles(course);
  const allowance = input.handicapAllowance ?? 1;
  const handicapIndex = input.handicapIndex;
  if (!Number.isFinite(allowance) || allowance < 0) throw new Error("Bad allowance");
  const unrounded = unroundedHandicap(handicapIndex, course);
  const playing = roundHalfAwayFromZero(unrounded * allowance);
  return {
    handicapIndex,
    courseHandicap: roundHalfAwayFromZero(unrounded),
    allowance,
    playingHandicap: playing,
    strokesByHole: strokesByHole(playing, holes),
  };
}

function scorecardFor(handicap: ChallengeGroupHandicapSnapshot, course: Pick<PlayerRoundCourseSnapshot, "holes">): ChallengeGroupHoleScore[] {
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

function buildTeamAuthority(
  golfers: readonly ChallengeGroupGolfer[],
  format: ChallengeTeamFormat,
  scoringMode: ChallengeGroupScoringMode,
  course: PlayerRoundCourseSnapshot,
): ChallengeTeamAuthority {
  const grouped = [...new Set(golfers.map((golfer) => golfer.teamId))].map((id) => ({
    id,
    playerIds: golfers.filter((golfer) => golfer.teamId === id).map((golfer) => golfer.id),
  }));
  const holes = competitionHoles(course);
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  const handicapCourse = course.rating
    ? { courseRating: course.rating.courseRating, slopeRating: course.rating.slope, par }
    : { courseRating: par, slopeRating: 113, par };
  const scoring = scoringMode.endsWith("match") ? "match" as const : "stroke" as const;
  const handicaps = captureTeamHandicapSnapshots(grouped, golfers.map((golfer) => ({ id: golfer.id, handicapIndex: golfer.handicap.handicapIndex })), format, scoring, handicapCourse, holes);
  const balls = grouped.map((team) => {
    const handicap = handicaps.find((entry) => entry.teamId === team.id)!;
    return {
      teamId: team.id,
      ball: { ...course.holes[0].tee },
      lie: "tee",
      nextPlayerId: team.playerIds[0],
      candidates: [],
      scorecard: course.holes.map((hole, index) => ({
        holeId: hole.id,
        par: hole.par,
        handicapStrokes: handicap.strokesByHole[index],
        strokes: 0,
        penalties: 0,
        gross: null,
        net: null,
        status: "active" as const,
        countedPlayerIds: [],
      })),
    };
  });
  return freeze({ version: 1, format, scoring, teams: grouped, handicaps, balls, choices: [] });
}

function applyFourBallHandicaps(golfers: readonly ChallengeGroupGolfer[], authority: ChallengeTeamAuthority): ChallengeGroupGolfer[] {
  if (authority.format !== "four-ball") return golfers.map((golfer) => ({ ...golfer }));
  return golfers.map((golfer) => {
    const member = authority.handicaps.flatMap((snapshot) => snapshot.members).find((entry) => entry.playerId === golfer.id)!;
    const handicap = { ...golfer.handicap, playingHandicap: member.strokesOffLow, strokesByHole: member.strokesByHole };
    return {
      ...golfer,
      handicap,
      scorecard: golfer.scorecard.map((score, index) => ({ ...score, handicapStrokes: member.strokesByHole[index] })),
    };
  });
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

function buildIndividualAuthority(
  golfers: readonly ChallengeGroupGolfer[],
  format: ChallengeGroupScoringMode,
  contests: readonly ChallengeIndividualContest[],
  course: PlayerRoundCourseSnapshot,
): ChallengeIndividualAuthority {
  if (new Set(contests.map((contest) => contest.id)).size !== contests.length || contests.some((contest) => !contest.id || !SIDE_BET_KINDS.includes(contest.kind))) {
    throw new Error("Individual contests are invalid.");
  }
  for (const contest of contests) {
    if (contest.holeIds && (new Set(contest.holeIds).size !== contest.holeIds.length || contest.holeIds.some((id) => !course.holes.some((hole) => hole.id === id)))) throw new Error("Individual contest holes are invalid.");
    if (contest.kind === "nassau" && (golfers.length !== 2 || course.holes.length !== 18 || contest.holeIds?.length || !isNassauFormat(format))) throw new Error("Nassau requires a 2-player 18-hole gross/net match.");
  }
  return freeze({
    version: 1,
    format,
    handicapSnapshots: golfers.map((golfer) => ({ playerId: golfer.id, playingHandicap: golfer.handicap.playingHandicap, strokesByHole: [...golfer.handicap.strokesByHole] })),
    contests: clone(contests),
    results: [],
    measurements: [],
  });
}

function individualHoleWinners(round: ChallengeGroupRound, golfers: readonly ChallengeGroupGolfer[]): string[] {
  const mode = round.individualAuthority!.format;
  const values = golfers.filter((golfer) => !golfer.withdrawn).flatMap((golfer) => {
    const card = golfer.scorecard[round.currentHoleIndex];
    if (card.gross == null || card.net == null) return [];
    const value = mode === "gross-stroke" || mode === "gross-match" ? card.gross
      : mode === "net-stableford" ? stablefordPoints(card.gross, card.par, card.handicapStrokes)
        : card.net;
    return [{ id: golfer.id, value }];
  });
  if (!values.length) return [];
  const target = mode === "net-stableford" ? Math.max(...values.map((entry) => entry.value)) : Math.min(...values.map((entry) => entry.value));
  return values.filter((entry) => entry.value === target).map((entry) => entry.id);
}

function contestApplies(contest: ChallengeIndividualContest, holeId: string): boolean {
  return !contest.holeIds?.length || contest.holeIds.includes(holeId);
}

/** Scores a fixed Nassau segment as match play, never as aggregate stroke play. */
export function scoreChallengeNassauSegment(
  golfers: readonly ChallengeGroupGolfer[],
  format: "gross-match" | "net-match",
  start: number,
  end: number,
): Pick<ChallengeIndividualResult, "status" | "winnerIds" | "reason"> {
  if (golfers.length !== 2 || start < 0 || end < start) throw new Error("Nassau segment requires two golfers and a valid range.");
  if (golfers.some((golfer) => golfer.withdrawn || golfer.scorecard.slice(start, end + 1).some((card) => card.status === "withdrawn"))) {
    return { status: "withdrawn", winnerIds: [], reason: "Competitor withdrew." };
  }
  const wins = new Map(golfers.map((golfer) => [golfer.id, 0]));
  for (let index = start; index <= end; index += 1) {
    const values = golfers.map((golfer) => ({ id: golfer.id, score: format === "gross-match" ? golfer.scorecard[index]?.gross : golfer.scorecard[index]?.net }));
    if (values.some((entry) => entry.score == null)) return { status: "withdrawn", winnerIds: [], reason: "No completed score." };
    if (values[0].score! < values[1].score!) wins.set(values[0].id, wins.get(values[0].id)! + 1);
    else if (values[1].score! < values[0].score!) wins.set(values[1].id, wins.get(values[1].id)! + 1);
  }
  const [first, second] = golfers;
  const firstWins = wins.get(first.id)!;
  const secondWins = wins.get(second.id)!;
  if (firstWins === secondWins) return { status: "tied", winnerIds: [first.id, second.id], reason: "Segment halved." };
  return { status: "won", winnerIds: [firstWins > secondWins ? first.id : second.id] };
}

function settleIndividualHole(round: ChallengeGroupRound, golfers: readonly ChallengeGroupGolfer[]): ChallengeIndividualAuthority | undefined {
  const authority = round.individualAuthority;
  if (!authority) return undefined;
  const hole = round.course.holes[round.currentHoleIndex];
  const winnerIds = individualHoleWinners(round, golfers);
  const nextResults = [...authority.results];
  for (const contest of authority.contests) {
    if (!contestApplies(contest, hole.id)) continue;
    if (contest.kind === "skins") {
      const prior = [...nextResults].reverse().find((result) => result.contestId === contest.id && result.status === "carried")?.carryHoles ?? 0;
      nextResults.push(winnerIds.length === 1
        ? { contestId: contest.id, segment: hole.id, holeId: hole.id, status: "won", winnerIds, carryHoles: prior }
        : { contestId: contest.id, segment: hole.id, holeId: hole.id, status: "carried", winnerIds: [], carryHoles: prior + 1, reason: winnerIds.length ? "Hole tied." : "No completed score." });
      continue;
    }
    if (contest.kind === "nassau") continue; // fixed segments are resolved at 9 and 18 below
    const records = authority.measurements.filter((entry) => entry.contestId === contest.id && entry.holeId === hole.id && entry.eligible);
    const withdrawn = golfers.some((golfer) => golfer.withdrawn);
    if (!records.length) nextResults.push({ contestId: contest.id, segment: hole.id, holeId: hole.id, status: withdrawn ? "withdrawn" : "not-awarded", winnerIds: [], carryHoles: 0, reason: withdrawn ? "Competitor withdrew." : "No measurement evidence." });
    else {
      const target = contest.kind === "closest-to-pin" ? Math.min(...records.map((entry) => entry.measurement)) : Math.max(...records.map((entry) => entry.measurement));
      const winners = records.filter((entry) => entry.measurement === target).map((entry) => entry.participantId);
      nextResults.push({ contestId: contest.id, segment: hole.id, holeId: hole.id, status: winners.length === 1 ? "won" : "tied", winnerIds: winners, carryHoles: 0, ...(winners.length > 1 ? { reason: "Equal measurements." } : {}) });
    }
  }
  for (const contest of authority.contests.filter((entry) => entry.kind === "nassau")) {
    const segments = round.currentHoleIndex === 8 ? [{ name: "front", start: 0, end: 8 }]
      : round.currentHoleIndex === 17 ? [{ name: "back", start: 9, end: 17 }, { name: "overall", start: 0, end: 17 }]
        : [];
    for (const segment of segments) {
      const outcome = scoreChallengeNassauSegment(golfers, authority.format as "gross-match" | "net-match", segment.start, segment.end);
      nextResults.push({ contestId: contest.id, segment: segment.name, status: outcome.status, winnerIds: outcome.winnerIds, carryHoles: 0, ...(outcome.reason ? { reason: outcome.reason } : {}) });
    }
  }
  return { ...authority, results: nextResults };
}

function participantCourse(round: ChallengeGroupRound, golfer: ChallengeGroupGolfer): PlayerRoundCourseSnapshot {
  return {
    ...round.course,
    holes: golfer.setup.holes,
  };
}

function playableRound(round: ChallengeGroupRound, golfer: ChallengeGroupGolfer): PlayerPlayableRound {
  const setup = golfer.setup;
  const course = participantCourse(round, golfer);
  const scorecard = golfer.scorecard.map((score, index) => ({
    holeId: score.holeId,
    name: setup.holes[index].name,
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
    course,
    rulesSnapshot: round.rulesSnapshot,
    teeSet: setup.teeSet,
    pinRotation: setup.pinRotation,
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
  if (round.teamAuthority && round.teamAuthority.format !== "four-ball") return nextTeamGolferId(round);
  const rank = new Map(round.honorsOrder.map((id, index) => [id, index]));
  return golfers
    .filter((golfer) => activeOnHole(round, golfer))
    .map((golfer) => {
      const pin = golfer.setup.holes[round.currentHoleIndex].pin;
      return { golfer, distance: Math.hypot(golfer.ball.x - pin.x, golfer.ball.y - pin.y) };
    })
    .sort((a, b) => b.distance - a.distance || (rank.get(a.golfer.id) ?? 99) - (rank.get(b.golfer.id) ?? 99))[0]?.golfer.id ?? null;
}

function activeTeamBall(round: ChallengeGroupRound, ball: TeamBallState): boolean {
  return ball.scorecard[round.currentHoleIndex]?.status === "active";
}

function nextTeamGolferId(round: ChallengeGroupRound): string | null {
  const authority = round.teamAuthority;
  if (!authority) return null;
  const pin = round.course.holes[round.currentHoleIndex].pin;
  const teamRank = new Map(authority.teams.map((team, index) => [team.id, index]));
  const ball = authority.balls.filter((entry) => activeTeamBall(round, entry)).sort((a, b) => {
    const aDistance = Math.hypot(a.ball.x - pin.x, a.ball.y - pin.y);
    const bDistance = Math.hypot(b.ball.x - pin.x, b.ball.y - pin.y);
    return bDistance - aDistance || (teamRank.get(a.teamId) ?? 99) - (teamRank.get(b.teamId) ?? 99);
  })[0];
  if (!ball) return null;
  if (authority.format === "alternate-shot") return ball.nextPlayerId;
  const team = authority.teams.find((entry) => entry.id === ball.teamId)!;
  return team.playerIds.find((id) => !ball.candidates.some((candidate) => candidate.playerId === id)) ?? null;
}

function withTeamBallGolfer(round: ChallengeGroupRound, golfer: ChallengeGroupGolfer): ChallengeGroupGolfer {
  const ball = round.teamAuthority?.balls.find((entry) => entry.teamId === golfer.teamId);
  if (!ball || round.teamAuthority?.format === "four-ball") return golfer;
  const teamScore = ball.scorecard[round.currentHoleIndex];
  return {
    ...golfer,
    ball: { ...ball.ball },
    lie: ball.lie,
    scorecard: golfer.scorecard.map((score, index) => index === round.currentHoleIndex ? {
      ...score,
      strokes: teamScore.strokes,
      penalties: teamScore.penalties,
    } : score),
  };
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
  if (mode === "net-stableford") return score.gross == null ? null : stablefordPoints(score.gross, score.par, score.handicapStrokes);
  return mode.startsWith("net") ? score.net : score.gross;
}

function settleCompletedHole(round: ChallengeGroupRound, golfers: readonly ChallengeGroupGolfer[]): { golfers: ChallengeGroupGolfer[]; match: ChallengeMatchState; reactions: ChallengeGroupRound["reactions"] } {
  const hole = round.course.holes[round.currentHoleIndex];
  const sharedTeamBall = round.teamAuthority && round.teamAuthority.format !== "four-ball";
  const scoringMode = round.individualAuthority?.format ?? round.match.scoringMode;
  const scores = Object.fromEntries(golfers.map((golfer) => [golfer.id, sharedTeamBall ? null : scoreValue(golfer.scorecard[round.currentHoleIndex], scoringMode)]));
  const eligible = golfers.filter((golfer) => scores[golfer.id] != null && !golfer.withdrawn);
  const best = eligible.length ? (scoringMode === "net-stableford" ? Math.max : Math.min)(...eligible.map((golfer) => scores[golfer.id]!)) : null;
  const winnerIds = best == null ? [] : eligible.filter((golfer) => scores[golfer.id] === best).map((golfer) => golfer.id);
  const teamScores = round.match.teams.map((team) => {
    const shared = sharedTeamBall ? round.teamAuthority!.balls.find((ball) => ball.teamId === team.id)?.scorecard[round.currentHoleIndex] : null;
    if (shared) return { id: team.id, gross: shared.gross ?? Number.POSITIVE_INFINITY, net: shared.net ?? Number.POSITIVE_INFINITY };
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
  const statuses = sharedTeamBall
    ? round.teamAuthority!.balls.map((ball) => ball.scorecard[round.currentHoleIndex].status)
    : golfers.map((golfer) => golfer.scorecard[round.currentHoleIndex].status);
  const result: ChallengeMatchHoleResult = {
    holeId: hole.id,
    winnerIds,
    teamWinnerIds,
    status: statuses.includes("withdrawn") ? "withdrawn" : statuses.includes("conceded") ? "conceded" : (sharedTeamBall ? teamWinnerIds.length : winnerIds.length) === 1 ? "won" : "halved",
    scores,
  };
  const standings = round.match.standings.map((standing) => {
    const golfer = golfers.find((candidate) => candidate.id === standing.id)!;
    const card = golfer.scorecard[round.currentHoleIndex];
    return {
      ...standing,
      gross: standing.gross + (sharedTeamBall ? 0 : card.gross ?? 0),
      net: standing.net + (sharedTeamBall ? 0 : card.net ?? 0),
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
  const sharedTeamBall = round.teamAuthority && round.teamAuthority.format !== "four-ball";
  const hasActive = sharedTeamBall
    ? round.teamAuthority!.balls.some((ball) => activeTeamBall(round, ball))
    : golfers.some((golfer) => activeOnHole(round, golfer));
  if (hasActive) {
    return { ...round, golfers, activeGolferId: nextGolferId(round, golfers) };
  }
  const settled = settleCompletedHole(round, golfers);
  const individualAuthority = settleIndividualHole(round, settled.golfers);
  if (round.currentHoleIndex >= round.course.holes.length - 1) {
    return freeze({
      ...round,
      phase: "complete",
      activeGolferId: null,
      golfers: settled.golfers,
      reactions: settled.reactions,
      ...(individualAuthority ? { individualAuthority } : {}),
      match: { ...settled.match, status: "complete" },
      completedWeek: round.startedWeek,
      completedDay: round.startedDay,
    });
  }
  const honorsOrder = sharedTeamBall ? [...round.honorsOrder] : [...round.honorsOrder].sort((a, b) => {
    const aScore = settled.golfers.find((golfer) => golfer.id === a)!.scorecard[round.currentHoleIndex].gross;
    const bScore = settled.golfers.find((golfer) => golfer.id === b)!.scorecard[round.currentHoleIndex].gross;
    return (aScore ?? Number.MAX_SAFE_INTEGER) - (bScore ?? Number.MAX_SAFE_INTEGER)
      || round.honorsOrder.indexOf(a) - round.honorsOrder.indexOf(b);
  });
  const nextIndex = round.currentHoleIndex + 1;
  const golfersForNext = settled.golfers.map((golfer) => golfer.withdrawn ? golfer : {
    ...golfer,
    ball: { ...golfer.setup.holes[nextIndex].tee },
    lie: "tee",
  });
  const advanced: ChallengeGroupRound = {
    ...round,
    currentHoleIndex: nextIndex,
    honorsOrder,
    golfers: golfersForNext,
    match: settled.match,
    reactions: settled.reactions,
    ...(individualAuthority ? { individualAuthority } : {}),
    activeGolferId: null,
    ...(sharedTeamBall ? {
      teamAuthority: {
        ...round.teamAuthority!,
        balls: round.teamAuthority!.balls.map((ball) => {
          const team = round.teamAuthority!.teams.find((entry) => entry.id === ball.teamId)!;
          const teePlayerIndex = round.teamAuthority!.format === "alternate-shot" ? nextIndex % 2 : 0;
          return {
            ...ball,
            ball: { ...round.course.holes[nextIndex].tee },
            lie: "tee",
            nextPlayerId: team.playerIds[teePlayerIndex],
            candidates: [],
          };
        }),
      },
    } : {}),
  };
  return { ...advanced, activeGolferId: nextGolferId(advanced, golfersForNext) };
}

function selectedScrambleBall(round: ChallengeGroupRound, teamId: string, selectedPlayerId: string, controller: "player" | "ai"): ChallengeGroupRound {
  const authority = round.teamAuthority;
  if (!authority || authority.format !== "scramble") throw new Error("Ball choice is available only in a two-person scramble.");
  const ball = authority.balls.find((entry) => entry.teamId === teamId);
  const team = authority.teams.find((entry) => entry.id === teamId);
  const selected = ball?.candidates.find((candidate) => candidate.playerId === selectedPlayerId);
  if (!ball || !team || ball.candidates.length !== 2 || !selected) throw new Error("The selected scramble ball is not one of the two completed partner shots.");
  const score = ball.scorecard[round.currentHoleIndex];
  const strokes = score.strokes + selected.strokeCost;
  const penalties = score.penalties + selected.penaltyStrokes;
  const complete = selected.completesHole;
  const nextScore = {
    ...score,
    strokes,
    penalties,
    gross: complete ? strokes + penalties : null,
    net: complete ? strokes + penalties - score.handicapStrokes : null,
    status: complete ? "played" as const : "active" as const,
    countedPlayerIds: [...score.countedPlayerIds, selected.playerId],
  };
  const nextBall: TeamBallState = {
    ...ball,
    ball: { ...selected.rest },
    lie: selected.lie,
    nextPlayerId: team.playerIds[0],
    candidates: [],
    scorecard: ball.scorecard.map((entry, index) => index === round.currentHoleIndex ? nextScore : entry),
  };
  const golfers = round.golfers.map((golfer) => golfer.teamId !== teamId ? golfer : {
    ...golfer,
    ball: { ...selected.rest },
    lie: selected.lie,
    scorecard: golfer.scorecard.map((entry, index) => index === round.currentHoleIndex && complete ? { ...entry, status: "played" as const } : entry),
  });
  const choice = {
    holeId: score.holeId,
    sequence: authority.choices.length + 1,
    teamId,
    selectedPlayerId,
    candidateShotIds: ball.candidates.map((candidate) => candidate.shotId),
    controller,
    reason: controller === "ai" ? "completion, penalty, leave, roster order, then shot ID" : "explicit player selection",
  };
  return completeOrAdvanceHole({
    ...round,
    phase: "awaiting_player",
    activeGolferId: null,
    golfers,
    teamAuthority: {
      ...authority,
      balls: authority.balls.map((entry) => entry.teamId === teamId ? nextBall : entry),
      choices: [...authority.choices, choice],
    },
  }, golfers);
}

function commitTeamTurn(round: ChallengeGroupRound, golferId: string, selection: PlayerShotSelection): ChallengeGroupRound {
  const authority = round.teamAuthority!;
  if (round.phase === "complete" || round.phase === "awaiting_ball_choice" || round.activeGolferId !== golferId) return round;
  const golfer = round.golfers.find((candidate) => candidate.id === golferId);
  const ball = authority.balls.find((entry) => entry.teamId === golfer?.teamId);
  if (!golfer || !ball || !activeTeamBall(round, ball)) return round;
  const playableGolfer = withTeamBallGolfer(round, golfer);
  const skills = effectiveSkills(golfer);
  const preview = previewPlayableShot(playableRound(round, playableGolfer), skills, selection);
  if (!preview.available) return round;
  const score = ball.scorecard[round.currentHoleIndex];
  const seed = (round.rngSeed + round.rngCursor * 104729) >>> 0;
  const rawTrace = resolvePlayableShot({
    snapshot: round.course,
    rulesSnapshot: round.rulesSnapshot,
    holeId: score.holeId,
    shotNumber: score.strokes + 1,
    from: ball.ball,
    lie: ball.lie,
    skills,
    selection,
    handedness: golfer.handedness,
    confidenceSnapshot: golfer.confidenceSnapshot,
    seed,
  });
  const shotId = `shot-${round.id}-${golfer.id}-${score.holeId}-${round.turnEvidence.length + 1}`;
  const trace: PlayerShotTrace = { ...rawTrace, id: shotId, evidence: rawTrace.evidence.map((entry) => ({ ...entry, id: `${entry.id}-${golfer.id}` })) };
  const puttingStrokes = trace.greenPutting?.putts ?? 0;
  const strokeCost = 1 + puttingStrokes;
  const completesHole = trace.holed || puttingStrokes > 0;
  const candidate: TeamBallCandidate = {
    playerId: golfer.id,
    shotId,
    rest: { ...trace.rest },
    lie: trace.lieAfter,
    penaltyStrokes: trace.penaltyStrokes,
    strokeCost,
    completesHole,
    distanceToPin: Math.hypot(trace.rest.x - round.course.holes[round.currentHoleIndex].pin.x, trace.rest.y - round.course.holes[round.currentHoleIndex].pin.y),
  };
  const team = authority.teams.find((entry) => entry.id === golfer.teamId)!;
  let nextBall: TeamBallState;
  if (authority.format === "alternate-shot") {
    nextBall = advanceAlternateShotBall(ball, round.currentHoleIndex, candidate, team.playerIds);
  } else {
    nextBall = { ...ball, candidates: [...ball.candidates, candidate] };
  }
  const golfers = round.golfers.map((entry) => entry.id !== golfer.id ? entry : {
    ...entry,
    ball: { ...trace.rest },
    lie: trace.lieAfter,
    shots: [...entry.shots, trace].slice(-MAX_GROUP_SHOTS),
    scorecard: entry.scorecard.map((card, index) => index === round.currentHoleIndex ? {
      ...card,
      strokes: card.strokes + strokeCost,
      penalties: card.penalties + trace.penaltyStrokes,
      status: authority.format === "alternate-shot" && completesHole ? "played" as const : card.status,
    } : card),
  }).map((entry) => authority.format === "alternate-shot" && completesHole && entry.teamId === golfer.teamId ? {
    ...entry,
    scorecard: entry.scorecard.map((card, index) => index === round.currentHoleIndex ? { ...card, status: "played" as const } : card),
  } : entry);
  const evidence: ChallengeTurnEvidence = {
    turn: round.turnEvidence.length + 1,
    golferId,
    controller: golfer.controller,
    holeId: score.holeId,
    shotId,
    seed,
    selection: clone(selection),
    from: { ...ball.ball },
    lieBefore: ball.lie,
    lieAfter: trace.lieAfter,
    rest: { ...trace.rest },
    penaltyStrokes: trace.penaltyStrokes,
    ruling: trace.ruling ? clone(trace.ruling) : null,
  };
  let next: ChallengeGroupRound = {
    ...round,
    golfers,
    teamAuthority: { ...authority, balls: authority.balls.map((entry) => entry.teamId === ball.teamId ? nextBall : entry) },
    turnEvidence: [...round.turnEvidence, evidence].slice(-MAX_GROUP_SHOTS),
    rngCursor: round.rngCursor + 1,
  };
  if (authority.format === "scramble" && nextBall.candidates.length === 2) {
    const playerTeam = team.playerIds.includes(round.playerGolferId);
    if (playerTeam) return { ...next, phase: "awaiting_ball_choice", activeGolferId: round.playerGolferId };
    const chosen = chooseDeterministicScrambleBall(nextBall.candidates, team.playerIds);
    next = selectedScrambleBall(next, team.id, chosen.playerId, "ai");
    return next;
  }
  return completeOrAdvanceHole(next, golfers);
}

function commitTurn(round: ChallengeGroupRound, golferId: string, selection: PlayerShotSelection): ChallengeGroupRound {
  if (round.teamAuthority && round.teamAuthority.format !== "four-ball") return commitTeamTurn(round, golferId, selection);
  if (round.phase === "complete" || round.activeGolferId !== golferId) return round;
  const golfer = round.golfers.find((candidate) => candidate.id === golferId);
  if (!golfer || !activeOnHole(round, golfer)) return round;
  const skills = effectiveSkills(golfer);
  const preview = previewPlayableShot(playableRound(round, golfer), skills, selection);
  if (!preview.available) return round;
  const score = golfer.scorecard[round.currentHoleIndex];
  const seed = (round.rngSeed + round.rngCursor * 104729) >>> 0;
  const rawTrace = resolvePlayableShot({
    snapshot: participantCourse(round, golfer),
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
    if (next.phase === "awaiting_ball_choice") break;
    const golfer = next.golfers.find((candidate) => candidate.id === next.activeGolferId);
    if (!golfer || golfer.controller === "player") break;
    const selection = caddieRecommendation(playableRound(next, withTeamBallGolfer(next, golfer)), effectiveSkills(golfer));
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
  const participants = args.participants;
  const teamFormat = args.teamFormat;
  const scoringMode = args.scoringMode;
  const sharedCourse = args.course;
  if (!args.id.trim()) throw new Error("Challenge group requires a stable round ID.");
  if (participants.length < CHALLENGE_GROUP_MIN_GOLFERS || participants.length > CHALLENGE_GROUP_MAX_GOLFERS) throw new Error("Challenge groups require 2–4 golfers.");
  if (participants.some((participant) => !participant.id.trim() || !participant.name.trim())) throw new Error("Challenge group golfers require stable IDs and names.");
  if (new Set(participants.map((participant) => participant.id)).size !== participants.length) throw new Error("Challenge group golfer IDs must be unique.");
  if (participants.filter((participant) => participant.controller === "player").length !== 1) throw new Error("Challenge groups require exactly one player-controlled golfer.");
  if (teamFormat) {
    const teamIds = [...new Set(participants.map((participant) => participant.teamId))];
    if (participants.length !== 4 || teamIds.length !== 2 || teamIds.some((id) => !id || participants.filter((participant) => participant.teamId === id).length !== 2)) throw new Error("Team formats require exactly two stable teams of two golfers.");
  }
  if (teamFormat && (args.individualFormat || args.individualContests?.length)) throw new Error("Individual competition authority cannot be combined with a team format.");
  if (teamFormat && scoringMode === "net-stableford") throw new Error("Team Stableford requires its own team authority.");
  if (sharedCourse.holes.length !== 9 && sharedCourse.holes.length !== 18) throw new Error("Challenge groups require an authoritative 9- or 18-hole route.");
  if (sharedCourse.tiles.length !== sharedCourse.width * sharedCourse.height || sharedCourse.elevations.length !== sharedCourse.tiles.length) throw new Error("Challenge group course geometry is incomplete.");
  if (!validRating(sharedCourse.rating)) throw new Error(INVALID_SETUP);
  if (args.rulesSnapshot && !decodeControlledRoundSnapshotV2(args.rulesSnapshot).ok) throw new Error("Challenge group rules snapshot is invalid.");
  for (const participant of participants) {
    const setup = participant.setup;
    if (!setup) continue;
    const participantCourse = setup.course;
    if (participantCourse.holes.length !== sharedCourse.holes.length
      || participantCourse.holes.some((hole, index) => hole.id !== sharedCourse.holes[index].id)) throw new Error(INVALID_SETUP);
    if (!validRating(participantCourse.rating)) throw new Error(INVALID_SETUP);
    if (teamFormat && (setup.teeSet !== args.teeSet || setup.pinRotation !== args.pinRotation || JSON.stringify(participantCourse) !== JSON.stringify(sharedCourse))) throw new Error(INVALID_SETUP);
  }
  const course = freeze(sharedCourse);
  let golfers: ChallengeGroupGolfer[] = participants.map((participant) => {
    const setup = participantSetup(participant.setup ?? { course, teeSet: args.teeSet, pinRotation: args.pinRotation });
    const handicap = handicapFor(participant, setup);
    return {
      id: participant.id,
      name: participant.name,
      controller: participant.controller,
      teamId: participant.teamId ?? `individual:${participant.id}`,
      handedness: participant.handedness ?? "right",
      skills: freeze(participant.skills),
      ...(participant.confidenceSnapshot ? { confidenceSnapshot: freeze(participant.confidenceSnapshot) } : {}),
      setup,
      handicap,
      equipment: selectedEquipment(participant.equipment),
      ball: { ...setup.holes[0].tee },
      lie: "tee",
      scorecard: scorecardFor(handicap, setup),
      shots: [],
      withdrawn: false,
    };
  });
  const effectiveIndividualFormat = teamFormat ? undefined : args.individualFormat
    ?? (args.individualContests?.length || scoringMode === "net-stableford" ? scoringMode ?? "net-match" : undefined);
  if (effectiveIndividualFormat === "net-match") {
    const field = golfers.map((golfer) => ({ playingHandicap: golfer.handicap.playingHandicap }));
    for (const golfer of golfers) {
      golfer.handicap.playingHandicap = strokesOffLow(golfer.handicap.playingHandicap, field);
      const strokes = strokesByHole(golfer.handicap.playingHandicap, competitionHoles(golfer.setup));
      golfer.handicap.strokesByHole = strokes;
      golfer.scorecard.forEach((score, index) => { score.handicapStrokes = strokes[index]; });
    }
  }
  const teamAuthority = teamFormat ? buildTeamAuthority(golfers, teamFormat, scoringMode ?? "net-match", course) : undefined;
  if (teamAuthority?.format === "four-ball") golfers = applyFourBallHandicaps(golfers, teamAuthority);
  const honorsOrder = golfers.map((golfer) => golfer.id);
  const individualAuthority = effectiveIndividualFormat
    ? buildIndividualAuthority(golfers, effectiveIndividualFormat, args.individualContests ?? [], course)
    : undefined;
  const initial: ChallengeGroupRound = {
    version: CHALLENGE_GROUP_ROUND_VERSION,
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
    ...(teamAuthority ? { teamAuthority } : {}),
    ...(individualAuthority ? { individualAuthority } : {}),
    match: buildMatch(golfers, teamFormat ? scoringMode ?? "net-match" : effectiveIndividualFormat ?? scoringMode ?? "net-match"),
    sideBets: freeze(args.sideBets ?? []),
    reactions: [],
    turnEvidence: [],
    rngSeed: args.rngSeed >>> 0,
    rngCursor: 0,
    startedWeek: Math.max(0, Math.floor(args.startedWeek)),
    startedDay: Math.max(0, Math.floor(args.startedDay)),
  };
  const started = runAiUntilPlayer(initial);
  const error = validateChallengeGroupRound(started);
  if (error) throw new Error(error);
  return started;
}

export function previewChallengeGroupPlayerShot(round: ChallengeGroupRound, golferId: string, selection: PlayerShotSelection): PlayerShotPreview | null {
  if (round.phase !== "awaiting_player" || round.activeGolferId !== golferId) return null;
  const golfer = round.golfers.find((candidate) => candidate.id === golferId);
  if (!golfer || golfer.controller !== "player") return null;
  return previewPlayableShot(playableRound(round, withTeamBallGolfer(round, golfer)), effectiveSkills(golfer), selection);
}

/** Deferred UI projection of the authoritative group state; never persisted. */
export function challengeGroupPlayerRound(round: ChallengeGroupRound): PlayerPlayableRound | null {
  const golfer = round.golfers.find((candidate) => candidate.id === round.playerGolferId);
  if (!golfer || round.phase === "awaiting_ball_choice") return null;
  const view = playableRound(round, withTeamBallGolfer(round, golfer));
  return round.phase === "complete" ? { ...view, phase: "round_complete" } : view;
}

/** Exact skills used by authoritative preview and resolution, including frozen equipment. */
export function challengeGroupPlayerSkills(round: ChallengeGroupRound): PlayerProSkills {
  const golfer = round.golfers.find((candidate) => candidate.id === round.playerGolferId);
  if (!golfer) throw new Error("Challenge group player is missing.");
  return effectiveSkills(golfer);
}

export function commitChallengeGroupPlayerShot(round: ChallengeGroupRound, golferId: string, selection: PlayerShotSelection): ChallengeGroupRound {
  if (golferId !== round.playerGolferId) throw new Error("Only the player-controlled golfer accepts player shot input.");
  if (round.activeGolferId !== golferId) throw new Error("The player-controlled golfer does not own the current turn.");
  return runAiUntilPlayer(commitTurn(round, golferId, selection));
}

/** The human captain must explicitly choose either partner's completed scramble shot. */
export function chooseChallengeGroupScrambleBall(round: ChallengeGroupRound, selectedPlayerId: string): ChallengeGroupRound {
  if (round.phase !== "awaiting_ball_choice" || !round.teamAuthority || round.teamAuthority.format !== "scramble") throw new Error("This round is not awaiting an explicit scramble ball choice.");
  const player = round.golfers.find((golfer) => golfer.id === round.playerGolferId)!;
  const next = selectedScrambleBall(round, player.teamId, selectedPlayerId, "player");
  return runAiUntilPlayer(next);
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

export interface ChallengeMeasurementInput {
  contestId: string;
  participantId: string;
  holeId: string;
  shotId: string;
  club: string;
  start: PlayerProPoint;
  end: PlayerProPoint;
  lie: string;
  measurement: number;
}

/**
 * Records contest evidence without deciding anything of value. Invalid claims
 * are retained as rejected audit records rather than silently disappearing.
 */
export function recordChallengeGroupMeasurement(round: ChallengeGroupRound, input: ChallengeMeasurementInput): ChallengeGroupRound {
  const authority = round.individualAuthority;
  if (!authority) throw new Error("This round has no individual competition authority.");
  const contest = authority.contests.find((entry) => entry.id === input.contestId);
  const golfer = round.golfers.find((entry) => entry.id === input.participantId);
  const shot = golfer?.shots.find((entry) => entry.id === input.shotId);
  const accepted = Boolean(contest && (contest.kind === "closest-to-pin" || contest.kind === "longest-drive") && golfer && shot
    && shot.holeId === input.holeId && contestApplies(contest, input.holeId) && point(input.start) && point(input.end)
    && typeof input.club === "string" && input.club.length > 0 && typeof input.lie === "string" && input.lie.length > 0
    && Number.isFinite(input.measurement) && input.measurement >= 0 && !golfer.withdrawn);
  const rejectionReason = accepted ? undefined
    : !contest ? "Unknown contest."
      : contest.kind !== "closest-to-pin" && contest.kind !== "longest-drive" ? "Contest does not accept measurement evidence."
        : !golfer ? "Unknown participant."
          : !shot ? "Shot does not belong to the participant."
            : shot.holeId !== input.holeId ? "Shot belongs to a different hole."
              : !contestApplies(contest, input.holeId) ? "Contest is not active on this hole."
                : golfer.withdrawn ? "Participant withdrew."
                  : "Measurement evidence is malformed.";
  const record: ChallengeMeasurementRecord = {
    id: `measurement-${round.id}-${authority.measurements.length + 1}`,
    contestId: input.contestId,
    holeId: input.holeId,
    participantId: input.participantId,
    shotId: input.shotId,
    club: input.club,
    start: clone(input.start),
    end: clone(input.end),
    lie: input.lie,
    measurement: input.measurement,
    eligible: accepted,
    ...(rejectionReason ? { rejectionReason } : {}),
  };
  return freeze({ ...round, individualAuthority: { ...authority, measurements: [...authority.measurements, record] } });
}

export function encodeChallengeGroupRound(round: ChallengeGroupRound): string {
  const error = validateChallengeGroupRound(round);
  if (error) throw new Error(error);
  return JSON.stringify(round);
}

export { decodeChallengeGroupRound } from "./challengeGroupRoundCodec";
export {
  challengeGroupIndividualGrossEvidence,
  challengeGroupRoundTextState,
  renderChallengeGroupRoundToText,
} from "./challengeGroupRoundText";
