import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Terrain } from "../models/types";
import { commitDay } from "./commitDay";
import { consumeControlledTimeStep, observeControlledTime, type ControlledTimeLedger } from "./controlledTime";
import { createDayAdvanceRequest, runDayAdvanceChunk } from "./dayAdvance";
import { createLiveState, roundReactions, stepLive } from "./simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "./persistence";

function fixture() {
  const width = 20; const height = 12;
  const course: Course = { name: "Boundary Links", width, height, tiles: new Array<Terrain>(width * height).fill("fairway"),
    elevations: new Array(width * height).fill(0), holes: [{ tee: { x: 2, y: 6 }, green: { x: 17, y: 6 }, parMode: "AUTO" }],
    obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 65, condition: .8 };
  const world = structuredClone(DEFAULT_WORLD);
  const live = createLiveState(course, world, 6);
  live.arrivals = []; live.golfers = []; live.dayMinute = 839.95;
  const baseline = observeControlledTime(null, { scope: "run1337", roundId: "round-1", shotCount: 0, totalSteps: 0 }).ledger;
  const ledger = observeControlledTime(baseline, { scope: "run1337", roundId: "round-1", shotCount: 1, totalSteps: 70 }).ledger!;
  return { course, world, live, ledger };
}

describe("optional pacing persistence and operating-day boundaries", () => {
  it("preserves finite pending controlled time and the fractional ordinary clock across Sunday settlement/save/resume", () => {
    const f = fixture();
    let ledger: ControlledTimeLedger = f.ledger;
    let callbacks = 0;
    const result = runDayAdvanceChunk({ request: createDayAdvanceRequest(f.live, "until"), live: f.live, canReceiveArrivals: true,
      step: (minutes) => {
        const events = stepLive(f.live, f.course, minutes, f.world);
        ledger = consumeControlledTimeStep(ledger)!;
        return events;
      }, onEvents: () => { callbacks++; }, isComplete: () => ledger.pendingSteps === 0, now: () => 0 });
    expect(result.status).toBe("day-over");
    expect(callbacks).toBe(result.steps);
    expect(ledger.pendingSteps).toBe(70 - result.steps);
    expect(ledger.pendingSteps).toBeGreaterThan(0);
    const committed = commitDay({ course: f.course, world: f.world, revenue: 0, greenFees: 0, concessionRevenue: 0,
      concessionByType: {}, transactions: [], reactions: roundReactions(f.live), dayIndex: 6 });
    const nextWorld = { ...committed.world, week: f.world.week + 1 };
    const nextDay = createLiveState(committed.course, nextWorld, 0);
    const saved = snapshotLiveSimulation({ state: nextDay, pendingCash: 0, speed: "paused", selectedGolferId: null,
      clockRemainderMinutes: .037, controlledTime: ledger, weekReportPending: { version: 1, week: f.world.week, resumeSpeed: "4x" } });
    const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(saved)))!;
    expect(restored.controlledTime).toEqual(ledger);
    expect(restored.clockRemainderMinutes).toBe(.037);
    expect(restored.weekReportPending).toEqual({ version: 1, week: f.world.week, resumeSpeed: "4x" });
    // A week report pause runs no authority chunks; the snapshot retains all debt.
    expect(restored.state.dayMinute).toBe(0);
    const remaining = restored.controlledTime!.pendingSteps;
    ledger = restored.controlledTime!;
    const request = createDayAdvanceRequest(restored.state, "until");
    let resumedCallbacks = 0;
    while (request.status === "running") runDayAdvanceChunk({ request, live: restored.state, canReceiveArrivals: true,
      step: (minutes) => {
        const events = stepLive(restored.state, committed.course, minutes, nextWorld);
        ledger = consumeControlledTimeStep(ledger)!;
        return events;
      }, onEvents: () => { resumedCallbacks++; }, isComplete: () => ledger.pendingSteps === 0, maxSteps: 17, now: () => 0 });
    expect(request.status).toBe("complete");
    expect(resumedCallbacks).toBe(remaining);
    expect(callbacks + resumedCallbacks).toBe(70);
    expect(ledger.pendingSteps).toBe(0);
    expect(restored.state.dayMinute).toBeCloseTo(remaining * .05);
    const sameObservation = observeControlledTime(ledger, { scope: "run1337", roundId: "round-1", shotCount: 1, totalSteps: 70 });
    expect(sameObservation.status).toBe("unchanged");
    expect(sameObservation.ledger!.pendingSteps).toBe(0);
  });

  it("drops invalid optional debt carriers without rejecting an existing live save", () => {
    const f = fixture();
    const saved = snapshotLiveSimulation({ state: f.live, pendingCash: 0, speed: "paused", selectedGolferId: null });
    for (const controlledTime of [null, [], { ...f.ledger, extra: true }, { ...f.ledger, pendingSteps: -1 },
      { ...f.ledger, pendingSteps: f.ledger.observedTotalSteps + 1 }, { ...f.ledger, observedTotalSteps: Infinity }]) {
      const restored = restoreLiveSimulation({ ...saved, controlledTime });
      expect(restored).not.toBeNull();
      expect(restored!.controlledTime).toBeUndefined();
    }
    expect(restoreLiveSimulation(saved)!.state.dayIndex).toBe(6);
  });

  it("rejects malformed acknowledgement barriers instead of resuming authority", () => {
    const f = fixture();
    const next = createLiveState(f.course, { ...f.world, week: f.world.week + 1 }, 0);
    const saved = snapshotLiveSimulation({ state: next, pendingCash: 0, speed: "paused", selectedGolferId: null });
    const marker = { version: 1, week: f.world.week, resumeSpeed: "4x" };
    for (const weekReportPending of [null, undefined, [], { ...marker, extra: true }, { ...marker, version: 2 },
      { ...marker, week: 0 }, { ...marker, week: Infinity }, { ...marker, resumeSpeed: "paused" }]) {
      expect(restoreLiveSimulation({ ...saved, weekReportPending })).toBeNull();
    }
    expect(restoreLiveSimulation({ ...saved, weekReportPending: marker })!.weekReportPending).toEqual(marker);
    expect(restoreLiveSimulation({ ...saved, state: { ...saved.state, dayIndex: 6 }, weekReportPending: marker })).toBeNull();
    expect(restoreLiveSimulation(saved)).not.toBeNull();
  });
});
