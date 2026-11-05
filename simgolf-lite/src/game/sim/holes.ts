import type { Course, Hole, Obstacle, Point, Terrain } from "../models/types";
import { computeHoleDistanceTiles, computePathDistanceTiles } from "./holeMetrics";
import { BALANCE } from "../balance/balanceConfig";
import { getGolferProfile } from "./golferProfiles";
import type { ShotPlanStep } from "./shots/solveShotsToGreen";
import { solveShotsToGreen } from "./shots/solveShotsToGreen";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { prepareShotSearchDomain, sameShotSearchDomain, shotSearchConfigUnchanged, withShotSearchDomain, type ShotSearchDomain } from "./shots/shotSearchDomain";

export interface HoleScore {
  holeIndex: number;
  isComplete: boolean;
  isValid: boolean;
  par: number;
  autoPar: number;
  scratchShotsToGreen: number; // expected strokes to reach green (ex-putting)
  bogeyShotsToGreen: number;
  reachableInTwo: boolean;
  straightDistance: number; // tiles (euclidean)
  effectiveDistance: number; // tiles (path length)
  path: Point[]; // visualization polyline (shot plan sampled points)
  shotPlan: ShotPlanStep[];
  playabilityScore: number; // 0..100
  difficultyScore: number; // 0..100
  aestheticsScore: number; // 0..100
  overallHoleScore: number; // 0..100
  corridor: {
    samples: number;
    fairway: number;
    rough: number;
    deep_rough: number;
    sand: number;
    waste_area: number;
    water: number;
    wetland: number;
    green: number;
    tee: number;
    path: number;
  };
  score: number; // alias for overallHoleScore (0..100)
  layoutIssues: string[];
  issues: string[]; // includes layout + quality warnings
}

