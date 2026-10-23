import type { PlayerPlayableRound, PlayerShotTrace } from "../models/playerProTypes";
import { createShotPacingCursor, createShotPacingPlan, isShotPacingCursor, type ShotPacingCursorV1, type ShotPacingPlan } from "../live/shotPacing";
import type { ChallengeGroupRound, ChallengeTurnEvidence } from "./challengeGroupRound";

/** A bounded display batch, never an input to turn selection, RNG or scoring. */
export interface ChallengeGroupPresentationV1 {
  version: 1;
  groupId: string;
  startTurn: number;
  throughTurn: number;
  index: number;
  entries: readonly { turn: number; cursor: ShotPacingCursorV1 }[];
}
const exact = (value: object, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));

function source(round: ChallengeGroupRound, turn: ChallengeTurnEvidence): { shot: PlayerShotTrace; plan: ShotPacingPlan } | null {
  const golfer = round.golfers.find((candidate) => candidate.id === turn.golferId);
  const shot = golfer?.shots.find((candidate) => candidate.id === turn.shotId);
  const motion = shot?.sharedOutcome?.motion;
  if (!golfer || !shot || !motion || turn.controller !== golfer.controller || turn.holeId !== shot.holeId
    || turn.seed !== shot.seed || motion.identity.shotId !== shot.id || motion.identity.holeId !== shot.holeId
    || motion.identity.seed !== (shot.seed >>> 0) || motion.identity.shotNumber !== shot.shotNumber
    || motion.identity.club !== shot.club || motion.identity.style !== shot.shotStyle
    || turn.from.x !== shot.from.x || turn.from.y !== shot.from.y || turn.rest.x !== shot.rest.x || turn.rest.y !== shot.rest.y) return null;
  const plan = createShotPacingPlan({ scopeId: round.id, actorId: golfer.id, motion, distanceYards: shot.carryYards + shot.rollYards });
  return plan ? { shot, plan } : null;
}

/** Latest newly committed retained turn per actor, in actual turn order, at most four. */
function selectedTurns(round: ChallengeGroupRound, startTurn: number) {
  const latest = new Map<string, ChallengeTurnEvidence>();
  for (const turn of round.turnEvidence.slice(startTurn)) latest.set(turn.golferId, turn);
  return [...latest.values()].filter((turn) => source(round, turn)).sort((left, right) => left.turn - right.turn);
}

export function createChallengeGroupPresentation(previous: ChallengeGroupRound | null, round: ChallengeGroupRound): ChallengeGroupRound {
  const startTurn = previous?.id === round.id ? previous.turnEvidence.length : 0;
  if (startTurn === round.turnEvidence.length) return round;
  const entries = selectedTurns(round, startTurn).map((turn) => ({ turn: turn.turn, cursor: createShotPacingCursor(source(round, turn)!.plan) }));
  return { ...round, presentation: { version: 1, groupId: round.id, startTurn, throughTurn: round.turnEvidence.length, index: 0, entries } };
}

export function isChallengeGroupPresentation(value: unknown, round: ChallengeGroupRound): value is ChallengeGroupPresentationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exact(value, ["version", "groupId", "startTurn", "throughTurn", "index", "entries"])) return false;
  const carrier = value as ChallengeGroupPresentationV1;
  if (carrier.version !== 1 || carrier.groupId !== round.id || !Number.isInteger(carrier.startTurn) || carrier.startTurn < 0
    || carrier.throughTurn !== round.turnEvidence.length || carrier.startTurn >= carrier.throughTurn || !Array.isArray(carrier.entries)
    || carrier.entries.length > 4 || !Number.isInteger(carrier.index) || carrier.index < 0 || carrier.index > carrier.entries.length) return false;
  const expected = selectedTurns(round, carrier.startTurn);
  return expected.length === carrier.entries.length && carrier.entries.every((entry, index) => {
    if (!entry || typeof entry !== "object" || !exact(entry, ["turn", "cursor"]) || entry.turn !== expected[index].turn) return false;
    const plan = source(round, expected[index])!.plan;
    return isShotPacingCursor(entry.cursor, plan)
      && (index < carrier.index ? entry.cursor.elapsedMs === plan.durationMs : index > carrier.index ? entry.cursor.elapsedMs === 0 : true);
  });
}

