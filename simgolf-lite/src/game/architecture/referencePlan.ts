import type { Course, Hole, PinRotation, Point, TeeSet, Terrain } from "../models/types";
import { getParSetting, getPinPosition, getTeeBox } from "../models/courseSetup";
import type { ClubSpec, GolferProfile } from "../sim/golferProfiles";
import { evalShotExpectedCost } from "../sim/shots/evalShotExpectedCost";
import { buildingFootprintSet } from "../models/buildings";
import { hashCanonicalValue } from "../../utils/stateHash";
import { analyzeArchitecture } from "./architecture";
import { computeRatingForSetup } from "../sim/courseRating";
import { retainArchitectureReferencePlan, retainedArchitectureReferencePlan } from "./referencePlanEvidence";
import type { ArchitectureReviewData } from "./review";
import type { ArchitectureOverlayRender } from "./reviewTypes";

/**
 * The architecture reference is deliberately separate from live golfers.
 * These are neutral, central-tendency carries for the population expected to
 * use each tee, with ordinary-course dispersion and firm-neutral rollout.
 * Weather, confidence, mood, tournament pressure, and daily turf state never
 * enter this contract.
 */
export const ARCHITECTURE_REFERENCE_CAPABILITIES: Record<TeeSet, ArchitectureReferenceCapability> = {
  forward: { teeSet: "forward", teeCarryYards: 195, teeTotalYards: 208, approachCarryYards: 150, dispersionTiles: 3.25, riskTolerance: .42 },
  member: { teeSet: "member", teeCarryYards: 225, teeTotalYards: 242, approachCarryYards: 170, dispersionTiles: 2.85, riskTolerance: .48 },
  championship: { teeSet: "championship", teeCarryYards: 255, teeTotalYards: 276, approachCarryYards: 195, dispersionTiles: 2.55, riskTolerance: .52 },
};

export interface ArchitectureReferenceCapability {
  teeSet: TeeSet;
  teeCarryYards: number;
  teeTotalYards: number;
  approachCarryYards: number;
  dispersionTiles: number;
  riskTolerance: number;
}

export interface ArchitectureReferenceSegment {
  id: string;
  shot: number;
  from: Point;
  to: Point;
  club: string;
  carryYards: number;
  totalYards: number;
  playsLikeYards: number;
  utilization: number;
  dispersionTiles: number;
  expectedCost: number;
  risk: {
    landing: number;
    carry: number;
    blockers: number;
    outOfBounds: number;
    runout: number;
    nextShot: number;
    total: number;
  };
  explanation: string[];
}

export interface ArchitectureLandingZone {
  id: string;
  shot: number;
  center: Point;
  radiusTiles: number;
  lie: Terrain;
  playableShare: number;
  hazardShare: number;
  nextShotYards: number;
}

export interface ArchitectureReferencePlan {
  id: string;
  version: string;
  holeId: string;
  teeSet: TeeSet;
  pinRotation: PinRotation;
  tee: Point | null;
  pin: Point | null;
  capability: ArchitectureReferenceCapability;
  status: "complete" | "incomplete" | "implausible";
  selectedPar: 3 | 4 | 5;
  recommendedPar: 3 | 4 | 5;
  alternativePar: 3 | 4 | 5 | null;
  planPar: 3 | 4 | 5;
  fullShots: number;
  expectedPutts: 2;
  effectiveYardage: number;
  segments: ArchitectureReferenceSegment[];
  landingZones: ArchitectureLandingZone[];
  warnings: string[];
  explanation: string;
  corridor: Record<Terrain, number> & { samples: number };
}

export interface ReferenceConsumerSummary {
  teeSet: TeeSet;
  pinRotation: PinRotation;
  architectureScore: number;
  safetyScore: number;
  courseRating: number;
  slope: number;
  effectiveYardage: number;
}

export type ArchitectureReferencePlanSet = ArchitectureReferencePlan[] & { referenceSummary?: ReferenceConsumerSummary };

interface Candidate {
  point: Point;
  guideDistance: number;
  lie: Terrain;
  landing: ReturnType<typeof landingFacts>;
}

interface Transition {
  segment: ArchitectureReferenceSegment;
  score: number;
}

