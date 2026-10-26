import { describe, expect, it } from "vitest";
import type { PlayerShotTrace } from "../models/playerProTypes";
import { FIXED_GAME_STEP_MINUTES } from "./clock";
import {
  MAX_CONTROLLED_SHOT_STEPS, MAX_CONTROLLED_TIME_SHOTS,
  consumeControlledTimeStep, controlledGroupTime, controlledParticipantTime, controlledShotTimeSteps,
  observeControlledTime, restoreControlledTimeLedger,
  type ControlledTimeLedger, type ControlledTimeObservation,
} from "./controlledTime";

function shot(overrides: Partial<PlayerShotTrace> = {}): PlayerShotTrace {
  return {
    id: "shot-hole-1-1", holeId: "hole-1", shotNumber: 1, club: "Driver", technique: "normal", power: 1,
    from: { x: 0, y: 0 }, aim: { x: 20, y: 0 }, landing: { x: 20, y: 0 }, rest: { x: 20, y: 0 },
    carryYards: 200, rollYards: 0, lieBefore: "tee", lieAfter: "fairway", penaltyStrokes: 0,
    holed: false, seed: 5, evidence: [], ...overrides,
  };
}

function observation(shotCount = 0, totalSteps = 0, roundId = "round-1", scope = "player"): ControlledTimeObservation {
  return { scope, roundId, shotCount, totalSteps };
}

function baseline(): ControlledTimeLedger {
  return observeControlledTime(null, observation()).ledger!;
}

describe("committed controlled shot time", () => {
  it("uses existing pause, bounded flight, and geometric walk pacing in fixed quanta", () => {
    expect(controlledShotTimeSteps(shot(), 10)).toBe(88); // (.4 + 1 + 20*.15) / .05
    expect(controlledShotTimeSteps(shot({ carryYards: 0, rest: { x: 0, y: 0 } }), 10)).toBe(14);
    expect(controlledShotTimeSteps(shot({ carryYards: 100_000, rest: { x: 0, y: 0 } }), 10)).toBe(28);
    expect(controlledShotTimeSteps(shot({ carryYards: 0, rest: { x: .01, y: 0 } }), 10)).toBe(15);
    expect(controlledShotTimeSteps(shot({ club: "Putter" }), 10)).toBe(14);
    expect(controlledShotTimeSteps(shot(), 20)).toBe(78);
    expect(controlledShotTimeSteps(shot(), 10)! * FIXED_GAME_STEP_MINUTES).toBeCloseTo(4.4);
  });

  it("includes only actual retained automatic putts and leaves physics and score facts untouched", () => {
    const trace = shot({ greenPutting: { version: 1, seed: 9, putts: 2, leaveDistanceYards: 10, breakTiles: 0, pinDifficulty: 0, realizedSpeedFeet: 10, effectiveMoisture: .5, wear: 0, puttingSkill: 50, consistency: 50 } });
    const before = structuredClone(trace);
    expect(controlledShotTimeSteps(trace, 10)).toBe(116);
    expect(controlledShotTimeSteps({ ...trace, club: "Putter", greenPutting: undefined }, 10)).toBe(14);
    expect(controlledShotTimeSteps({ ...trace, club: "Putter" }, 10)).toBe(42);
    expect(trace).toEqual(before);
  });

  it("depends on committed traces rather than aim changes, playback, skips, or frame counts", () => {
    const traces = [shot(), shot({ id: "shot-hole-1-2", shotNumber: 2, club: "Putter" })];
    const expected = controlledParticipantTime(traces, 10);
    expect(expected).toEqual({ shotCount: 2, totalSteps: 102 });
    expect(controlledParticipantTime(traces.map((trace) => ({ ...trace, aim: { x: 999, y: 999 } })), 10)).toEqual(expected);
    for (let frame = 0; frame < 10; frame++) expect(controlledParticipantTime(traces, 10)).toEqual(expected);
    expect(controlledParticipantTime([], 10)).toEqual({ shotCount: 0, totalSteps: 0 });
  });

  it("uses the longest cumulative participant time for a parallel group", () => {
    const participant = { shots: [shot()], yardsPerTile: 10 };
    expect(controlledGroupTime(Array.from({ length: 4 }, () => participant))).toEqual({ shotCount: 4, totalSteps: 88 });
    expect(controlledGroupTime([participant, { shots: [shot(), shot({ club: "Putter" })], yardsPerTile: 10 }])).toEqual({ shotCount: 3, totalSteps: 102 });
    expect(controlledGroupTime([])).toEqual({ shotCount: 0, totalSteps: 0 });
    expect(controlledGroupTime(Array.from({ length: 5 }, () => participant))).toBeNull();
  });

  it("rejects invalid source facts, unbounded traces, and excessive shot time", () => {
    for (const yardsPerTile of [0, -1, NaN, Infinity]) expect(controlledShotTimeSteps(shot(), yardsPerTile)).toBeNull();
    expect(controlledShotTimeSteps(shot({ carryYards: NaN }), 10)).toBeNull();
    expect(controlledShotTimeSteps(shot({ from: { x: Infinity, y: 0 } }), 10)).toBeNull();
    expect(controlledShotTimeSteps(shot({ rest: { x: 100_000, y: 0 } }), 10)).toBeNull();
    expect(controlledShotTimeSteps(shot({ greenPutting: { version: 1, putts: 0 } as unknown as PlayerShotTrace["greenPutting"] }), 10)).toBeNull();
    expect(controlledParticipantTime(Array.from({ length: MAX_CONTROLLED_TIME_SHOTS + 1 }, () => shot()), 10)).toBeNull();
    expect(controlledParticipantTime([shot({ carryYards: -1 })], 10)).toBeNull();
  });
});

