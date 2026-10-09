import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import type { Course, World } from "../game/models/types";
import { createLiveState } from "../game/live/simulation";
import { snapshotLiveSimulation } from "../game/live/persistence";
const hookRuntime = vi.hoisted(() => {
  type Slot = { kind: string; value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };
  const slots: Slot[] = [];
  let cursor = 0;
  let pending: Array<{ slot: Slot; callback: () => void | (() => void); deps?: unknown[] }> = [];
  const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const next = (kind: string): Slot => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { kind };
    if (slots[index].kind !== kind) throw new Error(`Hook order changed at ${index}`);
    return slots[index];
  };
  return {
    slots,
    begin() { cursor = 0; pending = []; },
    finish() {
      for (const item of pending) {
        item.slot.cleanup?.();
        item.slot.deps = item.deps;
        item.slot.cleanup = item.callback();
      }
    },
    useRef(initial: unknown) {
      const slot = next("ref");
      if (!("value" in slot)) slot.value = { current: initial };
      return slot.value as { current: unknown };
    },
    useState(initial: unknown) {
      const slot = next("state");
      if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slot.value, (value: unknown) => { slot.value = typeof value === "function" ? (value as (previous: unknown) => unknown)(slot.value) : value; }];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const slot = next("callback");
      if (!("value" in slot) || !sameDeps(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value;
    },
    useEffect(callback: () => void | (() => void), deps?: unknown[]) {
      const slot = next("effect");
      if (!("value" in slot) || !sameDeps(slot.deps, deps)) {
        slot.value = true;
        pending.push({ slot, callback, deps });
      }
    },
    reset() { for (const slot of slots) slot.cleanup?.(); slots.splice(0); cursor = 0; pending = []; },
  };
});

vi.mock("react", () => ({
  useRef: hookRuntime.useRef,
  useState: hookRuntime.useState,
  useCallback: hookRuntime.useCallback,
  useEffect: hookRuntime.useEffect,
}));

vi.mock("../game/m51/operationsReport", async () => {
  const actual = await vi.importActual<typeof import("../game/m51/operationsReport")>("../game/m51/operationsReport");
  return { ...actual, buildMobilityOperationsReports: vi.fn(actual.buildMobilityOperationsReports) };
});
import { buildMobilityOperationsReports } from "../game/m51/operationsReport";
import { useLiveSimulation } from "./useLiveSimulation";
const actualReport = (await vi.importActual<typeof import("../game/m51/operationsReport")>("../game/m51/operationsReport")).buildMobilityOperationsReports;
const report = vi.mocked(buildMobilityOperationsReports);

function rentalCourse(fleetCount: number): Course {
  const width = 24;
  const height = 18;
  const id = "course-primary";
  return {
    ...DEFAULT_COURSE,
    width, height,
    tiles: new Array(width * height).fill("fairway"),
    elevations: new Array(width * height).fill(0),
    holes: [{ id: "hole-1", tee: { x: 3, y: 9 }, green: { x: 20, y: 9 }, parMode: "MANUAL", parManual: 4 }],
    layouts: [{ id, name: "Report fixture", draftHoleIds: ["hole-1"], publishedHoleIds: ["hole-1"], roundLength: 9, state: "open", greenFee: 65, legacyPartial: true }],
    activeCourseId: id,
    buildings: [{ id: "rental", type: "cart_rental", x: 2, y: 2, tier: 2, price: 20 }],
    obstacles: [], decorations: [],
    m51: {
      version: 3,
      cartRentals: {},
      fleet: Object.fromEntries(Array.from({ length: fleetCount }, (_, index) => {
        const unitId = `cart-${index}`;
        return [unitId, { id: unitId, courseId: id, buildingId: "rental", productId: "rental:riding_cart", mode: "riding_cart" as const, seats: 2, state: "available" as const, condition: 1, uses: 0, wear: 0 }];
      })),
      settledAssignmentIds: [],
    },
  };
}

function renderHook(args: Parameters<typeof useLiveSimulation>[0]) {
  hookRuntime.begin();
  // Execute the production hook; only React scheduling is supplied by the hook-slot runtime above.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const value = useLiveSimulation(args);
  hookRuntime.finish();
  return value;
}