const HAZARDS = new Set<Terrain>(["water", "wetland", "sand", "waste_area", "deep_rough"]);
const PLAYABLE = new Set<Terrain>(["tee", "fairway", "rough", "green", "path"]);
const cache = new WeakMap<Course, Map<string, ArchitectureReferencePlan>>();
const geometryVersions = new WeakMap<Course, string>();
let diagnostics = { requests: 0, cacheHits: 0, retainedHits: 0, solves: 0 };
const diagnosticsEnabled = import.meta.env.DEV || import.meta.env.MODE === "test";
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const key = (point: Point) => `${point.x}:${point.y}`;
const inBounds = (course: Course, point: Point) => point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
const terrainAt = (course: Course, point: Point): Terrain => inBounds(course, point) ? course.tiles[point.y * course.width + point.x] : "water";

function recordDiagnostic(metric: keyof typeof diagnostics): void {
  if (!diagnosticsEnabled) return;
  diagnostics[metric]++;
  if (typeof window !== "undefined") {
    (window as unknown as { __ccReferencePlanDiagnostics?: typeof diagnostics }).__ccReferencePlanDiagnostics = { ...diagnostics };
  }
}

function referenceGolfer(course: Course, capability: ArchitectureReferenceCapability): GolferProfile {
  const runout = capability.teeTotalYards - capability.teeCarryYards;
  const clubs: ClubSpec[] = [
    { name: "Reference driver", carryYards: capability.teeCarryYards, dispersionTilesBase: capability.dispersionTiles },
    { name: "Reference fairway wood", carryYards: Math.round(capability.teeCarryYards * .88), dispersionTilesBase: capability.dispersionTiles * .88 },
    { name: "Reference long iron", carryYards: capability.approachCarryYards, dispersionTilesBase: capability.dispersionTiles * .72 },
    { name: "Reference mid iron", carryYards: Math.round(capability.approachCarryYards * .8), dispersionTilesBase: capability.dispersionTiles * .58 },
    { name: "Reference wedge", carryYards: Math.round(capability.approachCarryYards * .61), dispersionTilesBase: capability.dispersionTiles * .43 },
  ];
  return {
    name: "SCRATCH",
    yardsPerTile: course.yardsPerTile,
    clubs: clubs.map((club, index) => ({ ...club, carryYards: club.carryYards + (index === 0 ? 0 : Math.round(runout * .08)) })),
    ratingMultipliers: { hazard: 1, rough: 1, deepRough: 1, obstacle: 1 },
  };
}

function bresenham(a: Point, b: Point): Point[] {
  const result: Point[] = [];
  let x = Math.round(a.x), y = Math.round(a.y);
  const x1 = Math.round(b.x), y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    result.push({ x, y });
    if (x === x1 && y === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
  return result;
}

function segmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return distance(point, from);
  const t = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared);
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}

function landingFacts(course: Course, target: Point, dispersionTiles: number) {
  const radius = Math.max(1, Math.ceil(dispersionTiles));
  let samples = 0, playable = 0, hazards = 0, out = 0;
  for (let y = target.y - radius; y <= target.y + radius; y++) for (let x = target.x - radius; x <= target.x + radius; x++) {
    if (Math.hypot(x - target.x, y - target.y) > dispersionTiles + .25) continue;
    samples++;
    const point = { x, y };
    if (!inBounds(course, point)) { out++; continue; }
    const terrain = terrainAt(course, point);
    if (PLAYABLE.has(terrain)) playable++;
    if (HAZARDS.has(terrain)) hazards++;
  }
  return {
    radiusTiles: dispersionTiles,
    playableShare: samples ? playable / samples : 0,
    hazardShare: samples ? hazards / samples : 1,
    outOfBoundsShare: samples ? out / samples : 1,
  };
}

function guidePoints(hole: Hole, tee: Point, pin: Point): Point[] {
  const points = [tee, ...(hole.waypoints ?? []), pin]
    .filter((point, index, values) => index === 0 || key(point) !== key(values[index - 1]));
  // Authored waypoints convey a dogleg/corner, but dense paint-derived chains
  // are only a guide. Retain at most two decisive turns; the output remains
  // straight shot chords between discrete targets.
  if (points.length <= 4) return points;
  const middle = points.slice(1, -1);
  const first = middle[Math.floor((middle.length - 1) / 3)];
  const second = middle[Math.floor((middle.length - 1) * 2 / 3)];
  return [tee, first, second, pin].filter((point, index, values) => index === 0 || key(point) !== key(values[index - 1]));
}

