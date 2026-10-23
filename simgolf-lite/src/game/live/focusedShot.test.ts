import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Terrain } from "../models/types";
import { acquireFocusedShot, focusedShotAudioEvents, focusedShotMatches, projectFocusedShot, restoreFocusedShot, snapshotFocusedShot } from "./focusedShot";
import { advanceShotPacingCursor, shotPacingFrame } from "./shotPacing";
import { createLiveState, liveRenderData, stepLive } from "./simulation";
import { createDayAdvanceRequest, runDayAdvanceChunk } from "./dayAdvance";
import { FIXED_GAME_STEP_MINUTES } from "./clock";
import { restoreLiveSimulation, snapshotLiveSimulation } from "./persistence";

function fixture() {
  const width = 60; const height = 24;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  const tee = { x: 4, y: 12 }; const green = { x: 50, y: 12 };
  tiles[tee.y * width + tee.x] = "tee";
  for (let y = 11; y <= 13; y++) for (let x = 49; x <= 51; x++) tiles[y * width + x] = "green";
  const course: Course = { name: "Focus Links", width, height, tiles, elevations: new Array(width * height).fill(0),
    holes: [{ tee, green, parMode: "AUTO" }], obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 65, condition: .8 };
  const world = structuredClone(DEFAULT_WORLD);
  const live = createLiveState(course, world, 0);
  live.arrivals = live.arrivals.slice(0, 1);
  let steps = 0;
  while (!live.golfers.some((golfer) => golfer.segments[golfer.segIndex]?.motion) && steps++ < 5000) stepLive(live, course, FIXED_GAME_STEP_MINUTES, world);
  expect(steps).toBeLessThan(5000);
  const golfer = live.golfers.find((item) => item.segments[item.segIndex]?.motion)!;
  const owner = acquireFocusedShot(live, world, golfer.id)!;
  expect(owner).not.toBeNull();
  return { course, world, live, golfer, owner };
}

