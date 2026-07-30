import type { Course, Hole, PinRotation, Point, TeeSet, Terrain } from "../models/types";
import { courseForLayout } from "../models/courseLayouts";
import { getParSetting, getPinPosition, getTeeBox, resolveCourseSetup } from "../models/courseSetup";
import { createGolferCapabilities } from "../live/capabilities";
import type { Personality } from "../live/personality";
import { generateStrategicHolePlan } from "../live/strategicOptions";
import { hashCanonicalValue } from "../../utils/stateHash";
import { computeAutoPar, computePathDistanceTiles } from "../sim/holeMetrics";
import type { M48CohortDefinition, M48CohortEvidence, M48OptionEvidence, M48OptionKind, M48StrategicEvaluation, M48StrategicHoleEvaluation, M48SetupKey } from "./m48Types";
import { M48_DEFAULT_SAMPLES, M48_MAX_HOLES, M48_MAX_OPTIONS, M48_STRATEGY_VERSION } from "./m48Types";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";

const cache = new Map<string, M48StrategicEvaluation>();
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const HAZARDS = new Set<Terrain>(["water", "wetland", "sand", "waste_area", "deep_rough"]);

const personality = (skill: number, consistency: number, difficulty: number, scenery = 0): Personality => ({
  skill,
  consistency,
  patience: difficulty < 0 ? .78 : .5,
  spendPropensity: .5,
  prefs: { difficulty, scenery, price: 0 },
});

export function m48Cohorts(seed = 480001): M48CohortDefinition[] {
  const definitions: Array<[M48CohortDefinition["id"], string, string, Personality]> = [
    ["power", "Power player", "Long carry creates opportunities, but accuracy and recovery still matter.", personality(.82, .68, .55)],
    ["accuracy", "Accuracy player", "Dispersion control makes narrow safe lines and precise layups valuable.", personality(.72, .95, -.05)],
    ["shortGame", "Short-game player", "Approach, run-up, and putting skill can rescue a conservative line.", personality(.64, .9, -.1)],
    ["recovery", "Recovery player", "Misses are acceptable when the design leaves a playable recovery.", personality(.58, .86, .15)],
    ["casual", "Casual golfer", "A fair route and visible mercy matter more than a forced test of skill.", personality(.36, .42, -.78, .45)],
  ];
  return definitions.map(([id, label, explanation, p], index) => ({
    id,
    label,
    explanation,
    capabilities: createGolferCapabilities({ personality: p, seed: (seed + index * 977) >>> 0 }),
  }));
}

export function strategicGeometryVersion(course: Course): string {
  return `m48-${hashCanonicalValue({
    width: course.width,
    height: course.height,
    tiles: course.tiles,
    elevations: course.elevations,
    obstacles: course.obstacles,
    holes: course.holes.map((hole) => ({
      id: hole.id,
      tee: hole.tee,
      green: hole.green,
      teeBoxes: hole.teeBoxes,
      pinPositions: hole.pinPositions,
      waypoints: hole.waypoints,
    })),
  })}`;
}

function inBounds(course: Course, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
}

function terrainAt(course: Course, point: Point): Terrain | null {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  return x >= 0 && y >= 0 && x < course.width && y < course.height ? course.tiles[y * course.width + x] ?? null : null;
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function pointAt(a: Point, b: Point, fraction: number, offset = 0): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(.001, Math.hypot(dx, dy));
  return { x: a.x + dx * fraction - dy / length * offset, y: a.y + dy * fraction + dx / length * offset };
}

function routePoints(hole: Hole): Point[] {
  if (!hole.tee || !hole.green) return [];
  return [hole.tee, ...(hole.waypoints ?? []), hole.green];
}