function pathLength(points: Point[]): number {
  return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
}

function pointAlong(points: Point[], fraction: number): Point {
  const total = pathLength(points);
  let remaining = total * clamp(fraction);
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], to = points[index];
    const length = distance(from, to);
    if (remaining <= length || index === points.length - 1) {
      const t = length ? remaining / length : 0;
      return { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
    }
    remaining -= length;
  }
  return points.at(-1)!;
}

function candidatesForStage(course: Course, guide: Point[], stage: number, shots: number, capability: ArchitectureReferenceCapability, buildings: Set<number>): Candidate[] {
  const ideal = pointAlong(guide, stage / shots);
  const radius = Math.max(6, Math.ceil(capability.dispersionTiles + 3));
  const result = new Map<string, Candidate>();
  for (let y = ideal.y - radius; y <= ideal.y + radius; y++) for (let x = ideal.x - radius; x <= ideal.x + radius; x++) {
    const point = { x, y };
    if (!inBounds(course, point) || buildings.has(y * course.width + x)) continue;
    const lie = terrainAt(course, point);
    if (lie === "water" || lie === "wetland") continue;
    const landing = landingFacts(course, point, capability.dispersionTiles);
    if (landing.playableShare < .18 || landing.outOfBoundsShare > .34) continue;
    result.set(key(point), { point, guideDistance: distance(point, ideal), lie, landing });
  }
  return [...result.values()]
    .sort((a, b) => (b.landing.playableShare - b.landing.hazardShare) - (a.landing.playableShare - a.landing.hazardShare) || a.guideDistance - b.guideDistance || key(a.point).localeCompare(key(b.point)))
    // Fourteen deterministic landing candidates keep the two-layer dynamic
    // program inside the 750 ms editor budget on a 36-hole estate. Candidate
    // ordering still preserves the best playable, low-risk guide points.
    .slice(0, 14);
}

function runoutRisk(course: Course, from: Point, target: Point, runoutTiles: number, buildings: Set<number>): number {
  if (runoutTiles <= .5) return 0;
  const dx = target.x - from.x, dy = target.y - from.y;
  const length = Math.max(.001, Math.hypot(dx, dy));
  let risk = 0;
  for (let step = 1; step <= Math.ceil(runoutTiles); step++) {
    const point = { x: Math.round(target.x + dx / length * step), y: Math.round(target.y + dy / length * step) };
    if (!inBounds(course, point)) { risk += 1; continue; }
    if (buildings.has(point.y * course.width + point.x)) { risk += 1; continue; }
    const terrain = terrainAt(course, point);
    risk += terrain === "water" || terrain === "wetland" ? 1 : terrain === "sand" || terrain === "deep_rough" ? .5 : 0;
  }
  return clamp(risk / Math.max(1, Math.ceil(runoutTiles)));
}

function blockerRisk(course: Course, from: Point, to: Point, buildings: Set<number>, obstacles: Course["obstacles"]): { risk: number; impossible: boolean; explanation: string[] } {
  const line = bresenham(from, to);
  const explanations: string[] = [];
  let risk = 0;
  for (let index = 1; index < line.length - 1; index++) {
    const point = line[index];
    if (buildings.has(point.y * course.width + point.x)) return { risk: 1, impossible: true, explanation: ["A structure blocks the flight corridor."] };
  }
  const minX = Math.min(from.x, to.x) - 1, maxX = Math.max(from.x, to.x) + 1;
  const minY = Math.min(from.y, to.y) - 1, maxY = Math.max(from.y, to.y) + 1;
  for (const obstacle of obstacles) {
    if (obstacle.x < minX || obstacle.x > maxX || obstacle.y < minY || obstacle.y > maxY) continue;
    const proximity = segmentDistance(obstacle, from, to);
    if (proximity > (obstacle.type === "tree" ? .82 : .55)) continue;
    const fromDistance = distance(from, obstacle);
    const toDistance = distance(to, obstacle);
    if (fromDistance < 1.5 || toDistance < 1.5) continue;
    if (obstacle.type === "tree") {
      risk += .18;
      explanations.push("Tree clearance narrows the flight window.");
    } else if (obstacle.type === "rock") {
      risk += .1;
      explanations.push("A rock constrains the landing corridor.");
    } else risk += .04;
  }
  return { risk: clamp(risk), impossible: false, explanation: explanations };
}

