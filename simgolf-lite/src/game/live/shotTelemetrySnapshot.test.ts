import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createM27ReleaseReferenceCourse } from "../testing/referenceCourse";
import { createM47CertificationCourse } from "../testing/m47Certification";
import { createGolferCapabilities } from "./capabilities";
import { currentShotEvidence, currentShotEvidenceText } from "./currentShotEvidence";
import { liveCourseSnapshot, resolveLiveShot } from "./livePhysics";
import type { HoleReaction, LiveShotOutcome } from "./m47Types";
import { snapshotLiveSimulation } from "./persistence";
import { captureShotTelemetrySnapshot } from "./shotTelemetrySnapshot";
import { createRenderPerfLiveState } from "./simulation";
import { generateStrategicHolePlan } from "./strategicOptions";
import type { Golfer } from "./types";

const state = createRenderPerfLiveState(createM27ReleaseReferenceCourse(), DEFAULT_WORLD);
const course = createM47CertificationCourse(9);
const physics = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
const personality = { skill: .6, consistency: .6, patience: .5, spendPropensity: .5, prefs: { difficulty: 0, scenery: 0, price: 0 } };
const capabilities = createGolferCapabilities({ personality, seed: 42 });
const plan = generateStrategicHolePlan({ course, hole: course.holes[0], par: 4, personality, capabilities, snapshot: physics });
const outcome = resolveLiveShot({ snapshot: physics, capabilities, holeId: physics.holes[0].id, shotNumber: 1, from: physics.holes[0].tee,
  lie: "tee", intent: { ...plan.chosen, technique: "normal", flightProfile: "standard" }, seed: 1108 });
function carrier(index = 0, id = 1): Golfer {
  const shot = JSON.parse(JSON.stringify(outcome)) as LiveShotOutcome;
  const base = { from: shot.from, to: shot.from, dur: 1, holeIndex: 0, holeId: shot.holeId };
  return { ...state.golfers[0], id, segments: [
    { ...base, kind: "pause" },
    { ...base, kind: "flight", to: shot.rest, landing: shot.greenRollout!.landing, rollPath: shot.greenRollout!.path, shot: "swing" },
    { ...base, kind: "walk", from: shot.rest, to: shot.rest },
  ], segIndex: index, segElapsed: 0, scoredHoles: 0, holeIds: [shot.holeId], shotOutcomes: [shot], holeReactions: [] };
}
function original(golfers: Golfer[]) {
  const snapshot = snapshotLiveSimulation({ state: { ...state, golfers }, pendingCash: 0, speed: "paused", selectedGolferId: null });
  return new Map(snapshot.state.golfers.map((golfer) => [golfer.id, golfer]));
}
function text(map: ReturnType<typeof captureShotTelemetrySnapshot>, ids: number[]) {
  return JSON.stringify(ids.map((id) => ({ id, evidence: currentShotEvidenceText(currentShotEvidence(map.get(id))) })));
}
function parity(golfers: Golfer[], ids = golfers.map((golfer) => golfer.id)) {
  const expected = original(golfers);
  const actual = captureShotTelemetrySnapshot(golfers);
  expect([...actual.keys()]).toEqual([...expected.keys()]);
  expect(text(actual, ids)).toBe(text(expected, ids));
  return actual;
}

