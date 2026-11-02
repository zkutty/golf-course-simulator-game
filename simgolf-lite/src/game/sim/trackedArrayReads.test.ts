import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course, Terrain } from "../models/types";
import { createReferenceCourse } from "../testing/referenceCourse";
import { prepareShotSearchDomain, type ShotSearchDomain } from "./shots/shotSearchDomain";
import * as solver from "./shots/solveShotsToGreen";
import * as surfaceCare from "../conditions/surfaceCare";
import { __getHoleScoreDependenciesForTests, __resetHoleScoreCacheForTests, scoreCourseHoles, scoreHole, scoreSelectedCourseHole } from "./holes";

function fixture(): Course {
  const base = createReferenceCourse();
  return { ...base, width: 16, height: 9, yardsPerTile: 10, buildings: [], obstacles: [], surfaceCare: undefined,
    tiles: Array<Terrain>(144).fill("fairway"), elevations: Array<number>(144).fill(0),
    holes: [{ tee: { x: 2, y: 4 }, green: { x: 13, y: 4 }, parMode: "MANUAL", parManual: 4 }] };
}
afterEach(() => { vi.restoreAllMocks(); __resetHoleScoreCacheForTests(); });

describe("tracked own array reads", () => {
  it("reuses validated canonical reads on each internal entry path and retains exact public fallback output", () => {
    const course = fixture();
    const hole = course.holes[0];
    const domain = prepareShotSearchDomain(course, hole);
    expect(domain.eligible).toBe(true);
    const originalGet = Reflect.get;
    let canonicalReflectReads = 0;
    vi.spyOn(Reflect, "get").mockImplementation((...args) => {
      const [target, property] = args;
      if ((target === course.tiles || target === course.elevations) && typeof property === "string"
        && /^(?:0|[1-9]\d*)$/.test(property) && Number(property) < 144) canonicalReflectReads++;
      return Reflect.apply(originalGet, Reflect, args);
    });
    // An externally supplied domain takes the original Reflect.get path.
    const fallback = scoreHole(course, hole, 0, domain);
    expect(canonicalReflectReads).toBeGreaterThan(0);
    const paths = [() => scoreHole(course, hole, 0), () => scoreSelectedCourseHole(course, 0), () => scoreCourseHoles(course).holes[0]];
    for (const read of paths) {
      __resetHoleScoreCacheForTests();
      canonicalReflectReads = 0;
      expect(read()).toEqual(fallback);
      expect(canonicalReflectReads).toBe(0);
    }
  });

  for (const supplied of ["stale inspected", "arbitrary eligible"] as const) {
    it(`retains target/receiver accessor reads for a ${supplied} external domain`, () => {
      const course = fixture();
      const inspected = prepareShotSearchDomain(course, course.holes[0]);
      expect(inspected.eligible).toBe(true);
      const domain: ShotSearchDomain = supplied === "stale inspected" ? inspected : { eligible: true, config: null };
      const reads: string[] = [];
      Object.defineProperty(course.tiles, "66", { configurable: true, enumerable: true,
        get() { reads.push(this === course.tiles ? "target" : "receiver"); return "fairway"; } });
      const result = scoreHole(course, course.holes[0], 0, domain);
      expect(result).toMatchObject({ isComplete: true, isValid: true, par: 4 });
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.length % 2).toBe(0);
      for (let i = 0; i < reads.length; i += 2) expect(reads.slice(i, i + 2)).toEqual(["target", "receiver"]);
    });
  }

  it("preserves repeated effective conversion and its first cause on declined entry paths", () => {
    const actualEffective = surfaceCare.courseWithEffectiveSurfaces;
    for (const read of [scoreCourseHoles, (course: Course) => scoreSelectedCourseHole(course, 0)]) {
      const course = fixture();
      const events: string[] = [];
      let careReads = 0;
      Object.defineProperty(course, "surfaceCare", { configurable: true, enumerable: true,
        get() { events.push("care"); if (++careReads === 2) throw false; return undefined; } });
      expect(prepareShotSearchDomain(course).eligible).toBe(false);
      const conversion = vi.spyOn(surfaceCare, "courseWithEffectiveSurfaces").mockImplementation((source) => {
        if (source === course) events.push("conversion");
        return actualEffective(source);
      });
      let threw = false;
      let cause: unknown;
      try { read(course); } catch (error) { threw = true; cause = error; }
      finally { conversion.mockRestore(); }
      expect(threw).toBe(true);
      expect(cause).toBe(false);
      expect(events).toEqual(["conversion", "care", "conversion", "care"]);
    }
  });

  it("preserves leading-zero, nonnumeric, symbol and out-of-bounds fallback reads", () => {
    const course = fixture();
    const actualSolve = solver.solveShotsToGreen;
    const observed: unknown[][] = [];
    vi.spyOn(solver, "solveShotsToGreen").mockImplementation((args) => {
      const tiles = args.course.tiles as unknown as Record<string | symbol, unknown>;
      observed.push([tiles["01"], tiles["1.0"], tiles["-0"], tiles["1e2"], tiles["1000000"], tiles[Symbol.iterator]]);
      return actualSolve(args);
    });
    scoreHole(course, course.holes[0], 0);
    expect(observed).toHaveLength(2);
    for (const row of observed) expect(row).toEqual([undefined, undefined, undefined, undefined, undefined, Array.prototype[Symbol.iterator]]);
    const dependencies = __getHoleScoreDependenciesForTests(course.holes[0]);
    expect(dependencies).toContain(1); // Original tracking normalizes leading zero for dependencies only.
    expect(dependencies).toContain(1000000); // Out-of-bounds reads still participate in tracking.
  });
});
