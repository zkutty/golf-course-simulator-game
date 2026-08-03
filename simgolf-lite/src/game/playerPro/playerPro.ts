import type {
  Course,
  ObstacleType,
  Terrain,
  World,
  TeeSet,
  PinRotation,
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
  type PlayerRoundKind,
  type PlayerShotTechnique,
  type PlayerShotTrace,
  type PlayerSkillEvidence,
  type PlayerTournamentRecord,
  type PlayerTrainingRecord,
} from "../models/playerProTypes";
import {
  biomeCompatibilityMetadataFor,
  getBiomeDefinition,
  normalizeBiomeKey,
  validateBiomeCompatibilityMetadata,
} from "../models/biomes";
import { courseGeometryVersion } from "../livingClub/livingClub";
import type { ClubSpec, GolferProfile } from "../sim/golferProfiles";
import { evalShotExpectedCost } from "../sim/shots/evalShotExpectedCost";
import { activeCourseLayout, courseForLayout, layoutById } from "../models/courseLayouts";
import { getParSetting, resolveCourseSetup } from "../models/courseSetup";
import { computeAutoPar } from "../sim/holeMetrics";
import { mulberry32 } from "../../utils/rng";
import { tournamentCalendar, TOURNAMENT_TIERS } from "../tournaments/tournaments";
import type { TournamentEvent, TournamentStanding, TournamentTier } from "../tournaments/types";
import { activeWeather, seasonalState, weatherModifiers } from "../seasons/seasons";
import { effectiveSurfaceTiles } from "../conditions/surfaceCare";
import { isOwnedTile } from "../estate/estate";
import {
  isValidReliefResolution,
  isValidSharedShotOutcome,
  isValidShotRuling,
  type SharedShotOutcome,
  type ShotFlightProfile,
  type ShotLie,
} from "../rules/contracts";
import { classifyPenaltyAreaComponents } from "../rules/penaltyAreas";
import { createControlledRoundSnapshotV2, decodeControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import {
  createGreenRoundSnapshot,
  decodeGreenRoundSnapshot,
  withNormalizedGreenContract,
} from "../greens/greenSurface";
import { createSharedShotOutcome, resolveSharedRules } from "../rules/sharedOutcome";
import { prepareObstacleInput, type FlightObstacle } from "../rules/obstacleCollision";
import {
  calculateShotEffects,
  type CalculatedShotEffects,
  type ShotClubId,
} from "../rules/shotEffects";
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

const DEFAULT_SKILL = 40;
const XP_PER_LEVEL = 12;
const MAX_HISTORY = 40;
const MAX_SHOTS = 240;
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

const CLUBS: ReadonlyArray<ClubSpec & { skill: PlayerProSkill; lies: string[] }> = [
  { name: "Driver", carryYards: 270, dispersionTilesBase: 3.7, skill: "driving", lies: ["tee", "fairway"] },
  { name: "3 Wood", carryYards: 235, dispersionTilesBase: 3.2, skill: "driving", lies: ["tee", "fairway", "rough"] },
  { name: "5 Iron", carryYards: 185, dispersionTilesBase: 2.55, skill: "irons", lies: ["tee", "fairway", "rough", "waste_area"] },
  { name: "7 Iron", carryYards: 155, dispersionTilesBase: 2.1, skill: "irons", lies: ["tee", "fairway", "rough", "waste_area", "sand"] },
  { name: "Pitching Wedge", carryYards: 115, dispersionTilesBase: 1.55, skill: "shortGame", lies: ["tee", "fairway", "rough", "deep_rough", "waste_area", "sand"] },
  { name: "Sand Wedge", carryYards: 78, dispersionTilesBase: 1.35, skill: "recovery", lies: ["fairway", "rough", "deep_rough", "sand", "waste_area"] },
  { name: "Chip", carryYards: 38, dispersionTilesBase: 0.82, skill: "shortGame", lies: ["fairway", "rough", "deep_rough", "green", "sand", "waste_area"] },
  { name: "Putter", carryYards: 28, dispersionTilesBase: 0.38, skill: "putting", lies: ["green", "fairway"] },
];

const CLUB_ID_BY_LABEL: Readonly<Record<string, ShotClubId>> = {
  Driver: "driver",
  "3 Wood": "three_wood",
  "5 Iron": "five_iron",
  "7 Iron": "seven_iron",
  "Pitching Wedge": "pitching_wedge",
  "Sand Wedge": "sand_wedge",
  Chip: "chip",
  Putter: "putter",
};

export function shotClubIdForLabel(label: string): ShotClubId | null {
  return CLUB_ID_BY_LABEL[label] ?? null;
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
  return {
    version: 1,
    identity: {
      id: `player-pro-${args.seed >>> 0}`,
      name: args.name?.trim().slice(0, 30) || "Alex Green",
      appearance: args.appearance ?? "classic",
      handedness: args.handedness ?? "right",
      background,
    },
    skills: baseSkills(background),
    skillXp: Object.fromEntries(PLAYER_PRO_SKILLS.map((skill) => [skill, 0])) as PlayerProSkills,
    careerPoints: 0,
    unlockedTechniques: ["normal"],
    activeRound: null,
    rounds: [],
    training: [],
    challenges: [],
    tournaments: [],
    trophies: [],
    earnings: 0,
    reputation: 0,
    settlementLedger: [],
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
  const greenSnapshot = round.course.greenSnapshot == null
    ? null
    : decodeGreenRoundSnapshot(round.course.greenSnapshot, round.course);
  if (greenSnapshot && !greenSnapshot.ok) return null;
  if (round.shots.some((trace) => !validActiveShotTrace(trace))) return null;
  if (round.phase === "flight" && (!round.pendingShot || !validActiveShotTrace(round.pendingShot))) return null;
  const theme = normalizeBiomeKey(round.course.theme);
  if (!theme) return null;
  const biomeCompatibility = validateBiomeCompatibilityMetadata(
    round.course.biomeCompatibility,
    theme,
  );
  if (!biomeCompatibility.ok) return null;
  return {
    ...round,
    handedness: round.handedness === "left" ? "left" : "right",
    course: {
      ...round.course,
      theme,
      biomeCompatibility: biomeCompatibility.metadata,
      ...(greenSnapshot?.ok ? { greenSnapshot: greenSnapshot.value } : {}),
      greenDrainageLevel: clamp(Math.round(finite(round.course.greenDrainageLevel)), 0, 3),
    },
    strokes: Math.max(0, Math.floor(finite(round.strokes))),
    penalties: Math.max(0, Math.floor(finite(round.penalties))),
    rngCursor: Math.max(0, Math.floor(finite(round.rngCursor))),
    pendingShot: round.phase === "flight" && round.pendingShot ? round.pendingShot : null,
    rewardsApplied: round.rewardsApplied === true,
    autoPlay: round.autoPlay === true,
    shots: round.shots.slice(-MAX_SHOTS),
  };
}

function normalizeCareerRound(value: unknown): PlayerCareerRound | null {
  if (!value || typeof value !== "object") return null;
  const round = value as PlayerCareerRound;
  if (typeof round.id !== "string" || !round.id || typeof round.courseId !== "string") return null;
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
  };
}

export function normalizePlayerPro(raw: unknown, args: { seed: number; founderName?: string }): PlayerProCareer {
  const fallback = createDefaultPlayerPro({ seed: args.seed, name: args.founderName });
  if (!raw || typeof raw !== "object") return fallback;
  const candidate = raw as PlayerProCareer;
  const identity = candidate.identity && typeof candidate.identity === "object" ? candidate.identity : fallback.identity;
  const background: PlayerProBackground = identity.background === "operator" || identity.background === "host" ? identity.background : "architect";
  const skills = normalizeSkills(candidate.skills, baseSkills(background));
  const xp = normalizeSkills(candidate.skillXp, Object.fromEntries(PLAYER_PRO_SKILLS.map((skill) => [skill, 0])) as PlayerProSkills);
  const techniques = (Array.isArray(candidate.unlockedTechniques) ? candidate.unlockedTechniques : ["normal"])
    .filter((value): value is PlayerShotTechnique => ["normal", "draw", "fade", "punch", "flop", "backspin"].includes(value))
    .filter((value, index, all) => all.indexOf(value) === index);
  if (!techniques.includes("normal")) techniques.unshift("normal");
  return {
    version: 1,
    identity: {
      id: typeof identity.id === "string" && identity.id ? identity.id : fallback.identity.id,
      name: typeof identity.name === "string" && identity.name.trim() ? identity.name.trim().slice(0, 30) : fallback.identity.name,
      appearance: identity.appearance === "sport" || identity.appearance === "heritage" ? identity.appearance : "classic",
      handedness: identity.handedness === "left" ? "left" : "right",
      background,
    },
    skills,
    skillXp: xp,
    careerPoints: Math.max(0, Math.floor(finite(candidate.careerPoints))),
    unlockedTechniques: techniques,
    activeRound: normalizeActiveRound(candidate.activeRound),
    rounds: Array.isArray(candidate.rounds)
      ? candidate.rounds.map(normalizeCareerRound).filter((round): round is PlayerCareerRound => round != null).slice(-MAX_HISTORY)
      : [],
    training: Array.isArray(candidate.training) ? candidate.training.slice(-MAX_TRAINING) : [],
    challenges: Array.isArray(candidate.challenges) ? candidate.challenges.slice(-30) : [],
    tournaments: Array.isArray(candidate.tournaments) ? candidate.tournaments.slice(-30) : [],
    trophies: Array.isArray(candidate.trophies) ? candidate.trophies.slice(-40) : [],
    earnings: finite(candidate.earnings),
    reputation: clamp(finite(candidate.reputation), 0, 100),
    settlementLedger: Array.isArray(candidate.settlementLedger)
      ? candidate.settlementLedger.filter((entry): entry is string => typeof entry === "string").slice(-160)
      : [],
  };
}

function snapshotCourse(course: Course, world: World, day: number, layoutId: string, teeSet: TeeSet, pinRotation: PinRotation): PlayerRoundCourseSnapshot | null {
  const layout = layoutById(course, layoutId);
  if (!layout || layout.state !== "open") return null;
  const view = courseForLayout(course, layout.id);
  const holes = view.holes.map((hole) => {
    const setup = resolveCourseSetup(hole, teeSet, pinRotation);
    if (!setup.tee || !setup.pin) return null;
    const parSetting = getParSetting(hole, setup.teeSet);
    const par = parSetting.mode === "MANUAL"
      ? parSetting.par
      : computeAutoPar(Math.hypot(setup.pin.x - setup.tee.x, setup.pin.y - setup.tee.y));
    return {
      id: hole.id ?? `hole-${view.holes.indexOf(hole) + 1}`,
      name: hole.name ?? `Hole ${view.holes.indexOf(hole) + 1}`,
      par,
      tee: { ...setup.tee },
      pin: { ...setup.pin },
      waypoints: hole.waypoints?.map((candidate) => ({ ...candidate })) ?? [],
    };
  });
  if (holes.some((hole) => !hole)) return null;
  const season = seasonalState(world, course, day);
  const weather = activeWeather(world, course, day);
  const modifiers = weatherModifiers(weather, season.operations.drainageLevel);
  const greenSnapshot = createGreenRoundSnapshot(view);
  return {
    courseId: layout.id,
    courseName: layout.name,
    geometryVersion: courseGeometryVersion(view),
    theme: getBiomeDefinition(course.theme).compatibility.saveKey,
    biomeCompatibility: biomeCompatibilityMetadataFor(
      getBiomeDefinition(course.theme).compatibility.saveKey,
    ),
    width: course.width,
    height: course.height,
    yardsPerTile: course.yardsPerTile,
    tiles: effectiveSurfaceTiles(course).slice(),
    elevations: course.elevations.slice(),
    obstacles: course.obstacles.map((obstacle) => ({ ...obstacle })),
    holes: holes as PlayerRoundCourseSnapshot["holes"],
    greenSnapshot,
    greenDrainageLevel: season.operations.drainageLevel,
    weather: {
      kind: weather.kind,
      temperatureF: weather.temperatureF,
      windMph: weather.windMph,
      rainInches: weather.rainInches,
      carryMultiplier: modifiers.carryMultiplier,
      dispersionMultiplier: modifiers.dispersionMultiplier,
      paceMultiplier: modifiers.paceMultiplier,
    },
  };
}

function rulesSnapshotForRound(course: Course, snapshot: PlayerRoundCourseSnapshot) {
  const cells = snapshot.width * snapshot.height;
  const inBounds = new Array<boolean>(cells);
  const penaltyMask = new Array<boolean>(cells);
  for (let index = 0; index < cells; index++) {
    const x = index % snapshot.width;
    const y = Math.floor(index / snapshot.width);
    const owned = isOwnedTile(course, x, y);
    inBounds[index] = owned;
    penaltyMask[index] = owned && (snapshot.tiles[index] === "water" || snapshot.tiles[index] === "wetland");
  }
  const base = createControlledRoundSnapshotV2({
    width: snapshot.width,
    height: snapshot.height,
    inBounds,
    penaltyMask,
    holeClassifications: snapshot.holes.map((hole) => ({ holeId: hole.id, red: [], yellow: [] })),
  });
  if (!base.ok) return undefined;
  const decoded = decodeControlledRoundSnapshotV2(base.value);
  if (!decoded.ok) return undefined;
  const classifications = snapshot.holes.map((hole) => classifyPenaltyAreaComponents({
    snapshot: {
      width: decoded.value.snapshot.width,
      height: decoded.value.snapshot.height,
      inBounds: decoded.value.inBounds,
      penaltyComponents: decoded.value.penaltyComponents,
      components: decoded.value.components,
    },
    holeId: hole.id,
    route: [hole.tee, ...hole.waypoints, hole.pin],
  }));
  if (classifications.some((result) => !result.ok)) return undefined;
  const normalizedClassifications = classifications.flatMap((result) => result.ok ? [result.value] : []);
  if (normalizedClassifications.length !== snapshot.holes.length) return undefined;
  const classified = createControlledRoundSnapshotV2({
    width: snapshot.width,
    height: snapshot.height,
    inBounds,
    penaltyMask,
    holeClassifications: normalizedClassifications,
  });
  return classified.ok ? classified.value : undefined;
}

export function startPlayableRound(args: {
  course: Course;
  world: World;
  kind?: PlayerRoundKind;
  layoutId?: string;
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
  opponent?: PlayerPlayableRound["opponent"];
  tournament?: { id: string; name: string };
  day?: number;
}): { ok: true; round: PlayerPlayableRound } | { ok: false; reason: string } {
  const layout = args.layoutId ? layoutById(args.course, args.layoutId) : activeCourseLayout(args.course);
  if (!layout) return { ok: false, reason: "The selected routing no longer exists." };
  if (layout.publishedHoleIds.length < 3) return { ok: false, reason: "Publish at least three complete holes before starting a Player Pro round." };
  const teeSet = args.teeSet ?? "member";
  const pinRotation = args.pinRotation ?? args.course.activePinRotation ?? "A";
  const snapshot = snapshotCourse(args.course, args.world, args.day ?? 0, layout.id, teeSet, pinRotation);
  if (!snapshot) return { ok: false, reason: "Every routed hole needs a valid tee, pin, and playable setup." };
  const rulesSnapshot = rulesSnapshotForRound(args.course, snapshot);
  const frozenCourse = rulesSnapshot ? { ...snapshot, rulesSnapshot } : snapshot;
  const id = `pro-round-${args.world.runSeed >>> 0}-${args.world.week}-${args.day ?? 0}-${args.kind ?? "casual"}-${(args.world.playerPro?.rounds.length ?? 0) + 1}`;
  return {
    ok: true,
    round: {
      version: 1,
      id,
      kind: args.kind ?? "casual",
      handedness: args.world.playerPro?.identity.handedness === "left" ? "left" : "right",
      phase: "awaiting_shot",
      course: frozenCourse,
      rulesSnapshot,
      teeSet,
      pinRotation,
      currentHoleIndex: 0,
      ball: { ...frozenCourse.holes[0].tee },
      lie: "tee",
      strokes: 0,
      penalties: 0,
      scorecard: frozenCourse.holes.map((hole) => ({
        holeId: hole.id,
        name: hole.name,
        par: hole.par,
        strokes: 0,
        penalties: 0,
        complete: false,
      })),
      shots: [],
      pendingShot: null,
      rngSeed: (args.world.runSeed | 0) ^ (args.world.week * 7919) ^ ((args.day ?? 0) * 431) ^ id.length * 997,
      rngCursor: 0,
      autoPlay: false,
      rewardsApplied: false,
      startedWeek: args.world.week,
      startedDay: args.day ?? 0,
      opponent: args.opponent,
      tournamentId: args.tournament?.id,
      tournamentName: args.tournament?.name,
    },
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
      carryYards: club.carryYards * (0.82 + power / 500) * (snapshot.weather?.carryMultiplier ?? 1),
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

export function previewPlayableShot(round: PlayerPlayableRound, skills: PlayerProSkills, selection: PlayerShotSelection): PlayerShotPreview {
  const club = CLUBS.find((candidate) => candidate.name === selection.club);
  const flightProfile = flightProfileForTechnique(selection.technique, selection.flightProfile);
  const calculated = calculatePlayerShotEffects({
    club: selection.club,
    lie: round.lie,
    recoverySkill: skills.recovery,
    technique: selection.technique,
    flightProfile,
  });
  const baseCarry = calculated.effects.carryYards * (0.82 + skills.power / 500) * (round.course.weather?.carryMultiplier ?? 1);
  if (!club) return {
    available: false,
    blocker: "unknown_club",
    carryYards: 0,
    targetYards: 0,
    dispersionTiles: 0,
    expectedPenalty: 0,
    landingTerrain: round.lie,
    risk: "high",
    recommended: false,
    flightProfile,
    shotEffects: calculated.effects,
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
  const obstructionPenalty = obstacleClose && selection.technique !== "punch" && club.name !== "Sand Wedge" && club.name !== "Chip" ? 0.65 : 0;
  const expectedPenalty = Math.max(0, evaluation.expectedShotCost - 1) + obstructionPenalty;
  const dispersionTiles = calculated.effects.dispersionTiles
    * (1.42 - skills[skillForClub(club.name, round.lie)] / 180)
    * (round.course.weather?.dispersionMultiplier ?? 1)
    * (obstructionPenalty > 0 ? 1.55 : 1);
  const resolved = evaluation.isValid
    ? resolvePlayableShot({
      snapshot: round.course,
      rulesSnapshot: round.rulesSnapshot,
      holeId: round.course.holes[round.currentHoleIndex].id,
      shotNumber: round.scorecard[round.currentHoleIndex].strokes + 1,
      from: round.ball,
      lie: round.lie,
      skills,
      selection,
      handedness: round.handedness,
      seed: round.rngSeed + round.rngCursor * 104729,
    })
    : null;
  const sharedOutcome = resolved?.sharedOutcome ?? null;
  const automaticPuttingEstimate = resolved && !resolved.holed && resolved.lieAfter === "green"
    ? estimateAutomaticPutts({
      snapshot: round.course,
      holeId: round.course.holes[round.currentHoleIndex].id,
      rest: resolved.rest,
      rollout: resolved.greenRollout,
      skills,
    })
    : null;
  return {
    available: evaluation.isValid,
    blocker: evaluation.isValid ? null : "unreachable",
    carryYards: baseCarry * clamp(selection.power, 0.25, 1.15),
    targetYards: evaluation.distanceYards,
    dispersionTiles,
    expectedPenalty,
    landingTerrain: lieAt(round.course, aim),
    risk: expectedPenalty > 0.75 ? "high" : expectedPenalty > 0.25 ? "medium" : "low",
    recommended: Math.abs(baseCarry * clamp(selection.power, 0.25, 1.15) - evaluation.distanceYards) < 35 && expectedPenalty < 0.35,
    flightProfile,
    shotEffects: calculated.effects,
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
  seed: number;
}): PlayerShotTrace {
  const club = CLUBS.find((candidate) => candidate.name === args.selection.club) ?? CLUBS[4];
  const flightProfile = flightProfileForTechnique(args.selection.technique, args.selection.flightProfile);
  const calculated = calculatePlayerShotEffects({
    club: club.name,
    lie: args.lie,
    recoverySkill: args.skills.recovery,
    technique: args.selection.technique,
    flightProfile,
  });
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
  const obstructionPenalty = obstacleClose && args.selection.technique !== "punch" && club.name !== "Sand Wedge" && club.name !== "Chip";
  const weatherCarry = args.snapshot.weather?.carryMultiplier ?? 1;
  const powerScale = 0.82 + args.skills.power / 500;
  const requestedCarryYards = calculated.effects.carryYards * powerScale * weatherCarry * power;
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
  const dispersion = Math.max(
    0.12,
    calculated.effects.dispersionTiles
      * (1.42 - clubSkill / 180)
      * weatherDispersion
      * (obstructionPenalty ? 1.55 : 1),
  );
  const rng = mulberry32(args.seed | 0);
  const lateral = gaussian(rng) * dispersion * 0.42;
  const longitudinal = gaussian(rng) * dispersion * 0.22;
  const curve = resolveShotCurve({
    shotSlope,
    shotLengthTiles: intendedTiles,
    club: club.name,
    technique: args.selection.technique,
  }).combinedCurveTiles;
  let landing: PlayerProPoint = {
    x: args.from.x + ux * (intendedTiles + longitudinal) - uy * (lateral + curve),
    y: args.from.y + uy * (intendedTiles + longitudinal) + ux * (lateral + curve),
  };
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
  const requestedRollYards = club.name === "Putter"
    ? Math.hypot(rawLanding.x - args.from.x, rawLanding.y - args.from.y) * args.snapshot.yardsPerTile
    : calculated.effects.rolloutYards;
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
    landingAngleDegrees: club.name === "Putter" ? 0 : clamp(18 + calculated.effects.flight.launchAngleDegrees * 0.75, 0, 70),
    trajectory: flightProfile,
    spin,
    weather: args.snapshot.weather,
    drainageLevel: args.snapshot.greenDrainageLevel,
    seed: args.seed,
  });
  const rawRest = greenRollout.rest;
  const puttingSkill = args.skills.putting;
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
    flightProfile,
    power,
    from: roundedPoint(args.from),
    aim: roundedPoint(args.selection.aim),
    landing: roundedPoint(rolloutLanding),
    rest: roundedPoint(rest),
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
    trace.greenPutting = resolveAutomaticPutts({
      snapshot: args.snapshot,
      holeId: args.holeId,
      rest: trace.rest,
      rollout: greenRollout,
      skills: args.skills,
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
    seed: round.rngSeed + round.rngCursor * 104729,
  });
  return {
    ...round,
    phase: "flight",
    pendingShot: trace,
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

export function autoFinishPlayerRound(round: PlayerPlayableRound, skills: PlayerProSkills): PlayerPlayableRound {
  let next = round.phase === "flight" ? finishPlayerShot(round) : round;
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
    }
  }
  return next;
}

export function concedePlayerRound(round: PlayerPlayableRound): PlayerPlayableRound {
  if (round.phase === "round_complete" || round.phase === "conceded") return round;
  return { ...round, phase: "conceded", pendingShot: null };
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
  return {
    cashDelta,
    reputationDelta,
    round: careerRound,
    tournamentEvent,
    career: {
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
    },
  };
}

export interface PlayerTrainingOption {
  id: string;
  facilityId: string;
  facilityName: string;
  skill: PlayerProSkill;
  cost: number;
  minutes: number;
  available: boolean;
  blocker: string | null;
}

const TRAINING_SKILLS: Record<string, PlayerProSkill[]> = {
  driving_range: ["power", "driving", "irons"],
  practice_bays: ["driving", "irons"],
  putting_green: ["putting"],
  short_game_area: ["shortGame", "recovery"],
  practice_holes: ["irons", "shortGame", "putting", "recovery"],
};

export function playerTrainingOptions(course: Course, world: World, day: number, dayMinute = 600): PlayerTrainingOption[] {
  const assets = course.property?.assets ?? [];
  const hasCoach = (world.staffRoster ?? []).some((staff) => staff.role === "club_pro") || (world.enterprise?.professionals.length ?? 0) > 0;
  const sessionsToday = world.playerPro?.training.filter((record) => record.week === world.week && record.day === day).length ?? 0;
  return assets.flatMap((asset) => (TRAINING_SKILLS[asset.kind] ?? []).map((skill) => {
    const blocker = !asset.enabled
      ? "closed"
      : (asset.constructionDaysRemaining ?? 0) > 0
        ? "construction"
        : asset.condition < 0.4
          ? "condition"
          : dayMinute < (asset.openHour ?? 7) * 60 || dayMinute >= (asset.closeHour ?? 20) * 60
            ? "hours"
            : !hasCoach
              ? "coach"
              : sessionsToday >= 2
                ? "daily_cap"
                : null;
    return {
      id: `${asset.id}:${skill}`,
      facilityId: asset.id,
      facilityName: asset.name,
      skill,
      cost: Math.max(25, Math.round(asset.price * 2 + asset.tier * 20)),
      minutes: 45 + asset.tier * 5,
      available: blocker == null,
      blocker,
    };
  }));
}

export function completePlayerTraining(career: PlayerProCareer, world: World, option: PlayerTrainingOption, day: number): { career: PlayerProCareer; cost: number } {
  if (!option.available || world.cash < option.cost) return { career, cost: 0 };
  const id = `training-${world.week}-${day}-${career.training.filter((record) => record.week === world.week && record.day === day).length + 1}`;
  if (career.settlementLedger.includes(id)) return { career, cost: 0 };
  const evidence = 4;
  const skillXp = { ...career.skillXp, [option.skill]: career.skillXp[option.skill] + evidence };
  const beforeLevel = Math.floor(career.skillXp[option.skill] / XP_PER_LEVEL);
  const afterLevel = Math.floor(skillXp[option.skill] / XP_PER_LEVEL);
  const skills = { ...career.skills, [option.skill]: clamp(career.skills[option.skill] + Math.max(0, afterLevel - beforeLevel), 0, 100) };
  const record: PlayerTrainingRecord = {
    id,
    week: world.week,
    day,
    facilityId: option.facilityId,
    facilityName: option.facilityName,
    skill: option.skill,
    cost: option.cost,
    minutes: option.minutes,
    evidence,
  };
  return {
    cost: option.cost,
    career: {
      ...career,
      skills,
      skillXp,
      unlockedTechniques: unlockTechniques(skills),
      training: [...career.training, record].slice(-MAX_TRAINING),
      settlementLedger: [...career.settlementLedger, id].slice(-160),
    },
  };
}

export interface PlayerOpponent {
  id: string;
  name: string;
  skill: number;
  relationship: number;
}

export function eligiblePlayerOpponents(world: World): PlayerOpponent[] {
  const customers = (world.enterprise?.customers ?? [])
    .filter((customer) => customer.visits >= 2 || customer.loyalty >= 40)
    .slice(0, 12)
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
      skill: clamp(customer.skill / 100, 0.2, 0.95),
      relationship: clamp(customer.loyalty - 50, -50, 50),
    }));
  if (customers.length) return customers;
  return (world.enterprise?.professionals ?? []).slice(0, 6).map((professional) => ({
    id: professional.id,
    name: professional.name,
    skill: clamp(0.5 + professional.tier * 0.08, 0.4, 0.95),
    relationship: 5,
  }));
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