describe("focused ordinary golfer ownership", () => {
  it("acquires every ordinary actor by its explicit id, and never guesses an owner", () => {
    const f = fixture();
    f.live.golfers = [7, 23, 91].map((id) => ({ ...f.golfer, id }));
    const keys = new Set<string>();
    for (const id of [7, 23, 91]) {
      const owner = acquireFocusedShot(f.live, f.world, id)!;
      expect(owner.golferId).toBe(id);
      keys.add(owner.plan.key);
    }
    expect(keys.size).toBe(3);
    for (const id of [undefined, null, -1, 1000, NaN]) expect(acquireFocusedShot(f.live, f.world, id)).toBeNull();
  });

  it("cancels on unfollow, changed actor, reconciliation, day/run/week replacement or a changed retained identity", () => {
    const f = fixture();
    expect(focusedShotMatches(f.owner, f.live, f.world, f.golfer.id)).toBe(true);
    expect(focusedShotMatches(f.owner, f.live, f.world, null)).toBe(false);
    expect(focusedShotMatches(f.owner, f.live, f.world, f.golfer.id + 1)).toBe(false);
    expect(focusedShotMatches(f.owner, { ...f.live }, f.world, f.golfer.id)).toBe(false);
    expect(focusedShotMatches(f.owner, f.live, { ...f.world, week: f.world.week + 1 }, f.golfer.id)).toBe(false);
    expect(focusedShotMatches(f.owner, f.live, { ...f.world, runSeed: f.world.runSeed! + 1 }, f.golfer.id)).toBe(false);
    f.live.reconcileEpoch++;
    expect(focusedShotMatches(f.owner, f.live, f.world, f.golfer.id)).toBe(false);
    f.live.reconcileEpoch--;
    f.owner.motion.identity.seed++;
    expect(focusedShotMatches(f.owner, f.live, f.world, f.golfer.id)).toBe(false);
  });

  it("projects the retained endpoint and animation facts without changing authority or exposing a future result", () => {
    const f = fixture();
    const before = snapshotLiveSimulation({ state: f.live, pendingCash: 0, speed: "4x", selectedGolferId: f.golfer.id });
    const initial = liveRenderData(f.live);
    projectFocusedShot(f.owner, initial);
    expect(initial.find((item) => item.id === f.golfer.id)).toMatchObject({ segKind: "pause", segT: 0, ballX: f.owner.motion.from.point.x });
    const addressEnd = { ...f.owner.cursor, elapsedMs: f.owner.plan.addressMs };
    f.owner.cursor = addressEnd;
    projectFocusedShot(f.owner, initial);
    expect(initial.find((item) => item.id === f.golfer.id)).toMatchObject({ segKind: "pause", segT: 1 });
    f.owner.cursor = advanceShotPacingCursor(f.owner.plan, f.owner.cursor, 0, { skip: true })!;
    projectFocusedShot(f.owner, initial);
    const rendered = initial.find((item) => item.id === f.golfer.id)!;
    expect(rendered).toMatchObject({ segKind: "flight", ballX: f.owner.motion.physicalRest.point.x, ballY: f.owner.motion.physicalRest.point.y });
    expect(rendered.ballMotion!.pose.time).toBe(1);
    expect(snapshotLiveSimulation({ state: f.live, pendingCash: 0, speed: "4x", selectedGolferId: f.golfer.id })).toEqual(before);
  });

  it("keeps paused and hidden playback stopped, saves the cursor, and restores only the exact authoritative owner", () => {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.owner.cursor = advanceShotPacingCursor(f.owner.plan, f.owner.cursor, 100)!;
    const frozen = f.owner.cursor;
    expect(advanceShotPacingCursor(f.owner.plan, frozen, 100, { paused: true })).toBe(frozen);
    expect(advanceShotPacingCursor(f.owner.plan, frozen, 100, { hidden: true })).toBe(frozen);
    const snapshot = snapshotLiveSimulation({ state: f.live, pendingCash: 12, speed: "paused", selectedGolferId: f.golfer.id,
      clockRemainderMinutes: .037, focusedShot: snapshotFocusedShot(f.owner) });
    const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot)))!;
    expect(restored.clockRemainderMinutes).toBe(.037);
    const owner = restoreFocusedShot(restored.focusedShot, restored.state, f.world)!;
    expect(owner.cursor).toEqual(frozen);
    expect(owner.plan.key).toBe(f.owner.plan.key);
    expect(focusedShotAudioEvents(owner, owner.cursor, f.course)).toEqual([]);
    expect(restoreFocusedShot(restored.focusedShot, restored.state, { ...f.world, week: f.world.week + 1 })).toBeNull();
    expect(focusedShotMatches(owner, restored.state, f.world, null)).toBe(false);
  });

  it("skips presentation then drains just its remaining segment through ordinary callbacks, including a yielded/save/resume boundary", () => {
    const f = fixture();
    const startIndex = f.golfer.segIndex;
    const initialMinute = f.live.dayMinute;
    const expected = restoreLiveSimulation(snapshotLiveSimulation({ state: f.live, pendingCash: 0, speed: "4x", selectedGolferId: f.golfer.id }))!.state;
    const outcomes = structuredClone(f.golfer.shotOutcomes);
    let expectedSteps = 0;
    while (expected.golfers.find((g) => g.id === f.golfer.id)?.segIndex === startIndex && expectedSteps++ < 100) stepLive(expected, f.course, FIXED_GAME_STEP_MINUTES, f.world);
    f.owner.cursor = advanceShotPacingCursor(f.owner.plan, f.owner.cursor, 0, { paused: true, skip: true })!;
    const callbacks: number[] = [];
    const request = createDayAdvanceRequest(f.live, "until");
    const step = (minutes: number) => stepLive(f.live, f.course, minutes, f.world);
    const isComplete = () => f.live.golfers.find((g) => g.id === f.golfer.id)?.segIndex !== startIndex;
    const first = runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step, isComplete, maxSteps: 1, onEvents: () => callbacks.push(f.live.dayMinute) });
    expect(first.status).toBe("running");
    expect(focusedShotMatches(f.owner, f.live, f.world, f.golfer.id, true)).toBe(true);
    const snapshot = snapshotLiveSimulation({ state: f.live, pendingCash: 0, speed: "paused", selectedGolferId: f.golfer.id,
      focusedShot: snapshotFocusedShot(f.owner) });
    const restored = restoreLiveSimulation(snapshot)!;
    const resumed = restoreFocusedShot(restored.focusedShot, restored.state, f.world)!;
    expect(shotPacingFrame(resumed.plan, resumed.cursor)!.complete).toBe(true);
    expect(resumed.segmentElapsed).toBe(f.golfer.segElapsed);
    expect(focusedShotAudioEvents(resumed, resumed.cursor, f.course)).toEqual([]);
    const nextRequest = createDayAdvanceRequest(restored.state, "until");
    const result = runDayAdvanceChunk({ request: nextRequest, live: restored.state, canReceiveArrivals: true,
      step: (minutes) => stepLive(restored.state, f.course, minutes, f.world),
      onEvents: () => callbacks.push(restored.state.dayMinute),
      isComplete: () => restored.state.golfers.find((g) => g.id === f.golfer.id)?.segIndex !== startIndex, now: () => 0 });
    expect(result.status).toBe("complete");
    expect(callbacks).toHaveLength(expectedSteps);
    expect(restored.state.dayMinute - initialMinute).toBeCloseTo(expectedSteps * FIXED_GAME_STEP_MINUTES);
    expect(restored.state.golfers.find((g) => g.id === f.golfer.id)!.segIndex).toBe(startIndex + 1);
    expect(restored.state.golfers.find((g) => g.id === f.golfer.id)!.shotOutcomes).toEqual(outcomes);
    expect(restored.state.dayMinute).toBe(expected.dayMinute);
  });

  it("drops malformed optional focused fields while keeping legacy authority valid", () => {
    const f = fixture();
    const snapshot = snapshotLiveSimulation({ state: f.live, pendingCash: 0, speed: "1x", selectedGolferId: f.golfer.id });
    const carrier = snapshotFocusedShot(f.owner);
    const invalid: unknown[] = [null, [], { ...carrier, extra: 1 }, { ...carrier, golferId: -1 },
      { ...carrier, segmentElapsed: carrier.segmentElapsed + .001 }, { ...carrier, segmentIndex: carrier.segmentIndex + 1 },
      { ...carrier, scope: { ...carrier.scope, dayIndex: carrier.scope.dayIndex + 1 } },
      { ...carrier, cursor: { ...carrier.cursor, key: "another-owner" } },
      { ...carrier, cursor: { ...carrier.cursor, elapsedMs: Infinity } }];
    for (const focusedShot of invalid) {
      const restored = restoreLiveSimulation({ ...snapshot, focusedShot });
      expect(restored).not.toBeNull();
      expect(restored!.focusedShot).toBeUndefined();
    }
    expect(restoreLiveSimulation(snapshot)!.state.dayMinute).toBe(f.live.dayMinute);
  });

  it("does not emit historical or skipped audio and emits contact only after the shared contact phase", () => {
    const f = fixture();
    let previous = f.owner.cursor;
    f.owner.cursor = { ...previous, elapsedMs: f.owner.plan.addressMs + f.owner.plan.contactMs - 1 };
    expect(focusedShotAudioEvents(f.owner, previous, f.course)).toEqual([]);
    previous = f.owner.cursor;
    f.owner.cursor = { ...previous, elapsedMs: previous.elapsedMs + 1 };
    expect(focusedShotAudioEvents(f.owner, previous, f.course).map((event) => event.kind)).toEqual(["shot"]);
    previous = f.owner.cursor;
    f.owner.cursor = advanceShotPacingCursor(f.owner.plan, previous, 0, { skip: true })!;
    expect(focusedShotAudioEvents(f.owner, previous, f.course, true)).toEqual([]);
  });
});
