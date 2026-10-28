import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Terrain } from "../../models/types";
import { BALANCE } from "../../balance/balanceConfig";
import { courseForCourseSetup } from "../../models/courseSetup";
import { createReferenceCourse } from "../../testing/referenceCourse";
import { getGolferProfile, type GolferProfile } from "../golferProfiles";
import * as holes from "../holes";
import { __resetPrivateRatingScoringForTests, scorePrivateRatingSetup } from "../privateRatingScoring";
import * as domain from "./shotSearchDomain";
import * as solver from "./solveShotsToGreen";

const evaluationCounter = vi.hoisted(() => ({ value: 0 }));
// Plain delegate: unlike vi.spyOn/vi.fn this retains no hot-call args/results.
vi.mock("./evalShotExpectedCost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./evalShotExpectedCost")>();
  const evaluate = actual.evalShotExpectedCost;
  return { ...actual, evalShotExpectedCost: (args: Parameters<typeof evaluate>[0]) => {
    evaluationCounter.value++;
    return evaluate(args);
  } };
});

const actualSolve = solver.solveShotsToGreen;
const actualScore = holes.scoreCourseHoles;
const actualPrepare = domain.prepareShotSearchDomain;
let solverCalls = 0;
let scorerCalls = 0;
let dependencyMaps: Map<unknown, unknown>[] = [];
const restores: (() => void)[] = [];

beforeEach(() => {
  holes.__resetHoleScoreCacheForTests();
  __resetPrivateRatingScoringForTests();
  solverCalls = scorerCalls = 0;
  evaluationCounter.value = 0;
  dependencyMaps = [];
  vi.spyOn(solver, "solveShotsToGreen").mockImplementation((args) => { solverCalls++; return actualSolve(args); });
  vi.spyOn(holes, "scoreCourseHoles").mockImplementation((course) => { scorerCalls++; return actualScore(course); });
  const NativeMap = Map;
  class ObservedMap<K, V> extends NativeMap<K, V> {
    constructor(entries?: readonly (readonly [K, V])[] | null) {
      super(entries);
      if (/scoreHole\s*\(.*[/\\]holes\.ts:/.test(new Error().stack?.split("\n")[2] ?? "")) dependencyMaps.push(this);
    }
  }
  vi.stubGlobal("Map", ObservedMap);
});

afterEach(() => {
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  holes.__resetHoleScoreCacheForTests();
  __resetPrivateRatingScoringForTests();
  dependencyMaps.length = 0;
});

function counts(solvers: number, scorers = 0, cold = 0) {
  expect([solverCalls, scorerCalls, holes.__getHoleScoreCacheStatsForTests().misses]).toEqual([solvers, scorers, cold]);
  expect(dependencyMaps).toHaveLength(cold * 2);
  console.info("FRONTIER_FLOOR_COUNTS", JSON.stringify({ solvers: solverCalls, scorers: scorerCalls, cold }));
}

function fixture(width = 16, height = 12, hazard = false): Course {
  const base = createReferenceCourse();
  const tee = { x: 2, y: Math.floor(height / 2) };
  const green = { x: width - 3, y: tee.y };
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  if (hazard) for (let y = 0; y < height; y++) for (let x = green.x - 1; x <= green.x + 1; x++) tiles[y * width + x] = "wetland";
  return { ...base, width, height, tiles, elevations: new Array<number>(tiles.length).fill(0), buildings: [],
    holes: [{ tee, green, parMode: "MANUAL", parManual: 4 }], obstacles: [] };
}

function setValue(target: object, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
  Object.defineProperty(target, key, { ...descriptor, value });
  restores.push(() => Object.defineProperty(target, key, descriptor));
}

function getter(target: object, key: string, read: () => unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, get: read });
  restores.push(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
}

function argsFor(course: Course, profile: GolferProfile = getGolferProfile("SCRATCH", course)) {
  return { course, tee: course.holes[0].tee!, green: course.holes[0].green!, golfer: profile };
}

function admittedSolve(args: ReturnType<typeof argsFor>) {
  return domain.withShotSearchDomain(args.course, domain.prepareShotSearchDomain(args.course), () => solver.solveShotsToGreen(args));
}