describe("retained controlled windows and inter-hole travel", () => {
  const holes = [
    { id: "hole-1", tee: { x: 0, y: 0 }, pin: { x: 40, y: 0 } },
    { id: "hole-2", tee: { x: 50, y: 0 }, pin: { x: 70, y: 0 } },
  ];
  const autoPutting = {
    version: 1 as const, seed: 9, putts: 2 as const, leaveDistanceYards: 10, breakTiles: 0,
    pinDifficulty: 0, realizedSpeedFeet: 10, effectiveMoisture: .5, wear: 0, puttingSkill: 50, consistency: 50,
  };
  const observeWindow = (count: number, costs: number[]): ControlledTimeObservation => ({
    ...observation(count, costs.reduce((sum, cost) => sum + cost, 0)), recentShotSteps: costs,
  });

  it("charges travel on the next committed shot, from the frozen pin after automatic putting", () => {
    const first = shot({ greenPutting: autoPutting });
    const second = shot({ id: "shot-hole-2-1", holeId: "hole-2", from: { x: 50, y: 0 }, rest: { x: 70, y: 0 } });
    expect(controlledParticipantTime([first, second], 10, { holes })).toEqual({ shotCount: 2, totalSteps: 234 });
    expect(controlledParticipantTime([first, second], 10)).toBeNull();
    expect(controlledParticipantTime([first, second], 10, { holes: [] })).toBeNull();
    expect(controlledGroupTime([{ shots: [first, second], yardsPerTile: 10, holes }, { shots: [first, second], yardsPerTile: 10, holes }])).toEqual({ shotCount: 4, totalSteps: 234 });
    // The first trace alone has no next-hole walk yet, regardless of aiming.
    expect(controlledParticipantTime([first], 10, { holes })?.totalSteps).toBe(116);
  });

  it("uses the prior physical rest without automatic putting and caps long inter-hole walks", () => {
    const second = shot({ holeId: "hole-2", from: { x: 30, y: 0 }, rest: { x: 50, y: 0 } });
    expect(controlledParticipantTime([shot(), second], 10)?.totalSteps).toBe(206);
    const far = shot({ holeId: "hole-2", from: { x: 200, y: 0 }, rest: { x: 220, y: 0 } });
    expect(controlledParticipantTime([shot(), far], 10)?.totalSteps).toBe(296); // 88+88+6/.05
    expect(controlledParticipantTime([far], 10, { completedShotCount: 241 })).toEqual({ shotCount: 241, totalSteps: 88, recentShotSteps: [88] });
  });

  it("keeps charging shots 241 and 242 after the retained array saturates, including save/reload", () => {
    const traces = Array.from({ length: 240 }, (_, index) => shot({ id: `shot-${index}` }));
    const total240 = controlledParticipantTime(traces, 10, { completedShotCount: 240 })!;
    const ledger240 = observeControlledTime(null, { scope: "player", roundId: "round-1", ...total240 }).ledger!;
    expect(ledger240.pendingSteps).toBe(0);
    traces.push(shot({ club: "Putter" }));
    const total241 = controlledParticipantTime(traces.slice(-240), 10, { completedShotCount: 241 })!;
    expect(total241.totalSteps).toBeLessThan(total240.totalSteps);
    const queued241 = observeControlledTime(ledger240, { scope: "player", roundId: "round-1", ...total241 }).ledger!;
    expect(queued241.pendingSteps).toBe(14);
    const restored = restoreControlledTimeLedger(JSON.parse(JSON.stringify(consumeControlledTimeStep(queued241))))!;
    expect(observeControlledTime(restored, { scope: "player", roundId: "round-1", ...total241 }).ledger?.pendingSteps).toBe(13);
    traces.push(shot());
    const total242 = controlledParticipantTime(traces.slice(-240), 10, { completedShotCount: 242 })!;
    const queued242 = observeControlledTime(restored, { scope: "player", roundId: "round-1", ...total242 }).ledger!;
    expect(queued242.pendingSteps).toBe(101);
    expect(queued242.observedShotCount).toBe(242);
    expect(queued242.observedTotalSteps).toBe(21_222);
  });

  it("deduplicates a 262-cost trusted batch followed by its cropped ordinary window", () => {
    const before = observeControlledTime(null, observeWindow(240, Array(240).fill(88))).ledger!;
    const batchCosts = [88, ...Array(261).fill(14)];
    const after = observeControlledTime(before, observeWindow(501, batchCosts));
    expect(after.status).toBe("queued");
    expect(after.ledger?.pendingSteps).toBe(261 * 14);
    expect(after.ledger?.observedTotalSteps).toBe(240 * 88 + 261 * 14);
    const rawWindow = observeWindow(501, Array(240).fill(14));
    expect(observeControlledTime(after.ledger, rawWindow)).toEqual({ status: "unchanged", ledger: after.ledger });
    const reloaded = restoreControlledTimeLedger(JSON.parse(JSON.stringify(after.ledger)))!;
    expect(observeControlledTime(reloaded, rawWindow).ledger?.pendingSteps).toBe(261 * 14);
    expect(observeControlledTime(reloaded, observeWindow(502, Array(240).fill(14))).ledger?.pendingSteps).toBe(262 * 14);
    expect(Object.keys(reloaded)).toHaveLength(7);
  });

  it("baselines legacy windows, converts an empty imperative baseline, and supports counts past 960", () => {
    const legacy = observeControlledTime(null, observeWindow(1_000, Array(240).fill(14)));
    expect(legacy.status).toBe("baseline");
    expect(legacy.ledger?.pendingSteps).toBe(0);
    expect(observeControlledTime(legacy.ledger, observeWindow(1_001, Array(240).fill(14))).ledger?.pendingSteps).toBe(14);
    expect(observeControlledTime(baseline(), observeWindow(1, [88])).ledger?.pendingSteps).toBe(88);
    const emptyWindow = observeControlledTime(baseline(), observeWindow(0, [])).ledger!;
    expect(emptyWindow.observedWindowSteps).toBe(0);
    expect(observeControlledTime(emptyWindow, observeWindow(1, [88])).ledger?.pendingSteps).toBe(88);
    const initialBatch = observeControlledTime(baseline(), observeWindow(261, Array(261).fill(14)));
    expect(initialBatch.ledger?.pendingSteps).toBe(261 * 14);
  });

  it("rejects incomplete gaps, malformed costs or counters, corrupt saves, and unsafe mode changes", () => {
    const previous = observeControlledTime(null, observeWindow(240, Array(240).fill(14))).ledger!;
    const invalid = [observeWindow(480, Array(240).fill(14)), observeWindow(501, Array(240).fill(14)),
      observeWindow(503, Array(263).fill(14)), observeWindow(241.5, [14]), observeWindow(1_000_001, [14]),
      observeWindow(241, [NaN]), observeWindow(241, [0]), { ...observeWindow(241, [14]), totalSteps: 15 }];
    for (const next of invalid) expect(observeControlledTime(previous, next)).toEqual({ status: "invalid", ledger: previous });
    expect(controlledParticipantTime(Array(241).fill(shot()), 10, { completedShotCount: 241 })).toBeNull();
    expect(controlledParticipantTime([shot()], 10, { completedShotCount: 0 })).toBeNull();
    expect(controlledParticipantTime([], 10, { completedShotCount: 1 })).toBeNull();
    expect(restoreControlledTimeLedger({ ...previous, observedWindowSteps: undefined })).toBeNull();
    expect(restoreControlledTimeLedger({ ...previous, observedWindowSteps: Infinity })).toBeNull();
    expect(restoreControlledTimeLedger({ ...previous, extra: true })).toBeNull();
    expect(observeControlledTime(previous, observation(241, 3_374)).status).toBe("invalid");
    const cumulative = observeControlledTime(baseline(), observation(1, 14)).ledger!;
    expect(observeControlledTime(cumulative, observeWindow(2, [14, 14])).status).toBe("invalid");
    expect(observeControlledTime(cumulative, observeWindow(1, [14])).ledger?.observedWindowSteps).toBe(14);
  });
});