export interface CourseHoleSummary {
  holes: HoleScore[];
  holeQualityAvg: number; // 0..100
  variety: number; // 0..100
  globalBonus: number; // -10..+10-ish
  courseQuality: number; // 0..100
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function dist(a: Point, b: Point) {
  return computeHoleDistanceTiles(a, b);
}

function deriveAutoParFromShots(shotsToGreen: number): 3 | 4 | 5 {
  const p = Math.round(shotsToGreen + 2);
  return clamp(p, 3, 5) as 3 | 4 | 5;
}

function inBounds(course: Course, p: Point) {
  return p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
}

export function tileAt(course: Course, p: Point): Terrain {
  // Scoring enters through scoreHole(), which freezes the effective terrain
  // view before dependency tracking. Reading that view directly preserves the
  // exact per-hole cache footprint used by immutable paint updates.
  return course.tiles[p.y * course.width + p.x];
}

export function sampleLine(a: Point, b: Point, samples = 13): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    pts.push({
      x: Math.round(a.x + (b.x - a.x) * t),
      y: Math.round(a.y + (b.y - a.y) * t),
    });
  }
  // Deduplicate
  const seen = new Set<string>();
  return pts.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function scoreHoleUncached(course: Course, hole: Hole, holeIndex: number): HoleScore {
  const issues: string[] = [];
  if (!hole.tee || !hole.green) {
    const par = hole.parMode === "MANUAL" ? (hole.parManual ?? 4) : 4;
    return {
      holeIndex,
      isComplete: false,
      isValid: false,
      par,
      autoPar: 4,
      scratchShotsToGreen: Infinity,
      bogeyShotsToGreen: Infinity,
      reachableInTwo: false,
      straightDistance: 0,
      effectiveDistance: 0,
      path: [],
      shotPlan: [],
      playabilityScore: 0,
      difficultyScore: 0,
      aestheticsScore: 0,
      overallHoleScore: 0,
      corridor: {
        samples: 0,
        fairway: 0,
        rough: 0,
        deep_rough: 0,
        sand: 0,
        waste_area: 0,
        water: 0,
        wetland: 0,
        green: 0,
        tee: 0,
        path: 0,
      },
      score: 0,
      layoutIssues: ["Missing tee/green placement"],
      issues: ["Missing tee/green placement"],
    };
  }

  const tee = hole.tee;
  const green = hole.green;

  const layoutIssues: string[] = [];
  if (!inBounds(course, tee)) issues.push("Tee is out of bounds");
  if (!inBounds(course, green)) issues.push("Green is out of bounds");
  if (tee.x === green.x && tee.y === green.y) issues.push("Tee and green overlap");
  for (const msg of issues) layoutIssues.push(msg);

  const straightDistance = dist(tee, green);
  const scratch = getGolferProfile("SCRATCH", course);
  const bogey = getGolferProfile("BOGEY", course);
  const scratchSolve = solveShotsToGreen({ course, tee, green, golfer: scratch });
  const bogeySolve = solveShotsToGreen({ course, tee, green, golfer: bogey });

  const scratchShotsToGreen = scratchSolve.expectedShotsToGreen;
  const bogeyShotsToGreen = bogeySolve.expectedShotsToGreen;
  const reachable = scratchSolve.reachable;

  const minDistOk = straightDistance * scratch.yardsPerTile >= BALANCE.shots.hole.minHoleDistanceYards;
  const maxOk = reachable && scratchShotsToGreen <= BALANCE.shots.water.maxExpectedShotsToGreen;

  const autoPar = reachable ? deriveAutoParFromShots(scratchShotsToGreen) : 4;
  const par = hole.parMode === "MANUAL" ? (hole.parManual ?? autoPar) : autoPar;
  const reachableInTwo =
    reachable && scratchShotsToGreen <= BALANCE.shots.hole.reachableInTwoThreshold;

  if (!minDistOk) issues.push("Hole too short (tee too close to green)");
  if (!reachable) issues.push("Green unreachable with club-based shot planning");
  if (reachable && !maxOk) issues.push("Routing is too costly (forced penalties / no safe layup)");

  const shotPlan = scratchSolve.plan;
  const poly: Point[] = [];
  for (const s of shotPlan) {
    const pts = sampleLine(s.from, s.to, 9);
    for (const p of pts) {
      if (poly.length === 0) poly.push(p);
      else {
        const last = poly[poly.length - 1];
        if (last.x !== p.x || last.y !== p.y) poly.push(p);
      }
    }
  }
  if (poly.length === 0) poly.push(tee, green);
  const effectiveDistance = computePathDistanceTiles(poly);

  const teeTile = inBounds(course, tee) ? tileAt(course, tee) : "rough";
  const greenTile = inBounds(course, green) ? tileAt(course, green) : "rough";
  if (teeTile === "water" || teeTile === "wetland" || teeTile === "sand") issues.push("Tee on hazard");
  if (greenTile === "water" || greenTile === "wetland" || greenTile === "sand") issues.push("Green on hazard");

  // Evaluate "corridor" along the chosen shot plan polyline.
  const pts = poly;
  const corridorCounts = pts.reduce(
    (acc, p) => {
      const t = tileAt(course, p);
      acc[t] += 1;
      acc.samples += 1;
      return acc;
    },
    {
      samples: 0,
      fairway: 0,
      rough: 0,
      deep_rough: 0,
      sand: 0,
      waste_area: 0,
      water: 0,
      wetland: 0,
      green: 0,
      tee: 0,
      path: 0,
    }
  );

  const s = corridorCounts.samples || 1;
  const waterFrac = (corridorCounts.water + corridorCounts.wetland) / s;
  const sandFrac = corridorCounts.sand / s;
  const wasteFrac = corridorCounts.waste_area / s;
  const fairwayFrac = corridorCounts.fairway / s;
  const roughFrac = corridorCounts.rough / s;
  const deepRoughFrac = corridorCounts.deep_rough / s;
  const pathFrac = corridorCounts.path / s;
  const onHazardFrac = waterFrac + sandFrac;
  const onBadLieFrac = roughFrac + deepRoughFrac + wasteFrac + onHazardFrac;

  if (waterFrac > 0.25) issues.push("Lots of water on main line");
  if (roughFrac > 0.7) issues.push("Mostly rough on main line");
  if (deepRoughFrac > 0.25) issues.push("Deep rough dominates the main line");

  // "Near corridor" sampling (3x3 around each on-line point) for aesthetics.
  const nearCounts = pts.reduce(
    (acc, p) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (!inBounds(course, q)) continue;
          // exclude on-line points; we already track hazards directly on the line separately
          if (dx === 0 && dy === 0) continue;
          const t = tileAt(course, q);
          acc[t] += 1;
          acc.samples += 1;
        }
      }
      return acc;
    },
    {
      samples: 0,
      fairway: 0,
      rough: 0,
      deep_rough: 0,
      sand: 0,
      waste_area: 0,
      water: 0,
      wetland: 0,
      green: 0,
      tee: 0,
      path: 0,
    }
  );
  const ns = nearCounts.samples || 1;
  const nearWaterFrac = (nearCounts.water + nearCounts.wetland) / ns;
  const nearSandFrac = nearCounts.sand / ns;
  const nearWasteFrac = nearCounts.waste_area / ns;
  const nearDeepRoughFrac = nearCounts.deep_rough / ns;

  // Obstacle influence relative to corridor points
  const obstacleStats = scoreObstaclesAgainstCorridor(course.obstacles ?? [], pts);

  // Per-hole ratings (0..100)
  // Playability: reward fairway/path; penalize rough/hazards on the main line; harsh penalties for hazards at endpoints.
  let playabilityScore =
    90 +
    35 * fairwayFrac +
    10 * pathFrac -
    70 * roughFrac -
    120 * deepRoughFrac -
    130 * waterFrac -
    55 * sandFrac -
    42 * wasteFrac;
  if (teeTile === "water" || teeTile === "wetland" || teeTile === "sand") playabilityScore -= 25;
  if (greenTile === "water" || greenTile === "wetland" || greenTile === "sand") playabilityScore -= 25;
  // Obstacles on/near the line reduce playability (trees more than bushes)
  playabilityScore -= 20 * obstacleStats.treeOnLine;
  playabilityScore -= 10 * obstacleStats.bushOnLine;
  playabilityScore -= 10 * obstacleStats.treeNear;
  playabilityScore -= 5 * obstacleStats.bushNear;
  playabilityScore = clamp(playabilityScore, 0, 100);

  // Difficulty: hazards, distance, and expected shots increase it (higher = harder).
  const distNorm = clamp(effectiveDistance / 40, 0, 1); // 40 tiles ~= "long"
  const shotsNorm = reachable ? clamp((scratchShotsToGreen - 2) / 3, 0, 1) : 1;
  let difficultyScore =
    20 +
    65 * (0.85 * waterFrac + 0.55 * sandFrac + 0.38 * wasteFrac + 0.25 * roughFrac + 0.45 * deepRoughFrac) +
    28 * distNorm +
    38 * shotsNorm;
  if (teeTile === "water" || teeTile === "wetland" || teeTile === "sand") difficultyScore += 10;
  if (greenTile === "water" || greenTile === "wetland" || greenTile === "sand") difficultyScore += 10;
  // Obstacles near/on the corridor raise difficulty (trees more than bushes)
  difficultyScore += 12 * obstacleStats.treeOnLine;
  difficultyScore += 6 * obstacleStats.bushOnLine;
  difficultyScore += 6 * obstacleStats.treeNear;
  difficultyScore += 3 * obstacleStats.bushNear;
  difficultyScore = clamp(difficultyScore, 0, 100);

  // Aesthetics: reward "scenic" hazards near the corridor, but penalize hazards directly on it.
  let aestheticsScore =
    55 +
    75 * (nearWaterFrac + 0.6 * nearSandFrac + 0.35 * nearWasteFrac) -
    120 * (waterFrac + 0.6 * sandFrac + 0.25 * wasteFrac);
  // A small bonus for some contrast, but don't reward excessive hazards.
  aestheticsScore += 10 * clamp(nearWaterFrac, 0, 0.12) / 0.12;
  // Deep rough is visually noisy if overused; allow small amounts without penalty.
  aestheticsScore -= 35 * clamp(nearDeepRoughFrac - 0.12, 0, 1);
  // Obstacles: off/near corridor can look nice, but too many becomes clutter.
  aestheticsScore += 4 * obstacleStats.treeScenic + 3 * obstacleStats.bushScenic;
  aestheticsScore += 1 * obstacleStats.treeOff + 0.5 * obstacleStats.bushOff;
  aestheticsScore -= 12 * obstacleStats.treeOnLine + 6 * obstacleStats.bushOnLine;
  const obstacleTotal = obstacleStats.total;
  if (obstacleTotal > 22) aestheticsScore -= 2 * (obstacleTotal - 22);
  aestheticsScore = clamp(aestheticsScore, 0, 100);

  // Overall: weighted towards playability, then aesthetics, and lightly penalize excessive difficulty.
  let overallHoleScore = 0.6 * playabilityScore + 0.25 * aestheticsScore + 0.15 * (100 - difficultyScore);
  // Extra penalty if corridor is mostly hazards.
  overallHoleScore -= 30 * clamp(onHazardFrac - 0.25, 0, 1);
  // Extra penalty if corridor is mostly "bad lies" (rough/deep rough/hazards).
  overallHoleScore -= 18 * clamp(onBadLieFrac - 0.55, 0, 1);
  overallHoleScore = clamp(overallHoleScore, 0, 100);
  const score = overallHoleScore; // legacy alias used by existing aggregation

  const isValid = issues.length === 0 && maxOk && minDistOk;

  return {
    holeIndex,
    isComplete: true,
    isValid,
    par,
    autoPar,
    scratchShotsToGreen,
    bogeyShotsToGreen,
    reachableInTwo,
    straightDistance,
    effectiveDistance,
    path: poly,
    shotPlan,
    playabilityScore,
    difficultyScore,
    aestheticsScore,
    overallHoleScore,
    corridor: corridorCounts,
    score,
    layoutIssues,
    issues,
  };
}