function bestTransition(args: {
  course: Course;
  from: Point;
  to: Candidate;
  pin: Point;
  shot: number;
  shots: number;
  capability: ArchitectureReferenceCapability;
  golfer: GolferProfile;
  buildings: Set<number>;
  obstacles: Course["obstacles"];
}): Transition | null {
  const { course, from, to, pin, shot, shots, capability, golfer, buildings, obstacles } = args;
  const blocker = blockerRisk(course, from, to.point, buildings, obstacles);
  if (blocker.impossible) return null;
  let best: Transition | null = null;
  for (const club of golfer.clubs) {
    const driverRunout = capability.teeTotalYards - capability.teeCarryYards;
    const runoutYards = club === golfer.clubs[0] ? driverRunout : Math.max(3, driverRunout * club.carryYards / capability.teeCarryYards * .42);
    const maxTotal = club.carryYards + runoutYards;
    const flatYards = distance(from, to.point) * course.yardsPerTile;
    // A conservative flat-distance rejection avoids the expensive slope,
    // carry-line, and landing evaluation for clubs that cannot reach even
    // with a generous downhill allowance. The authoritative plays-like check
    // below remains unchanged for every remotely viable club.
    if (flatYards > maxTotal * 1.2) continue;
    const evaluation = evalShotExpectedCost({ course, from, to: to.point, golfer, club });
    if (!evaluation.isValid || !Number.isFinite(evaluation.expectedShotCost)) continue;
    // A drive or running approach may finish on the green beyond its airborne
    // carry. Cross-hazard validity still uses the club's true carry through
    // evalShotExpectedCost, while runout risk checks the ground after landing.
    if (evaluation.distanceYards > maxTotal * 1.03) continue;
    if (evaluation.distanceYards < 35 && distance(from, pin) * course.yardsPerTile > 70) continue;
    const runout = runoutRisk(course, from, to.point, runoutYards / course.yardsPerTile, buildings);
    const remainingYards = distance(to.point, pin) * course.yardsPerTile;
    const remainingShots = shots - shot;
    const nextShot = remainingShots === 0 ? 0 : clamp(Math.max(0, remainingYards - remainingShots * capability.teeTotalYards) / capability.teeTotalYards);
    const risk = {
      landing: clamp(evaluation.expectedLandingPenalty / 2.6),
      carry: clamp(evaluation.expectedCarryPenalty / 2.6),
      blockers: blocker.risk,
      outOfBounds: to.landing.outOfBoundsShare,
      runout,
      nextShot,
      total: 0,
    };
    risk.total = clamp(risk.landing * .28 + risk.carry * .28 + risk.blockers * .18 + risk.outOfBounds * .12 + risk.runout * .08 + risk.nextShot * .22);
    if (risk.total > .78 - capability.riskTolerance * .18) continue;
    const lieBonus = to.lie === "fairway" || to.lie === "green" || to.lie === "tee" ? -.16 : to.lie === "rough" ? 0 : .16;
    const score = evaluation.expectedShotCost + risk.total * 2.4 + to.guideDistance * .025 + nextShot * .8 + lieBonus;
    const segment: ArchitectureReferenceSegment = {
      id: `shot-${shot}`,
      shot,
      from,
      to: to.point,
      club: club.name,
      carryYards: club.carryYards,
      totalYards: Math.round(maxTotal),
      playsLikeYards: round(evaluation.distanceYards, 1),
      utilization: round(evaluation.utilization, 3),
      dispersionTiles: round(evaluation.dispersionTiles, 2),
      expectedCost: round(evaluation.expectedShotCost, 3),
      risk,
      explanation: [
        ...evaluation.debug,
        ...blocker.explanation,
        `landing:${Math.round(to.landing.playableShare * 100)}% playable`,
        `next:${Math.round(remainingYards)}yd`,
      ],
    };
    if (!best || score < best.score || (score === best.score && `${segment.club}:${key(segment.to)}`.localeCompare(`${best.segment.club}:${key(best.segment.to)}`) < 0)) best = { segment, score };
  }
  return best;
}

