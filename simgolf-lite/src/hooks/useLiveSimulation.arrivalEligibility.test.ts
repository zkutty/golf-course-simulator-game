import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import type { Course, Terrain, World } from "../game/models/types";
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
    reset() { slots.splice(0); cursor = 0; pending = []; },
  };
});

vi.mock("react", () => ({
  useRef: hookRuntime.useRef,
  useState: hookRuntime.useState,
  useCallback: hookRuntime.useCallback,
  useEffect: hookRuntime.useEffect,
}));

const simulation = await vi.importActual<typeof import("../game/live/simulation")>("../game/live/simulation");
const eligibility = vi.spyOn(simulation, "courseCanReceiveLiveArrivals");
const ensureArrivals = vi.spyOn(simulation, "ensureOpeningDayArrivals");
vi.mock("../game/live/simulation", async () => ({
  ...(await vi.importActual<typeof import("../game/live/simulation")>("../game/live/simulation")),
  courseCanReceiveLiveArrivals: (...args: Parameters<typeof simulation.courseCanReceiveLiveArrivals>) => eligibility(...args),
  ensureOpeningDayArrivals: (...args: Parameters<typeof simulation.ensureOpeningDayArrivals>) => ensureArrivals(...args),
}));

import { useLiveSimulation } from "./useLiveSimulation";

function makeTutorialNine(playable: boolean): Course {
  const width = 60;
  const height = 24;
  const baseTiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const tee = { x: 4, y: 12 };
  const green = { x: 50, y: 12 };
  baseTiles[tee.y * width + tee.x] = "tee";
  baseTiles[green.y * width + green.x] = "green";
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `hole-${index + 1}`,
    tee,
    green: playable || index < 8 ? green : null,
    parMode: "AUTO" as const,
    name: `Hole ${index + 1}`,
  }));
  const holeIds = holes.map((hole) => hole.id);
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: baseTiles,
    elevations: new Array(width * height).fill(0),
    holes,
    layouts: [{
      id: "course-primary",
      name: "Tutorial Nine",
      draftHoleIds: holeIds,
      publishedHoleIds: holeIds,
      roundLength: 9,
      state: "open",
      greenFee: 65,
    }],
    activeCourseId: "course-primary",
  };
}

function makePreviewThree(): Course {
  const course = makeTutorialNine(true);
  const holes = course.holes.slice(0, 3);
  const holeIds = holes.map((hole) => hole.id!);
  return {
    ...course,
    holes,
    layouts: [{ ...course.layouts![0], draftHoleIds: holeIds, publishedHoleIds: holeIds }],
  };
}

function renderHook(args: Parameters<typeof useLiveSimulation>[0]): ReturnType<typeof useLiveSimulation> {
  hookRuntime.begin();
  // This harness invokes the real hook under its explicit hook-slot runtime.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = useLiveSimulation(args);
  hookRuntime.finish();
  return result;
}

describe("useLiveSimulation arrival eligibility ownership", () => {
  afterEach(() => {
    hookRuntime.reset();
    eligibility.mockClear();
    ensureArrivals.mockClear();
    vi.unstubAllGlobals();
  });

  it("retains an ineligible first-mount value and tracks real course eligibility changes", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const course = makeTutorialNine(false);
    const playableCourse = makeTutorialNine(true);
    const world = { ...DEFAULT_WORLD } as World;
    const base = { enabled: true, course, world, setWorld: () => {}, setCourse: () => {} };

    renderHook(base);
    expect(eligibility).toHaveBeenCalledTimes(2); // first-mount value plus authoritative effect
    expect(eligibility).toHaveBeenNthCalledWith(1, course, { tutorialThreeHolePreview: false });
    expect(eligibility).toHaveBeenNthCalledWith(2, course, { tutorialThreeHolePreview: false });
    expect(eligibility.mock.results[0].value).toBe(false);

    renderHook({ ...base, world: { ...world, cash: world.cash + 1 } });
    expect(eligibility).toHaveBeenCalledTimes(2);

    renderHook({ ...base, course: playableCourse });
    expect(eligibility).toHaveBeenCalledTimes(3);
    expect(eligibility).toHaveBeenLastCalledWith(playableCourse, { tutorialThreeHolePreview: false });
    expect(eligibility.mock.results[2].value).toBe(true);
    expect(ensureArrivals).toHaveBeenLastCalledWith(expect.anything(), playableCourse, world, { tutorialThreeHolePreview: false });

    renderHook({ ...base, enabled: false, course: playableCourse });
    expect(eligibility).toHaveBeenCalledTimes(4);
    expect(ensureArrivals).toHaveBeenCalledTimes(1);
  });

  it("applies policy-only preview eligibility changes and restores a populated live snapshot", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const course = makePreviewThree();
    const world = { ...DEFAULT_WORLD } as World;
    const base = { enabled: true, course, world, setWorld: () => {}, setCourse: () => {} };

    let result = renderHook(base);
    expect(eligibility.mock.results[0].value).toBe(false);
    expect(eligibility).toHaveBeenCalledTimes(2);

    result = renderHook({ ...base, publicThreeHoleOperation: true });
    expect(eligibility).toHaveBeenCalledTimes(3);
    expect(eligibility).toHaveBeenLastCalledWith(course, { tutorialThreeHolePreview: true });
    expect(eligibility.mock.results[2].value).toBe(true);
    expect(ensureArrivals).toHaveBeenLastCalledWith(expect.anything(), course, world, { tutorialThreeHolePreview: true });

    result = renderHook({ ...base, publicThreeHoleOperation: false });
    expect(eligibility).toHaveBeenCalledTimes(4);
    expect(eligibility).toHaveBeenLastCalledWith(course, { tutorialThreeHolePreview: false });
    expect(eligibility.mock.results[3].value).toBe(false);

    const savedState = createLiveState(course, world, 0, { tutorialThreeHolePreview: true });
    expect(savedState.arrivals.length).toBeGreaterThan(0);
    const snapshot = snapshotLiveSimulation({ state: savedState, pendingCash: 12, speed: "paused", selectedGolferId: null });
    expect(result.restoreSnapshot(snapshot)).toBe(true);
    expect(result.getSnapshot()).toMatchObject({ state: snapshot.state, pendingCash: 12, speed: "paused" });

    renderHook({ ...base, publicThreeHoleOperation: false });
    expect(eligibility).toHaveBeenCalledTimes(4);
    const ensureCallsBeforeDisable = ensureArrivals.mock.calls.length;
    renderHook({ ...base, enabled: false, publicThreeHoleOperation: false });
    expect(eligibility).toHaveBeenCalledTimes(5);
    expect(ensureArrivals).toHaveBeenCalledTimes(ensureCallsBeforeDisable);
  });
});
