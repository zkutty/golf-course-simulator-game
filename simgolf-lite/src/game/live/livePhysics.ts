import type { Course, Point, TeeSet, PinRotation, Terrain } from "../models/types";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import type { ControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { createControlledRoundSnapshotV2, decodeControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import { classifyPenaltyAreaComponents } from "../rules/penaltyAreas";
import { resolveCourseSetup, getParSetting } from "../models/courseSetup";
import { isOwnedTile } from "../estate/estate";
import { resolvePlayableShot, type PlayerShotSelection } from "../playerPro/playerPro";
import { capabilitiesToPlayerSkills } from "./capabilities";
import type { GolferCapabilities, LiveShotOutcome, ShotIntent } from "./m47Types";
import { biomeCompatibilityMetadataFor, getBiomeDefinition } from "../models/biomes";
import { effectiveSurfaceTiles, resolveEffectiveSurface } from "../conditions/surfaceCare";

function parFor(hole: Course["holes"][number]): number {
  const setting = getParSetting(hole, "member");
  return setting.mode === "MANUAL" ? setting.par : 4;
}

function deriveRulesSnapshot(course: Course, holes: PlayerRoundCourseSnapshot["holes"]): ControlledRoundSnapshotV2 | undefined {
  const cells = course.width * course.height;
  const inBounds = Array.from({ length: cells }, (_, index) => isOwnedTile(course, index % course.width, Math.floor(index / course.width)));
  const penaltyMask = inBounds.map((owned, index) => owned && (course.tiles[index] === "water" || course.tiles[index] === "wetland"));
  const base = createControlledRoundSnapshotV2({
    width: course.width,
    height: course.height,
    inBounds,
    penaltyMask,
    holeClassifications: holes.map((hole) => ({ holeId: hole.id, red: [], yellow: [] })),
  });
  if (!base.ok) return undefined;
  const decoded = decodeControlledRoundSnapshotV2(base.value);
  if (!decoded.ok) return undefined;
  const snapshot = {
    width: decoded.value.snapshot.width,
    height: decoded.value.snapshot.height,
    inBounds: decoded.value.inBounds,
    penaltyComponents: decoded.value.penaltyComponents,
    components: decoded.value.components,
  };
  const classifications = holes.map((hole) => classifyPenaltyAreaComponents({
    snapshot,
    holeId: hole.id,
    route: [hole.tee, ...hole.waypoints, hole.pin],
  }));
  if (classifications.some((result) => !result.ok)) return undefined;
  const frozen = createControlledRoundSnapshotV2({
    width: course.width,
    height: course.height,
    inBounds,
    penaltyMask,
    holeClassifications: classifications.map((result) => result.ok ? result.value : { holeId: "invalid", red: [], yellow: [] }),
  });
  return frozen.ok ? frozen.value : undefined;
}

export function liveCourseSnapshot(args: {
  course: Course;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  weather?: PlayerRoundCourseSnapshot["weather"];
  rulesSnapshot?: ControlledRoundSnapshotV2;
}): PlayerRoundCourseSnapshot {
  const holes = args.course.holes.map((hole, index) => {
    const setup = resolveCourseSetup(hole, args.teeSet, args.pinRotation);
    return {
      id: hole.id ?? `hole-${index + 1}`,
      name: hole.name ?? `Hole ${index + 1}`,
      par: parFor(hole),
      tee: setup.tee ?? hole.tee ?? { x: 0, y: 0 },
      pin: setup.pin ?? hole.green ?? { x: 0, y: 0 },
      waypoints: hole.waypoints?.map((point) => ({ ...point })) ?? [],
    };
  });
  const theme = getBiomeDefinition(args.course.theme).compatibility.saveKey;
  return {
    courseId: args.course.activeCourseId ?? "course-primary",
    courseName: args.course.name ?? "Live course",
    geometryVersion: undefined,
    theme,
    biomeCompatibility: biomeCompatibilityMetadataFor(theme),
    width: args.course.width,
    height: args.course.height,
    yardsPerTile: args.course.yardsPerTile,
    tiles: effectiveSurfaceTiles(args.course).slice(),
    elevations: args.course.elevations.slice(),
    obstacles: args.course.obstacles.map((obstacle) => ({ x: obstacle.x, y: obstacle.y, type: obstacle.type })),
    holes,
    rulesSnapshot: args.rulesSnapshot ?? deriveRulesSnapshot(args.course, holes),
    weather: args.weather,
  };
}

export function resolveLiveShot(args: {
  snapshot: PlayerRoundCourseSnapshot;
  capabilities: GolferCapabilities;
  holeId: string;
  shotNumber: number;
  from: Point;
  lie: string;
  intent: ShotIntent;
  seed: number;
}): LiveShotOutcome {
  const selection: PlayerShotSelection = {
    club: args.intent.club,
    aim: args.intent.target,
    power: args.intent.power,
    technique: args.intent.technique,
    flightProfile: args.intent.flightProfile,
  };
  const trace = resolvePlayableShot({
    snapshot: args.snapshot,
    holeId: args.holeId,
    shotNumber: args.shotNumber,
    from: args.from,
    lie: args.lie,
    skills: capabilitiesToPlayerSkills(args.capabilities),
    selection,
    seed: args.seed,
  });
  const facts = args.intent.facts.slice();
  if (trace.penaltyStrokes > 0) facts.push({ code: "outcome", detail: `penalty:${trace.penaltyStrokes}` });
  facts.push({ code: "outcome", detail: `rest:${trace.lieAfter}` });
  return {
    version: 1,
    id: trace.id,
    holeId: trace.holeId,
    shotNumber: trace.shotNumber,
    intentId: args.intent.id,
    intent: args.intent.kind,
    club: trace.club,
    technique: trace.technique,
    flightProfile: trace.flightProfile,
    from: { ...trace.from },
    aim: { ...trace.aim },
    landing: { ...trace.landing },
    rest: { ...trace.rest },
    lieBefore: trace.lieBefore,
    lieAfter: trace.lieAfter,
    carryYards: trace.carryYards,
    rollYards: trace.rollYards,
    penaltyStrokes: trace.penaltyStrokes,
    holed: trace.holed,
    seed: trace.seed,
    facts,
    ruling: trace.ruling,
    relief: trace.relief,
    finalPosition: trace.finalPosition,
    sharedOutcome: trace.sharedOutcome,
  };
}

export function terrainAt(course: Course, point: Point): Terrain {
  return resolveEffectiveSurface(course, point.x, point.y).effectiveTerrain;
}