function planForShots(course: Course, hole: Hole, tee: Point, pin: Point, shots: number, capability: ArchitectureReferenceCapability, buildings: Set<number>, obstacles: Course["obstacles"]): ArchitectureReferenceSegment[] | null {
  const golfer = referenceGolfer(course, capability);
  const guide = guidePoints(hole, tee, pin);
  const layers: Candidate[][] = [
    [{ point: tee, guideDistance: 0, lie: terrainAt(course, tee), landing: landingFacts(course, tee, capability.dispersionTiles) }],
    ...Array.from({ length: Math.max(0, shots - 1) }, (_, index) => candidatesForStage(course, guide, index + 1, shots, capability, buildings)),
    [{ point: pin, guideDistance: 0, lie: terrainAt(course, pin), landing: landingFacts(course, pin, Math.max(1.2, capability.dispersionTiles * .7)) }],
  ];
  if (layers.some((layer) => layer.length === 0)) return null;
  let states = new Map<string, { score: number; segments: ArchitectureReferenceSegment[]; point: Point }>([[key(tee), { score: 0, segments: [], point: tee }]]);
  for (let shot = 1; shot <= shots; shot++) {
    const next = new Map<string, { score: number; segments: ArchitectureReferenceSegment[]; point: Point }>();
    for (const state of states.values()) for (const candidate of layers[shot]) {
      const transition = bestTransition({ course, from: state.point, to: candidate, pin, shot, shots, capability, golfer, buildings, obstacles });
      if (!transition) continue;
      const score = state.score + transition.score;
      const prior = next.get(key(candidate.point));
      if (!prior || score < prior.score) next.set(key(candidate.point), { score, segments: [...state.segments, transition.segment], point: candidate.point });
    }
    states = next;
    if (!states.size) return null;
  }
  return states.get(key(pin))?.segments ?? null;
}

function corridor(course: Course, segments: ArchitectureReferenceSegment[], tee?: Point | null, pin?: Point | null): ArchitectureReferencePlan["corridor"] {
  const result = { samples: 0, fairway: 0, rough: 0, deep_rough: 0, sand: 0, waste_area: 0, water: 0, wetland: 0, green: 0, tee: 0, path: 0 };
  const paths: Array<Pick<ArchitectureReferenceSegment, "from" | "to">> = segments.length ? segments : tee && pin ? [{ from: tee, to: pin }] : [];
  for (const segment of paths) for (const point of bresenham(segment.from, segment.to)) {
    result[terrainAt(course, point)]++;
    result.samples++;
  }
  return result;
}

function ambiguity(effectiveYards: number, recommended: 3 | 4 | 5, viable: Map<number, ArchitectureReferenceSegment[]>): 3 | 4 | 5 | null {
  if ((recommended === 3 || recommended === 4) && effectiveYards >= 210 && effectiveYards <= 290 && viable.has(recommended === 3 ? 2 : 1)) return recommended === 3 ? 4 : 3;
  if ((recommended === 4 || recommended === 5) && effectiveYards >= 400 && effectiveYards <= 535 && viable.has(recommended === 4 ? 3 : 2)) return recommended === 4 ? 5 : 4;
  return null;
}

function incompletePlan(course: Course, hole: Hole, teeSet: TeeSet, pinRotation: PinRotation, tee: Point | null, pin: Point | null, capability: ArchitectureReferenceCapability): ArchitectureReferencePlan {
  const selected = getParSetting(hole, teeSet);
  const selectedPar = selected.mode === "MANUAL" ? selected.par : 4;
  return {
    id: `${hole.id ?? "hole"}:${teeSet}:${pinRotation}`,
    version: `reference-${hashCanonicalValue({ tee, pin, teeSet, pinRotation })}`,
    holeId: hole.id ?? "hole",
    teeSet,
    pinRotation,
    tee,
    pin,
    capability,
    status: "incomplete",
    selectedPar,
    recommendedPar: 4,
    alternativePar: null,
    planPar: selectedPar,
    fullShots: 0,
    expectedPutts: 2,
    effectiveYardage: 0,
    segments: [],
    landingZones: [],
    warnings: [!tee ? `Place a ${teeSet} tee before calculating its reference plan.` : `Place pin ${pinRotation} before calculating its reference plan.`],
    explanation: "The selected tee and pin setup is incomplete.",
    corridor: corridor(course, []),
  };
}

