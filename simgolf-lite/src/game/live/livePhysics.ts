import type { Course, Point, TeeSet, PinRotation, Terrain } from "../models/types";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { resolveCourseSetup, getParSetting } from "../models/courseSetup";
import { resolvePlayableShot, type PlayerShotSelection } from "../playerPro/playerPro";
import { capabilitiesToPlayerSkills } from "./capabilities";
import type { GolferCapabilities, LiveShotOutcome, ShotIntent } from "./m47Types";

function parFor(hole: Course["holes"][number]): number {
  const setting = getParSetting(hole, "member");
  return setting.mode === "MANUAL" ? setting.par : 4;
}

export function liveCourseSnapshot(args: {
  course: Course;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  weather?: PlayerRoundCourseSnapshot["weather"];
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
  return {
    courseId: args.course.activeCourseId ?? "course-primary",
    courseName: args.course.name ?? "Live course",
    geometryVersion: undefined,
    theme: args.course.theme ?? "parkland",
    width: args.course.width,
    height: args.course.height,
    yardsPerTile: args.course.yardsPerTile,
    tiles: args.course.tiles.slice(),
    elevations: args.course.elevations.slice(),
    obstacles: args.course.obstacles.map((obstacle) => ({ x: obstacle.x, y: obstacle.y, type: obstacle.type })),
    holes,
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
  };
}

export function terrainAt(course: Course, point: Point): Terrain {
  const x = Math.max(0, Math.min(course.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(course.height - 1, Math.round(point.y)));
  return course.tiles[y * course.width + x] ?? "rough";
}
