import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import type { Course, Terrain } from "../game/models/types";
import { createLiveState, createRenderPerfLiveState } from "../game/live/simulation";
import { createParklandVisualReferenceCourse } from "../game/testing/referenceCourse";
import { reserveGroupMobility } from "../game/m51/operations";
import { staffFromLevel } from "../game/live/pace";
import { captureShotTelemetrySnapshot } from "../game/live/shotTelemetrySnapshot";
import { snapshotLiveSimulation } from "../game/live/persistence";
const hookRuntime = vi.hoisted(() => {
  type Slot = {
    callback?: () => void | (() => void);
    kind: string;
    value?: unknown;
    deps?: unknown[];
    cleanup?: (() => void) | void;
  };
  const slots: Slot[] = [];
  let cursor = 0;
  let pending: Array<{
    slot: Slot;
    callback: () => void | (() => void);
    deps?: unknown[];
  }> = [];
  const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const next = (kind: string): Slot => {
    const index = cursor++;
    if (!slots[index])
      slots[index] = { kind };
    if (slots[index].kind !== kind)
      throw new Error(`Hook order changed at ${index}`);
    return slots[index];
  };
  return {
    slots,
    begin() { cursor = 0; pending = []; },
    finish() {
      for (const item of pending) {
        item.slot.cleanup?.();
        item.slot.deps = item.deps;
        item.slot.callback = item.callback;
        item.slot.cleanup = item.callback();
      }
    },
    useRef(initial: unknown) {
      const slot = next("ref");
      if (!("value" in slot))
        slot.value = { current: initial };
      return slot.value as {
        current: unknown;
      };
    },
    useState(initial: unknown) {
      const slot = next("state");
      if (!("value" in slot))
        slot.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slot.value, (value: unknown) => { slot.value = typeof value === "function" ? (value as (previous: unknown) => unknown)(slot.value) : value; }];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const slot = next("callback");
      if (!("value" in slot) || !sameDeps(slot.deps, deps)) {
        slot.value = callback;
        slot.deps = deps;
      }
      return slot.value;
    },
    useEffect(callback: () => void | (() => void), deps?: unknown[]) {
      const slot = next("effect");
      if (!("value" in slot) || !sameDeps(slot.deps, deps)) {
        slot.value = true;
        pending.push({ slot, callback, deps });
      }
    },
    replayEffects() {
      for (const slot of slots) {
        if (slot.kind === "effect" && slot.callback) {
          slot.cleanup?.();
          slot.cleanup = slot.callback();
        }
      }
    },
    cleanupAll() {
      for (const slot of slots) {
        slot.cleanup?.();
        slot.cleanup = undefined;
      }
    },
    reset() { this.cleanupAll(); slots.splice(0); cursor = 0; pending = []; },
  };
});
vi.mock("react", () => ({
  useRef: hookRuntime.useRef,
  useState: hookRuntime.useState,
  useCallback: hookRuntime.useCallback,
  useEffect: hookRuntime.useEffect,
}));
import { useLiveSimulation } from "./useLiveSimulation";
function rentalCourse(options: {
  carts?: number;
  pushcarts?: number;
  paths?: boolean;
  enabled?: boolean;
} = {}): Course {
  const width = 60;
  const height = 24;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  if (options.paths !== false)
    for (let x = 1; x < width - 1; x++)
      tiles[4 * width + x] = "path";
  tiles[12 * width + 4] = "tee";
  tiles[12 * width + 50] = "green";
  const buildingId = "rental";
  const fleet = Object.fromEntries([
    ...Array.from({ length: options.carts ?? 2 }, (_, index) => {
      const id = `cart-${index + 1}`;
      return [id, { id, courseId: "course-primary", buildingId, productId: `${buildingId}:riding_cart`, mode: "riding_cart" as const, seats: 2, state: "available" as const, condition: 1, uses: 0, wear: 0 }];
    }),
    ...Array.from({ length: options.pushcarts ?? 4 }, (_, index) => {
      const id = `push-${index + 1}`;
      return [id, { id, courseId: "course-primary", buildingId, productId: `${buildingId}:pushcart`, mode: "pushcart" as const, seats: 1, state: "available" as const, condition: 1, uses: 0, wear: 0 }];
    }),
  ]);
  return {
    ...DEFAULT_COURSE,
    name: "Mobility Links", width, height, tiles, elevations: new Array(width * height).fill(0),
    holes: [{ id: "hole-1", tee: { x: 4, y: 12 }, green: { x: 50, y: 12 }, parMode: "AUTO", name: "Long walk" }],
    // This focused one-hole fixture represents a legacy partial layout. Live
    // arrival planning now correctly rejects incomplete authored courses, so
    // retain the explicit legacy opt-in while exercising M51's full-day
    // assignment/return lifecycle.
    layouts: [{ id: "course-primary", name: "Mobility Links", draftHoleIds: ["hole-1"], publishedHoleIds: ["hole-1"], roundLength: 9, state: "open", greenFee: 65, legacyPartial: true }],
    buildings: [{ id: buildingId, type: "cart_rental", x: 2, y: 2, tier: 2, price: 20 }],
    obstacles: [], decorations: [],
    m51: {
      version: 3,
      cartRentals: {
        rental: {
          buildingId, tier: 2,
          products: {
            pushcart: { id: "rental:pushcart", courseId: "course-primary", buildingId, mode: "pushcart", name: "Pushcart", price: 9, enabled: options.enabled !== false },
            riding_cart: { id: "rental:riding_cart", courseId: "course-primary", buildingId, mode: "riding_cart", name: "Riding cart", price: 20, enabled: options.enabled !== false },
          },
        },
      },
      fleet,
      settledAssignmentIds: [],
    },
  };
}
const course = createParklandVisualReferenceCourse();
const world = { ...DEFAULT_WORLD };
const rafs = new Map<number, FrameRequestCallback>();
let nextRaf = 1;
function renderHook(args: Parameters<typeof useLiveSimulation>[0]) {
  hookRuntime.begin();
  // Real hook under the existing explicit slot runtime, not a copied algorithm.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const live = useLiveSimulation(args);
  hookRuntime.finish();
  return live;
}
function base(enabled = true) { return { enabled, course, world, setCourse: () => { }, setWorld: () => { } }; }
function fixture() {
  const state = createRenderPerfLiveState(course, world);
  state.golfers = state.golfers.slice(0, 1);
  state.arrivals = [];
  state.groups = [];
  return state;
}
function restore(live: ReturnType<typeof useLiveSimulation>, state = fixture(), speed: "paused" | "1x" = "paused") {
  expect(live.restoreSnapshot(snapshotLiveSimulation({ state, pendingCash: 0, speed, selectedGolferId: null }))).toBe(true);
}
function parity(live: ReturnType<typeof useLiveSimulation>) {
  const expected = live.getShotTelemetrySnapshot();
  const lookup = live.getReadonlyShotTelemetryLookup();
  expect(JSON.stringify([...expected].map(([id]) => [id, lookup.get(id)]))).toBe(JSON.stringify([...expected]));
  const full = live.getSnapshot();
  if (full)
    expect(JSON.stringify([...captureShotTelemetrySnapshot(full.state.golfers)])).toBe(JSON.stringify([...expected]));
  return lookup;
}
function tick(ts: number) { const first = [...rafs][0]; expect(first).toBeDefined(); rafs.delete(first[0]); first[1](ts); }
describe("real live hook cursor writer/lifetime boundaries", () => {
  afterEach(() => { hookRuntime.reset(); vi.unstubAllGlobals(); rafs.clear(); nextRaf = 1; });
  function globals() { vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = nextRaf++; rafs.set(id, callback); return id; }); vi.stubGlobal("cancelAnimationFrame", (id: number) => rafs.delete(id)); }
  it("hits through paused status RAF/rerenders and preserves fresh public/save isolation", () => {
    globals();
    const args = base();
    let live = renderHook(args);
    restore(live);
    const initial = parity(live);
    tick(1000);
    tick(2000);
    live = renderHook(args);
    expect(parity(live)).toBe(initial);
    const publicCopy = live.getShotTelemetrySnapshot() as Map<number, ReturnType<typeof fixture>["golfers"][number]>;
    publicCopy.get(1)!.segments[0].from.x = 777;
    publicCopy.clear();
    const full = live.getSnapshot()!;
    full.state.golfers[0].segments[0].from.x = 888;
    expect(parity(live)).toBe(initial);
    expect(live.getSnapshot()!.state.golfers[0].segments[0].from.x).not.toBe(888);
    expect(live.getShotTelemetrySnapshot().get(1)!.segments[0].from.x).not.toBe(777);
  });
  it("invalidates actual advanceTime and RAF partial cursor writes before reuse", () => {
    globals();
    const live = renderHook(base());
    restore(live);
    const previous = parity(live);
    live.setSpeed("1x");
    live.advanceTime(2000);
    const advanced = parity(live);
    expect(advanced).not.toBe(previous);
    expect(advanced.get(1)!.segElapsed).not.toBe(previous.get(1)!.segElapsed);
    tick(1000);
    for (let time = 1100; time <= 3000; time += 100)
      tick(time);
    const rafAdvanced = parity(live);
    expect(rafAdvanced).not.toBe(advanced);
    expect(rafAdvanced.get(1)!.segElapsed).toBeGreaterThan(advanced.get(1)!.segElapsed);
  });
  it("invalidates reset, failed restore, repeated same-ID restore and disable/StrictMode cleanup", () => {
    globals();
    const args = base();
    let live = renderHook(args);
    restore(live);
    const old = parity(live);
    const state = fixture();
    state.golfers[0].segments[0].dur = 200;
    restore(live, state);
    const changed = parity(live);
    expect(changed.get(1)!.segments[0].dur).toBe(200);
    expect(changed).not.toBe(old);
    expect(live.restoreSnapshot({ version: 999 } as never)).toBe(false);
    expect(parity(live)).not.toBe(changed);
    const beforeReplay = parity(live);
    hookRuntime.replayEffects();
    expect(parity(live)).not.toBe(beforeReplay);
    live = renderHook({ ...args, enabled: false });
    const disabled = parity(live);
    expect(disabled).not.toBe(beforeReplay);
    expect(disabled.get(1)).toBeDefined();
    expect(live.restoreSnapshot(undefined)).toBe(true);
    expect(parity(live).get(1)).toBeUndefined();
    restore(live, state);
    expect(parity(live).get(1)!.segments[0].dur).toBe(200);
    const final = parity(live);
    hookRuntime.cleanupAll();
    expect(parity(live)).not.toBe(final);
  });
  it("invalidates geometry reconciliation and same-root opening-arrival planning", () => {
    globals();
    const args = base();
    let live = renderHook(args);
    restore(live);
    // Restores skip exactly one geometry replan; the next edit must replan.
    live = renderHook({ ...args, course: { ...course, obstacles: [...course.obstacles] } });
    const old = parity(live);
    live = renderHook({ ...args, course: { ...course, obstacles: [...course.obstacles, { type: "tree", x: 12, y: 18 }] } });
    const replanned = parity(live);
    expect(replanned).not.toBe(old);
    expect(JSON.stringify(replanned.get(1))).not.toBe(JSON.stringify(old.get(1)));
    const rental = rentalCourse();
    const pristine = createLiveState(rental, world, 0);
    pristine.arrivals = [];
    pristine.groups = [];
    restore(live, pristine);
    const empty = parity(live);
    expect(live.getSnapshot()!.state.arrivals).toHaveLength(0);
    live = renderHook({ ...args, course: { ...rental, obstacles: [...rental.obstacles] } });
    // Pristine planning changes the SAME live root, but its zero-golfer cursor
    // remains empty. Identity verifies the conservative fence; arrivals prove
    // the real planner executed, rather than a generic null-root creation.
    expect(live.getSnapshot()!.state.arrivals.length).toBeGreaterThan(0);
    expect(parity(live)).not.toBe(empty);
  });
  it("captures a real hole boundary and scoredHoles increment", () => {
    globals();
    const live = renderHook(base());
    const state = fixture();
    const g = state.golfers[0];
    g.segments = [{ kind: "walk", from: { x: 3, y: 9 }, to: { x: 4, y: 9 }, holeIndex: 0, dur: .01 }, { kind: "walk", from: { x: 4, y: 9 }, to: { x: 5, y: 9 }, holeIndex: -1, dur: 10000 }];
    g.holePar = [4];
    g.holeStrokes = [5];
    g.scoredHoles = 0;
    restore(live, state, "1x");
    const before = parity(live);
    expect(before.get(1)!.scoredHoles).toBe(0);
    live.advanceTime(2000);
    const after = parity(live);
    expect(after.get(1)!.scoredHoles).toBe(1);
    expect(after.get(1)!.segIndex).toBeGreaterThan(before.get(1)!.segIndex);
    expect(before.get(1)!.scoredHoles).toBe(0);
  });
  it("captures newly spawned arrival IDs and M51 mobility segments", () => {
    globals();
    const rental = rentalCourse();
    const live = renderHook({ ...base(), course: rental });
    const state = createLiveState(rental, world, 0);
    state.arrivals = state.arrivals.slice(0, 1).map(a => ({ ...a, atMinute: 0 }));
    state.groups = state.groups?.filter(g => g.id === state.arrivals[0].groupId);
    state.nextArrivalIdx = 0;
    state.nextTeeFreeAt = 0;
    state.nextTeeFreeAtByCourse = {};
    state.golfers = [];
    restore(live, state, "1x");
    const before = parity(live);
    expect(before.get(1)).toBeUndefined();
    live.advanceTime(2000);
    const after = parity(live);
    expect(after.get(1)).toBeDefined();
    expect(after).not.toBe(before);
    expect(live.getSnapshot()!.state.m51?.selections.length).toBeGreaterThan(0);
  });
  it("invalidates marshal edits of existing nested segment durations", () => {
    globals();
    const rental = rentalCourse();
    const staffed = { ...world, staffLevel: 5, staffRoster: staffFromLevel(5, "course-primary") };
    const live = renderHook({ ...base(), course: rental, world: staffed });
    const state = fixture();
    const golfer = state.golfers[0];
    golfer.courseId = "course-primary";
    golfer.groupId = "g-1";
    golfer.currentHole = 0;
    golfer.currentHoleId = "hole-1";
    golfer.holeIds = ["hole-1"];
    golfer.holePar = [4];
    golfer.holeStrokes = [4];
    golfer.segments = [{ kind: "walk", from: { x: 4, y: 12 }, to: { x: 50, y: 12 }, holeIndex: 0, dur: 10000 }, { kind: "walk", from: { x: 50, y: 12 }, to: { x: 2, y: 2 }, holeIndex: -1, dur: 10000 }];
    state.dayMinute = 200;
    state.groups = [{ id: "g-1", courseId: "course-primary", bookedAt: 0, startedAt: 0, finishedAt: null, golferIds: [1], waitMinutes: 0, blocked: false, interventions: 1, pickups: 0, lastMarshalMinute: -999 }];
    restore(live, state, "1x");
    const before = parity(live);
    expect(before.get(1)!.segments[0].dur).toBe(10000);
    live.advanceTime(2000);
    const after = parity(live);
    expect(after.get(1)!.segments[0].dur).toBe(.02);
    expect(before.get(1)!.segments[0].dur).toBe(10000);
  });
  it("invalidates M51 rental reapplication on real hook geometry reconciliation", () => {
    globals();
    const rental = rentalCourse();
    const args = { ...base(), course: rental };
    let live = renderHook(args);
    const state = createLiveState(rental, world, 0);
    state.arrivals = [];
    state.groups = [];
    const g = fixture().golfers[0];
    g.courseId = "course-primary";
    g.groupId = "g-1";
    g.holeIds = ["hole-1"];
    g.capabilities = undefined;
    g.wallet = 100;
    g.archetype = "senior";
    g.personality = { ...g.personality, spendPropensity: 1, prefs: { difficulty: 0, scenery: 0, price: 1 } };
    g.segments = [{ kind: "walk", from: { x: 2, y: 8 }, to: { x: 56, y: 8 }, holeIndex: 0, dur: 180 }];
    state.golfers = [g];
    reserveGroupMobility(state, rental, [g]);
    expect(g.mobilityMode).toBe("riding_cart");
    restore(live, state);
    live = renderHook({ ...args, course: { ...rental, obstacles: [...rental.obstacles] } });
    const before = parity(live);
    const changed = { ...rental, tiles: rental.tiles.map((t, i) => i === 8 * rental.width + 20 ? "water" as const : t) };
    live = renderHook({ ...args, course: changed });
    const after = parity(live);
    expect(after).not.toBe(before);
    expect(JSON.stringify(after.get(1)!.segments)).not.toBe(JSON.stringify(before.get(1)!.segments));
    expect(live.getSnapshot()!.state.golfers[0].mobilityMode).toBe("riding_cart");
    expect(after.get(1)!.segments.some(segment => segment.mobility)).toBe(true);
  });
  it("removes completed golfer IDs and replaces roots at day rollover", () => {
    globals();
    const live = renderHook(base());
    const state = fixture();
    state.golfers[0].segments = [{ kind: "walk", from: { x: 3, y: 9 }, to: { x: 4, y: 9 }, holeIndex: -1, dur: .001 }];
    state.golfers[0].holeStrokes = [];
    state.golfers[0].holePar = [];
    restore(live, state, "1x");
    const before = parity(live);
    expect(before.get(1)).toBeDefined();
    live.advanceTime(2000);
    expect(parity(live).get(1)).toBeUndefined();
    const snapshot = live.getSnapshot()!;
    snapshot.state.dayOver = true;
    expect(live.restoreSnapshot(snapshot)).toBe(true);
    const day = parity(live);
    live.advanceTime(1);
    expect(live.getSnapshot()!.state.dayIndex).toBe((snapshot.state.dayIndex + 1) % 7);
    expect(parity(live)).not.toBe(day);
    expect(parity(live).get(1)).toBeUndefined();
  });
});