export function buildArchitectureReferencePlan(course: Course, hole: Hole, teeSet: TeeSet = "member", pinRotation: PinRotation = "A"): ArchitectureReferencePlan {
  recordDiagnostic("requests");
  let plans = cache.get(course);
  if (!plans) { plans = new Map(); cache.set(course, plans); }
  const cacheKey = `${hole.id ?? course.holes.indexOf(hole)}:${teeSet}:${pinRotation}`;
  const cached = plans.get(cacheKey);
  if (cached) {
    recordDiagnostic("cacheHits");
    return cached;
  }
  const retained = retainedArchitectureReferencePlan(course, hole, teeSet, pinRotation);
  if (retained) {
    recordDiagnostic("retainedHits");
    plans.set(cacheKey, retained);
    return retained;
  }
  recordDiagnostic("solves");
  const tee = getTeeBox(hole, teeSet);
  const pin = getPinPosition(hole, pinRotation);
  const capability = ARCHITECTURE_REFERENCE_CAPABILITIES[teeSet];
  if (!tee || !pin || !inBounds(course, tee) || !inBounds(course, pin)) {
    const result = incompletePlan(course, hole, teeSet, pinRotation, tee, pin, capability);
    plans.set(cacheKey, result);
    retainArchitectureReferencePlan(course, hole, result);
    return result;
  }
  const buildings = buildingFootprintSet(course);
  // Reference planning is neutral architecture, not a daily turf forecast.
  // Supplying the authored terrain directly also prevents every candidate
  // club evaluation from rebuilding an effective-surface course wrapper.
  const planningCourse = course.surfaceCare == null ? course : { ...course, surfaceCare: undefined };
  const guide = guidePoints(hole, tee, pin);
  const margin = Math.max(7, Math.ceil(capability.dispersionTiles) + 4);
  const minX = Math.min(...guide.map((point) => point.x)) - margin, maxX = Math.max(...guide.map((point) => point.x)) + margin;
  const minY = Math.min(...guide.map((point) => point.y)) - margin, maxY = Math.max(...guide.map((point) => point.y)) + margin;
  const obstacles = course.obstacles.filter((obstacle) => obstacle.x >= minX && obstacle.x <= maxX && obstacle.y >= minY && obstacle.y <= maxY);
  const viable = new Map<number, ArchitectureReferenceSegment[]>();
  let recommendedShots: 1 | 2 | 3 = 3;
  for (const shots of [1, 2, 3] as const) {
    const segments = planForShots(planningCourse, hole, tee, pin, shots, capability, buildings, obstacles);
    if (!segments?.length) continue;
    viable.set(shots, segments);
    recommendedShots = shots;
    break;
  }
  const recommendedPar = (recommendedShots + 2) as 3 | 4 | 5;
  const setting = getParSetting(hole, teeSet);
  const selectedPar = setting.mode === "MANUAL" ? setting.par : recommendedPar;
  const requestedShots = selectedPar - 2;
  const directYards = distance(tee, pin) * course.yardsPerTile;
  const ambiguityShots = recommendedPar === 3 && directYards >= 210 && directYards <= 290 ? 2
    : recommendedPar === 4 && directYards >= 400 && directYards <= 535 ? 3
      : null;
  for (const shots of new Set([requestedShots, ambiguityShots].filter((value): value is number => value != null))) {
    if (shots < 1 || shots > 3 || viable.has(shots)) continue;
    const candidate = planForShots(planningCourse, hole, tee, pin, shots, capability, buildings, obstacles);
    if (candidate?.length === shots) viable.set(shots, candidate);
  }
  const selectedSegments = viable.get(requestedShots);
  const segments = selectedSegments ?? viable.get(recommendedShots) ?? [];
  const planPar = segments.length ? (segments.length + 2) as 3 | 4 | 5 : recommendedPar;
  const effectiveYardage = Math.round(segments.length ? segments.reduce((sum, segment) => sum + segment.playsLikeYards, 0) : directYards);
  const warnings: string[] = [];
  if (setting.mode === "MANUAL" && !selectedSegments) warnings.push(`Manual Par ${selectedPar} is preserved for ${teeSet}, but the neutral reference cannot produce ${requestedShots} plausible full ${requestedShots === 1 ? "shot" : "shots"}; showing the recommended Par ${recommendedPar} route.`);
  const maxRisk = Math.max(0, ...segments.map((segment) => segment.risk.total));
  if (maxRisk > .42) warnings.push(`The reference route contains a marginal carry or landing window (${Math.round(maxRisk * 100)}% composite risk).`);
  const alternativePar = ambiguity(effectiveYardage, recommendedPar, viable);
  if (alternativePar) warnings.push(`At ${effectiveYardage} yards this setup overlaps the documented Par ${recommendedPar}/Par ${alternativePar} ambiguity band.`);
  const landingZones: ArchitectureLandingZone[] = segments.slice(0, -1).map((segment) => {
    const facts = landingFacts(course, segment.to, segment.dispersionTiles);
    return {
      id: `${cacheKey}:landing-${segment.shot}`,
      shot: segment.shot,
      center: segment.to,
      radiusTiles: segment.dispersionTiles,
      lie: terrainAt(course, segment.to),
      playableShare: round(facts.playableShare, 3),
      hazardShare: round(facts.hazardShare, 3),
      nextShotYards: Math.round(distance(segment.to, pin) * course.yardsPerTile),
    };
  });
  let courseGeometryVersion = geometryVersions.get(course);
  if (!courseGeometryVersion) {
    courseGeometryVersion = hashCanonicalValue({
      width: course.width,
      height: course.height,
      yardsPerTile: course.yardsPerTile,
      tiles: course.tiles,
      elevations: course.elevations,
      obstacles: course.obstacles,
      buildings: course.buildings,
    });
    geometryVersions.set(course, courseGeometryVersion);
  }
  const version = `reference-${hashCanonicalValue({ courseGeometryVersion, tee, pin, teeSet, pinRotation, par: setting, waypoints: hole.waypoints, capability })}`;
  const result: ArchitectureReferencePlan = {
    id: cacheKey,
    version,
    holeId: hole.id ?? "hole",
    teeSet,
    pinRotation,
    tee,
    pin,
    capability,
    status: segments.length ? selectedSegments || setting.mode === "AUTO" ? "complete" : "implausible" : "implausible",
    selectedPar,
    recommendedPar,
    alternativePar,
    planPar,
    fullShots: segments.length,
    expectedPutts: 2,
    effectiveYardage,
    segments,
    landingZones,
    warnings,
    explanation: segments.length
      ? `${teeSet} reference: ${segments.length} full ${segments.length === 1 ? "shot" : "shots"} to pin ${pinRotation}, then the two-putt convention (recommended Par ${recommendedPar}${alternativePar ? `; credible Par ${alternativePar} alternative` : ""}).`
      : `No plausible neutral reference route reaches pin ${pinRotation} from the ${teeSet} tee in three full shots.`,
    corridor: corridor(course, segments, tee, pin),
  };
  plans.set(cacheKey, result);
  retainArchitectureReferencePlan(course, hole, result);
  return result;
}

