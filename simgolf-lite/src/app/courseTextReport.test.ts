import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { surfaceCareTopology } from "../game/conditions/surfaceCare";
import { createHealthyGreenLocalState } from "../game/greens/greenSurface";
import { GameSession } from "../game/session";
import type { PlatformServices } from "../platform/types";
import type { SavePayload } from "../utils/save";
import { DEFAULT_STATE } from "../game/gameState";
import type { GameState } from "../game/gameState";
import type { Course } from "../game/models/types";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../game/testing/referenceCourse";
import { computeCourseRatingAndSlope } from "../game/sim/courseRating";
import { CourseTextReportOwner, type CourseTextCaptureV1 } from "./courseTextReport";
class Store {
  revision = 0;
  state: GameState;
  constructor(state: GameState) { this.state = state; }
  getState = () => this.state;
  replace(state: GameState) { this.state = state; this.revision++; }
}
function capture(store: CourseTextCaptureV1["session"], extra: Partial<CourseTextCaptureV1> = {}): CourseTextCaptureV1 {
  const state = store.getState();
  return { session: store, capturedState: state, persistedCourse: state.course,
    capturedWorld: state.world, activeOperatingCourse: state.course,
    operatingLayoutId: "member", selectedTeeSet: "member", activePinRotation: "A",
    outputMode: "normal", quality: "high", presentationSeed: state.world.runSeed,
    presentationReducedMotion: false, ...extra };
}
function report(owner: CourseTextReportOwner, input: CourseTextCaptureV1) {
  return owner.prepareRatingPart(input).finishCarePart();
}
function setup(course: Course = DEFAULT_STATE.course) {
  const store = new Store({ ...DEFAULT_STATE, course });
  return { store, owner: new CourseTextReportOwner(store) };
}
function serialized(value: unknown) { return JSON.stringify(value); }
function careFixture() {
  const course = createParklandVisualReferenceCourse();
  return { ...course, surfaceCare: { version: 1 as const, cellSize: 8 as const, lastAdvancedAbsoluteDay: 2, records: Object.fromEntries(surfaceCareTopology(course).zones.map((zone, i) => [zone.key, { key: zone.key, surfaceId: zone.surfaceId, cellX: zone.cellX, cellY: zone.cellY, intendedTerrain: zone.intendedTerrain, area: zone.cells.length, mowingQuality: .4, moisture: .2, turfHealth: i % 2 ? .12 : .7, wear: .6, dormancy: 0, drainageStress: .1, failureDurationDays: 3, missedMowingDays: 2, insufficientWaterDays: 2, saturatedDays: 0, repairRequired: i % 2 === 1, repairProgress: 0, lastDemand: 2, lastAllocated: 1, lastTraffic: 3, lastIrrigationDemand: 2, lastIrrigationApplied: 1, lastElevatedWaterDemand: 0, lastElevatedWaterApplied: 0, lastObservedAbsoluteDay: 2 }])) } };
}
describe("session-owned CourseTextReportV1", () => {
  it("matches independently captured original whole ordered fragments", () => {
    const cases = [
      [DEFAULT_STATE.course, "f431b6c0f738d3ba00233c677438167a2d88791537c66f6a7578aca6e7358e2a"],
      [createParklandVisualReferenceCourse(), "d5790d10695f0aff854731755c7e9c9500fe7bd3b6387403df5efae48ff7606c"],
      [createM27ReleaseReferenceCourse(), "0214769557a89be5a1781aa0c2be4aa35b8a459cafd3433e7a393b313b216adf"],
    ] as const;
    for (const [course, hash] of cases) {
      const { store, owner } = setup(course);
      const value = report(owner, capture(store));
      expect(createHash("sha256").update(serialized(value)).digest("hex")).toBe(hash);
      expect(Object.keys(value.ratings.teeRatings)).toEqual(["forward", "member", "championship"]);
      expect(Object.keys(value.ratings.tournamentReadiness)).toEqual(["local", "regional", "championship"]);
      expect(Object.keys(value.care.greenKeeping.realized)).toEqual(["speedFeet", "firmness", "health", "moisture", "compaction", "wear"]);
    }
  });
  it("matches original observed-care, JSON edge and outside-layout setup fragments", () => {
    const operating = createParklandVisualReferenceCourse();
    const outside = { ...operating, holes: [...operating.holes, { ...operating.holes[0], id: "outside", teeBoxes: { forward: { x: 6, y: 17 } }, pinPositions: { B: { x: 38, y: 20 } } }] };
    const cases = [
      { course: careFixture(), world: DEFAULT_STATE.world, operating: undefined, hash: "4aaee4d138040b67a6f123f1479a51cc476ac1bcff32827db9f4b7ae147367be" },
      { course: { ...operating, condition: NaN }, world: { ...DEFAULT_STATE.world, maintenanceBudget: Infinity, staffRoster: undefined, staffLevel: NaN }, operating: undefined, hash: "1e5f1fbd8d4db73476a1ada3cd69afd025fa67cbb770cd3605651151d054ad46" },
      { course: outside, world: DEFAULT_STATE.world, operating, hash: "05f1f2ce771bf89845adef4667579cfcdb7e5f37b9b04595a12b624999b68b50" },
    ];
    for (const item of cases) {
      const { store, owner } = setup(item.course);
      store.replace({ ...store.state, world: item.world });
      const value = report(owner, capture(store, { activeOperatingCourse: item.operating ?? item.course }));
      expect(createHash("sha256").update(serialized(value)).digest("hex")).toBe(item.hash);
      if (item.course.surfaceCare) {
        expect(value.care.evidence.length).toBeGreaterThan(1);
        expect(value.care.presentation.commands).toBeGreaterThan(0);
        expect(Object.keys(value.care.evidence[0])).toEqual(["key", "surfaceId", "cell", "terrain", "tiles", "effectiveTerrain", "turfHealth", "mowingQuality", "moisture", "wear", "serviceRatio", "repairRequired", "action"]);
      }
    }
  });
  it("preserves original nonempty rotation deltas, negative zero and final JSON normalization", () => {
    const base = careFixture();
    const course = {...base, holes:base.holes.map(h => ({...h,
      teeBoxes:{forward:{x:12,y:18},member:h.tee,championship:{x:5,y:17}},
      pinPositions:{A:h.green,B:{x:39,y:20},C:{x:41,y:20}},
    }))};
    const {store,owner}=setup(course);
    store.replace({...store.state,world:{...store.state.world,staffRoster:undefined,staffLevel:4}});
    const value=report(owner,capture(store));
    expect(createHash("sha256").update(serialized(value)).digest("hex")).toBe("133bfec071b7052628511a23a2452c5ec9b96b2e63da53b7079aa192f0318859");
    expect(Object.keys(value.ratings.teeRatings.member.deltas)).toEqual(["A","B","C"]);
    expect(Object.is((value.ratings.teeRatings.member.deltas as Record<string,number>).A,-0)).toBe(true);
    expect(JSON.parse(serialized(value)).ratings.teeRatings.member.deltas.A).toBe(0);
    const nanInput=capture(store,{persistedCourse:{...course,condition:NaN,surfaceCare:undefined}});
    const nonfinite=report(owner,nanInput);
    expect(Number.isNaN(nonfinite.care.condition.overallCondition)).toBe(true);
    expect(JSON.parse(serialized(nonfinite)).care.condition.overallCondition).toBeNull();
    // Unchanged branches remain at the final stringify boundary: omitted object
    // undefined and sparse-array holes have their original JSON representations.
    const sparse = new Array(4); sparse[1]=undefined; sparse[2]=-0; sparse[3]=NaN;
    expect(serialized({before:sparse,omitted:undefined,report:value}))
      .toBe(serialized({before:[null,null,0,null],report:JSON.parse(serialized(value))}));
  });

  it("never tags stale render inputs with the current store revision", () => {
    const { store, owner } = setup();
    const old = capture(store);
    const previous = serialized(report(owner, old));
    store.replace({ ...store.state, world: { ...store.state.world, maintenanceBudget: 777, staffLevel: 8 } });
    const stale = report(owner, old);
    expect(serialized(stale)).toBe(previous);
    const current = report(owner, capture(store));
    expect(current).not.toBe(stale);
    expect(serialized(current)).not.toBe(previous);
    expect(serialized(current)).toBe(serialized(report(new CourseTextReportOwner(store), capture(store))));
    expect(report(owner, capture(store))).toBe(current);
  });
  it("does not publish when authority advances between ratings and care", () => {
    const { store, owner } = setup();
    const input = capture(store);
    const transaction = owner.prepareRatingPart(input);
    store.replace({ ...store.state, world: { ...store.state.world, maintenanceBudget: 555 } });
    const stale = transaction.finishCarePart();
    const current = report(owner, capture(store));
    expect(current).not.toBe(stale);
    expect(serialized(stale)).toBe(serialized(report(new CourseTextReportOwner(store), input)));
    expect(serialized(current)).toBe(serialized(report(new CourseTextReportOwner(store), capture(store))));
  });
  it("invalidates external dimensions and restores despite equal coarse counters", () => {
    const { store, owner } = setup(createParklandVisualReferenceCourse());
    let previous = report(owner, capture(store));
    for (const change of [{ quality: "low" as const }, { presentationSeed: 712 }, { presentationReducedMotion: true },
      { operatingLayoutId: "other" }, { selectedTeeSet: "forward" }, { activePinRotation: "B" }, { outputMode: "validate-hole" as const }]) {
      const input = capture(store, change);
      const next = report(owner, input);
      expect(next).not.toBe(previous);
      expect(serialized(next)).toBe(serialized(report(new CourseTextReportOwner(store), input)));
      expect(report(owner, input)).toBe(next);
      previous = next;
    }
    const old = store.state;
    store.replace({ ...old });
    expect(store.state.terrainVersion).toBe(old.terrainVersion);
    const restored = report(owner, capture(store));
    expect(restored).not.toBe(previous);
    expect(serialized(restored)).toBe(serialized(report(new CourseTextReportOwner(store), capture(store))));
  });
  it("invalidates through real session restore and idempotent StrictMode teardown replay", () => {
    const session=new GameSession({initialState:DEFAULT_STATE,platform:{} as PlatformServices});
    const owner=new CourseTextReportOwner(session);
    const initial=report(owner,capture(session));
    const pending=owner.prepareRatingPart(capture(session));
    let unregister=session.registerTeardown(owner.clear);
    // App cleanup clears its own owner and registration, never the store.
    unregister(); owner.clear(); owner.clear();
    const cancelled=pending.finishCarePart();
    const replay=report(owner,capture(session));
    expect(replay).not.toBe(cancelled); expect(replay).not.toBe(initial);
    unregister=session.registerTeardown(owner.clear);
    const state=session.getState();
    session.restore({course:state.course,world:{...state.world,maintenanceBudget:300}} as SavePayload);
    expect(session.getState().terrainVersion).toBeGreaterThan(state.terrainVersion);
    const restored=report(owner,capture(session));
    expect(restored).not.toBe(replay);
    expect(serialized(restored)).toBe(serialized(report(new CourseTextReportOwner(session),capture(session))));
    const teardownPending=owner.prepareRatingPart(capture(session));
    session.dispose();
    const old=teardownPending.finishCarePart();
    expect(report(owner,capture(session))).not.toBe(old);
    unregister();
  });

  it("matches fresh derivation after course/world domain edits", () => {
    const { store, owner } = setup(createParklandVisualReferenceCourse());
    const original = structuredClone(store.state);
    const edits: ((state: GameState) => GameState)[] = [
      s => ({ ...s, course: { ...s.course, tiles: s.course.tiles.map((t, i) => i === 0 ? "water" : t) } }),
      s => ({ ...s, course: { ...s.course, elevations: s.course.elevations.map((e, i) => i === 0 ? e + 1 : e) } }),
      s => ({ ...s, course: { ...s.course, obstacles: [...s.course.obstacles, { type: "tree", x: 1, y: 1 }] } }),
      s => ({ ...s, course: { ...s.course, holes: s.course.holes.map((h, i) => i ? h : { ...h, tee: { x: 6, y: 17 }, green: { x: 38, y: 20 }, parMode: "MANUAL" as const, parManual: 5 }) } }),
      s => ({ ...s, course: { ...s.course, holes: [...s.course.holes].reverse() } }),
      s => ({ ...s, course: { ...s.course, greenProgram: { ...s.course.greenProgram!, targetSpeedFeet: 12 } } }),
      s => ({...s,course:{...s.course,holes:s.course.holes.map(h=>({...h,pinPositions:{A:h.green,B:{x:39,y:20}},teeBoxes:{member:h.tee,forward:{x:10,y:17}},waypoints:[{x:25,y:18}]}))}}),
      s => ({...s,course:{...s.course,surfaceCare:careFixture().surfaceCare}}),
      s => ({...s,course:{...s.course,greenLocalState:{...createHealthyGreenLocalState(s.course),holes:createHealthyGreenLocalState(s.course).holes.map(h=>({...h,health:.3,moisture:.2}))}}}),
      s => ({ ...s, world: { ...s.world, week: s.world.week + 1, staffLevel: 5, maintenanceBudget: 900 } }),
    ];
    let previous = report(owner, capture(store));
    for (const edit of edits) {
      store.replace(edit(structuredClone(original)));
      const input = capture(store);
      const next = report(owner, input);
      expect(next).not.toBe(previous);
      expect(serialized(next)).toBe(serialized(report(new CourseTextReportOwner(store), input)));
      previous = next;
    }
  });
  it("uses full persisted setup detection and operating authority separately", () => {
    const operating = createParklandVisualReferenceCourse();
    const expanded = { ...operating, holes: [...operating.holes, { ...operating.holes[0], id: "outside", teeBoxes: { forward: { x: 6, y: 17 } }, pinPositions: { B: { x: 38, y: 20 } } }] };
    const { store, owner } = setup(expanded);
    const input = capture(store, { activeOperatingCourse: operating, selectedTeeSet: "championship", activePinRotation: "C", outputMode: "validate-hole" });
    const result = report(owner, input);
    expect(result.ratings.teeRatings.member.complete).toBe(false);
    expect(result.ratings.teeRatings.member.rating).toBe(computeCourseRatingAndSlope(operating).courseRating);
    expect(result.ratings.teeRatings.member.yardage).toBeGreaterThan(0);
  });
  it("owns only detached frozen thin values and clears safely on replay/teardown", () => {
    const { store, owner } = setup();
    const input = capture(store);
    const first = report(owner, input);
    expect(Object.isFrozen(first.care.presentation.cueCounts)).toBe(true);
    expect(() => { (first.care.presentation.holeCounts as Record<string, number>).fake = 1; }).toThrow();
    const serializedBefore = serialized(first);
    owner.clear();
    owner.clear();
    const second = report(owner, input);
    expect(second).not.toBe(first);
    expect(serialized(second)).toBe(serializedBefore);
    const pending = owner.prepareRatingPart(input);
    owner.clear();
    const cancelled = pending.finishCarePart();
    expect(report(owner, input)).not.toBe(cancelled);
    const other = new Store({ ...store.state });
    expect(report(owner, capture(other))).not.toBe(report(owner, capture(other)));
    // Completed ownership contains no authoritative roots, even after replacements.
    const seen = new Set<unknown>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object" || seen.has(value))
        return;
      expect(value).not.toBe(store.state);
      expect(value).not.toBe(store.state.course);
      expect(value).not.toBe(store.state.world);
      seen.add(value);
      for (const child of Object.values(value))
        visit(child);
    };
    // Session is the explicit lifetime owner; inspect only the completed entry.
    visit((owner as unknown as {
      latest: unknown;
    }).latest);
  });
  it("does not publish partial transactions or suppress derivation errors", () => {
    const { store, owner } = setup();
    const input = capture(store);
    const transaction = owner.prepareRatingPart(input);
    const badWorld = { ...input.capturedWorld, get maintenanceBudget(): number { throw new Error("care failure"); } };
    // Rating preparation does not evaluate care; care errors arise only
    // after the caller has crossed its fresh live capture boundary.
    const broken = owner.prepareRatingPart({ ...input, capturedWorld: badWorld });
    expect(() => broken.finishCarePart()).toThrow("care failure");
    const value = transaction.finishCarePart();
    expect(report(owner, input)).toBe(value);
    expect(() => owner.prepareRatingPart({ ...input, activeOperatingCourse: { ...input.activeOperatingCourse, get holes(): Course["holes"] { throw new Error("rating failure"); } }, quality: "low" })).toThrow("rating failure");
    expect(report(owner, input)).toBe(value);
  });
  it("reuses completed stages without owning caller live captures", () => {
    const { store, owner } = setup();
    let live = 0;
    const invoke = () => { const transaction = owner.prepareRatingPart(capture(store)); const snapshot = ++live; return { report: transaction.finishCarePart(), snapshot }; };
    const first = invoke();
    const second = invoke();
    expect(second.report).toBe(first.report);
    expect(second.snapshot).toBe(2);
  });
});
