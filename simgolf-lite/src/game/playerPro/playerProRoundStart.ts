import type { Course, PinRotation, TeeSet, World } from "../models/types";
import type { PlayerPlayableRound, PlayerProSkills, PlayerRoundCourseSnapshot, PlayerRoundKind } from "../models/playerProTypes";
import { biomeCompatibilityMetadataFor, getBiomeDefinition } from "../models/biomes";
import { courseGeometryVersion } from "../livingClub/livingClub";
import { activeCourseLayout, courseForLayout, layoutById } from "../models/courseLayouts";
import { getParSetting, resolveCourseSetup } from "../models/courseSetup";
import { computeAutoPar } from "../sim/holeMetrics";
import { computeRatingForSetup } from "../sim/courseRating";
import { activeWeather, absoluteDayFor, seasonalState, weatherModifiers } from "../seasons/seasons";
import { effectiveSurfaceTiles } from "../conditions/surfaceCare";
import { isOwnedTile } from "../estate/estate";
import { classifyPenaltyAreaComponents } from "../rules/penaltyAreas";
import { createControlledRoundSnapshotV2, decodeControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { createGreenRoundSnapshot } from "../greens/greenSurface";
import { captureRoundHandicapSnapshot, createHandicapProfile } from "../competition/persistence";
import { confidenceAtDay, createPlayerConfidence } from "./confidence";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const ARCHITECT_SKILLS: PlayerProSkills = { power: 40, driving: 40, irons: 44, shortGame: 42, putting: 40, recovery: 40 };

function snapshotCourse(course: Course, world: World, day: number, layoutId: string, teeSet: TeeSet, pinRotation: PinRotation): PlayerRoundCourseSnapshot | null {
  const layout = layoutById(course, layoutId);
  if (!layout || layout.state !== "open") return null;
  const view = courseForLayout(course, layout.id);
  const holes = view.holes.map((hole, index) => {
    const setup = resolveCourseSetup(hole, teeSet, pinRotation);
    if (!setup.tee || !setup.pin) return null;
    const parSetting = getParSetting(hole, setup.teeSet);
    return {
      id: hole.id ?? `hole-${index + 1}`,
      name: hole.name ?? `Hole ${index + 1}`,
      par: parSetting.mode === "MANUAL" ? parSetting.par : computeAutoPar(Math.hypot(setup.pin.x - setup.tee.x, setup.pin.y - setup.tee.y)),
      tee: { ...setup.tee },
      pin: { ...setup.pin },
      waypoints: hole.waypoints?.map((candidate) => ({ ...candidate })) ?? [],
      strokeIndex: Number.isInteger(hole.holeIndex) ? hole.holeIndex! : null,
      teeSet: setup.teeSet,
      pinRotation: setup.pinRotation,
    };
  });
  if (holes.some((hole) => !hole)) return null;
  const season = seasonalState(world, course, day);
  const weather = activeWeather(world, course, day);
  const modifiers = weatherModifiers(weather, season.operations.drainageLevel);
  const rating = computeRatingForSetup(view, teeSet, pinRotation);
  const theme = getBiomeDefinition(course.theme).compatibility.saveKey;
  return {
    courseId: layout.id,
    courseName: layout.name,
    geometryVersion: courseGeometryVersion(view),
    theme,
    biomeCompatibility: biomeCompatibilityMetadataFor(theme),
    width: course.width,
    height: course.height,
    yardsPerTile: course.yardsPerTile,
    tiles: effectiveSurfaceTiles(course).slice(),
    elevations: course.elevations.slice(),
    obstacles: course.obstacles.map((obstacle) => ({ ...obstacle })),
    holes: holes as PlayerRoundCourseSnapshot["holes"],
    rating: { courseRating: rating.courseRating, slope: rating.slope },
    greenSnapshot: createGreenRoundSnapshot(view),
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
  const normalized = classifications.flatMap((result) => result.ok ? [result.value] : []);
  if (normalized.length !== snapshot.holes.length) return undefined;
  const classified = createControlledRoundSnapshotV2({ width: snapshot.width, height: snapshot.height, inBounds, penaltyMask, holeClassifications: normalized });
  return classified.ok ? classified.value : undefined;
}

export interface StartPlayableRoundArgs {
  course: Course;
  world: World;
  kind?: PlayerRoundKind;
  layoutId?: string;
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
  opponent?: PlayerPlayableRound["opponent"];
  tournament?: { id: string; name: string };
  day?: number;
  /** Immutable authority captured by the deferred equipment boundary in the same start transaction. */
  performanceLoadout?: PlayerPlayableRound["performanceLoadout"];
}

export function startPlayableRound(args: StartPlayableRoundArgs): { ok: true; round: PlayerPlayableRound } | { ok: false; reason: string } {
  const layout = args.layoutId ? layoutById(args.course, args.layoutId) : activeCourseLayout(args.course);
  if (!layout) return { ok: false, reason: "The selected routing no longer exists." };
  if (layout.publishedHoleIds.length < 3) return { ok: false, reason: "Publish at least three complete holes before starting a Player Pro round." };
  const teeSet = args.teeSet ?? "member";
  const pinRotation = args.pinRotation ?? args.course.activePinRotation ?? "A";
  const snapshot = snapshotCourse(args.course, args.world, args.day ?? 0, layout.id, teeSet, pinRotation);
  if (!snapshot) return { ok: false, reason: "Every routed hole needs a valid tee, pin, and playable setup." };
  const rulesSnapshot = rulesSnapshotForRound(args.course, snapshot);
  const frozenCourse = rulesSnapshot ? { ...snapshot, rulesSnapshot } : snapshot;
  const handicapProfile = args.world.playerPro?.handicapProfile ?? createHandicapProfile(args.world.playerPro?.skills ?? ARCHITECT_SKILLS);
  const confidence = confidenceAtDay(args.world.playerPro?.confidence ?? createPlayerConfidence(), absoluteDayFor(args.world.week, args.day ?? 0));
  const roundOrdinal = Math.max(args.world.playerPro?.rounds.length ?? 0, handicapProfile.scoreRecords.length) + 1;
  const id = `pro-round-${args.world.runSeed >>> 0}-${args.world.week}-${args.day ?? 0}-${args.kind ?? "casual"}-${roundOrdinal}`;
  const handicapSnapshot = captureRoundHandicapSnapshot({
    roundId: id,
    handicapIndex: handicapProfile.handicapIndex,
    confidence: handicapProfile.confidence,
    course: { id: frozenCourse.courseId, name: frozenCourse.courseName, geometryVersion: frozenCourse.geometryVersion, teeSet, pinRotation, rating: frozenCourse.rating, holes: frozenCourse.holes },
    startedWeek: args.world.week,
    startedDay: args.day ?? 0,
  });
  const performanceLoadout = args.performanceLoadout ?? Object.freeze({
    version: 1 as const,
    frozenWeek: Math.max(1, Math.floor(args.world.week)),
    frozenDay: clamp(Math.floor(args.day ?? 0), 0, 6),
    itemIds: Object.freeze([]),
    modifiers: Object.freeze([]),
  });
  return { ok: true, round: {
    version: 1,
    id,
    kind: args.kind ?? "casual",
    handedness: args.world.playerPro?.identity.handedness === "left" ? "left" : "right",
    phase: "awaiting_shot",
    course: frozenCourse,
    handicapSnapshot,
    confidenceSnapshot: confidence,
    rulesSnapshot,
    performanceLoadout,
    teeSet,
    pinRotation,
    currentHoleIndex: 0,
    ball: { ...frozenCourse.holes[0].tee },
    lie: "tee",
    strokes: 0,
    penalties: 0,
    scorecard: frozenCourse.holes.map((hole) => ({ holeId: hole.id, name: hole.name, par: hole.par, strokes: 0, penalties: 0, complete: false })),
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
  } };
}
