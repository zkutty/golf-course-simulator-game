import type { Course, Hole, Point, Terrain } from "../models/types";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { estimateAutomaticPutts } from "../greens/greenPutting";
import { resolveGreenRollout, sampleGreenRolloutSurface } from "../greens/greenRollout";
import { analyzeShotSlope } from "../models/shotSlope";
import { capabilitiesToPlayerSkills } from "./capabilities";
import type { GolferCapabilities, StrategyFact } from "./m47Types";
import type { Personality } from "./personality";

export const GREEN_LANDING_ZONE_LIMIT = 16 as const;

export type GreenLandingRole = "attack" | "center" | "uphill" | "run-up" | "bailout";

export interface GreenLandingCandidate {
  id: string;
  target: Point;
  predictedRest: Point;
  role: GreenLandingRole;
  score: number;
  expectedPutts: number;
  hazardRisk: number;
  shortSidedRisk: number;
  rollOffRisk: number;
  nextShotQuality: number;
  variance: number;
  carryUtilization: number;
  facts: StrategyFact[];
}

const cache = new WeakMap<Course, Map<string, readonly Point[]>>();
const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const round = (value: number, places = 3) => Number(value.toFixed(places));
const distance = (left: Point, right: Point) => Math.hypot(left.x - right.x, left.y - right.y);

function terrainAt(tiles: readonly (Terrain | string)[], width: number, height: number, point: Point): string {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  return x >= 0 && y >= 0 && x < width && y < height ? String(tiles[y * width + x] ?? "rough") : "out_of_bounds";
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isFringe(tiles: readonly (Terrain | string)[], width: number, height: number, x: number, y: number): boolean {
  const terrain = terrainAt(tiles, width, height, { x, y });
  if (terrain !== "fairway" && terrain !== "rough") return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx !== 0 || dy !== 0) && terrainAt(tiles, width, height, { x: x + dx, y: y + dy }) === "green") return true;
  }
  return false;
}

function boundedZones(course: Course, hole: Hole, pin: Point): readonly Point[] {
  let courseCache = cache.get(course);
  if (!courseCache) {
    courseCache = new Map();
    cache.set(course, courseCache);
  }
  const key = `${hole.id ?? course.holes.indexOf(hole)}:${pin.x.toFixed(3)}:${pin.y.toFixed(3)}`;
  const prior = courseCache.get(key);
  if (prior) return prior;

  const all: Point[] = [];
  for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
    const terrain = terrainAt(course.tiles, course.width, course.height, { x, y });
    if (terrain === "green" || isFringe(course.tiles, course.width, course.height, x, y)) all.push({ x, y });
  }
  if (!all.length) return [{ ...pin }];
  const green = all.filter((point) => terrainAt(course.tiles, course.width, course.height, point) === "green");
  const centroid = (green.length ? green : all).reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  centroid.x /= Math.max(1, green.length || all.length);
  centroid.y /= Math.max(1, green.length || all.length);
  const ordered = all.slice().sort((left, right) => left.y - right.y || left.x - right.x);
  const selected: Point[] = [];
  const add = (point: Point | undefined) => {
    if (point && !selected.some((item) => item.x === point.x && item.y === point.y)) selected.push(point);
  };
  const nearest = (target: Point, predicate: (point: Point) => boolean = () => true) => ordered
    .filter(predicate)
    .sort((left, right) => distance(left, target) - distance(right, target) || left.y - right.y || left.x - right.x)[0];
  add(nearest(pin, (point) => terrainAt(course.tiles, course.width, course.height, point) === "green"));
  add(nearest(centroid, (point) => terrainAt(course.tiles, course.width, course.height, point) === "green"));
  add(ordered[0]);
  add(ordered.at(-1));
  add(ordered.slice().sort((left, right) => left.x - right.x || left.y - right.y)[0]);
  add(ordered.slice().sort((left, right) => right.x - left.x || left.y - right.y)[0]);
  add(ordered.slice().sort((left, right) => left.y - right.y || left.x - right.x)[0]);
  add(ordered.slice().sort((left, right) => right.y - left.y || left.x - right.x)[0]);
  while (selected.length < Math.min(GREEN_LANDING_ZONE_LIMIT, ordered.length)) {
    const next = ordered
      .filter((point) => !selected.some((item) => item.x === point.x && item.y === point.y))
      .map((point) => ({
        point,
        separation: Math.min(...selected.map((item) => distance(item, point))),
        tie: stableHash(`${key}:${point.x}:${point.y}`),
      }))
      .sort((left, right) => right.separation - left.separation || left.tie - right.tie)[0];
    if (!next) break;
    add(next.point);
  }
  const result = Object.freeze(selected.map((point) => Object.freeze({ ...point })));
  courseCache.set(key, result);
  return result;
}

