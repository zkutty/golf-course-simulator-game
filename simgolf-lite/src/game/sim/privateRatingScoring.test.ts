import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, Hole, PinRotation, TeeSet, Terrain } from "../models/types";
import { courseForCourseSetup } from "../models/courseSetup";
import { createReferenceCourse } from "../testing/referenceCourse";
import { courseWithEffectiveSurfaces, normalizeSurfaceCareState, surfaceCareTopology } from "../conditions/surfaceCare";
import * as holes from "./holes";
import * as solver from "./shots/solveShotsToGreen";
import * as privateScoring from "./privateRatingScoring";
import { computeCourseRatingAndSlope, computeRatingForSetup } from "./courseRating";
import { BALANCE } from "../balance/balanceConfig";

// Fixed small-fixture execution ledger. No M27 constructor or full-course solve.
// Each tuple is [actual baseline scorer entries, actual candidate scorer entries,
// actual cold HoleScore misses, actual low-level solver entries].
type Counts = readonly [number, number, number, number];
let phase: "baseline" | "candidate" = "baseline";
let counts = { baseline: 0, candidate: 0, solver: 0 };
const actualScore = holes.scoreCourseHoles;
const actualSolve = solver.solveShotsToGreen;

beforeEach(() => {
  holes.__resetHoleScoreCacheForTests();
  privateScoring.__resetPrivateRatingScoringForTests();
  counts = { baseline: 0, candidate: 0, solver: 0 };
  vi.spyOn(holes, "scoreCourseHoles").mockImplementation((course) => {
    counts[phase]++;
    return actualScore(course);
  });
  vi.spyOn(solver, "solveShotsToGreen").mockImplementation((args) => {
    counts.solver++;
    return actualSolve(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  holes.__resetHoleScoreCacheForTests();
  privateScoring.__resetPrivateRatingScoringForTests();
});

function checkCounts(expected: Counts) {
  expect([counts.baseline, counts.candidate, holes.__getHoleScoreCacheStatsForTests().misses, counts.solver]).toEqual(expected);
  console.info("PRIVATE_RATING_COUNTS", JSON.stringify({ baseline: counts.baseline, candidate: counts.candidate,
    coldMisses: holes.__getHoleScoreCacheStatsForTests().misses, solver: counts.solver }));
}

function fixture(): Course {
  const base = createReferenceCourse();
  return {
    ...base, width: 16, height: 9, yardsPerTile: 10, buildings: [],
    tiles: new Array<Terrain>(144).fill("fairway"), elevations: new Array<number>(144).fill(0),
    holes: [{ ...base.holes[0], tee: { x: 2, y: 4 }, green: { x: 13, y: 4 }, parMode: "MANUAL", parManual: 4 }],
  };
}

function fresh(course: Course, tee: TeeSet = "member", pin: PinRotation = "A") {
  const effective = courseWithEffectiveSurfaces(course);
  return { effective, projected: courseForCourseSetup(effective, tee, pin) };
}

function baseline(course: Course, tee: TeeSet = "member", pin: PinRotation = "A") {
  phase = "baseline";
  return holes.scoreCourseHoles(fresh(course, tee, pin).projected);
}

function candidate(course: Course, tee: TeeSet = "member", pin: PinRotation = "A") {
  phase = "candidate";
  const { effective, projected } = fresh(course, tee, pin);
  return privateScoring.scorePrivateRatingSetup(effective, projected);
}

function pair(course: Course, tee: TeeSet = "member", pin: PinRotation = "A") {
  const oracle = baseline(course, tee, pin);
  const result = candidate(course, tee, pin);
  expect(result).toEqual(oracle);
  return { oracle, result, saved: structuredClone(result) };
}

function twoHoleEstate(): Course {
  const base = fixture();
  const holes = [0, 1].map((index) => {
    const tee = { x: 2, y: 3 + index * 2 };
    const green = { x: 13, y: 3 + index * 2 };
    return { ...base.holes[0], id: `prefix-${index}`, tee, green,
      teeBoxes: { member: tee }, pinPositions: { A: green } };
  });
  return { ...base, holes };
}

function changeSearchPenalty(): () => void {
  const penalties = BALANCE.shots.landing.penaltyStrokes;
  const descriptor = Object.getOwnPropertyDescriptor(penalties, "rough")!;
  Object.defineProperty(penalties, "rough", { ...descriptor, value: descriptor.value + .125 });
  return () => { Object.defineProperty(penalties, "rough", descriptor); };
}

describe("setup and published-rating scoring reuse", () => {
  it("shares actual solves across UI setup, estate rating and leading operating-course rating", () => {
    const original = twoHoleEstate();
    const oldAdapter = vi.spyOn(privateScoring, "scorePrivateRatingSetup")
      .mockImplementation((_source, projected) => holes.scoreCourseHoles(projected));
    const oracleSetup = baseline(original);
    const oracleEstate = computeCourseRatingAndSlope(original);
    const oracleOperating = computeCourseRatingAndSlope({ ...original, holes: original.holes.slice(0, 1) });
    expect(holes.__getHoleScoreCacheStatsForTests().misses).toBe(5);
    expect(counts.solver).toBe(10);
    oldAdapter.mockRestore();

    holes.__resetHoleScoreCacheForTests();
    privateScoring.__resetPrivateRatingScoringForTests();
    counts.solver = 0;
    const course = { ...original, tiles: original.tiles.slice(), elevations: original.elevations.slice() };
    const setup = candidate(course);
    const estate = computeCourseRatingAndSlope(course);
    const operating = computeCourseRatingAndSlope({ ...course, holes: course.holes.slice(0, 1) });
    expect(setup).toEqual(oracleSetup);
    expect(estate).toEqual(oracleEstate);
    expect(operating).toEqual(oracleOperating);
    expect(holes.__getHoleScoreCacheStatsForTests().misses).toBe(2);
    expect(counts.solver).toBe(4);
    expect(privateScoring.__privateRatingScoringStateForTests()).toEqual({ owners: 1, entries: 1, active: false });
  });

  it("returns only current prefix holes and drops retired entries before expanding again", () => {
    const course = twoHoleEstate();
    const prefix = { ...course, holes: course.holes.slice(0, 1) };
    const full = candidate(course);
    const saved = structuredClone(full);
    const short = candidate(prefix);
    expect(short.holes).toHaveLength(1);
    expect(short.holes[0]).toBe(full.holes[0]);
    expect(privateScoring.__privateRatingScoringStateForTests().entries).toBe(1);
    expect(holes.__getHoleScoreCacheStatsForTests().misses).toBe(2);
    const expanded = candidate(course);
    expect(expanded).toEqual(saved);
    expect(expanded.holes[0]).toBe(full.holes[0]);
    expect(expanded.holes[1]).not.toBe(full.holes[1]);
    expect(holes.__getHoleScoreCacheStatsForTests().misses).toBe(3);
    expect(privateScoring.__privateRatingScoringStateForTests().entries).toBe(2);
    candidate(prefix);
    expect(privateScoring.__privateRatingScoringStateForTests().entries).toBe(1);
    expect(full).toEqual(saved);
  });

  it("does not score a retained inspector projection changed after its snapshot", () => {
    const course = twoHoleEstate();
    const view = fresh(course);
    const held = privateScoring.scorePrivateRatingSetup(view.effective, view.projected);
    const saved = structuredClone(held);
    view.projected.holes[0].parManual = 5;
    const restore = changeSearchPenalty();
    try {
      const result = candidate(course);
      expect(result).toEqual(baseline(course));
      expect(result.holes[0].par).toBe(4);
      expect(held).toEqual(saved);
    } finally {
      restore();
    }
  });

  for (const kind of ["nonleading", "reordered"] as const) it(`does not carry a ${kind} layout's entries`, () => {
    const course = twoHoleEstate();
    candidate(course);
    const changed = { ...course, holes: kind === "nonleading" ? course.holes.slice(1) : [...course.holes].reverse() };
    const before = holes.__getHoleScoreCacheStatsForTests().misses;
    const result = candidate(changed);
    expect(holes.__getHoleScoreCacheStatsForTests().misses - before).toBe(changed.holes.length);
    expect(result).toEqual(baseline(changed));
    expect(privateScoring.__privateRatingScoringStateForTests().entries).toBe(changed.holes.length);
  });

  for (const kind of ["terrain", "elevation", "point", "setup", "search configuration"] as const) it(`invalidates a leading view after ${kind} changes`, () => {
    const course = twoHoleEstate();
    course.holes[0].teeBoxes!.forward = { x: 3, y: 3 };
    candidate(course);
    const prefix = { ...course, holes: course.holes.slice(0, 1) };
    if (kind === "terrain") prefix.tiles = prefix.tiles.slice();
    if (kind === "elevation") prefix.elevations = prefix.elevations.slice();
    if (kind === "point") course.holes[0].tee!.x++;
    const restore = kind === "search configuration" ? changeSearchPenalty() : () => {};
    try {
      const before = holes.__getHoleScoreCacheStatsForTests().misses;
      const tee = kind === "setup" ? "forward" : "member";
      const result = candidate(prefix, tee);
      expect(holes.__getHoleScoreCacheStatsForTests().misses - before).toBe(1);
      expect(result).toEqual(baseline(prefix, tee));
      expect(privateScoring.__privateRatingScoringStateForTests().entries).toBe(1);
    } finally {
      restore();
    }
  });
});

describe("private rating scoring: fixed finite actual-scorer ledger", () => {
  it("reuses fallback A/B/C/A while preserving the full actual output and public fresh aliases", () => {
    // Observe the two actual dependency Maps allocated directly by scoreHole.
    // Native Map operations are inherited unchanged. Retain these only for this
    // finite test, then release them; serialized payload is not native heap size.
    const NativeMap = Map;
    const dependencies: Map<unknown, unknown>[] = [];
    class ObservedMap<K, V> extends NativeMap<K, V> {
      constructor(entries?: readonly (readonly [K, V])[] | null) {
        super(entries);
        const caller = new Error().stack?.split("\n")[2] ?? "";
        if (/scoreHole\s*\(.*[/\\]holes\.ts:/.test(caller)) dependencies.push(this);
      }
    }
    vi.stubGlobal("Map", ObservedMap);
    const course = fixture();
    const held = ["A", "B", "C", "A"].map((pin) => pair(course, "member", pin as PinRotation));
    held.forEach(({ result, saved }) => expect(result).toEqual(saved));
    const a = fresh(course).projected;
    const b = fresh(course).projected;
    expect(a).not.toBe(b);
    expect(a.holes).not.toBe(b.holes);
    expect(a.holes[0]).not.toBe(b.holes[0]);
    expect(a.holes[0].tee).toBe(course.holes[0].tee);
    expect(Reflect.ownKeys(a.holes[0])).toEqual(Reflect.ownKeys(b.holes[0]));
    expect(Object.getOwnPropertyDescriptors(a.holes[0])).toEqual(Object.getOwnPropertyDescriptors(b.holes[0]));
    checkCounts([4, 4, 5, 10]);
    expect(dependencies).toHaveLength(10);
    const sizes = dependencies.map((map) => map.size);
    const logicalBytes = new TextEncoder().encode(JSON.stringify(dependencies.map((map) => [...map]))).byteLength;
    console.info("PRIVATE_RATING_DEPENDENCY_PAYLOAD", JSON.stringify({ coldHoles: 5, maps: sizes.length,
      tileEntries: sizes.filter((_, i) => i % 2 === 0), elevationEntries: sizes.filter((_, i) => i % 2 === 1),
      serializedEntryBytes: logicalBytes, nativeHeapBytes: null }));
    dependencies.length = 0;
  });

  it("preserves scalar rating summaries and requested rotation keys against the actual fresh-scoring rating baseline", () => {
    const course = fixture();
    const originalAdapter = privateScoring.scorePrivateRatingSetup;
    const bypass = vi.spyOn(privateScoring, "scorePrivateRatingSetup").mockImplementation((_source, projected) => holes.scoreCourseHoles(projected));
    phase = "baseline";
    const oracle = ["A", "B", "C", "A"].map((pin) => computeRatingForSetup({ ...course, tiles: course.tiles.slice() }, "member", pin as PinRotation));
    bypass.mockImplementation(originalAdapter);
    phase = "candidate";
    const results = ["A", "B", "C", "A"].map((pin) => computeRatingForSetup(course, "member", pin as PinRotation));
    expect(results).toEqual(oracle);
    expect(results[0]).not.toBe(results[1]);
    expect(results[1].pinRotation).toBe("B");
    expect(results[2].pinRotation).toBe("C");
    expect(results[3]).toBe(results[0]);
    const saved = structuredClone(results);
    course.holes[0].tee!.x++;
    expect(results).toEqual(saved);
    checkCounts([4, 3, 5, 10]);
  });

  it("keeps configured distinct tees/pins separate with one latest projection rather than setup history", () => {
    const course = fixture();
    course.holes[0].teeBoxes = { member: course.holes[0].tee, forward: { x: 4, y: 4 } };
    course.holes[0].pinPositions = { A: course.holes[0].green, B: { x: 12, y: 5 } };
    pair(course);
    pair(course, "forward", "B");
    pair(course);
    expect(privateScoring.__privateRatingScoringStateForTests()).toEqual({ owners: 1, entries: 1, active: false });
    checkCounts([3, 3, 6, 12]);
  });

  it("preserves missing requested-forward null rather than borrowing the resolver's member tee", () => {
    const course = fixture();
    const first = pair(course, "forward", "B");
    pair(course, "forward", "B");
    expect(first.result.holes[0].isComplete).toBe(false);
    expect(fresh(course, "forward", "B").projected.holes[0].tee).toBeNull();
    checkCounts([2, 2, 3, 0]);
  });

  const shapes: { name: string; declines: boolean; edit: (course: Course, reads: string[]) => void }[] = [
    { name: "manual par", declines: false, edit: (c) => { c.holes[0].parManual = 5; } },
    { name: "AUTO own undefined", declines: false, edit: (c) => { c.holes[0].parMode = "AUTO"; c.holes[0].parManual = undefined; } },
    { name: "symbol undefined NaN and negative-zero metadata", declines: false, edit: (c) => {
      Object.assign(c.holes[0], { [Symbol("metadata")]: undefined, metadataNaN: NaN, metadataZero: -0 });
    } },
    { name: "nonenumerable metadata", declines: false, edit: (c) => { Object.defineProperty(c.holes[0], "hidden", { value: undefined }); } },
    { name: "custom prototype", declines: true, edit: (c) => { Object.setPrototypeOf(c.holes[0], { inherited: true }); } },
    { name: "source accessor", declines: true, edit: (c, reads) => {
      Object.defineProperty(c.holes[0], "name", { enumerable: true, configurable: true, get() { reads.push("name"); return "getter"; } });
    } },
    { name: "point accessor", declines: true, edit: (c, reads) => {
      Object.defineProperty(c.holes[0].tee!, "x", { enumerable: true, configurable: true, get() { reads.push("x"); return 2; } });
    } },
    { name: "terrain accessor", declines: true, edit: (c, reads) => {
      Object.defineProperty(c.tiles, "66", { enumerable: true, configurable: true, get() { reads.push(this === c.tiles ? "target" : "receiver"); return "fairway"; } });
    } },
  ];
  for (const shape of shapes) it(`preserves or declines ${shape.name}`, () => {
    const course = fixture();
    const reads: string[] = [];
    shape.edit(course, reads);
    const oracle = [baseline(course), baseline(course)];
    const expectedReads = reads.splice(0);
    const results = [candidate(course), candidate(course)];
    expect(results).toEqual(oracle);
    expect(reads).toEqual(expectedReads);
    checkCounts([2, 2, shape.declines ? 4 : 3, shape.declines ? 8 : 6]);
  });

  const edits: { name: string; hit?: boolean; setup?: (course: Course) => void; edit: (course: Course) => Course }[] = [
    { name: "in-place tee", edit: (c) => { c.holes[0].tee!.x++; return c; } },
    { name: "in-place pin", edit: (c) => { c.holes[0].green!.y++; return c; } },
    { name: "in-place par", edit: (c) => { c.holes[0].parManual = 5; return c; } },
    { name: "in-place metadata", edit: (c) => { c.holes[0].name = "edited"; return c; } },
    { name: "in-place obstacle", setup: (c) => { c.obstacles = [{ type: "tree", x: 0, y: 0 }]; }, edit: (c) => { c.obstacles[0].x++; return c; } },
    { name: "ordered obstacles", setup: (c) => { c.obstacles = [{ type: "tree", x: 0, y: 0 }, { type: "rock", x: 15, y: 8 }]; }, edit: (c) => { c.obstacles.reverse(); return c; } },
    { name: "immutable tee", edit: (c) => ({ ...c, holes: [{ ...c.holes[0], tee: { x: 3, y: 4 } }] }) },
    { name: "immutable metadata", edit: (c) => ({ ...c, holes: [{ ...c.holes[0], name: "immutable" }] }) },
    { name: "consumed terrain", edit: (c) => { c.tiles[66] = "sand"; return c; } },
    { name: "irrelevant terrain", hit: true, edit: (c) => { c.tiles[0] = "sand"; return c; } },
    { name: "consumed elevation", edit: (c) => { c.elevations[66] = 2; return c; } },
    { name: "irrelevant elevation", hit: true, edit: (c) => { c.elevations[0] = 2; return c; } },
    { name: "immutable tiles owner", edit: (c) => ({ ...c, tiles: c.tiles.slice() }) },
    { name: "immutable elevations owner", edit: (c) => ({ ...c, elevations: c.elevations.slice() }) },
    { name: "theme and deep rough", setup: (c) => { c.tiles[66] = "deep_rough"; }, edit: (c) => ({ ...c, theme: "desert" }) },
    { name: "dimensions", edit: (c) => ({ ...c, width: 17, tiles: new Array<Terrain>(153).fill("fairway"), elevations: new Array<number>(153).fill(0) }) },
    { name: "yards", edit: (c) => ({ ...c, yardsPerTile: 8 }) },
    { name: "subset hole index", setup: (c) => { c.holes.push({ ...c.holes[0], tee: { x: 3, y: 4 } }); }, edit: (c) => ({ ...c, holes: c.holes.slice(1) }) },
  ];
  for (const edit of edits) it(`invalidates exactly for ${edit.name}`, () => {
    const course = fixture();
    edit.setup?.(course);
    const held = pair(course);
    const edited = edit.edit(course);
    const result = pair(edited);
    // Compare retained outputs with the actual baseline's alias behavior, not
    // with two live aliases mistaken for a pre-edit snapshot.
    expect(held.result).toEqual(held.oracle);
    if (edited !== course) expect(held.result).toEqual(held.saved);
    if (edit.name === "subset hole index") expect(result.result.holes[0].holeIndex).toBe(0);
    const misses = edit.name === "subset hole index" ? 6 : edit.hit ? 3 : 4;
    checkCounts([2, 2, misses, misses * 2]);
  });

  it("uses actual nonempty surface care and drops its effective owner when care is removed", () => {
    const course = fixture();
    pair(course);
    const records = Object.fromEntries(surfaceCareTopology(course).zones.map((zone) => [zone.key,
      { mowingQuality: 0, turfHealth: 0, moisture: 0, wear: 1, missedMowingDays: 20, repairRequired: true }]));
    const surfaceCare = normalizeSurfaceCareState({ version: 1, cellSize: 8, records }, course)!;
    expect(Object.keys(surfaceCare.records).length).toBeGreaterThan(0);
    const cared = { ...course, surfaceCare };
    const effective = courseWithEffectiveSurfaces(cared);
    expect(effective.tiles).not.toBe(course.tiles);
    expect(effective.tiles.some((tile, index) => tile !== course.tiles[index])).toBe(true);
    pair(cared);
    pair({ ...cared, surfaceCare: undefined });
    checkCounts([3, 3, 6, 12]);
  });

  it("drops edit history on undo and preserves held scalar/full snapshots", () => {
    const course = fixture();
    const first = pair(course);
    pair({ ...course, holes: [{ ...course.holes[0], parManual: 5 }] });
    const undo = pair(course);
    expect(undo.result).toEqual(first.saved);
    expect(first.result).toEqual(first.saved);
    checkCounts([3, 3, 6, 12]);
  });

  it("bounds ownership to 36 entries and retains no retired layout history", () => {
    const base = fixture();
    const course = { ...base, holes: Array.from({ length: 36 }, (_, index) => ({ ...base.holes[0], id: String(index), tee: null, green: null })) };
    pair(course);
    pair(course, "member", "B");
    expect(privateScoring.__privateRatingScoringStateForTests().entries).toBe(36);
    pair({ ...course, holes: [...course.holes, { ...course.holes[0], id: "37" }] });
    expect(privateScoring.__privateRatingScoringStateForTests().owners).toBe(0);
    pair(course);
    expect(privateScoring.__privateRatingScoringStateForTests().entries).toBe(36);
    pair({ ...course, holes: course.holes.slice(1, 2) });
    expect(privateScoring.__privateRatingScoringStateForTests()).toEqual({ owners: 1, entries: 1, active: false });
    checkCounts([5, 5, 256, 0]);
  });

  it("preserves every falsy first cause and publishes no failed projection", () => {
    for (const cause of [undefined, null, false, 0, "", new Error("original")]) {
      privateScoring.__resetPrivateRatingScoringForTests();
      const course = fixture();
      const view = fresh(course);
      let failedHole: Hole | undefined;
      let caught = false;
      try {
        privateScoring.scorePrivateRatingSetup(view.effective, view.projected, (scoringCourse) => {
          failedHole = scoringCourse.holes[0];
          throw cause;
        });
      } catch (error) { caught = true; expect(error).toBe(cause); }
      expect(caught).toBe(true);
      expect(privateScoring.__privateRatingScoringStateForTests()).toEqual({ owners: 0, entries: 0, active: false });
      const oracle = baseline(course);
      phase = "candidate";
      const retry = fresh(course);
      const result = privateScoring.scorePrivateRatingSetup(retry.effective, retry.projected, (scoringCourse) => {
        expect(scoringCourse.holes[0]).not.toBe(failedHole);
        return holes.scoreCourseHoles(scoringCourse);
      });
      expect(result).toEqual(oracle);
      expect(candidate(course)).toEqual(oracle);
    }
    checkCounts([6, 12, 12, 24]);
  });

  it("uses a fresh nested scoring view and restores owner/activity after outer rejection", () => {
    const course = fixture();
    const outer = fresh(course);
    const nested = fresh(course);
    const cause = new Error("outer first cause");
    phase = "candidate";
    let retained: holes.CourseHoleSummary | undefined;
    expect(() => privateScoring.scorePrivateRatingSetup(outer.effective, outer.projected, () => {
      retained = privateScoring.scorePrivateRatingSetup(nested.effective, nested.projected, (scoringCourse) => {
        expect(scoringCourse).toBe(nested.projected);
        return holes.scoreCourseHoles(scoringCourse);
      });
      throw cause;
    })).toThrow(cause);
    expect(privateScoring.__privateRatingScoringStateForTests()).toEqual({ owners: 0, entries: 0, active: false });
    const oracle = baseline(course);
    expect(retained).toEqual(oracle);
    expect(candidate(course)).toEqual(oracle);
    expect(candidate(course)).toEqual(oracle);
    checkCounts([1, 3, 3, 6]);
  });
});