function originalScore(course: Course) {
  // The full actual scorer is the oracle; only its private registration is
  // declined. Fresh root/Hole identities prevent cache results becoming oracle.
  const bypass = vi.spyOn(domain, "prepareShotSearchDomain").mockImplementation((...args) => { actualPrepare(...args); return { eligible: false, config: null }; });
  try { return holes.scoreCourseHoles({ ...course, holes: course.holes.map((hole) => ({ ...hole })) }); }
  finally { bypass.mockRestore(); }
}

describe("global scoring frontier floor: fixed finite ledger", () => {
  const graphRows = [
    { name: "equal final edge", g: 2, d: 1, edges: [1], admitted: true },
    { name: "equal ancestor costs", g: 3, d: 2, edges: [1], admitted: true },
    { name: "strictly more expensive suffix", g: 2.5, d: 2, edges: [1], admitted: true },
    { name: "multiple suffix edges", g: 3, d: 2, edges: [1, 1], admitted: true },
    { name: "rounded large equality", g: 1e16, d: 1e16, edges: [1], admitted: true },
    { name: "smaller stale frontier delays stop", g: 3, d: 1, edges: [2], admitted: true },
    { name: "subunit mutant must decline", g: 3, d: 2.5, edges: [0.2], admitted: false },
    { name: "negative mutant must decline", g: 3, d: 2.5, edges: [-0.2], admitted: false },
  ];
  for (const row of graphRows) it(`proves ${row.name}`, () => {
    const suffix = row.edges.reduce((sum, edge) => sum + edge, row.d);
    const stops = row.g <= row.d + 1;
    if (row.admitted && stops) {
      expect(suffix).toBeGreaterThanOrEqual(row.g);
      for (const ancestor of [0, Math.min(row.g, row.d), row.g]) expect(suffix < ancestor).toBe(false);
    }
    if (!row.admitted) { expect(stops).toBe(true); expect(suffix).toBeLessThan(row.g); }
    if (row.name === "smaller stale frontier delays stop") expect(stops).toBe(false);
    if (row.name === "negative mutant must decline") {
      const course = fixture();
      const old = domain.prepareShotSearchDomain(course);
      setValue(BALANCE.shots.landing.penaltyStrokes, "rough", 0.3);
      expect(domain.sameShotSearchDomain(old, domain.prepareShotSearchDomain(course))).toBe(false);
      expect(domain.shotSearchConfigUnchanged(old)).toBe(false);
    }
    counts(0);
  });

  const directRows = ["open SCRATCH", "open BOGEY", "hazard SCRATCH", "hazard BOGEY", "short wetland", "equal clubs",
    "out of bounds", "water tee", "water green", "same point", "slope SCRATCH", "slope BOGEY"];
  for (const name of directRows) it(`retains actual complete solver output for ${name}`, () => {
    const course = fixture(16, 12, name.startsWith("hazard") || name === "equal clubs");
    const profile = getGolferProfile(name.includes("BOGEY") ? "BOGEY" : "SCRATCH", course);
    if (name === "short wetland") { course.tiles.fill("wetland"); profile.clubs = [{ name: "short", carryYards: 20, dispersionTilesBase: 1 }]; }
    if (name === "equal clubs") profile.clubs = [{ name: "first", carryYards: 55, dispersionTilesBase: 1 }, { name: "second", carryYards: 55, dispersionTilesBase: 1 }];
    if (name === "out of bounds") course.holes[0].tee = { x: -1, y: 6 };
    if (name === "water tee") course.tiles[6 * 16 + 2] = "water";
    if (name === "water green") course.tiles[6 * 16 + 13] = "water";
    if (name === "same point") course.holes[0].green = course.holes[0].tee;
    if (name.startsWith("slope")) course.elevations[6 * 16 + 13] = 3;
    const args = argsFor(course, profile);
    const oracle = solver.solveShotsToGreen(args);
    const originalEvaluations = evaluationCounter.value;
    const result = admittedSolve(args);
    const candidateEvaluations = evaluationCounter.value - originalEvaluations;
    expect(result).toEqual(oracle);
    if (name === "equal clubs" && result.reachable) expect(result.plan.every((step) => step.club === "first")).toBe(true);
    if (name.startsWith("hazard")) {
      expect(result.expectedShotsToGreen).toBeGreaterThanOrEqual(2);
      expect(candidateEvaluations).toBeLessThan(originalEvaluations);
    }
    counts(2);
  });

  const traceRows = ["terrain mutation", "elevation leading zero", "point mutation", "width falsy throw",
    "landing original throw", "water accessor", "theme mutation", "club accessor"];
  for (const name of traceRows) it(`preserves original ordered reads and first cause for ${name}`, () => {
    const firstCause = new Error("original producer");
    function capture(admitted: boolean) {
      const course = fixture(16, 12, name === "water accessor");
      const profile = getGolferProfile("SCRATCH", course);
      const reads: string[] = [];
      const restoreStart = restores.length;
      const alter = () => { setValue(BALANCE.shots.landing.penaltyStrokes, "rough", -0.2); };
      if (name === "terrain mutation") getter(course.tiles, "109", () => { reads.push("terrain"); if (reads.length === 1) alter(); return "fairway"; });
      if (name === "elevation leading zero") {
        Object.defineProperty(course.elevations, "01", { value: 0, configurable: true });
        getter(course.elevations, "98", () => { reads.push("elevation"); return Reflect.get(course.elevations, "01"); });
      }
      if (name === "point mutation") getter(course.holes[0].tee!, "x", () => { reads.push("point"); if (reads.length === 1) alter(); return 2; });
      if (name === "width falsy throw") getter(course, "width", () => { reads.push("width"); throw false; });
      if (name === "landing original throw") getter(BALANCE.shots.landing.penaltyStrokes, "rough", () => { reads.push("landing"); throw firstCause; });
      if (name === "water accessor") getter(BALANCE.shots.water, "shortMissMaxProb", () => { reads.push("water"); return 0.22; });
      if (name === "theme mutation") getter(BALANCE.themes.parkland, "deepRoughPenaltyMult", () => { reads.push("theme"); if (reads.length === 1) alter(); return 1; });
      if (name === "club accessor") getter(profile.clubs[0], "carryYards", () => { reads.push("club"); return 280; });
      try {
        const args = argsFor(course, profile);
        try { return { result: admitted ? admittedSolve(args) : solver.solveShotsToGreen(args), reads, threw: false, cause: undefined }; }
        catch (cause) { return { result: undefined, reads, threw: true, cause }; }
      } finally { while (restores.length > restoreStart) restores.pop()!(); }
    }
    const oracle = capture(false);
    const result = capture(true);
    expect(result).toEqual(oracle);
    expect(result.reads.length).toBeGreaterThan(0);
    if (name === "width falsy throw") { expect(result.threw).toBe(true); expect(result.cause).toBe(false); }
    if (name === "landing original throw") { expect(result.threw).toBe(true); expect(result.cause).toBe(firstCause); }
    counts(2);
  });

  const balanceRows = [
    { name: "negative landing", target: BALANCE.shots.landing.penaltyStrokes, key: "wetland", value: -0.2 },
    { name: "negative probability", target: BALANCE.shots.water, key: "shortMissMaxProb", value: -0.2 },
    { name: "negative water penalty", target: BALANCE.shots.water, key: "waterPenaltyStrokes", value: -1 },
    { name: "negative theme", target: BALANCE.themes.parkland, key: "deepRoughPenaltyMult", value: -1 },
    { name: "NaN utilization", target: BALANCE.shots.water, key: "shortMissUtilStart", value: NaN },
    { name: "infinite landing", target: BALANCE.shots.landing.penaltyStrokes, key: "rough", value: Infinity },
  ];
  for (const row of balanceRows) it(`keeps the original balance fallback for ${row.name}`, () => {
    setValue(row.target, row.key, row.value);
    const args = argsFor(fixture(16, 12, true));
    expect(domain.prepareShotSearchDomain(args.course).eligible).toBe(false);
    const oracle = solver.solveShotsToGreen(args);
    const originalEvaluations = evaluationCounter.value;
    expect(admittedSolve(args)).toEqual(oracle);
    expect(evaluationCounter.value - originalEvaluations).toBe(originalEvaluations);
    counts(2);
  });

  const cacheRows = ["removed terrain", "removed elevation", "consumed terrain", "consumed elevation", "theme", "obstacles",
    "immutable point", "private in-place point", "config eligibility transition"];
  for (const name of cacheRows) it(`preserves full actual score/cache semantics for ${name}`, () => {
    const removed = name.startsWith("removed");
    const course = fixture(removed ? 64 : 32, removed ? 32 : 16, true);
    if (name === "theme") course.tiles[course.holes[0].tee!.y * course.width + course.holes[0].tee!.x] = "deep_rough";
    const leanInitial = name === "immutable point" || name === "obstacles";
    const oracle = leanInitial ? undefined : originalScore(course);
    const oldMaps = dependencyMaps.slice(0, 2);
    const candidateMapStart = dependencyMaps.length;
    const result = name === "private in-place point"
      ? scorePrivateRatingSetup(course, courseForCourseSetup(course, "member", "A")) : holes.scoreCourseHoles(course);
    if (oracle) expect(result).toEqual(oracle);
    const saved = structuredClone(result);
    const newMaps = dependencyMaps.slice(candidateMapStart, candidateMapStart + 2);
    let edited: Course = { ...course };
    const teeIndex = course.holes[0].tee!.y * course.width + course.holes[0].tee!.x;
    if (removed) {
      const index = name === "removed terrain" ? 0 : 1;
      const omitted = [...oldMaps[index].keys()].find((key) => !newMaps[index].has(key));
      expect(omitted, "Fixed fixture must demonstrate a genuinely removed read; stop rather than grow it").toBeTypeOf("number");
      if (name === "removed terrain") { edited.tiles = course.tiles.slice(); edited.tiles[omitted as number] = course.tiles[omitted as number] === "water" ? "fairway" : "water"; }
      else { edited.elevations = course.elevations.slice(); edited.elevations[omitted as number] += 2; }
    }
    if (name === "consumed terrain") {
      const consumed = [...newMaps[0].keys()][0] as number;
      edited.tiles = course.tiles.slice(); edited.tiles[consumed] = course.tiles[consumed] === "sand" ? "rough" : "sand";
    }
    if (name === "consumed elevation") {
      expect(newMaps[1].has(teeIndex)).toBe(true);
      edited.elevations = course.elevations.slice(); edited.elevations[teeIndex] += 2;
    }
    if (name === "theme") edited.theme = "links";
    if (name === "obstacles") edited.obstacles = [...course.obstacles, { type: "tree", ...course.holes[0].tee! }];
    if (name === "immutable point") edited.holes = [{ ...course.holes[0], tee: { ...course.holes[0].tee!, x: 3 } }];
    if (name === "private in-place point") course.holes[0].tee!.x++;
    if (name === "config eligibility transition") { setValue(BALANCE.shots.landing.penaltyStrokes, "rough", -0.2); edited = course; }
    const changed = name === "private in-place point"
      ? scorePrivateRatingSetup(edited, courseForCourseSetup(edited, "member", "A")) : holes.scoreCourseHoles(edited);
    expect(changed).toEqual(originalScore(edited));
    if (name === "config eligibility transition") {
      restores.pop()!();
      const restored = holes.scoreCourseHoles(course);
      expect(restored).not.toBe(changed);
      expect(restored.holes[0]).not.toBe(changed.holes[0]);
      expect(restored).toEqual(originalScore(course));
      expect(restored).toEqual(saved);
    }
    if (removed) expect(changed.holes[0]).toBe(result.holes[0]);
    if (oracle) expect(result).toEqual(oracle);
    if (name !== "private in-place point") expect(result).toEqual(saved);
    if (name === "config eligibility transition") counts(12, 6, 6);
    else counts(removed || leanInitial ? 6 : 8, leanInitial ? 3 : 4, removed || leanInitial ? 3 : 4);
  });
});
