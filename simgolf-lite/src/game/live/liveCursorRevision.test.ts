import { createHash } from "node:crypto";
import { createM47CertificationCourse } from "../testing/m47Certification";
import { createGolferCapabilities } from "./capabilities";
import { currentShotEvidence, currentShotEvidenceText } from "./currentShotEvidence";
import { liveCourseSnapshot, resolveLiveShot } from "./livePhysics";
import { generateStrategicHolePlan } from "./strategicOptions";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { createRenderPerfLiveState, stepLive, reconcileGolfers } from "./simulation";
import { captureShotTelemetrySnapshot } from "./shotTelemetrySnapshot";
import { snapshotLiveSimulation, restoreLiveSimulation } from "./persistence";
import { LiveCursorRevisionOwner, type ShotTelemetryLookupV1 } from "./liveCursorRevision";
import type { Golfer } from "./types";
function compact() { const state = createRenderPerfLiveState(createParklandVisualReferenceCourse(), DEFAULT_WORLD); state.golfers = state.golfers.slice(0, 1); return state; }
function parity(owner: LiveCursorRevisionOwner, golfers: Golfer[]) {
  const expected = captureShotTelemetrySnapshot(golfers);
  const lookup = owner.capture(golfers);
  expect(JSON.stringify([...expected].map(([id]) => [id, lookup.get(id)]))).toBe(JSON.stringify([...expected]));
  return lookup;
}
describe("hook-owned live cursor revision lookup", () => {
  it("matches independent original M27 ordered cursor capture and full save projection", () => {
    const state = createRenderPerfLiveState(createM27ReleaseReferenceCourse(), DEFAULT_WORLD);
    const owner = new LiveCursorRevisionOwner();
    const lookup = parity(owner, state.golfers);
    const serialized = JSON.stringify(state.golfers.map(g => [g.id, lookup.get(g.id)]));
    expect(createHash("sha256").update(serialized).digest("hex")).toBe("3d184caa765eb601641facfa72278f2a99d9165496b0595df686643f7e3dd49f");
    const full = snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null });
    expect(JSON.stringify([...captureShotTelemetrySnapshot(full.state.golfers)])).toBe(serialized);
    expect(owner.capture(state.golfers)).toBe(lookup);
  });
  it("preserves original partial-step/nested-write/restored ordered goldens", () => {
    const course = createM27ReleaseReferenceCourse();
    const state = createRenderPerfLiveState(course, DEFAULT_WORLD);
    state.golfers = state.golfers.slice(0, 1);
    const owner = new LiveCursorRevisionOwner();
    owner.invalidate();
    stepLive(state, course, .5, DEFAULT_WORLD);
    const hash = (lookup: ShotTelemetryLookupV1) => createHash("sha256").update(JSON.stringify(state.golfers.map(g => [g.id, lookup.get(g.id)]))).digest("hex");
    expect(hash(parity(owner, state.golfers))).toBe("1075ba866062263203e256d5e5ea1e28ccf913d9057d3810ffeee652412702ea");
    owner.invalidate();
    state.golfers[0].segments[0].dur += 1;
    expect(hash(parity(owner, state.golfers))).toBe("25f53fd14d073e09d783bba1603253aefce0aae4849abd2a1ad569ce3abec95e");
    owner.invalidate();
    const restored = restoreLiveSimulation(snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null }))!;
    state.golfers = restored.state.golfers;
    expect(hash(parity(owner, state.golfers))).toBe("25f53fd14d073e09d783bba1603253aefce0aae4849abd2a1ad569ce3abec95e");
  });
  it("invalidates every cursor field, nested geometry and golfer identity before reuse", () => {
    const state = compact();
    const owner = new LiveCursorRevisionOwner();
    const mutations: ((g: Golfer) => void)[] = [g => { g.segIndex = 1; }, g => { g.segElapsed += .4; }, g => { g.scoredHoles++; }, g => { g.segments[0].dur += 2; }, g => { g.segments[0].from.x += 1; }, g => { g.holeIds = ["changed"]; }, g => { g.shotOutcomes = []; }, g => { g.holeReactions = []; }, g => { g.id = 777; }];
    let lookup = parity(owner, state.golfers);
    for (const mutate of mutations) {
      const old = lookup;
      const serialized = JSON.stringify(old.get(state.golfers[0].id));
      owner.invalidate();
      mutate(state.golfers[0]);
      lookup = parity(owner, state.golfers);
      expect(lookup).not.toBe(old);
      if (state.golfers[0].id !== 777)
        expect(JSON.stringify(old.get(state.golfers[0].id))).toBe(serialized);
    }
    expect(lookup.get(1)).toBeUndefined();
    expect(lookup.get(777)).toBeDefined();
    owner.invalidate();
    state.golfers = [];
    expect(owner.capture(state.golfers).get(777)).toBeUndefined();
  });
  it("preserves populated committed truth, nested rollout/outcome/reaction edits and old capture isolation", () => {
    const course = createM47CertificationCourse(9);
    const physics = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
    const personality = { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
    const capabilities = createGolferCapabilities({ personality, seed: 42 });
    const plan = generateStrategicHolePlan({ course, hole: course.holes[0], par: 4, personality, capabilities, snapshot: physics });
    const outcome = resolveLiveShot({ snapshot: physics, capabilities, holeId: physics.holes[0].id, shotNumber: 1, from: physics.holes[0].tee, lie: "tee", intent: { ...plan.chosen, technique: "normal", flightProfile: "standard" }, seed: 1108 });
    const g = { ...compact().golfers[0], segIndex: 2, segments: [
        { kind: "pause" as const, from: outcome.from, to: outcome.from, dur: 1, holeIndex: 0, holeId: outcome.holeId },
        { kind: "flight" as const, from: outcome.from, to: outcome.rest, dur: 1, holeIndex: 0, holeId: outcome.holeId, landing: outcome.greenRollout!.landing, rollPath: outcome.greenRollout!.path, shot: "swing" as const },
        { kind: "walk" as const, from: outcome.rest, to: outcome.rest, dur: 1, holeIndex: 0, holeId: outcome.holeId },
      ], holeIds: [outcome.holeId], shotOutcomes: [outcome], holeReactions: [{ version: 1 as const, holeId: outcome.holeId, expectedScore: 4, actualScore: 5, satisfaction: 60, outcome: "neutral" as const, facts: [], thought: "Original reaction" }] };
    const owner = new LiveCursorRevisionOwner();
    let lookup = parity(owner, [g]);
    const compareTruth = () => {
      const original = snapshotLiveSimulation({ state: { ...compact(), golfers: [g] }, pendingCash: 0, speed: "paused", selectedGolferId: null });
      const expected = currentShotEvidenceText(currentShotEvidence(original.state.golfers[0]));
      expect(JSON.stringify(currentShotEvidenceText(currentShotEvidence(lookup.get(g.id))))).toBe(JSON.stringify(expected));
    };
    expect(currentShotEvidence(lookup.get(g.id)).phase).toBe("result");
    compareTruth();
    const edits = [() => { g.segments[1].rollPath![0].x += .25; }, () => { g.shotOutcomes[0].sharedOutcome!.physicalRest.x += .5; }, () => { g.holeReactions[0].thought = "Changed reaction"; }];
    for (const edit of edits) {
      const before = lookup;
      const old = JSON.stringify(before.get(g.id));
      owner.invalidate();
      edit();
      lookup = parity(owner, [g]);
      expect(JSON.stringify(before.get(g.id))).toBe(old);
      expect(JSON.stringify(lookup.get(g.id))).not.toBe(old);
      compareTruth();
    }
  });
  it("has no mutable Map escape and preserves the old fresh mutable getter", () => {
    const state = compact();
    const owner = new LiveCursorRevisionOwner();
    const lookup = parity(owner, state.golfers);
    const value = lookup.get(1)!;
    expect(Object.keys(lookup)).toEqual(["get"]);
    expect(lookup).not.toBeInstanceOf(Map);
    expect(() => { value.segments[0].from.x = 999; }).toThrow();
    expect(() => { value.shotOutcomes?.push(undefined!); }).toThrow();
    const mutable = captureShotTelemetrySnapshot(state.golfers) as Map<number, Golfer>;
    mutable.get(1)!.segments[0].from.x = 123;
    mutable.set(999, mutable.get(1)!);
    mutable.delete(1);
    expect(owner.capture(state.golfers)).toBe(lookup);
    expect(lookup.get(1)!.segments[0].from.x).not.toBe(123);
    expect(lookup.get(999)).toBeUndefined();
    expect(captureShotTelemetrySnapshot(state.golfers).get(1)).toBeDefined();
    const save = snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null });
    save.state.golfers[0].segments[0].from.x = 555;
    expect(snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null }).state.golfers[0].segments[0].from.x).not.toBe(555);
  });
  it("preserves duplicate IDs, late IDs, sparse/null and number JSON normalization", () => {
    const state = compact();
    const first = state.golfers[0];
    const duplicate = { ...first, segElapsed: .7 };
    const late = { ...first, id: 999 };
    const sparse = new Array(2);
    sparse[1] = first.segments[0];
    const golfers = [{ ...first, segments: sparse, segElapsed: NaN, shotOutcomes: undefined, holeIds: new Array(2), holeReactions: new Array(1) }, duplicate, late];
    const owner = new LiveCursorRevisionOwner();
    const lookup = parity(owner, golfers);
    expect(lookup.get(1)!.segElapsed).toBe(.7);
    expect(lookup.get(999)).toBeDefined();
    expect(lookup.get(-1)).toBeUndefined();
    owner.invalidate();
    const normalized = parity(owner, [{ ...first, id: -0, segElapsed: Infinity, segments: sparse, holeIds: new Array(2), holeReactions: new Array(1) }]);
    expect(normalized.get(0)!.id).toBe(0);
    expect(normalized.get(0)!.segElapsed).toBeNull();
    expect(normalized.get(0)!.segments[0]).toBeNull();
    expect(normalized.get(0)!.holeIds![0]).toBeNull();
  });
  it("does not publish on synchronous clear or serialization failure and bounds latest ownership", () => {
    const state = compact();
    const owner = new LiveCursorRevisionOwner();
    const g = state.golfers[0];
    let once = true;
    const during = { ...g, get segments() {
        if (once) {
          once = false;
          owner.invalidate();
        }
        return g.segments;
      } };
    const cancelled = owner.capture([during]);
    expect(owner.capture([g])).not.toBe(cancelled);
    owner.invalidate();
    const cyclic = { ...g, segments: [{ ...g.segments[0] }] };
    (cyclic.segments[0] as unknown as {
      cycle: unknown;
    }).cycle = cyclic.segments;
    expect(() => owner.capture([cyclic])).toThrow();
    const valid = parity(owner, [g]);
    for (let id = 2; id < 20; id++) {
      owner.invalidate();
      const input = { ...g, id };
      const latest = parity(owner, [input]);
      expect(latest.get(id - 1)).toBeUndefined();
      expect(latest.get(id)).not.toBe(input);
      expect(latest.get(id)!.segments).not.toBe(input.segments);
    }
    owner.invalidate();
    expect(parity(owner, [g])).not.toBe(valid);
    const other = new LiveCursorRevisionOwner();
    expect(other.capture([g])).not.toBe(owner.capture([g]));
  });
  it("cannot borrow a pre-wrap generation after counter reset", () => {
    const state = compact();
    const owner = new LiveCursorRevisionOwner();
    const old = parity(owner, state.golfers);
    // Arrange the otherwise impractically distant safe-integer boundary without
    // a production seam. A wrapped counter must discard its original entry.
    (owner as unknown as {
      generation: number;
    }).generation = Number.MAX_SAFE_INTEGER;
    owner.invalidate();
    state.golfers[0].id = 777;
    const next = parity(owner, state.golfers);
    expect(next).not.toBe(old);
    expect(next.get(1)).toBeUndefined();
    expect(next.get(777)).toBeDefined();
  });
  it("matches fresh original projection after actual reconciliation", () => {
    const course = createParklandVisualReferenceCourse();
    const state = compact();
    const owner = new LiveCursorRevisionOwner();
    const old = parity(owner, state.golfers);
    owner.invalidate();
    reconcileGolfers(state, { ...course, obstacles: [...course.obstacles, { type: "tree", x: 12, y: 18 }] });
    const next = parity(owner, state.golfers);
    expect(next).not.toBe(old);
    expect(JSON.stringify(next.get(1))).not.toBe(JSON.stringify(old.get(1)));
  });
});
