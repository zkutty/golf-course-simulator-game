import type { Course, Hole, Point } from "../models/types";
import type { GolferProfile } from "../sim/golferProfiles";
import { evalShotExpectedCost } from "../sim/shots/evalShotExpectedCost";
import { getGolferProfile } from "../sim/golferProfiles";
import type { GolferCapabilities, RejectedAlternative, ShotIntent, StrategicHolePlan, StrategicIntentKind, StrategyFact } from "./m47Types";
import type { Personality } from "./personality";
import { terrainAt } from "./livePhysics";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const playable = new Set(["tee", "fairway", "rough", "deep_rough", "green", "sand", "waste_area"]);
const INTENTS: StrategicIntentKind[] = ["safe", "hero", "positional", "recovery", "approach"];
const CLUBS: Record<string, { carry: number; dispersion: number }> = {
  Driver: { carry: 270, dispersion: 3.7 },
  "3 Wood": { carry: 235, dispersion: 3.2 },
  "5 Iron": { carry: 185, dispersion: 2.55 },
  "7 Iron": { carry: 155, dispersion: 2.1 },
  "Pitching Wedge": { carry: 115, dispersion: 1.55 },
  "Sand Wedge": { carry: 78, dispersion: 1.35 },
  Chip: { carry: 38, dispersion: .82 },
  Putter: { carry: 28, dispersion: .38 },
};

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function unit(a: Point, b: Point): Point {
  const d = Math.max(.001, distance(a, b));
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
function pointAt(a: Point, b: Point, fraction: number, offset = 0): Point {
  const u = unit(a, b);
  return { x: a.x + (b.x - a.x) * fraction - u.y * offset, y: a.y + (b.y - a.y) * fraction + u.x * offset };
}
function inBounds(course: Course, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
}
function targetNear(course: Course, raw: Point, preferSafe: boolean): Point {
  const candidates: Point[] = [];
  for (let radius = 0; radius <= 5; radius++) {
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
      const candidate = { x: Math.round(raw.x + x), y: Math.round(raw.y + y) };
      if (inBounds(course, candidate) && playable.has(terrainAt(course, candidate))) candidates.push(candidate);
    }
    if (candidates.length) break;
  }
  if (!candidates.length) return { x: clamp(Math.round(raw.x), 0, course.width - 1), y: clamp(Math.round(raw.y), 0, course.height - 1) };
  return candidates.sort((a, b) => {
    const terrainScore = (point: Point) => {
      const terrain = terrainAt(course, point);
      if (terrain === "fairway" || terrain === "green" || terrain === "tee") return 0;
      if (terrain === "rough") return preferSafe ? 1 : 2;
      if (terrain === "deep_rough") return preferSafe ? 3 : 1;
      return preferSafe ? 4 : 0;
    };
    return terrainScore(a) - terrainScore(b) || distance(a, raw) - distance(b, raw) || a.y - b.y || a.x - b.x;
  })[0];
}

function profileFor(capabilities: GolferCapabilities, course: Course): GolferProfile {
  const base = getGolferProfile(capabilities.accuracy >= 65 ? "SCRATCH" : "BOGEY", course);
  const scale = (club: { name: string; carryYards: number; dispersionTilesBase: number }) => ({
    ...club,
    carryYards: club.carryYards * (.84 + capabilities.power / 480),
    dispersionTilesBase: club.dispersionTilesBase * (1.38 - capabilities.accuracy / 220),
  });
  return {
    ...base,
    clubs: base.clubs.map(scale),
    ratingMultipliers: {
      hazard: 1.42 - capabilities.recovery / 190,
      rough: 1.34 - capabilities.recovery / 210,
      deepRough: 1.62 - capabilities.recovery / 175,
      obstacle: 1.42 - capabilities.recovery / 190,
    },
  };
}

function chooseClub(kind: StrategicIntentKind, from: Point, target: Point, capabilities: GolferCapabilities, lie: string): { name: string; power: number } {
  const d = distance(from, target) * 10;
  const names = lie === "green" ? ["Putter", "Chip"] : kind === "hero" ? ["Driver", "3 Wood", "5 Iron"] : kind === "safe" ? ["3 Wood", "5 Iron", "Driver"] : ["Driver", "3 Wood", "5 Iron", "7 Iron", "Pitching Wedge"];
  const available = names.filter((name) => CLUBS[name]);
  const name = available.find((candidate) => CLUBS[candidate].carry * 1.1 >= d) ?? available[available.length - 1] ?? "7 Iron";
  const carry = CLUBS[name].carry * (.84 + capabilities.power / 480);
  return { name, power: clamp(d / Math.max(1, carry), .35, kind === "hero" ? 1.12 : .98) };
}

function candidateTarget(course: Course, hole: Hole, kind: StrategicIntentKind): Point {
  const tee = hole.tee!;
  const green = hole.green!;
  if (kind === "hero" || kind === "approach") return { ...green };
  if (kind === "safe") return targetNear(course, pointAt(tee, green, .66, 0), true);
  if (kind === "positional") {
    const waypoint = hole.waypoints?.[0];
    return targetNear(course, waypoint ? { ...waypoint } : pointAt(tee, green, .58, 3.5), true);
  }
  return targetNear(course, pointAt(tee, green, .46, -3.5), true);
}

