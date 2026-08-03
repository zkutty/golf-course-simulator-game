import type { Course, Hole, Point } from "../models/types";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import type { GolferProfile } from "../sim/golferProfiles";
import { evalShotExpectedCost } from "../sim/shots/evalShotExpectedCost";
import { getGolferProfile } from "../sim/golferProfiles";
import type { ShotFlightProfile, ShotLie } from "../rules/contracts";
import {
  availableShotClubs,
  calculateShotEffects,
  type CalculatedShotEffects,
  type ShotClubDefinition,
  type ShotTechnique,
} from "../rules/shotEffects";
import { resolveObstacleCollision } from "../rules/obstacleCollision";
import type { GolferCapabilities, RejectedAlternative, ShotIntent, StrategicHolePlan, StrategicIntentKind, StrategyFact } from "./m47Types";
import type { Personality } from "./personality";
import { liveCourseSnapshot, resolveLiveShot, terrainAt } from "./livePhysics";
import { analyzeShotSlope, resolveShotCurve, type ShotCurveTechnique } from "../models/shotSlope";
import { planGreenLandingZones, type GreenLandingCandidate } from "./greenLandingStrategy";
import { stableGolferHandedness } from "./capabilities";
import { shotSlopeEvidenceFacts } from "../models/shotSlopeEvidence";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const playable = new Set(["tee", "fairway", "rough", "deep_rough", "green", "sand", "waste_area"]);
const recoveryLies = new Set(["rough", "deep_rough", "sand", "waste_area"]);
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

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lieQuality(lie: string): number {
  if (lie === "cup") return 1;
  if (lie === "green") return .96;
  if (lie === "tee" || lie === "fairway") return .82;
  if (lie === "rough") return .58;
  if (lie === "waste_area") return .46;
  if (lie === "sand") return .42;
  if (lie === "deep_rough") return .34;
  return .08;
}

function segmentDistance(point: Point, from: Point, to: Point): { distance: number; progress: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return { distance: distance(point, from), progress: 0 };
  const progress = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared, 0, 1);
  return {
    distance: distance(point, { x: from.x + dx * progress, y: from.y + dy * progress }),
    progress,
  };
}

type RouteObstacle = {
  obstacle: Course["obstacles"][number];
  distance: number;
  progress: number;
};

function routeObstacle(course: Course, from: Point, to: Point): RouteObstacle | null {
  let best: RouteObstacle | null = null;
  for (const obstacle of course.obstacles) {
    const projection = segmentDistance(obstacle, from, to);
    if (projection.progress <= .015 || projection.progress >= .98 || projection.distance > 1.45) continue;
    const candidate: RouteObstacle = { obstacle, ...projection };
    if (!best
      || candidate.progress < best.progress
      || candidate.progress === best.progress && candidate.distance < best.distance
      || candidate.progress === best.progress && candidate.distance === best.distance && candidate.obstacle.x < best.obstacle.x
      || candidate.progress === best.progress && candidate.distance === best.distance && candidate.obstacle.x === best.obstacle.x && candidate.obstacle.y < best.obstacle.y) {
      best = candidate;
    }
  }
  return best;
}