function neighborhoodRisk(snapshot: PlayerRoundCourseSnapshot, point: Point, dispersion: number): number {
  const vectors = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  const radius = Math.max(.65, dispersion);
  let risk = 0;
  for (const [dx, dy] of vectors) {
    const terrain = terrainAt(snapshot.tiles, snapshot.width, snapshot.height, { x: point.x + dx * radius, y: point.y + dy * radius });
    risk += terrain === "water" || terrain === "wetland" || terrain === "out_of_bounds" ? 1
      : terrain === "sand" || terrain === "waste_area" ? .52
        : terrain === "deep_rough" ? .38
          : terrain === "rough" ? .14
            : .02;
  }
  return clamp(risk / vectors.length);
}

function greenDepth(snapshot: PlayerRoundCourseSnapshot, point: Point, direction: Point): number {
  let depth = 0;
  for (let step = .5; step <= 5; step += .5) {
    if (terrainAt(snapshot.tiles, snapshot.width, snapshot.height, { x: point.x + direction.x * step, y: point.y + direction.y * step }) !== "green") break;
    depth = step;
  }
  return depth;
}

function roleFor(args: {
  snapshot: PlayerRoundCourseSnapshot;
  pin: Point;
  target: Point;
  center: Point;
  uphill: number;
}): GreenLandingRole {
  const terrain = terrainAt(args.snapshot.tiles, args.snapshot.width, args.snapshot.height, args.target);
  if (terrain !== "green") return "run-up";
  if (distance(args.target, args.pin) <= 1.35) return "attack";
  if (args.uphill >= .075) return "uphill";
  if (distance(args.target, args.center) <= 1.35) return "center";
  return "bailout";
}

/**
 * Samples a fixed, bounded set of green/fringe landing zones and ranks them
 * without consuming outcome RNG. The target remains an aim point; live shot
 * resolution is still the sole authority for the realized flight and rest.
 */