export function playerTournamentEligibility(career: PlayerProCareer, event: TournamentEvent): { eligible: boolean; reason: string | null } {
  const average = PLAYER_PRO_SKILLS.reduce((sum, skill) => sum + career.skills[skill], 0) / PLAYER_PRO_SKILLS.length;
  const minimum: Record<TournamentTier, number> = { local: 35, regional: 52, championship: 68 };
  if (event.status !== "scheduled") return { eligible: false, reason: "event_status" };
  if (average < minimum[event.tier]) return { eligible: false, reason: `skill:${minimum[event.tier]}` };
  if (career.tournaments.some((record) => record.eventId === event.id && record.status !== "withdrawn")) return { eligible: false, reason: "already_entered" };
  return { eligible: true, reason: null };
}

export function registerPlayerTournament(
  career: PlayerProCareer,
  event: TournamentEvent,
  options: { campaignQualified?: boolean } = {},
): PlayerProCareer {
  const eligibility = options.campaignQualified && event.status === "scheduled"
    ? { eligible: true, reason: null }
    : playerTournamentEligibility(career, event);
  if (!eligibility.eligible) return career;
  const record: PlayerTournamentRecord = {
    id: `pro-event-${event.id}`,
    eventId: event.id,
    name: event.name,
    tier: event.tier,
    status: "registered",
  };
  return { ...career, tournaments: [...career.tournaments, record].slice(-30) };
}

export function activatePlayerTournament(career: PlayerProCareer, eventId: string, roundId: string): PlayerProCareer {
  return {
    ...career,
    tournaments: career.tournaments.map((record) => record.eventId === eventId
      ? { ...record, status: "active", roundId }
      : record),
  };
}

export function currentPlayerTournament(world: World, id?: string): TournamentEvent | undefined {
  if (!id) return undefined;
  return tournamentCalendar(world).events.find((event) => event.id === id);
}

export function playerTechniqueCatalog(skills: PlayerProSkills): Array<{ technique: PlayerShotTechnique; unlocked: boolean; requirement: string | null }> {
  return (["normal", "draw", "fade", "punch", "flop", "backspin"] as PlayerShotTechnique[]).map((technique) => ({
    technique,
    unlocked: techniqueRequirement(technique, skills) == null,
    requirement: techniqueRequirement(technique, skills),
  }));
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
