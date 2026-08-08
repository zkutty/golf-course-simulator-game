import type { Course, PinRotation, Point, TeeSet } from "../models/types";
import { scoreCourseHoles } from "./holes";
import { getGolferProfile, type GolferProfile } from "./golferProfiles";
import { BALANCE } from "../balance/balanceConfig";
import { courseForCourseSetup, getPinPosition, getTeeBox, PIN_ROTATIONS, TEE_SETS } from "../models/courseSetup";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { analyzePinFairness } from "../greens/pinFairness";
import type { ArchitectureReferencePlan } from "../architecture/referencePlan";

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
  plan: ArchitectureReferencePlan | undefined,
  fallback: ReturnType<typeof scoreCourseHoles>["holes"][number] | undefined,
  expectedPutts = 2,
) {
  if (!course.holes[holeIndex] || (plan ? !plan.tee || !plan.pin : !fallback?.isComplete || !fallback.isValid)) {
    // Treat invalid holes as very punishing (forces redesign); bogey punished more.
    return profile.name === "BOGEY" ? 9 : 7;
  }

  const yardsPerTile = course.yardsPerTile ?? 10;
  const usesReference = !!plan;
  const distanceYards = usesReference ? plan.effectiveYardage : fallback!.effectiveDistance * yardsPerTile;

  const corridor = usesReference ? plan.corridor : fallback!.corridor;
  const s = corridor.samples || 1;
  const waterFrac = (corridor.water + corridor.wetland) / s;
  const sandFrac = corridor.sand / s;
  const wasteFrac = corridor.waste_area / s;
  const roughFrac = corridor.rough / s;
  const deepRoughFrac = corridor.deep_rough / s;

  // The reference planner already evaluates blockers, landing width, carries,
  // runout, and next-shot quality. Rating consumes that retained evidence
  // instead of reconstructing another fairway-following difficulty proxy.
  const obstaclePenalty = usesReference && plan.segments.length
    ? plan.segments.reduce((sum, segment) => sum + segment.risk.blockers * .45 + segment.risk.landing * .25
      + segment.risk.carry * .2 + segment.risk.runout * .1, 0) / plan.segments.length
    : usesReference
      ? 0
    : clamp((fallback!.difficultyScore - 45) / 100, 0, 1);

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

  const expected = baseShots + penalty + expectedPutts;
  return expected;
}

function inBounds(course: Course, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
}