/**
 * Bounded planner instrumentation used by release certification and profiling.
 * It counts plan builds, not pointer events or render frames, so a consumer can
 * prove that repeated reads stay on the selected-plan cache instead of
 * accidentally launching full-estate solves.
 */
export function architectureReferencePlanDiagnostics(): Readonly<typeof diagnostics> {
  return { ...diagnostics };
}

export function resetArchitectureReferencePlanDiagnostics(): void {
  diagnostics = { requests: 0, cacheHits: 0, retainedHits: 0, solves: 0 };
  if (diagnosticsEnabled && typeof window !== "undefined") {
    (window as unknown as { __ccReferencePlanDiagnostics?: typeof diagnostics }).__ccReferencePlanDiagnostics = { ...diagnostics };
  }
}

export function architectureReferencePlans(course: Course, teeSet: TeeSet, pinRotation: PinRotation): ArchitectureReferencePlan[] {
  return course.holes.map((hole) => buildArchitectureReferencePlan(course, hole, teeSet, pinRotation));
}

export function analyzeReferencePlanArchitecture(
  course: Course,
  teeSet: TeeSet,
  pinRotation: PinRotation,
  plans: readonly ArchitectureReferencePlan[],
) {
  const byHole = new Map(plans.map((plan) => [plan.holeId, plan]));
  return analyzeArchitecture({
    ...course,
    holes: course.holes.map((hole) => {
      const plan = byHole.get(hole.id ?? "");
      return plan ? {
        ...hole,
        waypoints: plan.segments.slice(0, -1).map((segment) => segment.to),
      } : hole;
    }),
  }, { teeSet, pinRotation });
}