interface HoleScoreCacheEntry {
  searchDomain: ShotSearchDomain;
  width: number;
  height: number;
  yardsPerTile: number;
  holeIndex: number;
  theme: Course["theme"];
  themeSensitive: boolean;
  obstacles: Course["obstacles"];
  tileDependencies: Map<number, Terrain>;
  elevationDependencies: Map<number, number>;
  elevationToken: object | null;
  result: HoleScore;
  borrowProof?: PublicBorrowProof;
}

type DataSnapshot = { key: PropertyKey; descriptor: PropertyDescriptor }[];
type HoleInputSnapshot = { data: DataSnapshot; tee: DataSnapshot | null; green: DataSnapshot | null };
type ObstacleInputSnapshot = { value: Obstacle; data: DataSnapshot }[];
type PublicScoreContext = { complete: boolean; obstacles: ObstacleInputSnapshot };
type PristineScore = { score: HoleScore; tee: Point | null; green: Point | null };
type PublicBorrowProof = {
  context: PublicScoreContext;
  hole: HoleInputSnapshot;
  pristine: PristineScore;
  tiles: Course["tiles"];
  elevations: Course["elevations"];
};

const MAX_BORROW_HOLES = 36;
const MAX_BORROW_OBSTACLES = 900;
const MAX_BORROW_OBJECTS = 512;
const MAX_BORROW_PROPERTIES = 4096;