/** Existing coarse setup difficulty remains the compatibility baseline. */
function coarsePinDifficultyPenalty(course: Course, pin: Point | null): number {
  if (!pin || !inBounds(course, pin)) return 0;
  const cfg = BALANCE.courseSetup.pinDifficulty;
  let nearestNonGreen: number = cfg.edgeRadiusTiles;
  let adjacentHazards = 0;
  let elevationChange = 0;
  const pinElevation = course.elevations[pin.y * course.width + pin.x] ?? 0;
  for (let dy = -cfg.edgeRadiusTiles; dy <= cfg.edgeRadiusTiles; dy++) for (let dx = -cfg.edgeRadiusTiles; dx <= cfg.edgeRadiusTiles; dx++) {
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

interface RatingGeometryCache {
  elevations: Course["elevations"];
  obstacles: Course["obstacles"];
  width: number;
  height: number;
  yardsPerTile: number;
  holeSignature: string;
  greenSurface: Course["greenSurface"];
  greenProgram: Course["greenProgram"];
  greenLocalState: Course["greenLocalState"];
  setups: Map<string, SetupRatingSummary>;
  ratings?: Record<TeeSet, PublishedTeeRating>;
  rating?: RatingSummary;
}

// Operating policy, green fee, layout metadata, and other management state
// live on the Course root but do not affect a physical course rating. Key the
// expensive shot-solver work by immutable geometry instead of root identity so
// operations-only updates reuse it.
const ratingGeometryCache = new WeakMap<Course["tiles"], RatingGeometryCache[]>();
const holeSignatureCache = new WeakMap<Course["holes"], string>();

function ratingHoleSignature(course: Course): string {
  const cached = holeSignatureCache.get(course.holes);
  if (cached) return cached;
  const point = (value: Point | null | undefined) => value ? `${value.x},${value.y}` : "-";
  const signature = course.holes.map((hole) => [
    ...TEE_SETS.map((teeSet) => point(getTeeBox(hole, teeSet))),
    ...PIN_ROTATIONS.map((pinRotation) => point(getPinPosition(hole, pinRotation))),
    ...TEE_SETS.map((teeSet) => {
      const par = hole.parByTee?.[teeSet];
      if (par?.mode === "MANUAL") return `M${par.par}`;
      if (par?.mode === "AUTO") return "A";
      if (teeSet === "member" && hole.parMode === "MANUAL") return `M${hole.parManual ?? 4}`;
      return "A";
    }),
  ].join("|")).join(";");
  holeSignatureCache.set(course.holes, signature);
  return signature;
}

function ratingGeometry(course: Course): RatingGeometryCache {
  const entries = ratingGeometryCache.get(course.tiles) ?? [];
  if (entries.length === 0) ratingGeometryCache.set(course.tiles, entries);
  const holeSignature = ratingHoleSignature(course);
  const yardsPerTile = course.yardsPerTile ?? 10;
  const cached = entries.find((entry) =>
    entry.elevations === course.elevations &&
    entry.obstacles === course.obstacles &&
    entry.width === course.width &&
    entry.height === course.height &&
    entry.yardsPerTile === yardsPerTile &&
    entry.greenSurface === course.greenSurface &&
    entry.greenProgram === course.greenProgram &&
    entry.greenLocalState === course.greenLocalState &&
    entry.holeSignature === holeSignature
  );
  if (cached) return cached;
  const created: RatingGeometryCache = {
    elevations: course.elevations,
    obstacles: course.obstacles,
    width: course.width,
    height: course.height,
    yardsPerTile,
    greenSurface: course.greenSurface,
    greenProgram: course.greenProgram,
    greenLocalState: course.greenLocalState,
    holeSignature,
    setups: new Map(),
  };
  entries.push(created);
  return created;
}

export function computeRatingForSetup(course: Course, teeSet: TeeSet, pinRotation: PinRotation, referencePlans?: readonly ArchitectureReferencePlan[]): SetupRatingSummary {
  course = courseWithEffectiveSurfaces(course);
  const setups = ratingGeometry(course).setups;
  const planKey = referencePlans?.map((plan) => plan.version).join("|") ?? "legacy";
  const cacheKey = `${teeSet}:${pinRotation}:${planKey}`;
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
  const plansByHole = new Map(referencePlans?.map((plan) => [plan.holeId, plan]) ?? []);
  for (let i = 0; i < Math.min(holesUsed, course.holes.length); i++) {
    const original = course.holes[i];
    const tee = getTeeBox(original, teeSet);
    const pin = getPinPosition(original, pinRotation);
    if (!tee || !pin) setupComplete = false;
    const fairness = analyzePinFairness(setupCourse, original, pin, pinRotation);
    const referencePlan = plansByHole.get(original.id ?? "");
    const coarsePenalty = coarsePinDifficultyPenalty(setupCourse, pin);
    // Retain the published coarse-rating baseline while the authoritative fine
    // surface and automatic-putt model add only their newly observed excess.
    const scratchAutomaticDelta = fairness.cohorts.scratch.scoreDelta * .25;
    const scratchPutting = 2 + coarsePenalty + scratchAutomaticDelta;
    const bogeyAutomaticDelta = scratchAutomaticDelta
      + Math.max(0, fairness.cohorts.bogey.scoreDelta - fairness.cohorts.scratch.scoreDelta) * .12;
    const bogeyPutting = 2 + coarsePenalty * BALANCE.courseSetup.pinDifficulty.bogeySensitivity + bogeyAutomaticDelta;
    const info = holeSummary.holes[i];
    scratchTotal += computeExpectedScoreForHole(setupCourse, i, scratch, referencePlan, info, scratchPutting);
    bogeyTotal += computeExpectedScoreForHole(setupCourse, i, bogey, referencePlan, info, bogeyPutting);
    if (!fairness.legal) setupComplete = false;
    const referenceComplete = referencePlan ? !!referencePlan.tee && !!referencePlan.pin : !!info?.isComplete && info.isValid;
    if (referenceComplete && tee && pin && fairness.legal) {
      validHoles++;
      effectiveYardage += referencePlan ? referencePlan.effectiveYardage : info!.effectiveDistance * setupCourse.yardsPerTile;
      pinDelta += coarsePenalty + (fairness.cohorts.scratch.scoreDelta + fairness.cohorts.bogey.scoreDelta) / 2;
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

export function computeRatingsByTee(course: Course): Record<TeeSet, PublishedTeeRating> {
  const geometry = ratingGeometry(course);
  const cached = geometry.ratings;
  if (cached) return cached;
  const result = Object.fromEntries(TEE_SETS.map((teeSet) => {
    const configuredRotations = PIN_ROTATIONS.filter((rotation) => course.holes.some((hole) => getTeeBox(hole, teeSet) && getPinPosition(hole, rotation)));
    if (configuredRotations.length === 0) return [teeSet, emptyPublishedRating(course, teeSet)];
    return [teeSet, averageSetups(teeSet, configuredRotations.map((rotation) => computeRatingForSetup(course, teeSet, rotation)))];
  })) as Record<TeeSet, PublishedTeeRating>;
  geometry.ratings = result;
  return result;
}

// Compatibility contract: all legacy consumers continue to see the stable
// published Member rating, independent of the selected daily pin rotation.
export function computeCourseRatingAndSlope(course: Course): RatingSummary {
  const geometry = ratingGeometry(course);
  const cached = geometry.rating;
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
  geometry.rating = result;
  return result;
}