/** Deferred review solve: retain one set for every downstream reference consumer. */
export function architectureReferenceReview(course: Course, teeSet: TeeSet, pinRotation: PinRotation): ArchitectureReferencePlanSet {
  const plans = architectureReferencePlans(course, teeSet, pinRotation) as ArchitectureReferencePlanSet;
  const architecture = analyzeReferencePlanArchitecture(course, teeSet, pinRotation, plans);
  const rating = computeRatingForSetup(course, teeSet, pinRotation, plans);
  plans.referenceSummary = {
    teeSet,
    pinRotation,
    architectureScore: architecture.total,
    safetyScore: architecture.components.safety.score,
    courseRating: rating.courseRating,
    slope: rating.slope,
    effectiveYardage: rating.effectiveYardage,
  };
  return plans;
}

const bounded = <T>(values: T[], max: number) => values.length <= max ? values : Array.from({ length: max }, (_, index) => values[Math.floor(index * values.length / max)]);

/** Build the deferred overlay, explanations, and setup summary from that same plan set. */
export function withArchitectureReferencePlans(review: ArchitectureReviewData, plans: ArchitectureReferencePlan[] | null, course?: Course): ArchitectureReviewData {
  if (review.filters.kind !== "reference" || !plans) return review.referencePlans.length === 0 ? review : { ...review, referencePlans: [], selectedReferencePlan: null, referenceSummary: null };
  const selectedReferencePlan = review.filters.holeId === "all" ? null : plans.find((plan) => plan.holeId === review.filters.holeId) ?? null;
  const visiblePlans = selectedReferencePlan ? [selectedReferencePlan] : plans;
  const holeNumber = (plan: ArchitectureReferencePlan, fallback: number) => {
    const index = course?.holes.findIndex((hole) => hole.id === plan.holeId) ?? -1;
    return (index >= 0 ? index : fallback) + 1;
  };
  const overlay: ArchitectureOverlayRender = { kind: "reference", traces: [], cells: [], points: [] };
  overlay.traces = bounded(visiblePlans.flatMap((plan, holeIndex) => plan.segments.map((segment) => ({
    id: `${plan.id}:${segment.id}`,
    from: segment.from,
    to: segment.to,
    current: true,
    emphasized: plan.id === selectedReferencePlan?.id,
    label: `Hole ${holeNumber(plan, holeIndex)} · ${plan.teeSet} · shot ${segment.shot} · ${segment.playsLikeYards} yd · ${Math.round(segment.risk.total * 100)}% risk`,
    source: "reference" as const,
    pattern: "solid" as const,
  }))), 320);
  overlay.points = bounded(visiblePlans.flatMap((plan, holeIndex) => plan.landingZones.map((zone) => ({
    id: zone.id,
    x: zone.center.x,
    y: zone.center.y,
    value: Math.max(2, zone.radiusTiles),
    current: true,
    label: `Hole ${holeNumber(plan, holeIndex)} · shot ${zone.shot} landing · ${Math.round(zone.playableShare * 100)}% playable · ${zone.nextShotYards} yd next`,
    source: "reference" as const,
    pattern: "dots" as const,
  }))), 180);
  return { ...review, referencePlans: plans, selectedReferencePlan, referenceSummary: (plans as ArchitectureReferencePlanSet).referenceSummary ?? null, overlay };
}

export function flyoverReferencePlan(course: Course, activeHoleIndex: number, teeSet: TeeSet): ArchitectureReferencePlan | null {
  let hole = course.holes[activeHoleIndex];
  let plan = hole ? buildArchitectureReferencePlan(course, hole, teeSet, course.activePinRotation ?? "A") : null;
  if ((!plan?.tee || !plan.pin) && activeHoleIndex > 0) {
    hole = course.holes[activeHoleIndex - 1];
    plan = hole ? buildArchitectureReferencePlan(course, hole, teeSet, course.activePinRotation ?? "A") : null;
  }
  return plan;
}