export function planGreenLandingZones(args: {
  course: Course;
  hole: Hole;
  from: Point;
  lie: string;
  capabilities: GolferCapabilities;
  personality: Personality;
  snapshot: PlayerRoundCourseSnapshot;
}): GreenLandingCandidate[] {
  const snapshotHole = args.snapshot.holes.find((candidate) => candidate.id === (args.hole.id ?? ""));
  const pin = snapshotHole?.pin ?? args.hole.green;
  if (!pin) return [];
  const zones = boundedZones(args.course, args.hole, pin);
  const greenZones = zones.filter((point) => terrainAt(args.snapshot.tiles, args.snapshot.width, args.snapshot.height, point) === "green");
  const center = (greenZones.length ? greenZones : zones).reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= Math.max(1, greenZones.length || zones.length);
  center.y /= Math.max(1, greenZones.length || zones.length);
  const pinSample = sampleGreenRolloutSurface({
    width: args.snapshot.width,
    height: args.snapshot.height,
    tiles: args.snapshot.tiles,
    elevations: args.snapshot.elevations,
    holes: args.snapshot.holes.map((hole) => ({ id: hole.id, green: hole.pin })),
    greenSurface: args.snapshot.greenSnapshot?.surface,
    greenProgram: args.snapshot.greenSnapshot?.program,
    greenLocalState: args.snapshot.greenSnapshot?.localState,
  }, args.snapshot.greenSnapshot?.surface, pin);
  const approachLength = Math.max(.001, distance(args.from, pin));
  const approach = { x: (pin.x - args.from.x) / approachLength, y: (pin.y - args.from.y) / approachLength };
  const skill = capabilitiesToPlayerSkills(args.capabilities);
  const averageSkill = (args.capabilities.power + args.capabilities.accuracy + args.capabilities.irons + args.capabilities.shortGame) / 400;
  const dispersion = clamp(3.4 - args.capabilities.accuracy / 42 - args.capabilities.irons / 130, .55, 3.5);

  return zones.map((target) => {
    const surface = sampleGreenRolloutSurface({
      width: args.snapshot.width,
      height: args.snapshot.height,
      tiles: args.snapshot.tiles,
      elevations: args.snapshot.elevations,
      holes: args.snapshot.holes.map((hole) => ({ id: hole.id, green: hole.pin })),
      greenSurface: args.snapshot.greenSnapshot?.surface,
      greenProgram: args.snapshot.greenSnapshot?.program,
      greenLocalState: args.snapshot.greenSnapshot?.localState,
    }, args.snapshot.greenSnapshot?.surface, target);
    const uphill = pinSample.height - surface.height;
    const role = roleFor({ snapshot: args.snapshot, pin, target, center, uphill });
    const requestedRollYards = role === "run-up" ? 20 : role === "attack" ? 7 : 11;
    const rollout = resolveGreenRollout({
      course: {
        width: args.snapshot.width,
        height: args.snapshot.height,
        tiles: args.snapshot.tiles,
        elevations: args.snapshot.elevations,
        holes: args.snapshot.holes.map((hole) => ({ id: hole.id, green: hole.pin })),
        greenSurface: args.snapshot.greenSnapshot?.surface,
        greenProgram: args.snapshot.greenSnapshot?.program,
        greenLocalState: args.snapshot.greenSnapshot?.localState,
      },
      holeId: snapshotHole?.id ?? args.hole.id ?? "hole-1",
      landing: target,
      direction: approach,
      requestedRollYards,
      yardsPerTile: args.snapshot.yardsPerTile,
      club: role === "run-up" ? "Chip" : "7 Iron",
      sourceLie: args.lie,
      launchAngleDegrees: role === "run-up" ? 18 : 28,
      landingAngleDegrees: role === "run-up" ? 25 : 43,
      trajectory: role === "run-up" ? "low" : "standard",
      spin: role === "attack" && args.capabilities.irons >= 72 ? "backspin" : "neutral",
      weather: args.snapshot.weather,
      drainageLevel: args.snapshot.greenDrainageLevel,
      seed: stableHash(`${args.capabilities.seed}:${args.hole.id ?? "hole"}:${target.x}:${target.y}`),
    });
    const putting = estimateAutomaticPutts({
      snapshot: args.snapshot,
      holeId: snapshotHole?.id ?? args.hole.id ?? "hole-1",
      rest: rollout.rest,
      rollout,
      skills: skill,
    });
    const hazardRisk = neighborhoodRisk(args.snapshot, target, dispersion);
    const pinDirectionLength = distance(target, pin);
    const pinDirection = pinDirectionLength > .001
      ? { x: (pin.x - target.x) / pinDirectionLength, y: (pin.y - target.y) / pinDirectionLength }
      : approach;
    const shortDepth = greenDepth(args.snapshot, pin, pinDirection);
    const shortSidedRisk = distance(target, pin) <= 3.5 ? clamp((1.75 - shortDepth) / 1.75) : 0;
    const restTerrain = terrainAt(args.snapshot.tiles, args.snapshot.width, args.snapshot.height, rollout.rest);
    const rollOffRisk = restTerrain === "green" ? 0 : restTerrain === "fairway" || restTerrain === "rough" ? .48 : 1;
    const angleQuality = clamp(greenDepth(args.snapshot, target, approach) / 4);
    const centerQuality = clamp(1 - distance(target, center) / 7);
    const attackQuality = clamp(1 - distance(rollout.rest, pin) / 6);
    const uphillQuality = clamp(uphill / .35);
    const runUpQuality = role === "run-up" ? clamp(args.capabilities.shortGame / 100 * angleQuality) : 0;
    const playsLikeYards = analyzeShotSlope({ course: args.course, from: args.from, to: target, yardsPerTile: args.course.yardsPerTile }).playsLikeDistanceYards;
    const maximumCarryYards = 270 * (.84 + args.capabilities.power / 480);
    const carryUtilization = playsLikeYards / Math.max(1, maximumCarryYards);
    const conservative = args.capabilities.riskStyle === "conservative" || args.personality.prefs.difficulty < -.35;
    const aggressive = args.capabilities.riskStyle === "aggressive" || args.personality.prefs.difficulty > .45;
    const roleBias = role === "attack"
      ? -(args.capabilities.power / 100 * .18 + args.capabilities.accuracy / 100 * .12 + (aggressive ? .72 : 0))
      : role === "center"
        ? -(conservative ? .92 : .08) - (averageSkill < .52 ? .5 : 0)
        : role === "uphill"
          ? -(args.capabilities.irons / 100 * .26 + (conservative ? .18 : 0))
          : role === "run-up"
            ? -(args.capabilities.shortGame / 100 * .48)
            : -(args.capabilities.accuracy / 100 * .16 + (averageSkill < .52 ? .2 : 0));
    const riskWeight = 1.55 - args.capabilities.riskTolerance * .62;
    const score = putting.expectedPutts * .72
      + hazardRisk * riskWeight
      + shortSidedRisk * (1.2 - args.capabilities.riskTolerance * .45)
      + rollOffRisk * (1.45 - args.capabilities.riskTolerance * .4)
      + clamp(carryUtilization - .82, 0, .4) * (1.15 - args.capabilities.power / 250)
      + (1 - angleQuality) * (1 - args.capabilities.irons / 130) * .2
      - attackQuality * args.capabilities.challengeSeeking * .16
      - centerQuality * (conservative ? .18 : averageSkill < .52 ? .14 : 0)
      - uphillQuality * (1 - args.capabilities.riskTolerance) * .18
      - runUpQuality * .2
      + roleBias;
    const variance = clamp((100 - args.capabilities.consistency) / 120 + hazardRisk * .35 + rollOffRisk * .3 + shortSidedRisk * .2, .03, 1);
    const nextShotQuality = clamp(1 - (putting.expectedPutts - 1) / 2 - hazardRisk * .2 - rollOffRisk * .4);
    const facts: StrategyFact[] = [
      { code: "context", detail: `green-zone:${role} target:${target.x.toFixed(2)},${target.y.toFixed(2)} pin:${pin.x.toFixed(2)},${pin.y.toFixed(2)}` },
      { code: "capability-fit", detail: `power:${Math.round(args.capabilities.power)} accuracy:${Math.round(args.capabilities.accuracy)} irons:${Math.round(args.capabilities.irons)} short-game:${Math.round(args.capabilities.shortGame)} style:${args.capabilities.riskStyle}` },
      { code: "risk", detail: `hazard:${Math.round(hazardRisk * 100)}% short-sided:${Math.round(shortSidedRisk * 100)}% roll-off:${Math.round(rollOffRisk * 100)}% dispersion:${dispersion.toFixed(2)} carry:${Math.round(carryUtilization * 100)}%` },
      { code: "terrain", detail: `landing:${terrainAt(args.snapshot.tiles, args.snapshot.width, args.snapshot.height, target)} rest:${restTerrain} tier:${uphill > .075 ? "uphill" : uphill < -.075 ? "downhill" : "same"}` },
      { code: "next-shot", detail: `leave:${putting.leaveDistanceYards.toFixed(1)}yd expected-putts:${putting.expectedPutts.toFixed(2)} angle:${Math.round(angleQuality * 100)}%` },
      { code: "outcome", detail: `predicted-rest:${rollout.rest.x.toFixed(2)},${rollout.rest.y.toFixed(2)} speed:${putting.realizedSpeedFeet.toFixed(2)} break:${putting.breakTiles.toFixed(2)} rollout-authority:preview-only` },
    ];
    return {
      id: `${args.hole.id ?? "hole"}-green-${role}-${target.x}-${target.y}`,
      target: { ...target },
      predictedRest: { ...rollout.rest },
      role,
      score: round(score),
      expectedPutts: putting.expectedPutts,
      hazardRisk: round(hazardRisk),
      shortSidedRisk: round(shortSidedRisk),
      rollOffRisk: round(rollOffRisk),
      nextShotQuality: round(nextShotQuality),
      variance: round(variance),
      carryUtilization: round(carryUtilization),
      facts,
    };
  }).filter((candidate) => candidate.carryUtilization <= 1.08)
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id));
}