let holeScoreCache = new WeakMap<Hole, HoleScoreCacheEntry>();
let holeScoreCacheHits = 0;
let holeScoreCacheMisses = 0;
// An optimized search can omit old rejected-candidate elevation reads. Keep
// immutable elevation replacement conservative without retaining its array in
// each Hole entry: a retained empty token has no reference back to its key.
const elevationTokens = new WeakMap<number[], object>();
function elevationTokenFor(values: number[]): object {
  const cached = elevationTokens.get(values);
  if (cached) return cached;
  const token = {};
  elevationTokens.set(values, token);
  return token;
}

function numericIndex(property: string | symbol): number | null {
  if (typeof property !== "string" || property.length === 0) return null;
  // Short decimal indices are exact integers. Avoid regexp and Number work
  // on the hot array-read path; retain the original conversion for long keys.
  if (property.length <= 9) {
    let index = 0;
    for (let i = 0; i < property.length; i++) {
      const digit = property.charCodeAt(i) - 48;
      if (digit < 0 || digit > 9) return null;
      index = index * 10 + digit;
    }
    return index;
  }
  return /^\d+$/.test(property) ? Number(property) : null;
}

function trackArrayReads<T>(values: T[], dependencies: Map<number, T>, readOwnArray: boolean): T[] {
  return new Proxy(values, {
    get(target, property, receiver) {
      const index = numericIndex(property);
      // A newly prepared internal domain verified every array cell as an own
      // data property. Reuse the dependency value for canonical in-bounds reads.
      if (readOwnArray && index !== null && index < target.length
        && typeof property === "string" && (property.length === 1 || property.charCodeAt(0) !== 48)) {
        const value = target[index];
        dependencies.set(index, value);
        return value;
      }
      if (index !== null) dependencies.set(index, target[index]);
      return Reflect.get(target, property, receiver);
    },
  });
}

function dependenciesMatch<T>(dependencies: Map<number, T>, values: T[]): boolean {
  for (const [index, previous] of dependencies) {
    if (values[index] !== previous) return false;
  }
  return true;
}

// The borrow proof is optional. Inspect descriptors without invoking an input
// getter, and decline unusual data rather than changing public scoring.
function dataSnapshot(value: unknown, maxKeys: number, scalarsOnly = false): DataSnapshot | undefined {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return;
  const keys = Reflect.ownKeys(value);
  if (keys.length > maxKeys) return;
  const result: DataSnapshot = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return;
    const item = descriptor.value;
    if (scalarsOnly && (item !== null && typeof item === "object" || typeof item === "function")) return;
    if (typeof item === "number" && !Number.isFinite(item)) return;
    result.push({ key, descriptor });
  }
  return result;
}

function sameData(a: DataSnapshot, b: DataSnapshot): boolean {
  return a.length === b.length && a.every(({ key, descriptor: x }, index) => {
    const { key: otherKey, descriptor: y } = b[index];
    return key === otherKey && x.enumerable === y.enumerable && x.configurable === y.configurable
      && x.writable === y.writable && Object.is(x.value, y.value);
  });
}

