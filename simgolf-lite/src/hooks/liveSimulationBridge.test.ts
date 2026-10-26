import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD } from "../game/models/defaults";
import type { Course, Terrain } from "../game/models/types";
import { snapshotLiveSimulation } from "../game/live/persistence";
import { createLiveState, stepLive } from "../game/live/simulation";
import { acquireFocusedShot, snapshotFocusedShot } from "../game/live/focusedShot";
import { createLiveSimulationBridge, type LiveSimulationApi, type LiveSimulationArgs } from "./liveSimulationBridge";

function fixture() {
  const width = 60; const height = 24;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  const tee = { x: 4, y: 12 }; const green = { x: 50, y: 12 };
  tiles[tee.y * width + tee.x] = "tee";
  for (let y = 11; y <= 13; y++) for (let x = 49; x <= 51; x++) tiles[y * width + x] = "green";
  const course: Course = { name: "Deferred Links", width, height, tiles, elevations: new Array(width * height).fill(0),
    holes: [{ tee, green, parMode: "AUTO" }], obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 65, condition: .8 };
  const world = structuredClone(DEFAULT_WORLD);
  const args: LiveSimulationArgs = { enabled: false, course, world, getLatestWorld: () => world, setWorld: vi.fn(), setCourse: vi.fn() };
  const bridge = createLiveSimulationBridge(args);
  const live = createLiveState(course, world, 0);
  const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 12, speed: "4x", selectedGolferId: null, clockRemainderMinutes: .037 });
  return { args, bridge, live, snapshot, course, world };
}

function driverFor(bridge: ReturnType<typeof createLiveSimulationBridge>): LiveSimulationApi {
  return { ...bridge.getView(), ...bridge.methods, golfersRef: { current: [] },
    restoreSnapshot: vi.fn(() => true), setSpeed: vi.fn(), selectGolfer: vi.fn(), getSnapshot: vi.fn(),
    advanceTime: vi.fn(), startDayAdvance: vi.fn(), skipFocusedShot: vi.fn() };
}

