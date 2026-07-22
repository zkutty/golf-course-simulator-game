import type { Course, PinRotation, Point, TeeSet } from "../models/types";
import { scoreCourseHoles } from "./holes";
import { getGolferProfile, type GolferProfile } from "./golferProfiles";
import { BALANCE } from "../balance/balanceConfig";
import { courseForCourseSetup, getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS } from "../models/courseSetup";

export interface RatingSummary {
  holesUsed: number; // 9 or 18
  expectedScratchScore: number; // 18-hole equivalent
  expectedBogeyScore: number; // 18-hole equivalent
  courseRating: number; // ≈ expectedScratchScore (18-hole), typical 67–75
  slopeRaw: number; // bogey - scratch
  slope: number; // USGA-like range ~55–155, 113 avg
}

export interface SetupRatingSummary extends RatingSummary {
  teeSet: TeeSet;
  pinRotation: PinRotation;
  effectiveYardage: number;
  setupComplete: boolean;
  validHoles: number;
  pinDifficultyDelta: number;
}

export interface PublishedTeeRating extends RatingSummary {
  teeSet: TeeSet;
  effectiveYardage: number;
  setupComplete: boolean;
  rotationsUsed: PinRotation[];
  rotationDeltas: Partial<Record<PinRotation, number>>;
  setups: Partial<Record<PinRotation, SetupRatingSummary>>;
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function estimateShotsToReachGreen(distanceYards: number, profile: GolferProfile) {
  // Greedy "longest club that doesn't overshoot too badly" approximation.
  // This intentionally stays simple + deterministic.
  const clubs = profile.clubs.map((club) => club.carryYards).sort((a, b) => b - a);

  let remaining = Math.max(0, distanceYards);
  let shots = 0;
  let guard = 0;

  while (remaining > 5 && guard++ < 20) {
    const carry = clubs.find((c) => c <= remaining + 20) ?? clubs[clubs.length - 1];
    remaining = Math.max(0, remaining - carry);
    shots++;
  }

  return shots;
}

function hazardPenaltyStrokes(args: {
  // fractions along the playable route
  waterFrac: number;
  sandFrac: number;
  wasteFrac: number;
  roughFrac: number;
  deepRoughFrac: number;
  // obstacle "density" proxy
  obstaclePenalty: number;
  distanceYards: number;
  profile: GolferProfile;
}) {
  const { waterFrac, sandFrac, wasteFrac, roughFrac, deepRoughFrac, obstaclePenalty, distanceYards, profile } =
    args;

  // Long holes amplify the impact.
  const distFactor = clamp(distanceYards / 480, 0.3, 1.4);

  // Water is the biggest "forced layup" driver; sand moderate.
  const hazard = profile.ratingMultipliers.hazard * (2.2 * waterFrac + 0.9 * sandFrac + 0.62 * wasteFrac);
  const lie =
    profile.ratingMultipliers.rough * (0.9 * roughFrac) +
    profile.ratingMultipliers.deepRough * (1.2 * deepRoughFrac);
  const obst = profile.ratingMultipliers.obstacle * obstaclePenalty;

  // Convert to strokes (fractional) and cap to keep it MVP-friendly.
  const raw = distFactor * (hazard + lie + obst);
  return clamp(raw * 1.4, 0, 2.5);
}

function computeExpectedScoreForHole(
  course: Course,
  holeIndex: number,
  profile: GolferProfile,
  summary: ReturnType<typeof scoreCourseHoles>,
  puttingPenalty = 0,
) {
  const h = summary.holes[holeIndex];
  if (!h || !h.isComplete || !h.isValid) {
    // Treat invalid holes as very punishing (forces redesign); bogey punished more.
    return profile.name === "BOGEY" ? 9 : 7;
  }

  const yardsPerTile = course.yardsPerTile ?? 10;
  const distanceYards = h.effectiveDistance * yardsPerTile;

  const s = h.corridor.samples || 1;
  const waterFrac = (h.corridor.water + h.corridor.wetland) / s;
  const sandFrac = h.corridor.sand / s;
  const wasteFrac = h.corridor.waste_area / s;
  const roughFrac = h.corridor.rough / s;
  const deepRoughFrac = h.corridor.deep_rough / s;

  // Obstacle proxy: difficulty above baseline indicates more forced shots.
  const obstaclePenalty = clamp((h.difficultyScore - 45) / 100, 0, 1);

  const baseShots = estimateShotsToReachGreen(distanceYards, profile);
  const penalty = hazardPenaltyStrokes({
    waterFrac,
    sandFrac,
    wasteFrac,
    roughFrac,
    deepRoughFrac,
    obstaclePenalty,
    distanceYards,
    profile,
  });

  // Two putts baseline; keep MVP simple.
  const puttingBaseline = 2;
  const sensitivity = profile.name === "BOGEY" ? BALANCE.courseSetup.pinDifficulty.bogeySensitivity : 1;
  const expected = baseShots + penalty + puttingBaseline + puttingPenalty * sensitivity;
  return expected;
}

function inBounds(course: Course, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
}

function pinDifficultyPenalty(course: Course, pin: Point | null): number {
  if (!pin || !inBounds(course, pin)) return 0;
  const cfg = BALANCE.courseSetup.pinDifficulty;
  let nearestNonGreen: number = cfg.edgeRadiusTiles;
  let adjacentHazards = 0;
  let elevationChange = 0;
  const pinElevation = course.elevations[pin.y * course.width + pin.x] ?? 0;
  for (let dy = -cfg.edgeRadiusTiles; dy <= cfg.edgeRadiusTiles; dy++) {
    for (let dx = -cfg.edgeRadiusTiles; dx <= cfg.edgeRadiusTiles; dx++) {
      if (dx === 0 && dy === 0) continue;
      const point = { x: pin.x + dx, y: pin.y + dy };
      if (!inBounds(course, point)) continue;
      const distance = Math.hypot(dx, dy);
      const index = point.y * course.width + point.x;
      const terrain = course.tiles[index];
      if (terrain !== "green") nearestNonGreen = Math.min(nearestNonGreen, distance);
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (terrain === "water" || terrain === "wetland" || terrain === "sand")) adjacentHazards++;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) elevationChange = Math.max(elevationChange, Math.abs((course.elevations[index] ?? 0) - pinElevation));
    }
  }
  const edge = clamp(1 - nearestNonGreen / cfg.edgeRadiusTiles, 0, 1) * cfg.edgePenaltyMax;
  const hazard = adjacentHazards * cfg.adjacentHazardPenalty;
  const elevation = elevationChange * cfg.elevationPenaltyPerStep;
  return clamp(edge + hazard + elevation, 0, cfg.penaltyCap);
}