function pointSnapshot(point: Point | null): DataSnapshot | null | undefined {
  if (point === null) return null;
  const snapshot = dataSnapshot(point, 8, true);
  if (!snapshot) return;
  const x = snapshot.find((item) => item.key === "x")?.descriptor.value;
  const y = snapshot.find((item) => item.key === "y")?.descriptor.value;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isInteger(x) || !Number.isInteger(y)
    || Object.is(x, -0) || Object.is(y, -0)) return;
  return snapshot;
}

function holeInputSnapshot(hole: Hole): HoleInputSnapshot | undefined {
  const data = dataSnapshot(hole, 32);
  if (!data || (hole.parMode !== "AUTO" && hole.parMode !== "MANUAL")
    || hole.parManual !== undefined && (!Number.isInteger(hole.parManual) || hole.parManual < 3 || hole.parManual > 5)) return;
  const tee = pointSnapshot(hole.tee);
  const green = pointSnapshot(hole.green);
  if (tee === undefined || green === undefined) return;
  return { data, tee, green };
}

function sameHoleInput(a: HoleInputSnapshot, b: HoleInputSnapshot): boolean {
  return sameData(a.data, b.data)
    && (a.tee === null || b.tee === null ? a.tee === b.tee : sameData(a.tee, b.tee))
    && (a.green === null || b.green === null ? a.green === b.green : sameData(a.green, b.green));
}

function obstacleInputSnapshot(obstacles: Obstacle[]): ObstacleInputSnapshot | undefined {
  if (obstacles.length > MAX_BORROW_OBSTACLES || Object.getPrototypeOf(obstacles) !== Array.prototype
    || Reflect.ownKeys(obstacles).length !== obstacles.length + 1) return;
  const result: ObstacleInputSnapshot = [];
  for (let index = 0; index < obstacles.length; index++) {
    const item = Object.getOwnPropertyDescriptor(obstacles, String(index));
    if (!item || !("value" in item)) return;
    const data = dataSnapshot(item.value, 8, true);
    if (!data || typeof item.value.x !== "number" || typeof item.value.y !== "number"
      || !Number.isFinite(item.value.x) || !Number.isFinite(item.value.y)
      || typeof item.value.type !== "string") return;
    result.push({ value: item.value, data });
  }
  return result;
}

function sameObstacleInputs(a: ObstacleInputSnapshot, b: ObstacleInputSnapshot): boolean {
  return a.length === b.length && a.every((item, index) => item.value === b[index].value && sameData(item.data, b[index].data));
}

// Clone the internally produced score, preserving its point alias graph and
// frozen slope descriptors. Replacements bind input aliases to the private
// projection only in the returned private copy.
function cloneScoreGraph<T>(value: T, replacements = new Map<object, object>()): T | undefined {
  const seen = new Map<object, object>(replacements);
  let objects = 0;
  let properties = 0;
  const clone = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") {
      if (typeof item === "function") throw new Error("unsupported score value");
      return item;
    }
    const prior = seen.get(item);
    if (prior) return prior;
    const isArray = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (isArray ? Array.prototype : Object.prototype)
      || ++objects > MAX_BORROW_OBJECTS) throw new Error("unsupported score object");
    const target: object = isArray ? [] : {};
    seen.set(item, target);
    const keys = Reflect.ownKeys(item);
    if ((properties += keys.length) > MAX_BORROW_PROPERTIES) throw new Error("oversize score");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !("value" in descriptor)) throw new Error("score accessor");
      Object.defineProperty(target, key, { ...descriptor, value: clone(descriptor.value) });
    }
    if (Object.isFrozen(item)) Object.freeze(target);
    else if (Object.isSealed(item)) Object.seal(target);
    else if (!Object.isExtensible(item)) Object.preventExtensions(target);
    return target;
  };
  try { return clone(value) as T; }
  catch { return; }
}

function pristineScore(result: HoleScore, hole: Hole): PristineScore | undefined {
  const tee = hole.tee ? cloneScoreGraph(hole.tee) : null;
  const green = hole.green === hole.tee ? tee : hole.green ? cloneScoreGraph(hole.green) : null;
  if (tee === undefined || green === undefined) return;
  const aliases = new Map<object, object>();
  if (hole.tee && tee) aliases.set(hole.tee, tee);
  if (hole.green && green) aliases.set(hole.green, green);
  const score = cloneScoreGraph(result, aliases);
  return score && { score, tee, green };
}

function privateScoreCopy(proof: PublicBorrowProof, projectedHole: Hole): HoleScore | undefined {
  const aliases = new Map<object, object>();
  if (proof.pristine.tee && projectedHole.tee) aliases.set(proof.pristine.tee, projectedHole.tee);
  if (proof.pristine.green && projectedHole.green) aliases.set(proof.pristine.green, projectedHole.green);
  return cloneScoreGraph(proof.pristine.score, aliases);
}

