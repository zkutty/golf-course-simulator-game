import { completedPlayerShotCount, isValidTerminalCompletedShotCount, MAX_RETAINED_PLAYER_SHOTS } from "./completedShotCount";
import { isPlayerShotPresentation } from "./shotPlayback";
import { freezeProfileCalibration, isProfileCalibrationV1 } from "../rules/profileCalibration";
import type {
  Course,
  ObstacleType,
  Terrain,
  World,
} from "../models/types";
import {
  PLAYER_PRO_SKILLS,
  type PlayerCareerRound,
  type PlayerChallengeRecord,
  type PlayerPlayableRound,
  type PlayerProAppearance,
  type PlayerProBackground,
  type PlayerProCareer,
  type PlayerProHandedness,
  type PlayerProPoint,
  type PlayerProSkill,
  type PlayerProSkills,
  type PlayerRoundCourseSnapshot,
  type PlayerShotTechnique,
  type PlayerShotTrace,
  type PlayerSkillEvidence,
  type PlayerTournamentRecord,
} from "../models/playerProTypes";
import {
  normalizeBiomeKey,
  validateBiomeCompatibilityMetadata,
} from "../models/biomes";
import type { ClubSpec, GolferProfile } from "../sim/golferProfiles";
import { evalShotExpectedCost } from "../sim/shots/evalShotExpectedCost";
import { mulberry32 } from "../../utils/rng";
import { tournamentCalendar, TOURNAMENT_TIERS } from "../tournaments/tournaments";
import type { TournamentEvent, TournamentStanding } from "../tournaments/types";
import {
  isValidReliefResolution,
  isValidSharedShotOutcome,
  isValidShotRuling,
  type SharedShotOutcome,
  type ShotFlightProfile,
  type ShotLie,
} from "../rules/contracts";
import { decodeControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import {
  decodeGreenRoundSnapshot,
  withNormalizedGreenContract,
} from "../greens/greenSurface";
import { createSharedShotOutcome, resolveSharedRules } from "../rules/sharedOutcome";
import { prepareObstacleInput, resolveObstacleCollision, type FlightObstacle, type ObstacleCollisionResolution } from "../rules/obstacleCollision";
import {
  calculateShotEffects,
  type CalculatedShotEffects,
  type ShotClubId,
} from "../rules/shotEffects";
import { calculateShotStyleEffects, isShotStyleId, shotStyleForTechnique, SHOT_STYLES, type ShotStyleId, type ClubImpactV1 } from "../rules/shotStyles";
import { createRetainedShotMotion, isValidRetainedShotMotionV1 } from "../rules/shotMotion";
import { isValidShotModelSnapshot, usesClubShotModel } from "../rules/shotModelSnapshot";
import { BIVARIATE_DISPERSION_MODEL_VERSION, DISPERSION_CLUBS, dispersionClubIdForLabel } from "../rules/dispersionRegistry";
import {
  analyzeShotSlope,
  elevationAdjustedCarryYards,
  normalizeShotSlopeContext,
  resolveShotCurve,
  type ShotHandedness,
  type ShotSlopeContext,
} from "../models/shotSlope";
import {
  isValidGreenRollout,
  createGreenRolloutSurfaceSampler,
  createGreenRolloutHeightSampler,
  resolveGreenRollout,
  type GreenRolloutV1,
  type GreenRolloutSpin,
} from "../greens/greenRollout";
import {
  estimateAutomaticPutts,
  isValidGreenPutting,
  resolveAutomaticPutts,
  type GreenPuttingEstimate,
} from "../greens/greenPutting";
import {
  captureRoundHandicapSnapshot,
  createHandicapProfile,
  createHandicapScoreRecord,
  decodeRoundHandicapSnapshot,
  normalizeHandicapProfile,
  postCompletedHandicapRound,
} from "../competition/persistence";
import { defaultPlayerProInventory, normalizePlayerProInventory } from "./inventoryPersistence";
import { decodeChallengeGroupRound } from "../competition/challengeGroupRoundCodec";
import { decodePersistedChallengeRuntime } from "../competition/challengeRuntimePersistence";
import {
  applyRoundConfidence,
  confidenceAtDay,
  confidenceDispersionMultiplier,
  createPlayerConfidence,
  normalizePlayerConfidence,
  type PlayerConfidenceState,
} from "./confidence";
import { absoluteDayFor } from "../seasons/seasons";
import { createInvitationCalendar, normalizeInvitationCalendar } from "./invitations";
import {
  normalizePerformanceLoadoutSnapshot,
  normalizedMentorCareerFields,
  resolvePerformanceModifiers,
} from "../competition/equipmentRuntime";
import { normalizeShotEnvironmentV1, resolveAppliedShotWindV1 } from "../rules/shotEnvironment";
import { decodeDispersionRoundSnapshotV1 } from "../rules/dispersionSnapshot";
import { resolveBivariateDispersionShot, resolveBivariateDispersionRuntime, BIVARIATE_DISPERSION_CENTRAL_68_RADIUS } from "../rules/dispersionRuntime";

export { startPlayableRound } from "./playerProRoundStart";
export type { StartPlayableRoundArgs } from "./playerProRoundStart";

const DEFAULT_SKILL = 40;
const XP_PER_LEVEL = 12;
const MAX_HISTORY = 40;
const MAX_SHOTS = MAX_RETAINED_PLAYER_SHOTS;
const MAX_TRAINING = 80;

const preparedObstacleInputs = new WeakMap<PlayerRoundCourseSnapshot, readonly FlightObstacle[]>();

function obstacleInputFor(snapshot: PlayerRoundCourseSnapshot): readonly FlightObstacle[] {
  const cached = preparedObstacleInputs.get(snapshot);
  if (cached) return cached;
  const prepared = prepareObstacleInput(snapshot.obstacles.map((obstacle) => ({
    x: obstacle.x,
    y: obstacle.y,
    type: obstacle.type as ObstacleType,
  })));
  preparedObstacleInputs.set(snapshot, prepared);
  return prepared;
}

const TECHNIQUE_GATES: Record<Exclude<PlayerShotTechnique, "normal">, { skill: PlayerProSkill; value: number }> = {
  draw: { skill: "driving", value: 48 },
  fade: { skill: "irons", value: 48 },
  punch: { skill: "recovery", value: 46 },
  flop: { skill: "shortGame", value: 55 },
  backspin: { skill: "irons", value: 62 },
};

const CLUB_SKILLS: Readonly<Record<ShotClubId, PlayerProSkill>> = {
  driver: "driving", three_wood: "driving", five_iron: "irons", seven_iron: "irons",
  pitching_wedge: "shortGame", sand_wedge: "recovery", chip: "shortGame", putter: "putting",
};

const CLUBS: ReadonlyArray<ClubSpec & { skill: PlayerProSkill; lies: string[] }> = DISPERSION_CLUBS.map((club) => ({
  name: club.label,
  carryYards: club.carryYards,
  dispersionTilesBase: club.dispersionTiles,
  skill: CLUB_SKILLS[club.id],
  lies: [...club.allowedLies],
}));

export function shotClubIdForLabel(label: string): ShotClubId | null {
  return dispersionClubIdForLabel(label);
}

export function flightProfileForTechnique(
  technique: PlayerShotTechnique,
  requested?: ShotFlightProfile,
): ShotFlightProfile {
  if (requested) return requested;
  if (technique === "punch") return "low";
  if (technique === "flop") return "high";
  return "standard";
}

function shotLieForTerrain(lie: string): ShotLie {
  const supported: ShotLie[] = [
    "tee", "fairway", "rough", "deep_rough", "waste_area", "sand", "green",
    "path", "water", "wetland", "out_of_bounds",
  ];
  return supported.includes(lie as ShotLie) ? lie as ShotLie : "out_of_bounds";
}

function calculatePlayerShotEffects(args: {
  club: string;
  lie: string;
  recoverySkill: number;
  technique: PlayerShotTechnique;
  style?: ShotStyleId;
  flightProfile?: ShotFlightProfile;
}): { effects: CalculatedShotEffects; blocker: string | null } {
  const clubId = shotClubIdForLabel(args.club) ?? "pitching_wedge";
  const flightProfile = flightProfileForTechnique(args.technique, args.flightProfile);
  const result = calculateShotEffects({
    clubId,
    lie: shotLieForTerrain(args.lie),
    recoverySkill: args.recoverySkill,
    technique: args.technique,
    flightProfile,
  });
  if (result.ok) return { effects: result.value, blocker: null };

  // Preserve the legacy resolver's ability to record a physical attempt from
  // a hazard while the authoritative ZK-549 ruling layer is still pending.
  const neutral = calculateShotEffects({
    clubId,
    lie: "fairway",
    recoverySkill: args.recoverySkill,
    technique: args.technique,
    flightProfile,
  });
  if (neutral.ok) return { effects: neutral.value, blocker: result.blocker.code };
  const safe = calculateShotEffects({
    clubId,
    lie: "fairway",
    recoverySkill: args.recoverySkill,
    technique: "normal",
    flightProfile: "standard",
  });
  if (!safe.ok) throw new Error(`Unable to calculate shot effects: ${safe.blocker.message}`);
  return { effects: safe.value, blocker: result.blocker.code };
}

const BACKGROUND_BONUS: Record<PlayerProBackground, Partial<PlayerProSkills>> = {
  architect: { irons: 4, shortGame: 2 },
  operator: { recovery: 4, power: 2 },
  host: { putting: 4, driving: 2 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function point(value: unknown): value is PlayerProPoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PlayerProPoint;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function validActiveShotTrace(value: unknown): value is PlayerShotTrace {
  if (!value || typeof value !== "object") return false;
  const trace = value as PlayerShotTrace;
  if (
    typeof trace.id !== "string"
    || typeof trace.holeId !== "string"
    || !Number.isSafeInteger(trace.shotNumber)
    || trace.shotNumber < 1
    || typeof trace.club !== "string"
    || !["normal", "draw", "fade", "punch", "flop", "backspin"].includes(trace.technique)
    || (trace.shotStyle !== undefined && !isShotStyleId(trace.shotStyle))
    || (trace.flightProfile != null && !["low", "standard", "high"].includes(trace.flightProfile))
    || !Number.isFinite(trace.power)
    || !point(trace.from)
    || !point(trace.aim)
    || !point(trace.landing)
    || !point(trace.rest)
    || !Number.isFinite(trace.carryYards)
    || !Number.isFinite(trace.rollYards)
    || typeof trace.lieBefore !== "string"
    || typeof trace.lieAfter !== "string"
    || !Number.isSafeInteger(trace.penaltyStrokes)
    || trace.penaltyStrokes < 0
    || trace.penaltyStrokes > 1
    || typeof trace.holed !== "boolean"
    || !Number.isFinite(trace.seed)
    || !Array.isArray(trace.evidence)
  ) {
    return false;
  }
  if (trace.sharedOutcome != null && !isValidSharedShotOutcome(trace.sharedOutcome)) return false;
  if (trace.sharedOutcome?.appliedDispersion != null && (
    (trace.seed >>> 0) !== trace.sharedOutcome.appliedDispersion.seed
    || dispersionClubIdForLabel(trace.club) !== trace.sharedOutcome.appliedDispersion.clubId
  )) return false;
  const motion = trace.sharedOutcome?.motion;
  if (motion && (!isValidRetainedShotMotionV1(motion) || motion.identity.shotId !== trace.id
    || motion.identity.holeId !== trace.holeId || motion.identity.shotNumber !== trace.shotNumber
    || motion.identity.seed !== (trace.seed >>> 0) || motion.identity.club !== trace.club
    || motion.identity.style !== trace.shotStyle
    || (trace.sharedOutcome?.impact && (trace.sharedOutcome.impact.power !== trace.power
      || trace.sharedOutcome.impact.clubId !== dispersionClubIdForLabel(trace.club))))) return false;
  if (trace.shotSlope != null && !normalizeShotSlopeContext(trace.shotSlope)) return false;
  if (trace.greenRollout != null && !isValidGreenRollout(trace.greenRollout)) return false;
  if (trace.greenPutting != null && !isValidGreenPutting(trace.greenPutting)) return false;
  if (trace.ruling != null && !isValidShotRuling(trace.ruling)) return false;
  if (trace.relief != null && !isValidReliefResolution(trace.relief)) return false;
  if (trace.finalPosition != null && !point(trace.finalPosition)) return false;
  if (trace.ruling && trace.ruling.penaltyStrokes !== trace.penaltyStrokes) return false;
  return !trace.sharedOutcome
    || (
      trace.sharedOutcome.ruling.penaltyStrokes === trace.penaltyStrokes
      && trace.sharedOutcome.finalPosition.x === (trace.finalPosition ?? trace.rest).x
      && trace.sharedOutcome.finalPosition.y === (trace.finalPosition ?? trace.rest).y
    );
}

function baseSkills(background: PlayerProBackground): PlayerProSkills {
  const result = Object.fromEntries(PLAYER_PRO_SKILLS.map((skill) => [skill, DEFAULT_SKILL])) as PlayerProSkills;
  for (const [skill, amount] of Object.entries(BACKGROUND_BONUS[background]) as Array<[PlayerProSkill, number]>) {
    result[skill] += amount;
  }
  return result;
}

export function createDefaultPlayerPro(args: {
  seed: number;
  name?: string;
  appearance?: PlayerProAppearance;
  handedness?: PlayerProHandedness;
  background?: PlayerProBackground;
}): PlayerProCareer {
  const background = args.background ?? "architect";
  const skills = baseSkills(background);
  const identityId = `player-pro-${args.seed >>> 0}`;
  return {
    version: 1,
    identity: {
      id: identityId,
      name: args.name?.trim().slice(0, 30) || "Alex Green",
      appearance: args.appearance ?? "classic",
      handedness: args.handedness ?? "right",
      background,
    },
    skills,
    skillXp: Object.fromEntries(PLAYER_PRO_SKILLS.map((skill) => [skill, 0])) as PlayerProSkills,
    careerPoints: 0,
    unlockedTechniques: ["normal"],
    learnedTechniques: [],
    activeMentorTechniqueChallenge: null,
    mentorTechniqueChallenges: [],
    mentorTechniqueLedger: [],
    activeRound: null,
    activeChallengeGroupRound: null,
    activeChallengeRuntime: null,
    challengeSequence: 0,
    rounds: [],
    training: [],
    challenges: [],
    tournaments: [],
    trophies: [],
    earnings: 0,
    reputation: 0,
    settlementLedger: [],
    handicapProfile: createHandicapProfile(skills),
    confidence: createPlayerConfidence(),
    invitationCalendar: createInvitationCalendar(),
    ...defaultPlayerProInventory(identityId),
  };
}

function normalizeSkills(value: unknown, fallback: PlayerProSkills): PlayerProSkills {
  if (!value || typeof value !== "object") return { ...fallback };
  const candidate = value as Partial<PlayerProSkills>;
  return Object.fromEntries(PLAYER_PRO_SKILLS.map((skill) => [
    skill,
    clamp(finite(candidate[skill], fallback[skill]), 0, 100),
  ])) as PlayerProSkills;
}

function normalizeActiveRound(value: unknown): PlayerPlayableRound | null {
  if (!value || typeof value !== "object") return null;
  const round = value as PlayerPlayableRound;
  if (
    round.version !== 1
    || typeof round.id !== "string"
    || !round.course
    || !Array.isArray(round.course.holes)
    || round.course.holes.length < 1
  ) return null;
  if (!Array.isArray(round.course.tiles) || !Array.isArray(round.course.elevations) || round.course.tiles.length !== round.course.width * round.course.height) return null;
  if (!Number.isInteger(round.currentHoleIndex) || round.currentHoleIndex < 0 || round.currentHoleIndex >= round.course.holes.length) return null;
  if (!point(round.ball) || !Array.isArray(round.scorecard) || !Array.isArray(round.shots) || round.shots.length > MAX_SHOTS) return null;
  if (!["awaiting_shot", "flight", "hole_complete", "round_complete", "conceded"].includes(round.phase)) return null;
  if (round.rulesSnapshot != null && !decodeControlledRoundSnapshotV2(round.rulesSnapshot).ok) return null;
  if (round.course.shotModel !== undefined && !isValidShotModelSnapshot(round.course.shotModel)) return null;
  if (round.course.distanceProfile !== undefined && !isProfileCalibrationV1(round.course.distanceProfile)) return null;
  if (usesClubShotModel(round.course.shotModel) && !isProfileCalibrationV1(round.course.distanceProfile)) return null;
  const dispersionSnapshot = decodeDispersionRoundSnapshotV1(round.course.dispersionSnapshot);
  if (!dispersionSnapshot.ok) return null;
  const greenSnapshot = round.course.greenSnapshot == null
    ? null
    : decodeGreenRoundSnapshot(round.course.greenSnapshot, round.course);
  if (greenSnapshot && !greenSnapshot.ok) return null;
  if (round.shots.some((trace) => !validActiveShotTrace(trace))) return null;
  if (round.completedShotCount !== undefined && !isValidTerminalCompletedShotCount(round)) return null;
  if (round.phase === "flight" && (!round.pendingShot || !validActiveShotTrace(round.pendingShot))) return null;
  if (round.shotPresentation !== undefined && (!round.pendingShot || round.phase !== "flight"
    || !round.pendingShot.sharedOutcome?.motion || !isPlayerShotPresentation(round.shotPresentation, round.pendingShot.id))) return null;
  const theme = normalizeBiomeKey(round.course.theme);
  if (!theme) return null;
  const biomeCompatibility = validateBiomeCompatibilityMetadata(
    round.course.biomeCompatibility,
    theme,
  );
  if (!biomeCompatibility.ok) return null;
  const handicapSnapshot = round.handicapSnapshot == null
    ? undefined
    : decodeRoundHandicapSnapshot(round.handicapSnapshot);
  const confidenceSnapshot = round.confidenceSnapshot == null
    ? undefined
    : normalizePlayerConfidence(round.confidenceSnapshot);
  const performanceLoadout = normalizePerformanceLoadoutSnapshot(round.performanceLoadout);
  return {
    ...round,
    handedness: round.handedness === "left" ? "left" : "right",
    course: {
      ...round.course,
      theme,
      biomeCompatibility: biomeCompatibility.metadata,
      ...(greenSnapshot?.ok ? { greenSnapshot: greenSnapshot.value } : {}),
      greenDrainageLevel: clamp(Math.round(finite(round.course.greenDrainageLevel)), 0, 3),
      dispersionSnapshot: dispersionSnapshot.value,
      ...(round.course.weather ? {
        weather: {
          ...round.course.weather,
          environment: normalizeShotEnvironmentV1(round.course.weather.environment, round.course.weather.windMph),
        },
      } : {}),
    },
    strokes: Math.max(0, Math.floor(finite(round.strokes))),
    penalties: Math.max(0, Math.floor(finite(round.penalties))),
    rngCursor: Math.max(0, Math.floor(finite(round.rngCursor))),
    pendingShot: round.phase === "flight" && round.pendingShot ? round.pendingShot : null,
    rewardsApplied: round.rewardsApplied === true,
    autoPlay: round.autoPlay === true,
    shots: round.shots.slice(-MAX_SHOTS),
    ...(handicapSnapshot && !("code" in handicapSnapshot) ? { handicapSnapshot } : { handicapSnapshot: undefined }),
    ...(confidenceSnapshot ? { confidenceSnapshot } : {}),
    performanceLoadout,
  };
}

function normalizeCareerRound(value: unknown): PlayerCareerRound | null {
  if (!value || typeof value !== "object") return null;
  const round = value as PlayerCareerRound;
  if (typeof round.id !== "string" || !round.id || typeof round.courseId !== "string") return null;
  const handicapSnapshot = round.handicapSnapshot == null
    ? undefined
    : decodeRoundHandicapSnapshot(round.handicapSnapshot, `completed round ${round.id}.handicapSnapshot`);
  return {
    ...round,
    strokes: Math.max(0, Math.floor(finite(round.strokes))),
    penalties: Math.max(0, Math.floor(finite(round.penalties))),
    par: Math.max(0, Math.floor(finite(round.par))),
    scoreToPar: Math.floor(finite(round.scoreToPar)),
    earnings: finite(round.earnings),
    scorecard: Array.isArray(round.scorecard) ? round.scorecard : [],
    shots: Array.isArray(round.shots) ? round.shots.slice(-MAX_SHOTS).map((shot) => {
      if (shot.greenRollout == null || isValidGreenRollout(shot.greenRollout)) return shot;
      const { greenRollout: _discarded, ...legacy } = shot;
      return legacy;
    }) : [],
    evidence: Array.isArray(round.evidence) ? round.evidence : [],
    skillGains: round.skillGains && typeof round.skillGains === "object" ? round.skillGains : {},
    ...(handicapSnapshot && !("code" in handicapSnapshot) ? { handicapSnapshot } : { handicapSnapshot: undefined }),
  };
}

function normalizeTournamentRecord(value: unknown): PlayerTournamentRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as PlayerTournamentRecord;
  if (typeof record.id !== "string" || typeof record.eventId !== "string" || typeof record.name !== "string"
    || !["local", "regional", "championship"].includes(record.tier) || !["registered", "active", "complete", "withdrawn"].includes(record.status)) return null;
  const safeArray = <T>(candidate: unknown, predicate: (item: unknown) => item is T): T[] => Array.isArray(candidate) ? candidate.filter(predicate).slice(-4) : [];
  const boundedInteger = (candidate: unknown, min: number, max: number) => Number.isInteger(candidate) && (candidate as number) >= min && (candidate as number) <= max ? candidate as number : undefined;
  const hasRoundIds = record.roundIds !== undefined;
  const hasCompletedRounds = record.completedRounds !== undefined;
  const hasTotalRounds = record.totalRounds !== undefined;
  const hasCurrentRound = record.currentRound !== undefined;
  if (!hasRoundIds && !hasCompletedRounds && !hasTotalRounds && !hasCurrentRound) return record;
  const normalized = { ...record };
  if (hasRoundIds) normalized.roundIds = safeArray(record.roundIds, (id): id is string => typeof id === "string");
  if (hasCompletedRounds) normalized.completedRounds = safeArray(record.completedRounds, Number.isInteger as (item: unknown) => item is number);
  const totalRounds = boundedInteger(record.totalRounds, 1, 4);
  if (hasTotalRounds) normalized.totalRounds = totalRounds;
  if (hasCurrentRound) normalized.currentRound = boundedInteger(record.currentRound, 0, totalRounds ?? 4);
  return normalized;
}

export function normalizePlayerPro(raw: unknown, args: { seed: number; founderName?: string }): PlayerProCareer {
  const fallback = createDefaultPlayerPro({ seed: args.seed, name: args.founderName });
  if (!raw || typeof raw !== "object") return fallback;
  const candidate = raw as PlayerProCareer;
  const identity = candidate.identity && typeof candidate.identity === "object" ? candidate.identity : fallback.identity;
  const background: PlayerProBackground = identity.background === "operator" || identity.background === "host" ? identity.background : "architect";
  const skills = normalizeSkills(candidate.skills, baseSkills(background));
  const handicap = normalizeHandicapProfile(candidate.handicapProfile, skills);
  if (!handicap.ok) throw new Error(handicap.error.message);
  const xp = normalizeSkills(candidate.skillXp, Object.fromEntries(PLAYER_PRO_SKILLS.map((skill) => [skill, 0])) as PlayerProSkills);
  const techniques = (Array.isArray(candidate.unlockedTechniques) ? candidate.unlockedTechniques : ["normal"])
    .filter((value): value is PlayerShotTechnique => ["normal", "draw", "fade", "punch", "flop", "backspin"].includes(value))
    .filter((value, index, all) => all.indexOf(value) === index);
  if (!techniques.includes("normal")) techniques.unshift("normal");
  const normalizedActiveRound = normalizeActiveRound(candidate.activeRound);
  const decodedChallengeGroupRound = candidate.activeChallengeGroupRound == null
    ? null
    : decodeChallengeGroupRound(candidate.activeChallengeGroupRound);
  const activeChallengeGroupRound = decodedChallengeGroupRound?.ok
    ? decodedChallengeGroupRound.round
    : null;
  const activeRound = normalizedActiveRound && !normalizedActiveRound.handicapSnapshot
    ? {
        ...normalizedActiveRound,
        handicapSnapshot: captureRoundHandicapSnapshot({
          roundId: normalizedActiveRound.id,
          handicapIndex: handicap.profile.handicapIndex,
          confidence: handicap.profile.confidence,
          course: {
            id: normalizedActiveRound.course.courseId,
            name: normalizedActiveRound.course.courseName,
            geometryVersion: normalizedActiveRound.course.geometryVersion,
            teeSet: normalizedActiveRound.teeSet,
            pinRotation: normalizedActiveRound.pinRotation,
            rating: normalizedActiveRound.course.rating,
            holes: normalizedActiveRound.course.holes,
          },
          startedWeek: normalizedActiveRound.startedWeek,
          startedDay: normalizedActiveRound.startedDay,
        }),
        confidenceSnapshot: normalizedActiveRound.confidenceSnapshot ?? normalizePlayerConfidence(candidate.confidence),
      }
    : normalizedActiveRound && !normalizedActiveRound.confidenceSnapshot
      ? { ...normalizedActiveRound, confidenceSnapshot: normalizePlayerConfidence(candidate.confidence) }
      : normalizedActiveRound;
  const identityId = typeof identity.id === "string" && identity.id ? identity.id : fallback.identity.id;
  const mentorFields = normalizedMentorCareerFields(candidate);
  const { learnedTechniques } = mentorFields;
  const inventoryState = normalizePlayerProInventory(candidate, identityId);
  const decodedChallengeRuntime = candidate.activeChallengeRuntime == null
    ? null
    : decodePersistedChallengeRuntime(candidate.activeChallengeRuntime, { id: identityId, inventory: inventoryState.inventory });
  if (decodedChallengeRuntime && !decodedChallengeRuntime.ok) throw new Error(decodedChallengeRuntime.error);
  const activeChallengeRuntime = decodedChallengeRuntime?.ok ? decodedChallengeRuntime.state : null;
  const equipmentLoadout = inventoryState.equipmentLoadout.techniqueId && !learnedTechniques.includes(inventoryState.equipmentLoadout.techniqueId)
    ? { ...inventoryState.equipmentLoadout, techniqueId: undefined }
    : inventoryState.equipmentLoadout;
  return {
    version: 1,
    identity: {
      id: identityId,
      name: typeof identity.name === "string" && identity.name.trim() ? identity.name.trim().slice(0, 30) : fallback.identity.name,
      appearance: identity.appearance === "sport" || identity.appearance === "heritage" ? identity.appearance : "classic",
      handedness: identity.handedness === "left" ? "left" : "right",
      background,
    },
    skills,
    skillXp: xp,
    careerPoints: Math.max(0, Math.floor(finite(candidate.careerPoints))),
    unlockedTechniques: techniques,
    ...mentorFields,
    activeRound,
    activeChallengeGroupRound,
    activeChallengeRuntime,
    challengeSequence: Number.isSafeInteger(candidate.challengeSequence) && Number(candidate.challengeSequence) >= 0
      ? Math.floor(Number(candidate.challengeSequence))
      : Array.isArray(candidate.challenges) ? candidate.challenges.length : 0,
    rounds: Array.isArray(candidate.rounds)
      ? candidate.rounds.map(normalizeCareerRound).filter((round): round is PlayerCareerRound => round != null).slice(-MAX_HISTORY)
      : [],
    training: Array.isArray(candidate.training) ? candidate.training.slice(-MAX_TRAINING) : [],
    challenges: Array.isArray(candidate.challenges) ? candidate.challenges.slice(-30) : [],
    tournaments: Array.isArray(candidate.tournaments) ? candidate.tournaments.slice(-30).map(normalizeTournamentRecord).filter((record): record is PlayerTournamentRecord => Boolean(record)) : [],
    trophies: Array.isArray(candidate.trophies) ? candidate.trophies.slice(-40) : [],
    earnings: finite(candidate.earnings),
    reputation: clamp(finite(candidate.reputation), 0, 100),
    settlementLedger: Array.isArray(candidate.settlementLedger)
      ? candidate.settlementLedger.filter((entry): entry is string => typeof entry === "string").slice(-160)
      : [],
    handicapProfile: handicap.profile,
    confidence: normalizePlayerConfidence(candidate.confidence),
    invitationCalendar: normalizeInvitationCalendar(candidate.invitationCalendar),
    ...inventoryState,
    equipmentLoadout,
  };
}

function courseFromSnapshot(snapshot: PlayerRoundCourseSnapshot): Course {
  const course: Course = {
    width: snapshot.width,
    height: snapshot.height,
    tiles: snapshot.tiles as Terrain[],
    elevations: snapshot.elevations,
    holes: snapshot.holes.map((hole) => ({
      id: hole.id,
      name: hole.name,
      tee: hole.tee,
      green: hole.pin,
      waypoints: hole.waypoints,
      parMode: "MANUAL",
      parManual: hole.par as 3 | 4 | 5,
    })),
    layouts: [{
      id: snapshot.courseId,
      name: snapshot.courseName,
      draftHoleIds: snapshot.holes.map((hole) => hole.id),
      publishedHoleIds: snapshot.holes.map((hole) => hole.id),
      roundLength: snapshot.holes.length > 9 ? 18 : 9,
      state: "open",
      greenFee: 0,
      legacyPartial: snapshot.holes.length !== 9 && snapshot.holes.length !== 18,
    }],
    activeCourseId: snapshot.courseId,
    obstacles: snapshot.obstacles as Course["obstacles"],
    buildings: [],
    yardsPerTile: snapshot.yardsPerTile,
    name: snapshot.courseName,
    baseGreenFee: 0,
    condition: 1,
    theme: snapshot.theme,
    biomeCompatibility: snapshot.biomeCompatibility,
  };
  return withNormalizedGreenContract({
    ...course,
    greenSurface: snapshot.greenSnapshot?.surface,
    greenProgram: snapshot.greenSnapshot?.program,
    greenLocalState: snapshot.greenSnapshot?.localState,
  });
}

function lieAt(snapshot: PlayerRoundCourseSnapshot, pointValue: PlayerProPoint): string {
  // Controlled-round rules classify a coordinate by its containing tile.
  // Keep the playable lie on that same floor-based convention so a legal
  // ruling or relief position cannot become a neighboring penalty lie.
  const x = clamp(Math.floor(pointValue.x), 0, snapshot.width - 1);
  const y = clamp(Math.floor(pointValue.y), 0, snapshot.height - 1);
  return snapshot.tiles[y * snapshot.width + x] ?? "rough";
}

function skillForClub(club: string, lie: string): PlayerProSkill {
  if (lie === "sand" || lie === "deep_rough" || lie === "waste_area" || club === "Sand Wedge") return "recovery";
  return CLUBS.find((candidate) => candidate.name === club)?.skill ?? "irons";
}

function profileForPlayer(snapshot: PlayerRoundCourseSnapshot, skills: PlayerProSkills, club: ClubSpec): GolferProfile {
  const skill = skillForClub(club.name, "fairway");
  const value = skills[skill];
  const power = skills.power;
  return {
    name: value >= 70 ? "SCRATCH" : "BOGEY",
    yardsPerTile: snapshot.yardsPerTile,
    clubs: [{
      ...club,
      carryYards: (usesClubShotModel(snapshot.shotModel) && club.name !== "Putter"
        ? (snapshot.distanceProfile ?? freezeProfileCalibration(skills)).clubCarryYards[shotClubIdForLabel(club.name)!]
        : club.carryYards * (0.82 + power / 500)) * (snapshot.weather?.carryMultiplier ?? 1),
      dispersionTilesBase: club.dispersionTilesBase * (1.42 - value / 180) * (snapshot.weather?.dispersionMultiplier ?? 1),
    }],
    ratingMultipliers: {
      hazard: 1.35 - skills.recovery / 180,
      rough: 1.3 - skills.recovery / 200,
      deepRough: 1.55 - skills.recovery / 170,
      obstacle: 1.35 - skills.recovery / 190,
    },
  };
}

export function availablePlayerClubs(lie: string): Array<{ name: string; carryYards: number; skill: PlayerProSkill }> {
  return CLUBS.filter((club) => club.lies.includes(lie)).map((club) => ({
    name: club.name,
    carryYards: club.carryYards,
    skill: club.skill,
  }));
}

export function techniqueRequirement(technique: PlayerShotTechnique, skills: PlayerProSkills): string | null {
  if (technique === "normal") return null;
  const gate = TECHNIQUE_GATES[technique];
  return skills[gate.skill] >= gate.value ? null : `${gate.skill}:${gate.value}`;
}

export interface PlayerShotSelection {
  club: string;
  aim: PlayerProPoint;
  power: number;
  technique: PlayerShotTechnique;
  style?: ShotStyleId;
  flightProfile?: ShotFlightProfile;
}

export interface PlayerShotPreview {
  available: boolean;
  blocker: string | null;
  carryYards: number;
  targetYards: number;
  dispersionTiles: number;
  expectedPenalty: number;
  landingTerrain: string;
  risk: "low" | "medium" | "high";
  recommended: boolean;
  flightProfile: ShotFlightProfile;
  shotEffects?: CalculatedShotEffects;
  impact?: ClubImpactV1;
  expectedWind?: SharedShotOutcome["appliedWind"];
  /** Unseeded aiming geometry; the boundary represents the central 68% dispersion. */
  expectedFlight?: { from: PlayerProPoint; landing: PlayerProPoint; apexHeightYards: number; curveOffsetTiles: number; envelope: PlayerProPoint[] };
  /**
   * The exact M50 outcome that the next committed shot will retain. It is
   * deliberately resolved with the round's next seed so the direct-play
   * preview cannot drift from execution.
   */
  sharedOutcome: SharedShotOutcome | null;
  /** Exact M62 path paired with `sharedOutcome` for preview/commit parity. */
  greenRollout: GreenRolloutV1 | null;
  /** Planning-only, deliberately unseeded automatic-putt information. */
  automaticPuttingEstimate: GreenPuttingEstimate | null;
  /**
   * Frozen M61 evidence for this exact preview.  UI, caddie, and text-state
   * consumers must present this value instead of re-reading mutable terrain.
   */
  shotSlope: ShotSlopeContext | null;
}

function selectedShotEffects(snapshot: PlayerRoundCourseSnapshot, skills: PlayerProSkills, lie: string, selection: PlayerShotSelection, loadout?: PlayerPlayableRound["performanceLoadout"]) {
  const clubId = shotClubIdForLabel(selection.club) ?? "pitching_wedge";
  const styleId = selection.style ?? shotStyleForTechnique(clubId, selection.technique);
  const initialFlight = usesClubShotModel(snapshot.shotModel)
    ? SHOT_STYLES.find((style) => style.id === styleId)?.flightProfile ?? flightProfileForTechnique(selection.technique, selection.flightProfile)
    : flightProfileForTechnique(selection.technique, selection.flightProfile);
  const performance = resolvePerformanceModifiers(loadout, { clubId, lie, flightProfile: initialFlight });
  const legacy = calculatePlayerShotEffects({ club: selection.club, lie, recoverySkill: skills.recovery * performance.recovery,
    technique: selection.technique, flightProfile: initialFlight });
  if (!usesClubShotModel(snapshot.shotModel)) return { ...legacy, selection, impact: undefined as ClubImpactV1 | undefined };
  const styled = calculateShotStyleEffects({ clubId, lie: shotLieForTerrain(lie),
    style: styleId, power: selection.power,
    recoverySkill: clamp(skills.recovery * performance.recovery, 0, 100), shortGameSkill: skills.shortGame,
    spinCapabilityMultiplier: 1 / performance.spin,
    strikeQuality: .7 + skills[skillForClub(selection.club, lie)] / 333.333333,
    flightProfile: initialFlight });
  if (!styled.ok) return { ...legacy, blocker: styled.blocker.code, selection, impact: undefined as ClubImpactV1 | undefined };
  const effective = styled.value.effectiveSelection;
  const profile = snapshot.distanceProfile ?? freezeProfileCalibration(skills);
  const registryCarry = DISPERSION_CLUBS.find((candidate) => candidate.id === clubId)!.carryYards;
  const carry = clubId === "putter" ? styled.value.effects.carryYards
    : styled.value.effects.carryYards * profile.clubCarryYards[clubId] / registryCarry;
  return { effects: { ...styled.value.effects, carryYards: carry }, blocker: null,
    selection: { ...selection, technique: effective.technique, flightProfile: effective.flightProfile, power: effective.power },
    impact: styled.value.impact };
}

export function previewPlayableShot(round: PlayerPlayableRound, skills: PlayerProSkills, selection: PlayerShotSelection): PlayerShotPreview {
  const inputSelection = selection;
  const selected = selectedShotEffects(round.course, skills, round.lie, selection, round.performanceLoadout);
  selection = selected.selection;
  const club = CLUBS.find((candidate) => candidate.name === selection.club);
  const flightProfile = flightProfileForTechnique(selection.technique, selection.flightProfile);
  const clubId = shotClubIdForLabel(selection.club) ?? "pitching_wedge";
  const performance = resolvePerformanceModifiers(round.performanceLoadout, { clubId, lie: round.lie, flightProfile });
  const legacyCalculated = calculatePlayerShotEffects({
    club: selection.club,
    lie: round.lie,
    recoverySkill: clamp(skills.recovery * performance.recovery, 0, 100),
    technique: selection.technique,
    flightProfile,
  });
  const calculated = usesClubShotModel(round.course.shotModel) ? selected : legacyCalculated;
  const baseCarry = calculated.effects.carryYards * (usesClubShotModel(round.course.shotModel) ? 1 : 0.82 + skills.power / 500) * (round.course.weather?.carryMultiplier ?? 1) * performance.carry;
  const invalidAim = usesClubShotModel(round.course.shotModel) && (!point(selection.aim) || !Number.isFinite(selection.power)
    || selection.aim.x < 0 || selection.aim.y < 0 || selection.aim.x >= round.course.width || selection.aim.y >= round.course.height);
  if (!club || invalidAim) return {
    available: false,
    blocker: invalidAim ? "invalid_aim" : "unknown_club",
    carryYards: 0,
    targetYards: 0,
    dispersionTiles: 0,
    expectedPenalty: 0,
    landingTerrain: round.lie,
    risk: "high",
    recommended: false,
    flightProfile,
    shotEffects: calculated.effects,
    ...(selected.impact ? { impact: selected.impact } : {}),
    sharedOutcome: null,
    greenRollout: null,
    automaticPuttingEstimate: null,
    shotSlope: null,
  };
  if (!club.lies.includes(round.lie)) return {
    available: false,
    blocker: `lie:${round.lie}`,
    carryYards: baseCarry,
    targetYards: 0,
    dispersionTiles: 0,
    expectedPenalty: 0,
    landingTerrain: round.lie,
    risk: "high",
    recommended: false,
    flightProfile,
    shotEffects: calculated.effects,
    ...(selected.impact ? { impact: selected.impact } : {}),
    sharedOutcome: null,
    greenRollout: null,
    automaticPuttingEstimate: null,
    shotSlope: null,
  };
  const requirement = techniqueRequirement(selection.technique, skills);
  if (requirement) return {
    available: false,
    blocker: `technique:${requirement}`,
    carryYards: baseCarry,
    targetYards: 0,
    dispersionTiles: 0,
    expectedPenalty: 0,
    landingTerrain: round.lie,
    risk: "high",
    recommended: false,
    flightProfile,
    shotEffects: calculated.effects,
    ...(selected.impact ? { impact: selected.impact } : {}),
    sharedOutcome: null,
    greenRollout: null,
    automaticPuttingEstimate: null,
    shotSlope: null,
  };
  if (calculated.blocker) return {
    available: false,
    blocker: calculated.blocker,
    carryYards: baseCarry,
    targetYards: 0,
    dispersionTiles: 0,
    expectedPenalty: 0,
    landingTerrain: round.lie,
    risk: "high",
    recommended: false,
    flightProfile,
    shotEffects: calculated.effects,
    ...(selected.impact ? { impact: selected.impact } : {}),
    sharedOutcome: null,
    greenRollout: null,
    automaticPuttingEstimate: null,
    shotSlope: null,
  };
  const course = courseFromSnapshot(round.course);
  const profile = profileForPlayer(round.course, skills, club);
  const adjustedClub = profile.clubs[0];
  const aim = {
    x: clamp(Math.round(selection.aim.x), 0, round.course.width - 1),
    y: clamp(Math.round(selection.aim.y), 0, round.course.height - 1),
  };
  const evaluation = evalShotExpectedCost({
    course,
    from: round.ball,
    to: aim,
    golfer: profile,
    club: adjustedClub,
    handedness: round.handedness,
  });
  const obstacleClose = round.course.obstacles.some((obstacle) => Math.hypot(obstacle.x - round.ball.x, obstacle.y - round.ball.y) < 1.6);
  const obstructionPenalty = !usesClubShotModel(round.course.shotModel) && obstacleClose && selection.technique !== "punch" && club.name !== "Sand Wedge" && club.name !== "Chip" ? 0.65 : 0;
  const expectedPenalty = Math.max(0, evaluation.expectedShotCost - 1) + obstructionPenalty;
  const legacyPreviewDispersionTiles = calculated.effects.dispersionTiles
    * (1.42 - skills[skillForClub(club.name, round.lie)] / 180)
    * (round.course.weather?.dispersionMultiplier ?? 1)
    * confidenceDispersionMultiplier(round.confidenceSnapshot)
    * (obstructionPenalty > 0 ? 1.55 : 1)
    * performance.dispersion;
  const previewDispersionAuthority = decodeDispersionRoundSnapshotV1(round.course.dispersionSnapshot);
  const dispersionTiles = previewDispersionAuthority.ok && previewDispersionAuthority.value.mode === "bivariate_v1"
    ? calculated.effects.dispersionTiles
      * (round.course.weather?.dispersionMultiplier ?? 1)
      * confidenceDispersionMultiplier(round.confidenceSnapshot)
      * (obstructionPenalty > 0 ? 1.55 : 1)
      * performance.dispersion
    : legacyPreviewDispersionTiles;
  if (usesClubShotModel(round.course.shotModel)) {
    const shotSlope = analyzeShotSlope({ course: round.course, from: round.ball, to: selection.aim,
      yardsPerTile: round.course.yardsPerTile, handedness: round.handedness });
    const targetTiles = Math.hypot(selection.aim.x - round.ball.x, selection.aim.y - round.ball.y);
    const available = point(selection.aim) && Number.isFinite(selection.power) && targetTiles > 1e-9;
    const unweatheredCarry = calculated.effects.carryYards * selection.power * performance.carry;
    const wind = resolveAppliedShotWindV1({ environment: normalizeShotEnvironmentV1(round.course.weather?.environment, round.course.weather?.windMph ?? 0),
      from: round.ball, to: selection.aim, weatherCarryMultiplier: round.course.weather?.carryMultiplier ?? 1,
      requestedCarryYards: unweatheredCarry, yardsPerTile: round.course.yardsPerTile, isPutter: club.name === "Putter" });
    const carryYards = unweatheredCarry * (wind?.carryMultiplier ?? round.course.weather?.carryMultiplier ?? 1);
    const distance = Math.min(targetTiles, elevationAdjustedCarryYards(carryYards, shotSlope) / round.course.yardsPerTile);
    const ux = targetTiles > 1e-9 ? (selection.aim.x - round.ball.x) / targetTiles : 1;
    const uy = targetTiles > 1e-9 ? (selection.aim.y - round.ball.y) / targetTiles : 0;
    const curve = resolveShotCurve({ shotSlope, shotLengthTiles: distance, club: club.name, technique: selection.technique }).combinedCurveTiles;
    const runtime = resolveBivariateDispersionRuntime({ clubId, effectiveDispersionTiles: Math.max(.05, dispersionTiles),
      accuracy: skills[skillForClub(club.name, round.lie)], consistency: skills[skillForClub(club.name, round.lie)],
      centerlineLateralTiles: curve, appliedWind: wind });
    const lateral = runtime.ok ? runtime.value.centerline.lateralTiles : curve + (wind?.lateralCenterlineTiles ?? 0);
    const landing = { x: round.ball.x + ux * distance - uy * lateral, y: round.ball.y + uy * distance + ux * lateral };
    const envelope: PlayerProPoint[] = [];
    if (runtime.ok) {
      const covariance = runtime.value.covariance;
      const a = Math.sqrt(covariance.longitudinalVariance);
      const b = a > 1e-9 ? covariance.covariance / a : 0;
      const c = Math.sqrt(Math.max(0, covariance.lateralVariance - b * b));
      for (let i = 0; i <= 32; i++) {
        const angle = i * Math.PI / 16;
        const longitudinal = BIVARIATE_DISPERSION_CENTRAL_68_RADIUS * a * Math.cos(angle);
        const side = BIVARIATE_DISPERSION_CENTRAL_68_RADIUS * (b * Math.cos(angle) + c * Math.sin(angle));
        envelope.push({ x: landing.x + ux * longitudinal - uy * side, y: landing.y + uy * longitudinal + ux * side });
      }
    }
    const expected = evalShotExpectedCost({ course, from: round.ball, to: landing, golfer: profile, club: adjustedClub, handedness: round.handedness });
    const penalty = Number.isFinite(expected.expectedShotCost) ? Math.max(0, expected.expectedShotCost - 1) : 3;
    return { available, blocker: available ? null : "invalid_aim", carryYards, targetYards: targetTiles * round.course.yardsPerTile,
      dispersionTiles, expectedPenalty: penalty, landingTerrain: lieAt(round.course, landing),
      risk: penalty > .75 ? "high" : penalty > .25 ? "medium" : "low",
      recommended: available && Math.abs(carryYards - targetTiles * round.course.yardsPerTile) < 35 && penalty < .35,
      flightProfile, shotEffects: calculated.effects, impact: selected.impact, ...(wind ? { expectedWind: wind } : {}), sharedOutcome: null, greenRollout: null,
      automaticPuttingEstimate: null, shotSlope,
      ...(available ? { expectedFlight: { from: { ...round.ball }, landing, apexHeightYards: calculated.effects.flight.apexHeightYards,
        curveOffsetTiles: clamp(-curve * .5, -8, 8), envelope } } : {}) };
  }
  const resolved = evaluation.isValid
    ? resolvePlayableShot({
      snapshot: round.course,
      rulesSnapshot: round.rulesSnapshot,
      holeId: round.course.holes[round.currentHoleIndex].id,
      shotNumber: round.scorecard[round.currentHoleIndex].strokes + 1,
      from: round.ball,
      lie: round.lie,
      skills,
      selection: inputSelection,
      handedness: round.handedness,
      confidenceSnapshot: round.confidenceSnapshot,
      performanceLoadout: round.performanceLoadout,
      seed: round.rngSeed + round.rngCursor * 104729,
    })
    : null;
  const sharedOutcome = resolved?.sharedOutcome ?? null;
  const automaticPuttingEstimate = resolved && !resolved.holed && resolved.lieAfter === "green"
    ? (() => {
      const pin = round.course.holes[round.currentHoleIndex].pin;
      const leaveDistanceYards = Math.hypot(resolved.rest.x - pin.x, resolved.rest.y - pin.y) * round.course.yardsPerTile;
      const puttingPerformance = resolvePerformanceModifiers(round.performanceLoadout, { clubId: "putter", lie: "green", flightProfile: "standard", leaveDistanceYards });
      return estimateAutomaticPutts({
      snapshot: round.course,
      holeId: round.course.holes[round.currentHoleIndex].id,
      rest: resolved.rest,
      rollout: resolved.greenRollout,
      skills: { ...skills, putting: clamp(skills.putting * puttingPerformance.putting, 0, 100) },
      });
    })()
    : null;
  return {
    available: evaluation.isValid,
    blocker: evaluation.isValid ? null : "unreachable",
    carryYards: sharedOutcome?.appliedWind ? sharedOutcome.requestedCarryYards : baseCarry * clamp(selection.power, 0.25, 1.15),
    targetYards: evaluation.distanceYards,
    dispersionTiles,
    expectedPenalty,
    landingTerrain: lieAt(round.course, aim),
    risk: expectedPenalty > 0.75 ? "high" : expectedPenalty > 0.25 ? "medium" : "low",
    recommended: Math.abs((sharedOutcome?.appliedWind ? sharedOutcome.requestedCarryYards : baseCarry * clamp(selection.power, 0.25, 1.15)) - evaluation.distanceYards) < 35 && expectedPenalty < 0.35,
    flightProfile,
    shotEffects: calculated.effects,
    ...(selected.impact ? { impact: selected.impact } : {}),
    sharedOutcome,
    greenRollout: resolved?.greenRollout ?? null,
    automaticPuttingEstimate,
    shotSlope: resolved?.shotSlope ?? null,
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function roundedPoint(value: PlayerProPoint): PlayerProPoint {
  return { x: Number(value.x.toFixed(3)), y: Number(value.y.toFixed(3)) };
}

export function resolvePlayableShot(args: {
  snapshot: PlayerRoundCourseSnapshot;
  rulesSnapshot?: unknown;
  holeId: string;
  shotNumber: number;
  from: PlayerProPoint;
  lie: string;
  skills: PlayerProSkills;
  selection: PlayerShotSelection;
  handedness?: ShotHandedness;
  /** Frozen Player Pro confidence; omitted callers intentionally use neutral. */
  confidenceSnapshot?: PlayerConfidenceState;
  /** Frozen ZK-730 equipment and learned-technique authority. */
  performanceLoadout?: PlayerPlayableRound["performanceLoadout"];
  /** Live callers carry their persisted consistency through this shared seam. */
  dispersionConsistency?: number;
  seed: number;
}): PlayerShotTrace {
  if (usesClubShotModel(args.snapshot.shotModel) && (!CLUBS.some((club) => club.name === args.selection.club)
    || !point(args.from) || !point(args.selection.aim) || !Number.isFinite(args.selection.power)
    || args.selection.aim.x < 0 || args.selection.aim.y < 0 || args.selection.aim.x >= args.snapshot.width || args.selection.aim.y >= args.snapshot.height)) {
    throw new Error("Invalid modern shot selection");
  }
  const selected = selectedShotEffects(args.snapshot, args.skills, args.lie, args.selection, args.performanceLoadout);
  if (usesClubShotModel(args.snapshot.shotModel) && selected.blocker) throw new Error(`Unavailable shot style: ${selected.blocker}`);
  args = { ...args, selection: selected.selection };
  const club = CLUBS.find((candidate) => candidate.name === args.selection.club) ?? CLUBS[4];
  const flightProfile = flightProfileForTechnique(args.selection.technique, args.selection.flightProfile);
  const clubId = shotClubIdForLabel(club.name) ?? "pitching_wedge";
  const performance = resolvePerformanceModifiers(args.performanceLoadout, { clubId, lie: args.lie, flightProfile });
  const legacyCalculated = calculatePlayerShotEffects({
    club: club.name,
    lie: args.lie,
    recoverySkill: clamp(args.skills.recovery * performance.recovery, 0, 100),
    technique: args.selection.technique,
    flightProfile,
  });
  const calculated = usesClubShotModel(args.snapshot.shotModel) ? selected : legacyCalculated;
  const course = courseFromSnapshot(args.snapshot);
  const profile = profileForPlayer(args.snapshot, args.skills, club);
  const adjustedClub = profile.clubs[0];
  const power = clamp(args.selection.power, 0.25, 1.15);
  const dx = args.selection.aim.x - args.from.x;
  const dy = args.selection.aim.y - args.from.y;
  const aimDistance = Math.max(0.001, Math.hypot(dx, dy));
  const ux = dx / aimDistance;
  const uy = dy / aimDistance;
  const obstacleClose = args.snapshot.obstacles.some((obstacle) => Math.hypot(obstacle.x - args.from.x, obstacle.y - args.from.y) < 1.6);
  const obstructionPenalty = !usesClubShotModel(args.snapshot.shotModel) && obstacleClose && args.selection.technique !== "punch" && club.name !== "Sand Wedge" && club.name !== "Chip";
  const weatherCarry = args.snapshot.weather?.carryMultiplier ?? 1;
  const powerScale = usesClubShotModel(args.snapshot.shotModel) ? 1 : 0.82 + args.skills.power / 500;
  const unweatheredCarryYards = calculated.effects.carryYards * powerScale * power * performance.carry;
  const appliedWind = resolveAppliedShotWindV1({
    environment: normalizeShotEnvironmentV1(args.snapshot.weather?.environment, args.snapshot.weather?.windMph ?? 0),
    from: args.from,
    to: args.selection.aim,
    weatherCarryMultiplier: weatherCarry,
    requestedCarryYards: unweatheredCarryYards,
    yardsPerTile: args.snapshot.yardsPerTile,
    isPutter: club.name === "Putter",
  });
  // Preserve the pre-Wave-1 operand order bit-for-bit for scalar saves.
  const requestedCarryYards = appliedWind
    ? unweatheredCarryYards * appliedWind.carryMultiplier
    : calculated.effects.carryYards * powerScale * weatherCarry * power * performance.carry;
  const nominalPhysicalCarryYards = requestedCarryYards * (obstructionPenalty ? 0.78 : 1);
  const shotSlope = analyzeShotSlope({
    course: args.snapshot,
    from: args.from,
    to: args.selection.aim,
    yardsPerTile: args.snapshot.yardsPerTile,
    handedness: args.handedness,
  });
  const maxTiles = elevationAdjustedCarryYards(nominalPhysicalCarryYards, shotSlope) / args.snapshot.yardsPerTile;
  const intendedTiles = Math.min(aimDistance, maxTiles);
  const evaluation = evalShotExpectedCost({ course, from: args.from, to: args.selection.aim, golfer: profile, club: adjustedClub, shotSlope });
  const clubSkill = args.skills[skillForClub(club.name, args.lie)];
  const weatherDispersion = args.snapshot.weather?.dispersionMultiplier ?? 1;
  const dispersionAuthority = decodeDispersionRoundSnapshotV1(args.snapshot.dispersionSnapshot);
  if (!dispersionAuthority.ok) throw new Error(`Invalid dispersion snapshot: ${dispersionAuthority.reason}`);
  // Keep the scalar's historical multiplication and RNG inputs entirely
  // isolated. In bivariate mode the old club-skill scalar is never a base.
  const legacyDispersion = dispersionAuthority.value.mode === "legacy_scalar"
    ? Math.max(
      0.12,
      calculated.effects.dispersionTiles
        * (1.42 - clubSkill / 180)
        * weatherDispersion
        * confidenceDispersionMultiplier(args.confidenceSnapshot)
        * (obstructionPenalty ? 1.55 : 1)
        * performance.dispersion,
    )
    : 0;
  const bivariateDispersion = dispersionAuthority.value.mode === "bivariate_v1"
    ? Math.max(
      .05,
      calculated.effects.dispersionTiles
        * weatherDispersion
        * confidenceDispersionMultiplier(args.confidenceSnapshot)
        * (obstructionPenalty ? 1.55 : 1)
        * performance.dispersion,
    )
    : 0;
  const dispersion = dispersionAuthority.value.mode === "bivariate_v1" ? bivariateDispersion : legacyDispersion;
  const curve = resolveShotCurve({
    shotSlope,
    shotLengthTiles: intendedTiles,
    club: club.name,
    technique: args.selection.technique,
  }).combinedCurveTiles;
  let appliedDispersion: SharedShotOutcome["appliedDispersion"];
  let landing: PlayerProPoint;
  if (dispersionAuthority.value.mode === "bivariate_v1") {
    // This is the sole bivariate resolve/sample. The existing shot seed is
    // deliberately reused so preview, commit, replay, and live agree.
    const resolved = resolveBivariateDispersionShot({
      clubId,
      effectiveDispersionTiles: bivariateDispersion,
      accuracy: clubSkill,
      consistency: args.dispersionConsistency ?? clubSkill,
      centerlineLateralTiles: curve,
      appliedWind,
    }, args.seed);
    if (!resolved) throw new Error("Invalid bivariate dispersion");
    const { sample } = resolved;
    landing = {
      x: args.from.x + ux * (intendedTiles + sample.landing.longitudinalTiles) - uy * sample.landing.lateralTiles,
      y: args.from.y + uy * (intendedTiles + sample.landing.longitudinalTiles) + ux * sample.landing.lateralTiles,
    };
    appliedDispersion = {
      version: 1,
      mode: "bivariate_v1",
      modelVersion: BIVARIATE_DISPERSION_MODEL_VERSION,
      clubId,
      seed: args.seed >>> 0,
      effectiveDispersionTiles: resolved.resolvedFrom.effectiveDispersionTiles,
      accuracy: resolved.resolvedFrom.accuracy,
      consistency: resolved.resolvedFrom.consistency,
      centerlineLongitudinalTiles: resolved.centerline.longitudinalTiles,
      centerlineLateralInputTiles: resolved.resolvedFrom.centerlineLateralTiles,
      centerlineLateralTiles: resolved.centerline.lateralTiles,
      appliedWindLateralTiles: resolved.appliedWindLateralTiles,
      sample: {
        isTail: sample.isTail,
        mahalanobisRadius: sample.mahalanobisRadius,
        longitudinalTiles: sample.offset.longitudinalTiles,
        lateralTiles: sample.offset.lateralTiles,
      },
    };
  } else {
    // Isolated legacy path: preserve RNG call order and scalar arithmetic.
    const rng = mulberry32(args.seed | 0);
    const lateral = gaussian(rng) * legacyDispersion * 0.42;
    const longitudinal = gaussian(rng) * legacyDispersion * 0.22;
    landing = {
      x: args.from.x + ux * (intendedTiles + longitudinal) - uy * (lateral + curve + (appliedWind?.lateralCenterlineTiles ?? 0)),
      y: args.from.y + uy * (intendedTiles + longitudinal) + ux * (lateral + curve + (appliedWind?.lateralCenterlineTiles ?? 0)),
    };
  }
  const newModel = usesClubShotModel(args.snapshot.shotModel);
  if (newModel) landing = roundedPoint(landing);
  const frozenHeight = createGreenRolloutHeightSampler(course, course.greenSurface);
  const heightAt = (point: PlayerProPoint) => frozenHeight(point) * 2.5;
  const physicalFlight: ObstacleCollisionResolution | null = newModel && club.name !== "Putter"
    ? resolveObstacleCollision({ from: args.from, to: landing,
        flight: { profile: flightProfile, apexHeightYards: calculated.effects.flight.apexHeightYards,
          curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: clamp(-curve * .5, -8, 8) || 0 } },
        endpointHeightsYards: { from: heightAt(args.from), to: heightAt(landing) }, terrainHeightAtYards: heightAt,
        width: args.snapshot.width, height: args.snapshot.height, yardsPerTile: args.snapshot.yardsPerTile,
        elevations: args.snapshot.elevations, tiles: args.snapshot.tiles as Terrain[],
        obstacles: obstacleInputFor(args.snapshot), obstaclesAreStable: true, retainGeometry: true }) : null;
  if (physicalFlight && physicalFlight.collision.kind !== "none") landing = { ...physicalFlight.collision.point };
  const outside = landing.x < 0 || landing.y < 0 || landing.x >= args.snapshot.width || landing.y >= args.snapshot.height;
  const rawLanding = { ...landing };
  landing = {
    x: clamp(landing.x, 0, args.snapshot.width - 1),
    y: clamp(landing.y, 0, args.snapshot.height - 1),
  };
  const landingTerrain = outside ? "out_of_play" : lieAt(args.snapshot, landing);
  const legacyHazard = outside || landingTerrain === "water" || landingTerrain === "wetland";
  const hasFrozenRules = args.rulesSnapshot !== undefined || args.snapshot.rulesSnapshot !== undefined;
  const hole = args.snapshot.holes.find((candidate) => candidate.id === args.holeId) ?? args.snapshot.holes[0];
  if (!hole) throw new Error(`Unknown hole ${args.holeId}`);
  const rolloutLanding = club.name === "Putter" ? { ...args.from } : rawLanding;
  const rolloutDx = club.name === "Putter" ? rawLanding.x - args.from.x : ux;
  const rolloutDy = club.name === "Putter" ? rawLanding.y - args.from.y : uy;
  const rolloutLength = Math.hypot(rolloutDx, rolloutDy);
  const rolloutDirection = rolloutLength > 1e-9
    ? { x: rolloutDx / rolloutLength, y: rolloutDy / rolloutLength }
    : { x: ux, y: uy };
  const stoppedAtContact = newModel && (physicalFlight?.collision.kind !== "none" && physicalFlight !== null
    || ["water", "wetland", "out_of_play"].includes(landingTerrain));
  const requestedRollYards = stoppedAtContact ? 0 : club.name === "Putter"
    ? Math.hypot(rawLanding.x - args.from.x, rawLanding.y - args.from.y) * args.snapshot.yardsPerTile
    : calculated.effects.rolloutYards * (newModel ? 1 : performance.spin);
  const spin: GreenRolloutSpin = args.selection.technique === "backspin"
    ? "backspin"
    : args.selection.technique === "draw"
      ? "draw"
      : args.selection.technique === "fade"
        ? "fade"
        : "neutral";
  const greenRollout = resolveGreenRollout({
    course: {
      ...course,
      holes: course.holes.map((candidate) => ({ id: candidate.id, green: candidate.green })),
    },
    holeId: args.holeId,
    landing: rolloutLanding,
    direction: rolloutDirection,
    requestedRollYards,
    yardsPerTile: args.snapshot.yardsPerTile,
    club: club.name,
    sourceLie: args.lie,
    launchAngleDegrees: calculated.effects.flight.launchAngleDegrees,
    landingAngleDegrees: selected.impact?.landingAngleDegrees ?? (club.name === "Putter" ? 0 : clamp(18 + calculated.effects.flight.launchAngleDegrees * 0.75, 0, 70)),
    ...(selected.impact ? { impact: selected.impact } : {}),
    trajectory: flightProfile,
    spin,
    weather: args.snapshot.weather,
    drainageLevel: args.snapshot.greenDrainageLevel,
    seed: args.seed,
  });
  const rawRest = greenRollout.rest;
  const puttingSkill = clamp(args.skills.putting * performance.putting, 0, 100);
  const cupRadius = club.name === "Putter" ? 0.42 + puttingSkill / 240 : 0.22;
  const physicalHoled = (hasFrozenRules || !legacyHazard) && rawRest.x >= 0 && rawRest.y >= 0
    && rawRest.x < args.snapshot.width && rawRest.y < args.snapshot.height
    && Math.hypot(rawRest.x - hole.pin.x, rawRest.y - hole.pin.y) <= cupRadius;
  const rules = resolveSharedRules({
    rulesSnapshot: args.rulesSnapshot ?? args.snapshot.rulesSnapshot,
    holeId: args.holeId,
    hole: hole.pin,
    previousPosition: args.from,
    physicalRest: rawRest,
    rollPath: greenRollout.path,
    clubLengthTiles: club.carryYards / Math.max(1, args.snapshot.yardsPerTile),
    holed: physicalHoled,
    legacyPenaltyStrokes: hasFrozenRules ? 0 : (legacyHazard ? 1 : 0),
  });
  const finalPosition = rules.finalPosition;
  const rest = {
    x: clamp(finalPosition.x, 0, args.snapshot.width - 1),
    y: clamp(finalPosition.y, 0, args.snapshot.height - 1),
  };
  const holed = rules.ruling.status === "holed";
  const finalInBounds = finalPosition.x >= 0 && finalPosition.y >= 0
    && finalPosition.x < args.snapshot.width && finalPosition.y < args.snapshot.height;
  const lieAfter = holed ? "cup" : finalInBounds ? lieAt(args.snapshot, rest) : "out_of_bounds";
  const demonstratedSkill = skillForClub(club.name, args.lie);
  const successful = rules.ruling.penaltyStrokes === 0
    && (lieAfter === "green" || lieAfter === "cup" || evaluation.expectedShotCost < 1.55);
  const evidence: PlayerSkillEvidence[] = [{
    id: `evidence-${args.holeId}-${args.shotNumber}-${demonstratedSkill}`,
    skill: demonstratedSkill,
    amount: successful ? 3 : 1,
    reason: `${club.name}:${args.lie}->${lieAfter}`,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    successful,
  }];
  if (club.name === "Driver" && successful) evidence.push({
    id: `evidence-${args.holeId}-${args.shotNumber}-power`,
    skill: "power",
    amount: 2,
    reason: `carry:${Math.round(intendedTiles * args.snapshot.yardsPerTile)}`,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    successful: true,
  });
  const trace: PlayerShotTrace = {
    id: `shot-${args.holeId}-${args.shotNumber}`,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    club: club.name,
    technique: args.selection.technique,
    ...(newModel ? { shotStyle: selected.impact!.style } : {}),
    flightProfile,
    power,
    from: newModel ? { ...args.from } : roundedPoint(args.from),
    aim: roundedPoint(args.selection.aim),
    landing: newModel ? { ...greenRollout.landing } : roundedPoint(rolloutLanding),
    rest: newModel ? { ...rest } : roundedPoint(rest),
    carryYards: Number((Math.hypot(landing.x - args.from.x, landing.y - args.from.y) * args.snapshot.yardsPerTile).toFixed(1)),
    rollYards: greenRollout.rollYards,
    lieBefore: args.lie,
    lieAfter,
    penaltyStrokes: rules.ruling.penaltyStrokes,
    holed,
    seed: args.seed,
    evidence,
    shotSlope,
    greenRollout,
    ruling: rules.ruling,
    relief: rules.relief,
    finalPosition: { ...finalPosition },
  };
  if (!trace.holed && trace.lieAfter === "green") {
    const leaveDistanceYards = Math.hypot(trace.rest.x - hole.pin.x, trace.rest.y - hole.pin.y) * args.snapshot.yardsPerTile;
    const automaticPuttingPerformance = resolvePerformanceModifiers(args.performanceLoadout, { clubId: "putter", lie: "green", flightProfile: "standard", leaveDistanceYards });
    trace.greenPutting = resolveAutomaticPutts({
      snapshot: args.snapshot,
      holeId: args.holeId,
      rest: trace.rest,
      rollout: greenRollout,
      skills: { ...args.skills, putting: clamp(args.skills.putting * automaticPuttingPerformance.putting, 0, 100) },
      // A distinct deterministic stream prevents a putt result from changing
      // any already-resolved flight result when the putting model evolves.
      seed: (args.seed ^ 0x640a77) >>> 0,
    });
  }
  trace.sharedOutcome = createSharedShotOutcome({
    trace,
    effects: calculated.effects,
    requestedCarryYards,
    requestedDispersionTiles: dispersion,
    physicalRest: rawRest,
    ruling: rules.ruling,
    relief: rules.relief,
    finalPosition,
    ...(appliedWind ? { appliedWind } : {}),
    ...(appliedDispersion ? { appliedDispersion } : {}),
    ...(physicalFlight ? { resolvedObstacle: physicalFlight } : {}),
    ...(selected.impact ? { impact: selected.impact } : {}),
    obstacleCollision: {
      width: args.snapshot.width,
      height: args.snapshot.height,
      yardsPerTile: args.snapshot.yardsPerTile,
      elevations: args.snapshot.elevations,
      tiles: args.snapshot.tiles as readonly Terrain[],
      obstacles: obstacleInputFor(args.snapshot),
      obstaclesAreStable: true,
    },
  });
  if (newModel) {
    const at = (point: PlayerProPoint) => ({ point: { ...point }, heightYards: heightAt(point) });
    const retainedFlight = physicalFlight?.retained ?? null;
    const sourceImpact = physicalFlight && retainedFlight
      ? physicalFlight.samples[retainedFlight.endSampleIndex] : null;
    const contactPath = sourceImpact && retainedFlight?.collision.kind !== "none"
      ? [{ point: { ...sourceImpact.point }, heightYards: sourceImpact.pathHeightYards }, at(greenRollout.landing)] : [];
    const motion = createRetainedShotMotion({
      identity: { shotId: trace.id, holeId: trace.holeId, shotNumber: trace.shotNumber, seed: trace.seed >>> 0,
        club: trace.club, style: trace.shotStyle!, modelVersion: "club_styles_v1" },
      yardsPerTile: args.snapshot.yardsPerTile, from: at(args.from), landing: at(greenRollout.landing),
      physicalRest: at(rawRest), rollPath: greenRollout.path.map(at), flight: retainedFlight,
      ...(contactPath.length ? { postCollisionPath: contactPath } : {}),
      reliefPosition: rules.relief.status === "resolved" ? finalPosition : null, holed: physicalHoled,
      facts: { launchAngleDegrees: calculated.effects.flight.launchAngleDegrees,
        landingAngleDegrees: selected.impact?.landingAngleDegrees ?? null, spin },
    });
    if (!motion) throw new Error("Unable to retain coherent committed shot motion");
    trace.sharedOutcome.motion = motion;
  }
  return trace;
}

export function commitPlayerShot(round: PlayerPlayableRound, skills: PlayerProSkills, selection: PlayerShotSelection): PlayerPlayableRound {
  if (round.phase !== "awaiting_shot") return round;
  const preview = previewPlayableShot(round, skills, selection);
  if (!preview.available) return round;
  const hole = round.course.holes[round.currentHoleIndex];
  const trace = resolvePlayableShot({
    snapshot: round.course,
    rulesSnapshot: round.rulesSnapshot,
    holeId: hole.id,
    shotNumber: round.scorecard[round.currentHoleIndex].strokes + 1,
    from: round.ball,
    lie: round.lie,
    skills,
    selection,
    handedness: round.handedness,
    confidenceSnapshot: round.confidenceSnapshot,
    performanceLoadout: round.performanceLoadout,
    seed: round.rngSeed + round.rngCursor * 104729,
  });
  return {
    ...round,
    phase: "flight",
    pendingShot: trace,
    ...(trace.sharedOutcome?.motion ? { shotPresentation: { version: 1 as const, shotId: trace.id, progress: 0 } } : {}),
    rngCursor: round.rngCursor + 1,
  };
}

export function finishPlayerShot(round: PlayerPlayableRound): PlayerPlayableRound {
  if (round.phase !== "flight" || !round.pendingShot) return round;
  const trace = round.pendingShot;
  const automaticPutts = trace.greenPutting?.putts ?? 0;
  const scorecard = round.scorecard.map((hole, index) => index === round.currentHoleIndex ? {
    ...hole,
    strokes: hole.strokes + 1 + automaticPutts,
    penalties: hole.penalties + trace.penaltyStrokes,
    complete: trace.holed || automaticPutts > 0,
  } : hole);
  return {
    ...round,
    phase: trace.holed || automaticPutts > 0 ? "hole_complete" : "awaiting_shot",
    ball: trace.rest,
    lie: trace.lieAfter,
    strokes: round.strokes + 1 + automaticPutts,
    penalties: round.penalties + trace.penaltyStrokes,
    scorecard,
    shots: [...round.shots, trace].slice(-MAX_SHOTS),
    pendingShot: null,
    ...(round.shotPresentation ? { shotPresentation: undefined } : {}),
  };
}

export function advancePlayerRound(round: PlayerPlayableRound): PlayerPlayableRound {
  if (round.phase !== "hole_complete") return round;
  if (round.currentHoleIndex >= round.course.holes.length - 1) {
    return { ...round, phase: "round_complete" };
  }
  const nextIndex = round.currentHoleIndex + 1;
  return {
    ...round,
    phase: "awaiting_shot",
    currentHoleIndex: nextIndex,
    ball: { ...round.course.holes[nextIndex].tee },
    lie: "tee",
  };
}

function recommendedSelection(round: PlayerPlayableRound, skills: PlayerProSkills): PlayerShotSelection {
  const hole = round.course.holes[round.currentHoleIndex];
  if (usesClubShotModel(round.course.shotModel)) {
    // Deliberately unseeded: compare expected centerlines, never resolve a
    // committed shot or inspect the round's next random sample.
    const clubs = availablePlayerClubs(round.lie);
    const fallback: PlayerShotSelection = { club: clubs[0]?.name ?? "Pitching Wedge", aim: { ...hole.pin }, power: 1, technique: "normal" };
    if (!clubs.length) return fallback;
    const course = courseFromSnapshot(round.course);
    const sampleSurface = createGreenRolloutSurfaceSampler(course, course.greenSurface);
    const heightAt = (at: PlayerProPoint) => sampleSurface(at).height * 2.5;
    const rules = round.rulesSnapshot ?? round.course.rulesSnapshot;
    const decoded = rules ? decodeControlledRoundSnapshotV2(rules) : null;
    const legal = (at: PlayerProPoint) => at.x >= 0 && at.y >= 0 && at.x < round.course.width && at.y < round.course.height
      && (!decoded?.ok || decoded.value.inBounds[Math.floor(at.y) * round.course.width + Math.floor(at.x)]);
    const fullCarry = new Map(clubs.map((club) => [club.name,
      selectedShotEffects(round.course, skills, round.lie, { ...fallback, club: club.name }, round.performanceLoadout).effects.carryYards
        * (round.course.weather?.carryMultiplier ?? 1)]));
    const candidates: PlayerShotSelection[] = [];
    const add = (club: string, aim: PlayerProPoint, technique: PlayerShotTechnique = "normal", flightProfile: ShotFlightProfile = "standard") => {
      if (techniqueRequirement(technique, skills)) return;
      const selection = { club, aim: { x: clamp(aim.x, 0, round.course.width - 1), y: clamp(aim.y, 0, round.course.height - 1) }, power: 1, technique, flightProfile };
      const selected = selectedShotEffects(round.course, skills, round.lie, selection, round.performanceLoadout);
      if (selected.blocker) return;
      const slope = analyzeShotSlope({ course: round.course, from: round.ball, to: selection.aim, yardsPerTile: round.course.yardsPerTile, handedness: round.handedness });
      selection.power = Number(clamp(slope.playsLikeDistanceYards / Math.max(1, selected.effects.carryYards * (round.course.weather?.carryMultiplier ?? 1)), .25, 1).toFixed(6));
      candidates.push(selection);
    };
    const distanceToPin = Math.hypot(hole.pin.x - round.ball.x, hole.pin.y - round.ball.y);
    const ordered = [...clubs].sort((a, b) => Math.abs(fullCarry.get(a.name)! - distanceToPin * round.course.yardsPerTile)
      - Math.abs(fullCarry.get(b.name)! - distanceToPin * round.course.yardsPerTile));
    for (const club of ordered) add(club.name, hole.pin);
    const flightClubs = ordered.filter((club) => club.name !== "Putter" && club.name !== "Chip").slice(0, 2);
    for (const club of flightClubs) {
      add(club.name, hole.pin, "normal", "high");
      add(club.name, hole.pin, "punch", "low");
    }
    const dx = hole.pin.x - round.ball.x;
    const dy = hole.pin.y - round.ball.y;
    const length = Math.max(.001, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const nearby = round.course.obstacles.filter((obstacle) => {
      const along = clamp(((obstacle.x - round.ball.x) * dx + (obstacle.y - round.ball.y) * dy) / Math.max(.001, length * length), 0, 1);
      return Math.hypot(obstacle.x - round.ball.x - dx * along, obstacle.y - round.ball.y - dy * along) < 1.5;
    }).sort((a, b) => Math.hypot(a.x - round.ball.x, a.y - round.ball.y) - Math.hypot(b.x - round.ball.x, b.y - round.ball.y)).slice(0, 2);
    const recoveryClub = clubs.find((club) => club.name === "Chip") ?? clubs.find((club) => club.name === "Pitching Wedge") ?? ordered[0];
    for (const obstacle of nearby) {
      for (const side of [-1, 1]) add(recoveryClub.name, { x: obstacle.x + ux - uy * side * 2.5, y: obstacle.y + uy + ux * side * 2.5 });
      const awayX = round.ball.x - obstacle.x;
      const awayY = round.ball.y - obstacle.y;
      const awayLength = Math.hypot(awayX, awayY);
      if (awayLength < 1.2) {
        const ax = awayLength > .001 ? awayX / awayLength : -ux;
        const ay = awayLength > .001 ? awayY / awayLength : -uy;
        const escapeTiles = Math.max(2, Math.min(4, length));
        for (const angle of [0, -.8, .8]) add(recoveryClub.name,
          { x: round.ball.x + (ax * Math.cos(angle) - ay * Math.sin(angle)) * escapeTiles,
            y: round.ball.y + (ax * Math.sin(angle) + ay * Math.cos(angle)) * escapeTiles });
      }
    }
    // A radial escape can point off the property when a ball is beside an
    // edge. Include a bounded fan of legal sideways/interior recoveries and
    // a lofted wedge whose retained roll does not force that escape back out.
    const edgeDistance = Math.min(round.ball.x, round.ball.y,
      round.course.width - 1 - round.ball.x, round.course.height - 1 - round.ball.y);
    if (edgeDistance < 2 || nearby.some((obstacle) => Math.hypot(obstacle.x - round.ball.x, obstacle.y - round.ball.y) < 1.2)) {
      const loftedRecovery = clubs.find((club) => club.name === "Sand Wedge") ?? clubs.find((club) => club.name === "Pitching Wedge");
      for (const distance of [2, 4]) for (let direction = 0; direction < 8; direction += 1) {
        const angle = direction * Math.PI / 4;
        const aim = { x: round.ball.x + Math.cos(angle) * distance, y: round.ball.y + Math.sin(angle) * distance };
        add(recoveryClub.name, aim);
        if (loftedRecovery && loftedRecovery.name !== recoveryClub.name) add(loftedRecovery.name, aim, "normal", "high");
      }
    }
    let best = fallback;
    let bestScore = Infinity;
    for (const selection of candidates) {
      const preview = previewPlayableShot(round, skills, selection);
      if (!preview.available || !preview.expectedFlight || !preview.impact || !preview.shotEffects) continue;
      const expected = preview.expectedFlight;
      const isPutter = selection.club === "Putter";
      // The caddie consumes collision identity, not distant clearance evidence.
      // This hull encloses the entire curve plus every obstacle volume radius.
      const margin = Math.abs(expected.curveOffsetTiles) + .9;
      const minX = Math.min(round.ball.x, expected.landing.x) - margin;
      const maxX = Math.max(round.ball.x, expected.landing.x) + margin;
      const minY = Math.min(round.ball.y, expected.landing.y) - margin;
      const maxY = Math.max(round.ball.y, expected.landing.y) + margin;
      const flightObstacles = obstacleInputFor(round.course).filter((obstacle) =>
        obstacle.x >= minX && obstacle.x <= maxX && obstacle.y >= minY && obstacle.y <= maxY);
      const flight = resolveObstacleCollision({ from: round.ball, to: expected.landing,
        flight: { profile: preview.flightProfile, apexHeightYards: expected.apexHeightYards,
          curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: expected.curveOffsetTiles } },
        endpointHeightsYards: { from: heightAt(round.ball), to: heightAt(expected.landing) }, terrainHeightAtYards: heightAt,
        width: round.course.width, height: round.course.height, yardsPerTile: round.course.yardsPerTile,
        elevations: round.course.elevations, tiles: round.course.tiles as Terrain[], obstacles: flightObstacles,
        obstaclesAreStable: true, retainGeometry: true });
      const blocked = flight != null && flight.collision.kind !== "none";
      const landing = blocked ? flight.collision.kind !== "none" ? flight.collision.point : expected.landing : expected.landing;
      const travelX = expected.landing.x - round.ball.x;
      const travelY = expected.landing.y - round.ball.y;
      const travelLength = Math.max(.001, Math.hypot(travelX, travelY));
      const rollout = resolveGreenRollout({ course, holeId: hole.id, landing: isPutter ? round.ball : landing,
        direction: { x: travelX / travelLength, y: travelY / travelLength },
        requestedRollYards: blocked ? 0 : isPutter ? travelLength * round.course.yardsPerTile : preview.impact.forwardRollPotentialYards,
        yardsPerTile: round.course.yardsPerTile, club: selection.club, sourceLie: round.lie,
        launchAngleDegrees: preview.impact.launchAngleDegrees, landingAngleDegrees: preview.impact.landingAngleDegrees,
        trajectory: preview.flightProfile, spin: selection.technique === "backspin" ? "backspin" : "neutral", impact: preview.impact,
        weather: round.course.weather, drainageLevel: round.course.greenDrainageLevel,
        // This solver uses seed only as retained metadata, not for sampling.
        seed: 0 });
      const rest = rollout.rest;
      const remaining = Math.hypot(rest.x - hole.pin.x, rest.y - hole.pin.y) * round.course.yardsPerTile;
      const terrain = rollout.lieAfter;
      const hazard = !legal(rest) || ["water", "wetland", "out_of_bounds"].includes(terrain);
      const moved = Math.hypot(rest.x - round.ball.x, rest.y - round.ball.y);
      const clearance = nearby.reduce((minimum, obstacle) => Math.min(minimum, Math.hypot(rest.x - obstacle.x, rest.y - obstacle.y)), Infinity);
      const score = remaining + preview.dispersionTiles * round.course.yardsPerTile * .12 + preview.expectedPenalty * 40
        + (blocked ? 500 : 0) + (hazard ? 2000 : 0) + (moved < .15 && length > 1 ? 300 : 0)
        + (clearance < .8 ? (.8 - clearance) * 30 : 0);
      if (score < bestScore) { best = selection; bestScore = score; }
    }
    return best;
  }
  const shotSlope = analyzeShotSlope({
    course: round.course,
    from: round.ball,
    to: hole.pin,
    yardsPerTile: round.course.yardsPerTile,
    handedness: round.handedness,
  });
  const distance = shotSlope.playsLikeDistanceYards;
  const clubs = availablePlayerClubs(round.lie);
  const powerScale = 0.82 + skills.power / 500;
  const club = [...clubs].sort((a, b) => Math.abs(a.carryYards * powerScale - distance) - Math.abs(b.carryYards * powerScale - distance))[0] ?? clubs[0];
  return {
    club: club?.name ?? "Pitching Wedge",
    aim: { ...hole.pin },
    power: clamp(distance / Math.max(1, (club?.carryYards ?? 115) * powerScale), 0.35, 1),
    technique: "normal",
  };
}

export function autoFinishPlayerRound(
  round: PlayerPlayableRound,
  skills: PlayerProSkills,
  onCompletedShot?: (roundAfterFinish: PlayerPlayableRound) => void,
): PlayerPlayableRound {
  let next = round.phase === "flight" ? finishPlayerShot(round) : round;
  if (next !== round) onCompletedShot?.(next);
  let guard = 0;
  while (next.phase !== "round_complete" && next.phase !== "conceded" && guard++ < 260) {
    if (next.phase === "hole_complete") {
      next = advancePlayerRound(next);
      continue;
    }
    if (next.phase === "awaiting_shot") {
      next = commitPlayerShot(next, skills, recommendedSelection(next, skills));
      if (next.phase !== "flight") break;
      next = finishPlayerShot(next);
      onCompletedShot?.(next);
    }
  }
  return next;
}

export function concedePlayerRound(round: PlayerPlayableRound): PlayerPlayableRound {
  if (round.phase === "round_complete" || round.phase === "conceded") return round;
  const completedShotCount = completedPlayerShotCount(round);
  return { ...round, phase: "conceded", pendingShot: null,
    ...(completedShotCount === null ? {} : { completedShotCount }),
    ...(round.shotPresentation ? { shotPresentation: undefined } : {}) };
}

function scoreToPar(round: PlayerPlayableRound): number {
  const playedPar = round.scorecard.filter((hole) => hole.complete).reduce((sum, hole) => sum + hole.par, 0);
  return round.strokes + round.penalties - playedPar;
}

function unlockTechniques(skills: PlayerProSkills): PlayerShotTechnique[] {
  return [
    "normal",
    ...(Object.entries(TECHNIQUE_GATES) as Array<[Exclude<PlayerShotTechnique, "normal">, { skill: PlayerProSkill; value: number }]>)
      .filter(([, gate]) => skills[gate.skill] >= gate.value)
      .map(([technique]) => technique),
  ];
}

function projectedOpponentStrokes(round: PlayerPlayableRound, skill: number, salt: number): number {
  const par = round.scorecard.reduce((sum, hole) => sum + hole.par, 0);
  const rng = mulberry32(round.rngSeed ^ salt);
  const handicap = Math.round((1 - clamp(skill, 0, 1)) * round.scorecard.length * 1.15);
  return Math.max(round.scorecard.length, par + handicap + Math.floor(rng() * 5) - 2);
}

export interface PlayerRoundSettlement {
  career: PlayerProCareer;
  cashDelta: number;
  reputationDelta: number;
  round: PlayerCareerRound | null;
  tournamentEvent?: TournamentEvent;
}

export function settlePlayerRound(career: PlayerProCareer, round: PlayerPlayableRound, event?: TournamentEvent): PlayerRoundSettlement {
  const ledgerId = `round:${round.id}`;
  if ((round.phase !== "round_complete" && round.phase !== "conceded") || career.settlementLedger.includes(ledgerId)) {
    return { career, cashDelta: 0, reputationDelta: 0, round: null };
  }
  const evidence = round.shots.flatMap((shot) => shot.evidence);
  const skillXp = { ...career.skillXp };
  const skills = { ...career.skills };
  const skillGains: Partial<PlayerProSkills> = {};
  for (const skill of PLAYER_PRO_SKILLS) {
    const relevant = evidence.filter((item) => item.skill === skill);
    let awarded = 0;
    relevant.forEach((item, index) => {
      awarded += item.amount * (item.successful ? 1 : 0.35) / (1 + index * 0.2);
    });
    awarded = Math.min(18, awarded);
    const beforeLevel = Math.floor(skillXp[skill] / XP_PER_LEVEL);
    skillXp[skill] += awarded;
    const afterLevel = Math.floor(skillXp[skill] / XP_PER_LEVEL);
    const gain = Math.max(0, Math.min(100 - skills[skill], afterLevel - beforeLevel));
    if (gain > 0) {
      skills[skill] += gain;
      skillGains[skill] = gain;
    }
  }
  const totalPar = round.scorecard.reduce((sum, hole) => sum + hole.par, 0);
  let result: PlayerCareerRound["result"] = round.phase === "conceded" ? "conceded" : "complete";
  let cashDelta = 0;
  let reputationDelta = 0;
  let opponentStrokes: number | undefined;
  if (round.opponent) {
    opponentStrokes = round.opponent.projectedStrokes || projectedOpponentStrokes(round, round.opponent.skill, round.opponent.id.length);
    const playerTotal = round.strokes + round.penalties;
    result = round.phase === "conceded" || playerTotal > opponentStrokes ? "lost" : playerTotal < opponentStrokes ? "won" : "tied";
    cashDelta = round.kind === "wager" ? (result === "won" ? round.opponent.wager : result === "lost" ? -round.opponent.wager : 0) : 0;
    reputationDelta = result === "won" ? 1 : 0;
  }
  let tournamentRecord: PlayerTournamentRecord | undefined;
  let tournamentEvent: TournamentEvent | undefined;
  let trophy = null;
  if (event && round.tournamentId === event.id) {
    const playerTotal = round.strokes + round.penalties;
    const existingPlayer = event.field.some((entrant) => entrant.id === career.identity.id);
    const eligibleOpponents = event.field.filter((entrant) => entrant.id !== career.identity.id);
    const opponents = existingPlayer ? eligibleOpponents : eligibleOpponents.slice(0, Math.max(0, event.field.length - 1));
    const playerEntrant = {
      id: career.identity.id,
      name: career.identity.name,
      archetype: "pro" as const,
      skill: PLAYER_PRO_SKILLS.reduce((sum, skill) => sum + career.skills[skill], 0) / PLAYER_PRO_SKILLS.length / 100,
    };
    const standings: TournamentStanding[] = opponents.map((entrant, index) => {
      const score = projectedOpponentStrokes(round, entrant.skill, index * 977 + entrant.id.length);
      return {
        entrantId: entrant.id,
        golferId: null,
        name: entrant.name,
        archetype: entrant.archetype,
        holesCompleted: round.scorecard.length,
        score,
        scoreToPar: score - totalPar,
        finished: true,
      };
    });
    standings.push({
      entrantId: playerEntrant.id,
      golferId: null,
      name: playerEntrant.name,
      archetype: playerEntrant.archetype,
      holesCompleted: round.scorecard.filter((hole) => hole.complete).length,
      score: playerTotal,
      scoreToPar: playerTotal - totalPar,
      finished: round.phase === "round_complete",
    });
    standings.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.scoreToPar !== b.scoreToPar) return a.scoreToPar - b.scoreToPar;
      if (a.holesCompleted !== b.holesCompleted) return b.holesCompleted - a.holesCompleted;
      return a.name.localeCompare(b.name);
    });
    const finish = standings.findIndex((standing) => standing.entrantId === playerEntrant.id) + 1;
    const field = [...opponents, playerEntrant];
    tournamentEvent = {
      ...event,
      field,
      status: "completed",
      results: standings,
      winnerName: standings[0]?.name,
    };
    const prizeShare = finish === 1 ? 1 : finish <= 3 ? 0.45 : finish <= Math.ceil(field.length / 2) ? 0.12 : 0;
    const prize = Math.round(event.revenueAward * prizeShare);
    cashDelta += prize;
    reputationDelta += finish === 1 ? event.reputationAward : finish <= 3 ? Math.ceil(event.reputationAward / 2) : 0;
    result = finish === 1 ? "won" : "complete";
    tournamentRecord = {
      id: `pro-event-${event.id}`,
      eventId: event.id,
      name: event.name,
      tier: event.tier,
      status: "complete",
      roundId: round.id,
      finish,
      fieldSize: field.length,
      prize,
      settled: true,
    };
    if (finish === 1) trophy = {
      id: `trophy-${event.id}`,
      name: event.name,
      courseId: round.course.courseId,
      courseName: round.course.courseName,
      week: round.startedWeek,
      tournamentId: event.id,
    };
  }
  const careerRound: PlayerCareerRound = {
    id: round.id,
    kind: round.kind,
    courseId: round.course.courseId,
    courseName: round.course.courseName,
    week: round.startedWeek,
    strokes: round.strokes,
    penalties: round.penalties,
    par: totalPar,
    scoreToPar: scoreToPar(round),
    result,
    opponentId: round.opponent?.id,
    opponentName: round.opponent?.name,
    tournamentId: round.tournamentId,
    tournamentName: round.tournamentName,
    earnings: cashDelta,
    scorecard: round.scorecard.map((hole) => ({ ...hole })),
    shots: round.shots.map((shot) => ({
      ...shot,
      from: { ...shot.from },
      aim: { ...shot.aim },
      landing: { ...shot.landing },
      rest: { ...shot.rest },
      evidence: shot.evidence.map((item) => ({ ...item })),
      greenRollout: shot.greenRollout ? structuredClone(shot.greenRollout) : undefined,
      greenPutting: shot.greenPutting ? { ...shot.greenPutting } : undefined,
    })),
    evidence,
    skillGains,
    rulesSnapshot: round.rulesSnapshot,
    handicapSnapshot: round.handicapSnapshot,
  };
  const challenges = career.challenges.map((challenge) => challenge.roundId === round.id ? {
    ...challenge,
    status: "complete" as const,
    result: result === "won" || result === "lost" || result === "tied" || result === "conceded" ? result : "tied",
    relationship: clamp(challenge.relationship + (result === "won" ? 2 : result === "lost" ? 1 : 0), -100, 100),
    settled: true,
  } : challenge);
  const tournaments = tournamentRecord
    ? [...career.tournaments.filter((record) => record.eventId !== tournamentRecord!.eventId), tournamentRecord]
    : career.tournaments;
  const completionDay = absoluteDayFor(round.completedWeek ?? round.startedWeek, round.startedDay);
  let confidence = confidenceAtDay(career.confidence, completionDay);
  const handicapProfile = round.handicapSnapshot
    ? (() => {
        const score = createHandicapScoreRecord(round.handicapSnapshot, {
          roundId: round.id,
          completedWeek: round.completedWeek ?? round.startedWeek,
          completedDay: round.startedDay,
          conceded: round.phase === "conceded",
          source: round.kind === "tournament"
            ? "tournament"
            : round.kind === "friendly" || round.kind === "wager"
              ? "challenge"
              : round.kind === "exhibition"
                ? "practice"
                : "casual",
          scorecard: round.scorecard,
        });
        confidence = applyRoundConfidence(confidence, {
          indexBefore: round.handicapSnapshot.handicapIndex,
          differential: score.evidence.differential,
          conceded: round.phase === "conceded",
        });
        return postCompletedHandicapRound(career.handicapProfile, score);
      })()
    : career.handicapProfile;
  const settledCareer: PlayerProCareer = {
      ...career,
      skills,
      skillXp,
      unlockedTechniques: unlockTechniques(skills),
      careerPoints: career.careerPoints + Math.max(1, round.scorecard.filter((hole) => hole.complete).length) + (result === "won" ? 4 : 0),
      activeRound: null,
      rounds: [...career.rounds, careerRound].slice(-MAX_HISTORY),
      challenges,
      tournaments,
      trophies: trophy ? [...career.trophies, trophy].slice(-40) : career.trophies,
      earnings: career.earnings + cashDelta,
      reputation: clamp(career.reputation + reputationDelta, 0, 100),
      settlementLedger: [...career.settlementLedger, ledgerId].slice(-160),
      handicapProfile,
      confidence,
  };
  return {
    cashDelta,
    reputationDelta,
    round: careerRound,
    tournamentEvent,
    career: settledCareer,
  };
}