describe("detached all-golfer shot telemetry at the existing effect boundary", () => {
  it("matches the original M27 whole-telemetry capture and preserves all 100 IDs", () => {
    const actual = parity(state.golfers);
    const serialized = text(actual, state.golfers.map((golfer) => golfer.id));
    // Captured from the unchanged full-state persistence snapshot before this patch.
    expect(createHash("sha256").update(serialized).digest("hex")).toBe("9feae26bc00e47dede88dd4edb248f5e058de9fcc787dffc495358f8e0a4da7c");
    expect(actual.size).toBe(100);
  });

  it("preserves intent, crossed result/truth and reaction selection", () => {
    for (const index of [0, 1, 2]) {
      const golfer = carrier(index);
      const actual = parity([golfer]);
      const evidence = currentShotEvidence(actual.get(golfer.id));
      expect(evidence.phase).toBe(index < 2 ? "intent" : "result");
      if (evidence.phase === "result") expect(evidence.truth.physicalRest).toEqual(golfer.shotOutcomes![0].sharedOutcome!.physicalRest);
    }
    const reactionGolfer = carrier(3);
    reactionGolfer.segments.push({ kind: "walk", from: outcome.rest, to: outcome.rest, dur: 1, holeIndex: 1, holeId: "next-hole" });
    reactionGolfer.scoredHoles = 1;
    reactionGolfer.holeReactions = [{ version: 1, holeId: outcome.holeId, expectedScore: 4, actualScore: 5, satisfaction: 60,
      outcome: "neutral", facts: [], thought: "The hole felt fair." } satisfies HoleReaction];
    expect(currentShotEvidence(parity([reactionGolfer]).get(1)).phase).toBe("reaction");
  });

  it("covers offscreen/selected IDs, late display changes, duplicates and missing IDs", () => {
    const golfers = [carrier(0, 1), carrier(1, 77), carrier(2, 1), carrier(2, 999)];
    const actual = parity(golfers, [999, 77, 1, -1]);
    expect(currentShotEvidence(actual.get(1)).phase).toBe("result"); // last duplicate wins
    expect(currentShotEvidence(actual.get(999)).phase).toBe("result"); // initially offscreen
    expect(currentShotEvidence(actual.get(-1))).toEqual({ phase: "unavailable", reason: "missing" });
    // A later displayed golfer still selects from the original boundary's complete map.
    expect(text(actual, [999, 1])).toBe(text(original(golfers), [999, 1]));
    const missing = carrier(); delete (missing as Partial<Golfer>).id;
    parity([missing], [undefined as unknown as number]);
  });

  it("retains JSON normalization and malformed cursor behavior", () => {
    const mutations: Array<(golfer: Golfer) => void> = [
      (g) => { g.segElapsed = NaN; }, (g) => { g.segIndex = Infinity; }, (g) => { g.scoredHoles = -Infinity; },
      (g) => { g.segElapsed = -0; }, (g) => { g.holeIds = undefined; },
      (g) => { g.shotOutcomes = undefined; }, (g) => { g.segments = null as unknown as Golfer["segments"]; },
      (g) => { g.shotOutcomes![0].aim.x = NaN; }, (g) => { g.shotOutcomes!.push(g.shotOutcomes![0]); },
      (g) => { g.id = NaN; }, (g) => { g.id = -0; },
    ];
    for (const mutate of mutations) { const g = carrier(2); mutate(g); parity([g]); }
    expect(captureShotTelemetrySnapshot([{ ...carrier(), segElapsed: -0 }]).get(1)?.segElapsed).toBe(0);
  });

  it("matches full-snapshot sparse-array holes normalized to null", () => {
    for (const field of ["segments", "holeIds", "shotOutcomes", "holeReactions"] as const) {
      const golfer = carrier(2);
      // Retain a valid value after an actual missing own array index.
      if (field === "holeReactions") {
        golfer.holeReactions = [{ version: 1, holeId: outcome.holeId, expectedScore: 4, actualScore: 5,
          satisfaction: 60, outcome: "neutral", facts: [], thought: "retained" }];
      }
      const values: unknown[] = golfer[field]!;
      values.length = 2;
      values[1] = values[0];
      delete values[0];
      expect(0 in values).toBe(false);
      const expected = original([golfer]);
      const actual = parity([golfer]);
      expect(actual.get(1)?.[field]?.[0]).toBeNull();
      expect(actual.get(1)?.[field]).toEqual(expected.get(1)?.[field]);
      expect(currentShotEvidence(actual.get(1))).toEqual(currentShotEvidence(expected.get(1)));
      if (field !== "holeReactions") {
        expect(currentShotEvidence(actual.get(1))).toEqual({ phase: "unavailable", reason: "malformed" });
      } else {
        const evidence = currentShotEvidence(actual.get(1));
        expect(evidence.phase).toBe("result");
        if (evidence.phase === "result") expect(evidence.truth.physicalRest).toEqual(outcome.sharedOutcome!.physicalRest);
      }
    }
  });

  it("detaches nested truth, cursor and reaction data from subsequent live mutation", () => {
    const g = carrier(2);
    const actual = captureShotTelemetrySnapshot([g]);
    const before = text(actual, [1]);
    g.segments[0].from.x += 20;
    g.shotOutcomes![0].sharedOutcome!.physicalRest.x += 10;
    g.shotOutcomes![0].facts.push({ code: "context", detail: "later mutation" });
    g.segIndex = 0;
    expect(text(actual, [1])).toBe(before);
    const reaction = { version: 1, holeId: outcome.holeId, expectedScore: 4, actualScore: 5, satisfaction: 60,
      outcome: "neutral", facts: [], thought: "before" } satisfies HoleReaction;
    const r = { ...carrier(2), holeReactions: [reaction] };
    const detached = captureShotTelemetrySnapshot([r]);
    reaction.thought = "after";
    expect(detached.get(1)?.holeReactions?.[0].thought).toBe("before");
  });

  it("does not capture unrelated planning data, and retains consumed-cycle errors", () => {
    const g = carrier(2);
    const before = text(captureShotTelemetrySnapshot([g]), [1]);
    g.name = "unrelated"; g.holePlans = new Array(100).fill(plan);
    expect(text(captureShotTelemetrySnapshot([g]), [1])).toBe(before);
    const detached = captureShotTelemetrySnapshot([g]).get(1)!;
    expect(detached).not.toHaveProperty("holePlans");
    expect(detached).not.toHaveProperty("personality");
    const cyclic = carrier();
    (cyclic.segments[0] as unknown as { self: unknown }).self = cyclic.segments;
    expect(() => original([cyclic])).toThrow(/circular/i);
    expect(() => captureShotTelemetrySnapshot([cyclic])).toThrow(/circular/i);
    expect(captureShotTelemetrySnapshot([]).size).toBe(0);
  });
});