function cachedHoleMatches(cached: HoleScoreCacheEntry | undefined, course: Course, holeIndex: number, searchDomain: ShotSearchDomain, elevations: number[], elevationToken: object | null): cached is HoleScoreCacheEntry {
  return !!cached && sameShotSearchDomain(cached.searchDomain, searchDomain)
    && cached.elevationToken === elevationToken
    && cached.width === course.width && cached.height === course.height
    && cached.yardsPerTile === (course.yardsPerTile ?? 10) && cached.holeIndex === holeIndex
    && (!cached.themeSensitive || cached.theme === course.theme)
    && cached.obstacles === course.obstacles
    && dependenciesMatch(cached.tileDependencies, course.tiles)
    && dependenciesMatch(cached.elevationDependencies, elevations);
}

/**
 * Memoize each hole by the exact terrain/elevation cells its previous solve
 * read. A paint stroke only invalidates a hole when it changes an input that
 * participated in that hole's Dijkstra search, while immutable marker and
 * obstacle identities invalidate naturally.
 */
export function scoreHole(course: Course, hole: Hole, holeIndex: number, preparedDomain?: ShotSearchDomain): HoleScore {
  course = courseWithEffectiveSurfaces(course);
  const searchDomain = preparedDomain ?? prepareShotSearchDomain(course, hole);
  // A supplied public domain does not prove that this call's arrays were
  // inspected. Only this module's freshly prepared paths may reuse own reads.
  return scoreHoleWithPreparedDomain(course, hole, holeIndex, searchDomain, preparedDomain === undefined && searchDomain.eligible);
}

function scoreHoleWithPreparedDomain(course: Course, hole: Hole, holeIndex: number, searchDomain: ShotSearchDomain, readOwnArray: boolean, publicContext?: PublicScoreContext): HoleScore {
  const cached = holeScoreCache.get(hole);
  const elevations = course.elevations ?? [];
  const elevationToken = searchDomain.eligible ? elevationTokenFor(elevations) : null;
  if (cachedHoleMatches(cached, course, holeIndex, searchDomain, elevations, elevationToken)) {
    holeScoreCacheHits++;
    return cached.result;
  }

  holeScoreCacheMisses++;
  let input: HoleInputSnapshot | undefined;
  if (publicContext) {
    try { input = holeInputSnapshot(hole); }
    catch { /* Optional borrow proof must not change public scoring. */ }
  }
  const tileDependencies = new Map<number, Terrain>();
  const elevationDependencies = new Map<number, number>();
  const trackedCourse: Course = {
    ...course,
    tiles: trackArrayReads(course.tiles, tileDependencies, readOwnArray),
    ...(course.elevations
      ? { elevations: trackArrayReads(course.elevations, elevationDependencies, readOwnArray) }
      : {}),
  };
  const result = withShotSearchDomain(trackedCourse, searchDomain, () => scoreHoleUncached(trackedCourse, hole, holeIndex));
  let borrowProof: PublicBorrowProof | undefined;
  if (publicContext && input) {
    try {
      const current = holeInputSnapshot(hole);
      const pristine = current && sameHoleInput(input, current) ? pristineScore(result, hole) : undefined;
      if (pristine) borrowProof = { context: publicContext, hole: input, pristine, tiles: course.tiles, elevations: course.elevations };
    } catch { /* Optional borrow proof must not change public scoring. */ }
  }
  holeScoreCache.set(hole, {
    searchDomain,
    width: course.width,
    height: course.height,
    yardsPerTile: course.yardsPerTile ?? 10,
    holeIndex,
    theme: course.theme,
    // Theme-specific shot scoring currently applies only to deep rough. If
    // the exact tracked solve footprint never read deep rough, an otherwise
    // identical immutable geometry is safe to reuse across biome roots.
    themeSensitive: [...tileDependencies.values()].some((terrain) => terrain === "deep_rough"),
    obstacles: course.obstacles,
    tileDependencies,
    elevationDependencies,
    elevationToken,
    result,
    borrowProof,
  });
  return result;
}

export function __getHoleScoreCacheStatsForTests(): { hits: number; misses: number } {
  return { hits: holeScoreCacheHits, misses: holeScoreCacheMisses };
}

export function __getHoleScoreDependenciesForTests(hole: Hole): number[] {
  return [...(holeScoreCache.get(hole)?.tileDependencies.keys() ?? [])];
}