function densePath(points: Point[], samples = 24): Point[] {
  if (points.length < 2) return points.slice();
  const segments = points.slice(1).map((point, index) => [points[index], point] as const);
  const total = segments.reduce((sum, [from, to]) => sum + distance(from, to), 0);
  if (!total) return [points[0]];
  const result: Point[] = [];
  for (let index = 0; index < samples; index++) {
    let remaining = total * (index / Math.max(1, samples - 1));
    for (const [from, to] of segments) {
      const length = distance(from, to);
      if (remaining <= length || to === segments[segments.length - 1][1]) {
        const fraction = length ? remaining / length : 0;
        result.push({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
        break;
      }
      remaining -= length;
    }
  }
  return result;
}

function hazardRisk(terrain: Terrain | null): number {
  if (terrain === "water" || terrain === "wetland") return .98;
  if (terrain === "deep_rough") return .58;
  if (terrain === "waste_area") return .46;
  if (terrain === "sand") return .36;
  if (terrain === "rough") return .14;
  return terrain ? .03 : 1;
}

function lineFacts(course: Course, path: Point[]) {
  const samples = densePath(path, Math.max(28, Math.ceil(computePathDistanceTiles(path) * 2)));
  let risk = 0;
  let visual = 0;
  let safe = 0;
  let longestHazard = 0;
  let currentHazard = 0;
  for (const point of samples) {
    const terrain = terrainAt(course, point);
    const riskAtPoint = hazardRisk(terrain);
    risk += riskAtPoint;
    if (HAZARDS.has(terrain as Terrain)) {
      currentHazard++;
      visual += terrain === "water" || terrain === "wetland" ? 1 : .45;
    } else {
      safe++;
      longestHazard = Math.max(longestHazard, currentHazard);
      currentHazard = 0;
    }
  }
  longestHazard = Math.max(longestHazard, currentHazard);
  const count = Math.max(1, samples.length);
  return {
    hazardRisk: clamp(risk / count),
    safeSurface: clamp(safe / count),
    visualChallenge: clamp(visual / count * 1.45),
    contiguousHazard: longestHazard / count,
    sampleCount: samples.length,
  };
}

function deterministic(seed: number): () => number {
  let value = (seed >>> 0) || 1;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function optionPath(course: Course, hole: Hole, kind: M48OptionKind): Point[] {
  const tee = hole.tee;
  const green = hole.green;
  if (!tee || !green) return [];
  const waypoint = hole.waypoints?.[0];
  if (kind === "hero") return [tee, green];
  if (kind === "positional") return waypoint ? [tee, waypoint, green] : [tee, pointAt(tee, green, .58, 3), green];
  if (kind === "runup") return [tee, pointAt(tee, green, .72, -3.5), green];
  if (kind === "recovery") return [tee, pointAt(tee, green, .42, -4.5), pointAt(tee, green, .72, -4.5), green];
  const candidates = [
    [tee, pointAt(tee, green, .56, 4.5), pointAt(tee, green, .78, 4.5), green],
    [tee, pointAt(tee, green, .56, -4.5), pointAt(tee, green, .78, -4.5), green],
    waypoint ? [tee, waypoint, green] : [tee, pointAt(tee, green, .66, 0), green],
  ];
  return candidates
    .map((path) => ({ path, risk: lineFacts(course, path).hazardRisk, distance: computePathDistanceTiles(path) }))
    .sort((a, b) => a.risk - b.risk || a.distance - b.distance)[0].path;
}

function planKind(kind: M48OptionKind): "safe" | "hero" | "positional" | "recovery" {
  return kind === "runup" ? "positional" : kind;
}

function setupKey(hole: Hole, teeSet: TeeSet, pinRotation: PinRotation): M48SetupKey {
  const resolved = resolveCourseSetup(hole, teeSet, pinRotation);
  return { teeSet: resolved.teeSet, pinRotation: resolved.pinRotation, usedTeeFallback: resolved.usedTeeFallback, usedPinFallback: resolved.usedPinFallback };
}

function evaluateOption(args: {
  course: Course;
  hole: Hole;
  cohort: M48CohortDefinition;
  kind: M48OptionKind;
  samples: number;
  seed: number;
  par: number;
}): M48OptionEvidence {
  const path = optionPath(args.course, args.hole, args.kind);
  const facts = lineFacts(args.course, path);
  const plan = generateStrategicHolePlan({
    course: args.course,
    hole: args.hole,
    par: args.par,
    capabilities: args.cohort.capabilities,
    personality: personality(.5, args.cohort.capabilities.consistency / 100, args.cohort.capabilities.riskTolerance > .66 ? .6 : -.15),
  });
  const relevant = [plan.chosen, ...plan.rejected.map((item) => ({ expectedStrokes: item.expectedStrokes, kind: item.kind }))]
    .find((candidate) => candidate.kind === planKind(args.kind)) ?? plan.chosen;
  const powerCarry = 2.2 + args.cohort.capabilities.power / 55;
  const forcedCarry = clamp(facts.contiguousHazard * computePathDistanceTiles(path) / Math.max(3, 3 + powerCarry * 1.2));
  const skillRiskReduction = args.cohort.capabilities.accuracy / 100 * .22 + args.cohort.capabilities.recovery / 100 * .13;
  const adjustedRisk = clamp((facts.hazardRisk + facts.contiguousHazard * .42) * (1 - skillRiskReduction));
  const viable = facts.safeSurface >= .42 && forcedCarry < .7 && adjustedRisk < .62;
  const riskPenalty = adjustedRisk * (1.18 - args.cohort.capabilities.riskTolerance * .42) + forcedCarry * (1 - args.cohort.capabilities.riskTolerance) * .78;
  const capabilityBonus = args.kind === "hero" ? args.cohort.capabilities.power / 650 : args.kind === "safe" ? args.cohort.capabilities.accuracy / 720 : args.cohort.capabilities.shortGame / 740;
  const base = Number.isFinite(relevant.expectedStrokes) ? relevant.expectedStrokes : args.par + 1;
  const rng = deterministic(args.seed);
  const scores: number[] = [];
  for (let index = 0; index < args.samples; index++) {
    const noise = (rng() - .5) * (1 - args.cohort.capabilities.consistency / 100) * .62;
    scores.push(Math.max(1, base + riskPenalty - capabilityBonus + noise));
  }
  const expected = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
  const variance = scores.reduce((sum, value) => sum + (value - expected) ** 2, 0) / Math.max(1, scores.length);
  const bailoutQuality = clamp(facts.safeSurface * (1 - adjustedRisk) * (args.kind === "safe" || args.kind === "recovery" ? 1.12 : .72));
  const heroReward = 0;
  return {
    id: `${args.hole.id ?? "hole"}-${args.kind}`,
    kind: args.kind,
    label: args.kind === "hero" ? "Hero line" : args.kind === "safe" ? "Safe route" : args.kind === "runup" ? "Run-up" : args.kind === "recovery" ? "Recovery line" : "Positional line",
    geometry: path,
    location: path[Math.floor(path.length / 2)] ?? args.hole.green ?? args.hole.tee!,
    viable,
    safeSurface: round(facts.safeSurface),
    hazardRisk: round(adjustedRisk),
    forcedCarryBurden: round(forcedCarry),
    bailoutQuality: round(bailoutQuality),
    heroLineReward: round(heroReward),
    expectedStrokes: round(expected),
    variance: round(variance),
    recoveryBurden: round(adjustedRisk * (1 - args.cohort.capabilities.recovery / 100)),
    sampleCount: args.samples,
    sampleStatus: args.samples > 0 ? "simulated" : "insufficient",
    facts: [
      `surface:${Math.round(facts.safeSurface * 100)}%`,
      `hazard:${Math.round(adjustedRisk * 100)}%`,
      `carry:${Math.round(forcedCarry * 100)}%`,
      `capability:${args.cohort.capabilities.strengths.join(",")}`,
    ],
  };
}

function holeEvaluation(args: { course: Course; hole: Hole; holeIndex: number; setup: M48SetupKey; geometryVersion: string; samples: number; seed: number }): M48StrategicHoleEvaluation {
  const id = `${args.hole.id ?? `hole-${args.holeIndex + 1}`}:${args.setup.teeSet}:${args.setup.pinRotation}`;
  if (!args.hole.tee || !args.hole.green || !inBounds(args.course, args.hole.tee) || !inBounds(args.course, args.hole.green)) {
    return { version: M48_STRATEGY_VERSION, id, holeId: args.hole.id ?? `hole-${args.holeIndex + 1}`, holeIndex: args.holeIndex, setup: args.setup, geometryVersion: args.geometryVersion, status: "incomplete", sampleCount: 0, safeRouteViability: 0, optionCount: 0, forcedCarryBurden: 0, bailoutQuality: 0, heroLineReward: 0, expectedStrokes: 0, variance: 0, recoveryBurden: 0, visualChallenge: 0, fairnessFloor: 0, strategicSeparation: 0, unavoidablePunishment: 0, cohorts: [], options: [], warnings: ["Complete the tee and pin setup before evaluating strategy."] };
  }
  const parSetting = getParSetting(args.hole, args.setup.teeSet);
  const par = parSetting.mode === "MANUAL" ? parSetting.par : computeAutoPar(computePathDistanceTiles(routePoints(args.hole)));
  const definitions = m48Cohorts(args.seed);
  const kinds: M48OptionKind[] = ["safe", "hero", "positional", "runup", "recovery"];
  const options = definitions.flatMap((cohort, cohortIndex) => kinds.map((kind) => evaluateOption({ course: args.course, hole: args.hole, cohort, kind, samples: args.samples, seed: args.seed + cohortIndex * 101 + kinds.indexOf(kind) * 17, par })));
  const byKind = kinds.map((kind) => options.filter((option) => option.kind === kind));
  const optionSummary = byKind.map((items) => ({ ...items[0], expectedStrokes: items.reduce((sum, item) => sum + item.expectedStrokes, 0) / Math.max(1, items.length), viable: items.some((item) => item.viable), bailoutQuality: items.reduce((sum, item) => sum + item.bailoutQuality, 0) / Math.max(1, items.length), forcedCarryBurden: items.reduce((sum, item) => sum + item.forcedCarryBurden, 0) / Math.max(1, items.length), heroLineReward: items.reduce((sum, item) => sum + item.heroLineReward, 0) / Math.max(1, items.length) }));
  const cohortEvidence: M48CohortEvidence[] = definitions.map((cohort) => {
    const items = options.filter((option) => option.facts.some((fact) => fact === `capability:${cohort.capabilities.strengths.join(",")}`));
    const safeItem = items.find((item) => item.kind === "safe");
    const heroItem = items.find((item) => item.kind === "hero");
    if (safeItem && heroItem) heroItem.heroLineReward = round(clamp((safeItem.expectedStrokes - heroItem.expectedStrokes) / 2));
    const viable = items.filter((item) => item.viable);
    const ordered = items.slice().sort((a, b) => a.expectedStrokes - b.expectedStrokes || a.id.localeCompare(b.id));
    const preferred = ordered[0];
    const mean = items.length ? items.reduce((sum, item) => sum + item.expectedStrokes, 0) / items.length : args.course.yardsPerTile;
    return {
      cohortId: cohort.id,
      viability: round(clamp((viable.length ? viable.length / Math.max(1, items.length) : 0) * .65 + (preferred?.viable ? .35 : 0)) * 100, 1),
      preferredOption: preferred?.kind ?? null,
      expectedStrokes: round(preferred?.expectedStrokes ?? mean, 2),
      variance: round(preferred?.variance ?? 1, 3),
      recoveryBurden: round(preferred?.recoveryBurden ?? 1, 3),
      skillAdvantageDelta: 0,
      options: items.map((item) => ({ optionId: item.id, viable: item.viable, expectedStrokes: item.expectedStrokes, variance: item.variance, advantageDelta: 0 })),
      facts: [`${viable.length} of ${items.length} options remain viable`, `preferred:${preferred?.label ?? "none"}`],
    };
  });
  const meanExpected = cohortEvidence.length ? cohortEvidence.reduce((sum, item) => sum + item.expectedStrokes, 0) / cohortEvidence.length : 0;
  for (const cohort of cohortEvidence) {
    cohort.skillAdvantageDelta = round(meanExpected - cohort.expectedStrokes, 2);
    cohort.options = cohort.options.map((item) => ({ ...item, advantageDelta: round(meanExpected - item.expectedStrokes, 2) }));
  }
  const safe = cohortEvidence.length ? cohortEvidence.reduce((sum, item) => sum + item.viability, 0) / cohortEvidence.length : 0;
  const optionCount = optionSummary.filter((item) => item.viable && item.bailoutQuality > .18).length;
  const fairnessFloor = Math.min(...cohortEvidence.map((item) => item.viability), 0);
  const separation = cohortEvidence.length ? clamp((Math.max(...cohortEvidence.map((item) => item.skillAdvantageDelta), 0) - Math.min(...cohortEvidence.map((item) => item.skillAdvantageDelta), 0)) / 2) * 100 : 0;
  const hero = optionSummary.find((item) => item.kind === "hero");
  const safeOption = optionSummary.find((item) => item.kind === "safe");
  const forcedCarry = hero?.forcedCarryBurden ?? 0;
  const unavoidable = clamp(1 - optionSummary.filter((item) => item.viable).length / kinds.length);
  const visualChallenge = clamp(optionSummary.reduce((sum, item) => sum + item.hazardRisk, 0) / Math.max(1, optionSummary.length) * 1.1) * 100;
  const warnings: string[] = [];
  if (fairnessFloor < 42) warnings.push("One or more representative cohorts have no fair route.");
  if (optionCount < 2) warnings.push("The design offers fewer than two meaningful options.");
  if (forcedCarry > .72 && unavoidable > .5) warnings.push("The most visible challenge behaves like an unavoidable carry.");
  if (separation < 8) warnings.push("The hole does not visibly reward a distinct capability.");
  return {
    version: M48_STRATEGY_VERSION,
    id,
    holeId: args.hole.id ?? `hole-${args.holeIndex + 1}`,
    holeIndex: args.holeIndex,
    setup: args.setup,
    geometryVersion: args.geometryVersion,
    status: "complete",
    sampleCount: args.samples,
    safeRouteViability: round(safe, 1),
    optionCount,
    forcedCarryBurden: round(forcedCarry * 100, 1),
    bailoutQuality: round((safeOption?.bailoutQuality ?? 0) * 100, 1),
    heroLineReward: round((hero?.heroLineReward ?? 0) * 100, 1),
    expectedStrokes: round(meanExpected, 2),
    variance: round(cohortEvidence.reduce((sum, item) => sum + item.variance, 0) / Math.max(1, cohortEvidence.length), 3),
    recoveryBurden: round(cohortEvidence.reduce((sum, item) => sum + item.recoveryBurden, 0) / Math.max(1, cohortEvidence.length), 3),
    visualChallenge: round(visualChallenge, 1),
    fairnessFloor: round(fairnessFloor, 1),
    strategicSeparation: round(separation, 1),
    unavoidablePunishment: round(unavoidable * 100, 1),
    cohorts: cohortEvidence,
    options: optionSummary.slice(0, M48_MAX_OPTIONS).map((option) => ({ ...option, expectedStrokes: round(option.expectedStrokes), bailoutQuality: round(option.bailoutQuality), forcedCarryBurden: round(option.forcedCarryBurden), heroLineReward: round(option.heroLineReward) })),
    warnings,
  };
}

function availableSetups(hole: Hole): Array<{ teeSet: TeeSet; pinRotation: PinRotation }> {
  const tees: TeeSet[] = (["forward", "member", "championship"] as const).filter((set) => !!getTeeBox(hole, set));
  const pins: PinRotation[] = (["A", "B", "C"] as const).filter((rotation) => !!getPinPosition(hole, rotation));
  const resolvedTees: TeeSet[] = tees.length ? tees : ["member"];
  const resolvedPins: PinRotation[] = pins.length ? pins : ["A"];
  return resolvedTees.flatMap((teeSet) => resolvedPins.map((pinRotation) => ({ teeSet, pinRotation })));
}

export function evaluateStrategicArchitecture(course: Course, options: { courseId?: string; samplesPerOption?: number; seed?: number } = {}): M48StrategicEvaluation {
  const selected = courseWithEffectiveSurfaces(
    courseForLayout(course, options.courseId ?? course.activeCourseId),
  );
  const samplesPerOption = Math.max(0, Math.min(M48_DEFAULT_SAMPLES, Math.floor(options.samplesPerOption ?? M48_DEFAULT_SAMPLES)));
  const geometryVersion = strategicGeometryVersion(selected);
  const conditionKey = Math.round(clamp(selected.condition, 0, 1) * 100);
  const key = `${selected.activeCourseId ?? "course"}:${geometryVersion}:${conditionKey}:${samplesPerOption}:${options.seed ?? 480001}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const published = selected.holes.slice(0, M48_MAX_HOLES);
  const holes: M48StrategicHoleEvaluation[] = [];
  for (let holeIndex = 0; holeIndex < published.length; holeIndex++) {
    const sourceHole = published[holeIndex];
    for (const setup of availableSetups(sourceHole)) {
      const resolved = resolveCourseSetup(sourceHole, setup.teeSet, setup.pinRotation);
      const parSetting = getParSetting(sourceHole, resolved.teeSet);
      const hole = { ...sourceHole, tee: resolved.tee, green: resolved.pin, parMode: parSetting.mode, parManual: parSetting.mode === "MANUAL" ? parSetting.par : undefined };
      holes.push(holeEvaluation({ course: selected, hole, holeIndex, setup: setupKey(sourceHole, setup.teeSet, setup.pinRotation), geometryVersion, samples: samplesPerOption, seed: (options.seed ?? 480001) + holeIndex * 811 + setup.teeSet.length * 31 + setup.pinRotation.charCodeAt(0) }));
    }
  }
  const result: M48StrategicEvaluation = { version: M48_STRATEGY_VERSION, geometryVersion, courseId: selected.activeCourseId ?? "course-primary", conditionKey, samplesPerOption, holes, cohorts: m48Cohorts(options.seed ?? 480001) };
  cache.set(key, result);
  return result;
}

export function strategicHoleForSetup(evaluation: M48StrategicEvaluation, holeId: string, teeSet: TeeSet, pinRotation: PinRotation): M48StrategicHoleEvaluation | undefined {
  return evaluation.holes.find((hole) => hole.holeId === holeId && hole.setup.teeSet === teeSet && hole.setup.pinRotation === pinRotation) ?? evaluation.holes.find((hole) => hole.holeId === holeId);
}

export function clearStrategicEvaluationCache(): void { cache.clear(); }
