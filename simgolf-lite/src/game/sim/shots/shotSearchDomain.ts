import { BALANCE } from "../../balance/balanceConfig";
import { BIOME_DEFINITIONS } from "../../models/biomes";
import type { Course, Hole, Point, Terrain } from "../../models/types";
import { LEGACY_SOLVER_CLUB_PROFILES } from "../../rules/dispersionRegistry";
import type { GolferProfile } from "../golferProfiles";

type Scalar = string | number;
export interface ShotSearchDomain {
  readonly eligible: boolean;
  readonly config: readonly Scalar[] | null;
}

const terrains: readonly Terrain[] = ["rough", "deep_rough", "fairway", "sand", "waste_area", "water", "wetland", "green", "tee", "path"];
const ownedContexts = new WeakMap<Course, ShotSearchDomain>();

// Private normalized-state boundary, not a transparent-Proxy detector. Inspect
// descriptors rather than invoking getters. Standard synchronous intrinsics and
// the actual internal evaluator/profile constructors are part of this domain.
function dataRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).every((key) => "value" in Object.getOwnPropertyDescriptor(value, key)!);
}

function dataArray(value: unknown, accepts: (item: unknown) => boolean): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !accepts(descriptor.value)) return false;
  }
  return true;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function point(value: unknown): value is Point {
  return dataRecord(value) && finite(value.x) && finite(value.y)
    && Number.isInteger(value.x) && Number.isInteger(value.y);
}

function clubs(value: unknown): boolean {
  return dataArray(value, (club) => dataRecord(club) && typeof club.name === "string"
    && finite(club.carryYards) && club.carryYards > 0
    && finite(club.dispersionTilesBase) && club.dispersionTilesBase >= 0);
}

// A fixed scalar snapshot, never record references or JSON-coerced numbers.
// Relevant edits invalidate a previously shortened read footprint, including
// positive edits that retain the floor but change the actual shot costs.
function searchConfig(): readonly Scalar[] | null {
  if (!dataRecord(BALANCE) || !dataRecord(BALANCE.shots) || !dataRecord(BALANCE.shots.water)
    || !dataRecord(BALANCE.shots.landing) || !dataRecord(BALANCE.shots.landing.penaltyStrokes)
    || !dataRecord(BALANCE.shots.hole) || !dataRecord(BALANCE.elevation)
    || !dataRecord(BALANCE.themes) || !dataRecord(BIOME_DEFINITIONS)
    || !dataRecord(BALANCE.golfers) || !dataRecord(LEGACY_SOLVER_CLUB_PROFILES)) return null;
  const shots = BALANCE.shots;
  const water = shots.water;
  const result: Scalar[] = [];
  const numeric = [shots.utilizationThreshold, shots.dispersionRamp, water.carryBufferYards,
    water.maxExpectedShotsToGreen, water.shortMissUtilStart, water.shortMissMaxProb,
    water.waterPenaltyStrokes, shots.landing.maxRadiusTiles, BALANCE.elevation.shotYardsPerStep,
    shots.hole.minHoleDistanceYards, shots.hole.reachableInTwoThreshold];
  if (!numeric.every(finite) || water.shortMissMaxProb < 0 || water.waterPenaltyStrokes < 0
    || shots.dispersionRamp < 0 || !Number.isInteger(shots.landing.maxRadiusTiles)
    || shots.landing.maxRadiusTiles < 0 || shots.landing.maxRadiusTiles > 6) return null;
  result.push(...numeric);
  for (const terrain of terrains) {
    const descriptor = Object.getOwnPropertyDescriptor(shots.landing.penaltyStrokes, terrain);
    if (!descriptor || !("value" in descriptor) || !finite(descriptor.value) || descriptor.value < 0) return null;
    result.push(descriptor.value);
  }
  for (const theme of ["parkland", "links", "desert"] as const) {
    const definition = BIOME_DEFINITIONS[theme];
    const balance = BALANCE.themes[theme];
    if (!dataRecord(definition) || definition.key !== theme || !dataRecord(balance)
      || !finite(balance.deepRoughPenaltyMult) || balance.deepRoughPenaltyMult < 0) return null;
    result.push(balance.deepRoughPenaltyMult);
  }
  for (const name of ["SCRATCH", "BOGEY"] as const) {
    const profile = BALANCE.golfers[name === "SCRATCH" ? "scratch" : "bogey"];
    const sourceClubs = LEGACY_SOLVER_CLUB_PROFILES[name];
    if (!dataRecord(profile) || !dataRecord(profile.ratingMultipliers) || !finite(profile.yardsPerTile)
      || profile.yardsPerTile <= 0 || !clubs(sourceClubs)) return null;
    result.push(profile.yardsPerTile);
    for (const key of ["hazard", "rough", "deepRough", "obstacle"] as const) {
      if (!finite(profile.ratingMultipliers[key])) return null;
      result.push(profile.ratingMultipliers[key]);
    }
    result.push(sourceClubs.length);
    for (const club of sourceClubs) result.push(club.name, club.carryYards, club.dispersionTilesBase);
  }
  return result;
}