describe("compact controlled time ledger", () => {
  it("baselines an existing legacy round without historical charges and charges a newly observed shot", () => {
    const legacy = observeControlledTime(null, observation(4, 300));
    expect(legacy.status).toBe("baseline");
    expect(legacy.ledger).toMatchObject({ observedShotCount: 4, observedTotalSteps: 300, pendingSteps: 0 });
    const committed = observeControlledTime(legacy.ledger, observation(5, 340));
    expect(committed.status).toBe("queued");
    expect(committed.ledger?.pendingSteps).toBe(40);
    expect(observeControlledTime(baseline(), observation(1, 88)).ledger?.pendingSteps).toBe(88);
  });

  it("deduplicates the same observation, skipping playback, and an older consistent observation", () => {
    const queued = observeControlledTime(baseline(), observation(2, 102)).ledger!;
    for (let frame = 0; frame < 10; frame++) {
      expect(observeControlledTime(queued, observation(2, 102))).toEqual({ status: "unchanged", ledger: queued });
    }
    expect(observeControlledTime(queued, observation(1, 88))).toEqual({ status: "unchanged", ledger: queued });
    expect(observeControlledTime(queued, observation(2, 103))).toEqual({ status: "invalid", ledger: queued });
    expect(observeControlledTime(queued, observation(1, 103))).toEqual({ status: "invalid", ledger: queued });
    expect(observeControlledTime(queued, observation(3, 101))).toEqual({ status: "invalid", ledger: queued });
  });

  it("reloads pending debt and consumes every executed quantum exactly once across boundaries", () => {
    const queued = observeControlledTime(baseline(), observation(1, 14)).ledger!;
    const partial = consumeControlledTimeStep(consumeControlledTimeStep(queued)!)!;
    expect(partial.pendingSteps).toBe(12);
    expect(queued.pendingSteps).toBe(14);
    let resumed = restoreControlledTimeLedger(JSON.parse(JSON.stringify(partial)))!;
    expect(observeControlledTime(resumed, observation(1, 14)).ledger?.pendingSteps).toBe(12);
    // No day/week fields exist: crossing a boundary pauses consumption, retains debt.
    for (let quantum = 0; quantum < 12; quantum++) resumed = consumeControlledTimeStep(resumed)!;
    expect(resumed.pendingSteps).toBe(0);
    expect(consumeControlledTimeStep(resumed)).toEqual(resumed);
    expect(observeControlledTime(resumed, observation(1, 14)).ledger?.pendingSteps).toBe(0);
    expect(observeControlledTime(resumed, observation(2, 28)).ledger?.pendingSteps).toBe(14);
    expect(Object.keys(resumed)).toHaveLength(6);
  });

  it("retains pending debt on scope changes and baselines the new scope only after draining", () => {
    const queued = observeControlledTime(baseline(), observation(1, 14)).ledger!;
    const changed = observation(3, 200, "round-2", "challenge");
    expect(observeControlledTime(queued, changed)).toEqual({ status: "pending-scope", ledger: queued });
    expect(observeControlledTime(queued, { ...changed, scope: "player" }).status).toBe("pending-scope");
    let drained = queued;
    while (drained.pendingSteps > 0) drained = consumeControlledTimeStep(drained)!;
    expect(observeControlledTime(drained, changed)).toEqual({ status: "baseline", ledger: { version: 1, scope: "challenge", roundId: "round-2", observedShotCount: 3, observedTotalSteps: 200, pendingSteps: 0 } });
  });

  it("queues only growth in the group maximum, including zero growth for a trailing participant", () => {
    const initial = observeControlledTime(null, observation(0, 0, "group-1", "group")).ledger!;
    const first = observeControlledTime(initial, observation(1, 88, "group-1", "group")).ledger!;
    const second = observeControlledTime(first, observation(2, 88, "group-1", "group"));
    expect(second.status).toBe("queued");
    expect(second.ledger?.pendingSteps).toBe(88);
    expect(observeControlledTime(second.ledger, observation(3, 102, "group-1", "group")).ledger?.pendingSteps).toBe(102);
  });

  it("strictly rejects corrupt or extended save fields and excessive integer totals", () => {
    const valid = observeControlledTime(baseline(), observation(1, 14)).ledger!;
    expect(restoreControlledTimeLedger(valid)).toEqual(valid);
    const missing = { ...valid } as Partial<ControlledTimeLedger>;
    delete missing.pendingSteps;
    for (const invalid of [null, [], {}, missing, { ...valid, extra: true }, { ...valid, version: 2 },
      { ...valid, scope: "" }, { ...valid, roundId: " round-1" }, { ...valid, observedShotCount: 961 },
      { ...valid, observedTotalSteps: Infinity }, { ...valid, pendingSteps: NaN }, { ...valid, pendingSteps: 15 },
      { ...valid, pendingSteps: .5 }, { ...valid, observedTotalSteps: MAX_CONTROLLED_SHOT_STEPS + 1 },
      { ...valid, observedTotalSteps: 0, pendingSteps: 0 }, { ...valid, roundId: "round\n1" },
      { ...valid, observedShotCount: 0, observedTotalSteps: 1, pendingSteps: 0 }]) {
      expect(restoreControlledTimeLedger(invalid)).toBeNull();
    }
    expect(consumeControlledTimeStep({ ...valid, pendingSteps: -1 })).toBeNull();
  });

  it("rejects malformed observations and retains the valid prior ledger", () => {
    const previous = baseline();
    const malformed = [observation(1.5, 14), observation(1, NaN), observation(1, 0), observation(1, 4001), observation(961, 100),
      { ...observation(), extra: "bad" }, { ...observation(), totalSteps: undefined }];
    for (const invalid of malformed) expect(observeControlledTime(previous, invalid as ControlledTimeObservation)).toEqual({ status: "invalid", ledger: previous });
    expect(observeControlledTime({ ...previous, pendingSteps: -1 }, observation())).toEqual({ status: "invalid", ledger: null });
  });
});