/** Legacy saves without a carrier deliberately do not replay their old history. */
export function challengeGroupFeaturedShot(round: ChallengeGroupRound | null | undefined) {
  const carrier = round?.presentation;
  if (!round || !carrier || !isChallengeGroupPresentation(carrier, round)) return null;
  const entry = carrier.entries[carrier.index];
  const turn = entry && round.turnEvidence[entry.turn - 1];
  const retained = turn && source(round, turn);
  const golfer = turn && round.golfers.find((candidate) => candidate.id === turn.golferId);
  return entry && turn && retained && golfer ? { ...retained, golfer, turn, entry, carrier } : null;
}

export function checkpointChallengeGroupPresentation(round: ChallengeGroupRound, shotId: string, progress: number, complete = false): ChallengeGroupRound {
  const featured = challengeGroupFeaturedShot(round);
  if (!featured || featured.shot.id !== shotId || !Number.isFinite(progress) || progress < 0 || progress > 1) return round;
  const elapsedMs = progress * featured.plan.durationMs;
  if (elapsedMs <= featured.entry.cursor.elapsedMs && !complete || elapsedMs < featured.entry.cursor.elapsedMs || complete && progress !== 1) return round;
  const entries = featured.carrier.entries.map((entry, index) => index === featured.carrier.index
    ? { ...entry, cursor: { ...entry.cursor, elapsedMs } } : entry);
  return { ...round, presentation: { ...featured.carrier, entries, index: featured.carrier.index + (complete ? 1 : 0) } };
}

export function skipChallengeGroupPresentation(round: ChallengeGroupRound): ChallengeGroupRound {
  if (!round.presentation || !isChallengeGroupPresentation(round.presentation, round)) return round;
  const entries = round.presentation.entries.map((entry) => ({ ...entry, cursor: { ...entry.cursor,
    elapsedMs: source(round, round.turnEvidence[entry.turn - 1])!.plan.durationMs } }));
  return { ...round, presentation: { ...round.presentation, entries, index: entries.length } };
}

/** Read-only renderer/HUD projection of the featured actor's exact committed trace. */
export function challengeGroupPresentationRound(round: ChallengeGroupRound): PlayerPlayableRound | null {
  const featured = challengeGroupFeaturedShot(round);
  if (!featured) return null;
  const { golfer, shot, plan, entry } = featured;
  const scorecard = golfer.scorecard.map((score, index) => ({ holeId: score.holeId, name: golfer.setup.holes[index].name,
    par: score.par, strokes: score.strokes, penalties: score.penalties, complete: score.status !== "active" }));
  return { version: 1, id: round.id, kind: "friendly", handedness: golfer.handedness, phase: "flight",
    course: { ...round.course, holes: golfer.setup.holes, rating: golfer.setup.rating }, rulesSnapshot: round.rulesSnapshot,
    teeSet: golfer.setup.teeSet, pinRotation: golfer.setup.pinRotation,
    currentHoleIndex: golfer.setup.holes.findIndex((hole) => hole.id === shot.holeId), ball: shot.from, lie: shot.lieBefore,
    strokes: scorecard.reduce((sum, score) => sum + score.strokes, 0), penalties: scorecard.reduce((sum, score) => sum + score.penalties, 0),
    scorecard, shots: [...golfer.shots], pendingShot: shot, shotPresentation: { version: 1, shotId: shot.id, progress: entry.cursor.elapsedMs / plan.durationMs },
    rngSeed: round.rngSeed, rngCursor: round.rngCursor, autoPlay: golfer.controller === "ai", rewardsApplied: false,
    startedWeek: round.startedWeek, startedDay: round.startedDay };
}