function sameConfig(a: readonly Scalar[] | null, b: readonly Scalar[] | null): boolean {
  return a === null || b === null ? a === b : a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

export function sameShotSearchDomain(a: ShotSearchDomain, b: ShotSearchDomain): boolean {
  return a.eligible === b.eligible && sameConfig(a.config, b.config);
}

export function shotSearchConfigUnchanged(domain: ShotSearchDomain, everOptimized = false): boolean {
  // A declined-from-start summary keeps its original identity-cache policy.
  // A downgraded optimized summary must miss when support is restored.
  if (!domain.eligible) return !everOptimized || searchConfig() === null;
  return sameConfig(domain.config, searchConfig());
}

/** Inspect once before tracking wrappers; no terrain/elevation values retained. */
export function prepareShotSearchDomain(course: Course, selectedHole?: Hole): ShotSearchDomain {
  const config = searchConfig();
  const declined: ShotSearchDomain = { eligible: false, config: null };
  if (!config || !dataRecord(course) || course.surfaceCare !== undefined
    || !Number.isInteger(course.width) || !Number.isInteger(course.height)
    || course.width < 1 || course.height < 1 || course.width >= 10_000 || course.height >= 10_000
    || !finite(course.yardsPerTile) || course.yardsPerTile <= 0
    || (course.theme !== undefined && course.theme !== "parkland" && course.theme !== "links" && course.theme !== "desert")
    || !dataArray(course.tiles, (value) => terrains.includes(value as Terrain))
    || !dataArray(course.elevations, finite)
    || course.tiles.length !== course.width * course.height || course.elevations.length !== course.tiles.length
    || !dataArray(course.obstacles, (value) => dataRecord(value) && finite(value.x) && finite(value.y)
      && (value.type === "tree" || value.type === "bush" || value.type === "rock"))) return declined;
  const holes = selectedHole ? [selectedHole] : course.holes;
  if (!dataArray(holes, (value) => dataRecord(value) && (value.tee === null || point(value.tee))
    && (value.green === null || point(value.green)))) return declined;
  return { eligible: true, config };
}

/** Only holes.ts binds its newly owned trackedCourse, for this synchronous call. */
export function withShotSearchDomain<T>(course: Course, domain: ShotSearchDomain, operation: () => T): T {
  if (!domain.eligible) return operation();
  const previous = ownedContexts.get(course);
  ownedContexts.set(course, domain);
  try { return operation(); }
  finally {
    if (previous) ownedContexts.set(course, previous);
    else ownedContexts.delete(course);
  }
}

export function scoringShotFloor(course: Course, tee: Point, green: Point, golfer: GolferProfile): 0 | 1 {
  const domain = ownedContexts.get(course);
  if (!domain || !point(tee) || !point(green) || !dataRecord(golfer) || !clubs(golfer.clubs)
    || !finite(golfer.yardsPerTile) || golfer.yardsPerTile <= 0 || !shotSearchConfigUnchanged(domain)) return 0;
  return 1;
}