export function __resetHoleScoreCacheForTests(): void {
  holeScoreCache = new WeakMap<Hole, HoleScoreCacheEntry>();
  holeScoreCacheHits = 0;
  holeScoreCacheMisses = 0;
}

// Whole-summary identity caching handles repeated reads in one render. The
// per-hole dependency cache above carries expensive solves across immutable
// course objects produced by drag painting/sculpting.
const summaryCache = new WeakMap<Course, { result: CourseHoleSummary; searchDomain: ShotSearchDomain; everOptimized: boolean }>();

export function scoreCourseHoles(course: Course): CourseHoleSummary {
  const cached = summaryCache.get(course);
  if (cached && shotSearchConfigUnchanged(cached.searchDomain, cached.everOptimized)) return cached.result;
  const effectiveCourse = courseWithEffectiveSurfaces(course);
  const searchDomain = prepareShotSearchDomain(effectiveCourse);
  const result = scoreCourseHolesUncached(effectiveCourse, searchDomain);
  summaryCache.set(course, { result, searchDomain, everOptimized: !!cached?.everOptimized || searchDomain.eligible });
  return result;
}

type PrivateBorrowPlan = {
  source: Course;
  sourceHoles: readonly Hole[];
  checkedContexts: Map<PublicScoreContext, boolean>;
  consumed: HoleScoreCacheEntry[];
};

function privateBorrowedHole(course: Course, hole: Hole, holeIndex: number, searchDomain: ShotSearchDomain, plan: PrivateBorrowPlan): HoleScore | undefined {
  if (!searchDomain.eligible || plan.source.holes.length !== course.holes.length
    || plan.source.tiles !== course.tiles || plan.source.elevations !== course.elevations
    || plan.source.obstacles !== course.obstacles || plan.source.width !== course.width
    || plan.source.height !== course.height || !Object.is(plan.source.yardsPerTile, course.yardsPerTile)
    || plan.source.theme !== course.theme) return;
  const original = plan.sourceHoles[holeIndex];
  if (!original || original === hole) return;
  const cached = holeScoreCache.get(original);
  const proof = cached?.borrowProof;
  const elevations = course.elevations ?? [];
  const elevationToken = elevationTokenFor(elevations);
  if (!proof?.context.complete || proof.tiles !== course.tiles || proof.elevations !== course.elevations
    || !cachedHoleMatches(cached, course, holeIndex, searchDomain, elevations, elevationToken)) return;
  let valid = plan.checkedContexts.get(proof.context);
  if (valid === undefined) {
    const now = obstacleInputSnapshot(course.obstacles);
    valid = !!now && sameObstacleInputs(proof.context.obstacles, now);
    plan.checkedContexts.set(proof.context, valid);
  }
  if (!valid) return;
  const sourceInput = holeInputSnapshot(original);
  const projectedInput = holeInputSnapshot(hole);
  if (!sourceInput || !projectedInput || !sameHoleInput(proof.hole, sourceInput)
    || !sameHoleInput(sourceInput, projectedInput)) return;
  const score = privateScoreCopy(proof, hole);
  if (!score) return;
  // The independent score belongs to the projected hole; completed dependency
  // maps may be shared because no solve mutates them after publication.
  holeScoreCache.set(hole, { ...cached, result: score, borrowProof: undefined });
  plan.consumed.push(cached);
  holeScoreCacheHits++;
  return score;
}

/** Internal private rating bridge. Public scoreCourseHoles retains its exact
 * identity cache, result aliases, and fallback policy. */
export function scoreCourseHolesForPrivateRating(source: Course, projected: Course, sourceHoles: readonly Hole[]): CourseHoleSummary {
  const effectiveCourse = courseWithEffectiveSurfaces(projected);
  const searchDomain = prepareShotSearchDomain(effectiveCourse);
  const plan: PrivateBorrowPlan = { source, sourceHoles, checkedContexts: new Map(), consumed: [] };
  const result = scoreCourseHolesUncached(effectiveCourse, searchDomain, plan);
  for (const entry of plan.consumed) entry.borrowProof = undefined;
  return result;
}

/** Score one inspector hole with the same effective terrain and whole-course
 * search-domain eligibility used by scoreCourseHoles. */
export function scoreSelectedCourseHole(course: Course, holeIndex: number): HoleScore | undefined {
  const effectiveCourse = courseWithEffectiveSurfaces(course);
  const hole = effectiveCourse.holes[holeIndex];
  if (!hole) return undefined;
  const searchDomain = prepareShotSearchDomain(effectiveCourse);
  return searchDomain.eligible
    ? scoreHoleWithPreparedDomain(effectiveCourse, hole, holeIndex, searchDomain, true)
    : scoreHole(effectiveCourse, hole, holeIndex, searchDomain);
}