function buildIntent(args: { course: Course; hole: Hole; kind: StrategicIntentKind; capabilities: GolferCapabilities; personality: Personality; profile: GolferProfile; }): ShotIntent {
  const from = { ...args.hole.tee! };
  const target = candidateTarget(args.course, args.hole, args.kind);
  const club = chooseClub(args.kind, from, target, args.capabilities, terrainAt(args.course, from));
  const clubSpec = args.profile.clubs.find((candidate) => candidate.name === club.name) ?? args.profile.clubs[0];
  const evaluation = evalShotExpectedCost({ course: args.course, from, to: target, golfer: args.profile, club: clubSpec });
  const terrain = terrainAt(args.course, target);
  const terrainRisk = terrain === "water" || terrain === "wetland" ? .95 : terrain === "deep_rough" ? .46 : terrain === "sand" || terrain === "waste_area" ? .32 : .08;
  const distanceRisk = clamp(evaluation.utilization - .82, 0, .4);
  const hazardRisk = clamp(terrainRisk + distanceRisk + clubSpec.dispersionTilesBase / 14, 0, 1);
  const variance = clamp((100 - args.capabilities.consistency) / 100 * .65 + hazardRisk * .35, .05, 1);
  const nextShotQuality = clamp((terrain === "fairway" || terrain === "green" ? .82 : terrain === "rough" ? .55 : .3) + args.capabilities.irons / 500, 0, 1);
  const capability = args.kind === "hero" ? args.capabilities.power : args.kind === "safe" ? args.capabilities.accuracy : args.kind === "recovery" ? args.capabilities.recovery : args.capabilities.irons;
  const facts: StrategyFact[] = [
    { code: "capability-fit", detail: `${args.kind}:${Math.round(capability)}` },
    { code: "risk", detail: `hazard:${Math.round(hazardRisk * 100)}% variance:${Math.round(variance * 100)}%` },
    { code: "terrain", detail: `landing:${terrain}` },
    { code: "next-shot", detail: `quality:${Math.round(nextShotQuality * 100)}%` },
    { code: "context", detail: `preference:${args.personality.prefs.difficulty.toFixed(2)}` },
  ];
  return {
    id: `${args.hole.id ?? "hole"}-${args.kind}`,
    kind: args.kind,
    from,
    target,
    club: club.name,
    power: club.power,
    technique: args.kind === "recovery" ? "punch" : "normal",
    expectedStrokes: 1 + Math.max(0, evaluation.expectedShotCost - 1) + hazardRisk * (1.25 - args.capabilities.riskTolerance),
    variance,
    hazardRisk,
    nextShotQuality,
    facts,
  };
}

export function generateStrategicHolePlan(args: {
  course: Course;
  hole: Hole;
  par: number;
  capabilities: GolferCapabilities;
  personality: Personality;
}): StrategicHolePlan {
  const profile = profileFor(args.capabilities, args.course);
  const candidates = INTENTS.map((kind) => buildIntent({ ...args, kind, profile }));
  const score = (intent: ShotIntent) => {
    const riskPenalty = intent.hazardRisk * (1 - args.capabilities.riskTolerance) * 1.4;
    const challengeBonus = intent.kind === "hero" ? args.capabilities.challengeSeeking * .25 : 0;
    const styleBonus = args.capabilities.riskStyle === "aggressive" && intent.kind === "hero"
      ? .18
      : args.capabilities.riskStyle === "conservative" && intent.kind === "safe"
        ? .18
        : args.capabilities.riskStyle === "balanced" && (intent.kind === "positional" || intent.kind === "approach")
          ? .1
          : 0;
    return intent.expectedStrokes + riskPenalty - challengeBonus - styleBonus - intent.nextShotQuality * .08;
  };
  const ordered = candidates.slice().sort((a, b) => score(a) - score(b) || INTENTS.indexOf(a.kind) - INTENTS.indexOf(b.kind));
  const chosen = ordered[0];
  const rejected: RejectedAlternative[] = ordered.slice(1, 4).map((alternative) => ({
    kind: alternative.kind,
    expectedStrokes: Number(alternative.expectedStrokes.toFixed(3)),
    reason: score(alternative) > score(chosen) + .25 ? "higher modeled risk or lower next-shot quality" : "slightly less fit for this golfer",
    facts: alternative.facts,
  }));
  return {
    version: 1,
    holeId: args.hole.id ?? `hole-${args.course.holes.indexOf(args.hole) + 1}`,
    par: args.par,
    expectedScore: Number((args.par + score(chosen) - 1).toFixed(3)),
    chosen,
    rejected,
  };
}

export function followUpIntent(args: {
  course: Course;
  hole: Hole;
  from: Point;
  lie: string;
  capabilities: GolferCapabilities;
  personality: Personality;
  shotNumber: number;
}): ShotIntent {
  const target = { ...args.hole.green! };
  const kind: StrategicIntentKind = args.lie === "rough" || args.lie === "deep_rough" || args.lie === "sand" || args.lie === "waste_area"
    ? "recovery"
    : distance(args.from, target) <= 5 ? "approach" : "positional";
  const profile = profileFor(args.capabilities, args.course);
  const intent = buildIntent({ course: args.course, hole: { ...args.hole, tee: args.from, green: target }, kind, capabilities: args.capabilities, personality: args.personality, profile });
  return { ...intent, id: `${args.hole.id ?? "hole"}-follow-${args.shotNumber}`, from: { ...args.from } };
}