describe("deferred live simulation handoff", () => {
  it("resolves entry preparation only after the restored driver publishes ready", async () => {
    const f = fixture();
    let completed = false;
    const prepared = f.bridge.prepare().then((ready) => { completed = ready; return ready; });
    expect(f.bridge.getView()).toMatchObject({ requested: true, ready: false });
    await Promise.resolve();
    expect(completed).toBe(false);
    const driver = driverFor(f.bridge);
    f.bridge.attach(driver);
    f.bridge.arm();
    await Promise.resolve();
    expect(completed).toBe(false);
    f.bridge.publish(driver);
    expect(await prepared).toBe(true);
    expect(await f.bridge.prepare()).toBe(true);
  });

  it("cancels stale entries independently while a newer entry shares preparation", async () => {
    const f = fixture();
    const stale = new AbortController();
    const oldEntry = f.bridge.prepare(stale.signal);
    const currentEntry = f.bridge.prepare();
    stale.abort();
    expect(await oldEntry).toBe(false);
    expect(f.bridge.getView().requested).toBe(true);
    const driver = driverFor(f.bridge);
    f.bridge.attach(driver);
    f.bridge.publish(driver);
    expect(await currentEntry).toBe(true);
    const dormant = fixture();
    expect(await dormant.bridge.prepare(stale.signal)).toBe(false);
    expect(dormant.bridge.getView().requested).toBe(false);
  });

  it.each(["1x", "2x", "4x"] as const)("retains queued startup %s across a disabled StrictMode cleanup before live state exists", (speed) => {
    const f = fixture();
    f.bridge.methods.restoreSnapshot(undefined);
    f.bridge.methods.setSpeed(speed);
    f.bridge.methods.selectGolfer(7);
    const first = driverFor(f.bridge);
    f.bridge.attach(first);
    f.bridge.arm();
    f.bridge.detach();
    const remounted = driverFor(f.bridge);
    f.bridge.attach(remounted);
    expect(remounted.restoreSnapshot).toHaveBeenCalledWith(undefined);
    expect(remounted.setSpeed).toHaveBeenCalledExactlyOnceWith(speed);
    expect(remounted.selectGolfer).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("keeps title startup dormant and authority unavailable without a driver", () => {
    const f = fixture();
    expect(f.bridge.getView()).toMatchObject({ requested: false, ready: false, advanceDisabledReason: "unavailable", speed: "paused" });
    expect(f.bridge.methods.getSnapshot()).toBeUndefined();
    expect(f.bridge.methods.baselineControlledRoundTime({ scope: "new", roundId: "r", shotCount: 0, totalSteps: 0 })).toBe(false);
    expect(f.bridge.methods.observeControlledTimeNow({ scope: "new", roundId: "r", shotCount: 1, totalSteps: 10 })).toBe(false);
    f.bridge.methods.advanceTime(2000);
    f.bridge.methods.startDayAdvance("finish-day");
    expect(f.bridge.getView().status.dayMinute).toBe(0);
  });

  it("queues the last validated restore and subsequent speed/selection before attachment", () => {
    const f = fixture();
    f.bridge.methods.setSpeed("1x");
    expect(f.bridge.methods.restoreSnapshot(f.snapshot)).toBe(true);
    f.bridge.methods.setSpeed("paused");
    f.bridge.methods.selectGolfer(7);
    const queued = f.bridge.methods.getSnapshot()!;
    expect(queued).toMatchObject({ speed: "paused", selectedGolferId: 7, pendingCash: 12, clockRemainderMinutes: .037 });
    queued.state.dayMinute = 99;
    expect(f.bridge.methods.getSnapshot()!.state.dayMinute).toBe(f.snapshot.state.dayMinute);
    const driver = driverFor(f.bridge);
    expect(f.bridge.attach(driver)).toBe(true);
    expect(driver.restoreSnapshot).toHaveBeenCalledWith(expect.objectContaining({ speed: "paused", selectedGolferId: 7 }));
    expect(driver.setSpeed).toHaveBeenCalledWith("paused");
    expect(driver.selectGolfer).toHaveBeenCalledWith(7);
    expect(f.bridge.getView().ready).toBe(false);
    f.bridge.publish(driver);
    expect(f.bridge.getView().ready).toBe(true);
  });

  it("preserves focused retained authority and cursor while the driver is unavailable", () => {
    const f = fixture();
    f.live.arrivals = f.live.arrivals.slice(0, 1);
    let steps = 0;
    while (!f.live.golfers.some((golfer) => golfer.segments[golfer.segIndex]?.motion) && steps++ < 5000) stepLive(f.live, f.course, .05, f.world);
    expect(steps).toBeLessThan(5000);
    const golfer = f.live.golfers.find((item) => item.segments[item.segIndex]?.motion)!;
    const owner = acquireFocusedShot(f.live, f.world, golfer.id)!;
    owner.cursor = { ...owner.cursor, elapsedMs: 2000 };
    const saved = snapshotLiveSimulation({ state: f.live, pendingCash: 12, speed: "4x", selectedGolferId: golfer.id,
      clockRemainderMinutes: .037, focusedShot: snapshotFocusedShot(owner) });
    expect(f.bridge.methods.restoreSnapshot(saved)).toBe(true);
    const before = f.bridge.methods.getSnapshot();
    f.bridge.methods.advanceTime(2000);
    f.bridge.methods.skipFocusedShot();
    expect(f.bridge.methods.getSnapshot()).toEqual(before);
    expect(f.bridge.methods.getFocusedShotFrame()).toMatchObject({ key: owner.plan.key, progress: 2000 / owner.plan.durationMs });
    expect(before!.focusedShot).toEqual(saved.focusedShot);
    const driver = driverFor(f.bridge);
    f.bridge.attach(driver);
    expect(driver.restoreSnapshot).toHaveBeenCalledWith(before);
    expect(driver.advanceTime).not.toHaveBeenCalled();
  });

  it("keeps Sunday acknowledgement and controlled debt intact before first frame", () => {
    const f = fixture();
    f.world.week = 4;
    const saved = { ...f.snapshot, weekReportPending: { version: 1 as const, week: 3, resumeSpeed: "4x" as const },
      controlledTime: { version: 1 as const, scope: "player:run", roundId: "r", observedShotCount: 1, observedTotalSteps: 14, pendingSteps: 14 } };
    expect(f.bridge.methods.restoreSnapshot(saved)).toBe(true);
    f.bridge.methods.advanceTime(2000);
    expect(f.bridge.methods.getSnapshot()).toMatchObject({ weekReportPending: saved.weekReportPending, controlledTime: saved.controlledTime });
    expect(f.bridge.getView().controlledTimePendingSteps).toBe(14);
    expect(f.bridge.methods.restoreSnapshot({ ...saved, weekReportPending: { ...saved.weekReportPending, week: 2 } })).toBe(false);
    expect(f.bridge.methods.getSnapshot()!.weekReportPending).toEqual(saved.weekReportPending);
    f.bridge.methods.acknowledgeWeekReport();
    expect(f.bridge.methods.getSnapshot()!.weekReportPending).toBeUndefined();
    expect(f.bridge.methods.getSnapshot()!.controlledTime).toEqual(saved.controlledTime);
  });

  it("clears a queued previous run on reset and preserves only subsequent settings", () => {
    const f = fixture();
    f.bridge.methods.restoreSnapshot(f.snapshot);
    f.bridge.methods.setSpeed("2x");
    f.bridge.methods.restoreSnapshot(undefined);
    f.bridge.methods.setSpeed("1x");
    expect(f.bridge.methods.getSnapshot()).toBeUndefined();
    expect(f.bridge.golfersRef.current).toEqual([]);
    const driver = driverFor(f.bridge);
    f.bridge.attach(driver);
    expect(driver.restoreSnapshot).toHaveBeenCalledWith(undefined);
    expect(driver.setSpeed).toHaveBeenCalledExactlyOnceWith("1x");
    expect(f.bridge.getView()).toMatchObject({ selectedId: null, focusedShot: null, controlledTimePendingSteps: 0 });
  });

  it("publishes changed fields once and reads buffer swaps through a stable ref", () => {
    const f = fixture();
    const listener = vi.fn();
    f.bridge.subscribe(listener);
    const driver = driverFor(f.bridge);
    f.bridge.attach(driver);
    f.bridge.publish(driver);
    f.bridge.publish({ ...driver });
    expect(listener).toHaveBeenCalledTimes(1);
    const ref = f.bridge.golfersRef;
    const first = driver.golfersRef.current;
    driver.golfersRef.current = [...first];
    expect(f.bridge.golfersRef).toBe(ref);
    expect(ref.current).toBe(driver.golfersRef.current);
    expect(ref.current).not.toBe(first);
    f.bridge.detach();
    expect(ref.current).toEqual([]);
  });

  it("retains the queued save and never arms a rejected handoff", () => {
    const f = fixture();
    f.bridge.methods.restoreSnapshot(f.snapshot);
    const before = f.bridge.methods.getSnapshot();
    const driver = driverFor(f.bridge);
    driver.restoreSnapshot = vi.fn(() => false);
    expect(f.bridge.attach(driver)).toBe(false);
    expect(f.bridge.getView().ready).toBe(false);
    expect(f.bridge.methods.getSnapshot()).toEqual(before);
    expect(driver.setSpeed).not.toHaveBeenCalled();
  });

  it("retains current authority, debt and Sunday acknowledgement when a ready controller unmounts", () => {
    const f = fixture();
    f.world.week = 4;
    const saved = { ...f.snapshot, weekReportPending: { version: 1 as const, week: 3, resumeSpeed: "4x" as const },
      controlledTime: { version: 1 as const, scope: "player:run", roundId: "r", observedShotCount: 1, observedTotalSteps: 14, pendingSteps: 14 } };
    f.bridge.methods.restoreSnapshot(saved);
    const driver = driverFor(f.bridge);
    const current = f.bridge.methods.getSnapshot();
    driver.getSnapshot = vi.fn(() => structuredClone(current));
    f.bridge.attach(driver);
    f.bridge.arm();
    f.bridge.publish(driver);
    f.bridge.detach();
    expect(f.bridge.methods.getSnapshot()).toEqual(current);
    expect(f.bridge.getView()).toMatchObject({ ready: false, requested: true, advanceDisabledReason: "unavailable" });
    expect(f.bridge.isArmed()).toBe(false);
    f.bridge.methods.advanceTime(2000);
    f.bridge.methods.startDayAdvance("finish-day");
    expect(driver.advanceTime).not.toHaveBeenCalled();
    expect(driver.startDayAdvance).not.toHaveBeenCalled();
    expect(f.bridge.methods.getSnapshot()).toEqual(current);
  });
});