function scoreCourseHolesUncached(course: Course, searchDomain: ShotSearchDomain, privatePlan?: PrivateBorrowPlan): CourseHoleSummary {
  let publicContext: PublicScoreContext | undefined;
  if (!privatePlan && searchDomain.eligible && course.holes.length <= MAX_BORROW_HOLES) {
    try {
      const obstacles = obstacleInputSnapshot(course.obstacles);
      if (obstacles) publicContext = { complete: false, obstacles };
    } catch { /* Optional borrow proof must not change public scoring. */ }
  }
  const holes = course.holes.map((h, i) => {
    if (!searchDomain.eligible) return scoreHole(course, h, i, searchDomain);
    if (privatePlan) {
      const existing = holeScoreCache.get(h);
      const elevations = course.elevations ?? [];
      const elevationToken = elevationTokenFor(elevations);
      if (cachedHoleMatches(existing, course, i, searchDomain, elevations, elevationToken)) {
        holeScoreCacheHits++;
        return existing.result;
      }
      try {
        const borrowed = privateBorrowedHole(course, h, i, searchDomain, privatePlan);
        if (borrowed) return borrowed;
      } catch { /* Unusual inputs retain the original private scoring path. */ }
    }
    return scoreHoleWithPreparedDomain(course, h, i, searchDomain, true, publicContext);
  });
  const scored = holes.filter((h) => h.isComplete);
  const holeQualityAvg =
    scored.length === 0 ? 0 : scored.reduce((acc, h) => acc + h.overallHoleScore, 0) / scored.length;

  // Variety: reward mix of par 3/4/5 (or derived lengths if par missing)
  const parCounts = new Map<number, number>();
  for (const h of holes) parCounts.set(h.par, (parCounts.get(h.par) ?? 0) + 1);
  const distinctPars = parCounts.size; // 1..3 in MVP
  const variety = clamp(20 + 40 * distinctPars, 0, 100); // 60 for 1 par, 100 for 2+, simple MVP

  // Small global bonuses for some pathing + tasteful water usage
  const total = course.tiles.length || 1;
  const pathFrac = course.tiles.filter((t) => t === "path").length / total;
  const waterFrac = course.tiles.filter((t) => t === "water").length / total;
  const deepRoughFrac = course.tiles.filter((t) => t === "deep_rough").length / total;
  const obstacleFrac = (course.obstacles?.length ?? 0) / total;
  const deepRoughPenalty = 12 * clamp(deepRoughFrac - 0.28, 0, 1); // allow some; penalize heavy overuse
  const obstaclePenalty = 10 * clamp(obstacleFrac - 0.06, 0, 1); // clutter penalty
  const globalBonus = clamp(
    8 * pathFrac - 6 * Math.max(0, waterFrac - 0.08) - deepRoughPenalty - obstaclePenalty,
    -10,
    10
  );

  const courseQuality = clamp(holeQualityAvg + globalBonus + 0.15 * (variety - 70), 0, 100);

  const result = { holes, holeQualityAvg, variety, globalBonus, courseQuality };
  if (publicContext) publicContext.complete = true;
  return result;
}

function scoreObstaclesAgainstCorridor(obstacles: Obstacle[], corridorPts: Point[]) {
  if (corridorPts.length === 0 || obstacles.length === 0) {
    return {
      treeOnLine: 0,
      bushOnLine: 0,
      treeNear: 0,
      bushNear: 0,
      treeScenic: 0,
      bushScenic: 0,
      treeOff: 0,
      bushOff: 0,
      total: 0,
    };
  }

  function cheb(a: Point, b: Point) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  let treeOnLine = 0;
  let bushOnLine = 0;
  let treeNear = 0;
  let bushNear = 0;
  let treeScenic = 0;
  let bushScenic = 0;
  let treeOff = 0;
  let bushOff = 0;

  for (const o of obstacles) {
    let d = Infinity;
    for (const p of corridorPts) d = Math.min(d, cheb(o, p));

    const isTree = o.type === "tree";
    if (d === 0) {
      if (isTree) treeOnLine++;
      else bushOnLine++;
    } else if (d === 1) {
      if (isTree) treeNear++;
      else bushNear++;
    } else if (d <= 3) {
      if (isTree) treeScenic++;
      else bushScenic++;
    } else {
      if (isTree) treeOff++;
      else bushOff++;
    }
  }

  const total = treeOnLine + bushOnLine + treeNear + bushNear + treeScenic + bushScenic + treeOff + bushOff;
  return { treeOnLine, bushOnLine, treeNear, bushNear, treeScenic, bushScenic, treeOff, bushOff, total };
}