function rafClock() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  return (timestamp: number) => {
    const entry = callbacks.entries().next().value;
    if (!entry) throw new Error("No scheduled production RAF callback");
    callbacks.delete(entry[0]);
    entry[1](timestamp);
  };
}

describe("useLiveSimulation initial mobility report", () => {
  afterEach(() => {
    hookRuntime.reset();
    report.mockClear();
    vi.unstubAllGlobals();
  });

  it("builds the first report once and discards no report on unrelated or input rerenders", () => {
    rafClock();
    const course = rentalCourse(2);
    const world = { ...DEFAULT_WORLD } as World;
    const args = { enabled: false, course, world, setWorld: () => {}, setCourse: () => {} };
    let value = renderHook(args);
    const initial = value.status.mobility;
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith({ course, world, week: world.week, dayIndex: 0 });
    expect(initial).toEqual(actualReport({ course, world, week: world.week, dayIndex: 0 }));
    expect(initial.current.fleet.owned).toBe(2);

    value.setSpeed("4x");
    value = renderHook(args);
    expect(value.status.speed).toBe("4x");
    expect(value.status.mobility).toBe(initial);
    expect(report).toHaveBeenCalledTimes(1);

    const changedCourse = rentalCourse(3);
    const changedWorld = { ...world, week: world.week + 1, cash: world.cash + 1 };
    value = renderHook({ ...args, course: changedCourse, world: changedWorld });
    expect(report).toHaveBeenCalledTimes(1);
    expect(value.status.mobility).toBe(initial); // current status changes only at the original publication/restore boundary

    hookRuntime.reset();
    value = renderHook({ ...args, course: changedCourse, world: changedWorld });
    expect(report).toHaveBeenCalledTimes(2); // a new mount gets its own current initial value
    expect(value.status.mobility).toEqual(actualReport({ course: changedCourse, world: changedWorld, week: changedWorld.week, dayIndex: 0 }));
    expect(value.status.mobility.current.fleet.owned).toBe(3);
  });

  it("still refreshes restored and RAF-published reports from current inputs", () => {
    const tick = rafClock();
    const firstCourse = rentalCourse(2);
    const firstWorld = { ...DEFAULT_WORLD } as World;
    const args = { enabled: false, course: firstCourse, world: firstWorld, setWorld: () => {}, setCourse: () => {} };
    renderHook(args);
    const course = rentalCourse(3);
    const world = { ...firstWorld, week: firstWorld.week + 1 };
    const currentArgs = { ...args, course, world };
    let value = renderHook(currentArgs);
    expect(report).toHaveBeenCalledTimes(1);
    const state = createLiveState(course, world, 2);
    const snapshot = snapshotLiveSimulation({ state, pendingCash: 0, speed: "paused", selectedGolferId: null });
    expect(value.restoreSnapshot(snapshot)).toBe(true);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith({ course, world, live: expect.anything(), week: world.week, dayIndex: 2 });
    value = renderHook(currentArgs);
    expect(report).toHaveBeenCalledTimes(2);
    expect(value.status.dayIndex).toBe(2);
    expect(value.status.mobility).toEqual(report.mock.results[1].value);
    expect(value.status.mobility.current.fleet.owned).toBe(3);

    const nextCourse = rentalCourse(4);
    const nextWorld = { ...world, week: world.week + 1 };
    const activeArgs = { ...currentArgs, enabled: true, course: nextCourse, world: nextWorld };
    renderHook(activeArgs);
    expect(report).toHaveBeenCalledTimes(2);
    tick(1000); // the real paused RAF loop publishes its original throttled status
    expect(report).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenLastCalledWith({ course: nextCourse, world: nextWorld, live: expect.anything(), week: nextWorld.week, dayIndex: 2 });
    value = renderHook(activeArgs);
    expect(report).toHaveBeenCalledTimes(3);
    expect(value.status.mobility).toEqual(report.mock.results[2].value);
    expect(value.status.mobility.current.fleet.owned).toBe(4);
  });
});
