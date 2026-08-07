import type { PlayerProPoint, PlayerRoundCourseSnapshot, PlayerShotTrace } from "../models/playerProTypes";
import { isValidSharedShotOutcome } from "../rules/contracts";
import { decodeControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { courseHandicapUnrounded, roundHalfAwayFromZero, strokesByHole, strokesOffLow } from "./handicap";
import { captureTeamHandicapSnapshots } from "./teamAuthority";
import type {
  ChallengeGroupDecodeResult,
  ChallengeGroupRound,
  ChallengeGroupScoringMode,
  ChallengeParticipantSetupSnapshot,
  ChallengeSideBetState,
} from "./challengeGroupRound";

const VERSION = 2;
const MAX_GROUP_SHOTS = 960;
const groupError = (detail: string) => `ChallengeGroupRound ${detail}`;
const SIDE_BET_KINDS = ["skins", "nassau", "closest-to-pin", "longest-drive"] as const;
const INDIVIDUAL_FORMATS = ["gross-stroke", "net-stroke", "gross-match", "net-match", "net-stableford"] as const;
const isNassauFormat = (format: ChallengeGroupScoringMode) => format === "gross-match" || format === "net-match";
const INVALID_GOLFER = groupError("golfer evidence is invalid.");
const INVALID_SAVE = groupError("save is invalid.");

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function point(value: unknown): value is PlayerProPoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PlayerProPoint;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function competitionHoles(course: Pick<PlayerRoundCourseSnapshot, "holes">) {
  return course.holes.map((hole, index) => ({ id: hole.id, par: hole.par, strokeIndex: hole.strokeIndex ?? index + 1 }));
}

function validRating(rating: PlayerRoundCourseSnapshot["rating"]): boolean {
  return !!rating && Number.isFinite(rating.courseRating) && Number.isFinite(rating.slope) && rating.slope > 0;
}

function participantSetup(source: Pick<ChallengeGroupRound, "course" | "teeSet" | "pinRotation">): ChallengeParticipantSetupSnapshot {
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

function validateShot(shot: PlayerShotTrace): boolean {
  return typeof shot.id === "string" && typeof shot.holeId === "string" && Number.isInteger(shot.shotNumber)
    && point(shot.from) && point(shot.aim) && point(shot.rest) && Number.isFinite(shot.seed)
    && Number.isInteger(shot.penaltyStrokes) && shot.penaltyStrokes >= 0
    && (!shot.sharedOutcome || isValidSharedShotOutcome(shot.sharedOutcome));
}

function validSideBet(sideBet: ChallengeSideBetState): boolean {
  return typeof sideBet.id === "string" && sideBet.id.length > 0
    && SIDE_BET_KINDS.includes(sideBet.kind)
    && Number.isFinite(sideBet.stake) && sideBet.stake >= 0
    && Number.isFinite(sideBet.carry) && sideBet.carry >= 0
    && ["pending", "active", "complete", "refunded"].includes(sideBet.status)
    && Array.isArray(sideBet.settlements) && Array.isArray(sideBet.evidence)
    && sideBet.evidence.every((entry) => typeof entry.holeId === "string" && typeof entry.playerId === "string" && Number.isFinite(entry.measurement) && typeof entry.eligible === "boolean");
}

export function validateChallengeGroupRound(round: ChallengeGroupRound): string | null {
  if (round.version !== VERSION) return INVALID_SAVE;
  if (typeof round.id !== "string" || !round.id) return INVALID_SAVE;
  if (round.phase !== "awaiting_player" && round.phase !== "awaiting_ball_choice" && round.phase !== "complete") return INVALID_SAVE;
  const golfers = round.golfers;
  if (golfers.length < 2 || golfers.length > 4) return INVALID_SAVE;
  const golferIds = new Set(golfers.map((golfer) => golfer.id));
  if (golferIds.size !== golfers.length) return INVALID_SAVE;
  if (golfers.some((golfer) => !golfer.id || !golfer.name || (golfer.controller !== "player" && golfer.controller !== "ai") || !golfer.teamId)) return INVALID_SAVE;
  const players = golfers.filter((golfer) => golfer.controller === "player");
  if (players.length !== 1 || round.playerGolferId !== players[0].id) return INVALID_SAVE;
  const course = round.course;
  const route = course.holes;
  if (route.length !== 9 && route.length !== 18) return INVALID_SAVE;
  const holeIds = new Set(route.map((hole) => hole.id));
  if (course.tiles.length !== course.width * course.height || course.elevations.length !== course.tiles.length) return INVALID_SAVE;
  if (round.rulesSnapshot && !decodeControlledRoundSnapshotV2(round.rulesSnapshot).ok) return INVALID_SAVE;
  if (!Number.isInteger(round.currentHoleIndex) || round.currentHoleIndex < 0 || round.currentHoleIndex >= route.length) return INVALID_SAVE;
  if (new Set(round.honorsOrder).size !== golfers.length || round.honorsOrder.some((id) => !golferIds.has(id))) return INVALID_SAVE;
  if (round.phase === "complete" ? round.activeGolferId !== null : !round.activeGolferId || !golferIds.has(round.activeGolferId)) return INVALID_SAVE;
  if (round.phase === "awaiting_player" && round.activeGolferId !== round.playerGolferId) return INVALID_SAVE;
  if (golfers.some(({ setup }) => !setup || !["forward", "member", "championship"].includes(setup.teeSet)
    || !["A", "B", "C"].includes(setup.pinRotation) || setup.holes.length !== route.length
    || setup.holes.some((hole, index) => hole.id !== route[index].id || !Number.isInteger(hole.par) || hole.par < 1 || !point(hole.tee) || !point(hole.pin))
    || !validRating(setup.rating))) return INVALID_GOLFER;
  const teamAuthority = round.teamAuthority;
  const individualAuthority = round.individualAuthority;
  const allowanceField = golfers.map((golfer) => {
    const unrounded = unroundedHandicap(golfer.handicap.handicapIndex, golfer.setup);
    return { u: unrounded, playingHandicap: roundHalfAwayFromZero(unrounded * golfer.handicap.allowance) };
  });
  if (golfers.some((golfer, golferIndex) => {
    const setup = golfer.setup;
    const handicap = golfer.handicap;
    const holes = competitionHoles(setup);
    const expectedCourseHandicap = roundHalfAwayFromZero(allowanceField[golferIndex].u);
    const teamPlaying = teamAuthority?.format === "four-ball"
      ? teamAuthority.handicaps.flatMap((snapshot) => snapshot.members).find((member) => member.playerId === golfer.id)?.strokesOffLow
      : undefined;
    const expectedPlaying = teamPlaying ?? (individualAuthority?.format === "net-match"
      ? strokesOffLow(allowanceField[golferIndex].playingHandicap, allowanceField)
      : allowanceField[golferIndex].playingHandicap);
    const expectedStrokes = strokesByHole(handicap.playingHandicap, holes);
    return !point(golfer.ball)
    || !Object.values(golfer.skills).every((skill) => Number.isFinite(skill) && skill >= 0 && skill <= 100)
    || !Number.isFinite(handicap.handicapIndex)
    || handicap.courseHandicap !== expectedCourseHandicap
    || !Number.isFinite(handicap.allowance) || handicap.allowance < 0
    || !Number.isInteger(handicap.playingHandicap)
    || handicap.playingHandicap !== expectedPlaying
    || handicap.strokesByHole.length !== setup.holes.length
    || golfer.scorecard.length !== setup.holes.length
    || golfer.scorecard.some((score, index) => score.holeId !== setup.holes[index].id
      || score.par !== setup.holes[index].par
      || score.strokeIndex !== (setup.holes[index].strokeIndex ?? index + 1)
      || handicap.strokesByHole[index] !== expectedStrokes[index]
      || score.handicapStrokes !== handicap.strokesByHole[index]
      || !Number.isInteger(score.strokes) || score.strokes < 0
      || !Number.isInteger(score.penalties) || score.penalties < 0
      || (score.gross != null && score.gross !== score.strokes + score.penalties)
      || (score.net != null && score.net !== score.gross! - score.handicapStrokes))
    || golfer.equipment.modifiers.some((modifier) => !Number.isFinite(modifier.multiplier) || modifier.multiplier <= 0)
    || golfer.shots.some((shot) => !validateShot(shot));
  })) return INVALID_GOLFER;
  const turns = round.turnEvidence;
  if (turns.length > MAX_GROUP_SHOTS || turns.some((turn, index) => turn.turn !== index + 1 || !golferIds.has(turn.golferId) || !point(turn.from) || !point(turn.rest))) return INVALID_SAVE;
  if (!Number.isInteger(round.rngCursor) || round.rngCursor !== turns.length) return INVALID_SAVE;
  const shotIds = golfers.flatMap((golfer) => golfer.shots.map((shot) => shot.id));
  if (new Set(shotIds).size !== shotIds.length) return INVALID_SAVE;
  if (turns.some((turn) => !shotIds.includes(turn.shotId))) return groupError("turn evidence references a missing shot.");
  const sideBets = round.sideBets;
  if (!Array.isArray(sideBets) || sideBets.some((sideBet) => !validSideBet(sideBet)) || new Set(sideBets.map((sideBet) => sideBet.id)).size !== sideBets.length) return INVALID_SAVE;
  if (individualAuthority) {
    const authority = individualAuthority;
    const contestIds = new Set(authority.contests.map((contest) => contest.id));
    if (teamAuthority || authority.version !== 1 || !INDIVIDUAL_FORMATS.includes(authority.format)
      || authority.handicapSnapshots.length !== golfers.length
      || authority.handicapSnapshots.some((snapshot, index) => snapshot.playerId !== golfers[index].id || snapshot.playingHandicap !== golfers[index].handicap.playingHandicap || JSON.stringify(snapshot.strokesByHole) !== JSON.stringify(golfers[index].handicap.strokesByHole))) return INVALID_SAVE;
    if (contestIds.size !== authority.contests.length
      || authority.contests.some((contest) => !contest.id || !SIDE_BET_KINDS.includes(contest.kind) || contest.holeIds?.some((id) => !holeIds.has(id)))) return INVALID_SAVE;
    if (authority.contests.some((contest) => contest.kind === "nassau" && (golfers.length !== 2 || route.length !== 18 || contest.holeIds?.length || !isNassauFormat(authority.format)))) return INVALID_SAVE;
    if (authority.measurements.some((entry, index) => entry.id !== `measurement-${round.id}-${index + 1}` || !contestIds.has(entry.contestId) || !golferIds.has(entry.participantId) || !holeIds.has(entry.holeId) || !point(entry.start) || !point(entry.end) || !Number.isFinite(entry.measurement) || entry.measurement < 0 || typeof entry.eligible !== "boolean" || (entry.eligible && entry.rejectionReason))) return INVALID_SAVE;
    if (authority.results.some((result) => !contestIds.has(result.contestId) || !["won", "tied", "carried", "not-awarded", "withdrawn"].includes(result.status) || !Number.isInteger(result.carryHoles) || result.carryHoles < 0 || result.winnerIds.some((id) => !golferIds.has(id)))) return INVALID_SAVE;
  }
  const match = round.match;
  if (!match || !Array.isArray(match.teams) || !Array.isArray(match.holeResults) || !Array.isArray(match.standings)) return INVALID_SAVE;
  if (match.teams.some((team) => !team.id || !team.playerIds.length || team.playerIds.some((id: string) => !golferIds.has(id)))) return INVALID_SAVE;
  if (teamAuthority) {
    const authority = teamAuthority;
    if (authority.version !== 1 || !["four-ball", "alternate-shot", "scramble"].includes(authority.format)
      || !["match", "stroke"].includes(authority.scoring) || authority.teams.length !== 2 || authority.handicaps.length !== 2 || authority.balls.length !== 2
      || authority.teams.some((team) => team.playerIds.length !== 2)
      || authority.balls.some((ball) => !authority.teams.some((team) => team.id === ball.teamId) || !point(ball.ball)
        || ball.scorecard.length !== route.length || ball.candidates.length > 2
        || !authority.teams.find((team) => team.id === ball.teamId)?.playerIds.includes(ball.nextPlayerId)
        || ball.scorecard.some((score, index) => score.holeId !== route[index].id || score.par !== route[index].par
          || !Number.isInteger(score.strokes) || score.strokes < 0 || !Number.isInteger(score.penalties) || score.penalties < 0
          || (score.gross != null && score.gross !== score.strokes + score.penalties)
          || (score.net != null && score.net !== score.gross! - score.handicapStrokes))
        || ball.candidates.some((candidate) => !authority.teams.find((team) => team.id === ball.teamId)?.playerIds.includes(candidate.playerId)
          || !point(candidate.rest) || !Number.isInteger(candidate.penaltyStrokes) || candidate.penaltyStrokes < 0 || !Number.isInteger(candidate.strokeCost) || candidate.strokeCost < 1))) return INVALID_SAVE;
    const holes = competitionHoles(course);
    const par = holes.reduce((sum, hole) => sum + hole.par, 0);
    const handicapCourse = course.rating
      ? { courseRating: course.rating.courseRating, slopeRating: course.rating.slope, par }
      : { courseRating: par, slopeRating: 113, par };
    const expectedHandicaps = captureTeamHandicapSnapshots(authority.teams, golfers.map((golfer) => ({ id: golfer.id, handicapIndex: golfer.handicap.handicapIndex })), authority.format, authority.scoring, handicapCourse, holes);
    if (JSON.stringify(expectedHandicaps) !== JSON.stringify(authority.handicaps)
      || authority.scoring !== (match.scoringMode.endsWith("match") ? "match" : "stroke")) return groupError("frozen team handicaps drifted.");
    if (authority.balls.some((ball) => ball.candidates.some((candidate) => !shotIds.includes(candidate.shotId)))
      || authority.choices.some((choice, index) => choice.sequence !== index + 1
        || !authority.teams.some((team) => team.id === choice.teamId && team.playerIds.includes(choice.selectedPlayerId))
        || choice.candidateShotIds.length !== 2 || choice.candidateShotIds.some((id) => !shotIds.includes(id)))) return INVALID_SAVE;
    if (round.phase === "awaiting_ball_choice") {
      const playerTeam = golfers.find((golfer) => golfer.id === round.playerGolferId)?.teamId;
      if (authority.format !== "scramble" || round.activeGolferId !== round.playerGolferId
        || authority.balls.find((ball) => ball.teamId === playerTeam)?.candidates.length !== 2) return INVALID_SAVE;
    }
  } else if (round.phase === "awaiting_ball_choice") return INVALID_SAVE;
  if (round.phase === "complete" && match.status !== "complete") return INVALID_SAVE;
  return null;
}

export function decodeChallengeGroupRound(raw: string | unknown): ChallengeGroupDecodeResult {
  let value: unknown;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
  } catch {
    return { ok: false, error: groupError("save is not valid JSON.") };
  }
  if (!value || typeof value !== "object") return { ok: false, error: INVALID_SAVE };
  const round = value as ChallengeGroupRound;
  let error: string | null;
  try {
    if ((round.version as number) === 1) {
      (round as unknown as { version: number }).version = VERSION;
      const setup = participantSetup(round);
      for (const golfer of round.golfers) {
        golfer.setup = setup;
        const unrounded = unroundedHandicap(golfer.handicap.handicapIndex, setup);
        golfer.handicap.allowance = golfer.handicap.playingHandicap === roundHalfAwayFromZero(unrounded) ? 1 : unrounded === 0
          ? golfer.handicap.playingHandicap === 0 ? 1 : NaN
          : golfer.handicap.playingHandicap / unrounded;
      }
    }
    error = validateChallengeGroupRound(round);
  } catch {
    error = INVALID_SAVE;
  }
  return error ? { ok: false, error } : { ok: true, round: deepFreeze(round) };
}