export interface PlayerTrainingOption {
  id: string;
  facilityId: string;
  facilityName: string;
  tier: number;
  skill: PlayerProSkill;
  cost: number;
  minutes: number;
  available: boolean;
  blocker: string | null;
}

export interface PlayerOpponent {
  id: string;
  name: string;
  skill: number;
  relationship: number;
}

export function createPlayerChallenge(career: PlayerProCareer, opponent: PlayerOpponent, kind: "friendly" | "wager", wager = 100): { career: PlayerProCareer; challenge: PlayerChallengeRecord } {
  const id = `challenge-${opponent.id}-${career.challenges.length + 1}`;
  const challenge: PlayerChallengeRecord = {
    id,
    opponentId: opponent.id,
    opponentName: opponent.name,
    kind,
    status: "offered",
    relationship: opponent.relationship,
    wager: kind === "wager" ? clamp(Math.round(wager), 25, 500) : 0,
  };
  return { challenge, career: { ...career, challenges: [...career.challenges, challenge].slice(-30) } };
}

export function activatePlayerChallenge(career: PlayerProCareer, challengeId: string, roundId: string): PlayerProCareer {
  return {
    ...career,
    challenges: career.challenges.map((challenge) => challenge.id === challengeId
      ? { ...challenge, status: "active", roundId }
      : challenge),
  };
}

export function currentPlayerTournament(world: World, id?: string): TournamentEvent | undefined {
  if (!id) return undefined;
  return tournamentCalendar(world).events.find((event) => event.id === id);
}

export function caddieRecommendation(round: PlayerPlayableRound, skills: PlayerProSkills): PlayerShotSelection {
  return recommendedSelection(round, skills);
}

/**
 * A caddie line is presentation of the same seeded Player Pro preview that
 * commit uses.  It deliberately carries no independent elevation, sidehill,
 * curve, or risk formula.
 */
export function caddieShotGuidance(round: PlayerPlayableRound, skills: PlayerProSkills): Readonly<{
  selection: PlayerShotSelection;
  preview: PlayerShotPreview;
  shotSlope: ShotSlopeContext | null;
}> {
  const selection = caddieRecommendation(round, skills);
  const preview = previewPlayableShot(round, skills, selection);
  return Object.freeze({ selection, preview, shotSlope: preview.shotSlope });
}

export function playerTournamentPrizePreview(event: TournamentEvent): string {
  const spec = TOURNAMENT_TIERS[event.tier];
  return `${spec.revenueAward}:${spec.reputationAward}`;
}