function saferAroundTarget(course: Course, from: Point, green: Point, obstacle: Point | null, advance: number, side: -1 | 1): Point {
  const u = unit(from, green);
  const base = obstacle
    ? {
        x: obstacle.x + u.x * advance,
        y: obstacle.y + u.y * advance,
      }
    : {
        x: from.x + u.x * advance,
        y: from.y + u.y * advance,
      };
  const offset = obstacle ? 2.25 : 3.25;
  return targetNear(course, {
    x: base.x - u.y * offset * side,
    y: base.y + u.x * offset * side,
  }, true);
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

/** Counter-aims with the authoritative curve resolver; flight still applies it once. */
function slopeAwareAim(args: {
  course: Course;
  from: Point;
  desired: Point;
  club: string;
  technique: ShotCurveTechnique;
  capabilities: GolferCapabilities;
}): Point {
  const shotSlope = analyzeShotSlope({
    course: args.course,
    from: args.from,
    to: args.desired,
    yardsPerTile: args.course.yardsPerTile,
    handedness: stableGolferHandedness(args.capabilities.seed),
  });
  const length = distance(args.from, args.desired);
  const curve = resolveShotCurve({
    shotSlope,
    shotLengthTiles: length,
    club: args.club,
    technique: args.technique,
  }).combinedCurveTiles;
  if (Math.abs(curve) < 1e-9 || length < 1e-9) return { ...args.desired };
  const direction = unit(args.from, args.desired);
  return targetNear(args.course, {
    x: args.desired.x + direction.y * curve,
    y: args.desired.y - direction.x * curve,
  }, true);
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

export type RecoveryRoute = "safe" | "advance" | "hero";
export type RecoveryShape = "around" | "under" | "over";

interface RecoveryCandidateSpec {
  route: RecoveryRoute;
  shape: RecoveryShape;
  target: Point;
  technique: ShotTechnique;
  flightProfile: ShotFlightProfile;
}

interface LegalRecoverySelection {
  club: ShotClubDefinition;
  effects: CalculatedShotEffects;
  power: number;
}

function legalRecoverySelection(args: {
  course: Course;
  lie: ShotLie;
  from: Point;
  target: Point;
  route: RecoveryRoute;
  technique: ShotTechnique;
  flightProfile: ShotFlightProfile;
  capabilities: GolferCapabilities;
  yardsPerTile: number;
}): LegalRecoverySelection | null {
  const targetYards = analyzeShotSlope({
    course: args.course,
    from: args.from,
    to: args.target,
    yardsPerTile: args.yardsPerTile,
  }).playsLikeDistanceYards;
  const powerScale = .82 + args.capabilities.power / 500;
  const legal = availableShotClubs(args.lie).flatMap((club) => {
    const result = calculateShotEffects({
      clubId: club.id,
      lie: args.lie,
      recoverySkill: args.capabilities.recovery,
      technique: args.technique,
      flightProfile: args.flightProfile,
    });
    if (!result.ok) return [];
    const fullCarry = result.value.carryYards * powerScale;
    const power = clamp(targetYards / Math.max(1, fullCarry), .25, 1.15);
    const utilization = targetYards / Math.max(1, fullCarry * power);
    const routeBias = args.route === "safe"
      ? result.value.dispersionTiles * .08 + Math.abs(power - .72) * .22
      : args.route === "hero"
        ? Math.max(0, 1 - fullCarry / Math.max(1, targetYards)) * .8 - fullCarry / 2_000
        : result.value.dispersionTiles * .035 + Math.abs(power - .88) * .12;
    return [{ club, effects: result.value, power, score: Math.abs(1 - utilization) + routeBias }];
  });
  const selected = legal.sort((a, b) =>
    a.score - b.score
    || a.effects.dispersionTiles - b.effects.dispersionTiles
    || a.club.carryYards - b.club.carryYards
    || a.club.id.localeCompare(b.club.id),
  )[0];
  return selected ? { club: selected.club, effects: selected.effects, power: selected.power } : null;
}

function recoverySpecs(course: Course, hole: Hole, from: Point): RecoveryCandidateSpec[] {
  const green = { ...hole.green! };
  const route = routeObstacle(course, from, green);
  const obstacle = route?.obstacle ?? null;
  const remaining = distance(from, green);
  const safeAdvance = Math.min(Math.max(3, remaining * .16), 7);
  const positionalAdvance = Math.min(Math.max(7, remaining * .36), 16);
  const safeLeft = saferAroundTarget(course, from, green, obstacle, safeAdvance, -1);
  const safeRight = saferAroundTarget(course, from, green, obstacle, safeAdvance, 1);
  const saferSide = lieQuality(terrainAt(course, safeLeft)) > lieQuality(terrainAt(course, safeRight))
    ? -1
    : lieQuality(terrainAt(course, safeRight)) > lieQuality(terrainAt(course, safeLeft))
      ? 1
      : safeLeft.y < safeRight.y ? -1 : 1;
  const advanceAround = saferAroundTarget(course, from, green, obstacle, positionalAdvance, saferSide);
  const directAdvance = targetNear(course, {
    x: from.x + unit(from, green).x * positionalAdvance,
    y: from.y + unit(from, green).y * positionalAdvance,
  }, false);
  return [
    {
      route: "safe",
      shape: "around",
      target: saferSide === -1 ? safeLeft : safeRight,
      technique: "normal",
      flightProfile: "standard",
    },
    {
      route: "advance",
      shape: "around",
      target: advanceAround,
      technique: saferSide === -1 ? "draw" : "fade",
      flightProfile: "standard",
    },
    {
      route: "advance",
      shape: "under",
      target: directAdvance,
      technique: "punch",
      flightProfile: "low",
    },
    {
      route: "advance",
      shape: "over",
      target: directAdvance,
      technique: "normal",
      flightProfile: "high",
    },
    {
      route: "hero",
      shape: "over",
      target: green,
      technique: "normal",
      flightProfile: "high",
    },
  ];
}

function recoveryKind(route: RecoveryRoute): StrategicIntentKind {
  return route === "safe" ? "recovery" : route === "hero" ? "hero" : "positional";
}

function recoveryScore(intent: ShotIntent, capabilities: GolferCapabilities): number {
  const riskPenalty = intent.hazardRisk * (1 - capabilities.riskTolerance) * 1.7;
  const consistencyPenalty = intent.variance * (1 - capabilities.consistency / 100) * .28;
  const styleBonus = capabilities.riskStyle === "aggressive" && intent.kind === "hero"
    ? .58
    : capabilities.riskStyle === "conservative" && intent.kind === "recovery"
      ? 1.35
      : capabilities.riskStyle === "balanced" && intent.kind === "positional"
        ? .22
        : 0;
  const challengeBonus = intent.kind === "hero" ? capabilities.challengeSeeking * .28 : 0;
  return intent.expectedStrokes + riskPenalty + consistencyPenalty - intent.nextShotQuality * .24 - styleBonus - challengeBonus;
}

function hasRecoveryContext(course: Course, from: Point, green: Point, lie: string): boolean {
  const route = routeObstacle(course, from, green);
  return recoveryLies.has(lie)
    || lie === "water"
    || lie === "wetland"
    || (route !== null && distance(route.obstacle, from) <= 4);
}

function recoveryCandidate(args: {
  course: Course;
  hole: Hole;
  from: Point;
  lie: ShotLie;
  capabilities: GolferCapabilities;
  personality: Personality;
  shotNumber: number;
  profile: GolferProfile;
  snapshot: PlayerRoundCourseSnapshot;
  spec: RecoveryCandidateSpec;
  sampleCount?: number;
}): ShotIntent | null {
  const selection = legalRecoverySelection({
    course: args.course,
    lie: args.lie,
    from: args.from,
    target: args.spec.target,
    route: args.spec.route,
    technique: args.spec.technique,
    flightProfile: args.spec.flightProfile,
    capabilities: args.capabilities,
    yardsPerTile: args.course.yardsPerTile,
  });
  if (!selection) return null;

  const kind = recoveryKind(args.spec.route);
  const id = `${args.hole.id ?? "hole"}-recovery-${args.shotNumber}-${args.spec.route}-${args.spec.shape}`;
  const clubSpec = args.profile.clubs.find((candidate) => candidate.name === selection.club.label) ?? args.profile.clubs[0];
  const expected = evalShotExpectedCost({
    course: args.course,
    from: args.from,
    to: args.spec.target,
    golfer: args.profile,
    club: clubSpec,
  });
  const plannedClearance = resolveObstacleCollision({
    from: args.from,
    to: args.spec.target,
    flight: {
      profile: args.spec.flightProfile,
      apexHeightYards: selection.effects.flight.apexHeightYards,
    },
    width: args.course.width,
    height: args.course.height,
    yardsPerTile: args.course.yardsPerTile,
    elevations: args.course.elevations,
    tiles: args.course.tiles,
    obstacles: args.course.obstacles,
  });
  const baseIntent: ShotIntent = {
    id,
    kind,
    from: { ...args.from },
    target: { ...args.spec.target },
    club: selection.club.label,
    power: selection.power,
    technique: args.spec.technique,
    flightProfile: args.spec.flightProfile,
    expectedStrokes: 1,
    variance: 0,
    hazardRisk: 0,
    nextShotQuality: 0,
    facts: [],
    shotSlope: analyzeShotSlope({
      course: args.course,
      from: args.from,
      to: args.spec.target,
      yardsPerTile: args.course.yardsPerTile,
      handedness: stableGolferHandedness(args.capabilities.seed),
    }),
  };
  const samples = Array.from({ length: args.sampleCount ?? 3 }, (_, index) => resolveLiveShot({
    snapshot: args.snapshot,
    capabilities: args.capabilities,
    holeId: args.hole.id ?? args.snapshot.holes[0]?.id ?? "hole-1",
    shotNumber: args.shotNumber,
    from: args.from,
    lie: args.lie,
    intent: baseIntent,
    seed: stableHash(`${args.capabilities.seed}:${id}:${index}`),
  }));
  const obstacleHits = samples.filter((outcome) => outcome.sharedOutcome?.collision.kind === "obstacle").length;
  const terrainHits = samples.filter((outcome) => outcome.sharedOutcome?.collision.kind === "terrain").length;
  const penaltyCost = samples.reduce((sum, outcome) => sum + outcome.penaltyStrokes, 0) / samples.length;
  const reliefCount = samples.filter((outcome) => outcome.relief?.status === "resolved").length;
  const averageRemaining = samples.reduce((sum, outcome) => sum + distance(outcome.finalPosition ?? outcome.rest, args.hole.green!), 0) / samples.length;
  const averageLieQuality = samples.reduce((sum, outcome) => sum + lieQuality(outcome.lieAfter), 0) / samples.length;
  const collisionRate = (obstacleHits + terrainHits * .65) / samples.length;
  const relevantClearance = plannedClearance.clearance
    .filter((evidence) => evidence.relationship !== "around" || (evidence.horizontalClearanceYards ?? 0) < args.course.yardsPerTile * 3)
    .sort((a, b) => Math.abs(a.clearanceYards) - Math.abs(b.clearanceYards))[0];
  const dispersionYards = selection.effects.dispersionTiles
    * (1.42 - args.capabilities.accuracy / 180)
    * args.course.yardsPerTile;
  const clearanceRisk = relevantClearance?.relationship === "through"
    ? 1
    : relevantClearance?.relationship === "around"
      ? clamp((dispersionYards - (relevantClearance.horizontalClearanceYards ?? 0)) / Math.max(1, dispersionYards) * .5 + .2, 0, .8)
      : relevantClearance?.relationship === "over"
        ? clamp((dispersionYards * .35 - relevantClearance.clearanceYards) / Math.max(1, dispersionYards), 0, .8)
        : relevantClearance?.relationship === "under"
          ? clamp(.18 + dispersionYards / 80, .18, .5)
          : 0;
  const collisionRisk = clamp(collisionRate * .72 + clearanceRisk * .28, 0, 1);
  const landingRisk = samples.reduce((sum, outcome) => sum + (lieQuality(outcome.lieAfter) < .2 ? 1 : lieQuality(outcome.lieAfter) < .5 ? .34 : .06), 0) / samples.length;
  const hazardRisk = clamp(penaltyCost * .72 + collisionRisk * .68 + landingRisk * .28, 0, 1);
  const nextShotQuality = clamp(
    averageLieQuality * .62
      + (1 - clamp(averageRemaining / Math.max(1, distance(args.from, args.hole.green!)), 0, 1)) * .38,
    0,
    1,
  );
  const variance = clamp(
    (100 - args.capabilities.consistency) / 100 * .5
      + (100 - args.capabilities.accuracy) / 100 * .2
      + hazardRisk * .3,
    .04,
    1,
  );
  const routeCost = args.spec.route === "safe" ? .04 : args.spec.route === "hero" ? -.08 : .04;
  const expectedStrokes = 1
    + Math.max(0, expected.expectedShotCost - 1)
    + penaltyCost
    + collisionRisk * (1.15 - args.capabilities.recovery / 260)
    + (1 - nextShotQuality) * .52
    + routeCost;
  const collisionDetail = relevantClearance
    ? `obstacle:${relevantClearance.obstacleType ?? "terrain"} relationship:${relevantClearance.relationship ?? "clear"} clearance:${relevantClearance.clearanceYards.toFixed(1)}yd collision-risk:${Math.round(collisionRisk * 100)}%`
    : `obstacle:clear collision-risk:${Math.round(collisionRisk * 100)}%`;
  const firstRules = samples[0]?.sharedOutcome;
  const facts: StrategyFact[] = [
    { code: "capability-fit", detail: `recovery:${Math.round(args.capabilities.recovery)} accuracy:${Math.round(args.capabilities.accuracy)} consistency:${Math.round(args.capabilities.consistency)}` },
    { code: "risk", detail: `hazard:${Math.round(hazardRisk * 100)}% collision:${Math.round(collisionRisk * 100)}% penalty:${Math.round(penaltyCost * 100)}%` },
    { code: "terrain", detail: `source:${args.lie} expected-landing:${terrainAt(args.course, args.spec.target)}` },
    { code: "next-shot", detail: `quality:${Math.round(nextShotQuality * 100)}% remaining:${Math.round(averageRemaining * args.course.yardsPerTile)}yd` },
    { code: "context", detail: `recovery:${args.spec.route} shape:${args.spec.shape} flight:${args.spec.flightProfile} technique:${args.spec.technique} club:${selection.club.label}` },
    { code: "outcome", detail: collisionDetail },
    { code: "outcome", detail: `rules:${firstRules?.ruling.status ?? "legacy"} relief:${firstRules?.relief.type ?? "none"} relief-rate:${Math.round(reliefCount / samples.length * 100)}%` },
    { code: "outcome", detail: `expected-cost:${expectedStrokes.toFixed(3)}` },
    { code: "context", detail: `preference:${args.personality.prefs.difficulty.toFixed(2)}` },
  ];
  return {
    ...baseIntent,
    expectedStrokes,
    variance,
    hazardRisk,
    nextShotQuality,
    facts,
    previewLanding: samples[0] ? { ...samples[0].landing } : undefined,
    previewRest: samples[0] ? { ...samples[0].rest } : undefined,
    previewSeed: samples[0]?.seed,
  };
}

/**
 * Build a stable, legal M50 recovery set from the current ball state. The
 * candidates retain the old M47 intent vocabulary while adding explicit
 * around/under/over flight and authoritative outcome evidence.
 */
export function generateRecoveryCandidates(args: {
  course: Course;
  hole: Hole;
  from: Point;
  lie: string;
  capabilities: GolferCapabilities;
  personality: Personality;
  shotNumber?: number;
  sampleCount?: number;
  snapshot?: PlayerRoundCourseSnapshot;
}): ShotIntent[] {
  if (!args.hole.green || !hasRecoveryContext(args.course, args.from, args.hole.green, args.lie)) return [];
  const lie = args.lie as ShotLie;
  const profile = profileFor(args.capabilities, args.course);
  const snapshot = args.snapshot ?? liveCourseSnapshot({
    course: args.course,
    teeSet: "member",
    pinRotation: args.course.activePinRotation ?? "A",
  });
  return recoverySpecs(args.course, args.hole, args.from)
    .map((spec) => recoveryCandidate({
      ...args,
      lie,
      shotNumber: args.shotNumber ?? 1,
      profile,
      snapshot,
      spec,
      sampleCount: args.sampleCount,
    }))
    .filter((candidate): candidate is ShotIntent => candidate !== null)
    .sort((a, b) => recoveryScore(a, args.capabilities) - recoveryScore(b, args.capabilities) || a.id.localeCompare(b.id));
}

function chooseClub(course: Course, kind: StrategicIntentKind, from: Point, target: Point, capabilities: GolferCapabilities, lie: string): { name: string; power: number } {
  const shotSlope = analyzeShotSlope({ course, from, to: target, yardsPerTile: course.yardsPerTile });
  const d = shotSlope.playsLikeDistanceYards;
  const names = lie === "green" ? ["Putter", "Chip"] : kind === "hero" ? ["Driver", "3 Wood", "5 Iron"] : kind === "safe" ? ["3 Wood", "5 Iron", "Driver"] : ["Driver", "3 Wood", "5 Iron", "7 Iron", "Pitching Wedge"];
  const available = names.filter((name) => CLUBS[name]);
  const legacyName = available.find((candidate) => CLUBS[candidate].carry * 1.1 >= d) ?? available[available.length - 1] ?? "7 Iron";
  const powerScale = .84 + capabilities.power / 480;
  const name = shotSlope.targetElevationDelta === 0
    ? legacyName
    : available.slice().sort((a, b) =>
        Math.abs(CLUBS[a].carry * powerScale - d) - Math.abs(CLUBS[b].carry * powerScale - d)
        || CLUBS[a].carry - CLUBS[b].carry
        || a.localeCompare(b),
      )[0] ?? legacyName;
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

function buildIntent(args: { course: Course; hole: Hole; kind: StrategicIntentKind; capabilities: GolferCapabilities; personality: Personality; profile: GolferProfile; snapshot?: PlayerRoundCourseSnapshot; }): ShotIntent {
  const from = { ...args.hole.tee! };
  const desiredTarget = candidateTarget(args.course, args.hole, args.kind);
  const club = chooseClub(args.course, args.kind, from, desiredTarget, args.capabilities, terrainAt(args.course, from));
  const technique = args.kind === "recovery" ? "punch" : "normal";
  const target = slopeAwareAim({ course: args.course, from, desired: desiredTarget, club: club.name, technique, capabilities: args.capabilities });
  const clubSpec = args.profile.clubs.find((candidate) => candidate.name === club.name) ?? args.profile.clubs[0];
  const shotSlope = analyzeShotSlope({
    course: args.course,
    from,
    to: target,
    yardsPerTile: args.course.yardsPerTile,
    handedness: stableGolferHandedness(args.capabilities.seed),
  });
  const evaluation = evalShotExpectedCost({ course: args.course, from, to: target, golfer: args.profile, club: clubSpec, shotSlope });
  const snapshot = args.snapshot ?? liveCourseSnapshot({
    course: args.course,
    teeSet: "member",
    pinRotation: args.course.activePinRotation ?? "A",
  });
  const previewSeed = stableHash(`${args.capabilities.seed}:${args.hole.id ?? "hole"}:${args.kind}:slope-preview`);
  const previewBase: ShotIntent = {
    id: `${args.hole.id ?? "hole"}-${args.kind}`,
    kind: args.kind,
    from,
    target,
    club: club.name,
    power: club.power,
    technique,
    expectedStrokes: 1,
    variance: 0,
    hazardRisk: 0,
    nextShotQuality: 0,
    facts: [],
    shotSlope,
  };
  const preview = resolveLiveShot({
    snapshot,
    capabilities: args.capabilities,
    holeId: args.hole.id ?? snapshot.holes[0]?.id ?? "hole-1",
    shotNumber: 1,
    from,
    lie: terrainAt(args.course, from),
    intent: previewBase,
    seed: previewSeed,
  });
  const terrain = terrainAt(args.course, preview.rest);
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
    ...shotSlopeEvidenceFacts(shotSlope),
  ];
  return {
    ...previewBase,
    expectedStrokes: 1 + Math.max(0, evaluation.expectedShotCost - 1) + hazardRisk * (1.25 - args.capabilities.riskTolerance),
    variance,
    hazardRisk,
    nextShotQuality,
    facts,
    previewLanding: { ...preview.landing },
    previewRest: { ...preview.rest },
    previewSeed,
  };
}

function greenReachable(course: Course, hole: Hole, from: Point, capabilities: GolferCapabilities): boolean {
  if (!hole.green) return false;
  const playsLikeYards = analyzeShotSlope({ course, from, to: hole.green, yardsPerTile: course.yardsPerTile }).playsLikeDistanceYards;
  const maximumCarry = CLUBS.Driver.carry * (.84 + capabilities.power / 480) * 1.12;
  // A golfer needs a little reserve for dispersion and elevation; a target at
  // the absolute 112% hero ceiling is not treated as a viable green attack.
  return playsLikeYards <= maximumCarry * .92;
}

function chooseGreenClub(course: Course, from: Point, target: Point, capabilities: GolferCapabilities): { name: string; power: number } {
  const playsLikeYards = analyzeShotSlope({ course, from, to: target, yardsPerTile: course.yardsPerTile }).playsLikeDistanceYards;
  const powerScale = .84 + capabilities.power / 480;
  const names = ["Chip", "Sand Wedge", "Pitching Wedge", "7 Iron", "5 Iron", "3 Wood", "Driver"];
  const name = names.find((candidate) => CLUBS[candidate].carry * powerScale * 1.08 >= playsLikeYards) ?? "Driver";
  return { name, power: clamp(playsLikeYards / Math.max(1, CLUBS[name].carry * powerScale), .25, 1.08) };
}

function buildGreenLandingIntent(args: {
  course: Course;
  hole: Hole;
  from: Point;
  lie: string;
  capabilities: GolferCapabilities;
  candidate: GreenLandingCandidate;
  snapshot: PlayerRoundCourseSnapshot;
}): ShotIntent {
  const club = chooseGreenClub(args.course, args.from, args.candidate.target, args.capabilities);
  const shotSlope = analyzeShotSlope({
    course: args.course,
    from: args.from,
    to: args.candidate.target,
    yardsPerTile: args.course.yardsPerTile,
    handedness: stableGolferHandedness(args.capabilities.seed),
  });
  const intent: ShotIntent = {
    id: args.candidate.id,
    kind: "approach",
    from: { ...args.from },
    target: { ...args.candidate.target },
    club: club.name,
    power: club.power,
    technique: args.candidate.role === "run-up" ? "punch" : args.candidate.role === "attack" && args.capabilities.irons >= 72 ? "backspin" : "normal",
    flightProfile: args.candidate.role === "run-up" ? "low" : args.candidate.role === "attack" ? "high" : "standard",
    expectedStrokes: args.candidate.score,
    variance: args.candidate.variance,
    hazardRisk: args.candidate.hazardRisk,
    nextShotQuality: args.candidate.nextShotQuality,
    facts: args.candidate.facts,
    shotSlope,
  };
  const previewSeed = stableHash(`${args.capabilities.seed}:${intent.id}:slope-preview`);
  const preview = resolveLiveShot({
    snapshot: args.snapshot,
    capabilities: args.capabilities,
    holeId: args.hole.id ?? args.snapshot.holes[0]?.id ?? "hole-1",
    shotNumber: 1,
    from: args.from,
    lie: args.lie,
    intent,
    seed: previewSeed,
  });
  return {
    ...intent,
    previewLanding: { ...preview.landing },
    previewRest: { ...preview.rest },
    previewSeed,
  };
}

function greenLandingIntents(args: {
  course: Course;
  hole: Hole;
  from: Point;
  lie: string;
  capabilities: GolferCapabilities;
  personality: Personality;
  snapshot: PlayerRoundCourseSnapshot;
}): ShotIntent[] {
  if (!greenReachable(args.course, args.hole, args.from, args.capabilities)) return [];
  return planGreenLandingZones(args).map((candidate) => buildGreenLandingIntent({ ...args, candidate }));
}

export function generateStrategicHolePlan(args: {
  course: Course;
  hole: Hole;
  par: number;
  capabilities: GolferCapabilities;
  personality: Personality;
  snapshot?: PlayerRoundCourseSnapshot;
  /** Architecture review compares named route types rather than green-zone aims. */
  includeGreenLandingZones?: boolean;
}): StrategicHolePlan {
  const profile = profileFor(args.capabilities, args.course);
  const snapshot = args.snapshot ?? (args.includeGreenLandingZones === false
    ? undefined
    : liveCourseSnapshot({
        course: args.course,
        teeSet: "member",
        pinRotation: args.course.activePinRotation ?? "A",
      }));
  const teeLie = args.hole.tee ? terrainAt(args.course, args.hole.tee) : null;
  const recoveryCandidates = args.hole.tee && args.hole.green && teeLie && recoveryLies.has(teeLie)
    ? generateRecoveryCandidates({
        course: args.course,
        hole: args.hole,
        from: args.hole.tee,
        lie: teeLie,
        capabilities: args.capabilities,
        personality: args.personality,
        shotNumber: 1,
        sampleCount: 1,
        snapshot,
      })
    : [];
  const landingCandidates = snapshot && args.includeGreenLandingZones !== false && recoveryCandidates.length === 0 && args.hole.tee && teeLie
    ? greenLandingIntents({ ...args, from: args.hole.tee, lie: teeLie, snapshot })
    : [];
  const candidates = recoveryCandidates.length > 0
    ? recoveryCandidates
    : landingCandidates.length > 0
      ? landingCandidates
      : INTENTS.map((kind) => buildIntent({ ...args, kind, profile, snapshot }));
  const legacyScore = (intent: ShotIntent) => {
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
  const score = recoveryCandidates.length > 0
    ? (intent: ShotIntent) => recoveryScore(intent, args.capabilities)
    : landingCandidates.length > 0
      ? (intent: ShotIntent) => intent.expectedStrokes
      : legacyScore;
  const ordered = candidates.slice().sort((a, b) => score(a) - score(b) || INTENTS.indexOf(a.kind) - INTENTS.indexOf(b.kind));
  const chosen = ordered[0];
  const rejected: RejectedAlternative[] = ordered.slice(1, 6).map((alternative) => ({
    intentId: alternative.id,
    kind: alternative.kind,
    target: { ...alternative.target },
    score: Number(score(alternative).toFixed(3)),
    expectedStrokes: Number(alternative.expectedStrokes.toFixed(3)),
    reason: landingCandidates.length > 0
      ? score(alternative) > score(chosen) + .25
        ? "higher expected putts, miss risk, or rollout exposure"
        : "viable green zone, but less aligned with this golfer's capability and risk profile"
      : score(alternative) > score(chosen) + .25 ? "higher modeled risk or lower next-shot quality" : "slightly less fit for this golfer",
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
  snapshot?: PlayerRoundCourseSnapshot;
  obstacleRecoveryContext?: boolean;
}): ShotIntent {
  const target = { ...args.hole.green! };
  const ordinaryLie = args.lie === "tee" || args.lie === "fairway" || args.lie === "green";
  const recoveryCandidates = !ordinaryLie || args.obstacleRecoveryContext === true
    ? generateRecoveryCandidates({ ...args, sampleCount: 1 })
    : [];
  if (recoveryCandidates.length > 0) {
    const chosen = args.capabilities.riskStyle === "conservative"
      ? recoveryCandidates.find((candidate) => candidate.facts.some((fact) => fact.code === "context" && fact.detail.includes("recovery:safe"))) ?? recoveryCandidates[0]
      : recoveryCandidates[0];
    return {
      ...chosen,
      id: `${args.hole.id ?? "hole"}-follow-${args.shotNumber}-${chosen.id.split("-").slice(-2).join("-")}`,
      from: { ...args.from },
    };
  }
  const snapshot = args.snapshot ?? liveCourseSnapshot({
    course: args.course,
    teeSet: "member",
    pinRotation: args.course.activePinRotation ?? "A",
  });
  const landingCandidates = greenLandingIntents({ ...args, snapshot });
  if (landingCandidates.length > 0) return {
    ...landingCandidates[0],
    id: `${args.hole.id ?? "hole"}-follow-${args.shotNumber}-${landingCandidates[0].id.split("-").slice(-3).join("-")}`,
    from: { ...args.from },
  };
  const kind: StrategicIntentKind = args.lie === "rough" || args.lie === "deep_rough" || args.lie === "sand" || args.lie === "waste_area"
    ? "recovery"
    : distance(args.from, target) <= 5 ? "approach" : "positional";
  const profile = profileFor(args.capabilities, args.course);
  const intent = buildIntent({ course: args.course, hole: { ...args.hole, tee: args.from, green: target }, kind, capabilities: args.capabilities, personality: args.personality, profile, snapshot: args.snapshot });
  return { ...intent, id: `${args.hole.id ?? "hole"}-follow-${args.shotNumber}`, from: { ...args.from } };
}