function courseForSetup(course: Course, teeSet: TeeSet, pinRotation: PinRotation): Course {
  return courseForCourseSetup(course, teeSet, pinRotation);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const setupRatingCache = new WeakMap<Course, Map<string, SetupRatingSummary>>();

export function computeRatingForSetup(course: Course, teeSet: TeeSet, pinRotation: PinRotation): SetupRatingSummary {
  let setups = setupRatingCache.get(course);
  if (!setups) { setups = new Map(); setupRatingCache.set(course, setups); }
  const cacheKey = `${teeSet}:${pinRotation}`;
  const cached = setups.get(cacheKey);
  if (cached) return cached;
  const setupCourse = courseForSetup(course, teeSet, pinRotation);
  const holeSummary = scoreCourseHoles(setupCourse);
  const scratch = getGolferProfile("SCRATCH", setupCourse);
  const bogey = getGolferProfile("BOGEY", setupCourse);
  const holesUsed = holeSummary.holes.length >= 18 ? 18 : 9;
  let scratchTotal = 0;
  let bogeyTotal = 0;
  let effectiveYardage = 0;
  let pinDelta = 0;
  let validHoles = 0;
  let setupComplete = true;
  for (let i = 0; i < Math.min(holesUsed, course.holes.length); i++) {
    const original = course.holes[i];
    const tee = getTeeBox(original, teeSet);
    const pin = getPinPosition(original, pinRotation);
    if (!tee || !pin) setupComplete = false;
    const penalty = pinDifficultyPenalty(setupCourse, pin);
    const info = holeSummary.holes[i];
    scratchTotal += computeExpectedScoreForHole(setupCourse, i, scratch, holeSummary, penalty);
    bogeyTotal += computeExpectedScoreForHole(setupCourse, i, bogey, holeSummary, penalty);
    if (info?.isComplete && info.isValid && tee && pin) {
      validHoles++;
      effectiveYardage += info.effectiveDistance * setupCourse.yardsPerTile;
      pinDelta += penalty;
    }
  }
  const mult = holesUsed === 9 ? 2 : 1;
  const expectedScratchScore = scratchTotal * mult;
  const expectedBogeyScore = bogeyTotal * mult;
  const slopeRaw = expectedBogeyScore - expectedScratchScore;
  const result: SetupRatingSummary = {
    teeSet,
    pinRotation,
    holesUsed,
    expectedScratchScore: round1(expectedScratchScore),
    expectedBogeyScore: round1(expectedBogeyScore),
    courseRating: round1(expectedScratchScore),
    slopeRaw: round1(slopeRaw),
    slope: Math.round(clamp((113 * slopeRaw) / 20, 55, 155)),
    effectiveYardage: Math.round(effectiveYardage * mult),
    setupComplete: setupComplete && validHoles === Math.min(holesUsed, course.holes.length),
    validHoles,
    pinDifficultyDelta: round1(pinDelta * mult),
  };
  setups.set(cacheKey, result);
  return result;
}

function averageSetups(teeSet: TeeSet, setups: SetupRatingSummary[]): PublishedTeeRating {
  const average = (key: keyof RatingSummary) => setups.reduce((sum, setup) => sum + Number(setup[key]), 0) / setups.length;
  const baseline = setups[0];
  const publishedRating = average("courseRating");
  return {
    teeSet,
    holesUsed: baseline.holesUsed,
    expectedScratchScore: round1(average("expectedScratchScore")),
    expectedBogeyScore: round1(average("expectedBogeyScore")),
    courseRating: round1(publishedRating),
    slopeRaw: round1(average("slopeRaw")),
    slope: Math.round(average("slope")),
    effectiveYardage: Math.round(setups.reduce((sum, setup) => sum + setup.effectiveYardage, 0) / setups.length),
    setupComplete: setups.length === PIN_ROTATIONS.length && setups.every((setup) => setup.setupComplete),
    rotationsUsed: setups.map((setup) => setup.pinRotation),
    rotationDeltas: Object.fromEntries(setups.map((setup) => [setup.pinRotation, round1(setup.courseRating - publishedRating)])),
    setups: Object.fromEntries(setups.map((setup) => [setup.pinRotation, setup])),
  };
}

function emptyPublishedRating(course: Course, teeSet: TeeSet): PublishedTeeRating {
  return {
    teeSet,
    holesUsed: course.holes.length >= 18 ? 18 : 9,
    expectedScratchScore: 0,
    expectedBogeyScore: 0,
    courseRating: 0,
    slopeRaw: 0,
    slope: 55,
    effectiveYardage: 0,
    setupComplete: false,
    rotationsUsed: [],
    rotationDeltas: {},
    setups: {},
  };
}

const ratingsCache = new WeakMap<Course, Record<TeeSet, PublishedTeeRating>>();

export function computeRatingsByTee(course: Course): Record<TeeSet, PublishedTeeRating> {
  const cached = ratingsCache.get(course);
  if (cached) return cached;
  const result = Object.fromEntries(TEE_SETS.map((teeSet) => {
    const configuredRotations = PIN_ROTATIONS.filter((rotation) => course.holes.some((hole) => getTeeBox(hole, teeSet) && getPinPosition(hole, rotation)));
    if (configuredRotations.length === 0) return [teeSet, emptyPublishedRating(course, teeSet)];
    return [teeSet, averageSetups(teeSet, configuredRotations.map((rotation) => computeRatingForSetup(course, teeSet, rotation)))];
  })) as Record<TeeSet, PublishedTeeRating>;
  ratingsCache.set(course, result);
  return result;
}

// Compatibility contract: all legacy consumers continue to see the stable
// published Member rating, independent of the selected daily pin rotation.
const ratingCache = new WeakMap<Course, RatingSummary>();

export function computeCourseRatingAndSlope(course: Course): RatingSummary {
  const cached = ratingCache.get(course);
  if (cached) return cached;
  const member = computeRatingsByTee(course).member;
  const result: RatingSummary = {
    holesUsed: member.holesUsed,
    expectedScratchScore: member.expectedScratchScore,
    expectedBogeyScore: member.expectedBogeyScore,
    courseRating: member.courseRating,
    slopeRaw: member.slopeRaw,
    slope: member.slope,
  };
  ratingCache.set(course, result);
  return result;
}
